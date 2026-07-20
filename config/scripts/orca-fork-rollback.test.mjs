import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { restoreSnapshotPair } from './orca-fork-rollback.mjs'

function writeTree(root, appValue, profileValue, liveValue) {
  mkdirSync(join(root, 'Orca Fork.app'), { recursive: true })
  writeFileSync(join(root, 'Orca Fork.app', 'version.txt'), appValue)
  mkdirSync(join(root, 'orca', 'codex-runtime-home'), { recursive: true })
  writeFileSync(join(root, 'orca', 'config.json'), profileValue)
  writeFileSync(join(root, 'orca', 'codex-runtime-home', 'session.txt'), liveValue)
}

function restoreOptions(root, backup, safetyBackup = null) {
  return {
    backup,
    manifest: {
      appPresent: true,
      profilePresent: true,
      preservedLiveEntries: ['codex-runtime-home']
    },
    safetyBackup,
    productName: 'Orca Fork',
    userDataDirName: 'orca',
    installedApp: join(root, 'installed', 'Orca Fork.app'),
    sharedProfile: join(root, 'installed', 'orca'),
    cloneDirectory: (source, target) => cpSync(source, target, { recursive: true }),
    cleanTransientProfileState: () => {},
    validateBundle: () => {}
  }
}

describe('Orca Fork rollback', () => {
  it('restores app settings while carrying live Codex state forward', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-rollback-live-'))
    const backup = join(root, 'backup')
    writeTree(join(root, 'installed'), 'old-app', 'old-config', 'live-session')
    writeTree(backup, 'new-app', 'new-config', 'stale-session')
    rmSync(join(backup, 'orca', 'codex-runtime-home'), { recursive: true })

    try {
      restoreSnapshotPair(restoreOptions(root, backup))
      expect(readFileSync(join(root, 'installed', 'Orca Fork.app', 'version.txt'), 'utf8')).toBe(
        'new-app'
      )
      expect(readFileSync(join(root, 'installed', 'orca', 'config.json'), 'utf8')).toBe(
        'new-config'
      )
      expect(
        readFileSync(join(root, 'installed', 'orca', 'codex-runtime-home', 'session.txt'), 'utf8')
      ).toBe('live-session')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('restores the safety pair when the profile member fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-rollback-compensate-'))
    const backup = join(root, 'backup')
    const safety = join(root, 'safety')
    writeTree(join(root, 'installed'), 'old-app', 'old-config', 'live-session')
    writeTree(backup, 'new-app', 'new-config', 'stale-session')
    writeTree(safety, 'old-app', 'old-config', 'stale-session')
    rmSync(join(backup, 'orca', 'codex-runtime-home'), { recursive: true })
    rmSync(join(safety, 'orca', 'codex-runtime-home'), { recursive: true })
    writeFileSync(
      join(safety, 'manifest.json'),
      JSON.stringify({
        appPresent: true,
        profilePresent: true,
        preservedLiveEntries: ['codex-runtime-home']
      })
    )
    let profileCleanCalls = 0
    const options = restoreOptions(root, backup, safety)
    options.cleanTransientProfileState = () => {
      profileCleanCalls += 1
      if (profileCleanCalls === 1) {
        throw new Error('profile staging failed')
      }
    }

    try {
      expect(() => restoreSnapshotPair(options)).toThrow('profile staging failed')
      expect(readFileSync(join(root, 'installed', 'Orca Fork.app', 'version.txt'), 'utf8')).toBe(
        'old-app'
      )
      expect(readFileSync(join(root, 'installed', 'orca', 'config.json'), 'utf8')).toBe(
        'old-config'
      )
      expect(
        readFileSync(join(root, 'installed', 'orca', 'codex-runtime-home', 'session.txt'), 'utf8')
      ).toBe('live-session')
      expect(existsSync(`${options.sharedProfile}.rollback-staging-${process.pid}`)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
