/**
 * PROOF:
 * Behavior: a workspace with no `designmap/out` is an EMPTY state, not a load failure.
 *   The panel used to forward the host's ENOENT as "could not load", which made a fresh
 *   workspace look broken; the adapter now answers `{ok:true, missing:true, views:[]}`
 *   so the view can say "No design map in this workspace yet".
 * Fails when: the adapter forwards ENOENT as an error, or returns a success shape the
 *   view cannot distinguish from a real workspace (views[0] undefined -> crash).
 * Production path: client/host.js createRemoteHost().load -> client/view.jsx load().
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRemoteHost } from '../client/host.js'

/** A remote whose file listing fails with the given error, and that reads nothing. */
function fakeRemote({ listError }) {
  return {
    workspaceFiles: {
      list: async () => ({ ok: false, error: listError }),
      read: async () => ({ ok: false, error: { code: 'ENOENT', message: 'no entry' } }),
      stat: async () => ({ ok: false, error: { code: 'ENOENT', message: 'no entry' } }),
    },
    commands: { execute: async () => ({ ok: false, error: { code: 'unavailable', message: 'no command' } }) },
    session: { openWorkspacePath: async () => ({ ok: true }) },
  }
}

test('a missing scene directory is an empty state, not a load failure', async () => {
  const host = createRemoteHost({
    remote: fakeRemote({ listError: { code: 'ENOENT', message: 'no entry at "designmap/out"' } }),
    sessionId: 'session-1',
  })
  const result = await host.load()
  assert.equal(result.ok, true, 'ENOENT must not be surfaced as an error')
  assert.equal(result.value.missing, true)
  assert.deepEqual(result.value.views, [])
  assert.deepEqual(result.value.overlays.rows, {})
})

test('a real listing failure is still an error', async () => {
  const host = createRemoteHost({
    remote: fakeRemote({ listError: { code: 'EACCES', message: 'permission denied' } }),
    sessionId: 'session-1',
  })
  const result = await host.load()
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'EACCES')
})

test('a session-less panel refuses with a named code instead of throwing', async () => {
  const host = createRemoteHost({ remote: fakeRemote({ listError: null }), sessionId: null })
  const result = await host.load()
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'no_session')
})
