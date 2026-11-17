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
const STATUS_ORDER = ['open', 'active', 'review', 'done', 'blocked', 'cancelled', 'unverified', 'verified', 'failing', 'stale', 'proposed', 'accepted', 'superseded', 'dropped']
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
  }))
  const testRows = tests.map((test) => ({
    id: test.id,
    reqId: test.reqId ?? null,
    status: test.status,
    authorRole: test.authorRole ?? null,
    command: test.command ?? null,
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
      test: model.tests.length,
      decision: model.decisions.length,
    },
    reqs: model.reqs.map((req) => ({ id: req.id, status: req.status, tasks: req.tasks, tests: req.tests, decisions: req.decisions })),
    tasks: model.tasks.map((task) => ({ id: task.id, reqId: task.reqId ?? null, status: task.status, chore: task.chore === true })),
    tests: model.tests.map((test) => ({ id: test.id, reqId: test.reqId, status: test.status, evidenceRefs: test.evidenceRefs })),
    decisions: model.decisions.map((decision) => ({ id: decision.id, status: decision.status })),
  }
  return `${JSON.stringify(index, null, 2)}\n`
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
    lines.push('| id | title | req | chore |')
    lines.push('|---|---|---|---|')
    for (const task of tasks) lines.push(`| ${task.id} | ${cell(task.title)} | ${task.reqId ?? '—'} | ${task.chore === true ? 'yes' : 'no'} |`)
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

/** `snapshot.md`: counts and the last journal sequence (never a wall clock). */
export function renderSnapshot(model, { lastSeq = 0 } = {}) {
  const lines = ['# State snapshot', '', 'GENERATED — DO NOT EDIT.', '', `- last journal event: ${lastSeq}`, `- REQ: ${model.reqs.length}`, `- DECISION: ${model.decisions.length}`, `- TASK: ${model.tasks.length}`, `- TEST: ${model.tests.length}`, '', '## Tasks by status', '']
  const counts = new Map()
  for (const task of model.tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1)
  for (const status of [...counts.keys()].sort()) lines.push(`- ${status}: ${counts.get(status)}`)
  return `${lines.join('\n')}\n`
}

/** `digest.md`: the small block the L1 layer will deliver; hard-capped. */
export function renderDigest(model, { lastSeq = 0, limit = DIGEST_LIMIT_BYTES } = {}) {
  const lines = ['# Project state', '', 'GENERATED — DO NOT EDIT.', '', `REQ ${model.reqs.length} · TASK ${model.tasks.length} · TEST ${model.tests.length} · event ${lastSeq}`, '']
  const open = model.tasks.filter((task) => task.status === 'open' || task.status === 'active' || task.status === 'review')
  if (open.length > 0) {
    lines.push('## Open work', '')
    for (const task of open.sort(byStatusThenId)) lines.push(`- ${task.id} ${task.status}: ${cell(task.title).slice(0, 120)}${task.reqId ? ` (${task.reqId})` : ''}`)
    lines.push('')
  }
  if (model.reqs.length > 0) {
    lines.push('## Requirements', '')
    for (const req of model.reqs) {
      const facts = [`${req.tasks.length} task${req.tasks.length === 1 ? '' : 's'}`, `${req.tests.length} test${req.tests.length === 1 ? '' : 's'}`]
      lines.push(`- ${req.id} ${req.status}: ${cell(req.title).slice(0, 120)} — ${facts.join(', ')}`)
    }
    lines.push('')
  }
  return truncateBytes(`${lines.join('\n')}\n`, limit)
}

/**
 * Render every projection.
 *
 * @param {object} model - output of `buildModel`.
 * @param {{lastSeq?: number, digestLimit?: number, staleIds?: Set<string>}} [options]
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
    ...renderMaps(model),
  }
}
