/*
PROOF: the owner's status choice is visible before the round trip, and a refusal puts it back
Behavior: the panel's one data object carries the chosen status the moment the badge fires
  (index row and loaded entity), the command is sent AFTER that patch, a refusal restores the
  previous status instead of leaving a lie on screen, and a successful write tells the session
  header to re-read its counters instead of waiting for the five-second poll. A reload keeps the
  panel's current data rather than repainting the cached (pre-write) index.
Fails when: the badge only changes after the command answers (the owner's measured "nothing
  changes" - the controlled select repainted the old value for ~1.5 s), a refusal leaves the
  optimistic value, the header waits for its poll, or a reload overwrites a just-written status
  with the cached index.
  CASE_NEGATIVE_CONTROL=expect-pre-fix asserts the pre-fix shape (no applyTaskStatus helper, the
  success-only inline patch, no cache guard), which fails on the fixed file.
Production path: plugins/project-state-panel/client.js - changeStatus, applyTaskStatus, the
  first-paint cache guard in ProjectStatePage, and PanelTrigger's STATE_CHANGED_EVENT listener.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.env.PANEL_ROOT ?? process.cwd()
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''
const PANEL = 'plugins/project-state-panel/client.js'
const SOURCE = readFileSync(join(ROOT, PANEL), 'utf8')

function loadPanel() {
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
  new Function('window', 'document', 'sessionStorage', SOURCE)(
    window,
    { addEventListener: () => {}, removeEventListener: () => {}, getElementById: () => null, activeElement: null },
    { getItem: () => null, setItem: () => {} },
  )
  return exported
}

const dataOf = (rows, frontmatter = null) => ({
  phase: 'ready',
  index: { schemaVersion: 1, lastSeq: 1, counts: {}, reqs: [], tests: [], decisions: [], tasks: rows },
  entities: new Map(frontmatter === null ? [] : [['TASK-333', { frontmatter }]]),
})

test('negative control expect-pre-fix keeps the post-command-only patch', () => {
  if (control !== 'expect-pre-fix') return
  assert.doesNotMatch(SOURCE, /function applyTaskStatus/)
  assert.match(SOURCE, /setData\(\(previous\) => \{\n\s+if \(previous\.phase !== 'ready' && previous\.phase !== 'refreshing'\) return previous/)
  assert.doesNotMatch(SOURCE, /previous\.phase === 'ready' \|\| previous\.phase === 'refreshing'/)
})

test('the optimistic patch moves the index row and the loaded entity, and leaves the rest', () => {
  const panel = loadPanel()
  assert.ok(panel !== null && panel.__test !== undefined, 'the panel did not load')
  const { applyTaskStatus } = panel.__test
  assert.equal(typeof applyTaskStatus, 'function', 'applyTaskStatus is not exported')
  const before = dataOf([{ id: 'TASK-333', status: 'active' }, { id: 'TASK-222', status: 'open' }], { id: 'TASK-333', status: 'active', title: 'x' })
  const after = applyTaskStatus(before, 'TASK-333', 'review')
  assert.equal(after.index.tasks.find((row) => row.id === 'TASK-333').status, 'review')
  assert.equal(after.index.tasks.find((row) => row.id === 'TASK-222').status, 'open')
  assert.equal(after.entities.get('TASK-333').frontmatter.status, 'review')
  assert.equal(after.entities.get('TASK-333').frontmatter.title, 'x')
  assert.equal(before.index.tasks.find((row) => row.id === 'TASK-333').status, 'active', 'the helper mutated its input')
  assert.equal(applyTaskStatus({ phase: 'loading' }, 'TASK-333', 'review').phase, 'loading')
})

test('the badge patches before the command and restores on a refusal', () => {
  // The call order in changeStatus: the optimistic patch first, then changeTaskStatus.
  const changeStart = SOURCE.indexOf('const changeStatus = useCallback')
  const changeEnd = SOURCE.indexOf('// THE OWNER\'S HAND EDIT', changeStart)
  const body = SOURCE.slice(changeStart, changeEnd)
  const patchAt = body.indexOf('setData((previous) => applyTaskStatus(previous, taskId, status))')
  const commandAt = body.indexOf('changeTaskStatus(remote, sessionId, { taskId, status, reason })')
  assert.ok(patchAt >= 0, 'changeStatus does not patch the data optimistically')
  assert.ok(commandAt > patchAt, 'the command is sent before the optimistic patch')
  assert.match(body, /applyTaskStatus\(previous, taskId, before\)/, 'a refusal does not restore the previous status')
  assert.match(body, /dispatchEvent\(new CustomEvent\(STATE_CHANGED_EVENT\)\)/, 'the header is not told about the write')
})

test('a reload does not repaint the cached index over live data, and the header listens', () => {
  assert.match(SOURCE, /previous\.phase === 'ready' \|\| previous\.phase === 'refreshing'/)
  assert.match(SOURCE, /STATE_CHANGED_EVENT = 'dsh:project-state-changed'/)
  assert.match(SOURCE, /window\.addEventListener\(STATE_CHANGED_EVENT, onChanged\)/)
  assert.match(SOURCE, /window\.removeEventListener\(STATE_CHANGED_EVENT, onChanged\)/)
})
