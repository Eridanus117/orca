import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

export const PRESERVED_LIVE_PROFILE_ENTRIES = ['codex-runtime-home']
export const TRANSIENT_PROFILE_ENTRY_NAMES = new Set([
  'Cache',
  'Code Cache',
  'DawnCache',
  'GPUCache',
  'ShaderCache',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
  'daemon',
  'logs',
  'orca-runtime.json',
  'shell-ready'
])

// Why: a v3 snapshot is seconds-long; one hour avoids racing a live writer while reaping v2 debris.
const DEFAULT_STALE_PARTIAL_AGE_MS = 60 * 60 * 1_000

/**
 * Classifies one profile entry for rollback snapshot handling.
 *
 * @param {string} name Top-level profile entry name.
 * @returns {'preserve-live' | 'exclude-transient' | 'snapshot'} Snapshot policy.
 */
export function classifyProfileSnapshotEntry(name) {
  if (PRESERVED_LIVE_PROFILE_ENTRIES.includes(name) || name.startsWith('terminal-history')) {
    return 'preserve-live'
  }
  if (
    TRANSIENT_PROFILE_ENTRY_NAMES.has(name) ||
    /^o-\d+-.+\.sock$/u.test(name) ||
    name.endsWith('.sock')
  ) {
    return 'exclude-transient'
  }
  return 'snapshot'
}

/**
 * Lists live profile entries that rollback must carry forward unchanged.
 *
 * @param {string} profileRoot Profile directory.
 * @returns {string[]} Existing preserved entry names.
 */
export function listPreservedLiveProfileEntries(profileRoot) {
  if (!existsSync(profileRoot)) {
    return []
  }
  return readdirSync(profileRoot)
    .filter((name) => classifyProfileSnapshotEntry(name) === 'preserve-live')
    .sort()
}

/**
 * Clones one profile entry without a full-copy fallback.
 *
 * @param {string} source Source entry.
 * @param {string} target Target entry.
 * @returns {void}
 */
function cloneProfileEntryCow(source, target) {
  execFileSync('cp', ['-cR', source, target], { stdio: 'inherit' })
}

/**
 * Publishes one app/profile backup through a private partial directory.
 *
 * @param {object} options Snapshot inputs and injectable copy functions.
 * @returns {string} Published snapshot directory.
 */
export function createAtomicPairSnapshot({
  appSource,
  appName,
  profileSource,
  profileName,
  backupRoot,
  snapshotName,
  manifest,
  cloneDirectory,
  cloneProfileEntry = cloneProfileEntryCow
}) {
  mkdirSync(backupRoot, { recursive: true })
  const snapshot = join(backupRoot, snapshotName)
  const partial = join(backupRoot, `.partial-${snapshotName}-${process.pid}`)
  if (existsSync(snapshot) || existsSync(partial)) {
    throw new Error(`Snapshot target already exists: ${snapshot}`)
  }
  mkdirSync(partial)
  try {
    if (appSource && existsSync(appSource)) {
      cloneDirectory(appSource, join(partial, appName))
    }
    if (profileSource && existsSync(profileSource)) {
      const profileTarget = join(partial, profileName)
      mkdirSync(profileTarget)
      for (const name of readdirSync(profileSource).sort()) {
        if (classifyProfileSnapshotEntry(name) !== 'snapshot') {
          continue
        }
        cloneProfileEntry(join(profileSource, name), join(profileTarget, name), partial)
      }
    }
    // Why: a manifest marks the payload complete; readers ignore partial dirs.
    writeFileSync(join(partial, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    renameSync(partial, snapshot)
    return snapshot
  } catch (error) {
    rmSync(partial, { recursive: true, force: true })
    throw error
  }
}

/**
 * Removes old valid backups and abandoned invalid snapshot directories.
 *
 * @param {string} backupRoot Backup root.
 * @param {object} options Retention and stale-age policy.
 * @returns {string[]} Removed entry names.
 */
export function pruneSnapshotHistory(
  backupRoot,
  {
    keep = 2,
    nowMs = Date.now(),
    stalePartialAgeMs = DEFAULT_STALE_PARTIAL_AGE_MS,
    acceptedSchemas = []
  } = {}
) {
  if (!existsSync(backupRoot)) {
    return []
  }
  const entries = readdirSync(backupRoot)
    .map((name) => ({ name, path: join(backupRoot, name) }))
    .filter(({ path }) => lstatSync(path).isDirectory())
  const hasManifest = ({ path }) => {
    const manifestPath = join(path, 'manifest.json')
    if (!existsSync(manifestPath)) {
      return false
    }
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      return (
        manifest !== null &&
        typeof manifest === 'object' &&
        (acceptedSchemas.length === 0 || acceptedSchemas.includes(manifest.schema))
      )
    } catch {
      return false
    }
  }
  const valid = entries
    .filter(hasManifest)
    .sort((left, right) => right.name.localeCompare(left.name))
  const removable = new Set(valid.slice(Math.max(0, keep)).map(({ name }) => name))
  for (const entry of entries) {
    if (hasManifest(entry)) {
      continue
    }
    if (nowMs - statSync(entry.path).mtimeMs >= stalePartialAgeMs) {
      removable.add(entry.name)
    }
  }
  for (const name of removable) {
    rmSync(join(backupRoot, name), { recursive: true, force: true })
  }
  return [...removable]
}

/**
 * Removes recognized app-only snapshots after a paired snapshot is safely published.
 *
 * @param {string} legacyRoot Installer-owned v1 backup root.
 * @returns {string[]} Removed legacy snapshot paths.
 */
export function removeLegacyAppOnlySnapshots(legacyRoot) {
  if (!existsSync(legacyRoot)) {
    return []
  }
  const removed = []
  for (const name of readdirSync(legacyRoot)) {
    const candidate = join(legacyRoot, name)
    const manifestPath = join(candidate, 'manifest.json')
    if (!existsSync(manifestPath)) {
      continue
    }
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (manifest.schema !== 'orca.local-distribution-backup/v1') {
        continue
      }
    } catch {
      continue
    }
    rmSync(candidate, { recursive: true, force: true })
    removed.push(candidate)
  }
  if (readdirSync(legacyRoot).length === 0) {
    rmSync(legacyRoot, { recursive: true, force: true })
  }
  return removed
}
