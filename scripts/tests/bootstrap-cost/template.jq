# Contract checks on the compiled ARM template of infra/bootstrap/cost.bicep (see run.sh).
#
#   jq -r -f scripts/tests/bootstrap-cost/template.jq cost.json
#
# Prints one line per check, "ok<TAB>description" or "FAIL<TAB>description". Values are compared
# with the ARM expressions Bicep emits (e.g. "[parameters('budgetAmount')]"); the budget's
# notifications compile to one toObject(...) expression, which is checked piece by piece.

def p($n): "[parameters('\($n)')]";
def budget: .resources[] | select(.type == "Microsoft.Consumption/budgets");
def alert: .resources[] | select(.type == "Microsoft.CostManagement/scheduledActions");
def notifications: budget.properties.notifications;

# A check passes when its filter yields exactly one value, true, without an error.
def check($description; f): {description: $description, ok: (try ([f] == [true]) catch false)};

[
  check("subscription scope"; ."$schema" | test("subscriptionDeploymentTemplate")),
  check("exactly the expected parameters"; (.parameters | keys) == [
    "alertReceivers", "anomalyAlertEndDate", "anomalyAlertStartDate", "budgetAmount",
    "budgetStartDate", "deploymentSlug"]),
  check("budgetAmount: int, default 10, at least 1";
    .parameters.budgetAmount | .type == "int" and .defaultValue == 10 and .minValue == 1),
  check("alertReceivers (the emails) is a secure object";
    .parameters.alertReceivers.type == "secureObject"),
  check("a new budget starts on the first of the current month";
    .parameters.budgetStartDate.defaultValue == "[format('{0}-01T00:00:00Z', utcNow('yyyy-MM'))]"),
  check("the anomaly alert ends one year ahead by default";
    .parameters.anomalyAlertEndDate.defaultValue == "[dateTimeAdd(utcNow('yyyy-MM-dd'), 'P1Y')]"),
  check("exactly two resources: the budget and the anomaly alert";
    [.resources[].type] | sort == ["Microsoft.Consumption/budgets", "Microsoft.CostManagement/scheduledActions"]),

  check("budget: named budget-<slug>";
    budget.name == "[variables('budgetName')]"
    and .variables.budgetName == "[format('budget-{0}', parameters('deploymentSlug'))]"),
  check("budget: Cost, Monthly, amount from budgetAmount";
    budget.properties | .category == "Cost" and .timeGrain == "Monthly" and .amount == p("budgetAmount")),
  check("budget: start date from budgetStartDate, no end date";
    budget.properties.timePeriod == {startDate: p("budgetStartDate")}),
  check("budget: no filter, so it covers the whole subscription (all three environments)";
    budget.properties | has("filter") | not),
  check("budget: Actual 10/50/100 % and Forecasted 50/100 %, nothing else";
    [.variables.budgetNotifications[] | [.thresholdType, .threshold]]
    == [["Actual", 10], ["Actual", 50], ["Actual", 100], ["Forecasted", 50], ["Forecasted", 100]]),
  check("budget: one notification per definition, keyed like Actual_GreaterThan_10_Percent";
    notifications | startswith("[toObject(variables('budgetNotifications'), lambda('n', format('{0}_GreaterThan_{1}_Percent', lambdaVariables('n').thresholdType, lambdaVariables('n').threshold)), lambda('n', createObject(")),
  check("budget notification: enabled, GreaterThan the threshold of its definition";
    notifications | contains("'enabled', true(), 'operator', 'GreaterThan', 'threshold', lambdaVariables('n').threshold, 'thresholdType', lambdaVariables('n').thresholdType")),
  check("budget notification: to the alert emails";
    notifications | contains("'contactEmails', parameters('alertReceivers').emails")),
  check("budget notification: to ag-<slug>-production in rg-<slug>-production-ops";
    notifications | contains("'contactGroups', createArray(extensionResourceId(format('/subscriptions/{0}/resourceGroups/{1}', subscription().subscriptionId, format('rg-{0}-production-ops', parameters('deploymentSlug'))), 'Microsoft.Insights/actionGroups', format('ag-{0}-production', parameters('deploymentSlug'))))")),
  check("budget notification: to the Owner role";
    notifications | contains("'contactRoles', createArray('Owner')")),

  check("anomaly alert: named anomaly-<slug>";
    alert.name == "[variables('anomalyAlertName')]"
    and .variables.anomalyAlertName == "[format('anomaly-{0}', parameters('deploymentSlug'))]"),
  check("anomaly alert: kind InsightAlert, enabled";
    alert | .kind == "InsightAlert" and .properties.status == "Enabled"),
  check("anomaly alert: the subscription's DailyAnomalyByResourceGroup view (shown in the portal)";
    alert.properties.viewId == "[format('{0}/providers/Microsoft.CostManagement/views/ms:DailyAnomalyByResourceGroup', subscription().id)]"),
  check("anomaly alert: daily, start and end from the parameters";
    alert.properties.schedule == {frequency: "Daily", startDate: p("anomalyAlertStartDate"), endDate: p("anomalyAlertEndDate")}),
  check("anomaly alert: emailed to the alert emails";
    alert.properties | .notification.to == "[parameters('alertReceivers').emails]"
    and .notificationEmail == "[first(parameters('alertReceivers').emails)]"),
  check("anomaly alert: message within 250 characters";
    alert.properties.notification.message | length <= 250),

  check("outputs: names and dates only";
    (.outputs | keys) == ["anomalyAlertEndDate", "anomalyAlertName", "budgetName", "budgetStartDate"]),
  check("outputs: never the emails or the amount";
    [.outputs[].value | test("alertReceivers|budgetAmount")] | any | not)
]
| .[]
| "\(if .ok then "ok" else "FAIL" end)\t\(.description)"
