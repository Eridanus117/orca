import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { quoteShell } from './appimage-cli-wrapper'

const SHIM_DIR_NAME = 'local-fork-orca-cli-shim'
const ensuredShimTargets = new Map<string, string>()

export type LocalForkTerminalOrcaCliShimOptions = {
  userDataPath: string
  cliCommand: string
  /** Test seam — defaults to the packaged resources root. */
  resourcesPath?: string | null
  /** Test seam — defaults to the native host platform. */
  platform?: NodeJS.Platform
}

/**
 * Creates a managed-PTY-only `orca` compatibility command for a local Fork.
 *
 * @param options Fork profile, packaged command, and optional test seams.
 * @returns The PATH directory containing the compatibility command, or null.
 */
export function ensureLocalForkTerminalOrcaCliShimDir(
  options: LocalForkTerminalOrcaCliShimOptions
): string | null {
  if ((options.platform ?? process.platform) === 'win32') {
    return null
  }
  if (!/^[A-Za-z0-9._-]+$/.test(options.cliCommand)) {
    return null
  }

  const resourcesPath = options.resourcesPath ?? process.resourcesPath
  if (!resourcesPath) {
    return null
  }
  const target = join(resourcesPath, 'bin', options.cliCommand)
  if (!existsSync(target)) {
    return null
  }

  const cachedTarget = ensuredShimTargets.get(options.userDataPath)
  const shimDir = join(options.userDataPath, SHIM_DIR_NAME)
  if (cachedTarget === target) {
    return shimDir
  }

  const shimPath = join(shimDir, 'orca')
  const script = `#!/usr/bin/env bash\nexec ${quoteShell(target)} "$@"\n`
  try {
    if (readShim(shimPath) !== script) {
      mkdirSync(shimDir, { recursive: true })
      writeFileSync(shimPath, script, 'utf8')
    }
    chmodSync(shimPath, 0o755)
  } catch {
    return null
  }
  ensuredShimTargets.set(options.userDataPath, target)
  return shimDir
}

/**
 * Reads a previously managed compatibility script.
 *
 * @param shimPath Absolute script path.
 * @returns Script contents, or null when it cannot be read.
 */
function readShim(shimPath: string): string | null {
  try {
    return readFileSync(shimPath, 'utf8')
  } catch {
    return null
  }
}
