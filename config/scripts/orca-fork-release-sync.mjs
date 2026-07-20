const COMMANDS = new Set(['status', 'signing-setup', 'sync', 'install', 'update', 'rollback'])
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-rc\.\d+)?$/
const COMMIT_PATTERN = /^[0-9a-f]{40}$/

/**
 * Parses the public Fork maintenance command and release-sync arguments.
 *
 * @param {string[]} argv Command-line arguments.
 * @returns {{command: string, apply: boolean, from?: string, base?: string}} Parsed command.
 */
export function parseCommand(argv) {
  const command = argv.find((value) => !value.startsWith('-')) ?? 'status'
  if (!COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}`)
  }
  const baseIndex = argv.indexOf('--base')
  const base = baseIndex === -1 ? undefined : argv[baseIndex + 1]
  const fromIndex = argv.indexOf('--from')
  const from = fromIndex === -1 ? undefined : argv[fromIndex + 1]
  if (baseIndex !== -1 && (!base || base.startsWith('-'))) {
    throw new Error('--base requires a release tag.')
  }
  if (fromIndex !== -1 && (!from || from.startsWith('-'))) {
    throw new Error('--from requires the current release tag or commit.')
  }
  if (command === 'sync' && (!from || !base)) {
    throw new Error('sync requires --from <current-base> --base <release-tag>.')
  }
  if ((base || from) && command !== 'sync') {
    throw new Error('--from and --base are only supported by sync.')
  }
  if (base && !RELEASE_TAG_PATTERN.test(base)) {
    throw new Error(`Unsupported release tag: ${base}`)
  }
  if (from && !RELEASE_TAG_PATTERN.test(from) && !COMMIT_PATTERN.test(from)) {
    throw new Error(`Unsupported current base: ${from}`)
  }
  return {
    command,
    apply: argv.includes('--apply'),
    ...(from && base ? { from, base } : {})
  }
}

/**
 * Describes the release-tag sync without mutating Git.
 *
 * @param {string | undefined} from Current upstream release tag or commit.
 * @param {string | undefined} base Requested release tag.
 * @returns {string[]} Ordered dry-run steps.
 */
export function buildReleaseSyncDryRunPlan(from, base) {
  if (!from || !base) {
    throw new Error('sync requires --from <current-base> --base <release-tag>.')
  }
  return [
    `Fetch official release tag ${base}.`,
    `Verify ${base} contains current upstream base ${from}.`,
    'Replay only the Fork patch queue onto the release tag; abort automatically on conflict.'
  ]
}

/**
 * Replays the local Fork patch queue onto an explicit official release tag.
 *
 * @param {object} input Sync dependencies and refs.
 * @param {string} input.from Current upstream release tag or commit.
 * @param {string} input.base Requested release tag.
 * @param {(command: string, args: string[]) => unknown} input.run Throwing command runner.
 * @param {(command: string, args: string[]) => string} input.capture Capturing command runner.
 * @returns {void}
 */
export function syncForkFromRelease({ from, base, run, capture }) {
  const status = capture('git', ['status', '--porcelain'])
  if (status) {
    throw new Error('The source checkout is dirty. Commit or stash changes before syncing.')
  }
  const branch = capture('git', ['branch', '--show-current'])
  if (!branch || branch === 'main' || branch === 'master') {
    throw new Error('Sync requires a named fork branch, never main/master.')
  }

  run('git', ['fetch', 'upstream', 'tag', base])
  if (RELEASE_TAG_PATTERN.test(from)) {
    run('git', ['fetch', 'upstream', 'tag', from])
  }
  const nextBase = capture('git', ['rev-parse', '--verify', `${base}^{commit}`])
  const currentBase = capture('git', ['rev-parse', '--verify', `${from}^{commit}`])
  if (!nextBase || !currentBase) {
    throw new Error('Could not resolve the current or requested upstream base.')
  }
  try {
    run('git', ['merge-base', '--is-ancestor', currentBase, nextBase])
  } catch {
    throw new Error(`${base} does not contain current upstream base ${from}.`)
  }
  try {
    // Why: replay only local patches; rebasing by branch name could silently change the baseline.
    run('git', ['rebase', '--onto', nextBase, currentBase])
  } catch (error) {
    run('git', ['rebase', '--abort'])
    throw error
  }
}
