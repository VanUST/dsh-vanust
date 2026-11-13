/**
 * PURPOSE
 *   Tell an agent, deterministically and without one model call, that its session has
 *   grown long enough to hand off. A long session is not a failure — it is expensive:
 *   every new step re-sends the whole derived history, and compaction then re-bills the
 *   prefix. The fix is a HANDOFF (a note the next session can read) while the context is
 *   still affordable, not a summary written after it is not.
 *
 *   Two seams carry it, both of them the harness's own:
 *     - `agent/pre-step` is the waterfall the loop runs before it appends `step/start`
 *       and builds the request (dsh-agent-loop/lib/index.js:907-936; documented in
 *       docs/agent-lifecycle.md of the 0.2.1-rc.2 source). A listener that appends a
 *       `user/message` there writes into the surface the very next request is derived
 *       from — `buildRequest` calls `session.deriveMessages()` after the waterfall
 *       (dsh-agent-loop/lib/index.js:1214-1290). That is exactly how
 *       `@deepseek-ai/dsh-compaction-basic` delivers its checkpoint
 *       (dsh-compaction-basic/lib/index.js:596-655, listener at :839): the text is in
 *       the same request, not the one after it.
 *     - `ctx.sessionProjections` is the harness's durable fold registry
 *       (dsh-session-projection/lib/index.js; mounted by dsh-base/cordis.patch.yml:172).
 *       A unit this plugin registers folds the WHOLE append-only event log — including
 *       events a compaction has shadowed — so the step count and the "already reminded"
 *       marks are rebuilt after a reload and are untouched by `{op:'replace'}`, which
 *       changes the surface, never the log.
 *
 * INPUTS
 *   Config (all optional):
 *     enabled        false disables the listener and the projection. Default true.
 *     thresholds     ascending step counts that earn a reminder. The LAST one is the
 *                    HARD threshold (stop starting work, hand off now); every earlier one
 *                    is SOFT (write the handoff note now). Default [300, 400, 500].
 *     notify         raise a desktop notification when a reminder fires. Default true.
 *     notifyChildren notify for delegated child sessions too. Default false: a child's
 *                    reminder still reaches the child, but the human is not popped for
 *                    work they delegated (the @cc/dsh-notify plugin makes the same call).
 *     notifyStyle    forwarded to `notificationCommand` ('overlay' | 'daemon'). Default:
 *                    the notifier's own default.
 *
 * OUTPUTS
 *   One `sessionBudget` projection unit and one `agent/pre-step` listener. The listener
 *   may append one fixed `user/message` per fired threshold. Exported so the behaviour can
 *   be exercised without a running harness: `resolveConfig`, `decideThreshold`,
 *   `levelOf`, `renderReminder`, `reminderThresholds`, `notificationInput`, `notifyHuman`,
 *   `isRootSession`, `budgetProjectionDefinition`.
 *
 * KEYWORDS
 *   session budget, handoff, agent/pre-step, session projection, step count, compaction,
 *   user/message, desktop notification, deterministic, no model call
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The step ordinal of the step about to run is `completed steps + 1`, where a completed
 *     step is one `step/end` event (the loop appends exactly one per entered step in a
 *     `finally`, so completed, failed, cancelled and max-token steps all count once —
 *     the same authority `@deepseek-ai/dsh-session-stats` documents).
 *   - Only the HIGHEST crossed, not-yet-fired threshold is announced. A plugin loaded into
 *     a session already past 420 fires the 400 reminder, not 300 and 400 in one step; two
 *     reminders in one request is noise, and the last threshold is the true message.
 *   - A threshold fires once per session, ever. The mark is folded from the marker line in
 *     the reminder's own text, so a repeat pre-step on the same step (a retry, a second
 *     listener round) and a reload both stay silent. The mark is durable because it is the
 *     message content, not the message source.
 *   - Compaction cannot reset the count: `{op:'replace'}` shadows surface nodes and appends
 *     two events; the `step/end` events and the shadowed reminder content remain in the
 *     log the projection folds. Verified by `proof/proof.mjs`, which really appends a
 *     replacement to a real `Session`.
 *   - A failure on ANY step — the projection state, the append, the notification — is
 *     caught, logged ONCE per failure kind, and `next()` is still called, so the agent
 *     turn never sees an exception from this plugin.
 *   - The notifier is imported lazily, by the literal specifier below, so a profile without
 *     @cc/dsh-notify loses the popup (logged once) and never the reminder, and a machine
 *     that runs the kit straight from source still loads this module.
 *   - The notification never blocks the turn: the command travels as argv, is spawned
 *     `detached` with `stdio:'ignore'`, `unref()`d, and its `error` event is consumed (an
 *     unhandled `error` on a detached child would otherwise take the process down).
 */

import { spawn } from 'node:child_process'

import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'session-budget'

/** The projection registry is the only service this plugin needs; without it there is no count. */
export const inject = ['sessionProjections']

/** Key of the projection unit this plugin registers. */
export const PROJECTION_KEY = 'sessionBudget'

/** Step counts that earn a reminder; the last one is the hard threshold. */
export const DEFAULT_THRESHOLDS = Object.freeze([300, 400, 500])

/**
 * Load the notifier at fire time, not at load time: @cc/dsh-notify is a peer of this
 * package, so a profile without it must lose only the popup. The specifier is a LITERAL on
 * purpose — the kit's portability gate rejects `import(<variable>)`, which is a real Windows
 * bug when the variable holds a path.
 */
function loadDefaultNotifier() {
  return import('@cc/dsh-notify/core')
}

/**
 * The marker a reminder carries. It is plain text on purpose: a session's message
 * SOURCE is not part of the restored log (the v4 row of a `user/message` keeps its
 * content), so the fired set is folded from content, which does survive.
 */
const MARKER_PATTERN = /\[session-budget (soft|hard) (\d+)\]/g

/** The strongest level this plugin emits. */
export const HARD_LEVEL = 'hard'

/** A positive safe integer, or null. */
function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/** Ascending, de-duplicated thresholds; the default when the config names none. */
function normalizeThresholds(value) {
  if (!Array.isArray(value)) return [...DEFAULT_THRESHOLDS]
  const seen = new Set()
  const thresholds = []
  for (const item of value) {
    const threshold = positiveInteger(item)
    if (threshold === null || seen.has(threshold)) continue
    seen.add(threshold)
    thresholds.push(threshold)
  }
  return thresholds.length === 0 ? [...DEFAULT_THRESHOLDS] : thresholds.sort((a, b) => a - b)
}

/**
 * Parse config into a total policy. Unusable values fall back to the defaults instead of
 * disabling the plugin: a typo must not silently stop a reminder that protects the budget.
 *
 * @param config - raw plugin config.
 * @returns the resolved policy.
 */
export function resolveConfig(config = {}) {
  return {
    enabled: config.enabled !== false,
    thresholds: normalizeThresholds(config.thresholds),
    notify: config.notify !== false,
    notifyChildren: config.notifyChildren === true,
    notifyStyle: typeof config.notifyStyle === 'string' && config.notifyStyle !== '' ? config.notifyStyle : undefined,
  }
}

/**
 * The thresholds one event records as already announced.
 *
 * @param event - a session event.
 * @returns the marker thresholds found in a `user/message`'s text blocks; [] otherwise.
 */
export function reminderThresholds(event) {
  if (event === null || typeof event !== 'object' || event.type !== 'user/message') return []
  const content = event.data?.content
  if (!Array.isArray(content)) return []
  const found = []
  for (const block of content) {
    if (block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') continue
    MARKER_PATTERN.lastIndex = 0
    let match
    while ((match = MARKER_PATTERN.exec(block.text)) !== null) found.push(Number(match[2]))
  }
  return found
}

/**
 * A total parser for the unit's state. The registry only calls `parse` (checkpoint restore
 * and cold view), so a hand-written guard is enough and keeps the plugin dependency-free —
 * the alternative would pull a schema library into the profile for two integers.
 */
const budgetStateSchema = Object.freeze({
  parse(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('session-budget: projection state is not an object')
    if (!Number.isSafeInteger(value.steps) || value.steps < 0) throw new Error('session-budget: projection state has no step count')
    if (!Array.isArray(value.fired) || value.fired.some((entry) => !Number.isSafeInteger(entry) || entry <= 0)) throw new Error('session-budget: projection state has an invalid fired list')
    return value
  },
})

/**
 * The projection unit: a fold over the append-only log, never over the compacted surface.
 *
 * `steps` counts `step/end`; `fired` collects every threshold this plugin has announced in
 * this session. Both are rebuilt from the log after a reload and are unaffected by a
 * compaction replacement, because a replacement appends events and shadows surface nodes —
 * it deletes nothing.
 */
export const budgetProjectionDefinition = Object.freeze({
  key: PROJECTION_KEY,
  stateVersion: 1,
  stateSchema: budgetStateSchema,
  init: () => ({ steps: 0, fired: [] }),
  apply(state, event) {
    if (event !== null && typeof event === 'object' && event.type === 'step/end') return { ...state, steps: state.steps + 1 }
    const thresholds = reminderThresholds(event)
    if (thresholds.length === 0) return state
    let fired = state.fired
    for (const threshold of thresholds) if (!fired.includes(threshold)) fired = [...fired, threshold]
    return fired === state.fired ? state : { ...state, fired: fired.sort((a, b) => a - b) }
  },
})

/**
 * The highest threshold this step crosses that has not fired yet, or null.
 *
 * @param ordinal - the step ordinal about to run (completed steps + 1).
 * @param fired - thresholds already announced in this session.
 * @param thresholds - the resolved ascending thresholds.
 * @returns the threshold to announce, or null.
 */
export function decideThreshold(ordinal, fired, thresholds) {
  let chosen = null
  for (const threshold of thresholds) {
    if (threshold <= ordinal && !fired.includes(threshold)) chosen = threshold
  }
  return chosen
}

/**
 * The level a threshold carries: the last threshold is hard, everything before is soft.
 *
 * @param threshold - one resolved threshold.
 * @param thresholds - the full ascending list.
 * @returns 'hard' or 'soft'.
 */
export function levelOf(threshold, thresholds) {
  return thresholds[thresholds.length - 1] === threshold ? HARD_LEVEL : 'soft'
}

/**
 * The fixed reminder text. Deterministic: the same threshold and ordinal always yield the
 * same bytes, so the plugin's output can be cited, diffed and asserted in a proof.
 *
 * @param level - 'soft' or 'hard'.
 * @param threshold - the crossed threshold.
 * @param ordinal - the step ordinal about to run.
 * @returns the model-facing text, ending with the marker line.
 */
export function renderReminder(level, threshold, ordinal) {
  const marker = `[session-budget ${level} ${threshold}]`
  if (level === HARD_LEVEL) {
    return [
      `Session budget: this session has reached ${ordinal} steps (hard threshold ${threshold}). The context is expensive now.`,
      '',
      'Stop starting new work. Write the handoff note before this turn ends:',
      '- what is done, and the command/output that proves it;',
      '- what is left, and where the files are;',
      '- the exact next step, and any trap the next session would otherwise repeat.',
      '',
      'Then end the turn and tell the human to open a new session with that note.',
      '',
      marker,
    ].join('\n')
  }
  return [
    `Session budget: this session has reached ${ordinal} steps (soft threshold ${threshold}).`,
    '',
    'Write the handoff note now, while the context is still affordable:',
    '- what is done, and the command/output that proves it;',
    '- what is left, and where the files are;',
    '- the exact next step, and any trap the next session would otherwise repeat.',
    '',
    'This is not a stop: finish the current step, then hand off and start a new session.',
    '',
    marker,
  ].join('\n')
}

/**
 * Whether a session belongs to the human rather than to a delegated child. Mirrors
 * @cc/dsh-notify's rule: any of the three marks makes it a child.
 *
 * @param session - the live session.
 * @returns true for a root session.
 */
export function isRootSession(session) {
  const header = session?.header
  if (header === null || header === undefined) return true
  if (header.origin === 'subagent') return false
  if (header.parentSession !== undefined) return false
  return (header.delegationDepth ?? 0) === 0
}

/**
 * The pure notification input for one fired threshold.
 *
 * @param input - `{ level, threshold, ordinal, sessionId }`.
 * @returns `{ title, body }` — stable and short enough for a popup.
 */
export function notificationInput({ level, threshold, ordinal, sessionId }) {
  const id = typeof sessionId === 'string' && sessionId !== '' ? sessionId : 'this session'
  return {
    title: `Session budget — ${level} ${threshold}`,
    body: `${ordinal} steps in ${id}. Write the handoff note now and start a new session.`,
  }
}

/**
 * Run the notification command, detached and never awaited by the turn.
 *
 * `load` and `spawn` are seams for the proof: production leaves them at their defaults.
 *
 * @param options - `{ ctx, config, input, warnOnce, load?, spawn? }`.
 * @returns whether a notifier was started. Never rejects.
 */
export async function notifyHuman(options) {
  const { config, input, warnOnce = () => {}, load = loadDefaultNotifier, spawn: spawnImpl = spawn } = options
  try {
    if (config.notify === false) return false
    const notifier = await load()
    const build = notifier?.notificationCommand
    if (typeof build !== 'function') {
      warnOnce('notify-module', 'the notifier module exports no notificationCommand')
      return false
    }
    // `notificationCommand` does NOT default the platform — its caller passes it (see
    // @cc/dsh-notify's plugin-notify.mjs:303-315). Omitting it returns null and the popup
    // silently disappears, which is exactly the failure a proof is for.
    const command = build({
      ...input,
      platform: process.platform,
      ...(config.notifyStyle === undefined ? {} : { style: config.notifyStyle }),
    })
    if (command === null || typeof command !== 'object' || typeof command.command !== 'string' || command.command === '') return false
    const child = spawnImpl(command.command, Array.isArray(command.args) ? command.args : [], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ...(command.env ?? {}) },
      windowsHide: true,
    })
    // Consume `error`: an unhandled one on a detached child is a process-level crash,
    // which would turn a missing notifier into a broken turn.
    child?.on?.('error', (error) => {
      warnOnce(`notify-spawn:${command.command}:${String(error?.code ?? error?.message ?? 'error')}`, `could not run ${command.command}: ${String(error?.code ?? error?.message ?? 'error')}`)
    })
    child?.unref?.()
    return true
  } catch (error) {
    warnOnce(`notify:${error instanceof Error ? error.name : 'unknown'}`, `notification failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/**
 * Read this session's projection state through whichever registration contract the host has.
 *
 * dsh 0.2.1-rc.2's `sessionProjections.register` is synchronous and the state is read with
 * `stateOf(session, key)`. dsh 0.2.2 returns a THENABLE registration whose awaited handle owns
 * `stateOf(session)`, and it deprecates the pair form (it logs `… stateOf(session, "key") is
 * deprecated; read handle.stateOf(session) from an awaited registration`). Both are supported
 * here because the kit's pin and the migration target are different versions for a while:
 *   - a thenable registration is awaited ONCE (the promise is cached by the caller), then
 *     `handle.stateOf(session)` is used on every later step;
 *   - a host without a thenable registration (0.2.1) keeps the legacy pair read.
 * A rejected registration falls back to the legacy read instead of failing the turn: the
 * reminder is a cost nudge, never a reason for a step to fail.
 *
 * @param ctx - Cordis context carrying `sessionProjections`.
 * @param session - the agent's session.
 * @param handlePromise - cached `Promise<handle>` from `register`, or undefined on 0.2.1.
 * @returns Projection state, or undefined when the host has none yet.
 */
async function readState(ctx, session, handlePromise) {
  if (handlePromise !== undefined) {
    try {
      const handle = await handlePromise
      if (handle !== undefined && handle !== null && typeof handle.stateOf === 'function') return handle.stateOf(session)
    } catch {
      // Fall through to the legacy read; a failed registration must not mute the reminder.
    }
  }
  return ctx.sessionProjections.stateOf(session, PROJECTION_KEY)
}

/**
 * Inspect one step. It may throw — the listener wraps it — but every failure it can
 * anticipate (missing session, missing projection state, aborted turn) is a silent no-op.
 */
async function inspectStep(ctx, payload, config, warnOnce, handlePromise) {
  if (!config.enabled) return
  if (payload?.signal?.aborted === true) return
  const session = payload?.agent?.session
  if (session === undefined || session === null) return
  const state = await readState(ctx, session, handlePromise)
  if (state === undefined || state === null) return
  const ordinal = state.steps + 1
  const threshold = decideThreshold(ordinal, state.fired, config.thresholds)
  if (threshold === null) return
  const level = levelOf(threshold, config.thresholds)
  const message = createUserMessage({
    content: [{ type: 'text', text: renderReminder(level, threshold, ordinal) }],
    source: { kind: 'session-budget', form: 'notice', summary: `session budget ${level} ${threshold}` },
  })
  session.append('user/message', message, { surfaceOp: 'append' })
  if (config.notify && (config.notifyChildren || isRootSession(session))) {
    // Fire and forget: the turn must not wait for a popup, and notifyHuman never rejects.
    void notifyHuman({ ctx, config, warnOnce, input: notificationInput({ level, threshold, ordinal, sessionId: session.id }) })
  }
}

/**
 * Install the projection unit and the pre-step listener.
 *
 * @param ctx - Cordis context carrying `sessionProjections`.
 * @param config - raw plugin config; see the module header.
 * @returns Nothing.
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  const warned = new Set()
  const warnOnce = (key, message) => {
    if (warned.has(key)) return
    warned.add(key)
    try {
      ctx.logger?.warn?.(`session-budget: ${message}`)
    } catch {
      // A logger that throws must not turn a warning into a turn failure.
    }
  }
  // The registration is awaited by the READER (see readState), not here: `apply` may not be
  // async on every host, and a handle that resolves late is still a handle. A thenable
  // registration is the 0.2.2 contract; anything else keeps the legacy pair read.
  let handlePromise
  try {
    const registration = ctx.sessionProjections.register(budgetProjectionDefinition)
    if (registration !== undefined && registration !== null && typeof registration.then === 'function') {
      handlePromise = Promise.resolve(registration).catch(() => undefined)
    }
  } catch (error) {
    warnOnce('register', `could not register the projection unit: ${error instanceof Error ? error.message : String(error)}`)
  }
  ctx.on('agent/pre-step', async (payload, next) => {
    try {
      await inspectStep(ctx, payload, resolved, warnOnce, handlePromise)
    } catch (error) {
      warnOnce(`inspect:${error instanceof Error ? error.name : 'unknown'}`, `step inspection failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return next()
  })
}
