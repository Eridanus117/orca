import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const WORKSPACE_GROUPING_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['project-group', 'list'],
    summary: 'List sidebar Project Groups',
    usage: 'orca project-group list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca project-group list --json']
  },
  {
    path: ['project-group', 'create'],
    summary: 'Create a sidebar Project Group',
    usage: 'orca project-group create --name <name> [--parent-path <path>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name', 'parent-path'],
    examples: ['orca project-group create --name "Orca" --parent-path ~/work --json']
  },
  {
    path: ['project-group', 'update'],
    summary: 'Rename or reorder a sidebar Project Group',
    usage: 'orca project-group update --group <id> [--name <name>] [--order <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'group', 'name', 'order'],
    examples: ['orca project-group update --group <id> --name "Agent 工作面" --order 0 --json']
  },
  {
    path: ['project-group', 'move-project'],
    summary: 'Move a registered project into a Project Group',
    usage: 'orca project-group move-project --repo <selector> --group <id> [--order <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'group', 'order'],
    examples: ['orca project-group move-project --repo name:orca --group <id> --order 0 --json']
  },
  {
    path: ['folder-workspace', 'list'],
    summary: 'List Folder Workspaces, optionally within one Project Group',
    usage: 'orca folder-workspace list [--group <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'group'],
    examples: ['orca folder-workspace list --group <id> --json']
  },
  {
    path: ['folder-workspace', 'create'],
    summary: 'Create an item-level Folder Workspace',
    usage: 'orca folder-workspace create --group <id> --name <name> --path <path> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'group', 'name', 'path'],
    examples: [
      'orca folder-workspace create --group <id> --name "FREIGHT-45 · 模板换绑异步化" --path ~/work/workspaces/FREIGHT-45 --json'
    ]
  },
  {
    path: ['folder-workspace', 'update'],
    summary: 'Update an item-level Folder Workspace',
    usage:
      'orca folder-workspace update --folder <id> [--name <name>] [--path <path>] [--comment <text>] [--workspace-status <id>] [--archived true|false] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'folder',
      'name',
      'path',
      'comment',
      'workspace-status',
      'archived'
    ],
    examples: [
      'orca folder-workspace update --folder <id> --name "FREIGHT-45 · 模板换绑异步化" --workspace-status in-progress --json'
    ]
  }
]
