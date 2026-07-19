import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LOCAL_FORK_DISTRIBUTION_MARKER,
  resolveLocalForkDistribution
} from './local-fork-distribution'

const tempDirectories: string[] = []
const validIdentity = {
  schema: 'orca.local-distribution/v2',
  kind: 'local-fork',
  appId: 'com.eridanus117.orca-fork',
  productName: 'Orca Fork',
  userDataDirName: 'orca',
  executableName: 'Orca'
}

function createResources(identity: unknown = validIdentity): string {
  const resourcesPath = mkdtempSync(join(tmpdir(), 'orca-fork-distribution-'))
  tempDirectories.push(resourcesPath)
  writeFileSync(
    join(resourcesPath, LOCAL_FORK_DISTRIBUTION_MARKER),
    JSON.stringify(identity),
    'utf8'
  )
  return resourcesPath
}

function createEmptyResources(): string {
  const resourcesPath = mkdtempSync(join(tmpdir(), 'orca-fork-no-marker-'))
  tempDirectories.push(resourcesPath)
  return resourcesPath
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('local fork distribution', () => {
  it('accepts a packaged build only when the compiled flag and marker agree', () => {
    expect(
      resolveLocalForkDistribution({
        resourcesPath: createResources(),
        isPackaged: true,
        compiledLocalForkBuild: true
      })
    ).toEqual(validIdentity)
  })

  it('rejects a partial fork build instead of mixing distribution identities', () => {
    expect(() =>
      resolveLocalForkDistribution({
        resourcesPath: createResources(),
        isPackaged: true,
        compiledLocalForkBuild: false
      })
    ).toThrow('identity mismatch')

    expect(() =>
      resolveLocalForkDistribution({
        resourcesPath: createEmptyResources(),
        isPackaged: true,
        compiledLocalForkBuild: true
      })
    ).toThrow('identity mismatch')
  })

  it('rejects malformed marker data', () => {
    expect(() =>
      resolveLocalForkDistribution({
        resourcesPath: createResources({ schema: validIdentity.schema }),
        isPackaged: true,
        compiledLocalForkBuild: true
      })
    ).toThrow('identity mismatch')
  })
})
