import type { ChildProcess } from 'node:child_process'

type ComputerSidecarGracefulShutdownOptions = {
  child: ChildProcess
  requestShutdown: () => Promise<unknown>
  terminate: () => void
  timeoutMs: number
}

/**
 * Waits for a sidecar acknowledgement and exit, then uses TERM only as timeout fallback.
 *
 * @param options Child lifecycle operations.
 * @returns A promise that settles after graceful exit or bounded fallback.
 */
export async function shutdownComputerSidecarProcess({
  child,
  requestShutdown,
  terminate,
  timeoutMs
}: ComputerSidecarGracefulShutdownOptions): Promise<void> {
  const exitWaiter = waitForExit(child, timeoutMs)
  void exitWaiter.promise.catch(() => undefined)
  try {
    await requestShutdown()
    await exitWaiter.promise
  } catch {
    exitWaiter.cancel()
    terminate()
  }
}

/**
 * Waits for one child exit without leaking the timeout listener.
 *
 * @param child Sidecar child process.
 * @param timeoutMs Maximum exit wait.
 * @returns A promise resolved by exit and rejected by timeout.
 */
function waitForExit(
  child: ChildProcess,
  timeoutMs: number
): { promise: Promise<void>; cancel: () => void } {
  let cancel = () => {}
  const promise = new Promise<void>((resolve, reject) => {
    const onExit = () => {
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(() => {
      child.off('exit', onExit)
      reject(new Error('computer sidecar did not exit after shutdown'))
    }, timeoutMs)
    cancel = () => {
      clearTimeout(timeout)
      child.off('exit', onExit)
    }
    child.once('exit', onExit)
  })
  return { promise, cancel }
}
