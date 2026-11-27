# Local development

The whole stack runs on your machine: Azurite for Table Storage, the Functions host with the API,
and Vite with the one-pager. Optionally the Static Web Apps CLI sits in front of both to emulate
the routes, roles and sign-in of the Azure edge. Everything uses the fictional sample instance
(`samples/instance/`, Anna & Ben) unless you point `INSTANCE_DIR` elsewhere.

## Prerequisites

Node 24 (`fnm use` reads `.nvmrc`), pnpm from Homebrew or npm (not corepack), .NET 10 SDK, Azure
Functions Core Tools v4 (`func`), and a Docker engine (Docker Desktop or OrbStack; the active docker
context is used). Then `pnpm install` once.

## Start the stack

```sh
pnpm dev       # Azurite + Functions host + Vite; open http://localhost:5173
pnpm dev:swa   # the same + the SWA CLI emulator; open http://localhost:4280
```

| Script                                  | What it starts                                                                | URL                              |
| --------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------- |
| `pnpm dev`                              | `storage:up`, then `dev:web` and `dev:api` side by side (`concurrently`)      | http://localhost:5173            |
| `pnpm dev:swa`                          | as `pnpm dev`, plus `swa start` with the generated `staticwebapp.config.json` | http://localhost:4280            |
| `pnpm dev:web`                          | the bake, then Vite; `/api/*` is proxied to the Functions host                | http://localhost:5173            |
| `pnpm dev:api`                          | creates `local.settings.json` if missing, then `func start --port 7071`       | http://localhost:7071/api/health |
| `pnpm storage:up` / `pnpm storage:down` | Azurite (`docker compose`, waits until healthy) / stops it                    | ports 10000-10002                |

- `func start` builds the API first (a few seconds, longer on the first run), so the API answers a
  little after Vite. Until then Vite logs proxy errors (`ECONNREFUSED`) for the page's API calls.
- Ctrl+C stops Vite, the Functions host and the emulator; Azurite keeps running until
  `pnpm storage:down`.
- The ports are fixed: Vite 5173, Functions host 7071, emulator 4280, Azurite 10000-10002. Run one
  stack per machine. If Vite cannot bind 5173, it stops with `Port 5173 is already in use`
  (`strictPort`) instead of moving to a port the emulator does not know; stop the other dev server
  first (`lsof -nP -iTCP:5173 -sTCP:LISTEN`). A second Vite without the emulator, for example in
  another worktree, can take another port: `pnpm dev:web --port 5183`.

## How the pieces connect

```text
browser ──▶ :5173 Vite ── /api/* (proxy) ──▶ :7071 Functions host ──▶ :10002 Azurite (tables)

browser ──▶ :4280 SWA CLI ─┬─▶ :5173 Vite            (static files, HMR websocket)
                           ├─▶ :7071 Functions host  (/api/*, plus x-ms-client-principal)
                           └─▶ /.auth/* emulated     (mock sign-in, /.auth/me)
```

- **Vite proxy** (`apps/web/vite.config.ts`): `/api` goes to `http://localhost:7071`, so the page
  calls the API same-origin, as behind Static Web Apps (no CORS). `DEV_API_URL` overrides the
  target; `vite preview` uses the same proxy.
- **SWA CLI** (`swa-cli.config.json`, configuration `weddingplanner`): connects to the running Vite
  and Functions host (`appDevserverUrl`, `apiDevserverUrl`) and serves on port 4280 with
  `apps/web/.swa/staticwebapp.config.json`, which `dev:swa` writes first
  (`node apps/web/swa-config/build-swa-config.ts`). It waits up to five minutes for both dev servers.

## API settings

`pnpm dev:api` (through `pnpm api:settings`) copies the committed
`apps/api/src/WeddingPlanner.Api/local.settings.sample.json` to `local.settings.json` next to it
when that file does not exist (it is gitignored; never put secrets in the sample). The sample
switches every feature on, points storage at Azurite and sets a far-future RSVP deadline. Delete
`local.settings.json` to pick up a changed sample. Useful local edits:

- `"Features__Rsvp": "false"`: the RSVP API answers 404, as with the flag off on Azure.
- `"Storage__TablePrefix": "dev"` (letters and digits): keeps your tables apart in a shared Azurite.
- Keep `Rsvp__Deadline` in the space form (`2099-05-01 23:59:00+02:00`): Core Tools rewrites
  `T`-separated dates from this file into culture-formatted strings, which leaves the RSVP API
  `not_configured`.

Restart `pnpm dev:api` (or `pnpm dev`) after a change.

## Feature flags and content locally

The page's flags come from the bake (`DEPLOY_ENV`, default `e2e`, every flag on in the sample). To
see the page as a guest sees it with RSVP still dark, bake for an environment where the flag is off:

```sh
DEPLOY_ENV=production pnpm dev   # sample: rsvp off → the RSVP section shows the "opens soon" note
```

To preview a private instance, point `INSTANCE_DIR` at a checkout **outside** this repo:
`INSTANCE_DIR=../my-instance DEPLOY_ENV=test pnpm dev`. Never copy real content into this repo and
never commit screenshots of it.

## RSVP round trip with curl

Through the Vite proxy, with fictional data and a cookie jar in a temporary directory:

```sh
jar="$(mktemp -d)/cookies"
curl -s http://localhost:5173/api/rsvp/status
curl -s -c "$jar" -b "$jar" -H 'Content-Type: application/json' -X POST http://localhost:5173/api/rsvp \
  --data '{"attending":true,"people":[{"name":"Pablo Pérez","dietary":{"tags":["vegetarian"]}}],"language":"es","website":"","dietaryConsent":true,"elapsedMs":5000}'
curl -s -c "$jar" -b "$jar" http://localhost:5173/api/rsvp/me
curl -s -c "$jar" -b "$jar" -X DELETE -o /dev/null -w '%{http_code}\n' http://localhost:5173/api/rsvp/me
```

The API always sets `Secure` cookies. curl and browsers that treat `http://localhost` as a secure
context (Chrome, Edge, Firefox) keep them on plain http; use `localhost`, not `127.0.0.1`.

## Sign in as admin (`pnpm dev:swa`)

1. Open http://localhost:4280/login (or any `/admin` page: anonymous requests are redirected to the
   sign-in, as on Azure).
2. The emulator shows a mock sign-in form. Keep the provider `aad`, enter a fictional user name such
   as `anna@example.com`, and add the role `admin` on its own line under the roles.
3. After sign-in, `/admin` serves the admin entry, `/.auth/me` shows the principal, and every
   `/api/*` request reaches the Functions host with the `x-ms-client-principal` header. `/logout`
   signs out.

Emulator differences to keep in mind: it serves its mock sign-in for every provider (the block on
`/.auth/login/github` only applies on Azure), the mock sign-in page loads its scripts from a
Microsoft CDN, and it does not reproduce every platform detail (client-IP headers, cookie handling
of the managed API). Verify those on the `e2e` environment.

## Azurite and parallel worktrees

`pnpm storage:up` runs `docker compose up --detach --wait --no-recreate` with the fixed compose
project `weddingplanner`: an Azurite that is already running, from any checkout or worktree, is
reused as it is, and its data stays in the `.azurite/` folder of the checkout that created it. Tests
use random table prefixes, so several worktrees can share it. After a change to `docker-compose.yml`
(for example a new image tag), run `pnpm storage:down` and then `pnpm storage:up` to recreate it.

## Troubleshooting

| Symptom                                                | Cause and fix                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `func: command not found`                              | Install Azure Functions Core Tools v4.                                                    |
| `Port 7071 is unavailable` or the emulator won't start | Another stack runs; stop it (`lsof -nP -iTCP:7071 -sTCP:LISTEN` shows the process).       |
| RSVP calls answer 503 `not_configured`                 | `Storage__ConnectionString` is missing, or `Rsvp__Deadline` was edited into the `T` form. |
| RSVP writes and reads answer 500, status still "open"  | Azurite is not running (`pnpm storage:up`).                                               |
| RSVP calls answer 404 `not_found`                      | `Features__Rsvp` is not `true` in `local.settings.json`.                                  |
| The RSVP section says "opens soon"                     | The bake ran for an environment with `features.rsvp` off; restart without `DEPLOY_ENV`.   |
| `/admin` shows the 403 page after the mock sign-in     | The mock sign-in lacks the role `admin` (one role per line); sign out and in again.       |
