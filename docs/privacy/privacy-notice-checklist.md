# Privacy notice checklist (owner)

What the owner checks and decides before guests can reply in production. The guest-facing notice is
the page `/datenschutz` (alias `/privacy`). What the system stores and why is in the
[data inventory](data-inventory.md); this list turns it into decisions and text checks.

> **Not legal advice.** This is a structured checklist written from the code, so nothing the notice
> must cover is forgotten. When in doubt about a legal question (marked **Open question**), ask
> someone qualified. Roles only here: the real names, addresses, emails and dates live in the
> private instance repo and never in this repository.

## Where the text lives

| Part                                                                                                                                   | Where                                                                                                                               | Who edits it                    |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| The built-in notice (data, purposes, legal bases, Azure, US transfer, OSM, cookies, retention, rights, imprint note), in de, en and es | [`apps/web/src/site/privacy/privacy-text.ts`](../../apps/web/src/site/privacy/privacy-text.ts) (this repository; generic, no names) | A PR here                       |
| Controllers (names, optional postal address), privacy contact email, deletion date, extra paragraphs, optional imprint                 | The private instance's `site-content.json`, block `privacy` (`controllers[]`, `email`, `deleteBy`, `extra[]`, `imprint`)            | The owner, in the instance repo |
| Azure regions named in the notice                                                                                                      | `instance.json` `swaLocation` and `dataLocation` (baked into `build.json`)                                                          | The owner                       |

The notice reads the instance's `site-content.json` `privacy` block, not a `pages.privacy` field of
`site.json` (that older format is no longer shown). The page fills `{controllers}`, `{email}`,
`{deleteBy}`, `{appRegion}` and `{dataRegion}` from it.

## Checklist

Tick each item on `test` (open `/datenschutz` there in German, English and Spanish), then approve.

### 1. Controllers and contact

- [ ] `privacy.controllers` lists every controller (usually both of the couple) with their **full
      names**, and a postal address if you want one shown (a contact route is required; an address
      is the usual choice).
- [ ] `privacy.email` is an address you read, reserved for privacy requests (access, erasure,
      withdrawing consent). Without it the notice falls back to "use the contact details on this
      site".
- [ ] Both are set: `content validate` fails with `E_PRIVACY_MISSING` / `E_PRIVACY_EMAIL` as soon as
      `environments.production.features.rsvp` is on without them (the instance repo's own check and
      the production deploy), and warns everywhere else.

### 2. Legal bases (section "Legal bases")

- [ ] Reply: consent by sending it voluntarily and handling the registration (Art. 6(1)(a) and (b)
      GDPR).
- [ ] Diet, allergies, intolerances: explicit consent (Art. 9(2)(a) GDPR).
- [ ] Delivering and protecting the site: legitimate interest (Art. 6(1)(f) GDPR).
- [ ] Cookies and local storage: strictly necessary (§ 25(2) no. 2 TDDDG), so no banner.

### 3. Dietary data (Art. 9 GDPR)

- [ ] The guest form asks for explicit consent as soon as any dietary data is entered (a tag or a
      note), stores it only for people who attend, and the guest API (`POST /api/rsvp`,
      `PUT /api/rsvp/me`) refuses dietary data without consent. Read the consent sentence under the
      dietary fields in all three languages; it names what is stored, that it is used only to plan
      the food, that the guest answers for companions with their agreement, and that consent can be
      withdrawn.
- [ ] **Admin edits need an attestation, enforced by the API.** When an admin adds or changes dietary
      data (a tag, a note, a new name for a person who keeps dietary data, a new person with dietary
      data), the admin editor shows the checkbox "Der Gast hat ausdrücklich eingewilligt, dass wir
      diese Angaben zum Essen speichern." and `PUT /api/admin/rsvps/{id}` refuses the edit without it
      (400). The reply then records that and when an admin attested (`DietaryConsentSource`
      `admin`), but not which admin and not the guest's proof. To replace a companion, remove the
      person and add the new one, so their dietary data does not move to someone else. Agree among
      the admins: **tick it only with that guest's explicit consent, and
      keep your own proof of it** (for example their email or message). The notice's "What data we
      process" says so too: dietary details given another way (for example by email) are entered
      only with explicit consent, and the consent, its time and where it was given are recorded.
- [ ] Dietary details go only to the kitchen or caterer, with names only (the notice's "purpose"
      paragraph says so). Decide how you pass them on (the CSV export leaves the system: keep it
      safe and delete it after the wedding).
- [ ] **Open question: do the tags need consent when there is no note?** The code treats every tag
      (vegetarian, vegan, gluten-free, lactose-free) as dietary data that needs consent, like the
      free-text note. Gluten-free and lactose-free can reveal health data; vegetarian and vegan can
      hint at beliefs. Default: keep asking for consent for tags too (the cautious choice). Change it
      only on qualified advice; it would need a code change and a new notice text.
- [ ] Optional: the consent sentence says the data is used "only to plan the food" but does not name
      the kitchen or caterer as a recipient. If you pass dietary details on, consider naming the
      recipient there too (a change to `dietConsent` in `apps/web/src/site/ui.ts`).

### 4. Dietary data passes through the United States

The Static Web App and its managed API run in `swaLocation` (West US 2 for this deployment's
default), while every reply is **stored** only in `dataLocation` (Germany West Central). So a
reply, including dietary data, is **received and processed in the USA** for the length of the
request before it is stored in Germany; telemetry and backups stay in Germany.

- [ ] The "Hosting and service providers" section names both regions (filled from `instance.json`)
      and shows the **US transfer clause**: servers in the USA are used, Microsoft is certified under
      the **EU-U.S. Data Privacy Framework** (adequacy decision, Art. 45 GDPR) and the **standard
      contractual clauses** apply as well (Art. 46 GDPR). The page shows this clause automatically
      when a region is in the USA; check that it is there.
- [ ] **Open question: should the dietary consent sentence mention the US processing?** The transfer
      itself rests on the adequacy decision and the clauses, not on consent, and the notice
      explains it. Mentioning it in the consent sentence too ("…processed on Microsoft servers,
      also in the USA") makes the explicit consent better informed. Default: notice only; decide
      with advice, then change `dietConsent` in `apps/web/src/site/ui.ts`.
- [ ] Alternative, if you would rather avoid the US entirely: `swaLocation` `westeurope` (a new
      Static Web App, a new URL; decided against until after the wedding, so the invitation link
      stays the same).

### 5. Retention and deletion date

- [ ] `privacy.deleteBy` is the day by which all replies are deleted (after the wedding; `validate`
      rejects an earlier date). Without it the notice says the last day of the third month after
      the wedding. Put the date in your calendar together with the deletion procedure in the
      [data inventory](data-inventory.md#deletion-procedure-owner).
- [ ] Backups: the notice promises the sentence quoted below (section "How long we keep data"). The
      infrastructure keeps every backup copy 27 to 29 days at most, depending on how Azure counts
      days ([runbook](../runbooks/backup-restore.md#retention-and-protection)), **but only once the
      old immutability (WORM) policy is deleted** in test and production (one-time step in the
      runbook). Make sure no `privacy.extra` paragraph promises anything else about backups.
- [ ] Withdrawing a reply deletes it at once; erasure requests by email: delete the reply in the
      admin area, answer "deleted now, gone from the backups within 30 days" (runbook, "Erasure
      requests").

The backup sentence to check (de, then en; es says the same):

> Sicherungskopien bewahren wir höchstens 30 Tage auf; gelöschte Daten verschwinden also spätestens
> 30 Tage später auch dort.
>
> We keep backups for no more than 30 days, so deleted data disappears from them within 30 days as
> well.

### 6. Imprint

- [ ] Decide: a private, non-commercial invitation without advertising needs no imprint (§ 5 DDG);
      the notice says so by default. To publish one anyway, set `privacy.imprint` (de/en/es). The
      footer links it at `/datenschutz#impressum`.

### 7. OpenStreetMap

- [ ] The notice's "Maps and links" section says that maps load only after "Show map", that the
      browser then fetches images from servers of the **OpenStreetMap Foundation (United Kingdom)**
      and sends them the IP address, and that the UK has an adequacy decision.
- [ ] The note under each "Show map" button says the same in short and links the notice.
- [ ] Optional: `tile.openstreetmap.org` is served through a content delivery network on OSMF's
      behalf. Compare the notice's wording with OSMF's own privacy policy and tile usage policy.
- [ ] External links (Google Maps directions, WhatsApp, playlists) send nothing before a click.

### 8. Cookies and local storage

- [ ] The notice lists exactly: `wp_rsvp` (credential, HttpOnly, one year), `wp_rsvp_state` ("yes"
      or "no", one year) and `wp.lang` (local storage, the language). Nothing else is set for guests.
- [ ] Admins only: Static Web Apps sets `StaticWebAppsAuthCookie` when an admin signs in. Guests never
      get it; the notice need not list it, but the record of processing may.
- [ ] If map consent is ever remembered (`wp.mapConsent`, planned), the notice must list it first.
- [ ] **The personal edit link** (`/#edit=…`): read the two paragraphs about it in "What data we
      process" in all three languages (#90). They say that guests get it after sending and can show
      it again, that whoever has it can see, change and withdraw the reply (so keep it to
      yourselves), that it works while the reply exists, that only a hash of its secret is stored,
      and that the secret stays in the part after "#", which browsers do not send to the server
      (the page itself sends it, encrypted, to open the reply).
- [ ] The `wp_rsvp` item says the cookie is set when a reply is sent **or** a personal link is opened
      (after "who are you?" if the device already has another reply), and the closing paragraph says
      that after deleting cookies the personal link opens the reply again, and that only the guest
      (until replies close) and you as hosts can change it.

### 9. Languages

- [ ] The built-in text is complete in de, en and es. Your `privacy.extra` paragraphs and the
      optional imprint need all three too: without them, English and Spanish guests read German
      (`validate` warns with `W_I18N_FALLBACK`).
- [ ] Read the whole page once per language on a phone.

### 10. Processors and other places

- [ ] Microsoft (Azure) is the processor under its Data Protection Addendum, which comes with the
      Azure subscription; GitHub holds the private instance repo (couple's and admins' data, no guest
      replies).
- [ ] Admins are invited by email (SWA role invitations) and sign in with a Microsoft account; turn on
      multi-factor authentication for those accounts.
- [ ] `test` holds only your own test replies (and invited testers'); clear them before the
      invitations go out. `e2e` holds fictional data only.

### 11. Approval

- [ ] You have read `/datenschutz` on **test** in all three languages and approve the text.
- [ ] Only then switch `environments.production.features.rsvp` on in the instance's `instance.json`
      (the production deploy fails while the controllers or the email are missing, but it cannot
      check your approval).
- [ ] After a change to the built-in text or the regions, read it again before the next production
      deploy.
