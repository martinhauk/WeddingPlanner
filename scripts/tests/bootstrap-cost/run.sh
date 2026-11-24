#!/usr/bin/env bash
# Tests for scripts/bootstrap-cost.sh and infra/bootstrap/cost.bicep.
#
# The script runs against a fake `az` (fake-az, a small stateful simulator that logs every call),
# with jq as the real tool and the clock pinned through BOOTSTRAP_COST_NOW. It is copied into a
# throwaway repository layout, so no network access is needed and nothing in Azure changes.
#
# Covered: fresh and repeated (idempotent) runs, the reuse of the budget and anomaly alert start
# dates, the one-year end date of the anomaly alert, every precondition that must stop the script
# before it deploys (instance.json, arguments, CI, Azure sign-in, subscription state, providers,
# the production action group), the "subscription not ready" detection with exit status 75, error
# redaction, and that no email, amount or id is ever printed and the temporary files are deleted.
#
# The template part compiles infra/bootstrap/cost.bicep with the local Bicep (`az bicep`, no
# Azure login): build and lint must report no diagnostics, and the compiled template must meet the
# contract of the issue. It is skipped, with a notice, when az with Bicep is not installed.
#
# Usage: scripts/tests/bootstrap-cost/run.sh
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
FIXTURES="$HERE/fixtures"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
REAL_AZ=$(command -v az || true)

# Throwaway repository layout: scripts/bootstrap-cost.sh and infra/bootstrap/cost.bicep.
FAKE_REPO="$WORK/repo"
mkdir -p "$FAKE_REPO/scripts" "$FAKE_REPO/infra/bootstrap" "$WORK/bin"
cp "$ROOT/scripts/bootstrap-cost.sh" "$FAKE_REPO/scripts/bootstrap-cost.sh"
cp "$ROOT/infra/bootstrap/cost.bicep" "$FAKE_REPO/infra/bootstrap/cost.bicep"
cp "$HERE/fake-az" "$WORK/bin/az"
chmod +x "$FAKE_REPO/scripts/bootstrap-cost.sh" "$WORK/bin/az"

# A local checkout of the private instance repo.
INSTANCE="$WORK/instance"
mkdir -p "$INSTANCE"
cp "$FIXTURES/instance.json" "$INSTANCE/instance.json"

AZ_LOG="$WORK/az.log"
AZ_DIR="$WORK/az"
AZ_STATE="$WORK/az-state.json"
RUN_TMP="$WORK/tmp"
OUT=""
STATUS=0
PASSED=0
FAILED=0
NOW="2026-11-24T10:42:13Z"

SUB=11111111-1111-4111-8111-111111111111
SCRIPT="$FAKE_REPO/scripts/bootstrap-cost.sh"
TEMPLATE="$FAKE_REPO/infra/bootstrap/cost.bicep"

# run AZ_STATE|keep [ARGS...]: run bootstrap-cost.sh against the fake az with the clock at $NOW;
# sets OUT and STATUS. "keep" continues with the state the previous run left behind.
run() {
  local az_state=$1
  shift
  : >"$AZ_LOG"
  rm -rf "$AZ_DIR" "$RUN_TMP"
  mkdir -p "$AZ_DIR" "$RUN_TMP"
  if [ "$az_state" != "keep" ]; then cp "$az_state" "$AZ_STATE"; fi
  set +e
  OUT=$(env -u CI -u GITHUB_ACTIONS PATH="$WORK/bin:$PATH" TMPDIR="$RUN_TMP" \
    FAKE_AZ_STATE="$AZ_STATE" FAKE_AZ_LOG="$AZ_LOG" FAKE_AZ_DIR="$AZ_DIR" \
    BOOTSTRAP_COST_NOW="$NOW" "$SCRIPT" "$@" 2>&1)
  STATUS=$?
  set -e
}

# variant BASE_FIXTURE JQ_FILTER: write a modified copy of a fixture and print its path.
variant() {
  local file
  file=$(mktemp "$WORK/state.XXXXXX")
  jq "$2" "$FIXTURES/$1" >"$file"
  printf '%s' "$file"
}

# instance_variant JQ_FILTER: a private instance checkout with a modified instance.json.
instance_variant() {
  local dir
  dir=$(mktemp -d "$WORK/instance.XXXXXX")
  jq "$1" "$FIXTURES/instance.json" >"$dir/instance.json"
  printf '%s' "$dir"
}

test_case() { printf '\n%s\n' "$1"; }

check() {
  local description=$1
  shift
  if "$@"; then
    PASSED=$((PASSED + 1))
    printf '  ok    %s\n' "$description"
  else
    FAILED=$((FAILED + 1))
    printf '  FAIL  %s\n' "$description"
    printf '%s\n' "$OUT" | sed 's/^/        | /'
    printf '        az calls:\n'
    sed 's/^/        > /' "$AZ_LOG"
  fi
}

status_is() { [ "$STATUS" -eq "$1" ]; }
output_has() { printf '%s' "$OUT" | grep -qF -- "$1"; }
output_lacks() { ! printf '%s' "$OUT" | grep -qF -- "$1"; }
az_called() { grep -qF -- "$1" "$AZ_LOG"; }
az_not_called() { ! grep -qF -- "$1" "$AZ_LOG"; }
az_count() { grep -cF -- "$1" "$AZ_LOG" || true; }
az_silent() { [ ! -s "$AZ_LOG" ]; }
no_deployment() { az_not_called "deployment sub create"; }
json_true() { [ "$(printf '%s' "$1" | jq "$2")" = "true" ]; }
# params_true FILTER: FILTER holds for the parameters of the (last) deployment.
params_true() {
  local last
  last=$(find "$AZ_DIR" -name 'params-*.json' | sort | tail -n 1)
  [ -n "$last" ] && json_true "$(cat "$last")" "$1"
}
no_temp_files() { [ -z "$(ls -A "$RUN_TMP")" ]; }
# private_output: no subscription id, email or budget amount (37 in the fixture) in the output.
private_output() {
  local value
  for value in "$SUB" "@example" "example.org" "37"; do
    if printf '%s' "$OUT" | grep -qF -- "$value"; then
      printf '        output contains %s\n' "$value"
      return 1
    fi
  done
}
# refused MESSAGE: the last run failed with MESSAGE and made no az call.
refused() { [ "$STATUS" -eq 1 ] && output_has "$1" && az_silent; }

# ---------------------------------------------------------------------------------------------
test_case "fresh subscription: creates the budget and the anomaly alert"
run "$FIXTURES/az.fresh.json" --instance "$INSTANCE"
check "exits 0" status_is 0
check "deploys cost.bicep at subscription scope with a fixed name in dataLocation" az_called \
  "deployment sub create --name bootstrap-cost-wedx7k2p9 --location germanywestcentral --subscription $SUB --template-file $TEMPLATE"
check "deploys with -o none" az_called "-o none --only-show-errors"
check "deploys once" [ "$(az_count 'deployment sub create')" -eq 1 ]
check "checks the production action group in the production ops RG, -o none" az_called \
  "monitor action-group show --name ag-wedx7k2p9-production --resource-group rg-wedx7k2p9-production-ops --subscription $SUB -o none"
check "only reads besides the one deployment" [ "$(grep -cvE '^az (account show|rest --method get|provider show|monitor action-group show|deployment sub create) ' "$AZ_LOG")" -eq 0 ]
check "checks both cost providers" [ "$(az_count 'provider show --namespace Microsoft.C')" -eq 2 ]
check "parameters: exactly the template's parameters" params_true \
  '.parameters | keys == ["alertReceivers", "anomalyAlertEndDate", "anomalyAlertStartDate", "budgetAmount", "budgetStartDate", "deploymentSlug"]'
check "parameters: slug and budgetAmount (a number) from instance.json" params_true \
  '.parameters | .deploymentSlug.value == "wedx7k2p9" and .budgetAmount.value == 37'
check "parameters: alert emails, de-duplicated" params_true \
  '.parameters.alertReceivers.value == {emails: ["maria-jose.garcia@example.org", "pablo.perez@example.org"]}'
check "parameters: the budget starts on the first of the current month" params_true \
  '.parameters.budgetStartDate.value == "2026-11-01T00:00:00Z"'
check "parameters: the anomaly alert starts this hour" params_true \
  '.parameters.anomalyAlertStartDate.value == "2026-11-24T10:00:00Z"'
check "parameters: the anomaly alert ends one year from today" params_true \
  '.parameters.anomalyAlertEndDate.value == "2027-11-24T00:00:00Z"'
check "reports what it created" output_has "created budget-wedx7k2p9 (monthly from 2026-11-01)"
check "reports the anomaly alert expiry" output_has "anomaly-wedx7k2p9 expires on 2027-11-24"
check "prints no ids, emails or the amount" private_output
check "deletes its temporary files" no_temp_files

test_case "re-run next month keeps the start dates and extends the anomaly alert (idempotent)"
NOW="2026-12-05T08:15:00Z"
run keep --instance "$INSTANCE"
check "exits 0" status_is 0
check "keeps the budget start date" params_true '.parameters.budgetStartDate.value == "2026-11-01T00:00:00Z"'
check "keeps the anomaly alert start date" params_true \
  '.parameters.anomalyAlertStartDate.value == "2026-11-24T10:00:00Z"'
check "extends the anomaly alert to one year from today" params_true \
  '.parameters.anomalyAlertEndDate.value == "2027-12-05T00:00:00Z"'
check "reports updates, not creations" output_has "updated budget-wedx7k2p9 (monthly since 2026-11-01)"
check "no warnings" output_lacks "warning"
check "prints no ids, emails or the amount" private_output
check "deletes its temporary files" no_temp_files
NOW="2026-11-24T10:42:13Z"

test_case "configured subscription: an existing budget from an earlier month"
NOW="2027-03-15T23:59:59Z"
run "$FIXTURES/az.configured.json" --instance "$INSTANCE"
check "exits 0" status_is 0
check "passes the existing start date" params_true '.parameters.budgetStartDate.value == "2026-11-01T00:00:00Z"'
check "passes the existing anomaly alert start" params_true \
  '.parameters.anomalyAlertStartDate.value == "2026-11-24T10:00:00Z"'
check "ends the anomaly alert one year from today" params_true \
  '.parameters.anomalyAlertEndDate.value == "2028-03-15T00:00:00Z"'
check "prints no ids, emails or the amount (the budget list contains them)" private_output
NOW="2026-11-24T10:42:13Z"

test_case "the budget start date is normalised to the first of the month at midnight UTC"
state=$(variant az.configured.json '.budgets[0].properties.timePeriod.startDate = "2026-11-01T00:00:00"')
run "$state" --instance "$INSTANCE"
check "exits 0" status_is 0
check "passes 2026-11-01T00:00:00Z" params_true '.parameters.budgetStartDate.value == "2026-11-01T00:00:00Z"'

test_case "a budget of the same name that does not start on the first is refused"
state=$(variant az.configured.json '.budgets[0].properties.timePeriod.startDate = "2026-11-15T00:00:00Z"')
run "$state" --instance "$INSTANCE"
check "exits 1" status_is 1
check "explains" output_has "not the first of a month"
check "no deployment" no_deployment

test_case "29 February: the anomaly alert ends on 28 February next year"
NOW="2028-02-29T12:00:00Z"
run "$FIXTURES/az.fresh.json" --instance "$INSTANCE"
check "exits 0" status_is 0
check "budget starts 2028-02-01" params_true '.parameters.budgetStartDate.value == "2028-02-01T00:00:00Z"'
check "alert ends 2029-02-28" params_true '.parameters.anomalyAlertEndDate.value == "2029-02-28T00:00:00Z"'
NOW="2026-11-24T10:42:13Z"

test_case "other budgets and anomaly alerts in the subscription are reported, not touched"
state=$(variant az.configured.json '.budgets += [{name: "portal-budget", properties: {timePeriod: {startDate: "2025-01-01T00:00:00Z"}}}]
  | .scheduledActions += [{name: "portal-anomaly", kind: "InsightAlert", properties: {schedule: {startDate: "2025-01-01T00:00:00Z"}}},
                          {name: "weekly-costs", kind: "Email", properties: {schedule: {startDate: "2025-01-01T00:00:00Z"}}}]')
run "$state" --instance "$INSTANCE"
check "exits 0" status_is 0
check "warns about the other budget" output_has "1 other budget(s) in this subscription"
check "warns about the other anomaly alert only" output_has "1 other anomaly alert(s)"
check "does not name them" output_lacks "portal-"
check "deploys only its own resources" params_true '.parameters.deploymentSlug.value == "wedx7k2p9"'

# ---------------------------------------------------------------------------------------------
test_case "instance.json: budgetAmount defaults to 10"
dir=$(instance_variant 'del(.budgetAmount)')
run "$FIXTURES/az.fresh.json" --instance "$dir"
check "exits 0" status_is 0
check "deploys budgetAmount 10" params_true '.parameters.budgetAmount.value == 10'
check "says so" output_has "budgetAmount not set (default 10)"

for bad in '0' '-5' '10.5' '"37"' 'null' '2000000'; do
  test_case "instance.json: budgetAmount $bad is refused without printing it"
  dir=$(instance_variant ".budgetAmount = $bad")
  run "$FIXTURES/az.fresh.json" --instance "$dir"
  check "exits 1" status_is 1
  check "names the rule" output_has "budgetAmount must be a whole number"
  check "no Azure calls" az_silent
  needle=$(printf '%s' "$bad" | tr -d '"')
  if [ "$needle" != "0" ]; then
    check "does not print the value" output_lacks "$needle"
  fi
done

test_case "instance.json: an invalid email is reported by index, never by value"
dir=$(instance_variant '.alertEmails = ["pablo.perez@example.org", "juergen-at-example"]')
run "$FIXTURES/az.fresh.json" --instance "$dir"
check "exits 1" status_is 1
check "names the index" output_has "alertEmails[1]"
check "does not print the value" output_lacks "juergen-at-example"
check "no Azure calls" az_silent

test_case "instance.json: missing alertEmails"
dir=$(instance_variant 'del(.alertEmails)')
run "$FIXTURES/az.fresh.json" --instance "$dir"
check "refused" refused "alertEmails must be a non-empty array"

test_case "instance.json: invalid slug"
dir=$(instance_variant '.slug = "anna-and-ben"')
run "$FIXTURES/az.fresh.json" --instance "$dir"
check "refused" refused "slug must match"
check "does not print the value" output_lacks "anna-and-ben"

test_case "instance.json: dataLocation is the deployment location; example.com and sample warn"
dir=$(instance_variant '.dataLocation = "swedencentral" | .alertEmails = ["anna@example.com"] | .sample = true')
run "$FIXTURES/az.fresh.json" --instance "$dir"
check "exits 0" status_is 0
check "deploys in swedencentral" az_called "--location swedencentral"
check "warns about placeholder emails" output_has "example.com placeholders"
check "warns about sample content" output_has "marked \"sample\": true"
check "prints no emails" output_lacks "anna@"

test_case "instance.json: dataLocation defaults to germanywestcentral"
dir=$(instance_variant 'del(.dataLocation)')
run "$FIXTURES/az.fresh.json" --instance "$dir"
check "exits 0" status_is 0
check "deploys in germanywestcentral" az_called "--location germanywestcentral"

test_case "arguments are checked before anything runs"
run "$FIXTURES/az.fresh.json"
check "--instance is required" refused "--instance <dir> is required"
run "$FIXTURES/az.fresh.json" --instance "$WORK/does-not-exist"
check "--instance must exist" refused "directory not found"
run "$FIXTURES/az.fresh.json" --instance "$WORK"
check "--instance must contain instance.json" refused "instance.json (--instance) not found"
run "$FIXTURES/az.fresh.json" --instance "$INSTANCE" --subscription not-a-guid
check "--subscription must be a GUID" refused "--subscription must be"
run "$FIXTURES/az.fresh.json" --instance "$INSTANCE" --env production
check "unknown argument" refused "unknown argument"
run "$FIXTURES/az.fresh.json" --help
check "--help prints the usage" [ "$STATUS" -eq 0 ]
check "--help mentions exit status 75" output_has "75 Cost Management is not ready"

test_case "refuses to run in CI"
: >"$AZ_LOG"
set +e
OUT=$(GITHUB_ACTIONS=true PATH="$WORK/bin:$PATH" FAKE_AZ_STATE="$AZ_STATE" FAKE_AZ_LOG="$AZ_LOG" \
  FAKE_AZ_DIR="$AZ_DIR" "$SCRIPT" --instance "$INSTANCE" 2>&1)
STATUS=$?
set -e
check "refused without calls" refused "never by CI"

test_case "--subscription selects the subscription"
run "$FIXTURES/az.fresh.json" --instance "$INSTANCE" --subscription "$SUB"
check "exits 0" status_is 0
check "does not ask az for the current account" az_not_called "account show"
check "deploys into it" az_called "--subscription $SUB --template-file"

# ---------------------------------------------------------------------------------------------
test_case "Azure: not signed in"
state=$(variant az.fresh.json '.account = null')
run "$state" --instance "$INSTANCE"
check "exits 1" status_is 1
check "asks for az login" output_has "az login"
check "no deployment" no_deployment

test_case "Azure: disabled subscription"
state=$(variant az.fresh.json '.subscription.state = "Disabled"')
run "$state" --instance "$INSTANCE"
check "exits 1" status_is 1
check "explains the pay-as-you-go upgrade" output_has "pay-as-you-go"
check "no deployment" no_deployment

test_case "Azure: spending limit (trial) warns"
state=$(variant az.fresh.json '.subscription.subscriptionPolicies.spendingLimit = "On"')
run "$state" --instance "$INSTANCE"
check "exits 0" status_is 0
check "warns about the trial" output_has "spending limit"

test_case "Azure: providers not registered"
state=$(variant az.fresh.json '.providers["Microsoft.CostManagement"] = "Registering"')
run "$state" --instance "$INSTANCE"
check "exits 1" status_is 1
check "points to the production bootstrap" output_has "scripts/bootstrap.sh --env production"
check "no deployment" no_deployment

test_case "Azure: the production ops resource group does not exist yet"
state=$(variant az.fresh.json '.actionGroups = {}')
run "$state" --instance "$INSTANCE"
check "exits 1" status_is 1
check "names the missing action group" output_has "ag-wedx7k2p9-production (in rg-wedx7k2p9-production-ops) does not exist"
check "points to the production bootstrap" output_has "Run scripts/bootstrap.sh --env production --instance <dir> first"
check "no Cost Management calls" az_not_called "Microsoft.Consumption/budgets"
check "no deployment" no_deployment

test_case "Azure: only the e2e and test action groups exist"
state=$(variant az.fresh.json '.actionGroups = {"rg-wedx7k2p9-production-ops/ag-other": "global"}')
run "$state" --instance "$INSTANCE"
check "exits 1" status_is 1
check "points to the production bootstrap" output_has "scripts/bootstrap.sh --env production"
check "no deployment" no_deployment

# ---------------------------------------------------------------------------------------------
test_case "not ready: the deployment is rejected for a new subscription"
state=$(variant az.fresh.json '.deploymentFailures = 1
  | .deploymentError = "ERROR: {\"code\": \"DeploymentFailed\", \"details\": [{\"code\": \"SubscriptionNotFound\", \"message\": \"Subscription 11111111-1111-4111-8111-111111111111 was not found for pablo.perez@example.org.\"}]}"')
run "$state" --instance "$INSTANCE"
check "exits 75" status_is 75
check "prints retry guidance" output_has "up to 48 hours"
check "says nothing else waits" output_has "deploys work without it"
check "shows how to re-run" output_has "scripts/bootstrap-cost.sh --instance <instance checkout>"
check "no raw error" output_lacks "DeploymentFailed"
check "prints no ids, emails or the amount" private_output
check "deletes its temporary files" no_temp_files

for message in \
  "(DataNotAvailable) Cost data is not available yet." \
  "(400) Budgets are not supported for this subscription yet. Please try again later." \
  "Cost Management is not available for the subscription until 48 hours after creation." \
  "(SubscriptionNotRegistered) The subscription is not registered to use namespace Microsoft.Consumption."; do
  test_case "not ready: ${message%% *} ..."
  state=$(variant az.fresh.json ".deploymentFailures = 1 | .deploymentError = \"ERROR: $message\"")
  run "$state" --instance "$INSTANCE"
  check "exits 75" status_is 75
  check "prints retry guidance" output_has "Re-run later"
done

test_case "not ready: listing budgets already fails"
state=$(variant az.fresh.json '.budgetsError = "ERROR: Bad Request({\"error\":{\"code\":\"SubscriptionNotFound\",\"message\":\"Subscription not found. If the subscription is newly created, wait 48 hours and try again.\"}})"')
run "$state" --instance "$INSTANCE"
check "exits 75" status_is 75
check "names the step" output_has "listing budgets"
check "no deployment" no_deployment
check "no raw error" output_lacks "Bad Request"

test_case "not ready: listing anomaly alerts fails"
state=$(variant az.fresh.json '.scheduledActionsError = "ERROR: (DataNotAvailable) Cost data is not available yet."')
run "$state" --instance "$INSTANCE"
check "exits 75" status_is 75
check "names the step" output_has "listing anomaly alerts"
check "no deployment" no_deployment

test_case "other deployment errors fail at once, redacted"
state=$(variant az.fresh.json '.deploymentFailures = 1
  | .deploymentError = "ERROR: (RBACAccessDenied) pablo.perez@example.org has no access to /subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-wedx7k2p9-production-ops"')
run "$state" --instance "$INSTANCE"
check "exits 1" status_is 1
check "deploys once" [ "$(az_count 'deployment sub create')" -eq 1 ]
check "shows the error" output_has "RBACAccessDenied"
check "points to the docs" output_has "docs/cost-and-abuse.md, Troubleshooting"
check "redacts emails and ids" private_output
check "deletes its temporary files" no_temp_files

test_case "an earlier deployment in another region"
state=$(variant az.fresh.json '.deploymentFailures = 1
  | .deploymentError = "ERROR: (InvalidDeploymentLocation) Invalid deployment location."')
run "$state" --instance "$INSTANCE"
check "exits 1" status_is 1
check "explains the fix" output_has "az deployment sub delete --name bootstrap-cost-wedx7k2p9"

test_case "listing budgets fails for another reason"
state=$(variant az.fresh.json '.budgetsError = "ERROR: (AuthorizationFailed) The client pablo.perez@example.org does not have authorization."')
run "$state" --instance "$INSTANCE"
check "exits 1" status_is 1
check "shows the redacted error" output_has "AuthorizationFailed"
check "redacts emails and ids" private_output
check "no deployment" no_deployment

# ---------------------------------------------------------------------------------------------
test_case "the script's API versions match the template"
for type in Microsoft.Consumption/budgets Microsoft.CostManagement/scheduledActions; do
  version=$(grep -o "'$type@[0-9a-z-]*'" "$ROOT/infra/bootstrap/cost.bicep" | sed -E "s/.*@([^']*)'/\\1/")
  check "$type@$version is used by the script" grep -q "$version" "$ROOT/scripts/bootstrap-cost.sh"
done

# ---------------------------------------------------------------------------------------------
test_case "template: infra/bootstrap/cost.bicep builds and lints without diagnostics"
# trimmed TEXT: TEXT without whitespace (empty when Bicep reported nothing).
trimmed() { printf '%s' "$1" | tr -d '[:space:]'; }
if [ -n "$REAL_AZ" ] && "$REAL_AZ" bicep version >/dev/null 2>&1; then
  export AZURE_BICEP_CHECK_VERSION=false AZURE_CORE_COLLECT_TELEMETRY=false AZURE_CORE_NO_COLOR=true
  COMPILED="$WORK/cost.json"
  set +e
  OUT=$("$REAL_AZ" bicep build --file "$ROOT/infra/bootstrap/cost.bicep" --outfile "$COMPILED" 2>&1)
  STATUS=$?
  set -e
  check "az bicep build succeeds" status_is 0
  check "az bicep build reports nothing" [ -z "$(trimmed "$OUT")" ]
  set +e
  OUT=$("$REAL_AZ" bicep lint --file "$ROOT/infra/bootstrap/cost.bicep" 2>&1)
  STATUS=$?
  set -e
  check "az bicep lint succeeds" status_is 0
  check "az bicep lint reports nothing (bicepconfig.json rules included)" [ -z "$(trimmed "$OUT")" ]

  test_case "template: the compiled template meets the contract (template.jq)"
  OUT=""
  if [ -s "$COMPILED" ]; then
    RESULTS=$(jq -r -f "$HERE/template.jq" "$COMPILED")
    while IFS=$(printf '\t') read -r result description; do
      check "$description" [ "$result" = "ok" ]
    done <<<"$RESULTS"
  else
    check "the template compiled" false
  fi
else
  printf '  SKIP  az with Bicep is not installed: build, lint and the template contract were not checked\n'
fi

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
