import { spawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { readActiveForkRuntime } from './orca-fork-update-runtime.mjs'

const TRANSACTION_SCHEMA = 'orca.local-fork-update-handoff/v1'
const MAIN_EXIT_TIMEOUT_MS = 90_000
const DESKTOP_EXIT_TIMEOUT_MS = 30_000
const RELAUNCH_TIMEOUT_MS = 90_000
const POLL_INTERVAL_MS = 250

/**
 * Identifies the detached terminal daemon that must survive an app replacement.
 *
 * @param {string} processLine A `ps` pid/command line.
 * @returns {boolean} Whether the line belongs to the daemon entry process.
 */
export function isDetachedDaemonProcess(processLine) {
  return processLine.includes('daemon-entry.js') && processLine.includes('--socket')
}

/**
 * Returns app-bundle processes that prevent a daemon-preserving swap.
 *
 * @param {string[]} processLines Matching bundle process lines.
 * @returns {string[]} Desktop and non-daemon helper processes.
 */
export function blockingForkDesktopProcesses(processLines) {
  return processLines.filter((line) => !isDetachedDaemonProcess(line))
}

/**
 * Rejects an operation while any process from one app bundle is alive.
 *
 * @param {{ appBundleName: string, capture: Function }} options Process inputs.
 * @returns {void}
 */
export function assertAppBundleStopped({ appBundleName, capture }) {
  if (bundleProcessLines(appBundleName, capture).length > 0) {
    throw new Error(`${appBundleName} is running. Quit it before this operation.`)
  }
}

/**
 * Requires both official Orca and Orca Fork to be fully stopped.
 *
 * @param {{ forkBundleName: string, capture: Function }} options Process inputs.
 * @returns {void}
 */
export function assertAllOrcaAppsStopped({ forkBundleName, capture }) {
  assertAppBundleStopped({ appBundleName: 'Orca', capture })
  assertAppBundleStopped({ appBundleName: forkBundleName, capture })
}

/**
 * Rejects a bootstrap swap until every non-daemon bundle process exits.
 *
 * @param {{ appBundleName: string, capture: Function }} options Process inputs.
 * @returns {void}
 */
export function assertForkDesktopStopped({ appBundleName, capture }) {
  const blocking = blockingForkDesktopProcesses(bundleProcessLines(appBundleName, capture))
  if (blocking.length > 0) {
    throw new Error(`${appBundleName} is still exiting. Wait, then retry the update.`)
  }
}

/**
 * Stages a validated bundle and records the old runtime identity before quit.
 *
 * @param {object} options Handoff paths and filesystem callbacks.
 * @returns {object} Persisted transaction.
 */
export function prepareUpdateHandoff({
  builtApp,
  installedApp,
  stateDirectory,
  runtime,
  cloneDirectory,
  validateBundle
}) {
  const transactionPath = `${stateDirectory}/transaction.json`
  if (existsSync(transactionPath)) {
    throw new Error(`A pending Orca Fork update already exists: ${transactionPath}`)
  }
  const suffix = `${process.pid}-${Date.now()}`
  const stagingApp = `${installedApp}.staging-${suffix}`
  const previousApp = `${installedApp}.previous-${suffix}`
  cloneDirectory(builtApp, stagingApp)
  validateBundle(stagingApp)
  const transaction = {
    schema: TRANSACTION_SCHEMA,
    status: 'prepared',
    startedAt: new Date().toISOString(),
    transactionPath,
    logPath: `${stateDirectory}/update-handoff.log`,
    stagingApp,
    previousApp,
    targetApp: installedApp,
    oldPid: runtime.pid,
    oldRuntimeId: runtime.runtimeId
  }
  writeTransaction(transaction)
  return transaction
}

/**
 * Removes staging when the old runtime rejects the graceful quit request.
 *
 * @param {object} transaction Prepared transaction.
 * @returns {void}
 */
export function abortPreparedUpdate(transaction) {
  rmSync(transaction.stagingApp, { recursive: true, force: true })
  rmSync(transaction.transactionPath, { force: true })
}

/**
 * Starts the post-quit installer outside the Orca app lifecycle.
 *
 * @param {{ transaction: object, scriptPath: string }} options Spawn inputs.
 * @returns {number} Detached finalizer pid.
 */
export function spawnUpdateFinalizer({ transaction, scriptPath }) {
  const logFd = openSync(transaction.logPath, 'a')
  try {
    const child = spawn(
      process.execPath,
      [scriptPath, '__complete-update', '--transaction', transaction.transactionPath],
      {
        detached: true,
        stdio: ['ignore', logFd, logFd]
      }
    )
    if (!child.pid) {
      throw new Error('Could not start the detached Orca Fork update finalizer.')
    }
    child.unref()
    return child.pid
  } finally {
    closeSync(logFd)
  }
}

/**
 * Completes the swap after the old main process has disconnected its daemon.
 *
 * @param {object} options Transaction path and installer callbacks.
 * @returns {Promise<void>} Resolves after the replacement runtime is ready.
 */
export async function completeUpdateHandoff({
  transactionPath,
  appBundleName,
  sharedProfile,
  capture,
  createPairSnapshot,
  validateBundle,
  cleanManagedLegacyForkCli,
  launchApp
}) {
  const transaction = readTransaction(transactionPath)
  await waitUntil(
    () => !isPidAlive(transaction.oldPid),
    MAIN_EXIT_TIMEOUT_MS,
    'Orca Fork did not exit normally; update aborted without sending a signal.'
  )
  await waitUntil(
    () =>
      bundleProcessLines(appBundleName, capture).every((line) => isDetachedDaemonProcess(line)),
    DESKTOP_EXIT_TIMEOUT_MS,
    'Orca Fork desktop helpers did not exit; update aborted without sending a signal.'
  )

  transaction.status = 'swapping'
  writeTransaction(transaction)
  createPairSnapshot('pre-daemon-safe-update')
  if (existsSync(transaction.targetApp)) {
    renameSync(transaction.targetApp, transaction.previousApp)
  }
  try {
    renameSync(transaction.stagingApp, transaction.targetApp)
    validateBundle(transaction.targetApp)
  } catch (error) {
    if (!existsSync(transaction.targetApp) && existsSync(transaction.previousApp)) {
      renameSync(transaction.previousApp, transaction.targetApp)
    }
    throw error
  }

  transaction.status = 'relaunching'
  writeTransaction(transaction)
  cleanManagedLegacyForkCli()
  launchApp(transaction.targetApp)
  await waitUntil(
    () => {
      const runtime = readActiveForkRuntime({ sharedProfile, appBundleName, capture })
      return runtime !== null && runtime.runtimeId !== transaction.oldRuntimeId
    },
    RELAUNCH_TIMEOUT_MS,
    'Replacement runtime did not become ready; previous app and transaction retained.'
  )

  rmSync(transaction.previousApp, { recursive: true, force: true })
  rmSync(transactionPath, { force: true })
}

/**
 * Reads and validates one update transaction.
 *
 * @param {string} transactionPath Transaction manifest path.
 * @returns {object} Valid transaction data.
 */
function readTransaction(transactionPath) {
  const transaction = JSON.parse(readFileSync(transactionPath, 'utf8'))
  if (
    transaction.schema !== TRANSACTION_SCHEMA ||
    transaction.transactionPath !== transactionPath ||
    !Number.isInteger(transaction.oldPid)
  ) {
    throw new Error(`Invalid Orca Fork update transaction: ${transactionPath}`)
  }
  return transaction
}

/**
 * Persists the current transaction state.
 *
 * @param {object} transaction Transaction data.
 * @returns {void}
 */
function writeTransaction(transaction) {
  writeFileSync(transaction.transactionPath, `${JSON.stringify(transaction, null, 2)}\n`)
}

/**
 * Lists processes still executing from the named app bundle.
 *
 * @param {string} appBundleName Bundle display name.
 * @param {Function} capture Command capture callback.
 * @returns {string[]} Matching pid/command lines.
 */
function bundleProcessLines(appBundleName, capture) {
  const needle = `/${appBundleName}.app/Contents/`
  return capture('ps', ['-axo', 'pid=,command='])
    .split('\n')
    .filter((line) => line.includes(needle))
}

/**
 * Probes whether a process id is still alive.
 *
 * @param {number} pid Process id.
 * @returns {boolean} Whether the process exists.
 */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Polls a condition without escalating to process termination.
 *
 * @param {() => boolean} condition Completion predicate.
 * @param {number} timeoutMs Maximum wait.
 * @param {string} timeoutMessage Failure message.
 * @returns {Promise<void>} Resolves once the condition succeeds.
 */
async function waitUntil(condition, timeoutMs, timeoutMessage) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(timeoutMessage)
}
