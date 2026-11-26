# Feature flags

Every merge to `main` reaches the `e2e` and `test` environments automatically and can be promoted to
`production`. Unfinished or unaccepted guest-visible features must therefore stay unusable for guests.
They ship **dark**: merged and deployed, but switched off
([ADR 0005](../adr/0005-feature-flags-per-environment.md)).

## Where flags live

Flags are set per environment in the deployment's `instance.json`:

```json
{
  "environments": {
    "e2e": { "features": { "rsvp": true, "admin": true } },
    "test": { "features": { "rsvp": true, "admin": true } },
    "production": { "features": { "rsvp": false, "admin": false } }
  }
}
```

- The `e2e` environment always uses the sample instance (`samples/instance/`) with **every flag on**,
  so the write-path tests exercise everything.
- `test` and `production` read the private instance repo of the deployment.

## How a flag is enforced

The deploy pipeline applies each flag in **two places**:

1. **UI:** the bake writes the flags into `build.json` (`features.<name>`). When a flag is off, the
   web app **shows a short note instead of the feature** rather than hiding it silently, and makes
   **no API call** for it. Controls that only lead to the feature are hidden.
2. **API:** the pipeline sets the app setting `Features__<Name>` (for example `Features__Rsvp`).
   When it is off, every route of that feature returns **404** before any I/O, indistinguishable from
   a route that does not exist. The code default is **off**.

A flag that only changes the UI is not enough: the API must enforce it too.

Today's flags:

- **`rsvp` off:** the RSVP section stays (intro, "opens soon" note, deadline) but has no form; the
  hero button is gone and its nav entry is not highlighted; the page makes no RSVP call and no
  keep-warm ping. `/api/rsvp*` answers 404 (`Features__Rsvp`).
- **`admin` off:** nothing guest-visible changes (the admin entry is reached only by URL);
  `/api/admin*` answers 404 (`Features__Admin`).

**Locally:** the bake takes the flags of `DEPLOY_ENV` (default `e2e`, every flag on in the sample);
`DEPLOY_ENV=production pnpm dev` shows the sample with RSVP off. The API reads `Features__Rsvp` and
`Features__Admin` from `local.settings.json` ([local development](../local-development.md)).

## Lifecycle

1. **Add** the flag with the feature: a field in the instance schema (`features.<name>`), the API
   feature gate mapping, and the UI check. Code default and `production` value: off.
2. **Ship dark:** merge; the feature is on in `e2e` (and usually `test`), off in `production`.
3. **Accept on test:** the owner checks the feature on the `test` environment.
4. **Flip in production:** the owner sets `features.<name>: true` for `production` in the private
   instance repo; the next approved production deploy turns it on.
5. **Remove the flag** once the feature is stable: delete the checks and the schema field in a
   follow-up PR (with a `schemaVersion` note if instance files must change).

## Emergency lockdown is not a feature flag

`API_LOCKDOWN` is a GitHub Environment variable override, set only by `scripts/ops/lockdown.sh`. It
makes the Static Web Apps edge reject anonymous `/api/*` requests before any function runs, to cap
cost during an attack. It is independent of feature flags.

## Checklist for a guest-visible feature

- [ ] Behind a flag (existing or new), off by default in code and in `production`.
- [ ] Off: the UI shows a note instead of the feature and calls no API for it, **and** the API
      returns 404; tests cover both states.
- [ ] Screenshot cases run with the flag on (the e2e sample has every flag on).
