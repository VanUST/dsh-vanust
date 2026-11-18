/**
 * PURPOSE
 *   An OpenAI-compatible provider for the harness llm service. The harness ships DeepSeek and
 *   Kimi routes; an owner with an OpenAI/Codex key has no route to put it on. This plugin
 *   registers one:
 *     - `ctx.llm.registerAdapter([provider], adapter)` — the wire adapter (streaming text and
 *       tool calls over `/v1/chat/completions`, `/v1/models` discovery, key from credentials);
 *     - `ctx.llm.registerConfigurableProviders([entry])` — the Settings -> Models directory
 *       entry, so the route can be configured (base URL, key reference, model list) without a
 *       code change.
 *
 * KEY HANDLING
 *   The key is read from `ctx.credentials.resolve(ref)` first (the harness store), and only a
 *   deployment without that service falls back to the launch environment. The key is never
 *   logged, written to a file or put in the request URL.
 *
 * WHAT THIS ADAPTER DOES NOT DO
 *   It does not translate the Responses API, images or reasoning-effort control beyond passing
 *   `reasoning_effort` for models that accept it; a request with images is refused by name
 *   (`IMAGES_UNSUPPORTED`) rather than silently dropping the image.
 */

import { LlmAdapter, LlmError, attributionHeaders } from '@deepseek-ai/dsh-llm'

export const name = '@cc/dsh-openai-codex'
export const inject = ['llm']

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_KEY_REF = 'OPENAI_API_KEY'
const DEFAULT_MODELS = ['gpt-5', 'gpt-5-codex']
const DEFAULT_TIMEOUT_MS = 120_000

const textOf = (content) => (Array.isArray(content) ? content : [])
  .filter((block) => block !== null && typeof block === 'object' && block.type === 'text')
  .map((block) => String(block.text ?? ''))
  .join('')

const toolCallsOf = (content) => (Array.isArray(content) ? content : [])
  .filter((block) => block !== null && typeof block === 'object' && block.type === 'tool-call')
  .map((block) => ({ id: String(block.id ?? ''), name: String(block.name ?? ''), arguments: String(block.arguments ?? '') }))

/** The request body one harness request becomes on the OpenAI wire. */
export function toChatRequest(options) {
  const messages = []
  if (typeof options.system === 'string' && options.system.trim() !== '') messages.push({ role: 'system', content: options.system })
  for (const message of Array.isArray(options.messages) ? options.messages : []) {
    const role = message?.role
    if (role === 'system' || role === 'developer') {
      const text = textOf(message.content)
      if (text !== '') messages.push({ role: 'system', content: text })
    } else if (role === 'assistant') {
      const entry = { role: 'assistant', content: textOf(message.content) }
      const calls = toolCallsOf(message.content)
      if (calls.length > 0) entry.tool_calls = calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }))
      messages.push(entry)
    } else if (role === 'tool') {
      messages.push({ role: 'tool', tool_call_id: String(message.toolCallId ?? ''), content: textOf(message.content) })
    } else {
      messages.push({ role: 'user', content: textOf(message.content) })
    }
  }
  const body = { model: options.model, messages, stream: true, stream_options: { include_usage: true } }
  if (Array.isArray(options.tools) && options.tools.length > 0) {
    body.tools = options.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description ?? '', parameters: tool.parameters ?? { type: 'object', properties: {} } } }))
    body.tool_choice = 'auto'
  }
  if (Number.isFinite(options.maxTokens)) body.max_completion_tokens = options.maxTokens
  if (Number.isFinite(options.temperature)) body.temperature = options.temperature
  if (Array.isArray(options.stop) && options.stop.length > 0) body.stop = options.stop
  if (typeof options.reasoningEffort === 'string' && options.reasoningEffort !== '') body.reasoning_effort = options.reasoningEffort
  return body
}

/** Map one SSE `data:` JSON object to harness chunks (text, tool call deltas, finish, usage). */
export function* chunksOf(event) {
  if (event === null || typeof event !== 'object') return
  const choice = Array.isArray(event.choices) ? event.choices[0] : undefined
  if (choice !== undefined) {
    const delta = choice.delta ?? {}
    if (typeof delta.content === 'string' && delta.content !== '') yield { type: 'text-delta', index: 0, text: delta.content }
    let callIndex = 1
    for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const id = String(call.id ?? '')
      if (id !== '') {
        yield { type: 'block-start', index: callIndex, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: callIndex, id, name: String(call.function?.name ?? ''), argumentsDelta: String(call.function?.arguments ?? '') }
      } else {
        yield { type: 'tool-call-delta', index: callIndex, id: '', argumentsDelta: String(call.function?.arguments ?? '') }
      }
      callIndex += 1
    }
    if (typeof choice.finish_reason === 'string') {
      const kind = choice.finish_reason === 'tool_calls' ? 'tool-calls' : choice.finish_reason === 'length' ? 'max-tokens' : 'stop'
      yield { type: 'finish', reason: { kind } }
    }
  }
  if (event.usage !== null && typeof event.usage === 'object') {
    const prompt = Number(event.usage.prompt_tokens ?? 0)
    const cached = Number(event.usage.prompt_tokens_details?.cached_tokens ?? 0)
    yield {
      type: 'usage',
      usage: {
        inputTokens: Math.max(0, prompt - cached),
        outputTokens: Number(event.usage.completion_tokens ?? 0),
        ...(Number.isFinite(event.usage.total_tokens) ? { totalTokens: event.usage.total_tokens } : {}),
        ...(cached > 0 ? { cacheReadTokens: cached } : {}),
      },
    }
  }
}

class OpenAiAdapter extends LlmAdapter {
  constructor(options) {
    super()
    this.options = options
  }

  providerInfo(provider) {
    return { id: provider, name: 'OpenAI / Codex' }
  }

  async listModels(provider) {
    const { baseURL, key, fetchImpl } = await this.options.connection()
    const response = await fetchImpl(`${baseURL}/models`, { headers: { ...attributionHeaders(), authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS) })
    if (!response.ok) throw new LlmError(`OpenAI model listing failed with HTTP ${response.status}`, 'TRANSPORT')
    const body = await response.json()
    const ids = (Array.isArray(body?.data) ? body.data : []).map((entry) => String(entry?.id ?? '')).filter((id) => id !== '')
    return (ids.length > 0 ? ids : this.options.fallbackModels ?? []).map((id) => ({ id, name: id }))
  }

  async resolveModel(provider, model) {
    return { provider, id: model, name: model }
  }

  async prepareCall(provider, model, signal) {
    const connection = await this.options.connection(signal)
    return {
      model: { provider, id: model, name: model },
      stream: (options) => this.streamWithConnection(options, connection),
    }
  }

  stream(options) {
    return this.streamWithConnection(options, null)
  }

  async *streamWithConnection(options, prepared) {
    const connection = prepared ?? await this.options.connection(options.signal)
    if ((Array.isArray(options.messages) ? options.messages : []).some((message) => (Array.isArray(message?.content) ? message.content : []).some((block) => block?.type === 'image'))) {
      throw new LlmError('OpenAI Chat Completions route refuses image content; send text only or use a vision route', 'IMAGES_UNSUPPORTED')
    }
    const body = toChatRequest(options)
    const response = await connection.fetchImpl(`${connection.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { ...attributionHeaders(), 'content-type': 'application/json', authorization: `Bearer ${connection.key}` },
      body: JSON.stringify(body),
      signal: options.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new LlmError(`OpenAI request failed with HTTP ${response.status}: ${text.slice(0, 300)}`, 'TRANSPORT')
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let startedText = false
    let callIndex = 1
    let calls = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') continue
          let event
          try { event = JSON.parse(payload) } catch { continue }
          const choice = Array.isArray(event.choices) ? event.choices[0] : undefined
          if (choice !== undefined && typeof choice.delta?.content === 'string' && choice.delta.content !== '' && !startedText) {
            startedText = true
            yield { type: 'block-start', index: 0, blockType: 'text' }
          }
          const toolDeltas = Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls : []
          for (const call of toolDeltas) {
            if (String(call?.id ?? '') !== '') {
              yield { type: 'block-start', index: callIndex, blockType: 'tool-call' }
              yield { type: 'tool-call-delta', index: callIndex, id: String(call.id), name: String(call.function?.name ?? ''), argumentsDelta: String(call.function?.arguments ?? '') }
              calls += 1
              callIndex += 1
            } else if (toolDeltas.length > 0) {
              yield { type: 'tool-call-delta', index: Math.max(1, callIndex - 1), id: '', argumentsDelta: String(call?.function?.arguments ?? '') }
            }
          }
          if (typeof choice?.delta?.content === 'string' && choice.delta.content !== '') {
            yield { type: 'text-delta', index: 0, text: choice.delta.content }
          }
          for (const chunk of chunksOf({ usage: event.usage })) yield chunk
          if (typeof choice?.finish_reason === 'string') {
            const kind = choice.finish_reason === 'tool_calls' ? 'tool-calls' : choice.finish_reason === 'length' ? 'max-tokens' : 'stop'
            if (startedText) yield { type: 'block-end', index: 0, block: { type: 'text', text: '' } }
            yield { type: 'finish', reason: { kind } }
          }
        }
      }
    } finally {
      try { await reader.cancel() } catch { /* the stream is already gone */ }
    }
  }
}

/** Read the key: the harness credential store first, the launch environment only as a fallback. */
async function resolveKey(ctx, ref) {
  try {
    const credentials = ctx.get?.('credentials')
    if (credentials !== undefined && typeof credentials.resolve === 'function') {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined && typeof hit.value === 'string' && hit.value !== '') return hit.value
      return undefined
    }
  } catch {
    return undefined
  }
  const ambient = typeof process.env[ref] === 'string' ? process.env[ref] : ''
  return ambient === '' ? undefined : ambient
}

/**
 * Register the provider.
 *
 * @param ctx - host context; `ctx.llm` is required, `ctx.credentials` is optional.
 * @param {object} [config] - `provider`, `baseURL`, `keyRef`, `models`, `timeoutMs`, `fetch`.
 */
export function apply(ctx, config = {}) {
  const provider = typeof config.provider === 'string' && config.provider !== '' ? config.provider : 'openai-codex'
  const baseURL = (typeof config.baseURL === 'string' && config.baseURL !== '' ? config.baseURL : DEFAULT_BASE_URL).replace(/\/+$/u, '')
  const keyRef = typeof config.keyRef === 'string' && config.keyRef !== '' ? config.keyRef : DEFAULT_KEY_REF
  const fetchImpl = typeof config.fetch === 'function' ? config.fetch : globalThis.fetch
  const options = {
    connection: async (signal) => {
      if (typeof signal?.throwIfAborted === 'function') signal.throwIfAborted()
      const key = await resolveKey(ctx, keyRef)
      if (key === undefined) throw new LlmError(`no API key for ${provider}: configure ${keyRef} in Settings -> Models or the credentials store`, 'INVALID_CREDENTIAL')
      return { baseURL, key, fetchImpl }
    },
    fallbackModels: Array.isArray(config.models) ? config.models.map(String) : DEFAULT_MODELS,
    timeoutMs: Number.isFinite(config.timeoutMs) ? config.timeoutMs : DEFAULT_TIMEOUT_MS,
  }
  const adapter = new OpenAiAdapter(options)
  const registration = ctx.llm.registerAdapter([provider], adapter)
  ctx.effect?.(() => () => registration?.dispose?.())
  const directory = ctx.llm.registerConfigurableProviders?.([{
    provider,
    displayName: 'OpenAI / Codex',
    settingsNs: 'llm-openai-codex',
    settingsPath: [],
    defaultBaseURL: baseURL,
    nativeAuth: { env: [keyRef], oauth: false },
  }])
  return { provider, adapter, registration, directory }
}

export default { name, inject, apply }
