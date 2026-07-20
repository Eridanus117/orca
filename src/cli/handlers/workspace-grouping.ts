import type { FolderWorkspace, ProjectGroup, Repo } from '../../shared/types'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getOptionalNumberFlag, getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { resolveRepoPathArgument } from '../repo-path-arguments'
import { RuntimeClientError } from '../runtime-client'
import {
  formatFolderWorkspaceList,
  formatFolderWorkspaceResult,
  formatMovedProject,
  formatProjectGroupList,
  formatProjectGroupResult
} from '../workspace-grouping-format'

/**
 * Parses an optional true/false CLI flag.
 *
 * @param flags Parsed CLI flags.
 * @param name Flag name without leading dashes.
 * @returns Parsed boolean or undefined when absent.
 */
function getOptionalBooleanFlag(
  flags: Map<string, string | boolean>,
  name: string
): boolean | undefined {
  const value = getOptionalStringFlag(flags, name)
  if (value === undefined) {
    return undefined
  }
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  throw new RuntimeClientError('invalid_argument', `--${name} must be true or false`)
}

export const WORKSPACE_GROUPING_HANDLERS: Record<string, CommandHandler> = {
  'project-group list': async ({ client, json }) => {
    const result = await client.call<{ groups: ProjectGroup[] }>('projectGroup.list')
    printResult(result, json, formatProjectGroupList)
  },
  'project-group create': async ({ flags, client, cwd, json }) => {
    const rawParentPath = getOptionalStringFlag(flags, 'parent-path')
    const result = await client.call<{ group: ProjectGroup }>('projectGroup.create', {
      name: getRequiredStringFlag(flags, 'name'),
      parentPath:
        rawParentPath === undefined
          ? undefined
          : resolveRepoPathArgument(rawParentPath, cwd, client.isRemote, 'Remote Project Group'),
      createdFrom: 'manual'
    })
    printResult(result, json, formatProjectGroupResult)
  },
  'project-group update': async ({ flags, client, json }) => {
    const result = await client.call<{ group: ProjectGroup | null }>('projectGroup.update', {
      groupId: getRequiredStringFlag(flags, 'group'),
      updates: {
        name: getOptionalStringFlag(flags, 'name'),
        tabOrder: getOptionalNumberFlag(flags, 'order')
      }
    })
    printResult(result, json, formatProjectGroupResult)
  },
  'project-group move-project': async ({ flags, client, json }) => {
    const result = await client.call<{ repo: Repo | null }>('projectGroup.moveProject', {
      repo: getRequiredStringFlag(flags, 'repo'),
      groupId: getRequiredStringFlag(flags, 'group'),
      order: getOptionalNumberFlag(flags, 'order')
    })
    printResult(result, json, formatMovedProject)
  },
  'folder-workspace list': async ({ flags, client, json }) => {
    const groupId = getOptionalStringFlag(flags, 'group')
    const result = await client.call<{ folderWorkspaces: FolderWorkspace[] }>(
      'folderWorkspace.list'
    )
    const folderWorkspaces =
      groupId === undefined
        ? result.result.folderWorkspaces
        : result.result.folderWorkspaces.filter((workspace) => workspace.projectGroupId === groupId)
    printResult({ ...result, result: { folderWorkspaces } }, json, formatFolderWorkspaceList)
  },
  'folder-workspace create': async ({ flags, client, cwd, json }) => {
    const rawPath = getRequiredStringFlag(flags, 'path')
    const result = await client.call<{ folderWorkspace: FolderWorkspace }>(
      'folderWorkspace.create',
      {
        projectGroupId: getRequiredStringFlag(flags, 'group'),
        name: getRequiredStringFlag(flags, 'name'),
        folderPath: resolveRepoPathArgument(
          rawPath,
          cwd,
          client.isRemote,
          'Remote Folder Workspace'
        )
      }
    )
    printResult(result, json, formatFolderWorkspaceResult)
  },
  'folder-workspace update': async ({ flags, client, cwd, json }) => {
    const rawPath = getOptionalStringFlag(flags, 'path')
    const result = await client.call<{ folderWorkspace: FolderWorkspace | null }>(
      'folderWorkspace.update',
      {
        folderWorkspaceId: getRequiredStringFlag(flags, 'folder'),
        updates: {
          name: getOptionalStringFlag(flags, 'name'),
          folderPath:
            rawPath === undefined
              ? undefined
              : resolveRepoPathArgument(rawPath, cwd, client.isRemote, 'Remote Folder Workspace'),
          comment: getOptionalStringFlag(flags, 'comment'),
          workspaceStatus: getOptionalStringFlag(flags, 'workspace-status'),
          isArchived: getOptionalBooleanFlag(flags, 'archived')
        }
      }
    )
    printResult(result, json, formatFolderWorkspaceResult)
  }
}
