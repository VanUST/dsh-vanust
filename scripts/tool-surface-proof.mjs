/**
 * PURPOSE
 *   Prove that the tool-families allow row now decides what a per-agent plugin may register,
 *   not only what tools.restrict can mask. Measured 2026-11-18: the root header carried 54
 *   tools, 8 of them (case_*, delegation_*, diagram) the orchestrator row never named, because
 *   tools.restrict masks global and ancestor registrations only and these plugins register
 *   into the agent's own layer.
 *
 * INPUTS
 *   The real allow rows, parsed from profile/cordis.patch.yml (the one owner of the policy),
 *   plus three fake hosts built here. No live server, no session, no write.
 *
 * OUTPUTS
 *   One table row per check, then 'tool-surface proof: PASS|FAIL (n checks)'. Exit 0 only when
 *   every row passed.
 *
 * KEYWORDS
 *   tool-families, allow list, per-agent registration, test-cases, delegation-brief, diagrams,
 *   role surface, context economy, proof
 */

import { readFileSync } from 'node:fs'

import { apply as applyFamilies } from '../plugins/tool-families/tool-families.mjs'
import { apply as applyDelegationBrief } from '../plugins/delegation-brief/index.mjs'
import { apply as applyTestCases } from '../plugins/test-cases/test-cases.mjs'
import { apply as applyDiagrams } from '../plugins/diagrams/index.js'

const PROFILE = new URL('../profile/cordis.patch.yml', import.meta.url)

/** Collect the '- name' entries under families.<preset>.allow in the real profile. */
function allowRow(preset) {
  const lines = readFileSync(PROFILE, 'utf8').split('\n')
  const trimmed = lines.map((line) => line.trim())
  const familiesAt = trimmed.indexOf('families:')
  if (familiesAt === -1) throw new Error('profile has no families block')
  const presetAt = trimmed.findIndex((line, index) => index > familiesAt && line === preset + ':')
  if (presetAt === -1) throw new Error('profile has no row for ' + preset)
  const allowAt = trimmed.findIndex((line, index) => index > presetAt && line === 'allow:')
  if (allowAt === -1) throw new Error('row ' + preset + ' has no allow list')
  const names = []
  for (let index = allowAt + 1; index < trimmed.length; index += 1) {
    const line = trimmed[index]
    if (!line.startsWith('- ')) break
    names.push(line.slice(2).trim())
  }
  return names
}

const rows = []
let failed = false
function check(scenario, ok, detail) {
  rows.push({ scenario, ok, detail: String(detail) })
  if (!ok) failed = true
}

/** A fake host that captures the toolFamilies service and the listeners. */
function host(families) {
  const handlers = new Map()
  const provided = new Map()
  const ctx = {
    on(event, handler) { handlers.set(event, handler) },
    provide(name, service) { provided.set(name, service); return service },
    effect(fn) { fn(); return () => {} },
    get(name) { return provided.get(name) },
    logger: { info() {}, warn() {}, error() {} },
    systemPrompt: { section() {} },
    commands: { register() {} },
    tools: { schemas: () => [], register() {} },
  }
  ctx.root = ctx
  applyFamilies(ctx, { families, projectMarkers: {} })
  return { ctx, handlers, service: provided.get('toolFamilies') }
}

/** A fake agent whose own layer captures registrations. */
function agentFor(sessionId, preset) {
  const registered = []
  return {
    registered,
    agent: {
      session: { id: sessionId, header: { agentPreset: preset, cwd: process.cwd() } },
      ctx: {
        tools: { register(tool) { registered.push(tool.name); return () => {} } },
        systemPrompt: { section() {} },
      },
    },
  }
}

const families = { orchestrator: { allow: allowRow('orchestrator') }, backend: { allow: allowRow('backend') } }

// delegation-brief: the row decides each of the two root tools
{
  const env = host(families)
  applyDelegationBrief(env.ctx, {})
  const { agent, registered } = agentFor('db-session', 'orchestrator')
  env.handlers.get('agent/created')({ agent })
  check('delegation_brief is registered (the row names it)', registered.includes('delegation_brief'), registered.join(',') || '(none)')
  check('delegation_return is not registered (the row omits it)', !registered.includes('delegation_return'), registered.join(',') || '(none)')
}

// diagrams: the row refuses the tool, the preset gate alone would allow it
{
  const env = host(families)
  applyDiagrams(env.ctx)
  const { agent, registered } = agentFor('dg-session', 'orchestrator')
  env.handlers.get('agent/created')({ agent })
  check('diagram is not registered for the orchestrator (the row omits it)', registered.length === 0, registered.join(',') || '(none)')
}

// test-cases: the intake subset survives, the rest of the family does not
{
  const env = host(families)
  applyTestCases(env.ctx, {})
  const { agent, registered } = agentFor('tc-session', 'orchestrator')
  env.handlers.get('agent/created')({ agent })
  const intake = ['case_record', 'case_list', 'case_get', 'case_drift']
  check('the case intake subset is registered', intake.every((name) => registered.includes(name)), registered.join(',') || '(none)')
  check('case_gate and case_run stay out of the root', !registered.includes('case_gate') && !registered.includes('case_run'), registered.join(',') || '(none)')
}

// a preset without a row keeps its plugins' own policy
{
  const env = host(families)
  applyDiagrams(env.ctx)
  const { agent, registered } = agentFor('std-session', 'standard')
  env.handlers.get('agent/created')({ agent })
  check('a preset without a row still gets diagram (no row = no filtering)', registered.includes('diagram'), registered.join(',') || '(none)')
}

const width = rows.reduce((max, row) => Math.max(max, row.scenario.length), 'scenario'.length)
console.log('tool-surface proof - rows parsed from profile/cordis.patch.yml\n')
for (const row of rows) console.log(row.scenario.padEnd(width) + '  ' + (row.ok ? 'PASS' : 'FAIL') + ' ' + row.detail)
console.log('')
console.log(failed ? 'tool-surface proof: FAIL (' + rows.length + ' checks)' : 'tool-surface proof: PASS (' + rows.length + ' checks)')
process.exitCode = failed ? 1 : 0
