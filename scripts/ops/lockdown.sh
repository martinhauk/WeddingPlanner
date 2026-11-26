#!/usr/bin/env bash
# lockdown.sh: switch the emergency API lockdown of ONE environment on or off.
#
# Run by the owner with an authenticated `gh` (admin of this repository). Never run by CI.
# The lockdown is the GitHub Environment variable API_LOCKDOWN: `on` sets it to "true", `off`
# deletes it (unset means off). The deploy bakes it into staticwebapp.config.json, which then
# requires the role admin for every /api/* request, so the edge rejects anonymous API calls before
# any function runs. It takes effect with the next deploy, so the script starts deploy.yml for that
# environment right away; production still waits for your approval. Idempotent: re-running it
# changes nothing and only redeploys. It prints names only, never hostnames or tokens.
#
# Usage: scripts/ops/lockdown.sh on|off --env e2e|test|production [options]
#        scripts/ops/lockdown.sh status [--repo OWNER/NAME]
#
#   on | off             switch the lockdown of --env on or off and redeploy it
#   status               show the lockdown state of every environment; changes nothing
#   --env ENV            e2e, test or production (required for on and off)
#   --repo OWNER/NAME    this repository (default: the current directory's GitHub repo)
#   --ref REF            commit SHA, branch or tag of this repository to redeploy (default: the head
#                        of main). Pass the deployed commit when main has changes you have not
#                        released yet; production accepts only commits on main.
#   --instance-ref REF   test and production: instance repo commit or branch (default: its main)
#   --no-deploy          only set or clear the variable; the next deploy applies it
#   --dry-run            only report what would change; change nothing, start nothing
#   -h, --help           show this help
#
# Exit status: 0 done (or nothing to change), 1 error, 2 usage error.
#
# Requires: gh, jq. Compatible with the bash 3.2 that ships with macOS.
# Runbook: docs/runbooks/incident.md
set -euo pipefail

ENVIRONMENTS="e2e test production"
VARIABLE="API_LOCKDOWN"
WORKFLOW="deploy.yml"
DEPLOY_BRANCH="main"
REPO_REGEX='^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
# The same formats deploy.yml accepts for its `ref` and `instance-ref` inputs.
REF_REGEX='^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$'
INSTANCE_REF_REGEX='^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$'

ACTION=""
ENV_NAME=""
REPO=""
REF=""
INSTANCE_REF=""
DEPLOY=true
DRY_RUN=false
TMP_DIR=""
# Set by read_variable and read_repo_variable.
EXISTS=false
CURRENT=""
REPO_EXISTS=false
REPO_STATE=off

usage() {
  sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//'
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

usage_error() {
  printf 'error: %s (see --help)\n' "$*" >&2
  exit 2
}

section() { printf '\n%s\n' "$*"; }
ok() { printf '  ok       %s\n' "$*"; }
note() { printf '  note     %s\n' "$*"; }
warn() { printf '  warning  %s\n' "$*" >&2; }
changed() {
  if [ "$DRY_RUN" = true ]; then
    printf '  would    %s\n' "$*"
  else
    printf '  change   %s\n' "$*"
  fi
}

cleanup() {
  if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi
}

show_stderr() {
  if [ -s "$TMP_DIR/stderr" ]; then sed 's/^/           /' "$TMP_DIR/stderr" >&2; fi
}

# api_write METHOD PATH [JSON]: send a change (skipped in dry-run mode). Dies on error.
api_write() {
  local method=$1 path=$2 body=${3:-}
  if [ "$DRY_RUN" = true ]; then
    return 0
  fi
  if [ -n "$body" ]; then
    printf '%s' "$body" | gh api -X "$method" "$path" --input - >/dev/null 2>"$TMP_DIR/stderr" ||
      {
        show_stderr
        die "$method $path failed"
      }
  else
    gh api -X "$method" "$path" >/dev/null 2>"$TMP_DIR/stderr" || {
      show_stderr
      die "$method $path failed"
    }
  fi
}

is_environment() {
  case " $ENVIRONMENTS " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

parse_args() {
  [ $# -gt 0 ] || usage_error "missing action: on, off or status"
  case "$1" in
    on | off | status) ACTION=$1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) usage_error "unknown action: $1 (expected on, off or status)" ;;
  esac
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --env | --repo | --ref | --instance-ref)
        [ $# -ge 2 ] || usage_error "$1 needs a value"
        case "$1" in
          --env) ENV_NAME=$2 ;;
          --repo) REPO=$2 ;;
          --ref) REF=$2 ;;
          --instance-ref) INSTANCE_REF=$2 ;;
        esac
        shift 2
        ;;
      --no-deploy)
        DEPLOY=false
        shift
        ;;
      --dry-run)
        DRY_RUN=true
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) usage_error "unknown argument: $1" ;;
    esac
  done

  if [ "$ACTION" = status ]; then
    [ -z "$ENV_NAME$REF$INSTANCE_REF" ] && [ "$DEPLOY" = true ] ||
      usage_error "status takes --repo only"
    return
  fi
  [ -n "$ENV_NAME" ] || usage_error "--env is required (e2e, test or production)"
  is_environment "$ENV_NAME" || usage_error "unknown environment: $ENV_NAME (expected e2e, test or production)"
  if [ -n "$REF" ] && ! [[ $REF =~ $REF_REGEX ]]; then
    usage_error "--ref must be a commit SHA, a branch or a tag of this repository"
  fi
  if [ -n "$INSTANCE_REF" ]; then
    [ "$ENV_NAME" != e2e ] || usage_error "--instance-ref applies to test and production only"
    [[ $INSTANCE_REF =~ $INSTANCE_REF_REGEX ]] ||
      usage_error "--instance-ref must be a commit SHA or a branch of the instance repo"
  fi
  if [ "$DEPLOY" = false ] && [ -n "$REF$INSTANCE_REF" ]; then
    usage_error "--ref and --instance-ref need a deploy; drop --no-deploy"
  fi
}

preflight() {
  if [ "${GITHUB_ACTIONS:-}" = "true" ] || [ "${CI:-}" = "true" ]; then
    die "this script is run by the repository owner, never by CI"
  fi
  command -v gh >/dev/null 2>&1 || die "GitHub CLI (gh) not found"
  command -v jq >/dev/null 2>&1 || die "jq not found"
  TMP_DIR=$(mktemp -d)
  trap cleanup EXIT
  if [ -z "$REPO" ]; then
    REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null) ||
      die "cannot determine the repository; pass --repo OWNER/NAME"
  fi
  [[ $REPO =~ $REPO_REGEX ]] || die "invalid repository name: $REPO (expected OWNER/NAME)"
}

# require_environment ENV: dies unless the GitHub Environment exists.
require_environment() {
  if gh api "repos/$REPO/environments/$1" >/dev/null 2>"$TMP_DIR/stderr"; then
    return 0
  fi
  if grep -q 'HTTP 404' "$TMP_DIR/stderr"; then
    die "the GitHub Environment $1 does not exist; run scripts/github/setup-repo.sh first"
  fi
  show_stderr
  die "cannot read the GitHub Environment $1"
}

# read_variable PATH: sets EXISTS and CURRENT from the variable at PATH (404 = not set).
read_variable() {
  local out
  if out=$(gh api "$1" --jq .value 2>"$TMP_DIR/stderr"); then
    EXISTS=true
    CURRENT=$out
    return 0
  fi
  if grep -q 'HTTP 404' "$TMP_DIR/stderr"; then
    EXISTS=false
    CURRENT=""
    return 0
  fi
  show_stderr
  die "cannot read $1"
}

# lockdown_state VALUE: on, off or invalid, as the web build parses API_LOCKDOWN.
lockdown_state() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    "" | false | 0) echo off ;;
    true | 1) echo on ;;
    *) echo invalid ;;
  esac
}

# The repository-level variable applies to every environment without its own value.
read_repo_variable() {
  read_variable "repos/$REPO/actions/variables/$VARIABLE"
  REPO_EXISTS=$EXISTS
  REPO_STATE=$(lockdown_state "$CURRENT")
}

status() {
  local env state
  section "Lockdown state of $REPO ($VARIABLE)"
  read_repo_variable
  if [ "$REPO_EXISTS" = true ]; then
    warn "repository variable $VARIABLE is set ($REPO_STATE); it applies to every environment without its own value"
  fi
  for env in $ENVIRONMENTS; do
    if ! gh api "repos/$REPO/environments/$env" >/dev/null 2>"$TMP_DIR/stderr"; then
      if grep -q 'HTTP 404' "$TMP_DIR/stderr"; then
        printf '  %-11s no GitHub Environment\n' "$env"
        continue
      fi
      show_stderr
      die "cannot read the GitHub Environment $env"
    fi
    read_variable "repos/$REPO/environments/$env/variables/$VARIABLE"
    if [ "$EXISTS" = true ]; then
      state=$(lockdown_state "$CURRENT")
    elif [ "$REPO_EXISTS" = true ]; then
      state="$REPO_STATE (repository variable)"
    else
      state="off (not set)"
    fi
    case "$state" in
      invalid*) state="invalid value: the next deploy fails; run lockdown.sh on|off --env $env" ;;
    esac
    printf '  %-11s %s\n' "$env" "$state"
  done
  printf '\nThe state applies from the last deploy after it was set; the deploy summary shows the commit.\n'
}

# check_workflow: dies unless deploy.yml exists and is enabled.
check_workflow() {
  local state
  if ! state=$(gh api "repos/$REPO/actions/workflows/$WORKFLOW" --jq .state 2>"$TMP_DIR/stderr"); then
    show_stderr
    die "cannot read the workflow $WORKFLOW"
  fi
  [ "$state" = active ] || die "the workflow $WORKFLOW is $state; enable it in GitHub Actions first"
  ok "workflow $WORKFLOW is active"
}

switch_variable() {
  local path="repos/$REPO/environments/$ENV_NAME/variables" body
  section "GitHub Environment $ENV_NAME: $VARIABLE"
  read_variable "$path/$VARIABLE"
  body=$(jq -n --arg n "$VARIABLE" '{name: $n, value: "true"}')
  if [ "$ACTION" = on ]; then
    if [ "$EXISTS" = true ] && [ "$CURRENT" = true ]; then
      ok "$VARIABLE is already true"
    elif [ "$EXISTS" = true ]; then
      changed "set $VARIABLE to true (was $(lockdown_state "$CURRENT"))"
      api_write PATCH "$path/$VARIABLE" "$body"
    else
      changed "create $VARIABLE = true"
      api_write POST "$path" "$body"
    fi
    return
  fi

  # off: an environment value of "false" is needed only to override a repository-level lockdown.
  if [ "$REPO_EXISTS" = true ] && [ "$REPO_STATE" != off ]; then
    warn "repository variable $VARIABLE is $REPO_STATE; $ENV_NAME keeps its own value false to override it"
    body=$(jq -n --arg n "$VARIABLE" '{name: $n, value: "false"}')
    if [ "$EXISTS" = true ] && [ "$CURRENT" = false ]; then
      ok "$VARIABLE is already false"
    elif [ "$EXISTS" = true ]; then
      changed "set $VARIABLE to false"
      api_write PATCH "$path/$VARIABLE" "$body"
    else
      changed "create $VARIABLE = false"
      api_write POST "$path" "$body"
    fi
  elif [ "$EXISTS" = true ]; then
    changed "delete $VARIABLE (was $(lockdown_state "$CURRENT"))"
    api_write DELETE "$path/$VARIABLE"
  else
    ok "$VARIABLE is not set (lockdown off)"
  fi
}

trigger_deploy() {
  local body
  section "Deploy $ENV_NAME"
  if [ "$DEPLOY" = false ]; then
    note "--no-deploy: the change takes effect with the next deploy of $ENV_NAME"
    return
  fi
  body=$(jq -n --arg branch "$DEPLOY_BRANCH" --arg env "$ENV_NAME" --arg ref "$REF" \
    --arg iref "$INSTANCE_REF" '{
      ref: $branch,
      inputs: ({environment: $env}
        + (if $ref == "" then {} else {ref: $ref} end)
        + (if $iref == "" then {} else {"instance-ref": $iref} end))
    }')
  changed "start $WORKFLOW for $ENV_NAME (commit: ${REF:-head of $DEPLOY_BRANCH})"
  api_write POST "repos/$REPO/actions/workflows/$WORKFLOW/dispatches" "$body"
  if [ "$ENV_NAME" = production ] && [ -z "$REF" ]; then
    note "production deploys the head of $DEPLOY_BRANCH; if it holds changes you have not released yet, re-run with --ref <deployed commit>"
  fi
}

summary() {
  local verb=$ACTION
  printf '\n'
  if [ "$DRY_RUN" = true ]; then
    printf 'Dry run: nothing was changed and no deploy was started.\n'
    return
  fi
  if [ "$DEPLOY" = false ]; then
    printf 'Lockdown %s for %s once %s is deployed next.\n' "$verb" "$ENV_NAME" "$ENV_NAME"
    return
  fi
  printf 'Lockdown %s for %s in about 5 minutes, when the deploy finishes.\n' "$verb" "$ENV_NAME"
  if [ "$ENV_NAME" = production ]; then
    printf 'production waits for your approval: GitHub, Actions, the new deploy run, Review deployments.\n'
  fi
  printf 'Follow the run: gh run list --workflow %s --repo %s --limit 3\n' "$WORKFLOW" "$REPO"
  printf 'Check afterwards: scripts/ops/lockdown.sh status (and see docs/runbooks/incident.md).\n'
}

main() {
  parse_args "$@"
  preflight
  if [ "$ACTION" = status ]; then
    status
    return
  fi
  section "Checks"
  require_environment "$ENV_NAME"
  ok "GitHub Environment $ENV_NAME exists"
  if [ "$DEPLOY" = true ]; then check_workflow; fi
  read_repo_variable
  switch_variable
  trigger_deploy
  summary
}

main "$@"
