# API: RSVP and admin endpoints

The public RSVP API of the Functions app (`apps/api`). Everything lives under `/api`, bodies are JSON in
camelCase (members that are `null` are omitted), timestamps are UTC ISO 8601 with `Z`, and every error
is an RFC 9457 problem (`application/problem+json`) with a stable `code`:

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "Bad Request",
  "status": 400,
  "code": "validation_failed",
  "errors": [{ "field": "people[0].name", "code": "required" }]
}
```

The architecture overview is in [architecture.md](architecture.md) (sections 6 to 8 and 13).

## Feature flag and configuration

- **`Features__Rsvp`** (from `instance.json` `environments.<env>.features.rsvp`): while it is off, every
  `/api/rsvp*` route answers 404 `not_found` before anything else runs, indistinguishable from a
  missing route.
- **`Storage__ConnectionString`**, **`Rsvp__Deadline`**, **`Rsvp__TimeZone`**: written by Bicep. Without
  storage, or without a valid deadline, the endpoints answer 503 `not_configured` (reading an existing
  reply only needs storage) and the status reports `enabled: false`.
- Optional, with code defaults: `Rsvp__MaxCompanions` (5, can only be lowered), `Rsvp__MaxActiveRsvps`
  (300), `Rsvp__CookieLifetimeDays` (365), `Rsvp__MinSubmitMs` (2500, see "Abuse protection"),
  `Storage__TablePrefix` (none), and the rate limits below.

The deadline is an ISO 8601 date-time, with offset (`2099-05-01T23:59:00+02:00`) or local to
`Rsvp__TimeZone`. A space may replace the `T`; use that form in `local.settings.json`, because Core
Tools rewrites `T`-separated date strings from that file into culture-formatted dates. Replies can be
created, changed and deleted **until and including** the deadline.

## Endpoints

| Method and route       | Function         | Success                                                         | Purpose                                                 |
| ---------------------- | ---------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/rsvp/status` | `RsvpStatus`     | 200 status                                                      | Whether the form is open, deadline, limits              |
| `POST /api/rsvp`       | `RsvpCreate`     | 201 `{rsvp, version, editToken}`, cookies, ETag, Location       | Create this browser's reply                             |
| `GET /api/rsvp/me`     | `RsvpGetMine`    | 200 `{rsvp, version, open, deadline, editToken}`, ETag          | Read the own reply (also after the deadline)            |
| `PUT /api/rsvp/me`     | `RsvpUpdateMine` | 200 `{rsvp, version, open, deadline, editToken}`, ETag          | Replace the own reply (needs `If-Match`)                |
| `DELETE /api/rsvp/me`  | `RsvpDeleteMine` | 204, cookies cleared                                            | Delete the own reply                                    |
| `POST /api/rsvp/claim` | `RsvpClaim`      | 200 `{rsvp, version, open, deadline, editToken}`, cookies, ETag | Open a reply in this browser by its edit link           |
| `POST /api/rsvp/claim` | `RsvpClaim`      | with `"preview": true`: 200 `{names}`, no cookies               | Whose reply a link opens, before it replaces this one's |

### `GET /api/rsvp/status`

```json
{
  "enabled": true,
  "open": true,
  "full": false,
  "deadline": "2099-05-01T21:59:00Z",
  "timeZone": "Europe/Berlin",
  "limits": {
    "maxPeople": 6,
    "maxCompanions": 5,
    "maxNameLength": 80,
    "maxNoteLength": 200,
    "maxMessageLength": 1000,
    "dietaryTags": ["vegetarian", "vegan", "glutenFree", "lactoseFree"]
  }
}
```

`open` means new replies are accepted: configured, deadline not passed, and fewer than
`Rsvp__MaxActiveRsvps` replies stored (`full`). The answer is cached in memory for 60 seconds per worker
instance and sent with `Cache-Control: public, max-age=60`, so `open` may lag the deadline by up to a
minute; writes check the deadline exactly. No cookies, no personal data. If counting the stored replies
fails (storage error, network failure or timeout), the status reports `full: false`, is not cached, and
the failure is logged by exception type only, at most once per hour and worker instance.

### Request body of `POST /api/rsvp` and `PUT /api/rsvp/me`

```json
{
  "attending": true,
  "people": [
    {
      "name": "Pablo Pérez",
      "dietary": { "tags": ["vegetarian", "glutenFree"], "note": "Sin nueces" }
    },
    { "id": "e8132d57", "name": "María-José García", "dietary": { "tags": ["vegan"] } }
  ],
  "message": "¡Felicidades!",
  "language": "es",
  "website": "",
  "dietaryConsent": true,
  "elapsedMs": 41250
}
```

| Field                   | Rule                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `attending`             | required boolean                                                                                 |
| `people`                | 1 to 6 entries (the guest plus up to `maxCompanions`); a "no" may name several people            |
| `people[].name`         | required, 2 to 80 characters after sanitising, a letter, no web address or `@` (see below)       |
| `people[].id`           | optional; on `PUT`, send back the ids from the last read to keep them (admin matching uses them) |
| `people[].dietary.tags` | at most 10 of `vegetarian`, `vegan`, `glutenFree`, `lactoseFree` (exact spelling)                |
| `people[].dietary.note` | optional, at most 200 characters                                                                 |
| `message`               | optional, at most 1000 characters, line breaks kept                                              |
| `language`              | required language tag such as `de`, `en`, `es` (stored lower case)                               |
| `website`               | honeypot: hidden in the form, must be empty (else 400 `submission_rejected`)                     |
| `dietaryConsent`        | `true` required when any stored person has a dietary tag or note, else `required`                |
| `elapsedMs`             | `POST` only: whole ms since the form was shown; missing or too low is 400 `submission_rejected`  |

Text is NFC-normalised and trimmed; control characters, lone surrogates, Unicode noncharacters (such as
U+FFFE), format characters (category Cf: bidirectional controls, BOM, soft hyphen, zero-width space,
word joiner, tag characters and the like, except the joiners ZWJ and ZWNJ) and the Hangul fillers U+3164
and U+FFA0 are removed; names and notes collapse whitespace to single spaces. Text with nothing visible
left (only whitespace, joiners or variation selectors) counts as empty, so such a name is `required`.
An unknown tag is `unknown_tag` per entry; more than 10 entries are one `too_many` for the whole list.

**Names** (domain rules, `PersonNames`): fewer than 2 characters (Unicode code points, after sanitising) is
`too_short`; a name without a letter, with `@` (or the full-width `＠`), or with a web address is `invalid`.
A web address is `://` anywhere, `www.` at the start of a word, or a domain `label.tld`. Any top-level
domain makes one when a path, query, fragment or port follows (`x.ly/abc`, `J.de/x`, `example.ai:8080`).
Without one, the top-level domain must be on a curated list of common and abuse-heavy ones (`com`, `net`,
`org`, `io`, `co`, `shop`, `xyz`, `bond`, `lol`, `es`, `uk`, …) and not be followed by a letter or digit
(`example.com`, `x.io`, `spam.shop`); top-level domains that are also name particles, abbreviations or
short names (`de`, `fr`, `ch`, `li`, `lu`, `hu`, `ly`, `su`, `to`, `ai`, `asia`) make a domain only at the
end of the name (nothing but characters other than letters and digits follow, `example.de`, `bit.ly`) and
after a label that is no initial, so `J.de Vries`, `Mª.de los Ángeles`, `MA.DE LOS ANGELES`,
`HR.U.FR. MÜLLER` and `Wei J.LI` pass. Case: an all-caps top-level domain counts only after an all-caps
label (`EXAMPLE.COM`, but not `Dr.LI`, `Dr.med.LI` or `J.LINK`), a capitalised one never (`Prof.Dr.`,
`Lic.De la Cruz`), any other casing always (`example.cOM`). A common title is never the label (`DR.LI`,
`prof.lu`, `DR.PAGE`). Titles typed without spaces and initials pass, because their endings are not on
the list or are capitalised: `Dr.med.vet.`, `Prof.Dr.`, `Dr.in`, `Anna B.Sc.`, `J.R.R.`. A person whose
name an earlier person of the same reply already has is `duplicate` on the
later one; the comparison ignores case, diacritics and punctuation (`María-José García` =
`maria jose GARCIA`), but does not transliterate (`Müller` ≠ `Mueller`). The rules apply to `POST`,
`PUT` and the admin edit alike. The API is the only authority for the web-address rule: before it
sends, the form checks only the unambiguous cases (required, too long, too short, no letter, `@`, `://`,
`www.` starting a word, `duplicate`) and leaves domains to the API, whose `invalid` finding it shows at
that person's name field with the same message.

For a "no", dietary data is dropped and never stored. Allergies and intolerances can be health data
(GDPR Art. 9), so dietary data is stored only with explicit consent: a reply that still has a dietary
tag or note after validation needs `dietaryConsent: true`, otherwise it is 400 `validation_failed` with
`dietaryConsent` / `required` (checked after the other rules). The reply stores the flag
(`dietaryConsent` in the view: `true` exactly when dietary data was stored with consent). Unknown members are ignored; duplicate members,
wrong types or a non-object body are 400 `invalid_json`. Lengths count UTF-16 code units, like
`maxlength` in the browser.

### The reply (`rsvp`)

```json
{
  "id": "1b86eb8e593b91c86f2d8d37d4fd593a",
  "attending": true,
  "people": [
    {
      "id": "5e97e056",
      "name": "Pablo Pérez",
      "dietary": { "tags": ["vegetarian"], "note": "Sin nueces" }
    }
  ],
  "message": "¡Felicidades!",
  "language": "es",
  "dietaryConsent": true,
  "createdAt": "2099-04-01T10:00:00Z",
  "updatedAt": "2099-04-01T10:00:00Z"
}
```

## Identity: cookies and concurrency

- `POST` creates a random reply id (16 bytes, hex) and edit token (32 bytes, base64url). Only the
  SHA-256 hash of the token is stored; it is compared in constant time.
- `wp_rsvp=<id>.<token>; Max-Age=31536000; Path=/api/rsvp; Secure; HttpOnly; SameSite=Strict` identifies
  the reply. `wp_rsvp_state=yes|no; Max-Age=31536000; Path=/; Secure; SameSite=Lax` (readable by scripts,
  no personal data) lets the page show "answered" without an API call. Never `Expires` or `Domain`.
  `GET` and `PUT` refresh both; `DELETE` and an unknown cookie clear both with `Max-Age=0`.
- A `POST` that carries a valid `wp_rsvp` cookie answers 409 `rsvp_exists`; an unknown or malformed
  cookie is ignored and a new reply is created.
- `POST`, `GET` and `PUT` return the reply's entity tag twice: as a strong `ETag` header and as
  `version` in the body (the same string, quotes included), so the client still has it if a proxy drops
  or weakens the header. `PUT` requires `If-Match` with it (428 `precondition_required` without, 412
  `precondition_failed` when the reply changed since); `*` skips the check. `If-Match` may list several
  tags, and a `W/` prefix is ignored. `DELETE` checks `If-Match` only when sent. Internally the tag is
  the Table Storage ETag without its `W/` prefix.

## Personal edit link and `POST /api/rsvp/claim`

Guests often reply in a messenger's in-app browser, whose cookies the phone's real browser (or another
device) never sees. The personal edit link moves a reply to another browser, so the guest can change it
there instead of answering twice.

- **The credential is the cookie's:** the 201 of `POST /api/rsvp` carries `editToken: "<id>.<token>"`,
  the same value as the `wp_rsvp` cookie (256-bit random token, only its SHA-256 hash stored). Every
  answer about the own reply returns it too (`GET` and `PUT /me`, the claim: the credential of the
  request's own cookie, or of the claimed link), so a returning guest can see the link again (owner
  decision). It is never logged, and these responses are `no-store`. The page shows it as
  `<site origin>/#edit=<editToken>` with a copy button: at once on the success screen, and behind a
  "show your personal link" button for a returning guest. The secret is therefore readable by scripts on
  the page while the reply is shown; the strict CSP (no third-party scripts) keeps that risk low, and the
  `wp_rsvp` cookie itself stays HttpOnly.
- **A fragment, not a query:** browsers never send `#edit=…` to a server or in a `Referer`, so the token
  reaches neither the SWA edge, the Functions host logs nor a third party. The page reads it, scrolls to
  the RSVP section and calls the claim only once that section nears the viewport (the page-load rule:
  no API call except the keep-warm ping), then removes the fragment with `history.replaceState`.
- **`POST /api/rsvp/claim`** with `{"editToken": "<id>.<token>"}` answers 200
  `{rsvp, version, open, deadline, editToken}` with `ETag`, exactly like `GET /api/rsvp/me`, and sets both
  cookies (replacing any this browser held for another reply). It works after the deadline too
  (`open: false`, read-only), and needs only storage (503 `not_configured` without it).
- **Preview:** with `{"editToken": "…", "preview": true}` a valid link answers 200
  `{"names": ["…", …]}`: only the names of its reply's people, the guest first. No version, no reply
  details, and **no cookie is set or cleared**. A browser that already holds a reply uses it to ask the
  guest "Are you X or Y?" before a claim would replace that reply (see below). Every failure takes the
  same path and gives the same 404 as a claim. `preview` is optional (omitted or `false`: a claim), so
  older request bodies keep working; a `preview` that is not a boolean is 400 `invalid_json`.
- **The page's flow when this browser already has a reply** (`wp_rsvp_state` present): once the section
  nears the viewport it reads `GET /me`. A 404 (stale cookie) claims as without a reply; the same reply
  id as the link's needs no claim (the page just shows it and removes the fragment); another reply makes
  it preview the link and ask "Wer seid ihr? Seid ihr X oder Y?" (de/en/es, names joined with
  `Intl.ListFormat`) with one button per answer. This browser's names keep its reply (no claim); the
  link's names claim it. A preview 404 shows the friendly wrong-link message and keeps this browser's
  reply.
- **One answer for every failure:** a malformed token, an unknown id, a wrong token and a withdrawn
  (deleted) reply all answer the same 404 `not_found`, so the response never reveals whether an id
  exists. The token is hashed and compared in constant time, against a random decoy hash when the id is
  unknown. A 404 leaves the browser's cookies untouched (a mistyped link must not make it forget its
  own reply). A body that is not a JSON object, or an `editToken` that is not a string, is 400
  `invalid_json`.
- **Lifetime:** the link stays valid while the reply exists; changing the reply keeps it. Withdrawing
  (`DELETE /me`) deletes the reply and so invalidates the link everywhere.
- **Abuse:** the claim is a write for the pipeline (`Rsvp*`, `POST`): gated by `Features__Rsvp`,
  rate-limited like every write (a wrong token costs the same permit as a right one), JSON only and
  refused cross-site. Guessing a 256-bit token is not feasible within any rate limit.
- **Deployed tests:** the WP3 write-path test on `e2e` will add a claim step (a second browser context
  opens the link from the success screen).

## Errors

| Status | `code`                   | When                                                                                                                              |
| ------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_json`           | Malformed JSON, `null`, wrong types, duplicate members                                                                            |
| 400    | `validation_failed`      | Validation; `errors: [{field, code}]` with `required`, `too_short`, `too_long`, `too_many`, `duplicate`, `unknown_tag`, `invalid` |
| 400    | `submission_rejected`    | `POST` or `PUT` refused as automated (honeypot, minimum fill time); never says which check failed                                 |
| 403    | `cross_site_request`     | A write with `Sec-Fetch-Site: cross-site`                                                                                         |
| 403    | `rsvp_closed`            | `POST`, `PUT` or `DELETE` after the deadline                                                                                      |
| 404    | `not_found`              | Feature off; no valid `wp_rsvp` cookie for `/me` (cookies cleared); a claim with a wrong, malformed or withdrawn edit token       |
| 409    | `rsvp_exists`            | `POST` from a browser that already has a reply                                                                                    |
| 412    | `precondition_failed`    | `If-Match` does not match the current reply                                                                                       |
| 413    | `payload_too_large`      | Body above 16 KB (`maxBytes`), with or without `Content-Length`                                                                   |
| 415    | `unsupported_media_type` | A body that is not `application/json` (UTF-8)                                                                                     |
| 428    | `precondition_required`  | `PUT` without `If-Match`                                                                                                          |
| 429    | `rate_limited`           | Rate limit; `Retry-After` in seconds                                                                                              |
| 500    | `internal_error`         | Unexpected failure (no details)                                                                                                   |
| 503    | `not_configured`         | Storage or deadline missing or invalid                                                                                            |
| 503    | `capacity_reached`       | `POST` when `Rsvp__MaxActiveRsvps` replies are stored                                                                             |

Every `/api/rsvp` response except the status is `Cache-Control: no-store`.

## Abuse protection

In the worker pipeline, before any storage I/O (`apps/api/CLAUDE.md`, "Request pipeline"):

- **Rate limits** (in memory, per worker instance): per client 10 writes per 10 minutes and 60 reads per
  minute, plus 120 writes per minute per instance for all clients together. Overridable with
  `RateLimiting__WritesPerClient`, `__WriteWindowSeconds`, `__ReadsPerClient`, `__ReadWindowSeconds`,
  `__InstanceWritesPerMinute`. The client key is the address in the trusted header named by
  `RateLimiting__ClientIpHeader` (port removed, IPv6 per /64). Its code default is empty: on the SWA
  managed API no header carries the caller's address (the candidates are spoofable or shared platform
  addresses, [ADR 0011](adr/0011-client-ip.md)), so no header is trusted. `X-Forwarded-For` and the
  connection address are never used. A request without a client key skips the per-client limits and
  only the per-instance write limit applies. Addresses are never logged or stored. A write that the instance
  limit refuses gives its per-client permit back, and a write that the client limit refuses never uses
  the instance budget.
- **Platform probe:** `GET /api/health/probe` (switch `HealthProbe__Enabled`, code default off, on for
  `e2e` only) with `scripts/smoke/api-probe.sh`. It found that the per-client limits cannot be keyed on
  the managed API, so the per-instance limit protects it ([ADR 0011](adr/0011-client-ip.md)). Re-run it on
  `e2e` after platform changes; set `RateLimiting__ClientIpHeader` only if it reports a header that the
  platform overwrites with the caller's address.
- **CSRF:** `SameSite=Strict` credential cookie, JSON-only bodies (a cross-site JSON request needs a
  preflight the API never answers; no CORS headers), and writes with `Sec-Fetch-Site: cross-site` are
  rejected.
- **Submission guard** (`Features/Rsvp/RsvpSubmissionGuard`), right after the body is read and before
  validation or any storage I/O: a filled-in honeypot `website` (`POST` and `PUT`), or on `POST` an
  `elapsedMs` below `Rsvp__MinSubmitMs` or missing, answers 400 `submission_rejected` with no `errors`
  and no hint at the reason, so a bot cannot tell the honeypot from the timer. Refusals are not logged
  one by one, only counted (see "Logs" below).
  `Rsvp__MinSubmitMs` is 0 (off) to 60000; its code default is 2500, and a missing or invalid value keeps
  the default. The form measures the time from showing the form to sending it (it does not reset after a
  refusal, so pressing save again works). The value is client-supplied: it stops naive bots and scripts
  that fill the form instantly, not a targeted attack; the per-instance write limit and the reply cap
  remain the backstop.
- **Automated tests against a deployed environment** (the WP3 write-path test on `e2e`) keep the
  production setting and wait instead: a browser test spends at least `Rsvp__MinSubmitMs` (plus a margin)
  between opening the form and saving, and a direct API call sends an honest `elapsedMs`. Bicep does not
  set `Rsvp__MinSubmitMs`, so every environment checks the same fill time as production; the app setting
  stays available as a per-environment override should a test ever need it.
- **Size:** bodies above 16 KB are rejected; at most 300 replies are stored.
- **Logs** contain no names, messages, dietary data, tokens, cookies or addresses; unexpected exceptions
  are logged by type only. Refusals are not logged per request: reaching the reply cap is a warning at
  most once per hour and worker instance, so spam at the cap cannot fill the daily Application Insights
  cap.
- **Refused new replies are counted:** a create refused by the honeypot, the fill time or the name rules
  (a name that is too short, has no letter, a web address or `@`) is counted per reason, and a warning
  **`RsvpSubmissionsRejected`** (event id 2102) reports the counts at most once per hour and worker
  instance: `RsvpSubmissionsRejected: <n> new replies refused since the last report (honeypot <a>, fill
  time <b>, name rules <c>; …)`. Counts only: no names, bodies or addresses. The first refusal is
  reported at once; the ones after it wait for the next refusal after the hour. Name-rule refusals still
  answer 400 `validation_failed` with the field error (a real guest can fix a name), not
  `submission_rejected`.
- **Alert signal for the cap:** that warning has the event name **`RsvpCapacityReached`** (event id
  2101, `EventName` in the log record) and its message starts with `RsvpCapacityReached:`, followed by the
  cap (`MaxActiveRsvps`). An Application Insights log alert can match it with
  `traces | where message startswith "RsvpCapacityReached"` (or on `customDimensions.EventName` where the
  exporter records it). There is no separate metric: the worker exports logs and traces only. No alert
  rule is deployed; adding one in Application Insights is an owner option.

## Storage

Table `Rsvps` (plus `Storage__TablePrefix`), partition `rsvp`, row key = reply id. Columns:
`Attending`, `People` (JSON `[{id, name, tags, note}]`), `PersonCount`, `AttendingCount` (people coming,
0 for a no), `Message`, `Language`, `DietaryConsent` (missing on older rows: read as `false`),
`TokenHash`, `CreatedAt`, `UpdatedAt`, `SchemaVersion` (1). No IP
addresses and no tokens are stored.

## Admin endpoints

Gated by `Features__Admin` (404 `not_found` while off) and, in this order, by the admin guard
(`Security/AdminAuthorizationMiddleware`): it decodes the base64 JSON of `x-ms-client-principal` (set
by SWA for signed-in users) and answers 401 `unauthorized` without a valid principal and 403 `forbidden`
unless the principal has role `admin` and `identityProvider` `aad`. The SWA route rule `/api/admin*`
requires role `admin` as well. Every admin response is `no-store`; writes pass the same origin and
content-type checks as RSVP writes (bodies up to 256 KB). Admins may change replies after the deadline.

| Endpoint                       | Function           | Answer                                                                                            |
| ------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------- |
| `GET /api/admin/rsvps`         | `AdminRsvpsList`   | 200 `{rsvps, totals}`, latest change first                                                        |
| `PUT /api/admin/rsvps/{id}`    | `AdminRsvpsUpdate` | 200 `{rsvp}`; body as for `PUT /api/rsvp/me`; `If-Match` required (428 / 412)                     |
| `DELETE /api/admin/rsvps/{id}` | `AdminRsvpsDelete` | 204; `If-Match` optional (412 when stale)                                                         |
| `GET /api/admin/export.csv`    | `AdminExportCsv`   | 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="antworten-<date>.csv"` |

An unknown or malformed `id` answers 404 `not_found`. Each reply in `rsvps` is the reply view above plus
`version` (its ETag for `If-Match`). `totals`: `replies`, `yes`, `no`, `attendingPeople` (headcount),
`declinedPeople`, `dietary` (attending people per tag: `vegetarian`, `vegan`, `glutenFree`,
`lactoseFree`), `dietaryNotes`, `messages`.

**CSV export** (made for German Excel): UTF-8 with BOM, `;` separator, CRLF, one row per person,
replies oldest first. Columns: `Antwort-ID`, `Zusage` (`ja`/`nein`), `Person` (1 = the guest), `Name`,
one `x` column per dietary tag, `Hinweis Essen`, `Nachricht` (only on the guest's row), `Sprache`,
`Erstellt`, `Geändert` (`yyyy-MM-dd HH:mm` in `Rsvp__TimeZone`). Every cell is quoted (`"` doubled), and
a cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'` against CSV injection.

**Routes:** the Functions host refuses routes that start with `admin`, so the admin routes start with
the constrained parameter `{adminArea:regex(^admin$)}` (`Features/Admin/AdminRoutes`). The public path
stays `/api/admin/…` (verified with Core Tools 4.17; to be confirmed on the SWA managed host).

## Not implemented yet

From the architecture, still open: the admin `Settings` overrides (`deadlineOverride`,
`closedManually`) in the open check, and `UpdatedBy` (`guest`/`admin`) on stored replies.
