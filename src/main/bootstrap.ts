import { app } from 'electron'
import { join } from 'node:path'
import { getLocalForkDistribution } from './startup/local-fork-distribution'

const localForkDistribution = getLocalForkDistribution()
if (localForkDistribution) {
  const appDataPath = app.getPath('appData')
  app.setName(localForkDistribution.productName)
  app.setPath('userData', join(appDataPath, localForkDistribution.userDataDirName))
  process.env.ORCA_USER_DATA_PATH = app.getPath('userData')
  process.env.ORCA_LOCAL_FORK_CLI_COMMAND = localForkDistribution.cliCommand
} else {
  delete process.env.ORCA_LOCAL_FORK_CLI_COMMAND
}

// Why: userData, lock, runtime socket, logs, and updater state must be isolated
// before importing any main module whose top-level code can resolve app paths.
void import('./index')
