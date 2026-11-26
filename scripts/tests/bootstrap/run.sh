#!/usr/bin/env bash
# Tests for scripts/bootstrap.sh.
#
# The script runs against a fake `az` (fake-az, a small stateful simulator) and a fake `gh`
# (fake-gh, canned API responses from fixtures/*.json); both log every call. ssh-keygen, git and
# jq are the real tools. The script is copied into a throwaway repository layout with a fixture
# sample instance, so no network access is needed and nothing in Azure or on GitHub changes.
#
# Covered: fresh and configured (idempotent) runs for e2e and test, the deploy key lifecycle
# (create, keep, rotate, repair), the nightly backup environment backup-<env> and its identity,
# every precondition that must stop the script before it changes anything, the RBAC replication
# retry, and that no email, id, instance repo name or private key is ever printed and the
# temporary files are deleted.
#
# Usage: scripts/tests/bootstrap/run.sh
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
FIXTURES="$HERE/fixtures"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Throwaway repository layout: scripts/bootstrap.sh, infra/bootstrap/main.bicep and a fixture
# samples/instance/instance.json (the real sample instance belongs to another task).
FAKE_REPO="$WORK/repo"
mkdir -p "$FAKE_REPO/scripts" "$FAKE_REPO/infra/bootstrap" "$FAKE_REPO/samples/instance" "$WORK/bin"
cp "$ROOT/scripts/bootstrap.sh" "$FAKE_REPO/scripts/bootstrap.sh"
cp "$ROOT/infra/bootstrap/main.bicep" "$FAKE_REPO/infra/bootstrap/main.bicep"
cp "$FIXTURES/sample-instance.json" "$FAKE_REPO/samples/instance/instance.json"
cp "$HERE/fake-az" "$WORK/bin/az"
cp "$HERE/fake-gh" "$WORK/bin/gh"
chmod +x "$FAKE_REPO/scripts/bootstrap.sh" "$WORK/bin/az" "$WORK/bin/gh"

# A local checkout of the private instance repo.
INSTANCE="$WORK/instance"
mkdir -p "$INSTANCE"
cp "$FIXTURES/private-instance.json" "$INSTANCE/instance.json"

AZ_LOG="$WORK/az.log"
GH_LOG="$WORK/gh.log"
AZ_DIR="$WORK/az"
GH_DIR="$WORK/gh"
RUN_TMP="$WORK/tmp"
OUT=""
STATUS=0
PASSED=0
FAILED=0
PROVIDER_TIMEOUT=60

SUB=11111111-1111-4111-8111-111111111111
TENANT=22222222-2222-4222-8222-222222222222
OWNER=33333333-3333-4333-8333-333333333333
CLIENT=44444444-4444-4444-8444-444444444444
BACKUP_CLIENT=66666666-6666-4666-8666-666666666666
PREFIX="repo:acme@4242/wedding-demo@987654"

# run AZ_STATE GH_STATE [ARGS...]: run bootstrap.sh against the fakes; sets OUT and STATUS.
run() {
  local az_state=$1 gh_state=$2
  shift 2
  : >"$AZ_LOG"
  : >"$GH_LOG"
  rm -rf "$AZ_DIR" "$GH_DIR" "$RUN_TMP"
  mkdir -p "$AZ_DIR" "$GH_DIR" "$RUN_TMP"
  cp "$az_state" "$WORK/az-state.json"
  set +e
  OUT=$(env -u CI -u GITHUB_ACTIONS PATH="$WORK/bin:$PATH" TMPDIR="$RUN_TMP" \
    FAKE_AZ_STATE="$WORK/az-state.json" FAKE_AZ_LOG="$AZ_LOG" FAKE_AZ_DIR="$AZ_DIR" \
    FAKE_GH_STATE="$gh_state" FAKE_GH_LOG="$GH_LOG" FAKE_GH_DIR="$GH_DIR" \
    BOOTSTRAP_POLL_SECONDS=0 BOOTSTRAP_RETRY_SECONDS=0 \
    BOOTSTRAP_PROVIDER_TIMEOUT_SECONDS="$PROVIDER_TIMEOUT" \
    "$FAKE_REPO/scripts/bootstrap.sh" --repo acme/wedding-demo "$@" 2>&1)
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

# instance_variant JQ_FILTER: a private instance checkout with a modified instance.json.
instance_variant() {
  local dir
  dir=$(mktemp -d "$WORK/instance.XXXXXX")
  jq "$1" "$FIXTURES/private-instance.json" >"$dir/instance.json"
  printf '%s' "$dir"
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
    printf '        az calls:\n'
    sed 's/^/        > /' "$AZ_LOG"
    printf '        gh calls:\n'
    sed 's/^/        > /' "$GH_LOG"
  fi
}

status_is() { [ "$STATUS" -eq "$1" ]; }
failed() { [ "$STATUS" -ne 0 ]; }
output_has() { printf '%s' "$OUT" | grep -qF -- "$1"; }
output_lacks() { ! printf '%s' "$OUT" | grep -qF -- "$1"; }
az_called() { grep -qF -- "$1" "$AZ_LOG"; }
az_not_called() { ! grep -qF -- "$1" "$AZ_LOG"; }
az_count() { grep -cF -- "$1" "$AZ_LOG" || true; }
az_silent() { [ ! -s "$AZ_LOG" ]; }
gh_called() { grep -qF -- "$1" "$GH_LOG"; }
gh_not_called() { ! grep -qF -- "$1" "$GH_LOG"; }
gh_silent() { [ ! -s "$GH_LOG" ]; }
gh_writes() { grep -E '^(POST|PUT|PATCH|DELETE|SECRET) ' "$GH_LOG" || true; }
gh_write_count() { gh_writes | grep -c . || true; }
no_gh_writes() { [ "$(gh_write_count)" -eq 0 ]; }
gh_line() { grep -nF -- "$1" "$GH_LOG" | head -n 1 | cut -d: -f1; }
before() { [ -n "$(gh_line "$1")" ] && [ -n "$(gh_line "$2")" ] && [ "$(gh_line "$1")" -lt "$(gh_line "$2")" ]; }
# body PREFIX: the JSON body of the last gh call that starts with PREFIX.
body() { grep -F -- "$1 " "$GH_LOG" | tail -n 1 | sed "s|^$1 ||"; }
json_true() { [ "$(printf '%s' "$1" | jq "$2")" = "true" ]; }
params_true() { json_true "$(cat "$AZ_DIR/params-1.json")" "$1"; }
no_temp_files() { [ -z "$(ls -A "$RUN_TMP")" ]; }
# private_output: nothing secret or personal in the output.
private_output() {
  local value
  for value in "$SUB" "$TENANT" "$OWNER" "$CLIENT" "$BACKUP_CLIENT" "$PREFIX" "@example" "PRIVATE KEY" \
    "acme/wedding-instance" "ssh-ed25519"; do
    if printf '%s' "$OUT" | grep -qF -- "$value"; then
      printf '        output contains %s\n' "$value"
      return 1
    fi
  done
}
variable_created() {
  json_true "$(grep -F "POST repos/acme/wedding-demo/environments/$1/variables " "$GH_LOG" |
    sed 's|^[^{]*||' | jq -s --arg n "$2" --arg v "$3" 'map(select(.name == $n)) | . == [{name: $n, value: $v}]')" '.'
}

# ---------------------------------------------------------------------------------------------
test_case "e2e: fresh subscription and repository"
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env e2e
check "exits 0" status_is 0
check "registers the 6 unregistered providers" [ "$(az_count 'provider register')" -eq 6 ]
for ns in OperationalInsights Insights ManagedIdentity Consumption CostManagement AlertsManagement; do
  check "registers Microsoft.$ns with -o none" az_called "provider register --namespace Microsoft.$ns --subscription $SUB -o none"
done
check "skips registered providers" az_not_called "provider register --namespace Microsoft.Web "
check "deploys the template at subscription scope with a fixed name in dataLocation" az_called \
  "deployment sub create --name bootstrap-wedsample1-e2e --location germanywestcentral --subscription $SUB --template-file $FAKE_REPO/infra/bootstrap/main.bicep"
check "deploys with -o none" az_called "-o none --only-show-errors"
check "parameters: slug, environment, region, subject prefix, owner" params_true \
  ".parameters | .deploymentSlug.value == \"wedsample1\" and .environmentName.value == \"e2e\"
   and .dataLocation.value == \"germanywestcentral\" and .githubSubjectPrefix.value == \"$PREFIX\"
   and .ownerPrincipalId.value == \"$OWNER\" and .ownerPrincipalType.value == \"User\"
   and .actionGroupLocation.value == \"\""
check "parameters: alert emails from the sample instance" params_true \
  '.parameters.alertReceivers.value == {emails: ["anna@example.com", "ben@example.com"]}'
check "sets AZURE_CLIENT_ID" variable_created e2e AZURE_CLIENT_ID "$CLIENT"
check "sets AZURE_TENANT_ID" variable_created e2e AZURE_TENANT_ID "$TENANT"
check "sets AZURE_SUBSCRIPTION_ID" variable_created e2e AZURE_SUBSCRIPTION_ID "$SUB"
check "sets AZURE_RESOURCE_GROUP" variable_created e2e AZURE_RESOURCE_GROUP "rg-wedsample1-e2e"
check "sets exactly these four variables" [ "$(gh_write_count)" -eq 4 ]
check "sets no INSTANCE_REPO and no deploy key" gh_not_called "INSTANCE_REPO"
check "no backup environment for e2e" gh_not_called "backup-e2e"
check "no backup identity for e2e" az_not_called "id-wedsample1-e2e-backup"
check "warns that the sample emails are placeholders" output_has "example.com placeholders"
check "prints no ids, emails or keys" private_output
check "deletes its temporary files" no_temp_files

test_case "e2e: --alert-emails-from routes e2e alerts to the owner"
run "$FIXTURES/az.configured.json" "$FIXTURES/gh.configured.json" --env e2e \
  --alert-emails-from "$INSTANCE/instance.json"
check "exits 0" status_is 0
check "takes the alert emails from the given file" params_true \
  '.parameters.alertReceivers.value.emails == ["maria-jose.garcia@example.org", "pablo.perez@example.org"]'
check "keeps the sample's slug" params_true '.parameters.deploymentSlug.value == "wedsample1"'
check "no placeholder warning" output_lacks "placeholders"
check "prints no emails" private_output

test_case "e2e: configured environment is left alone (idempotent)"
run "$FIXTURES/az.configured.json" "$FIXTURES/gh.configured.json" --env e2e
check "exits 0" status_is 0
check "registers no provider" az_not_called "provider register"
check "re-applies the idempotent deployment" [ "$(az_count 'deployment sub create')" -eq 1 ]
check "keeps the existing action group location" params_true \
  '.parameters.actionGroupLocation.value == "germanywestcentral"'
check "no GitHub writes" no_gh_writes
check "API_LOCKDOWN is not reported as unexpected" output_lacks "unexpected variable"
check "reports 0 changes" output_has "(0 change(s))"

# ---------------------------------------------------------------------------------------------
test_case "test: fresh environment with instance repo"
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env test --instance "$INSTANCE" \
  --instance-repo acme/wedding-instance
check "exits 0" status_is 0
check "deploys bootstrap-wedx7k2p9-test" az_called "deployment sub create --name bootstrap-wedx7k2p9-test"
check "parameters from the private instance.json" params_true \
  '.parameters | .deploymentSlug.value == "wedx7k2p9" and .environmentName.value == "test"
   and .alertReceivers.value.emails == ["maria-jose.garcia@example.org", "pablo.perez@example.org"]'
check "sets AZURE_RESOURCE_GROUP" variable_created test AZURE_RESOURCE_GROUP "rg-wedx7k2p9-test"
check "sets INSTANCE_REPO" variable_created test INSTANCE_REPO "acme/wedding-instance"
check "adds a read-only ed25519 deploy key titled deploy-test" json_true \
  "$(body 'POST repos/acme/wedding-instance/keys')" \
  '.title == "deploy-test" and .read_only == true and (.key | startswith("ssh-ed25519 "))'
check "stores the private key as environment secret (via stdin)" gh_called \
  "SECRET INSTANCE_REPO_DEPLOY_KEY --env test --repo acme/wedding-demo"
SECRET_FILE="$GH_DIR/secret-INSTANCE_REPO_DEPLOY_KEY-test"
check "the secret is an OpenSSH private key" grep -q 'BEGIN OPENSSH PRIVATE KEY' "$SECRET_FILE"
chmod 600 "$SECRET_FILE"
POSTED_KEY=$(body 'POST repos/acme/wedding-instance/keys' | jq -r .key | cut -d' ' -f1-2)
check "the secret matches the added public key" [ "$(ssh-keygen -y -f "$SECRET_FILE" | cut -d' ' -f1-2)" = "$POSTED_KEY" ]
check "adds the key before storing the secret" before "POST repos/acme/wedding-instance/keys" "SECRET "
check "removes no key" gh_not_called "DELETE"
check "prints no ids, emails, instance repo or keys" private_output
check "deletes the temporary key files" no_temp_files

test_case "test: fresh nightly backup environment and identity"
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env test --instance "$INSTANCE" \
  --instance-repo acme/wedding-instance
check "exits 0" status_is 0
check "creates backup-test: main only, no reviewer, no wait timer, no admin bypass" json_true \
  "$(body 'PUT repos/acme/wedding-demo/environments/backup-test')" \
  '. == {wait_timer: 0, prevent_self_review: false, reviewers: null,
    deployment_branch_policy: {protected_branches: false, custom_branch_policies: true},
    can_admins_bypass: false}'
check "allows deployments from main" json_true \
  "$(body 'POST repos/acme/wedding-demo/environments/backup-test/deployment-branch-policies')" \
  '. == {name: "main", type: "branch"}'
check "creates the environment before its variables" before \
  "PUT repos/acme/wedding-demo/environments/backup-test" "POST repos/acme/wedding-demo/environments/backup-test/variables"
check "AZURE_CLIENT_ID of backup-test is the backup identity" \
  variable_created backup-test AZURE_CLIENT_ID "$BACKUP_CLIENT"
check "AZURE_TENANT_ID of backup-test" variable_created backup-test AZURE_TENANT_ID "$TENANT"
check "AZURE_SUBSCRIPTION_ID of backup-test" variable_created backup-test AZURE_SUBSCRIPTION_ID "$SUB"
check "AZURE_RESOURCE_GROUP of backup-test" variable_created backup-test AZURE_RESOURCE_GROUP "rg-wedx7k2p9-test"
check "exactly four backup variables (no INSTANCE_REPO, no secret)" \
  [ "$(gh_writes | grep -c '^POST repos/acme/wedding-demo/environments/backup-test/variables ')" -eq 4 ]
check "no secret in the backup environment" gh_not_called "SECRET INSTANCE_REPO_DEPLOY_KEY --env backup-test"
check "the deploy environment keeps the deploy identity" variable_created test AZURE_CLIENT_ID "$CLIENT"
check "checks the backup identity's federated credentials" \
  az_called "identity federated-credential list --identity-name id-wedx7k2p9-test-backup --resource-group rg-wedx7k2p9-test-ops"
check "reports the backup identity" output_has "backup identity id-wedx7k2p9-test-backup"
check "prints no ids" private_output

test_case "test: a backup environment with a reviewer or other branches is repaired"
state=$(variant gh.configured.json '.["GET repos/acme/wedding-demo/environments/backup-test"].protection_rules += [{id: 9, type: "required_reviewers", reviewers: []}]
  | .["GET repos/acme/wedding-demo/environments/backup-test/deployment-branch-policies"].branch_policies += [{id: 12, name: "feature/*", type: "branch"}]')
run "$FIXTURES/az.configured.json" "$state" --env test --instance "$INSTANCE" --instance-repo acme/wedding-instance
check "exits 0" status_is 0
check "removes the reviewer (PUT without reviewers)" json_true \
  "$(body 'PUT repos/acme/wedding-demo/environments/backup-test')" '.reviewers == null and .can_admins_bypass == false'
check "explains why" output_has "scheduled backup cannot pass"
check "removes the other branch policy" gh_called "DELETE repos/acme/wedding-demo/environments/backup-test/deployment-branch-policies/12"
check "keeps main" gh_not_called "deployment-branch-policies/11"

test_case "test: extra federated credentials on the backup identity are removed"
state=$(variant az.configured.json '.extraBackupCredentials = ["pull-request"]')
run "$state" "$FIXTURES/gh.configured.json" --env test --instance "$INSTANCE" --instance-repo acme/wedding-instance
check "exits 0" status_is 0
check "removes it from the backup identity" az_called \
  "identity federated-credential delete --name pull-request --identity-name id-wedx7k2p9-test-backup"
check "keeps github-backup-test" az_not_called "delete --name github-backup-test"

test_case "Azure: custom role replication delay is retried"
state=$(variant az.fresh.json '.deploymentFailures = 1
  | .deploymentError = "ERROR: (RoleDefinitionDoesNotExist) The specified role definition does not exist."')
run "$state" "$FIXTURES/gh.fresh.json" --env test --instance "$INSTANCE" --instance-repo acme/wedding-instance
check "exits 0" status_is 0
check "deploys twice" [ "$(az_count 'deployment sub create')" -eq 2 ]

test_case "test: configured environment keeps its deploy key (idempotent)"
run "$FIXTURES/az.configured.json" "$FIXTURES/gh.configured.json" --env test --instance "$INSTANCE" \
  --instance-repo acme/wedding-instance
check "exits 0" status_is 0
check "no GitHub writes" no_gh_writes
check "reports the key as kept" output_has "kept (replace with --rotate-deploy-key)"

test_case "test: --rotate-deploy-key replaces the key without a gap"
run "$FIXTURES/az.configured.json" "$FIXTURES/gh.configured.json" --env test --instance "$INSTANCE" \
  --instance-repo acme/wedding-instance --rotate-deploy-key
check "exits 0" status_is 0
check "adds a new read-only key" json_true "$(body 'POST repos/acme/wedding-instance/keys')" \
  '.title == "deploy-test" and .read_only == true'
check "updates the secret" gh_called "SECRET INSTANCE_REPO_DEPLOY_KEY --env test"
check "removes the previous key" gh_called "DELETE repos/acme/wedding-instance/keys/7"
check "order: add key, store secret, remove old key" before "POST repos/acme/wedding-instance/keys" "SECRET "
check "old key removed last" before "SECRET " "DELETE repos/acme/wedding-instance/keys/7"
check "keeps other keys" gh_not_called "keys/3"
check "keeps the production key" gh_not_called "keys/8"
check "deletes the temporary key files" no_temp_files

test_case "test: a missing secret is repaired with a new key"
state=$(variant gh.configured.json 'del(.["GET repos/acme/wedding-demo/environments/test/secrets/INSTANCE_REPO_DEPLOY_KEY"])')
run "$FIXTURES/az.configured.json" "$state" --env test --instance "$INSTANCE" --instance-repo acme/wedding-instance
check "exits 0" status_is 0
check "adds a new key" gh_called "POST repos/acme/wedding-instance/keys"
check "stores the secret" gh_called "SECRET INSTANCE_REPO_DEPLOY_KEY --env test"
check "removes the orphaned key" gh_called "DELETE repos/acme/wedding-instance/keys/7"

test_case "test: a writable key titled deploy-test is replaced"
state=$(variant gh.configured.json '.["GET repos/acme/wedding-instance/keys?per_page=100"][1].read_only = false')
run "$FIXTURES/az.configured.json" "$state" --env test --instance "$INSTANCE" --instance-repo acme/wedding-instance
check "exits 0" status_is 0
check "adds a read-only key" json_true "$(body 'POST repos/acme/wedding-instance/keys')" '.read_only == true'
check "removes the writable key" gh_called "DELETE repos/acme/wedding-instance/keys/7"

test_case "test: a failed secret update keeps the old key"
state=$(variant gh.configured.json '.["SECRET INSTANCE_REPO_DEPLOY_KEY"] = {__error: "HTTP 500"}')
run "$FIXTURES/az.configured.json" "$state" --env test --instance "$INSTANCE" \
  --instance-repo acme/wedding-instance --rotate-deploy-key
check "exits non-zero" failed
check "does not remove the old key" gh_not_called "DELETE"
check "deletes the temporary key files" no_temp_files

test_case "test: instance repo from the origin remote of --instance"
GIT_INSTANCE="$WORK/instance-git"
mkdir -p "$GIT_INSTANCE"
cp "$FIXTURES/private-instance.json" "$GIT_INSTANCE/instance.json"
git -C "$GIT_INSTANCE" init -q
git -C "$GIT_INSTANCE" remote add origin git@github.com:acme/wedding-instance.git
run "$FIXTURES/az.configured.json" "$FIXTURES/gh.configured.json" --env test --instance "$GIT_INSTANCE"
check "exits 0" status_is 0
check "checks the instance repo from the remote" gh_called "GET repos/acme/wedding-instance"
check "INSTANCE_REPO unchanged (derived value matches)" no_gh_writes

test_case "test: a public instance repo is refused before any change"
state=$(variant gh.fresh.json '.["GET repos/acme/wedding-instance"].private = false')
run "$FIXTURES/az.fresh.json" "$state" --env test --instance "$INSTANCE" --instance-repo acme/wedding-instance
check "exits non-zero" failed
check "explains why" output_has "not private"
check "no Azure calls" az_silent
check "no GitHub writes" no_gh_writes

test_case "test: the public repo cannot be the instance repo"
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env test --instance "$INSTANCE" --instance-repo acme/wedding-demo
check "exits non-zero" failed
check "no Azure calls" az_silent

# ---------------------------------------------------------------------------------------------
test_case "production: refused without a required reviewer"
state=$(variant gh.fresh.json '.["GET repos/acme/wedding-demo/environments/production"].protection_rules = [{type: "branch_policy"}]')
run "$FIXTURES/az.fresh.json" "$state" --env production --instance "$INSTANCE" --instance-repo acme/wedding-instance
check "exits non-zero" failed
check "points to setup-repo.sh" output_has "scripts/github/setup-repo.sh"
check "no Azure calls" az_silent
check "no GitHub writes" no_gh_writes

test_case "production: fresh environment"
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env production --instance "$INSTANCE" \
  --instance-repo acme/wedding-instance
check "exits 0" status_is 0
check "deploys bootstrap-wedx7k2p9-production" az_called "deployment sub create --name bootstrap-wedx7k2p9-production"
check "adds deploy-production" json_true "$(body 'POST repos/acme/wedding-instance/keys')" '.title == "deploy-production"'
check "sets five variables" [ "$(gh_writes | grep -c '^POST repos/acme/wedding-demo/environments/production/variables ')" -eq 5 ]
check "points to the cost bootstrap next" output_has "scripts/bootstrap-cost.sh"

test_case "missing GitHub Environment stops before any change"
state=$(variant gh.fresh.json 'del(.["GET repos/acme/wedding-demo/environments/test"])')
run "$FIXTURES/az.fresh.json" "$state" --env test --instance "$INSTANCE" --instance-repo acme/wedding-instance
check "exits non-zero" failed
check "points to setup-repo.sh" output_has "scripts/github/setup-repo.sh"
check "no Azure calls" az_silent
check "no GitHub writes" no_gh_writes

test_case "custom OIDC subject template is refused"
state=$(variant gh.fresh.json '.["GET repos/acme/wedding-demo/actions/oidc/customization/sub"] = {use_default: false, include_claim_keys: ["repo", "context"]}')
run "$FIXTURES/az.fresh.json" "$state" --env e2e
check "exits non-zero" failed
check "explains the reset" output_has "use_default=true"
check "no Azure calls" az_silent

test_case "legacy subject prefix when GitHub returns none"
state=$(variant gh.fresh.json '.["GET repos/acme/wedding-demo/actions/oidc/customization/sub"] = {use_default: true}')
run "$FIXTURES/az.fresh.json" "$state" --env e2e
check "exits 0" status_is 0
check "uses repo:OWNER/NAME" params_true '.parameters.githubSubjectPrefix.value == "repo:acme/wedding-demo"'
check "warns" output_has "legacy subject format"

# ---------------------------------------------------------------------------------------------
test_case "instance.json: invalid slug"
dir=$(instance_variant '.slug = "anna-and-ben"')
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env test --instance "$dir" --instance-repo acme/wedding-instance
check "exits non-zero" failed
check "names the rule" output_has "slug must match"
check "no Azure calls" az_silent
check "no GitHub calls" gh_silent

test_case "instance.json: an invalid email is reported by index, never by value"
dir=$(instance_variant '.alertEmails = ["pablo.perez@example.org", "juergen-at-example"]')
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env test --instance "$dir" --instance-repo acme/wedding-instance
check "exits non-zero" failed
check "names the index" output_has "alertEmails[1]"
check "does not print the value" output_lacks "juergen-at-example"
check "no Azure calls" az_silent

test_case "instance.json: missing alertEmails"
dir=$(instance_variant 'del(.alertEmails)')
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env test --instance "$dir" --instance-repo acme/wedding-instance
check "exits non-zero" failed
check "no Azure calls" az_silent

test_case "instance.json: dataLocation defaults to germanywestcentral; sample content warns"
dir=$(instance_variant 'del(.dataLocation) | .sample = true')
run "$FIXTURES/az.configured.json" "$FIXTURES/gh.configured.json" --env test --instance "$dir" --instance-repo acme/wedding-instance
check "exits 0" status_is 0
check "deploys in germanywestcentral" params_true '.parameters.dataLocation.value == "germanywestcentral"'
check "warns about sample content" output_has "marked \"sample\": true"

test_case "arguments are checked before anything runs"
# refused MESSAGE: the last run failed with MESSAGE and made no az or gh call.
refused() { failed && output_has "$1" && az_silent && gh_silent; }
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env test
check "test needs --instance" refused "needs --instance"
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env e2e --instance "$INSTANCE"
check "e2e refuses --instance" refused "e2e always uses samples/instance/"
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env test --instance "$INSTANCE" \
  --alert-emails-from "$INSTANCE/instance.json"
check "--alert-emails-from is e2e only" refused "is for e2e only"
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env e2e --rotate-deploy-key
check "--rotate-deploy-key is not for e2e" refused "test and production only"
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env staging
check "unknown environment" refused "--env must be one of"
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env e2e --subscription not-a-guid
check "subscription must be a GUID" refused "--subscription must be"
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env e2e --bogus
check "unknown argument" refused "unknown argument"

test_case "refuses to run in CI"
: >"$AZ_LOG"
: >"$GH_LOG"
set +e
OUT=$(GITHUB_ACTIONS=true PATH="$WORK/bin:$PATH" FAKE_AZ_STATE="$WORK/az-state.json" FAKE_AZ_LOG="$AZ_LOG" \
  FAKE_AZ_DIR="$AZ_DIR" FAKE_GH_STATE="$FIXTURES/gh.fresh.json" FAKE_GH_LOG="$GH_LOG" FAKE_GH_DIR="$GH_DIR" \
  "$FAKE_REPO/scripts/bootstrap.sh" --repo acme/wedding-demo --env e2e 2>&1)
STATUS=$?
set -e
check "refused without calls" refused "never by CI"

# ---------------------------------------------------------------------------------------------
test_case "Azure: not signed in"
state=$(variant az.fresh.json '.account = null')
run "$state" "$FIXTURES/gh.fresh.json" --env e2e
check "exits non-zero" failed
check "asks for az login" output_has "az login"
check "no GitHub writes" no_gh_writes

test_case "Azure: disabled subscription"
state=$(variant az.fresh.json '.subscription.state = "Disabled"')
run "$state" "$FIXTURES/gh.fresh.json" --env e2e
check "exits non-zero" failed
check "explains the pay-as-you-go upgrade" output_has "pay-as-you-go"
check "no deployment" az_not_called "deployment sub create"

test_case "Azure: spending limit (trial) warns"
state=$(variant az.fresh.json '.subscription.subscriptionPolicies.spendingLimit = "On"')
run "$state" "$FIXTURES/gh.fresh.json" --env e2e
check "exits 0" status_is 0
check "warns about the trial" output_has "spending limit"

test_case "Azure: signed in as a service principal"
state=$(variant az.fresh.json '.signedInUser = null')
run "$state" "$FIXTURES/gh.fresh.json" --env e2e
check "exits non-zero" failed
check "asks for a user login" output_has "as a user"

test_case "Azure: providers still registering"
state=$(variant az.fresh.json '.registerResult = "Registering"')
PROVIDER_TIMEOUT=0
run "$state" "$FIXTURES/gh.fresh.json" --env e2e
PROVIDER_TIMEOUT=60
check "exits non-zero" failed
check "asks for a re-run" output_has "re-run this script"
check "no deployment" az_not_called "deployment sub create"

test_case "Azure: resource group in another region"
state=$(variant az.configured.json '.groups["rg-wedsample1-e2e"] = "westeurope" | .providers = {}')
run "$state" "$FIXTURES/gh.configured.json" --env e2e
check "exits non-zero" failed
check "explains the conflict" output_has "cannot move"
check "no deployment" az_not_called "deployment sub create"
check "no provider registration" az_not_called "provider register"

test_case "Azure: identity replication delay is retried"
state=$(variant az.fresh.json '.deploymentFailures = 2
  | .deploymentError = "ERROR: (PrincipalNotFound) Principal 44444444444444448444444444444444 does not exist in the directory 22222222-2222-4222-8222-222222222222."')
run "$state" "$FIXTURES/gh.fresh.json" --env e2e
check "exits 0" status_is 0
check "deploys three times" [ "$(az_count 'deployment sub create')" -eq 3 ]
check "warns about the retry" output_has "has not replicated yet"
check "prints no ids" private_output

test_case "Azure: other deployment errors fail at once, redacted"
state=$(variant az.fresh.json '.deploymentFailures = 1
  | .deploymentError = "ERROR: (InvalidTemplate) receiver pablo.perez@example.org in /subscriptions/11111111-1111-4111-8111-111111111111 failed"')
run "$state" "$FIXTURES/gh.fresh.json" --env e2e
check "exits non-zero" failed
check "deploys once" [ "$(az_count 'deployment sub create')" -eq 1 ]
check "shows the error" output_has "InvalidTemplate"
check "redacts emails and ids" private_output
check "sets no variables" no_gh_writes
check "deletes its temporary files" no_temp_files

test_case "Azure: extra federated credentials are removed"
state=$(variant az.configured.json '.extraCredentials = ["pull-request", "branch-main"]')
run "$state" "$FIXTURES/gh.configured.json" --env e2e
check "exits 0" status_is 0
check "removes the pull_request credential" az_called \
  "identity federated-credential delete --name pull-request --identity-name id-wedsample1-e2e --resource-group rg-wedsample1-e2e-ops"
check "removes the branch credential" az_called "identity federated-credential delete --name branch-main"
check "keeps github-e2e" az_not_called "delete --name github-e2e"

test_case "Azure: --action-group-location applies to a new action group only"
run "$FIXTURES/az.fresh.json" "$FIXTURES/gh.fresh.json" --env e2e --action-group-location Global
check "exits 0" status_is 0
check "creates the action group as global" params_true '.parameters.actionGroupLocation.value == "global"'
run "$FIXTURES/az.configured.json" "$FIXTURES/gh.configured.json" --env e2e --action-group-location global
check "exits 0" status_is 0
check "keeps the existing location" params_true '.parameters.actionGroupLocation.value == "germanywestcentral"'
check "warns that the flag is ignored" output_has "--action-group-location is ignored"

test_case "GitHub: stale values are updated, unexpected variables are reported"
state=$(variant gh.configured.json '.["GET repos/acme/wedding-demo/environments/e2e/variables?per_page=30"].variables
  |= (map(if .name == "AZURE_CLIENT_ID" then .value = "55555555-5555-4555-8555-555555555555" else . end)
      + [{name: "RSVP_ENABLED", value: "true"}, {name: "INSTANCE_REPO", value: "acme/other"}])')
run "$FIXTURES/az.configured.json" "$state" --env e2e
check "exits 0" status_is 0
check "updates AZURE_CLIENT_ID" json_true \
  "$(body 'PATCH repos/acme/wedding-demo/environments/e2e/variables/AZURE_CLIENT_ID')" \
  ". == {name: \"AZURE_CLIENT_ID\", value: \"$CLIENT\"}"
check "one write only" [ "$(gh_write_count)" -eq 1 ]
check "reports RSVP_ENABLED" output_has "unexpected variable RSVP_ENABLED"
check "reports INSTANCE_REPO on e2e" output_has "unexpected variable INSTANCE_REPO"
check "deletes nothing" gh_not_called "DELETE"

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
