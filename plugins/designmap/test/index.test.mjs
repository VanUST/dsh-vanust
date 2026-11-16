/**
 * PROOF:
 * Behavior: `renderAll` writes every scene plus `out/index.json`, and the index is the
 *   panel's only discovery surface (it cannot list a directory): one sorted row per
 *   view with the scene's relative path, hash and size, plus the model/views/overlays
 *   hashes. Two runs produce byte-identical index bytes.
 * Fails when: a view is missing from the index, a scene path is absolute or wrong, the
 *   index hash disagrees with the scene bytes on disk, or the index carries a timestamp
 *   (which would break the byte-identical rule).
 * Production path: src/index-file.mjs renderAll/buildIndex -> src/workspace.mjs
 *   writeScene/writeIndex; consumed by the M1 panel once M3 wires a host command.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkspace } from '../src/workspace.mjs'
import { renderAll } from '../src/index-file.mjs'
import { sha256 } from '../src/canonical.mjs'

const demo = fileURLToPath(new URL('../fixtures/demo', import.meta.url))

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'designmap-index-'))
  cpSync(demo, root, { recursive: true })
  return { root, workspace: createWorkspace(root) }
}

test('renderAll writes a sorted, hash-consistent index for every view', async () => {
  const { root, workspace } = scratch()
  try {
    const result = await renderAll({ workspace })
    const onDisk = JSON.parse(readFileSync(join(root, 'out', 'index.json'), 'utf8'))
    assert.deepEqual(onDisk, result.index)
    assert.equal(onDisk.schemaVersion, 1)
    assert.deepEqual(onDisk.views.map(view => view.viewId), ['v.checkout', 'v.context'])
    for (const row of onDisk.views) {
      assert.equal(row.scenePath, `out/${row.viewId}.scene.json`)
      assert.equal(row.parent, row.viewId === 'v.checkout' ? 'grp.checkout' : null)
      const sceneText = readFileSync(join(root, row.scenePath), 'utf8')
      assert.equal(row.sceneHash, sha256(sceneText))
      assert.equal(row.bytes, Buffer.byteLength(sceneText))
      assert.equal(row.sceneHash.startsWith('sha256:'), true)
    }
    assert.equal(onDisk.modelHash, workspace.hashOf('model'))
    assert.equal(onDisk.viewsHash, workspace.hashOf('views'))
    assert.equal(onDisk.overlaysHash, workspace.hashOf('overlays'))
    assert.equal(/generatedAt|absolute|\/tmp\//u.test(JSON.stringify(onDisk)), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('two renderAll runs produce byte-identical scenes and index', async () => {
  const { root, workspace } = scratch()
  try {
    const first = await renderAll({ workspace })
    const firstScenes = new Map(first.rendered.map(row => [row.viewId, readFileSync(join(root, 'out', row.viewId + '.scene.json'), 'utf8')]))
    const second = await renderAll({ workspace })
    assert.equal(second.indexJson, first.indexJson)
    assert.equal(second.indexHash, first.indexHash)
    for (const row of second.rendered) {
      assert.equal(readFileSync(join(root, 'out', row.viewId + '.scene.json'), 'utf8'), firstScenes.get(row.viewId))
    }
    console.log(`index hash=${first.indexHash}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an empty workspace gets an index with no views, not a missing file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'designmap-index-empty-'))
  try {
    const workspace = createWorkspace(root)
    const result = await renderAll({ workspace })
    assert.deepEqual(result.index.views, [])
    assert.equal(result.index.modelHash, null)
    assert.equal(readFileSync(join(root, 'out', 'index.json'), 'utf8'), result.indexJson)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
