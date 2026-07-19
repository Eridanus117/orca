import { app } from 'electron'
import { join } from 'node:path'
import { getLocalForkDistribution } from './startup/local-fork-distribution'

const localForkDistribution = getLocalForkDistribution()
if (localForkDistribution) {
  const appDataPath = app.getPath('appData')
  app.setName(localForkDistribution.productName)
  app.setPath('userData', join(appDataPath, localForkDistribution.userDataDirName))
  process.env.ORCA_USER_DATA_PATH = app.getPath('userData')
  // Why: a diagnostic lock bypass would allow both app bundles to write the
  // shared profile concurrently, which this distribution never supports.
  delete process.env.ORCA_BYPASS_SINGLE_INSTANCE_LOCK
}

// Why: both app bundles intentionally share one profile and its single-instance
// lock; the path must be fixed before any main module resolves app storage.
void import('./index')
