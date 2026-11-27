// Backup store of one environment: a storage account of its own (never the data account) with a
// private container for the table backups of tools/table-backup.
//
// Retention: the privacy notice promises that backups are kept for at most 30 days. Every copy of a
// backup (the blob, a previous version, its soft-deleted state) is gone at the latest
//   retentionDays (lifecycle threshold)                           18 days
//   + 1 lifecycle run that deletes the current version           <= 1 day
//   + 1 run that deletes the previous version that delete leaves <= 1 day
//   + softDeleteDays                                                7 days
//   = 27 days after it was written (28 for a blob that was ever overwritten, one more run; one
// day more each if Azure counts "GreaterThan" in whole days, which Microsoft Learn does not say).
// Lifecycle runs start at most 24 hours after the previous one completed, so 1 to 3 days of slack
// remain. docs/runbooks/backup-restore.md explains the arithmetic and its sources.
//
// There is deliberately NO immutability (WORM) policy on the container: Microsoft documents that
// the lifecycle delete action is "not supported with blobs in an immutable container", so a
// container-level time-based retention policy would keep backups forever and break the promise.
// An existing policy from earlier versions must be deleted by the owner (runbook, one-time step);
// infra/app/tests/backup.jq fails if this template ever creates one again.
//
// Protection, from the outside in:
//   - the app resource group's CanNotDelete lock (infra/bootstrap): the account cannot be deleted
//     by anyone without removing the lock first;
//   - Microsoft Entra ID only: shared key access is off, so no account key can read or write it;
//     the nightly identity can only write new blobs (no read, no delete);
//   - blob versioning: an overwrite keeps the original as a previous version;
//   - soft delete for blobs and containers (`softDeleteDays`), permanent delete off: anything
//     deleted by hand or by mistake stays recoverable for that long.
// A lifecycle rule deletes backups, their previous versions and snapshots after `retentionDays`.

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

@description('Days that deleted blobs and containers stay recoverable (soft delete).')
var softDeleteDays = 7

@description('Days after which backups, their previous versions and snapshots are deleted.')
var retentionDays = 18

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
      // Soft-deleted versions and snapshots cannot be purged early by anyone.
      allowPermanentDelete: false
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
              snapshot: {
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
