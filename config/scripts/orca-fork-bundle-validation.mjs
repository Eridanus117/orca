import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { hasStableCodeRequirement } from './orca-fork-code-signing.mjs'

/**
 * Binds distribution metadata and command runners to a reusable validator.
 *
 * @param {object} input Static validation dependencies.
 * @returns {(appPath: string, options?: object) => void} Bound bundle validator.
 */
export function createForkBundleValidator(input) {
  return (appPath, options = {}) => validateForkBundle({ ...input, appPath, ...options })
}

/**
 * Validates the local Fork bundle layout, distribution identity, and signature.
 *
 * @param {object} input Validation coordinates.
 * @param {string} input.appPath App bundle path.
 * @param {object} input.distribution Fork distribution metadata.
 * @param {(command: string, args: string[]) => unknown} input.run Command runner.
 * @param {(command: string, args: string[]) => string} input.capture Capturing command runner.
 * @param {(command: string, args: string[]) => string} input.captureCombined Combined-output runner.
 * @param {boolean} [input.requireStableSignature] Whether cdhash-only identity is rejected.
 * @returns {void}
 */
export function validateForkBundle({
  appPath,
  distribution,
  run,
  capture,
  captureCombined,
  requireStableSignature = true
}) {
  const plist = join(appPath, 'Contents', 'Info.plist')
  const resources = join(appPath, 'Contents', 'Resources')
  const bundleId = capture('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist])
  const executable = capture('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist])
  if (bundleId !== distribution.appId) {
    throw new Error(`Unexpected bundle id: ${bundleId || '<missing>'}`)
  }
  if (executable !== distribution.executableName) {
    throw new Error(`Unexpected executable: ${executable || '<missing>'}`)
  }
  for (const required of [
    join(resources, 'orca-fork-distribution.json'),
    join(resources, 'bin', 'orca')
  ]) {
    if (!existsSync(required)) {
      throw new Error(`Missing fork bundle resource: ${required}`)
    }
  }
  run('codesign', ['--verify', '--deep', '--strict', appPath])
  if (!requireStableSignature) {
    return
  }
  const requirement = captureCombined('codesign', ['-d', '-r-', appPath])
  if (!hasStableCodeRequirement(requirement)) {
    throw new Error(
      'Orca Fork has a cdhash-only ad-hoc signature that invalidates macOS privacy grants.'
    )
  }
}
