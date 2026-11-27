#!/usr/bin/env bash
# Tests for infra/bootstrap (the owner-run bootstrap core of one environment): the access of the
# nightly backup identity.
#
# Everything runs through the local Bicep compiler (`az bicep`): no Azure login, no calls to
# Azure, nothing is deployed. scripts/tests/bootstrap/run.sh covers scripts/bootstrap.sh itself
# against a fake az. The tests check that
#   1. `az bicep build` of main.bicep (with its modules) and of infra/app/backup.bicep report no
#      diagnostics;
#   2. the compiled template meets its access contract (access.jq): the custom role "WeddingPlanner
#      Backup Writer" may write new blobs and read blobs, never delete them or touch tables, and
#      its assignment to the backup identity carries the condition that limits reads to current
#      versions in the backup container of infra/app/backup.bicep.
#
# Usage: infra/bootstrap/tests/run.sh        (needs az with Bicep, and jq)
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BOOTSTRAP=$(cd "$HERE/.." && pwd)
INFRA=$(cd "$BOOTSTRAP/.." && pwd)
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
BACKUP_TEMPLATE="$WORK/backup.json"
OUT=""
STATUS=0
PASSED=0
FAILED=0

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
# Bicep diagnostics look like "main.bicep(12,3) : Warning rule-name: message".
no_diagnostics() { ! printf '%s' "$OUT" | grep -qE '\([0-9]+,[0-9]+\) : (Error|Warning|Info) '; }

test_case "build"
run az bicep build --file "$BOOTSTRAP/main.bicep" --outfile "$TEMPLATE"
check "az bicep build main.bicep succeeds" status_is 0
check "build reports no diagnostics" no_diagnostics
run az bicep build --file "$INFRA/app/backup.bicep" --outfile "$BACKUP_TEMPLATE"
check "az bicep build infra/app/backup.bicep succeeds (it names the backup container)" status_is 0
OUT=""

container=""
if [ -s "$BACKUP_TEMPLATE" ]; then
  container=$(jq -r '.resources[] | select(.name == "app-backup-storage")
    | .properties.template.variables.containerName // ""' "$BACKUP_TEMPLATE")
fi

# The contract prints "group<TAB>name", "ok<TAB>description" or "FAIL<TAB>description".
if [ -s "$TEMPLATE" ]; then
  run jq -r --arg container "$container" -f "$HERE/access.jq" "$TEMPLATE"
else
  STATUS=1 OUT="no compiled template"
fi
test_case "access contract (access.jq)"
check "access.jq runs" status_is 0
results=$OUT
OUT=""
status_is 0 || results=""
while IFS="$(printf '\t')" read -r result description; do
  case "$result" in
    group) test_case "$description" ;;
    ok | FAIL) check "$description" test "$result" = ok ;;
    "") ;;
    *) check "unexpected access.jq output: $result" false ;;
  esac
done <<EOF
$results
EOF

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
