import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Restores an app/profile pair and compensates from the safety snapshot on failure.
 *
 * @param {object} options Snapshot paths, manifests, and filesystem callbacks.
 * @returns {void}
 */
export function restoreSnapshotPair({
  backup,
  manifest,
  safetyBackup,
  productName,
  userDataDirName,
  installedApp,
  sharedProfile,
  cloneDirectory,
  cleanTransientProfileState,
  validateBundle
}) {
  const replace = (source, target, present, label, preservedLiveEntries = []) =>
    replaceFromSnapshot({
      source,
      target,
      present,
      label,
      preservedLiveEntries,
      cloneDirectory,
      cleanTransientProfileState,
      validateBundle
    })
  try {
    replace(join(backup, `${productName}.app`), installedApp, manifest.appPresent, 'app')
    replace(
      join(backup, userDataDirName),
      sharedProfile,
      manifest.profilePresent,
      'profile',
      manifest.preservedLiveEntries ?? []
    )
  } catch (error) {
    if (safetyBackup) {
      const safetyManifest = JSON.parse(readFileSync(join(safetyBackup, 'manifest.json'), 'utf8'))
      replace(
        join(safetyBackup, `${productName}.app`),
        installedApp,
        safetyManifest.appPresent,
        'app'
      )
      replace(
        join(safetyBackup, userDataDirName),
        sharedProfile,
        safetyManifest.profilePresent,
        'profile',
        safetyManifest.preservedLiveEntries ?? []
      )
    }
    throw error
  }
}

/**
 * Atomically replaces one snapshot member while carrying live profile data forward.
 *
 * @param {object} options Member paths, policy, and filesystem callbacks.
 * @returns {void}
 */
function replaceFromSnapshot({
  source,
  target,
  present,
  label,
  preservedLiveEntries,
  cloneDirectory,
  cleanTransientProfileState,
  validateBundle
}) {
  const staging = `${target}.rollback-staging-${process.pid}`
  const displaced = `${target}.rollback-displaced-${process.pid}`
  const movedLiveEntries = []
  rmSync(staging, { recursive: true, force: true })
  if (present) {
    cloneDirectory(source, staging)
    if (label === 'profile') {
      cleanTransientProfileState(staging)
    } else {
      // Why: the first post-migration backup is ad-hoc; rollback can require TCC again.
      validateBundle(staging, { requireStableSignature: false })
    }
  }
  if (existsSync(target)) {
    renameSync(target, displaced)
  }
  try {
    if (present) {
      carryForwardLiveEntries({
        label,
        displaced,
        staging,
        preservedLiveEntries,
        movedLiveEntries
      })
      renameSync(staging, target)
    }
    rmSync(displaced, { recursive: true, force: true })
  } catch (error) {
    restoreDisplacedTarget({ target, staging, displaced, movedLiveEntries })
    throw error
  }
}

/**
 * Moves active agent state into the staged profile without copying gigabytes.
 *
 * @param {object} options Source, target, policy, and move ledger.
 * @returns {void}
 */
function carryForwardLiveEntries({
  label,
  displaced,
  staging,
  preservedLiveEntries,
  movedLiveEntries
}) {
  if (label !== 'profile' || !existsSync(displaced)) {
    return
  }
  for (const name of preservedLiveEntries) {
    const source = join(displaced, name)
    if (!existsSync(source)) {
      continue
    }
    const target = join(staging, name)
    if (existsSync(target)) {
      throw new Error(`Rollback profile already contains preserved live entry: ${name}`)
    }
    renameSync(source, target)
    movedLiveEntries.push(name)
  }
}

/**
 * Compensates a failed member swap and puts moved live data back.
 *
 * @param {object} options Swap paths and moved entry ledger.
 * @returns {void}
 */
function restoreDisplacedTarget({ target, staging, displaced, movedLiveEntries }) {
  const liveCarrier = existsSync(target) ? target : staging
  if (existsSync(displaced) && existsSync(liveCarrier)) {
    for (const name of movedLiveEntries) {
      const source = join(liveCarrier, name)
      if (existsSync(source)) {
        renameSync(source, join(displaced, name))
      }
    }
  }
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true })
  }
  if (existsSync(displaced)) {
    renameSync(displaced, target)
  }
}
