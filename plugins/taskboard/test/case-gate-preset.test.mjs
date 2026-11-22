/*
PROOF: the close gate judges independence against the IMPLEMENTER's preset, not the closer's
Behavior: taskboard.beforeClose reads the row it is about to close and hands the case gate the
  preset that did the work (the row's `preset`, or `orchestrator` for an inline task); the gate's
  refusal refuses the close and names the case and the fact, and its evidence travels with the
  refusal. A row whose role has no recorded preset leaves the preset unknown instead of guessing,
  and a task that does not exist is left to the close's own `not_found`.
Fails when: the gate is called without the implementer preset (so an acceptance case passes
  because nothing was compared), the closing session's preset is used instead of the row's, or a
  refusal stops naming the case.
Production path: plugins/taskboard/taskboard.mjs (apply -> hooks.beforeClose, describeBlocker) and
  the `cases` service the test-cases plugin provides.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../taskboard.mjs'

const AT = '2026-01-05T00:00:00.000Z'

function boardOf(task) {
  return { version: 1, revision: 3, tasks: [{ id: 'task-1', revision: 1, title: 'work', status: 'review', priority: 'normal', chatId: 'chat-1', createdAt: AT, updatedAt: AT, ...task }], agents: [] }
}

/**
 * The plugin over a fake Host whose `cases` service records every question it is asked and
 * answers with the blocker a real case gate would return.
 */
function harness(task, { answer = undefined } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-case-gate-'))
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  const boardPath = join(dir, 'taskboard.json')
  writeFileSync(boardPath, JSON.stringify(boardOf(task), null, 2) + '\n')
  const asked = []
  const cases = {
    gateForTask(cwd, taskId, context) {
      asked.push({ cwd, taskId, context })
      return typeof answer === 'function' ? answer(context) : answer
    },
  }
  const registry = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    provide(name, service) { registry.set(name, service); return service },
    effect(fn) { fn(); return () => {} },
    on() {},
    get(name) {
      if (name === 'cases') return cases
      return undefined
    },
    tools: { register() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  apply(ctx, { file: boardPath, linksFile: join(dir, 'links.json'), lockWaitMs: 1000 })
  return { dir, asked, service: registry.get('taskboard') }
}

const closeArgs = (dir) => ({ id: 'task-1', chatId: 'chat-1', parentSessionId: 'root', result: { summary: 'accepted', evidence: ['node --test x'] } })

test('a role task hands the gate its preset; the refusal names the case and the fact', () => {
  const { dir, asked, service } = harness({ role: 'BACKEND', preset: 'backend' }, {
    answer: () => ({
      ok: false,
      blockers: [{ id: 'probe-case', status: 'verified', reason: 'SELF_RUN' }],
      evidence: [{ id: 'probe-case', status: 'verified', runBy: { preset: 'backend' } }],
    }),
  })
  const closed = service.close(dir, closeArgs(dir))
  assert.equal(asked.length, 1, 'the case gate was not consulted')
  assert.equal(asked[0].taskId, 'task-1')
  assert.equal(asked[0].context.implementerPreset, 'backend', 'the gate did not receive the row\'s preset')
  assert.equal(closed.ok, false, JSON.stringify(closed))
  assert.equal(closed.code, 'cases_not_green')
  assert.match(closed.message, /probe-case/, 'the refusal does not name the case')
  assert.match(closed.message, /the implementer ran it/, 'the refusal does not say why')
  assert.deepEqual(closed.blockers.map((entry) => entry.id), ['probe-case'])
})

test('an inline task is the owner\'s own work: the orchestrator is the implementer', () => {
  const { dir, asked, service } = harness({ inline: true }, { answer: () => ({ ok: true, blockers: [] }) })
  const closed = service.close(dir, closeArgs(dir))
  assert.equal(asked[0].context.implementerPreset, 'orchestrator')
  assert.equal(closed.ok, true, JSON.stringify(closed))
  assert.equal(closed.task.status, 'done')
})

test('the row owns its case ids, and the close passes them to the gate', () => {
  const { dir, asked, service } = harness({ role: 'BACKEND', preset: 'backend', caseIds: ['case-a', 'case-b'] }, { answer: () => ({ ok: true, blockers: [] }) })
  const closed = service.close(dir, closeArgs(dir))
  assert.deepEqual(asked[0].context.caseIds, ['case-a', 'case-b'], 'the close did not pass the row links')
  assert.equal(closed.ok, true, JSON.stringify(closed))
})

test('an empty caseIds list is passed as an empty list: the task owes no case', () => {
  const { dir, asked, service } = harness({ inline: true, caseIds: [] }, { answer: () => ({ ok: true, blockers: [] }) })
  const closed = service.close(dir, closeArgs(dir))
  assert.deepEqual(asked[0].context.caseIds, [])
  assert.equal(closed.ok, true, JSON.stringify(closed))
})

test('a NEW task states its links even when it has none, so it is not a legacy row', () => {
  const { dir, service } = harness({ role: 'BACKEND', preset: 'backend' })
  const created = service.create(dir, { title: 'Fresh work', role: 'BACKEND', preset: 'backend', chatId: 'chat-1' })
  assert.equal(typeof created.id, 'string', JSON.stringify(created))
  const row = service.get(dir, created.id)
  assert.deepEqual(row.caseIds, [], 'a new task without a case must still carry an explicit empty list')
})

test('task_update attaches case ids by hand, de-duplicated and bounded', () => {
  const { dir, service } = harness({ role: 'BACKEND', preset: 'backend' })
  const updated = service.update(dir, { id: 'task-1', expectedRevision: 1, patch: { caseIds: ['case-a', ' case-b ', 'case-a'] } })
  assert.equal(updated.ok, true, JSON.stringify(updated))
  assert.deepEqual(updated.task.caseIds, ['case-a', 'case-b'])
  const cleared = service.update(dir, { id: 'task-1', expectedRevision: updated.task.revision, patch: { caseIds: [] } })
  assert.deepEqual(cleared.task.caseIds, [], 'an empty list must be stored, not dropped')
})

test('a close whose row names a case that is gone refuses by name', () => {
  const { dir, service } = harness({ role: 'BACKEND', preset: 'backend', caseIds: ['gone-case'] }, {
    answer: () => ({ ok: false, blockers: [{ id: 'gone-case', status: null, reason: 'CASE_MISSING', reasons: ['CASE_MISSING'] }], errors: [] }),
  })
  const closed = service.close(dir, closeArgs(dir))
  assert.equal(closed.ok, false)
  assert.equal(closed.code, 'cases_not_green')
  assert.match(closed.message, /gone-case/)
  assert.match(closed.message, /not in the library any more/)
})

test('an unreadable case file refuses the close by name, not by silence', () => {
  const { dir, service } = harness({ role: 'BACKEND', preset: 'backend' }, {
    answer: () => ({
      ok: false,
      blockers: [],
      errors: [{ id: 'broken-case', code: 'CASE_UNREADABLE', message: 'the case file could not be read, so its evidence cannot be judged' }],
    }),
  })
  const closed = service.close(dir, closeArgs(dir))
  assert.equal(closed.ok, false, JSON.stringify(closed))
  assert.equal(closed.code, 'cases_unreadable')
  assert.match(closed.message, /broken-case/, 'the refusal does not name the file')
  assert.match(closed.message, /CASE_UNREADABLE/, 'the refusal does not name the reason')
  assert.deepEqual(closed.errors.map((entry) => entry.code), ['CASE_UNREADABLE'])
})

test('a role row with no recorded preset leaves the implementer unknown instead of guessing', () => {
  const { dir, asked, service } = harness({ role: 'BACKEND' }, { answer: () => ({ ok: false, blockers: [{ id: 'x', status: 'verified', reason: 'IMPLEMENTER_UNKNOWN' }] }) })
  const closed = service.close(dir, closeArgs(dir))
  assert.equal(asked.length, 1)
  assert.equal(asked[0].context.implementerPreset, undefined)
  assert.equal(closed.ok, false)
  assert.match(closed.message, /independence cannot be shown/)
})

test('a close without a case gate keeps the legacy behaviour, and a missing task is not the gate\'s refusal', () => {
  const { dir, asked, service } = harness({ role: 'BACKEND', preset: 'backend' })
  // No answer: the fake returns undefined, which is a profile without the case library.
  const legacy = service.close(dir, closeArgs(dir))
  assert.equal(asked.length, 1)
  assert.equal(legacy.ok, true, JSON.stringify(legacy))
  const missing = service.close(dir, { ...closeArgs(dir), id: 'task-absent' })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'not_found', JSON.stringify(missing))
  assert.equal(asked.length, 1, 'the gate was asked about a task that does not exist')
})
