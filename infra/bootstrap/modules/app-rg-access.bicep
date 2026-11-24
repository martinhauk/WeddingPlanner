// App resource group (rg-<slug>-<env>): CanNotDelete lock plus the role assignments for the deploy
// identity and the owner. Contributor cannot remove the lock or create role assignments
// (Microsoft.Authorization write/delete are excluded from Contributor).

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

// Built-in role definition ids.
var roles = {
  contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  storageTableDataReader: '76199698-9eea-4c19-bc75-cec21354c6b6'
  storageTableDataContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
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

resource deleteLock 'Microsoft.Authorization/locks@2020-05-01' = {
  name: 'do-not-delete'
  properties: {
    level: 'CanNotDelete'
    notes: 'Protects the RSVP data of this WeddingPlanner environment. Managed by scripts/bootstrap.sh; see docs/runbooks/azure-onboarding.md before removing it.'
  }
}

resource roleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for assignment in assignments: {
    name: guid(resourceGroup().id, assignment.principalId, assignment.roleId)
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', assignment.roleId)
      principalId: assignment.principalId
      principalType: assignment.principalType
      description: assignment.description
    }
  }
]
