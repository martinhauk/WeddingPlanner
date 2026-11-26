// Backup store of one environment: a storage account of its own (never the data account) with a
// private container for the table backups of tools/table-backup.
//
// Protection, from the outside in:
//   - the app resource group's CanNotDelete lock (infra/bootstrap): the account, its container
//     and the immutability policy cannot be deleted by anyone without removing the lock first;
//   - a time-based immutability policy (WORM) on the container: no backup blob can be modified or
//     deleted for `immutabilityDays` after it was written. The policy stays UNLOCKED so the owner
//     can still correct it; locking is a one-way owner decision (docs/runbooks/backup-restore.md);
//   - blob versioning and soft delete for blobs and containers (`softDeleteDays`);
//   - Microsoft Entra ID only: shared key access is off, so no account key can read or write it.
// A lifecycle rule deletes backups (and any previous versions) after `retentionDays`.

@description('Storage account name (3-24 lower-case letters and digits, globally unique).')
@minLength(3)
@maxLength(24)
param name string

@description('Region for the account (dataLocation, ADR 0006).')
param location string

@description('Tags applied to the account.')
param tags object

@description('Name of the private backup container.')
var containerName = 'table-backups'

@description('Days a backup blob is immutable (WORM) after it was written.')
var immutabilityDays = 30

@description('Days that deleted blobs and containers stay recoverable.')
var softDeleteDays = 30

@description('Days after which backups and previous versions are deleted.')
var retentionDays = 180

resource account 'Microsoft.Storage/storageAccounts@2026-06-01' = {
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
    // Entra ID only: no account key or SAS can reach the backups.
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    allowCrossTenantReplication: false
    // GitHub-hosted runners have no fixed addresses; access is limited by RBAC instead.
    publicNetworkAccess: 'Enabled'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2026-06-01' = {
  parent: account
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

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2026-06-01' = {
  parent: blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}

// Container-level time-based retention (WORM), unlocked. Applies to every blob in the container.
resource immutability 'Microsoft.Storage/storageAccounts/blobServices/containers/immutabilityPolicies@2026-06-01' = {
  parent: container
  name: 'default'
  properties: {
    immutabilityPeriodSinceCreationInDays: immutabilityDays
    allowProtectedAppendWrites: false
  }
}

resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2026-06-01' = {
  parent: account
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'delete-old-backups'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: [
                'blockBlob'
              ]
              // Referencing the container also orders this policy after the blob service, whose
              // versioning the version action relies on.
              prefixMatch: [
                '${container.name}/'
              ]
            }
            actions: {
              baseBlob: {
                delete: {
                  daysAfterModificationGreaterThan: retentionDays
                }
              }
              version: {
                delete: {
                  daysAfterCreationGreaterThan: retentionDays
                }
              }
            }
          }
        }
      ]
    }
  }
}

output accountName string = account.name
output containerName string = container.name
