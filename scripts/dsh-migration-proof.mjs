#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove the two dsh-0.2.2 migration seams against the REAL plugin modules, without a
 *   server: the activation spec carries both harness shapes, flash-guard REFUSES a disallowed
 *   delegated route instead of rewriting it (0.2.2 freezes the route before `agent/request`),
 *   and session-budget reads the projection through the awaited 0.2.2 handle with the 0.2.1
 *   pair-read as its fallback.
 *
 * WHY IT EXISTS. Each of the two is a silent or a loud break on exactly one harness version:
 * a nested-only spec throws `Cannot read properties of undefined (reading 'id')` on 0.2.2; a
 * rewritten route now throws inside the turn after the task row exists; a projection read
 * through the deprecated pair logs a warning per step and stops being guaranteed. A check that
 * cannot fail proves nothing, so this script also runs against the previous bytes (see INPUTS)
 * and is expected to go red there.
 *
 * INPUTS
 *   --orchestrator <path>   default plugins/orchestrator/orchestrator.mjs
 *   --flash-guard <path>    default plugins/flash-guard/flash-guard.mjs

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


// The third seam (session-budget) was removed with the plugin on 2026-11-18.

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exitCode = passed === results.length ? 0 : 1
