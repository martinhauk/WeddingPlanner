#!/usr/bin/env bash
# Tests for infra/app (the app infrastructure of one environment) and infra/bicepconfig.json.
#
# Everything runs through the local Bicep compiler (`az bicep`): no Azure login, no calls to
# Azure, nothing is deployed. The tests check that
#   1. `az bicep build` and `az bicep lint` report no diagnostics at all. Bicep's type system
#      also bounds the length of every derived resource name against the module's
#      @minLength/@maxLength, so a name that could get too long fails here;
#   2. `az bicep build-params` turns dummy environment variables into the expected parameters,
#      applies the optional defaults, and fails on missing or invalid variables;
#   3. the compiled ARM template meets the contract of the issue (template.jq);
#   4. bicepconfig.json turns each required linter rule into an error (one fixture per rule).
#
# Usage: infra/app/tests/run.sh        (needs az with Bicep, and jq)
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
APP=$(cd "$HERE/.." && pwd)
INFRA=$(cd "$APP/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Keep az offline and quiet: no Bicep version check, no telemetry, no colours.
export AZURE_BICEP_CHECK_VERSION=false AZURE_CORE_COLLECT_TELEMETRY=false AZURE_CORE_NO_COLOR=true

for tool in az jq; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf '%s is required\n' "$tool" >&2
    exit 2
  }
done

TEMPLATE="$WORK/main.json"
PARAMS="$WORK/params.json"
OUT=""
STATUS=0
PASSED=0
FAILED=0

# Every variable main.bicepparam reads. All are unset before each run, so nothing leaks in
# from the caller's shell.
PARAM_VARS="DEPLOYMENT_SLUG ENVIRONMENT_NAME DATA_LOCATION SWA_LOCATION FEATURES_RSVP
FEATURES_ADMIN RSVP_DEADLINE RSVP_TIME_ZONE LOG_DAILY_CAP_GB ENABLE_ALERTS"
REQUIRED_VARS="DEPLOYMENT_SLUG ENVIRONMENT_NAME DATA_LOCATION SWA_LOCATION FEATURES_RSVP
FEATURES_ADMIN RSVP_DEADLINE RSVP_TIME_ZONE"
# Dummy values only (a fictional far-future deadline); the optional variables stay unset.
VALID_ENV=(
  DEPLOYMENT_SLUG=wedabc123
  ENVIRONMENT_NAME=e2e
  DATA_LOCATION=germanywestcentral
  SWA_LOCATION=westeurope
  FEATURES_RSVP=true
  FEATURES_ADMIN=false
  RSVP_DEADLINE=2099-06-30T23:59:59
  RSVP_TIME_ZONE=Europe/Berlin
)

test_case() { printf '\n%s\n' "$1"; }

# check DESCRIPTION CMD...: count and print the result of CMD; show OUT when it fails.
check() {
  local description=$1
  shift
  if "$@"; then
    PASSED=$((PASSED + 1))
    printf '  ok    %s\n' "$description"
  else
    FAILED=$((FAILED + 1))
    printf '  FAIL  %s\n' "$description"
    if [ -n "$OUT" ]; then
      printf '%s\n' "$OUT" | sed 's/^/        | /'
    fi
  fi
}

# run CMD...: run CMD; its combined output goes to OUT and its exit code to STATUS.
run() {
  set +e
  OUT=$("$@" 2>&1)
  STATUS=$?
  set -e
}

status_is() { [ "$STATUS" -eq "$1" ]; }
status_not() { [ "$STATUS" -ne "$1" ]; }
output_has() { printf '%s' "$OUT" | grep -qF -- "$1"; }
# Bicep diagnostics look like "main.bicep(12,3) : Warning rule-name: message".
no_diagnostics() { ! printf '%s' "$OUT" | grep -qE '\([0-9]+,[0-9]+\) : (Error|Warning|Info) '; }
has_error() { printf '%s' "$OUT" | grep -qE "\\([0-9]+,[0-9]+\\) : Error $1:"; }

# build_params [VAR=value...]: az bicep build-params with exactly these variables set.
build_params() {
  local unset_args=() var
  for var in $PARAM_VARS; do
    unset_args+=(-u "$var")
  done
  rm -f "$PARAMS"
  run env "${unset_args[@]}" "$@" az bicep build-params --file "$APP/main.bicepparam" \
    --outfile "$PARAMS"
}

# param_is NAME JSON: the built parameter NAME has exactly this JSON value.
param_is() { [ "$(jq -c --arg n "$1" '.parameters[$n].value' "$PARAMS")" = "$2" ]; }
# fails_naming VAR: the last run failed and its output names VAR (Bicep quotes it).
fails_naming() { status_not 0 && output_has "\"$1\""; }
# config_has FILTER: the jq FILTER on infra/bicepconfig.json yields true.
config_has() { jq -e "$1" "$INFRA/bicepconfig.json" >/dev/null; }

# lint_fixture NAME CONTENT: lint a Bicep fixture next to a copy of infra/bicepconfig.json.
lint_fixture() {
  local dir="$WORK/fixtures/$1"
  mkdir -p "$dir"
  cp "$INFRA/bicepconfig.json" "$dir/bicepconfig.json"
  printf '%s\n' "$2" >"$dir/main.bicep"
  run az bicep lint --file "$dir/main.bicep"
}

test_case "build and lint"
run az bicep build --file "$APP/main.bicep" --outfile "$TEMPLATE"
check "az bicep build main.bicep succeeds" status_is 0
check "build reports no diagnostics (derived names fit their length limits)" no_diagnostics
run az bicep lint --file "$APP/main.bicep"
check "az bicep lint main.bicep (with all modules) succeeds" status_is 0
check "lint reports no diagnostics" no_diagnostics
run env "${VALID_ENV[@]}" az bicep lint --file "$APP/main.bicepparam"
check "az bicep lint main.bicepparam succeeds with dummy env vars" status_is 0
check "parameter file lint reports no diagnostics" no_diagnostics
OUT=""
check "infra/app uses the shared infra/bicepconfig.json" test ! -e "$APP/bicepconfig.json"

test_case "build-params with dummy env vars"
build_params "${VALID_ENV[@]}"
check "succeeds" status_is 0
check "reports no diagnostics" no_diagnostics
OUT=""
check "sets exactly the ten env-backed parameters" \
  test "$(jq -c '.parameters | keys' "$PARAMS")" = \
  '["dataLocation","deploymentSlug","enableAlerts","environmentName","featuresAdmin","featuresRsvp","logDailyCapGb","rsvpDeadline","rsvpTimeZone","swaLocation"]'
check "deploymentSlug from DEPLOYMENT_SLUG" param_is deploymentSlug '"wedabc123"'
check "environmentName from ENVIRONMENT_NAME" param_is environmentName '"e2e"'
check "dataLocation from DATA_LOCATION" param_is dataLocation '"germanywestcentral"'
check "swaLocation from SWA_LOCATION" param_is swaLocation '"westeurope"'
check "featuresRsvp is the bool true" param_is featuresRsvp 'true'
check "featuresAdmin is the bool false" param_is featuresAdmin 'false'
check "rsvpDeadline from RSVP_DEADLINE" param_is rsvpDeadline '"2099-06-30T23:59:59"'
check "rsvpTimeZone from RSVP_TIME_ZONE" param_is rsvpTimeZone '"Europe/Berlin"'
check "logDailyCapGb defaults to the string 0.1" param_is logDailyCapGb '"0.1"'
check "enableAlerts defaults to true" param_is enableAlerts 'true'

build_params "${VALID_ENV[@]}" LOG_DAILY_CAP_GB=0.5 ENABLE_ALERTS=false FEATURES_RSVP=False \
  FEATURES_ADMIN=TRUE ENVIRONMENT_NAME=production SWA_LOCATION=eastasia
check "optional variables set and other values: succeeds" status_is 0
OUT=""
check "LOG_DAILY_CAP_GB overrides the cap" param_is logDailyCapGb '"0.5"'
check "ENABLE_ALERTS=false disables the alerts" param_is enableAlerts 'false'
check "FEATURES_RSVP=False parses case-insensitively" param_is featuresRsvp 'false'
check "FEATURES_ADMIN=TRUE parses case-insensitively" param_is featuresAdmin 'true'
check "ENVIRONMENT_NAME=production is accepted" param_is environmentName '"production"'
check "SWA_LOCATION=eastasia is accepted" param_is swaLocation '"eastasia"'

test_case "build-params fails on a missing required env var"
for missing in $REQUIRED_VARS; do
  args=()
  for kv in "${VALID_ENV[@]}"; do
    [ "${kv%%=*}" = "$missing" ] || args+=("$kv")
  done
  build_params "${args[@]}"
  check "without $missing: fails and names the variable" fails_naming "$missing"
done

test_case "build-params fails on invalid values"
build_params "${VALID_ENV[@]}" ENVIRONMENT_NAME=staging
check "ENVIRONMENT_NAME=staging is rejected" status_not 0
build_params "${VALID_ENV[@]}" SWA_LOCATION=germanywestcentral
check "SWA_LOCATION=germanywestcentral is rejected (SWA is not offered there)" status_not 0
build_params "${VALID_ENV[@]}" FEATURES_RSVP=yes
check "FEATURES_RSVP=yes is rejected (not a bool)" status_not 0
build_params "${VALID_ENV[@]}" ENABLE_ALERTS=1
check "ENABLE_ALERTS=1 is rejected (not a bool)" status_not 0
build_params "${VALID_ENV[@]}" DEPLOYMENT_SLUG=wed12
check "DEPLOYMENT_SLUG shorter than 6 characters is rejected" status_not 0
build_params "${VALID_ENV[@]}" DEPLOYMENT_SLUG=wed123456789
check "DEPLOYMENT_SLUG longer than 11 characters is rejected" status_not 0
OUT=""

# template.jq prints "group<TAB>name", "ok<TAB>description" or "FAIL<TAB>description".
if [ -s "$TEMPLATE" ]; then
  run jq -r -f "$HERE/template.jq" "$TEMPLATE"
  test_case "template contract (template.jq)"
  check "template.jq runs" status_is 0
  RESULTS=$OUT
  OUT=""
  status_is 0 || RESULTS=""
  while IFS="$(printf '\t')" read -r result description; do
    case "$result" in
      group) test_case "$description" ;;
      ok | FAIL) check "$description" test "$result" = ok ;;
      "") ;;
      *) check "unexpected template.jq output: $result" false ;;
    esac
  done <<EOF
$RESULTS
EOF
else
  check "compiled template exists for the contract checks" false
fi

test_case "bicepconfig.json"
check "the five required rules are set to error" config_has '.analyzers.core.rules | [
  ."outputs-should-not-contain-secrets", ."secure-secrets-in-params",
  ."use-secure-value-for-secure-inputs", ."no-unused-params", ."use-recent-api-versions"]
  | all(.level == "error")'

lint_fixture secret-output "resource account 'Microsoft.Storage/storageAccounts@2026-06-01' existing = {
  name: 'stexample'
}
output accountKey string = account.listKeys().keys[0].value"
check "an output with an account key fails lint" has_error outputs-should-not-contain-secrets

lint_fixture plain-secret-param "param adminPassword string
output passwordLength int = length(adminPassword)"
check "a password parameter without @secure() fails lint" has_error secure-secrets-in-params

lint_fixture insecure-input "param vmLogin string
resource vm 'Microsoft.Compute/virtualMachines@2025-04-01' = {
  name: 'vm-example'
  location: resourceGroup().location
  properties: {
    osProfile: {
      computerName: 'vm-example'
      adminUsername: vmLogin
      adminPassword: vmLogin
    }
  }
}"
check "a non-secure value for a secure property fails lint" \
  has_error use-secure-value-for-secure-inputs

lint_fixture unused-param "param unusedValue string"
check "an unused parameter fails lint" has_error no-unused-params

lint_fixture old-api-version "resource account 'Microsoft.Storage/storageAccounts@2021-09-01' = {
  name: 'stexample'
  location: resourceGroup().location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
}"
check "an outdated API version fails lint" has_error use-recent-api-versions

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
