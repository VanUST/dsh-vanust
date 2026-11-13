#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove the three dsh-0.2.2 migration seams against the REAL plugin modules, without a
 *   server: the activation spec carries both harness shapes, flash-guard REFUSES a disallowed
 *   delegated route instead of rewriting it (0.2.2 freezes the route before `agent/request`),
 *   and session-budget reads the projection through the awaited 0.2.2 handle with the 0.2.1
 *   pair-read as its fallback.
 *
 * WHY IT EXISTS. Each of the three is a silent or a loud break on exactly one harness version:
 * a nested-only spec throws `Cannot read properties of undefined (reading 'id')` on 0.2.2; a
 * rewritten route now throws inside the turn after the task row exists; a projection read
 * through the deprecated pair logs a warning per step and stops being guaranteed. A check that
 * cannot fail proves nothing, so this script also runs against the previous bytes (see INPUTS)
 * and is expected to go red there.
 *
 * INPUTS
 *   --orchestrator <path>   default plugins/orchestrator/orchestrator.mjs
 *   --flash-guard <path>    default plugins/flash-guard/flash-guard.mjs
 *   --session-budget <path> default plugins/session-budget/session-budget.mjs
 *
 * OUTPUTS
 *   One PASS/FAIL line per check, then `n/m checks passed`; exit 0 only when every check held.
 *
 * KEYWORDS
 *   dsh 0.2.2, migration, startActivation, agent/request, route rewrite, session projection,
 *   awaited handle, regression proof
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The projection fixtures are fakes in the shape the two hosts expose, not mocks of the
 *     code under test: `register` either returns a thenable handle (0.2.2) or nothing (0.2.1),
 *     and the check asserts WHICH reader the plugin used, by counting calls on each.
 *   - A rejected registration must fall back, not mute the reminder; that is a check too.
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const value = (name, fallback) => {
  const at = argv.indexOf(name)
  return at >= 0 && at + 1 < argv.length ? resolve(argv[at + 1]) : join(KIT, fallback)
}
const orchestratorModule = value('--orchestrator', 'plugins/orchestrator/orchestrator.mjs')
const flashGuardModule = value('--flash-guard', 'plugins/flash-guard/flash-guard.mjs')
const sessionBudgetModule = value('--session-budget', 'plugins/session-budget/session-budget.mjs')

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

// Each section reports its own failure instead of aborting the run: a missing export on an
// older module is exactly the red this script exists to produce, and it must be a readable
// FAIL line rather than a stack trace that hides the other two sections.
const section = async (name, run) => {
  try {
    await run()
  } catch (error) {
    check(`${name} — the module could not be exercised`, false, error instanceof Error ? error.message : String(error))
  }
}

// ── 1. the activation spec carries both shapes ────────────────────────────────
await section('activation spec', async () => {
  const { activationSpec } = await import(pathToFileURL(orchestratorModule).href)
  const request = { prompt: [{ type: 'text', text: 'brief' }], parent: { id: 'parent-1' }, agentPreset: 'backend', cwd: '/tmp/ws' }
  const spec = activationSpec({ provider: 'spawn', label: 'BACKEND', signal: 'SIG', delivery: 'parent', request })
  // dsh 0.2.2 startActivation: `spec.parent.id`, `spec.maxDepth`, `spec.outputSchema`.
  const readFlat = (s) => s.parent?.id
  // dsh 0.2.1 startActivation: `spec.request.parent`, `spec.request.maxDepth`, …
  const readNested = (s) => s.request?.parent?.id
  check('0.2.1 reader finds the parent (spec.request.parent.id)', readNested(spec) === 'parent-1', `got ${readNested(spec)}`)
  check('0.2.2 reader finds the parent (spec.parent.id)', readFlat(spec) === 'parent-1', `got ${readFlat(spec)}`)
  check(
    'the rest of the request rides along in both shapes',
    spec.agentPreset === 'backend' && spec.request.agentPreset === 'backend' && spec.cwd === '/tmp/ws' && spec.request.cwd === '/tmp/ws'
      && Array.isArray(spec.prompt) && Array.isArray(spec.request.prompt),
  )
  check('provider/signal/delivery stay top-level only', spec.provider === 'spawn' && spec.signal === 'SIG' && spec.delivery === 'parent' && spec.request.provider === undefined)
})

// ── 2. flash-guard refuses, never rewrites ────────────────────────────────────
await section('flash-guard', async () => {
  const { normalizeConfig, guardDecision } = await import(pathToFileURL(flashGuardModule).href)
  const policy = normalizeConfig({
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    // The old production value: it must NOT bring the rewrite path back.
    onViolation: 'rewrite',
    allowedRoutes: [{ provider: 'deepseek-official', model: 'deepseek-flash' }],
  })
  check('onViolation "rewrite" resolves to "refuse"', policy.onViolation === 'refuse', `onViolation=${policy.onViolation}`)
  check('and it is reported as a replaced value, not silently accepted', policy.malformedOnViolation === true)
  const child = { session: { header: { delegationDepth: 1, parentSession: 'parent-1' } } }
  const disallowed = guardDecision({ provider: 'kimi-coding', model: 'k3.1-pro' }, child, policy)
  check('a disallowed delegated route is REFUSED', disallowed.action === 'refuse', `action=${disallowed.action}`)
  check(
    'the returned call is NOT mutated (no provider/model swap)',
    disallowed.call.provider === 'kimi-coding' && disallowed.call.model === 'k3.1-pro',
    `call=${disallowed.call.provider}/${disallowed.call.model}`,
  )
  const allowed = guardDecision({ provider: 'deepseek-official', model: 'deepseek-flash' }, child, policy)
  check('an allowed delegated route passes through', allowed.action === 'allow', `action=${allowed.action}`)
  const root = { session: { header: {} } }
  check('a root agent is untouched while enforceRoot is false', guardDecision({ provider: 'kimi-coding', model: 'k3.1-pro' }, root, policy).action === 'allow')
  const denied = normalizeConfig({ deniedModels: ['*highspeed*'], allowedRoutes: [] })
  const refuse = guardDecision({ provider: 'kimi-coding', model: 'kimi-for-coding-highspeed' }, root, denied)
  check('a deniedModels match is refused even for the root agent', refuse.action === 'refuse', `action=${refuse.action}`)
})

// ── 3. session-budget reads the awaited handle, with the legacy fallback ──────
await section('session-budget projection', async () => {
  const { apply, PROJECTION_KEY } = await import(pathToFileURL(sessionBudgetModule).href)
  /** Drive one pre-step through the real plugin over a host of the chosen shape. */
  const runStep = async ({ thenable, reject = false, state = { steps: 299, fired: [] } }) => {
    let listener
    let legacyReads = 0
    let handleReads = 0
    const appended = []
    const session = { header: { id: 'session-1', cwd: '/tmp/ws' }, append: (type, message) => appended.push({ type, message }) }
    const ctx = {
      logger: { warn() {}, info() {}, debug() {} },
      on(event, callback) {
        if (event === 'agent/pre-step') listener = callback
      },
      sessionProjections: {
        register(definition) {
          if (definition === undefined) throw new Error('session-budget registered nothing')
          if (!thenable) return undefined
          const handle = { stateOf: (target) => { handleReads += 1; return target === session ? state : undefined } }
          if (!reject) return Promise.resolve(handle)
          // A host does not let a failed registration surface as an unhandled rejection; the
          // fixture must not either, or an older plugin that ignores the promise kills the run
          // before the remaining checks print.
          const failed = Promise.reject(new Error('registration failed'))
          failed.catch(() => {})
          return failed
        },
        stateOf(target, key) {
          legacyReads += 1
          // The exact key the plugin registered: a wrong key here would silently test the
          // "no state yet" no-op instead of the fallback this check is about.
          return target === session && key === PROJECTION_KEY ? state : undefined
        },
      },
    }
    apply(ctx, { enabled: true, notify: false, thresholds: [300, 400, 500] })
    if (typeof listener !== 'function') throw new Error('no agent/pre-step listener registered')
    await listener({ agent: { session }, signal: { aborted: false } }, async () => ({ kind: 'enter', messages: [] }))
    return { legacyReads, handleReads, appended }
  }

  const modern = await runStep({ thenable: true })
  check('0.2.2: the awaited handle is the reader used', modern.handleReads === 1 && modern.legacyReads === 0, `handle=${modern.handleReads} legacy=${modern.legacyReads}`)
  check('0.2.2: the 300-step reminder is appended from that state', modern.appended.length === 1, `appended=${modern.appended.length}`)

  const legacy = await runStep({ thenable: false })
  check('0.2.1: a synchronous register falls back to the pair read', legacy.legacyReads === 1 && legacy.handleReads === 0, `handle=${legacy.handleReads} legacy=${legacy.legacyReads}`)
  check('0.2.1: the reminder still fires', legacy.appended.length === 1)

  const rejected = await runStep({ thenable: true, reject: true })
  check('a rejected registration falls back instead of muting the reminder', rejected.legacyReads === 1 && rejected.appended.length === 1, `legacy=${rejected.legacyReads} appended=${rejected.appended.length}`)
})

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exitCode = passed === results.length ? 0 : 1
