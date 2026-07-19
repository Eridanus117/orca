import { describe, expect, it } from 'vitest'
import { buildDryRunPlan, parseCommand } from './orca-fork-macos.mjs'

describe('orca-fork-macos', () => {
  it('defaults mutating commands to dry-run', () => {
    expect(parseCommand(['update'])).toEqual({ command: 'update', apply: false })
    expect(buildDryRunPlan('update')).toContain('Do not launch the app.')
  })

  it('requires an explicit apply flag and keeps source sync separate', () => {
    expect(parseCommand(['sync', '--apply'])).toEqual({ command: 'sync', apply: true })
    expect(buildDryRunPlan('sync')).toEqual([
      'Fetch upstream/main.',
      'Rebase the current fork branch; abort automatically on conflict.'
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

  it('removes the obsolete profile migration command and keeps rollback on v2 backups', () => {
    expect(() => parseCommand(['migrate-profile'])).toThrow('Unknown command')
    expect(buildDryRunPlan('rollback')).toContain(
      'Restore the newest v2 app/shared-profile pair and clear transient runtime state.'
    )
  })
})
