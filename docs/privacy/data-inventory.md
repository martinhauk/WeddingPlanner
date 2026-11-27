# Data inventory

Every piece of personal data a WeddingPlanner deployment processes: what it is, why, where it lives,
how long it is kept and who can see it. It backs the guest-facing privacy notice (`/datenschutz`,
built-in text in [`apps/web/src/site/privacy/privacy-text.ts`](../../apps/web/src/site/privacy/privacy-text.ts))
and the couple's record of processing activities. The owner's checklist for the notice itself is
[`privacy-notice-checklist.md`](privacy-notice-checklist.md). This is a structured inventory, not
legal advice.

**Keep both true to the code.** A change that stores, logs, sends or loads something new updates this
file and the notice text in the same commit.

Terms: the **couple** are the controllers (named in `site-content.json` `privacy.controllers`); the
**operator** runs the Azure subscription and the deploy (often one of the couple); **Microsoft** is the
processor (Azure, Art. 28 GDPR). Regions come from `instance.json`: `swaLocation` (site and API; the
sample and `infra/app/main.bicep` default to `westus2`, West US 2) and `dataLocation` (guest replies,
telemetry and backups at rest; default `germanywestcentral`, Germany West Central). Both are named
in the notice (`{appRegion}`, `{dataRegion}` from `build.json` `regions`). Not everything is in
`dataLocation`: the admins' SWA role invitations (email addresses) belong to the Static Web App
resource, and the baked site content (the couple's names, photos, places) is served from its global
edge (see "Other places").

## Guest replies: table `Rsvps`

One entity per reply ([`TableRsvpRepository`](../../apps/api/src/WeddingPlanner.Api/Storage/Rsvps/TableRsvpRepository.cs),
contract in [`docs/api.md`](../api.md)). Stored in Azure Table Storage in `dataLocation`. Written by
the guest (create, change, withdraw) and by an admin (change, delete).

| Field                                        | Content                                          | Purpose                                  | Legal basis                  |
| -------------------------------------------- | ------------------------------------------------ | ---------------------------------------- | ---------------------------- |
| `People[].name`                              | Names of the guest and companions (or of a "no") | Guest list                               | Art. 6(1)(a), 6(1)(b) GDPR   |
| `Attending`, `PersonCount`, `AttendingCount` | Yes or no, number of people                      | Guest list, planning                     | Art. 6(1)(a), 6(1)(b) GDPR   |
| `People[].tags`                              | vegetarian, vegan, glutenFree, lactoseFree       | Food planning (only for a "yes")         | Art. 9(2)(a) GDPR (explicit) |
| `People[].note`                              | Free text: allergies, intolerances (health data) | Food planning (only for a "yes")         | Art. 9(2)(a) GDPR (explicit) |
| `DietaryConsent`                             | `true` after guest consent (guest writes only)   | Proof of consent (Art. 7(1) GDPR)        | Art. 6(1)(c) GDPR            |
| `Message`                                    | Optional free text to the couple                 | Personal message                         | Art. 6(1)(a) GDPR            |
| `Language`                                   | `de`, `en` or `es`                               | Answering in the guest's language        | Art. 6(1)(b) GDPR            |
| `CreatedAt`, `UpdatedAt`                     | Timestamps (UTC)                                 | Deadline handling, support               | Art. 6(1)(b) GDPR            |
| `TokenHash`, row key, `People[].id`          | SHA-256 of the edit token, random ids            | Letting the guest change their own reply | Art. 6(1)(b) GDPR            |
| `SchemaVersion`                              | Format version                                   | Technical                                | (no personal data)           |

- Dietary data is dropped for a "no". **Guest writes** (`POST /api/rsvp`, `PUT /api/rsvp/me`) store it
  only with `dietaryConsent: true` (the API answers 400 otherwise; the form asks for consent as soon
  as dietary data is entered) and set `DietaryConsent` accordingly.
- **Admin edits do not check or record consent.** The admin editor can add or change tags and notes;
  `PUT /api/admin/rsvps/{id}` never asks for `dietaryConsent` and keeps the reply's old
  `DietaryConsent` flag. So an admin can store Art. 9 data while the flag says `false`. Until the API
  records it: **admins enter dietary data only with the guest's explicit consent and keep their own
  proof of it** (for example the guest's email), because an admin edit does not update the flag. A
  follow-up for the API is open (consent check or attestation on admin writes).
- **No IP addresses, cookies or raw tokens are stored.** The edit token (32 random bytes) exists only
  as its SHA-256 hash (`TokenHash`), compared in constant time.
- **Deletes are hard deletes.** A withdrawn reply (`DELETE /api/rsvp/me`) or an admin delete removes
  the entity at once; there are no soft-deleted rows today. Planned in the open issues #32 (S2-06)
  and #56 (S3-02), not implemented yet: the audit fields `UpdatedBy` and `DeletedBy` (`guest`, or
  the signed-in admin's email address) and a soft delete for admin deletes only, purged after 30
  days (a guest's own withdrawal stays a hard delete). [`docs/api.md`](../api.md) ("Not implemented
  yet") lists `UpdatedBy`. Add them here when they land.
- **Retention:** until the guest withdraws the reply (deleted at once) or, at the latest, the deletion
  date `privacy.deleteBy` (default: the last day of the third month after the wedding,
  `privacyDeleteBy` in `@weddingplanner/content`). Backups: at most 30 days longer (see below).
- **Access:** the couple (admin area, role `admin` via SWA invitation, Microsoft sign-in), the operator
  (Azure subscription), Microsoft as processor. The guest sees and edits only their own reply (cookie
  or personal edit link). Dietary details may be passed on, without other data than names, to the
  kitchen or caterer.
- **CSV export** (`GET /api/admin/export.csv`, admins only): one row per person with names, answer,
  dietary data, message, language and timestamps. The file leaves the system on the admin's device;
  the couple is responsible for it (delete it after the wedding, never share it unencrypted).

### Planned tables: `Guests`, `MatchDecisions`, `Settings`

Not built yet ([ADR 0002](../adr/0002-azure-table-storage.md), architecture section 4). Planned
content, from the architecture and API plan; check the fields again when the admin tasks land:

| Table            | Planned content                                                        | Written by    | Legal basis                                             |
| ---------------- | ---------------------------------------------------------------------- | ------------- | ------------------------------------------------------- |
| `Guests`         | The couple's own guest list: names, group or household, notes          | admin         | Art. 6(1)(f) GDPR (organising the invitation)           |
| `MatchDecisions` | Which reply belongs to which guest (ids), who decided (admin identity) | admin, system | Art. 6(1)(f) GDPR                                       |
| `Settings`       | `deadlineOverride`, `closedManually`, who changed it (admin identity)  | admin         | Art. 6(1)(f) GDPR (only the admin identity is personal) |

## Personal edit link and claim

- **What it is:** `<site origin>/#edit=<editToken>` with `editToken = <rsvpId>.<token>`, the same
  value as the `wp_rsvp` cookie. It is returned in the 201 of `POST /api/rsvp` and in every answer
  about the own reply (`GET` and `PUT /api/rsvp/me`, `POST /api/rsvp/claim`), so a returning guest can
  see it again; the page shows it on the success screen and behind "show your personal link".
- **Where it travels:** only in the URL **fragment**, which browsers never send to a server or in a
  `Referer`. The page reads it, calls the claim, then removes it from the address bar. It is never
  logged; all these answers are `no-store`. Only its SHA-256 hash is stored.
- **Claim preview** (`POST /api/rsvp/claim` with `preview: true`): answers only the names of the
  reply's people so the page can ask "Are you X or Y?"; it sets or clears **no cookies** and stores
  nothing.
- **Lifetime:** valid while the reply exists; withdrawing the reply invalidates it everywhere.
- Anyone who has the link can see and change that reply, like with the cookie. Guests should keep it
  to themselves (the page says so).

## Browser storage (guest's device)

| Name            | Type and attributes (from the code)                                     | Content                        | Lifetime                                                  | Basis               |
| --------------- | ----------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------- | ------------------- |
| `wp_rsvp`       | Cookie, `HttpOnly; Secure; SameSite=Strict; Path=/api/rsvp`, host-only  | Reply id and random edit token | `Max-Age` 365 days (`Rsvp__CookieLifetimeDays`, 1 to 400) | § 25(2) no. 2 TDDDG |
| `wp_rsvp_state` | Cookie, readable by the page, `Secure; SameSite=Lax; Path=/`, host-only | `yes` or `no`                  | Same as `wp_rsvp`                                         | § 25(2) no. 2 TDDDG |
| `wp.lang`       | `localStorage`                                                          | Chosen language                | Until the guest clears it                                 | § 25(2) no. 2 TDDDG |

- Sources: [`RsvpCookies.cs`](../../apps/api/src/WeddingPlanner.Api/Features/Rsvp/RsvpCookies.cs),
  [`CookieWriter.cs`](../../apps/api/src/WeddingPlanner.Api/Http/CookieWriter.cs) (`Max-Age` only,
  never `Expires` or `Domain`; cleared with `Max-Age=0`),
  [`RsvpOptions.cs`](../../apps/api/src/WeddingPlanner.Api/Features/Rsvp/RsvpOptions.cs) (default 365
  days; no app setting overrides it today), [`i18n.ts`](../../apps/web/src/site/i18n.ts) (`wp.lang`).
- Both cookies are set only when a reply is sent or claimed (a personal link opened), refreshed (a
  new `Max-Age`) whenever the page reads or changes the reply, and cleared when the reply is
  withdrawn or when a request with a stale cookie finds no reply (404, `RsvpHttp.NotFound`).
- **Map consent is not stored:** the click-to-load map asks again on every visit. A planned
  `wp.mapConsent` (`localStorage`, #36) must be added here and to the notice when it lands.
- **Admins only:** signing in to `/admin` (Microsoft account, SWA provider `aad`) makes the platform
  set its session cookie `StaticWebAppsAuthCookie` (HttpOnly, set and cleared by Static Web Apps at
  `/.auth/login/aad` and `/.auth/logout`; attributes and lifetime are Microsoft's). Guests never get
  it. Basis: § 25(2) no. 2 TDDDG (needed for the sign-in the admin asked for).
- **e2e only:** `wp_probe` (value `1`, `HttpOnly; Secure; SameSite=Strict; Path=/api/health`,
  `Max-Age` 60 seconds) is set by `GET /api/health/probe`, a platform probe that is off by default
  and switched on only in e2e (`HealthProbe__Enabled`, `infra/app/main.bicep`). Only the probe
  smoke script calls it ([ADR 0011](../adr/0011-client-ip.md)); the page never does, and in test and
  production it answers 404 and sets nothing.

No other cookies, no tracking, no consent banner (every entry is strictly necessary for a function the
guest or admin uses).

## Transient processing (not stored by the app)

| Data                    | Where                                                                                           | Purpose                     | Retention                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IP address              | Azure Static Web Apps edge (global) and the managed API (`swaLocation`)                         | Delivering the site and API | Microsoft's platform logs; not accessible to the app                                                                                                         |
| Request bodies          | The managed API (`swaLocation`, West US 2 by default) on the way to storage in `dataLocation`   | Saving a reply              | In memory for the request only                                                                                                                               |
| IP address (client key) | API memory per worker instance (`RateLimiting/`), only if `RateLimiting__ClientIpHeader` is set | Rate limiting               | Sliding window of minutes, never logged or stored. Default: no header is trusted on the managed API, so no IP is used ([ADR 0011](../adr/0011-client-ip.md)) |
| IP address              | OpenStreetMap Foundation (UK), only after "Show map"                                            | Map tiles                   | OSMF's policy; adequacy decision for the UK                                                                                                                  |

- **Dietary data passes through the United States** when `swaLocation` is a US region (West US 2 by
  default): the managed functions that receive and validate a reply run there, while the reply is
  stored only in `dataLocation` (Germany). The notice covers this with the transfer clause (EU-U.S.
  Data Privacy Framework plus standard contractual clauses); see the checklist.
- The `/api/health` keep-warm ping (only while RSVP is on) and `/version.json` carry no personal data
  beyond the technical request metadata every request has (IP address, user agent at the edge).
- External links (Google Maps directions, WhatsApp, playlists, hotel sites) send nothing until the
  guest opens them. Fonts and images are self-hosted. The CSP
  ([`build-swa-config.ts`](../../apps/web/swa-config/build-swa-config.ts)) allows two third-party
  origins: `img-src https://tile.openstreetmap.org` for the map tiles, and
  `frame-src https://www.openstreetmap.org`, which nothing uses (the map draws tiles, no page has an
  iframe; a follow-up drops it). The map tiles are requested with
  `Referrer-Policy: strict-origin-when-cross-origin`, so OSM sees only the site's origin.

## Telemetry and logs

Application Insights and Log Analytics in `dataLocation` ([`monitoring.bicep`](../../infra/app/modules/monitoring.bicep)):

- request and error telemetry **without** names, messages, dietary data, tokens, cookies, IP
  addresses or admin principals (enforced by `RsvpPrivacyTests` and the logging rules in
  [`apps/api/CLAUDE.md`](../../apps/api/CLAUDE.md));
- **IP masking is on:** `DisableIpMasking: false` on the Application Insights component, so the
  client IP is never stored (checked by `infra/app/tests/template.jq`);
- request telemetry of the Functions host records each request's URL path. Guest routes carry no
  id; the admin routes `PUT` and `DELETE /api/admin/rsvps/{id}` carry the reply's random id
  (pseudonymous: no name, but it identifies one reply in the tables);
- sampling: host requests are never sampled out (`excludedTypes: Request` in `host.json`); worker
  traces are rate-limited to 5 per second unless an `OTEL_TRACES_SAMPLER` app setting says otherwise
  (`Program.cs`);
- abuse signals are counts only: event **2101 `RsvpCapacityReached`** (the reply cap; the cap number
  only) and **2102 `RsvpSubmissionsRejected`** (number of refused new replies per reason: honeypot,
  fill time, name rules), each at most once per hour and worker instance;
- retention 30 days, daily cap 0.1 GB. Access: the operator.

## Backups

Nightly exports (01:30 UTC) and an export before every deploy of `test` and `production` go to a
separate backup storage account `bk…` in `dataLocation`, container `table-backups`
([runbook](../runbooks/backup-restore.md), [`backup-storage.bicep`](../../infra/app/modules/backup-storage.bicep)).
They contain every table, i.e. all fields above. Access: the operator (Entra ID only, no keys); the
nightly identity can only write new blobs.

**Retention:** a lifecycle rule deletes backups, their previous versions and snapshots after 18 days;
deleted blobs stay soft-deleted for 7 days. Worst case 18 + up to 3 lifecycle runs (each at most a day
apart) + 7 = **28 days** after a backup was written, or 29 if Azure counts the 18-day threshold only
in whole days (Microsoft Learn does not say), within the notice's promise ("backups are kept for at
most 30 days"). There is no immutability (WORM) policy, because lifecycle delete does not
work in an immutable container; the arithmetic, its sources and the one-time owner step to remove the
old policy are in the [runbook](../runbooks/backup-restore.md#retention-and-protection).

**Erasure:** deleting a reply removes it from the tables at once and from the backups within 30 days.
Faster removal from backups is possible by hand (runbook, "Erasure requests"). A restore must never
bring back a reply that was withdrawn or erased after the backup was taken.

## Other places

| Where                                     | What                                                                                                                                                      | Who                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| SWA role invitations                      | Email addresses (Microsoft accounts) of the admins with role `admin`                                                                                      | Operator; Microsoft        |
| Private instance repo (GitHub)            | `instance.json` (admin and alert emails, budget), `site-content.json` (couple's names, contact data, controllers, wedding-party names and photos, places) | Owner; GitHub as processor |
| Azure action group and budget (bootstrap) | Alert email addresses                                                                                                                                     | Operator; Microsoft        |
| Data account (`st…`)                      | Only the tables above; no blob containers hold personal data                                                                                              | Operator                   |

This public repository and its CI hold fictional sample data only (Anna & Ben, `example.com`);
deploy logs print codes, counts and hashes, never content or hostnames.

## Environments

| Environment  | Content                                   | Replies in its tables                                                                                     |
| ------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `e2e`        | The fictional sample (`samples/instance`) | Fictional only: automated tests and the backup drill's canary rows                                        |
| `test`       | The real instance                         | Test entries by the owner and invited testers (their own data; may include acceptance replies); no guests |
| `production` | The real instance                         | Real guest replies once `features.rsvp` is on                                                             |

`test` gets the same backups and retention as production. Clear test replies before the invitations
go out and on the deletion date, like production.

## Guests' rights: how each one is served

| Right                               | While RSVP is open                                         | After the deadline                                                                    |
| ----------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Access (Art. 15)                    | The guest sees their reply (cookie or personal link)       | Read-only on the page; anything else by email: an admin reads it in the admin area    |
| Rectification (Art. 16)             | The guest changes it                                       | An admin changes it (`PUT /api/admin/rsvps/{id}`; admins may edit after the deadline) |
| Erasure, withdrawal (Art. 17, 7(3)) | The guest withdraws the reply: deleted at once             | An admin deletes it (`DELETE /api/admin/rsvps/{id}`, a hard delete)                   |
| Portability (Art. 20)               | On request: the admin's CSV export, cut to that guest      | The same                                                                              |
| Backups                             | Deleted data leaves the backups within 30 days (see above) | The same                                                                              |

Requests reach the couple through `privacy.email`. There is no self-service erasure after the
deadline; that is a manual admin step, so answer such requests within a month (Art. 12(3)).

## Deletion procedure (owner)

On or before `privacy.deleteBy`:

1. Export what the couple still needs offline (it then leaves this system; it must not contain dietary
   data unless the couple keeps the guests' consent for it).
2. Delete all entities of `Rsvps` (and `Guests`, `MatchDecisions`, `Settings` once they exist) in
   `test` and `production`.
3. Stop the nightly backup. The lifecycle rule deletes the remaining backups within 30 days; check
   with the command in the runbook that nothing older is left (previous versions and soft-deleted
   blobs included), then delete the backup account if the deployment is retired.
4. Switch `rsvp` and `admin` off in `instance.json` for every environment, remove the admins' SWA
   role invitations, and delete exported CSV files.
5. Telemetry ages out after 30 days on its own.
