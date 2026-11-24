#!/usr/bin/env bash
# Tests for scripts/github/apply-ruleset.sh and the ruleset in .github/rulesets/main.json.
#
# The script runs against the fake `gh` of tests/run.sh (tests/fake-gh), which serves canned
# API responses from tests/fixtures/apply-ruleset.*.json and logs every call, so the tests need
# no network and change nothing on GitHub. They check the ruleset's contract (the merge policy
# of ADR 0009), that a missing ruleset is created, that a matching one is left alone
# (idempotency), that drift is repaired, that --dry-run never writes, and that CI runs and
# non-admins are refused.
#
# Usage: scripts/github/tests/apply-ruleset.test.sh
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPTS=$(cd "$HERE/.." && pwd)
RULESET="$SCRIPTS/../../.github/rulesets/main.json"
FIXTURES="$HERE/fixtures"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
cp "$HERE/fake-gh" "$WORK/bin/gh"
chmod +x "$WORK/bin/gh"
LOG="$WORK/calls.log"
OUT=""
STATUS=0
PASSED=0
FAILED=0

# run STATE_FILE [ARGS...]: run apply-ruleset.sh against the fake gh; sets OUT and STATUS.
run() {
  local state=$1
  shift
  : >"$LOG"
  set +e
  OUT=$(env -u CI -u GITHUB_ACTIONS PATH="$WORK/bin:$PATH" FAKE_GH_STATE="$state" FAKE_GH_LOG="$LOG" \
    "$SCRIPTS/apply-ruleset.sh" --repo acme/wedding-demo "$@" 2>&1)
  STATUS=$?
  set -e
}

# variant BASE_FIXTURE JQ_FILTER: write a modified copy of a fixture and print its path.
variant() {
  local file
  file=$(mktemp "$WORK/state.XXXXXX")
  jq "$2" "$FIXTURES/$1" >"$file"
  printf '%s' "$file"
}

writes() { grep -E '^(POST|PUT|PATCH|DELETE) ' "$LOG" || true; }
write_count() { writes | grep -c . || true; }
# body PREFIX: the JSON body of the last logged call that starts with PREFIX.
body() { grep -F -- "$1 " "$LOG" | tail -n 1 | sed "s|^$1 ||"; }

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

called() { grep -qF -- "$1" "$LOG"; }
output_has() { printf '%s' "$OUT" | grep -qF -- "$1"; }
status_is() { [ "$STATUS" -eq "$1" ]; }
no_writes() { [ "$(write_count)" -eq 0 ]; }
# ruleset_has FILTER: the jq FILTER on main.json yields true.
ruleset_has() { jq -e "$1" "$RULESET" >/dev/null; }
# is_ruleset_file JSON: JSON equals the content of main.json.
is_ruleset_file() { [ "$(printf '%s' "$1" | jq -S -c .)" = "$(jq -S -c . "$RULESET")" ]; }

# ---------------------------------------------------------------------------------------
test_case "main.json: the merge policy of ADR 0009"
: >"$LOG"
check "is named main, active, for branches" ruleset_has \
  '.name == "main" and .enforcement == "active" and .target == "branch"'
check "applies to refs/heads/main only" ruleset_has \
  '.conditions == {ref_name: {include: ["refs/heads/main"], exclude: []}}'
check "nobody can bypass it" ruleset_has '.bypass_actors == []'
check "has exactly the five expected rules" ruleset_has \
  '[.rules[].type] | sort == ["deletion", "non_fast_forward", "pull_request", "required_linear_history", "required_status_checks"]'
check "requires a PR with 0 approvals, squash merges only, no code-owner review" ruleset_has \
  '.rules[] | select(.type == "pull_request") | .parameters
   | .required_approving_review_count == 0 and .allowed_merge_methods == ["squash"]
     and .require_code_owner_review == false'
check "requires ci-ok from GitHub Actions on an up-to-date branch" ruleset_has \
  '.rules[] | select(.type == "required_status_checks") | .parameters
   | .strict_required_status_checks_policy == true
     and .required_status_checks == [{context: "ci-ok", integration_id: 15368}]'

test_case "fresh repository: the ruleset is created"
run "$FIXTURES/apply-ruleset.fresh.json"
check "exits 0" status_is 0
check "lists only the repository's own rulesets" called 'GET repos/acme/wedding-demo/rulesets?includes_parents=false'
check "creates the ruleset with the content of main.json" is_ruleset_file \
  "$(body 'POST repos/acme/wedding-demo/rulesets')"
check "exactly one change" [ "$(write_count)" -eq 1 ]
check "reports the rules it creates" output_has \
  "change   create ruleset main (deletion, non_fast_forward, required_linear_history, pull_request, required_status_checks)"

test_case "fresh repository, dry run: no changes"
run "$FIXTURES/apply-ruleset.fresh.json" --dry-run
check "exits 0" status_is 0
check "no write calls" no_writes
check "reports what would change" output_has "would    create ruleset main"

test_case "configured repository: left alone (idempotent)"
run "$FIXTURES/apply-ruleset.configured.json"
check "exits 0" status_is 0
check "reads the existing ruleset" called 'GET repos/acme/wedding-demo/rulesets/101'
check "no write calls (GitHub's extra fields and defaults are ignored)" no_writes
check "reports nothing to change" output_has "Nothing to change"

test_case "drift is repaired with one update"
state=$(variant apply-ruleset.configured.json '
  .["GET repos/acme/wedding-demo/rulesets/101"] |= (
    .enforcement = "disabled"
    | .bypass_actors = [{actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always"}]
    | .conditions.ref_name.include = ["~ALL"]
    | .rules |= (map(select(.type != "required_linear_history"))
      | map(if .type == "pull_request" then
              .parameters.allowed_merge_methods = ["merge", "squash"]
            elif .type == "required_status_checks" then
              .parameters.strict_required_status_checks_policy = false
            else . end)
      + [{type: "required_signatures"}]))')
run "$state"
check "exits 0" status_is 0
check "updates the existing ruleset with the content of main.json" is_ruleset_file \
  "$(body 'PUT repos/acme/wedding-demo/rulesets/101')"
check "creates nothing" [ -z "$(body 'POST repos/acme/wedding-demo/rulesets')" ]
check "exactly one change" [ "$(write_count)" -eq 1 ]
for problem in "enforcement is disabled" "bypass actors differ" "branch conditions differ" \
  "rule required_linear_history missing" "rule pull_request differs" \
  "rule required_status_checks differs" "extra rule required_signatures"; do
  check "reports: $problem" output_has "$problem"
done

test_case "a ruleset with the same rules in another order matches"
state=$(variant apply-ruleset.configured.json '
  .["GET repos/acme/wedding-demo/rulesets/101"].rules |= reverse')
run "$state"
check "exits 0" status_is 0
check "no write calls" no_writes

test_case "two rulesets named main: refuses to guess"
state=$(variant apply-ruleset.configured.json '
  .["GET repos/acme/wedding-demo/rulesets?includes_parents=false"] += [{id: 102, name: "main", target: "branch"}]')
run "$state"
check "exits non-zero" [ "$STATUS" -ne 0 ]
check "names the problem" output_has "2 rulesets are named main"
check "no write calls" no_writes

test_case "refuses to change a repository without admin rights"
state=$(variant apply-ruleset.fresh.json '.["GET repos/acme/wedding-demo"].permissions.admin = false')
run "$state"
check "exits non-zero" [ "$STATUS" -ne 0 ]
check "no write calls" no_writes

test_case "refuses an invalid ruleset file"
printf '{"rules": []}\n' >"$WORK/invalid.json"
run "$FIXTURES/apply-ruleset.fresh.json" --file "$WORK/invalid.json"
check "exits non-zero" [ "$STATUS" -ne 0 ]
check "makes no gh calls" [ ! -s "$LOG" ]

test_case "refuses to run in CI"
: >"$LOG"
set +e
OUT=$(GITHUB_ACTIONS=true PATH="$WORK/bin:$PATH" FAKE_GH_STATE="$FIXTURES/apply-ruleset.fresh.json" \
  FAKE_GH_LOG="$LOG" "$SCRIPTS/apply-ruleset.sh" --repo acme/wedding-demo 2>&1)
STATUS=$?
set -e
check "exits non-zero" [ "$STATUS" -ne 0 ]
check "makes no gh calls" [ ! -s "$LOG" ]

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
