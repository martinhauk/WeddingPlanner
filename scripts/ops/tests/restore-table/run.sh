#!/usr/bin/env bash
# Tests for scripts/ops/restore-table.sh against a fake `az` and a fake `node` (no network, no
# Azure). The script is copied into a throwaway repository layout with a fixture instance.
#
# Covered: dry run by default, --apply with typed confirmation (and its refusal), --yes outside
# production only, the options passed to the backup tool, --list, account discovery and its
# failures, argument checks before any call, and that no account name is printed.
#
# Usage: scripts/ops/tests/restore-table/run.sh
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

FAKE_REPO="$WORK/repo"
mkdir -p "$FAKE_REPO/scripts/ops" "$FAKE_REPO/tools/table-backup/src" \
  "$FAKE_REPO/tools/table-backup/node_modules" "$FAKE_REPO/samples/instance" "$WORK/bin"
cp "$ROOT/scripts/ops/restore-table.sh" "$FAKE_REPO/scripts/ops/restore-table.sh"
: >"$FAKE_REPO/tools/table-backup/src/cli.ts"
printf '{"slug": "wedsample1", "sample": true}\n' >"$FAKE_REPO/samples/instance/instance.json"
INSTANCE="$WORK/instance"
mkdir -p "$INSTANCE"
printf '{"slug": "wedx7k2p9"}\n' >"$INSTANCE/instance.json"
cp "$HERE/fake-az" "$WORK/bin/az"
cp "$HERE/fake-node" "$WORK/bin/node"
chmod +x "$FAKE_REPO/scripts/ops/restore-table.sh" "$WORK/bin/az" "$WORK/bin/node"

AZ_LOG="$WORK/az.log"
NODE_LOG="$WORK/node.log"
DATA=stwedx7k2p9testabc123
BACKUP=bkwedx7k2p9testabc123
ID=20261126T013000Z-nightly-3fa9c2
OUT=""
STATUS=0
PASSED=0
FAILED=0

# run INPUT [ENV=value...] -- ARGS...: run the script with stdin INPUT; sets OUT and STATUS.
run() {
  local input=$1 envs=()
  shift
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do
    envs+=("$1")
    shift
  done
  shift
  : >"$AZ_LOG"
  : >"$NODE_LOG"
  set +e
  OUT=$(printf '%s' "$input" | env -u CI -u GITHUB_ACTIONS PATH="$WORK/bin:$PATH" \
    FAKE_AZ_LOG="$AZ_LOG" FAKE_NODE_LOG="$NODE_LOG" FAKE_AZ_ACCOUNTS="$DATA $BACKUP" \
    ${envs[@]+"${envs[@]}"} "$FAKE_REPO/scripts/ops/restore-table.sh" "$@" 2>&1)
  STATUS=$?
  set -e
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
    sed 's/^/        > /' "$AZ_LOG" "$NODE_LOG"
  fi
}
status_is() { [ "$STATUS" -eq "$1" ]; }
failed() { [ "$STATUS" -ne 0 ]; }
output_has() { printf '%s' "$OUT" | grep -qF -- "$1"; }
output_lacks() { ! output_has "$1"; }
node_calls() { grep -c . "$NODE_LOG" || true; }
node_line() { sed -n "${1}p" "$NODE_LOG"; }
node_silent() { [ ! -s "$NODE_LOG" ]; }
az_silent() { [ ! -s "$AZ_LOG" ]; }
no_account_names() { ! printf '%s' "$OUT" | grep -qE "$DATA|$BACKUP"; }
refused() { failed && output_has "$1" && az_silent && node_silent; }
ACCOUNTS="--tables-account $DATA --backup-account $BACKUP"

test_case "dry run by default"
run "" -- --env test --instance "$INSTANCE" --backup-id "$ID"
check "exits 0" status_is 0
check "runs the tool once" [ "$(node_calls)" -eq 1 ]
check "as a dry run with both accounts" [ "$(node_line 1)" = "node restore --backup-id $ID --dry-run $ACCOUNTS" ]
check "finds the accounts in rg-<slug>-<env>" grep -qF "storage account list --resource-group rg-wedx7k2p9-test" "$AZ_LOG"
check "says nothing was written" output_has "Nothing was written"
check "prints no account names" no_account_names

test_case "--apply asks for the environment name, then restores and verifies"
run "test
" -- --env test --instance "$INSTANCE" --backup-id "$ID" --tables Rsvps,Guests --apply
check "exits 0" status_is 0
check "dry run, restore, verify" [ "$(node_calls)" -eq 3 ]
check "dry run first" [ "$(node_line 1)" = "node restore --backup-id $ID --tables Rsvps,Guests --dry-run $ACCOUNTS" ]
check "then the restore without --dry-run" [ "$(node_line 2)" = "node restore --backup-id $ID --tables Rsvps,Guests $ACCOUNTS" ]
check "then verify with the same tables" [ "$(node_line 3)" = "node verify --backup-id $ID --tables Rsvps,Guests $ACCOUNTS" ]
check "asked to confirm" output_has "Type the environment name to confirm"
check "prints no account names" no_account_names

test_case "--apply without the right confirmation writes nothing"
run "yes
" -- --env production --instance "$INSTANCE" --backup-id "$ID" --apply
check "exits non-zero" failed
check "explains" output_has "not confirmed; nothing was written"
check "only the dry run ran" [ "$(node_calls)" -eq 1 ]
run "" -- --env production --instance "$INSTANCE" --backup-id "$ID" --apply
check "no input: refused too" failed
check "no input: only the dry run ran" [ "$(node_calls)" -eq 1 ]

test_case "--table-prefix and --force are passed on"
run "" -- --env e2e --backup-id "$ID" --table-prefix inspect1 --force --apply --yes
check "exits 0" status_is 0
check "e2e uses the sample slug" grep -qF "rg-wedsample1-e2e" "$AZ_LOG"
check "restore into the prefix with --force" \
  [ "$(node_line 2)" = "node restore --backup-id $ID --table-prefix inspect1 --force $ACCOUNTS" ]
check "verify the prefixed copy" [ "$(node_line 3)" = "node verify --backup-id $ID --table-prefix inspect1 $ACCOUNTS" ]
check "--yes skips the question" output_lacks "Type the environment name"

test_case "a failed dry run (guard, broken backup) stops before any write"
run "test
" FAKE_NODE_FAIL=dry-run -- --env test --instance "$INSTANCE" --backup-id "$ID" --apply
check "exits non-zero" failed
check "nothing written" output_has "nothing was written"
check "only the dry run ran" [ "$(node_calls)" -eq 1 ]

test_case "a verify mismatch fails, except after --force"
run "" FAKE_NODE_FAIL=verify -- --env test --instance "$INSTANCE" --backup-id "$ID" --apply --yes
check "exits non-zero" failed
check "explains" output_has "do not match the backup"
run "" FAKE_NODE_FAIL=verify -- --env test --instance "$INSTANCE" --backup-id "$ID" --apply --yes --force
check "with --force: exits 0" status_is 0
check "with --force: explains extra rows" output_has "--force keeps rows"

test_case "--list"
run "" -- --env production --resource-group rg-wedx7k2p9-production --list
check "exits 0" status_is 0
check "lists with the backup account" [ "$(node_line 1)" = "node list $ACCOUNTS" ]
check "uses the given resource group" grep -qF "rg-wedx7k2p9-production" "$AZ_LOG"

test_case "account discovery"
run "" FAKE_AZ_ACCOUNTS="$DATA" -- --env test --instance "$INSTANCE" --backup-id "$ID"
check "no backup store: fails" failed
check "explains" output_has "has no backup store"
check "no tool call" node_silent
run "" FAKE_AZ_ACCOUNTS="$BACKUP" -- --env test --instance "$INSTANCE" --backup-id "$ID"
check "no data account: fails" output_has "has no data account"
run "" FAKE_AZ_ACCOUNTS="$DATA stother1 $BACKUP" -- --env test --instance "$INSTANCE" --backup-id "$ID"
check "two data accounts: fails" output_has "more than one st"
run "" FAKE_AZ_LIST_FAIL=true -- --env test --instance "$INSTANCE" --backup-id "$ID"
check "listing fails: explains" output_has "cannot list the storage accounts"
run "" FAKE_AZ_LOGGED_IN=false -- --env test --instance "$INSTANCE" --backup-id "$ID"
check "not signed in: asks for az login" output_has "az login"
check "not signed in: no tool call" node_silent

test_case "arguments are checked before anything runs"
run "" -- --env test --backup-id "$ID"
check "test needs --instance or --resource-group" refused "needs --instance"
run "" -- --env staging --backup-id "$ID"
check "unknown environment" refused "--env must be one of"
run "" -- --env test --instance "$INSTANCE"
check "--backup-id is required" refused "--backup-id is required"
run "" -- --env test --instance "$INSTANCE" --backup-id ../../etc
check "invalid backup id" refused "invalid --backup-id"
run "" -- --env test --instance "$INSTANCE" --backup-id "$ID" --tables "Rsvps;rm"
check "invalid tables" refused "invalid --tables"
run "" -- --env test --instance "$INSTANCE" --backup-id "$ID" --table-prefix 9x
check "invalid prefix" refused "invalid --table-prefix"
run "" -- --env production --instance "$INSTANCE" --backup-id "$ID" --apply --yes
check "--yes refused for production" refused "not accepted for production"
run "" -- --env test --instance "$INSTANCE" --list --apply
check "--list takes no restore options" refused "--list takes no restore options"
run "" -- --env test --instance "$INSTANCE" --resource-group rg-x --backup-id "$ID"
check "--instance and --resource-group exclude each other" refused "either --instance or --resource-group"
run "" -- --env test --bogus
check "unknown argument" refused "unknown argument"
run "" GITHUB_ACTIONS=true -- --env test --instance "$INSTANCE" --backup-id "$ID"
check "refuses to run in CI" refused "never by CI"

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
