// Bootstrap core for ONE environment (e2e, test or production) of a WeddingPlanner deployment.
//
// Subscription scope, deployed by the owner through scripts/bootstrap.sh (never by CI):
//   rg-<slug>-<env>       app resource group (S0-04 deploys into it), CanNotDelete lock
//   rg-<slug>-<env>-ops   ops resource group the deploy identity has NO rights on:
//     id-<slug>-<env>     user-assigned deploy identity with one federated credential for the
//                         GitHub Environment <env> (no pull_request or branch credential)
//     ag-<slug>-<env>     action group (emails from instance.json) for the app's metric alerts
//
// RBAC (least privilege):
//   deploy identity: Contributor, Storage Blob Data Contributor and Storage Table Data Reader on
//                    the app RG; Monitoring Reader on the action group only (to attach alerts)
//   signed-in owner: Storage Blob Data Contributor and Storage Table Data Contributor on the app RG
//
// The names are a contract with infra/app (S0-04) and scripts/bootstrap-cost.sh (S0-06). Module
// (deployment) names are fixed so the deployment history of the locked app RG never grows.
// Outputs are non-secret identifiers only; the alert emails are a secure parameter, so they are
// not stored in the deployment history.
targetScope = 'subscription'

@description('Neutral deployment slug from instance.json (^wed[0-9a-z]{3,8}$; the regex is checked by scripts/bootstrap.sh).')
@minLength(6)
@maxLength(11)
param deploymentSlug string

@description('Environment, the same name as the GitHub Environment.')
@allowed([
  'e2e'
  'test'
  'production'
])
param environmentName string

@description('Region for the resource groups, the identity and (where supported) the action group.')
param dataLocation string = 'germanywestcentral'

@description('Region of the action group: "global" or a region with regional processing. Empty picks dataLocation when it supports regional processing, else "global". The location of an existing action group cannot change; the script passes it on re-runs.')
param actionGroupLocation string = ''

@description('GitHub OIDC subject prefix of this repository, from GET repos/{repo}/actions/oidc/customization/sub (sub_claim_prefix), e.g. "repo:<owner>@<owner-id>/<repo>@<repo-id>".')
@minLength(6)
param githubSubjectPrefix string

@description('Alert recipients from instance.json: { emails: string[] }. Secure, so the addresses are not stored in the deployment history.')
@secure()
param alertReceivers object

@description('Object id of the signed-in owner, who gets data-plane access to storage in the app RG.')
param ownerPrincipalId string

@description('Principal type of the owner.')
@allowed([
  'User'
  'Group'
  'ServicePrincipal'
])
param ownerPrincipalType string = 'User'

var appResourceGroupName = 'rg-${deploymentSlug}-${environmentName}'
var opsResourceGroupName = 'rg-${deploymentSlug}-${environmentName}-ops'
var identityName = 'id-${deploymentSlug}-${environmentName}'
var actionGroupName = 'ag-${deploymentSlug}-${environmentName}'

// Regions that offer regional processing for action groups (Azure Monitor docs, "Global and
// regional action group processing"). Elsewhere the action group is global.
var regionalActionGroupLocations = [
  'eastus'
  'westus'
  'eastus2'
  'westus2'
  'southcentralus'
  'northcentralus'
  'swedencentral'
  'germanywestcentral'
  'centralindia'
  'southindia'
]
var effectiveActionGroupLocation = !empty(actionGroupLocation)
  ? actionGroupLocation
  : (contains(regionalActionGroupLocations, toLower(dataLocation)) ? dataLocation : 'global')

var tags = {
  app: 'weddingplanner'
  deployment: deploymentSlug
  environment: environmentName
  managedBy: 'bootstrap'
}

resource appResourceGroup 'Microsoft.Resources/resourceGroups@2025-04-01' = {
  name: appResourceGroupName
  location: dataLocation
  tags: tags
}

resource opsResourceGroup 'Microsoft.Resources/resourceGroups@2025-04-01' = {
  name: opsResourceGroupName
  location: dataLocation
  tags: tags
}

module deployIdentity 'modules/deploy-identity.bicep' = {
  name: 'bootstrap-deploy-identity'
  scope: opsResourceGroup
  params: {
    identityName: identityName
    location: dataLocation
    tags: tags
    subject: '${githubSubjectPrefix}:environment:${environmentName}'
    credentialName: 'github-${environmentName}'
  }
}

module actionGroup 'modules/action-group.bicep' = {
  name: 'bootstrap-action-group'
  scope: opsResourceGroup
  params: {
    actionGroupName: actionGroupName
    location: effectiveActionGroupLocation
    environmentName: environmentName
    tags: tags
    alertReceivers: alertReceivers
    deployPrincipalId: deployIdentity.outputs.principalId
  }
}

module appResourceGroupAccess 'modules/app-rg-access.bicep' = {
  name: 'bootstrap-app-rg-access'
  scope: appResourceGroup
  params: {
    deployPrincipalId: deployIdentity.outputs.principalId
    ownerPrincipalId: ownerPrincipalId
    ownerPrincipalType: ownerPrincipalType
  }
}

output appResourceGroupName string = appResourceGroup.name
output opsResourceGroupName string = opsResourceGroup.name
output identityName string = identityName
output identityClientId string = deployIdentity.outputs.clientId
output federatedCredentialName string = deployIdentity.outputs.credentialName
output actionGroupName string = actionGroup.outputs.name
output actionGroupLocation string = effectiveActionGroupLocation
