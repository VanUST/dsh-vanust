/*
PROOF: the verification level decides whether a case is owed, and only independent counts criteria
Behavior: a task created at level proof or case closes with no acceptance case and never asks the
  case gate; a task at level independent asks it and its refusal (CRITERIA_UNCOVERED or
  CRITERIA_REQUIRED) refuses the close with the same code and its coverage; the row's verification
  and criteria are what the gate receives; a row with no level keeps the pre-P2 behaviour; criteria
  get stable ids (a bare string becomes AC-n) and duplicates are dropped.
Fails when: a proof task is blocked for a missing case, an independent close passes an uncovered
  criterion, the coverage refusal is reported as a case problem, or an old row starts asking for a
  level it never had.
Production path: plugins/taskboard/taskboard.mjs (VERIFICATION_LEVELS, criteriaOf, beforeClose) and
  the cases service's gateForTask (coverage lives there).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../taskboard.mjs'

const now = '2026-01-05T00:00:00.000Z'

function boardOf(task) {
  return { version: 1, revision: 3, tasks: [{ id: 'task-1', revision: 1, title: 'work', status: 'review', priority: 'normal', chatId: 'chat-1', createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z', ...task }] }
}

function harness(task, answer = () => ({ ok: true, blockers: [] })) {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-contract-'))
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  const boardPath = join(dir, 'taskboard.json')
  writeFileSync(boardPath, JSON.stringify(boardOf(task), null, 2) + '\n')
  const asked = []
  const cases = {
    gateForTask(cwd, taskId, context) {
      asked.push({ taskId, context })
      return answer(context)
    },
  }
  const registry = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    provide(name, service) { registry.set(name, service); return service },
    effect(fn) { fn(); return () => {} },
    on() {},
    get(name) { return name === 'cases' ? cases : undefined },
    tools: { register() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  apply(ctx, { file: boardPath, linksFile: join(dir, 'links.json'), lockWaitMs: 1000 })
  return { dir, asked, service: registry.get('taskboard') }
}

const closeArgs = (dir) => ({ id: 'task-1', chatId: 'chat-1', parentSessionId: 'root', result: { summary: 'accepted', evidence: ['node sum.mjs 1 2 3'] } })

test('a proof task closes with no case, and the case gate is never asked', () => {
  const { dir, asked, service } = harness({ role: 'BACKEND', preset: 'backend', verification: 'proof' })
  const closed = service.close(dir, closeArgs(dir))
  assert.equal(asked.length, 0, 'a proof task asked for a case')
  assert.equal(closed.ok, true, JSON.stringify(closed))
  assert.equal(closed.task.status, 'done')
})

test('a case-level task closes without a case too', () => {
  const { dir, asked, service } = harness({ role: 'BACKEND', preset: 'backend', verification: 'case' })
  const closed = service.close(dir, closeArgs(dir))
  assert.equal(asked.length, 0)
  assert.equal(closed.ok, true, JSON.stringify(closed))
})

test('an independent task hands the gate its level and its criteria', () => {
  const criteria = [{ id: 'AC-1', text: 'the sum is six' }]
  const { dir, asked, service } = harness({ role: 'BACKEND', preset: 'backend', verification: 'independent', criteria })
  service.close(dir, closeArgs(dir))
  assert.equal(asked.length, 1)
  assert.equal(asked[0].context.verification, 'independent')
  assert.deepEqual(asked[0].context.criteria, criteria)
  assert.equal(asked[0].context.implementerPreset, 'backend')
})

test('an uncovered criterion refuses the close by its own code, with the coverage', () => {
  const coverage = [{ id: 'AC-1', text: 'the sum is six', covered: true, caseId: 'sum-case' }, { id: 'AC-2', text: 'zero is accepted', covered: false, caseId: null }]
  const { dir, service } = harness({ role: 'BACKEND', preset: 'backend', verification: 'independent', criteria: [{ id: 'AC-1', text: 'x' }, { id: 'AC-2', text: 'y' }] }, () => ({
    ok: false,
    code: 'CRITERIA_UNCOVERED',
    message: 'not every acceptance criterion is covered by an acceptable case: AC-2',
    coverage,
  }))
  const closed = service.close(dir, closeArgs(dir))
  assert.equal(closed.ok, false)
  assert.equal(closed.code, 'CRITERIA_UNCOVERED', JSON.stringify(closed))
  assert.deepEqual(closed.coverage, coverage, 'the refusal dropped the coverage')
  assert.match(closed.message, /AC-2/)
})

test('an independent task with no criteria is refused as a contract problem', () => {
  const { dir, service } = harness({ role: 'BACKEND', preset: 'backend', verification: 'independent', criteria: [] }, () => ({ ok: false, code: 'CRITERIA_REQUIRED', message: 'no criteria', coverage: [] }))
  const closed = service.close(dir, closeArgs(dir))
  assert.equal(closed.ok, false)
  assert.equal(closed.code, 'CRITERIA_REQUIRED', JSON.stringify(closed))
})

test('a row with no level keeps the pre-P2 answer and passes no level to the gate', () => {
  const { dir, asked, service } = harness({ role: 'BACKEND', preset: 'backend' })
  service.close(dir, closeArgs(dir))
  assert.equal(asked.length, 1, 'a legacy row stopped asking the case gate')
  assert.equal(asked[0].context.verification, undefined)
  assert.equal(asked[0].context.criteria, undefined)
})

test('criteria ids are stable and de-duplicated', () => {
  const { service, dir } = harness({ role: 'BACKEND', preset: 'backend' })
  const created = service.create(dir, {
    title: 'Contract',
    role: 'BACKEND',
    preset: 'backend',
    chatId: 'chat-1',
    verification: 'independent',
    criteria: ['the first claim', { id: 'REQ-9-C01', text: 'the second claim' }, { id: 'REQ-9-C01', text: 'a duplicate id' }, '   '],
    constraints: ['no new dependency'],
  })
  assert.equal(typeof created.id, 'string', JSON.stringify(created))
  const row = service.get(dir, created.id)
  assert.equal(row.verification, 'independent')
  assert.deepEqual(row.criteria, [{ id: 'AC-1', text: 'the first claim' }, { id: 'REQ-9-C01', text: 'the second claim' }])
  assert.deepEqual(row.constraints, ['no new dependency'])
})

test('the close refuses a row whose shell changed the product', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'taskboard-shell-violation-'))
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  const boardPath = join(cwd, 'taskboard.json')
  writeFileSync(boardPath, JSON.stringify({ version: 1, revision: 3, tasks: [{ id: 'task-shell', revision: 1, title: 'shell', status: 'review', priority: 'normal', chatId: 'chat-1', role: 'BACKEND', preset: 'backend', caseIds: [], childSessionIds: ['child-shell'], createdAt: now, updatedAt: now }] }, null, 2) + '\n')
  writeFileSync(join(cwd, '.dsh', 'proof-guard-violations.json'), JSON.stringify([{ at: now, sessionId: 'child-shell', preset: 'tester', tool: 'pwsh', files: ['src/app.mjs'] }], null, 2) + '\n')
  const registry = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    provide(name, service) { registry.set(name, service); return service },
    effect(fn) { fn(); return () => {} },
    on() {},
    get() { return undefined },
    tools: { register() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  apply(ctx, { file: boardPath, linksFile: join(cwd, 'links.json'), lockWaitMs: 1000 })
  const service = registry.get('taskboard')
  const closed = service.close(cwd, { id: 'task-shell', chatId: 'chat-1', parentSessionId: 'child-shell', result: { summary: 'done', evidence: ['node x'] } })
  assert.equal(closed.ok, false, 'a row whose shell edited the product was closed')
  assert.equal(closed.code, 'product_shell_violation', JSON.stringify(closed))
  assert.deepEqual(closed.files, ['src/app.mjs'])
})

test('a violation recorded for the row\'s child refuses a close made by the orchestrator', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'taskboard-shell-child-'))
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  const boardPath = join(cwd, 'taskboard.json')
  writeFileSync(boardPath, JSON.stringify({ version: 1, revision: 3, tasks: [{ id: 'task-child', revision: 1, title: 'child row', status: 'review', priority: 'normal', chatId: 'chat-1', role: 'BACKEND', preset: 'backend', caseIds: [], childSessionIds: ['sess-tester'], createdAt: now, updatedAt: now }] }, null, 2) + '\n')
  writeFileSync(join(cwd, '.dsh', 'proof-guard-violations.json'), JSON.stringify([{ at: now, sessionId: 'sess-tester', preset: 'tester', tool: 'pwsh', files: ['src/app.mjs'] }], null, 2) + '\n')
  const registry = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    provide(name, service) { registry.set(name, service); return service },
    effect(fn) { fn(); return () => {} },
    on() {},
    get() { return undefined },
    tools: { register() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  apply(ctx, { file: boardPath, linksFile: join(cwd, 'links.json'), lockWaitMs: 1000 })
  // The orchestrator closes; the tester child is the one whose shell changed the product.
  const closed = registry.get('taskboard').close(cwd, { id: 'task-child', chatId: 'chat-1', parentSessionId: 'root', result: { summary: 'accepted', evidence: ['node x'] } })
  assert.equal(closed.ok, false, 'a row whose CHILD shell changed the product was closed')
  assert.equal(closed.code, 'product_shell_violation', JSON.stringify(closed))
  assert.match(closed.message, /sess-tester/)
})

/*
PROOF: the runtime's ledger writes are not a role's product edit when the close is judged
Behavior: a recorded shell-audit entry that names only state/ or .dsh/ files is not an edit the
  role made, so it does not refuse the close; an entry that also names a product file still
  refuses and reports only that product file. The recorded entry itself stays on disk.
Fails when: a ledger append recorded during a scoped shell refuses the row (the defect: the
  tester's task sat refused with files ['state/events.jsonl']), or the filter hides a real product
  edit recorded beside it.
*/
function closeWithRecord(record, id = 'task-shell') {
  const cwd = mkdtempSync(join(tmpdir(), 'taskboard-runtime-root-'))
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  const boardPath = join(cwd, 'taskboard.json')
  // The closing session is the one the record names; a linked child would make the close try to
  // interrupt it, which this harness has no service for.
  writeFileSync(boardPath, JSON.stringify({ version: 1, revision: 3, tasks: [{ id, revision: 1, title: 'row', status: 'review', priority: 'normal', chatId: 'chat-1', role: 'BACKEND', preset: 'backend', caseIds: [], createdAt: now, updatedAt: now }] }, null, 2) + '\n')
  const recordPath = join(cwd, '.dsh', 'proof-guard-violations.json')
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n')
  const registry = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    provide(name, service) { registry.set(name, service); return service },
    effect(fn) { fn(); return () => {} },
    on() {},
    get() { return undefined },
    tools: { register() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  apply(ctx, { file: boardPath, linksFile: join(cwd, 'links.json'), lockWaitMs: 1000 })
  const closed = registry.get('taskboard').close(cwd, { id, chatId: 'chat-1', parentSessionId: 'sess-tester', result: { summary: 'accepted', evidence: ['node x'] } })
  return { closed, recordPath }
}

test('a record that names only the ledger does not refuse the close, and the record is kept', () => {
  // The exact shape recorded for the tester's session: the journal and the view projections only.
  const record = [
    { at: now, sessionId: 'sess-tester', preset: 'tester', tool: 'bash', files: ['state/events.jsonl'] },
    { at: now, sessionId: 'sess-tester', preset: 'tester', tool: 'bash', files: ['state/views/.hashes.json', 'state/views/board.md', 'state/views/digest.md', 'state/views/index.json', 'state/views/snapshot.md'] },
  ]
  const { closed, recordPath } = closeWithRecord(record)
  assert.equal(closed.ok, true, JSON.stringify(closed))
  assert.deepEqual(JSON.parse(readFileSync(recordPath, 'utf8')), record, 'the recorded entry was deleted instead of judged')
})

test('a record that mixes the ledger with a product file still refuses, naming only the product file', () => {
  const { closed } = closeWithRecord([{ at: now, sessionId: 'sess-tester', preset: 'tester', tool: 'bash', files: ['.dsh/note.json', 'state/events.jsonl', 'src/app.mjs'] }])
  assert.equal(closed.ok, false, 'a product edit recorded beside a ledger append was accepted')
  assert.equal(closed.code, 'product_shell_violation', JSON.stringify(closed))
  assert.deepEqual(closed.files, ['src/app.mjs'])
})

/*
PROOF: a recorded product edit refuses only while its content is still there, and the area owner can
resolve a false record with a reason.
Behavior: the record stores the sha256 each file had after the command (proof-guard.mjs). The close
  refuses while the file still carries it; a file reverted to HEAD stops matching and stops
  refusing, with no manual edit of the record. The owner of the file area (DOCS for docs/, BACKEND
  for plugins/) resolves a false record with a reason; the resolution (who, when, why) stays in the
  violation ledger, and a resolved record never refuses. A surviving product edit still refuses in
  every close path: close, closeMany and applyMany (task_batch).
Fails when: a reverted file keeps the row refused; a resolved record still refuses; a foreign role
  resolves another area; or a surviving edit closes through a batch door.
*/
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/** A board row in review plus a violation ledger whose entry carries real files and their hashes. */
function shellHashHarness({ files, recordFiles, sessionId = 'sess-tester' }) {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-shell-hash-'))
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path.split('/').slice(0, -1).join('/')), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const hashes = {}
  for (const path of recordFiles) {
    try {
      hashes[path] = sha256(readFileSync(join(dir, path)))
    } catch {
      hashes[path] = null
    }
  }
  const boardPath = join(dir, 'taskboard.json')
  writeFileSync(boardPath, JSON.stringify({ version: 1, revision: 3, tasks: [{ id: 'task-shell', revision: 1, title: 'shell', status: 'review', priority: 'normal', chatId: 'chat-1', role: 'BACKEND', preset: 'backend', caseIds: [], createdAt: now, updatedAt: now }] }, null, 2) + '\n')
  const recordPath = join(dir, '.dsh', 'proof-guard-violations.json')
  writeFileSync(recordPath, JSON.stringify([{ at: now, sessionId, preset: 'tester', tool: 'pwsh', files: recordFiles, hashes }], null, 2) + '\n')
  const registry = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    provide(name, service) { registry.set(name, service); return service },
    effect(fn) { fn(); return () => {} },
    on() {},
    get() { return undefined },
    tools: { register() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  apply(ctx, { file: boardPath, linksFile: join(dir, 'links.json'), lockWaitMs: 1000 })
  return { dir, service: registry.get('taskboard'), recordPath, hashes }
}

const closeShell = (dir, service, extra = {}) => service.close(dir, { id: 'task-shell', chatId: 'chat-1', parentSessionId: 'sess-tester', result: { summary: 'accepted', evidence: ['node x'] }, ...extra })

test('a recorded edit refuses while its content is there and stops refusing once the file is back', () => {
  const file = 'docs/adr/CHANGE.md'
  const { dir, service } = shellHashHarness({ files: { [file]: 'written by another process during the window' }, recordFiles: [file] })
  const refused = closeShell(dir, service)
  assert.equal(refused.ok, false, 'a surviving recorded edit was closed')
  assert.equal(refused.code, 'product_shell_violation', JSON.stringify(refused))
  assert.deepEqual(refused.files, [file])
  // The file returns to its committed content: the record cannot name an edit that is gone.
  writeFileSync(join(dir, file), 'the committed content\n')
  const closed = closeShell(dir, service)
  assert.equal(closed.ok, true, `a reverted file still refused the close: ${JSON.stringify(closed)}`)
})

test('the area owner resolves a false record with a reason, and the resolution stays recorded', () => {
  const file = 'docs/adr/BOARD-JOURNAL-AND-SNAPSHOT.md'
  const { dir, service, recordPath } = shellHashHarness({ files: { [file]: 'the orchestrator wrote this' }, recordFiles: [file] })
  const foreign = service.resolveShellViolation(dir, { sessionId: 'sess-tester', files: [file], role: 'BACKEND', reason: 'not my area' })
  assert.equal(foreign.ok, false, 'a foreign role resolved another area')
  assert.equal(foreign.code, 'area_not_owned', JSON.stringify(foreign))
  const resolved = service.resolveShellViolation(dir, { sessionId: 'sess-tester', files: [file], role: 'DOCS', reason: 'the orchestrator edited the ADR in the same window; the tester never touched it' })
  assert.equal(resolved.ok, true, JSON.stringify(resolved))
  assert.equal(resolved.resolved, 1)
  const ledger = JSON.parse(readFileSync(recordPath, 'utf8'))
  assert.equal(ledger[0].resolved.by, 'DOCS')
  assert.match(ledger[0].resolved.reason, /orchestrator/)
  assert.equal(typeof ledger[0].resolved.at, 'string')
  const closed = closeShell(dir, service)
  assert.equal(closed.ok, true, `a resolved record still refused the close: ${JSON.stringify(closed)}`)
})

test('a surviving product edit still refuses close, closeMany and applyMany', () => {
  const file = 'plugins/app/src.mjs'
  const { dir, service } = shellHashHarness({ files: { [file]: 'edited by the role shell' }, recordFiles: [file] })
  const single = closeShell(dir, service)
  assert.equal(single.ok, false, 'close accepted a surviving product edit')
  const many = service.closeMany(dir, { ids: ['task-shell'], chatId: 'chat-1', parentSessionId: 'sess-tester', result: { summary: 'accepted', evidence: ['node x'] } })
  assert.equal(many.ok, false, 'closeMany accepted a surviving product edit')
  assert.equal(many.results[0].code, 'product_shell_violation', JSON.stringify(many.results[0]))
  const batch = service.applyMany(dir, [{ op: 'close', id: 'task-shell', resultSummary: 'accepted', resultEvidence: ['node x'] }], 'orchestrator', 'sess-tester')
  assert.equal(batch.ok, false, 'applyMany accepted a surviving product edit')
  assert.equal(batch.results[0].code, 'product_shell_violation', JSON.stringify(batch.results[0]))
})
