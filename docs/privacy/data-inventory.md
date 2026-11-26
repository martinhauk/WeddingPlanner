# Data inventory

Every piece of personal data a WeddingPlanner deployment processes: what it is, why, where it lives,
how long it is kept and who can see it. It backs the guest-facing privacy notice (`/datenschutz`,
built-in text in [`apps/web/src/site/privacy/privacy-text.ts`](../../apps/web/src/site/privacy/privacy-text.ts))
and the couple's record of processing activities.

**Keep both true to the code.** A change that stores, logs, sends or loads something new updates this
file and the notice text in the same commit.

Terms: the **couple** are the controllers (named in `site-content.json` `privacy.controllers`); the
**operator** runs the Azure subscription and the deploy (often one of the couple); **Microsoft** is the
processor (Azure, Art. 28 GDPR). Regions come from `instance.json`: `swaLocation` (site and API,
default `westus2`) and `dataLocation` (all data at rest, default `germanywestcentral`).

## Guest replies: table `Rsvps`

One entity per reply ([`TableRsvpRepository`](../../apps/api/src/WeddingPlanner.Api/Storage/Rsvps/TableRsvpRepository.cs),
contract in [`docs/api.md`](../api.md)). Stored in Azure Table Storage in `dataLocation`.

| Field                            | Content                                          | Purpose                                  | Legal basis                  |
| -------------------------------- | ------------------------------------------------ | ---------------------------------------- | ---------------------------- |
| `People[].name`                  | Names of the guest and companions (or of a "no") | Guest list                               | Art. 6(1)(a), 6(1)(b) GDPR   |
| `Attending`, counts              | Yes or no, number of people                      | Guest list, planning                     | Art. 6(1)(a), 6(1)(b) GDPR   |
| `People[].tags`                  | vegetarian, vegan, glutenFree, lactoseFree       | Food planning (only for a "yes")         | Art. 9(2)(a) GDPR (explicit) |
| `People[].note`                  | Free text: allergies, intolerances (health data) | Food planning (only for a "yes")         | Art. 9(2)(a) GDPR (explicit) |
| `DietaryConsent`                 | `true` when dietary data was stored with consent | Proof of consent (Art. 7(1) GDPR)        | Art. 6(1)(c) GDPR            |
| `Message`                        | Optional free text to the couple                 | Personal message                         | Art. 6(1)(a) GDPR            |
| `Language`                       | `de`, `en` or `es`                               | Answering in the guest's language        | Art. 6(1)(b) GDPR            |
| `CreatedAt`, `UpdatedAt`         | Timestamps (UTC)                                 | Deadline handling, support               | Art. 6(1)(b) GDPR            |
| `TokenHash`, row key, person ids | SHA-256 of the edit token, random ids            | Letting the guest change their own reply | Art. 6(1)(b) GDPR            |

- Dietary data is dropped for a "no" and is stored only with `dietaryConsent: true` (the API answers
  400 otherwise; the form asks for consent as soon as dietary data is entered).
- No IP addresses, cookies or tokens are stored.
- **Retention:** until the guest withdraws the reply (deleted at once) or, at the latest, the deletion
  date `privacy.deleteBy` (default: the last day of the third month after the wedding,
  `privacyDeleteBy` in `@weddingplanner/content`).
- **Access:** the couple (admin area, role `admin` via SWA invitation, Microsoft sign-in), the operator
  (Azure subscription), Microsoft as processor. The guest sees and edits only their own reply (cookie).
  Dietary details may be passed on, without other data than names, to the kitchen or caterer.

The tables `Guests`, `MatchDecisions` and `Settings` (admin area, ADR 0002) hold the couple's own
guest list and matching decisions; add their fields here when the admin tasks land.

## Browser storage (guest's device)

| Name            | Type                                       | Content                        | Lifetime                  | Basis               |
| --------------- | ------------------------------------------ | ------------------------------ | ------------------------- | ------------------- |
| `wp_rsvp`       | Cookie, HttpOnly, `Path=/api/rsvp`, Strict | Reply id and random edit token | 1 year (`Max-Age`)        | § 25(2) no. 2 TDDDG |
| `wp_rsvp_state` | Cookie, readable, `Path=/`, Lax            | `yes` or `no`                  | 1 year (`Max-Age`)        | § 25(2) no. 2 TDDDG |
| `wp.lang`       | `localStorage`                             | Chosen language                | Until the guest clears it | § 25(2) no. 2 TDDDG |

No other cookies, no tracking, no consent banner (every entry is strictly necessary for a function the
guest uses). The cookies are set only when a reply is sent.

## Transient processing (not stored by the app)

| Data                    | Where                                                         | Purpose                     | Retention                                            |
| ----------------------- | ------------------------------------------------------------- | --------------------------- | ---------------------------------------------------- |
| IP address              | Azure Static Web Apps edge and Functions host (`swaLocation`) | Delivering the site and API | Microsoft's platform logs; not accessible to the app |
| IP address (client key) | API memory per worker instance (`RateLimiting/`)              | Rate limiting against abuse | Sliding window of minutes, never logged or stored    |
| IP address              | OpenStreetMap Foundation (UK), only after "Show map"          | Map tiles                   | OSMF's policy; adequacy decision for the UK          |

External links (Google Maps directions, WhatsApp, playlists, hotel sites) send nothing until the guest
opens them. Fonts and images are self-hosted; the CSP allows no other third-party origin.

## Telemetry

Application Insights and Log Analytics in `dataLocation` (`infra/app/modules/monitoring.bicep`):
request and error telemetry without names, messages, dietary data, tokens, cookies or IP addresses
(enforced by `RsvpPrivacyTests` and the logging rules in `apps/api/CLAUDE.md`). Retention 30 days,
daily cap 0.1 GB. Access: the operator.

## Backups

Nightly exports of the tables to private blob storage in `dataLocation` (in progress: a separate backup
account with 30-day immutability, plus a backup before every deploy). Access: the operator. The privacy
notice promises that backups disappear no later than 30 days after the data is deleted; the deletion
procedure (and the backup lifecycle) must guarantee that.

## Deletion procedure (owner)

On or before `privacy.deleteBy`:

1. Export what the couple still needs offline (it then leaves this system; it must not contain dietary
   data unless the couple keeps the guests' consent for it).
2. Delete all entities of `Rsvps`, `Guests`, `MatchDecisions` and `Settings` in `test` and `production`.
3. Stop the nightly backup and delete the backup blobs as soon as their immutability ends (at most 30
   days later); check soft-deleted blobs and previous versions are gone too.
4. Switch `rsvp` and `admin` off in `instance.json` for every environment.
