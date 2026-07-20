import { existsSync, readFileSync } from 'node:fs'
import { createConnection } from 'node:net'

/**
 * Reads a live local Fork runtime from the shared profile.
 *
 * @param {{ sharedProfile: string, appBundleName: string, capture: Function }} options
 * Runtime discovery inputs.
 * @returns {{ pid: number, runtimeId: string, authToken: string, endpoint: string } | null}
 * The active Fork runtime, or null when metadata is stale or belongs elsewhere.
 */
export function readActiveForkRuntime({ sharedProfile, appBundleName, capture }) {
  const metadataPath = `${sharedProfile}/orca-runtime.json`
  if (!existsSync(metadataPath)) {
    return null
  }
  let metadata
  try {
    metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  } catch {
    return null
  }
  const transport = metadata.transports?.find?.((candidate) => candidate.kind === 'unix')
  if (
    !Number.isInteger(metadata.pid) ||
    typeof metadata.runtimeId !== 'string' ||
    typeof metadata.authToken !== 'string' ||
    typeof transport?.endpoint !== 'string'
  ) {
    return null
  }
  const command = capture('ps', ['-p', String(metadata.pid), '-o', 'command='])
  if (!command.includes(`/${appBundleName}.app/Contents/`)) {
    return null
  }
  return {
    pid: metadata.pid,
    runtimeId: metadata.runtimeId,
    authToken: metadata.authToken,
    endpoint: transport.endpoint
  }
}

/**
 * Asks the local Unix-socket runtime to enter Electron's normal quit pipeline.
 *
 * @param {{ endpoint: string, authToken: string }} runtime Active runtime.
 * @returns {Promise<void>} Resolves after the runtime acknowledges the request.
 */
export function requestGracefulUpdateQuit(runtime) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(runtime.endpoint)
    let buffer = ''
    let settled = false
    const finish = (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      socket.destroy()
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const timeout = setTimeout(
      () => finish(new Error('Timed out waiting for Orca Fork to accept graceful update quit.')),
      10_000
    )
    socket.setEncoding('utf8')
    socket.once('error', (error) => finish(error))
    socket.on('data', (chunk) => {
      buffer += chunk
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex === -1) {
        return
      }
      let response
      try {
        response = JSON.parse(buffer.slice(0, newlineIndex))
      } catch {
        finish(new Error('Orca Fork returned an invalid update handoff response.'))
        return
      }
      if (!response.ok || response.result?.accepted !== true) {
        const message = response.error?.message ?? 'update handoff was rejected'
        if (response.error?.code === 'method_not_found') {
          finish(
            new Error(
              'Installed Orca Fork predates graceful handoff. Quit it normally, then rerun update --apply; the detached daemon may remain running.'
            )
          )
          return
        }
        finish(new Error(`Orca Fork did not accept graceful update quit: ${message}`))
        return
      }
      finish()
    })
    socket.once('connect', () => {
      socket.write(
        `${JSON.stringify({
          id: `local-fork-update-${process.pid}`,
          authToken: runtime.authToken,
          method: 'localFork.requestUpdateQuit'
        })}\n`
      )
    })
  })
}
