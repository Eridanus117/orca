import { describe, expect, it } from 'vitest'
import {
  getFullDropIndexForWorktreeDragUnit,
  getWorktreeDragUnitGroups
} from './worktree-drag-units'

function header(key: string): { type: 'header'; key: string } {
  return { type: 'header', key }
}

function item(
  id: string,
  depth = 0,
  sectionKey = 'all',
  folderWorkspaceId?: string
): {
  type: 'item'
  worktree: { id: string }
  depth: number
  sectionKey: string
  folderWorkspaceId?: string
} {
  return { type: 'item', worktree: { id }, depth, sectionKey, folderWorkspaceId }
}

function importedCard(): { type: 'imported-worktrees-card' } {
  return { type: 'imported-worktrees-card' }
}

function folderWorkspace(id: string): {
  type: 'folder-workspace'
  folderWorkspace: { id: string }
} {
  return { type: 'folder-workspace', folderWorkspace: { id } }
}

describe('getWorktreeDragUnitGroups', () => {
  it('treats expanded lineage descendants as part of the parent drag unit', () => {
    const groups = getWorktreeDragUnitGroups([
      header('all'),
      item('parent'),
      item('child', 1),
      item('grandchild', 2),
      item('sibling')
    ])

    expect(groups).toEqual([
      {
        key: 'all',
        worktreeIds: ['parent', 'sibling'],
        units: [
          { worktreeId: 'parent', worktreeIds: ['parent', 'child', 'grandchild'] },
          { worktreeId: 'sibling', worktreeIds: ['sibling'] }
        ]
      }
    ])
  })

  it('ignores imported worktree card rows without splitting drag groups', () => {
    const groups = getWorktreeDragUnitGroups([
      header('repo:one'),
      item('main'),
      importedCard(),
      item('feature'),
      header('repo:two'),
      importedCard(),
      item('other')
    ])

    expect(groups).toEqual([
      {
        key: 'repo:one',
        worktreeIds: ['main', 'feature'],
        units: [
          { worktreeId: 'main', worktreeIds: ['main'] },
          { worktreeId: 'feature', worktreeIds: ['feature'] }
        ]
      },
      {
        key: 'repo:two',
        worktreeIds: ['other'],
        units: [{ worktreeId: 'other', worktreeIds: ['other'] }]
      }
    ])
  })

  it('includes pinned rows when they are the only rendered copy', () => {
    const groups = getWorktreeDragUnitGroups([
      header('pinned'),
      item('pinned-copy', 0, 'pinned'),
      item('other-pinned', 0, 'pinned')
    ])

    expect(groups).toEqual([
      {
        key: 'pinned',
        worktreeIds: ['pinned-copy', 'other-pinned'],
        units: [
          { worktreeId: 'pinned-copy', worktreeIds: ['pinned-copy'] },
          { worktreeId: 'other-pinned', worktreeIds: ['other-pinned'] }
        ]
      }
    ])
  })

  it('uses natural drag units when pinned rows have duplicate natural copies', () => {
    const groups = getWorktreeDragUnitGroups([
      header('pinned'),
      item('pinned-copy', 0, 'pinned'),
      header('all'),
      item('pinned-copy'),
      item('other')
    ])

    expect(groups).toEqual([
      {
        key: 'all',
        worktreeIds: ['pinned-copy', 'other'],
        units: [
          { worktreeId: 'pinned-copy', worktreeIds: ['pinned-copy'] },
          { worktreeId: 'other', worktreeIds: ['other'] }
        ]
      }
    ])
  })

  it('treats each folder task group as one drag unit', () => {
    expect(
      getWorktreeDragUnitGroups([
        header('project-group:logistics'),
        folderWorkspace('freight-45'),
        item('freight-45-center', 0, 'folder-workspace:freight-45', 'freight-45'),
        folderWorkspace('freight-49')
      ])
    ).toEqual([
      {
        key: 'project-group:logistics',
        worktreeIds: ['folder:freight-45', 'folder:freight-49'],
        units: [
          { worktreeId: 'folder:freight-45', worktreeIds: ['folder:freight-45'] },
          { worktreeId: 'folder:freight-49', worktreeIds: ['folder:freight-49'] }
        ]
      }
    ])
  })
})

describe('getFullDropIndexForWorktreeDragUnit', () => {
  it('maps visual unit drop indexes back to full row indexes', () => {
    const groups = getWorktreeDragUnitGroups([
      header('all'),
      item('parent'),
      item('child', 1),
      item('sibling')
    ])

    expect(
      getFullDropIndexForWorktreeDragUnit({
        groups,
        sourceGroupKey: 'all',
        dropIndex: 2
      })
    ).toBe(3)
  })
})
