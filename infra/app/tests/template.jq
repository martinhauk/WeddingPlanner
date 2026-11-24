# Contract checks on the compiled ARM template of infra/app/main.bicep (see run.sh).
#
#   jq -r -f infra/app/tests/template.jq main.json
#
# Prints one line per check, "ok<TAB>description" or "FAIL<TAB>description", and
# "group<TAB>name" before each group. Bicep compiles every module to a nested deployment, so
# the module checks look inside .properties.template of that deployment. Values are compared
# with the ARM expressions Bicep emits (e.g. "[parameters('location')]").

def nested($n): .resources[] | select(.type == "Microsoft.Resources/deployments" and .name == $n);
def template($n): nested($n).properties.template;
def inner($n; $t): template($n).resources[] | select(.type == $t);
def arg($n; $p): nested($n).properties.parameters[$p].value;
def templates: ., (.resources[]? | select(.type == "Microsoft.Resources/deployments")
  | .properties.template | templates);
def all_resources: templates | .resources[]?;
# "[variables('x')]" -> the value of variable x in $vars; anything else unchanged.
def resolve($vars):
  if type == "string" and test("^\\[variables\\('[A-Za-z0-9_]+'\\)\\]$")
  then $vars[capture("^\\[variables\\('(?<n>[A-Za-z0-9_]+)'\\)\\]$").n]
  else . end;
def p($n): "[parameters('\($n)')]";

def swa: inner("app-infra-static-web-app"; "Microsoft.Web/staticSites");
def settings: inner("app-infra-static-web-app"; "Microsoft.Web/staticSites/config");
def account: inner("app-infra-storage"; "Microsoft.Storage/storageAccounts");
def rules: inner("app-infra-storage"; "Microsoft.Storage/storageAccounts/managementPolicies")
  | .properties.policy.rules[];
def alert: inner("app-infra-alerts"; "Microsoft.Insights/metricAlerts");

# A check passes when its filter yields exactly one value, true, without an error.
def check($description; f): {description: $description, ok: (try ([f] == [true]) catch false)};
def group($name): {group: $name};

[
  group("parameters"),
  check("exactly the expected parameters"; (.parameters | keys) == ([
    "alertBytesSentThreshold", "alertFunctionErrorsThreshold", "alertFunctionHitsThreshold",
    "dataLocation", "deploymentSlug", "enableAlerts", "environmentName", "featuresAdmin",
    "featuresRsvp", "logDailyCapGb", "rsvpDeadline", "rsvpTimeZone", "swaLocation"] | sort)),
  check("deploymentSlug: string, length 6-11";
    .parameters.deploymentSlug | .type == "string" and .minLength == 6 and .maxLength == 11),
  check("environmentName: allowed e2e, test, production";
    .parameters.environmentName.allowedValues == ["e2e", "test", "production"]),
  check("dataLocation: default germanywestcentral";
    .parameters.dataLocation.defaultValue == "germanywestcentral"),
  check("swaLocation: allowed SWA regions, default westeurope"; .parameters.swaLocation
    | .allowedValues == ["westeurope", "centralus", "eastus2", "westus2", "eastasia"]
      and .defaultValue == "westeurope"),
  check("featuresRsvp and featuresAdmin: bool";
    [.parameters.featuresRsvp.type, .parameters.featuresAdmin.type] == ["bool", "bool"]),
  check("rsvpDeadline and rsvpTimeZone: required strings";
    [.parameters.rsvpDeadline, .parameters.rsvpTimeZone]
    | all(.type == "string" and (has("defaultValue") | not))),
  check("logDailyCapGb: string, default \"0.1\"";
    .parameters.logDailyCapGb | .type == "string" and .defaultValue == "0.1"),
  check("enableAlerts: bool, default true";
    .parameters.enableAlerts | .type == "bool" and .defaultValue == true),
  check("alert thresholds default to 3000 hits, 1 GiB, 50 errors";
    [.parameters.alertFunctionHitsThreshold, .parameters.alertBytesSentThreshold,
      .parameters.alertFunctionErrorsThreshold] | map(.defaultValue) == [3000, 1073741824, 50]),
  check("no secure parameters anywhere (no secrets are passed in)";
    [templates | .parameters[]? | .type | ascii_downcase | startswith("secure")] | any | not),

  group("modules, names and tags"),
  check("four modules with fixed deployment names"; [.resources[]
    | select(.type == "Microsoft.Resources/deployments") | .name]
    == ["app-infra-storage", "app-infra-monitoring", "app-infra-static-web-app", "app-infra-alerts"]),
  check("only the alerts module is conditional, on enableAlerts";
    [.resources[] | {name, condition}] == [
      {name: "app-infra-storage", condition: null},
      {name: "app-infra-monitoring", condition: null},
      {name: "app-infra-static-web-app", condition: null},
      {name: "app-infra-alerts", condition: p("enableAlerts")}]),
  check("name suffix is uniqueString(resourceGroup().id)";
    .variables.nameSuffix == "[uniqueString(resourceGroup().id)]"),
  check("base name is <slug>-<env>"; .variables.baseName
    == "[format('{0}-{1}', parameters('deploymentSlug'), parameters('environmentName'))]"),
  check("SWA, Log Analytics and App Insights names: prefix-<slug>-<env>-<hash>";
    .variables.names | [.staticWebApp, .logAnalytics, .appInsights] == [
      "[format('swa-{0}-{1}', variables('baseName'), variables('shortSuffix'))]",
      "[format('log-{0}-{1}', variables('baseName'), variables('shortSuffix'))]",
      "[format('appi-{0}-{1}', variables('baseName'), variables('shortSuffix'))]"]),
  check("short hash is the first 6 characters of the suffix";
    .variables.shortSuffix == "[take(variables('nameSuffix'), 6)]"),
  check("storage name: st<slug><env><hash>, lower case, at most 24 characters";
    .variables.names.storageAccount == "[take(toLower(format('st{0}{1}{2}', parameters('deploymentSlug'), variables('environmentShortNames')[parameters('environmentName')], variables('nameSuffix'))), 24)]"),
  check("names never depend on a SHA, the time or the deployment name";
    .variables.names | tostring | test("utcNow|deployment\\(\\)|newGuid") | not),
  check("ops resource group is rg-<slug>-<env>-ops (bootstrap naming contract)";
    .variables.names.opsResourceGroup == "[format('rg-{0}-ops', variables('baseName'))]"),
  check("action group is ag-<slug>-<env> (bootstrap naming contract)";
    .variables.names.actionGroup == "[format('ag-{0}', variables('baseName'))]"),
  check("tags: app, deployment (slug), environment, managedBy"; .variables.tags == {
    app: "weddingplanner", deployment: p("deploymentSlug"),
    environment: p("environmentName"), managedBy: "bicep"}),
  check("every module receives the tags";
    [.resources[] | .properties.parameters.tags.value] | all(. == "[variables('tags')]")),
  check("every top-level resource is tagged"; [all_resources | select(.type | IN(
    "Microsoft.Web/staticSites", "Microsoft.Storage/storageAccounts",
    "Microsoft.OperationalInsights/workspaces", "Microsoft.Insights/components",
    "Microsoft.Insights/metricAlerts")) | .tags] | length == 5 and all(. == p("tags"))),

  group("static web app"),
  check("module location is swaLocation";
    arg("app-infra-static-web-app"; "location") == p("swaLocation")),
  check("SWA in the location parameter, sku Free"; swa
    | .location == p("location") and .sku == {name: "Free", tier: "Free"}),
  check("stagingEnvironmentPolicy Disabled, allowConfigFileUpdates true"; swa.properties
    | .stagingEnvironmentPolicy == "Disabled" and .allowConfigFileUpdates == true),
  check("exactly one config resource, appsettings";
    [settings | .name] == ["[format('{0}/{1}', parameters('name'), 'appsettings')]"]),
  check("app settings are exactly the complete set"; settings.properties | keys == ([
    "Storage__ConnectionString", "APPLICATIONINSIGHTS_CONNECTION_STRING", "Features__Rsvp",
    "Features__Admin", "Rsvp__Deadline", "Rsvp__TimeZone"] | sort)),
  check("no app setting uses a prefix SWA reserves"; settings.properties | keys
    | map(ascii_upcase) | all(test("^(APPSETTING_|AZUREBLOBSTORAGE_|AZUREFILESSTORAGE_|AZURE_FUNCTION_|CONTAINER_|DIAGNOSTICS_|DOCKER_|FUNCTIONS_|IDENTITY_|MACHINEKEY_|MAINSITE_|MSDEPLOY_|SCMSITE_|SCM_|WEBSITES_|WEBSITE_|WEBSOCKET_|AZUREWEB)") | not)),
  check("no tag name SWA reserves"; .variables.tags | keys | map(ascii_downcase)
    | all(IN("accountid", "environmentid", "functionappid") | not)),
  check("Storage__ConnectionString: listKeys of the existing account, never a parameter";
    settings.properties.Storage__ConnectionString
    | startswith("[format('DefaultEndpointsProtocol=https;AccountName={0};AccountKey={1};EndpointSuffix={2}', parameters('storageAccountName'), listKeys(resourceId('Microsoft.Storage/storageAccounts', parameters('storageAccountName'))")
      and endswith(".keys[0].value, environment().suffixes.storage)]")),
  check("the SWA module declares no storage account (existing reference only)";
    [inner("app-infra-static-web-app"; "Microsoft.Storage/storageAccounts")] == []),
  check("APPLICATIONINSIGHTS_CONNECTION_STRING read from the existing component";
    settings.properties.APPLICATIONINSIGHTS_CONNECTION_STRING
    | startswith("[reference(resourceId('Microsoft.Insights/components', parameters('appInsightsName'))")
      and endswith(".ConnectionString]")),
  check("feature flags are the strings true/false"; settings.properties
    | .Features__Rsvp == "[if(parameters('featuresRsvp'), 'true', 'false')]"
      and .Features__Admin == "[if(parameters('featuresAdmin'), 'true', 'false')]"),
  check("Rsvp__Deadline and Rsvp__TimeZone from the parameters"; settings.properties
    | .Rsvp__Deadline == p("rsvpDeadline") and .Rsvp__TimeZone == p("rsvpTimeZone")),
  check("module receives flags, deadline and time zone from main";
    nested("app-infra-static-web-app").properties.parameters
    | [.featuresRsvp, .featuresAdmin, .rsvpDeadline, .rsvpTimeZone] | map(.value)
    == [p("featuresRsvp"), p("featuresAdmin"), p("rsvpDeadline"), p("rsvpTimeZone")]),

  group("storage"),
  check("module location is dataLocation"; arg("app-infra-storage"; "location") == p("dataLocation")),
  check("account: StorageV2, Standard_LRS, in the location parameter"; account
    | .kind == "StorageV2" and .sku.name == "Standard_LRS" and .location == p("location")),
  check("account: TLS 1.2, HTTPS only, no public blobs, shared key on, OAuth by default";
    account.properties | .minimumTlsVersion == "TLS1_2" and .supportsHttpsTrafficOnly == true
      and .allowBlobPublicAccess == false and .allowSharedKeyAccess == true
      and .defaultToOAuthAuthentication == true),
  check("blob versioning, 30-day blob and container soft delete";
    template("app-infra-storage").variables as $v
    | inner("app-infra-storage"; "Microsoft.Storage/storageAccounts/blobServices").properties
    | .isVersioningEnabled == true
      and .deleteRetentionPolicy.enabled == true
      and (.deleteRetentionPolicy.days | resolve($v)) == 30
      and .containerDeleteRetentionPolicy.enabled == true
      and (.containerDeleteRetentionPolicy.days | resolve($v)) == 30),
  check("exactly one container: private backups";
    [inner("app-infra-storage"; "Microsoft.Storage/storageAccounts/blobServices/containers")
      | {name, access: .properties.publicAccess}]
    == [{name: "[format('{0}/{1}/{2}', parameters('name'), 'default', 'backups')]", access: "None"}]),
  check("tables Rsvps, Guests, MatchDecisions, Settings";
    template("app-infra-storage").variables.tableNames
      == ["Rsvps", "Guests", "MatchDecisions", "Settings"]
    and ([inner("app-infra-storage"; "Microsoft.Storage/storageAccounts/tableServices/tables")
      | [.copy.count, .name]] == [["[length(variables('tableNames'))]",
        "[format('{0}/{1}/{2}', parameters('name'), 'default', variables('tableNames')[copyIndex()])]"]])),
  check("lifecycle: previous versions deleted after 90 days";
    template("app-infra-storage").variables as $v
    | [rules | select(.enabled and .definition.filters.prefixMatch == null)
      | .definition.actions.version.delete.daysAfterCreationGreaterThan | resolve($v)] == [90]),
  check("lifecycle: backups/ deleted after 180 days";
    template("app-infra-storage").variables as $v
    | [rules | select(.enabled and (.definition.filters.prefixMatch == ["backups/"]
        or .definition.filters.prefixMatch == ["[format('{0}/', 'backups')]"]))
      | .definition.actions.baseBlob.delete.daysAfterModificationGreaterThan | resolve($v)] == [180]),

  group("monitoring"),
  check("module location is dataLocation, cap from logDailyCapGb";
    nested("app-infra-monitoring").properties.parameters
    | .location.value == p("dataLocation") and .dailyCapGb.value == p("logDailyCapGb")),
  check("Log Analytics: PerGB2018, 30-day retention, dailyQuotaGb = json(cap)";
    inner("app-infra-monitoring"; "Microsoft.OperationalInsights/workspaces")
    | .location == p("location") and .properties.sku.name == "PerGB2018"
      and .properties.retentionInDays == 30
      and .properties.workspaceCapping.dailyQuotaGb == "[json(parameters('dailyCapGb'))]"),
  check("App Insights: workspace-based, in the same location";
    inner("app-infra-monitoring"; "Microsoft.Insights/components")
    | .location == p("location") and .kind == "web"
      and .properties.IngestionMode == "LogAnalytics"
      and .properties.WorkspaceResourceId
        == "[resourceId('Microsoft.OperationalInsights/workspaces', parameters('logAnalyticsName'))]"),

  group("alerts"),
  check("action group via resourceId() in the ops resource group";
    arg("app-infra-alerts"; "actionGroupId")
    == "[resourceId(variables('names').opsResourceGroup, 'Microsoft.Insights/actionGroups', variables('names').actionGroup)]"),
  check("thresholds come from the parameters"; nested("app-infra-alerts").properties.parameters
    | [.functionHitsThreshold, .bytesSentThreshold, .functionErrorsThreshold] | map(.value)
    == [p("alertFunctionHitsThreshold"), p("alertBytesSentThreshold"), p("alertFunctionErrorsThreshold")]),
  check("FunctionHits / 15 min, BytesSent / 1 h, FunctionErrors / 15 min";
    template("app-infra-alerts").variables.alertDefinitions | map({metricName, windowSize, threshold})
    == [
      {metricName: "FunctionHits", windowSize: "PT15M", threshold: p("functionHitsThreshold")},
      {metricName: "BytesSent", windowSize: "PT1H", threshold: p("bytesSentThreshold")},
      {metricName: "FunctionErrors", windowSize: "PT15M", threshold: p("functionErrorsThreshold")}]),
  check("one global metric alert per definition, scoped to the Static Web App"; alert
    | .copy.count == "[length(variables('alertDefinitions'))]" and .location == "global"
      and .properties.scopes == ["[resourceId('Microsoft.Web/staticSites', parameters('staticWebAppName'))]"]),
  check("static threshold: Total greater than threshold, evaluated every 5 minutes";
    alert.properties | .enabled == true and .evaluationFrequency == "PT5M"
      and (.criteria.allOf | length == 1 and (.[0] | .criterionType == "StaticThresholdCriterion"
        and .operator == "GreaterThan" and .timeAggregation == "Total"
        and .metricNamespace == "Microsoft.Web/staticSites"
        and .metricName == "[variables('alertDefinitions')[copyIndex()].metricName]"
        and .threshold == "[variables('alertDefinitions')[copyIndex()].threshold]"))
      and .windowSize == "[variables('alertDefinitions')[copyIndex()].windowSize]"),
  check("alerts notify the action group";
    alert.properties.actions == [{actionGroupId: p("actionGroupId")}]),

  group("outputs and scope"),
  check("outputs are exactly swaName, swaDefaultHostname, storageAccountName";
    .outputs | keys == ["storageAccountName", "swaDefaultHostname", "swaName"]),
  check("no output anywhere carries a key or connection string"; [templates | .outputs[]?
    | (.type | ascii_downcase | startswith("secure"))
      or (.value | tostring | test("listKeys|ConnectionString|InstrumentationKey|primaryKey|apiKey"; "i"))]
    | any | not),
  check("no role assignments, locks, budgets, identities or action groups"; [all_resources | .type
    | select(test("^Microsoft\\.(Authorization|Consumption|CostManagement|ManagedIdentity)/")
      or . == "Microsoft.Insights/actionGroups")] == [])
]
| .[]
| if has("group") then "group\t\(.group)"
  else "\(if .ok then "ok" else "FAIL" end)\t\(.description)" end
