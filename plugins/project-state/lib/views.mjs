/**
 * PURPOSE
 *   Render the state PROJECTIONS from a read-only model: `digest.md` (the small L1 block),
 *   `board.md`, `traceability.md`, one mermaid subgraph per REQ, `snapshot.md` and the
 *   machine-readable `index.json` that the future panel consumes instead of parsing markdown.
 *
 * DETERMINISM
 *   Every list is sorted by id, every section has a fixed order and no wall-clock appears in
 *   the output. Regenerating from unchanged state therefore produces identical bytes, which is
 *   what lets `verify()` detect a hand edit through the hash manifest.
 *
 * WHAT THIS MODULE DOES NOT DO
 *   It never writes: the core owns the files under `state/views/`. It also never parses the
 *   projections back — `index.json` is the contract, the markdown is for a human.
 */

export const VIEW_DIR = 'views'
export const INDEX_SCHEMA_VERSION = 1
export const DIGEST_LIMIT_BYTES = 3072

const utf8 = (text) => Buffer.byteLength(text ?? '', 'utf8')
const byId = (a, b) => String(a.id).localeCompare(String(b.id))

/** Sort helpers: a fixed status order, then id. */
const STATUS_ORDER = ['open', 'active', 'review', 'done', 'blocked', 'cancelled', 'unverified', 'verified', 'failing', 'stale', 'proposed', 'accepted', 'superseded', 'dropped', 'deprecated']
const statusRank = (status) => {
  const index = STATUS_ORDER.indexOf(status)
  return index < 0 ? STATUS_ORDER.length : index
}
const byStatusThenId = (a, b) => statusRank(a.status) - statusRank(b.status) || String(a.id).localeCompare(String(b.id))

/** One deterministic markdown table row. */
const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** Truncate a text to a byte limit on a line boundary, with a deterministic marker. */
function truncateBytes(text, limit) {
  if (utf8(text) <= limit) return text
  const marker = '\n[truncated: the digest budget is ' + limit + ' bytes; read index.json or state/req/]\n'
  const budget = limit - utf8(marker)
  const lines = text.split('\n')
  const kept = []
  for (const line of lines) {
    const candidate = `${kept.join('\n')}${kept.length > 0 ? '\n' : ''}${line}`
    if (utf8(candidate) > budget) break
    kept.push(line)
  }
  return `${kept.join('\n')}${marker}`
}

/**
 * Build the link model: for every REQ its tasks/tests/decisions, for every TEST its evidence.
 *
 * @param {{reqs: object[], tasks: object[], tests: object[], decisions: object[]}} entities
 */
export function buildModel({ reqs = [], tasks = [], tests = [], decisions = [] }) {
  const tasksByReq = new Map()
  const testsByReq = new Map()
  const decisionsByReq = new Map()
  const push = (map, key, value) => {
    if (typeof key !== 'string' || key === '') return
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(value)
  }
  for (const task of tasks) push(tasksByReq, task.reqId, task)
  for (const test of tests) push(testsByReq, test.reqId, test)
  for (const decision of decisions) push(decisionsByReq, decision.links?.find((link) => link.kind === 'req')?.id, decision)
  const reqRows = reqs.map((req) => ({
    id: req.id,
    title: req.title,
    status: req.status,
    criteria: Array.isArray(req.criteria) ? req.criteria : [],
    tasks: [...(tasksByReq.get(req.id) ?? [])].sort(byId).map((task) => task.id),
    tests: [...(testsByReq.get(req.id) ?? [])].sort(byId).map((test) => test.id),
    decisions: [...(decisionsByReq.get(req.id) ?? [])].sort(byId).map((decision) => decision.id),
    // The plan names the INITIATIVE a decision belongs to: a DECISION links to a REQ, and the REQ
    // carries `analysisRef.initiative`. The renderers below read this; `renderIndex` lists its own
    // fields, so the machine contract does not grow.
    analysisRef: req.analysisRef !== null && typeof req.analysisRef === 'object' ? { initiative: req.analysisRef.initiative ?? null, requirementId: req.analysisRef.requirementId ?? null } : null,
  }))
  const testRows = tests.map((test) => ({
    id: test.id,
    // The panel's first paint reads the index alone; a row without a title would send it back
    // to the entity files (the legacy fallback), so the title travels here too.
    title: test.title,
    reqId: test.reqId ?? null,
    status: test.status,
    authorRole: test.authorRole ?? null,
    command: test.command ?? null,
    updatedAt: test.updatedAt ?? null,
    evidenceRefs: (Array.isArray(test.links) ? test.links : []).filter((link) => link.kind !== 'req').map((link) => ({ kind: link.kind, id: link.id, hash: link.hash })),
  }))
  return { reqs: reqRows.sort(byId), tasks: [...tasks].sort(byId), tests: testRows.sort(byId), decisions: [...decisions].sort(byId) }
}

/** The machine-readable contract (stable ids, no prose). */
export function renderIndex(model, { lastSeq = 0 } = {}) {
  const index = {
    schemaVersion: INDEX_SCHEMA_VERSION,
    lastSeq,
    counts: {
      req: model.reqs.length,
      task: model.tasks.length,
      // Live TEST rows, plus the retired ones named on their own key: the panel's TEST counter
      // must mean the same thing the snapshot's figure does.
      test: testCounts(model).live,
      testRetired: testCounts(model).retired,
      decision: model.decisions.length,
    },
    // THE PANEL'S FIRST PAINT READS THIS ONE FILE. It used to follow the index with one read
    // per entity (hundreds of round trips, several seconds); the rows below carry every field
    // a list or a card draws, and the entity file is fetched only when a body is opened.
    reqs: model.reqs.map((req) => ({ id: req.id, title: req.title, status: req.status, ...(typeof req.updatedAt === 'string' ? { updatedAt: req.updatedAt } : {}), tasks: req.tasks, tests: req.tests, decisions: req.decisions })),
    tasks: model.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      reqId: task.reqId ?? null,
      status: task.status,
      chore: task.chore === true,
      ...(Array.isArray(task.reqIds) && task.reqIds.length > 0 ? { reqIds: task.reqIds } : {}),
      ...(Array.isArray(task.steps) && task.steps.length > 0 ? { steps: task.steps.length, stepsDone: Number.isSafeInteger(task.stepsDone) ? task.stepsDone : 0 } : {}),
      // LIST FIELDS ONLY. The card needs title/status/progress/sessions and the drawer's
      // details (scope, acceptance, result, full steps) come from the entity file when the
      // card is opened; putting them here made index.json 790 KB (over the reader's page cap).
      ...(typeof task.role === 'string' && task.role !== '' ? { role: task.role } : {}),
      ...(typeof task.preset === 'string' && task.preset !== '' ? { preset: task.preset } : {}),
      ...(task.inline === true ? { inline: true } : {}),
      ...(task.owner !== undefined && task.owner !== null ? { owner: task.owner } : {}),
      ...(Array.isArray(task.sessions) && task.sessions.length > 0 ? { sessions: task.sessions } : {}),
      ...(typeof task.updatedAt === 'string' ? { updatedAt: task.updatedAt } : {}),
    })),
    tests: model.tests.map((test) => ({ id: test.id, title: test.title, reqId: test.reqId, status: test.status, authorRole: test.authorRole ?? null, command: test.command ?? null, ...(typeof test.updatedAt === 'string' ? { updatedAt: test.updatedAt } : {}), evidenceRefs: test.evidenceRefs })),
    decisions: model.decisions.map((decision) => ({ id: decision.id, title: decision.title, status: decision.status, ...(typeof decision.updatedAt === 'string' ? { updatedAt: decision.updatedAt } : {}) })),
  }
  // ONE LINE, deliberately: the gateway pages a read at 5000 lines, and a pretty index of a
  // few hundred entities crosses that. This file is the machine contract (a human reads
  // board.md/digest.md), so compact JSON keeps the panel's first paint at one read.
  return `${JSON.stringify(index)}\n`
}

/** `board.md`: the TASK board grouped by status in a fixed order. */
export function renderBoard(model) {
  const lines = ['# Board', '', 'GENERATED — DO NOT EDIT. Regenerated from `state/task/` by `regenerateViews()`.', '']
  if (model.tasks.length === 0) return `${lines.join('\n')}No tasks.\n`
  const groups = new Map()
  for (const task of [...model.tasks].sort(byStatusThenId)) {
    if (!groups.has(task.status)) groups.set(task.status, [])
    groups.get(task.status).push(task)
  }
  for (const [status, tasks] of groups) {
    lines.push(`## ${status} (${tasks.length})`, '')
    lines.push('| id | title | reqs | steps | chore |')
    lines.push('|---|---|---|---|---|')
    for (const task of tasks) {
      const reqs = Array.isArray(task.reqIds) && task.reqIds.length > 0 ? task.reqIds.join(', ') : (task.reqId ?? '—')
      const steps = Array.isArray(task.steps) && task.steps.length > 0 ? `${Number.isSafeInteger(task.stepsDone) ? task.stepsDone : 0}/${task.steps.length}` : '—'
      lines.push(`| ${task.id} | ${cell(task.title)} | ${reqs} | ${steps} | ${task.chore === true ? 'yes' : 'no'} |`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** `traceability.md`: REQ → tasks/tests, with a stale link called out. */
export function renderTraceability(model, staleIds = new Set()) {
  const lines = ['# Traceability', '', 'GENERATED — DO NOT EDIT. Regenerated from `state/` by `regenerateViews()`.', '']
  lines.push('| REQ | status | tasks | tests | decisions | stale links |')
  lines.push('|---|---|---|---|---|---|')
  for (const req of model.reqs) {
    const stale = staleIds.has(req.id) ? 'yes' : 'no'
    lines.push(`| ${req.id} | ${req.status} | ${req.tasks.join(', ') || '—'} | ${req.tests.join(', ') || '—'} | ${req.decisions.join(', ') || '—'} | ${stale} |`)
  }
  lines.push('')
  lines.push('## Tests', '')
  lines.push('| TEST | req | status | evidence |')
  lines.push('|---|---|---|---|')
  for (const test of model.tests) {
    lines.push(`| ${test.id} | ${test.reqId ?? '—'} | ${test.status} | ${test.evidenceRefs.map((ref) => ref.id).join(', ') || '—'} |`)
  }
  return `${lines.join('\n')}\n`
}

/** `map/REQ-*.mmd`: one mermaid subgraph per REQ with its tasks and tests. */
export function renderMaps(model) {
  const files = {}
  for (const req of model.reqs) {
    const lines = [`%% GENERATED — DO NOT EDIT. REQ ${req.id}`, 'graph LR', `  ${req.id.replace(/-/g, '_')}["${req.id}: ${String(req.title ?? '').replace(/"/g, "'")}"]`]
    for (const taskId of req.tasks) lines.push(`  ${taskId.replace(/-/g, '_')}["${taskId}"] --> ${req.id.replace(/-/g, '_')}`)
    for (const testId of req.tests) lines.push(`  ${testId.replace(/-/g, '_')}["${testId}"] --> ${req.id.replace(/-/g, '_')}`)
    files[`map/${req.id}.mmd`] = `${lines.join('\n')}\n`
  }
  return files
}

/**
 * The session statuses that still mean working. The task ledger records `active`/`sleeping`
 * (plus `paused`); `running` is the runtime's own word for the same thing, so both count. A
 * settled session is `sleeping` and is not working.
 */
const WORKING_SESSION_STATUSES = ['active', 'running']

/**
 * How many agents the ledger records as working: the task rows' sessions whose status is still
 * working, counted once per session id. This is a projection of the ledger, not a live probe of
 * the runtime - the digest and the snapshot never touch a running process.
 */
export function activeAgentCount(model) {
  const ids = new Set()
  for (const task of model.tasks) {
    if (!Array.isArray(task.sessions)) continue
    for (const session of task.sessions) {
      if (session === null || typeof session !== 'object') continue
      if (typeof session.sessionId !== 'string' || session.sessionId === '') continue
      if (!WORKING_SESSION_STATUSES.includes(session.status)) continue
      ids.add(session.sessionId)
    }
  }
  return ids.size
}

/**
 * A TEST row whose case was retired: the row stays (with its caseId) as the requirement's trace,
 * but it is not live work, so the TEST figure does not count it. ONE meaning for the figure,
 * shared by the snapshot, the digest and index.json.
 */
export const RETIRED_TEST_STATUSES = new Set(['deprecated'])

/** How many TEST rows are live and how many are retired (terminal). */
export function testCounts(model) {
  const tests = Array.isArray(model.tests) ? model.tests : []
  let retired = 0
  for (const test of tests) if (RETIRED_TEST_STATUSES.has(test.status)) retired += 1
  return { live: tests.length - retired, retired }
}

/** The one spelling of the TEST figure: live, with the retired rows named when there are any. */
export function testFigure(model) {
  const { live, retired } = testCounts(model)
  return retired > 0 ? `${live} (${retired} retired)` : String(live)
}

/** `snapshot.md`: counts and the last journal sequence (never a wall clock). */
export function renderSnapshot(model, { lastSeq = 0 } = {}) {
  const lines = ['# State snapshot', '', 'GENERATED — DO NOT EDIT.', '', `- last journal event: ${lastSeq}`, `- REQ: ${model.reqs.length}`, `- DECISION: ${model.decisions.length}`, `- TASK: ${model.tasks.length}`, `- TEST: ${testFigure(model)}`, `- active agents: ${activeAgentCount(model)}`, '', '## Tasks by status', '']
  const counts = new Map()
  for (const task of model.tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1)
  for (const status of [...counts.keys()].sort()) lines.push(`- ${status}: ${counts.get(status)}`)
  return `${lines.join('\n')}\n`
}

/** `digest.md`: the small block the L1 layer will deliver; hard-capped. */
export function renderDigest(model, { lastSeq = 0, limit = DIGEST_LIMIT_BYTES } = {}) {
  const lines = ['# Project state', '', 'GENERATED — DO NOT EDIT.', '', `REQ ${model.reqs.length} · TASK ${model.tasks.length} · TEST ${testFigure(model)} · event ${lastSeq}`, '']
  // THE GAPS COME FIRST, so the hard cap can never hide them: a full register is exactly the
  // case where the reader must know that the REQ have no tasks and the tasks have no reqId.
  const OPEN_REQ = ['proposed', 'open', 'accepted', 'in_progress']
  const reqsWithoutTasks = model.reqs.filter((req) => req.tasks.length === 0)
  const tasksWithoutReq = model.tasks.filter((task) => typeof task.reqId !== 'string' || task.reqId === '')
  const testsWithoutReq = model.tests.filter((test) => typeof test.reqId !== 'string' || test.reqId === '')
  if (reqsWithoutTasks.length > 0 || tasksWithoutReq.length > 0 || testsWithoutReq.length > 0) {
    lines.push('## Gaps', '')
    if (reqsWithoutTasks.length > 0) {
      const ids = reqsWithoutTasks.slice(0, 10).map((req) => req.id)
      lines.push(`- REQ without TASK: ${reqsWithoutTasks.length} (${ids.join(', ')}${reqsWithoutTasks.length > ids.length ? ', …' : ''})`)
    }
    if (tasksWithoutReq.length > 0) lines.push(`- TASK without reqId: ${tasksWithoutReq.length}`)
    if (testsWithoutReq.length > 0) lines.push(`- TEST without reqId: ${testsWithoutReq.length}`)
    lines.push('')
  }
  const openReqs = model.reqs.filter((req) => OPEN_REQ.includes(req.status)).sort(byId)
  if (openReqs.length > 0) {
    lines.push(`## Open requirements (${openReqs.length})`, '')
    for (const req of openReqs.slice(0, 20)) lines.push(`- ${req.id} ${req.status}: ${cell(req.title).slice(0, 100)}`)
    if (openReqs.length > 20) lines.push(`- … and ${openReqs.length - 20} more`)
    lines.push('')
  }
  const open = model.tasks.filter((task) => task.status === 'open' || task.status === 'active' || task.status === 'review')
  if (open.length > 0) {
    lines.push(`## Open work (${open.length})`, '')
    for (const task of open.sort(byStatusThenId).slice(0, 24)) lines.push(`- ${task.id} ${task.status}: ${cell(task.title).slice(0, 100)}${task.reqId ? ` (${task.reqId})` : ''}`)
    if (open.length > 24) lines.push(`- … and ${open.length - 24} more`)
    lines.push('')
  }
  return truncateBytes(`${lines.join('\n')}\n`, limit)
}

/** Requirement statuses the analysis record uses for a CONFIRMED requirement. */
const CONFIRMED_REQUIREMENT_STATUSES = new Set(['done', 'accepted', 'completed', 'implemented', 'verified', 'met', 'proven'])
/** TASK statuses that are finished: everything else is open work. */
const CLOSED_TASK_STATUSES = new Set(['done', 'cancelled', 'dropped', 'deprecated', 'superseded'])

/** Stage order for the plan: work in flight first, the archive last. */
const PLAN_STAGE_ORDER = ['active', 'in_progress', 'ready', 'draft', 'completed', 'done', 'dropped']
const planStageRank = (status) => {
  const index = PLAN_STAGE_ORDER.indexOf(String(status))
  return index < 0 ? PLAN_STAGE_ORDER.length : index
}
/** A row stays one readable line: a long initiative title is cut, never wrapped. */
const PLAN_TITLE_LIMIT = 90
/** Rows the compact `plan.yaml` carries; the rest of the plan stays in `plan.md`. */
export const PLAN_INITIATIVE_ROWS = 10
export const PLAN_TASK_ROWS = 6
/** DECISION rows the compact `plan.yaml` carries; the rest stays in `plan.md`. */
export const PLAN_DECISION_ROWS = 4
/** A decision in one of these statuses is history: the plan shows the rules that still hold. */
const RETIRED_DECISION_STATUSES = new Set(['superseded', 'deprecated', 'dropped'])
/** Hard cap of `state/plan.yaml`: it travels inside L1, so it must stay a few kilobytes. */
export const PLAN_YAML_LIMIT_BYTES = 4096
/** A title in `plan.yaml` is cut shorter than in `plan.md`: this file travels inside L1. */
export const PLAN_YAML_TITLE_LIMIT = 60
const shortTitle = (value, limit = PLAN_TITLE_LIMIT) => {
  const text = cell(value)
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`
}
/** At most four ids in a table cell; the rest of the work is listed under "Что осталось". */
const idCell = (ids) => (ids.length === 0 ? '—' : ids.length <= 4 ? ids.join(', ') : `${ids.slice(0, 4).join(', ')} +${ids.length - 4}`)

/**
 * The ONE derivation both plan projections read: per initiative its requirements, which are
 * confirmed, which remain, and which traced tasks the journal still has open; plus the
 * journal's own open tasks. `plan.md` and `plan.yaml` cannot disagree about the plan because
 * neither of them derives it.
 *
 * @param {object[]} initiatives - the analysis records, as `loadInitiatives` returns them.
 * @param {{tasks?: object[]}} [model] - output of `buildModel`.
 */
function planSections(initiatives, model = { tasks: [] }) {
  const tasks = new Map((Array.isArray(model.tasks) ? model.tasks : []).map((task) => [task.id, task]))
  const records = (Array.isArray(initiatives) ? initiatives : [])
    .filter((record) => record !== null && typeof record === 'object' && typeof record.id === 'string')
  const rows = records.map((record) => {
    const requirements = (Array.isArray(record.requirements) ? record.requirements : [])
      .filter((requirement) => requirement !== null && typeof requirement === 'object' && typeof requirement.id === 'string')
      .sort(byId)
    const confirmed = requirements.filter((requirement) => CONFIRMED_REQUIREMENT_STATUSES.has(String(requirement.status)))
    const remaining = requirements.filter((requirement) => !CONFIRMED_REQUIREMENT_STATUSES.has(String(requirement.status)))
    const traced = new Set()
    for (const trace of Array.isArray(record.trace) ? record.trace : []) {
      for (const link of Array.isArray(trace?.tasks) ? trace.tasks : []) {
        if (typeof link?.taskId === 'string' && link.taskId !== '') traced.add(link.taskId)
      }
    }
    // Only tasks the journal still has are actionable; a trace link to a task that no longer
    // exists is a stale link in the analysis record, not open work on the board.
    const openTasks = [...traced]
      .sort()
      .map((id) => tasks.get(id))
      .filter((task) => task !== undefined && !CLOSED_TASK_STATUSES.has(String(task.status)))
    return { record, requirements, confirmed, remaining, openTasks }
  })
  rows.sort((a, b) => planStageRank(a.record.status) - planStageRank(b.record.status) || byId(a.record, b.record))
  // The open-work section lists only work that is actionable NOW (an open task); a remaining
  // requirement is visible in the table and its text stays in the analysis record.
  const inFlight = rows.filter((row) => row.openTasks.length > 0)
  const withRemaining = rows.filter((row) => row.remaining.length > 0)
  // The journal's own open work, initiative or not: the question a new session asks first is
  // "what is still running", and a task need not be traced from an analysis record to be open.
  const openJournalTasks = (Array.isArray(model.tasks) ? model.tasks : [])
    .filter((task) => task !== null && typeof task === 'object' && typeof task.id === 'string' && !CLOSED_TASK_STATUSES.has(String(task.status)))
    .sort(byId)
  return { records, rows, inFlight, withRemaining, openJournalTasks }
}

/**
 * The live DECISION rows of the journal, oldest first, each with the initiative it belongs to.
 *
 * WHY THE PLAN CARRIES THEM. The plan answered "which initiatives exist"; it could not answer
 * "in what order do we work and when do we stop". That order is a decision, so it lives in the
 * journal as a DECISION and the plan shows it instead of repeating it: one derivation here, and
 * both plan projections read it.
 *
 * A DECISION links to a REQ, and that REQ's `analysisRef` names the initiative; when a decision
 * links nothing the initiative cell stays empty rather than inventing one.
 *
 * @param {{reqs?: object[], decisions?: object[]}} [model] - output of `buildModel`.
 */
function planDecisions(model = {}) {
  const reqs = new Map((Array.isArray(model.reqs) ? model.reqs : []).map((req) => [req.id, req]))
  return (Array.isArray(model.decisions) ? model.decisions : [])
    .filter((decision) => decision !== null && typeof decision === 'object' && typeof decision.id === 'string')
    .filter((decision) => !RETIRED_DECISION_STATUSES.has(String(decision.status)))
    // NEWEST FIRST, because the plan keeps the newest: the block has a byte cap, so the rows it
    // can carry are trimmed from the OLD end. Sorted the other way round, a fresh decision was
    // the first row dropped — the plan showed the rules that were about to be superseded and hid
    // the one the session had just decided (measured on DEC-004).
    .sort((a, b) => byId(b, a))
    .map((decision) => {
      const link = (Array.isArray(decision.links) ? decision.links : []).find((entry) => entry !== null && typeof entry === 'object' && entry.kind === 'req' && typeof entry.id === 'string')
      const req = link === undefined ? undefined : reqs.get(link.id)
      const initiative = typeof req?.analysisRef?.initiative === 'string' && req.analysisRef.initiative !== '' ? req.analysisRef.initiative : (link?.id ?? '')
      return { id: decision.id, title: decision.title, status: String(decision.status ?? 'unknown'), initiative }
    })
}

/**
 * `plan.md`: the initiatives of the analysis records, their stage, what is confirmed, what is
 * left, and which tasks are still open - ONE LINE PER INITIATIVE plus a short list of the work in
 * flight. The aim is a new session's minute, not the archive: requirement TEXTS stay in the
 * analysis records and are not copied here; the page carries their ids and statuses, and the open
 * tasks with their title and status.
 *
 * WHY A VIEW AND NOT A HAND-WRITTEN FILE. The plan used to be docs/PROJECT-PLAN.md, which went
 * stale between edits. The order and stage of an initiative are already in its analysis record
 * (docs/analysis/<id>.json) and the task statuses are in the journal, so the page is derived from
 * both: it cannot disagree with them, and it is regenerated with every other projection.
 *
 * DETERMINISM. Work in flight first, then the stage order, then id; requirements and tasks by id;
 * no date, no wall clock and no absolute path reaches the text. One input, one byte sequence.
 */
export function renderPlan(initiatives = [], model = { tasks: [] }) {
  const { records, rows, inFlight, withRemaining, openJournalTasks } = planSections(initiatives, model)
  const lines = [
    '# План: инициативы журнала',
    '',
    'Сгенерированный вид из docs/analysis/*.json и журнала проекта (regenerateViews). Руками не правится; тексты требований остаются в записях анализа.',
    '',
  ]
  const decisions = planDecisions(model)
  if (records.length === 0) {
    lines.push('Записей анализа нет.')
    lines.push(...decisionSection(decisions))
    return lines.join('\n') + '\n'
  }
  // TWO COUNTS, TWO NAMES. "С открытыми задачами" counts INITIATIVES whose traced tasks are still
  // open - the last column of the table - and the open work below is listed per initiative. The
  // journal's own open tasks are a different set (a task need not be traced from a record), so
  // they are counted in their own sentence and listed under their own heading: the header used to
  // say "0 open tasks" next to a list of six (2026-11-28). The first three numbers keep their
  // wording because the panel parses this line (plugins/project-state-panel/client.js).
  const tracedOpen = inFlight.reduce((total, row) => total + row.openTasks.length, 0)
  lines.push(`Инициатив: ${rows.length}; с открытыми задачами: ${inFlight.length}; с несделанными требованиями: ${withRemaining.length}. Открытых задач журнала: ${openJournalTasks.length}; из них связаны с инициативой: ${tracedOpen}.`)
  lines.push('')
  lines.push('| Инициатива | Этап | Подтверждено | Осталось | Открытые задачи |')
  lines.push('|---|---|---|---|---|')
  for (const row of rows) {
    lines.push(`| ${row.record.id} — ${shortTitle(row.record.title)} | ${String(row.record.status ?? 'unknown')} | ${row.confirmed.length} из ${row.requirements.length} | ${idCell(row.remaining.map((requirement) => requirement.id))} | ${idCell(row.openTasks.map((task) => task.id))} |`)
  }
  lines.push(...decisionSection(decisions))
  if (inFlight.length > 0) {
    // The heading counts what the list under it holds, so the number in the header and the list
    // below can be checked against each other by reading the file.
    lines.push('', `## Открытые задачи инициатив (${inFlight.length} инициатив, ${tracedOpen} задач)`)
    for (const row of inFlight) {
      lines.push('', `### ${row.record.id}`)
      for (const task of row.openTasks) lines.push(`- ${task.id} (${String(task.status ?? 'unknown')}): ${shortTitle(task.title)}`)
    }
  }
  if (openJournalTasks.length > 0) {
    lines.push('', `## Открытые задачи журнала (${openJournalTasks.length})`)
    for (const task of openJournalTasks) lines.push(`- ${task.id} (${String(task.status ?? 'unknown')}): ${shortTitle(task.title)}`)
  }
  lines.push('', 'Записи анализа: docs/analysis/<initiative>.json.')
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}


/**
 * The plan's decisions block: one row per live DECISION, newest first, the initiative it belongs
 * to and the rule it states. The same derivation feeds `plan.yaml`, so the two views cannot
 * disagree about which rules hold. It renders even when the workspace has no analysis records
 * yet: a decision is the journal's, not the initiative's.
 */
function decisionSection(decisions) {
  if (decisions.length === 0) return []
  const lines = ['', `## Решения (${decisions.length})`, '', 'Порядок работ и условия остановки: строка — одно решение журнала; полный текст и причина — в файле решения.', '']
  lines.push('| Решение | Статус | Инициатива | Правило |')
  lines.push('|---|---|---|---|')
  for (const decision of decisions) {
    lines.push(`| ${decision.id} | ${cell(decision.status)} | ${cell(decision.initiative) === '' ? '—' : cell(decision.initiative)} | ${shortTitle(decision.title)} |`)
  }
  lines.push('', 'Файлы решений: state/decision/<ID>.md.')
  return lines
}

/** A YAML double-quoted scalar: JSON string escaping is a valid YAML 1.2 quoted scalar. */
const yamlString = (value) => JSON.stringify(String(value ?? ''))

/**
 * `state/plan.yaml`: the plan the state feed puts into a new session's FIRST message.
 *
 * WHY A SECOND FILE. `plan.md` is the readable view (one row per initiative, every open task);
 * it is ten kilobytes, and L1 already carries the digest and the board. This is the same plan
 * with the archive dropped: only initiatives with unfinished work, their stage, how many of
 * their requirements are confirmed, and the nearest open tasks - no requirement texts, no
 * tables. `plugins/state-feed/lib/feed.mjs` reads it as the `## Plan` section of L1 and folds
 * it into the projection hash, so a plan change is a state change, not a silent edit.
 *
 * DETERMINISM. Same inputs and the same row limits as `plan.md` (`planSections`), no clock and
 * no absolute path: two runs on unchanged state produce identical bytes. The row limits and the
 * title cut keep the file inside `PLAN_YAML_LIMIT_BYTES`; the generator never truncates mid-line,
 * because half a YAML row is worse than a shorter plan.
 *
 * @param {object[]} initiatives - the analysis records, as `loadInitiatives` returns them.
 * @param {{tasks?: object[]}} [model] - output of `buildModel`.
 * @returns {string} the YAML document, newline-terminated.
 */
export function renderPlanYaml(initiatives = [], model = { tasks: [] }) {
  const { rows, openJournalTasks } = planSections(initiatives, model)
  const live = rows.filter((row) => row.remaining.length > 0 || row.openTasks.length > 0)
  // WHAT IS COUNTED AND WHAT IS PRINTED, side by side. "initiativesWithOpenWork" is the total of
  // initiatives that have unfinished work; "initiativesListed" is how many rows follow in this
  // file, because the list is capped (PLAN_INITIATIVE_ROWS) and a count of 30 above ten rows read
  // as an error (2026-11-28). The same pair for the journal's open tasks, whose total is not the
  // per-row `openTasks` list either (that one is the initiative's traced tasks).
  const listedInitiatives = Math.min(live.length, PLAN_INITIATIVE_ROWS)
  const listedTasks = Math.min(openJournalTasks.length, PLAN_TASK_ROWS)
  const lines = [
    '# GENERATED — DO NOT EDIT. The plan summary the state feed delivers in L1,',
    '# written by regenerateViews() from docs/analysis/*.json and the journal. The full view is state/views/plan.md.',
    'schemaVersion: 1',
    `initiativesWithOpenWork: ${live.length}`,
    `initiativesListed: ${listedInitiatives}`,
    `openTasksInJournal: ${openJournalTasks.length}`,
    `openTasksListed: ${listedTasks}`,
  ]
  lines.push(live.length === 0 ? 'work: []' : 'work:')
  for (const row of live.slice(0, PLAN_INITIATIVE_ROWS)) {
    lines.push(`  - id: ${yamlString(row.record.id)}`)
    lines.push(`    title: ${yamlString(shortTitle(row.record.title, PLAN_YAML_TITLE_LIMIT))}`)
    lines.push(`    stage: ${yamlString(String(row.record.status ?? 'unknown'))}`)
    lines.push(`    confirmed: ${row.confirmed.length}`)
    lines.push(`    requirements: ${row.requirements.length}`)
    lines.push(`    openTasks: [${row.openTasks.map((task) => yamlString(task.id)).join(', ')}]`)
  }
  if (live.length > PLAN_INITIATIVE_ROWS) {
    lines.push(`  # +${live.length - PLAN_INITIATIVE_ROWS} more initiatives with open work: state/views/plan.md`)
  }
  const next = [openJournalTasks.length === 0 ? 'next: []' : 'next:']
  for (const task of openJournalTasks.slice(0, PLAN_TASK_ROWS)) {
    next.push(`  - id: ${yamlString(task.id)}`)
    next.push(`    status: ${yamlString(String(task.status ?? 'unknown'))}`)
    next.push(`    title: ${yamlString(shortTitle(task.title, PLAN_YAML_TITLE_LIMIT))}`)
  }
  if (openJournalTasks.length > PLAN_TASK_ROWS) {
    next.push(`  # +${openJournalTasks.length - PLAN_TASK_ROWS} more open tasks: state/views/plan.md`)
  }
  // THE DECISIONS COME BEFORE THE OPEN WORK: the order and the stop conditions are what a new
  // session has to know first. The cap is enforced here rather than hoped for, because this is
  // the one block that grows with every accepted decision: the OLDEST rows are dropped and named
  // by a marker (never a half row), while the newest decisions always make it in; `plan.md` still
  // lists all of them. One row is one line — id, initiative, short title — so four decisions cost
  // ~440 bytes instead of ~520 and the block fits beside the initiatives.
  const decisions = planDecisions(model)
  const decisionBlock = (shown) => {
    if (decisions.length === 0) return []
    const block = [`decisions: ${decisions.length}`]
    for (const decision of shown) {
      block.push(`  - { id: ${yamlString(decision.id)}, initiative: ${yamlString(decision.initiative)}, title: ${yamlString(shortTitle(decision.title, PLAN_YAML_TITLE_LIMIT))} }`)
    }
    if (shown.length < decisions.length) block.push(`  # +${decisions.length - shown.length} older decisions: state/views/plan.md`)
    return block
  }
  let shown = decisions.slice(0, PLAN_DECISION_ROWS)
  let block = decisionBlock(shown)
  const compose = () => `${[...lines, ...block, ...next].join('\n')}\n`
  while (shown.length > 0 && utf8(compose()) > PLAN_YAML_LIMIT_BYTES) {
    shown = shown.slice(0, -1)
    block = decisionBlock(shown)
  }
  // Even the count line can be one line too many: then the block leaves the file and plan.md
  // stays the only place a plan reader sees the decisions.
  if (shown.length === 0 && utf8(compose()) > PLAN_YAML_LIMIT_BYTES) block = []
  return compose()
}

/**
 * Render every projection.
 *
 * @param {object} model - output of `buildModel`.
 * @param {{lastSeq?: number, digestLimit?: number, staleIds?: Set<string>, plan?: object[]}} [options]
 * @returns {{[relPath: string]: string}} files keyed by their path under `state/views/`.
 */
export function renderViews(model, options = {}) {
  const lastSeq = options.lastSeq ?? 0
  return {
    'index.json': renderIndex(model, { lastSeq }),
    'digest.md': renderDigest(model, { lastSeq, limit: options.digestLimit ?? DIGEST_LIMIT_BYTES }),
    'board.md': renderBoard(model),
    'traceability.md': renderTraceability(model, options.staleIds ?? new Set()),
    'snapshot.md': renderSnapshot(model, { lastSeq }),
    'plan.md': renderPlan(options.plan ?? [], model),
    ...renderMaps(model),
  }
}
