/*
PROOF: an OpenAI-compatible route for the llm service
Behavior: the plugin registers a provider through ctx.llm.registerAdapter and a configurable
  provider entry, streams text and tool calls from an OpenAI-compatible /chat/completions SSE
  endpoint, lists models from /v1/models, and reads the key from credentials (never from the
  URL). Without a configured key the stream refuses INVALID_CREDENTIAL.
Fails when: no provider is registered, text or tool-call deltas are lost, listModels returns
  nothing, the key leaks into a URL, or a missing key is silently accepted.
Production path: plugins/openai-codex/index.mjs with @deepseek-ai/dsh-llm.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { apply } from '../index.mjs'

const sse = (events) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'

async function fakeOpenAi({ requireAuth = 'Bearer test-key' } = {}) {
  const seen = { urls: [], auth: [], bodies: [] }
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      seen.urls.push(req.url)
      seen.auth.push(req.headers.authorization)
      if (requireAuth !== undefined && req.headers.authorization !== requireAuth) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'bad key' } }))
        return
      }
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'gpt-5' }, { id: 'gpt-5-codex' }, { id: 'o4-mini' }] }))
        return
      }
      if (req.url === '/v1/chat/completions') {
        seen.bodies.push(JSON.parse(body))
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(sse([
          { choices: [{ delta: { role: 'assistant', content: 'Hel' } }] },
          { choices: [{ delta: { content: 'lo' } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read', arguments: '{"path":' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] } }] },
          { choices: [{ finish_reason: 'tool_calls' }] },
          { choices: [], usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19, prompt_tokens_details: { cached_tokens: 2 } } },
        ]))
        return
      }
      res.writeHead(404)
      res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, seen, baseURL: `http://127.0.0.1:${server.address().port}/v1` }
}

function fakeCtx({ key = 'test-key' } = {}) {
  const registered = []
  const directories = []
  const ctx = {
    get: (name) => (name === 'credentials' ? { resolve: async (ref) => (key === null ? undefined : { value: key }) } : undefined),
    effect: (fn) => fn(),
  }
  ctx.llm = {
    registerAdapter: (providers, adapter) => { registered.push({ providers, adapter }); return { dispose() {} } },
    registerConfigurableProviders: (entries) => { directories.push(entries); return { dispose() {} } },
  }
  return { ctx, registered, directories }
}

const toolSchema = { type: 'object', properties: { path: { type: 'string' } } }

const collect = async (iterator) => { const chunks = []; for await (const chunk of iterator) chunks.push(chunk); return chunks }

test('registers a provider and a configurable directory entry', async () => {
  const { ctx, registered, directories } = fakeCtx()
  apply(ctx, {})
  assert.equal(registered.length, 1)
  assert.deepEqual(registered[0].providers, ['openai-codex'])
  assert.equal(directories.length, 1)
  assert.equal(directories[0][0].provider, 'openai-codex')
  assert.equal(directories[0][0].settingsNs, 'llm-openai-codex')
})

test('streams text and tool calls from an OpenAI-compatible endpoint', async () => {
  const fake = await fakeOpenAi()
  try {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { baseURL: fake.baseURL })
    const chunks = await collect(registered[0].adapter.stream({
      provider: 'openai-codex',
      model: 'gpt-5-codex',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'read a.txt' }] }],
      tools: [{ name: 'read', description: 'read', parameters: toolSchema }],
    }))
    const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
    assert.equal(text, 'Hello')
    const callDeltas = chunks.filter((chunk) => chunk.type === 'tool-call-delta')
    assert.equal(callDeltas[0].name, 'read')
    assert.equal(callDeltas[0].id, 'call_1')
    const finish = chunks.find((chunk) => chunk.type === 'finish')
    assert.deepEqual(finish.reason, { kind: 'tool-calls' })
    const usage = chunks.find((chunk) => chunk.type === 'usage')
    assert.equal(usage.usage.inputTokens, 10)
    assert.equal(usage.usage.outputTokens, 7)
    assert.equal(usage.usage.cacheReadTokens, 2)
    // the key travels in the header, never in a URL
    assert.ok(fake.seen.urls.every((url) => !url.includes('test-key')))
    assert.ok(fake.seen.auth.every((auth) => auth === 'Bearer test-key'))
    const body = fake.seen.bodies[0]
    assert.equal(body.model, 'gpt-5-codex')
    assert.equal(body.tools[0].function.name, 'read')
    assert.equal(body.messages[0].content, 'read a.txt')
  } finally {
    fake.server.close()
  }
})

test('lists models from /v1/models and resolves a model identity', async () => {
  const fake = await fakeOpenAi()
  try {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { baseURL: fake.baseURL })
    const models = await registered[0].adapter.listModels('openai-codex')
    assert.deepEqual(models.map((model) => model.id), ['gpt-5', 'gpt-5-codex', 'o4-mini'])
    const resolved = await registered[0].adapter.resolveModel('openai-codex', 'gpt-5')
    assert.equal(resolved.provider, 'openai-codex')
    assert.equal(resolved.id, 'gpt-5')
  } finally {
    fake.server.close()
  }
})

test('a missing key refuses the stream with INVALID_CREDENTIAL and calls no endpoint', async () => {
  const fake = await fakeOpenAi()
  try {
    const { ctx, registered } = fakeCtx({ key: null })
    apply(ctx, { baseURL: fake.baseURL })
    await assert.rejects(
      () => collect(registered[0].adapter.stream({ provider: 'openai-codex', model: 'gpt-5', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })),
      (error) => error.code === 'INVALID_CREDENTIAL',
    )
    assert.equal(fake.seen.urls.length, 0)
  } finally {
    fake.server.close()
  }
})
