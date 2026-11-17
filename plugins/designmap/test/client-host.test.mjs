/**
 * PROOF:
 * Behavior: the panel's read path asks the host command for `views` — scenes already
 *   rendered with the stored visual layer — and hands the payload to the view untouched;
 *   a workspace with no views is an empty state, a failed command is an error, a
 *   session-less panel refuses with a named code, and a label edit is a model write
 *   (never an overlay) that refuses an empty label before it leaves the page.
 * Fails when: the adapter lists `out/` again and merges overlays in the browser (the
 *   arrows-detach bug), forwards a command failure as success, or sends an empty label
 *   to the host.
 * Production path: client/host.js createRemoteHost().load / refreshView / writeLabel ->
 *   remote.commands.execute('/designmap …') -> src/command.mjs; consumed by view.jsx.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRemoteHost } from '../client/host.js'

const VIEW = {
  view: { viewId: 'v.context', title: 'Context', level: 'context', parentGroupId: null },
  scene: { schemaVersion: 1, viewId: 'v.context', title: 'Context', level: 'context', canvas: { x: 0, y: 0, width: 400, height: 200 }, nodes: [], groups: [], edges: [] },
  meta: { generatedAt: '2026-11-17T00:00:00.000Z', commit: 'abc', sceneHash: 'sha256:x', scenePath: 'designmap/out/v.context.scene.json', stale: { stale: false }, lint: { ok: true, counts: { error: 0, warning: 0, info: 0 }, findings: [], rules: [] } },
}

/** A remote whose command transport answers with `answer`, and records what was sent. */
function fakeRemote(answer, { listError = null, calls = [] } = {}) {
  return {
    workspaceFiles: {
      list: async () => (listError === null ? { ok: true, value: { entries: [] } } : { ok: false, error: listError }),
      read: async () => ({ ok: false, error: { code: 'ENOENT', message: 'no entry' } }),
      stat: async () => ({ ok: false, error: { code: 'ENOENT', message: 'no entry' } }),
    },
    commands: {
      execute: async (_sessionId, text) => {
        calls.push(text)
        return answer
      },
    },
    session: { openWorkspacePath: async () => ({ ok: true }) },
  }
}

const success = value => ({ ok: true, value: { result: { kind: 'success', text: JSON.stringify(value) } } })

test('the load asks the host for rendered views and returns the payload untouched', async () => {
  const calls = []
  const payload = { ok: true, views: [VIEW], rootId: 'v.context', overlays: { rows: { 'svc.a': { fill: '#fff' } }, path: 'designmap/overlays.json' }, annotations: [], stale: { stale: false }, generatedAt: 'x', commit: 'abc' }
  const host = createRemoteHost({ remote: fakeRemote(success(payload), { calls }), sessionId: 'session-1' })
  const result = await host.load()
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(result.value, payload)
  assert.equal(calls.length, 1)
  assert.match(calls[0], /"op":"views"/u)
  assert.equal(calls[0].includes('workspaceFiles'), false)
})

test('a workspace with no views is an empty state, not a load failure', async () => {
  const host = createRemoteHost({
    remote: fakeRemote(success({ ok: true, views: [], rootId: null, overlays: { rows: {}, path: 'designmap/overlays.json' }, annotations: [] })),
    sessionId: 'session-1',
  })
  const result = await host.load()
  assert.equal(result.ok, true, 'an empty model must not be surfaced as an error')
  assert.equal(result.value.missing, true)
  assert.deepEqual(result.value.views, [])
  assert.deepEqual(result.value.overlays.rows, {})
})

test('a failed command is an error, not an empty map', async () => {
  const host = createRemoteHost({
    remote: fakeRemote({ ok: false, error: { code: 'command_unavailable', message: 'no command' } }),
    sessionId: 'session-1',
  })
  const result = await host.load()
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'command_unavailable')
})

test('a session-less panel refuses with a named code instead of throwing', async () => {
  const host = createRemoteHost({ remote: fakeRemote({ ok: false, error: { code: 'unexpected' } }), sessionId: null })
  const result = await host.load()
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'no_session')
})

test('refreshView re-renders one view and a label goes through the model command', async () => {
  const calls = []
  const payload = { ok: true, views: [VIEW], rootId: 'v.context', overlays: { rows: {}, path: 'designmap/overlays.json' }, annotations: [] }
  const host = createRemoteHost({ remote: fakeRemote(success(payload), { calls }), sessionId: 'session-1' })
  const refreshed = await host.refreshView('v.context')
  assert.equal(refreshed.ok, true)
  assert.match(calls[0], /"op":"views".*"viewId":"v.context"/u)

  const empty = await host.writeLabel({ kind: 'edge', id: 'e.a', label: '   ' })
  assert.equal(empty.ok, false)
  assert.equal(empty.error.code, 'missing_edge_label')
  const emptyNode = await host.writeLabel({ kind: 'node', id: 'svc.a', label: ' ' })
  assert.equal(emptyNode.error.code, 'invalid_label')
  assert.equal(calls.length, 1, 'an empty label must never reach the host')

  const written = await host.writeLabel({ kind: 'node', id: 'svc.a', label: 'Renamed' })
  assert.equal(written.ok, true)
  assert.match(calls[1], /"op":"label".*"kind":"node".*"id":"svc.a".*"label":"Renamed"/u)
})
