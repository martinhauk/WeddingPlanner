// Parameters for infra/app/backup.bicep, read ONLY from environment variables (the same ones the
// deploy job derives from instance.json for main.bicepparam). A missing variable fails
// `az bicep build-params` and the deployment.
//
// Required: DEPLOYMENT_SLUG, ENVIRONMENT_NAME, DATA_LOCATION (see main.bicepparam).
using './backup.bicep'

param deploymentSlug = readEnvironmentVariable('DEPLOYMENT_SLUG')
param environmentName = readEnvironmentVariable('ENVIRONMENT_NAME')
param dataLocation = readEnvironmentVariable('DATA_LOCATION')
