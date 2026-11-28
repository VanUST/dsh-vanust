/*
PROOF: the page editor reaches the host through the /designmap command, page ops only
Behavior: createRemoteHost lists pages, opens one page, saves the scene back, tidies it,
  checks its readability and renders it through remote.commands.execute('/designmap <json>'),
  and applies one ready repair through the same command's edit op; a command refusal keeps its
  named code, a missing command transport refuses command_unavailable, and an empty page name
  or a save without an elements array is refused before any command leaves the panel.
Fails when: a page operation bypasses the command, a host refusal is reported as success, a
  malformed save is sent, or the host stops exposing the same seven page operations.
Production path: plugins/designmap/client/host.js createRemoteHost -> remote.commands.execute
  -> src/command.mjs; consumed by page-view.jsx.
*/
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRemoteHost } from '../client/host.js'

function fakeRemote(answer, { calls = [] } = {}) {
  return {
    commands: {
      execute: async (_sessionId, text) => {
        calls.push(text)
        return answer
      },
    },
  }
}

const success = (value) => ({ ok: true, value: { result: { kind: 'success', text: JSON.stringify(value) } } })
const refusal = (text) => ({ ok: true, value: { result: { kind: 'error', text } } })

test('every page operation travels through the /designmap command', async () => {
  const calls = []
  const answers = [
    success({ ok: true, pages: [{ page: 'system' }] }),
    success({ ok: true, page: 'system', scene: { elements: [] } }),
    success({ ok: true, page: 'system', elements: 0, previousElements: 0 }),
    success({ ok: true, page: 'system', moved: 0 }),
    success({ ok: true, page: 'system', png: { bytes: 1200 }, renderer: 'excalidraw' }),
    success({ ok: true, page: 'system', score: 100, verdict: 'clean', findings: [] }),
    success({ ok: true, page: 'system', action: 'node.move', nodes: 1, edges: 0 }),
  ]
  const remote = { commands: { execute: async (_sessionId, text) => { calls.push(text); return answers.shift() } } }
  const host = createRemoteHost({ remote, sessionId: 'session-1' })

  assert.equal((await host.pages()).ok, true)
  assert.equal((await host.page('system')).ok, true)
  assert.equal((await host.savePage('system', { elements: [] })).ok, true)
  assert.equal((await host.tidyPage('system')).ok, true)
  assert.equal((await host.renderPage('system')).ok, true)
  assert.equal((await host.lintPage('system')).ok, true)
  assert.equal((await host.edit({ op: 'node.move', page: 'system', id: 'n1', x: 40, y: 40 })).ok, true)

  assert.deepEqual(calls, [
    '/designmap {"op":"pages"}',
    '/designmap {"op":"page","page":"system"}',
    '/designmap {"op":"save","page":"system","scene":{"elements":[]}}',
    '/designmap {"op":"tidy-page","page":"system"}',
    '/designmap {"op":"render-page","page":"system"}',
    '/designmap {"op":"lint","page":"system"}',
    '/designmap {"op":"edit","operation":{"op":"node.move","page":"system","id":"n1","x":40,"y":40}}',
  ])
})

test('a command refusal keeps its named code and message', async () => {
  const host = createRemoteHost({ remote: fakeRemote(refusal('designmap: unknown_page: nope')), sessionId: 'session-1' })
  const result = await host.page('nope')
  assert.equal(result.ok, false)
  assert.deepEqual(result.error, { code: 'unknown_page', message: 'nope' })
})

test('a missing command transport refuses command_unavailable', async () => {
  const host = createRemoteHost({ remote: {}, sessionId: 'session-1' })
  const result = await host.pages()
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'command_unavailable')
  assert.equal(host.canWrite, false)
})

test('a malformed page request is refused before a command leaves the panel', async () => {
  const calls = []
  const host = createRemoteHost({ remote: fakeRemote(success({}), { calls }), sessionId: 'session-1' })
  assert.equal((await host.page('')).error.code, 'invalid_page')
  assert.equal((await host.savePage('system', { type: 'excalidraw' })).error.code, 'invalid_scene')
  assert.equal((await host.lintPage('')).error.code, 'invalid_page')
  assert.equal((await host.edit({ page: 'system' })).error.code, 'invalid_operation')
  assert.deepEqual(calls, [])
})
