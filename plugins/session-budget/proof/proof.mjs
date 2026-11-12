/**
 * PURPOSE
 *   Prove, by running the plugin itself, that @cc/dsh-session-budget counts a session's
 *   steps deterministically and puts exactly one fixed reminder in front of the model at
 *   each threshold — and that the count survives a compaction.
 *
 *   Nothing here mocks the logic under test. `apply()` from the plugin is called with a
 *   context whose only fake part is the Cordis event bus; the projection registry drives
 *   the plugin's REAL `budgetProjectionDefinition` over the events of a REAL
 *   `@deepseek-ai/dsh-session` `Session`, and the reminder is appended to that Session
 *   through the real `session.append`, so `session.deriveMessages()` shows what the model
 *   would actually receive. The notification is built by the REAL
 *   `@cc/dsh-notify/core` `notificationCommand`; only the spawn is observed (detached /
 *   stdio / unref) instead of running a popup.
 *
 * INPUTS
 *   None. Reads the plugin next to it and the installed harness packages.
 *
 * OUTPUTS
 *   One table row per check, then `session-budget proof: PASS|FAIL (n checks)`.
 *   Exit code 0 only when every row passed.
 *
 * KEYWORDS
 *   session budget, proof, agent/pre-step, step count, compaction, handoff, notification
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

import {
  apply,
  notificationInput,
  notifyHuman,
  reminderThresholds,
  resolveConfig,
} from '../session-budget.mjs'

/** Collected rows; `ok === false` makes the process exit non-zero. */
const rows = []
let failed = false

/**
 * Record one check.
 *
 * @param scenario - what is being proven.
 * @param ok - the observed verdict.
 * @param detail - the short evidence printed in the last column.
 * @param numbers - optional `{ steps, reminders, marker }` for the numeric columns.
 */
function check(scenario, ok, detail, numbers = {}) {
  rows.push({
    scenario,
    steps: numbers.steps ?? '',
    reminders: numbers.reminders ?? '',
    detail,
    ok,
  })
  if (!ok) failed = true
}

/** A fake Cordis context: the event bus, a logger, and the projection registry the plugin uses. */
function createHarness() {
  const handlers = new Map()
  const warnings = []
  const registered = new Map()
  const ctx = {
    logger: { warn: (message) => warnings.push(String(message)) },
    on(event, handler) {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
    sessionProjections: {
      register(definition) {
        registered.set(definition.key, definition)
      },
      /** The registry's read face: fold the unit over the whole in-memory log. */
      stateOf(session, key) {
        const definition = registered.get(key)
        if (definition === undefined) return undefined
        let state = definition.init(session.header, session.inheritedEventCount)
        for (const event of session.snapshotEvents()) state = definition.apply(state, event)
        return state
      },
    },
  }
  return { ctx, handlers, warnings, registered }
}

/** Run the plugin's real `agent/pre-step` listener for one step. */
async function runPreStep(harness, session, step) {
  const handler = harness.handlers.get('agent/pre-step')
  if (handler === undefined) throw new Error('the plugin registered no agent/pre-step listener')
  const before = session.seq
  let nextCalls = 0
  const decision = await handler(
    { agent: { session }, turn: 1, step, messages: [], signal: { aborted: false } },
    () => {
      nextCalls += 1
      return Promise.resolve({ kind: 'enter', messages: [] })
    },
  )
  const appended = session.snapshotEvents().slice(before).filter((event) => event.type === 'user/message')
  return { decision, appended, nextCalls }
}

/** Completed steps = appended `step/end` events, the authority the count folds. */
function completedSteps(session) {
  return session.snapshotEvents().filter((event) => event.type === 'step/end').length
}

/** Append `step/end` until the session has completed `target` steps. */
function completeSteps(session, target) {
  while (completedSteps(session) < target) session.append('step/end', { turn: 1, step: completedSteps(session) + 1 })
}

/** The text of an appended reminder event. */
function reminderText(event) {
  const blocks = event?.data?.content
  return Array.isArray(blocks) ? blocks.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('') : ''
}

/**
 * Import the real `@cc/dsh-notify/core`: the installed profile copy when it is there, the
 * kit's own copy otherwise. Both are the same module; the profile copy is the deployed one.
 */
async function loadRealNotifyCore() {
  const candidates = []
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '') {
    candidates.push(join(process.env.DSH_HOME, 'profiles', 'web', 'node_modules', '@cc', 'dsh-notify', 'notify-core.mjs'))
  }
  candidates.push(fileURLToPath(new URL('../../notify/notify-core.mjs', import.meta.url)))
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const module = await import(pathToFileURL(candidate).href)
    if (typeof module.notificationCommand === 'function') return module
  }
  throw new Error(`no real @cc/dsh-notify/core found; tried ${candidates.join(', ')}`)
}

// ── the threshold ladder on a real Session ─────────────────────────────────
const harness = createHarness()
apply(harness.ctx, { notify: false })
const session = Session.create(SessionId('proof-session'))

completeSteps(session, 298)
const at299 = await runPreStep(harness, session, 299)
check('299 — no reminder', at299.appended.length === 0 && at299.nextCalls === 1, `reminders=${at299.appended.length}`, {
  steps: 298,
  reminders: at299.appended.length,
  detail: '(below the first threshold)',
})

completeSteps(session, 299)
const at300 = await runPreStep(harness, session, 300)
const text300 = reminderText(at300.appended[0])
check(
  '300 — one soft',
  at300.appended.length === 1 && text300.includes('[session-budget soft 300]') && at300.nextCalls === 1,
  text300.includes('[session-budget soft 300]') ? '[session-budget soft 300]' : JSON.stringify(text300.slice(0, 80)),
  { steps: 299, reminders: at300.appended.length, detail: text300.includes('[session-budget soft 300]') ? '[session-budget soft 300]' : 'WRONG TEXT' },
)

const derivedAfter300 = session.deriveMessages().map((message) => message.content.map((block) => block.text ?? '').join('')).join('\n')
check('300 — the model sees it in the next request', derivedAfter300.includes('[session-budget soft 300]'), 'present in session.deriveMessages()')

completeSteps(session, 399)
const at400 = await runPreStep(harness, session, 400)
const text400 = reminderText(at400.appended[0])
check(
  '400 — second soft',
  at400.appended.length === 1 && text400.includes('[session-budget soft 400]'),
  text400.includes('[session-budget soft 400]') ? '[session-budget soft 400]' : JSON.stringify(text400.slice(0, 80)),
  { steps: 399, reminders: at400.appended.length, detail: text400.includes('[session-budget soft 400]') ? '[session-budget soft 400]' : 'WRONG TEXT' },
)

completeSteps(session, 499)
const at500 = await runPreStep(harness, session, 500)
const text500 = reminderText(at500.appended[0])
check(
  '500 — hard',
  at500.appended.length === 1 && text500.includes('[session-budget hard 500]') && text500.includes('Stop starting new work'),
  text500.includes('[session-budget hard 500]') ? '[session-budget hard 500]' : JSON.stringify(text500.slice(0, 80)),
  { steps: 499, reminders: at500.appended.length, detail: text500.includes('[session-budget hard 500]') ? '[session-budget hard 500]' : 'WRONG TEXT' },
)

const repeat = await runPreStep(harness, session, 500)
check('500 — no repeat on the same step', repeat.appended.length === 0 && repeat.nextCalls === 1, 'second pre-step for step 500 appends nothing', {
  steps: 499,
  reminders: repeat.appended.length,
  detail: 'second pre-step for step 500',
})

// ── compaction: a real surface replacement, on the real log ────────────────
const reminder300 = at300.appended[0]
const checkpoint = createUserMessage({
  content: [{ type: 'text', text: '[compaction checkpoint: proof]' }],
  source: { kind: 'compact-checkpoint', compactionId: 'proof-compaction' },
})
session.append('user/message', checkpoint, {
  surfaceOp: { op: 'replace', startSeq: reminder300.seq, endSeq: reminder300.seq },
  sourceEventSeqs: [reminder300.seq],
})
const stateAfterCompaction = harness.ctx.sessionProjections.stateOf(session, 'sessionBudget')
const derivedAfterCompaction = session
  .deriveMessages()
  .map((message) => message.content.map((block) => block.text ?? '').join(''))
  .join('\n')
const shadowed = !derivedAfterCompaction.includes('[session-budget soft 300]')
check(
  'compaction — count and marks survive the replace',
  stateAfterCompaction.steps === 499 &&
    stateAfterCompaction.fired.join(',') === '300,400,500' &&
    shadowed,
  `steps=${stateAfterCompaction.steps} fired=[${stateAfterCompaction.fired.join(',')}] shadowed=${shadowed}`,
  { steps: stateAfterCompaction.steps, reminders: '', detail: `fired=[${stateAfterCompaction.fired.join(',')}] shadowed=${shadowed}` },
)

const afterCompaction = await runPreStep(harness, session, 500)
check('compaction — no repeat at 500', afterCompaction.appended.length === 0, 'the shadowed mark still suppresses the reminder', {
  steps: 499,
  reminders: afterCompaction.appended.length,
  detail: 'shadowed mark still suppresses',
})

// ── failure containment: the turn never sees an exception ──────────────────
const brokenProjection = createHarness()
apply(brokenProjection.ctx, { notify: false })
brokenProjection.ctx.sessionProjections.stateOf = () => {
  throw new Error('projection exploded')
}
const brokenSession = Session.create(SessionId('proof-broken-projection'))
const brokenRun = await runPreStep(brokenProjection, brokenSession, 1)
check(
  'throwing projection — wrapped and logged',
  brokenRun.nextCalls === 1 && brokenProjection.warnings.some((warning) => warning.includes('step inspection failed')),
  brokenProjection.warnings.find((warning) => warning.includes('step inspection failed')) ?? 'no warning',
)

const brokenAppend = createHarness()
apply(brokenAppend.ctx, { notify: false })
brokenAppend.ctx.sessionProjections.stateOf = () => ({ steps: 299, fired: [] })
const failingSession = { id: 'proof-append', header: {}, seq: 0, snapshotEvents: () => [], append: () => { throw new Error('append exploded') } }
const appendHandler = brokenAppend.handlers.get('agent/pre-step')
let appendNextCalls = 0
await appendHandler(
  { agent: { session: failingSession }, turn: 1, step: 300, messages: [], signal: { aborted: false } },
  () => {
    appendNextCalls += 1
    return Promise.resolve({ kind: 'enter', messages: [] })
  },
)
check(
  'throwing append — wrapped and logged',
  appendNextCalls === 1 && brokenAppend.warnings.some((warning) => warning.includes('append exploded')),
  brokenAppend.warnings.find((warning) => warning.includes('append exploded')) ?? 'no warning',
)

// ── the notification: real command, detached spawn ────────────────────────
const notifyCore = await loadRealNotifyCore()
const config = resolveConfig({})
const spawnCalls = []
let unrefCalls = 0
let childErrorHandler = null
const observingSpawn = (command, args, options) => {
  spawnCalls.push({ command, args, options })
  return {
    on(event, handler) {
      if (event === 'error') childErrorHandler = handler
    },
    unref() {
      unrefCalls += 1
    },
  }
}
const notifyWarnings = []
const started = await notifyHuman({
  ctx: harness.ctx,
  config,
  input: notificationInput({ level: 'soft', threshold: 300, ordinal: 300, sessionId: 'proof-session' }),
  warnOnce: (_key, message) => notifyWarnings.push(String(message)),
  load: async () => notifyCore,
  spawn: observingSpawn,
})
const spawned = spawnCalls[0]
check(
  'notification — real notificationCommand, detached spawn',
  started === true && spawnCalls.length === 1 && spawned.options.detached === true && spawned.options.stdio === 'ignore' && unrefCalls === 1,
  spawned === undefined ? 'no spawn observed' : `${spawned.command} args=${spawned.args.length} detached=${spawned.options.detached} stdio=${spawned.options.stdio} unref=${unrefCalls}`,
)
check(
  'notification — env carries the reminder text',
  spawned !== undefined && String(spawned.options.env.DSH_NOTIFY_TITLE).includes('Session budget') && String(spawned.options.env.DSH_NOTIFY_BODY).includes('300 steps'),
  spawned === undefined ? 'no spawn observed' : `title=${JSON.stringify(spawned.options.env.DSH_NOTIFY_TITLE)}`,
)
childErrorHandler?.(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
check(
  'notification — child error consumed, not thrown',
  notifyWarnings.some((warning) => warning.includes('could not run')),
  notifyWarnings.find((warning) => warning.includes('could not run')) ?? 'no warning',
)

// A profile without @cc/dsh-notify: the default loader fails, the reminder still lands.
const missingNotifier = createHarness()
apply(missingNotifier.ctx, { notify: true })
const missingSession = Session.create(SessionId('proof-missing-notifier'))
completeSteps(missingSession, 299)
const missingRun = await runPreStep(missingNotifier, missingSession, 300)
await new Promise((resolve) => setTimeout(resolve, 100))
check(
  'missing notifier — reminder lands, failure logged once',
  missingRun.appended.length === 1 && missingNotifier.warnings.some((warning) => warning.includes('notification failed')),
  missingNotifier.warnings.find((warning) => warning.includes('notification failed')) ?? 'no warning',
)

// A guard on the exported shape: the marker parse is what makes the fired set durable.
check(
  'marker parse — text, not source',
  reminderThresholds({ type: 'user/message', data: { content: [{ type: 'text', text: '[session-budget hard 500]' }] } }).join(',') === '500',
  'reminderThresholds() reads the marker from the message content',
)

// ── the table ──────────────────────────────────────────────────────────────
const width = rows.reduce((max, row) => Math.max(max, row.scenario.length), 'scenario'.length)
const stepWidth = Math.max(5, ...rows.map((row) => String(row.steps).length))
const reminderWidth = Math.max(9, ...rows.map((row) => String(row.reminders).length))
console.log('session-budget proof — real Session, real projection fold, real notificationCommand')
console.log('')
console.log(`${'scenario'.padEnd(width)}  ${'steps'.padStart(stepWidth)}  ${'reminders'.padStart(reminderWidth)}  result`)
console.log(`${'-'.repeat(width)}  ${'-'.repeat(stepWidth)}  ${'-'.repeat(reminderWidth)}  ${'-'.repeat(48)}`)
for (const row of rows) {
  console.log(`${row.scenario.padEnd(width)}  ${String(row.steps).padStart(stepWidth)}  ${String(row.reminders).padStart(reminderWidth)}  ${row.ok ? 'PASS' : 'FAIL'} ${row.detail}`)
}
console.log('')
if (failed) {
  console.log(`session-budget proof: FAIL (${rows.length} checks)`)
  process.exitCode = 1
} else {
  console.log(`session-budget proof: PASS (${rows.length} checks)`)
  process.exitCode = 0
}
