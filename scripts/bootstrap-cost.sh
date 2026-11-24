#!/usr/bin/env bash
# bootstrap-cost.sh: create or update the cost guardrails of this WeddingPlanner deployment: ONE
# monthly budget and ONE cost anomaly alert for the whole Azure subscription, which holds the
# e2e, test and production environments (infra/bootstrap/cost.bicep).
#
# Run by the owner on their own machine after `scripts/bootstrap.sh --env production`, signed in
# with `az login` as Owner of the subscription. Never run by CI. Idempotent: every re-run
# converges to the same state and extends the anomaly alert to one year ahead. It prints names and
# dates only, never the alert emails, the budget amount or any id.
#
# A new subscription can reject budgets and anomaly alerts for up to 48 hours. The script detects
# that, prints retry guidance and exits with status 75. Nothing else waits for this step, so
# simply re-run it later (for example once a day).
#
# Usage: scripts/bootstrap-cost.sh --instance DIR [options]
#
#   --instance DIR       local checkout of the private instance repo (required); its instance.json
#                        provides slug, budgetAmount (default 10, in the billing currency),
#                        alertEmails and dataLocation
#   --subscription ID    Azure subscription id (default: the current `az account`)
#   -h, --help           show this help
#
# What a run does, for the slug from instance.json:
#   1. Checks first, changing nothing if one fails: instance.json, the Azure sign-in, the
#      subscription state, the Microsoft.Consumption and Microsoft.CostManagement providers, and
#      the production action group ag-<slug>-production in rg-<slug>-production-ops (both created
#      by scripts/bootstrap.sh --env production).
#   2. Reads the existing budget budget-<slug> and anomaly alert anomaly-<slug>, to reuse their
#      start dates (a budget's start date cannot move to a later month).
#   3. Deploys infra/bootstrap/cost.bicep at subscription scope (deployment bootstrap-cost-<slug>,
#      -o none).
#
# Exit status: 0 done; 1 error; 75 Cost Management is not ready for this subscription yet.
# Requires: az (with Bicep) and jq. Compatible with the bash 3.2 that ships with macOS.
# Docs: docs/cost-and-abuse.md
set -euo pipefail

SLUG_REGEX='^wed[0-9a-z]{3,8}$'
GUID_REGEX='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
DEFAULT_DATA_LOCATION="germanywestcentral"
DEFAULT_BUDGET_AMOUNT=10
PROVIDERS="Microsoft.Consumption Microsoft.CostManagement"
# The API versions of infra/bootstrap/cost.bicep.
BUDGETS_API="2026-06-01"
SCHEDULED_ACTIONS_API="2026-06-01"
EXIT_NOT_READY=75
# Errors that mean "Cost Management does not work for this subscription yet": a new subscription
# (Cost Management docs: SubscriptionNotFound, "wait 48 hours and try again"), billing data not
# available yet, or the providers still registering in the background.
NOT_READY_PATTERN='SubscriptionNotFound|SubscriptionNotRegistered|DataNotAvailable|NotOnboarded|not (yet )?(been )?onboarded|not (yet )?(available|ready|supported) (yet )?for (this|the) subscription|not ready|newly created|48 hours|try again (later|after|in)|BillingAccountNotFound|no (valid )?billing account'
# The current time; the tests pin it (format yyyy-MM-ddTHH:mm:ssZ).
NOW=${BOOTSTRAP_COST_NOW:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
TEMPLATE="$REPO_ROOT/infra/bootstrap/cost.bicep"

INSTANCE_DIR=""
SUBSCRIPTION=""

INSTANCE_FILE=""
SLUG=""
DATA_LOCATION=""
BUDGET_AMOUNT=""
EMAILS_JSON=""
BUDGET=""
ANOMALY_ALERT=""
ACTION_GROUP=""
OPS_RG=""
DEPLOYMENT_NAME=""
SUB_ID=""
BUDGET_START=""
BUDGET_EXISTS=false
ALERT_START=""
ALERT_END=""
ALERT_EXISTS=false
TMP_DIR=""
WARNINGS=0

usage() {
  sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//'
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

section() { printf '\n%s\n' "$*"; }
ok() { printf '  ok       %s\n' "$*"; }
applied() { printf '  applied  %s\n' "$*"; }
warn() {
  printf '  warning  %s\n' "$*" >&2
  WARNINGS=$((WARNINGS + 1))
}

cleanup() {
  if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi
}

# redact: hide email addresses and GUIDs (subscription, tenant, object ids) in tool output that is
# shown on errors.
redact() {
  sed -E \
    -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<email>/g' \
    -e 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/<id>/g'
}

# show_stderr: print the captured stderr of the last tool call, redacted.
show_stderr() {
  if [ -s "$TMP_DIR/stderr" ]; then redact <"$TMP_DIR/stderr" | sed 's/^/  | /' >&2; fi
}

matches() { printf '%s' "$1" | grep -Eq "$2"; }

# not_ready: the last tool call failed because Cost Management is not ready for the subscription.
not_ready() { grep -Eqi "$NOT_READY_PATTERN" "$TMP_DIR/stderr" 2>/dev/null; }

# exit_not_ready STEP: retry guidance instead of the raw error, then exit 75.
exit_not_ready() {
  {
    printf '\nnot ready: Cost Management does not accept budgets or anomaly alerts for this subscription yet (%s).\n' "$1"
    printf '  A new subscription can take up to 48 hours before budgets and anomaly alerts work.\n'
    printf '  Nothing else waits for this step: bootstrap.sh and the deploys work without it.\n'
    printf '  Re-run later, for example once a day, until it succeeds:\n'
    printf '    scripts/bootstrap-cost.sh --instance <instance checkout>\n'
    printf '  Still failing after 48 hours? See docs/cost-and-abuse.md, Troubleshooting.\n'
  } >&2
  exit "$EXIT_NOT_READY"
}

# ---------------------------------------------------------------------------------------------
# Arguments and instance.json

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --instance | --subscription)
        [ $# -ge 2 ] || die "$1 needs a value"
        case "$1" in
          --instance) INSTANCE_DIR=$2 ;;
          --subscription) SUBSCRIPTION=$2 ;;
        esac
        shift 2
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) die "unknown argument: $1 (see --help)" ;;
    esac
  done
}

preflight() {
  local tool
  if [ "${GITHUB_ACTIONS:-}" = "true" ] || [ "${CI:-}" = "true" ]; then
    die "this script is run by the owner, never by CI"
  fi
  [ -n "$INSTANCE_DIR" ] || die "--instance <dir> is required: a local checkout of the private instance repo"
  if [ -n "$SUBSCRIPTION" ]; then
    matches "$SUBSCRIPTION" "$GUID_REGEX" || die "--subscription must be a subscription id (GUID)"
  fi
  matches "$NOW" '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' || die "cannot read the current UTC time"
  for tool in az jq; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool not found (see docs/runbooks/azure-onboarding.md, Tools)"
  done
  [ -f "$TEMPLATE" ] || die "template not found: infra/bootstrap/cost.bicep"
}

# read_alert_emails FILE LABEL: validate alertEmails and set EMAILS_JSON. Error messages name the
# array index, never the address.
read_alert_emails() {
  local file=$1 label=$2 bad placeholders
  jq -e '.alertEmails | type == "array" and length > 0' "$file" >/dev/null 2>&1 ||
    die "$label: alertEmails must be a non-empty array of email addresses"
  bad=$(jq -r '.alertEmails | to_entries[]
    | select(if (.value | type) != "string" then true
             else (.value | test("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$") | not) end)
    | "alertEmails[\(.key)]"' "$file" | tr '\n' ' ')
  [ -z "$bad" ] || die "$label: not a valid email address: ${bad% }"
  EMAILS_JSON=$(jq -c '.alertEmails | unique' "$file")
  placeholders=$(printf '%s' "$EMAILS_JSON" | jq '[.[] | select(test("@example\\.com$"; "i"))] | length')
  if [ "$placeholders" -gt 0 ]; then
    warn "$placeholders alert email(s) are example.com placeholders, so budget and anomaly emails reach nobody; replace them and re-run"
  fi
}

read_instance() {
  local label="instance.json (--instance)" slug location amount
  section "Instance"
  [ -d "$INSTANCE_DIR" ] || die "--instance: directory not found"
  INSTANCE_FILE="$(cd "$INSTANCE_DIR" && pwd)/instance.json"
  [ -f "$INSTANCE_FILE" ] || die "$label not found"
  jq -e 'type == "object"' "$INSTANCE_FILE" >/dev/null 2>&1 || die "$label is not a JSON object"

  slug=$(jq -r 'if (.slug | type) == "string" then .slug else "" end' "$INSTANCE_FILE")
  matches "$slug" "$SLUG_REGEX" || die "$label: slug must match $SLUG_REGEX"
  SLUG=$slug
  location=$(jq -r --arg d "$DEFAULT_DATA_LOCATION" \
    'if (.dataLocation | type) == "string" then .dataLocation else $d end' "$INSTANCE_FILE")
  matches "$location" '^[a-z0-9]+$' || die "$label: dataLocation must be an Azure region name such as $DEFAULT_DATA_LOCATION"
  DATA_LOCATION=$location
  # The amount is private: the message never shows it.
  amount=$(jq -r --argjson d "$DEFAULT_BUDGET_AMOUNT" '
    if has("budgetAmount") | not then $d
    elif (.budgetAmount | type) == "number" and .budgetAmount >= 1 and .budgetAmount <= 1000000
      and .budgetAmount == (.budgetAmount | floor) then .budgetAmount
    else "invalid" end' "$INSTANCE_FILE")
  [ "$amount" != "invalid" ] ||
    die "$label: budgetAmount must be a whole number from 1 to 1000000 (the monthly budget in the billing currency)"
  BUDGET_AMOUNT=$amount
  read_alert_emails "$INSTANCE_FILE" "$label"

  if [ "$(jq -r '.sample // false' "$INSTANCE_FILE")" = "true" ]; then
    warn "instance.json is still marked \"sample\": true; use the private instance repo of this deployment"
  fi

  BUDGET="budget-$SLUG"
  ANOMALY_ALERT="anomaly-$SLUG"
  ACTION_GROUP="ag-$SLUG-production"
  OPS_RG="rg-$SLUG-production-ops"
  DEPLOYMENT_NAME="bootstrap-cost-$SLUG"
  if jq -e 'has("budgetAmount")' "$INSTANCE_FILE" >/dev/null; then
    ok "slug $SLUG, budgetAmount set, $(printf '%s' "$EMAILS_JSON" | jq length) alert email(s)"
  else
    ok "slug $SLUG, budgetAmount not set (default $DEFAULT_BUDGET_AMOUNT), $(printf '%s' "$EMAILS_JSON" | jq length) alert email(s)"
  fi
}

# ---------------------------------------------------------------------------------------------
# Azure checks (read-only)

azure_preflight() {
  local sub_json state limit ns
  section "Azure"
  if [ -n "$SUBSCRIPTION" ]; then
    SUB_ID=$SUBSCRIPTION
  else
    SUB_ID=$(az account show --query id -o tsv --only-show-errors 2>"$TMP_DIR/stderr") ||
      die "not signed in to Azure: run az login"
  fi
  matches "$SUB_ID" "$GUID_REGEX" || die "cannot determine the subscription id; pass --subscription"

  sub_json=$(az rest --method get --url "/subscriptions/$SUB_ID?api-version=2022-12-01" -o json \
    --only-show-errors 2>"$TMP_DIR/stderr") ||
    {
      show_stderr
      die "cannot read the subscription (az login, check --subscription)"
    }
  state=$(printf '%s' "$sub_json" | jq -r '.state // ""')
  [ "$state" = "Enabled" ] ||
    die "the subscription is ${state:-in an unknown state}, not Enabled. A free trial that was not upgraded is disabled after 30 days: upgrade to pay-as-you-go (docs/runbooks/azure-onboarding.md)."
  limit=$(printf '%s' "$sub_json" | jq -r '.subscriptionPolicies.spendingLimit // ""')
  if [ "$limit" = "On" ]; then
    warn "the subscription has a spending limit (free trial or credit offer): upgrade to pay-as-you-go now, a trial is disabled after 30 days"
  fi
  ok "subscription enabled"

  for ns in $PROVIDERS; do
    state=$(az provider show --namespace "$ns" --subscription "$SUB_ID" --query registrationState -o tsv \
      --only-show-errors 2>"$TMP_DIR/stderr") || {
      show_stderr
      die "cannot read the registration state of $ns"
    }
    [ "$state" = "Registered" ] ||
      die "$ns is ${state:-NotRegistered}. Run scripts/bootstrap.sh --env production --instance <dir> first (it registers the providers), then re-run."
  done
  ok "providers Microsoft.Consumption and Microsoft.CostManagement registered"

  if ! az monitor action-group show --name "$ACTION_GROUP" --resource-group "$OPS_RG" \
    --subscription "$SUB_ID" -o none --only-show-errors 2>"$TMP_DIR/stderr"; then
    if grep -Eqi 'ResourceNotFound|ResourceGroupNotFound|was not found|could not be found' "$TMP_DIR/stderr"; then
      die "the production action group $ACTION_GROUP (in $OPS_RG) does not exist. Run scripts/bootstrap.sh --env production --instance <dir> first, then re-run this script."
    fi
    show_stderr
    die "cannot read the production action group $ACTION_GROUP"
  fi
  ok "production action group $ACTION_GROUP exists"
}

# read_existing: the start dates of an existing budget and anomaly alert, and other guardrails in
# the subscription.
read_existing() {
  local list start others
  section "Cost Management"

  list=$(az rest --method get \
    --url "/subscriptions/$SUB_ID/providers/Microsoft.Consumption/budgets?api-version=$BUDGETS_API" \
    -o json --only-show-errors 2>"$TMP_DIR/stderr") || {
    if not_ready; then exit_not_ready "listing budgets"; fi
    show_stderr
    die "cannot list the budgets of the subscription"
  }
  start=$(printf '%s' "$list" | jq -r --arg n "$BUDGET" \
    '[.value[]? | select(.name == $n)][0].properties.timePeriod.startDate // ""')
  others=$(printf '%s' "$list" | jq --arg n "$BUDGET" '[.value[]? | select(.name != $n)] | length')
  if [ -n "$start" ]; then
    matches "$start" '^[0-9]{4}-[0-9]{2}-01([T ]|$)' ||
      die "$BUDGET exists, but its start date is not the first of a month; delete the budget in the portal and re-run"
    BUDGET_START="${start%"${start#??????????}"}T00:00:00Z"
    BUDGET_EXISTS=true
    ok "$BUDGET exists since ${BUDGET_START%T*}; keeping its start date"
  else
    BUDGET_START="${NOW%"${NOW#???????}"}-01T00:00:00Z"
    ok "$BUDGET does not exist yet; it starts ${BUDGET_START%T*}"
  fi
  if [ "$others" -gt 0 ]; then
    warn "$others other budget(s) in this subscription; $BUDGET already covers the whole subscription (all three environments)"
  fi

  list=$(az rest --method get \
    --url "/subscriptions/$SUB_ID/providers/Microsoft.CostManagement/scheduledActions?api-version=$SCHEDULED_ACTIONS_API" \
    -o json --only-show-errors 2>"$TMP_DIR/stderr") || {
    if not_ready; then exit_not_ready "listing anomaly alerts"; fi
    show_stderr
    die "cannot list the scheduled actions (anomaly alerts) of the subscription"
  }
  start=$(printf '%s' "$list" | jq -r --arg n "$ANOMALY_ALERT" \
    '[.value[]? | select(.name == $n)][0].properties.schedule.startDate // ""')
  others=$(printf '%s' "$list" | jq --arg n "$ANOMALY_ALERT" \
    '[.value[]? | select(.kind == "InsightAlert" and .name != $n)] | length')
  if [ -n "$start" ]; then
    matches "$start" '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z?$' ||
      die "$ANOMALY_ALERT exists, but its start date cannot be read; delete it in the portal (Cost alerts) and re-run"
    ALERT_START=$start
    ALERT_EXISTS=true
    ok "$ANOMALY_ALERT exists; keeping its start date"
  else
    ALERT_START="${NOW%"${NOW#?????????????}"}:00:00Z"
    ok "$ANOMALY_ALERT does not exist yet"
  fi
  if [ "$others" -gt 0 ]; then
    warn "$others other anomaly alert(s) in this subscription (Cost Management allows five)"
  fi
  ALERT_END=$(one_year_after "${NOW%%T*}")
}

# one_year_after yyyy-MM-dd: the same day one year later at midnight UTC (28 February for
# 29 February). Cost Management accepts an end date at most one year after today.
one_year_after() {
  local year=${1%%-*} rest=${1#*-}
  if [ "$rest" = "02-29" ]; then rest="02-28"; fi
  printf '%04d-%sT00:00:00Z' "$((10#$year + 1))" "$rest"
}

# ---------------------------------------------------------------------------------------------
# Deployment

write_parameters() {
  local file=$1
  (
    umask 077
    jq -n \
      --arg slug "$SLUG" --argjson amount "$BUDGET_AMOUNT" --arg budgetStart "$BUDGET_START" \
      --arg alertStart "$ALERT_START" --arg alertEnd "$ALERT_END" --argjson emails "$EMAILS_JSON" '{
        "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
        contentVersion: "1.0.0.0",
        parameters: {
          deploymentSlug: {value: $slug},
          budgetAmount: {value: $amount},
          budgetStartDate: {value: $budgetStart},
          alertReceivers: {value: {emails: $emails}},
          anomalyAlertStartDate: {value: $alertStart},
          anomalyAlertEndDate: {value: $alertEnd}
        }
      }' >"$file"
  )
}

deploy_cost() {
  local params="$TMP_DIR/cost.parameters.json"
  section "Cost deployment"
  write_parameters "$params"
  if ! az deployment sub create --name "$DEPLOYMENT_NAME" --location "$DATA_LOCATION" \
    --subscription "$SUB_ID" --template-file "$TEMPLATE" --parameters "@$params" \
    -o none --only-show-errors 2>"$TMP_DIR/stderr"; then
    rm -f "$params"
    if not_ready; then exit_not_ready "deployment $DEPLOYMENT_NAME"; fi
    show_stderr
    if grep -q 'InvalidDeploymentLocation' "$TMP_DIR/stderr"; then
      die "deployment $DEPLOYMENT_NAME ran in another region before: delete that record (az deployment sub delete --name $DEPLOYMENT_NAME; the budget stays) and re-run"
    fi
    die "deployment $DEPLOYMENT_NAME failed; see docs/cost-and-abuse.md, Troubleshooting"
  fi
  rm -f "$params"
  if [ "$BUDGET_EXISTS" = true ]; then
    applied "updated $BUDGET (monthly since ${BUDGET_START%T*})"
  else
    applied "created $BUDGET (monthly from ${BUDGET_START%T*})"
  fi
  if [ "$ALERT_EXISTS" = true ]; then
    applied "updated $ANOMALY_ALERT (daily, now until ${ALERT_END%T*})"
  else
    applied "created $ANOMALY_ALERT (daily, until ${ALERT_END%T*})"
  fi
}

summary() {
  section "Summary"
  printf '  The cost guardrails of deployment %s are in place for the whole subscription.\n' "$SLUG"
  printf '  Budget %s: actual 10/50/100 %% and forecast 50/100 %% go to the alert emails,\n' "$BUDGET"
  printf '  %s and the subscription Owner role. Budgets only alert; they never stop spending.\n' "$ACTION_GROUP"
  printf '  Anomaly alert %s expires on %s: re-run this script before then (at least yearly).\n' \
    "$ANOMALY_ALERT" "${ALERT_END%T*}"
  printf '  Re-running this script is safe.\n'
  if [ "$WARNINGS" -gt 0 ]; then
    printf '  %d warning(s); see above.\n' "$WARNINGS"
  fi
}

main() {
  parse_args "$@"
  preflight
  TMP_DIR=$(mktemp -d)
  trap cleanup EXIT
  trap 'exit 130' INT TERM

  printf 'Bootstrapping the cost guardrails\n'
  read_instance
  azure_preflight
  read_existing
  deploy_cost
  summary
}

main "$@"
