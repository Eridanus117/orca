import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HandlerContext } from '../dispatch'
import type { RuntimeClient } from '../runtime-client'
import { okFixture } from '../test-fixtures'
import { WORKSPACE_GROUPING_HANDLERS } from './workspace-grouping'

describe('workspace grouping CLI handlers', () => {
  const call = vi.fn()
  const client = { call, isRemote: false } as unknown as RuntimeClient
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

  afterEach(() => {
    call.mockReset()
    log.mockClear()
  })

  /**
   * Runs one workspace-grouping handler with JSON output.
   *
   * @param command Canonical CLI command key.
   * @param flags Parsed CLI flags.
   * @returns Handler completion promise.
   */
  function run(command: string, flags: Map<string, string | boolean>): Promise<void> {
    const context: HandlerContext = {
      flags,
      client,
      cwd: '/Users/test/work',
      json: true
    }
    return WORKSPACE_GROUPING_HANDLERS[command](context)
  }

  it('creates a Project Group with a resolved parent path', async () => {
    call.mockResolvedValue(
      okFixture('group-create', {
        group: { id: 'group-1', name: 'Orca', parentPath: '/Users/test/work/orca' }
      })
    )

    await run(
      'project-group create',
      new Map([
        ['name', 'Orca'],
        ['parent-path', './orca']
      ])
    )

    expect(call).toHaveBeenCalledWith('projectGroup.create', {
      name: 'Orca',
      parentPath: '/Users/test/work/orca',
      createdFrom: 'manual'
    })
  })

  it('creates a Folder Workspace under an explicit Project Group', async () => {
    call.mockResolvedValue(
      okFixture('folder-create', {
        folderWorkspace: {
          id: 'folder-1',
          projectGroupId: 'group-1',
          name: 'Fork maintenance',
          folderPath: '/Users/test/work/orca'
        }
      })
    )

    await run(
      'folder-workspace create',
      new Map([
        ['group', 'group-1'],
        ['name', 'Fork maintenance'],
        ['path', './orca']
      ])
    )

    expect(call).toHaveBeenCalledWith('folderWorkspace.create', {
      projectGroupId: 'group-1',
      name: 'Fork maintenance',
      folderPath: '/Users/test/work/orca'
    })
  })
})
