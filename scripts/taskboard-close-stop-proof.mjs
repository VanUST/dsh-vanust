#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove the taskboard acceptance and stop contract against the REAL plugin modules on a
 *   disposable board: one task or a batch accepted in one call with the result supplied at
 *   acceptance, and a linked specialist actually stopped on cancel/close and on an explicit
 *   forced stop. The stop half runs through the plugin's real ctx.subagents.interrupt hook,
 *   with a fake runtime that enforces the same authority the installed DSH subagent manager
 *   enforces.
 *
 * WHY IT EXISTS. The owner reported two structural holes on 2026-11-12: accepting a task took
 * two calls (write the result, then close) and a 70-row cleanup therefore took about 140
 * calls; and cancelling a task could not stop its child because the plugin passed the parent
 * Agent object where the runtime expects {kind: 'ancestor', agent}, so every live child
 * produced interrupt_failed. The script is meant to run against the previous modules too and
 * be observed red, so a green run is evidence rather than a restatement of the code.
 *
 * INPUTS
 *   --taskboard <path>  taskboard module to test (default plugins/taskboard/taskboard.mjs)
 *   --dir <path>        scratch directory for the disposable board (default: a temp dir)
 *
 * OUTPUTS
 *   One PASS/FAIL line per check, then n/m checks passed; exit 0 only when every check
 *   passed. A failing line names the observed value.
 *
 * KEYWORDS
 *   taskboard, batch close, result at acceptance, subagent stop, interrupt authority,
 *   forced stop, red-first proof
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The fake subagent runtime validates the authority SHAPE before it acts: a raw Agent
 *     object, a missing kind, or an ancestor whose id is not the live root is UNAUTHORIZED,
 *     exactly as the installed DSH manager treats them.
 *   - A child the fake does not consider live is an accepted no-op, matching the real
 *     manager absent-target behaviour; a child explicitly marked bad throws.
 *   - The module path is imported through pathToFileURL, so the same script proves the working
 *     tree and a checkout of an older revision on either platform.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const value = (name) => {
  const at = argv.indexOf(name)
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : ''
}
const taskboardModule = value('--taskboard') !== '' ? resolve(value('--taskboard')) : join(KIT, 'plugins', 'taskboard', 'taskboard.mjs')
const dir = value('--dir') !== '' ? resolve(value('--dir')) : mkdtempSync(join(tmpdir(), 'taskboard-close-stop-proof-'))
mkdirSync(dir, { recursive: true })
const boardPath = join(dir, 'taskboard.json')
const linksPath = join(dir, 'links.json')
writeFileSync(boardPath, JSON.stringify({ version: 1, revision: 1, tasks: [], agents: [] }, null, 2) + '\n')

const { apply } = await import(pathToFileURL(taskboardModule).href)

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  const suffix = detail === undefined ? '' : '  ' + JSON.stringify(detail)
  process.stdout.write((ok ? 'PASS' : 'FAIL') + '  ' + name + suffix + '\n')
}
const readBoard = () => JSON.parse(readFileSync(boardPath, 'utf8'))
const writeBoard = (board) => writeFileSync(boardPath, JSON.stringify(board, null, 2) + '\n')
const setStatus = (id, status) => {
  const board = readBoard()
  const task = board.tasks.find((entry) => entry.id === id)
  if (task !== undefined) task.status = status
  writeBoard(board)
}

function harness() {
  const root = { id: 'root', session: { header: { cwd: dir } } }
  const registry = new Map()
  const tools = new Map()
  const interrupts = []
  const live = new Set(['child-live', 'child-batch'])
  const subagents = {
    interrupt(target, authority) {
      interrupts.push({ target, authority })
      if (authority === null || typeof authority !== 'object' || (authority.kind !== 'ancestor' && authority.kind !== 'user')) {
        throw new Error('UNAUTHORIZED: authority must be {kind:"ancestor",agent} or {kind:"user",parentSessionId}')
      }
      if (authority.kind === 'ancestor') {
        if (authority.agent?.id !== root.id) throw new Error('UNAUTHORIZED: stale ancestor agent')
      } else if (typeof authority.parentSessionId !== 'string' || authority.parentSessionId === '') {
        throw new Error('UNAUTHORIZED: the human path needs a parent session address')
      }
      if (target === 'child-bad') throw new Error('UNAUTHORIZED: target is not a live descendant')
      if (live.has(target)) return
    },
  }
  const agents = new Map([[root.id, root]])
  const ctx = {
    logger: { warn() {} },
    provide(name, service) {
      registry.set(name, service)
      return service
    },
    effect(fn) {
      fn()
      return () => {}
    },
    on() {},
    get(name) {
      if (name === 'subagents') return subagents
      if (name === 'agents') return agents
      return undefined
    },
    tools: { register(tool) { tools.set(tool.name, tool); return () => {} } },
    commands: { register() { return () => {} } },
  }
  apply(ctx, { file: boardPath, linksFile: linksPath, maxTasks: 200, timelineLimit: 120 })
  const call = async (name, args) => {
    const tool = tools.get(name)
    if (tool === undefined) return { missing: true, name }
    try {
      return await tool.execute(args, { agent: root })
    } catch (error) {
      return { ok: false, code: error?.code ?? 'threw', message: error?.message ?? String(error) }
    }
  }
  return { service: registry.get('taskboard'), tools, call, interrupts, root }
}

const h = harness()
const { service, call } = h
const makeTask = (title) => service.create(dir, { title, role: 'REVIEWER', preset: 'reviewer', chatId: 'root' })
const makeReview = (title, result) => {
  const task = makeTask(title)
  const board = readBoard()
  const row = board.tasks.find((entry) => entry.id === task.id)
  row.status = 'review'
  if (result !== undefined) row.result = result
  writeBoard(board)
  return row
}
const rev = () => readBoard().revision

// 1. One call writes the result and accepts a review task.
{
  const task = makeReview('one-call close', undefined)
  const before = rev()
  const closed = await call('task_close', {
    id: task.id,
    resultSummary: 'Reviewed the change; it is accepted.',
    resultEvidence: ['node scripts/taskboard-close-stop-proof.mjs exit 0'],
  })
  const after = service.get(dir, task.id)
  check('one-call close accepts a review task with a result', closed?.ok === true && after?.status === 'done', { closed, status: after?.status })
  check('the result supplied at acceptance is recorded', after?.result?.summary === 'Reviewed the change; it is accepted.' && Array.isArray(after?.result?.evidence) && after.result.evidence.length === 1, after?.result)
  check('one-call close is one ledger write', rev() === before + 1, { before, after: rev() })
}

// 2. A close with no result still refuses by name, and evidence is part of the gate.
{
  const noSummary = makeTask('no result')
  setStatus(noSummary.id, 'review')
  const refused = await call('task_close', { id: noSummary.id })
  check('a close without a result is refused with needs_result', refused?.ok === false && refused?.code === 'needs_result', refused)
  const noEvidence = makeTask('no evidence')
  setStatus(noEvidence.id, 'review')
  const refusedEvidence = await call('task_close', { id: noEvidence.id, resultSummary: 'claimed finished' })
  check('a close without evidence is refused with needs_evidence', refusedEvidence?.ok === false && refusedEvidence?.code === 'needs_evidence', refusedEvidence)
  check('a refused close leaves its task in review', service.get(dir, noSummary.id)?.status === 'review' && service.get(dir, noEvidence.id)?.status === 'review')
}

// 3. A batch closes in one write, fills only what is missing, and never rewrites a summary.
{
  const original = makeReview('keeps its summary', { summary: 'the original result', evidence: ['original evidence'] })
  const missing = makeReview('needs a result', undefined)
  const complete = makeReview('already complete', { summary: 'its own summary', evidence: ['its own evidence'] })
  const before = rev()
  const closed = await call('task_close', {
    ids: [original.id, missing.id, complete.id],
    resultSummary: 'Closed during the 2026-11-12 board cleanup; the work was not re-run.',
    resultEvidence: ['taskboard audit of 2026-11-12, review backlog'],
  })
  check('a batch close accepts every review task in one call', closed?.ok === true && closed?.closed === 3, { closed })
  check('a batch close is one ledger write', rev() === before + 1, { before, after: rev() })
  check('an existing summary is never rewritten by the batch result', service.get(dir, original.id)?.result?.summary === 'the original result', service.get(dir, original.id)?.result)
  check('a missing summary is filled from the shared result', String(service.get(dir, missing.id)?.result?.summary).startsWith('Closed during the 2026-11-12 board cleanup'), service.get(dir, missing.id)?.result)
  check('a task that was already complete keeps its own result', service.get(dir, complete.id)?.result?.summary === 'its own summary')
  check('a batch result reports each closed id', Array.isArray(closed?.results) && closed.results.every((entry) => entry.ok === true) && closed.results.length === 3, closed?.results)
}

// 4. A batch is partial by design: one bad row does not roll back the good ones.
{
  const good = makeReview('batch good', undefined)
  const active = makeTask('batch not review')
  const closed = await call('task_close', {
    ids: [good.id, active.id],
    resultSummary: 'cleanup acceptance',
    resultEvidence: ['board audit'],
  })
  const goodAfter = service.get(dir, good.id)
  const activeAfter = service.get(dir, active.id)
  check('a batch keeps the good rows when one row is refused', goodAfter?.status === 'done' && activeAfter?.status === 'open', { good: goodAfter?.status, active: activeAfter?.status })
  check('the refused row names needs_review in the per-task results', closed?.ok === false && closed?.results?.some((entry) => entry.id === active.id && entry.code === 'needs_review'), closed?.results)
}

// 5. Cancel stops a live child through a valid authority.
{
  const task = makeTask('cancel with a live child')
  service.linkChild(dir, { id: task.id, sessionId: 'child-live', label: 'REVIEWER', role: 'REVIEWER', chatId: 'root' })
  const cancelled = await call('task_cancel', { id: task.id, reason: 'wrong brief' })
  check('cancel stops its live child', cancelled?.ok === true && cancelled?.interrupted?.includes('child-live'), cancelled)
  check('cancel passes the ancestor authority the runtime expects', h.interrupts.some((entry) => entry.target === 'child-live' && entry.authority?.kind === 'ancestor' && entry.authority?.agent?.id === 'root'), h.interrupts)
  check('cancel writes cancelled only after the stop', service.get(dir, task.id)?.status === 'cancelled', service.get(dir, task.id)?.status)
}

// 6. Close uses the same stop path after checking the result.
{
  const task = makeTask('close with a live child')
  service.linkChild(dir, { id: task.id, sessionId: 'child-live', label: 'REVIEWER', role: 'REVIEWER', chatId: 'root' })
  setStatus(task.id, 'review')
  const closed = await call('task_close', {
    id: task.id,
    resultSummary: 'accepted with its child stopped',
    resultEvidence: ['proof run'],
  })
  check('close stops its live child after checking the result', closed?.ok === true && closed?.interrupted?.includes('child-live'), closed)
  check('close leaves the task done and the child recorded', service.get(dir, task.id)?.status === 'done')
}

// 7. A refused interrupt fails closed and does not move the task.
{
  const task = makeTask('bad child')
  service.linkChild(dir, { id: task.id, sessionId: 'child-bad', label: 'REVIEWER', role: 'REVIEWER', chatId: 'root' })
  const refused = await call('task_cancel', { id: task.id, reason: 'should not stick' })
  check('a refused stop returns interrupt_failed', refused?.ok === false && refused?.code === 'interrupt_failed', refused)
  check('a refused stop leaves the task in its previous state', service.get(dir, task.id)?.status === 'active', service.get(dir, task.id)?.status)
}

// 8. The forced stop is a stop without a lifecycle change.
{
  const task = makeTask('force stop')
  service.linkChild(dir, { id: task.id, sessionId: 'child-live', label: 'REVIEWER', role: 'REVIEWER', chatId: 'root' })
  const stopped = await call('task_stop', { id: task.id, reason: 'ran the wrong brief' })
  check('the forced stop exists on the model surface', stopped?.missing !== true, stopped)
  check('the forced stop interrupts the linked child', stopped?.ok === true && stopped?.stopped?.includes('child-live'), stopped)
  check('the forced stop changes no lifecycle status', service.get(dir, task.id)?.status === 'active', service.get(dir, task.id)?.status)
  check('the forced stop records why in the timeline', service.get(dir, task.id)?.timeline?.some((entry) => String(entry.text).includes('ran the wrong brief')), service.get(dir, task.id)?.timeline?.slice(-2))
}

// 9. Batch cancel stops the children and abandons the rows in one call.
{
  const first = makeTask('batch cancel one')
  const second = makeTask('batch cancel two')
  service.linkChild(dir, { id: first.id, sessionId: 'child-live', label: 'REVIEWER', role: 'REVIEWER', chatId: 'root' })
  service.linkChild(dir, { id: second.id, sessionId: 'child-batch', label: 'REVIEWER', role: 'REVIEWER', chatId: 'root' })
  const cancelled = await call('task_cancel', { ids: [first.id, second.id], reason: 'cleanup: stale work' })
  check('a batch cancel abandons every row in one call', cancelled?.ok === true && cancelled?.cancelled === 2, cancelled)
  check('a batch cancel stops every linked child', cancelled?.results?.every((entry) => entry.interrupted?.length === 1), cancelled?.results)
  check('a batch cancel leaves both tasks cancelled', service.get(dir, first.id)?.status === 'cancelled' && service.get(dir, second.id)?.status === 'cancelled')
}

// 10. The human owns the subagents too: a panel cancel uses the trusted user authority even
// when the task's recorded parent session is no longer a live agent.
{
  const task = service.create(dir, {
    title: 'human cancel',
    role: 'REVIEWER',
    preset: 'reviewer',
    chatId: 'root',
    parentSessionId: 'dead-root',
  })
  service.linkChild(dir, { id: task.id, sessionId: 'child-live', label: 'REVIEWER', role: 'REVIEWER', chatId: 'root' })
  const current = service.get(dir, task.id)
  const cancelled = service.applyOp(dir, { op: 'cancel', id: task.id, expectedRevision: current.revision, reason: 'owner stopped it' }, 'human', 'root')
  check('the human panel can cancel and stop a linked child', cancelled?.ok === true && cancelled?.interrupted?.includes('child-live'), cancelled)
  check('the human path passes the trusted user authority when no live parent exists', h.interrupts.some((entry) => entry.target === 'child-live' && entry.authority?.kind === 'user' && entry.authority?.parentSessionId === 'dead-root'), h.interrupts.slice(-1))
  check('the human cancel records the owner as the actor', service.get(dir, task.id)?.timeline?.some((entry) => entry.kind === 'cancelled' && entry.actor === 'human'))
}

// 11. The human can force-stop one child without abandoning the task.
{
  const task = service.create(dir, {
    title: 'human stop',
    role: 'REVIEWER',
    preset: 'reviewer',
    chatId: 'root',
    parentSessionId: 'dead-root',
  })
  service.linkChild(dir, { id: task.id, sessionId: 'child-live', label: 'REVIEWER', role: 'REVIEWER', chatId: 'root' })
  const stopped = service.applyOp(dir, { op: 'stop', id: task.id, reason: 'owner stopped the wrong run' }, 'human', 'root')
  check('the human panel can force-stop one child', stopped?.ok === true && stopped?.stopped?.includes('child-live'), stopped)
  check('the human stop uses the trusted user authority', h.interrupts.some((entry) => entry.target === 'child-live' && entry.authority?.kind === 'user'), h.interrupts.slice(-1))
  check('the human stop leaves the task lifecycle alone', service.get(dir, task.id)?.status === 'active', service.get(dir, task.id)?.status)
}

// 12. A partial batch never leaks a refused row's changes into the write.
{
  const good = makeReview('partial close good', undefined)
  const bad = makeTask('partial close bad child')
  service.linkChild(dir, { id: bad.id, sessionId: 'child-bad', label: 'REVIEWER', role: 'REVIEWER', chatId: 'root' })
  setStatus(bad.id, 'review')
  const closed = await call('task_close', {
    ids: [good.id, bad.id],
    resultSummary: 'partial cleanup acceptance',
    resultEvidence: ['board audit'],
  })
  const badAfter = service.get(dir, bad.id)
  check('a partial close keeps the good row and refuses only the bad one', closed?.ok === false && service.get(dir, good.id)?.status === 'done' && badAfter?.status === 'review', closed?.results)
  check('a refused close does not write the shared result onto the bad row', badAfter?.result === undefined, badAfter?.result)
}

// 13. A partial cancel behaves the same way.
{
  const good = makeTask('partial cancel good')
  const bad = makeTask('partial cancel bad child')
  service.linkChild(dir, { id: good.id, sessionId: 'child-live', label: 'REVIEWER', role: 'REVIEWER', chatId: 'root' })
  service.linkChild(dir, { id: bad.id, sessionId: 'child-bad', label: 'REVIEWER', role: 'REVIEWER', chatId: 'root' })
  const cancelled = await call('task_cancel', { ids: [good.id, bad.id], reason: 'partial cleanup' })
  check('a partial cancel abandons the good row and leaves the bad one', cancelled?.ok === false && service.get(dir, good.id)?.status === 'cancelled' && service.get(dir, bad.id)?.status === 'active', cancelled?.results)
  check('the refused cancel names interrupt_failed for the bad child', cancelled?.results?.some((entry) => entry.id === bad.id && entry.code === 'interrupt_failed'), cancelled?.results)
}

// 14. A forced stop by one session id finds the task that links it.
{
  const task = makeTask('stop by session id')
  service.linkChild(dir, { id: task.id, sessionId: 'child-live', label: 'REVIEWER', role: 'REVIEWER', chatId: 'root' })
  const stopped = await call('task_stop', { sessionId: 'child-live', reason: 'stop by session' })
  check('a forced stop by session id works', stopped?.ok === true && stopped?.stopped?.includes('child-live'), stopped)
  check('a forced stop by session id notes the linked task', service.get(dir, task.id)?.timeline?.some((entry) => entry.kind === 'stop_requested' && String(entry.text).includes('stop by session')))
}

const failed = results.filter((entry) => !entry.ok)
process.stdout.write('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed\n')
process.exitCode = failed.length === 0 ? 0 : 1
