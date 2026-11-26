# ADR 0006: Data in germanywestcentral, Static Web Apps in westeurope

- **Status:** Accepted
- **Date:** 2026-11-24
- **Deciders:** product owner

## Context

RSVP and guest data are personal data of EU residents and should be stored in Germany where
possible. Azure Static Web Apps (and therefore its managed API compute) is offered only in Central
US, East US 2, West US 2, West Europe and East Asia. The static content is served from SWA's global
edge regardless of region.

## Decision

- Everything that supports it lives in **`germanywestcentral`**: the storage account (all RSVP and
  guest data at rest), Log Analytics / Application Insights, the action group and the resource
  groups.
- The Static Web App is created in **`westeurope`**, the only EU option.
- Bicep takes two parameters, filled from `instance.json`: `dataLocation` (default
  `germanywestcentral`) and `swaLocation` (allowed: `westeurope`, `centralus`, `eastus2`,
  `westus2`, `eastasia`; default `westeurope`).

## Consequences

- Data at rest stays in Germany; managed API compute runs in West Europe (EU). The privacy notice
  states both.
- Requests from the API to storage cross regions within the EU, which adds a few milliseconds.
- Other deployments can choose other regions through their `instance.json`.

## Alternatives considered

- **Everything in westeurope:** simpler, but data at rest outside Germany for no benefit.
- **Bring-your-own Functions in germanywestcentral:** requires SWA Standard (monthly cost, billed
  bandwidth overage).

## Update 2026-11-25: Static Web Apps in eastus2

The first deployment was rejected: `westeurope` is "currently not accepting new customers" for
Static Web Apps (capacity restriction on new subscriptions). The owner decided to run the SWA (static
content on the global CDN, managed API compute) in **`eastus2`** for now and **not** to request
access. Data at rest stays in `germanywestcentral`. A follow-up issue tracks re-checking `westeurope`
from time to time; moving back means recreating the SWA (new default hostname), which is cheap
before a custom domain exists.

## Update 2026-11-26: Static Web Apps in westus2

In `eastus2`, SWA Free intermittently rejected our managed `dotnet-isolated:10.0` API with "Failed to
deploy the Azure Functions" (2 of 13 uploads succeeded; Azure/static-web-apps#1820, an Azure-side
fault: the same package succeeded and failed, and our code never started). `westeurope` still refused
new SWAs on 2026-11-26. The e2e SWA was recreated in **`westus2`**, and the first 3 deploys there
succeeded on the first attempt, so `westus2` is the new default and every environment moves there.
Data at rest stays in `germanywestcentral`. Moving means deleting the SWA (the resource group's delete
lock is lifted for that step only) and redeploying; the site gets a new default hostname.
