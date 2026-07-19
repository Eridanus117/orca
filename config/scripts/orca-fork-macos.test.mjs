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
    expect(buildDryRunPlan('install')[0]).toBe('Locate the existing Orca Fork build under dist/.')
    expect(buildDryRunPlan('update')[0]).toBe(
      'Build the current checkout with the Orca Fork identity.'
    )
  })
})
