#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove end to end that `delegate_task` carries the basis of the task it creates: the
 *   requirements it implements (`reqIds`/`reqId`) or a stated chore (`chore: true` with a
 *   `choreReason`) - and that a call with NEITHER is refused by the REAL taskboard with
 *   `req_required`, creates no row and starts no child.
 *
 *   This is the defect the owner reported on 2026-11-19: a root could not delegate a review of
 *   existing code. The board required a requirement or a chore, the orchestrator passed
 *   neither, and the refusal answered with advice to free a row on a board that was not full.
 *   The root then read the code itself, which is exactly the work delegation exists to avoid.
 *
 * INPUTS
 *   --orchestrator <path>  orchestrator module under proof (default plugins/orchestrator)
 *   --taskboard <path>     taskboard module under proof (default plugins/taskboard)
 *   --dir <path>           scratch directory (default: a temp dir)
 *   --keep                 keep the scratch directory
 *
 *   Red→green pair:
 *     mkdir -p /tmp/red-delegation && ln -sfn "$PWD/node_modules" /tmp/red-delegation/node_modules
 *     git show HEAD:plugins/orchestrator/orchestrator.mjs > /tmp/red-delegation/orchestrator.mjs
 *     node scripts/delegation-basis-proof.mjs --orchestrator /tmp/red-delegation/orchestrator.mjs  # red
 *     node scripts/delegation-basis-proof.mjs                                                      # green
 *
 * OUTPUTS
 *   One PASS/FAIL line per check and `n/m checks passed`; exit 0 only when every check passed,
 *   1 otherwise. A failing line names the observed value.
 *
 * KEYWORDS
 *   delegate_task, taskboard, req_required, chore, choreReason, reqIds, red-first proof,
 *   delegation basis
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The subagent provider is a recorder: no model call, no real child, so the proof is
 *     deterministic and free. It exposes the same capabilities (agentPreset, agentOptions)
 *     the installed provider must expose.
 *   - The taskboard mirror is reported as ACTIVE (`mirrorActive`) because that is the mounted
 *     composition: without a project state core the old behaviour (no requirement gate) is
 *     correct and this proof would measure nothing.
 *   - Every harness gets its own workspace directory. The board export has a per-harness name
 *     (board-N.json), but the journal that IS the board (taskboard.events.ndjson) and its
 *     snapshot sit BESIDE that export under fixed names (lib/store.mjs, pathsFor), so two
 *     harnesses in one directory share one journal and the later one hydrates the rows the
 *     earlier one wrote.
 *   - A throw from the tool is recorded as `{ok:false, code:'threw'}` so one hard refusal
 *     cannot hide the remaining checks.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const orchestratorModulePath = modulePath('--orchestrator', 'plugins/orchestrator/orchestrator.mjs')
const taskboardModulePath = modulePath('--taskboard', 'plugins/taskboard/taskboard.mjs')
const dir = value('--dir') !== '' ? resolve(value('--dir')) : mkdtempSync(join(tmpdir(), 'delegation-proof-'))
const keep = argv.includes('--keep')
mkdirSync(dir, { recursive: true })

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  const suffix = detail === undefined ? '' : `  ${JSON.stringify(detail)}`
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${suffix}\n`)
}

const { createService: createTaskboard } = await import(pathToFileURL(taskboardModulePath).href)
const { apply: applyOrchestrator } = await import(pathToFileURL(orchestratorModulePath).href)

const logger = { warn() {}, info() {}, debug() {} }
let seq = 0
let boards = 0

/**
 * One fake harness over one disposable board: the real taskboard service (with the project
 * state mirror reported active, so the requirement gate is the one under proof) and the real
 * orchestrator plugin. The subagent provider records instead of spawning.
 */
function harness(options = {}) {
  boards += 1
  // One workspace per harness: the shared journal beside a board export would carry one
  // harness's rows into the next one's board (lib/store.mjs, pathsFor).
  const workspace = join(dir, `workspace-${boards}`)
  mkdirSync(workspace, { recursive: true })
  const boardPath = join(workspace, `board-${boards}.json`)
  const linksPath = join(workspace, `links-${boards}.json`)
  writeFileSync(boardPath, `${JSON.stringify({ version: 1, revision: 1, tasks: [], agents: [] }, null, 2)}\n`)
  const calls = { startActivation: [], sendMessage: [], interrupt: [] }
  const services = new Map()
  const created = []
  const taskboard = createTaskboard(
    { file: boardPath, linksFile: linksPath, maxTasks: options.maxTasks ?? 0, maxRows: 1000 },
    logger,
    { mirrorActive: () => true, waive: () => {} },
  )
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
  applyOrchestrator(ctx, {})
  const agentFor = (id) => {
    const tools = new Map()
    const agent = {
      id,
      session: { header: { id, cwd: workspace, agentPreset: 'orchestrator', delegationDepth: 0 } },
      ctx: {
        on: () => {},
        systemPrompt: { getSectionOrder: () => 100, section: () => {} },
        tools: { register: (definition) => tools.set(definition.name, definition), guard: () => {} },
      },
    }
    for (const handler of created) handler({ agent })
    return { agent, tools }
  }
  const call = async (tools, name, args, agent) => {
    const definition = tools.get(name)
    if (definition === undefined) return { ok: false, code: 'missing_tool', message: `no tool "${name}" was registered` }
    try {
      return await definition.execute(args, { agent, signal: new AbortController().signal })
    } catch (error) {
      return { ok: false, code: error?.code ?? 'threw', message: error instanceof Error ? error.message : String(error) }
    }
  }
  return { taskboard, calls, agentFor, call, workspace, rows: () => JSON.parse(readFileSync(boardPath, 'utf8')).tasks }
}

try {
  // 1. The tool DECLARES the basis. Before the fix the model had no way to state it.
  const base = harness()
  const root = base.agentFor('root-proof')
  const definition = root.tools.get('delegate_task')
  const parameters = definition?.parameters?.properties ?? {}
  check(
    'delegate_task declares reqIds, reqId, chore and choreReason',
    parameters.reqIds !== undefined && parameters.reqId !== undefined && parameters.chore !== undefined && parameters.choreReason !== undefined,
    { declared: ['reqIds', 'reqId', 'chore', 'choreReason'].filter((key) => parameters[key] !== undefined) },
  )

  // 2. Work that implements requirements: reqIds reaches the row, one child starts.
  const withRequirement = await base.call(root.tools, 'delegate_task', {
    title: 'review the delegation change',
    role: 'REVIEWER',
    objective: 'Judge whether the delegation fix carries the task basis.',
    reqIds: ['REQ-148', 'REQ-150'],
    cwd: base.workspace,
  }, root.agent)
  const requirementRow = base.rows().at(-1)
  check(
    'reqIds creates one row and starts one child',
    withRequirement?.ok !== false && typeof withRequirement?.childId === 'string' && base.rows().length === 1 && base.calls.startActivation.length === 1,
    { result: withRequirement?.ok, code: withRequirement?.code, rows: base.rows().length, children: base.calls.startActivation.length },
  )
  check(
    'the created row carries reqIds',
    Array.isArray(requirementRow?.reqIds) && requirementRow.reqIds.includes('REQ-148') && requirementRow.reqIds.includes('REQ-150'),
    requirementRow?.reqIds,
  )

  // 3. Work that implements no requirement: a review of existing code is a chore with a reason.
  const asChore = await base.call(root.tools, 'delegate_task', {
    title: 'review existing code',
    role: 'CRITIC',
    objective: 'Attack the current installer for other silent failures.',
    chore: true,
    choreReason: 'a review of existing code implements no requirement of its own',
    cwd: base.workspace,
  }, root.agent)
  const choreRow = base.rows().at(-1)
  check(
    'chore with a reason creates one row and starts one child',
    asChore?.ok !== false && typeof asChore?.childId === 'string' && base.rows().length === 2 && base.calls.startActivation.length === 2,
    { result: asChore?.ok, code: asChore?.code, rows: base.rows().length, children: base.calls.startActivation.length },
  )
  check(
    'the created row carries chore and choreReason',
    choreRow?.chore === true && typeof choreRow?.choreReason === 'string' && choreRow.choreReason.includes('implements no requirement'),
    { chore: choreRow?.chore, choreReason: choreRow?.choreReason },
  )

  // 4. Neither basis: the board refuses, nothing is created, nothing starts.
  const rowsBefore = base.rows().length
  const childBefore = base.calls.startActivation.length
  const noBasis = await base.call(root.tools, 'delegate_task', {
    title: 'a review with no basis',
    role: 'DOCS',
    objective: 'Try to start a child without a requirement or a chore reason.',
    cwd: base.workspace,
  }, root.agent)
  check(
    'a call with no basis is refused req_required',
    noBasis?.ok === false && noBasis?.code === 'req_required',
    { result: noBasis?.ok, code: noBasis?.code },
  )
  check(
    'the refused call leaves the board and the child count untouched',
    base.rows().length === rowsBefore && base.calls.startActivation.length === childBefore,
    { rows: base.rows().length, children: base.calls.startActivation.length },
  )
  const refusal = String(noBasis?.message ?? '')
  check(
    "the refusal carries the board's explanation of the missing basis",
    refusal.includes('chore:true with a non-empty choreReason'),
    { message: refusal },
  )
  check(
    'the refusal does not blame a full board',
    refusal !== '' && !refusal.includes('Free a row'),
    { message: refusal },
  )

  // 5. The cap is still the ONE case that advises freeing a row.
  const crowded = harness({ maxTasks: 1 })
  const crowdedRoot = crowded.agentFor('root-crowded')
  crowded.taskboard.create(crowded.workspace, { title: 'a row already in flight', role: 'BACKEND', reqIds: ['REQ-149'] }, 'orchestrator')
  const full = await crowded.call(crowdedRoot.tools, 'delegate_task', {
    title: 'delegation onto a full board',
    role: 'REVIEWER',
    objective: 'Show the board_full advice survives the fix.',
    reqIds: ['REQ-149'],
    cwd: crowded.workspace,
  }, crowdedRoot.agent)
  const fullMessage = String(full?.message ?? '')
  check(
    'board_full is refused and advised to free a row',
    full?.ok === false && full?.code === 'board_full' && fullMessage.includes('Free a row'),
    { code: full?.code, message: fullMessage },
  )
  check(
    'the board_full refusal also carries the board reason',
    fullMessage.includes('tasks can still be acted on'),
    { message: fullMessage },
  )

  // 6. Attaching to an existing row needs no basis: the row already carries one.
  const attached = harness()
  const attachedRoot = attached.agentFor('root-attached')
  // The row is opened the way `task_create` opens one: on this chat's board, so the attach is
  // allowed to write it (a row with no chat belongs to nobody and the attach is refused).
  const existing = attached.taskboard.create(attached.workspace, { title: 'a row opened before the delegation', role: 'REVIEWER', reqIds: ['REQ-149'], chatId: 'root-attached' }, 'orchestrator')
  const attachResult = await attached.call(attachedRoot.tools, 'delegate_task', {
    title: 'a row opened before the delegation',
    role: 'REVIEWER',
    objective: 'Attach the child to the row that already exists.',
    taskId: existing.id,
    cwd: attached.workspace,
  }, attachedRoot.agent)
  check(
    'an attach with taskId needs no basis and starts one child',
    attachResult?.ok !== false && attachResult?.taskId === existing.id && typeof attachResult?.childId === 'string' && attached.calls.startActivation.length === 1,
    { result: attachResult?.ok, code: attachResult?.code, taskId: attachResult?.taskId, children: attached.calls.startActivation.length },
  )
  check(
    'the attach created no second row',
    attached.rows().length === 1 && attached.rows()[0]?.id === existing.id,
    { rows: attached.rows().length, ids: attached.rows().map((row) => row.id) },
  )
} finally {
  if (!keep) rmSync(dir, { recursive: true, force: true })
}

const failed = results.filter((result) => !result.ok).length
process.stdout.write(`\n${results.length - failed}/${results.length} checks passed${failed === 0 ? '' : ` — ${failed} failed`}\n`)
process.exit(failed === 0 ? 0 : 1)
