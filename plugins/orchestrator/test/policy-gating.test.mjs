/*
PROOF: every root gets the working policy, the orchestrator gets its own part as well
Behavior: apply() registers one root policy section whose text is always the common working
  policy (Batch the work, Answering is not work, Report once) and, only when the session runs the
  POLICY_PRESET ('orchestrator'), the orchestration part (roles, delegation rules). A delegated
  child gets exactly CHILD_POLICY. The module header no longer claims both "applies to every
  preset" and "every other root gets no section".
Fails when: a non-orchestrator root loses the common part, a cordis/backend root receives the
  orchestration part, a child receives either root part, or the header contradiction returns.
Production path: plugins/orchestrator/orchestrator.mjs — ROOT_COMMON_POLICY, ROOT_POLICY,
  POLICY_PRESET, policyFor/rootText and the deployment:orchestrator-policy section.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { apply, CHILD_POLICY, POLICY_PRESET } from '../orchestrator.mjs'

const SOURCE = readFileSync(join(process.cwd(), 'plugins/orchestrator/orchestrator.mjs'), 'utf8')
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''

test('negative control expect-pre-fix keeps the pre-fix policy shape', () => {
  if (control !== 'expect-pre-fix') return
  // The pre-fix shape this change removes: one ROOT_POLICY, no common part, header contradiction.
  assert.match(SOURCE, /The policy applies to every preset/)
  assert.doesNotMatch(SOURCE, /ROOT_COMMON_POLICY/)
})

const COMMON_MARKERS = ['## Working policy', 'Batch the work', 'Answering is not work', 'Report once, when the work is done']
const ORCHESTRATOR_MARKERS = ['## Orchestration policy', '## Delegation rules', 'The seven roles are the tool sets']

function harness() {
  const sections = []
  const registered = []
  const handlers = []
  const ctx = {
    logger: { warn() {}, info() {} },
    on(event, handler) {
      if (event === 'agent/created') handlers.push(handler)
      return () => {}
    },
    get() { return undefined },
    effect(fn) { if (typeof fn === 'function') fn(); return () => {} },
    provide() { return () => {} },
    systemPrompt: { getSectionOrder: () => 100, section() {} },
  }
  ctx.root = ctx
  apply(ctx, { promptSections: true })
  const makeAgent = (header) => {
    const agent = {
      session: { id: 'session-1', header: { cwd: process.cwd(), ...header } },
      ctx: {
        systemPrompt: { section(spec) { sections.push(spec) } },
        tools: { register(tool) { registered.push(tool?.name ?? 'unknown'); return () => {} }, guard() {} },
        on() { return () => {} },
      },
    }
    for (const handler of handlers) handler({ agent })
    return agent
  }
  return { makeAgent, sections, registered }
}

const sectionText = (sections) => {
  const spec = sections[sections.length - 1]
  assert.ok(spec !== undefined, 'the agent received a policy section')
  return typeof spec.text === 'function' ? spec.text() : spec.text
}

test('the module header states the split without contradicting itself', () => {
  assert.match(SOURCE, /common working policy/i)
  assert.doesNotMatch(SOURCE, /The policy applies to every preset/)
  assert.doesNotMatch(SOURCE, /every other root gets no section/)
})

test('a root on another preset gets the common working policy only', () => {
  const { makeAgent, sections } = harness()
  makeAgent({ agentPreset: 'cordis', delegationDepth: 0 })
  const text = sectionText(sections)
  for (const marker of COMMON_MARKERS) assert.ok(text.includes(marker), `a cordis root lost the common marker: ${marker}`)
  for (const marker of ORCHESTRATOR_MARKERS) assert.ok(!text.includes(marker), `a cordis root received the orchestrator part: ${marker}`)
})

test('the orchestrator root gets the common working policy and its own part', () => {
  const { makeAgent, sections } = harness()
  makeAgent({ agentPreset: POLICY_PRESET, delegationDepth: 0 })
  const text = sectionText(sections)
  for (const marker of COMMON_MARKERS) assert.ok(text.includes(marker), `the orchestrator lost the common marker: ${marker}`)
  for (const marker of ORCHESTRATOR_MARKERS) assert.ok(text.includes(marker), `the orchestrator lost its own marker: ${marker}`)
  assert.ok(text.indexOf('## Working policy') < text.indexOf('## Orchestration policy'), 'the common part comes before the orchestration part')
})

test('a delegated child gets exactly CHILD_POLICY', () => {
  const { makeAgent, sections } = harness()
  makeAgent({ agentPreset: 'orchestrator', delegationDepth: 1, parentSession: 'parent-1' })
  assert.equal(sectionText(sections), CHILD_POLICY)
})
