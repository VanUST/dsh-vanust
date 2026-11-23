/*
PROOF: one review task covers several tasks, refuses to let its reviewer close them, and closes only with a verdict for each
Behavior: task_create/task_update accept reviewedTaskIds (2-8, de-duplicated); fewer than 2, more than 8,
  an unknown id or the task itself is refused by name; a batch review task cannot close until
  reviewResults names EVERY reviewed task with a pass/fail verdict (review_results_missing); the
  session that runs the review cannot close a task it reviews (reviewed_task_close), while the
  orchestrator's own close still works; each verdict carries findings and evidence per task.
Fails when: a reviewer closes a reviewed task, a review task closes with two verdicts for three
  tasks, an unknown id enters a batch, or a normal close is refused because some other row names it.
Production path: plugins/taskboard/taskboard.mjs (reviewedTaskIdsOf, batchRefusal, close guard,
  reviewResults in update) and the close's completeness check.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../taskboard.mjs'

const now = '2026-01-05T00:00:00.000Z'
const row = (id, overrides = {}) => ({ id, revision: 1, title: id, status: 'review', priority: 'normal', chatId: 'chat-1', createdAt: now, updatedAt: now, caseIds: [], childSessionIds: [], ...overrides })

function board(tasks) {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-batch-review-'))
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  const boardPath = join(dir, 'taskboard.json')
  writeFileSync(boardPath, JSON.stringify({ version: 1, revision: 5, tasks }, null, 2) + '\n')
  const registry = new Map()
  const tools = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    provide(name, service) { registry.set(name, service); return service },
    effect(fn) { fn(); return () => {} },
    on() {},
    get() { return undefined },
    tools: { register(tool) { if (typeof tool?.name === 'string') tools.set(tool.name, tool); return () => {} } },
    commands: { register() { return () => {} } },
  }
  apply(ctx, { file: boardPath, linksFile: join(dir, 'links.json'), lockWaitMs: 1000 })
  const call = (name, args) => tools.get(name).execute(args, { agent: { session: { header: { cwd: dir } } } })
  return { dir, service: registry.get('taskboard'), tools, call }
}

const batch = (n) => Array.from({ length: n }, (_, index) => row(`task-${index + 1}`))

test('a batch is 2-8 tasks, de-duplicated, and every id must exist', () => {
  const { dir, service } = board(batch(4))
  const two = service.update(dir, { id: 'task-1', expectedRevision: 1, patch: { reviewedTaskIds: ['task-2', 'task-2', 'task-3'] } })
  assert.equal(two.ok, true, JSON.stringify(two))
  assert.deepEqual(two.task.reviewedTaskIds, ['task-2', 'task-3'])
  const three = service.create(dir, { title: 'Review', role: 'REVIEWER', preset: 'reviewer', chatId: 'chat-1', reviewedTaskIds: ['task-1'] })
  assert.equal(three.code, 'review_batch_too_small', JSON.stringify(three))
  const tooMany = service.create(dir, { title: 'Review', role: 'REVIEWER', preset: 'reviewer', chatId: 'chat-1', reviewedTaskIds: Array.from({ length: 9 }, (_, index) => `task-${index + 1}`) })
  assert.ok(tooMany.code === 'review_batch_too_large' || tooMany.code === 'review_batch_unknown', JSON.stringify(tooMany))
  const unknown = service.create(dir, { title: 'Review', role: 'REVIEWER', preset: 'reviewer', chatId: 'chat-1', reviewedTaskIds: ['task-1', 'nope'] })
  assert.equal(unknown.code, 'review_batch_unknown', JSON.stringify(unknown))
})

test('a batch review closes only with a verdict for every reviewed task', () => {
  const { dir, service } = board([row('task-review', { role: 'REVIEWER', preset: 'reviewer' }), ...batch(3)])
  const attached = service.update(dir, { id: 'task-review', expectedRevision: 1, patch: { reviewedTaskIds: ['task-1', 'task-2', 'task-3'] } })
  assert.equal(attached.ok, true, JSON.stringify(attached))
  assert.deepEqual(attached.task.reviewedTaskIds, ['task-1', 'task-2', 'task-3'])
  const reviewId = 'task-review'
  const revision = attached.task.revision
  const partial = service.update(dir, { id: reviewId, expectedRevision: revision, patch: { reviewResults: [{ taskId: 'task-1', verdict: 'pass' }] } })
  assert.equal(partial.code, 'review_results_incomplete', JSON.stringify(partial))
  assert.deepEqual(partial.missing, ['task-2', 'task-3'])
  const badVerdict = service.update(dir, { id: reviewId, expectedRevision: revision, patch: { reviewResults: [{ taskId: 'task-1', verdict: 'maybe' }, { taskId: 'task-2', verdict: 'pass' }, { taskId: 'task-3', verdict: 'pass' }] } })
  assert.equal(badVerdict.code, 'review_results_incomplete')
  const blocked = service.close(dir, { id: reviewId, chatId: 'chat-1', parentSessionId: 'root', result: { summary: 'reviewed', evidence: ['node sum.mjs 1 2 3'] } })
  assert.equal(blocked.code, 'review_results_missing', JSON.stringify(blocked))
  const full = service.update(dir, { id: reviewId, expectedRevision: revision, patch: { reviewResults: [
    { taskId: 'task-1', verdict: 'pass', evidence: ['node sum.mjs 1 2 3 -> 6'] },
    { taskId: 'task-2', verdict: 'fail', findings: ['drops the last argument'] },
    { taskId: 'task-3', verdict: 'pass' },
  ] } })
  assert.equal(full.ok, true, JSON.stringify(full))
  assert.equal(full.task.reviewResults[1].verdict, 'fail')
  assert.deepEqual(full.task.reviewResults[1].findings, ['drops the last argument'])
  const closed = service.close(dir, { id: reviewId, chatId: 'chat-1', parentSessionId: 'root', result: { summary: 'reviewed', evidence: ['node sum.mjs 1 2 3'] } })
  assert.equal(closed.ok, true, JSON.stringify(closed))
})

test('the reviewer child cannot close a task it reviews; the orchestrator can', () => {
  // A review row is under way (status review) and one child runs it, which is how a batch is
  // really shaped: the row exists before the reviewer starts.
  const { dir, service } = board([row('task-review', { role: 'REVIEWER', preset: 'reviewer' }), ...batch(2)])
  const attached = service.update(dir, { id: 'task-review', expectedRevision: 1, patch: { reviewedTaskIds: ['task-1', 'task-2'] } })
  assert.equal(attached.ok, true, JSON.stringify(attached))
  const linked = service.linkChild(dir, { id: 'task-review', sessionId: 'child-reviewer', chatId: 'chat-1' })
  assert.equal(linked.ok, true, JSON.stringify(linked))
  const fromChild = service.close(dir, { id: 'task-1', chatId: 'chat-1', parentSessionId: 'child-reviewer' })
  assert.equal(fromChild.ok, false, 'the reviewer closed a reviewed task')
  assert.equal(fromChild.code, 'reviewed_task_close', JSON.stringify(fromChild))
  assert.match(fromChild.message, /task-1/)
  const fromRoot = service.close(dir, { id: 'task-1', chatId: 'chat-1', parentSessionId: 'root', result: { summary: 'accepted', evidence: ['node sum.mjs 1 2 3 -> 6'] } })
  assert.equal(fromRoot.ok, true, JSON.stringify(fromRoot))
  // The neighbour is untouched: a failed task goes back to active by itself, not its peers.
  assert.equal(service.get(dir, 'task-2').status, 'review')
})

test('the task_update TOOL writes the batch and the verdicts (the whitelist defect)', async () => {
  // The reviewer reports through the tool, not through the service: a field that the parameters
  // declare but the write whitelist drops answers {ok:true} and changes nothing, and the close then
  // fails with review_results_missing.
  const { dir, service, call } = board([row('task-review', { role: 'REVIEWER', preset: 'reviewer' }), ...batch(2)])
  const attached = await call('task_update', { id: 'task-review', expectedRevision: 1, reviewedTaskIds: ['task-1', 'task-2'] })
  assert.equal(attached.ok, true, JSON.stringify(attached))
  assert.deepEqual(attached.task.reviewedTaskIds, ['task-1', 'task-2'])

  const incomplete = await call('task_update', {
    id: 'task-review',
    expectedRevision: attached.task.revision,
    reviewResults: [{ taskId: 'task-1', verdict: 'pass' }],
  })
  assert.equal(incomplete.ok, false, 'an incomplete verdict set was accepted by the tool')
  assert.equal(incomplete.code, 'review_results_incomplete', JSON.stringify(incomplete))

  const unknown = await call('task_update', {
    id: 'task-review',
    expectedRevision: attached.task.revision,
    reviewResults: [{ taskId: 'task-1', verdict: 'pass' }, { taskId: 'task-9', verdict: 'pass' }],
  })
  assert.equal(unknown.ok, false, 'a verdict for a task outside the batch was accepted')
  assert.equal(unknown.code, 'review_results_incomplete', JSON.stringify(unknown))

  const reported = await call('task_update', {
    id: 'task-review',
    expectedRevision: attached.task.revision,
    reviewResults: [
      { taskId: 'task-1', verdict: 'pass', evidence: ['node sum.mjs 1 2 3 -> 6'] },
      { taskId: 'task-2', verdict: 'fail', findings: ['drops the last argument'] },
    ],
  })
  assert.equal(reported.ok, true, JSON.stringify(reported))
  assert.equal(reported.task.reviewResults.length, 2)
  const stored = JSON.parse(readFileSync(join(dir, 'taskboard.json'), 'utf8')).tasks.find((task) => task.id === 'task-review')
  assert.equal(stored.reviewResults?.[1]?.verdict, 'fail', 'the verdicts never reached the file')

  const closed = await call('task_close', { id: 'task-review', resultSummary: 'reviewed the batch', resultEvidence: ['node sum.mjs 1 2 3'] })
  assert.equal(closed.ok, true, JSON.stringify(closed))
  // The reviewed tasks were never touched by the review: they are still in review for the
  // orchestrator to close one by one.
  const tasks = JSON.parse(readFileSync(join(dir, 'taskboard.json'), 'utf8')).tasks
  assert.equal(tasks.find((task) => task.id === 'task-1').status, 'review')
  assert.equal(tasks.find((task) => task.id === 'task-2').status, 'review')
})

test('every task_update parameter reaches the row: the declared keys and the write list agree', async () => {
  const { TASK_UPDATE_FIELDS } = await import('../taskboard.mjs')
  const { tools } = board([row('task-review', { role: 'REVIEWER', preset: 'reviewer' }), ...batch(2)])
  const declared = Object.keys(tools.get('task_update').parameters.properties ?? {})
  const missing = declared.filter((key) => key !== 'id' && key !== 'expectedRevision' && key !== 'scope' && key !== 'resultSummary' && key !== 'resultEvidence' && key !== 'resultArtifacts' && key !== 'resultDecisions' && key !== 'resultRisks' && !TASK_UPDATE_FIELDS.includes(key))
  assert.deepEqual(missing, [], 'a declared parameter is written nowhere')
})

test('a verdict without a batch is refused by name', async () => {
  const { service, call } = board([row('task-plain', { role: 'REVIEWER', preset: 'reviewer' }), ...batch(2)])
  const verdict = await call('task_update', { id: 'task-plain', expectedRevision: 1, reviewResults: [{ taskId: 'task-1', verdict: 'pass' }, { taskId: 'task-2', verdict: 'pass' }] })
  assert.equal(verdict.ok, false, 'verdicts were accepted for a task that reviews nothing')
  assert.equal(verdict.code, 'review_results_incomplete', JSON.stringify(verdict))
  assert.deepEqual(verdict.unknown, ['task-1', 'task-2'])
  assert.equal(service.get(undefined === undefined ? call.dir : call.dir, 'task-plain').reviewResults, undefined)
})

test('the write set and the tool parameters name the same fields, in both directions', async () => {
  const { TASK_UPDATE_FIELDS } = await import('../taskboard.mjs')
  const { tools } = board([row('task-plain', { role: 'BACKEND', preset: 'backend' })])
  const declared = Object.keys(tools.get('task_update').parameters.properties ?? {})
  // Fields the tool assembles itself (result* -> result) or that name the row rather than a column.
  // 'scope' is both a task column and the workspace-scope switch: it is declared AND written.
  const notColumns = new Set(['id', 'expectedRevision', 'resultSummary', 'resultEvidence', 'resultArtifacts', 'resultDecisions', 'resultRisks'])
  const declaredColumns = declared.filter((key) => !notColumns.has(key))
  assert.deepEqual(declaredColumns.filter((key) => !TASK_UPDATE_FIELDS.includes(key)), [], 'a declared parameter is written nowhere')
  assert.deepEqual(TASK_UPDATE_FIELDS.filter((key) => !declaredColumns.includes(key)), [], 'the write list names a field the tool does not declare')
})
