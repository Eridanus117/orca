import { describe, expect, it } from 'vitest'
import { isStatefulRendererReplyCsiQuery } from './terminal-reply-query-extraction'

describe('stateful renderer reply query classification', () => {
  it('recognizes only the kitty keyboard flags query, not replies or key events', () => {
    expect(isStatefulRendererReplyCsiQuery('\x1b[?u')).toBe(true)
    expect(isStatefulRendererReplyCsiQuery('\x1b[?0u')).toBe(false)
    expect(isStatefulRendererReplyCsiQuery('\x1b[13;2u')).toBe(false)
  })
})
