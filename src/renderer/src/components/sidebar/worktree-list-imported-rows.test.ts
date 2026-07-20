import { describe, expect, it } from 'vitest'
import {
  canKeepImportedWorktreesHidden,
  getRenderRowKey,
  getWorktreeDragGroups,
  getWorktreeDragIndexes,
  renderRowContainsWorktree
} from './WorktreeList'
import type { FolderWorkspace, ProjectGroup, Repo, Worktree } from '../../../../shared/types'
import type { Row } from './worktree-list-groups'

const repo: Repo = {
  id: 'repo-1',
  path: '/repo',
  displayName: 'orca',
  badgeColor: '#000',
  addedAt: 1
}

const makeHeaderRow = (key: string): Extract<Row, { type: 'header' }> => ({
  type: 'header',
  key,
  label: key,
  count: 0,
  tone: 'text-foreground'
})

const makeWorktree = (id: string): Worktree => ({
  id,
  repoId: repo.id,
  path: `/repo/${id}`,
  head: 'abc123',
  branch: `refs/heads/${id}`,
  isBare: false,
  isMainWorktree: false,
  displayName: id,
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  linkedLinearIssue: null,
  linkedGitLabMR: null,
  linkedGitLabIssue: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0
})

const makeWorktreeRow = (id: string): Extract<Row, { type: 'item' }> => ({
  type: 'item',
  rowKey: `all:${id}`,
  sectionKey: 'all',
  worktree: makeWorktree(id),
  repo,
  depth: 0,
  groupDepth: 0,
  lineageTrail: [],
  isLastLineageChild: false,
  lineageChildCount: 0
})

const makePinnedWorktreeRow = (id: string): Extract<Row, { type: 'item' }> => ({
  ...makeWorktreeRow(id),
  rowKey: `pinned:${id}`,
  sectionKey: 'pinned',
  worktree: { ...makeWorktree(id), isPinned: true }
})

const makeImportedCardRow = (): Extract<Row, { type: 'imported-worktrees-card' }> => ({
  type: 'imported-worktrees-card',
  key: 'imported-worktrees-card:repo-group:repo-1',
  repo,
  hiddenWorktrees: [],
  placement: 'repo-group'
})

const makeFolderWorkspaceRow = (): Extract<Row, { type: 'folder-workspace' }> => {
  const projectGroup: ProjectGroup = {
    id: 'group-1',
    name: 'Logistics',
    parentPath: '/workspace/logistics',
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  }
  const folderWorkspace: FolderWorkspace = {
    id: 'folder-1',
    projectGroupId: projectGroup.id,
    name: 'FREIGHT-45',
    folderPath: '/workspace/logistics/FREIGHT-45',
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    createdAt: 1,
    updatedAt: 1
  }
  return {
    type: 'folder-workspace',
    key: 'folder-workspace:folder-1',
    folderWorkspace,
    projectGroup,
    attachedWorktreeIds: ['attached'],
    attachmentsCollapsed: false,
    depth: 0,
    groupDepth: 1
  }
}

describe('imported worktree virtual rows', () => {
  it('uses stable imported row keys and does not match worktree ids', () => {
    const card = makeImportedCardRow()

    expect(getRenderRowKey(card)).toBe('imported:imported-worktrees-card:repo-group:repo-1')
    expect(renderRowContainsWorktree(card, 'wt-1')).toBe(false)
  })

  it('keeps imported card rows out of worktree drag groups', () => {
    expect(
      getWorktreeDragGroups([
        makeHeaderRow('repo:repo-1'),
        makeWorktreeRow('main'),
        makeImportedCardRow(),
        makeWorktreeRow('feature')
      ])
    ).toEqual([{ key: 'repo:repo-1', worktreeIds: ['main', 'feature'] }])
  })

  it('indexes pinned rows for sidebar drag when they are the only rendered copy', () => {
    const rows = [makeHeaderRow('pinned'), makePinnedWorktreeRow('main')]
    const { groupIndexByRowKey, groupKeyByRowKey } = getWorktreeDragIndexes(rows)

    expect(getWorktreeDragGroups(rows)).toEqual([{ key: 'pinned', worktreeIds: ['main'] }])
    expect(groupKeyByRowKey.get('pinned:main')).toBe('pinned')
    expect(groupIndexByRowKey.get('pinned:main')).toBe(0)
  })

  it('uses natural drag metadata when pinned rows have duplicate natural copies', () => {
    const rows = [
      makeHeaderRow('pinned'),
      makePinnedWorktreeRow('main'),
      makeHeaderRow('all'),
      makeWorktreeRow('main')
    ]
    const { groupKeyByRowKey } = getWorktreeDragIndexes(rows)

    expect(getWorktreeDragGroups(rows)).toEqual([{ key: 'all', worktreeIds: ['main'] }])
    expect(groupKeyByRowKey.has('pinned:main')).toBe(false)
    expect(groupKeyByRowKey.get('all:main')).toBe('all')
  })

  it('treats a folder task group as one draggable row while keeping its projections attached', () => {
    const folderRow = makeFolderWorkspaceRow()
    const projectedRow = {
      ...makeWorktreeRow('attached'),
      rowKey: 'folder-workspace:folder-1:attached',
      sectionKey: 'folder-workspace:folder-1',
      folderWorkspaceId: 'folder-1'
    }
    const rows = [
      makeHeaderRow('project-group:group-1'),
      folderRow,
      projectedRow,
      makeHeaderRow('repo:repo-1'),
      makeWorktreeRow('regular')
    ]
    const { groupIndexByRowKey, groupKeyByRowKey } = getWorktreeDragIndexes(rows)

    expect(getWorktreeDragGroups(rows)).toEqual([
      { key: 'project-group:group-1', worktreeIds: ['folder:folder-1'] },
      { key: 'repo:repo-1', worktreeIds: ['regular'] }
    ])
    expect(groupKeyByRowKey.get('folder:folder-1')).toBe('project-group:group-1')
    expect(groupIndexByRowKey.get('folder:folder-1')).toBe(0)
    expect(groupKeyByRowKey.has(projectedRow.rowKey)).toBe(false)
  })

  it('only allows keep-hidden actions for repo-group cards that are not forced visible', () => {
    expect(canKeepImportedWorktreesHidden(makeImportedCardRow(), undefined)).toBe(true)
    expect(
      canKeepImportedWorktreesHidden(makeImportedCardRow(), {
        pending: false,
        error: 'Could not show discovered worktrees.',
        forceVisible: true
      })
    ).toBe(false)
    expect(
      canKeepImportedWorktreesHidden(
        { ...makeImportedCardRow(), placement: 'pinned-fallback' },
        undefined
      )
    ).toBe(false)
  })
})
