# Feature flags

Every merge to `main` reaches the `e2e` and `test` environments automatically and can be promoted to
`production`. Unfinished or unaccepted guest-visible features must therefore stay hidden. They ship
**dark**: merged and deployed, but switched off ([ADR 0005](../adr/0005-feature-flags-per-environment.md)).

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

1. **UI:** the bake writes the flags into `build.json` (`features.<name>`); the web app hides the
   feature when it is off.
2. **API:** the pipeline sets the app setting `Features__<Name>` (for example `Features__Rsvp`).
   When it is off, every route of that feature returns **404** before any I/O, indistinguishable from
   a route that does not exist. The code default is **off**.

A flag that only hides UI is not enough: the API must enforce it too.

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
- [ ] UI hidden **and** API returns 404 when off; tests cover both states.
- [ ] Screenshot cases run with the flag on (the e2e sample has every flag on).
