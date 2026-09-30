/**
 * PURPOSE
 *   Drive the SHIPPED `plugins/dsh-adr-panel/client.js` bundle through a stub module loader and
 *   a minimal React, and assert the observable UX contract: the bundle registers ONE
 *   Session-header action, that action renders a button a human can click, clicking it opens
 *   the window from the same component, the window lists the project's specs fetched from the
 *   host route, and opening a spec lets it be edited and saved back through that route.
 *
 *   A browser bundle cannot be imported by Node, so this is the only place its contract can be
 *   measured at all. Every claim is about what the component RENDERS or what it SENT, never
 *   about the shape of a module.
 *
 *   The one-seat claim is load-bearing, not cosmetic: an earlier revision put the button in
 *   `conversation.session.header.actions` and the window in `shell.overlay`, sharing a store
 *   between two independently-mounted components. The button then rendered while the window
 *   never appeared. So this test asserts the window is reachable from the TRIGGER alone, and
 *   that no second seat is registered.
 *
 * INPUTS
 *   None. The host route is a stub `fetch`; the corpus is a fixture list of specs.
 *
 * OUTPUTS
 *   Prints one `[ok]`/`[FAIL]` line per claim and exits 0 only when every claim holds. A bundle
 *   that never calls `window.__ModuleLoader__.load`, or whose factory throws, is a FAILURE with
 *   the reason rather than a skip.
 *
 * KEYWORDS
 *   adr panel, client bundle, render test, slots, specs, stub loader, behavioural, single seat
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No capability global: the window must say the host is not mounted instead of showing an
 *     empty list that reads like "this project has no specs".
 *   - No bound Session: the window must say so rather than requesting a project it cannot name.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const KIT = process.cwd()
const BUNDLE = join(KIT, 'plugins', 'dsh-adr-panel', 'client.js')

// ── a minimal React ─────────────────────────────────────────────────────────
let currentInstance = null
let dirty = false
let nodes = []
const instances = new Map()
const effectQueue = []

/** Creates the pseudo-element tree a React component returns. */
function createElement(type, props) {
  const children = []
  const push = (child) => {
    if (Array.isArray(child)) child.forEach(push)
    else children.push(child)
  }
  for (let index = 2; index < arguments.length; index += 1) push(arguments[index])
  return { type, key: props && props.key !== undefined ? props.key : null, props: props || {}, children }
}

const React = {
  createElement,
  useState(initial) {
    const instance = currentInstance
    const index = instance.cursor
    instance.cursor += 1
    if (instance.hooks[index] === undefined) {
      instance.hooks[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }
    }
    const hook = instance.hooks[index]
    return [
      hook.value,
      (next) => {
        const value = typeof next === 'function' ? next(hook.value) : next
        if (!Object.is(value, hook.value)) {
          hook.value = value
          dirty = true
        }
      },
    ]
  },
  useEffect(fn, deps) {
    const instance = currentInstance
    const index = instance.cursor
    instance.cursor += 1
    if (instance.hooks[index] === undefined) instance.hooks[index] = { kind: 'effect', deps: undefined, cleanup: undefined }
    effectQueue.push({ instance, index, fn, deps })
  },
}

/** The text content of an element subtree, ignoring component boundaries. */
function collectText(element) {
  if (element === null || element === undefined || typeof element === 'boolean') return ''
  if (typeof element === 'string' || typeof element === 'number') return String(element)
  if (Array.isArray(element)) return element.map(collectText).join('')
  if (typeof element.type === 'function') return ''
  return (element.children || []).map(collectText).join('')
}

/** Renders one pass, recording every host node and running queued effects. */
function walk(element, path) {
  if (element === null || element === undefined || typeof element === 'boolean') return
  if (Array.isArray(element)) {
    element.forEach((child, index) => walk(child, `${path}.${index}`))
    return
  }
  if (typeof element === 'string' || typeof element === 'number') return
  const type = element.type
  if (typeof type === 'function') {
    let instance = instances.get(path)
    if (instance === undefined) {
      instance = { hooks: [], cursor: 0 }
      instances.set(path, instance)
    }
    instance.cursor = 0
    const previous = currentInstance
    currentInstance = instance
    const output = type(element.props)
    currentInstance = previous
    walk(output, `${path}>${element.key === null ? 'k' : element.key}`)
    return
  }
  nodes.push({ tag: type, style: element.props.style, text: collectText(element), props: element.props })
  element.children.forEach((child, index) => walk(child, `${path}.${index}`))
}

/** Renders once and drains effects whose dependencies changed. */
function renderOnce(root, prefix) {
  effectQueue.length = 0
  nodes = []
  dirty = false
  walk(root, prefix)
  for (const effect of effectQueue) {
    const hook = effect.instance.hooks[effect.index]
    const previous = hook.deps
    const changed =
      previous === undefined ||
      effect.deps === undefined ||
      previous.length !== effect.deps.length ||
      effect.deps.some((dep, index) => !Object.is(dep, previous[index]))
    if (changed) {
      if (typeof hook.cleanup === 'function') {
        try {
          hook.cleanup()
        } catch {
          // A cleanup failure must not hide the assertion that follows.
        }
      }
      hook.deps = effect.deps
      hook.cleanup = effect.fn()
    }
  }
}

/** Renders until the tree stops marking itself dirty, bounded. */
async function flush(root, prefix) {
  renderOnce(root, prefix)
  for (let pass = 0; dirty && pass < 40; pass += 1) {
    dirty = false
    await Promise.resolve()
    await new Promise((resolveTick) => setTimeout(resolveTick, 10))
    renderOnce(root, prefix)
  }
  await new Promise((resolveTick) => setTimeout(resolveTick, 20))
  renderOnce(root, prefix)
}

/** Find a host node by tag and exact text. */
function button(text) {
  return nodes.find((node) => node.tag === 'button' && node.text === text)
}

// ── assertions ──────────────────────────────────────────────────────────────
const failures = []
let claims = 0

/** Records one assertion. */
function claim(name, ok, detail) {
  claims += 1
  if (!ok) failures.push(`${name}${detail === undefined ? '' : ` — ${detail}`}`)
  process.stdout.write(`  [${ok ? 'ok' : 'FAIL'}] ${name}${ok || detail === undefined ? '' : `  (${detail})`}\n`)
}

// ── load the bundle through a stub loader ───────────────────────────────────
let loaded = null
globalThis.window = {
  __ModuleLoader__: { load: (definition) => { loaded = definition } },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.location = { origin: 'http://stub.invalid' }

try {
  const source = readFileSync(BUNDLE, 'utf8')
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', source).call(globalThis, (name) => {
    if (name === 'react') return React
    throw new Error(`the bundle required an unexpected module: ${name}`)
  })
} catch (error) {
  process.stderr.write(`adr panel render FAILED\n  the bundle threw while loading: ${String(error && error.stack ? error.stack : error)}\n`)
  process.exit(1)
}

claim('the bundle calls window.__ModuleLoader__.load', loaded !== null, loaded === null ? 'no call was made' : undefined)
if (loaded === null) {
  process.stderr.write('adr panel render FAILED\n')
  process.exit(1)
}
claim('the bundle declares the id @cc/dsh-adr-panel', loaded.id === '@cc/dsh-adr-panel', JSON.stringify(loaded.id))

let exported = null
try {
  exported = loaded.factory((name) => {
    if (name === 'react') return React
    throw new Error(`the factory required an unexpected module: ${name}`)
  })
} catch (error) {
  process.stderr.write(`adr panel render FAILED\n  the factory threw: ${String(error && error.stack ? error.stack : error)}\n`)
  process.exit(1)
}

claim(
  'the bundle exports apply and inject',
  typeof exported.apply === 'function' && Array.isArray(exported.inject),
  `apply=${typeof exported.apply} inject=${JSON.stringify(exported.inject)}`,
)
claim(
  'the bundle requires only the slots service',
  Array.isArray(exported.inject) && exported.inject.length === 1 && exported.inject[0] === 'slots',
  JSON.stringify(exported.inject),
)

// ── a fake client context that records slot registrations ───────────────────
const registry = {}
const fakeCtx = {
  effect(fn) {
    return fn()
  },
  slots: {
    inject(name, factory) {
      return factory()
    },
    register(config, Component) {
      registry[config.name] = { config, Component }
      registry[config.name].members = typeof config.inject === 'function' ? config.inject() : {}
      return () => {}
    },
  },
}

try {
  exported.apply(fakeCtx)
} catch (error) {
  process.stderr.write(`adr panel render FAILED\n  apply() threw: ${String(error && error.stack ? error.stack : error)}\n`)
  process.exit(1)
}

claim(
  'apply registers the Session-header action',
  registry['conversation.session.header.actions'] !== undefined,
  `registered slots: ${JSON.stringify(Object.keys(registry))}`,
)
claim(
  'apply registers NO second seat, so the window cannot depend on one',
  Object.keys(registry).length === 1,
  `registered slots: ${JSON.stringify(Object.keys(registry))}`,
)

const header = registry['conversation.session.header.actions']
if (header === undefined) {
  process.stderr.write('adr panel render FAILED\n')
  process.exit(1)
}

// ── the header action renders a button that OPENS THE WINDOW ITSELF ─────────
const triggerProps = Object.assign({}, header.members, { sessionId: 'stub-session' })
const triggerTree = React.createElement(header.Component, triggerProps)
await flush(triggerTree, 'trigger')

const specsButton = button('Specs')
claim(
  'the header action renders a button labelled Specs',
  specsButton !== undefined,
  `buttons rendered: ${JSON.stringify(nodes.filter((n) => n.tag === 'button').map((n) => n.text))}`,
)
claim(
  'the window is NOT rendered before the click',
  button('Close') === undefined,
  `buttons before click: ${JSON.stringify(nodes.filter((n) => n.tag === 'button').map((n) => n.text))}`,
)

if (specsButton === undefined) {
  process.stderr.write('adr panel render FAILED\n')
  process.exit(1)
}

// ── the host route stub ─────────────────────────────────────────────────────
const SPEC_ROUTE = '/adr-panel/specs'
const SPEC_HEADER = 'x-adr-panel-specs'
globalThis.__DSH_ADR_PANEL_SPECS__ = { route: SPEC_ROUTE, header: SPEC_HEADER, token: 'stub-token' }

const requests = []
globalThis.fetch = (url, init) => {
  const target = String(url)
  const headers = (init && init.headers) || {}
  requests.push({ url: target, headers, method: (init && init.method) || 'GET', body: init && init.body })
  if (init && init.method === 'POST') {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, file: 'alpha.spec.md' }) })
  }
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      ok: true,
      project: '/stub/project',
      specs: [
        { file: 'alpha.spec.md', title: 'Alpha spec', status: 'active', body: '---\ntitle: Alpha spec\nstatus: active\n---\nALPHA-BODY\n' },
        { file: 'beta.spec.md', title: 'Beta spec', status: 'draft', body: 'BETA-BODY\n' },
      ],
    }),
  })
}
globalThis.confirm = () => false

specsButton.props.onClick()
await flush(triggerTree, 'trigger')

const overlayText = nodes.map((node) => node.text).join('\u0000')
claim(
  'clicking the button opens the window from the trigger alone',
  button('Close') !== undefined,
  `buttons after click: ${JSON.stringify(nodes.filter((n) => n.tag === 'button').map((n) => n.text))}`,
)
claim('the window names the plugin version', overlayText.includes('adr-panel'), overlayText.slice(0, 160))
claim(
  'the window lists the specs the host route returned',
  overlayText.includes('Alpha spec') && overlayText.includes('Beta spec'),
  overlayText.slice(0, 240),
)
claim(
  'the window asks the host for the bound Session',
  requests.some((r) => r.url.includes(SPEC_ROUTE) && r.url.includes('session=stub-session')),
  JSON.stringify(requests.map((r) => r.url)),
)
claim(
  'the request carries the capability header from the index global',
  requests.some((r) => r.headers[SPEC_HEADER] === 'stub-token'),
  JSON.stringify(requests.map((r) => r.headers)),
)

// ── opening a spec lets it be edited and saved ──────────────────────────────
const alphaButton = nodes.find((node) => node.tag === 'button' && typeof node.text === 'string' && node.text.startsWith('Alpha spec'))
claim(
  'each spec is a button a human can open',
  alphaButton !== undefined,
  `buttons: ${JSON.stringify(nodes.filter((n) => n.tag === 'button').map((n) => n.text).slice(0, 8))}`,
)

if (alphaButton !== undefined) {
  alphaButton.props.onClick()
  await flush(triggerTree, 'trigger')
  const editor = nodes.find((node) => node.tag === 'textarea')
  claim(
    'opening a spec shows its content in an editor',
    editor !== undefined && String(editor.props.value).includes('ALPHA-BODY'),
    editor === undefined ? 'no textarea rendered' : JSON.stringify(String(editor.props.value).slice(0, 60)),
  )
  claim('the editor offers a Save button', button('Save') !== undefined, `buttons: ${JSON.stringify(nodes.filter((n) => n.tag === 'button').map((n) => n.text))}`)
  if (editor !== undefined && button('Save') !== undefined) {
    editor.props.onChange({ target: { value: 'EDITED-BODY\n' } })
    await flush(triggerTree, 'trigger')
    const saveNow = button('Save')
    saveNow.props.onClick()
    await flush(triggerTree, 'trigger')
    const posted = requests.find((r) => r.method === 'POST')
    claim(
      'saving posts the edited content to the host route',
      posted !== undefined && String(posted.body).includes('EDITED-BODY'),
      posted === undefined ? 'no POST was made' : String(posted.body).slice(0, 120),
    )
  }
}

// ── Create: the flow the button exists for ──────────────────────────────────
// A fresh trigger path, because the stub renderer keys component state by path and this needs
// a window that has never been opened or saved in.
const createTree = React.createElement(header.Component, Object.assign({}, header.members, { sessionId: 'stub-session' }))
await flush(createTree, 'trigger-create')
button('Specs').props.onClick()
await flush(createTree, 'trigger-create')

const createButton = button('Create')
claim('the window offers a Create button', createButton !== undefined, `buttons: ${JSON.stringify(nodes.filter((n) => n.tag === 'button').map((n) => n.text))}`)

// A disabled control fires no handler at all, so the stub MUST assert the enabled state: the
// panel test drives onClick directly and would otherwise pass over a dead button.
claim(
  'Create is clickable, not disabled, before anything is typed',
  createButton !== undefined && createButton.props.disabled !== true,
  `disabled=${createButton === undefined ? 'n/a' : String(createButton.props.disabled)}`,
)

const requestsBeforeCreate = requests.length
if (createButton !== undefined) {
  createButton.props.onClick()
  await flush(createTree, 'trigger-create')
  const emptyText = nodes.map((node) => node.text).join('\u0000')
  claim('clicking Create with no name SAYS SO instead of doing nothing', emptyText.includes('type a spec name'), emptyText.slice(0, 200))
  claim('the empty click issued no request', requests.length === requestsBeforeCreate, `${requests.length - requestsBeforeCreate} request(s) issued`)

  const nameInput = nodes.find((node) => node.tag === 'input')
  claim('the window offers a name field', nameInput !== undefined, `inputs: ${nodes.filter((n) => n.tag === 'input').length}`)
  if (nameInput !== undefined) {
    nameInput.props.onChange({ target: { value: 'my-feature' } })
    await flush(createTree, 'trigger-create')
    const enabled = button('Create')
    claim('Create stays clickable after typing a name', enabled !== undefined && enabled.props.disabled !== true, `disabled=${enabled === undefined ? 'n/a' : String(enabled.props.disabled)}`)
    enabled.props.onClick()
    await flush(createTree, 'trigger-create')
    const created = requests.filter((r) => r.method === 'POST').pop()
    claim(
      'Create posts a .md filename derived from the typed name',
      created !== undefined && String(created.body).includes('my-feature.spec.md'),
      created === undefined ? 'no POST was issued' : String(created.body).slice(0, 140),
    )
    claim(
      'the new spec opens in the editor with the template body',
      nodes.some((node) => node.tag === 'textarea' && String(node.props.value).includes('Write the requirement here.')),
      `textareas: ${nodes.filter((n) => n.tag === 'textarea').length}`,
    )
  }
}

// ── the window says so when the host half is not mounted ────────────────────
delete globalThis.__DSH_ADR_PANEL_SPECS__
// A FRESH trigger instance: the stub renderer keys component state by path, so re-using the
// path would reuse the already-open window's hook state instead of opening a new one.
const freshTree = React.createElement(header.Component, Object.assign({}, header.members, { sessionId: 'stub-session' }))
await flush(freshTree, 'trigger-nohost')
const freshButton = button('Specs')
if (freshButton !== undefined) {
  freshButton.props.onClick()
  await flush(freshTree, 'trigger-nohost')
}
const noHostText = nodes.map((node) => node.text).join('\u0000')
claim(
  'with no capability global the window says the host is not mounted',
  noHostText.includes('host is not mounted'),
  noHostText.slice(0, 200),
)

process.stdout.write(`\n${claims - failures.length}/${claims} panel claims held\n`)
if (failures.length > 0) {
  process.stderr.write(`adr panel render FAILED\n  ${failures.join('\n  ')}\n`)
  process.exit(1)
}
process.stdout.write('adr panel render ok\n')
