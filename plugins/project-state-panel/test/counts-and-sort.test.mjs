/*
PROOF: the State header counters, the Board list sort and the owner's status write are built from named helpers
Behavior: the panel exports taskCounts (unfinished = not done/cancelled, active = status active),
  activeSubagents (running child sessions of this chat, current session excluded), taskRow (merges
  the projection row with the entity frontmatter: title, steps/stepsDone, reqIds, updatedAt),
  sortTasks (Relevance: active → blocked → review → open → done → cancelled, then more steps done,
  then updatedAt desc, then id; plus Updated, Status, Title), taskSessions (the TASK's recorded
  sessions with the live running flag) and parseEntityText (the state format, including a list of
  maps: acceptance [{text,done}] and sessions [{sessionId,label,role,status}]). The task card
  renders the concrete task and an Open button that calls uiWorkspace.openSession.
  It also exports the owner's status write: requirementIdsOf (reqId AND reqIds, deduplicated, so a
  batch task's two requirements show up in the card, the drawer, the filter and the count),
  taskStatusRequest (a TASK with no boardId is refused no_board_row; a status outside the six is
  status_invalid), parseTaskboardReply (a taskboard refusal keeps its code) and changeTaskStatus
  (read the TASK, read the board row's revision, then one compare-and-set `owner-status` call).
Fails when: a counter stops following its rule, the Relevance order or one of its tie-breaks changes,
  a sort stops being deterministic or mutates its input, the panel loses the Board/List toggle and
  the sort tags with aria-pressed, a task with reqIds reads as "no requirement", the status write
  stops being a two-call compare-and-set or swallows a refusal code, or any write other than that
  one command appears beside the reads.
  CASE_NEGATIVE_CONTROL=expect-pre-fix flips the assertions to the pre-fix shape (no helpers, no
  list, no owner-status write), which must fail on the fixed files (the measured red).
Production path: plugins/project-state-panel/client.js — the State header trigger, BoardMode,
  TaskCard, TaskStatusEditor and changeTaskStatus.
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

async function violations() {
  const source = readFileSync(join(ROOT, PANEL), 'utf8')
  const found = []
  const check = (name, actual, expected) => {
    if (!isDeepStrictEqual(actual, expected)) found.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
  if (control === 'expect-pre-fix') {
    // The pre-fix shape: no count/sort helpers, no task list, and no concrete task/session Open.
    let api = null
    try { api = loadPanel()?.__test ?? null } catch { api = null }
    if (api !== null) found.push('pre-fix control: the panel already exports the count/sort helpers (expected them absent before the fix)')
    if (/ps-tasklist/.test(source)) found.push('pre-fix control: the task list table is already present (expected it absent before the fix)')
    if (/Unfinished tasks in this workspace/.test(source)) found.push('pre-fix control: the header counters are already present (expected them absent before the fix)')
    if (/Concrete task/.test(source)) found.push('pre-fix control: the concrete-task section is already present (expected it absent before the fix)')
    if (/uiWorkspace\?\.openSession/.test(source)) found.push('pre-fix control: session navigation is already wired (expected it absent before the fix)')
    if (/owner-status/.test(source)) found.push('pre-fix control: the owner-status write is already present (expected it absent before the fix)')
    if (/requirementIdsOf/.test(source)) found.push('pre-fix control: the reqIds reader is already present (expected it absent before the fix)')
    return found
  }

  const api = loadPanel()?.__test ?? null
  if (api === null) {
    found.push('the panel module exports no __test helpers (taskCounts, activeSubagents, taskRow, sortTasks)')
    return found
  }
  for (const name of ['statusRank', 'sortTasks', 'taskCounts', 'activeSubagents', 'taskRow', 'taskSessions', 'parseEntityText']) {
    if (typeof api[name] !== 'function') found.length === 0 && found.push(`the panel does not export ${name}`)
  }
  if (typeof api.sortTasks !== 'function' || typeof api.taskCounts !== 'function' || typeof api.taskRow !== 'function' || typeof api.activeSubagents !== 'function' || typeof api.taskSessions !== 'function' || typeof api.parseEntityText !== 'function') return found

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
    ['TASK-3', { kind: 'task', id: 'TASK-3', frontmatter: { title: 'Delegated task', sessions: [{ sessionId: 's1', label: 'BACKEND', role: 'BACKEND', status: 'sleeping' }, { sessionId: 's2', label: 'CRITIC', role: 'CRITIC', status: 'active' }] } }],
  ])
  const row = api.taskRow(task('TASK-1', 'active'), entities)
  check('taskRow merges the entity frontmatter', { title: row.title, steps: row.steps, stepsDone: row.stepsDone, reqIds: row.reqIds, updatedAt: row.updatedAt }, { title: 'A named task', steps: 3, stepsDone: 2, reqIds: ['REQ-9'], updatedAt: '2026-11-18T12:00:00Z' })
  const roleRow = api.taskRow(task('TASK-4', 'open', { role: 'BACKEND', preset: 'backend' }), new Map())
  check('taskRow carries the role and preset for the list', { role: roleRow.role, preset: roleRow.preset, inline: roleRow.inline }, { role: 'BACKEND', preset: 'backend', inline: false })
  const live = api.taskRow(task('TASK-3', 'active'), entities, { s2: { running: true } })
  check('taskRow counts the subagents running NOW, not the task status', { total: live.sessions.length, running: live.running }, { total: 2, running: 1 })
  check('taskRow with no live snapshot marks every session idle', api.taskRow(task('TASK-3', 'active'), entities).running, 0)
  const projectRow = task('TASK-2', 'review', { title: 'From the projection', steps: ['a', 'b'], stepsDone: 1, reqIds: ['REQ-8'] })
  const projected = api.taskRow(projectRow, new Map())
  check('taskRow falls back to the projection row', { title: projected.title, steps: projected.steps, stepsDone: projected.stepsDone, reqIds: projected.reqIds }, { title: 'From the projection', steps: 2, stepsDone: 1, reqIds: ['REQ-8'] })

  const concrete = api.parseEntityText([
    '---', 'id: TASK-9', 'kind: task', 'title: "Concrete task"', 'status: active',
    'acceptance:', '  - text: "works"', '    done: true', '  - text: "tested"', '    done: false',
    'sessions:', '  - sessionId: sess-1', '    label: BACKEND', '    role: BACKEND', '    status: sleeping',
    'scope: [a, b]', 'steps: ["one, two", "three"]', 'stepsDone: 1', '---', '', 'Do it',
  ].join('\n'))
  check('parseEntityText keeps a list of maps (acceptance)', concrete.frontmatter.acceptance, [{ text: 'works', done: true }, { text: 'tested', done: false }])
  check('parseEntityText keeps a list of maps (sessions)', concrete.frontmatter.sessions, [{ sessionId: 'sess-1', label: 'BACKEND', role: 'BACKEND', status: 'sleeping' }])
  check('parseEntityText reads a bare number', concrete.frontmatter.stepsDone, 1)
  check('parseEntityText keeps a comma inside one inline item', concrete.frontmatter.steps, ['one, two', 'three'])
  check('taskSessions folds the live running flag', api.taskSessions(concrete.frontmatter, { 'sess-1': { running: true } }), [{ sessionId: 'sess-1', label: 'BACKEND', role: 'BACKEND', status: 'running', recorded: 'sleeping', running: true }])
  check('taskSessions reports a non-live child as idle, not its ledger word', api.taskSessions(concrete.frontmatter, {}), [{ sessionId: 'sess-1', label: 'BACKEND', role: 'BACKEND', status: 'idle', recorded: 'sleeping', running: false }])
  check('taskSessions on a TASK without sessions', api.taskSessions({}, {}), [])
  check('taskSessions never reports a closed task as running', api.taskSessions({ ...concrete.frontmatter, status: 'done' }, { 'sess-1': { running: true } }), [{ sessionId: 'sess-1', label: 'BACKEND', role: 'BACKEND', status: 'idle', recorded: 'sleeping', running: false }])

  if (!/aria-pressed':\s*view === 'board'/.test(source)) found.push('the Board/List toggle does not reflect its state through aria-pressed')
  if (!/'aria-label': 'Task view'/.test(source)) found.push('the Board/List toggle has no named group')
  if (!/'aria-label': 'Sort tasks'/.test(source)) found.push('the sort tags have no named group')
  if (!/'aria-pressed':\s*sort === tag\.id/.test(source)) found.push('the sort tags do not reflect the chosen sort through aria-pressed')
  for (const label of ['Relevance', 'Updated', 'Status', 'Title']) {
    if (!source.includes(`label: '${label}'`)) found.push(`the ${label} sort tag is missing`)
  }
  if (!/className: 'ps-table ps-tasklist'/.test(source)) found.push('the list table (ps-table ps-tasklist) is missing')
  for (const column of ['Status', 'Task', 'Role', 'Requirement', 'Progress', 'Subagents', 'Updated']) {
    if (!source.includes(`'${column}'`)) found.push(`the ${column} list column is missing`)
  }
  if (!/Unfinished tasks in this workspace/.test(source)) found.push('the header aria-label does not name the task count area (workspace)')
  if (!/Active subagents in this chat/.test(source)) found.push('the header aria-label does not name the subagent count area (this chat)')
  if (!/Concrete task/.test(source)) found.push('the task card has no concrete-task section')
  if (!/'Objective'/.test(source)) found.push('the task body is not labelled Objective')
  if (!/h\(TaskSpecifics/.test(source)) found.push('the drawer does not render the concrete task')
  if (!/sessionsById/.test(source)) found.push('the board does not pass the live session snapshot to the task rows')
  if (!/'Subagents'/.test(source)) found.push('the task list has no Subagents column')
  if (!/'Role'/.test(source)) found.push('the task list has no Role column')
  if (!/relativeLabel\(row\.updatedAt\)/.test(source)) found.push('the list shows a wall clock instead of elapsed time')
  const nowMs = Date.parse('2026-11-18T12:00:00Z')
  check('relativeLabel minutes', api.relativeLabel('2026-11-18T11:55:00Z', nowMs), '5 мин назад')
  check('relativeLabel hours', api.relativeLabel('2026-11-18T10:00:00Z', nowMs), '2 ч назад')
  check('relativeLabel days', api.relativeLabel('2026-11-15T12:00:00Z', nowMs), '3 дн назад')
  check('relativeLabel just now', api.relativeLabel('2026-11-18T11:59:50Z', nowMs), 'сейчас')
  check('relativeLabel future', api.relativeLabel('2026-11-18T12:05:00Z', nowMs), 'через 5 мин')
  if (!/ps-tablewrap/.test(source)) found.push('the task list has no horizontal-scroll wrapper for narrow panels')
  if (!/running > 0/.test(source)) found.push('the task row does not distinguish a running subagent from an idle one')
  if (!/'uiWorkspace'/.test(source)) found.push('the panel does not inject the uiWorkspace navigation service')
  if (!/uiWorkspace\?\.openSession/.test(source)) found.push('the panel never calls uiWorkspace.openSession')
  if (!/onOpenSession/.test(source)) found.push('the task card does not pass onOpenSession')
  if (!/'Open'/.test(source)) found.push('the session row has no Open button')
  // HIDE CHORES: one pure predicate, both spellings of the flag.
  if (typeof api.isChoreTask !== 'function') {
    found.push('the panel exports no isChoreTask (the hide-chores filter is missing)')
  } else {
    check('isChoreTask reads the index row flag', api.isChoreTask({ chore: true }, {}), true)
    check('isChoreTask reads the frontmatter flag of an old row', api.isChoreTask({}, { chore: true }), true)
    check('isChoreTask is false for a requirement-linked task', api.isChoreTask({ chore: false }, {}), false)
    check('isChoreTask tolerates an empty row', api.isChoreTask(undefined, undefined), false)
  }

  // A PRE-FIX CLIENT FAILS BY NAME: the helpers and the write are absent, not broken.
  if (typeof api.requirementIdsOf !== 'function' || typeof api.taskStatusRequest !== 'function' || typeof api.parseTaskboardReply !== 'function' || typeof api.changeTaskStatus !== 'function') {
    found.push('the panel exports no requirement/status helpers (requirementIdsOf, taskStatusRequest, parseTaskboardReply, changeTaskStatus)')
  } else {
    // THE REQUIREMENTS A TASK IS LINKED TO: the batch (reqIds) and the single (reqId) are folded.
    check('requirementIdsOf reads a batch task reqIds', api.requirementIdsOf({ reqId: null, reqIds: ['REQ-003', 'REQ-004'] }), ['REQ-003', 'REQ-004'])
    check('requirementIdsOf folds reqId and reqIds without duplicates', api.requirementIdsOf({ reqId: 'REQ-003', reqIds: ['REQ-003', 'REQ-004'] }), ['REQ-003', 'REQ-004'])
    check('requirementIdsOf reads the entity frontmatter when the row has none', api.requirementIdsOf({ reqId: null }, { reqIds: ['REQ-007'] }), ['REQ-007'])
    check('requirementIdsOf is empty for a chore with no link', api.requirementIdsOf({ reqId: null, chore: true }, {}), [])

    // THE OWNER'S STATUS WRITE: the plan, the refusal code and the two-call compare-and-set.
    check('taskStatusRequest uses the boardId the TASK records', api.taskStatusRequest({ frontmatter: { boardId: 'task-1' } }, 'done'), { ok: true, boardId: 'task-1', status: 'done' })
    check('taskStatusRequest refuses a TASK without a board row', api.taskStatusRequest({ frontmatter: {} }, 'done').code, 'no_board_row')
    check('taskStatusRequest refuses a status outside the registry', api.taskStatusRequest({ frontmatter: { boardId: 'task-1' } }, 'finished').code, 'status_invalid')
    check('parseTaskboardReply keeps a refusal code', api.parseTaskboardReply({ ok: true, value: { result: { kind: 'error', text: 'taskboard: stale; the row moved; current rev 7' } } }).code, 'stale')
    check('parseTaskboardReply reads a success payload', api.parseTaskboardReply({ ok: true, value: { result: { kind: 'success', text: '{"ok":true,"task":{"id":"task-1","revision":5}}' } } }).payload.task.revision, 5)
    check('parseTaskboardReply names a missing transport result', api.parseTaskboardReply(undefined).code, 'command_failed')

    const entityText = (status, boardLine = 'boardId: task-1') => ['---', 'id: TASK-034', 'kind: task', 'title: "UX package"', `status: ${status}`, boardLine, 'revision: 2', '---', 'body'].join('\n')
    const fakeRemote = (text, replies) => {
      const calls = []
      return {
        calls,
        remote: {
          workspaceFiles: { read: async () => ({ ok: true, value: { text, lines: text.split('\n').length, offset: 1, eof: true } }) },
          commands: {
            execute: async (sessionId, line) => {
              calls.push(line)
              const reply = replies[calls.length - 1]
              return reply === undefined ? { ok: false, error: { code: 'command_failed' } } : reply
            },
          },
        },
      }
    }
    const success = (payload) => ({ ok: true, value: { result: { kind: 'success', text: JSON.stringify(payload) } } })
    const accepted = fakeRemote(entityText('open'), [success({ ok: true, task: { id: 'task-1', revision: 4 } }), success({ ok: true, task: { id: 'task-1', revision: 5, status: 'done' } })])
    const applied = await api.changeTaskStatus(accepted.remote, 'session-1', { taskId: 'TASK-034', status: 'done', reason: 'owner closed it' })
    check('changeTaskStatus succeeds through the board', applied.ok, true)
    check('changeTaskStatus reads the board row first', accepted.calls.length >= 1 && accepted.calls[0].includes('"op":"get"'), true)
    check('changeTaskStatus sends one compare-and-set owner-status', accepted.calls.length === 2 ? JSON.parse(accepted.calls[1].slice('/taskboard '.length)) : accepted.calls, { op: 'owner-status', id: 'task-1', expectedRevision: 4, status: 'done', reason: 'owner closed it' })

    const stale = fakeRemote(entityText('open'), [success({ ok: true, task: { id: 'task-1', revision: 4 } }), { ok: true, value: { result: { kind: 'error', text: 'taskboard: stale; the row moved; current rev 5' } } }])
    const refused = await api.changeTaskStatus(stale.remote, 'session-1', { taskId: 'TASK-034', status: 'done' })
    check('a refused owner-status keeps its code', refused.code, 'stale')
    check('a refused owner-status carries the readable sentence', String(refused.message).includes('current rev 5'), true)

    const noBoard = fakeRemote(entityText('open', 'reqId: REQ-3'), [])
    const refusedNoBoard = await api.changeTaskStatus(noBoard.remote, 'session-1', { taskId: 'TASK-034', status: 'done' })
    check('a TASK without a board row is refused before any command', refusedNoBoard.code, 'no_board_row')
    check('a refused TASK sends no command', noBoard.calls.length, 0)

    const noTransport = { workspaceFiles: { read: async () => ({ ok: true, value: { text: entityText('open'), lines: 9, offset: 1, eof: true } }) } }
    const refusedTransport = await api.changeTaskStatus(noTransport, 'session-1', { taskId: 'TASK-034', status: 'done' })
    check('a build without a command transport is named', refusedTransport.code, 'command_unavailable')
  }
  if (/workspaceFiles\.write/.test(source)) found.push('the panel declares a workspaceFiles.write call')
  // TWO COMMAND CALL SITES, ONE WRITE: designmap's read-only views and the board's owner-status.
  const commandCalls = source.match(/commands\.execute\(/g) ?? []
  if (commandCalls.length !== 2) found.push(`the panel has ${commandCalls.length} command call sites; only designmap views (read) and taskboard owner-status (write) are allowed`)
  if (!/\/designmap /.test(source)) found.push('the designmap views command is missing')
  if (!/\/taskboard /.test(source)) found.push('the taskboard owner-status command is missing')
  if (!/'owner-status'/.test(source)) found.push('the owner-status op is never sent')
  if (!/onChangeStatus/.test(source)) found.push('the board card has no status control')
  // THE BADGE IS THE CONTROL, not a second plaque repeating the state.
  if (!/function StatusSelect\(/.test(source)) found.push('the status badge is not a control')
  if (!/ps-status ps-statusselect/.test(source)) found.push('the status control does not wear the status chip')
  if (/TaskStatusEditor/.test(source) || /ps-statusform/.test(source)) found.push('a second status control duplicates the badge')
  if (!/function TaskStatusBadge\(/.test(source)) found.push('the drawer badge carries no optional reason field')
  if (!/function TaskListTable\(\{ rows, onOpenTask, onChangeStatus/.test(source)) found.push('the task list has no owner status control (the list is the default view)')
  if (!/status by owner/.test(source)) found.push('the header badge still claims a bare read-only panel')
  if (!/Hide chores \(\$\{choreCount\}\)/.test(source)) found.push('the board subbar has no hide-chores toggle')
  if (!/'aria-pressed': hideChores === true/.test(source)) found.push('the hide-chores toggle does not reflect its state through aria-pressed')
  if (!/const visible = hideChores === true/.test(source)) found.push('the board/list does not filter chore tasks from the view')
  if (!/requirementIds\.length > 0/.test(source)) found.push('the drawer still shows a single requirement')
  if (!/const requirementIds = isNode \? \[\] : requirementIdsOf\(/.test(source)) found.push('the drawer does not read reqId and reqIds through requirementIdsOf')
  if (!/const reqIds = requirementIdsOf\(/.test(source)) found.push('the board card does not read reqId and reqIds through requirementIdsOf')
  return found
}

test('state counters and task list sort invariants', async () => {
  const found = await violations()
  const summary = JSON.stringify({ metrics: { violations: found.length } })
  process.stdout.write(`CASE_SUMMARY ${summary}\n`)
  if (typeof process.env.CASE_SUMMARY === 'string' && process.env.CASE_SUMMARY !== '') writeFileSync(process.env.CASE_SUMMARY, summary)
  assert.deepEqual(found, [], found.join('; '))
})
