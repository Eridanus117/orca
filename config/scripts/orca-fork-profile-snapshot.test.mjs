import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyProfileSnapshotEntry,
  createAtomicPairSnapshot,
  pruneSnapshotHistory,
  removeLegacyAppOnlySnapshots
} from './orca-fork-profile-snapshot.mjs'

function makeDirectory(root, name) {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  return path
}

describe('Orca Fork profile snapshots', () => {
  it('keeps live agent data out of rollback payloads', () => {
    expect(classifyProfileSnapshotEntry('codex-runtime-home')).toBe('preserve-live')
    expect(classifyProfileSnapshotEntry('terminal-history-v2')).toBe('preserve-live')
    expect(classifyProfileSnapshotEntry('daemon')).toBe('exclude-transient')
    expect(classifyProfileSnapshotEntry('provider.sock')).toBe('exclude-transient')
    expect(classifyProfileSnapshotEntry('config.json')).toBe('snapshot')
  })

  it('publishes the manifest last and never falls back to a full profile copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-profile-snapshot-'))
    const profile = makeDirectory(root, 'profile')
    const app = makeDirectory(root, 'Orca Fork.app')
    const backupRoot = makeDirectory(root, 'backups')
    for (const name of ['config.json', 'daemon', 'codex-runtime-home', 'terminal-history-v2']) {
      const path = join(profile, name)
      if (name.endsWith('.json')) {
        writeFileSync(path, name)
      } else {
        mkdirSync(path)
      }
    }
    const observed = []

    try {
      const snapshot = createAtomicPairSnapshot({
        appSource: app,
        appName: 'Orca Fork.app',
        profileSource: profile,
        profileName: 'orca',
        backupRoot,
        snapshotName: '2026-07-20T00-00-00-000Z',
        manifest: { schema: 'test/v1' },
        cloneDirectory: (_source, target) => mkdirSync(target, { recursive: true }),
        cloneProfileEntry: (source, target, snapshotRoot) => {
          observed.push([source, target, existsSync(join(snapshotRoot, 'manifest.json'))])
          if (source.endsWith('config.json')) {
            writeFileSync(target, readFileSync(source))
          } else {
            mkdirSync(target)
          }
        }
      })

      expect(observed).toHaveLength(1)
      expect(observed[0][0]).toBe(join(profile, 'config.json'))
      expect(observed[0][1]).toMatch(/\/backups\/\.partial-.+\/orca\/config\.json$/u)
      expect(observed[0][2]).toBe(false)
      expect(JSON.parse(readFileSync(join(snapshot, 'manifest.json'), 'utf8'))).toEqual({
        schema: 'test/v1'
      })
      expect(readdirSync(join(snapshot, 'orca'))).toEqual(['config.json'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('removes a failed partial without publishing or deleting older snapshots', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-profile-snapshot-failure-'))
    const profile = makeDirectory(root, 'profile')
    const app = makeDirectory(root, 'Orca Fork.app')
    const backupRoot = makeDirectory(root, 'backups')
    writeFileSync(join(profile, 'config.json'), 'config')
    const existing = makeDirectory(backupRoot, '2026-07-19T00-00-00-000Z')
    writeFileSync(join(existing, 'manifest.json'), '{}')

    try {
      expect(() =>
        createAtomicPairSnapshot({
          appSource: app,
          appName: 'Orca Fork.app',
          profileSource: profile,
          profileName: 'orca',
          backupRoot,
          snapshotName: '2026-07-20T00-00-00-000Z',
          manifest: {},
          cloneDirectory: (_source, target) => mkdirSync(target, { recursive: true }),
          cloneProfileEntry: () => {
            throw new Error('clone failed')
          }
        })
      ).toThrow('clone failed')
      expect(readdirSync(backupRoot)).toEqual(['2026-07-19T00-00-00-000Z'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps one valid snapshot and removes stale invalid history', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-profile-retention-'))
    const names = [
      '2026-07-17T00-00-00-000Z',
      '2026-07-18T00-00-00-000Z',
      '2026-07-19T00-00-00-000Z',
      '2026-07-20T00-00-00-000Z'
    ]
    for (const name of names) {
      const dir = makeDirectory(root, name)
      writeFileSync(join(dir, 'manifest.json'), '{}')
    }
    const invalid = makeDirectory(root, '2026-07-16T00-00-00-000Z')
    const stalePartial = makeDirectory(root, '.partial-stale')
    makeDirectory(root, '.partial-fresh')
    const old = new Date('2026-07-18T00:00:00Z')
    utimesSync(invalid, old, old)
    utimesSync(stalePartial, old, old)

    try {
      const removed = pruneSnapshotHistory(root, {
        keep: 1,
        nowMs: new Date('2026-07-20T12:00:00Z').getTime(),
        stalePartialAgeMs: 24 * 60 * 60 * 1_000
      })

      expect(removed.sort()).toEqual(
        [
          '.partial-stale',
          '2026-07-16T00-00-00-000Z',
          '2026-07-17T00-00-00-000Z',
          '2026-07-18T00-00-00-000Z',
          '2026-07-19T00-00-00-000Z'
        ].sort()
      )
      expect(readdirSync(root).sort()).toEqual(
        ['.partial-fresh', '2026-07-20T00-00-00-000Z'].sort()
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('removes only recognized app-only backup history', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-fork-legacy-backups-'))
    const recognized = makeDirectory(root, 'recognized')
    const unknown = makeDirectory(root, 'unknown')
    writeFileSync(
      join(recognized, 'manifest.json'),
      JSON.stringify({ schema: 'orca.local-distribution-backup/v1' })
    )
    writeFileSync(
      join(unknown, 'manifest.json'),
      JSON.stringify({ schema: 'orca.local-distribution-backup/future' })
    )

    try {
      expect(removeLegacyAppOnlySnapshots(root)).toEqual([recognized])
      expect(existsSync(recognized)).toBe(false)
      expect(existsSync(unknown)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
