#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove the taskboard's CHILD LEASE contract against the real plugin modules on a
 *   disposable board: one child session serves one task at a time, linking it to a second
 *   task transfers the lease (the first task loses the id and cannot stop it), a stop only
 *   interrupts the child that task still owns, a settled child releases its lease, and a
 *   ROOT agent can write another chat's task on purpose (`scope: 'workspace'`) while the
 *   same write without the scope is still refused with `other_chat`.
 *
 * WHY IT EXISTS. The owner measured two structural traps on 2026-11-12 in a live workspace:
 *   1. a second brief was delegated to a role whose session was still running the first one
 *      (`delegate_task` answered `reused: true`), so the ledger brief executed inside the
 *      stored-band child's turn and the two results interleaved;
 *   2. closing the schema task stopped the child that had since been handed the frame
 *      deletion, because BOTH tasks listed that session and `task_close` interrupts its
 *      linked children.
 * The fixes live in the ledger, not in a chat: `linkChild` transfers the lease, the role row
 * records `currentTaskId`, `interruptChildren` skips a child leased elsewhere, the delegator
 * refuses a busy socket, and the write scope is explicit. This script is meant to run
 * against the PREVIOUS modules too (`--taskboard /path/to/old/taskboard.mjs`) and be observed
 * red, so a green run is evidence rather than a restatement of the code.
 *
 * INPUTS
 *   --taskboard <path>     taskboard module to test (default plugins/taskboard/taskboard.mjs)
 *   --orchestrator <path>  orchestrator module for the reuse guard (default: plugins/orchestrator/orchestrator.mjs)
 *   --dir <path>           scratch directory for the disposable board (default: a temp dir)
 *
 * OUTPUTS
 *   One PASS/FAIL line per check, then n/m checks passed; exit 0 only when every check
 *   passed. A failing line names the observed value.
 *
 * KEYWORDS
 *   taskboard, child lease, lease transfer, interrupt, workspace scope, delegate reuse,
 *   red-first proof
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A role row written before the lease existed has no `currentTaskId`; the interrupt path
 *     falls back to "the newest task that links the child", so legacy boards stay safe.
 *   - The fake subagent runtime records every interrupt and rejects an unauthorized
 *     authority shape, so "was not stopped" cannot be a silent no-op.
 *   - The module paths are imported through pathToFileURL, so the same script proves the
 *     working tree and a checkout of an older revision on either platform.
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
const orchestratorModule = value('--orchestrator') !== '' ? resolve(value('--orchestrator')) : join(KIT, 'plugins', 'orchestrator', 'orchestrator.mjs')
const dir = value('--dir') !== '' ? resolve(value('--dir')) : mkdtempSync(join(tmpdir(), 'taskboard-lease-proof-'))
mkdirSync(dir, { recursive: true })
const boardPath = join(dir, 'taskboard.json')
const linksPath = join(dir, 'links.json')
writeFileSync(boardPath, JSON.stringify({ version: 1, revision: 1, tasks: [], agents: [] }, null, 2) + '\n')

const { apply } = await import(pathToFileURL(taskboardModule).href)
const orchestrator = await import(pathToFileURL(orchestratorModule).href)

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  const suffix = detail === undefined ? '' : '  ' + JSON.stringify(detail)
  process.stdout.write((ok ? 'PASS' : 'FAIL') + '  ' + name + suffix + '\n')
}
const readBoard = () => JSON.parse(readFileSync(boardPath, 'utf8'))
const writeBoard = (board) => writeFileSync(boardPath, JSON.stringify(board, null, 2) + '\n')

function harness() {
  const root = { id: 'root', session: { header: { cwd: dir } } }
  const registry = new Map()
  const tools = new Map()
  const interrupts = []
  const subagents = {
    interrupt(target, authority) {
      interrupts.push({ target, authority })
      if (authority === null || typeof authority !== 'object' || (authority.kind !== 'ancestor' && authority.kind !== 'user')) {
        throw new Error('UNAUTHORIZED: authority must be {kind:"ancestor",agent} or {kind:"user",parentSessionId}')
      }
      if (authority.kind === 'ancestor' && authority.agent?.id !== root.id) throw new Error('UNAUTHORIZED: stale ancestor agent')
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
  return { service: registry.get('taskboard'), tools, interrupts, root }
}

const h = harness()
const { service } = h
const CHAT_A = 'session-chat-a'
const CHAT_B = 'session-chat-b'
const CHILD = 'child-lease-1'
const PRESET = 'backend'

const makeTask = (title, chatId = CHAT_A) => service.create(dir, { title, role: 'BACKEND', preset: PRESET, chatId })
const markReview = (id) => {
  const board = readBoard()
  const row = board.tasks.find((entry) => entry.id === id)
  if (row !== undefined) {
    row.status = 'review'
    row.result = { summary: 'done', evidence: ['evidence'] }
  }
  writeBoard(board)
}

// 0. The role's child starts on task A.
const taskA = makeTask('task A - stored band')
service.registerAgent(dir, { role: 'BACKEND', label: 'BACKEND', sessionId: CHILD, taskId: taskA.id, chatSessionId: CHAT_A, preset: PRESET })
const linkedA = service.linkChild(dir, { id: taskA.id, sessionId: CHILD, label: 'BACKEND', role: 'BACKEND', chatId: CHAT_A })
check('linkChild links the child to the first task', linkedA?.ok === true && linkedA.task.childSessionIds.includes(CHILD), linkedA?.ok)
check('the role row records the lease', readBoard().agents.find((agent) => agent.sessionId === CHILD)?.currentTaskId === taskA.id, readBoard().agents.find((agent) => agent.sessionId === CHILD)?.currentTaskId)

// 1. The same child is handed to task B — the lease transfers.
const taskB = makeTask('task B - frame deletion')
const linkedB = service.linkChild(dir, { id: taskB.id, sessionId: CHILD, label: 'BACKEND', role: 'BACKEND', chatId: CHAT_A })
const boardAfter = readBoard()
const rowA = boardAfter.tasks.find((entry) => entry.id === taskA.id)
const rowB = boardAfter.tasks.find((entry) => entry.id === taskB.id)
check('linking the same child to a second task transfers the lease', linkedB?.ok === true && rowB.childSessionIds.includes(CHILD), { ok: linkedB?.ok })
check('the first task no longer lists the child', Array.isArray(rowA.childSessionIds) && rowA.childSessionIds.includes(CHILD) === false, rowA.childSessionIds)
check('the first task records the child as moved', (rowA.children ?? []).find((child) => child.sessionId === CHILD)?.status === 'moved', (rowA.children ?? []).find((child) => child.sessionId === CHILD)?.status)
check('the move is on the first task timeline', (rowA.timeline ?? []).some((entry) => String(entry.text ?? '').includes('handed to task')), undefined)
check('the role row now leases the second task', (boardAfter.agents.find((agent) => agent.sessionId === CHILD)?.currentTaskId) === taskB.id, boardAfter.agents.find((agent) => agent.sessionId === CHILD)?.currentTaskId)
check('linkChild reports which task lost the lease', Array.isArray(linkedB?.movedFrom) && linkedB.movedFrom.includes(taskA.id), linkedB?.movedFrom)

// 2. Closing the FIRST task must not stop a child it no longer owns.
markReview(taskA.id)
const closedA = await Promise.resolve(service.close(dir, { id: taskA.id, chatId: CHAT_A, actor: 'orchestrator', parentSessionId: 'root' }))
check('closing the first task succeeds', closedA?.ok === true, closedA?.code)
check('closing the first task does NOT interrupt the child it lost', h.interrupts.length === 0, h.interrupts)
check('the first task had no child left to stop', (closedA?.interrupted ?? []).length === 0 && (closedA?.skipped ?? []).length === 0, { interrupted: closedA?.interrupted, skipped: closedA?.skipped })


// 2b. A LEGACY board can still list one child under two tasks (it was written before the
//     lease existed). The interrupt path must consult the lease, not the list, and report
//     what it refused to stop.
const legacyA = makeTask('legacy task A')
const legacyB = makeTask('legacy task B')
service.registerAgent(dir, { role: 'LEGACY', label: 'LEGACY', sessionId: 'child-legacy', taskId: legacyB.id, chatSessionId: CHAT_A, preset: PRESET })
service.linkChild(dir, { id: legacyB.id, sessionId: 'child-legacy', label: 'LEGACY', role: 'LEGACY', chatId: CHAT_A })
{
  const stale = readBoard()
  stale.tasks.find((entry) => entry.id === legacyA.id).childSessionIds.push('child-legacy')
  stale.tasks.find((entry) => entry.id === legacyA.id).status = 'review'
  stale.tasks.find((entry) => entry.id === legacyA.id).result = { summary: 'stale row', evidence: ['evidence'] }
  writeBoard(stale)
}
const interruptsBefore = h.interrupts.length
const closedLegacy = await Promise.resolve(service.close(dir, { id: legacyA.id, chatId: CHAT_A, actor: 'orchestrator', parentSessionId: 'root' }))
check('a legacy duplicate link does not stop the child that another task leases', h.interrupts.length === interruptsBefore, h.interrupts.slice(interruptsBefore))
check('the skipped stop is reported with the owning task', Array.isArray(closedLegacy?.skipped) && closedLegacy.skipped.some((entry) => entry.childId === 'child-legacy' && entry.taskId === legacyB.id), closedLegacy)

// 3. Closing the OWNING task stops the child.
markReview(taskB.id)
const closedB = await Promise.resolve(service.close(dir, { id: taskB.id, chatId: CHAT_A, actor: 'orchestrator', parentSessionId: 'root' }))
check('closing the owning task succeeds', closedB?.ok === true, closedB?.code)
check('closing the owning task interrupts its child', h.interrupts.some((entry) => entry.target === CHILD), h.interrupts)
check('the owning close reports the interrupted child', Array.isArray(closedB?.interrupted) && closedB.interrupted.includes(CHILD), closedB?.interrupted)
check('a stopped child releases the lease', readBoard().agents.find((agent) => agent.sessionId === CHILD)?.currentTaskId === null, readBoard().agents.find((agent) => agent.sessionId === CHILD)?.currentTaskId)

// 4. A settled child is free for the next brief.
const taskC = makeTask('task C - next brief', CHAT_A)
service.linkChild(dir, { id: taskC.id, sessionId: CHILD, label: 'BACKEND', role: 'BACKEND', chatId: CHAT_A })
const leaseWhileRunning = readBoard().agents.find((agent) => agent.sessionId === CHILD)?.currentTaskId
service.childEnded(CHILD, { stopReason: 'completed' })
check('a running child holds the lease', leaseWhileRunning === taskC.id, leaseWhileRunning)
check('a settled child releases the lease', readBoard().agents.find((agent) => agent.sessionId === CHILD)?.currentTaskId === null, readBoard().agents.find((agent) => agent.sessionId === CHILD)?.currentTaskId)

// 5. Cross-chat writes: refused by default, allowed on purpose, attributed.
const crossNoteRefused = service.note(dir, { id: taskC.id, text: 'from another chat', chatId: CHAT_B, actor: 'orchestrator' })
check('a cross-chat note is refused without the workspace scope', crossNoteRefused?.ok === false && crossNoteRefused.code === 'other_chat', crossNoteRefused?.code)
const crossNoteAllowed = service.note(dir, { id: taskC.id, text: 'directive from another chat', chatId: CHAT_B, actor: 'orchestrator', scope: 'workspace' })
const notedTask = readBoard().tasks.find((entry) => entry.id === taskC.id)
check('the workspace scope lets a root agent note on another chat task', crossNoteAllowed?.ok === true, crossNoteAllowed?.code)
check('the cross-chat note names the chat it came from', (notedTask.timeline ?? []).some((entry) => String(entry.text ?? '').includes(`[from chat ${CHAT_B}]`)), (notedTask.timeline ?? []).at(-1)?.text)
const crossUpdateRefused = service.update(dir, { id: taskC.id, expectedRevision: notedTask.revision, patch: { priority: 'high' }, chatId: CHAT_B, actor: 'orchestrator' })
check('a cross-chat update is refused without the workspace scope', crossUpdateRefused?.ok === false && crossUpdateRefused.code === 'other_chat', crossUpdateRefused?.code)
const crossUpdateAllowed = service.update(dir, { id: taskC.id, expectedRevision: readBoard().tasks.find((entry) => entry.id === taskC.id).revision, patch: { priority: 'high' }, chatId: CHAT_B, actor: 'orchestrator', scope: 'workspace' })
check('the workspace scope lets a root agent update another chat task', crossUpdateAllowed?.ok === true, crossUpdateAllowed?.code)

// 6. The delegator refuses a busy socket and reuses a free one.
const busy = { sessionId: CHILD, preset: PRESET, status: 'active', currentTaskId: taskC.id }
const free = { sessionId: CHILD, preset: PRESET, status: 'sleeping', currentTaskId: null }
check('a busy role session is not reused', orchestrator.canReuseAgent(busy, PRESET) === false, orchestrator.canReuseAgent(busy, PRESET))
check('a free role session is reused', orchestrator.canReuseAgent(free, PRESET) === true, orchestrator.canReuseAgent(free, PRESET))
check('the busy refusal explains itself', String(orchestrator.reuseNoteFor(busy, 'BACKEND', PRESET) ?? '').includes(taskC.id), orchestrator.reuseNoteFor(busy, 'BACKEND', PRESET))

const passed = results.filter((entry) => entry.ok).length
process.stdout.write(`\ntaskboard lease proof: ${passed === results.length ? 'PASS' : 'FAIL'} (${passed}/${results.length} checks)\n`)
process.exit(passed === results.length ? 0 : 1)
