#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  readlinkSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  abortPreparedUpdate,
  assertAllOrcaAppsStopped,
  assertAppBundleStopped,
  assertForkDesktopStopped,
  completeUpdateHandoff,
  prepareUpdateHandoff,
  spawnUpdateFinalizer
} from './orca-fork-update-handoff.mjs'
import {
  readActiveForkRuntime,
  requestGracefulUpdateQuit
} from './orca-fork-update-runtime.mjs'

const projectDir = resolve(import.meta.dirname, '..', '..')
const distribution = JSON.parse(
  readFileSync(join(projectDir, 'resources', 'distribution', 'orca-fork.json'), 'utf8')
)
const appSupportDir = join(homedir(), 'Library', 'Application Support')
const paths = {
  sharedProfile: join(appSupportDir, distribution.userDataDirName),
  installedApp: join(homedir(), 'Applications', `${distribution.productName}.app`),
  legacyForkCli: join(homedir(), '.local', 'bin', 'orca-fork'),
  state: join(appSupportDir, 'Orca Fork Installer')
}

const COMMANDS = new Set(['status', 'sync', 'install', 'update', 'rollback'])
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-rc\.\d+)?$/
const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const BACKUP_SCHEMA = 'orca.local-distribution-backup/v2'
const BACKUP_ROOT_NAME = 'shared-profile-backups'
const TRANSIENT_PROFILE_NAMES = new Set([
  'Cache',
  'Code Cache',
  'DawnCache',
  'GPUCache',
  'ShaderCache',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
  'daemon',
  'logs',
  'orca-runtime.json',
  'shell-ready'
])

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? projectDir,
    env: options.env ?? process.env,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  })
}

function capture(command, args, options = {}) {
  try {
    return String(run(command, args, { ...options, capture: true })).trim()
  } catch {
    return ''
  }
}

function captureCombined(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectDir,
    env: options.env ?? process.env,
    encoding: 'utf8'
  })
  if (result.error || result.status !== 0) {
    return ''
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
}

function timestamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function ensureMac() {
  if (process.platform !== 'darwin') {
    throw new Error('Orca Fork local distribution currently supports macOS only.')
  }
}

function assertCleanCheckout() {
  const status = capture('git', ['status', '--porcelain'], { cwd: projectDir })
  if (status) {
    throw new Error('The source checkout is dirty. Commit or stash changes before syncing.')
  }
  const branch = capture('git', ['branch', '--show-current'], { cwd: projectDir })
  if (!branch || branch === 'main' || branch === 'master') {
    throw new Error('Sync requires a named fork branch, never main/master.')
  }
}

function cloneDirectory(source, target) {
  if (!existsSync(source)) {
    return false
  }
  if (existsSync(target)) {
    throw new Error(`Clone target already exists: ${target}`)
  }
  execFileSync('mkdir', ['-p', dirname(target)])
  try {
    // Why: APFS clone copies make the multi-gigabyte profile snapshot fast and
    // space-efficient while retaining a complete rollback image.
    execFileSync('cp', ['-cR', source, target], { stdio: 'inherit' })
  } catch {
    execFileSync('ditto', [source, target], { stdio: 'inherit' })
  }
  return true
}

function cleanTransientProfileState(profileRoot) {
  if (!existsSync(profileRoot) || lstatSync(profileRoot).isSymbolicLink()) {
    throw new Error(`Refusing to clean an invalid profile root: ${profileRoot}`)
  }
  for (const name of readdirSync(profileRoot)) {
    if (
      TRANSIENT_PROFILE_NAMES.has(name) ||
      /^o-\d+-.+\.sock$/u.test(name) ||
      name.endsWith('.sock')
    ) {
      rmSync(join(profileRoot, name), { recursive: true, force: true })
    }
  }
}

function readPackageVersion() {
  return JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')).version
}

function currentCommit() {
  return capture('git', ['rev-parse', 'HEAD'], { cwd: projectDir })
}

function resolveNode24Bin() {
  const currentMajor = Number(process.versions.node.split('.')[0])
  if (currentMajor === 24) {
    return dirname(process.execPath)
  }
  const nvmVersions = join(homedir(), '.nvm', 'versions', 'node')
  const candidates = [
    ...(existsSync(nvmVersions)
      ? readdirSync(nvmVersions)
          .filter((name) => name.startsWith('v24.'))
          .sort()
          .toReversed()
          .map((name) => join(nvmVersions, name, 'bin'))
      : []),
    '/opt/homebrew/opt/node@24/bin',
    '/usr/local/opt/node@24/bin'
  ]
  return candidates.find((candidate) => existsSync(join(candidate, 'node'))) ?? null
}

function resolveMacSdkRoot() {
  if (process.env.ORCA_FORK_SDKROOT) {
    return process.env.ORCA_FORK_SDKROOT
  }
  const sdkRoot = capture('xcrun', ['--sdk', 'macosx', '--show-sdk-path'])
  if (!sdkRoot || !existsSync(sdkRoot)) {
    throw new Error('A usable macOS SDK is required to build Orca Fork.')
  }
  return sdkRoot
}

function createPairSnapshot(reason) {
  const appPresent = existsSync(paths.installedApp)
  const profilePresent = existsSync(paths.sharedProfile)
  if (!appPresent && !profilePresent) {
    return null
  }
  const snapshotDir = join(paths.state, BACKUP_ROOT_NAME, timestamp())
  execFileSync('mkdir', ['-p', snapshotDir])
  if (appPresent) {
    cloneDirectory(paths.installedApp, join(snapshotDir, `${distribution.productName}.app`))
  }
  if (profilePresent) {
    cloneDirectory(paths.sharedProfile, join(snapshotDir, distribution.userDataDirName))
  }
  const manifest = {
    schema: BACKUP_SCHEMA,
    createdAt: new Date().toISOString(),
    reason,
    commit: currentCommit(),
    version: readPackageVersion(),
    appPresent,
    profilePresent
  }
  writeFileSync(join(snapshotDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return snapshotDir
}

/**
 * Lists abandoned transactional app directories from interrupted installs.
 *
 * @returns {string[]} Absolute paths safe to remove while both apps are stopped.
 */
function findStaleInstallArtifacts() {
  const appDirectory = dirname(paths.installedApp)
  if (!existsSync(appDirectory)) {
    return []
  }
  const appName = basename(paths.installedApp)
  const prefixes = [`${appName}.staging-`, `${appName}.previous-`]
  return readdirSync(appDirectory)
    .filter((name) => prefixes.some((prefix) => name.startsWith(prefix)))
    .map((name) => join(appDirectory, name))
}

/**
 * Removes abandoned app swaps only after the shared runtime is stopped.
 */
function cleanStaleInstallArtifacts() {
  for (const artifact of findStaleInstallArtifacts()) {
    rmSync(artifact, { recursive: true, force: true })
  }
}

/**
 * Removes the launcher created by the retired isolated-Fork distribution.
 */
function cleanManagedLegacyForkCli() {
  let stats
  try {
    stats = lstatSync(paths.legacyForkCli)
  } catch {
    return
  }
  if (!stats.isSymbolicLink()) {
    console.warn(`Leaving unmanaged legacy command untouched: ${paths.legacyForkCli}`)
    return
  }
  const target = resolve(dirname(paths.legacyForkCli), readlinkSync(paths.legacyForkCli))
  const expected = join(paths.installedApp, 'Contents', 'Resources', 'bin', 'orca-fork')
  if (target !== expected) {
    console.warn(`Leaving unrelated legacy symlink untouched: ${paths.legacyForkCli} -> ${target}`)
    return
  }
  rmSync(paths.legacyForkCli, { force: true })
}

function findBuiltApp(directory = join(projectDir, 'dist'), depth = 0) {
  if (!existsSync(directory) || depth > 3) {
    return null
  }
  for (const name of readdirSync(directory)) {
    const candidate = join(directory, name)
    const stats = lstatSync(candidate)
    if (stats.isDirectory() && name === `${distribution.executableName}.app`) {
      return candidate
    }
    if (stats.isDirectory() && !name.endsWith('.app')) {
      const nested = findBuiltApp(candidate, depth + 1)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

function validateBundle(appPath) {
  const plist = join(appPath, 'Contents', 'Info.plist')
  const resources = join(appPath, 'Contents', 'Resources')
  const bundleId = capture('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist])
  const executable = capture('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist])
  if (bundleId !== distribution.appId) {
    throw new Error(`Unexpected bundle id: ${bundleId || '<missing>'}`)
  }
  if (executable !== distribution.executableName) {
    throw new Error(`Unexpected executable: ${executable || '<missing>'}`)
  }
  for (const required of [
    join(resources, 'orca-fork-distribution.json'),
    join(resources, 'bin', 'orca')
  ]) {
    if (!existsSync(required)) {
      throw new Error(`Missing fork bundle resource: ${required}`)
    }
  }
  run('codesign', ['--verify', '--deep', '--strict', appPath])
}

function buildBundle() {
  const node24Bin = resolveNode24Bin()
  if (!node24Bin) {
    throw new Error(
      'Node 24 is required to build Orca Fork, but no local Node 24 install was found.'
    )
  }
  const sdkRoot = resolveMacSdkRoot()
  const buildEnv = {
    ...process.env,
    PATH: `${node24Bin}:${process.env.PATH ?? ''}`,
    // Why: stale Command Line Tools can expose an SDK newer than their clang;
    // ask Xcode for one coherent toolchain so node-gyp does not mix the two.
    SDKROOT: sdkRoot,
    CC: process.env.CC ?? '/usr/bin/clang',
    CXX: process.env.CXX ?? '/usr/bin/clang++',
    ORCA_LOCAL_FORK_BUILD: '1',
    ...(process.env.ORCA_FORK_SIGN_IDENTITY
      ? { CSC_NAME: process.env.ORCA_FORK_SIGN_IDENTITY }
      : {})
  }
  run('pnpm', ['run', 'build:desktop'], { env: buildEnv })
  run('pnpm', ['run', 'build:computer-macos'], { env: buildEnv })
  run('pnpm', ['run', 'build:notification-status-macos'], { env: buildEnv })
  run('pnpm', ['run', 'ensure:electron-runtime'], { env: buildEnv })
  const archFlag = process.arch === 'arm64' ? '--arm64' : '--x64'
  run(
    'pnpm',
    [
      'exec',
      'electron-builder',
      '--config',
      'config/electron-builder.config.cjs',
      '--mac',
      '--dir',
      archFlag
    ],
    { env: buildEnv }
  )
  const builtApp = findBuiltApp()
  if (!builtApp) {
    throw new Error(`Could not find ${distribution.executableName}.app under dist/.`)
  }
  validateBundle(builtApp)
  return builtApp
}

function installBuiltBundle(builtApp, options = {}) {
  if (options.preserveDetachedDaemon) {
    assertAppBundleStopped({ appBundleName: 'Orca', capture })
    assertForkDesktopStopped({ appBundleName: distribution.productName, capture })
    const staleArtifacts = findStaleInstallArtifacts()
    if (staleArtifacts.length > 0) {
      throw new Error(
        `Pending app transaction requires stopped recovery: ${staleArtifacts.join(', ')}`
      )
    }
  } else {
    assertAllOrcaAppsStopped({ forkBundleName: distribution.productName, capture })
    cleanStaleInstallArtifacts()
  }
  createPairSnapshot('pre-install')
  execFileSync('mkdir', ['-p', dirname(paths.installedApp), paths.state])
  const stagingApp = `${paths.installedApp}.staging-${process.pid}`
  const previousApp = `${paths.installedApp}.previous-${process.pid}`
  rmSync(stagingApp, { recursive: true, force: true })
  cloneDirectory(builtApp, stagingApp)
  validateBundle(stagingApp)
  const transactionPath = join(paths.state, 'transaction.json')
  writeFileSync(
    transactionPath,
    `${JSON.stringify(
      {
        schema: 'orca.local-distribution-transaction/v1',
        startedAt: new Date().toISOString(),
        stagingApp,
        previousApp,
        targetApp: paths.installedApp
      },
      null,
      2
    )}\n`
  )
  try {
    if (existsSync(paths.installedApp)) {
      renameSync(paths.installedApp, previousApp)
    }
    renameSync(stagingApp, paths.installedApp)
    cleanManagedLegacyForkCli()
    rmSync(previousApp, { recursive: true, force: true })
    rmSync(transactionPath, { force: true })
  } catch (error) {
    if (!existsSync(paths.installedApp) && existsSync(previousApp)) {
      renameSync(previousApp, paths.installedApp)
    }
    throw error
  }
}

function latestBackup() {
  const backupRoot = join(paths.state, BACKUP_ROOT_NAME)
  if (!existsSync(backupRoot)) {
    return null
  }
  return (
    readdirSync(backupRoot)
      .sort()
      .toReversed()
      .map((name) => join(backupRoot, name))
      .find((candidate) => existsSync(join(candidate, 'manifest.json'))) ?? null
  )
}

function replaceFromSnapshot(source, target, present, label) {
  const staging = `${target}.rollback-staging-${process.pid}`
  const displaced = `${target}.rollback-displaced-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  if (present) {
    cloneDirectory(source, staging)
    if (label === 'profile') {
      cleanTransientProfileState(staging)
    } else {
      validateBundle(staging)
    }
  }
  if (existsSync(target)) {
    renameSync(target, displaced)
  }
  try {
    if (present) {
      renameSync(staging, target)
    }
    rmSync(displaced, { recursive: true, force: true })
  } catch (error) {
    if (!existsSync(target) && existsSync(displaced)) {
      renameSync(displaced, target)
    }
    throw error
  }
}

function rollback() {
  assertAllOrcaAppsStopped({ forkBundleName: distribution.productName, capture })
  cleanStaleInstallArtifacts()
  const backup = latestBackup()
  if (!backup) {
    throw new Error('No Orca Fork backup is available.')
  }
  const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8'))
  if (manifest.schema !== BACKUP_SCHEMA) {
    throw new Error(`Unsupported backup schema: ${manifest.schema ?? '<missing>'}`)
  }
  createPairSnapshot('pre-rollback')
  replaceFromSnapshot(
    join(backup, `${distribution.productName}.app`),
    paths.installedApp,
    manifest.appPresent,
    'app'
  )
  replaceFromSnapshot(
    join(backup, distribution.userDataDirName),
    paths.sharedProfile,
    manifest.profilePresent,
    'profile'
  )
  cleanManagedLegacyForkCli()
}

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

export function buildDryRunPlan(command, from, base) {
  switch (command) {
    case 'status':
      return [
        'Inspect source, installed app, shared profile, legacy CLI, signing, and pending transaction.'
      ]
    case 'sync':
      if (!from || !base) {
        throw new Error('sync requires --from <current-base> --base <release-tag>.')
      }
      return [
        `Fetch official release tag ${base}.`,
        `Verify ${base} contains current upstream base ${from}.`,
        'Replay only the Fork patch queue onto the release tag; abort automatically on conflict.'
      ]
    case 'install':
      return [
        'Require official Orca, Orca Fork, and their bundle helpers to be stopped.',
        'Locate the existing Orca Fork build under dist/.',
        'Validate bundle id, executable, resources, and code signature.',
        'Snapshot the currently installed app and shared Orca profile as one rollback pair.',
        `Atomically install ${paths.installedApp} without changing the global orca command.`,
        'Remove abandoned staging apps and the retired managed orca-fork symlink.',
        'Do not launch the app.'
      ]
    case 'update':
      return [
        'Keep the running Orca Fork available while the replacement bundle builds and stages.',
        'Build the current checkout with the Orca Fork identity.',
        'Validate bundle id, executable, resources, and code signature.',
        'Ask the local runtime to quit normally so daemon-backed agents stay alive.',
        'Let a detached finalizer snapshot and replace the app after desktop exit.',
        'Bootstrap older Fork builds after a manual normal quit while allowing only the daemon.',
        `Atomically install ${paths.installedApp} without changing the global orca command.`,
        'Relaunch in the background; remove the previous app after the new runtime is ready.',
        'Never send TERM or KILL as an update fallback.'
      ]
    case 'rollback':
      return [
        'Require official Orca, Orca Fork, and their bundle helpers to be stopped.',
        'Snapshot the current app/shared-profile pair.',
        'Restore the newest v2 app/shared-profile pair and clear transient runtime state.'
      ]
  }
}

function printStatus() {
  const branch = capture('git', ['branch', '--show-current'], { cwd: projectDir })
  const commit = currentCommit()
  const upstreamDelta = capture('git', [
    'rev-list',
    '--left-right',
    '--count',
    'upstream/main...HEAD'
  ])
  const signature = existsSync(paths.installedApp)
    ? captureCombined('codesign', ['-dv', '--verbose=2', paths.installedApp])
    : ''
  const transaction = join(paths.state, 'transaction.json')
  console.log(`source: ${projectDir}`)
  console.log(`branch: ${branch || '<detached>'}`)
  console.log(`commit: ${commit || '<unknown>'}`)
  console.log(`build node: ${resolveNode24Bin() ?? '<Node 24 not found>'}`)
  console.log(`macOS SDK: ${resolveMacSdkRoot()}`)
  console.log(`upstream/main...HEAD: ${upstreamDelta || '<not fetched>'}`)
  console.log(`app: ${existsSync(paths.installedApp) ? paths.installedApp : '<not installed>'}`)
  console.log(
    `shared profile: ${existsSync(paths.sharedProfile) ? paths.sharedProfile : '<missing>'}`
  )
  console.log(`legacy fork CLI: ${existsSync(paths.legacyForkCli) ? paths.legacyForkCli : 'none'}`)
  console.log(`stale app transactions: ${findStaleInstallArtifacts().join(', ') || 'none'}`)
  console.log(`pending transaction: ${existsSync(transaction) ? transaction : 'none'}`)
  console.log(`signature: ${signature || '<none; local ad-hoc builds may require TCC again>'}`)
}

export async function main(argv = process.argv.slice(2)) {
  ensureMac()
  if (argv[0] === '__complete-update') {
    const transactionIndex = argv.indexOf('--transaction')
    const transactionPath = transactionIndex >= 0 ? argv[transactionIndex + 1] : null
    if (!transactionPath) {
      throw new Error('Missing --transaction for update finalizer.')
    }
    await completeUpdateHandoff({
      transactionPath,
      appBundleName: distribution.productName,
      sharedProfile: paths.sharedProfile,
      capture,
      createPairSnapshot,
      validateBundle,
      cleanManagedLegacyForkCli,
      launchApp: (appPath) => run('open', ['-g', appPath])
    })
    return
  }
  const { command, apply, from, base } = parseCommand(argv)
  if (command === 'status') {
    printStatus()
    return
  }
  if (!apply) {
    console.log(`[dry-run] ${command}`)
    for (const step of buildDryRunPlan(command, from, base)) {
      console.log(`- ${step}`)
    }
    console.log('Re-run with --apply to execute.')
    return
  }

  if (command === 'sync') {
    assertCleanCheckout()
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
    return
  }
  if (command === 'install') {
    const builtApp = findBuiltApp()
    if (!builtApp) {
      throw new Error(`Could not find ${distribution.executableName}.app under dist/.`)
    }
    installBuiltBundle(builtApp)
    console.log(`Installed ${paths.installedApp}`)
    console.log(`Launch when ready: open "${paths.installedApp}"`)
    return
  }
  if (command === 'update') {
    const builtApp = buildBundle()
    assertAppBundleStopped({ appBundleName: 'Orca', capture })
    const runtime = readActiveForkRuntime({
      sharedProfile: paths.sharedProfile,
      appBundleName: distribution.productName,
      capture
    })
    if (!runtime) {
      installBuiltBundle(builtApp, { preserveDetachedDaemon: true })
      run('open', ['-g', paths.installedApp])
      console.log(`Installed and relaunched ${paths.installedApp}`)
      return
    }

    execFileSync('mkdir', ['-p', dirname(paths.installedApp), paths.state])
    const transaction = prepareUpdateHandoff({
      builtApp,
      installedApp: paths.installedApp,
      stateDirectory: paths.state,
      runtime,
      cloneDirectory,
      validateBundle
    })
    try {
      await requestGracefulUpdateQuit(runtime)
      const finalizerPid = spawnUpdateFinalizer({
        transaction,
        scriptPath: resolve(process.argv[1])
      })
      console.log(`Handoff accepted; finalizer ${finalizerPid}; log ${transaction.logPath}`)
    } catch (error) {
      abortPreparedUpdate(transaction)
      throw error
    }
    return
  }
  rollback()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[orca-fork] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
