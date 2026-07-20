import { defineMethod, type RpcMethod } from '../core'

export const LOCAL_FORK_UPDATE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'localFork.requestUpdateQuit',
    params: null,
    handler: async (_params, { requestLocalForkUpdateQuit }) => {
      if (!requestLocalForkUpdateQuit) {
        throw new Error('local_fork_update_unavailable')
      }
      await requestLocalForkUpdateQuit()
      return { accepted: true }
    }
  })
]
