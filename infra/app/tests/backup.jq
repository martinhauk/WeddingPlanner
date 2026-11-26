# Contract checks on the compiled ARM template of infra/app/backup.bicep (see run.sh).
#
#   jq -r -f infra/app/tests/backup.jq backup.json
#
# Prints "group<TAB>name" and "ok<TAB>description" or "FAIL<TAB>description" per check, like
# template.jq. The module compiles to the nested deployment app-backup-storage.

def nested: .resources[] | select(.type == "Microsoft.Resources/deployments" and .name == "app-backup-storage");
def inner($t): nested.properties.template.resources[] | select(.type == $t);
def vars: nested.properties.template.variables;
# "[variables('x')]" -> the value of variable x in $v; anything else unchanged.
def resolve($v):
  if type == "string" and test("^\\[variables\\('[A-Za-z0-9_]+'\\)\\]$")
  then $v[capture("^\\[variables\\('(?<n>[A-Za-z0-9_]+)'\\)\\]$").n]
  else . end;
def account: inner("Microsoft.Storage/storageAccounts");
def check($description; f): {description: $description, ok: (try ([f] == [true]) catch false)};
def group($name): {group: $name};

[
  group("backup store: parameters and name"),
  check("parameters: deploymentSlug, environmentName, dataLocation only";
    (.parameters | keys) == ["dataLocation", "deploymentSlug", "environmentName"]),
  check("one module deployment with a fixed name";
    [.resources[] | .name] == ["app-backup-storage"]),
  check("account name bk<slug><env><hash>: never the data account's st prefix, no SHA or time";
    nested.properties.parameters.name.value
    == "[take(toLower(format('bk{0}{1}{2}', parameters('deploymentSlug'), variables('environmentShortNames')[parameters('environmentName')], variables('nameSuffix'))), 24)]"
    and .variables.nameSuffix == "[uniqueString(resourceGroup().id)]"),
  check("in dataLocation"; nested.properties.parameters.location.value == "[parameters('dataLocation')]"),

  group("backup store: account"),
  check("StorageV2, Standard_LRS"; account | .kind == "StorageV2" and .sku.name == "Standard_LRS"),
  check("Entra ID only: shared key access off, OAuth by default"; account.properties
    | .allowSharedKeyAccess == false and .defaultToOAuthAuthentication == true),
  check("TLS 1.2, HTTPS only, no public blobs, no cross-tenant replication"; account.properties
    | .minimumTlsVersion == "TLS1_2" and .supportsHttpsTrafficOnly == true
      and .allowBlobPublicAccess == false and .allowCrossTenantReplication == false),
  check("blob versioning, 30-day blob and container soft delete";
    vars as $v | inner("Microsoft.Storage/storageAccounts/blobServices").properties
    | .isVersioningEnabled == true
      and .deleteRetentionPolicy.enabled == true and (.deleteRetentionPolicy.days | resolve($v)) == 30
      and .containerDeleteRetentionPolicy.enabled == true
      and (.containerDeleteRetentionPolicy.days | resolve($v)) == 30),
  check("exactly one container, private";
    [inner("Microsoft.Storage/storageAccounts/blobServices/containers") | .properties.publicAccess]
    == ["None"] and vars.containerName == "table-backups"),
  check("WORM: container immutability policy, 30 days, no append writes";
    vars as $v
    | [inner("Microsoft.Storage/storageAccounts/blobServices/containers/immutabilityPolicies")
      | {name: (.name | test("'default'\\)\\]$")),
         days: (.properties.immutabilityPeriodSinceCreationInDays | resolve($v)),
         append: .properties.allowProtectedAppendWrites}]
    == [{name: true, days: 30, append: false}]),
  check("the policy is not locked by the template (no lock or extend resources)";
    [nested.properties.template.resources[] | .type | select(test("immutabilityPolicies/"))] == []),
  check("lifecycle: backups and their versions deleted after 180 days";
    vars as $v
    | [inner("Microsoft.Storage/storageAccounts/managementPolicies") | .properties.policy.rules[]
      | {enabled, base: (.definition.actions.baseBlob.delete.daysAfterModificationGreaterThan | resolve($v)),
         version: (.definition.actions.version.delete.daysAfterCreationGreaterThan | resolve($v))}]
    == [{enabled: true, base: 180, version: 180}]),

  group("backup store: outputs and scope"),
  check("outputs are exactly the account and container names";
    (.outputs | keys) == ["backupContainerName", "backupStorageAccountName"]),
  check("no output carries a key or connection string"; [.outputs[], nested.properties.template.outputs[]
    | .value | tostring | test("listKeys|ConnectionString|primaryKey"; "i")] | any | not),
  check("no role assignments, locks or identities"; [nested.properties.template.resources[] | .type
    | select(test("^Microsoft\\.(Authorization|ManagedIdentity)/"))] == [])
]
| .[]
| if has("group") then "group\t\(.group)"
  else "\(if .ok then "ok" else "FAIL" end)\t\(.description)" end
