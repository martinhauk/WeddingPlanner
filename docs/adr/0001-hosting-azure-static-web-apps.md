# ADR 0001: Host on Azure Static Web Apps Free with a managed .NET 10 isolated API

- **Status:** Accepted
- **Date:** 2026-11-24
- **Deciders:** product owner, architecture panel

## Context

The site is a mobile-first invitation one-pager with an RSVP form and a small admin area. Traffic is
tiny (about a thousand visits and up to a few hundred RSVPs per wedding), but it peaks when
invitations go out. The running cost should be about €0 per month, with a €10 budget as a guardrail,
and an attack must not be able to run up a large bill. Admins sign in with Microsoft accounts.

## Decision

- Host the static site on **Azure Static Web Apps (SWA), Free plan**, with the **managed Functions
  API** on **.NET 10 isolated** (`apiRuntime: dotnet-isolated:10.0`; .NET 8 and 9 are out of
  support).
- The API project uses `Microsoft.NET.Sdk` with the Functions Worker SDK 2.x and ASP.NET Core
  integration, the project shape SWA documents.
- Infrastructure is Bicep; GitHub Actions deploys over OIDC (no stored Azure credentials).
- The admin area is a separate HTML entry behind SWA route rules (`/admin*`, `/api/admin*`, role
  `admin`), using the preconfigured `aad` provider (any Microsoft account) and SWA role invitations.
  The GitHub provider is blocked. The API re-checks the role itself.
- No SWA pull-request preview environments (they share app settings, and so production data, with
  production).

## Consequences

- Static traffic on Free is never billed: above the 100 GB/month quota (per subscription) the site
  stops being served instead. That is an availability risk, not a cost risk; images are kept small
  and a bandwidth alert exists.
- Managed function executions beyond the free grant can cost money, so the home page makes no API
  calls except a cheap keep-warm ping, metric alerts watch executions, and an edge lockdown
  (`API_LOCKDOWN`) can reject anonymous `/api/*` before any function runs.
- Managed functions have no managed identity; the storage connection string is written by Bicep into
  the SWA app settings and never output.
- SWA is only offered in a few regions ([ADR 0006](0006-azure-regions.md)).
- Cold starts of the managed API are possible; the web app keeps it warm while a visitor is present
  and the UI is optimistic.

## Alternatives considered

- **SWA Standard:** bills bandwidth overage and costs a monthly fee; offers bring-your-own Functions
  and more previews, which we do not need.
- **App Service / Container Apps:** monthly cost or cold-start trade-offs, more infrastructure.
- **A hosted invitation service:** no control over data location, look, languages or admin features.
