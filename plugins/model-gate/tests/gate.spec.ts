/** Model-gate behavior at the llm/stream waterfall. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  DEFAULT_ALLOWED_MODEL_PATTERNS,
  FLASH_CLASS_DEFAULT_PATTERN,
  MODEL_NOT_ALLOWED_CODE,
  apply,
} from '../src/index.ts'

/** One empty model stream; the gate vetoes before this is ever consumed. */
async function* emptyStream(): AsyncIterable<StreamChunk> {
  // No chunks: assertions only need the waterfall plumbing, never the adapter.
}

/** Minimal llm/stream payload exercising the gate. */
function request(model: string): { provider: string; model: string; messages: [] } {
  return { provider: 'deepseek-official', model, messages: [] }
}

/** Run one model id through a freshly gated context and return the thrown error, if any. */
function gateOne(model: string, config: Parameters<typeof apply>[1]): { error: unknown; dispatched: boolean } {
  const ctx = new Context()
  apply(ctx, config)
  let dispatched = false
  let error: unknown
  try {
    ctx.waterfall(
      'llm/stream',
      request(model),
      () => {
        dispatched = true
        return emptyStream()
      },
    )
  } catch (caught) {
    error = caught
  }
  return { error, dispatched }
}

describe('model gate', () => {
  it('rejects a non-flash model before the dispatch base runs', () => {
    const { error, dispatched } = gateOne('deepseek-v4-pro', { enabled: true })
    expect(error).toMatchObject({ code: MODEL_NOT_ALLOWED_CODE })
    expect(dispatched).toBe(false)
  })

  it('admits the whole flash class, including ids released after this build', () => {
    for (const model of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v5.1-flash']) {
      const { error, dispatched } = gateOne(model, { enabled: true })
      expect(error).toBeUndefined()
      expect(dispatched).toBe(true)
    }
    expect(FLASH_CLASS_DEFAULT_PATTERN).toBe('^deepseek-(v[0-9.]+-)?flash(-[a-z0-9-]+)*$')
    expect(DEFAULT_ALLOWED_MODEL_PATTERNS).toContain(FLASH_CLASS_DEFAULT_PATTERN)
  })

  it('honours configured patterns alongside exact ids', () => {
    const config = { enabled: true, allowedModels: ['internal-cheap'], allowedModelPatterns: ['^vendor-.*-mini$'] }
    for (const model of ['internal-cheap', 'vendor-x-mini']) {
      expect(gateOne(model, config).error).toBeUndefined()
    }
    expect(gateOne('vendor-x-large', config).error).toMatchObject({ code: MODEL_NOT_ALLOWED_CODE })
  })

  it('passes everything through while disabled', () => {
    const { error, dispatched } = gateOne('deepseek-v4-pro', { enabled: false })
    expect(error).toBeUndefined()
    expect(dispatched).toBe(true)
  })

  it('refuses to enable with no matcher at all', () => {
    const ctx = new Context()
    expect(() => apply(ctx, { enabled: true, allowedModels: [], allowedModelPatterns: [] }))
      .toThrow(/at least one allowed model or pattern/)
  })

  it('rejects an unusable pattern at startup', () => {
    const ctx = new Context()
    expect(() => apply(ctx, { enabled: true, allowedModelPatterns: ['('] }))
      .toThrow(/not a valid regular expression/)
  })
})
