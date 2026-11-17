/**
 * The vendored Excalidraw frame, loaded from this package.
 *
 * The editor runs in an iframe `srcdoc` so it cannot reach the workspace: the panel is
 * the only bridge. The frame reports its own changes and the panel turns them into the
 * overlay deltas the host command accepts (see client/excalidraw.js).
 *
 * The frame bundle is addressed through the module system's revisioned route, the same
 * way the viewer addressed it before; a relative `plugins/...` would resolve against the
 * document and break under a path prefix.
 */
const PKG = '@cc/dsh-designmap'
export const FRAME_FILE = 'client.frame.js'
export const FRAME_SOURCE = 'design-map-frame'
export const PANEL_SOURCE = 'design-map-panel'

/** Fetch the frame bundle text for the running revision of this package. */
export async function loadFrameText(fetchImpl = globalThis.fetch) {
  const boot = globalThis.__DSH_BOOT__
  const entry = (boot?.entries ?? []).find((row) => row?.id === PKG)
  const rev = entry === undefined ? null : new URL(entry.url, location.href).searchParams.get('rev')
  const url = `/plugins/${PKG}/${FRAME_FILE}${rev === null ? '' : `?rev=${encodeURIComponent(rev)}`}`
  const response = await fetchImpl(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`excalidraw frame HTTP ${response.status}`)
  return response.text()
}

/**
 * The iframe document: a bare root the frame bundle mounts into, plus the chrome rules.
 *
 * In read-only the editing chrome (toolbar, menu, hints) is hidden: the map is a document.
 * In edit mode the chrome is the human's editing UI (colour, shapes, text, pen), and what
 * they draw is persisted as a separate annotation layer — never as scene geometry.
 */
export function frameDocument(script, look = { surface: '#ffffff' }, { editing = false } = {}) {
  const safe = script.replaceAll('</script', '<\\/script')
  const background = /^#[0-9a-f]{3,8}$/iu.test(String(look?.surface ?? '')) ? look.surface : '#ffffff'
  // Read-only hides the whole editing chrome: the map is a document. Edit mode keeps the
  // drawing tools (the annotation layer) and hides the editor's own entry points: the panel
  // owns undo, fit, zoom and the document identity, so a hamburger menu, a Library link, a
  // Help "?" and a second undo/redo pair only add unlabelled icons — the "unclear glyphs"
  // the owner reported. The frame CSS is fixed when the document is built, which is why the
  // panel rebuilds the frame when the mode changes.
  const editorChrome = [
    '.HintViewer',
    '.dropdown-menu-button',
    '.layer-ui__wrapper__top-right',
    '.help-icon',
    '.zoom-button',
    'button[aria-label="Undo"]',
    'button[aria-label="Redo"]',
  ].join(',')
  const chrome = editing
    ? `${editorChrome}{display:none!important}`
    : `.App-toolbar,.App-menu,.layer-ui__wrapper__top-right,.dropdown-menu-button,.help-icon,.zoom-button,.HintViewer{display:none!important}`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body,#root{height:100%;margin:0;background:${background};overflow:hidden}
${chrome}
</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
}
