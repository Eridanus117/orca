import { join } from 'node:path'

/**
 * Resolves the forked Computer Use sidecar entry for packaged and source runs.
 *
 * @returns Absolute sidecar entry path.
 */
export function getComputerSidecarEntryPath(): string {
  const app = loadElectronApp()
  const appPath = app?.getAppPath() ?? process.cwd()
  const isPackaged = app?.isPackaged ?? false
  // Why: ELECTRON_RUN_AS_NODE bypasses Electron's asar require integration.
  const basePath = isPackaged ? appPath.replace('app.asar', 'app.asar.unpacked') : appPath
  return join(basePath, 'out', 'main', 'computer-sidecar.js')
}

/**
 * Loads Electron lazily so unit tests can import the client in plain Node.
 *
 * @returns The Electron app facade when available.
 */
function loadElectronApp(): { getAppPath(): string; isPackaged: boolean } | null {
  try {
    return require('electron').app
  } catch {
    return null
  }
}
