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
 * Excalidraw's editing chrome (toolbar, library, hints) is hidden: the panel already owns
 * the only allowed edits (move a node, recolour it) through its own controls, and offering
 * a full drawing toolbar would let the human create elements that carry no semantic id and
 * would therefore be silently dropped on the next render.
 */
export function frameDocument(script, look = { surface: '#ffffff' }) {
  const safe = script.replaceAll('</script', '<\\/script')
  const background = /^#[0-9a-f]{3,8}$/iu.test(String(look?.surface ?? '')) ? look.surface : '#ffffff'
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body,#root{height:100%;margin:0;background:${background};overflow:hidden}
.App-toolbar,.HintViewer,.App-menu,.layer-ui__wrapper__top-right,.dropdown-menu-button{display:none!important}
</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
}
