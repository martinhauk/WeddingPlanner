// Log Analytics workspace with a daily ingestion cap, plus a workspace-based Application
// Insights component for the API. Both live in `location` (the deployment's dataLocation).
// The connection string is read by static-web-app.bicep through an `existing` reference and is
// never an output.

@description('Log Analytics workspace name.')
@minLength(4)
@maxLength(63)
param logAnalyticsName string

@description('Application Insights component name.')
@minLength(1)
@maxLength(260)
param appInsightsName string

@description('Region for both resources (dataLocation).')
param location string

@description('Daily ingestion cap in GB as a decimal string, e.g. \'0.1\' (Bicep has no float type).')
param dailyCapGb string

@description('Tags applied to both resources.')
param tags object

resource workspace 'Microsoft.OperationalInsights/workspaces@2026-03-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: json(dailyCapGb)
    }
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
    // Client IP addresses are never stored (privacy).
    DisableIpMasking: false
    // Managed functions have no managed identity, so ingestion uses the connection string.
    DisableLocalAuth: false
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

output appInsightsName string = appInsights.name
