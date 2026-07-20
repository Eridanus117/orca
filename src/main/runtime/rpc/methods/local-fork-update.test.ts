import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { LOCAL_FORK_UPDATE_METHODS } from './local-fork-update'

const runtime = {
  getRuntimeId: () => 'runtime-test'
} as OrcaRuntimeService

const request = {
  id: 'request-update-quit',
  authToken: 'test',
  method: 'localFork.requestUpdateQuit'
}

describe('localFork.requestUpdateQuit', () => {
  it('rejects dispatchers without the local lifecycle callback', async () => {
    const dispatcher = new RpcDispatcher({ runtime, methods: LOCAL_FORK_UPDATE_METHODS })

    await expect(dispatcher.dispatch(request)).resolves.toMatchObject({
      ok: false,
      error: { message: 'local_fork_update_unavailable' }
    })
  })

  it('acknowledges the request after the local lifecycle callback accepts it', async () => {
    const requestLocalForkUpdateQuit = vi.fn().mockResolvedValue(undefined)
    const dispatcher = new RpcDispatcher({ runtime, methods: LOCAL_FORK_UPDATE_METHODS })

    await expect(
      dispatcher.dispatch(request, { requestLocalForkUpdateQuit })
    ).resolves.toMatchObject({
      ok: true,
      result: { accepted: true }
    })
    expect(requestLocalForkUpdateQuit).toHaveBeenCalledTimes(1)
  })
})
