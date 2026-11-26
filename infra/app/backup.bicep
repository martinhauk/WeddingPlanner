// Backup store for ONE environment (test, production; e2e for the restore drill), deployed by CI
// into rg-<slug>-<env> BEFORE the backup that runs before every deploy:
//
//   az deployment group create --name app-backup --resource-group <rg> \
//     --parameters infra/app/backup.bicepparam -o none
//
// It is a template of its own (not a module of main.bicep) so the backup step can create or
// update the backup store without touching the app, the data account or the API: the pre-deploy
// backup must run before anything that could change guest data. Additive and idempotent.
// No role assignments (infra/bootstrap). Outputs are non-secret names only.
targetScope = 'resourceGroup'

@description('Neutral deployment slug from instance.json (^wed[0-9a-z]{3,8}$, checked by the deploy job).')
@minLength(6)
@maxLength(11)
param deploymentSlug string

@description('Environment of this deployment.')
@allowed([
  'e2e'
  'test'
  'production'
])
param environmentName string

@description('Region for the backups (dataLocation, ADR 0006).')
param dataLocation string = 'germanywestcentral'

// The same stable hash as main.bicep, with the prefix "bk": never equal to the data account
// (prefix "st"), and the same on every deploy.
var nameSuffix = uniqueString(resourceGroup().id)
var environmentShortNames = {
  e2e: 'e2e'
  test: 'test'
  production: 'prod'
}

module backupStorage './modules/backup-storage.bicep' = {
  name: 'app-backup-storage'
  params: {
    name: take(toLower('bk${deploymentSlug}${environmentShortNames[environmentName]}${nameSuffix}'), 24)
    location: dataLocation
    tags: {
      app: 'weddingplanner'
      deployment: deploymentSlug
      environment: environmentName
      managedBy: 'bicep'
      purpose: 'table-backups'
    }
  }
}

output backupStorageAccountName string = backupStorage.outputs.accountName
output backupContainerName string = backupStorage.outputs.containerName
