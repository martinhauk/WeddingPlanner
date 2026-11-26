#!/usr/bin/env bash
# uptime.sh: read-only uptime check and cold-start probe of the deployed environments, and the
# incident issue of the scheduled uptime workflow (.github/workflows/uptime.yml).
#
# Usage: scripts/ops/uptime.sh check [--env ENV]...
#        scripts/ops/uptime.sh cold-start [--env ENV]
#        scripts/ops/uptime.sh incident --down "ENV ..." [--repo OWNER/NAME] [--run TEXT]
#
# check       For every environment (default: e2e, test and production; --env picks some) that has
#             a host in UPTIME_HOST_<ENV>: GET / must answer 200; GET /version.json 200 with a commit
#             SHA and the expected instance kind (isSample: true on e2e, false on test and
#             production); GET /api/health 200, retried for a cold start. A health answer of 401 or
#             403, or a redirect to the login, is the edge lockdown: reported as "locked", not down.
#             An environment without a host is skipped (not bootstrapped or not configured yet).
# cold-start  One environment (default e2e): GET /api/health, then GET /api/rsvp/status, then GET
#             /api/health again, and reports status codes and durations. After an idle period the
#             first request pays the cold start of the managed functions.
# incident    Keeps ONE open issue labelled `incident`, marked as the uptime check's, in step with
#             the environments in --down: opens it, retitles it and comments when the set changes,
#             comments and closes it when --down is empty. Issue texts name environments only.
#
# Environment:
#   UPTIME_HOST_E2E, UPTIME_HOST_TEST, UPTIME_HOST_PRODUCTION
#                         hostname (or https:// origin) of each environment; never printed
#   UPTIME_TIMEOUT        seconds per request (default: check 30, cold-start 120)
#   UPTIME_RETRY_SECONDS  wait between /api/health attempts of check (default 15)
#   GITHUB_OUTPUT         check writes `checked`, `down` and `completed=true`; cold-start writes
#                         the durations in seconds
#   GITHUB_STEP_SUMMARY   check and cold-start append a table
#   GH_TOKEN              incident: a token that may write issues (in Actions: github.token)
#
# Output: environment names, status codes, durations and short commit SHAs only. Never hostnames,
# URLs or response bodies. Read-only towards the sites: GET requests only, no redirects followed.
#
# Exit status: check: 0 nothing down, 1 an environment is down. cold-start and incident: 0 done,
# 1 error. All: 2 usage error, invalid host or missing tool.
#
# Requires: curl, jq; incident also gh. Compatible with the bash 3.2 that ships with macOS.
set -euo pipefail

ENVIRONMENTS="e2e test production"
HEALTH_ATTEMPTS=3
LABEL="incident"
LABEL_COLOR="b60205"
MARKER="<!-- uptime-check -->"
HOST_REGEX='^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$'
REPO_REGEX='^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
RETRY_SECONDS=${UPTIME_RETRY_SECONDS:-15}

TMP_DIR=""
TIMEOUT=""
# Set by http.
CODE=""
TIME=""
REDIRECT=""

usage() {
  sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//'
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

usage_error() {
  printf 'error: %s\n' "$*" >&2
  exit 2
}

cleanup() {
  if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi
}

require() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || usage_error "$tool not found"
  done
}

is_environment() {
  case " $ENVIRONMENTS " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# in_order LIST: the environments of LIST in the order e2e, test, production, without duplicates.
in_order() {
  local env out=""
  for env in $ENVIRONMENTS; do
    case " $1 " in
      *" $env "*) out="$out $env" ;;
    esac
  done
  printf '%s' "${out# }"
}

# host_of ENV: the normalized host of ENV from UPTIME_HOST_<ENV> (empty when unset). Exits 2 on
# an invalid value, naming the variable but never the value.
host_of() {
  local var value
  var=$(host_var "$1")
  # A secret set from a pipe may end with a newline.
  value=$(printf '%s' "${!var:-}" | tr -d '[:space:]')
  value=${value#https://}
  value=${value%/}
  if [ -n "$value" ] && ! [[ $value =~ $HOST_REGEX ]]; then
    usage_error "$var is not a hostname or https:// origin"
  fi
  printf '%s' "$value"
}

host_var() {
  printf 'UPTIME_HOST_%s' "$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
}

# mask HOST: hide HOST in the GitHub Actions log. Secrets are masked already; this also covers a
# host from any other source.
mask() {
  if [ -n "$1" ] && [ "${GITHUB_ACTIONS:-}" = true ]; then printf '::add-mask::%s\n' "$1"; fi
}

# http HOST PATH [BODY_FILE]: one GET to https://HOST/PATH without following redirects. Sets CODE
# (000 when no answer), TIME (seconds) and REDIRECT. Prints nothing.
http() {
  local host=$1 path=$2 out=${3:-/dev/null} result=""
  result=$(curl -s -o "$out" --proto '=https' --max-time "$TIMEOUT" \
    -w '%{http_code} %{time_total} %{redirect_url}' "https://$host$path" 2>/dev/null) || true
  CODE=""
  TIME=""
  REDIRECT=""
  read -r CODE TIME REDIRECT <<<"$result" || true
  [[ $CODE =~ ^[0-9]{3}$ ]] || CODE=000
  [[ $TIME =~ ^[0-9]+([.][0-9]+)?$ ]] || TIME=""
}

# is_lockdown: the last answer is the edge lockdown (401/403, or the 401 redirect to the login).
is_lockdown() {
  case "$CODE" in
    401 | 403) return 0 ;;
    301 | 302 | 303 | 307 | 308)
      case "$REDIRECT" in
        *"/.auth/login/"*) return 0 ;;
      esac
      ;;
  esac
  return 1
}

seconds() {
  if [ -z "$1" ]; then
    printf '%s' '-'
  else
    awk -v t="$1" 'BEGIN { printf "%.2f", t }'
  fi
}

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$@" >>"$GITHUB_STEP_SUMMARY"; fi
}

output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then printf '%s\n' "$@" >>"$GITHUB_OUTPUT"; fi
}

# parse_envs DEFAULT ARGS...: sets ENVS from repeated --env options (default DEFAULT).
parse_envs() {
  local default=$1
  ENVS=""
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --env)
        [ $# -ge 2 ] || usage_error "--env needs a value"
        is_environment "$2" || usage_error "unknown environment: $2 (expected e2e, test or production)"
        ENVS="$ENVS $2"
        shift 2
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) usage_error "unknown argument: $1 (see --help)" ;;
    esac
  done
  ENVS=$(in_order "${ENVS:-$default}")
}

# check_one ENV HOST: checks one environment; sets STATE (up, locked or down) and DETAIL.
check_one() {
  local env=$1 host=$2 problems="" version="$TMP_DIR/version.json" expected=false sha
  local home_code version_code version_note="" attempt=1

  http "$host" /
  home_code=$CODE
  [ "$home_code" = 200 ] || problems="$problems home"

  rm -f "$version"
  http "$host" /version.json "$version"
  version_code=$CODE
  if [ "$env" = e2e ]; then expected=true; fi
  if [ "$version_code" != 200 ]; then
    problems="$problems version"
  elif ! sha=$(jq -er '.sha | select(type == "string" and test("^[0-9a-f]{40}$"))' "$version" 2>/dev/null); then
    problems="$problems version"
    version_note="no commit SHA"
  elif ! jq -e --argjson s "$expected" '.isSample == $s' "$version" >/dev/null 2>&1; then
    problems="$problems version"
    version_note="${sha:0:7}, isSample is not $expected"
  else
    version_note=${sha:0:7}
  fi

  while :; do
    http "$host" /api/health
    if [ "$CODE" = 200 ] || is_lockdown || [ "$attempt" -ge "$HEALTH_ATTEMPTS" ]; then break; fi
    attempt=$((attempt + 1))
    sleep "$RETRY_SECONDS"
  done

  DETAIL="home $home_code, version.json $version_code${version_note:+ ($version_note)}, /api/health $CODE"
  if [ "$attempt" -gt 1 ]; then DETAIL="$DETAIL (attempt $attempt)"; fi
  if [ "$CODE" = 200 ]; then
    STATE=up
  elif is_lockdown; then
    STATE=locked
    DETAIL="$DETAIL, API locked down"
  else
    problems="$problems api"
  fi
  if [ -n "$problems" ]; then STATE=down; fi
}

cmd_check() {
  local env host entry hosts="" checked="" down="" rows=""
  parse_envs "$ENVIRONMENTS" "$@"
  require curl jq awk
  TIMEOUT=${UPTIME_TIMEOUT:-30}
  [[ $TIMEOUT =~ ^[1-9][0-9]*$ ]] || usage_error "UPTIME_TIMEOUT must be a whole number of seconds"
  TMP_DIR=$(mktemp -d)
  trap cleanup EXIT

  # Validate (and mask) every host before the first request.
  for env in $ENVS; do
    host=$(host_of "$env")
    mask "$host"
    hosts="$hosts $env=$host"
  done

  for env in $ENVS; do
    host=""
    for entry in $hosts; do
      if [ "${entry%%=*}" = "$env" ]; then host=${entry#*=}; fi
    done
    if [ -z "$host" ]; then
      STATE=skipped
      DETAIL="no $(host_var "$env") (not bootstrapped or not configured)"
    else
      check_one "$env" "$host"
      if [ "$STATE" = down ]; then
        # Confirm before alerting: one blip must not open an incident.
        sleep "$RETRY_SECONDS"
        check_one "$env" "$host"
      fi
      checked="$checked $env"
      if [ "$STATE" = down ]; then down="$down $env"; fi
    fi
    printf '%-11s %-8s %s\n' "$env" "$STATE" "$DETAIL"
    rows="$rows| $env | $STATE | $DETAIL |"$'\n'
  done

  checked=${checked# }
  down=${down# }
  summary "### Uptime check" "" "| Environment | Result | Details |" "| --- | --- | --- |"
  summary "${rows%$'\n'}"
  output "checked=$checked" "down=$down" "completed=true"
  if [ -z "$checked" ]; then
    printf 'No environment has an UPTIME_HOST_* value: nothing was checked.\n'
  fi
  if [ -n "$down" ]; then
    printf 'Down: %s\n' "$down"
    return 1
  fi
}

cmd_cold_start() {
  local env host at health_code health_time status_code status_time warm_code warm_time
  parse_envs e2e "$@"
  case "$ENVS" in
    *" "*) usage_error "cold-start probes one environment" ;;
  esac
  env=$ENVS
  require curl awk
  TIMEOUT=${UPTIME_TIMEOUT:-120}
  [[ $TIMEOUT =~ ^[1-9][0-9]*$ ]] || usage_error "UPTIME_TIMEOUT must be a whole number of seconds"
  host=$(host_of "$env")
  mask "$host"
  if [ -z "$host" ]; then
    printf '%s: skipped, no %s (not bootstrapped or not configured)\n' "$env" "$(host_var "$env")"
    summary "### Cold-start probe ($env)" "" "Skipped: no host configured."
    return 0
  fi

  at=$(date -u '+%Y-%m-%d %H:%M UTC')
  http "$host" /api/health
  health_code=$CODE
  health_time=$(seconds "$TIME")
  http "$host" /api/rsvp/status
  status_code=$CODE
  status_time=$(seconds "$TIME")
  http "$host" /api/health
  warm_code=$CODE
  warm_time=$(seconds "$TIME")

  printf '%s cold-start probe at %s\n' "$env" "$at"
  printf '  first /api/health  %s  %s s\n' "$health_code" "$health_time"
  printf '  /api/rsvp/status   %s  %s s\n' "$status_code" "$status_time"
  printf '  warm /api/health   %s  %s s\n' "$warm_code" "$warm_time"
  summary "### Cold-start probe ($env)" "" \
    "Measured at $at. The first request after an idle period pays the cold start." "" \
    "| Request | Status | Seconds |" "| --- | --- | --- |" \
    "| first \`/api/health\` | $health_code | $health_time |" \
    "| \`/api/rsvp/status\` | $status_code | $status_time |" \
    "| warm \`/api/health\` | $warm_code | $warm_time |"
  output "first-health-seconds=$health_time" "rsvp-status-seconds=$status_time" "warm-health-seconds=$warm_time"
  if [ "$health_code" != 200 ]; then
    if [ "${GITHUB_ACTIONS:-}" = true ]; then
      printf '::warning::the first /api/health on %s answered %s\n' "$env" "$health_code"
    else
      printf 'warning: the first /api/health answered %s\n' "$health_code" >&2
    fi
  fi
}

# gh_try ARGS...: run gh with stderr in $TMP_DIR/stderr.
gh_try() {
  gh "$@" 2>"$TMP_DIR/stderr"
}

gh_fail() {
  sed 's/^/  /' "$TMP_DIR/stderr" >&2
  die "$1"
}

# issue_write METHOD PATH JSON [JQ]: send a change to the issues API, optionally printing a field.
issue_write() {
  printf '%s' "$3" | gh_try api -X "$1" "$2" --input - --jq "${4:-.id}" || gh_fail "$1 $2 failed"
}

ensure_label() {
  if gh_try api "repos/$REPO/labels/$LABEL" >/dev/null; then
    return 0
  fi
  grep -q 'HTTP 404' "$TMP_DIR/stderr" || gh_fail "cannot read the label $LABEL"
  issue_write POST "repos/$REPO/labels" "$(jq -n --arg n "$LABEL" --arg c "$LABEL_COLOR" \
    '{name: $n, color: $c, description: "Something is down or under attack (docs/runbooks/incident.md)"}')" \
    .name >/dev/null
  printf 'created label %s\n' "$LABEL"
}

cmd_incident() {
  local down="" run="" open number title want body list env
  REPO=${GITHUB_REPOSITORY:-}
  if [ -n "${GITHUB_RUN_NUMBER:-}" ]; then run="uptime workflow run #$GITHUB_RUN_NUMBER"; fi
  while [ $# -gt 0 ]; do
    case "$1" in
      --down | --repo | --run)
        [ $# -ge 2 ] || usage_error "$1 needs a value"
        case "$1" in
          --down) down=$2 ;;
          --repo) REPO=$2 ;;
          --run) run=$2 ;;
        esac
        shift 2
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) usage_error "unknown argument: $1 (see --help)" ;;
    esac
  done
  for env in $down; do
    is_environment "$env" || usage_error "unknown environment in --down: $env"
  done
  down=$(in_order "$down")
  [ -n "$REPO" ] || usage_error "--repo is required outside GitHub Actions"
  [[ $REPO =~ $REPO_REGEX ]] || usage_error "invalid repository name (expected OWNER/NAME)"
  require gh jq
  TMP_DIR=$(mktemp -d)
  trap cleanup EXIT

  open=$(gh_try api "repos/$REPO/issues?labels=$LABEL&state=open&per_page=100" --jq \
    "[.[] | select(.pull_request == null) | select((.body // \"\") | contains(\"$MARKER\"))]
     | sort_by(.number) | first // empty | \"\\(.number)\\t\\(.title)\"") ||
    gh_fail "cannot list the open $LABEL issues"
  number=${open%%$'\t'*}
  title=${open#*$'\t'}
  list=$(printf '%s' "$down" | sed 's/ /, /g')
  want="Uptime check failing: $list"

  if [ -n "$down" ]; then
    if [ -z "$open" ]; then
      ensure_label
      body=$(printf '%s\n\n%s\n\n%s\n\n%s\n' "$MARKER" \
        "The scheduled uptime check found these environments down: **$(printf '%s' "$down" | sed 's/ /**, **/g')**." \
        "The job summary of ${run:-the failing run of the uptime workflow} shows which check failed (the home page, \`/version.json\` or \`/api/health\`). Follow \`docs/runbooks/incident.md\`." \
        "The uptime workflow manages this issue: it comments when the set of failing environments changes and closes it when every checked environment is up again. Never paste hostnames or URLs here.")
      number=$(issue_write POST "repos/$REPO/issues" \
        "$(jq -n --arg t "$want" --arg b "$body" --arg l "$LABEL" '{title: $t, body: $b, labels: [$l]}')" .number)
      printf 'opened incident issue #%s: %s\n' "$number" "$list"
    elif [ "$title" != "$want" ]; then
      issue_write PATCH "repos/$REPO/issues/$number" "$(jq -n --arg t "$want" '{title: $t}')" >/dev/null
      issue_write POST "repos/$REPO/issues/$number/comments" \
        "$(jq -n --arg b "Now failing: **$(printf '%s' "$down" | sed 's/ /**, **/g')**${run:+ ($run)}." '{body: $b}')" >/dev/null
      printf 'updated incident issue #%s: %s\n' "$number" "$list"
    else
      printf 'incident issue #%s is open for: %s (unchanged)\n' "$number" "$list"
    fi
  elif [ -n "$open" ]; then
    issue_write POST "repos/$REPO/issues/$number/comments" \
      "$(jq -n --arg b "Every checked environment is up again${run:+ ($run)}. Closing." '{body: $b}')" >/dev/null
    issue_write PATCH "repos/$REPO/issues/$number" '{"state":"closed","state_reason":"completed"}' >/dev/null
    printf 'closed incident issue #%s\n' "$number"
  else
    printf 'nothing down and no open incident issue\n'
  fi
}

main() {
  [ $# -gt 0 ] || usage_error "missing command: check, cold-start or incident (see --help)"
  local command=$1
  shift
  case "$command" in
    check) cmd_check "$@" ;;
    cold-start) cmd_cold_start "$@" ;;
    incident) cmd_incident "$@" ;;
    -h | --help) usage ;;
    *) usage_error "unknown command: $command (expected check, cold-start or incident)" ;;
  esac
}

main "$@"
