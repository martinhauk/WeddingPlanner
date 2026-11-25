# API: RSVP endpoints

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
  (300), `Rsvp__CookieLifetimeDays` (365), `Storage__TablePrefix` (none), and the rate limits below.

The deadline is an ISO 8601 date-time, with offset (`2099-05-01T23:59:00+02:00`) or local to
`Rsvp__TimeZone`. A space may replace the `T`; use that form in `local.settings.json`, because Core
Tools rewrites `T`-separated date strings from that file into culture-formatted dates. Replies can be
created, changed and deleted **until and including** the deadline.

## Endpoints

| Method and route       | Function         | Success                                        | Purpose                                      |
| ---------------------- | ---------------- | ---------------------------------------------- | -------------------------------------------- |
| `GET /api/rsvp/status` | `RsvpStatus`     | 200 status                                     | Whether the form is open, deadline, limits   |
| `POST /api/rsvp`       | `RsvpCreate`     | 201 `{rsvp, version}`, cookies, ETag, Location | Create this browser's reply                  |
| `GET /api/rsvp/me`     | `RsvpGetMine`    | 200 `{rsvp, version, open, deadline}`, ETag    | Read the own reply (also after the deadline) |
| `PUT /api/rsvp/me`     | `RsvpUpdateMine` | 200 `{rsvp, version, open, deadline}`, ETag    | Replace the own reply (needs `If-Match`)     |
| `DELETE /api/rsvp/me`  | `RsvpDeleteMine` | 204, cookies cleared                           | Delete the own reply                         |

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
  "website": ""
}
```

| Field                   | Rule                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `attending`             | required boolean                                                                                 |
| `people`                | 1 to 6 entries (the guest plus up to `maxCompanions`); a "no" may name several people            |
| `people[].name`         | required, 1 to 80 characters after sanitising                                                    |
| `people[].id`           | optional; on `PUT`, send back the ids from the last read to keep them (admin matching uses them) |
| `people[].dietary.tags` | at most 10 of `vegetarian`, `vegan`, `glutenFree`, `lactoseFree` (exact spelling)                |
| `people[].dietary.note` | optional, at most 200 characters                                                                 |
| `message`               | optional, at most 1000 characters, line breaks kept                                              |
| `language`              | required language tag such as `de`, `en`, `es` (stored lower case)                               |
| `website`               | honeypot: hidden in the form, must be empty                                                      |

Text is NFC-normalised and trimmed; control characters, lone surrogates, Unicode noncharacters (such as
U+FFFE), format characters (category Cf: bidirectional controls, BOM, soft hyphen, zero-width space,
word joiner, tag characters and the like, except the joiners ZWJ and ZWNJ) and the Hangul fillers U+3164
and U+FFA0 are removed; names and notes collapse whitespace to single spaces. Text with nothing visible
left (only whitespace, joiners or variation selectors) counts as empty, so such a name is `required`.
An unknown tag is `unknown_tag` per entry; more than 10 entries are one `too_many` for the whole list.
For a "no", dietary data is dropped and never stored. Unknown members are ignored; duplicate members,
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

## Errors

| Status | `code`                   | When                                                                                                                     |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 400    | `invalid_json`           | Malformed JSON, `null`, wrong types, duplicate members                                                                   |
| 400    | `validation_failed`      | Validation; `errors: [{field, code}]` with `required`, `too_long`, `too_many`, `unknown_tag`, `invalid`, `must_be_empty` |
| 403    | `cross_site_request`     | A write with `Sec-Fetch-Site: cross-site`                                                                                |
| 403    | `rsvp_closed`            | `POST`, `PUT` or `DELETE` after the deadline                                                                             |
| 404    | `not_found`              | Feature off, or no valid `wp_rsvp` cookie for `/me` (cookies cleared)                                                    |
| 409    | `rsvp_exists`            | `POST` from a browser that already has a reply                                                                           |
| 412    | `precondition_failed`    | `If-Match` does not match the current reply                                                                              |
| 413    | `payload_too_large`      | Body above 16 KB (`maxBytes`), with or without `Content-Length`                                                          |
| 415    | `unsupported_media_type` | A body that is not `application/json` (UTF-8)                                                                            |
| 428    | `precondition_required`  | `PUT` without `If-Match`                                                                                                 |
| 429    | `rate_limited`           | Rate limit; `Retry-After` in seconds                                                                                     |
| 500    | `internal_error`         | Unexpected failure (no details)                                                                                          |
| 503    | `not_configured`         | Storage or deadline missing or invalid                                                                                   |
| 503    | `capacity_reached`       | `POST` when `Rsvp__MaxActiveRsvps` replies are stored                                                                    |

Every `/api/rsvp` response except the status is `Cache-Control: no-store`.

## Abuse protection

In the worker pipeline, before any storage I/O (`apps/api/CLAUDE.md`, "Request pipeline"):

- **Rate limits** (in memory, per worker instance): per client 10 writes per 10 minutes and 60 reads per
  minute, plus 120 writes per minute per instance for all clients together. Overridable with
  `RateLimiting__WritesPerClient`, `__WriteWindowSeconds`, `__ReadsPerClient`, `__ReadWindowSeconds`,
  `__InstanceWritesPerMinute`. The client key is the address in `RateLimiting__ClientIpHeader` (default
  `x-azure-clientip`), else the first `X-Forwarded-For` entry without port, else the connection address;
  IPv6 counts per /64. Addresses are never logged or stored. A write that the instance limit refuses
  gives its per-client permit back, and a write that the client limit refuses never uses the instance
  budget.
- **CSRF:** `SameSite=Strict` credential cookie, JSON-only bodies (a cross-site JSON request needs a
  preflight the API never answers; no CORS headers), and writes with `Sec-Fetch-Site: cross-site` are
  rejected.
- **Size:** bodies above 16 KB are rejected; at most 300 replies are stored.
- **Logs** contain no names, messages, dietary data, tokens, cookies or addresses; unexpected exceptions
  are logged by type only. Refusals are not logged per request: reaching the reply cap is a warning at
  most once per hour and worker instance, so spam at the cap cannot fill the daily Application Insights
  cap.

## Storage

Table `Rsvps` (plus `Storage__TablePrefix`), partition `rsvp`, row key = reply id. Columns:
`Attending`, `People` (JSON `[{id, name, tags, note}]`), `PersonCount`, `AttendingCount` (people coming,
0 for a no), `Message`, `Language`, `TokenHash`, `CreatedAt`, `UpdatedAt`, `SchemaVersion` (1). No IP
addresses and no tokens are stored.

## Not implemented yet

From the architecture, still open: the personal edit link and `POST /api/rsvp/claim` (moving a reply to
another device), the minimum fill time (`Rsvp__MinSubmitMs`), and the admin `Settings` overrides
(`deadlineOverride`, `closedManually`) in the open check.
