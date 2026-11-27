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
  check("blob versioning, 7-day blob and container soft delete, no early permanent delete";
    vars as $v | inner("Microsoft.Storage/storageAccounts/blobServices").properties
    | .isVersioningEnabled == true
      and .deleteRetentionPolicy.enabled == true and (.deleteRetentionPolicy.days | resolve($v)) == 7
      and .deleteRetentionPolicy.allowPermanentDelete == false
      and .containerDeleteRetentionPolicy.enabled == true
      and (.containerDeleteRetentionPolicy.days | resolve($v)) == 7),
  check("exactly one container, private";
    [inner("Microsoft.Storage/storageAccounts/blobServices/containers") | .properties.publicAccess]
    == ["None"] and vars.containerName == "table-backups"),
  # Lifecycle delete is "not supported with blobs in an immutable container" (Microsoft Learn,
  # lifecycle policy structure), so a WORM policy would keep backups past the privacy promise.
  check("no immutability (WORM) policy, legal hold or version-level immutability";
    [nested.properties.template.resources[] | .type | select(test("immutabilityPolicies|legalHold"; "i"))]
    == []
    and ([nested.properties.template.resources[] | .properties | tostring
      | test("immutableStorageWithVersioning|immutabilityPolicy"; "i")] | any | not)),
  check("lifecycle: backups, their previous versions and snapshots deleted after 18 days";
    vars as $v
    | [inner("Microsoft.Storage/storageAccounts/managementPolicies") | .properties.policy.rules[]
      | {enabled, type, blobTypes: .definition.filters.blobTypes,
         prefix: .definition.filters.prefixMatch,
         base: (.definition.actions.baseBlob.delete.daysAfterModificationGreaterThan | resolve($v)),
         version: (.definition.actions.version.delete.daysAfterCreationGreaterThan | resolve($v)),
         snapshot: (.definition.actions.snapshot.delete.daysAfterCreationGreaterThan | resolve($v))}]
    == [{enabled: true, type: "Lifecycle", blobTypes: ["blockBlob"],
         prefix: ["[format('{0}/', variables('containerName'))]"],
         base: 18, version: 18, snapshot: 18}]),
  # The privacy notice promises at most 30 days. Worst case: the threshold, up to three lifecycle
  # runs (at most 24 hours apart: delete the old versions, the current version, the previous
  # version that leaves) and the soft delete period (docs/runbooks/backup-restore.md).
  check("worst case retention + 3 lifecycle runs + soft delete stays within 30 days";
    vars as $v
    | ([inner("Microsoft.Storage/storageAccounts/managementPolicies") | .properties.policy.rules[]
        | .definition.actions[] | .delete | to_entries[] | .value | resolve($v)] | max) as $lifecycle
    | (inner("Microsoft.Storage/storageAccounts/blobServices").properties
        | [.deleteRetentionPolicy.days, .containerDeleteRetentionPolicy.days]
        | map(resolve($v)) | max) as $softDelete
    | $lifecycle + 3 + $softDelete <= 30),

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
