#!/usr/bin/env bash
# Tests for scripts/github/setup-repo.sh and create-project.sh.
#
# The scripts run against a fake `gh` (tests/fake-gh) that serves canned API responses from
# tests/fixtures/*.json and logs every call, so the tests need no network and change nothing
# on GitHub. They check that a fresh repository gets every expected change, that a configured
# one gets none (idempotency), that --dry-run never writes, and that CI runs are refused.
#
# Usage: scripts/github/tests/run.sh
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPTS=$(cd "$HERE/.." && pwd)
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
CURRENT=""

# run SCRIPT STATE_FILE [ARGS...]: run a script against the fake gh; sets OUT and STATUS.
run() {
  local script=$1 state=$2
  shift 2
  : >"$LOG"
  set +e
  OUT=$(env -u CI -u GITHUB_ACTIONS PATH="$WORK/bin:$PATH" FAKE_GH_STATE="$state" FAKE_GH_LOG="$LOG" \
    "$SCRIPTS/$script" --repo acme/wedding-demo "$@" 2>&1)
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

writes() { grep -E '^(POST|PUT|PATCH|DELETE|MUTATION) ' "$LOG" || true; }
write_count() { writes | grep -c . || true; }
# first_body / last_body PREFIX: the JSON body (or GraphQL variables) of the first / last
# logged call that starts with PREFIX.
first_body() { grep -F -- "$1 " "$LOG" | head -n 1 | sed "s|^$1 ||"; }
last_body() { grep -F -- "$1 " "$LOG" | tail -n 1 | sed "s|^$1 ||"; }

test_case() {
  CURRENT=$1
  printf '\n%s\n' "$CURRENT"
}

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
not_called() { ! grep -qF -- "$1" "$LOG"; }
output_has() { printf '%s' "$OUT" | grep -qF -- "$1"; }
status_is() { [ "$STATUS" -eq "$1" ]; }
no_writes() { [ "$(write_count)" -eq 0 ]; }
json_true() { [ "$(printf '%s' "$1" | jq "$2")" = "true" ]; }

# ---------------------------------------------------------------------------------------
# setup-repo.sh

test_case "setup-repo: fresh repository gets every setting"
run setup-repo.sh "$FIXTURES/setup-repo.fresh.json"
check "exits 0" status_is 0
check "squash only, PR title, auto-merge, update branch, delete branch" json_true \
  "$(first_body 'PATCH repos/acme/wedding-demo')" \
  '.allow_merge_commit == false and .allow_rebase_merge == false and .squash_merge_commit_title == "PR_TITLE"
   and .allow_auto_merge == true and .allow_update_branch == true and .delete_branch_on_merge == true'
check "enables secret scanning" called 'PATCH repos/acme/wedding-demo {"security_and_analysis":{"secret_scanning":{"status":"enabled"}}}'
check "enables push protection" called '{"security_and_analysis":{"secret_scanning_push_protection":{"status":"enabled"}}}'
check "enables Dependabot alerts" called 'PUT repos/acme/wedding-demo/vulnerability-alerts'
check "enables private vulnerability reporting" called 'PUT repos/acme/wedding-demo/private-vulnerability-reporting'
check "configures CodeQL default setup" called 'PATCH repos/acme/wedding-demo/code-scanning/default-setup {"state":"configured","query_suite":"default"}'
check "requires approval for all outside contributors" called '{"approval_policy":"all_external_contributors"}'
check "makes GITHUB_TOKEN read-only" called '{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}'
for env in e2e test; do
  check "creates $env: custom branch policies, no admin bypass, no reviewers" json_true \
    "$(last_body "PUT repos/acme/wedding-demo/environments/$env")" \
    '.deployment_branch_policy == {protected_branches: false, custom_branch_policies: true}
     and .can_admins_bypass == false and .reviewers == null'
done
check "creates production: owner as reviewer, self-review allowed, no admin bypass" json_true \
  "$(last_body 'PUT repos/acme/wedding-demo/environments/production')" \
  '.reviewers == [{type: "User", id: 4242}] and .prevent_self_review == false
   and .can_admins_bypass == false
   and .deployment_branch_policy == {protected_branches: false, custom_branch_policies: true}'
for env in e2e test production; do
  check "allows deployments to $env from main" called \
    "POST repos/acme/wedding-demo/environments/$env/deployment-branch-policies {\"name\":\"main\",\"type\":\"branch\"}"
done

test_case "setup-repo: dry run makes no changes"
run setup-repo.sh "$FIXTURES/setup-repo.fresh.json" --dry-run
check "exits 0" status_is 0
check "no write calls" no_writes
check "reports what would change" output_has "would    create environment production"

test_case "setup-repo: configured repository is left alone (idempotent)"
run setup-repo.sh "$FIXTURES/setup-repo.configured.json"
check "exits 0" status_is 0
check "no write calls" no_writes
check "reports nothing to change" output_has "Nothing to change"

test_case "setup-repo: drift is repaired and existing reviewers are kept"
state=$(variant setup-repo.configured.json '
  .["GET repos/acme/wedding-demo/environments/production"].protection_rules[0] =
    {type: "required_reviewers", prevent_self_review: true,
     reviewers: [{type: "Team", reviewer: {id: 77, slug: "maintainers"}}]}
  | .["GET repos/acme/wedding-demo/environments/e2e"].can_admins_bypass = true
  | .["GET repos/acme/wedding-demo/environments/test/deployment-branch-policies"].branch_policies +=
    [{id: 22, name: "release/*", type: "branch"}]')
run setup-repo.sh "$state"
check "exits 0" status_is 0
check "production gets the owner added, keeps the team, self-review allowed" json_true \
  "$(last_body 'PUT repos/acme/wedding-demo/environments/production')" \
  '(.reviewers | sort_by(.id)) == [{type: "Team", id: 77}, {type: "User", id: 4242}]
   and .prevent_self_review == false'
check "e2e admin bypass is switched off" json_true \
  "$(last_body 'PUT repos/acme/wedding-demo/environments/e2e')" '.can_admins_bypass == false'
check "extra branch policy on test is removed" called \
  'DELETE repos/acme/wedding-demo/environments/test/deployment-branch-policies/22'
check "main policy on test is kept" not_called \
  'DELETE repos/acme/wedding-demo/environments/test/deployment-branch-policies/21'
check "test environment itself is unchanged" not_called 'PUT repos/acme/wedding-demo/environments/test'
check "exactly three changes" [ "$(write_count)" -eq 3 ]

test_case "setup-repo: CodeQL failure is a warning, not an error"
state=$(variant setup-repo.fresh.json '
  .["PATCH repos/acme/wedding-demo/code-scanning/default-setup"] =
    {__error: "no supported languages found (HTTP 422)"}')
run setup-repo.sh "$state"
check "exits 0" status_is 0
check "warns and suggests a re-run" output_has "re-run this script once the repository contains code"
check "still configures the environments" called 'PUT repos/acme/wedding-demo/environments/production'

test_case "setup-repo: refuses to change a repository without admin rights"
state=$(variant setup-repo.fresh.json '.["GET repos/acme/wedding-demo"].permissions.admin = false')
run setup-repo.sh "$state"
check "exits non-zero" [ "$STATUS" -ne 0 ]
check "no write calls" no_writes

test_case "setup-repo: refuses to run in CI"
: >"$LOG"
set +e
OUT=$(GITHUB_ACTIONS=true PATH="$WORK/bin:$PATH" FAKE_GH_STATE="$FIXTURES/setup-repo.fresh.json" \
  FAKE_GH_LOG="$LOG" "$SCRIPTS/setup-repo.sh" --repo acme/wedding-demo 2>&1)
STATUS=$?
set -e
check "exits non-zero" [ "$STATUS" -ne 0 ]
check "makes no gh calls" [ ! -s "$LOG" ]

# ---------------------------------------------------------------------------------------
# create-project.sh

test_case "create-project: fresh repository gets labels, milestones, project and fields"
run create-project.sh "$FIXTURES/create-project.fresh.json"
check "exits 0" status_is 0
check "creates 14 missing labels" [ "$(grep -c '^POST repos/acme/wedding-demo/labels ' "$LOG")" -eq 14 ]
check "creates blocked and incident labels" called '"name":"blocked"'
check "fixes the color of an existing label" json_true \
  "$(last_body 'PATCH repos/acme/wedding-demo/labels/area%3Aweb')" \
  '.new_name == "area:web" and .color == "1d76db"'
check "creates 4 milestones" [ "$(grep -c '^POST repos/acme/wedding-demo/milestones ' "$LOG")" -eq 4 ]
check "creates the project linked to the repository" json_true "$(last_body 'MUTATION CreateProject')" \
  '. == {ownerId: "U_acme", title: "wedding-demo", repositoryId: "R_demo"}'
check "adds In Review to Status, keeping option ids and order" json_true \
  "$(last_body 'MUTATION UpdateSingleSelectField')" \
  '.fieldId == "F_status"
   and (.options | map(.name)) == ["Todo", "In progress", "In Review", "Done"]
   and (.options | map(.id)) == ["o_todo", "o_prog", null, "o_done"]'
check "creates Stage, Area and Size" [ "$(grep -c '^MUTATION CreateSingleSelectField ' "$LOG")" -eq 3 ]
check "Area has the eight areas" json_true \
  "$(grep -F '"name":"Area"' "$LOG" | sed 's|^MUTATION CreateSingleSelectField ||')" \
  '(.options | map(.name)) == ["web", "api", "infra", "ci", "content", "docs", "e2e", "ops"]'
check "creates the Expert text field" called 'MUTATION CreateTextField {"projectId":"PVT_new","name":"Expert"}'

test_case "create-project: dry run makes no changes"
run create-project.sh "$FIXTURES/create-project.fresh.json" --dry-run
check "exits 0" status_is 0
check "no write calls" no_writes
check "reports the project it would create" output_has 'would    create project "wedding-demo"'
check "reports the Status option it would add" output_has "would    add options In Review to field Status"

test_case "create-project: configured repository is left alone (idempotent)"
run create-project.sh "$FIXTURES/create-project.configured.json"
check "exits 0" status_is 0
check "no write calls" no_writes
check "reports nothing to change" output_has "Nothing to change"

test_case "create-project: an unlinked project is linked, not recreated"
state=$(variant create-project.configured.json '
  .["graphql ProjectsByOwner"].data.repositoryOwner.projectsV2.nodes[1].repositories.nodes = []')
run create-project.sh "$state"
check "exits 0" status_is 0
check "links the project" json_true "$(last_body 'MUTATION LinkProject')" \
  '. == {projectId: "PVT_demo", repositoryId: "R_demo"}'
check "does not create a project" not_called 'MUTATION CreateProject'
check "exactly one change" [ "$(write_count)" -eq 1 ]

test_case "create-project: refuses to run in CI"
: >"$LOG"
set +e
OUT=$(CI=true PATH="$WORK/bin:$PATH" FAKE_GH_STATE="$FIXTURES/create-project.fresh.json" \
  FAKE_GH_LOG="$LOG" "$SCRIPTS/create-project.sh" --repo acme/wedding-demo 2>&1)
STATUS=$?
set -e
check "exits non-zero" [ "$STATUS" -ne 0 ]
check "makes no gh calls" [ ! -s "$LOG" ]

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
