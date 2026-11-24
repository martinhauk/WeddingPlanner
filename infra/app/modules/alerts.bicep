// Metric alerts on the Static Web App, the early warning for cost and abuse: SWA Free stops
// serving after 100 GB/month and managed function executions beyond the free grant are billed.
// They notify the environment's action group, which bootstrap (infra/bootstrap) creates in the
// ops resource group; the deploy identity needs Monitoring Reader on it.

@description('Prefix for the alert rule names, e.g. alert-<slug>-<env>.')
param namePrefix string

@description('Name of the Static Web App (in this resource group) the alerts watch.')
param staticWebAppName string

@description('Resource ID of the action group that is notified.')
param actionGroupId string

@description('Alert when managed function hits in 15 minutes exceed this.')
@minValue(1)
param functionHitsThreshold int

@description('Alert when bytes sent in 1 hour exceed this.')
@minValue(1)
param bytesSentThreshold int

@description('Alert when managed function errors in 15 minutes exceed this.')
@minValue(1)
param functionErrorsThreshold int

@description('Tags applied to the alert rules.')
param tags object

// SWA metrics have a 5-minute grain (PT5M); all are counted with the Total aggregation.
var alertDefinitions = [
  {
    suffix: 'function-hits'
    metricName: 'FunctionHits'
    threshold: functionHitsThreshold
    windowSize: 'PT15M'
    severity: 2
    description: 'API (managed functions) hits above the threshold within 15 minutes. Possible abuse: check App Insights and consider the API lockdown.'
  }
  {
    suffix: 'bytes-sent'
    metricName: 'BytesSent'
    threshold: bytesSentThreshold
    windowSize: 'PT1H'
    severity: 2
    description: 'Outgoing traffic above the threshold within 1 hour. SWA Free stops serving after 100 GB per month (shared by the subscription).'
  }
  {
    suffix: 'function-errors'
    metricName: 'FunctionErrors'
    threshold: functionErrorsThreshold
    windowSize: 'PT15M'
    severity: 3
    description: 'API (managed functions) errors above the threshold within 15 minutes. Check App Insights.'
  }
]

resource staticWebApp 'Microsoft.Web/staticSites@2025-03-01' existing = {
  name: staticWebAppName
}

resource metricAlerts 'Microsoft.Insights/metricAlerts@2026-01-01' = [
  for alert in alertDefinitions: {
    name: '${namePrefix}-${alert.suffix}'
    location: 'global'
    tags: tags
    properties: {
      description: alert.description
      severity: alert.severity
      enabled: true
      scopes: [
        staticWebApp.id
      ]
      evaluationFrequency: 'PT5M'
      windowSize: alert.windowSize
      autoMitigate: true
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
        allOf: [
          {
            criterionType: 'StaticThresholdCriterion'
            name: alert.metricName
            metricNamespace: 'Microsoft.Web/staticSites'
            metricName: alert.metricName
            operator: 'GreaterThan'
            threshold: alert.threshold
            timeAggregation: 'Total'
          }
        ]
      }
      actions: [
        {
          actionGroupId: actionGroupId
        }
      ]
    }
  }
]
