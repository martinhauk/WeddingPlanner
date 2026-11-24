// Cost guardrails of a WeddingPlanner deployment: ONE monthly budget and ONE cost anomaly alert
// for the whole subscription, which holds the e2e, test and production environments.
//
// Subscription scope, deployed by the owner through scripts/bootstrap-cost.sh (never by CI). It is
// kept out of infra/bootstrap/main.bicep because Cost Management can reject budgets and anomaly
// alerts for up to 48 hours after a subscription is created, which must never block a bootstrap or
// a deploy. Docs: docs/cost-and-abuse.md.
//
//   budget-<slug>   Microsoft.Consumption/budgets, Monthly, amount in the billing currency.
//                   Notifications (at most five per budget): Actual 10/50/100 % and Forecasted
//                   50/100 %, each to the alert emails, the production action group
//                   ag-<slug>-production (rg-<slug>-production-ops, created by bootstrap.sh) and
//                   the subscription's Owner role.
//   anomaly-<slug>  Microsoft.CostManagement/scheduledActions, kind InsightAlert: the daily cost
//                   anomaly check of the subscription, emailed to the alert emails.
//
// Budgets only alert: they never stop spending, and cost data arrives 8-24 hours late.
// The alert emails are a secure parameter, so they are not stored in the deployment history.
// Outputs are names and dates only.
targetScope = 'subscription'

@description('Neutral deployment slug from instance.json (^wed[0-9a-z]{3,8}$; the regex is checked by scripts/bootstrap-cost.sh).')
@minLength(6)
@maxLength(11)
param deploymentSlug string

@description('Monthly budget in the billing currency of the subscription (instance.json budgetAmount).')
@minValue(1)
param budgetAmount int = 10

@description('First day of the budget, always the first of a month (yyyy-MM-01T00:00:00Z). A new budget starts in the current month; re-runs must pass the start date of the existing budget, which the script reads from Azure.')
@minLength(10)
param budgetStartDate string = '${utcNow('yyyy-MM')}-01T00:00:00Z'

@description('Alert recipients from instance.json: { emails: string[] } (at least one). Secure, so the addresses are not stored in the deployment history.')
@secure()
param alertReceivers object

@description('Start of the anomaly alert schedule (UTC). Re-runs pass the start date of the existing alert.')
param anomalyAlertStartDate string = utcNow('yyyy-MM-ddTHH:00:00Z')

@description('End of the anomaly alert schedule (UTC). Cost Management allows at most one year from today, so every run of the script extends it to one year ahead.')
param anomalyAlertEndDate string = dateTimeAdd(utcNow('yyyy-MM-dd'), 'P1Y')

var budgetName = 'budget-${deploymentSlug}'
var anomalyAlertName = 'anomaly-${deploymentSlug}'

// The production action group is created by infra/bootstrap/main.bicep (scripts/bootstrap.sh
// --env production); scripts/bootstrap-cost.sh checks that it exists before deploying.
resource productionActionGroup 'Microsoft.Insights/actionGroups@2023-01-01' existing = {
  name: 'ag-${deploymentSlug}-production'
  scope: resourceGroup('rg-${deploymentSlug}-production-ops')
}

// Five notifications, the maximum a budget allows. Thresholds are percentages of the amount.
// They are keyed like the portal does, e.g. "Actual_GreaterThan_10_Percent".
var budgetNotifications = [
  {
    thresholdType: 'Actual'
    threshold: 10
  }
  {
    thresholdType: 'Actual'
    threshold: 50
  }
  {
    thresholdType: 'Actual'
    threshold: 100
  }
  {
    thresholdType: 'Forecasted'
    threshold: 50
  }
  {
    thresholdType: 'Forecasted'
    threshold: 100
  }
]

// No filter: the budget covers every cost in the subscription, i.e. all three environments.
resource budget 'Microsoft.Consumption/budgets@2026-06-01' = {
  name: budgetName
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: {
      // No end date: Azure defaults it to ten years after the start.
      startDate: budgetStartDate
    }
    notifications: toObject(
      budgetNotifications,
      n => '${n.thresholdType}_GreaterThan_${n.threshold}_Percent',
      n => {
        enabled: true
        operator: 'GreaterThan'
        threshold: n.threshold
        thresholdType: n.thresholdType
        contactEmails: alertReceivers.emails
        contactGroups: [
          productionActionGroup.id
        ]
        contactRoles: [
          'Owner'
        ]
        locale: 'en-us'
      }
    )
  }
}

// Anomaly alerts exist only at subscription scope and run daily. The portal lists only alerts
// whose view is ms:DailyAnomalyByResourceGroup. Recipients get one email per detected anomaly.
resource anomalyAlert 'Microsoft.CostManagement/scheduledActions@2026-06-01' = {
  name: anomalyAlertName
  kind: 'InsightAlert'
  properties: {
    displayName: 'WeddingPlanner ${deploymentSlug}: cost anomaly'
    status: 'Enabled'
    viewId: '${subscription().id}/providers/Microsoft.CostManagement/views/ms:DailyAnomalyByResourceGroup'
    notificationEmail: first(alertReceivers.emails)
    notification: {
      to: alertReceivers.emails
      subject: 'WeddingPlanner ${deploymentSlug}: cost anomaly detected'
      message: 'Daily cost changed unexpectedly. Check Cost analysis, the API metric alerts and, if it is an attack, run scripts/ops/lockdown.sh.'
      language: 'en'
      regionalFormat: 'en-us'
    }
    schedule: {
      frequency: 'Daily'
      startDate: anomalyAlertStartDate
      endDate: anomalyAlertEndDate
    }
  }
}

output budgetName string = budget.name
output budgetStartDate string = budgetStartDate
output anomalyAlertName string = anomalyAlert.name
output anomalyAlertEndDate string = anomalyAlertEndDate
