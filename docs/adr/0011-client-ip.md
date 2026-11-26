# ADR 0011: No client-IP header on the managed API; rate limits trust no header by default

- **Status:** Accepted
- **Date:** 2026-11-26
- **Deciders:** owner (product owner), lead agent

## Context

The RSVP API limits each client to 10 writes per 10 minutes and 60 reads per minute, keyed by the
client's address (`Http/ClientAddress`), plus 120 writes per minute per worker instance for all clients
together. Static Web Apps documents no client-IP header for its managed functions. The code trusted
`X-Azure-ClientIP`, then the first `X-Forwarded-For` entry, and a release gate required the platform
probe to confirm that header before RSVP goes live in production.

The probe (`GET /api/health/probe`, run by `scripts/smoke/api-probe.sh`) was run several times against
the `e2e` environment (Free plan, managed .NET 10 isolated API), over IPv4 and IPv6. The caller's own
public address was compared with what the API saw inside the shell only; no address, hostname or
cookie value was recorded. Findings:

- **No request header and not the connection address carries the caller's address**, for either
  address family.
- **`X-Forwarded-For` never reaches the worker.** The forwarded-headers handling in front of the
  worker consumes its single entry into the connection address and keeps the previous hop in
  `X-Original-For` (one entry). A client-sent `X-Forwarded-For`, `X-Original-For` or `Forwarded` is
  dropped; the connection address is never taken from the client.
- **The connection address is one platform address**, identical for every request and for an IPv4 and
  an IPv6 caller. Keyed on it, every guest would share one bucket.
- **`Client-IP`** is set by the platform (a client value is replaced) and carries a port, but holds the
  address of a platform hop: sometimes the connection address, otherwise one of a small pool that
  changes between requests of the same caller. It cannot key a client.
- **`X-Azure-ClientIP`, `X-Azure-SocketIP`, `X-Client-IP`, `X-Real-IP` and `True-Client-IP`** are absent
  unless the caller sends them, and a client value passes through unchanged: spoofable.
- **Cookie round trip works.** The probe cookie arrives with `Max-Age`, `Path`, `Secure`, `HttpOnly` and
  `SameSite=Strict` unchanged and travels back to the API on the next request; `Cache-Control:
  no-store` reaches the client. The proxy adds one attribute: `Domain` set to the request host.

## Decision

- `RateLimiting__ClientIpHeader` defaults to empty: **no header is trusted**. `ClientAddress` reads only
  the configured header and never falls back to `X-Forwarded-For` (its first entry is whatever the
  caller sent) or to the connection address. A list or malformed value gives no key.
- On the managed API therefore no request has a per-client key: the per-client limits do not apply and
  the per-instance write backstop, the cap on active RSVPs, body limits, honeypot and minimum fill time
  carry the abuse protection ([architecture §12](../architecture.md#12-cost-and-abuse)). Configure the
  header only behind a proxy that overwrites it with the caller's address.
- The probe is **off by code default**. Its switch is `HealthProbe__Enabled` (Static Web Apps rejects
  app settings that start with `DIAGNOSTICS_`); infra/app sets it to `true` on `e2e` only, so `test` and
  `production` answer 404. Re-run the probe on `e2e` after platform changes (region, plan, runtime).

## Consequences

- No regression: an honest request already had no key (the trusted header never arrived), and a caller
  who spoofed it gained nothing over omitting it. The code now says so instead of implying a
  per-client limit.
- One client can use the whole instance write budget and lock out other guests for up to a minute;
  reads are limited only by the platform. Acceptable for a small guest list; the lockdown
  (`scripts/ops/lockdown.sh`) and cost alerts are the escalation path.
- The platform-added `Domain` widens the cookies from host-only to the host and its subdomains. On the
  default host that is harmless; on an apex custom domain the RSVP cookie would also reach that
  domain's subdomains. Check on `test` with the custom domain before production. A `__Host-` cookie
  prefix would be rejected by browsers for the same reason.
- We would notice the decision is outdated when the probe reports a header that the platform sets and
  overwrites with the caller's address (compare from two networks); then configure that header.

## Alternatives considered

- **Keep trusting `X-Azure-ClientIP`:** it is never set by the platform and fully client-controlled.
- **Key on the connection address or `Client-IP`:** one shared address pools all guests into one bucket;
  a changing proxy address limits nobody.
- **Key on a cookie or fingerprint:** a client that wants to evade the limit simply omits or rotates it.
- **Linked backend or Front Door in front for a trustworthy header:** needs the Standard plan or extra
  services, against [ADR 0001](0001-hosting-azure-static-web-apps.md).
