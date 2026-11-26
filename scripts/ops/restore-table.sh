#!/usr/bin/env bash
# restore-table.sh: restore a table backup into ONE environment (e2e, test or production).
#
# Run by the owner on their own machine, signed in with `az login` (the owner has Storage Table
# Data Contributor and Storage Blob Data Contributor on the app resource group, from
# scripts/bootstrap.sh). Never run by CI. A DRY RUN by default: it downloads and checks the
# backup and shows what would be written; only --apply writes, after a confirmation.
# It prints table names and row counts, never account names, keys or row contents.
#
# Usage: scripts/ops/restore-table.sh --env ENV (--instance DIR | --resource-group RG) [options]
#
#   --env ENV               e2e, test or production (required)
#   --instance DIR          local checkout of the private instance repo (its slug names the
#                           resource group rg-<slug>-ENV); e2e defaults to samples/instance
#   --resource-group RG     the app resource group instead of --instance
#   --list                  list the backups of the environment, newest first, and exit
#   --backup-id ID          the backup to restore (see --list)
#   --tables A,B            only these tables (default: every table of the backup)
#   --table-prefix P        restore into P<Table> next to the live tables (inspect a backup,
#                           restore drill) instead of the original tables
#   --force                 also write into tables that already hold rows: backup rows replace
#                           rows with the same keys, other rows stay. Without it the restore
#                           refuses non-empty target tables.
#   --apply                 really write (default: dry run). Asks to type the environment name.
#   --yes                   e2e/test only: skip the confirmation of --apply
#   --subscription ID       Azure subscription id (default: the current `az account`)
#   -h, --help              show this help
#
# Requires: az, jq, node (Node 24) and `pnpm install` in the repository. Runbook:
# docs/runbooks/backup-restore.md
set -euo pipefail

ENVIRONMENTS="e2e test production"
SLUG_REGEX='^wed[0-9a-z]{3,8}$'
GUID_REGEX='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
BACKUP_ID_REGEX='^[0-9]{8}T[0-9]{6}Z-[a-z0-9]{1,20}-[0-9a-f]{6}$'
TABLES_REGEX='^[A-Za-z][A-Za-z0-9]{2,62}(,[A-Za-z][A-Za-z0-9]{2,62})*$'
PREFIX_REGEX='^[A-Za-z][A-Za-z0-9]{0,39}$'
RG_REGEX='^[A-Za-z0-9._()-]{1,90}$'

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
CLI="$REPO_ROOT/tools/table-backup/src/cli.ts"
SAMPLE_INSTANCE_FILE="$REPO_ROOT/samples/instance/instance.json"

ENV_NAME=""
INSTANCE_DIR=""
RESOURCE_GROUP=""
LIST=false
BACKUP_ID=""
TABLES=""
TABLE_PREFIX=""
FORCE=false
APPLY=false
YES=false
SUBSCRIPTION=""
DATA_ACCOUNT=""
BACKUP_ACCOUNT=""
SUB_ARGS=()

usage() {
  sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//'
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

matches() { printf '%s' "$1" | grep -Eq "$2"; }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --env | --instance | --resource-group | --backup-id | --tables | --table-prefix | --subscription)
        [ $# -ge 2 ] || die "$1 needs a value"
        case "$1" in
          --env) ENV_NAME=$2 ;;
          --instance) INSTANCE_DIR=$2 ;;
          --resource-group) RESOURCE_GROUP=$2 ;;
          --backup-id) BACKUP_ID=$2 ;;
          --tables) TABLES=$2 ;;
          --table-prefix) TABLE_PREFIX=$2 ;;
          --subscription) SUBSCRIPTION=$2 ;;
        esac
        shift 2
        ;;
      --list) LIST=true && shift ;;
      --force) FORCE=true && shift ;;
      --apply) APPLY=true && shift ;;
      --yes) YES=true && shift ;;
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
  [ -n "$ENV_NAME" ] || die "--env is required: e2e, test or production (see --help)"
  case " $ENVIRONMENTS " in
    *" $ENV_NAME "*) ;;
    *) die "--env must be one of: $ENVIRONMENTS" ;;
  esac
  [ -z "$INSTANCE_DIR" ] || [ -z "$RESOURCE_GROUP" ] || die "pass either --instance or --resource-group"
  if [ -n "$RESOURCE_GROUP" ]; then
    matches "$RESOURCE_GROUP" "$RG_REGEX" || die "invalid --resource-group"
  elif [ -z "$INSTANCE_DIR" ] && [ "$ENV_NAME" != "e2e" ]; then
    die "--env $ENV_NAME needs --instance <instance checkout> or --resource-group <rg>"
  fi
  if [ "$LIST" = true ]; then
    if [ -n "$BACKUP_ID$TABLES$TABLE_PREFIX" ] || [ "$FORCE" = true ] || [ "$APPLY" = true ]; then
      die "--list takes no restore options"
    fi
  else
    [ -n "$BACKUP_ID" ] || die "--backup-id is required (find one with --list)"
    matches "$BACKUP_ID" "$BACKUP_ID_REGEX" || die "invalid --backup-id"
  fi
  if [ -n "$TABLES" ]; then matches "$TABLES" "$TABLES_REGEX" || die "invalid --tables (A,B,...)"; fi
  if [ -n "$TABLE_PREFIX" ]; then
    matches "$TABLE_PREFIX" "$PREFIX_REGEX" || die "invalid --table-prefix (a letter, then letters or digits)"
  fi
  if [ -n "$SUBSCRIPTION" ]; then
    matches "$SUBSCRIPTION" "$GUID_REGEX" || die "--subscription must be a subscription id (GUID)"
  fi
  if [ "$YES" = true ] && [ "$ENV_NAME" = production ]; then
    die "--yes is not accepted for production: confirm by typing the environment name"
  fi
  for tool in az jq node; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool not found"
  done
  [ -f "$CLI" ] || die "tools/table-backup is missing; run from a checkout of this repository"
  [ -d "$REPO_ROOT/tools/table-backup/node_modules" ] || die "run pnpm install in the repository first"
}

resolve_resource_group() {
  local file slug
  [ -z "$RESOURCE_GROUP" ] || return 0
  if [ -n "$INSTANCE_DIR" ]; then
    file="$INSTANCE_DIR/instance.json"
  else
    file=$SAMPLE_INSTANCE_FILE
  fi
  [ -f "$file" ] || die "instance.json not found"
  slug=$(jq -r 'if (.slug | type) == "string" then .slug else "" end' "$file" 2>/dev/null) ||
    die "instance.json is not valid JSON"
  matches "$slug" "$SLUG_REGEX" || die "instance.json: slug must match $SLUG_REGEX"
  RESOURCE_GROUP="rg-$slug-$ENV_NAME"
}

# find_account PREFIX: print the only storage account named PREFIX... in the resource group
# (naming contract of infra/app: data account "st...", backup account "bk...").
find_account() {
  local names count
  names=$(az storage account list --resource-group "$RESOURCE_GROUP" ${SUB_ARGS[@]+"${SUB_ARGS[@]}"} \
    --query "[?starts_with(name, '$1')].name" -o tsv --only-show-errors) ||
    die "cannot list the storage accounts of $RESOURCE_GROUP (az login? right subscription?)"
  count=$(printf '%s' "$names" | grep -c . || true)
  [ "$count" -le 1 ] || die "more than one $1... storage account in $RESOURCE_GROUP"
  printf '%s' "$names"
}

# cli ARGS...: run the backup tool against the environment's accounts.
cli() {
  node "$CLI" "$@" --tables-account "$DATA_ACCOUNT" --backup-account "$BACKUP_ACCOUNT"
}

main() {
  local args=() answer
  parse_args "$@"
  preflight
  resolve_resource_group
  if [ -n "$SUBSCRIPTION" ]; then SUB_ARGS=(--subscription "$SUBSCRIPTION"); fi
  az account show ${SUB_ARGS[@]+"${SUB_ARGS[@]}"} --query id -o tsv --only-show-errors >/dev/null 2>&1 ||
    die "not signed in to Azure (az login) or the subscription is not available"

  BACKUP_ACCOUNT=$(find_account bk)
  [ -n "$BACKUP_ACCOUNT" ] || die "$RESOURCE_GROUP has no backup store (bk...): deploy the environment first"
  DATA_ACCOUNT=$(find_account st)
  [ -n "$DATA_ACCOUNT" ] || die "$RESOURCE_GROUP has no data account (st...): deploy the environment first"
  printf 'Environment %s (%s)\n' "$ENV_NAME" "$RESOURCE_GROUP"

  if [ "$LIST" = true ]; then
    cli list
    return
  fi

  args=(restore --backup-id "$BACKUP_ID")
  if [ -n "$TABLES" ]; then args+=(--tables "$TABLES"); fi
  if [ -n "$TABLE_PREFIX" ]; then args+=(--table-prefix "$TABLE_PREFIX"); fi
  if [ "$FORCE" = true ]; then args+=(--force); fi

  printf '\nDry run: checking backup %s\n' "$BACKUP_ID"
  cli "${args[@]}" --dry-run || die "the dry run failed; nothing was written"
  if [ "$APPLY" = false ]; then
    printf '\nNothing was written. Re-run with --apply to restore.\n'
    return
  fi

  if [ "$YES" = false ]; then
    printf '\nRestore backup %s into %s%s? Type the environment name to confirm: ' \
      "$BACKUP_ID" "$ENV_NAME" "$([ -n "$TABLE_PREFIX" ] && printf ' (prefix %s)' "$TABLE_PREFIX")"
    answer=""
    read -r answer || true
    [ "$answer" = "$ENV_NAME" ] || die "not confirmed; nothing was written"
  fi
  printf '\nRestoring backup %s\n' "$BACKUP_ID"
  cli "${args[@]}" || die "the restore failed; see above (re-running is safe: rows are upserted)"

  args=(verify --backup-id "$BACKUP_ID")
  if [ -n "$TABLES" ]; then args+=(--tables "$TABLES"); fi
  if [ -n "$TABLE_PREFIX" ]; then args+=(--table-prefix "$TABLE_PREFIX"); fi
  printf '\nVerifying\n'
  if ! cli "${args[@]}"; then
    if [ "$FORCE" = true ]; then
      printf 'The tables hold more than the backup (--force keeps rows that are not in it).\n'
    else
      die "the restored tables do not match the backup"
    fi
  fi
  printf '\nDone.\n'
}

main "$@"
