#!/usr/bin/env bash
# bootstrap.sh: create the Azure core of ONE environment (e2e, test or production) of this
# WeddingPlanner deployment and connect it to the GitHub Environment of the same name.
#
# Run by the owner on their own machine, once per environment, in the order e2e, test,
# production, signed in with `az login` (Owner of the subscription) and `gh` (admin of this
# repository and, for test/production, of the private instance repo). Never run by CI.
# Idempotent: every re-run converges to the same state. It prints step and resource-group names
# only, never emails, subscription/tenant/client ids, the instance repo, keys or tokens.
#
# Usage: scripts/bootstrap.sh --env e2e|test|production [options]
#
#   --env ENV                   environment to bootstrap: e2e, test or production (required)
#   --instance DIR              test/production (required): local checkout of the private instance
#                               repo; its instance.json provides slug, dataLocation and alertEmails.
#                               e2e always reads samples/instance/instance.json.
#   --instance-repo OWNER/NAME  test/production: the private instance repo
#                               (default: the GitHub `origin` remote of --instance)
#   --alert-emails-from FILE    e2e only: take alertEmails from this private instance.json, so e2e
#                               alerts reach you instead of the sample's example.com addresses
#   --subscription ID           Azure subscription id (default: the current `az account`)
#   --repo OWNER/NAME           this repository (default: the current directory's GitHub repo)
#   --rotate-deploy-key         test/production: replace the instance-repo deploy key
#   --action-group-location L   only when the action group is created: "global" or a region
#                               (default: dataLocation if it offers regional processing, else
#                               global). An existing action group always keeps its location.
#   -h, --help                  show this help
#
# What a run does, for the chosen environment ENV and the slug from instance.json:
#   1. Checks first, changing nothing if one fails: the GitHub Environment ENV exists (created by
#      scripts/github/setup-repo.sh), production has a required reviewer, the repository's OIDC
#      subject prefix, the instance repo (private, admin access), the Azure sign-in, the
#      subscription state and the region of existing resource groups.
#   2. Registers the resource providers Web, Storage, OperationalInsights, Insights,
#      ManagedIdentity, Consumption, CostManagement and AlertsManagement.
#   3. Deploys infra/bootstrap/main.bicep at subscription scope: rg-<slug>-ENV (CanNotDelete lock)
#      and rg-<slug>-ENV-ops with identity id-<slug>-ENV (one federated credential, subject
#      <prefix>:environment:ENV) and action group ag-<slug>-ENV, plus the RBAC. test/production
#      also get the nightly backup identity id-<slug>-ENV-backup (subject
#      <prefix>:environment:backup-ENV) and the custom role "WeddingPlanner Backup Writer".
#   4. Sets ONLY the environment variables AZURE_CLIENT_ID, AZURE_TENANT_ID,
#      AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP and, for test/production, INSTANCE_REPO.
#   5. test/production: read-only deploy key deploy-ENV on the instance repo, its private key in
#      the environment secret INSTANCE_REPO_DEPLOY_KEY. Re-runs keep it unless --rotate-deploy-key.
#   6. test/production: the GitHub Environment backup-ENV for the nightly backup
#      (.github/workflows/backup.yml): branch main only, no reviewer (a scheduled run cannot wait
#      for one), no admin bypass, and the four AZURE_* variables of the backup identity, which can
#      read tables, write new backup blobs and read back the current versions of blobs in the
#      table-backups container (a role assignment condition), but can neither delete blobs nor
#      write tables (docs/runbooks/backup-restore.md).
#
# Requires: az (with Bicep), gh, jq, and for test/production git and ssh-keygen. Compatible with
# the bash 3.2 that ships with macOS. Runbook: docs/runbooks/azure-onboarding.md
set -euo pipefail

ENVIRONMENTS="e2e test production"
PROVIDERS="Microsoft.Web Microsoft.Storage Microsoft.OperationalInsights Microsoft.Insights
Microsoft.ManagedIdentity Microsoft.Consumption Microsoft.CostManagement Microsoft.AlertsManagement"
SLUG_REGEX='^wed[0-9a-z]{3,8}$'
GUID_REGEX='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
REPO_REGEX='^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
DEFAULT_DATA_LOCATION="germanywestcentral"
DEPLOY_KEY_SECRET="INSTANCE_REPO_DEPLOY_KEY"
DEPLOY_ATTEMPTS=4
TAB=$(printf '\t')
# Waits; the tests set them to 0.
POLL_SECONDS=${BOOTSTRAP_POLL_SECONDS:-10}
RETRY_SECONDS=${BOOTSTRAP_RETRY_SECONDS:-30}
PROVIDER_TIMEOUT_SECONDS=${BOOTSTRAP_PROVIDER_TIMEOUT_SECONDS:-900}

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
TEMPLATE="$REPO_ROOT/infra/bootstrap/main.bicep"
SAMPLE_INSTANCE_FILE="$REPO_ROOT/samples/instance/instance.json"

ENV_NAME=""
INSTANCE_DIR=""
INSTANCE_REPO=""
ALERT_EMAILS_FROM=""
SUBSCRIPTION=""
REPO=""
ROTATE_DEPLOY_KEY=false
REQUESTED_ACTION_GROUP_LOCATION=""

INSTANCE_FILE=""
SLUG=""
DATA_LOCATION=""
EMAILS_JSON=""
APP_RG=""
OPS_RG=""
IDENTITY=""
ACTION_GROUP=""
CREDENTIAL=""
DEPLOYMENT_NAME=""
SUBJECT_PREFIX=""
SUB_ID=""
TENANT_ID=""
OWNER_ID=""
CLIENT_ID=""
ACTION_GROUP_LOCATION=""
BACKUP_ENV=""
BACKUP_IDENTITY=""
BACKUP_CREDENTIAL=""
BACKUP_CLIENT_ID=""
VAR_ENV=""
TMP_DIR=""
CHANGES=0
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
changed() {
  CHANGES=$((CHANGES + 1))
  printf '  change   %s\n' "$*"
}
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
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# ---------------------------------------------------------------------------------------------
# GitHub helpers (gh api)

# api_get PATH: print the response body. Returns 1 on HTTP 404; dies on any other error.
api_get() {
  local out
  if out=$(gh api "$1" 2>"$TMP_DIR/stderr"); then
    printf '%s' "$out"
    return 0
  fi
  if grep -q 'HTTP 404' "$TMP_DIR/stderr"; then
    return 1
  fi
  show_stderr
  die "GitHub API request failed: GET $1"
}

# api_write METHOD PATH [JSON]: send a change; dies on error.
api_write() {
  local method=$1 path=$2 body=${3:-}
  if [ -n "$body" ]; then
    printf '%s' "$body" | gh api -X "$method" "$path" --input - >/dev/null 2>"$TMP_DIR/stderr" ||
      {
        show_stderr
        die "GitHub API request failed: $method $path"
      }
  else
    gh api -X "$method" "$path" >/dev/null 2>"$TMP_DIR/stderr" ||
      {
        show_stderr
        die "GitHub API request failed: $method $path"
      }
  fi
}

# ---------------------------------------------------------------------------------------------
# Arguments and local checks

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --env | --instance | --instance-repo | --alert-emails-from | --subscription | --repo | \
        --action-group-location)
        [ $# -ge 2 ] || die "$1 needs a value"
        case "$1" in
          --env) ENV_NAME=$2 ;;
          --instance) INSTANCE_DIR=$2 ;;
          --instance-repo) INSTANCE_REPO=$2 ;;
          --alert-emails-from) ALERT_EMAILS_FROM=$2 ;;
          --subscription) SUBSCRIPTION=$2 ;;
          --repo) REPO=$2 ;;
          --action-group-location) REQUESTED_ACTION_GROUP_LOCATION=$(lower "$2") ;;
        esac
        shift 2
        ;;
      --rotate-deploy-key)
        ROTATE_DEPLOY_KEY=true
        shift
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
  local tool tools="az gh jq"
  if [ "${GITHUB_ACTIONS:-}" = "true" ] || [ "${CI:-}" = "true" ]; then
    die "this script is run by the owner, never by CI"
  fi
  [ -n "$ENV_NAME" ] || die "--env is required: e2e, test or production (see --help)"
  case " $ENVIRONMENTS " in
    *" $ENV_NAME "*) ;;
    *) die "--env must be one of: $ENVIRONMENTS" ;;
  esac
  if [ "$ENV_NAME" = "e2e" ]; then
    [ -z "$INSTANCE_DIR" ] ||
      die "--env e2e always uses samples/instance/; to route e2e alerts to you, use --alert-emails-from <private instance.json>"
    [ -z "$INSTANCE_REPO" ] || die "--instance-repo is for test and production only"
    [ "$ROTATE_DEPLOY_KEY" = false ] || die "--rotate-deploy-key is for test and production only (e2e has no deploy key)"
  else
    [ -n "$INSTANCE_DIR" ] ||
      die "--env $ENV_NAME needs --instance <dir>: a local checkout of the private instance repo"
    [ -z "$ALERT_EMAILS_FROM" ] ||
      die "--alert-emails-from is for e2e only; $ENV_NAME reads alertEmails from --instance"
    tools="$tools git ssh-keygen"
  fi
  if [ -n "$SUBSCRIPTION" ]; then
    matches "$SUBSCRIPTION" "$GUID_REGEX" || die "--subscription must be a subscription id (GUID)"
  fi
  if [ -n "$REPO" ]; then
    matches "$REPO" "$REPO_REGEX" || die "invalid --repo (expected OWNER/NAME)"
  fi
  if [ -n "$REQUESTED_ACTION_GROUP_LOCATION" ]; then
    matches "$REQUESTED_ACTION_GROUP_LOCATION" '^[a-z0-9]+$' ||
      die "--action-group-location must be \"global\" or a region name"
  fi
  for tool in $tools; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool not found (see docs/runbooks/azure-onboarding.md, Tools)"
  done
  [ -f "$TEMPLATE" ] || die "template not found: infra/bootstrap/main.bicep"
}

# read_alert_emails FILE LABEL: validate alertEmails in FILE and set EMAILS_JSON. Error messages
# name the array index, never the address.
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
    if [ "$ENV_NAME" = "e2e" ]; then
      warn "$placeholders alert email(s) are example.com placeholders, so e2e alerts reach nobody; pass --alert-emails-from <private instance.json>"
    else
      warn "$placeholders alert email(s) in instance.json are example.com placeholders; replace them and re-run"
    fi
  fi
}

read_instance() {
  local slug location label
  section "Instance"
  if [ "$ENV_NAME" = "e2e" ]; then
    INSTANCE_FILE=$SAMPLE_INSTANCE_FILE
    label="samples/instance/instance.json"
  else
    [ -d "$INSTANCE_DIR" ] || die "--instance: directory not found"
    INSTANCE_DIR=$(cd "$INSTANCE_DIR" && pwd)
    INSTANCE_FILE="$INSTANCE_DIR/instance.json"
    label="instance.json (--instance)"
  fi
  [ -f "$INSTANCE_FILE" ] || die "$label not found"
  jq -e 'type == "object"' "$INSTANCE_FILE" >/dev/null 2>&1 || die "$label is not a JSON object"

  slug=$(jq -r 'if (.slug | type) == "string" then .slug else "" end' "$INSTANCE_FILE")
  matches "$slug" "$SLUG_REGEX" || die "$label: slug must match $SLUG_REGEX"
  SLUG=$slug
  location=$(jq -r --arg d "$DEFAULT_DATA_LOCATION" \
    'if (.dataLocation | type) == "string" then .dataLocation else $d end' "$INSTANCE_FILE")
  matches "$location" '^[a-z0-9]+$' || die "$label: dataLocation must be an Azure region name such as $DEFAULT_DATA_LOCATION"
  DATA_LOCATION=$location

  if [ -n "$ALERT_EMAILS_FROM" ]; then
    [ -f "$ALERT_EMAILS_FROM" ] || die "--alert-emails-from: file not found"
    jq -e 'type == "object"' "$ALERT_EMAILS_FROM" >/dev/null 2>&1 ||
      die "--alert-emails-from is not a JSON object"
    read_alert_emails "$ALERT_EMAILS_FROM" "--alert-emails-from"
  else
    read_alert_emails "$INSTANCE_FILE" "$label"
  fi

  if [ "$ENV_NAME" != "e2e" ] && [ "$(jq -r '.sample // false' "$INSTANCE_FILE")" = "true" ]; then
    warn "instance.json is still marked \"sample\": true; $ENV_NAME deploys reject sample content"
  fi

  APP_RG="rg-$SLUG-$ENV_NAME"
  OPS_RG="rg-$SLUG-$ENV_NAME-ops"
  IDENTITY="id-$SLUG-$ENV_NAME"
  ACTION_GROUP="ag-$SLUG-$ENV_NAME"
  CREDENTIAL="github-$ENV_NAME"
  DEPLOYMENT_NAME="bootstrap-$SLUG-$ENV_NAME"
  if [ "$ENV_NAME" != "e2e" ]; then
    BACKUP_ENV="backup-$ENV_NAME"
    BACKUP_IDENTITY="id-$SLUG-$ENV_NAME-backup"
    BACKUP_CREDENTIAL="github-$BACKUP_ENV"
  fi
  ok "slug $SLUG, dataLocation $DATA_LOCATION, $(printf '%s' "$EMAILS_JSON" | jq length) alert email(s)"
}

# ---------------------------------------------------------------------------------------------
# GitHub checks (read-only)

resolve_subject_prefix() {
  local body use_default immutable
  body=$(api_get "repos/$REPO/actions/oidc/customization/sub") ||
    die "cannot read the OIDC subject settings of $REPO"
  use_default=$(printf '%s' "$body" | jq -r '.use_default // false')
  [ "$use_default" = "true" ] ||
    die "$REPO uses a custom OIDC subject template. The federated credential expects GitHub's default subject <prefix>:environment:<env>; reset it with: gh api -X PUT repos/$REPO/actions/oidc/customization/sub -F use_default=true"
  SUBJECT_PREFIX=$(printf '%s' "$body" | jq -r '.sub_claim_prefix // ""')
  immutable=$(printf '%s' "$body" | jq -r '.use_immutable_subject // false')
  if [ -z "$SUBJECT_PREFIX" ]; then
    SUBJECT_PREFIX="repo:$REPO"
    warn "GitHub returned no sub_claim_prefix; using the legacy subject format repo:OWNER/NAME"
  fi
  matches "$SUBJECT_PREFIX" '^repo:[A-Za-z0-9_.-]+(@[0-9]+)?/[A-Za-z0-9_.-]+(@[0-9]+)?$' ||
    die "unexpected OIDC sub_claim_prefix format"
  if [ "$immutable" = "true" ]; then
    ok "OIDC subject: immutable prefix + :environment:$ENV_NAME"
  else
    ok "OIDC subject: prefix + :environment:$ENV_NAME"
  fi
}

resolve_instance_repo() {
  local url info
  if [ -z "$INSTANCE_REPO" ]; then
    url=$(git -C "$INSTANCE_DIR" remote get-url origin 2>/dev/null) ||
      die "cannot determine the instance repo: --instance has no git remote 'origin'; pass --instance-repo OWNER/NAME"
    INSTANCE_REPO=$(printf '%s' "$url" |
      sed -E -n 's#^(git@github\.com:|ssh://git@github\.com/|https://github\.com/)([^/]+/[^/]+)$#\2#p' |
      sed -E 's#\.git$##')
    [ -n "$INSTANCE_REPO" ] ||
      die "the origin remote of --instance is not a github.com repository; pass --instance-repo OWNER/NAME"
  fi
  matches "$INSTANCE_REPO" "$REPO_REGEX" || die "invalid instance repo name (expected OWNER/NAME)"
  [ "$(lower "$INSTANCE_REPO")" != "$(lower "$REPO")" ] ||
    die "the instance repo must be the private instance repo, not this public repository"
  info=$(api_get "repos/$INSTANCE_REPO") ||
    die "the instance repo was not found or is not accessible with your gh login"
  [ "$(printf '%s' "$info" | jq -r '.private // false')" = "true" ] ||
    die "the instance repo is not private; it holds personal content: make it private first"
  [ "$(printf '%s' "$info" | jq -r '.permissions.admin // false')" = "true" ] ||
    die "admin rights on the instance repo are required to manage its deploy keys"
  ok "instance repo: private, admin access"
}

github_preflight() {
  local repo_json env_json reviewers
  section "GitHub"
  if [ -z "$REPO" ]; then
    REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null) ||
      die "cannot determine the repository; pass --repo OWNER/NAME"
    matches "$REPO" "$REPO_REGEX" || die "cannot determine the repository; pass --repo OWNER/NAME"
  fi
  repo_json=$(api_get "repos/$REPO") || die "repository $REPO not found or not accessible"
  [ "$(printf '%s' "$repo_json" | jq -r '.permissions.admin // false')" = "true" ] ||
    die "admin rights on $REPO are required (environment variables and secrets)"

  env_json=$(api_get "repos/$REPO/environments/$ENV_NAME") ||
    die "GitHub Environment '$ENV_NAME' does not exist. Create the environments first with scripts/github/setup-repo.sh, then re-run."
  if [ "$ENV_NAME" = "production" ]; then
    reviewers=$(printf '%s' "$env_json" | jq '[.protection_rules // [] | .[]
      | select(.type == "required_reviewers") | .reviewers // [] | .[]] | length')
    [ "$reviewers" -gt 0 ] ||
      die "the production environment has no required reviewer. Run scripts/github/setup-repo.sh (it makes the owner the reviewer), then re-run."
    ok "environment $ENV_NAME exists, $reviewers required reviewer(s)"
  else
    ok "environment $ENV_NAME exists"
  fi
  resolve_subject_prefix
  if [ "$ENV_NAME" != "e2e" ]; then
    resolve_instance_repo
  fi
}

# ---------------------------------------------------------------------------------------------
# Azure

azure_preflight() {
  local sub_json state limit
  section "Azure"
  if [ -n "$SUBSCRIPTION" ]; then
    SUB_ID=$SUBSCRIPTION
  else
    SUB_ID=$(az account show --query id -o tsv --only-show-errors 2>"$TMP_DIR/stderr") ||
      die "not signed in to Azure: run az login"
  fi
  matches "$SUB_ID" "$GUID_REGEX" || die "cannot determine the subscription id; pass --subscription"
  TENANT_ID=$(az account show --subscription "$SUB_ID" --query tenantId -o tsv --only-show-errors 2>"$TMP_DIR/stderr") ||
    {
      show_stderr
      die "the subscription is not available to the signed-in account (az login, check --subscription)"
    }
  matches "$TENANT_ID" "$GUID_REGEX" || die "cannot determine the tenant id"

  sub_json=$(az rest --method get --url "/subscriptions/$SUB_ID?api-version=2022-12-01" -o json \
    --only-show-errors 2>"$TMP_DIR/stderr") ||
    {
      show_stderr
      die "cannot read the subscription"
    }
  state=$(printf '%s' "$sub_json" | jq -r '.state // ""')
  [ "$state" = "Enabled" ] ||
    die "the subscription is ${state:-in an unknown state}, not Enabled. A free trial that was not upgraded is disabled after 30 days: upgrade to pay-as-you-go (runbook)."
  limit=$(printf '%s' "$sub_json" | jq -r '.subscriptionPolicies.spendingLimit // ""')
  if [ "$limit" = "On" ]; then
    warn "the subscription has a spending limit (free trial or credit offer): upgrade to pay-as-you-go now, a trial is disabled after 30 days"
  fi

  OWNER_ID=$(az ad signed-in-user show --query id -o tsv --only-show-errors 2>"$TMP_DIR/stderr") ||
    die "cannot read the signed-in user: run az login as a user (not a service principal)"
  matches "$OWNER_ID" "$GUID_REGEX" || die "cannot determine the signed-in user's object id"
  ok "signed in as a user; subscription enabled"
}

provider_state() {
  az provider show --namespace "$1" --subscription "$SUB_ID" --query registrationState -o tsv \
    --only-show-errors 2>"$TMP_DIR/stderr" || {
    show_stderr
    die "cannot read the registration state of $1"
  }
}

register_providers() {
  local ns state pending="" still start
  section "Resource providers"
  for ns in $PROVIDERS; do
    state=$(provider_state "$ns")
    if [ "$state" = "Registered" ]; then
      ok "$ns registered"
      continue
    fi
    changed "register $ns (was ${state:-NotRegistered})"
    az provider register --namespace "$ns" --subscription "$SUB_ID" -o none --only-show-errors \
      2>"$TMP_DIR/stderr" || {
      show_stderr
      die "cannot register $ns"
    }
    pending="$pending $ns"
  done
  start=$SECONDS
  while [ -n "$pending" ]; do
    still=""
    for ns in $pending; do
      if [ "$(provider_state "$ns")" = "Registered" ]; then
        ok "$ns registered"
      else
        still="$still $ns"
      fi
    done
    pending=$still
    [ -n "$pending" ] || break
    if [ $((SECONDS - start)) -ge "$PROVIDER_TIMEOUT_SECONDS" ]; then
      die "still registering:$pending. Registration continues in the background; re-run this script in a few minutes."
    fi
    sleep "$POLL_SECONDS"
  done
}

check_resource_groups() {
  local rg location exists ops_exists=false
  section "Resource groups"
  for rg in "$APP_RG" "$OPS_RG"; do
    exists=$(az group exists --name "$rg" --subscription "$SUB_ID" --only-show-errors 2>"$TMP_DIR/stderr") ||
      {
        show_stderr
        die "cannot check resource group $rg"
      }
    if [ "$exists" = "true" ]; then
      location=$(az group show --name "$rg" --subscription "$SUB_ID" --query location -o tsv \
        --only-show-errors 2>"$TMP_DIR/stderr") || {
        show_stderr
        die "cannot read resource group $rg"
      }
      [ "$(lower "$location")" = "$DATA_LOCATION" ] ||
        die "$rg exists in $location, but instance.json has dataLocation $DATA_LOCATION. Resource groups cannot move: restore dataLocation (see the runbook, Troubleshooting)."
      ok "$rg exists in $DATA_LOCATION"
      if [ "$rg" = "$OPS_RG" ]; then ops_exists=true; fi
    else
      changed "create $rg in $DATA_LOCATION"
    fi
  done
  # The location of an action group cannot change: keep the existing one on re-runs. An empty
  # value lets the template choose (dataLocation with regional processing, else global).
  ACTION_GROUP_LOCATION=""
  if [ "$ops_exists" = true ]; then
    ACTION_GROUP_LOCATION=$(az monitor action-group show --name "$ACTION_GROUP" --resource-group "$OPS_RG" \
      --subscription "$SUB_ID" --query location -o tsv --only-show-errors 2>/dev/null) || ACTION_GROUP_LOCATION=""
  fi
  if [ -z "$ACTION_GROUP_LOCATION" ]; then
    ACTION_GROUP_LOCATION=$REQUESTED_ACTION_GROUP_LOCATION
  elif [ -n "$REQUESTED_ACTION_GROUP_LOCATION" ] &&
    [ "$(lower "$ACTION_GROUP_LOCATION")" != "$REQUESTED_ACTION_GROUP_LOCATION" ]; then
    warn "$ACTION_GROUP exists in $ACTION_GROUP_LOCATION; its location cannot change, so --action-group-location is ignored"
  fi
}

write_parameters() {
  local file=$1
  (
    umask 077
    jq -n \
      --arg slug "$SLUG" --arg env "$ENV_NAME" --arg location "$DATA_LOCATION" \
      --arg agLocation "$ACTION_GROUP_LOCATION" --arg prefix "$SUBJECT_PREFIX" \
      --arg owner "$OWNER_ID" --argjson emails "$EMAILS_JSON" '{
        "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
        contentVersion: "1.0.0.0",
        parameters: {
          deploymentSlug: {value: $slug},
          environmentName: {value: $env},
          dataLocation: {value: $location},
          actionGroupLocation: {value: $agLocation},
          githubSubjectPrefix: {value: $prefix},
          alertReceivers: {value: {emails: $emails}},
          ownerPrincipalId: {value: $owner},
          ownerPrincipalType: {value: "User"}
        }
      }' >"$file"
  )
}

deploy_core() {
  local params="$TMP_DIR/bootstrap.parameters.json" attempt=1
  section "Bootstrap deployment"
  write_parameters "$params"
  while :; do
    if az deployment sub create --name "$DEPLOYMENT_NAME" --location "$DATA_LOCATION" \
      --subscription "$SUB_ID" --template-file "$TEMPLATE" --parameters "@$params" \
      -o none --only-show-errors 2>"$TMP_DIR/stderr"; then
      break
    fi
    # A new identity or custom role can take a while to replicate; role assignments then fail
    # with PrincipalNotFound or RoleDefinitionDoesNotExist. Retrying the (idempotent) deployment
    # is the documented remedy.
    if [ "$attempt" -lt "$DEPLOY_ATTEMPTS" ] &&
      grep -Eqi 'PrincipalNotFound|does not exist in the directory|RoleDefinitionDoesNotExist' "$TMP_DIR/stderr"; then
      warn "attempt $attempt: the new identity has not replicated yet; retrying in ${RETRY_SECONDS}s"
      attempt=$((attempt + 1))
      sleep "$RETRY_SECONDS"
      continue
    fi
    rm -f "$params"
    show_stderr
    die "deployment $DEPLOYMENT_NAME failed; see docs/runbooks/azure-onboarding.md, Troubleshooting"
  done
  rm -f "$params"
  applied "deployment $DEPLOYMENT_NAME: $APP_RG (delete lock), $OPS_RG, $IDENTITY with federated credential $CREDENTIAL, $ACTION_GROUP, RBAC"
  if [ -n "$BACKUP_ENV" ]; then
    applied "backup identity $BACKUP_IDENTITY with federated credential $BACKUP_CREDENTIAL (read tables, write new backups, read back current backups; no delete)"
  fi
}

read_outputs() {
  local outputs rg
  outputs=$(az deployment sub show --name "$DEPLOYMENT_NAME" --subscription "$SUB_ID" \
    --query properties.outputs -o json --only-show-errors 2>"$TMP_DIR/stderr") || {
    show_stderr
    die "cannot read the outputs of deployment $DEPLOYMENT_NAME"
  }
  CLIENT_ID=$(printf '%s' "$outputs" | jq -r '.identityClientId.value // ""')
  rg=$(printf '%s' "$outputs" | jq -r '.appResourceGroupName.value // ""')
  matches "$CLIENT_ID" "$GUID_REGEX" || die "deployment output identityClientId is missing"
  [ "$rg" = "$APP_RG" ] || die "deployment output appResourceGroupName does not match $APP_RG"
  if [ -n "$BACKUP_ENV" ]; then
    BACKUP_CLIENT_ID=$(printf '%s' "$outputs" | jq -r '.backupIdentityClientId.value // ""')
    matches "$BACKUP_CLIENT_ID" "$GUID_REGEX" || die "deployment output backupIdentityClientId is missing"
  fi
}

# prune_federated_credentials IDENTITY CREDENTIAL GITHUB_ENV: only CREDENTIAL may exist on the
# identity; remove anything else (for example a pull_request or branch credential added by hand).
prune_federated_credentials() {
  local identity=$1 credential=$2 github_env=$3 names name
  names=$(az identity federated-credential list --identity-name "$identity" --resource-group "$OPS_RG" \
    --subscription "$SUB_ID" --query '[].name' -o tsv --only-show-errors 2>"$TMP_DIR/stderr") || {
    show_stderr
    die "cannot list the federated credentials of $identity"
  }
  for name in $names; do
    [ "$name" != "$credential" ] || continue
    changed "remove federated credential $name from $identity (only $credential may exist)"
    az identity federated-credential delete --name "$name" --identity-name "$identity" \
      --resource-group "$OPS_RG" --subscription "$SUB_ID" --yes -o none --only-show-errors \
      2>"$TMP_DIR/stderr" || {
      show_stderr
      die "cannot remove federated credential $name"
    }
  done
  ok "$identity trusts only the GitHub Environment $github_env ($credential)"
}

# ---------------------------------------------------------------------------------------------
# GitHub changes

# set_variable NAME VALUE: create or update one environment variable (values are never printed).
set_variable() {
  local name=$1 value=$2 line
  if line=$(awk -F '\t' -v n="$name" '$1 == n { print; found = 1 } END { exit !found }' \
    "$TMP_DIR/variables.tsv"); then
    if [ "${line#*"$TAB"}" = "$value" ]; then
      ok "$name"
      return
    fi
    changed "update $name"
    api_write PATCH "repos/$REPO/environments/$VAR_ENV/variables/$name" \
      "$(jq -n --arg n "$name" --arg v "$value" '{name: $n, value: $v}')"
  else
    changed "create $name"
    api_write POST "repos/$REPO/environments/$VAR_ENV/variables" \
      "$(jq -n --arg n "$name" --arg v "$value" '{name: $n, value: $v}')"
  fi
}

# configure_variables GITHUB_ENV CLIENT_ID: the Azure variables of one GitHub Environment (the
# deploy environment ENV, or backup-ENV with the backup identity).
configure_variables() {
  local allowed name
  VAR_ENV=$1
  section "GitHub Environment $VAR_ENV: variables"
  gh api --paginate "repos/$REPO/environments/$VAR_ENV/variables?per_page=30" \
    --jq '.variables[] | [.name, .value] | @tsv' >"$TMP_DIR/variables.tsv" 2>"$TMP_DIR/stderr" || {
    show_stderr
    die "cannot list the variables of environment $VAR_ENV"
  }
  set_variable AZURE_CLIENT_ID "$2"
  set_variable AZURE_TENANT_ID "$TENANT_ID"
  set_variable AZURE_SUBSCRIPTION_ID "$SUB_ID"
  set_variable AZURE_RESOURCE_GROUP "$APP_RG"
  allowed=" AZURE_CLIENT_ID AZURE_TENANT_ID AZURE_SUBSCRIPTION_ID AZURE_RESOURCE_GROUP "
  if [ "$VAR_ENV" = "$ENV_NAME" ]; then
    allowed="$allowed API_LOCKDOWN "
    if [ "$ENV_NAME" != "e2e" ]; then
      set_variable INSTANCE_REPO "$INSTANCE_REPO"
      allowed="$allowed INSTANCE_REPO "
    fi
  fi
  # Everything else comes from instance.json at deploy time; report leftovers, never delete them.
  while IFS=$TAB read -r name _; do
    [ -n "$name" ] || continue
    case "$allowed" in
      *" $name "*) ;;
      *) warn "unexpected variable $name in environment $VAR_ENV (left unchanged; see the runbook)" ;;
    esac
  done <"$TMP_DIR/variables.tsv"
}

# The GitHub Environment backup-ENV of the nightly backup: deployments from main only, no
# reviewer (a scheduled run cannot wait for an approval), no wait timer, no admin bypass.
configure_backup_environment() {
  local current problems policies has_main id name
  local body='{"wait_timer":0,"prevent_self_review":false,"reviewers":null,"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true},"can_admins_bypass":false}'
  section "GitHub Environment $BACKUP_ENV (nightly backup)"
  if current=$(api_get "repos/$REPO/environments/$BACKUP_ENV"); then
    problems=$(printf '%s' "$current" | jq -r '[
        (if .deployment_branch_policy != {protected_branches: false, custom_branch_policies: true}
         then "deployments not restricted to selected branches" else empty end),
        (if .can_admins_bypass != false then "admins can bypass protection rules" else empty end),
        (if [.protection_rules // [] | .[] | select(.type == "required_reviewers" or .type == "wait_timer")] | length > 0
         then "has a reviewer or wait timer, which a scheduled backup cannot pass" else empty end)
      ] | join("; ")')
    if [ -z "$problems" ]; then
      ok "environment $BACKUP_ENV: protection rules as desired"
    else
      changed "update environment $BACKUP_ENV ($problems)"
      api_write PUT "repos/$REPO/environments/$BACKUP_ENV" "$body"
    fi
  else
    changed "create environment $BACKUP_ENV (branch main only, no reviewer, no admin bypass)"
    api_write PUT "repos/$REPO/environments/$BACKUP_ENV" "$body"
  fi
  # A just-created environment has no branch policies yet.
  policies=$(api_get "repos/$REPO/environments/$BACKUP_ENV/deployment-branch-policies") ||
    policies='{"branch_policies":[]}'
  has_main=$(printf '%s' "$policies" |
    jq '[.branch_policies[]? | select(.name == "main" and (.type // "branch") == "branch")] | length')
  if [ "$has_main" = "0" ]; then
    changed "allow deployments to $BACKUP_ENV from branch main"
    api_write POST "repos/$REPO/environments/$BACKUP_ENV/deployment-branch-policies" \
      '{"name":"main","type":"branch"}'
  else
    ok "environment $BACKUP_ENV: deployments from branch main allowed"
  fi
  while read -r id name <&3; do
    [ -n "$id" ] || continue
    changed "remove deployment policy $name from $BACKUP_ENV (only main may use it)"
    api_write DELETE "repos/$REPO/environments/$BACKUP_ENV/deployment-branch-policies/$id"
  done 3< <(printf '%s' "$policies" | jq -r '.branch_policies[]?
    | select(.name != "main" or (.type // "branch") != "branch")
    | "\(.id) \(.type // "branch"):\(.name)"')
}

configure_deploy_key() {
  local title="deploy-$ENV_NAME" keys matching count writable reason="" secret_present=false
  local key_dir new_id id
  section "Instance repo deploy key"
  keys=$(gh api --paginate "repos/$INSTANCE_REPO/keys?per_page=100" \
    --jq '.[] | [.id, .title, .read_only] | @tsv' 2>"$TMP_DIR/stderr") || {
    show_stderr
    die "cannot list the deploy keys of the instance repo"
  }
  matching=$(printf '%s\n' "$keys" | awk -F '\t' -v t="$title" '$2 == t')
  count=$(printf '%s' "$matching" | grep -c . || true)
  writable=$(printf '%s' "$matching" | awk -F '\t' '$3 != "true"' | grep -c . || true)
  if api_get "repos/$REPO/environments/$ENV_NAME/secrets/$DEPLOY_KEY_SECRET" >/dev/null; then
    secret_present=true
  fi

  if [ "$ROTATE_DEPLOY_KEY" = true ]; then
    reason="rotation requested"
  elif [ "$count" -eq 0 ]; then
    reason="no deploy key $title on the instance repo yet"
  elif [ "$secret_present" = false ]; then
    reason="environment secret $DEPLOY_KEY_SECRET is missing"
  elif [ "$count" -gt 1 ]; then
    reason="$count deploy keys are titled $title"
  elif [ "$writable" -gt 0 ]; then
    reason="deploy key $title is not read-only"
  fi
  if [ -z "$reason" ]; then
    ok "read-only deploy key $title and secret $DEPLOY_KEY_SECRET exist; kept (replace with --rotate-deploy-key)"
    return
  fi

  key_dir="$TMP_DIR/deploy-key"
  (umask 077 && mkdir "$key_dir")
  ssh-keygen -q -t ed25519 -N '' -C "$title" -f "$key_dir/id_ed25519" >/dev/null 2>&1 ||
    die "ssh-keygen failed"
  new_id=$(jq -n --arg t "$title" --rawfile k "$key_dir/id_ed25519.pub" \
    '{title: $t, key: ($k | rtrimstr("\n")), read_only: true}' |
    gh api -X POST "repos/$INSTANCE_REPO/keys" --input - --jq .id 2>"$TMP_DIR/stderr") || {
    rm -rf "$key_dir"
    show_stderr
    die "cannot add the deploy key to the instance repo"
  }
  changed "add read-only deploy key $title to the instance repo ($reason)"
  if ! gh secret set "$DEPLOY_KEY_SECRET" --env "$ENV_NAME" --repo "$REPO" \
    <"$key_dir/id_ed25519" >/dev/null 2>"$TMP_DIR/stderr"; then
    rm -rf "$key_dir"
    show_stderr
    die "cannot store the environment secret $DEPLOY_KEY_SECRET; re-run to retry (the unused new key is replaced then)"
  fi
  rm -rf "$key_dir"
  changed "store its private key as environment secret $DEPLOY_KEY_SECRET (temporary key files deleted)"
  for id in $(printf '%s\n' "$matching" | awk -F '\t' '$1 != "" { print $1 }'); do
    [ "$id" != "$new_id" ] || continue
    changed "remove the previous deploy key $title from the instance repo"
    api_write DELETE "repos/$INSTANCE_REPO/keys/$id"
  done
}

summary() {
  section "Summary"
  printf '  Environment %s of deployment %s is bootstrapped (%d change(s)).\n' "$ENV_NAME" "$SLUG" "$CHANGES"
  printf '  Re-running this script is safe.\n'
  if [ -n "$BACKUP_ENV" ]; then
    printf '  Nightly backups run in the GitHub Environment %s (.github/workflows/backup.yml).\n' "$BACKUP_ENV"
  fi
  if [ "$WARNINGS" -gt 0 ]; then
    printf '  %d warning(s); see above.\n' "$WARNINGS"
  fi
  case "$ENV_NAME" in
    e2e) printf '  Next: scripts/bootstrap.sh --env test --instance <instance checkout>\n' ;;
    test) printf '  Next: scripts/bootstrap.sh --env production --instance <instance checkout>\n' ;;
    production) printf '  Next: scripts/bootstrap-cost.sh --instance <instance checkout> (budget and anomaly alert)\n' ;;
  esac
}

main() {
  parse_args "$@"
  preflight
  TMP_DIR=$(mktemp -d)
  trap cleanup EXIT
  trap 'exit 130' INT TERM

  printf 'Bootstrapping environment %s\n' "$ENV_NAME"
  read_instance
  github_preflight
  azure_preflight
  check_resource_groups
  register_providers
  deploy_core
  read_outputs
  prune_federated_credentials "$IDENTITY" "$CREDENTIAL" "$ENV_NAME"
  if [ -n "$BACKUP_ENV" ]; then
    prune_federated_credentials "$BACKUP_IDENTITY" "$BACKUP_CREDENTIAL" "$BACKUP_ENV"
  fi
  configure_variables "$ENV_NAME" "$CLIENT_ID"
  if [ "$ENV_NAME" != "e2e" ]; then
    configure_deploy_key
    configure_backup_environment
    configure_variables "$BACKUP_ENV" "$BACKUP_CLIENT_ID"
  fi
  summary
}

main "$@"
