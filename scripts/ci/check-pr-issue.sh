#!/usr/bin/env bash
# check-pr-issue.sh: the linked-issue check of the pr-policy workflow (ADR 0013). No work without
# an open issue: a pull request passes only when its body links at least one open issue of this
# repository that is neither a pull request nor an epic.
#
# Input comes from environment variables only. The workflow passes the event's fields through
# `env:` and never interpolates them into a script.
#
#   PR_BODY    the pull request body (may be empty)
#   PR_AUTHOR  the login of the pull request's author
#   REPO       OWNER/NAME of the repository the pull request targets
#
# HTML comments (<!-- ... -->, also over several lines) are removed from the body first: links
# in them are not visible on GitHub and do not count. A link is close/closes/closed,
# fix/fixes/fixed, resolve/resolves/resolved or ref/refs, in any letter case, an optional colon,
# whitespace and `#N`. References to other repositories (`owner/repo#N`) do not count. Every
# linked number is read with `gh api repos/REPO/issues/N` and counts when it is an open issue of
# REPO without the label `type:epic`. Pull requests by Dependabot are exempt.
#
# Usage (read-only; also works locally with an authenticated gh):
#   PR_BODY='Closes #12' PR_AUTHOR=someone REPO=OWNER/NAME scripts/ci/check-pr-issue.sh
#
# Exit status: 0 when the PR links an open issue (or Dependabot opened it), 1 when it does not,
# 2 on a usage error. Requires: gh (with GH_TOKEN in CI), jq. Compatible with the bash 3.2 that
# ships with macOS.
set -euo pipefail

EPIC_LABEL="type:epic"
TMP_DIR=""

die() {
  printf 'error: %s\n' "$*" >&2
  exit 2
}

cleanup() {
  if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi
}
trap cleanup EXIT

# linked_numbers BODY: the unique issue numbers that BODY links, one per line, ascending.
linked_numbers() {
  jq -n -r --arg body "$1" '
    $body
    # An unclosed comment hides the rest of the body, as it does on GitHub.
    | gsub("<!--[\\s\\S]*?(-->|\\z)"; "")
    | [scan("(?i)\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?):?[ \\t]+#([0-9]{1,9})\\b")
       | .[0] | tonumber]
    | unique[]'
}

# issue_problem JSON: why the issue in JSON does not count; empty when it does.
issue_problem() {
  printf '%s' "$1" | jq -r --arg repo "$REPO" --arg epic "$EPIC_LABEL" '
    if (.pull_request // null) != null then "a pull request, not an issue"
    elif ((.repository_url // "") | ascii_downcase
          | endswith("/repos/" + ($repo | ascii_downcase)) | not)
    then "not an issue of \($repo)"
    elif .state != "open" then "\(.state // "unknown"), not open"
    elif any(.labels[]?; (if type == "object" then .name else . end) == $epic)
    then "an epic (\($epic)); link the bug, task or chore this PR works on"
    else "" end'
}

main() {
  local numbers n json problem valid="" errors=0
  REPO=${REPO:-}
  [ -n "$REPO" ] || die "REPO is not set (OWNER/NAME)"
  printf '%s' "$REPO" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' ||
    die "invalid repository name: $REPO (expected OWNER/NAME)"

  if [ "${PR_AUTHOR:-}" = "dependabot[bot]" ]; then
    echo "Dependabot PR: exempt from the linked-issue rule (ADR 0013)."
    return 0
  fi

  command -v jq >/dev/null 2>&1 || die "jq not found"
  command -v gh >/dev/null 2>&1 || die "GitHub CLI (gh) not found"
  TMP_DIR=$(mktemp -d)

  numbers=$(linked_numbers "${PR_BODY:-}")
  if [ -z "$numbers" ]; then
    echo "The PR body links no issue (links inside HTML comments do not count)."
  else
    echo "Issues linked in the PR body:"
    while IFS= read -r n; do
      if json=$(gh api "repos/$REPO/issues/$n" 2>"$TMP_DIR/stderr" </dev/null); then
        problem=$(issue_problem "$json") || {
          problem="could not be read: unexpected API response"
          errors=$((errors + 1))
        }
      elif grep -q 'HTTP 404' "$TMP_DIR/stderr"; then
        problem="not found in $REPO"
      elif grep -q 'HTTP 410' "$TMP_DIR/stderr"; then
        problem="deleted"
      else
        problem="could not be read: $(head -n 1 "$TMP_DIR/stderr")"
        errors=$((errors + 1))
      fi
      if [ -z "$problem" ]; then
        printf '  #%-7s ok   open issue\n' "$n"
        valid="$valid #$n"
      else
        printf '  #%-7s no   %s\n' "$n" "$problem"
      fi
    done <<<"$numbers"
  fi

  if [ -n "$valid" ]; then
    printf 'OK: the PR links the open issue(s)%s.\n' "$valid"
    return 0
  fi
  echo "::error title=No open issue linked::This PR links no open issue of $REPO. Add \"Closes #N\" to the PR body (\"Refs #N\" while the issue stays open). No issue yet? Create one first (bug, task or chore) and put it on the board. An epic alone does not count. Editing the PR body re-runs this check."
  if [ "$errors" -gt 0 ]; then
    echo "::warning::$errors linked issue(s) could not be read from the GitHub API; if they are open issues, re-run this job."
  fi
  return 1
}

main "$@"
