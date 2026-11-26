# Repo hygiene and public-repo privacy

This repository is **public**. Anything committed, printed in a CI log, uploaded as an artifact, or
written in an issue, PR or comment can be read by anyone, forever. The code supports several
deployments (weddings); each deployment's real data lives in its own **private instance repo** and
in its Azure resources, never here.

## Never in this repo, its CI logs, artifacts, issues or PRs

- Real names of the couple, guests or anyone else; real places, venues or addresses; real dates of
  an event or its RSVP deadline; real photos.
- Email addresses, phone numbers or messenger handles of real people.
- URLs or hostnames of a deployed site, of the import source of real content, or of Azure
  resources.
- Secrets of any kind: connection strings, keys, tokens, deploy keys, passwords, SAS URLs.
- Screenshots of real content.

If something slips in, tell the owner immediately. Removing it in a new commit is not enough; the
history and any forks still contain it.

## Fictional sample data

Use only these fictional people and obviously fictional details:

- The couple **Anna & Ben**; guests **Pablo Pérez**, **María-José García**, **Jürgen Müller** (the
  accents, hyphen and umlaut exercise normalisation and matching).
- Email addresses at `example.com`; obviously fictional phone numbers; invented places; far-future
  dates.
- Images that you generated yourself (placeholders, gradients). No third-party or real photos.

## Runtime and CI rules

- **No personal data or secrets in logs or artifacts.** API logs never contain names, messages,
  dietary data, tokens, cookies or IP addresses. Validation errors name a code and a JSON path, never
  the value.
- **Never print hostnames or tokens.** Workflows mask them with `::add-mask::` before use, never set
  `environment.url`, and job summaries show only the commit SHA and the content hash.
- **`-o none`** on every `az deployment` and on any `az` call whose output is not needed; Bicep
  never outputs secrets.
- **No `pull_request_target`.** Pull request workflows have no Azure access and no secrets; workflow
  runs from outside contributors need approval.
- **Deployed smoke tests are read-only** and record no screenshots, videos or traces.
- **Tests isolate themselves:** dynamic ports and a random table prefix per run, so parallel
  worktrees and CI jobs can share one Azurite.
- **Guest-visible features ship dark** ([feature-flags.md](feature-flags.md)).
- **Every app setting has a code default.**
- **No dependency without a reason**, stated in the PR.
- **On page load the home page calls no API** except the `GET /api/health` keep-warm ping, which
  performs no I/O and runs only while the RSVP feature is on. The RSVP section calls `/api/rsvp*`
  only once it nears the viewport or the guest presses a button.

## Local environment

- Never copy real content into this repo. Preview real content by pointing the bake at a local
  checkout of the private instance repo outside this working tree (`/.instance/` is gitignored as a
  safety net).
- Local secrets live in gitignored files only: `local.settings.json`, `scripts/*.env`, `.env*`.
- pnpm comes from Homebrew or npm, not corepack. Docker may be OrbStack: use the active docker
  context and never hard-code `/var/run/docker.sock`.

## Enforcement

- GitHub secret scanning with push protection is on (`scripts/github/setup-repo.sh`); CI runs
  gitleaks.
- Reviewers check every PR against this page; the PR template asks for it explicitly.
