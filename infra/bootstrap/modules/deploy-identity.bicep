// User-assigned deploy identity with exactly one federated credential: GitHub Actions jobs that
// run in the GitHub Environment <env> of this repository. There is deliberately no credential for
// pull_request or branch subjects, so pull requests never get Azure access.
//
// Deployed into the ops resource group, on which the identity itself has no rights: it cannot
// add federated credentials (or anything else) to itself.

@description('Name of the identity (id-<slug>-<env>).')
param identityName string

@description('Region of the identity.')
param location string

@description('Resource tags.')
param tags object

@description('Federated credential subject: <immutable sub_claim_prefix>:environment:<env>.')
param subject string

@description('Name of the federated credential (github-<env>).')
param credentialName string

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: identityName
  location: location
  tags: tags
}

resource githubEnvironment 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2024-11-30' = {
  parent: identity
  name: credentialName
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: subject
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}

output principalId string = identity.properties.principalId
output clientId string = identity.properties.clientId
output credentialName string = githubEnvironment.name
