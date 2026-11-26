// App infrastructure for ONE environment (e2e, test or production) of ONE deployment.
// Resource-group scope, deployed by CI into rg-<slug>-<env> (created by infra/bootstrap):
//
//   az deployment group create --name app-infra --resource-group <rg> \
//     --parameters infra/app/main.bicepparam -o none
//
// Static Web App (Free) in swaLocation; storage, Log Analytics and App Insights in dataLocation
// (ADR 0006); optional metric alerts. No role assignments, locks or budgets (infra/bootstrap).
// Outputs are non-secret only. See infra/app/README.md.
targetScope = 'resourceGroup'

@description('Neutral deployment slug from instance.json. The deploy job validates ^wed[0-9a-z]{3,8}$ (Bicep has no regex), Bicep enforces the length.')
@minLength(6)
@maxLength(11)
param deploymentSlug string

@description('Environment of this deployment.')
@allowed([
  'e2e'
  'test'
  'production'
])
param environmentName string

@description('Region for all data at rest: storage, Log Analytics, App Insights (ADR 0006).')
param dataLocation string = 'germanywestcentral'

@description('Region for the Static Web App and its managed functions; SWA is offered only in these regions (ADR 0006).')
@allowed([
  'westeurope'
  'centralus'
  'eastus2'
  'westus2'
  'eastasia'
])
param swaLocation string = 'westus2'

@description('API feature flag Features__Rsvp (instance.json environments.<env>.features.rsvp).')
param featuresRsvp bool = false

@description('API feature flag Features__Admin (instance.json environments.<env>.features.admin).')
param featuresAdmin bool = false

@description('RSVP deadline from instance.json rsvp.deadline: an ISO 8601 date-time, interpreted in rsvpTimeZone (app setting Rsvp__Deadline).')
param rsvpDeadline string

@description('IANA time zone of the RSVP deadline, e.g. Europe/Berlin (app setting Rsvp__TimeZone).')
param rsvpTimeZone string

@description('Log Analytics daily ingestion cap in GB as a decimal string (Bicep has no float type).')
param logDailyCapGb string = '0.1'

@description('Create the SWA metric alerts. They need the action group ag-<slug>-<env> in rg-<slug>-<env>-ops.')
param enableAlerts bool = true

@description('Alert when managed function hits within 15 minutes exceed this.')
@minValue(1)
param alertFunctionHitsThreshold int = 3000

@description('Alert when bytes sent within 1 hour exceed this (default 1 GiB).')
@minValue(1)
param alertBytesSentThreshold int = 1073741824

@description('Alert when managed function errors within 15 minutes exceed this.')
@minValue(1)
param alertFunctionErrorsThreshold int = 50

// Names: neutral slug + environment + a stable hash of the resource group. They never contain
// a SHA or anything personal, so every deploy updates the same resources.
var nameSuffix = uniqueString(resourceGroup().id)
var shortSuffix = take(nameSuffix, 6)
var baseName = '${deploymentSlug}-${environmentName}'
var environmentShortNames = {
  e2e: 'e2e'
  test: 'test'
  production: 'prod'
}
var names = {
  staticWebApp: 'swa-${baseName}-${shortSuffix}'
  // Storage names allow only 3-24 lower-case letters and digits and must be globally unique.
  storageAccount: take(toLower('st${deploymentSlug}${environmentShortNames[environmentName]}${nameSuffix}'), 24)
  logAnalytics: 'log-${baseName}-${shortSuffix}'
  appInsights: 'appi-${baseName}-${shortSuffix}'
  alertPrefix: 'alert-${baseName}'
  // Naming contract with infra/bootstrap (S0-05): ops resource group and action group.
  opsResourceGroup: 'rg-${baseName}-ops'
  actionGroup: 'ag-${baseName}'
}

var tags = {
  app: 'weddingplanner'
  deployment: deploymentSlug
  environment: environmentName
  managedBy: 'bicep'
}

module storage './modules/storage.bicep' = {
  name: 'app-infra-storage'
  params: {
    name: names.storageAccount
    location: dataLocation
    tags: tags
  }
}

module monitoring './modules/monitoring.bicep' = {
  name: 'app-infra-monitoring'
  params: {
    logAnalyticsName: names.logAnalytics
    appInsightsName: names.appInsights
    location: dataLocation
    dailyCapGb: logDailyCapGb
    tags: tags
  }
}

module staticWebApp './modules/static-web-app.bicep' = {
  name: 'app-infra-static-web-app'
  params: {
    name: names.staticWebApp
    location: swaLocation
    tags: tags
    storageAccountName: storage.outputs.storageAccountName
    appInsightsName: monitoring.outputs.appInsightsName
    featuresRsvp: featuresRsvp
    featuresAdmin: featuresAdmin
    rsvpDeadline: rsvpDeadline
    rsvpTimeZone: rsvpTimeZone
  }
}

module alerts './modules/alerts.bicep' = if (enableAlerts) {
  name: 'app-infra-alerts'
  params: {
    namePrefix: names.alertPrefix
    staticWebAppName: staticWebApp.outputs.swaName
    actionGroupId: resourceId(names.opsResourceGroup, 'Microsoft.Insights/actionGroups', names.actionGroup)
    functionHitsThreshold: alertFunctionHitsThreshold
    bytesSentThreshold: alertBytesSentThreshold
    functionErrorsThreshold: alertFunctionErrorsThreshold
    tags: tags
  }
}

output swaName string = staticWebApp.outputs.swaName
output swaDefaultHostname string = staticWebApp.outputs.swaDefaultHostname
output storageAccountName string = storage.outputs.storageAccountName
