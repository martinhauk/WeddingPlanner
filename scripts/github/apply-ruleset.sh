#!/usr/bin/env bash
# apply-ruleset.sh: create or update the branch ruleset that protects `main`, from the JSON
# in .github/rulesets/main.json (the body of the GitHub REST API "create a repository ruleset").
#
# Run by the repository owner with an authenticated `gh` (admin rights). Never run by CI.
# Idempotent: finds the ruleset by name, compares it with the file and writes only when they
# differ, so it is safe to re-run at any time. It prints rule names only, never tokens.
#
# Usage: scripts/github/apply-ruleset.sh [--repo OWNER/NAME] [--file PATH] [--dry-run]
#
#   --repo OWNER/NAME  repository to configure (default: the current directory's GitHub repo)
#   --file PATH        ruleset JSON (default: .github/rulesets/main.json next to this script)
#   --dry-run          only report what would change; make no changes
#
# The ruleset (ADR 0010, amended by ADR 0013): changes reach `main` only through a pull request
# that is squash-merged (linear history) with 0 required approvals, once the checks `ci-ok`
# (ci.yml) and `pr-policy` (pr-policy.yml: PR title, linked open issue) from GitHub Actions have
# passed on a branch that is up to date with `main`. Force pushes and deletion are blocked and
# nobody can bypass it.
#
# Apply it once `ci.yml` and `pr-policy.yml` have reported `ci-ok` and `pr-policy` on a pull
# request, then verify with a test PR that the merge button waits for both checks and offers
# squash merging only. A PR opened before pr-policy.yml existed gets the check on its next push
# or when its title or body is edited.
#
# Requires: gh, jq. Compatible with the bash 3.2 that ships with macOS.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
RULESET_FILE="$HERE/../../.github/rulesets/main.json"

REPO=""
DRY_RUN=false
CHANGES=0
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

# api_get PATH [JQ]: print the response body (filtered by JQ). Returns 1 on HTTP 404; dies on
# any other error.
api_get() {
  local out
  if [ $# -ge 2 ]; then
    out=$(gh api --paginate "$1" --jq "$2" 2>"$TMP_DIR/stderr") && {
      printf '%s' "$out"
      return 0
    }
  else
    out=$(gh api "$1" 2>"$TMP_DIR/stderr") && {
      printf '%s' "$out"
      return 0
    }
  fi
  if grep -q 'HTTP 404' "$TMP_DIR/stderr"; then
    return 1
  fi
  cat "$TMP_DIR/stderr" >&2
  die "GET $1 failed"
}

# api_write METHOD PATH JSON: send a change (skipped in dry-run mode). Dies on error.
api_write() {
  if [ "$DRY_RUN" = true ]; then
    return 0
  fi
  printf '%s' "$3" | gh api -X "$1" "$2" --input - >/dev/null
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --repo)
        [ $# -ge 2 ] || die "--repo needs a value"
        REPO=$2
        shift 2
        ;;
      --file)
        [ $# -ge 2 ] || die "--file needs a value"
        RULESET_FILE=$2
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
  [ -f "$RULESET_FILE" ] || die "ruleset file not found: $RULESET_FILE"
  jq -e '(.name | type) == "string" and (.name | length) > 0 and (.rules | type) == "array"' \
    "$RULESET_FILE" >/dev/null 2>&1 ||
    die "invalid ruleset file: $RULESET_FILE (expected JSON with a name and rules)"
  if [ -z "$REPO" ]; then
    REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner) ||
      die "cannot determine the repository; pass --repo OWNER/NAME"
  fi
  printf '%s' "$REPO" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' ||
    die "invalid repository name: $REPO (expected OWNER/NAME)"
}

# ruleset_problems DESIRED_JSON CURRENT_JSON: describe how the current ruleset differs from
# the desired one (empty when it matches). Every field of the desired ruleset must be present
# with the same value; fields GitHub adds on its own (ids, links, default parameters) are
# ignored. Rules are matched by type; a rule that is not in the file is reported as extra,
# because the update would remove it.
ruleset_problems() {
  jq -n -r --argjson want "$1" --argjson have "$2" '
    # Arrays of scalars (merge methods, ref patterns) and of required status checks are
    # compared as sets.
    def norm: walk(if type == "array" and all(.[]; type != "object" and type != "array")
                   then sort
                   elif type == "array" and all(.[]; type == "object" and has("context"))
                   then sort_by(.context, .integration_id)
                   else . end);
    # subset(want; have): every field of want exists in have with an equal value.
    def subset($w; $h):
      if ($w | type) == "object" then
        ($h | type) == "object"
        and all($w | to_entries[]; .key as $k | ($h | has($k)) and subset(.value; $h[$k]))
      elif ($w | type) == "array" then
        ($h | type) == "array" and ($w | length) == ($h | length)
        and all(range(0; $w | length); subset($w[.]; $h[.]))
      else $w == $h end;
    ($want | norm) as $w
    | ($have | norm) as $h
    | ($h.rules // []) as $hrules
    | [
        (if $h.target != ($w.target // "branch") then "target is \($h.target)" else empty end),
        (if $h.enforcement != $w.enforcement then "enforcement is \($h.enforcement)" else empty end),
        (if ($h.bypass_actors // []) != ($w.bypass_actors // [])
         then "bypass actors differ" else empty end),
        (if subset($w.conditions // {}; $h.conditions // {}) | not
         then "branch conditions differ" else empty end),
        ($w.rules[] as $r
         | ([$hrules[] | select(.type == $r.type)] | first) as $c
         | if $c == null then "rule \($r.type) missing"
           elif (subset($r.parameters // {}; $c.parameters // {}) | not)
           then "rule \($r.type) differs"
           else empty end),
        ($hrules[] | .type as $t
         | select([$w.rules[].type] | index($t) | not) | "extra rule \($t)")
      ] | join("; ")'
}

apply_ruleset() {
  local desired name list matches count id current problems
  desired=$(jq -c . "$RULESET_FILE")
  name=$(printf '%s' "$desired" | jq -r .name)
  section "Ruleset $name"

  # Only rulesets of this repository (not inherited ones), matched by name.
  list=$(api_get "repos/$REPO/rulesets?includes_parents=false" '.[] | [.id, .name] | @tsv') ||
    die "cannot list the rulesets of $REPO"
  matches=$(printf '%s\n' "$list" | awk -F '\t' -v n="$name" '$2 == n { print $1 }')
  count=$(printf '%s' "$matches" | grep -c . || true)
  if [ "$count" -gt 1 ]; then
    die "$count rulesets are named $name; delete the duplicates in the repository settings first"
  fi

  if [ "$count" -eq 0 ]; then
    changed "create ruleset $name ($(rule_summary "$desired"))"
    api_write POST "repos/$REPO/rulesets" "$desired"
    return
  fi

  id=$matches
  current=$(api_get "repos/$REPO/rulesets/$id") || die "cannot read ruleset $name (id $id)"
  problems=$(ruleset_problems "$desired" "$current")
  if [ -z "$problems" ]; then
    ok "ruleset $name as desired ($(rule_summary "$desired"))"
  else
    changed "update ruleset $name ($problems)"
    api_write PUT "repos/$REPO/rulesets/$id" "$desired"
  fi
}

# rule_summary JSON: the rule types of a ruleset, comma-separated.
rule_summary() {
  printf '%s' "$1" | jq -r '[.rules[].type] | join(", ")'
}

main() {
  local repo_json is_admin
  parse_args "$@"
  preflight
  TMP_DIR=$(mktemp -d)
  trap cleanup EXIT

  if [ "$DRY_RUN" = true ]; then
    printf 'Applying %s to %s (dry run: no changes)\n' "${RULESET_FILE##*/}" "$REPO"
  else
    printf 'Applying %s to %s\n' "${RULESET_FILE##*/}" "$REPO"
  fi

  repo_json=$(api_get "repos/$REPO") || die "repository $REPO not found or not accessible"
  is_admin=$(printf '%s' "$repo_json" | jq -r '.permissions.admin // false')
  if [ "$is_admin" != "true" ]; then
    if [ "$DRY_RUN" = true ]; then
      printf '  warning  you are not an admin of %s; changes would fail\n' "$REPO" >&2
    else
      die "admin rights on $REPO are required"
    fi
  fi

  apply_ruleset

  section "Summary"
  if [ "$CHANGES" -eq 0 ]; then
    printf '  Nothing to change: the ruleset of %s is as desired.\n' "$REPO"
  elif [ "$DRY_RUN" = true ]; then
    printf '  %d change(s) would be made. Re-run without --dry-run to apply them.\n' "$CHANGES"
  else
    printf '  %d change(s) applied. Re-running this script is safe.\n' "$CHANGES"
    printf '  Next: open a test PR and check that merging waits for ci-ok and pr-policy\n'
    printf '  and offers squash merging only.\n'
  fi
}

main "$@"
