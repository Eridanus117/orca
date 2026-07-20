import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { validateForkBundle } from './orca-fork-bundle-validation.mjs'
import {
  createForkSigningIdentity,
  hasStableCodeRequirement,
  ORCA_FORK_LOCAL_SIGNING_IDENTITY,
  resolveForkSigningIdentity
} from './orca-fork-code-signing.mjs'
import { buildDryRunPlan, parseCommand } from './orca-fork-macos.mjs'
import { syncForkFromRelease } from './orca-fork-release-sync.mjs'
import {
  abortPreparedUpdate,
  blockingForkDesktopProcesses,
  isDetachedDaemonProcess,
  prepareUpdateHandoff
} from './orca-fork-update-handoff.mjs'

describe('orca-fork-macos', () => {
  it('requires a stable certificate identity for local Fork builds', () => {
    const identities = [
      '  1) AABBCCDD "Apple Development: Example"',
      '  2) 11223344 "Orca Fork Local Code Signing"',
      '     2 valid identities found'
    ].join('\n')

    expect(resolveForkSigningIdentity({ identities })).toBe('Orca Fork Local Code Signing')
    expect(
      resolveForkSigningIdentity({
        explicitIdentity: 'Apple Development: Example',
        identities
      })
    ).toBe('Apple Development: Example')
    expect(() => resolveForkSigningIdentity({ identities: '0 valid identities found' })).toThrow(
      'signing-setup --apply'
    )
  })

  it('keeps local signing setup behind dry-run and explicit apply', () => {
    expect(parseCommand(['signing-setup'])).toEqual({
      command: 'signing-setup',
      apply: false
    })
    expect(parseCommand(['signing-setup', '--apply'])).toEqual({
      command: 'signing-setup',
      apply: true
    })
    expect(buildDryRunPlan('signing-setup')).toEqual(
      expect.arrayContaining([
        'Back up current user trust settings.',
        'Create a non-extractable local code-signing identity in the login Keychain.'
      ])
    )
  })

  it('imports a non-extractable key and limits trust to code signing', () => {
    const commands = []
    const trustBackupPath = join(
      tmpdir(),
      `orca-fork-trust-settings-${process.pid}-${Date.now()}.plist`
    )

    createForkSigningIdentity({
      keychainPath: '/tmp/login.keychain-db',
      trustBackupPath,
      run: (command, args) => commands.push([command, args])
    })

    expect(commands[0]).toEqual(['security', ['trust-settings-export', trustBackupPath]])
    expect(commands).toContainEqual([
      'security',
      expect.arrayContaining([
        'import',
        expect.any(String),
        '-k',
        '/tmp/login.keychain-db',
        '-x',
        '-T',
        '/usr/bin/codesign'
      ])
    ])
    expect(commands.at(-1)).toEqual([
      'security',
      expect.arrayContaining([
        'add-trusted-cert',
        '-r',
        'trustRoot',
        '-p',
        'codeSign',
        '-k',
        '/tmp/login.keychain-db'
      ])
    ])
    expect(
      commands.some(([, args]) =>
        args.some((arg) => arg.startsWith(`/CN=${ORCA_FORK_LOCAL_SIGNING_IDENTITY}/`))
      )
    ).toBe(true)
  })

  it('rejects cdhash-only ad-hoc requirements that invalidate TCC grants', () => {
    expect(hasStableCodeRequirement('# designated => cdhash H"0123456789"')).toBe(false)
    expect(
      hasStableCodeRequirement(
        'designated => identifier "com.eridanus117.orca-fork" and anchor H"AABBCCDD"'
      )
    ).toBe(true)
  })

  it('validates the bundle layout and certificate-backed requirement', () => {
    const appPath = mkdtempSync(join(tmpdir(), 'orca-fork-bundle-'))
    const resources = join(appPath, 'Contents', 'Resources')
    mkdirSync(join(resources, 'bin'), { recursive: true })
    writeFileSync(join(resources, 'orca-fork-distribution.json'), '{}')
    writeFileSync(join(resources, 'bin', 'orca'), '')
    const run = vi.fn()
    const capture = vi.fn((_command, args) =>
      args.includes('Print :CFBundleIdentifier') ? 'com.example.orca-fork' : 'Orca Fork'
    )
    const captureCombined = vi.fn(
      () => 'designated => identifier "com.example.orca-fork" and anchor H"AABBCCDD"'
    )

    try {
      validateForkBundle({
        appPath,
        distribution: {
          appId: 'com.example.orca-fork',
          executableName: 'Orca Fork'
        },
        run,
        capture,
        captureCombined
      })
    } finally {
      rmSync(appPath, { recursive: true, force: true })
    }

    expect(run).toHaveBeenCalledWith('codesign', ['--verify', '--deep', '--strict', appPath])
    expect(captureCombined).toHaveBeenCalledWith('codesign', ['-d', '-r-', appPath])
  })

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
    const daemon = '/Orca Fork.app/Contents/MacOS/Orca Fork daemon-entry.js --socket daemon.sock'
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
