import type { FolderWorkspace, ProjectGroup, Repo } from '../shared/types'

/**
 * Formats Project Groups for terminal output.
 *
 * @param result Project Groups returned by the runtime.
 * @returns One compact line per group.
 */
export function formatProjectGroupList(result: { groups: ProjectGroup[] }): string {
  if (result.groups.length === 0) {
    return 'No Project Groups found.'
  }
  return result.groups
    .map(
      (group) =>
        `${group.id}  ${group.name}  order:${group.tabOrder}  path:${group.parentPath ?? 'none'}`
    )
    .join('\n')
}

/**
 * Formats one Project Group mutation result.
 *
 * @param result Project Group returned by the runtime.
 * @returns Compact mutation summary.
 */
export function formatProjectGroupResult(result: { group: ProjectGroup | null }): string {
  const group = result.group
  return group
    ? `${group.id}  ${group.name}  order:${group.tabOrder}  path:${group.parentPath ?? 'none'}`
    : 'Project Group not found.'
}

/**
 * Formats a project move between Project Groups.
 *
 * @param result Repo returned after the move.
 * @returns Compact repo and group summary.
 */
export function formatMovedProject(result: { repo: Repo | null }): string {
  const repo = result.repo
  return repo
    ? `${repo.id}  ${repo.displayName}  group:${repo.projectGroupId ?? 'none'}`
    : 'Project not found.'
}

/**
 * Formats Folder Workspaces for terminal output.
 *
 * @param result Folder Workspaces returned by the runtime.
 * @returns One compact line per workspace.
 */
export function formatFolderWorkspaceList(result: { folderWorkspaces: FolderWorkspace[] }): string {
  if (result.folderWorkspaces.length === 0) {
    return 'No Folder Workspaces found.'
  }
  return result.folderWorkspaces
    .map(
      (workspace) =>
        `${workspace.id}  ${workspace.name}  group:${workspace.projectGroupId}  status:${workspace.workspaceStatus ?? 'none'}  path:${workspace.folderPath}`
    )
    .join('\n')
}

/**
 * Formats one Folder Workspace mutation result.
 *
 * @param result Folder Workspace returned by the runtime.
 * @returns Compact mutation summary.
 */
export function formatFolderWorkspaceResult(result: {
  folderWorkspace: FolderWorkspace | null
}): string {
  const workspace = result.folderWorkspace
  return workspace
    ? `${workspace.id}  ${workspace.name}  group:${workspace.projectGroupId}  path:${workspace.folderPath}`
    : 'Folder Workspace not found.'
}
