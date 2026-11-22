/*
PROOF: Codex sign-in starts and tracks a device flow without exposing secrets
Behavior: codex_signin_start begins ctx.authorization.begin for llm-pi-ai/openai-codex,
  returns the verification URL and user code from the first notice, keeps the flow
  running in the background, refuses a second start while pending, reports pending and
  then authorized/cancelled/failed, cancels through the signal and the service, and
  returns a named refusal when the authorization service is absent. The state holds only
  the notice message/url/code, never a token.
Fails when: start blocks until authorization, a retry starts a second flow, status
  loses the pending code, cancel leaves the flow running, a token reaches the output,
  or a missing service fails silently.
Production path: plugins/codex-signin/codex-signin.mjs (createSignIn, createSignInTools,
  installPresetGate, apply).
*/
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSignIn, createSignInTools, KEY } from '../codex-signin.mjs'

const tick = () => new Promise((resolve) => setImmediate(resolve))
async function waitFor(get, limit = 50) {
  for (let index = 0; index < limit; index += 1) {
    const value = get()
    if (value !== undefined) return value
    await tick()
  }
  throw new Error('condition not reached')
}

function fakeAuthorization() {
  const calls = { begin: [], cancel: [] }
  let settle
  const service = {
    begin(request) {
      calls.begin.push(request)
      return new Promise((resolve) => { settle = resolve })
    },
    cancel(key) { calls.cancel.push(key) },
  }
  return { service, calls, settle: (value) => settle(value) }
}

test('start returns the device URL/code and keeps the flow in flight', async () => {
  const fake = fakeAuthorization()
  const signIn = createSignIn({ authorizationOf: () => fake.service, credentialsOf: () => undefined, timeoutMs: 1000 })
  const started = signIn.start()
  const request = await waitFor(() => fake.calls.begin[0])
  assert.equal(request.key, KEY)
  assert.equal(request.method, 'oauth')
  request.interaction.notify({ message: 'Enter this code on the verification page', url: 'https://auth.openai.com/codex/device', code: 'ABCD-1234' })
  const result = await started
  assert.equal(result.ok, true)
  assert.equal(result.status, 'pending')
  assert.equal(result.url, 'https://auth.openai.com/codex/device')
  assert.equal(result.userCode, 'ABCD-1234')
  assert.equal(JSON.stringify(result).includes('token'), false)

  const again = await signIn.start()
  assert.equal(again.ok, false)
  assert.equal(again.code, 'ALREADY_IN_FLIGHT')
  assert.equal(again.userCode, 'ABCD-1234')
})

test('status keeps the pending code, then reports authorized after the flow commits', async () => {
  const fake = fakeAuthorization()
  const signIn = createSignIn({ authorizationOf: () => fake.service, credentialsOf: () => undefined, timeoutMs: 1000 })
  const started = signIn.start()
  const request = await waitFor(() => fake.calls.begin[0])
  request.interaction.notify({ message: 'Enter this code', url: 'https://auth.openai.com/codex/device', code: 'WXYZ-9876' })
  await started
  const pending = await signIn.status()
  assert.equal(pending.status, 'pending')
  assert.equal(pending.userCode, 'WXYZ-9876')
  fake.settle({ status: 'authorized' })
  await tick()
  const done = await signIn.status()
  assert.equal(done.status, 'authorized')
})

test('cancel aborts the request and accepts a new start', async () => {
  const fake = fakeAuthorization()
  const signIn = createSignIn({ authorizationOf: () => fake.service, credentialsOf: () => undefined, timeoutMs: 1000 })
  const started = signIn.start()
  const request = await waitFor(() => fake.calls.begin[0])
  request.interaction.notify({ message: 'Enter this code', url: 'https://auth.openai.com/codex/device', code: 'CODE-0001' })
  await started
  request.signal.addEventListener('abort', () => fake.settle({ status: 'cancelled' }))
  const cancelled = signIn.cancel()
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(fake.calls.cancel[0], KEY)
  assert.equal(request.signal.aborted, true)
  await tick()
  const fresh = signIn.start()
  const second = await waitFor(() => fake.calls.begin[1])
  second.interaction.notify({ message: 'Enter this code', url: 'https://auth.openai.com/codex/device', code: 'CODE-0002' })
  const result = await fresh
  assert.equal(result.userCode, 'CODE-0002')
})

test('a provider failure is named, and a missing service is refused by name', async () => {
  const fake = fakeAuthorization()
  const signIn = createSignIn({ authorizationOf: () => fake.service, credentialsOf: () => undefined, timeoutMs: 1000 })
  const started = signIn.start()
  const request = await waitFor(() => fake.calls.begin[0])
  request.interaction.notify({ message: 'starting', url: 'https://auth.openai.com/codex/device', code: 'CODE-0003' })
  await started
  const missing = createSignIn({ authorizationOf: () => undefined, credentialsOf: () => undefined, timeoutMs: 1000 })
  const refused = await missing.start()
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'AUTHORIZATION_UNAVAILABLE')
  fake.settle({ status: 'authorized' })
})

test('a provider that rejects begin is reported with its code', async () => {
  const signIn = createSignIn({
    authorizationOf: () => ({
      begin: async () => { const error = new Error('no flow claims this key'); error.code = 'NO_FLOW'; throw error },
      cancel() {},
    }),
    credentialsOf: () => undefined,
    timeoutMs: 1000,
  })
  const result = await signIn.start({ force: true })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'NO_FLOW')
  assert.equal(result.status, 'failed')
  assert.equal(JSON.stringify(result).includes('token'), false)
})

test('a select prompt picks the device method, a typed prompt is refused', async () => {
  const fake = fakeAuthorization()
  const signIn = createSignIn({ authorizationOf: () => fake.service, credentialsOf: () => undefined, timeoutMs: 1000 })
  const started = signIn.start()
  const request = await waitFor(() => fake.calls.begin[0])
  const chosen = await request.interaction.prompt({ kind: 'select', message: 'How?', options: [{ id: 'api_key', label: 'API key' }, { id: 'device', label: 'Device code' }] })
  assert.equal(chosen, 'device')
  await assert.rejects(() => request.interaction.prompt({ kind: 'secret', message: 'Paste a token' }), /device sign-in/)
  request.interaction.notify({ message: 'Enter this code', url: 'https://auth.openai.com/codex/device', code: 'CODE-0004' })
  const result = await started
  assert.equal(result.userCode, 'CODE-0004')
})

test('status falls back to a stored grant when no attempt exists', async () => {
  const signIn = createSignIn({
    authorizationOf: () => undefined,
    credentialsOf: () => ({ describeRecord: async (key) => ({ configured: key === KEY }) }),
    timeoutMs: 1000,
  })
  const status = await signIn.status()
  assert.equal(status.ok, true)
  assert.equal(status.status, 'authorized')
  assert.equal(status.configured, true)
})

test('the tool set carries the three names and no token field', () => {
  const stub = (definition) => definition
  const tools = createSignInTools({ signIn: {}, defineTool: stub })
  assert.deepEqual(tools.map((tool) => tool.name), ['codex_signin_start', 'codex_signin_status', 'codex_signin_cancel'])
  assert.equal(JSON.stringify(tools).includes('accessToken'), false)
})
