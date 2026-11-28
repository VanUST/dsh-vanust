/*
PROOF: a delegation that declares architectureImpact does not start without the architect's
  decision in the Analysis Record - the flag decides, not the derived class
Behavior: delegate_task refuses with `architect_consult_required` and a message naming what to
  record (an ARCH- entry in decisions[], with components, invariants, checks and rollback) when
  architectureImpact is true and the record holds no such decision, whether changeClass is L2, L1
  or omitted (the record's gate answers "L1" for an omitted class); the same delegation passes
  when the decision is there; L0, L1 and L2 without architectureImpact keep their previous
  behaviour; the root policy states the rule before any refusal.
Fails when: the gate lets an unconsulted architectural change through - including one that omits
  changeClass or declares L1 - the refusal loses the code or the message that says what to write,
  a legal delegation is blocked, or the policy says nothing about the rule.
Production path: plugins/orchestrator/orchestrator.mjs - architectConsultation and the check in
  the delegate_task execute body after the analysis gate; the root policy bullet (DEC-002).
Control: CASE_NEGATIVE_CONTROL=expect-pre-fix asserts the pre-fix source has no such gate.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import * as plugin from '../orchestrator.mjs'

const { apply } = plugin
const architectConsultation = plugin.architectConsultation
const SOURCE = readFileSync(join(process.cwd(), 'plugins/orchestrator/orchestrator.mjs'), 'utf8')
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''

test('negative control expect-pre-fix has no architect gate', () => {
  if (control !== 'expect-pre-fix') return
  assert.doesNotMatch(SOURCE, /architect_consult_required/)
})

/**
 * A harness with the two services delegate_task reads: the board (records the create and the
 * child activation) and the analysis service. `gate` answers the way the real one does for the
 * classes this test uses; `read` returns the record this case sets up.
 */
function harness({ decisions = [] } = {}) {
  const calls = { create: [], startActivation: [] }
  const taskboard = {
    create: (cwd, input) => {
      calls.create.push(input)
      return { id: `task-gate-${calls.create.length}`, revision: 1, title: input.title, role: input.role, status: 'open', scope: [], nonScope: [], acceptance: [] }
    },
    agents: () => [],
    list: () => [],
    get: () => undefined,
    update: (cwd, input) => ({ ok: true, task: { id: input.id, revision: 2 } }),
    note: () => ({ ok: true }),
    registerAgent: () => ({ ok: true }),
    linkChild: () => ({ ok: true }),
  }
  const analysis = {
    gate: (cwd, input) => {
      if (input.changeClass === 'L0') return { ok: true, class: 'L0', analysisRequired: false }
      // The real gate answers "L1" when changeClass is omitted (plugins/analysis/store.mjs, effective).
      const klass = input.changeClass ?? 'L1'
      if (klass !== 'L1' && klass !== 'L2') return { ok: false, code: 'analysis_required', message: 'changeClass must be L0, L1 or L2' }
      if (String(input.initiative ?? '') === '') return { ok: false, code: 'analysis_required', message: `an ${klass} delegation needs analysisId` }
      return {
        ok: true,
        class: klass,
        analysisRequired: true,
        initiative: String(input.initiative),
        rev: 3,
        requirements: (input.requirementIds ?? []).map((id) => ({ id, status: 'planned' })),
      }
    },
    read: (cwd, input) => ({ ok: true, exists: true, initiative: input.initiative, record: { id: input.initiative, rev: 3, decisions } }),
    linkTask: () => ({ ok: true, rev: 4 }),
  }
  const services = new Map([['taskboard', taskboard], ['analysis', analysis]])
  const created = []
  const ctx = {
    logger: { warn() {}, info() {} },
    provide() {},
    effect(fn) {
      fn()
      return () => {}
    },
    on(event, handler) {
      if (event === 'agent/created') created.push(handler)
    },
    get(name) {
      return services.get(name)
    },
    systemPrompt: { getSectionOrder: () => undefined, section() {} },
    tools: { register() {}, guard() {} },
    subagents: {
      getProvider: () => ({ capabilities: { agentPreset: true, agentOptions: true } }),
      async startActivation() {
        const childId = `gate-child-${calls.startActivation.length}`
        calls.startActivation.push(childId)
        return { childId }
      },
      async sendMessage() {},
      interrupt() {},
    },
  }
  apply(ctx, {})
  const tools = new Map()
  const agent = {
    id: 'root-gate',
    session: { header: { id: 'root-gate', cwd: process.cwd(), agentPreset: 'orchestrator', delegationDepth: 0 } },
    ctx: {
      on() {},
      systemPrompt: { getSectionOrder: () => 100, section() {} },
      tools: { register: (definition) => tools.set(definition.name, definition), guard() {} },
    },
  }
  for (const handler of created) handler({ agent })
  const delegate = (args) => tools.get('delegate_task').execute({ ...args }, { agent, signal: new AbortController().signal })
  return { calls, delegate, tools }
}

const base = (overrides = {}) => ({
  title: 'architectural change',
  role: 'BACKEND',
  objective: 'change the contract',
  analysisId: 'architect-gate-and-plan-view',
  requirementIds: ['R1'],
  ...overrides,
})

test('architectConsultation is exported and finds an ARCH- decision', () => {
  assert.equal(typeof architectConsultation, 'function', 'architectConsultation is exported')
  const service = { read: () => ({ ok: true, exists: true, record: { decisions: [{ id: 'D-1' }, { id: 'arch-2', decision: 'x' }] } }) }
  assert.deepEqual(architectConsultation(service, '.', 'any'), { ok: true, decisionId: 'arch-2' })
})

test('an L2 change with architectureImpact and no ARCH- decision is refused before a task exists', async () => {
  const { calls, delegate } = harness({ decisions: [{ id: 'D-1', decision: 'a local choice', rationale: 'cheap' }] })
  const result = await delegate(base({ changeClass: 'L2', architectureImpact: true }))
  assert.equal(result?.ok, false)
  assert.equal(result?.code, 'architect_consult_required')
  assert.match(String(result.message), /ARCH-/)
  assert.match(String(result.message), /decisions\[\]/)
  assert.match(String(result.message), /components and invariants/)
  assert.match(String(result.message), /rollback/)
  assert.equal(calls.create.length, 0, 'no task row is written for a refused delegation')
  assert.equal(calls.startActivation.length, 0, 'no child is started for a refused delegation')
})

test('the same L2 change passes when the record carries the architect decision', async () => {
  const { calls, delegate } = harness({ decisions: [{ id: 'ARCH-1', decision: 'one seam, no second store', rationale: 'the ledger is the source', alternatives: ['a second store'] }] })
  const result = await delegate(base({ changeClass: 'L2', architectureImpact: true }))
  assert.notEqual(result?.ok, false, JSON.stringify(result))
  assert.equal(calls.create.length, 1)
  assert.equal(calls.startActivation.length, 1)
})

test('L0, L1 and L2 without architectureImpact are unaffected', async () => {
  const l0 = harness({ decisions: [] })
  assert.notEqual((await l0.delegate(base({ changeClass: 'L0' })))?.ok, false, 'L0 delegates without a record')

  const l1 = harness({ decisions: [] })
  assert.notEqual((await l1.delegate(base({ changeClass: 'L1' })))?.ok, false, 'L1 needs no architect decision')

  const l2plain = harness({ decisions: [] })
  assert.notEqual((await l2plain.delegate(base({ changeClass: 'L2' })))?.ok, false, 'L2 without architectureImpact needs no architect decision')
})

test('the flag decides, not the class: an omitted or low changeClass with architectureImpact is refused', async () => {
  // The critic's finding: the gate used to test the DERIVED class, so a delegation with the flag
  // and no changeClass got the record's "L1" answer and walked past the consultation.
  const unclassified = harness({ decisions: [] })
  const noClass = await unclassified.delegate(base({ architectureImpact: true }))
  assert.equal(noClass?.ok, false, 'a flagged delegation without changeClass was not refused')
  assert.equal(noClass?.code, 'architect_consult_required')
  assert.equal(unclassified.calls.create.length, 0, 'no task row is written for a refused delegation')
  assert.equal(unclassified.calls.startActivation.length, 0, 'no child is started for a refused delegation')

  const impactL1 = harness({ decisions: [] })
  const l1 = await impactL1.delegate(base({ changeClass: 'L1', architectureImpact: true }))
  assert.equal(l1?.ok, false, 'a flagged L1 delegation was not refused')
  assert.equal(l1?.code, 'architect_consult_required')

  // The same flag with the decision recorded passes, whatever the class says.
  const consulted = harness({ decisions: [{ id: 'ARCH-7', decision: 'keep the seam', rationale: 'measured' }] })
  const passed = await consulted.delegate(base({ architectureImpact: true }))
  assert.notEqual(passed?.ok, false, JSON.stringify(passed))
  assert.equal(consulted.calls.create.length, 1)
  assert.equal(consulted.calls.startActivation.length, 1)
})

test('the root policy states the rule before any refusal', () => {
  assert.match(SOURCE, /architect_consult_required/)
  assert.match(SOURCE, /An architecture change is consulted before it starts/)
})

test('a real Analysis Record read by the real store refuses without an ARCH- decision and passes with one', async () => {
  const { createService } = await import(pathToFileURL(join(process.cwd(), 'plugins', 'analysis', 'store.mjs')).href)
  const cwd = process.cwd()
  const initiative = 'architect-gate-and-plan-view'
  assert.equal(createService({}, { warn() {} }).gate(cwd, { changeClass: 'L2', initiative, requirementIds: ['R1'], architectureImpact: true, role: 'BACKEND', preset: 'backend' }).ok, true, 'the real record must be ready for this case')
  // Both halves run on COPIES of the workspace record: the first without any ARCH- decision, the
  // second with one. The workspace record is never edited by a test, and a legitimate ARCH- entry
  // written by the orchestrator does not turn this test red.
  const scratch = mkdtempSync(join(tmpdir(), 'architect-gate-'))
  try {
    mkdirSync(join(scratch, 'docs', 'analysis'), { recursive: true })
    const record = JSON.parse(readFileSync(join(cwd, 'docs', 'analysis', `${initiative}.json`), 'utf8'))
    const path = join(scratch, 'docs', 'analysis', `${initiative}.json`)
    record.decisions = [{ id: 'D-1', decision: 'a local choice', rationale: 'cheap' }]
    writeFileSync(path, JSON.stringify(record, null, 2))
    const refused = architectConsultation(createService({}, { warn() {} }), scratch, initiative)
    assert.equal(refused.ok, false)
    assert.equal(refused.code, 'architect_consult_required')

    record.decisions = [{ id: 'ARCH-1', decision: 'the gate reads the record it already gates', rationale: 'one place, no new field', alternatives: ['a second config file'] }]
    writeFileSync(path, JSON.stringify(record, null, 2))
    const passed = architectConsultation(createService({}, { warn() {} }), scratch, initiative)
    assert.deepEqual(passed, { ok: true, decisionId: 'ARCH-1' })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

