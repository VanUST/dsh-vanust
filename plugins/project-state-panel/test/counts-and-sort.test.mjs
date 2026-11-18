/*
PROOF: the State header counters and the Board list sort are computed by named pure helpers
Behavior: the panel exports taskCounts (unfinished = not done/cancelled, active = status active),
  activeSubagents (running child sessions of this chat, current session excluded), taskRow (merges
  the projection row with the entity frontmatter: title, steps/stepsDone, reqIds, updatedAt) and
  sortTasks (Relevance: active → blocked → review → open → done → cancelled, then more steps done,
  then updatedAt desc, then id; plus Updated, Status, Title). Loading the real client module through
  a loader stand-in proves the helpers the UI calls, not a copy of them.
Fails when: a counter stops following its rule, the Relevance order or one of its tie-breaks changes,
  a sort stops being deterministic or mutates its input, the panel loses the Board/List toggle and
  the sort tags with aria-pressed, or a write call appears beside the reads.
  CASE_NEGATIVE_CONTROL=expect-pre-fix flips the assertions to the pre-fix shape (no helpers, no
  list), which must fail on the fixed files (the measured red).
Production path: plugins/project-state-panel/client.js — the State header trigger and BoardMode.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { join } from 'node:path'

const ROOT = process.env.PANEL_ROOT ?? process.cwd()
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''
const PANEL = 'plugins/project-state-panel/client.js'

function loadPanel() {
  const source = readFileSync(join(ROOT, PANEL), 'utf8')
  const react = {
    createElement: () => null,
    Component: class { constructor(props) { this.props = props } },
    Fragment: Symbol.for('react.fragment'),
    useState: () => [null, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: () => ({ current: null }),
  }
  let exported = null
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory((name) => (name === 'react' ? react : null)) } } }
  new Function('window', 'document', 'sessionStorage', source)(
    window,
    { addEventListener: () => {}, removeEventListener: () => {}, getElementById: () => null, activeElement: null },
    { getItem: () => null, setItem: () => {} },
  )
  return exported
}

const task = (id, status, extra = {}) => ({ id, reqId: null, status, ...extra })
const titles = (rows) => rows.map((row) => row.id)

function violations() {
  const source = readFileSync(join(ROOT, PANEL), 'utf8')
  const found = []
  const check = (name, actual, expected) => {
    if (!isDeepStrictEqual(actual, expected)) found.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
  if (control === 'expect-pre-fix') {
    // The pre-fix shape: no count/sort helpers and no task list.
    let api = null
    try { api = loadPanel()?.__test ?? null } catch { api = null }
    if (api !== null) found.push('pre-fix control: the panel already exports the count/sort helpers (expected them absent before the fix)')
    if (/ps-tasklist/.test(source)) found.push('pre-fix control: the task list table is already present (expected it absent before the fix)')
    if (/Unfinished tasks in this workspace/.test(source)) found.push('pre-fix control: the header counters are already present (expected them absent before the fix)')
    return found
  }

  const api = loadPanel()?.__test ?? null
  if (api === null) {
    found.push('the panel module exports no __test helpers (taskCounts, activeSubagents, taskRow, sortTasks)')
    return found
  }
  for (const name of ['statusRank', 'sortTasks', 'taskCounts', 'activeSubagents', 'taskRow']) {
    if (typeof api[name] !== 'function') found.length === 0 && found.push(`the panel does not export ${name}`)
  }
  if (typeof api.sortTasks !== 'function' || typeof api.taskCounts !== 'function' || typeof api.taskRow !== 'function' || typeof api.activeSubagents !== 'function') return found

  const rows = [
    task('T-30', 'cancelled', { stepsDone: 0, updatedAt: '2026-11-17T09:00:00Z' }),
    task('T-21', 'done', { stepsDone: 5, updatedAt: '2026-11-18T09:00:00Z' }),
    task('T-11', 'open', { stepsDone: 1, updatedAt: '2026-11-18T10:00:00Z' }),
    task('T-05', 'review', { stepsDone: 2, updatedAt: '2026-11-18T08:00:00Z' }),
    task('T-02', 'blocked', { stepsDone: 0, updatedAt: '2026-11-18T07:00:00Z' }),
    task('T-01', 'active', { stepsDone: 1, updatedAt: '2026-11-18T06:00:00Z' }),
  ]
  check('Relevance order', titles(api.sortTasks(rows, 'relevance')), ['T-01', 'T-02', 'T-05', 'T-11', 'T-21', 'T-30'])
  check('Relevance does not mutate the input', rows.map((row) => row.id), ['T-30', 'T-21', 'T-11', 'T-05', 'T-02', 'T-01'])

  const ties = [
    task('T-03', 'active', { stepsDone: 2, updatedAt: '2026-11-18T10:00:00Z' }),
    task('T-02', 'active', { stepsDone: 2, updatedAt: '2026-11-18T11:00:00Z' }),
    task('T-01', 'active', { stepsDone: 3, updatedAt: '2026-11-18T06:00:00Z' }),
    task('T-04', 'active', { stepsDone: 2, updatedAt: '2026-11-18T11:00:00Z' }),
  ]
  check('Relevance tie-break: steps done, then updatedAt desc, then id', titles(api.sortTasks(ties, 'relevance')), ['T-01', 'T-02', 'T-04', 'T-03'])
  check('Updated sort is newest first', titles(api.sortTasks(ties, 'updated')), ['T-02', 'T-04', 'T-03', 'T-01'])
  check('Status sort is alphabetical', titles(api.sortTasks(rows, 'status')), ['T-01', 'T-02', 'T-30', 'T-21', 'T-11', 'T-05'])
  const named = [task('T-02', 'open', { title: 'beta' }), task('T-01', 'open', { title: 'Alpha' }), task('T-03', 'open', { title: 'alpha' })]
  check('Title sort is case-insensitive with id tie-break', titles(api.sortTasks(named, 'title')), ['T-01', 'T-03', 'T-02'])

  check('taskCounts counts unfinished and active', api.taskCounts([task('A', 'active'), task('B', 'review'), task('C', 'open'), task('D', 'blocked'), task('E', 'done'), task('F', 'cancelled')]), { unfinished: 4, active: 1 })
  check('taskCounts on an empty board', api.taskCounts([]), { unfinished: 0, active: 0 })

  const byId = {
    root: { id: 'root', origin: 'main' },
    child: { id: 'child', parentId: 'root', origin: 'subagent', running: true },
    grand: { id: 'grand', parentId: 'child', origin: 'subagent', running: true },
    idle: { id: 'idle', parentId: 'root', origin: 'subagent', running: false },
    otherRoot: { id: 'otherRoot', origin: 'main' },
    otherChild: { id: 'otherChild', parentId: 'otherRoot', origin: 'subagent', running: true },
    plain: { id: 'plain', parentId: 'root', origin: 'main', running: true },
  }
  check('activeSubagents counts running descendants of this chat', api.activeSubagents(byId, 'root'), 2)
  check('activeSubagents excludes the current child itself', api.activeSubagents(byId, 'child'), 1)
  check('activeSubagents with no live session', api.activeSubagents(byId, ''), 0)
  check('activeSubagents with an empty snapshot', api.activeSubagents({}, 'root'), 0)

  const entities = new Map([
    ['TASK-1', { kind: 'task', id: 'TASK-1', frontmatter: { title: 'A named task', steps: ['one', 'two', 'three'], stepsDone: 2, reqIds: ['REQ-9'], updatedAt: '2026-11-18T12:00:00Z' } }],
  ])
  const row = api.taskRow(task('TASK-1', 'active'), entities)
  check('taskRow merges the entity frontmatter', { title: row.title, steps: row.steps, stepsDone: row.stepsDone, reqIds: row.reqIds, updatedAt: row.updatedAt }, { title: 'A named task', steps: 3, stepsDone: 2, reqIds: ['REQ-9'], updatedAt: '2026-11-18T12:00:00Z' })
  const projectRow = task('TASK-2', 'review', { title: 'From the projection', steps: ['a', 'b'], stepsDone: 1, reqIds: ['REQ-8'] })
  const projected = api.taskRow(projectRow, new Map())
  check('taskRow falls back to the projection row', { title: projected.title, steps: projected.steps, stepsDone: projected.stepsDone, reqIds: projected.reqIds }, { title: 'From the projection', steps: 2, stepsDone: 1, reqIds: ['REQ-8'] })

  if (!/aria-pressed':\s*view === 'board'/.test(source)) found.push('the Board/List toggle does not reflect its state through aria-pressed')
  if (!/'aria-label': 'Task view'/.test(source)) found.push('the Board/List toggle has no named group')
  if (!/'aria-label': 'Sort tasks'/.test(source)) found.push('the sort tags have no named group')
  if (!/'aria-pressed':\s*sort === tag\.id/.test(source)) found.push('the sort tags do not reflect the chosen sort through aria-pressed')
  for (const label of ['Relevance', 'Updated', 'Status', 'Title']) {
    if (!source.includes(`label: '${label}'`)) found.push(`the ${label} sort tag is missing`)
  }
  if (!/className: 'ps-table ps-tasklist'/.test(source)) found.push('the list table (ps-table ps-tasklist) is missing')
  for (const column of ['Status', 'Task', 'Requirement', 'Progress', 'Updated']) {
    if (!source.includes(`'${column}'`)) found.push(`the ${column} list column is missing`)
  }
  if (!/Unfinished tasks in this workspace/.test(source)) found.push('the header aria-label does not name the task count area (workspace)')
  if (!/Active subagents in this chat/.test(source)) found.push('the header aria-label does not name the subagent count area (this chat)')
  if (/workspaceFiles\.write/.test(source)) found.push('the panel declares a workspaceFiles.write call')
  const commandCalls = source.match(/commands\.execute\(/g) ?? []
  if (commandCalls.length !== 1) found.push(`the panel runs ${commandCalls.length} commands; only the read-only designmap views call is allowed`)
  return found
}

test('state counters and task list sort invariants', () => {
  const found = violations()
  const summary = JSON.stringify({ metrics: { violations: found.length } })
  process.stdout.write(`CASE_SUMMARY ${summary}\n`)
  if (typeof process.env.CASE_SUMMARY === 'string' && process.env.CASE_SUMMARY !== '') writeFileSync(process.env.CASE_SUMMARY, summary)
  assert.deepEqual(found, [], found.join('; '))
})
