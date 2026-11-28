/**
 * In-memory patches for the vendored Excalidraw bundle (client.frame.js).
 *
 * The bundle is a third-party build: the repository copy is never edited on disk, but two
 * callers need different bytes in memory — the panel builds the iframe document from them,
 * and the headless renderer opens the export dialog the glue closes. Both patches are
 * MARKER-CHECKED: a re-vendored bundle that no longer contains the exact minified text is a
 * named refusal here, not a silent no-op that would quietly lose the fix.
 *
 * WHY THE UNLOAD PATCHES. Excalidraw registers two document-lifetime listeners:
 *   - `zg(window,"unload",this.onUnload,!1)` in its App constructor (the native `unload`
 *     handler), and
 *   - `window.addEventListener("beforeunload",U)` when a text editor is created.
 * The DSH shell serves the panel iframe under `Permissions-Policy: unload=()`, so Chrome
 * prints "Permissions policy violation: unload is not allowed in this document" once per
 * frame build as soon as the first of them is registered. Both are meaningless inside our
 * iframe (the panel owns the document and saves the page on every change), and removing the
 * registrations is the fix; hiding the console message is not.
 */

/** The native unload registration in Excalidraw's App constructor; one occurrence. */
export const UNLOAD_REGISTRATION = 'zg(window,"unload",this.onUnload,!1)'

/** The beforeunload registration in the text-editor mount; one occurrence. */
export const BEFOREUNLOAD_REGISTRATION = 'window.addEventListener("beforeunload",U)'

/** The glue's disabled export switch and the same switch open (the renderer's one change). */
export const EXPORT_CLOSED = 'loadScene:!1,saveToActiveFile:!1,export:!1'
export const EXPORT_OPEN = 'loadScene:!1,saveToActiveFile:!1,export:!0'

/** A vendored bundle whose bytes are not the ones this package expects. */
export class FrameBundleMismatch extends Error {
  constructor(what) {
    super(what)
    this.name = 'FrameBundleMismatch'
    this.code = 'FRAME_BUNDLE_MISMATCH'
  }
}

const count = (text, needle) => text.split(needle).length - 1

/** Remove ONE registration by its exact marker, refusing by name when it is absent or repeated. */
function stripOne(text, marker, label) {
  const found = count(text, marker)
  if (found !== 1) {
    throw new FrameBundleMismatch(
      `client.frame.js is not the vendored Excalidraw bundle this package expects: expected exactly one ${label} (${marker}), found ${found}. A re-vendored bundle needs the unload patch re-checked.`,
    )
  }
  return text.replace(marker, 'void 0')
}

/**
 * The bundle with Excalidraw's unload and beforeunload registrations removed (in memory only).
 *
 * Refuses by name when either marker is absent or not unique: a re-vendored bundle must be
 * reviewed, not patched by guesswork.
 */
export function patchUnloadRegistration(text) {
  const withoutUnload = stripOne(text, UNLOAD_REGISTRATION, 'native unload registration')
  return stripOne(withoutUnload, BEFOREUNLOAD_REGISTRATION, 'beforeunload registration')
}

/** The bundle with Excalidraw's export dialog switched on (in memory only). */
export function patchExportSwitch(text) {
  if (!text.includes(EXPORT_CLOSED)) {
    throw new FrameBundleMismatch(
      'client.frame.js is not the vendored Excalidraw bundle this exporter expects (no export switch found)',
    )
  }
  return text.replace(EXPORT_CLOSED, EXPORT_OPEN)
}
