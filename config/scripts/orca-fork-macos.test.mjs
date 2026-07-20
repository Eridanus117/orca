import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildDryRunPlan, parseCommand } from './orca-fork-macos.mjs'
import { syncForkFromRelease } from './orca-fork-release-sync.mjs'
import {
  abortPreparedUpdate,
  blockingForkDesktopProcesses,
  isDetachedDaemonProcess,
  prepareUpdateHandoff
} from './orca-fork-update-handoff.mjs'

describe('orca-fork-macos', () => {
  it('defaults mutating commands to dry-run', () => {
    expect(parseCommand(['update'])).toEqual({ command: 'update', apply: false })
    expect(buildDryRunPlan('update')).toContain(
      'Ask the local runtime to quit normally so daemon-backed agents stay alive.'
    )
    expect(buildDryRunPlan('update')).toContain(
      'Bootstrap older Fork builds after a manual normal quit while allowing only the daemon.'
    )
  })

  it('requires an explicit apply flag and keeps source sync separate', () => {
    expect(
      parseCommand(['sync', '--from', 'v1.4.146-rc.0', '--base', 'v1.4.147', '--apply'])
    ).toEqual({
      command: 'sync',
      apply: true,
      from: 'v1.4.146-rc.0',
      base: 'v1.4.147'
    })
    expect(buildDryRunPlan('sync', 'v1.4.146-rc.0', 'v1.4.147')).toEqual([
      'Fetch official release tag v1.4.147.',
      'Verify v1.4.147 contains current upstream base v1.4.146-rc.0.',
      'Replay only the Fork patch queue onto the release tag; abort automatically on conflict.'
    ])
  })

  it('rejects implicit main sync and non-release refs', () => {
    expect(() => parseCommand(['sync'])).toThrow(
      'sync requires --from <current-base> --base <release-tag>.'
    )
    expect(() =>
      parseCommand(['sync', '--from', 'v1.4.146-rc.0', '--base', 'upstream/main'])
    ).toThrow('Unsupported release tag')
    expect(() => parseCommand(['update', '--base', 'v1.4.147'])).toThrow(
      '--from and --base are only supported by sync.'
    )
    expect(() => parseCommand(['sync', '--from', 'upstream/main', '--base', 'v1.4.147'])).toThrow(
      'Unsupported current base'
    )
  })

  it('rebases only the local patch queue after release ancestry validation', () => {
    const run = vi.fn()
    const capture = vi.fn((_command, args) => {
      const invocation = args.join(' ')
      if (invocation === 'status --porcelain') {
        return ''
      }
      if (invocation === 'branch --show-current') {
        return 'fork/macos-local'
      }
      if (invocation.includes('v1.4.147^{commit}')) {
        return 'new-base'
      }
      if (invocation.includes('v1.4.146^{commit}')) {
        return 'old-base'
      }
      return ''
    })

    syncForkFromRelease({
      from: 'v1.4.146',
      base: 'v1.4.147',
      run,
      capture
    })

    expect(run.mock.calls).toEqual([
      ['git', ['fetch', 'upstream', 'tag', 'v1.4.147']],
      ['git', ['fetch', 'upstream', 'tag', 'v1.4.146']],
      ['git', ['merge-base', '--is-ancestor', 'old-base', 'new-base']],
      ['git', ['rebase', '--onto', 'new-base', 'old-base']]
    ])
  })

  it('can install a validated existing build without rebuilding it', () => {
    expect(buildDryRunPlan('install')).toEqual(
      expect.arrayContaining([
        'Locate the existing Orca Fork build under dist/.',
        'Snapshot the currently installed app and shared Orca profile as one rollback pair.',
        'Do not launch the app.'
      ])
    )
    expect(buildDryRunPlan('update')[1]).toBe(
      'Build the current checkout with the Orca Fork identity.'
    )
  })

  it('keeps only detached daemon processes alive during the app swap', () => {
    const daemon =
      '/Orca Fork.app/Contents/MacOS/Orca Fork daemon-entry.js --socket daemon.sock'
    const helper =
      '/Orca Fork.app/Contents/Frameworks/Orca Fork Helper.app/Contents/MacOS/Orca Fork Helper'

    expect(isDetachedDaemonProcess(daemon)).toBe(true)
    expect(isDetachedDaemonProcess(helper)).toBe(false)
    expect(blockingForkDesktopProcesses([daemon, helper])).toEqual([helper])
  })

  it('removes staged state when graceful quit is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-fork-handoff-'))
    const installedApp = join(root, 'Orca Fork.app')
    const transaction = prepareUpdateHandoff({
      builtApp: join(root, 'built.app'),
      installedApp,
      stateDirectory: root,
      runtime: { pid: 42, runtimeId: 'runtime-old' },
      cloneDirectory: (_source, target) => mkdirSync(target),
      validateBundle: () => {}
    })

    expect(existsSync(transaction.stagingApp)).toBe(true)
    expect(existsSync(transaction.transactionPath)).toBe(true)
    abortPreparedUpdate(transaction)
    expect(existsSync(transaction.stagingApp)).toBe(false)
    expect(existsSync(transaction.transactionPath)).toBe(false)
    expect(existsSync(installedApp)).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  it('removes the obsolete profile migration command and keeps rollback on v2 backups', () => {
    expect(() => parseCommand(['migrate-profile'])).toThrow('Unknown command')
    expect(buildDryRunPlan('rollback')).toContain(
      'Restore the newest v2 app/shared-profile pair and clear transient runtime state.'
    )
  })
})
