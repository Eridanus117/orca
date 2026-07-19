import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const LOCAL_FORK_DISTRIBUTION_MARKER = 'orca-fork-distribution.json'
const LOCAL_FORK_SCHEMA = 'orca.local-distribution/v2'

export type LocalForkDistribution = {
  schema: typeof LOCAL_FORK_SCHEMA
  kind: 'local-fork'
  appId: string
  productName: string
  userDataDirName: string
  executableName: string
}

type ResolveLocalForkDistributionOptions = {
  resourcesPath?: string
  isPackaged?: boolean
  compiledLocalForkBuild?: boolean
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseLocalForkDistribution(value: unknown): LocalForkDistribution | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as Record<string, unknown>
  if (
    candidate.schema !== LOCAL_FORK_SCHEMA ||
    candidate.kind !== 'local-fork' ||
    !isNonEmptyString(candidate.appId) ||
    !isNonEmptyString(candidate.productName) ||
    !isNonEmptyString(candidate.userDataDirName) ||
    !isNonEmptyString(candidate.executableName)
  ) {
    return null
  }
  return candidate as LocalForkDistribution
}

function getCompiledLocalForkBuildFlag(): boolean {
  return typeof ORCA_LOCAL_FORK_BUILD !== 'undefined'
    ? ORCA_LOCAL_FORK_BUILD
    : ((globalThis as { ORCA_LOCAL_FORK_BUILD?: boolean }).ORCA_LOCAL_FORK_BUILD ?? false)
}

export function readLocalForkDistribution(resourcesPath: string): LocalForkDistribution | null {
  const markerPath = join(resourcesPath, LOCAL_FORK_DISTRIBUTION_MARKER)
  if (!existsSync(markerPath)) {
    return null
  }
  try {
    return parseLocalForkDistribution(JSON.parse(readFileSync(markerPath, 'utf8')))
  } catch {
    return null
  }
}

export function resolveLocalForkDistribution(
  options: ResolveLocalForkDistributionOptions = {}
): LocalForkDistribution | null {
  const isPackaged = options.isPackaged ?? true
  const compiledLocalForkBuild = options.compiledLocalForkBuild ?? getCompiledLocalForkBuildFlag()
  const resourcesPath = options.resourcesPath ?? process.resourcesPath
  const marker = resourcesPath ? readLocalForkDistribution(resourcesPath) : null

  if (!isPackaged) {
    if (compiledLocalForkBuild || marker) {
      throw new Error('Orca Fork identity is only valid for packaged builds.')
    }
    return null
  }

  // Why: a partial Fork build would mix the official identity/updater with Fork
  // code, so the compiled identity and packaged marker must agree.
  if (compiledLocalForkBuild !== Boolean(marker)) {
    throw new Error(
      `Orca Fork identity mismatch: compiled=${compiledLocalForkBuild} marker=${Boolean(marker)}`
    )
  }
  return marker
}

export function getLocalForkDistribution(): LocalForkDistribution | null {
  return resolveLocalForkDistribution()
}

export function isLocalForkDistribution(): boolean {
  return getLocalForkDistribution() !== null
}
