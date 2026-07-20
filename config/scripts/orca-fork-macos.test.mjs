import { describe, expect, it } from 'vitest'
import { buildDryRunPlan, parseCommand } from './orca-fork-macos.mjs'

describe('orca-fork-macos', () => {
  it('defaults mutating commands to dry-run', () => {
    expect(parseCommand(['update'])).toEqual({ command: 'update', apply: false })
    expect(buildDryRunPlan('update')).toContain('Do not launch the app.')
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

  it('removes the obsolete profile migration command and keeps rollback on v2 backups', () => {
    expect(() => parseCommand(['migrate-profile'])).toThrow('Unknown command')
    expect(buildDryRunPlan('rollback')).toContain(
      'Restore the newest v2 app/shared-profile pair and clear transient runtime state.'
    )
  })
})
