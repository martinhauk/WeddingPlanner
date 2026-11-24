// Storage account for one environment: Table Storage for runtime data and a private `backups`
// blob container for the nightly table export. All data at rest stays in `location` (the
// deployment's dataLocation, ADR 0006). There is no `content` container: content is baked into
// the static build from the private instance repo.

@description('Storage account name (3-24 lower-case letters and digits, globally unique).')
@minLength(3)
@maxLength(24)
param name string

@description('Region for the account and therefore for all data at rest (dataLocation).')
param location string

@description('Tags applied to the account.')
param tags object

@description('Tables the API uses (ADR 0002).')
var tableNames = [
  'Rsvps'
  'Guests'
  'MatchDecisions'
  'Settings'
]

@description('Days that deleted blobs and containers stay recoverable.')
var softDeleteDays = 30

@description('Days after which previous blob versions are deleted.')
var previousVersionRetentionDays = 90

@description('Days after which blobs under backups/ are deleted.')
var backupRetentionDays = 180

resource storageAccount 'Microsoft.Storage/storageAccounts@2026-06-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // Shared key access must stay on: SWA managed functions have no managed identity, so the
    // API authenticates with the connection string in the SWA app settings (ADR 0002).
    allowSharedKeyAccess: true
    // Portal and tooling default to Entra ID instead of the account key.
    defaultToOAuthAuthentication: true
    allowCrossTenantReplication: false
    // Managed functions run on shared infrastructure without fixed outbound addresses, so the
    // account cannot be restricted by network rules.
    publicNetworkAccess: 'Enabled'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2026-06-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: {
      enabled: true
      days: softDeleteDays
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: softDeleteDays
    }
  }
}

resource backupsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2026-06-01' = {
  parent: blobService
  name: 'backups'
  properties: {
    publicAccess: 'None'
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2026-06-01' = {
  parent: storageAccount
  name: 'default'
}

resource tables 'Microsoft.Storage/storageAccounts/tableServices/tables@2026-06-01' = [
  for tableName in tableNames: {
    parent: tableService
    name: tableName
  }
]

resource lifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2026-06-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'delete-previous-versions'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: [
                'blockBlob'
              ]
            }
            actions: {
              version: {
                delete: {
                  daysAfterCreationGreaterThan: previousVersionRetentionDays
                }
              }
            }
          }
        }
        {
          name: 'delete-old-backups'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: [
                'blockBlob'
              ]
              // Referencing the container also orders this policy after the blob service,
              // whose versioning the version action above relies on.
              prefixMatch: [
                '${backupsContainer.name}/'
              ]
            }
            actions: {
              baseBlob: {
                delete: {
                  daysAfterModificationGreaterThan: backupRetentionDays
                }
              }
            }
          }
        }
      ]
    }
  }
}

output storageAccountName string = storageAccount.name
