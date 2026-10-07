/**
 * PURPOSE
 *   Render the Specs window's real client bundle without a browser, and assert what it ASKS
 *   FOR. The defect this exists for was invisible to every check that ran a host handler
 *   directly: a state variable inside `SpecsWindow` was named `cap`, shadowing the capability
 *   object, so the panel requested `undefined?session=...` - a RELATIVE url that resolved
 *   against the page and got the host's 404 with an empty body. Identical for both scopes, on
 *   every build, past every restart, while the server answered the correct url perfectly.
 *
 *   A browser was needed to see it happen; a browser is not needed to prove it cannot come
 *   back. The bundle's component tree is executed here with a stub React, and the url handed to
 *   `fetch` is checked - before the fix, `undefined?session=...`.
 *
 * INPUTS
 *   The bundle at `plugins/dsh-adr-panel/client.js`, loaded through the same
 *   `window.__ModuleLoader__.load({ id, factory })` contract the Web client uses.
 *
 * OUTPUTS
 *   `node --test scripts/test-adr-panel-render.mjs`. A failure names the url that was requested
 *   instead of the one a panel must request.
 *
 * KEYWORDS
 *   adr-panel, client bundle, render, shadowing, fetch url, regression, no browser
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

const BUNDLE = new URL('../plugins/dsh-adr-panel/client.js', import.meta.url).href

/**
 * A React stub that runs components synchronously.
 *
 * `useState` keeps values in per-component slots, `useEffect` runs immediately - which is what
 * makes the panel's data load observable - and `createElement` returns a plain node the
 * renderer walks. `overrides` supplies the ROOT component's first hook values, which is how a
 * click (`open === true`) is simulated.
 *
 * @param overrides - Values the root component's hooks must return, by hook index.
 * @returns `{ React, render }`.
 */
function makeReact(overrides = []) {
  const hooks = { index: 0, values: [], overrides }
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => {
      const index = hooks.index
      hooks.index += 1
      if (hooks.overrides[index] !== undefined) return [hooks.overrides[index], () => {}]
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
      return [hooks.values[index], () => {}]
    },
    useEffect: (fn) => {
      const disposer = fn()
      if (typeof disposer === 'function') disposer()
    },
    useRef: (initial) => ({ current: initial }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn(),
  }

  /**
   * Execute a rendered tree, running every function component in it.
   *
   * Hook slots are per component: hooks belong to the component, not the page, and overrides
   * describe only the component under test. Applying them to nested components gave the window
   * `data = true` instead of its own initial object.
   *
   * @param node - The element or subtree.
   * @param isRoot - True only for the component under test.
   * @returns The rendered tree as plain objects.
   */
  function render(node, isRoot = false) {
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map((child) => render(child, false))
    if (typeof node.type === 'function') {
      const saved = { index: hooks.index, values: hooks.values, overrides: hooks.overrides }
      hooks.index = 0
      hooks.values = []
      hooks.overrides = isRoot ? saved.overrides : []
      const out = render(node.type(Object.assign({}, node.props, { children: node.children })), false)
      hooks.index = saved.index
      hooks.values = saved.values
      hooks.overrides = saved.overrides
      return out
    }
    return Object.assign({}, node, { children: (node.children ?? []).map((child) => render(child, false)) })
  }

  return { React, render }
}

/**
 * Load the bundle, register it, and render the trigger with the stubs still installed.
 *
 * Everything happens inside one stub lifetime, because rendering is what issues the fetch: a
 * helper that restored `globalThis.fetch` before the caller rendered would measure Node's own
 * fetch instead of the panel's.
 *
 * @param options - `{ capability, open, sessionId }`. `capability` undefined models a page
 *   where the host half never injected its global.
 * @returns `{ tree, calls }`: the rendered tree and every fetch the panel issued.
 */
async function renderPanel(options = {}) {
  const { capability, open = true, sessionId = 'session-a' } = options
  const previous = { window: globalThis.window, location: globalThis.location, fetch: globalThis.fetch }
  let definition = null
  const calls = []
  const { React, render } = makeReact([open])
  globalThis.window = { __ModuleLoader__: { load: (d) => { definition = d } } }
  globalThis.location = { origin: 'http://127.0.0.1:3080' }
  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), headers: (init && init.headers) || {} })
    return new Promise(() => {})
  }
  if (capability === undefined) delete globalThis.__DSH_ADR_PANEL_SPECS__
  else globalThis.__DSH_ADR_PANEL_SPECS__ = capability

  try {
    await import(`${BUNDLE}?probe=${Math.random()}`)
    assert.notEqual(definition, null, 'the bundle declared no module')
    const captured = []
    definition.factory((name) => {
      if (name === 'react') return React
      throw new Error(`unexpected require: ${name}`)
    }).apply({
      effect: (fn) => fn(),
      slots: {
        inject: (name, fn) => fn(),
        register: (spec, component) => {
          captured.push({ spec, component })
          return () => {}
        },
      },
    })
    assert.equal(captured.length, 1, 'the bundle must register exactly one slot action')
    assert.equal(captured[0].spec.name, 'conversation.session.header.actions')
    return { tree: render(captured[0].component({ sessionId }), true), calls }
  } finally {
    globalThis.fetch = previous.fetch
    globalThis.location = previous.location
    globalThis.window = previous.window
  }
}

const CAPABILITY = { route: '/adr-panel/specs', header: 'x-adr-panel-specs', token: 'probe-token' }

test('the panel asks the host for its route, never for "undefined"', async () => {
  const { calls } = await renderPanel({ capability: CAPABILITY, open: true })

  assert.ok(calls.length > 0, 'opening the window must ask the host for the listing')
  assert.equal(calls[0].url, '/adr-panel/specs?session=session-a&scope=local')
  assert.equal(calls[0].headers['x-adr-panel-specs'], 'probe-token', 'the capability token must travel')
  assert.ok(
    calls.every((call) => !call.url.includes('undefined')),
    `a request went to a url containing "undefined": ${calls.map((c) => c.url).join(', ')}`,
  )
})

test('a page without the capability renders a message instead of throwing', async () => {
  const { tree } = await renderPanel({ capability: undefined, open: true })

  const text = JSON.stringify(tree)
  assert.match(text, /not mounted in this composition/, 'the missing host half must be visible in the window')
  assert.match(text, /Specs/, 'the window itself must still render')
})

test('the closed trigger renders without asking the host for anything', async () => {
  const { tree, calls } = await renderPanel({ capability: CAPABILITY, open: false })

  assert.equal(calls.length, 0, 'a closed panel must not read anything')
  assert.match(JSON.stringify(tree), /Project specs/, 'the button is labelled by its aria-label')
})
