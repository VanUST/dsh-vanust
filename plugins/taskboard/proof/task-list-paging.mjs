/**
 * PURPOSE
 *   Prove, by running the plugin's real `task_list` tool, that the workspace board is paged
 *   instead of dumped: page one carries counts by status, the first `limit` rows and a `next`
 *   cursor; limit/offset read the next page; a status filter narrows the page; and the chat
 *   scope keeps its own default page size. Measured on the surface this replaces 2026-11-18:
 *   `task_list` with scope workspace returned 61 884 characters for 239 tasks and every
 *   later request re-sent them.
 *
 * INPUTS
 *   A temporary workspace holding a seeded `.dsh/taskboard.json` (60 rows, 4 statuses,
 *   all owned by one chat). No real board is read or written.
 *
 * OUTPUTS
 *   One table row per check, then `task-list paging proof: PASS|FAIL (n checks)`.
 *   Exit code 0 only when every row passed.
 *
 * KEYWORDS
 *   taskboard, task_list, paging, limit, offset, counts, next, proof
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../taskboard.mjs'

const CHAT = 'chat-root'
const STATUSES = ['open', 'active', 'review', 'done']
const workspace = mkdtempSync(join(tmpdir(), 'task-list-paging-'))
const now = Date.now()
const tasks = Array.from({ length: 60 }, (_, index) => ({
  id: `task-${index}`,
  title: `Task ${index}`,
  status: STATUSES[index % STATUSES.length],
  chatId: CHAT,
  revision: 1,
  createdAt: now,
  updatedAt: now,
}))
mkdirSync(join(workspace, '.dsh'), { recursive: true })
writeFileSync(join(workspace, '.dsh', 'taskboard.json'), JSON.stringify({ version: 1, revision: 1, agents: [], tasks }))

const registered = []
const ctx = {
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  get() { return undefined },
  on() { return () => {} },
  effect(fn) { return fn() },
  tools: { register(tool) { registered.push(tool) } },
  provide(name, value) { return value },
  systemPrompt: { section: () => () => {} },
  commands: { register() {} },
}
apply(ctx, {})

const tool = registered.find((candidate) => candidate.name === 'task_list')
const exec = { agent: { id: CHAT, session: { header: { cwd: workspace } } } }

const rows = []
let failed = false
function check(scenario, ok, detail) {
  rows.push({ scenario, ok, detail })
  if (!ok) failed = true
}

try {
  check('the tool is registered', tool !== undefined, tool === undefined ? 'no task_list tool' : 'task_list found')
  if (tool === undefined) throw new Error('cannot continue without the tool')

  const first = await tool.execute({ scope: 'workspace' }, exec)
  check('workspace page one — 25 rows of 60', first.tasks.length === 25 && first.total === 60, `rows=${first.tasks.length} total=${first.total}`)
  check('page one carries counts by status', first.counts.open === 15 && first.counts.review === 15, JSON.stringify(first.counts))
  check('page one carries the next cursor', first.next?.offset === 25 && first.next?.limit === 25, JSON.stringify(first.next))
  check('page one carries the hint', typeof first.hint === 'string' && first.hint.includes('next.offset'), first.hint ?? 'no hint')
  check('page one is far below the old dump', JSON.stringify(first).length < 12000, `${JSON.stringify(first).length} chars`)

  const second = await tool.execute({ scope: 'workspace', limit: 10, offset: 50 }, exec)
  check('offset page — 10 rows, no next', second.tasks.length === 10 && second.next === undefined, `rows=${second.tasks.length} next=${second.next === undefined ? 'none' : 'present'}`)
  check('offset page keeps the total', second.total === 60, `total=${second.total}`)

  const review = await tool.execute({ scope: 'workspace', status: 'review' }, exec)
  check('status filter — only review rows', review.total === 15 && review.tasks.every((task) => task.status === 'review'), `total=${review.total}`)
  check('status filter — requested status named', review.status === 'review', String(review.status))

  const chat = await tool.execute({}, exec)
  check('chat scope — default 50 rows and a cursor', chat.tasks.length === 50 && chat.next?.offset === 50 && chat.scope === 'chat', `rows=${chat.tasks.length} next=${JSON.stringify(chat.next)}`)

  const capped = await tool.execute({ scope: 'workspace', limit: 999 }, exec)
  check('limit is capped at 200', capped.tasks.length === 60, `rows=${capped.tasks.length}`)
} finally {
  rmSync(workspace, { recursive: true, force: true })
}

const width = rows.reduce((max, row) => Math.max(max, row.scenario.length), 'scenario'.length)
console.log('task-list paging proof — seeded board of 60 tasks (temporary workspace, removed)\n')
for (const row of rows) console.log(`${row.scenario.padEnd(width)}  ${row.ok ? 'PASS' : 'FAIL'} ${row.detail}`)
console.log('')
console.log(failed ? `task-list paging proof: FAIL (${rows.length} checks)` : `task-list paging proof: PASS (${rows.length} checks)`)
process.exitCode = failed ? 1 : 0
