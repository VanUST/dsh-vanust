/*
PROOF: the design-map page editor is an editor on open, and it can take the whole screen
Behavior: the built client bundle is loaded the way the shell loads it; PageEditor renders one
  toolbar with the page switch and Reload/Check/Tidy/Render/Full screen, one stage for the
  Excalidraw frame and no read/edit toggle: the canvas is editable from the first paint. The
  source keeps the Full screen call (requestFullscreen on the editor root) and the readability
  panel wired to the host's lintPage; the frame document hides the menu/help and KEEPS the
  drawing toolbar, undo/redo and zoom.
Fails when: a read mode or an edit-mode toggle comes back, the frame is built read-only, the
  toolbar loses the full-screen control, or the frame hides the editor the human draws with.
  CASE_NEGATIVE_CONTROL=expect-pre-fix asserts the pre-fix shape (the toggle and its two
  labels), which fails on this build - the measured red.
Production path: plugins/designmap/client/page-view.jsx + client.js (built by
  build-client.mjs), client/frame.js, client/styles.js.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.env.PANEL_ROOT ?? process.cwd()
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''
const PAGE = readFileSync(join(ROOT, 'plugins/designmap/client/page-view.jsx'), 'utf8')
const FRAME = readFileSync(join(ROOT, 'plugins/designmap/client/frame.js'), 'utf8')
const STYLES = readFileSync(join(ROOT, 'plugins/designmap/client/styles.js'), 'utf8')

/** Load the built client bundle through a fake module loader and a minimal React. */
function loadClient() {
  const source = readFileSync(join(ROOT, 'plugins/designmap/client.js'), 'utf8')
  const state = []
  let cursor = 0
  const element = (type, props, children) => ({ type, props: { ...(props ?? {}), ...(children === undefined ? {} : { children }) } })
  const React = {
    createElement: (type, props, ...children) => element(type, props, children.length <= 1 ? children[0] : children),
    Fragment: 'Fragment',
    useState: (initial) => {
      const index = cursor
      cursor += 1
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
    },
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: (initial = null) => ({ current: initial }),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  }
  const runtime = { jsx: (type, props) => element(type, props, props?.children), jsxs: (type, props) => element(type, props, props?.children), Fragment: 'Fragment' }
  let exported = null
  const window = {
    __ModuleLoader__: {
      load: ({ factory }) => {
        exported = factory((name) => (name === 'react' ? React : name === 'react/jsx-runtime' ? runtime : {}))
      },
    },
  }
  const document = {
    querySelector: () => null,
    createElement: () => ({ setAttribute() {}, textContent: '', append() {}, remove() {} }),
    head: { append() {} },
    addEventListener() {},
    removeEventListener() {},
    fullscreenElement: null,
  }
  new Function('window', 'document', 'location', 'fetch', source)(window, document, { href: 'http://localhost/' }, async () => ({ ok: false, status: 0 }))
  return exported
}

/** Every text node of the rendered tree, joined. */
function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  return textOf(node.props?.children)
}

function buttonsOf(node, out = []) {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const child of node) buttonsOf(child, out); return out }
  if (node.type === 'button') out.push({ text: textOf(node).trim(), props: node.props ?? {} })
  buttonsOf(node.props?.children, out)
  return out
}

test('negative control expect-pre-fix keeps the read/edit toggle', () => {
  if (control !== 'expect-pre-fix') return
  assert.match(PAGE, /Edit mode/)
  assert.match(PAGE, /setMode/)
})

test('the editor renders one toolbar and no edit-mode toggle', () => {
  const api = loadClient()
  assert.ok(api !== null && typeof api.PageEditor === 'function', 'the bundle does not export PageEditor')
  const tree = api.PageEditor({
    host: {
      pages: async () => ({ ok: true, value: { pages: [] } }),
      page: async () => ({ ok: false, error: { message: 'not called' } }),
      lintPage: async () => ({ ok: true, value: { score: 100, verdict: 'clean', counts: { total: 0 }, findings: [] } }),
    },
  })
  const text = textOf(tree)
  for (const label of ['Design map', 'Page', 'Reload', 'Check', 'Tidy', 'Render', 'Full screen']) {
    assert.ok(text.includes(label), `the toolbar lost "${label}"`)
  }
  assert.equal(/Edit mode/i.test(text), false, 'the read/edit toggle is back')
  const buttons = buttonsOf(tree).map((entry) => entry.text)
  assert.equal(buttons.includes('Edit mode: off'), false)
  assert.equal(buttons.includes('Edit mode: on'), false)
  assert.equal(tree.props?.['data-expanded'], 'false')
})

test('the editor can take the whole screen and reads the host readability report', () => {
  assert.match(PAGE, /requestFullscreen/)
  assert.match(PAGE, /fullscreenchange/)
  assert.match(PAGE, /lintPage/)
  assert.match(PAGE, /dmv-lint/)
})

test('the frame keeps the drawing toolbar and hides only the editor entry points', () => {
  assert.doesNotMatch(FRAME, /\.App-toolbar[,{]/)
  assert.doesNotMatch(FRAME, /\.zoom-button[,}]/)
  assert.match(FRAME, /\.dropdown-menu-button/)
  assert.match(FRAME, /\.HintViewer/)
  // The editor's own chrome rules are built once: no `editing` option rebuilds the document.
  assert.doesNotMatch(PAGE, /frameDocument\(text, LOOK, \{ editing/)
})

test('the stylesheet declares the full-screen layout and no dead React Flow chrome', () => {
  assert.match(STYLES, /\.dmv:fullscreen/)
  assert.doesNotMatch(STYLES, /react-flow/)
  assert.doesNotMatch(STYLES, /dmv-node/)
})
