import { rmSync } from 'node:fs'
import type { PendingNativeRequest } from './macos-native-provider-contract'

/**
 * Releases the current socket listeners and clears their owner reference.
 *
 * @param cleanup Active listener disposer.
 * @returns Null for direct assignment to the owner field.
 */
export function releaseNativeSocketListeners(cleanup: (() => void) | null): null {
  cleanup?.()
  return null
}

/**
 * Rejects and removes every request owned by a failed or closing transport.
 *
 * @param pending Active native requests.
 * @param error Shared shutdown or transport error.
 * @returns Nothing.
 */
export function rejectPendingNativeRequests(
  pending: Map<number, PendingNativeRequest>,
  error: Error
): void {
  for (const [id, request] of pending) {
    clearTimeout(request.timer)
    request.reject(error)
    pending.delete(id)
  }
}

/**
 * Removes the provider socket directory and clears both owner path fields.
 *
 * @param directory Active provider socket directory.
 * @returns Null values for socket directory and socket path.
 */
export function removeNativeSocketDirectory(directory: string | null): [null, null] {
  if (directory) {
    rmSync(directory, { recursive: true, force: true })
  }
  return [null, null]
}
