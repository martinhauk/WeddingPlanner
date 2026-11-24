// Parameters for infra/app/main.bicep, read ONLY from environment variables.
//
// The deploy job derives these variables from the deployment's instance.json
// (samples/instance/ for e2e) for the environment it deploys. They are NOT GitHub Environment
// variables and never hold secrets. A missing required variable fails `az bicep build-params`
// and the deployment.
//
// Required:
//   DEPLOYMENT_SLUG   neutral slug, ^wed[0-9a-z]{3,8}$ (validated by the deploy job)
//   ENVIRONMENT_NAME  e2e | test | production
//   DATA_LOCATION     region for data at rest, e.g. germanywestcentral
//   SWA_LOCATION      westeurope | centralus | eastus2 | westus2 | eastasia
//   FEATURES_RSVP     true | false (environments.<env>.features.rsvp)
//   FEATURES_ADMIN    true | false (environments.<env>.features.admin)
//   RSVP_DEADLINE     rsvp.deadline, ISO 8601 date-time interpreted in RSVP_TIME_ZONE
//   RSVP_TIME_ZONE    rsvp.timeZone, IANA time zone, e.g. Europe/Berlin
// Optional:
//   LOG_DAILY_CAP_GB  Log Analytics daily cap in GB as a decimal string (default 0.1)
//   ENABLE_ALERTS     true | false (default true)
//
// Alert thresholds keep the defaults in main.bicep.
using './main.bicep'

param deploymentSlug = readEnvironmentVariable('DEPLOYMENT_SLUG')
param environmentName = readEnvironmentVariable('ENVIRONMENT_NAME')
param dataLocation = readEnvironmentVariable('DATA_LOCATION')
param swaLocation = readEnvironmentVariable('SWA_LOCATION')
param featuresRsvp = bool(readEnvironmentVariable('FEATURES_RSVP'))
param featuresAdmin = bool(readEnvironmentVariable('FEATURES_ADMIN'))
param rsvpDeadline = readEnvironmentVariable('RSVP_DEADLINE')
param rsvpTimeZone = readEnvironmentVariable('RSVP_TIME_ZONE')
param logDailyCapGb = readEnvironmentVariable('LOG_DAILY_CAP_GB', '0.1')
param enableAlerts = bool(readEnvironmentVariable('ENABLE_ALERTS', 'true'))
