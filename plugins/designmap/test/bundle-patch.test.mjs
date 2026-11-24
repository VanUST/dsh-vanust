/*
PROOF: the vendored bundle is patched in memory and a re-vendored bundle refuses by name
Behavior: patchUnloadRegistration removes BOTH document-lifetime registrations Excalidraw adds
  (the native `unload` handler in its App constructor and the `beforeunload` handler in the
  text editor). The DSH iframe runs under Permissions-Policy: unload=(), so either registration
  makes Chrome print a violation once per frame build. frameDocument applies the patch to the
  iframe document, and patchExportSwitch still opens the export dialog the renderer needs. A
  bundle without a marker, or with it twice, throws FrameBundleMismatch (FRAME_BUNDLE_MISMATCH)
  instead of silently returning the text.
Fails when: a patch silently no-ops on a bundle it does not recognise, either registration
  survives frameDocument, or the export switch stops being flipped.
Production path: plugins/designmap/client/bundle-patch.js, client/frame.js frameDocument,
  src/excalidraw-render.mjs patchedFrame.
*/
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BEFOREUNLOAD_REGISTRATION, EXPORT_CLOSED, EXPORT_OPEN, FrameBundleMismatch, UNLOAD_REGISTRATION, patchExportSwitch, patchUnloadRegistration } from '../client/bundle-patch.js'
import { frameDocument } from '../client/frame.js'

const BUNDLE = readFileSync(new URL('../client.frame.js', import.meta.url), 'utf8')

test('the real vendored bundle loses both unload registrations', () => {
  assert.equal(BUNDLE.split(UNLOAD_REGISTRATION).length - 1, 1, 'the bundle must register the native unload handler exactly once')
  assert.equal(BUNDLE.split(BEFOREUNLOAD_REGISTRATION).length - 1, 1, 'the bundle must register beforeunload exactly once')
  const patched = patchUnloadRegistration(BUNDLE)
  assert.equal(patched.includes(UNLOAD_REGISTRATION), false)
  assert.equal(patched.includes(BEFOREUNLOAD_REGISTRATION), false)
  assert.equal(patched.includes('removeEventListener("beforeunload",U)'), true, 'the teardown listener is left alone')
})

test('frameDocument builds the iframe without either registration', () => {
  const html = frameDocument(BUNDLE)
  assert.equal(html.includes(UNLOAD_REGISTRATION), false)
  assert.equal(html.includes(BEFOREUNLOAD_REGISTRATION), false)
  assert.match(html, /<div id="root"><\/div><script>/)
})

test('a bundle without a marker refuses by name', () => {
  const renamedUnload = BUNDLE.replace(UNLOAD_REGISTRATION, 'zg(window,"unload",this.onUnload,!0)')
  assert.throws(() => patchUnloadRegistration(renamedUnload), (error) => error instanceof FrameBundleMismatch && error.code === 'FRAME_BUNDLE_MISMATCH' && /native unload registration/.test(error.message))
  assert.throws(() => frameDocument(renamedUnload), (error) => error.code === 'FRAME_BUNDLE_MISMATCH')
  const renamedBefore = BUNDLE.replace(BEFOREUNLOAD_REGISTRATION, 'window.addEventListener("beforeunload",V)')
  assert.throws(() => patchUnloadRegistration(renamedBefore), (error) => error.code === 'FRAME_BUNDLE_MISMATCH' && /beforeunload registration/.test(error.message))
  const doubled = BUNDLE + UNLOAD_REGISTRATION
  assert.throws(() => patchUnloadRegistration(doubled), (error) => error.code === 'FRAME_BUNDLE_MISMATCH' && /found 2/.test(error.message))
})

test('the export switch is still flipped for the renderer', () => {
  assert.equal(BUNDLE.includes(EXPORT_CLOSED), true)
  const patched = patchExportSwitch(BUNDLE)
  assert.equal(patched.includes(EXPORT_OPEN), true)
  assert.equal(patched.includes(EXPORT_CLOSED), false)
  assert.throws(() => patchExportSwitch(BUNDLE.replace(EXPORT_CLOSED, 'export:!1')), (error) => error.code === 'FRAME_BUNDLE_MISMATCH')
})
