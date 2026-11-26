#!/usr/bin/env bash
# Tests for scripts/ops/lockdown.sh and scripts/ops/uptime.sh.
#
# The scripts run against a fake `gh` (tests/fake-gh) and a fake `curl` (tests/fake-curl) that
# serve canned responses and log every call, so the tests need no network and change nothing on
# GitHub or Azure. They check what each script writes or requests, that --dry-run never writes,
# that CI runs of lockdown.sh are refused, and that no output ever contains a hostname.
#
# Usage: scripts/ops/tests/run.sh
# shellcheck disable=SC2016 # $variables and \(...) in the single-quoted jq filters are jq's
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPTS=$(cd "$HERE/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
cp "$HERE/fake-gh" "$WORK/bin/gh"
cp "$HERE/fake-curl" "$WORK/bin/curl"
chmod +x "$WORK/bin/gh" "$WORK/bin/curl"
LOG="$WORK/calls.log"
GH_STATE="$WORK/gh.json"
CURL_STATE="$WORK/curl.json"
OUTPUT_FILE="$WORK/github-output"
SUMMARY_FILE="$WORK/step-summary"
REPO="acme/wedding-demo"
HOST_E2E="wp-e2e.example.com"
HOST_TEST="wp-test.example.com"
HOST_PRODUCTION="wp-production.example.com"
OUT=""
STATUS=0
PASSED=0
FAILED=0

# lockdown ARGS...: run lockdown.sh against the fake gh with $GH_STATE; sets OUT and STATUS.
lockdown() {
  : >"$LOG"
  set +e
  OUT=$(env -u CI -u GITHUB_ACTIONS PATH="$WORK/bin:$PATH" FAKE_GH_STATE="$GH_STATE" FAKE_GH_LOG="$LOG" \
    "$SCRIPTS/lockdown.sh" "$@" 2>&1)
  STATUS=$?
  set -e
}

# uptime ARGS...: run uptime.sh against the fakes, with the hosts in UPTIME_* of the caller's
# environment (`VAR=value uptime ...`); sets OUT and STATUS.
uptime() {
  : >"$LOG"
  : >"$OUTPUT_FILE"
  : >"$SUMMARY_FILE"
  set +e
  OUT=$(env -u GITHUB_ACTIONS PATH="$WORK/bin:$PATH" FAKE_GH_STATE="$GH_STATE" FAKE_GH_LOG="$LOG" \
    FAKE_CURL_STATE="$CURL_STATE" FAKE_CURL_LOG="$LOG" UPTIME_RETRY_SECONDS=0 \
    GITHUB_OUTPUT="$OUTPUT_FILE" GITHUB_STEP_SUMMARY="$SUMMARY_FILE" \
    "$SCRIPTS/uptime.sh" "$@" 2>&1)
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

writes() { grep -E '^(POST|PUT|PATCH|DELETE) ' "$LOG" || true; }
no_writes() { [ -z "$(writes)" ]; }
write_count() { [ "$(writes | grep -c .)" -eq "$1" ]; }
called() { grep -qF -- "$1" "$LOG"; }
not_called() { ! grep -qF -- "$1" "$LOG"; }
no_calls() { [ ! -s "$LOG" ]; }
output_has() { printf '%s' "$OUT" | grep -qF -- "$1"; }
output_lacks() { ! printf '%s' "$OUT" | grep -qF -- "$1"; }
status_is() { [ "$STATUS" -eq "$1" ]; }
# body_of PREFIX: the JSON body of the first logged call that starts with "PREFIX ".
body_of() { grep -F -- "$1 " "$LOG" | head -n 1 | sed "s|^$1 ||"; }
body_is() { [ "$(body_of "$1" | jq -c "$2")" = "true" ]; }
github_output_has() { grep -qxF -- "$1" "$OUTPUT_FILE"; }
summary_has() { grep -qF -- "$1" "$SUMMARY_FILE"; }
no_host_anywhere() {
  local host
  for host in "$HOST_E2E" "$HOST_TEST" "$HOST_PRODUCTION"; do
    if printf '%s' "$OUT" | grep -qF "$host" || grep -qF "$host" "$OUTPUT_FILE" "$SUMMARY_FILE"; then
      return 1
    fi
  done
}

# gh_state JQ_FILTER: write $GH_STATE from the base state, modified by JQ_FILTER.
gh_state() {
  jq -n --arg r "$REPO" '{
    "repo view": $r,
    "GET repos/\($r)/environments/e2e": {name: "e2e"},
    "GET repos/\($r)/environments/test": {name: "test"},
    "GET repos/\($r)/environments/production": {name: "production"},
    "GET repos/\($r)/actions/workflows/deploy.yml": {state: "active"},
    "POST repos/\($r)/actions/workflows/deploy.yml/dispatches": "__204__"
  }' | jq --arg r "$REPO" "${1:-.}" >"$GH_STATE"
}

VAR_PATH="repos/$REPO/environments/test/variables"
PROD_VAR_PATH="repos/$REPO/environments/production/variables"
DISPATCH="POST repos/$REPO/actions/workflows/deploy.yml/dispatches"

# ---------------------------------------------------------------------------------------------
# lockdown.sh

test_case "lockdown on: creates API_LOCKDOWN=true and redeploys the environment"
gh_state
lockdown on --env test --repo "$REPO"
check "exit 0" status_is 0
check "creates the variable" body_is "POST $VAR_PATH" '. == {name: "API_LOCKDOWN", value: "true"}'
check "starts deploy.yml on main for test only" body_is "$DISPATCH" '. == {ref: "main", inputs: {environment: "test"}}'
check "two writes" write_count 2
check "checks the workflow first" called "GET repos/$REPO/actions/workflows/deploy.yml"
check "says when it takes effect" output_has "Lockdown on for test in about 5 minutes"

test_case "lockdown on: already true changes nothing but still redeploys"
gh_state '. + {"GET repos/\($r)/environments/test/variables/API_LOCKDOWN": {name: "API_LOCKDOWN", value: "true"}}'
lockdown on --env test --repo "$REPO"
check "exit 0" status_is 0
check "reports it" output_has "API_LOCKDOWN is already true"
check "only the dispatch is written" write_count 1
check "dispatch sent" called "$DISPATCH"

test_case "lockdown on: a value of false is updated"
gh_state '. + {"GET repos/\($r)/environments/test/variables/API_LOCKDOWN": {name: "API_LOCKDOWN", value: "false"}}'
lockdown on --env test --repo "$REPO"
check "exit 0" status_is 0
check "updates the variable" body_is "PATCH $VAR_PATH/API_LOCKDOWN" '.value == "true"'
check "does not create it" not_called "POST $VAR_PATH "

test_case "lockdown off: deletes the variable and redeploys"
gh_state '. + {"GET repos/\($r)/environments/test/variables/API_LOCKDOWN": {name: "API_LOCKDOWN", value: "true"}}'
lockdown off --env test --repo "$REPO"
check "exit 0" status_is 0
check "deletes the variable" called "DELETE $VAR_PATH/API_LOCKDOWN"
check "redeploys" body_is "$DISPATCH" '.inputs == {environment: "test"}'
check "says when it takes effect" output_has "Lockdown off for test"

test_case "lockdown off: nothing set, only a redeploy"
gh_state
lockdown off --env test --repo "$REPO"
check "exit 0" status_is 0
check "reports it" output_has "not set (lockdown off)"
check "only the dispatch is written" write_count 1

test_case "lockdown off: a repository-level lockdown is overridden with false"
gh_state '. + {"GET repos/\($r)/actions/variables/API_LOCKDOWN": {name: "API_LOCKDOWN", value: "true"},
  "GET repos/\($r)/environments/test/variables/API_LOCKDOWN": {name: "API_LOCKDOWN", value: "true"}}'
lockdown off --env test --repo "$REPO"
check "exit 0" status_is 0
check "warns about the repository variable" output_has "repository variable API_LOCKDOWN is on"
check "sets the environment value to false" body_is "PATCH $VAR_PATH/API_LOCKDOWN" '.value == "false"'
check "does not delete it" not_called "DELETE "

test_case "lockdown --dry-run: reads, but writes and starts nothing"
gh_state
lockdown on --env production --repo "$REPO" --dry-run
check "exit 0" status_is 0
check "no writes" no_writes
check "reports the variable" output_has "would    create API_LOCKDOWN = true"
check "reports the deploy" output_has "would    start deploy.yml for production"
check "says it was a dry run" output_has "Dry run: nothing was changed"

test_case "lockdown --no-deploy: sets the variable only"
gh_state
lockdown on --env e2e --repo "$REPO" --no-deploy
check "exit 0" status_is 0
check "creates the variable" called "POST repos/$REPO/environments/e2e/variables "
check "starts no deploy" not_called "$DISPATCH"
check "does not need the workflow" not_called "GET repos/$REPO/actions/workflows/deploy.yml"
check "says it waits for the next deploy" output_has "once e2e is deployed next"

test_case "lockdown production: pinned commits, approval note"
gh_state
lockdown on --env production --repo "$REPO" --ref 0123456789abcdef0123456789abcdef01234567 --instance-ref main
check "exit 0" status_is 0
check "creates the production variable" called "POST $PROD_VAR_PATH "
check "passes ref and instance-ref" body_is "$DISPATCH" \
  '. == {ref: "main", inputs: {environment: "production", ref: "0123456789abcdef0123456789abcdef01234567", "instance-ref": "main"}}'
check "mentions the approval" output_has "production waits for your approval"
check "no head-of-main note with --ref" output_lacks "--ref <deployed commit>"

test_case "lockdown production without --ref: notes that the head of main is deployed"
gh_state
lockdown off --env production --repo "$REPO"
check "exit 0" status_is 0
check "notes the head of main" output_has "re-run with --ref <deployed commit>"

test_case "lockdown resolves the repository with gh repo view"
gh_state
lockdown on --env e2e
check "exit 0" status_is 0
check "asked gh" called "REPO_VIEW"
check "used it" called "POST repos/$REPO/environments/e2e/variables "

test_case "lockdown refuses a missing environment, changing nothing"
gh_state 'del(."GET repos/\($r)/environments/test")'
lockdown on --env test --repo "$REPO"
check "exit 1" status_is 1
check "explains" output_has "setup-repo.sh"
check "no writes" no_writes

test_case "lockdown refuses a disabled deploy workflow, changing nothing"
gh_state '."GET repos/\($r)/actions/workflows/deploy.yml" = {state: "disabled_manually"}'
lockdown on --env test --repo "$REPO"
check "exit 1" status_is 1
check "explains" output_has "deploy.yml is disabled_manually"
check "no writes" no_writes

test_case "lockdown stops when a write fails"
gh_state '."POST repos/\($r)/environments/test/variables" = {"__error": "Resource not accessible (HTTP 403)"}'
lockdown on --env test --repo "$REPO"
check "exit 1" status_is 1
check "no deploy after the failure" not_called "$DISPATCH"

test_case "lockdown refuses to run in CI"
gh_state
: >"$LOG"
set +e
OUT=$(GITHUB_ACTIONS=true PATH="$WORK/bin:$PATH" FAKE_GH_STATE="$GH_STATE" FAKE_GH_LOG="$LOG" \
  "$SCRIPTS/lockdown.sh" on --env test --repo "$REPO" 2>&1)
STATUS=$?
set -e
check "exit 1" status_is 1
check "explains" output_has "never by CI"
check "no gh calls" no_calls

test_case "lockdown usage errors exit 2 without calling gh"
gh_state
for args in "" "maybe --env test" "on" "on --env staging" "on --env e2e --instance-ref main" \
  "on --env test --ref ../main" "on --env test --no-deploy --ref main" "status --env test" "on --env"; do
  # shellcheck disable=SC2086 # word splitting of the argument list is intended
  lockdown $args
  check "'$args' exits 2" status_is 2
  check "'$args' makes no gh calls" no_calls
done

test_case "lockdown status: every environment, no writes"
gh_state '. + {"GET repos/\($r)/environments/production/variables/API_LOCKDOWN": {name: "API_LOCKDOWN", value: "true"},
  "GET repos/\($r)/environments/test/variables/API_LOCKDOWN": {name: "API_LOCKDOWN", value: "yes"}}
  | del(."GET repos/\($r)/environments/e2e")'
lockdown status --repo "$REPO"
check "exit 0" status_is 0
check "no writes" no_writes
check "e2e has no environment" output_has "e2e         no GitHub Environment"
check "test value is invalid" output_has "test        invalid value"
check "production is on" output_has "production  on"

# ---------------------------------------------------------------------------------------------
# uptime.sh check

SHA=0123456789abcdef0123456789abcdef01234567
# site HOST IS_SAMPLE: canned answers of a healthy deployment.
site() {
  jq -n --arg h "$1" --arg sha "$SHA" --argjson s "$2" '{
    "\($h)/": {code: 200},
    "\($h)/version.json": {code: 200, body: ({sha: $sha, contentHash: "abc", isSample: $s} | tojson)},
    "\($h)/api/health": {code: 200, time: "0.08"},
    "\($h)/api/rsvp/status": {code: 200, time: "0.31"}
  }'
}
# curl_state JQ_FILTER: three healthy environments, modified by JQ_FILTER ($e, $t, $p = hosts).
curl_state() {
  jq -s 'add' <(site "$HOST_E2E" true) <(site "$HOST_TEST" false) <(site "$HOST_PRODUCTION" false) |
    jq --arg e "$HOST_E2E" --arg t "$HOST_TEST" --arg p "$HOST_PRODUCTION" "${1:-.}" >"$CURL_STATE"
}
export UPTIME_HOST_E2E UPTIME_HOST_TEST UPTIME_HOST_PRODUCTION
all_hosts() {
  UPTIME_HOST_E2E=$HOST_E2E
  UPTIME_HOST_TEST="https://$HOST_TEST/"
  UPTIME_HOST_PRODUCTION="$HOST_PRODUCTION"$'\n'
}

test_case "check: every environment up"
all_hosts
curl_state
uptime check
check "exit 0" status_is 0
check "e2e up" output_has "e2e         up       home 200, version.json 200 (0123456), /api/health 200"
check "test up (https:// origin accepted)" output_has "test        up"
check "production up" output_has "production  up"
check "output checked" github_output_has "checked=e2e test production"
check "output down is empty" github_output_has "down="
check "output completed" github_output_has "completed=true"
check "summary table" summary_has "| production | up | home 200"
check "only GET requests to the three hosts" [ "$(grep -c '^GET https://' "$LOG")" -eq 9 ]
check "no hostname in any output" no_host_anywhere

test_case "check: environments without a host are skipped"
UPTIME_HOST_E2E=$HOST_E2E
UPTIME_HOST_TEST=""
UPTIME_HOST_PRODUCTION=""
curl_state
uptime check
check "exit 0" status_is 0
check "test skipped" output_has "test        skipped  no UPTIME_HOST_TEST"
check "output checked" github_output_has "checked=e2e"
check "no request to a skipped environment" not_called "$HOST_TEST"

test_case "check: nothing configured"
UPTIME_HOST_E2E=""
uptime check
check "exit 0" status_is 0
check "says so" output_has "nothing was checked"
check "output checked is empty" github_output_has "checked="
check "no requests" no_calls

test_case "check: production home page down (confirmed by a second round)"
all_hosts
curl_state '.["\($p)/"] = {code: 503}'
uptime check
check "exit 1" status_is 1
check "production down" output_has "production  down     home 503"
check "output down" github_output_has "down=production"
check "output completed" github_output_has "completed=true"
check "checked twice before alerting" [ "$(grep -cxF "GET https://$HOST_PRODUCTION/" "$LOG")" -eq 2 ]
check "no hostname in any output" no_host_anywhere

test_case "check: a blip that recovers on the second round is not down"
curl_state '.["\($t)/"] = [{code: 502}, {code: 200}]'
uptime check
check "exit 0" status_is 0
check "test up" output_has "test        up"

test_case "check: edge lockdown is reported, not down"
curl_state '.["\($p)/api/health"] = {code: 302, redirect: "https://\($p)/.auth/login/aad?post_login_redirect_uri=/api/health"}
  | .["\($t)/api/health"] = {code: 401}'
uptime check
check "exit 0" status_is 0
check "production locked" output_has "production  locked   home 200, version.json 200 (0123456), /api/health 302, API locked down"
check "test locked" output_has "test        locked"
check "no retries for a lockdown" [ "$(grep -cxF "GET https://$HOST_PRODUCTION/api/health" "$LOG")" -eq 1 ]
check "no hostname in any output" no_host_anywhere

test_case "check: a redirect elsewhere is down"
curl_state '.["\($p)/api/health"] = {code: 302, redirect: "https://\($p)/somewhere"}'
uptime check
check "exit 1" status_is 1
check "production down" output_has "production  down"

test_case "check: a cold API is retried"
curl_state '.["\($e)/api/health"] = [{exit: 28}, {code: 200}]'
uptime check
check "exit 0" status_is 0
check "e2e up on attempt 2" output_has "/api/health 200 (attempt 2)"

test_case "check: an API that keeps failing is down"
curl_state '.["\($e)/api/health"] = {code: 500}'
uptime check
check "exit 1" status_is 1
check "e2e down after three attempts" output_has "e2e         down     home 200, version.json 200 (0123456), /api/health 500 (attempt 3)"
check "output down" github_output_has "down=e2e"

test_case "check: version.json must name a commit and the right instance kind"
curl_state '.["\($p)/version.json"].body = ({sha: "0123456789abcdef0123456789abcdef01234567", isSample: true} | tojson)
  | .["\($t)/version.json"].body = "{\"sha\": \"main\"}"'
uptime check
check "exit 1" status_is 1
check "sample content on production is down" output_has "(0123456, isSample is not false)"
check "missing SHA is down" output_has "(no commit SHA)"
check "output down" github_output_has "down=test production"

test_case "check: an unreachable host is down"
curl_state 'del(.["\($e)/"], .["\($e)/version.json"], .["\($e)/api/health"])'
uptime check
check "exit 1" status_is 1
check "e2e down" output_has "e2e         down     home 000, version.json 000, /api/health 000"

test_case "check: --env limits the environments"
curl_state
uptime check --env production
check "exit 0" status_is 0
check "output checked" github_output_has "checked=production"
check "no e2e request" not_called "$HOST_E2E"

test_case "check: an invalid host stops before any request"
UPTIME_HOST_TEST="https://$HOST_TEST/path"
uptime check
check "exit 2" status_is 2
check "names the variable" output_has "UPTIME_HOST_TEST is not a hostname"
check "never prints the value" no_host_anywhere
check "no requests" no_calls
check "not completed" [ ! -s "$OUTPUT_FILE" ]
all_hosts

test_case "check: masks the hosts in GitHub Actions"
curl_state
: >"$LOG"
set +e
OUT=$(GITHUB_ACTIONS=true PATH="$WORK/bin:$PATH" FAKE_CURL_STATE="$CURL_STATE" FAKE_CURL_LOG="$LOG" \
  UPTIME_RETRY_SECONDS=0 GITHUB_OUTPUT="$OUTPUT_FILE" GITHUB_STEP_SUMMARY="$SUMMARY_FILE" \
  "$SCRIPTS/uptime.sh" check 2>&1)
STATUS=$?
set -e
check "exit 0" status_is 0
check "masks every host" [ "$(printf '%s\n' "$OUT" | grep -c '^::add-mask::')" -eq 3 ]
check "hosts appear only in the mask commands" [ "$(printf '%s\n' "$OUT" | grep -v '^::add-mask::' | grep -c 'example.com' || true)" -eq 0 ]

# ---------------------------------------------------------------------------------------------
# uptime.sh cold-start

test_case "cold-start: health, RSVP status, warm health, with durations"
curl_state '.["\($e)/api/health"] = [{code: 200, time: "6.4321"}, {code: 200, time: "0.0712"}]'
uptime cold-start
check "exit 0" status_is 0
check "requests in order" [ "$(grep -o '/api/.*' "$LOG" | tr '\n' ' ')" = "/api/health /api/rsvp/status /api/health " ]
check "first health" output_has "first /api/health  200  6.43 s"
check "rsvp status" output_has "/api/rsvp/status   200  0.31 s"
check "warm health" output_has "warm /api/health   200  0.07 s"
check "summary row" summary_has "| first \`/api/health\` | 200 | 6.43 |"
check "output durations" github_output_has "first-health-seconds=6.43"
check "only e2e" not_called "$HOST_PRODUCTION"
check "no hostname in any output" no_host_anywhere

test_case "cold-start: a failing API is reported, not fatal"
curl_state '.["\($e)/api/health"] = {exit: 28, time: "120.001"}'
uptime cold-start
check "exit 0" status_is 0
check "reports the timeout" output_has "first /api/health  000  120.00 s"
check "warns" output_has "warning: the first /api/health answered 000"

test_case "cold-start: skipped without a host"
UPTIME_HOST_E2E=""
uptime cold-start
check "exit 0" status_is 0
check "says skipped" output_has "e2e: skipped, no UPTIME_HOST_E2E"
check "no requests" no_calls
all_hosts

test_case "cold-start: one environment only"
uptime cold-start --env e2e --env test
check "exit 2" status_is 2

# ---------------------------------------------------------------------------------------------
# uptime.sh incident

ISSUES="GET repos/$REPO/issues?labels=incident&state=open&per_page=100"
# issue_state JQ_FILTER: the label exists and the open incident issues are JQ_FILTER's list.
issue_state() {
  jq -n --arg r "$REPO" --arg k "$ISSUES" '{
    "GET repos/\($r)/labels/incident": {name: "incident"},
    ($k): [],
    "POST repos/\($r)/issues": {number: 7}
  }' | jq --arg k "$ISSUES" --arg m "<!-- uptime-check -->" "${1:-.}" >"$GH_STATE"
}
NOT_OURS='{number: 3, title: "Budget alert", body: "cost spike"}'
OURS='{number: 5, title: "Uptime check failing: production", body: "\($m)\nThe scheduled uptime check"}'

test_case "incident: opens one issue naming only the environments"
issue_state ".[\$k] = [$NOT_OURS] | del(.\"GET repos/$REPO/labels/incident\")"
uptime incident --repo "$REPO" --down "production e2e" --run "uptime workflow run #12"
check "exit 0" status_is 0
check "creates the label" body_is "POST repos/$REPO/labels" '.name == "incident"'
check "opens the issue" body_is "POST repos/$REPO/issues" \
  '.title == "Uptime check failing: e2e, production" and .labels == ["incident"]'
check "marks it" body_is "POST repos/$REPO/issues" '.body | startswith("<!-- uptime-check -->")'
check "names the environments" body_is "POST repos/$REPO/issues" '.body | contains("**e2e**, **production**")'
check "names the run" body_is "POST repos/$REPO/issues" '.body | contains("uptime workflow run #12")'
check "no URL in the issue" body_is "POST repos/$REPO/issues" '.body | test("https?:|example") | not'
check "reports it" output_has "opened incident issue #7"

test_case "incident: same environments, issue unchanged"
issue_state ".[\$k] = [$OURS]"
uptime incident --repo "$REPO" --down "production"
check "exit 0" status_is 0
check "no writes" no_writes
check "reports it" output_has "#5 is open for: production (unchanged)"

test_case "incident: a changed set retitles and comments"
issue_state ".[\$k] = [$OURS]"
uptime incident --repo "$REPO" --down "test production" --run "uptime workflow run #13"
check "exit 0" status_is 0
check "retitles" body_is "PATCH repos/$REPO/issues/5" '. == {title: "Uptime check failing: test, production"}'
check "comments" body_is "POST repos/$REPO/issues/5/comments" \
  '.body == "Now failing: **test**, **production** (uptime workflow run #13)."'
check "opens no second issue" not_called "POST repos/$REPO/issues "

test_case "incident: nothing down closes the issue"
issue_state ".[\$k] = [$OURS, $NOT_OURS]"
uptime incident --repo "$REPO" --down ""
check "exit 0" status_is 0
check "comments" body_is "POST repos/$REPO/issues/5/comments" '.body | startswith("Every checked environment is up again")'
check "closes" body_is "PATCH repos/$REPO/issues/5" '.state == "closed" and .state_reason == "completed"'
check "leaves other incident issues alone" not_called "repos/$REPO/issues/3"

test_case "incident: nothing down and no issue"
issue_state ".[\$k] = [$NOT_OURS]"
uptime incident --repo "$REPO" --down ""
check "exit 0" status_is 0
check "no writes" no_writes

test_case "incident: GITHUB_REPOSITORY and GITHUB_RUN_NUMBER are the defaults"
issue_state
: >"$LOG"
set +e
OUT=$(PATH="$WORK/bin:$PATH" FAKE_GH_STATE="$GH_STATE" FAKE_GH_LOG="$LOG" GITHUB_REPOSITORY="$REPO" \
  GITHUB_RUN_NUMBER=42 "$SCRIPTS/uptime.sh" incident --down test 2>&1)
STATUS=$?
set -e
check "exit 0" status_is 0
check "names the run" body_is "POST repos/$REPO/issues" '.body | contains("uptime workflow run #42")'

test_case "incident: listing fails"
issue_state ".[\$k] = {\"__error\": \"Bad credentials (HTTP 401)\"}"
uptime incident --repo "$REPO" --down test
check "exit 1" status_is 1
check "no writes" no_writes

test_case "incident: usage errors exit 2"
issue_state
uptime incident --repo "$REPO" --down "staging"
check "unknown environment exits 2" status_is 2
check "no gh calls" no_calls
uptime incident --down "test"
check "missing repo exits 2" status_is 2
uptime bogus
check "unknown command exits 2" status_is 2

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
