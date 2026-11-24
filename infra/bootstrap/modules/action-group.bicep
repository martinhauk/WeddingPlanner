// Action group for the app's metric alerts (infra/app, S0-04) and, for production, the budget
// (S0-06). Email receivers come from instance.json `alertEmails` and are never output.
//
// The deploy identity gets Monitoring Reader on this action group only: creating an alert rule
// that references an action group needs read permission on that action group (Azure Monitor docs,
// "Create or edit a metric alert rule", prerequisites). Fallback if that ever proves
// insufficient: docs/runbooks/azure-onboarding.md, "Alerts cannot attach the action group".

@description('Name of the action group (ag-<slug>-<env>).')
param actionGroupName string

@description('"global", or a region that offers regional processing for action groups.')
param location string

@description('Environment, used for the short name shown in notifications.')
@allowed([
  'e2e'
  'test'
  'production'
])
param environmentName string

@description('Resource tags.')
param tags object

@description('{ emails: string[] } from instance.json alertEmails.')
@secure()
param alertReceivers object

@description('Principal id of the deploy identity, which gets Monitoring Reader on this action group.')
param deployPrincipalId string

// Monitoring Reader (built-in role).
var monitoringReaderRoleId = '43d0d8ad-25c7-4714-9337-8ba259a9fe05'

// groupShortName allows at most 12 characters and appears in notifications.
var shortNames = {
  e2e: 'wp-e2e'
  test: 'wp-test'
  production: 'wp-prod'
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: actionGroupName
  location: location
  tags: tags
  properties: {
    groupShortName: shortNames[environmentName]
    enabled: true
    emailReceivers: [
      for (email, i) in alertReceivers.emails: {
        name: 'email-${i + 1}'
        emailAddress: email
        useCommonAlertSchema: true
      }
    ]
  }
}

resource deployIdentityMonitoringReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(actionGroup.id, deployPrincipalId, monitoringReaderRoleId)
  scope: actionGroup
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringReaderRoleId)
    principalId: deployPrincipalId
    principalType: 'ServicePrincipal'
    description: 'WeddingPlanner deploy identity: attach metric alerts to this action group'
  }
}

output name string = actionGroup.name
