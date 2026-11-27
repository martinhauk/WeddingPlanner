// App resource group (rg-<slug>-<env>): CanNotDelete lock plus the role assignments for the deploy
// identity, the backup identity (test, production) and the owner. Contributor cannot remove the
// lock or create role assignments (Microsoft.Authorization write/delete are excluded from
// Contributor).

@description('Principal id of the deploy identity (id-<slug>-<env>).')
param deployPrincipalId string

@description('Object id of the signed-in owner.')
param ownerPrincipalId string

@description('Principal type of the owner.')
@allowed([
  'User'
  'Group'
  'ServicePrincipal'
])
param ownerPrincipalType string

@description('Principal id of the nightly backup identity (id-<slug>-<env>-backup); empty for e2e.')
param backupPrincipalId string = ''

@description('Name (GUID) of the custom backup role (write new blobs, read them back, no delete); empty for e2e.')
param backupWriterRoleId string = ''

// Built-in role definition ids.
var roles = {
  contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  storageTableDataReader: '76199698-9eea-4c19-bc75-cec21354c6b6'
  storageTableDataContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
  reader: 'acdd72a7-3385-48ef-bd42-f606fba81ae7'
}

var assignments = [
  {
    principalId: deployPrincipalId
    principalType: 'ServicePrincipal'
    roleId: roles.contributor
    description: 'WeddingPlanner deploy identity: deploy the app resources'
  }
  {
    principalId: deployPrincipalId
    principalType: 'ServicePrincipal'
    roleId: roles.storageBlobDataContributor
    description: 'WeddingPlanner deploy identity: backups container'
  }
  {
    principalId: deployPrincipalId
    principalType: 'ServicePrincipal'
    roleId: roles.storageTableDataReader
    description: 'WeddingPlanner deploy identity: read tables (backup export)'
  }
  {
    principalId: ownerPrincipalId
    principalType: ownerPrincipalType
    roleId: roles.storageBlobDataContributor
    description: 'WeddingPlanner owner: backups and restores'
  }
  {
    principalId: ownerPrincipalId
    principalType: ownerPrincipalType
    roleId: roles.storageTableDataContributor
    description: 'WeddingPlanner owner: table restores and data fixes'
  }
]

// Role assignment condition (ABAC, condition version 2.0) on the Backup Writer assignment. Writes
// are not affected. "Read a blob" (every blob read except List Blobs) is allowed only for the
// current version of a blob in the container table-backups, never for a previous version (which
// would hold an overwritten original); "List blobs" only in that container. The patterns are from
// Microsoft Learn, "Example Azure role assignment conditions for Blob Storage" (read only current
// blob versions; read or list blobs in named containers). 'table-backups' is the container of
// infra/app/backup.bicep (variable containerName); infra/bootstrap/tests/run.sh checks that both
// agree and that the condition stays exactly this.
var backupReadCondition = '''
(
 (
  !(ActionMatches{'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'} AND NOT SubOperationMatches{'Blob.List'})
 )
 OR
 (
  @Resource[Microsoft.Storage/storageAccounts/blobServices/containers:name] StringEquals 'table-backups'
  AND
  @Resource[Microsoft.Storage/storageAccounts/blobServices/containers/blobs:isCurrentVersion] BoolEquals true
 )
)
AND
(
 (
  !(ActionMatches{'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'} AND SubOperationMatches{'Blob.List'})
 )
 OR
 (
  @Resource[Microsoft.Storage/storageAccounts/blobServices/containers:name] StringEquals 'table-backups'
 )
)
'''

// The nightly backup identity can read the resource group's deployments (to find the account
// names) and the tables, write new blobs, and read back current backups (the nightly check); it
// can delete nothing and write no table.
var backupAssignments = empty(backupPrincipalId)
  ? []
  : [
      {
        principalId: backupPrincipalId
        principalType: 'ServicePrincipal'
        roleId: roles.reader
        description: 'WeddingPlanner backup identity: find the storage accounts'
      }
      {
        principalId: backupPrincipalId
        principalType: 'ServicePrincipal'
        roleId: roles.storageTableDataReader
        description: 'WeddingPlanner backup identity: read tables (nightly export)'
      }
      {
        principalId: backupPrincipalId
        principalType: 'ServicePrincipal'
        roleId: backupWriterRoleId
        description: 'WeddingPlanner backup identity: write new backup blobs, read current backups back'
        condition: backupReadCondition
      }
    ]

resource deleteLock 'Microsoft.Authorization/locks@2020-05-01' = {
  name: 'do-not-delete'
  properties: {
    level: 'CanNotDelete'
    notes: 'Protects the RSVP data of this WeddingPlanner environment. Managed by scripts/bootstrap.sh; see docs/runbooks/azure-onboarding.md before removing it.'
  }
}

resource roleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for assignment in concat(assignments, backupAssignments): {
    name: guid(resourceGroup().id, assignment.principalId, assignment.roleId)
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', assignment.roleId)
      principalId: assignment.principalId
      principalType: assignment.principalType
      description: assignment.description
      condition: assignment.?condition
      conditionVersion: empty(assignment.?condition) ? null : '2.0'
    }
  }
]
