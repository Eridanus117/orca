import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureLocalForkTerminalOrcaCliShimDir } from './local-fork-terminal-orca-cli-shim'

const created: string[] = []

async function makeFixture(): Promise<{ userDataPath: string; resourcesPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'orca-fork-terminal-cli-shim-'))
  created.push(root)
  const resourcesPath = join(root, 'Orca Fork.app', 'Contents', 'Resources')
  mkdirSync(join(resourcesPath, 'bin'), { recursive: true })
  writeFileSync(join(resourcesPath, 'bin', 'orca-fork'), '#!/usr/bin/env bash\n', 'utf8')
  return { userDataPath: join(root, 'user-data'), resourcesPath }
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ensureLocalForkTerminalOrcaCliShimDir', () => {
  it('writes an executable bare-orca shim targeting the bundled fork CLI', async () => {
    const { userDataPath, resourcesPath } = await makeFixture()

    const shimDir = ensureLocalForkTerminalOrcaCliShimDir({
      userDataPath,
      resourcesPath,
      cliCommand: 'orca-fork',
      platform: 'darwin'
    })

    expect(shimDir).toBe(join(userDataPath, 'local-fork-orca-cli-shim'))
    const shimPath = join(shimDir!, 'orca')
    expect(readFileSync(shimPath, 'utf8')).toContain(
      `exec '${join(resourcesPath, 'bin', 'orca-fork')}' "$@"`
    )
    expect(statSync(shimPath).mode & 0o111).not.toBe(0)
  })

  it('rewrites a stale shim and restores its executable bit', async () => {
    const { userDataPath, resourcesPath } = await makeFixture()
    const shimDir = join(userDataPath, 'local-fork-orca-cli-shim')
    const shimPath = join(shimDir, 'orca')
    mkdirSync(shimDir, { recursive: true })
    writeFileSync(shimPath, 'stale', 'utf8')
    chmodSync(shimPath, 0o644)

    expect(
      ensureLocalForkTerminalOrcaCliShimDir({
        userDataPath,
        resourcesPath,
        cliCommand: 'orca-fork',
        platform: 'darwin'
      })
    ).toBe(shimDir)
    expect(readFileSync(shimPath, 'utf8')).toContain('orca-fork')
    expect(statSync(shimPath).mode & 0o111).not.toBe(0)
  })

  it('does not cache a missing packaged launcher', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-fork-terminal-cli-shim-missing-'))
    created.push(root)
    const userDataPath = join(root, 'user-data')
    const resourcesPath = join(root, 'resources')

    expect(
      ensureLocalForkTerminalOrcaCliShimDir({
        userDataPath,
        resourcesPath,
        cliCommand: 'orca-fork',
        platform: 'darwin'
      })
    ).toBeNull()

    mkdirSync(join(resourcesPath, 'bin'), { recursive: true })
    writeFileSync(join(resourcesPath, 'bin', 'orca-fork'), '#!/usr/bin/env bash\n', 'utf8')
    expect(
      ensureLocalForkTerminalOrcaCliShimDir({
        userDataPath,
        resourcesPath,
        cliCommand: 'orca-fork',
        platform: 'darwin'
      })
    ).toBe(join(userDataPath, 'local-fork-orca-cli-shim'))
  })

  it('rejects unsafe command names and native Windows', async () => {
    const { userDataPath, resourcesPath } = await makeFixture()
    expect(
      ensureLocalForkTerminalOrcaCliShimDir({
        userDataPath,
        resourcesPath,
        cliCommand: '../orca-fork',
        platform: 'darwin'
      })
    ).toBeNull()
    expect(
      ensureLocalForkTerminalOrcaCliShimDir({
        userDataPath,
        resourcesPath,
        cliCommand: 'orca-fork',
        platform: 'win32'
      })
    ).toBeNull()
  })
})
