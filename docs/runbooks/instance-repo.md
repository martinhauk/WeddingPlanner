# Runbook: the private instance repo and deploys

How the deployment's **private instance repo** (`instance.json`, `site.json`, `site-content.json`,
`media/`) reaches the `test` and `production` environments, and how a change in it triggers a
deploy. Background: [ADR 0003](../adr/0003-private-instance-repo-baked-at-build.md) (content baked
at build time) and [ADR 0004](../adr/0004-environments-e2e-test-production.md) (e2e → test →
production). Creating the repo and the deploy keys: [Azure onboarding](azure-onboarding.md).

**Privacy:** this repository and its deploy logs are public. Never paste the instance repo's name,
its content, branch names, tokens or `gh` output into issues, PRs or chats.

## At a glance

| Trigger                                       | Deploys                                       | Instance commit                            |
| --------------------------------------------- | --------------------------------------------- | ------------------------------------------ |
| push to `main` of this repo                   | e2e → test → production (approval)            | instance `main` at the time test runs      |
| instance repo push to `main` (its workflow)   | test → production (approval)                  | exactly the pushed commit                  |
| `repository_dispatch` type `instance-updated` | test → production (approval)                  | `client_payload.instance_sha`, else `main` |
| manual run of `deploy` (`workflow_dispatch`)  | `all`, one environment, `test-and-production` | `instance-ref` input, else `main`          |

- **e2e** always deploys `samples/instance/`; **test** and **production** always deploy the instance
  repo. Each environment is a call of
  [`_deploy-environment.yml`](../../.github/workflows/_deploy-environment.yml) from
  [`deploy.yml`](../../.github/workflows/deploy.yml).
- **production** deploys the instance commit that **test deployed in the same run**, so what you
  accepted on test is what goes live, even if the instance repo moved on while the approval waited.
- An environment without Azure variables (or, for test and production, without `INSTANCE_REPO`)
  is **skipped** with a notice. A missing or invalid instance **fails** the job: there is no
  fallback to the sample.

## How a deploy gets the instance

For test and production, the deploy job:

1. reads `INSTANCE_REPO` (GitHub Environment variable) and the read-only deploy key
   `INSTANCE_REPO_DEPLOY_KEY` (environment secret), both set by `scripts/bootstrap.sh`;
2. clones the instance repo with quiet plain git over SSH (GitHub's host keys pinned) into
   `$RUNNER_TEMP/instance`, **outside the workspace**, and deletes the key file right after;
3. refuses an instance that is missing `instance.json` or still says `"sample": true`;
4. runs `content validate --strict` (diagnostics show a code and a JSON path, never values);
5. derives the Bicep parameters and feature flags from `instance.json`
   `environments.<env>` and bakes with `DEPLOY_ENV=<env>`;
6. after the upload, waits until `/version.json` reports the deployed commit and content hash and
   `isSample` is `false` (read-only smoke test).

The instance repo's **default branch must be `main`**: deploys without an `instance-ref` take its
`main`, and production accepts only commits on it.

## Set up the instance repo's workflow

Once per deployment, after the bootstrap of `test` (it creates the deploy keys):

1. Copy [`samples/instance-template/.github/`](../../samples/instance-template/.github/workflows/validate-and-deploy.yml)
   into the root of the instance repo, so it has `.github/workflows/validate-and-deploy.yml`.
2. Create a **fine-grained personal access token** (GitHub → Settings → Developer settings →
   Fine-grained tokens):
   - resource owner: the owner of this repository;
   - repository access: **only this repository** (the public app repo);
   - repository permissions: **Actions: Read and write** (Metadata: Read is added automatically),
     nothing else;
   - expiration: past the wedding plus the cleanup period; put a reminder in your calendar.
3. Store it in the **instance repo** (never in this one):
   `gh secret set DEPLOY_DISPATCH_TOKEN -R <owner>/<neutral-name>` (paste the token at the prompt).
4. Forks only: `gh variable set APP_REPO -R <owner>/<neutral-name> --body <owner>/<app-repo>`.
5. Push to the instance repo's `main` (or run the workflow by hand). Its `validate` job must be
   green, then `request deploy` starts the `deploy` workflow here. Approve production when test
   looks right.

What the template does:

- **validate** (every pull request and push): checks out the instance and this repo at `main` (the
  ref that gets deployed), refuses `"sample": true`, runs `content validate --strict` and the full
  content build (bake + vite) for test and production.
- **request deploy** (push to `main` or a manual run on `main`):
  `gh workflow run deploy.yml --ref main -f environment=test-and-production -f instance-ref=<sha>`.

### Why `workflow_dispatch`, not `repository_dispatch`

GitHub requires **Contents: Read and write** for `POST /repos/{owner}/{repo}/dispatches`
(`repository_dispatch`), but only **Actions: Read and write** for starting a workflow by
`workflow_dispatch`. A token with Contents write on this repo could push branches and tags (and, for
an admin, bypass rules), so the template uses `workflow_dispatch` with the narrower token.

The `deploy` workflow still accepts `repository_dispatch` with type `instance-updated` (test, then
production) for setups that already have such a token, for example a GitHub App. The payload may pin
the instance commit:

```sh
gh api repos/<owner>/<app-repo>/dispatches -f event_type=instance-updated \
  -F 'client_payload[instance_sha]=<40-character instance commit SHA>'
```

## Everyday operations

All manual runs start from `main` (Actions → deploy → Run workflow, or `gh workflow run deploy.yml
--ref main -f …`). The GitHub Environments accept deployments from `main` only; the `ref` input
picks the commit instead.

| Goal                                    | `environment`         | `ref`            | `instance-ref`            |
| --------------------------------------- | --------------------- | ---------------- | ------------------------- |
| Redeploy everything from `main`         | `all`                 | empty            | empty                     |
| Redeploy content only                   | `test-and-production` | empty            | empty or an instance SHA  |
| Preview a content branch on test        | `test`                | empty            | the branch (neutral name) |
| Try a code branch on test               | `test`                | the branch       | empty                     |
| Roll production back to an older commit | `production`          | the older commit | empty or an instance SHA  |

Rules the workflow enforces:

- `ref`: a commit SHA (7 to 40 characters), a branch or a tag of this repo. **production** accepts
  only ancestors of `origin/main`; **e2e** and **test** accept any commit on a branch of this repo
  (with a warning when it is not on `main`). Commits of forks or on no branch are refused.
- `instance-ref`: a full commit SHA or a branch of the instance repo. **production** accepts only
  commits on the instance repo's `main`. It applies to test and production only.
- A code branch deployed to test runs with test's Azure credentials and instance deploy key: only
  deploy branches you trust, and redeploy `main` afterwards.
- Content rollback: prefer `git revert` in the instance repo (it keeps the history and runs the
  normal flow). A production deploy with an older `instance-ref` is the fast path; the next content
  push replaces it.

### Production approvals

Every production deploy waits for the owner's approval (GitHub Environment `production`), including
content-only deploys and rollbacks. Deploys of one environment never run at the same time (one concurrency group per environment, a running deploy is never
cancelled): a newer deploy queues behind the running or waiting one and replaces an older queued
one, whose run then shows as cancelled. To ship the newest commit, **reject** older waiting
production deploys and approve the newest. Pending approvals expire after 30 days.

## Privacy in the public deploy logs

- Masked: the SWA hostname, the deploy token, the instance repo name (`OWNER/NAME`), the RSVP
  deadline and its time zone.
- The instance is fetched without printing commit messages; for real content the web build's file
  listing (it names every media file) is not printed. Errors print codes and JSON paths only.
- The job summaries show commit SHAs and environment names only.
- The step that reads `INSTANCE_REPO` shows its value once in the step's header, before the mask
  is set. Keep the repo name neutral (as the onboarding runbook requires), and keep instance branch
  names neutral too: an `instance-ref` input appears in the run.

## Rotate or revoke the dispatch token

- **Rotate** (before it expires, or after a suspected leak): create a new token as above, run
  `gh secret set DEPLOY_DISPATCH_TOKEN -R <owner>/<neutral-name>` again, then delete the old token
  under Fine-grained tokens.
- **Revoke at once:** delete the token in your GitHub settings. Content pushes then fail in
  `request deploy`; start the deploys by hand until a new token is set.
- The deploy keys are separate: see [deploy-key rotation](azure-onboarding.md#deploy-key-rotation).

## Troubleshooting

| Message or symptom                                                     | Cause and fix                                                                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| notice `test has no INSTANCE_REPO variable yet`                        | Not bootstrapped with an instance: `scripts/bootstrap.sh --env test --instance ../<neutral-name>`.                                  |
| `has INSTANCE_REPO but no INSTANCE_REPO_DEPLOY_KEY secret`             | Re-run the bootstrap for that environment; it recreates the key and the secret.                                                     |
| `cannot fetch the main branch of INSTANCE_REPO`                        | The deploy key was removed or rotated without updating the secret, the repo was renamed, or it has no `main`. Re-run the bootstrap. |
| `the instance repo still says "sample": true`                          | Remove `"sample": true` from the instance's `instance.json`.                                                                        |
| `Invalid (strict) for <env>: … error(s)` (deploy)                      | Run `pnpm content:validate ../<neutral-name> --strict --env <env>` locally: the same codes and JSON paths, to check in your files.  |
| `Invalid (strict): … error(s)` (the instance repo's `validate` job)    | Checked for every environment at once: run `pnpm content:validate ../<neutral-name> --strict` locally (no `--env`).                 |
| `production deploys only commits on main`                              | The `ref` is not on `main`. Merge first, or pick a commit on `main`.                                                                |
| `production deploys only instance commits on the instance repo's main` | Merge the content branch in the instance repo first.                                                                                |
| `run this workflow from main`                                          | A manual run was started from another branch; start it from `main` and use `ref`.                                                   |
| `request deploy` fails with HTTP 401 or 403                            | The token expired or lacks Actions write on this repo: [rotate it](#rotate-or-revoke-the-dispatch-token).                           |
| `request deploy` fails with `secret DEPLOY_DISPATCH_TOKEN is missing`  | Step 3 of the setup.                                                                                                                |
| `/version.json never reported this commit and content hash`            | The upload did not go live within five minutes. Re-run the failed job; check the SWA in the portal if it repeats.                   |
| production waits although test is green                                | It waits for your approval, or behind an older deploy that waits for approval (reject that one).                                    |
