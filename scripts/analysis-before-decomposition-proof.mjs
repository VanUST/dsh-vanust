#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove analysis-before-decomposition end to end against the REAL plugin modules: the
 *   Analysis Record store and its four root-only tools, the REAL `delegate_task` body, and a
 *   REAL taskboard service over a disposable board. One run answers the questions the owner
 *   asked: can an L1/L2 delegation start without a ready analysis, does a mid-work
 *   requirement change make the affected record stale, does the record survive a new chat,
 *   does an L0 local fix stay unblocked, and does completion separate proven requirements
 *   from explicitly deferred ones?
 *
 * WHY IT EXISTS. The owner stated the requirement on 2026-11-13 (docs/cases/
 * orchestrator-traces-requirements-through-system-design.json and
 * small-changes-skip-heavy-analysis.json): a non-trivial request must be traced from business
 * outcome through process, requirement, component, task and evidence BEFORE decomposition,
 * while a question or local L0 fix must not acquire a heavy document. This script is the
 * observed red-first proof for that requirement and the green proof after implementation; it
 * is not a restatement of the plugin internals.
 *
 * INPUTS
 *   --analysis <path>      analysis module to test (default plugins/analysis/analysis.mjs)
 *   --orchestrator <path>  orchestrator module (default plugins/orchestrator/orchestrator.mjs)
 *   --taskboard <path>     taskboard module (default plugins/taskboard/taskboard.mjs)
 *   --dir <path>           scratch directory (default: a temp dir)
 *   --keep                 keep the scratch directory for inspection
 *   No model call and no real child: `startActivation` is a recorder, so the proof is
 *   deterministic and free. The fake subagent provider exposes the same capabilities the
 *   installed provider must expose (agentPreset + agentOptions).
 *
 * OUTPUTS
 *   One PASS/FAIL line per check, then `n/m checks passed`; exit 0 only when every check
 *   passed, 1 otherwise. A failing line names the observed value, so the red run shows the
 *   missing behaviour rather than a stack trace.
 *
 * KEYWORDS
 *   analysis before decomposition, analysis record, delegate_task gate, analysis_required,
 *   analysis_stale, L0/L1/L2, requirement trace, designMapRev, red-first proof
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A missing analysis module is a recorded FAILURE of the checks, not a crash: the first
 *     red run of a new plugin must still print every other observation.
 *   - A thrown refusal is recorded as `{ok:false, code:'threw', message}` so one hard
 *     refusal cannot hide the remaining checks.
 *   - Module paths are imported through `pathToFileURL`, so the same script proves the
 *     working tree and a checkout of an earlier revision on either platform.
 *   - Cleanup is in a `finally`; --keep preserves the scratch tree for a failing run.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const value = (name) => {
  const at = argv.indexOf(name)
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : ''
}
const modulePath = (name, fallback) => (value(name) !== '' ? resolve(value(name)) : join(KIT, fallback))
const analysisModulePath = modulePath('--analysis', 'plugins/analysis/analysis.mjs')
const orchestratorModulePath = modulePath('--orchestrator', 'plugins/orchestrator/orchestrator.mjs')
const taskboardModulePath = modulePath('--taskboard', 'plugins/taskboard/taskboard.mjs')
const dir = value('--dir') !== '' ? resolve(value('--dir')) : mkdtempSync(join(tmpdir(), 'analysis-proof-'))
const keep = argv.includes('--keep')
mkdirSync(dir, { recursive: true })

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  const suffix = detail === undefined ? '' : `  ${JSON.stringify(detail)}`
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${suffix}\n`)
}

const boardPath = join(dir, 'taskboard.json')
const linksPath = join(dir, 'links.json')
writeFileSync(boardPath, `${JSON.stringify({ version: 1, revision: 1, tasks: [], agents: [] }, null, 2)}\n`)
const designPath = join(dir, 'design.excalidraw')
const writeDesign = (rev) => writeFileSync(designPath, `${JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'proof',
  elements: [],
  appState: {},
  files: {},
  designMap: { rev, updatedAt: '2026-11-13T00:00:00.000Z', updatedBy: 'human', title: 'proof map' },
}, null, 2)}\n`)
writeDesign(7)

const { createService: createTaskboard } = await import(pathToFileURL(taskboardModulePath).href)
const { apply: applyOrchestrator } = await import(pathToFileURL(orchestratorModulePath).href)
let analysisModule
let analysisImportError
try {
  analysisModule = await import(pathToFileURL(analysisModulePath).href)
} catch (error) {
  analysisImportError = error instanceof Error ? error.message : String(error)
}

const logger = { warn() {}, info() {}, debug() {} }
let seq = 0

/**
 * One fake harness over one disposable directory: a real taskboard service, the real
 * orchestrator plugin and (when it exists) the real analysis plugin. The subagent provider
 * records instead of spawning; a fresh harness over the same directory is the "new chat /
 * restart" case.
 */
function harness(options = {}) {
  const calls = { startActivation: [], sendMessage: [], interrupt: [] }
  const services = new Map()
  const created = []
  const taskboard = createTaskboard({ file: boardPath, linksFile: linksPath, maxTasks: 0, maxRows: 1000 }, logger, { interrupt: () => {} })
  services.set('taskboard', taskboard)
  const provider = { capabilities: { agentPreset: true, agentOptions: true } }
  const subagents = {
    getProvider: () => provider,
    async startActivation(spec) {
      const parentId = spec?.request?.parent?.id ?? spec?.parent?.id
      const childId = `proof-child-${++seq}`
      calls.startActivation.push({ childId, parentId, preset: spec?.request?.agentPreset ?? spec?.agentPreset })
      return { childId }
    },
    async sendMessage(parent, childId) {
      calls.sendMessage.push({ from: parent?.id, to: childId })
    },
    interrupt: (childId) => calls.interrupt.push(childId),
  }
  const ctx = {
    logger,
    provide(name, service) {
      services.set(name, service)
      return service
    },
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
    systemPrompt: { getSectionOrder: () => undefined, section: () => {} },
    tools: { register: () => {}, guard: () => {} },
    subagents,
  }
  if (analysisModule !== undefined && options.analysis !== false) {
    analysisModule.apply(ctx, { dir: 'docs/analysis', designMapFile: 'design.excalidraw' })
  }
  if (options.orchestrator !== false) applyOrchestrator(ctx, {})
  /**
   * Emit `agent/created` for one root/child and return the tools and sections it received.
   * The same event is what the installed harness fires, so registration scoping is proved
   * rather than inferred.
   */
  const agentFor = (id, header = {}) => {
    const tools = new Map()
    const guards = []
    const sections = []
    const agent = {
      id,
      session: { header: { id, cwd: dir, agentPreset: 'orchestrator', ...header } },
      ctx: {
        on: () => {},
        systemPrompt: { getSectionOrder: () => 100, section: (entry) => sections.push(entry) },
        tools: { register: (definition) => tools.set(definition.name, definition), guard: (definition) => guards.push(definition) },
      },
    }
    for (const handler of created) handler({ agent })
    return { agent, tools, guards, sections }
  }
  const call = async (tools, name, args, agent) => {
    const definition = tools.get(name)
    if (definition === undefined) return { missing: true, name }
    try {
      return await definition.execute(args, { agent, signal: new AbortController().signal })
    } catch (error) {
      return { ok: false, code: error?.code ?? 'threw', message: error instanceof Error ? error.message : String(error) }
    }
  }
  /** Run the monotonic guards the plugins registered, then the tool body. */
  const guarded = async (tools, guards, name, args, agent) => {
    for (const guard of guards) {
      let denial
      try {
        denial = await guard({ name, arguments: args, agent, signal: new AbortController().signal })
      } catch (error) {
        return { ok: false, code: error?.code ?? 'guard_threw', message: error instanceof Error ? error.message : String(error) }
      }
      if (typeof denial === 'string' && denial !== '') return { ok: false, code: 'guard_denied', message: denial }
      if (denial !== null && typeof denial === 'object' && typeof denial.reason === 'string') return { ok: false, code: denial.info?.code ?? 'guard_denied', message: denial.reason }
    }
    return call(tools, name, args, agent)
  }
  const delegate = (tools, agent, args) => call(tools, 'delegate_task', args, agent)
  return { ctx, taskboard, calls, agentFor, call, guarded, delegate, analysis: services.get('analysis') }
}

const rows = () => JSON.parse(readFileSync(boardPath, 'utf8')).tasks
const recordPath = (initiative) => join(dir, 'docs', 'analysis', `${initiative}.json`)
const readStored = (initiative) => JSON.parse(readFileSync(recordPath(initiative), 'utf8'))

/** A record that is complete enough to be `ready`: every checkable field is filled. */
const readyRecord = (overrides = {}) => ({
  title: 'Analysis proof initiative',
  requestedSolution: 'Implement analysis-before-decomposition.',
  businessOutcome: {
    problem: 'A root delegates implementation before the business outcome is separated from the requested solution.',
    outcome: 'Every L1/L2 delegation cites a ready Analysis Record whose trace reaches a task and its evidence.',
    successMetrics: ['L1/L2 delegation without a ready record returns analysis_required'],
  },
  process: {
    current: [{ id: 'P-0', name: 'delegate from chat memory', actors: ['root'] }],
    target: [{ id: 'P-1', name: 'analyse, then decompose', actors: ['root', 'specialist'] }],
  },
  requirements: [
    { id: 'REQ-1', kind: 'FR', text: 'A ready record gates L1/L2 delegation.', acceptance: ['analysis_required before a child starts'] },
    { id: 'REQ-2', kind: 'NFR', text: 'An L0 local fix stays unblocked.', acceptance: ['no record needed for L0'] },
  ],
  architecture: {
    contractImpact: 'none',
    components: [{
      id: 'C-1',
      name: 'analysis store',
      responsibility: 'Persist and validate the record',
      owner: 'BACKEND',
      owns: ['D-1'],
      dependsOn: [],
    }],
  },
  data: [{ id: 'D-1', name: 'docs/analysis/<initiative>.json', owner: 'BACKEND', description: 'one repo-tracked record per initiative' }],
  contracts: [],
  invariants: [{ id: 'I-1', text: 'A semantic edit without a re-check cannot keep the record ready.' }],
  decisions: [{ id: 'DEC-1', decision: 'The record is the only trace store.', rationale: 'The taskboard stays a lifecycle ledger.' }],
  openQuestions: [],
  trace: [
    { requirementId: 'REQ-1', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] },
    { requirementId: 'REQ-2', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] },
  ],
  sizing: { class: 'L1', reasons: ['one component, no external contract'] },
  ...overrides,
})

try {
  // ── 0. The plugin exists, provides a root-only service and four tools ───────
  check(
    'the analysis plugin exists and imports',
    analysisModule !== undefined,
    analysisImportError,
  )
  check(
    'the analysis plugin exports a service factory and apply()',
    analysisModule !== undefined && typeof analysisModule.createService === 'function' && typeof analysisModule.apply === 'function',
  )

  const a = harness()
  const root = a.agentFor('chat-a')
  const child = a.agentFor('child-a', { delegationDepth: 1, parentSession: 'chat-a', agentPreset: 'backend' })
  const ANALYSIS_TOOLS = ['analysis_read', 'analysis_upsert', 'analysis_check', 'analysis_impact']
  check('a root agent receives all four analysis tools', ANALYSIS_TOOLS.every((name) => root.tools.has(name)), [...root.tools.keys()])
  check('a delegated child receives no analysis tool', ANALYSIS_TOOLS.every((name) => !child.tools.has(name)), [...child.tools.keys()])
  check('the delegated tool is still registered', root.tools.has('delegate_task'))
  check('the analysis service is provided as `analysis`', a.analysis !== undefined && typeof a.analysis.gate === 'function')

  const call = (name, args) => a.call(root.tools, name, args, root.agent)
  const delegate = (args) => a.delegate(root.tools, root.agent, args)

  // ── 1. A record keeps the business outcome apart from the requested solution ─
  const created = await call('analysis_upsert', {
    initiative: 'analysis-proof',
    patch: readyRecord({ status: 'ready' }),
  })
  check('analysis_upsert creates a ready record', created?.ok === true, { code: created?.code, findings: created?.findings })
  const read = await call('analysis_read', { initiative: 'analysis-proof' })
  check(
    'the record keeps businessOutcome, requestedSolution and process apart',
    read?.record?.businessOutcome?.outcome?.includes('ready Analysis Record') === true &&
      read?.record?.requestedSolution === 'Implement analysis-before-decomposition.' &&
      read?.record?.process?.target?.[0]?.id === 'P-1',
    { businessOutcome: read?.record?.businessOutcome, requestedSolution: read?.record?.requestedSolution },
  )
  check('a ready record records the design map revision it was written against', read?.record?.designRef?.mapRev === 7, read?.record?.designRef)
  check('a fresh ready record has no findings', read?.check?.ok === true && read?.record?.status === 'ready', { check: read?.check, status: read?.record?.status })

  // ── 2. analysis_check finds incompleteness, not only malformed JSON ─────────
  const incomplete = await call('analysis_upsert', {
    initiative: 'incomplete-proof',
    patch: {
      title: 'Incomplete', requestedSolution: 'do the thing',
      businessOutcome: { problem: 'p', outcome: 'o' },
      process: { target: [{ id: 'P-1', name: 'target' }] },
      requirements: [{ id: 'REQ-1', kind: 'FR', text: 'unaccepted' }],
      architecture: { components: [{ id: 'C-1', name: 'component' }] },
      data: [{ id: 'D-1', name: 'data' }],
      trace: [],
    },
  })
  const incompleteCheck = await call('analysis_check', { initiative: 'incomplete-proof' })
  const codes = (incompleteCheck?.findings ?? []).map((finding) => finding.code)
  check('analysis_upsert creates a draft with incomplete fields', incomplete?.ok === true && incomplete?.record?.status === 'draft', incomplete?.code)
  check('analysis_check names the missing acceptance', codes.includes('missing_acceptance'), codes)
  check('analysis_check names the missing component ownership', codes.includes('missing_component_ownership'), codes)
  check('analysis_check names the missing data ownership', codes.includes('missing_data_ownership'), codes)
  check('analysis_check names the missing contract impact', codes.includes('missing_contract_impact'), codes)
  check('analysis_check names the unresolved trace', codes.includes('unresolved_trace'), codes)
  const forcedReady = await call('analysis_upsert', {
    initiative: 'incomplete-proof',
    expectedRev: incomplete?.rev,
    patch: { status: 'ready' },
  })
  check('an incomplete record cannot be marked ready', forcedReady?.ok === false && forcedReady?.code === 'analysis_incomplete', { code: forcedReady?.code, findings: forcedReady?.findings })

  // ── 3. L1 delegation without a ready record is refused, no row and no child ─
  const beforeRows = rows().length
  const startsBefore = a.calls.startActivation.length
  const required = await delegate({
    title: 'L1 without analysis', role: 'BACKEND', objective: 'implement without a record',
    changeClass: 'L1', analysisId: 'missing-initiative', requirementIds: ['REQ-1'], cwd: dir,
  })
  check('L1 delegation without a ready analysis is refused analysis_required', required?.ok === false && required?.code === 'analysis_required', required)
  check('a refused delegation creates no task row', rows().length === beforeRows, { before: beforeRows, after: rows().length })
  check('a refused delegation starts no child', a.calls.startActivation.length === startsBefore)

  // ── 4. A ready record lets the delegation start and traces the task ─────────
  const first = await delegate({
    title: 'L1 with analysis', role: 'BACKEND', objective: 'implement against the ready record',
    changeClass: 'L1', analysisId: 'analysis-proof', requirementIds: ['REQ-1'], cwd: dir,
  })
  check('L1 delegation with a ready analysis starts a child', first?.ok !== false && first?.taskId !== undefined && first?.childId !== undefined, first)
  check('the delegation reports the analysis it used', first?.analysisId === 'analysis-proof' && Array.isArray(first?.requirementIds) && first.requirementIds.includes('REQ-1'), { analysisId: first?.analysisId, requirementIds: first?.requirementIds })
  const traced = await call('analysis_read', { initiative: 'analysis-proof' })
  const req1Trace = (traced?.record?.trace ?? []).find((row) => row.requirementId === 'REQ-1')
  check(
    'the delegated task is traced on its requirement in the Analysis Record',
    req1Trace?.tasks?.some((task) => task.taskId === first?.taskId && task.role === 'BACKEND') === true,
    req1Trace?.tasks,
  )

  // ── 5. A mid-work requirement change gets an impact and makes the record stale ─
  const impact = await call('analysis_impact', {
    initiative: 'analysis-proof',
    expectedRev: traced?.rev,
    requirementId: 'REQ-1',
    kind: 'requirement',
    change: 'acceptance tightened after the first delegation started',
  })
  check('analysis_impact reports the affected requirement and task', impact?.ok === true && impact?.code === 'analysis_stale' && impact?.affected?.requirementIds?.includes('REQ-1') && impact?.affected?.taskIds?.includes(first?.taskId), { code: impact?.code, affected: impact?.affected })
  const startsBeforeStale = a.calls.startActivation.length
  const stale = await delegate({
    title: 'L1 after change', role: 'BACKEND', objective: 'continue after a requirement change',
    changeClass: 'L1', analysisId: 'analysis-proof', requirementIds: ['REQ-1'], cwd: dir,
  })
  check('delegation for the affected requirement is refused analysis_stale', stale?.ok === false && stale?.code === 'analysis_stale', stale)
  check('the stale refusal starts no child', a.calls.startActivation.length === startsBeforeStale)

  // ── 6. Compare-and-set: a stale revision cannot overwrite the record ────────
  const afterImpact = await call('analysis_read', { initiative: 'analysis-proof' })
  const conflict = await call('analysis_upsert', {
    initiative: 'analysis-proof',
    expectedRev: Math.max(0, (afterImpact?.rev ?? 0) - 1),
    patch: { title: 'a competing writer' },
  })
  check('an upsert with a stale revision is refused stale', conflict?.ok === false && conflict?.code === 'stale', { code: conflict?.code, currentRev: conflict?.currentRev })
  check('the refused upsert left the record unchanged', (await call('analysis_read', { initiative: 'analysis-proof' }))?.record?.title === 'Analysis proof initiative')

  // ── 7. Resolving the impact and re-checking opens the gate again ────────────
  const resolved = await call('analysis_upsert', {
    initiative: 'analysis-proof',
    expectedRev: afterImpact?.rev,
    resolveImpacts: 'all',
    patch: {
      status: 'ready',
      requirements: [
        { id: 'REQ-1', kind: 'FR', text: 'A ready record gates L1/L2 delegation.', acceptance: ['analysis_required before a child starts', 'analysis_stale after an affected change'] },
        { id: 'REQ-2', kind: 'NFR', text: 'An L0 local fix stays unblocked.', acceptance: ['no record needed for L0'] },
      ],
    },
  })
  check('a resolved and re-checked record becomes ready again', resolved?.ok === true && resolved?.record?.status === 'ready' && (resolved?.record?.pendingImpacts ?? []).length === 0, { code: resolved?.code, findings: resolved?.findings })
  const again = await delegate({
    title: 'L1 after resolution', role: 'BACKEND', objective: 'continue after the analysis is refreshed',
    changeClass: 'L1', analysisId: 'analysis-proof', requirementIds: ['REQ-1', 'REQ-2'], cwd: dir,
  })
  check('delegation is allowed again after the impact is resolved', again?.ok !== false && again?.childId !== undefined, { code: again?.code, message: again?.message })

  // ── 8. A new chat / restart reads the same record and trace from disk ──────
  const b = harness()
  const newChat = b.agentFor('chat-b')
  check('a new chat receives the analysis tools', ANALYSIS_TOOLS.every((name) => newChat.tools.has(name)), [...newChat.tools.keys()])
  const reloaded = await b.call(newChat.tools, 'analysis_read', { initiative: 'analysis-proof' }, newChat.agent)
  check(
    'a new chat reads the same record and traced task',
    reloaded?.exists === true && reloaded?.rev === (await call('analysis_read', { initiative: 'analysis-proof' }))?.rev &&
      (reloaded?.record?.trace ?? []).some((row) => (row.tasks ?? []).some((task) => task.taskId === first?.taskId)),
    { rev: reloaded?.rev, exists: reloaded?.exists },
  )

  // ── 9. L0 stays unblocked: no record, no gate ──────────────────────────────
  const startsBeforeL0 = a.calls.startActivation.length
  const l0 = await delegate({
    title: 'L0 local fix', role: 'BACKEND', objective: 'rename a local variable',
    changeClass: 'L0', cwd: dir,
  })
  check('an L0 delegation without any record is not blocked', l0?.ok !== false && l0?.childId !== undefined, { code: l0?.code, message: l0?.message })
  check('the L0 delegation created exactly one task and one child', rows().length > 0 && a.calls.startActivation.length === startsBeforeL0 + 1)

  // ── 10. Completion separates proven from explicitly deferred ───────────────
  const beforeComplete = await call('analysis_read', { initiative: 'analysis-proof' })
  const openCompletion = await call('analysis_check', { initiative: 'analysis-proof', forCompletion: true })
  check(
    'completion refuses while a requirement is still planned',
    openCompletion?.completion?.ok === false && openCompletion?.completion?.counts?.planned >= 1,
    openCompletion?.completion,
  )
  const completionTrace = (beforeComplete?.record?.trace ?? []).map((row) => {
    if (row.requirementId === 'REQ-1') {
      const tasks = (row.tasks ?? []).map((task, at) => (at === 0 ? { ...task, evidence: [...task.evidence, 'node scripts/analysis-before-decomposition-proof.mjs exit 0'] } : task))
      return { ...row, status: 'proven', tasks: tasks.length > 0 ? tasks : [{ taskId: first?.taskId, role: 'BACKEND', evidence: ['node scripts/analysis-before-decomposition-proof.mjs exit 0'] }] }
    }
    return { ...row, status: 'deferred', reason: 'explicitly deferred: the L0 case is proved by the harness run' }
  })
  const completedBlocked = await call('analysis_upsert', {
    initiative: 'analysis-proof',
    expectedRev: beforeComplete?.rev,
    patch: { status: 'completed' },
  })
  check('marking an unresolved initiative completed is refused', completedBlocked?.ok === false && completedBlocked?.code === 'completion_blocked', { code: completedBlocked?.code, findings: completedBlocked?.findings })
  const provenDeferred = await call('analysis_upsert', {
    initiative: 'analysis-proof',
    expectedRev: beforeComplete?.rev,
    resolveImpacts: 'all',
    patch: {
      status: 'ready',
      requirements: [
        { id: 'REQ-1', kind: 'FR', text: 'A ready record gates L1/L2 delegation.', acceptance: ['analysis_required before a child starts', 'analysis_stale after an affected change'], status: 'proven' },
        { id: 'REQ-2', kind: 'NFR', text: 'An L0 local fix stays unblocked.', acceptance: ['no record needed for L0'], status: 'deferred', reason: 'L0 has no record to gate; covered by the delegation harness check.' },
      ],
      trace: completionTrace,
    },
  })
  check(
    'completion records one proven and one explicitly deferred requirement',
    provenDeferred?.ok === true && provenDeferred?.completion?.counts?.proven === 1 && provenDeferred?.completion?.counts?.deferred === 1,
    { code: provenDeferred?.code, completion: provenDeferred?.completion },
  )
  const finish = await call('analysis_upsert', {
    initiative: 'analysis-proof',
    expectedRev: provenDeferred?.rev,
    patch: { status: 'completed' },
  })
  check('a fully proven/deferred initiative can be completed', finish?.ok === true && finish?.record?.status === 'completed', { code: finish?.code, findings: finish?.findings })

  // ── 11. designMapRev is a reference: a newer map makes architecture work stale ─
  const designRead = await call('analysis_read', { initiative: 'analysis-proof' })
  writeDesign(8)
  const afterDesign = await delegate({
    title: 'architecture change after map edit', role: 'BACKEND', objective: 'change the architecture after the map moved',
    changeClass: 'L2', analysisId: 'analysis-proof', requirementIds: ['REQ-1'], architectureImpact: true, cwd: dir,
  })
  check('architecture work against a moved design map is refused analysis_stale', afterDesign?.ok === false && afterDesign?.code === 'analysis_stale', { code: afterDesign?.code, message: afterDesign?.message })
  writeDesign(7)
  check('the earlier completed record carried its design revision', designRead?.record?.designRef?.mapRev === 7, designRead?.record?.designRef)

  // ── 12. A hand-edited file is caught by the semantic fingerprint ───────────
  const tamperInitiative = 'tamper-proof'
  const tamperCreate = await call('analysis_upsert', { initiative: tamperInitiative, patch: readyRecord({ status: 'ready' }) })
  const tamperFile = recordPath(tamperInitiative)
  check('the tamper fixture was written', tamperCreate?.ok === true && existsSync(tamperFile), { code: tamperCreate?.code })
  if (existsSync(tamperFile)) {
    const tampered = readStored(tamperInitiative)
    tampered.requirements[0].text = 'edited outside the tool'
    writeFileSync(tamperFile, `${JSON.stringify(tampered, null, 2)}\n`)
  }
  const tamperRead = await call('analysis_read', { initiative: tamperInitiative })
  check('analysis_read detects that the semantic fingerprint no longer matches', tamperRead?.fingerprintMatches === false && tamperRead?.stale?.code === 'fingerprint_mismatch', { fingerprintMatches: tamperRead?.fingerprintMatches, stale: tamperRead?.stale })
  const tamperGate = await delegate({
    title: 'delegate against a tampered record', role: 'BACKEND', objective: 'use a hand-edited analysis',
    changeClass: 'L1', analysisId: tamperInitiative, requirementIds: ['REQ-1'], cwd: dir,
  })
  check('a hand-edited record is refused analysis_stale at the gate', tamperGate?.ok === false && tamperGate?.code === 'analysis_stale', { code: tamperGate?.code, message: tamperGate?.message })

  // ── 13. An unknown requirement is not a ready analysis for this delegation ──
  const unknownFixture = await call('analysis_upsert', { initiative: 'unknown-proof', patch: readyRecord({ status: 'ready' }) })
  check('the unknown-requirement fixture is ready', unknownFixture?.ok === true, { code: unknownFixture?.code })
  const unknownReq = await delegate({
    title: 'unknown requirement', role: 'BACKEND', objective: 'delegate a requirement the record does not hold',
    changeClass: 'L1', analysisId: 'unknown-proof', requirementIds: ['REQ-404'], cwd: dir,
  })
  check('an unknown requirement id is refused analysis_required', unknownReq?.ok === false && unknownReq?.code === 'analysis_required', { code: unknownReq?.code, message: unknownReq?.message })
  // ── 14. Read-only presets are exempt from the analysis gate ────────────────
  for (const role of ['RESEARCH', 'REVIEWER', 'CRITIC']) {
    const readOnly = await delegate({ title: `${role} read-only`, role, objective: 'read the code and report', cwd: dir })
    check(`a ${role} delegation with no changeClass is exempt`, readOnly?.ok !== false && readOnly?.childId !== undefined, { code: readOnly?.code, message: readOnly?.message })
  }

  // ── 15. A legacy taskId attach keeps working without a record ──────────────
  const legacyTask = a.taskboard.create(dir, {
    title: 'legacy task before the analysis contour', role: 'BACKEND', preset: 'backend', objective: 'continue the pre-existing work',
    status: 'open', parentSessionId: root.agent.id, chatId: root.agent.id,
  }, 'orchestrator')
  const legacyId = legacyTask?.id ?? legacyTask?.task?.id
  const legacyBoard = JSON.parse(readFileSync(boardPath, 'utf8'))
  const legacyRow = legacyBoard.tasks.find((entry) => entry.id === legacyId)
  if (legacyRow !== undefined) legacyRow.createdAt = '2020-01-01T00:00:00.000Z'
  writeFileSync(boardPath, `${JSON.stringify(legacyBoard, null, 2)}\n`)
  const legacyAttach = await delegate({ title: 'attach legacy', role: 'BACKEND', objective: 'continue', taskId: legacyId, legacyAttach: true, cwd: dir })
  check('a legacy taskId attach with no changeClass is exempt', legacyAttach?.ok !== false && legacyAttach?.childId !== undefined, { code: legacyAttach?.code, message: legacyAttach?.message })

  // ── 16. A traced task cannot be closed while its requirement is planned ────
  const closeInit = await call('analysis_upsert', { initiative: 'close-proof', patch: readyRecord({ status: 'ready', title: 'Close proof' }) })
  check('the close-guard fixture is ready', closeInit?.ok === true, { code: closeInit?.code })
  const closeDelegation = await delegate({
    title: 'close guard task', role: 'BACKEND', objective: 'implement REQ-1',
    changeClass: 'L1', analysisId: 'close-proof', requirementIds: ['REQ-1'], cwd: dir,
  })
  check('the close-guard task is traced', closeDelegation?.ok !== false && closeDelegation?.taskId !== undefined, { code: closeDelegation?.code })
  const closeTask = a.taskboard.get(dir, closeDelegation?.taskId)
  a.taskboard.update(dir, {
    id: closeTask.id, expectedRevision: closeTask.revision, chatId: root.agent.id,
    patch: { status: 'review', result: { summary: 'implemented', evidence: ['proof run'] } },
  })
  root.tools.set('task_close', {
    name: 'task_close',
    execute: (args) => (Array.isArray(args.ids)
      ? a.taskboard.closeMany(dir, {
        ids: args.ids,
        parentSessionId: root.agent.id,
        chatId: root.agent.id,
        result: { summary: args.resultSummary, evidence: args.resultEvidence },
      })
      : a.taskboard.close(dir, {
        id: args.id,
        parentSessionId: root.agent.id,
        chatId: root.agent.id,
        result: { summary: args.resultSummary, evidence: args.resultEvidence },
      })),
  })
  const deniedClose = await a.guarded(root.tools, root.guards, 'task_close', { id: closeTask.id, resultSummary: 'done', resultEvidence: ['proof run'] }, root.agent)
  check('task_close is refused while the traced requirement is planned', deniedClose?.ok === false && /analysis/i.test(deniedClose?.message ?? ''), { code: deniedClose?.code, message: deniedClose?.message })
  const closeRecord = await call('analysis_read', { initiative: 'close-proof' })
  const closeUpsert = await call('analysis_upsert', {
    initiative: 'close-proof', expectedRev: closeRecord.rev,
    patch: {
      requirements: [
        { id: 'REQ-1', kind: 'FR', text: 'A ready record gates L1/L2 delegation.', acceptance: ['analysis_required before a child starts'], status: 'proven' },
        { id: 'REQ-2', kind: 'NFR', text: 'An L0 local fix stays unblocked.', acceptance: ['no record needed for L0'] },
      ],
      trace: [
        { requirementId: 'REQ-1', processId: 'P-1', componentId: 'C-1', status: 'proven', tasks: [{ taskId: closeTask.id, role: 'BACKEND', evidence: ['proof run'] }] },
        { requirementId: 'REQ-2', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] },
      ],
      status: 'ready',
    },
  })
  check('the traced requirement can be proven in the record', closeUpsert?.ok === true, { code: closeUpsert?.code, findings: closeUpsert?.findings })
  const allowedClose = await a.guarded(root.tools, root.guards, 'task_close', { id: closeTask.id, resultSummary: 'done', resultEvidence: ['proof run'] }, root.agent)
  check('task_close is allowed after the traced requirement is proven', allowedClose?.ok === true && allowedClose?.task?.status === 'done', { code: allowedClose?.code, message: allowedClose?.message, status: allowedClose?.task?.status })

  // ── 17. Design drift blocks architecture work, not ordinary L1 ─────────────
  const designInit = await call('analysis_upsert', { initiative: 'design-proof', patch: readyRecord({ status: 'ready', title: 'Design proof' }) })
  check('the design-drift fixture is ready', designInit?.ok === true, { code: designInit?.code })
  writeDesign(8)
  const nonArch = await delegate({
    title: 'contained L1 after the map moved', role: 'BACKEND', objective: 'contained change',
    changeClass: 'L1', analysisId: 'design-proof', requirementIds: ['REQ-1'], cwd: dir,
  })
  check('a non-architecture L1 survives a moved design map', nonArch?.ok !== false && nonArch?.childId !== undefined, { code: nonArch?.code, message: nonArch?.message })
  const arch = await delegate({
    title: 'architecture change after the map moved', role: 'BACKEND', objective: 'change the architecture',
    changeClass: 'L2', analysisId: 'design-proof', requirementIds: ['REQ-1'], architectureImpact: true, cwd: dir,
  })
  check('architecture work against a moved map is refused analysis_stale', arch?.ok === false && arch?.code === 'analysis_stale', { code: arch?.code, message: arch?.message })
  writeDesign(7)

  // ── 18. Adding/removing requirements and architecture edits reopen the record ─
  const changeInit = await call('analysis_upsert', { initiative: 'change-proof', patch: readyRecord({ status: 'ready', title: 'Change proof' }) })
  check('the change-proof fixture is ready', changeInit?.ok === true, { code: changeInit?.code })
  const added = await call('analysis_upsert', {
    initiative: 'change-proof', expectedRev: changeInit.rev,
    patch: {
      requirements: [
        { id: 'REQ-1', kind: 'FR', text: 'A ready record gates L1/L2 delegation.', acceptance: ['analysis_required before a child starts'] },
        { id: 'REQ-2', kind: 'NFR', text: 'An L0 local fix stays unblocked.', acceptance: ['no record needed for L0'] },
        { id: 'REQ-3', kind: 'BR', text: 'scope added after ready', acceptance: ['a3'] },
      ],
      trace: [
        { requirementId: 'REQ-1', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] },
        { requirementId: 'REQ-2', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] },
        { requirementId: 'REQ-3', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] },
      ],
    },
  })
  check('adding a requirement to a ready record records an impact', added?.ok === true && (added?.record?.pendingImpacts ?? []).length >= 1 && added?.record?.status === 'draft', { status: added?.record?.status, pending: added?.record?.pendingImpacts?.length, code: added?.code })
  const addedGate = await delegate({
    title: 'delegate an added requirement', role: 'BACKEND', objective: 'build the added scope',
    changeClass: 'L1', analysisId: 'change-proof', requirementIds: ['REQ-3'], cwd: dir,
  })
  check('an added requirement is refused analysis_stale before it is acknowledged', addedGate?.ok === false && addedGate?.code === 'analysis_stale', { code: addedGate?.code, message: addedGate?.message })
  const resolveAdded = await call('analysis_upsert', {
    initiative: 'change-proof', expectedRev: added.rev, resolveImpacts: 'all', patch: { status: 'ready' },
  })
  check('the added requirement can be acknowledged and the record made ready', resolveAdded?.ok === true && resolveAdded?.record?.status === 'ready', { code: resolveAdded?.code, findings: resolveAdded?.findings })
  const removed = await call('analysis_upsert', {
    initiative: 'change-proof', expectedRev: resolveAdded.rev,
    patch: {
      requirements: [
        { id: 'REQ-1', kind: 'FR', text: 'A ready record gates L1/L2 delegation.', acceptance: ['analysis_required before a child starts'] },
        { id: 'REQ-2', kind: 'NFR', text: 'An L0 local fix stays unblocked.', acceptance: ['no record needed for L0'] },
      ],
      trace: [
        { requirementId: 'REQ-1', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] },
        { requirementId: 'REQ-2', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] },
      ],
    },
  })
  check('removing a requirement from a ready record records an impact', removed?.ok === true && (removed?.record?.pendingImpacts ?? []).length >= 1 && removed?.record?.status === 'draft', { status: removed?.record?.status, pending: removed?.record?.pendingImpacts?.length, code: removed?.code })
  const resolveRemoved = await call('analysis_upsert', {
    initiative: 'change-proof', expectedRev: removed.rev, resolveImpacts: 'all', patch: { status: 'ready' },
  })
  check('the removed requirement can be acknowledged', resolveRemoved?.ok === true && resolveRemoved?.record?.status === 'ready', { code: resolveRemoved?.code, findings: resolveRemoved?.findings })
  const archChange = await call('analysis_upsert', {
    initiative: 'change-proof', expectedRev: resolveRemoved.rev,
    patch: {
      architecture: { contractImpact: 'breaking', components: [
        { id: 'C-1', name: 'analysis store', responsibility: 'Persist and validate the record', owner: 'BACKEND', owns: ['D-1'], dependsOn: [] },
        { id: 'C-2', name: 'new contract surface', responsibility: 'new', owner: 'BACKEND', owns: [], dependsOn: ['C-1'] },
      ] },
      contracts: [{ id: 'CT-1', name: 'trace API', between: ['C-1', 'C-2'], change: 'breaking', description: 'breaks callers' }],
    },
  })
  check('a breaking architecture/contract edit records an impact', archChange?.ok === true && (archChange?.record?.pendingImpacts ?? []).length >= 1 && archChange?.record?.status === 'draft', { status: archChange?.record?.status, pending: archChange?.record?.pendingImpacts?.length, code: archChange?.code, findings: archChange?.findings })
  const resolveArch = await call('analysis_upsert', {
    initiative: 'change-proof', expectedRev: archChange.rev, resolveImpacts: 'all', patch: { status: 'ready' },
  })
  check('the architecture change can be acknowledged', resolveArch?.ok === true && resolveArch?.record?.status === 'ready', { code: resolveArch?.code, findings: resolveArch?.findings })
  const deferred = await call('analysis_upsert', {
    initiative: 'change-proof', expectedRev: resolveArch.rev, resolveImpacts: 'all',
    patch: {
      requirements: [
        { id: 'REQ-1', kind: 'FR', text: 'A ready record gates L1/L2 delegation.', acceptance: ['analysis_required before a child starts'] },
        { id: 'REQ-2', kind: 'NFR', text: 'An L0 local fix stays unblocked.', acceptance: ['no record needed for L0'], status: 'deferred', reason: 'not in this build' },
      ],
      trace: [
        { requirementId: 'REQ-1', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] },
        { requirementId: 'REQ-2', processId: 'P-1', componentId: 'C-1', status: 'deferred', reason: 'not in this build', tasks: [] },
      ],
      status: 'ready',
    },
  })
  check('a deferred requirement can be recorded ready', deferred?.ok === true, { code: deferred?.code, findings: deferred?.findings })
  const deferredGate = await delegate({
    title: 'delegate a deferred requirement', role: 'BACKEND', objective: 'build what was deferred',
    changeClass: 'L1', analysisId: 'change-proof', requirementIds: ['REQ-2'], cwd: dir,
  })
  check('a deferred requirement is refused analysis_required', deferredGate?.ok === false && deferredGate?.code === 'analysis_required', { code: deferredGate?.code, message: deferredGate?.message })

  // ── 19. A removed requirement with a traced task is refused ────────────────
  const traceInit = await call('analysis_upsert', { initiative: 'trace-proof', patch: readyRecord({ status: 'ready', title: 'Trace proof' }) })
  const traceDelegation = await delegate({
    title: 'traced task', role: 'BACKEND', objective: 'implement REQ-1',
    changeClass: 'L1', analysisId: 'trace-proof', requirementIds: ['REQ-1'], cwd: dir,
  })
  const traceRead = await call('analysis_read', { initiative: 'trace-proof' })
  const removeTraced = await call('analysis_upsert', {
    initiative: 'trace-proof', expectedRev: traceRead.rev,
    patch: {
      requirements: [{ id: 'REQ-2', kind: 'NFR', text: 'An L0 local fix stays unblocked.', acceptance: ['no record needed for L0'] }],
      trace: [{ requirementId: 'REQ-2', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] }],
    },
  })
  check('removing a requirement that still has a traced task is refused', traceInit?.ok === true && traceDelegation?.ok !== false && removeTraced?.ok === false && removeTraced?.code === 'requirement_has_tasks', { code: removeTraced?.code, message: removeTraced?.message })

  // ── 20. A bare designRef bump cannot clear drift ───────────────────────────
  const designRefInit = await call('analysis_upsert', { initiative: 'designref-proof', patch: readyRecord({ status: 'ready', title: 'DesignRef proof' }) })
  writeDesign(8)
  const bareBump = await call('analysis_upsert', {
    initiative: 'designref-proof', expectedRev: designRefInit.rev,
    patch: { designRef: { mapRev: 8, at: 'proof', source: 'design.excalidraw' }, status: 'ready' },
  })
  check('a bare designRef bump is refused or reopens the record', bareBump?.ok === false || ((bareBump?.record?.pendingImpacts ?? []).length >= 1 && bareBump?.record?.status !== 'ready'), { code: bareBump?.code, status: bareBump?.record?.status, pending: bareBump?.record?.pendingImpacts?.length })
  writeDesign(7)

  // ── 21. Goal completion is gated for a linked initiative ───────────────────
  root.tools.set('update_goal', { name: 'update_goal', execute: (args) => ({ ok: true, status: args.action }) })
  const goalInit = await call('analysis_upsert', { initiative: 'goal-proof', patch: { ...readyRecord({ status: 'ready', title: 'Goal proof' }), goalId: 'goal-1' } })
  const goalDenied = await a.guarded(root.tools, root.guards, 'update_goal', { goal_id: 'goal-1', revision: 1, action: 'complete' }, root.agent)
  check('goal completion is refused while the linked initiative is not completed', goalInit?.ok === true && goalDenied?.ok === false && /analysis/i.test(goalDenied?.message ?? ''), { code: goalDenied?.code, message: goalDenied?.message })
  // ── 22. Forged role / preset-only read-only exemption ──────────────────────
  const forgedHarness = harness()
  const forgedRoot = forgedHarness.agentFor('chat-forged')
  const forgedRole = await forgedHarness.call(forgedRoot.tools, 'delegate_task', { title: 'forged research', role: 'RESEARCH', preset: 'backend', objective: 'write with a read-only label', cwd: dir }, forgedRoot.agent)
  check('a read-only role with a write preset is gated', forgedRole?.ok === false && forgedRole?.code === 'analysis_required', { code: forgedRole?.code, message: forgedRole?.message })
  const presetHarness = harness()
  const presetRoot = presetHarness.agentFor('chat-preset')
  const presetResearch = await presetHarness.call(presetRoot.tools, 'delegate_task', { title: 'preset research', role: 'BACKEND', preset: 'research', objective: 'read-only work', cwd: dir }, presetRoot.agent)
  check('a read-only preset is exempt regardless of the role label', presetResearch?.ok !== false && presetResearch?.childId !== undefined, { code: presetResearch?.code, message: presetResearch?.message })
  const optInHarness = harness()
  const optInRoot = optInHarness.agentFor('chat-optin')
  const readOnlyOptIn = await optInHarness.call(optInRoot.tools, 'delegate_task', { title: 'read-only opt-in', role: 'RESEARCH', preset: 'research', objective: 'read only', changeClass: 'L1', analysisId: 'missing-initiative', requirementIds: ['REQ-1'], cwd: dir }, optInRoot.agent)
  check('an explicit class/record opts a read-only delegation back into the gate', readOnlyOptIn?.ok === false && readOnlyOptIn?.code === 'analysis_required', { code: readOnlyOptIn?.code, message: readOnlyOptIn?.message })

  // ── 23. Legacy attach only for a pre-existing task ─────────────────────────
  const freshTask = a.taskboard.create(dir, {
    title: 'fresh task after the contour', role: 'BACKEND', preset: 'backend', objective: 'new work',
    status: 'open', parentSessionId: root.agent.id, chatId: root.agent.id,
  }, 'orchestrator')
  const freshAttach = await delegate({ title: 'attach fresh', role: 'BACKEND', objective: 'new work', taskId: freshTask?.id ?? freshTask?.task?.id, cwd: dir })
  check('a fresh task attach with no class is refused analysis_required', freshAttach?.ok === false && freshAttach?.code === 'analysis_required', { code: freshAttach?.code, message: freshAttach?.message })
  const oldBoard = JSON.parse(readFileSync(boardPath, 'utf8'))
  const oldRow = oldBoard.tasks.find((entry) => entry.id === (freshTask?.id ?? freshTask?.task?.id))
  if (oldRow !== undefined) oldRow.createdAt = '2020-01-01T00:00:00.000Z'
  writeFileSync(boardPath, `${JSON.stringify(oldBoard, null, 2)}\n`)
  const oldAttach = await delegate({ title: 'attach old', role: 'BACKEND', objective: 'continue pre-existing work', taskId: freshTask?.id ?? freshTask?.task?.id, legacyAttach: true, cwd: dir })
  check('a pre-existing task attach is exempt', oldAttach?.ok !== false && oldAttach?.childId !== undefined, { code: oldAttach?.code, message: oldAttach?.message })

  // ── 24. Process changes are semantic impacts ───────────────────────────────
  const processInit = await call('analysis_upsert', { initiative: 'process-proof', patch: readyRecord({ status: 'ready', title: 'Process proof' }) })
  const processChange = await call('analysis_upsert', {
    initiative: 'process-proof', expectedRev: processInit.rev,
    patch: { process: { target: [{ id: 'P-1', name: 'changed process' }] } },
  })
  check('a process change on a ready record records an impact', processChange?.ok === true && (processChange?.record?.pendingImpacts ?? []).length >= 1 && processChange?.record?.status === 'draft', { status: processChange?.record?.status, pending: processChange?.record?.pendingImpacts?.length, code: processChange?.code })

  // ── 25. Malformed records fail closed for the completion guards ────────────
  const malformedInit = await call('analysis_upsert', { initiative: 'malformed-task', patch: readyRecord({ status: 'ready', title: 'Malformed task proof' }) })
  const malformedTask = await delegate({
    title: 'malformed traced task', role: 'BACKEND', objective: 'implement REQ-1',
    changeClass: 'L1', analysisId: 'malformed-task', requirementIds: ['REQ-1'], cwd: dir,
  })
  writeFileSync(recordPath('malformed-task'), `<<<<<<< HEAD\n${malformedTask?.taskId ?? 'task-x'}\n=======\n>>>>>>> branch\n`)
  const malformedRow = a.taskboard.get(dir, malformedTask?.taskId)
  if (malformedRow !== undefined) a.taskboard.update(dir, { id: malformedRow.id, expectedRevision: malformedRow.revision, chatId: root.agent.id, patch: { status: 'review', result: { summary: 'done', evidence: ['x'] } } })
  const malformedClose = await a.guarded(root.tools, root.guards, 'task_close', { id: malformedTask?.taskId, resultSummary: 'done', resultEvidence: ['x'] }, root.agent)
  check('task_close fails closed when the traced record is malformed', malformedInit?.ok === true && malformedClose?.ok === false && /analysis/i.test(malformedClose?.message ?? ''), { code: malformedClose?.code, message: malformedClose?.message })
  const malformedGoalInit = await call('analysis_upsert', { initiative: 'malformed-goal', patch: { ...readyRecord({ status: 'ready', title: 'Malformed goal proof' }), goalId: 'goal-malformed' } })
  writeFileSync(recordPath('malformed-goal'), `<<<<<<< HEAD\ngoal-malformed\n=======\n>>>>>>> branch\n`)
  const malformedGoal = await a.guarded(root.tools, root.guards, 'update_goal', { goal_id: 'goal-malformed', revision: 1, action: 'complete' }, root.agent)
  check('goal completion fails closed when the linked record is malformed', malformedGoalInit?.ok === true && malformedGoal?.ok === false && /analysis/i.test(malformedGoal?.message ?? ''), { code: malformedGoal?.code, message: malformedGoal?.message })

  // ── 26. Multi-task requirement: only the last outstanding close is blocked ─
  const multiInit = await call('analysis_upsert', { initiative: 'multi-proof', patch: readyRecord({ status: 'ready', title: 'Multi task proof' }) })
  const multiOne = await delegate({ title: 'multi task one', role: 'BACKEND', objective: 'implement REQ-1', changeClass: 'L1', analysisId: 'multi-proof', requirementIds: ['REQ-1'], cwd: dir })
  const multiTwo = await delegate({ title: 'multi task two', role: 'BACKEND', objective: 'implement REQ-1 more', changeClass: 'L1', analysisId: 'multi-proof', requirementIds: ['REQ-1'], cwd: dir })
  const setReview = (id) => {
    const row = a.taskboard.get(dir, id)
    return a.taskboard.update(dir, { id, expectedRevision: row.revision, chatId: root.agent.id, patch: { status: 'review', result: { summary: 'done', evidence: ['x'] } } })
  }
  setReview(multiOne.taskId)
  setReview(multiTwo.taskId)
  const nonLastClose = await a.guarded(root.tools, root.guards, 'task_close', { id: multiOne.taskId, resultSummary: 'done', resultEvidence: ['x'] }, root.agent)
  check('closing a non-last task on a planned requirement is allowed', multiInit?.ok === true && nonLastClose?.ok === true, { code: nonLastClose?.code, message: nonLastClose?.message })
  const lastClose = await a.guarded(root.tools, root.guards, 'task_close', { id: multiTwo.taskId, resultSummary: 'done', resultEvidence: ['x'] }, root.agent)
  check('closing the last outstanding task on a planned requirement is refused', lastClose?.ok === false && /analysis/i.test(lastClose?.message ?? ''), { code: lastClose?.code, message: lastClose?.message })

  // ── 27. GoalId is a commitment: unlink is refused on a ready record ────────
  const goalLock = await call('analysis_upsert', { initiative: 'goal-lock', patch: { ...readyRecord({ status: 'ready', title: 'Goal lock' }), goalId: 'goal-lock' } })
  const unlink = await call('analysis_upsert', { initiative: 'goal-lock', expectedRev: goalLock.rev, patch: { goalId: '' } })
  check('unlinking goalId on a ready record is refused', goalLock?.ok === true && unlink?.ok === false && unlink?.code === 'goal_link_locked', { code: unlink?.code, message: unlink?.message })

  // ── 28. Hand edits need an explicit acknowledgement ────────────────────────
  const handInit = await call('analysis_upsert', { initiative: 'hand-proof', patch: readyRecord({ status: 'ready', title: 'Hand edit proof' }) })
  const handFile = recordPath('hand-proof')
  const handStored = readStored('hand-proof')
  handStored.requirements[0].text = 'HAND EDIT: different requirement'
  writeFileSync(handFile, `${JSON.stringify(handStored, null, 2)}\n`)
  const benign = await call('analysis_upsert', { initiative: 'hand-proof', expectedRev: handInit.rev, patch: { title: 'benign' } })
  check('a hand edit is refused until it is explicitly acknowledged', benign?.ok === false && benign?.code === 'fingerprint_mismatch', { code: benign?.code, message: benign?.message })
  const afterBenign = await call('analysis_read', { initiative: 'hand-proof' })
  const accepted = await call('analysis_upsert', { initiative: 'hand-proof', expectedRev: afterBenign?.rev, acceptHandEdit: true, patch: { title: 'benign' } })
  check('an explicitly acknowledged hand edit can be repaired', accepted?.ok === true, { code: accepted?.code, findings: accepted?.findings })

  // ── 29. linkTask honours expectedRev ──────────────────────────────────────
  const linkInit = await call('analysis_upsert', { initiative: 'link-proof', patch: readyRecord({ status: 'ready', title: 'Link CAS proof' }) })
  const staleLink = a.analysis.linkTask(dir, { initiative: 'link-proof', requirementIds: ['REQ-1'], taskId: 'task-cas', expectedRev: 0 })
  check('linkTask refuses a stale expectedRev', linkInit?.ok === true && staleLink?.ok === false && staleLink?.code === 'stale', { code: staleLink?.code, message: staleLink?.message })

  // ── 30. A trace-only upsert cannot remove a task link from a ready record ──
  const unlinkInit = await call('analysis_upsert', { initiative: 'unlink-proof', patch: readyRecord({ status: 'ready', title: 'Trace unlink proof' }) })
  const unlinkTask = await delegate({ title: 'trace unlink task', role: 'BACKEND', objective: 'implement REQ-1', changeClass: 'L1', analysisId: 'unlink-proof', requirementIds: ['REQ-1'], cwd: dir })
  const unlinkRead = await call('analysis_read', { initiative: 'unlink-proof' })
  const traceRemoval = await call('analysis_upsert', {
    initiative: 'unlink-proof', expectedRev: unlinkRead.rev,
    patch: { trace: [
      { requirementId: 'REQ-1', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] },
      { requirementId: 'REQ-2', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] },
    ] },
  })
  check('removing a traced task from a ready record is refused', unlinkInit?.ok === true && unlinkTask?.ok !== false && traceRemoval?.ok === false && traceRemoval?.code === 'trace_task_removal', { code: traceRemoval?.code, message: traceRemoval?.message })



  // ── 35. Deferring/rejecting a requirement is a semantic change ─────────────
  const statusInit = await call('analysis_upsert', { initiative: 'status-proof', patch: readyRecord({ status: 'ready', title: 'Status proof' }) })
  const statusRead = await call('analysis_read', { initiative: 'status-proof' })
  const deferredChange = await call('analysis_upsert', {
    initiative: 'status-proof', expectedRev: statusRead.rev,
    patch: { requirements: [
      { id: 'REQ-1', kind: 'FR', text: 'A ready record gates L1/L2 delegation.', acceptance: ['analysis_required before a child starts'] },
      { id: 'REQ-2', kind: 'NFR', text: 'An L0 local fix stays unblocked.', acceptance: ['no record needed for L0'], status: 'deferred', reason: 'not in this build' },
    ] },
  })
  check('deferring a requirement on a ready record records an impact', statusInit?.ok === true && deferredChange?.ok === true && (deferredChange?.record?.pendingImpacts ?? []).length >= 1 && deferredChange?.record?.status === 'draft', { status: deferredChange?.record?.status, pending: deferredChange?.record?.pendingImpacts?.length, code: deferredChange?.code })

  // ── 32. Trace MAPPING changes are semantic impacts; task links are still not ─
  const mappingInit = await call('analysis_upsert', {
    initiative: 'mapping-proof',
    patch: readyRecord({
      status: 'ready',
      title: 'Mapping proof',
      architecture: {
        contractImpact: 'none',
        components: [
          { id: 'C-1', name: 'analysis store', responsibility: 'persist', owner: 'BACKEND', owns: ['D-1'], dependsOn: [] },
          { id: 'C-2', name: 'other store', responsibility: 'other', owner: 'BACKEND', owns: [], dependsOn: [] },
        ],
      },
      process: { target: [{ id: 'P-1', name: 'one' }, { id: 'P-2', name: 'two' }] },
      trace: [{ requirementId: 'REQ-1', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] }, { requirementId: 'REQ-2', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] }],
    }),
  })
  const remapped = await call('analysis_upsert', {
    initiative: 'mapping-proof', expectedRev: mappingInit.rev,
    patch: { trace: [
      { requirementId: 'REQ-1', processId: 'P-2', componentId: 'C-2', status: 'planned', tasks: [] },
      { requirementId: 'REQ-2', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] },
    ] },
  })
  check('a trace mapping change on a ready record records an impact', mappingInit?.ok === true && remapped?.ok === true && (remapped?.record?.pendingImpacts ?? []).length >= 1 && remapped?.record?.status === 'draft', { status: remapped?.record?.status, pending: remapped?.record?.pendingImpacts?.length, code: remapped?.code })
  const mappingRead = await call('analysis_read', { initiative: 'mapping-proof' })
  check('the mapping change is visible in the semantic fingerprint', mappingRead?.fingerprintMatches === true, { fingerprintMatches: mappingRead?.fingerprintMatches })

  // ── 33. Task links cannot be erased from a draft record either ─────────────
  const draftUnlinkInit = await call('analysis_upsert', { initiative: 'draft-unlink', patch: readyRecord({ status: 'ready', title: 'Draft unlink proof' }) })
  const draftUnlinkTask = await delegate({ title: 'draft unlink task', role: 'BACKEND', objective: 'implement REQ-1', changeClass: 'L1', analysisId: 'draft-unlink', requirementIds: ['REQ-1'], cwd: dir })
  const draftUnlinkRead = await call('analysis_read', { initiative: 'draft-unlink' })
  const toDraft = await call('analysis_upsert', { initiative: 'draft-unlink', expectedRev: draftUnlinkRead.rev, patch: { status: 'draft' } })
  const draftRemoval = await call('analysis_upsert', {
    initiative: 'draft-unlink', expectedRev: toDraft.rev,
    patch: { trace: [
      { requirementId: 'REQ-1', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] },
      { requirementId: 'REQ-2', processId: 'P-1', componentId: 'C-1', status: 'planned', tasks: [] },
    ] },
  })
  check('removing a traced task from a draft record is also refused', draftUnlinkInit?.ok === true && draftUnlinkTask?.ok !== false && toDraft?.ok === true && draftRemoval?.ok === false && draftRemoval?.code === 'trace_task_removal', { code: draftRemoval?.code, message: draftRemoval?.message })

  // ── 34. legacyAttach is explicit; an explicit class still opts back in ─────
  const explicitLegacy = await delegate({ title: 'explicit legacy fresh', role: 'BACKEND', objective: 'fresh work', taskId: freshTask?.id ?? freshTask?.task?.id, legacyAttach: true, cwd: dir })
  check('legacyAttach:true is an explicit escape hatch', explicitLegacy?.ok !== false && explicitLegacy?.childId !== undefined, { code: explicitLegacy?.code, message: explicitLegacy?.message })
  const legacyOptIn = await delegate({ title: 'legacy opt-in', role: 'BACKEND', objective: 'fresh work with a class', taskId: freshTask?.id ?? freshTask?.task?.id, legacyAttach: true, changeClass: 'L1', analysisId: 'missing-initiative', requirementIds: ['REQ-1'], cwd: dir })
  check('an explicit class overrides legacyAttach', legacyOptIn?.ok === false && legacyOptIn?.code === 'analysis_required', { code: legacyOptIn?.code, message: legacyOptIn?.message })

  // ── 31. A batch closes when every traced task is closable; a mixed batch is atomic ─
  const batchInit = await call('analysis_upsert', { initiative: 'batch-proof', patch: readyRecord({ status: 'ready', title: 'Batch proof' }) })
  const batchOne = await delegate({ title: 'batch one', role: 'BACKEND', objective: 'implement REQ-1', changeClass: 'L1', analysisId: 'batch-proof', requirementIds: ['REQ-1'], cwd: dir })
  const batchTwo = await delegate({ title: 'batch two', role: 'BACKEND', objective: 'implement REQ-2', changeClass: 'L1', analysisId: 'batch-proof', requirementIds: ['REQ-2'], cwd: dir })
  const batchRead = await call('analysis_read', { initiative: 'batch-proof' })
  const batchResolved = await call('analysis_upsert', {
    initiative: 'batch-proof', expectedRev: batchRead.rev,
    patch: {
      requirements: [
        { id: 'REQ-1', kind: 'FR', text: 'A ready record gates L1/L2 delegation.', acceptance: ['analysis_required before a child starts'], status: 'proven' },
        { id: 'REQ-2', kind: 'NFR', text: 'An L0 local fix stays unblocked.', acceptance: ['no record needed for L0'], status: 'proven' },
      ],
      trace: batchRead.record.trace.map((row) => ({ ...row, status: 'proven', tasks: row.tasks.map((task) => ({ ...task, evidence: ['proof run'] })) })),
      status: 'ready',
    },
  })
  setReview(batchOne.taskId)
  setReview(batchTwo.taskId)
  const batchClose = await a.guarded(root.tools, root.guards, 'task_close', { ids: [batchOne.taskId, batchTwo.taskId], resultSummary: 'done', resultEvidence: ['proof run'] }, root.agent)
  check('a batch close succeeds when every traced task is proven', batchInit?.ok === true && batchResolved?.ok === true && batchClose?.ok === true && batchClose?.closed === 2, { code: batchClose?.code, message: batchClose?.message, closed: batchClose?.closed })

  const partialInit = await call('analysis_upsert', { initiative: 'partial-proof', patch: readyRecord({ status: 'ready', title: 'Partial batch proof' }) })
  const partialOne = await delegate({ title: 'partial one', role: 'BACKEND', objective: 'implement REQ-1', changeClass: 'L1', analysisId: 'partial-proof', requirementIds: ['REQ-1'], cwd: dir })
  const partialTwo = await delegate({ title: 'partial two', role: 'BACKEND', objective: 'implement REQ-2', changeClass: 'L1', analysisId: 'partial-proof', requirementIds: ['REQ-2'], cwd: dir })
  const partialRead = await call('analysis_read', { initiative: 'partial-proof' })
  const partialResolved = await call('analysis_upsert', {
    initiative: 'partial-proof', expectedRev: partialRead.rev,
    patch: {
      requirements: [
        { id: 'REQ-1', kind: 'FR', text: 'A ready record gates L1/L2 delegation.', acceptance: ['analysis_required before a child starts'], status: 'proven' },
        { id: 'REQ-2', kind: 'NFR', text: 'An L0 local fix stays unblocked.', acceptance: ['no record needed for L0'] },
      ],
      trace: partialRead.record.trace.map((row) => (row.requirementId === 'REQ-1'
        ? { ...row, status: 'proven', tasks: row.tasks.map((task) => ({ ...task, evidence: ['proof run'] })) }
        : row)),
      status: 'ready',
    },
  })
  setReview(partialOne.taskId)
  setReview(partialTwo.taskId)
  const partialClose = await a.guarded(root.tools, root.guards, 'task_close', { ids: [partialOne.taskId, partialTwo.taskId], resultSummary: 'done', resultEvidence: ['proof run'] }, root.agent)
  const partialStatuses = [a.taskboard.get(dir, partialOne.taskId)?.status, a.taskboard.get(dir, partialTwo.taskId)?.status]
  check(
    'a mixed batch is refused atomically and leaves both tasks in review',
    partialInit?.ok === true && partialResolved?.ok === true && partialClose?.ok === false && partialStatuses[0] === 'review' && partialStatuses[1] === 'review',
    { code: partialClose?.code, message: partialClose?.message, statuses: partialStatuses },
  )

} finally {
  if (!keep) rmSync(dir, { recursive: true, force: true })
}

const failed = results.filter((entry) => !entry.ok)
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`)
process.exitCode = failed.length === 0 ? 0 : 1
