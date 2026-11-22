/**
 * PURPOSE
 *   The ChatGPT Plus/Pro sign-in that the web Models page does not offer yet. The
 *   harness's pi-ai adapter registers an OAuth flow for llm-pi-ai/openai-codex, but
 *   no surface starts it; these three tools are that surface for the orchestrator.
 *
 *   codex_signin_start begins the flow in the background and returns the verification
 *   URL and user code as soon as the provider issues them, because ctx.authorization.begin
 *   only resolves after the human has finished. codex_signin_status reports the same
 *   attempt, and codex_signin_cancel withdraws it. The grant itself is written by the
 *   pi-ai flow through the credentials service; this plugin never sees a token.
 *
 * INPUTS
 *   Config (all optional): {presets?: string[], timeoutMs?: number}. presets defaults
 *   to ['orchestrator']; timeoutMs defaults to 10000 and bounds how long start waits
 *   for the first notice. Tool argument: start accepts force: true to re-authenticate
 *   over an existing grant.
 *
 * OUTPUTS
 *   JSON results only. A start/status result carries status (pending, authorized,
 *   cancelled, failed, idle), url, code, and a human message. attemptId identifies the
 *   in-memory attempt. No access token, refresh token or other secret is stored,
 *   returned or logged.
 *
 * KEYWORDS
 *   ChatGPT, OpenAI Codex, device code, OAuth, authorization, orchestrator, sign-in
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A second start while an attempt is pending is refused with ALREADY_IN_FLIGHT and
 *     repeats the current URL/code, so a retry never strands the first flow.
 *   - A missing authorization service is refused by name, never silently ignored.
 *   - A provider that asks a typed question (text/secret) is refused: the device flow
 *     asks nothing beyond the browser code, and inventing an answer would be unsafe.
 *   - Cancel aborts the request signal and withdraws the attempt through the service;
 *     the flow settles as cancelled and a new start is accepted.
 *   - status falls back to the credential record, so a grant that survives a restart
 *     still reads authorized even though the in-memory attempt is gone.
 */

import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = '@cc/dsh-codex-signin'

/** The credential record the pi-ai flow writes; the only key this plugin addresses. */
export const KEY = 'llm-pi-ai/openai-codex'

/** The pi-ai flow method that uses device code when the provider supports it. */
export const METHOD = 'oauth'

const DEFAULT_PRESETS = ['orchestrator']
const DEFAULT_TIMEOUT_MS = 10_000
const ACTIVE = new Set(['starting', 'pending'])

/** A promise plus its resolver, used for the first-notice race. */
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

/** The subset of an attempt that is safe to show a human. */
function publicState(attempt) {
  if (attempt === null) return undefined
  return {
    attemptId: attempt.id,
    status: attempt.status,
    ...attempt.url === undefined ? {} : { url: attempt.url },
    ...attempt.userCode === undefined ? {} : { userCode: attempt.userCode },
    ...attempt.message === undefined ? {} : { message: attempt.message },
    ...attempt.error === undefined ? {} : { error: attempt.error },
    ...attempt.errorCode === undefined ? {} : { errorCode: attempt.errorCode },
    startedAt: attempt.startedAt,
    ...attempt.finishedAt === undefined ? {} : { finishedAt: attempt.finishedAt },
  }
}

/**
 * The sign-in state machine, independent of the host so a fake authorization service
 * can exercise every branch. One attempt per key is the service's own rule; the local
 * state mirrors it so status and the second-start refusal have something to report.
 */
export function createSignIn({ authorizationOf, credentialsOf, timeoutMs = DEFAULT_TIMEOUT_MS, now = () => Date.now() }) {
  let attempt = null

  const credentialsConfigured = async () => {
    const credentials = credentialsOf?.()
    if (credentials === undefined || credentials === null || typeof credentials.describeRecord !== 'function') return false
    try {
      return (await credentials.describeRecord(KEY))?.configured === true
    } catch {
      return false
    }
  }

  const bound = () => (attempt !== null && ACTIVE.has(attempt.status) ? attempt : null)

  async function start({ force = false } = {}) {
    const authorization = authorizationOf?.()
    if (authorization === undefined || authorization === null || typeof authorization.begin !== 'function') {
      return { ok: false, code: 'AUTHORIZATION_UNAVAILABLE', message: 'the authorization service is not mounted; the Codex sign-in cannot start in this composition' }
    }
    const active = bound()
    if (active !== null) {
      return {
        ok: false,
        code: 'ALREADY_IN_FLIGHT',
        message: 'a sign-in attempt is already running; finish it in the browser or cancel it, then retry',
        ...publicState(active),
      }
    }
    if (force !== true && await credentialsConfigured()) {
      return { ok: true, status: 'authorized', configured: true, message: 'the llm-pi-ai/openai-codex grant is already stored; pass force:true to start a new login' }
    }

    const controller = new AbortController()
    const first = deferred()
    const done = deferred()
    const state = { id: randomUUID(), status: 'starting', startedAt: now(), controller }
    attempt = state

    const interaction = {
      notify(notice) {
        if (typeof notice?.url === 'string' && notice.url !== '') state.url = notice.url
        if (typeof notice?.code === 'string' && notice.code !== '') state.userCode = notice.code
        if (typeof notice?.message === 'string' && notice.message !== '') state.message = notice.message
        if (state.status === 'starting') state.status = 'pending'
        if (state.url !== undefined || state.userCode !== undefined) first.resolve()
      },
      async prompt(prompt) {
        if (prompt?.kind === 'select' && Array.isArray(prompt.options) && prompt.options.length > 0) {
          const preferred = prompt.options.find((option) => /device|code|chatgpt|oauth/i.test(String(option.id) + ' ' + String(option.label)))
          return (preferred ?? prompt.options[0]).id
        }
        throw new Error('the provider asked for ' + String(prompt?.kind ?? 'typed') + ' input during the device sign-in: ' + String(prompt?.message ?? ''))
      },
    }

    Promise.resolve()
      .then(() => authorization.begin({ key: KEY, method: METHOD, interaction, signal: controller.signal }))
      .then((result) => {
        state.status = result?.status === 'authorized' ? 'authorized' : 'cancelled'
        state.finishedAt = now()
        if (state.status === 'authorized') delete state.error
        done.resolve()
      })
      .catch((error) => {
        state.finishedAt = now()
        if (controller.signal.aborted || error?.code === 'CANCELLED') {
          state.status = 'cancelled'
        } else {
          state.status = 'failed'
          state.error = String(error?.message ?? error)
          state.errorCode = typeof error?.code === 'string' ? error.code : 'SIGNIN_FAILED'
        }
        done.resolve()
      })

    const timeout = new Promise((resolve) => { setTimeout(() => resolve('timeout'), timeoutMs) })
    const winner = await Promise.race([first.promise.then(() => 'notice'), done.promise.then(() => 'done'), timeout])

    if (winner === 'notice') return { ok: true, ...publicState(state) }
    if (winner === 'done') {
      if (state.status === 'authorized') return { ok: true, ...publicState(state) }
      return {
        ok: false,
        code: state.errorCode ?? 'CANCELLED',
        message: state.error ?? 'the sign-in ended before a verification code was issued',
        ...publicState(state),
      }
    }

    controller.abort()
    try { authorization.cancel?.(KEY) } catch { /* the attempt is already gone */ }
    state.status = 'cancelled'
    state.finishedAt = now()
    return { ok: false, code: 'NO_CODE', message: 'the provider did not issue a verification link or code within ' + timeoutMs + ' ms', ...publicState(state) }
  }

  async function status() {
    const active = bound()
    if (active !== null) return { ok: true, ...publicState(active) }
    if (attempt !== null && (attempt.status === 'authorized' || attempt.status === 'cancelled' || attempt.status === 'failed')) return { ok: true, ...publicState(attempt) }
    if (await credentialsConfigured()) return { ok: true, status: 'authorized', configured: true, message: 'the llm-pi-ai/openai-codex grant is stored' }
    return { ok: true, status: 'idle', message: 'no sign-in attempt has been started in this session' }
  }

  function cancel() {
    const active = bound()
    if (active === null) return { ok: true, ...(attempt === null ? { status: 'idle', message: 'no sign-in attempt is running' } : publicState(attempt)) }
    const authorization = authorizationOf?.()
    active.status = 'cancelled'
    active.finishedAt = now()
    try { active.controller?.abort() } catch { /* already aborted */ }
    try { authorization?.cancel?.(KEY) } catch { /* the service may have settled it already */ }
    return { ok: true, ...publicState(active), message: 'the sign-in attempt was cancelled' }
  }

  return { start, status, cancel, key: KEY }
}

const render = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]

/** The three tool definitions, built with an injected defineTool for tests. */
export function createSignInTools({ signIn, defineTool: define = defineTool }) {
  return [
    define({
      name: 'codex_signin_start',
      description: 'Start the ChatGPT Plus/Pro (OpenAI Codex) device-code sign-in and return the verification URL and user code within 10 s. The flow keeps running in the background; the grant is written by the pi-ai authorization flow as llm-pi-ai/openai-codex. If a grant already exists, start reports authorized unless force:true.',
      parameters: {
        force: { type: 'boolean', description: 'Start a new login even when a usable grant is already stored.' },
      },
      output: { schema: { type: 'json' }, render },
      execute: (args) => signIn.start(args ?? {}),
    }),
    define({
      name: 'codex_signin_status',
      description: 'Report the current Codex sign-in attempt: pending with its URL and code, authorized, cancelled, failed, or idle. Falls back to the stored llm-pi-ai/openai-codex grant when no attempt exists.',
      parameters: {},
      output: { schema: { type: 'json' }, render },
      execute: () => signIn.status(),
    }),
    define({
      name: 'codex_signin_cancel',
      description: 'Cancel the running Codex device-code sign-in. The provider stops polling, the attempt settles as cancelled, and a new start is accepted.',
      parameters: {},
      output: { schema: { type: 'json' }, render },
      execute: () => signIn.cancel(),
    }),
  ]
}

/** The preset in force: tool-families first, projection second, creation header last. */
function presetOf(ctx, agent) {
  for (const lookup of [
    () => ctx.get?.('toolFamilies')?.presetFor?.(agent?.session),
    () => ctx.get?.('agentPresets')?.presetForSession?.(agent?.session),
    () => agent?.session?.header?.agentPreset,
  ]) {
    try {
      const preset = lookup()
      if (typeof preset === 'string' && preset.trim() !== '') return preset
    } catch {
      // A composition without that service falls through to the next source.
    }
  }
  return undefined
}

/** Register the tools once for every agent whose current preset is allowed. */
function installPresetGate(ctx, { allowed, tools }) {
  const installed = new Map()
  const sync = (agent, presetOverride) => {
    if (agent === undefined || agent === null) return
    try {
      const preset = typeof presetOverride === 'string' && presetOverride !== '' ? presetOverride : presetOf(ctx, agent)
      const current = installed.get(agent)
      if (current !== undefined && current.preset === preset) return
      if (current !== undefined) {
        for (const dispose of current.disposers) {
          try { dispose() } catch { /* a failing disposer must not take the session down */ }
        }
        installed.delete(agent)
      }
      if (typeof preset !== 'string' || !allowed(preset)) return
      const disposers = tools.map((tool) => agent.ctx.tools.register(tool)).filter((dispose) => typeof dispose === 'function')
      installed.set(agent, { preset, disposers })
    } catch {
      // Never throw into agent/created: an exception there cancels session creation.
    }
  }
  ctx.on('agent/created', ({ agent }) => sync(agent))
  try {
    ctx.root?.on?.('session/event', (session, event) => {
      if (event?.type !== 'agent-preset/selected') return
      let live
      try { live = ctx.get?.('agents')?.get?.(session?.id) } catch { live = undefined }
      if (live !== undefined && live !== null) sync(live, event?.data?.agentPreset)
    })
  } catch {
    // A root without the session feed still re-syncs at pre-step.
  }
  ctx.on('agent/pre-step', (payload, next) => { sync(payload?.agent); return next() }, { prepend: true })
  return sync
}

/** Cordis plugin entry. */
export function apply(ctx, config = {}) {
  const presets = Array.isArray(config.presets) && config.presets.length > 0 ? config.presets : DEFAULT_PRESETS
  const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS
  const signIn = createSignIn({
    authorizationOf: () => { try { return ctx.get?.('authorization') } catch { return undefined } },
    credentialsOf: () => { try { return ctx.get?.('credentials') } catch { return undefined } },
    timeoutMs,
  })
  const tools = createSignInTools({ signIn })
  installPresetGate(ctx, { tools, allowed: (preset) => presets.includes(preset) })
}
