#!/usr/bin/env bash
# Tests for scripts/ci/check-pr-issue.sh, the linked-issue check of the pr-policy workflow.
#
# The script runs against the fake `gh` of scripts/github/tests (fake-gh), which serves canned
# API responses from tests/fixtures/issues.json and logs every call, so the tests need no network.
# They check which PR bodies pass, which fail, and that the failure says what to do.
#
# Usage: scripts/ci/tests/check-pr-issue.test.sh
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT=$(cd "$HERE/.." && pwd)/check-pr-issue.sh
FAKE_GH=$(cd "$HERE/../../github/tests" && pwd)/fake-gh
STATE="$HERE/fixtures/issues.json"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
cp "$FAKE_GH" "$WORK/bin/gh"
chmod +x "$WORK/bin/gh"
LOG="$WORK/calls.log"
OUT=""
STATUS=0
PASSED=0
FAILED=0

# run BODY [AUTHOR]: run the check for a PR with BODY by AUTHOR; sets OUT and STATUS.
run() {
  : >"$LOG"
  set +e
  OUT=$(env PATH="$WORK/bin:$PATH" FAKE_GH_STATE="$STATE" FAKE_GH_LOG="$LOG" \
    PR_BODY="$1" PR_AUTHOR="${2:-anna-example}" REPO=acme/wedding-demo "$SCRIPT" 2>&1)
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
    printf '        calls:\n'
    sed 's/^/        > /' "$LOG"
  fi
}

status_is() { [ "$STATUS" -eq "$1" ]; }
output_has() { printf '%s' "$OUT" | grep -qF -- "$1"; }
called() { grep -qxF -- "GET repos/acme/wedding-demo/issues/$1" "$LOG"; }
no_calls() { [ ! -s "$LOG" ]; }
call_count() { [ "$(grep -c . "$LOG" || true)" -eq "$1" ]; }
only_called() { called "$1" && call_count 1; }
# fails_with_help: exit 1 with the annotation that says how to fix it.
fails_with_help() {
  status_is 1 && output_has '::error title=No open issue linked::' &&
    output_has 'Add "Closes #N" to the PR body ("Refs #N" while the issue stays open)' &&
    output_has 'Create one first (bug, task or chore) and put it on the board' &&
    output_has 'An epic alone does not count' &&
    output_has 'Editing the PR body re-runs this check'
}

# The body of .github/pull_request_template.md, as a PR starts out.
TEMPLATE=$(cat "$HERE/../../../.github/pull_request_template.md")

# ---------------------------------------------------------------------------------------
test_case "no link: fails and says what to do"
run "Tidies the sample media."
check "fails with the help text" fails_with_help
check "says the body links no issue" output_has "The PR body links no issue"
check "makes no API calls" no_calls

test_case "the unchanged PR template (bare \"Closes #\"): fails"
run "$TEMPLATE"
check "fails with the help text" fails_with_help
check "makes no API calls" no_calls

test_case "a link inside an HTML comment does not count"
run $'Summary.\n\n<!--\nCloses #10\n-->\n\n<!-- Refs #11 -->'
check "fails with the help text" fails_with_help
check "makes no API calls" no_calls

test_case "an unclosed HTML comment hides the rest of the body"
run $'Summary.\n<!-- draft notes\nCloses #10'
check "fails" status_is 1
check "makes no API calls" no_calls

# Bodies with backticks are $'...' strings, so the backticks are plainly literal.
test_case "a link inside code does not count (GitHub does not link it)"
for body in $'Quotes `Closes #10` only.' $'``Closes #10``' $'```text\nCloses #10\n```' \
  $'~~~\nCloses #10\n~~~' $'  ```\n  Closes #10\n  ```' $'````\n```\nCloses #10\n```\n````' \
  $'Summary.\n\n```sh\nCloses #10' $'```Closes #10```' \
  $'Quotes `the fix\nCloses #10` over two lines.'; do
  run "$body"
  check "$(printf '%q' "$body") does not count" status_is 1
  check "$(printf '%q' "$body") makes no API calls" no_calls
done

test_case "code hides only itself: links next to it count"
for body in $'Uses `jq`. Closes #10' $'```sh\nfoo\n```\n\nCloses #10' $'```\n```\nCloses #10' \
  $'~~~\n```\n~~~\nCloses #10' $'Fixes the `foo command.\n\nCloses #10\n\nAlso `bar`.' \
  $'``foo` Closes #10' $'`<!--` Closes #10' $'<!--\n```\n-->\nCloses #10' \
  $'```\r\nRefs #11\r\n```\r\nCloses #10' $'```Refs #11``` and Closes #10'; do
  run "$body"
  check "$(printf '%q' "$body") counts" status_is 0
  check "$(printf '%q' "$body") reads only #10" only_called 10
done

test_case "an epic alone does not count"
run "Refs #20"
check "fails with the help text" fails_with_help
check "names the epic" output_has "#20      no   an epic (type:epic)"

test_case "a pull request number does not count"
run "Closes #30"
check "fails with the help text" fails_with_help
check "names the pull request" output_has "#30      no   a pull request, not an issue"

test_case "a closed issue does not count"
run "Closes #40"
check "fails with the help text" fails_with_help
check "names the closed issue" output_has "#40      no   closed, not open"

test_case "a missing issue does not count"
run "Closes #99"
check "fails with the help text" fails_with_help
check "names the missing issue" output_has "#99      no   not found in acme/wedding-demo"

test_case "an issue that moved to another repository does not count"
run "Closes #50"
check "fails with the help text" fails_with_help
check "names the problem" output_has "#50      no   not an issue of acme/wedding-demo"

test_case "an API error fails the check and suggests a re-run"
run "Closes #60"
check "fails with the help text" fails_with_help
check "shows the error" output_has "#60      no   could not be read: gh: Server Error (HTTP 502)"
check "suggests a re-run" output_has "re-run this job"

test_case "valid: Closes an open task"
run $'Summary.\n\nCloses #10'
check "passes" status_is 0
check "reads the issue" called 10
check "lists it as ok" output_has "#10      ok   open issue"
check "says which issue counts" output_has "OK: the PR links the open issue(s) #10."

test_case "valid: Refs an open bug that stays open"
run "Refs #11"
check "passes" status_is 0
check "reads the issue" called 11

test_case "valid: the PR template with the tracker filled in"
run "${TEMPLATE/Closes #/Closes #10}"
check "passes" status_is 0
check "reads only the linked issue" call_count 1

test_case "mixed: an epic and a task pass, and every link is listed"
run $'Refs #20\nCloses #10\nCloses #40'
check "passes" status_is 0
check "lists the epic" output_has "#20      no   an epic"
check "lists the closed issue" output_has "#40      no   closed, not open"
check "lists the task" output_has "#10      ok   open issue"
check "counts only the task" output_has "OK: the PR links the open issue(s) #10."

test_case "keyword variants: any letter case, with a colon, tab and every keyword form"
for body in "closes #10" "CLOSES: #10" $'Refs:\t#10' "ref #10" "fix #10" "Fixes #10" "fixed: #10" \
  "close #10" "closed #10" "resolve #10" "Resolves #10" "resolved #10" "(Closes #10)"; do
  run "$body"
  check "\"$body\" counts" status_is 0
done

test_case "not a link: other words and forms, and full issue URLs"
for body in "prefixes #10" "Closes#10" "Closes #10abc" "Closes 10" "Closing #10" "See #10" \
  "closes https://example.com/acme/wedding-demo/issues/10"; do
  run "$body"
  check "\"$body\" does not count" status_is 1
  check "\"$body\" makes no API calls" no_calls
done

test_case "a reference to another repository is ignored"
run "Closes octo-org/other-repo#10"
check "fails with the help text" fails_with_help
check "makes no API calls" no_calls

test_case "Windows line endings and several links on one line"
run $'Summary.\r\n\r\nCloses #10, closes #11\r\n'
check "passes" status_is 0
check "reads both issues" called 10
check "reads #11 too" called 11
check "lists both" output_has "OK: the PR links the open issue(s) #10 #11."

test_case "every number is read once"
run $'Closes #10\nRefs #10\nfixes #0010'
check "passes" status_is 0
check "one API call" call_count 1

test_case "Dependabot is exempt"
run "" "dependabot[bot]"
check "passes" status_is 0
check "says why" output_has "Dependabot PR: exempt from the linked-issue rule"
check "makes no API calls" no_calls

test_case "another bot is not exempt"
run "" "renovate[bot]"
check "fails with the help text" fails_with_help

test_case "usage errors"
: >"$LOG"
set +e
OUT=$(env -u REPO PATH="$WORK/bin:$PATH" FAKE_GH_STATE="$STATE" FAKE_GH_LOG="$LOG" \
  PR_BODY="Closes #10" PR_AUTHOR=anna-example "$SCRIPT" 2>&1)
STATUS=$?
set -e
check "missing REPO exits 2" status_is 2
check "missing REPO makes no API calls" no_calls
: >"$LOG"
set +e
OUT=$(env PATH="$WORK/bin:$PATH" FAKE_GH_STATE="$STATE" FAKE_GH_LOG="$LOG" \
  PR_BODY="Closes #10" PR_AUTHOR=anna-example REPO="acme/wedding demo" "$SCRIPT" 2>&1)
STATUS=$?
set -e
check "an invalid REPO exits 2" status_is 2
check "an invalid REPO makes no API calls" no_calls

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
