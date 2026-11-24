#!/usr/bin/env bash
# setup-repo.sh: configure the GitHub repository settings, security features and the
# deployment environments (e2e, test, production) for WeddingPlanner.
#
# Run by the repository owner with an authenticated `gh` (admin rights). Never run by CI.
# Idempotent: reads the current state first and changes only what differs, so it is safe
# to re-run at any time. It prints setting names only, never tokens or hostnames.
#
# Usage: scripts/github/setup-repo.sh [--repo OWNER/NAME] [--reviewer LOGIN] [--dry-run]
#
#   --repo OWNER/NAME  repository to configure (default: the current directory's GitHub repo)
#   --reviewer LOGIN   required reviewer for the production environment
#                      (default: the repository owner, which must then be a user account)
#   --dry-run          only report what would change; make no changes
#
# What it configures:
#   - merges: squash only (PR title as commit title), auto-merge allowed, update-branch
#     allowed, head branches deleted on merge
#   - security: secret scanning + push protection, Dependabot alerts, private vulnerability
#     reporting, CodeQL default setup
#   - Actions: approval required for runs from all outside contributors; read-only default
#     GITHUB_TOKEN, which may not approve pull requests
#   - environments e2e, test, production: deployments from branch `main` only, no admin
#     bypass; production additionally requires the reviewer's approval for every deploy,
#     with "prevent self-review" off (merges run under the owner's login, so the owner
#     must be able to approve the resulting deploy)
#
# Requires: gh, jq. Compatible with the bash 3.2 that ships with macOS.
set -euo pipefail

ENVIRONMENTS="e2e test production"
PRODUCTION_ENV="production"
DEPLOY_BRANCH="main"

REPO=""
REVIEWER=""
REVIEWER_ID=""
DRY_RUN=false
CHANGES=0
WARNINGS=0
TMP_DIR=""

usage() {
  sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//'
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

section() { printf '\n%s\n' "$*"; }
ok() { printf '  ok       %s\n' "$*"; }
warn() {
  printf '  warning  %s\n' "$*" >&2
  WARNINGS=$((WARNINGS + 1))
}
changed() {
  CHANGES=$((CHANGES + 1))
  if [ "$DRY_RUN" = true ]; then
    printf '  would    %s\n' "$*"
  else
    printf '  change   %s\n' "$*"
  fi
}

cleanup() {
  if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi
}

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
  cat "$TMP_DIR/stderr" >&2
  die "GET $1 failed"
}

# api_get_soft PATH: like api_get, but returns 1 on any error (message in $TMP_DIR/stderr).
api_get_soft() {
  gh api "$1" 2>"$TMP_DIR/stderr"
}

# api_write METHOD PATH [JSON]: send a change (skipped in dry-run mode). Dies on error.
api_write() {
  local method=$1 path=$2 body=${3:-}
  if [ "$DRY_RUN" = true ]; then
    return 0
  fi
  if [ -n "$body" ]; then
    printf '%s' "$body" | gh api -X "$method" "$path" --input - >/dev/null
  else
    gh api -X "$method" "$path" >/dev/null
  fi
}

# api_try_write METHOD PATH [JSON]: like api_write, but returns 1 instead of dying, with the
# error message in $TMP_DIR/stderr.
api_try_write() {
  local method=$1 path=$2 body=${3:-}
  if [ "$DRY_RUN" = true ]; then
    return 0
  fi
  if [ -n "$body" ]; then
    printf '%s' "$body" | gh api -X "$method" "$path" --input - >/dev/null 2>"$TMP_DIR/stderr"
  else
    gh api -X "$method" "$path" >/dev/null 2>"$TMP_DIR/stderr"
  fi
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --repo)
        [ $# -ge 2 ] || die "--repo needs a value"
        REPO=$2
        shift 2
        ;;
      --reviewer)
        [ $# -ge 2 ] || die "--reviewer needs a value"
        REVIEWER=$2
        shift 2
        ;;
      --dry-run)
        DRY_RUN=true
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
  if [ "${GITHUB_ACTIONS:-}" = "true" ] || [ "${CI:-}" = "true" ]; then
    die "this script is run by the repository owner, never by CI"
  fi
  command -v gh >/dev/null 2>&1 || die "GitHub CLI (gh) not found"
  command -v jq >/dev/null 2>&1 || die "jq not found"
  if [ -z "$REPO" ]; then
    REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner) ||
      die "cannot determine the repository; pass --repo OWNER/NAME"
  fi
  printf '%s' "$REPO" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' ||
    die "invalid repository name: $REPO (expected OWNER/NAME)"
}

configure_merges() {
  local repo_json=$1 want diff keys
  section "Merge settings"
  want='{
    "allow_squash_merge": true,
    "allow_merge_commit": false,
    "allow_rebase_merge": false,
    "squash_merge_commit_title": "PR_TITLE",
    "squash_merge_commit_message": "COMMIT_MESSAGES",
    "allow_auto_merge": true,
    "allow_update_branch": true,
    "delete_branch_on_merge": true
  }'
  diff=$(jq -n --argjson have "$repo_json" --argjson want "$want" \
    '$want | with_entries(select(.value != $have[.key]))')
  if [ "$diff" = "{}" ]; then
    ok "squash only, auto-merge, update branch, delete branch on merge"
    return
  fi
  # GitHub only accepts certain title/message combinations, so always send both squash settings together.
  if printf '%s' "$diff" | jq -e 'has("squash_merge_commit_title") or has("squash_merge_commit_message")' >/dev/null; then
    diff=$(jq -n --argjson d "$diff" --argjson want "$want" \
      '$d + {squash_merge_commit_title: $want.squash_merge_commit_title, squash_merge_commit_message: $want.squash_merge_commit_message}')
  fi
  keys=$(printf '%s' "$diff" | jq -r 'to_entries | map("\(.key)=\(.value)") | join(", ")')
  changed "set $keys"
  api_write PATCH "repos/$REPO" "$diff"
}

configure_secret_scanning() {
  local repo_json=$1 feature status
  section "Secret scanning"
  for feature in secret_scanning secret_scanning_push_protection; do
    status=$(printf '%s' "$repo_json" | jq -r --arg f "$feature" '.security_and_analysis[$f].status // "disabled"')
    if [ "$status" = "enabled" ]; then
      ok "$feature enabled"
    else
      changed "enable $feature"
      api_write PATCH "repos/$REPO" \
        "$(jq -n --arg f "$feature" '{security_and_analysis: {($f): {status: "enabled"}}}')"
    fi
  done
}

configure_dependabot_alerts() {
  section "Dependabot alerts"
  # 204 when enabled, 404 when disabled
  if api_get "repos/$REPO/vulnerability-alerts" >/dev/null; then
    ok "Dependabot alerts enabled"
  else
    changed "enable Dependabot alerts"
    api_write PUT "repos/$REPO/vulnerability-alerts"
  fi
}

configure_private_vulnerability_reporting() {
  local body enabled=false
  section "Private vulnerability reporting"
  if body=$(api_get "repos/$REPO/private-vulnerability-reporting"); then
    enabled=$(printf '%s' "$body" | jq -r '.enabled // false')
  fi
  if [ "$enabled" = "true" ]; then
    ok "private vulnerability reporting enabled"
  else
    changed "enable private vulnerability reporting"
    api_write PUT "repos/$REPO/private-vulnerability-reporting"
  fi
}

configure_codeql() {
  local body state
  section "CodeQL default setup"
  if ! body=$(api_get_soft "repos/$REPO/code-scanning/default-setup"); then
    warn "cannot read the code scanning setup; skipped: $(tr '\n' ' ' <"$TMP_DIR/stderr")"
    return
  fi
  state=$(printf '%s' "$body" | jq -r '.state // "not-configured"')
  if [ "$state" = "configured" ]; then
    ok "CodeQL default setup configured"
    return
  fi
  changed "configure CodeQL default setup (default query suite)"
  if ! api_try_write PATCH "repos/$REPO/code-scanning/default-setup" \
    '{"state": "configured", "query_suite": "default"}'; then
    # Typical cause: no CodeQL-supported language in the repository yet.
    warn "CodeQL default setup failed: $(tr '\n' ' ' <"$TMP_DIR/stderr")"
    warn "re-run this script once the repository contains code"
  fi
}

configure_actions() {
  local body policy perms want
  section "GitHub Actions"
  body=$(api_get "repos/$REPO/actions/permissions/fork-pr-contributor-approval") ||
    die "cannot read the outside-contributor approval policy"
  policy=$(printf '%s' "$body" | jq -r '.approval_policy // ""')
  if [ "$policy" = "all_external_contributors" ]; then
    ok "approval required for runs from all outside contributors"
  else
    changed "require approval for runs from all outside contributors (was: ${policy:-unknown})"
    api_write PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" \
      '{"approval_policy": "all_external_contributors"}'
  fi

  want='{"default_workflow_permissions": "read", "can_approve_pull_request_reviews": false}'
  perms=$(api_get "repos/$REPO/actions/permissions/workflow") ||
    die "cannot read the workflow permissions"
  if [ "$(jq -n --argjson have "$perms" --argjson want "$want" \
    '$want | with_entries(select(.value != $have[.key])) | length')" = "0" ]; then
    ok "GITHUB_TOKEN read-only by default and cannot approve pull requests"
  else
    changed "set GITHUB_TOKEN default permissions to read-only, no PR approvals"
    api_write PUT "repos/$REPO/actions/permissions/workflow" "$want"
  fi
}

resolve_reviewer() {
  local owner user
  owner=${REPO%%/*}
  if [ -z "$REVIEWER" ]; then
    user=$(api_get "users/$owner") || die "unknown repository owner: $owner"
    [ "$(printf '%s' "$user" | jq -r '.type')" = "User" ] ||
      die "the repository owner is not a user account; pass --reviewer LOGIN"
    REVIEWER=$owner
  else
    user=$(api_get "users/$REVIEWER") || die "unknown GitHub user: $REVIEWER"
  fi
  REVIEWER_ID=$(printf '%s' "$user" | jq -r '.id')
  ok "production reviewer: $REVIEWER"
}

# environment_body ENV CURRENT_JSON: the desired PUT body for an environment. Keeps existing
# reviewers and wait timer, adds the production reviewer, disables admin bypass and restricts
# deployments to custom branch policies (managed in configure_branch_policies).
environment_body() {
  local env=$1 current=$2 is_production=false
  if [ "$env" = "$PRODUCTION_ENV" ]; then is_production=true; fi
  jq -n --argjson cur "$current" --argjson prod "$is_production" --argjson rid "$REVIEWER_ID" '
    ([$cur.protection_rules // [] | .[] | select(.type == "required_reviewers")] | first) as $rr
    | ([$cur.protection_rules // [] | .[] | select(.type == "wait_timer")] | first) as $wt
    | ([($rr.reviewers // [])[] | {type: .type, id: .reviewer.id}]) as $existing
    | {
        wait_timer: ($wt.wait_timer // 0),
        prevent_self_review: (if $prod then false else ($rr.prevent_self_review // false) end),
        reviewers: (if $prod then ($existing + [{type: "User", id: $rid}] | unique_by([.type, .id]))
                    elif ($existing | length) > 0 then $existing
                    else null end),
        deployment_branch_policy: {protected_branches: false, custom_branch_policies: true},
        can_admins_bypass: false
      }'
}

# environment_problems ENV CURRENT_JSON: describe how the current state differs from the
# desired one (empty when it matches).
environment_problems() {
  local env=$1 current=$2 is_production=false
  if [ "$env" = "$PRODUCTION_ENV" ]; then is_production=true; fi
  jq -r --argjson prod "$is_production" --argjson rid "$REVIEWER_ID" '
    ([.protection_rules // [] | .[] | select(.type == "required_reviewers")] | first) as $rr
    | [
        (if .deployment_branch_policy != {protected_branches: false, custom_branch_policies: true}
         then "deployments not restricted to selected branches" else empty end),
        (if .can_admins_bypass != false then "admins can bypass protection rules" else empty end),
        (if $prod and ([($rr.reviewers // [])[] | select(.type == "User" and .reviewer.id == $rid)] | length) == 0
         then "reviewer missing" else empty end),
        (if $prod and ($rr.prevent_self_review // false) then "prevent self-review is on" else empty end)
      ] | join("; ")' <<<"$current"
}

configure_environment() {
  local env=$1 current problems
  if current=$(api_get "repos/$REPO/environments/$env"); then
    problems=$(environment_problems "$env" "$current")
    if [ -z "$problems" ]; then
      ok "environment $env: protection rules as desired"
    else
      changed "update environment $env ($problems)"
      api_write PUT "repos/$REPO/environments/$env" "$(environment_body "$env" "$current")"
    fi
  else
    current='{}'
    if [ "$env" = "$PRODUCTION_ENV" ]; then
      changed "create environment $env (branch $DEPLOY_BRANCH only, reviewer required, no admin bypass)"
    else
      changed "create environment $env (branch $DEPLOY_BRANCH only, no admin bypass)"
    fi
    api_write PUT "repos/$REPO/environments/$env" "$(environment_body "$env" "$current")"
  fi
  configure_branch_policies "$env"
}

configure_branch_policies() {
  local env=$1 policies has_main id name
  if ! policies=$(api_get "repos/$REPO/environments/$env/deployment-branch-policies"); then
    if [ "$DRY_RUN" = true ]; then
      changed "allow deployments to $env from branch $DEPLOY_BRANCH"
      return
    fi
    die "cannot read the deployment branch policies of environment $env"
  fi
  has_main=$(printf '%s' "$policies" | jq --arg b "$DEPLOY_BRANCH" \
    '[.branch_policies[]? | select(.name == $b and (.type // "branch") == "branch")] | length')
  if [ "$has_main" = "0" ]; then
    changed "allow deployments to $env from branch $DEPLOY_BRANCH"
    api_write POST "repos/$REPO/environments/$env/deployment-branch-policies" \
      "$(jq -n --arg b "$DEPLOY_BRANCH" '{name: $b, type: "branch"}')"
  else
    ok "environment $env: deployments from branch $DEPLOY_BRANCH allowed"
  fi
  while read -r id name <&3; do
    [ -n "$id" ] || continue
    changed "remove deployment policy $name from $env (only $DEPLOY_BRANCH may deploy)"
    api_write DELETE "repos/$REPO/environments/$env/deployment-branch-policies/$id"
  done 3< <(printf '%s' "$policies" | jq -r --arg b "$DEPLOY_BRANCH" \
    '.branch_policies[]? | select(.name != $b or (.type // "branch") != "branch")
     | "\(.id) \(.type // "branch"):\(.name)"')
}

configure_environments() {
  local env
  section "Environments"
  resolve_reviewer
  for env in $ENVIRONMENTS; do
    configure_environment "$env"
  done
}

main() {
  local repo_json is_admin
  parse_args "$@"
  preflight
  TMP_DIR=$(mktemp -d)
  trap cleanup EXIT

  if [ "$DRY_RUN" = true ]; then
    printf 'Configuring %s (dry run: no changes)\n' "$REPO"
  else
    printf 'Configuring %s\n' "$REPO"
  fi

  repo_json=$(api_get "repos/$REPO") || die "repository $REPO not found or not accessible"
  is_admin=$(printf '%s' "$repo_json" | jq -r '.permissions.admin // false')
  if [ "$is_admin" != "true" ]; then
    if [ "$DRY_RUN" = true ]; then
      warn "you are not an admin of $REPO; changes would fail"
    else
      die "admin rights on $REPO are required"
    fi
  fi

  configure_merges "$repo_json"
  configure_secret_scanning "$repo_json"
  configure_dependabot_alerts
  configure_private_vulnerability_reporting
  configure_codeql
  configure_actions
  configure_environments

  section "Summary"
  if [ "$CHANGES" -eq 0 ]; then
    printf '  Nothing to change: %s is configured as desired.\n' "$REPO"
  elif [ "$DRY_RUN" = true ]; then
    printf '  %d change(s) would be made. Re-run without --dry-run to apply them.\n' "$CHANGES"
  else
    printf '  %d change(s) applied. Re-running this script is safe.\n' "$CHANGES"
  fi
  if [ "$WARNINGS" -gt 0 ]; then
    printf '  %d warning(s); see above.\n' "$WARNINGS"
  fi
  printf '  Next: protect main with scripts/github/apply-ruleset.sh once the ci-ok check exists.\n'
}

main "$@"
