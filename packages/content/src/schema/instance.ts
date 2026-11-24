import { z } from 'zod';
import { coded, dateTimeWithOffsetSchema, timeZoneSchema } from './common.ts';

/**
 * `instance.json`: the private configuration of one deployment.
 *
 * Its field names are a contract with the Bicep parameters (S0-04), the bootstrap scripts that read
 * it with jq (S0-05, S0-06) and the full schema (S1-01): extend it, never rename fields. Emails and
 * the budget are private and must never reach a generated file or a log.
 */

export const ENVIRONMENT_NAMES = ['e2e', 'test', 'production'] as const;
export type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

export function isEnvironmentName(value: string): value is EnvironmentName {
  return (ENVIRONMENT_NAMES as readonly string[]).includes(value);
}

/** Azure regions that offer Static Web Apps ([ADR 0006](../../../../docs/adr/0006-azure-regions.md)). */
export const SWA_LOCATIONS = ['westeurope', 'centralus', 'eastus2', 'westus2', 'eastasia'] as const;

export const SLUG_PATTERN = /^wed[0-9a-z]{3,8}$/;

/** Per-environment feature flags. The UI hides a feature that is off; the API returns 404. */
export const featuresSchema = z.strictObject({
  rsvp: z.boolean(),
  admin: z.boolean(),
});

export const environmentConfigSchema = z.strictObject({
  features: featuresSchema,
});

export const instanceSchema = z.strictObject({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  /** `true` only for the fictional sample instance in this repo. */
  sample: z.boolean().optional(),
  /** Neutral deployment slug used in Azure resource names and public logs; never a name. */
  slug: z.string().regex(SLUG_PATTERN, { error: coded('E_SLUG', 'must match ^wed[0-9a-z]{3,8}$') }),
  /** Region for data, monitoring and resource groups, e.g. `germanywestcentral`. */
  dataLocation: z.string().regex(/^[a-z][a-z0-9]*$/, {
    error: coded('E_LOCATION', 'must be an Azure region name, e.g. germanywestcentral'),
  }),
  /** Region of the Static Web App. */
  swaLocation: z.enum(SWA_LOCATIONS),
  /** Monthly budget in the billing currency (private). */
  budgetAmount: z.number().positive(),
  /** Recipients of budget and abuse alerts (private). */
  alertEmails: z.array(z.email()).min(1),
  /** People invited to the admin area (private). */
  adminEmails: z.array(z.email()),
  rsvp: z.strictObject({
    /** RSVP deadline as an ISO 8601 date-time with a UTC offset. */
    deadline: dateTimeWithOffsetSchema,
    /** IANA zone in which the deadline is shown to guests. */
    timeZone: timeZoneSchema,
  }),
  environments: z.strictObject({
    e2e: environmentConfigSchema.optional(),
    test: environmentConfigSchema.optional(),
    production: environmentConfigSchema.optional(),
  }),
});

export type Instance = z.infer<typeof instanceSchema>;
export type Features = z.infer<typeof featuresSchema>;
export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>;
