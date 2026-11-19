/*
PROOF: the Project state panel has a real Edit mode, and it writes only through `/state`
Behavior: the Edit tab for a REQ/TASK/TEST is built from the kind's field schema: initialDraft
  reads the entity into one value per control (a TASK merges reqId with reqIds, acceptance stays
  one line per criterion), and buildEditPatch returns ONLY the fields that changed, so saving
  never takes ownership of a field the owner left alone; an unchanged form patches nothing and an
  acceptance line keeps its done mark when its wording is unchanged. parseStateReply keeps the
  core's code from `state: <code>; <message>`, and editStateEntity refuses to send without a
  revision and otherwise sends one `/state` op carrying id, expectedRevision, patch and release.
Fails when: the panel has no Edit surface, a save sends every field instead of the changed ones,
  a done mark is lost by rewriting its line, a refusal loses its code, or a write goes anywhere
  but the state command.
Production path: plugins/project-state-panel/client.js — EntityEditor, initialDraft,
  buildEditPatch, parseStateReply, editStateEntity; the host side is the `/state` command in
  plugins/project-state/index.mjs.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

const api = () => loadPanel()?.__test ?? null

const REQ_ENTITY = {
  kind: 'req',
  id: 'REQ-001',
  body: 'The requirement text.',
  frontmatter: {
    id: 'REQ-001',
    kind: 'req',
    title: 'A title',
    status: 'proposed',
    source: 'agent',
    revision: 4,
    criteria: ['first', 'second'],
    body: 'The requirement text.',
  },
}

const TASK_ENTITY = {
  kind: 'task',
  id: 'TASK-007',
  body: 'Do the thing.',
  frontmatter: {
    id: 'TASK-007',
    kind: 'task',
    title: 'A task',
    status: 'open',
    revision: 2,
    reqIds: ['REQ-002'],
    reqId: 'REQ-001',
    steps: ['one', 'two'],
    stepsDone: 1,
    acceptance: [{ text: 'it works', done: true }],
  },
}

test('negative control expect-pre-fix keeps the read-only panel shape', () => {
  if (control !== 'expect-pre-fix') return
  // The pre-fix panel is a lens: no Edit tab, no state command, no draft/patch helpers. Each
  // assertion must fail on the fixed files - that is the red.
  const helpers = api()
  assert.equal(helpers?.editStateEntity, undefined)
  assert.doesNotMatch(readFileSync(join(ROOT, PANEL), 'utf8'), /ps-dtab-edit/)
})

test('the draft reads every field of the kind, and a TASK merges reqId with reqIds', () => {
  const helpers = api()
  assert.notEqual(helpers, null, 'the panel exports its __test helpers')
  const req = helpers.initialDraft(REQ_ENTITY, 'req')
  assert.equal(req.title, 'A title')
  assert.equal(req.source, 'agent')
  assert.equal(req.criteria, 'first\nsecond')
  assert.equal(req.body, 'The requirement text.')
  const task = helpers.initialDraft(TASK_ENTITY, 'task')
  assert.equal(task.reqIds, 'REQ-001\nREQ-002', 'the primary reqId and the batch are one list')
  assert.equal(task.stepsDone, '1')
  assert.equal(task.acceptance, 'it works')
})

test('an unchanged form patches nothing', () => {
  const helpers = api()
  for (const [entity, kind] of [[REQ_ENTITY, 'req'], [TASK_ENTITY, 'task']]) {
    const patch = helpers.buildEditPatch(entity, kind, helpers.initialDraft(entity, kind))
    assert.deepEqual(patch, {}, `${kind}: an untouched form must send no field`)
  }
})

test('only the changed field is sent', () => {
  const helpers = api()
  const draft = helpers.initialDraft(REQ_ENTITY, 'req')
  draft.title = 'A better title'
  const patch = helpers.buildEditPatch(REQ_ENTITY, 'req', draft)
  assert.deepEqual(Object.keys(patch), ['title'])
  assert.equal(patch.title, 'A better title')
})

test('an acceptance line keeps its done mark while its wording is unchanged', () => {
  const helpers = api()
  const draft = helpers.initialDraft(TASK_ENTITY, 'task')
  draft.acceptance = 'it works\nand a new one'
  const patch = helpers.buildEditPatch(TASK_ENTITY, 'task', draft)
  assert.deepEqual(patch.acceptance, [
    { text: 'it works', done: true },
    { text: 'and a new one', done: false },
  ])
})

test('the body edit travels as body, and clearing a number sends null', () => {
  const helpers = api()
  const draft = helpers.initialDraft(TASK_ENTITY, 'task')
  draft.body = 'A clearer objective.'
  draft.stepsDone = ''
  const patch = helpers.buildEditPatch(TASK_ENTITY, 'task', draft)
  assert.equal(patch.body, 'A clearer objective.')
  assert.equal(patch.stepsDone, null)
})

test('a state refusal keeps its code', () => {
  const helpers = api()
  const refused = helpers.parseStateReply({ ok: true, value: { result: { kind: 'error', text: 'state: revision_conflict; expected revision 4, file has 5' } } })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'revision_conflict')
  assert.match(refused.message, /expected revision 4, file has 5/)
  const ok = helpers.parseStateReply({ ok: true, value: { result: { kind: 'success', text: JSON.stringify({ ok: true, id: 'REQ-001', revision: 5, manualFields: ['title'] }) } } })
  assert.equal(ok.ok, true)
  assert.equal(ok.payload.revision, 5)
  assert.deepEqual(ok.payload.manualFields, ['title'])
})

test('the edit refuses to send without a revision and otherwise sends one /state op', async () => {
  const helpers = api()
  const calls = []
  const remote = {
    commands: {
      execute: async (sessionId, text) => {
        calls.push({ sessionId, text })
        return { ok: true, value: { result: { kind: 'success', text: JSON.stringify({ ok: true, id: 'REQ-001', revision: 5, manualFields: ['title'] }) } } }
      },
    },
  }
  const noRevision = await helpers.editStateEntity(remote, 'session-1', { id: 'REQ-001', kind: 'req', patch: { title: 'x' } })
  assert.deepEqual([noRevision.ok, noRevision.code], [false, 'revision_required'])
  assert.equal(calls.length, 0, 'no command is sent without the revision the core checks')
  const saved = await helpers.editStateEntity(remote, 'session-1', { id: 'REQ-001', kind: 'req', expectedRevision: 4, patch: { title: 'x' }, release: [] })
  assert.equal(saved.ok, true)
  assert.equal(calls.length, 1)
  assert.match(calls[0].text, /^\/state /)
  const op = JSON.parse(calls[0].text.slice('/state '.length))
  assert.deepEqual(op, { op: 'edit', id: 'REQ-001', expectedRevision: 4, patch: { title: 'x' } })
})

test('a release goes out without a patch', async () => {
  const helpers = api()
  const calls = []
  const remote = {
    commands: {
      execute: async (sessionId, text) => {
        calls.push(text)
        return { ok: true, value: { result: { kind: 'success', text: JSON.stringify({ ok: true, id: 'REQ-001', revision: 6 }) } } }
      },
    },
  }
  const released = await helpers.editStateEntity(remote, 'session-1', { id: 'REQ-001', kind: 'req', expectedRevision: 5, patch: {}, release: ['title'] })
  assert.equal(released.ok, true)
  const op = JSON.parse(calls[0].slice('/state '.length))
  assert.deepEqual(op, { op: 'edit', id: 'REQ-001', expectedRevision: 5, release: ['title'] })
})
