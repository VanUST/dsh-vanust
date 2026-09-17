/**
 * PURPOSE
 *   Enforce, behaviourally, that the ADR panel's browser bundle renders the tree it
 *   is supposed to. The bundle is a browser-only artifact: `node --check` proves it
 *   parses, and nothing else in the kit ever executes it, so a React mistake — a
 *   component invoked with a props object, a pill that loses its tone, a heading
 *   that leaks a glob pattern — ships silently and is only found by a human
 *   reloading a tab.
 *
 *   It loads `plugins/dsh-adr-panel/client.js` through a stub module loader with a
 *   minimal React, drives `apply` with a fake client context, renders the overlay
 *   over the kit's real `docs/adrs` and `docs/specs`, and asserts the properties the
 *   UX contract states. A synthetic corpus then exercises the states the real
 *   corpus does not contain (a superseded decision, an unknown `decided in` id).
 *
 *   It also checks the COLOUR of every toned control, not just the token each one
 *   names. A control can cite the right theme variable and still be unreadable, because
 *   what matters is the value that variable resolves to: the theme's dark variant maps
 *   both `state-error-primary` and `state-error-secondary` to the same solid red, so a
 *   pill whose background used `-secondary` was filled with exactly its own text colour
 *   and its label vanished. Where the shell's theme bundle can be found, every toned
 *   pill's AND every toned button's foreground and background are resolved through it in
 *   both variants and required to differ by a minimum contrast ratio. A plain,
 *   transparent button is not measured, because it inherits its colour.
 *
 * INPUTS
 *   None. The kit root is derived from this script's location, and every file read
 *   is the kit's own source. The shell theme is read only if it can be found beside
 *   an installed harness. No network, no credentials, no model.
 *
 * OUTPUTS
 *   One `[PASS]`/`[FAIL]` line per assertion, and a `[SKIP]` line for the contrast
 *   check when no theme is installed — never a silent pass, because a check with
 *   nothing to read is not a passing check. Then `adr panel render ok` and exit 0
 *   when every claim held, or the failures on stderr and exit 1. A caller that
 *   greps for the marker cannot mistake a partial run for a pass.
 *
 * KEYWORDS
 *   adr panel, client bundle, render test, slots, state pill, provenance, tone,
 *   contract, browser half, stub loader, theme tokens, contrast, readability
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The bundle failing to call `window.__ModuleLoader__.load`, or its factory
 *     throwing, is a failure with the reason, never a skip: a bundle that cannot
 *     load in Node is a bundle whose contract cannot be checked.
 *   - A component that throws during render fails the assertion that rendered it,
 *     so a defect is reported against the property it broke.
 *   - The real corpus is read as it is: if a directory is absent the render shows a
 *     failure line and the structural assertions still run, because the layout, not
 *     the data, is what this test is about.
 *   - No installed theme, or a toned control whose colour cannot be resolved to a concrete
 *     value, is reported as skipped or unresolved rather than counted as contrast
 *     it never measured.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(KIT, 'plugins', 'dsh-adr-panel', 'client.js')

// ── a minimal React: function components, useState, useEffect ───────────────
const instances = new Map()
let currentInstance = null
let dirty = false
const effectQueue = []
let nodes = []

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
}

// ── assertions ──────────────────────────────────────────────────────────────
const failures = []
const claims = []

/** Records one assertion. */
function claim(name, ok, detail) {
  claims.push({ name, ok, detail })
  if (!ok) failures.push(`${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

// ── load the bundle through a stub loader ───────────────────────────────────
let loaded = null
globalThis.window = {
  __ModuleLoader__: { load: (definition) => { loaded = definition } },
  addEventListener() {},
  removeEventListener() {},
}
try {
  // `pathToFileURL`, not the path: a dynamic import takes a URL, and on Windows a raw
  // `C:\…` path is read as the scheme `c:` and rejected with
  // ERR_UNSUPPORTED_ESM_URL_SCHEME — so this check crashed on the platform the kit is
  // AUTHORED on while passing on the one it is deployed to.
  await import(pathToFileURL(CLIENT).href)
} catch (error) {
  process.stderr.write(`adr panel render FAILED\n  the bundle could not be evaluated: ${String(error)}\n`)
  process.exit(1)
}
claim('the bundle calls window.__ModuleLoader__.load', loaded !== null, loaded === null ? 'no call was made' : undefined)
if (loaded === null) {
  process.stderr.write(`adr panel render FAILED\n  ${failures.join('\n  ')}\n`)
  process.exit(1)
}
claim('the bundle declares the panel id', loaded.id === '@cc/dsh-adr-panel', `id=${JSON.stringify(loaded.id)}`)

const bundle = loaded.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error(`unexpected require: ${specifier}`)
})
claim('the factory exports an apply', typeof bundle.apply === 'function', `apply=${typeof bundle.apply}`) // test-quality:allow the bundle is loaded dynamically, so its export shape is a precondition the driving cases below depend on

// ── the host routes: a stub state route computed by the REAL ratchet ────────
//
// The panel no longer reads the corpus itself. It fetches the ratchet's view model from
// the host state route, and the ratchet — not this test — derives every force fact. So
// the stub here does not hand the panel a hand-made object it could learn to agree with:
// it runs the SAME `deriveDecisions` the host route calls, over a materialised corpus,
// and returns its output. That is what makes "the panel renders the ratchet's
// derivation" a measurement: a change to `resolveActiveSet` changes this payload, and
// the panel has no rule of its own to disagree with it.
//
// The consent route stays a deterministic stub, because what the HOST does with a
// consent request — the ratchet's refusals and the write — is the probe's measurement
// against the real modules; here the transport claims are about what the bundle SENT.
const stateModule = await import(pathToFileURL(join(KIT, 'plugins', 'ratchet', 'ratchet-decisions.mjs')).href)
/** The root the state stub derives over; a fixture run points it at the fixture. */
let stateRoot = KIT
/** How many state requests the whole test issued, so "the panel used the route" is measured. */
let stateCalls = 0
/**
 * A state answer to serve instead of a freshly derived one, used by the one claim about a
 * CAPPED answer. `null` keeps the real derivation, so every other claim still measures the
 * ratchet's own view rather than a hand-made object.
 */
let stateViewOverride = null
const stateView = () => (stateViewOverride === null ? stateModule.deriveDecisions({ root: stateRoot }) : stateViewOverride)

let consentHostHandler = null
const consentCalls = []
globalThis.location = { origin: 'http://stub.invalid' }
globalThis.__DSH_ADR_PANEL_CONSENT__ = { route: '/adr-panel/consent', token: 'stub-capability-token' }
globalThis.__DSH_ADR_PANEL_STATE__ = { route: '/adr-panel/state', token: 'stub-capability-token' }
globalThis.fetch = (url, init) => {
  const target = String(url)
  const headers = init === undefined || init.headers === undefined ? {} : init.headers
  const call = {
    url: target,
    method: init === undefined || init.method === undefined ? 'GET' : init.method,
    headers,
    body: init === undefined || init.body === undefined || init.body === null ? null : JSON.parse(init.body),
  }
  consentCalls.push(call)
  if (target.includes('/adr-panel/state')) {
    stateCalls += 1
    return Promise.resolve({ status: 200, json: () => Promise.resolve(stateView()) })
  }
  const answer = consentHostHandler === null ? { status: 500, body: { ok: false, message: 'the stub host has no handler for this request' } } : consentHostHandler(call)
  // `null` from a handler means "never answer", and a promise means "answer when I say so":
  // both are how the in-flight phase is held on screen long enough to read what it renders.
  if (answer === null) return new Promise(() => {})
  if (typeof answer.then === 'function') {
    return answer.then((settled) => ({ status: settled.status, json: () => Promise.resolve(settled.body) }))
  }
  return Promise.resolve({ status: answer.status, json: () => Promise.resolve(answer.body) })
}

// ── apply the bundle and capture its registrations ──────────────────────────
const registry = {}
const context = {
  effect(fn) { fn() },
  slots: {
    inject(_parent, fn) { fn() },
    register(config, Component) {
      registry[config.name] = { config, Component }
      return () => {}
    },
  },
}
try {
  bundle.apply(context)
} catch (error) {
  process.stderr.write(`adr panel render FAILED\n  apply threw: ${String(error)}\n`)
  process.exit(1)
}
claim(
  'apply registers the session-header action',
  registry['conversation.session.header.actions'] !== undefined,
  Object.keys(registry).join(', '),
)
claim('apply registers the overlay', registry['shell.overlay'] !== undefined, Object.keys(registry).join(', '))
if (registry['shell.overlay'] === undefined) {
  process.stderr.write(`adr panel render FAILED\n  ${failures.join('\n  ')}\n`)
  process.exit(1)
}

/** A pill is the node carrying `chipStyle`: a fully rounded chip with that padding. */
const isPillNode = (node) => node.tag === 'span' && node.style !== undefined && node.style.borderRadius === 999 && node.style.padding === '1px 6px'

/**
 * Every colour-carrying control rendered so far, across all scenarios, for the colour
 * check: a toned pill AND a toned button. The buttons are the gap this list closes —
 * Approve and the pointer's Open button are painted with the same `tone` helper the
 * pills use, and the README claims every colour the bundle renders is resolved through
 * the shell theme, so a button whose fill equals its own label must fail here too.
 */
const renderedControls = []

/** Records the pills and the toned buttons in the current render. */
function collectControls() {
  for (const node of nodes) {
    if (isPillNode(node)) {
      renderedControls.push({ kind: 'pill', text: node.text, style: node.style })
      continue
    }
    if (node.tag !== 'button' || node.style === undefined) continue
    // A plain button is transparent and inherits its colour, so it has no pair to
    // measure; a toned button carries the tone helper's fill and text colour.
    if (typeof node.style.background !== 'string' || node.style.background === 'transparent' || node.style.background === '') continue
    if (typeof node.style.color !== 'string' || node.style.color === 'inherit' || node.style.color === '') continue
    renderedControls.push({ kind: 'button', text: node.text, style: node.style })
  }
}

/** Renders the overlay from one inject face and returns the recorded nodes. */
async function renderOverlay(prefix, overrideLoad) {
  const overlay = registry['shell.overlay']
  const members = overlay.config.inject()
  const store = members.hooks.panel
  store.set({ open: true, sessionId: 'stub-session' })
  const props = Object.assign({}, members, {
    usePanel: (selector) => selector(store.getSnapshot()),
    ...(overrideLoad === undefined ? {} : { load: overrideLoad }),
  })
  try {
    const root = React.createElement(overlay.Component, props)
    await flush(root, prefix)
    await new Promise((resolveTick) => setTimeout(resolveTick, 30))
    await flush(root, prefix)
    collectControls()
    return { ok: true, root }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/**
 * Clicks one of the sticky section tabs and re-renders the SAME window instance at the
 * same prefix, so the chosen part persists. `nodes` then holds that part's tree. It is
 * how "switching shows one section" is measured rather than read from the source.
 *
 * @param root - the overlay element returned by {@link renderOverlay}.
 * @param prefix - the render prefix that element was flushed at.
 * @param key - the `data-adr-panel-section` key to switch to.
 * @returns True when a matching tab was found and clicked, false otherwise.
 */
async function showSection(root, prefix, key) {
  const tab = nodes.find(
    (node) => node.tag === 'button' && node.props !== undefined && node.props['data-adr-panel-section'] === key,
  )
  if (tab === undefined) return false
  tab.props.onClick()
  await flush(root, prefix)
  collectControls()
  return true
}

/** The section tabs currently drawn, in order. */
const sectionTabsOf = (list) =>
  list.filter((node) => node.tag === 'button' && node.props !== undefined && node.props['data-adr-panel-section'] !== undefined)

const first = await renderOverlay('root')
claim('the overlay renders over the real corpus', first.ok, first.ok ? undefined : first.error)

/**
 * Renders the overlay over the current state root and expands every collapsed
 * needs-a-human batch, so the grouped rendering's entries are all in the recorded tree.
 * The group header is a control, so a test that never clicks it would measure the
 * collapsed header alone — this is what makes "expanding reveals each entry" a
 * measurement rather than a reading. The root is re-flushed at the same prefix, because
 * the stub renderer keys component state by path and a fresh prefix would be a component
 * that had never been clicked.
 *
 * @param prefix - the render prefix; pass the same one if re-flushing.
 * @returns `{ ok }` or `{ ok: false, error }`, exactly like {@link renderOverlay}.
 */
async function renderOverlayExpanded(prefix) {
  const overlay = registry['shell.overlay']
  const members = overlay.config.inject()
  const store = members.hooks.panel
  store.set({ open: true, sessionId: 'stub-session' })
  const props = Object.assign({}, members, { usePanel: (selector) => selector(store.getSnapshot()) })
  try {
    const root = React.createElement(overlay.Component, props)
    await flush(root, prefix)
    await new Promise((resolveTick) => setTimeout(resolveTick, 30))
    await flush(root, prefix)
    const headers = nodes.filter((node) => node.tag === 'button' && node.props !== undefined && node.props['aria-expanded'] === 'false')
    for (const header of headers) header.props.onClick()
    await flush(root, prefix)
    collectControls()
    return { ok: true, root }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

const texts = nodes.map((node) => node.text)
const headings = nodes.filter((node) => node.tag === 'h3').map((node) => node.text)

// ── the section navigator: four parts, one drawn at a time ──────────────────
// The window used to be one long scroll — Needs a human, then every decision, every
// consent and every spec stacked in a single column. These claims are about the
// replacement: a sticky tab per part, each stating its count, and exactly one part's
// body on screen. Switching is driven through the real click handlers, not read from
// the source, so a tab that renders but does not switch fails here.
const firstTabs = sectionTabsOf(nodes)
const tabKeys = firstTabs.map((node) => node.props['data-adr-panel-section'])
claim(
  'the window draws one section tab per part, in order',
  JSON.stringify(tabKeys) === JSON.stringify(['needs', 'decisions', 'consents', 'specs']),
  JSON.stringify(firstTabs.map((node) => node.text)),
)
claim(
  'every section tab states its count',
  firstTabs.length === 4 && firstTabs.every((node) => /^(Needs a human|Decisions|Consents|Specs) \((\d+)\)$/.test(node.text)),
  JSON.stringify(firstTabs.map((node) => node.text)),
)
const selectedTab = firstTabs.find((node) => node.props['aria-selected'] === 'true')
claim(
  'the window opens on the first non-empty part, which for this corpus is Decisions',
  selectedTab !== undefined && selectedTab.props['data-adr-panel-section'] === 'decisions',
  JSON.stringify(firstTabs.map((node) => ({ key: node.props['data-adr-panel-section'], selected: node.props['aria-selected'] }))),
)
claim(
  'exactly one section is drawn at a time',
  headings.length === 1 && headings[0] === 'Decisions',
  JSON.stringify(headings),
)
{
  const before = nodes.map((node) => node.text)
  await showSection(first.root, 'root', 'specs')
  const after = nodes.map((node) => node.text)
  claim(
    'switching to a tab replaces the drawn section instead of appending to it',
    nodes.some((node) => node.tag === 'h3' && node.text === 'Specs') &&
      !nodes.some((node) => node.tag === 'h3' && node.text === 'Decisions') &&
      before.length > 0 && after.length > 0,
    `afterHeadings=${JSON.stringify(nodes.filter((node) => node.tag === 'h3').map((node) => node.text))}`,
  )
  claim(
    'the Specs tab draws the compiled law rows',
    nodes.some((node) => node.props !== undefined && node.props['data-adr-panel-section'] === 'specs' && node.props['aria-selected'] === 'true') &&
      nodes.some((node) => node.tag === 'span' && /^decided in /.test(node.text)),
    JSON.stringify(nodes.filter((node) => node.tag === 'span' && /^decided in /.test(node.text)).map((node) => node.text).slice(0, 4)),
  )
  // Back to Decisions for the tone claims below, which read decision-row pills.
  await showSection(first.root, 'root', 'decisions')
}
// The header chip is the only way a reader tells a stale client bundle from a bug, so
// it must name the bundle's own declared `PANEL_VERSION`, and that constant must not lag
// the package's version. Equality is deliberately NOT asserted: a source change bumps
// `PANEL_VERSION` one patch ahead of `package.json` and the repack step catches the
// manifest up, so demanding equality would fail exactly in the window this test runs in.
const packageVersion = JSON.parse(readFileSync(join(KIT, 'plugins', 'dsh-adr-panel', 'package.json'), 'utf8')).version
const declaredPanelVersion = /const PANEL_VERSION = "([^"]+)"/.exec(readFileSync(CLIENT, 'utf8'))?.[1] ?? null
claim(
  'the window header names the bundle version the bundle declares',
  declaredPanelVersion !== null && texts.includes(`adr-panel ${declaredPanelVersion}`),
  `declared=${declaredPanelVersion}; header chips=${JSON.stringify(texts.filter((text) => /^adr-panel /.test(text)))}`,
)
const versionParts = (value) => String(value).split('.').map(Number)
const declaredVersion = versionParts(declaredPanelVersion)
const packagedVersion = versionParts(packageVersion)
const versionAtLeast = (a, b) =>
  a.length === 3 && b.length === 3 && a.every(Number.isFinite) && b.every(Number.isFinite) &&
  (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2]))))
claim(
  'the declared bundle version is never behind the package version',
  versionAtLeast(declaredVersion, packagedVersion),
  `package=${packageVersion} declared=${declaredPanelVersion}`,
)
claim(
  'no glob pattern leaks into the chrome',
  !texts.some((text) => /\*\.(adr|spec)\.md/.test(text)),
  texts.find((text) => /\*\.(adr|spec)\.md/.test(text)),
)
claim(
  'zero counts are omitted from the summary',
  !texts.some((text) => /\b0 (decision|consent|spec)/.test(text)),
  texts.find((text) => /\b0 (decision|consent|spec)/.test(text)),
)
claim(
  'the legend groups state, force and record',
  ['state', 'in force by', 'record'].every((label) => texts.includes(label)),
  JSON.stringify(texts.filter((text) => ['state', 'in force by', 'record'].includes(text))),
)
claim(
  'the legend note explains the dashed pill',
  texts.includes('a dashed pill is derived from the corpus, not read from a file'),
  texts.find((text) => /dashed pill/.test(text)),
)

/**
 * Every pill carrying this exact text. The legend wraps each pill in a bare
 * `span` for its key, so a text match alone finds that wrapper first; a pill is
 * the node that carries `chipStyle`'s pill radius.
 */
const pills = (label) => nodes.filter((entry) => isPillNode(entry) && entry.text === label)
const isFilled = (style) => typeof style.background === 'string' && style.background !== 'transparent'
const backgroundOf = (node) => String((node === undefined || node.style === undefined ? {} : node.style).background)

const statePills = pills('in force')
claim('a state pill is drawn filled', statePills.length > 0 && statePills.every((node) => isFilled(node.style)), JSON.stringify(statePills.map((node) => node.style)))
claim(
  'the awaiting-a-human state is the warn tone, so it catches the eye',
  pills('awaiting a human').length > 0 && pills('awaiting a human').every((node) => /state-warn/.test(backgroundOf(node))),
  JSON.stringify(pills('awaiting a human').map((node) => node.style)),
)
const provenancePills = pills('agent-activated')
claim(
  'a provenance pill is outlined, not filled',
  provenancePills.length > 0 && provenancePills.every((node) => !isFilled(node.style)),
  JSON.stringify(provenancePills.map((node) => node.style)),
)
claim(
  'the author label never repeats itself',
  !texts.includes('human · human') && !texts.includes('agent · agent'),
  texts.find((text) => text === 'human · human' || text === 'agent · agent'),
)

// The law cards live in the Specs part; the rows are only drawn there.
await showSection(first.root, 'root', 'specs')
const decidedIn = nodes.filter((node) => node.tag === 'span' && /^decided in /.test(node.text))
claim('a law card names its deciding record', decidedIn.length > 0, `chips=${decidedIn.length}`)
const knownChip = decidedIn.find((node) => node.text === 'decided in 0001')
claim(
  'a decided-in chip takes its decision in-force tone',
  knownChip !== undefined && /state-success/.test(backgroundOf(knownChip)),
  JSON.stringify(knownChip === undefined ? null : knownChip.style),
)

// ── a compact law row expands, and a truncated statement is not a wall of prose ──
// The spec view used to draw every law's full statement and every check at once. A
// collapsed row now shows a clipped statement, chips for its check KINDS, and the
// `decided in` chip; the full statement and each check's type/target are on expand.
// The expected values come from the generated document the ratchet served, read with the
// same `## law` / `- checks` shape the compiler writes, so the claim is about the ROW and
// not about a re-implementation of the parser.
const specDoc = stateModule.deriveDecisions({ root: KIT }).specs[0] ?? null
const specBlocks = String(specDoc?.text ?? '')
  .split(/\n## /)
  .slice(1)
  .map((block) => ({ lines: block.split('\n'), id: block.split('\n')[0].trim() }))
const firstBlock = specBlocks[0] ?? null
const firstLaw = firstBlock === null
  ? null
  : {
      id: firstBlock.id,
      statement: firstBlock.lines
        .slice(1)
        .find((line) => line.trim() !== '' && !/^\s*-/.test(line))
        ?.trim() ?? '',
      checks: firstBlock.lines
        .filter((line) => /^\s+- [A-Za-z0-9_]+:/.test(line))
        .map((line) => line.replace(/^\s+- [A-Za-z0-9_]+:\s*/, '').trim()),
    }
const statementNodes = nodes.filter((node) => node.tag === 'div' && typeof node.props?.title === 'string' && node.props.title === firstLaw?.statement)
claim(
  'a collapsed law row shows its statement on one clipped line',
  firstLaw !== null && statementNodes.length > 0 &&
    statementNodes.every((node) => node.style.whiteSpace === 'nowrap' && node.style.textOverflow === 'ellipsis') &&
    statementNodes.every((node) => node.text.length <= 121 && firstLaw.statement.startsWith(node.text.replace(/…$/, ''))),
  JSON.stringify(statementNodes.map((node) => ({ text: node.text.slice(0, 60), style: node.style }))),
)
const lawKindChips = nodes.filter((node) => isPillNode(node) && /^[A-Za-z0-9_]+ × \d+$/.test(node.text))
claim(
  'a collapsed law row states its check kinds with counts',
  lawKindChips.length > 0,
  JSON.stringify(lawKindChips.map((node) => node.text).slice(0, 8)),
)
{
  const fullStatement = firstLaw?.statement
  const lawHead = firstLaw === null ? undefined : nodes.find(
    (node) => node.tag === 'div' && node.props !== undefined && node.props['aria-expanded'] === 'false' &&
      typeof node.text === 'string' && node.text.includes(String(firstLaw.id)),
  )
  if (lawHead !== undefined) lawHead.props.onClick()
  await flush(first.root, 'root')
  const expandedStatement = nodes.filter((node) => node.tag === 'div' && node.props?.title === fullStatement)
  const expandedFull = expandedStatement.find((node) => node.style.whiteSpace !== 'nowrap')
  const checkRows = firstLaw === null
    ? []
    : firstLaw.checks.filter((check) => nodes.some((node) => typeof node.text === 'string' && node.text === String(check)))
  claim(
    'expanding a law row reveals the full statement and every check target',
    lawHead !== undefined && expandedFull !== undefined && checkRows.length === firstLaw.checks.length,
    `lawHead=${lawHead !== undefined} expandedFull=${expandedFull !== undefined} checks=${checkRows.length}/${firstLaw?.checks.length}`,
  )
  const unenforcedBlock = specBlocks.find((block) => block.lines.some((line) => /^- checks: none, and this law says why:/.test(line)))
  if (unenforcedBlock !== undefined) {
    const reasonLine = unenforcedBlock.lines.find((line) => /^- checks: none, and this law says why:/.test(line))
    const reason = reasonLine.replace(/^- checks: none, and this law says why:[ \t]*/, '').trim()
    const unenforcedHead = nodes.find(
      (node) => node.tag === 'div' && node.props !== undefined && node.props['aria-expanded'] === 'false' &&
        typeof node.text === 'string' && node.text.includes(String(unenforcedBlock.id)),
    )
    if (unenforcedHead !== undefined) unenforcedHead.props.onClick()
    await flush(first.root, 'root')
    claim(
      'a law with an `unenforced` note states the reason on expand',
      unenforcedHead !== undefined && reason !== '' &&
        nodes.some((node) => typeof node.text === 'string' && node.text.includes(reason)),
      `head=${unenforcedHead !== undefined} reason=${JSON.stringify(reason.slice(0, 60))} found=${JSON.stringify(nodes.filter((node) => typeof node.text === 'string' && /enforces this law/.test(node.text)).map((node) => node.text.slice(0, 60)).slice(0, 2))}`,
    )
  }
}

// ── the `1.` summary bug: a numbered Decision must not become its marker ────
//
// The reported bug: a Decision section written as an ordered list begins
// `1. **The fiction is adopted…**`, and the summary used to split on the marker's own
// period, so the row rendered the bare text `1.`. The fixture below is that shape, plus
// the two fallbacks (a Decision that is only a marker, and a Decision that is absent), so
// the claim is that a summary is never a marker and always the first real sentence.
{
  const numberedRecord = (id, text) => ({
    id,
    path: `docs/adrs/${id}-fixture.adr.md`,
    title: `fixture ${id}`,
    type: 'adr',
    status: 'active',
    authority: 'agent',
    authorName: 'fixture-author',
    created: '2026-09-15',
    source: { kind: 'file', path: 'docs/ratchet/sources/fixture.md', hash: `sha256:${'b'.repeat(64)}` },
    zones: [],
    supersedes: [],
    approves: [],
    laws: [],
    state: { text: 'in force', kind: 'in-force', derived: false },
    provenance: null,
    canRatify: false,
    text,
  })
  stateViewOverride = {
    ok: true,
    project: { decisionsDir: 'docs/adrs', specsDir: 'docs/specs', name: 'summary fixture' },
    specHash: null,
    records: [
      numberedRecord('7001', '---\nid: 7001\n---\n\n## Decision\n\n1. **The fiction is adopted as the working model.** It survives contact with the code.\n2. A second numbered point.\n'),
      numberedRecord('7002', '---\nid: 7002\n---\n\n## Decision\n\n1.\n'),
      numberedRecord('7003', '---\nid: 7003\n---\n\n## Context\n\nThe context paragraph carries the only prose this record has.\n'),
    ],
    queue: {},
    specs: [],
    drift: {},
    problems: [],
    needsHuman: [],
    truncated: null,
  }
  try {
    const rendered = await renderOverlay('summary-bug')
    const summaries = nodes
      .filter((node) => node.tag === 'div' && node.style !== undefined && node.style.whiteSpace === 'nowrap')
      .map((node) => node.text)
    claim(
      'a numbered Decision yields its real first sentence, not its list marker',
      rendered.ok && summaries.includes('The fiction is adopted as the working model.'),
      JSON.stringify(summaries),
    )
    claim(
      'no collapsed row summary is a bare list marker or punctuation',
      summaries.every((text) => /[A-Za-z0-9]/.test(text) && !/^\d+[.)]$/.test(text) && !/^[.\-*]+$/.test(text)),
      JSON.stringify(summaries),
    )
    claim(
      'a summary falls back to Context, and a marker-only Decision is skipped entirely',
      summaries.includes('The context paragraph carries the only prose this record has.') &&
        summaries.every((text) => text !== '1.'),
      JSON.stringify(summaries),
    )
    // One line: the row clips with nowrap/ellipsis, so a 140-character summary is a
    // single visual line rather than three wrapped ones.
    const clipped = nodes.filter((node) => node.tag === 'div' && node.style !== undefined && node.style.whiteSpace === 'nowrap')
    claim(
      'every collapsed summary is drawn as one clipped line',
      clipped.length >= 2 && clipped.every((node) => node.style.overflow === 'hidden' && node.style.textOverflow === 'ellipsis'),
      JSON.stringify(clipped.map((node) => node.style)),
    )
  } finally {
    stateViewOverride = null
  }
}

// ── synthetic corpus: states the real one does not hold ─────────────────────
const syntheticLaw = (id, decidedIn) => ({ id, authority: 'agent', decidedIn, statement: 'synthetic', checks: [] })
const synthetic = {
  decisions: [
    {
      id: '0002', path: 'synthetic/0002.adr.md', title: 'a superseded decision', type: 'adr',
      status: 'superseded', authority: 'agent', authorName: 'human', created: '2026-09-01',
      sourcePath: 'docs/ratchet/sources/x.md', sourceHash: 'abc12345', zones: [], supersedes: [], approves: [],
      laws: [], summary: '', sections: [], error: null,
      state: { text: 'superseded by 0009', kind: 'superseded', derived: true }, provenance: null, canRatify: false,
    },
    {
      id: '0017', path: 'synthetic/0017.adr.md', title: 'a decision awaiting a human', type: 'adr',
      status: 'proposed', authority: 'agent', authorName: 'deepseek-flash', created: '2026-09-15',
      sourcePath: 'docs/ratchet/sources/y.md', sourceHash: 'def67890', zones: ['zone-a'], supersedes: [], approves: [],
      laws: [], summary: 'awaiting a ratification', sections: [], error: null,
      state: { text: 'awaiting a human', kind: 'pending', derived: false }, provenance: null, canRatify: true,
    },
  ],
  consents: [],
  specs: [{
    name: 'spec', zone: 'zone-a', project: null, hash: 'deadbeef', eof: true, error: null,
    counts: { laws: 2, checks: 0 },
    laws: [syntheticLaw('L-super', '0002'), syntheticLaw('L-unknown', '9999')],
  }],
  relations: { approvedBy: {}, supersededBy: { '0002': ['0009'] } },
  lawsByDecision: { '0002': [{ law: syntheticLaw('L-super', '0002'), zone: 'zone-a' }] },
  decisionIds: { '0002': true, '0017': true },
  recordIds: { '0002': true, '0009': true },
  dirs: { decisionsDir: 'docs/adrs', specsDir: 'docs/specs' },
  projectName: 'synthetic project',
  notes: [],
  failures: [],
}
const second = await renderOverlay('synthetic', () => Promise.resolve(synthetic))
claim('the overlay renders a synthetic corpus', second.ok, second.ok ? undefined : second.error)
// The law cards are in the Specs part.
await showSection(second.root, 'synthetic', 'specs')
const syntheticChips = nodes.filter((node) => node.tag === 'span' && /^decided in /.test(node.text))
const supersededChip = syntheticChips.find((node) => node.text === 'decided in 0002')
const unknownChip = syntheticChips.find((node) => node.text === 'decided in 9999')
claim(
  'a decided-in chip follows a superseded decision into the muted tone',
  backgroundOf(supersededChip) === 'rgba(128,128,128,0.07)',
  JSON.stringify(supersededChip === undefined ? null : supersededChip.style),
)
claim(
  'a decided-in chip stays neutral for an id the corpus does not hold',
  backgroundOf(unknownChip) === 'rgba(128,128,128,0.10)',
  JSON.stringify(unknownChip === undefined ? null : unknownChip.style),
)
claim(
  'in force, superseded and unknown are three distinct chip tones',
  new Set([backgroundOf(knownChip), backgroundOf(supersededChip), backgroundOf(unknownChip)]).size === 3,
  [backgroundOf(knownChip), backgroundOf(supersededChip), backgroundOf(unknownChip)].join(' | '),
)

// ── the pills must be readable, not merely well-named ───────────────────────
// A pill's colour is a `var(--token, fallback)` string, so every structural
// assertion above passes even when the theme resolves that token to a value that
// hides the label. This resolves the rendered styles against the shell's own theme
// and requires each pill's text to contrast with the surface behind it.

/** Candidate roots that may hold the shell theme bundle, nearest first. */
function themeRoots() {
  const roots = []
  if (process.env.DSH_HOME) roots.push(join(process.env.DSH_HOME, 'profiles', 'web'), process.env.DSH_HOME)
  const dsh = dirname(dirname(process.execPath))
  roots.push(
    join(dsh, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules'),
    join(homedir(), '.npm', 'node', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules'),
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules',
  )
  // The global install that owns the `dsh` command, which is not necessarily the same
  // prefix as the interpreter running this script.
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '' || !existsSync(join(dir, 'dsh'))) continue
    const prefix = dirname(dir)
    roots.push(
      join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules'),
      join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules'),
    )
  }
  return roots
}

/** The shell theme bundle, or null when no harness installation carries one. */
function findTheme() {
  for (const root of themeRoots()) {
    for (const candidate of [join(root, 'node_modules'), root]) {
      const file = join(candidate, '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js')
      if (existsSync(file)) return file
    }
  }
  return null
}

/**
 * The `--token: value` declarations of one variant.
 *
 * The theme declares each variant under `body{…}` (light) and
 * `body[data-ds-dark-theme]{…}` (dark), and it emits several such blocks — one set
 * holding the `--dsw-static-*` palette and the next holding the `--dsw-alias-*`
 * layer that references it, then further complete themes. Blocks are read in order
 * and merging stops at the first one that carries the alias layer, so the map is
 * one coherent variant rather than a mix of several. Without this, reading only the
 * first block yields a map with no `--dsw-alias-*` tokens at all and the contrast
 * check measures nothing while still reporting the variants as found.
 */
function themeVariant(source, selector) {
  const vars = new Map()
  for (const match of source.matchAll(new RegExp(`${selector.replace(/[[\]]/g, '\\$&')}\\{`, 'g'))) {
    let depth = 0
    let index = source.indexOf('{', match.index)
    const open = index
    for (; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1
      else if (source[index] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    const body = source.slice(open + 1, index)
    for (const declaration of body.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
      if (!vars.has(declaration[1])) vars.set(declaration[1], declaration[2].trim())
    }
    if (vars.has('--dsw-alias-bg-base')) break
  }
  return vars.size === 0 ? null : vars
}

/** Resolves a `var(--a, var(--b, literal))` chain to its literal, or null. */
function resolveToken(expression, vars, depth = 0) {
  if (expression === undefined || depth > 16) return null
  const text = String(expression).trim()
  const match = /^var\(\s*(--dsw-[a-z0-9-]+)\s*(?:,\s*([\s\S]*))?\)$/.exec(text)
  if (match === null) return text
  const declared = vars.get(match[1])
  if (declared !== undefined) return resolveToken(declared, vars, depth + 1)
  return match[2] === undefined ? null : resolveToken(match[2], vars, depth + 1)
}

/** `[r, g, b, a]` for a hex or rgb()/rgba() value; null for anything else. */
function parseColour(text) {
  if (text === null || text === undefined) return null
  const value = String(text).trim()
  if (value === 'transparent') return [0, 0, 0, 0]
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value)
  if (hex !== null) {
    const digits = hex[1]
    const expand = (part) => parseInt(part.length === 1 ? part + part : part, 16)
    if (digits.length === 3) return [expand(digits[0]), expand(digits[1]), expand(digits[2]), 1]
    return [
      expand(digits.slice(0, 2)),
      expand(digits.slice(2, 4)),
      expand(digits.slice(4, 6)),
      digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1,
    ]
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value)
  if (rgb !== null) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number)
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return [parts[0], parts[1], parts[2], parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1]
    }
  }
  return null
}

/** `top` composited over an opaque `base`, both `[r, g, b, a]`. */
function over(top, base) {
  const alpha = top[3]
  return [top[0] * alpha + base[0] * (1 - alpha), top[1] * alpha + base[1] * (1 - alpha), top[2] * alpha + base[2] * (1 - alpha), 1]
}

/** WCAG relative luminance. */
function luminance(colour) {
  const channel = (value) => {
    const part = value / 255
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(colour[0]) + 0.7152 * channel(colour[1]) + 0.0722 * channel(colour[2])
}

/** WCAG contrast ratio, 1 for identical colours. */
function contrastRatio(a, b) {
  const one = luminance(a)
  const two = luminance(b)
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05)
}

/**
 * Below this a pill's label is effectively its own fill.
 *
 * The bar is deliberately far under the design system's own contrast rather than a
 * WCAG target: the light theme's tints measure about 2.1 by design (green-100 behind
 * green-500), and second-guessing the shell's palette is not this test's job. What it
 * catches is COLLAPSE — a pill filled with the very colour its text is drawn in, which
 * is what a `-secondary` background produced in the dark theme at a ratio of 1.00.
 */
const MINIMUM_CONTRAST = 1.5

/**
 * Resolves every colour-carrying control rendered so far — pills AND toned buttons —
 * through the installed theme, in both variants, and requires each one's text to
 * contrast with its own fill. Called after every render rather than where the helper
 * lives, because the window's Approve button and the pointer's Open button are rendered
 * later than the overlay.
 *
 * A missing theme is a `[SKIP]` line, never a pass: the check with nothing to resolve is
 * not a check that held.
 */
function checkColours() {
  const themeFile = findTheme()
  if (themeFile === null) {
    process.stdout.write('  [SKIP] every toned control is legible against its own fill — no installed shell theme to resolve against\n')
    return
  }
  const themeSource = readFileSync(themeFile, 'utf8')
  const variants = { light: themeVariant(themeSource, 'body'), dark: themeVariant(themeSource, 'body[data-ds-dark-theme]') }
  const unresolved = []
  const inherited = []
  const measured = []
  for (const [variant, vars] of Object.entries(variants)) {
    if (vars === null) continue
    const surface = parseColour(resolveToken(vars.get('--dsw-specific-menu'), vars))
    if (surface === null) continue
    for (const control of renderedControls) {
      // A plain chip sets neither: it inherits the surrounding text colour on the card,
      // so there is no pair to compare and claiming one would be measuring nothing.
      if (control.style.color === undefined && control.style.background === undefined) {
        inherited.push(`${variant}:${control.text}`)
        continue
      }
      const foreground = parseColour(resolveToken(control.style.color, vars))
      const background = parseColour(resolveToken(control.style.background, vars))
      if (foreground === null || background === null) {
        unresolved.push(`${variant}:${control.kind}:${control.text}`)
        continue
      }
      measured.push({ variant, kind: control.kind, text: control.text, ratio: contrastRatio(foreground, over(background, surface)) })
    }
  }
  const worst = measured.reduce((low, entry) => (low === null || entry.ratio < low.ratio ? entry : low), null)
  const failing = measured.filter((entry) => entry.ratio < MINIMUM_CONTRAST)
  const named = (entry) => `${entry.variant} ${entry.kind} "${entry.text}" ${entry.ratio.toFixed(2)}`
  claim(
    `no toned control is filled with its own text colour (contrast >= ${MINIMUM_CONTRAST})`,
    measured.length > 0 && failing.length === 0,
    failing.length > 0
      ? failing.map(named).join(' | ')
      : `worst ${worst === null ? 'n/a' : named(worst)} of ${measured.length} toned control(s), ${inherited.length} plain chip(s) inherit their colour`,
  )
  claim(
    'every toned control colour resolved through the theme',
    unresolved.length === 0,
    `${unresolved.length} unresolvable: ${unresolved.slice(0, 6).join(', ')}`,
  )
  claim(
    'the colour check measured at least one button, not only pills',
    measured.some((entry) => entry.kind === 'button'),
    JSON.stringify(measured.reduce((counts, entry) => Object.assign(counts, { [entry.kind]: (counts[entry.kind] ?? 0) + 1 }), {})),
  )
}

// ── the ratification claim: the composer seat and its two answers ───────────
//
// The panel presents the ratchet's own question, so the strongest test available is the
// real question: `buildQuiz` is imported from the ratchet and its output is fed to the
// bundle's own claim predicate. Nothing here restates the question's shape, so drift in
// either half — a renamed intent kind, a third option, a lost approve label — fails this
// test rather than shipping a claim that quietly eats an answer the human was owed. The
// answers the panel sends are then run back through the ratchet's own `deriveDecisions`,
// which is what makes "same effect as the chat quiz" a measurement instead of a hope.

const ratifySource = await import(pathToFileURL(join(KIT, 'plugins', 'ratchet', 'ratchet-ratify.mjs')).href)
const { buildQuiz, deriveDecisions, RATIFY_INTENT_KIND } = ratifySource

const composerRegistration = registry['conversation.composer']
claim(
  'apply claims the composer seat BELOW the entry that claims every question',
  composerRegistration !== undefined &&
    typeof composerRegistration.config.select === 'function' &&
    // The chain is tried in ASCENDING priority, lower first, and the entry that owns the
    // seat claims every pending question at the default 0. So a claim at 0 or above is
    // never reached: it parses, its `select` is correct, and it is dead code. That is not
    // hypothetical — this assertion read `> 0` while the bundle registered at 1, and
    // driving the real SlotCore showed `user-questions@0` elected over `adr-panel@1` for a
    // ratify question, so the chat quiz the operator had asked to replace was still the
    // thing that rendered.
    composerRegistration.config.priority < 0,
  composerRegistration === undefined
    ? 'no registration'
    : JSON.stringify({ priority: composerRegistration.config.priority, select: typeof composerRegistration.config.select }),
)
if (composerRegistration === undefined) {
  process.stderr.write(`adr panel render FAILED\n  the composer seat is not claimed, so nothing below can be measured\n`)
  process.exit(1)
}

const quiz = buildQuiz(
  [
    {
      id: '0015',
      title: 'A decision that waits for a human',
      laws: [{ id: 'kit-tooling.a-proposed-decision', op: 'add' }],
      text: '---\nid: 0015\n---\n\n## Reasoning\n\nbecause the measurement said so.\n',
    },
  ],
  { attempt: 1 },
)
const ratifyQuestion = quiz.questions[0]
// Never `options[0]`/`options[1]`: the panel keys approve on `intent.approve`, so the
// ratchet is free to order the two options either way and a test that assumed the order
// would fail on a behaviour-preserving change while passing on a real defect.
const approveLabel = ratifyQuestion.intent.approve
const declineLabel = ratifyQuestion.options.find((option) => option.label !== approveLabel).label
const answerCalls = []
const cancellations = []
const pendingRatify = {
  questions: quiz.questions,
  answer(batch) {
    answerCalls.push(batch)
    return Promise.resolve()
  },
  cancel() {
    cancellations.push(true)
    return Promise.resolve()
  },
}
/** A deep copy of the real question list, so a variant never edits the shared one. */
const variantQuestions = () => JSON.parse(JSON.stringify(quiz.questions))

const select = composerRegistration.config.select
claim(
  'the claim takes the ratchet\'s own question',
  select({ pendingInteraction: pendingRatify }) === pendingRatify,
  JSON.stringify(ratifyQuestion.intent),
)
claim(
  'the intent kind the panel matches is the one the ratchet sends',
  ratifyQuestion.intent.kind === RATIFY_INTENT_KIND,
  `ratchet=${RATIFY_INTENT_KIND} question=${JSON.stringify(ratifyQuestion.intent)}`,
)

// Every shape this predicate must refuse, each built from the real question so a variant
// can only differ in the one property it is named for.
const refused = [
  ['no interaction at all', {}],
  ['a null interaction', { pendingInteraction: null }],
  ['a foreign intent kind', { pendingInteraction: { ...pendingRatify, questions: variantQuestions().map((item) => ({ ...item, intent: { ...item.intent, kind: 'something-else' } })) } }],
  ['two questions in one batch', { pendingInteraction: { ...pendingRatify, questions: [...variantQuestions(), ...variantQuestions()] } }],
  ['a lost detail', { pendingInteraction: { ...pendingRatify, questions: variantQuestions().map(({ detail, ...rest }) => rest) } }],
  ['a multi-select', { pendingInteraction: { ...pendingRatify, questions: variantQuestions().map((item) => ({ ...item, multiSelect: true })) } }],
  ['a third option', { pendingInteraction: { ...pendingRatify, questions: variantQuestions().map((item) => ({ ...item, options: [...item.options, { label: 'Maybe', description: '' }] })) } }],
  ['a missing targetId', { pendingInteraction: { ...pendingRatify, questions: variantQuestions().map((item) => ({ ...item, intent: { kind: item.intent.kind, approve: item.intent.approve } })) } }],
  ['a renamed approve label', { pendingInteraction: { ...pendingRatify, questions: variantQuestions().map((item) => ({ ...item, options: item.options.map((option) => ({ ...option, label: option.label === item.intent.approve ? 'Yes please' : option.label })) })) } }],
  ['no callable answer', { pendingInteraction: { questions: variantQuestions() } }],
]
const wronglyAccepted = refused.filter(([, props]) => select(props) !== null).map(([name]) => name)
claim(
  'the claim refuses every question it cannot answer completely',
  wronglyAccepted.length === 0,
  wronglyAccepted.length === 0 ? `refused ${refused.length} shapes` : `accepted: ${wronglyAccepted.join(', ')}`,
)
claim(
  'the refusal table is not empty, so the assertion above measured something',
  refused.length >= 9,
  `${refused.length} shapes`,
)

// ── the seat is actually won, driven through the real slot core ─────────────
//
// The assertion above is an inequality against a constant, and an inequality is not an
// election: it is a claim about a rule the kit does not own. Where the harness's slot core
// can be found, the real thing runs — the panel's own captured `priority` and `select`
// against a synthetic entry that claims every question the way the seat's owner does — and
// the winner is read off the real `entriesOfSlot` order. Without the checkout this is a
// `[SKIP]` with the reason, never a silent pass.
function findSlotCore() {
  const candidates = [
    process.env.HARNESS_DIR === undefined ? null : join(process.env.HARNESS_DIR, 'packages', 'client', 'ui-slots', 'src', 'index.ts'),
    join(homedir(), 'deepseek-harness', 'packages', 'client', 'ui-slots', 'src', 'index.ts'),
  ].filter((entry) => entry !== null)
  return candidates.find((entry) => existsSync(entry)) ?? null
}

const slotCoreSource = findSlotCore()
if (slotCoreSource === null) {
  process.stdout.write(
    '  [SKIP] the panel wins the composer seat in a real election — no ui-slots source found; set HARNESS_DIR to a harness checkout\n',
  )
} else {
  try {
    const { SlotCore } = await import(pathToFileURL(slotCoreSource).href)
    const ownerEntry = (owner) => (owner.pendingInteraction === undefined ? null : owner.pendingInteraction)
    const race = (panelPriority) => {
      const core = new SlotCore()
      core.record('conversation.composer').spec = { kind: 'chain', scope: 'root' }
      // The seat's owner, as it really registers: no priority (so 0), claims everything.
      core.register({ name: 'conversation.composer', priority: 0, select: ownerEntry, registrant: 'owner-entry' }, null)
      core.register(
        {
          name: 'conversation.composer',
          priority: panelPriority,
          select: composerRegistration.config.select,
          registrant: 'adr-panel',
        },
        null,
      )
      return core.entriesOfSlot('conversation.composer')
    }
    const elect = (entries, ownerProps) => {
      for (const entry of entries) {
        let matched
        try {
          matched = entry.select(ownerProps)
        } catch {
          continue
        }
        if (matched !== null) return entry.registrant
      }
      return null
    }
    // The two interaction kinds the seat carries for these entries: the ratchet's real
    // question, and one the panel must decline so the owner keeps the seat.
    const withRatify = { sessionId: 's', session: {}, pendingInteraction: pendingRatify }
    const withForeign = { sessionId: 's', session: {}, pendingInteraction: { questions: [{ id: 'q' }], answer() {} } }

    const asShipped = elect(race(composerRegistration.config.priority), withRatify)
    claim(
      'the panel wins a real chain election for the ratchet\'s question',
      asShipped === 'adr-panel',
      `elected=${String(asShipped)} at priority ${composerRegistration.config.priority}`,
    )
    // The counterfactual, measured: the priority this bundle used to declare loses the seat
    // to the entry that claims every question. If this ever stops being true the ordering
    // rule has changed and the comment above the registration needs rewriting.
    const atOne = elect(race(1), withRatify)
    claim(
      'a claim at priority 1 loses the seat to the entry that claims every question',
      atOne === 'owner-entry',
      `elected=${String(atOne)}`,
    )
    claim(
      'the panel declines a question it does not recognise, leaving the seat to the owner',
      elect(race(composerRegistration.config.priority), withForeign) === 'owner-entry',
      `elected=${String(elect(race(composerRegistration.config.priority), withForeign))}`,
    )
  } catch (error) {
    process.stdout.write(`  [SKIP] the panel wins the composer seat in a real election — could not drive ${slotCoreSource}: ${String(error)}\n`)
  }
}

// ── the seat renders a pointer, never the question ──────────────────────────
//
// The requirement this pins: an agent's decision is answered in the ADR panel, so the
// Conversation must not grow a quiz. The seat claims the question in order to SUPPRESS
// the harness's own card, and what it renders there is a pointer — the decision's name
// and a way into the panel. The question's text, its record text and its answer labels
// must not appear in the Conversation at all.
const composerMembers = composerRegistration.config.inject()
const openCalls = []
const composerElement = React.createElement(composerRegistration.Component, {
  matched: pendingRatify,
  publishRatify: composerMembers.publishRatify,
  openPanel: (sessionId) => openCalls.push(sessionId),
  sessionId: 'stub-session',
})
await flush(composerElement, 'ratify-seat')
collectControls()
const seatNodes = nodes.slice()
const seatTexts = seatNodes.map((node) => node.text)
const seatButtons = seatNodes.filter((node) => node.tag === 'button')

// Everything the question owns must be absent — as a SUBSTRING, on ANY host element, and
// for a PREFIX of the record text as well as the whole of it. Stated that way because a
// breaker defeated the earlier version, which matched whole strings on `<button>` nodes
// only: rendering `claim.approve.label` into a plain `div`, or into an `<a onClick>` that
// called `pending.answer(...)`, passed every assertion while putting the answer — and the
// ability to send it — back into the Conversation. The seat is forbidden the answer, so the
// check has to be about the answer's presence anywhere, not about the tag it arrived in.
// The needles: both labels, the question, the record text, and a SHORT prefix of it — a guard
// that only matched the whole text let `detail.slice(0, 12)` through.
const forbiddenHere = [
  ['an answer label', [approveLabel, declineLabel]],
  ['the question', [ratifyQuestion.question]],
  ['the record text', [ratifyQuestion.detail, ratifyQuestion.detail.slice(0, 8)]],
]
const allNeedles = forbiddenHere.flatMap(([, needles]) => needles).filter((needle) => typeof needle === 'string' && needle !== '')

// Every string a browser can render, wherever it is carried: text, ANY string-valued prop (not a
// hand-written list — an `aria-description` or a `data-label` was outside one), and the one prop
// that is markup rather than text.
const NON_TEXT_PROPS = new Set(['style', 'children', 'type', 'key', 'ref', 'className'])
const leaked = []
for (const node of seatNodes) {
  for (const needle of allNeedles) {
    if (typeof node.text === 'string' && node.text.includes(needle)) {
      leaked.push(`text in <${node.tag}> ${JSON.stringify(needle.slice(0, 24))}`)
    }
  }
  const props = node.props === undefined ? {} : node.props
  for (const [key, value] of Object.entries(props)) {
    if (NON_TEXT_PROPS.has(key)) continue
    if (key === 'dangerouslySetInnerHTML') {
      const html = value === null || value === undefined ? '' : String(value.__html === undefined ? '' : value.__html)
      for (const needle of allNeedles) {
        if (html.includes(needle)) leaked.push(`dangerouslySetInnerHTML ${JSON.stringify(needle.slice(0, 24))}`)
      }
      continue
    }
    if (typeof value !== 'string') continue
    for (const needle of allNeedles) {
      if (value.includes(needle)) leaked.push(`${key}=${JSON.stringify(value.slice(0, 32))}`)
    }
  }
}
claim(
  'the seat puts nothing the question owns in the Conversation, in text or in any attribute',
  leaked.length === 0,
  leaked.length === 0
    ? `checked ${allNeedles.length} strings over ${seatNodes.length} nodes, every string prop and dangerouslySetInnerHTML`
    : leaked.join(' | '),
)
claim(
  'the only action the seat offers is the pointer into the panel',
  seatButtons.length > 0 && seatButtons.every((node) => node.text === 'Open the ADRs panel'),
  JSON.stringify(seatButtons.map((node) => node.text)),
)
const openButton = seatButtons.find((node) => node.text === 'Open the ADRs panel')
claim(
  'the seat names the decision and points at the panel',
  openButton !== undefined && seatTexts.includes(ratifyQuestion.header),
  JSON.stringify(seatTexts.filter((text) => text !== '')),
)
if (openButton !== undefined) openButton.props.onClick()
claim(
  'the pointer opens the window on its Session',
  openCalls.length === 1 && openCalls[0] === 'stub-session',
  JSON.stringify(openCalls),
)

// And the decisive one, independent of tags, text, attributes and markup: NO handler in the seat
// can settle the question. `onClick` alone was the first version's hole — an `onMouseDown` that
// answered passed it — so every handler a host element can carry is invoked. The pointer's own
// opener may run; it must not answer.
const HANDLER_PROPS = [
  'onClick', 'onMouseDown', 'onMouseUp', 'onPointerDown', 'onPointerUp', 'onPointerMove',
  'onKeyDown', 'onKeyUp', 'onKeyPress', 'onSubmit', 'onChange', 'onInput', 'onFocus',
  'onTouchStart', 'onTouchEnd', 'onContextMenu', 'onDoubleClick',
]
const answersBefore = answerCalls.length
const cancelsBefore = cancellations.length
let handlersInvoked = 0
for (const node of seatNodes) {
  const props = node.props === undefined ? {} : node.props
  for (const name of HANDLER_PROPS) {
    if (typeof props[name] !== 'function') continue
    handlersInvoked += 1
    try {
      props[name]({ preventDefault() {}, stopPropagation() {}, nativeEvent: {} })
    } catch {
      // A handler that throws changed no state; the assertion below is about settlement.
    }
  }
}
claim(
  'no handler in the seat can settle the ratification question',
  answerCalls.length === answersBefore && cancellations.length === cancelsBefore,
  `answers=${answerCalls.length - answersBefore} cancels=${cancellations.length - cancelsBefore} over ${handlersInvoked} handler(s)`,
)

// ── the window is the only place the question is put ────────────────────────
const overlayMembers = registry['shell.overlay'].config.inject()
const panelStore = overlayMembers.hooks.panel
claim(
  'the seat hands the claimed question to the panel window',
  panelStore.getSnapshot().ratify === pendingRatify,
  panelStore.getSnapshot().ratify === null ? 'null' : 'an interaction',
)

/** Renders the window against the shared store, on its own hook path. */
async function renderWindow(prefix) {
  try {
    const root = React.createElement(
      registry['shell.overlay'].Component,
      Object.assign({}, overlayMembers, { usePanel: (selector) => selector(panelStore.getSnapshot()) }),
    )
    await flush(root, prefix)
    collectControls()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

const approveWindow = await renderWindow('ratify-approve')
const approveButtons = nodes.filter((node) => node.tag === 'button')
claim(
  'the window puts the question, its record text and both of its own labels',
  approveWindow.ok &&
    nodes.map((node) => node.text).includes(ratifyQuestion.question) &&
    nodes.map((node) => node.text).includes(ratifyQuestion.detail) &&
    [approveLabel, declineLabel].every((label) =>
      approveButtons.some((node) => node.text === label),
    ),
  approveWindow.ok ? JSON.stringify(approveButtons.map((node) => node.text)) : approveWindow.error,
)
const windowApprove = approveButtons.find((node) => node.text === approveLabel)
if (windowApprove !== undefined) windowApprove.props.onClick()
claim(
  'a click in the window sends that option\'s own label as the whole answer batch',
  JSON.stringify(answerCalls) ===
    JSON.stringify([{ answers: [{ id: ratifyQuestion.id, selected: [approveLabel] }] }]),
  JSON.stringify(answerCalls),
)
const approveDerived = deriveDecisions(quiz, answerCalls[0])
claim(
  'the ratchet reads the window\'s approve click as an approval, not an unreadable answer',
  approveDerived.decisions.length === 1 &&
    approveDerived.decisions[0].decision === 'approved' &&
    approveDerived.unreadable.length === 0,
  JSON.stringify(approveDerived),
)

const declineWindow = await renderWindow('ratify-decline')
const windowDecline = declineWindow.ok
  ? nodes.filter((node) => node.tag === 'button').find((node) => node.text === declineLabel)
  : undefined
if (windowDecline !== undefined) windowDecline.props.onClick()
claim(
  'a decline click in the window sends the rejection label as the whole batch, with no extra key',
  JSON.stringify(answerCalls) ===
    JSON.stringify([
      { answers: [{ id: ratifyQuestion.id, selected: [approveLabel] }] },
      { answers: [{ id: ratifyQuestion.id, selected: [declineLabel] }] },
    ]),
  JSON.stringify(answerCalls),
)
const declineDerived = deriveDecisions(quiz, answerCalls[1])
claim(
  'the ratchet reads the window\'s decline click as a rejection',
  declineDerived.decisions.length === 1 &&
    declineDerived.decisions[0].decision === 'rejected' &&
    declineDerived.unreadable.length === 0,
  JSON.stringify(declineDerived),
)

const notNowWindow = await renderWindow('ratify-notnow')
const notNow = notNowWindow.ok ? nodes.filter((node) => node.tag === 'button').find((node) => node.text === 'Not now') : undefined
if (notNow !== undefined) notNow.props.onClick()
claim(
  'Not now leaves the question unanswered instead of answering it',
  cancellations.length === 1 && answerCalls.length === 2,
  `cancels=${cancellations.length} answers=${answerCalls.length}`,
)


// ── a row's Approve and Decline record through the host route ───────────────
//
// The requirement, in the operator's words: "clicking Approve or Decline in the panel must
// record the decision silently — no chat message, no agent in the loop". The bundle's half
// of that is measured here by driving the REAL component against a stub host: what it asks
// for, what it renders, what it sends back, and that it never touches the composer.
//
// The stub host answers with a quiz built by the ratchet's own `buildQuiz`, so the labels
// the row sends are the ratchet's labels rather than this file's idea of them, and the quiz
// it echoes back is deep-compared with the object it was given. The host's own behaviour —
// refusing a composed payload, the stale check, the actual write — is the probe's
// measurement against the real modules and a real HTTP server, not this stub's.

const overlayForRows = registry['shell.overlay'].config.inject()
panelStore.set({ ratify: null })
// The composer is the one surface a panel ratification must NOT use any more. This spy is
// wired to the only prop that could carry a composer message — the Session-header action's
// `inputActions` — and the whole flow below runs with it in place, so "no chat message is
// composed" is measured from the render rather than read from the source.
const composerCalls = []
const inputActionsSpy = {
  setDraft(text) { composerCalls.push(['setDraft', String(text)]) },
  submit() { composerCalls.push(['submit']) },
}

/** Renders the window over the SYNTHETIC corpus and returns its buttons. */
const renderRows = async (tag) => {
  await flush(
    React.createElement(
      registry['shell.overlay'].Component,
      Object.assign({}, overlayForRows, {
        usePanel: (selector) => selector(panelStore.getSnapshot()),
        load: () => Promise.resolve(synthetic),
      }),
    ),
    tag,
  )
  collectControls()
  return nodes.filter((node) => node.tag === 'button')
}

/** Renders the window once more after an asynchronous click has had time to travel. */
const settleRender = (tag) =>
  flush(
    React.createElement(
      registry['shell.overlay'].Component,
      Object.assign({}, overlayForRows, {
        usePanel: (selector) => selector(panelStore.getSnapshot()),
        load: () => Promise.resolve(synthetic),
      }),
    ),
    // The SAME prefix as the render that was clicked: the stub renderer keys component
    // instances by their path, so a different prefix is a fresh instance with fresh state —
    // which would measure a component that had never been clicked.
    tag,
  )

/** The ratchet's own question for one synthetic record, built by the ratchet's builder. */
const rowQuiz = (id) =>
  buildQuiz(
    [
      {
        id,
        title: 'a decision awaiting a human',
        laws: [{ id: 'zone-a.one', op: 'upsert' }],
        text: `---\nid: ${id}\n---\n\n## Decision\n\nsynthetic\n`,
      },
    ],
    { attempt: 1 },
  )

/** One ask result, as the host route would return it: the quiz and nothing written. */
const askBody = (adrId, built) => ({ ok: false, needsAnswer: true, attempt: 1, quiz: built, pending: [{ id: adrId }], blocked: [], problems: [] })

const idleButtons = await renderRows('consent-row-idle')
const idleLabels = [...new Set(idleButtons.map((node) => node.text))]
claim(
  'a ratifiable decision offers Approve and Decline on its own row',
  idleLabels.includes('Approve') && idleLabels.includes('Decline'),
  JSON.stringify(idleLabels),
)
claim(
  'and no row asks the human to go and answer a quiz somewhere else',
  !idleLabels.includes('Ratify…'),
  JSON.stringify(idleLabels),
)

// ── the approve click, end to end against the stub host ─────────────────────
const approveQuiz = rowQuiz('0017')
const approveLabelOf = approveQuiz.roles['ratify-0017'].approveLabel
const declineLabelOf = approveQuiz.roles['ratify-0017'].rejectLabel
const callsFrom = (from) => consentCalls.slice(from)
consentHostHandler = () => ({ status: 200, body: askBody('0017', approveQuiz) })

const beforeApprove = consentCalls.length
const approveRowButtons = await renderRows('consent-row-approve')
const rowApprove = approveRowButtons.find((node) => node.text === 'Approve')
if (rowApprove !== undefined) rowApprove.props.onClick()
await new Promise((resolveTick) => setTimeout(resolveTick, 20))
await settleRender('consent-row-approve')
const approveCalls = callsFrom(beforeApprove)
claim(
  "an Approve click asks the host route for the ratchet's own question about THAT record",
  approveCalls.length >= 1 &&
    approveCalls[0].method === 'GET' &&
    approveCalls[0].url.includes('/adr-panel/consent') &&
    approveCalls[0].url.includes('id=0017') &&
    approveCalls[0].url.includes('session=') &&
    approveCalls[0].headers['x-adr-panel-consent'] === globalThis.__DSH_ADR_PANEL_CONSENT__.token,
  JSON.stringify(approveCalls[0] === undefined ? null : { url: approveCalls[0].url, method: approveCalls[0].method, headers: approveCalls[0].headers }),
)
claim(
  "the panel sends the ratchet's own approve label, paired with the question it came from",
  approveCalls.length === 2 &&
    approveCalls[1].method === 'POST' &&
    approveCalls[1].body !== null &&
    approveCalls[1].body.adrId === '0017' &&
    approveCalls[1].body.label === approveLabelOf &&
    typeof approveCalls[1].body.session === 'string' &&
    JSON.stringify(approveCalls[1].body.quiz) === JSON.stringify(approveQuiz),
  JSON.stringify(approveCalls[1] === undefined ? null : { adrId: approveCalls[1].body === null ? null : approveCalls[1].body.adrId, label: approveCalls[1].body === null ? null : approveCalls[1].body.label, quizMatches: approveCalls[1].body !== null && JSON.stringify(approveCalls[1].body.quiz) === JSON.stringify(approveQuiz) }),
)
// What that request MEANS to the ratchet, measured with the ratchet's own reader: the label
// the panel sent must derive as an approval rather than as an unreadable answer.
const rowApproveDerived = deriveDecisions(approveQuiz, { answers: [{ id: 'ratify-0017', selected: [approveCalls[1].body.label] }] })
claim(
  "the ratchet reads the row's approve click as an approval, not an unreadable answer",
  rowApproveDerived.decisions.length === 1 && rowApproveDerived.decisions[0].decision === 'approved' && rowApproveDerived.unreadable.length === 0,
  JSON.stringify(rowApproveDerived),
)

// Decline routes the OTHER label, which a test that only clicked Approve could not tell.
consentHostHandler = () => ({ status: 200, body: askBody('0017', approveQuiz) })
const beforeDecline = consentCalls.length
const declineRowButtons = await renderRows('consent-row-decline')
const rowDecline = declineRowButtons.find((node) => node.text === 'Decline')
if (rowDecline !== undefined) rowDecline.props.onClick()
await new Promise((resolveTick) => setTimeout(resolveTick, 20))
await settleRender('consent-row-decline')
const declineCalls = callsFrom(beforeDecline)
claim(
  "a Decline click sends the ratchet's own reject label with the same question",
  declineCalls.length === 2 &&
    declineCalls[1].body !== null &&
    declineCalls[1].body.label === declineLabelOf &&
    declineCalls[1].body.adrId === '0017' &&
    JSON.stringify(declineCalls[1].body.quiz) === JSON.stringify(approveQuiz),
  JSON.stringify(declineCalls[1] === undefined ? null : { label: declineCalls[1].body === null ? null : declineCalls[1].body.label, expected: declineLabelOf }),
)
const rowDeclineDerived = deriveDecisions(approveQuiz, { answers: [{ id: 'ratify-0017', selected: [declineCalls[1].body.label] }] })
claim(
  "the ratchet reads the row's decline click as a rejection",
  rowDeclineDerived.decisions.length === 1 && rowDeclineDerived.decisions[0].decision === 'rejected' && rowDeclineDerived.unreadable.length === 0,
  JSON.stringify(rowDeclineDerived),
)

// ── the row shows the question, the record text, the labels and the outcome ──
//
// Nothing may be recorded invisibly. While the answer is in flight the ratchet's own
// question is on screen — its header, its text, the record's own bytes and BOTH labels —
// and afterwards the outcome says what was written, or why nothing was.
const questionQuiz = rowQuiz('0017')
const questionHeader = questionQuiz.questions[0].header
const questionText = questionQuiz.questions[0].question
const questionDetail = questionQuiz.questions[0].detail
// The first render's settle is held open until this promise is released, so the recording
// phase is on screen to be read; releasing it then completes with a written approval.
let releaseSettle = null
consentHostHandler = (call) => {
  if (call.method === 'GET') return { status: 200, body: askBody('0017', questionQuiz) }
  return new Promise((resolve) => {
    releaseSettle = () => resolve({ status: 200, body: { ok: true, ratified: ['0017'], rejected: [], unreadable: [], wrote: ['docs/ratchet/sources/2026-09-16-ratification-0017.md', 'docs/adrs/0029-ratify-adr-0017.adr.md'], approval: { id: '0029', path: 'docs/adrs/0029-ratify-adr-0017.adr.md', title: 'Ratify ADR 0017' }, transcript: { path: 'docs/ratchet/sources/2026-09-16-ratification-0017.md' }, problems: [] } })
  })
}
const shownButtons = await renderRows('consent-row-shown')
const shownApprove = shownButtons.find((node) => node.text === 'Approve')
if (shownApprove !== undefined) shownApprove.props.onClick()
await new Promise((resolveTick) => setTimeout(resolveTick, 20))
await settleRender('consent-row-shown')
const recordingTexts = nodes.map((node) => node.text)
claim(
  "the row puts the ratchet's question, the record's own text and both of its labels on screen",
  recordingTexts.includes(questionText) &&
    recordingTexts.includes(questionDetail) &&
    recordingTexts.includes(questionHeader) &&
    [approveLabelOf, declineLabelOf].every((label) => recordingTexts.includes(label)),
  JSON.stringify(recordingTexts.filter((text) => text === questionText || text === approveLabelOf || text === declineLabelOf || text === questionHeader)),
)
if (releaseSettle !== null) releaseSettle()
await new Promise((resolveTick) => setTimeout(resolveTick, 20))
await settleRender('consent-row-shown')
const doneTexts = nodes.map((node) => node.text)
claim(
  'and the outcome names the approval and its transcript, so nothing is recorded invisibly',
  doneTexts.some((text) => typeof text === 'string' && text.includes('Approved') && text.includes('docs/adrs/0029-ratify-adr-0017.adr.md') && text.includes('2026-09-16-ratification-0017.md')),
  JSON.stringify(doneTexts.filter((text) => typeof text === 'string' && text.includes('Approved'))),
)

// A decision the ratchet has no question for must be REPORTED and must send no answer: the
// click cannot silently turn into a confirmation of something that did not happen.
const refuseCalls = []
// The ratchet's refusal carries a problem with the code AND the message; the window must show
// the message, not only that something was refused, or the reader is sent to the CLI for the
// reason the window exists to give them.
const refuseProblemText = 'the record contradicts law "api.one" held by ADR 0001; a resolution is needed'
consentHostHandler = (call) => {
  refuseCalls.push(call)
  return { status: 200, body: { ok: false, nothingToRatify: true, message: 'ADR 0017 is not waiting for a human', problems: [{ code: 'RATIFICATION_UNPROVEN', message: refuseProblemText }], pending: [], blocked: [] } }
}
const refuseButtons = await renderRows('consent-row-refuse')
const refuseApprove = refuseButtons.find((node) => node.text === 'Approve')
if (refuseApprove !== undefined) refuseApprove.props.onClick()
await new Promise((resolveTick) => setTimeout(resolveTick, 20))
await settleRender('consent-row-refuse')
const refuseTexts = nodes.map((node) => node.text)
claim(
  'a decision the ratchet has no question for is reported, with the ratchet\'s own reason, and no answer is sent',
  refuseCalls.length === 1 &&
    refuseCalls[0].method === 'GET' &&
    refuseTexts.some((text) => typeof text === 'string' && text.includes('not waiting for a human')) &&
    refuseTexts.some((text) => typeof text === 'string' && text.includes(refuseProblemText)),
  JSON.stringify(refuseCalls.map((call) => call.method)),
)

// With no capability — the host half absent, or a page this process did not serve — the row
// names the CLI command instead of offering a button, and fetches nothing at all.
const savedBridge = globalThis.__DSH_ADR_PANEL_CONSENT__
delete globalThis.__DSH_ADR_PANEL_CONSENT__
const unavailableCalls = consentCalls.length
const unavailableButtons = await renderRows('consent-row-unavailable')
const unavailableTexts = nodes.map((node) => node.text)
claim(
  'with no capability the row names the CLI command instead of offering a button',
  !unavailableButtons.some((node) => node.text === 'Approve' || node.text === 'Decline') &&
    unavailableTexts.some((text) => typeof text === 'string' && text.includes('ratchet_ratify')),
  JSON.stringify(unavailableButtons.map((node) => node.text)),
)
claim(
  'and it fetches nothing at all in that state',
  consentCalls.length === unavailableCalls,
  `${consentCalls.length - unavailableCalls} unexpected request(s)`,
)
globalThis.__DSH_ADR_PANEL_CONSENT__ = savedBridge

// ── the composer is not part of a panel ratification any more ───────────────
//
// The whole reason this change exists: a click in the panel used to compose `/ratify <id>`
// into the Session, and the human waited for an agent to run the tool. The spy carries the
// only prop a composer message could travel through, and it is checked after every scenario
// above rather than after one.
claim(
  'no panel ratification composes a composer message, in any scenario driven above',
  composerCalls.length === 0,
  JSON.stringify(composerCalls),
)
// And the trigger itself, rendered the way the Session header renders it, must not use the
// composer either: it opens the window and does nothing else.
{
  const trigger = registry['conversation.session.header.actions']
  const triggerMembers = trigger.config.inject()
  await flush(
    React.createElement(trigger.Component, Object.assign({}, triggerMembers, {
      usePanel: (selector) => selector(panelStore.getSnapshot()),
      sessionId: 'stub-session',
      inputActions: inputActionsSpy,
    })),
    'consent-row-trigger',
  )
  const triggerButton = nodes.filter((node) => node.tag === 'button').find((node) => node.text === 'ADRs')
  if (triggerButton !== undefined) triggerButton.props.onClick()
  claim(
    'the Session-header trigger holds no composer capability and submits nothing',
    composerCalls.length === 0 && triggerMembers.publishAsk === undefined,
    `calls=${JSON.stringify(composerCalls)} publishAsk=${typeof triggerMembers.publishAsk}`,
  )
}

// ── a grilling session keeps the Conversation quiz ──────────────────────────
// The one exception, and the reason the ratchet has to say where a question is shown:
// a grill's question declares no panel intent, so nothing claims the seat, the harness
// renders its own card, and the question blocks the conversation until it is answered.
const chatQuiz = buildQuiz(
  [{ id: '0015', title: 'A grilling-session decision', laws: [], text: '---\nid: 0015\n---\n' }],
  { attempt: 1, present: 'chat' },
)
claim(
  'a grilling session\'s question carries no panel intent, so the seat leaves it alone',
  chatQuiz.questions[0].intent === undefined &&
    select({ pendingInteraction: { questions: chatQuiz.questions, answer() {} } }) === null,
  JSON.stringify(chatQuiz.questions[0].intent),
)
claim(
  'a panel question always carries the intent the seat matches',
  ratifyQuestion.intent !== undefined && ratifyQuestion.intent.kind === RATIFY_INTENT_KIND,
  JSON.stringify(ratifyQuestion.intent),
)
// The re-ask is a different question shape — its labels name the decision and its
// question id is `ratify-again-<id>` — and `buildQuiz` builds it with a non-empty
// `previous` list. The panel claims by the intent and the labels, not by the id, so it
// must claim this shape too; a claim that only matched attempt 1 would drop the human's
// second chance on the floor.
const reaskQuiz = buildQuiz(
  [{ id: '0015', title: 'A decision that waits for a human', laws: [], text: '---\nid: 0015\n---\n' }],
  { attempt: 2, previous: [{ id: '0015', reason: 'the answer was free text' }] },
)
claim(
  "the panel also claims the ratchet's re-ask shape (a non-empty `previous` list)",
  select({ pendingInteraction: { questions: reaskQuiz.questions, answer() {} } }) !== null,
  JSON.stringify(reaskQuiz.questions[0].intent),
)

// A question the seat does not claim must clear the window rather than leave a stale one.
await flush(
  React.createElement(composerRegistration.Component, {
    matched: { questions: [{ id: 'other', question: 'x', options: [{ label: 'a', description: '' }] }], answer() {} },
    publishRatify: composerMembers.publishRatify,
  }),
  'ratify-other',
)
claim(
  'a question the seat declines clears the window\'s ratification section',
  panelStore.getSnapshot().ratify === null,
  JSON.stringify(panelStore.getSnapshot().ratify),
)
// ── the panel reads and writes nothing of its own ───────────────────────────
// Every render above went through the recorded fetch stub, and this is a whole-plugin
// measurement, not a reading of the source: the only URLs the bundle ever requested are
// its host half's two routes, the state route is GET-only, and no request carries a body
// except the consent POST. The claim that no agent tool can reach either route is the
// cross-artifact half, enforced in `scripts/check-consent-surface.mjs`.
const requestedUrls = [...new Set(consentCalls.map((call) => call.url.replace(/[?].*$/, '')))].sort()
const stateRequests = consentCalls.filter((call) => call.url.includes('/adr-panel/state'))
const stateNonGet = stateRequests.filter((call) => call.method !== 'GET')
const offRoute = consentCalls.filter((call) => !call.url.includes('/adr-panel/state') && !call.url.includes('/adr-panel/consent'))
claim(
  'the whole render requests only the state route (GET) and the consent route',
  requestedUrls.length > 0 &&
    offRoute.length === 0 &&
    stateRequests.length > 0 &&
    stateNonGet.length === 0,
  `urls=${JSON.stringify(requestedUrls)} offRoute=${offRoute.length} stateRequests=${stateRequests.length} stateNonGet=${stateNonGet.length}`,
)

// ── the panel's rendered state agrees with the ratchet's ────────────────────
//
// The panel owns no force model any more: it fetches the ratchet's view model and renders
// it. These fixtures nevertheless run BOTH sides over one corpus and require them to
// agree record by record — the panel through the state route, whose stub calls the real
// `deriveDecisions`, and the host classification through the ratchet's own
// `resolveActiveSet` directly. If a future edit reintroduced a different rule on either
// side, the two would disagree here. Each of the first five is one divergence an
// independent review once measured; the sixth is the stale-hash consent that shares the
// consent map's rule.
const { parseAdr, parseRatchetConfig, hashSource } = await import(
  pathToFileURL(join(KIT, 'plugins', 'ratchet', 'ratchet-schema.mjs')).href
)
const { resolveActiveSet } = await import(pathToFileURL(join(KIT, 'plugins', 'ratchet', 'ratchet-compiler.mjs')).href)

/** A YAML list in block form by default, or an inline flow sequence when `flow`. */
const yamlList = (key, values, flow = false) => {
  if (flow) return [`${key}: [${values.map((value) => JSON.stringify(value)).join(', ')}]`]
  if (values.length === 0) return [`${key}: []`]
  return [`${key}:`, ...values.map((value) => `  - ${JSON.stringify(value)}`)]
}

/** The lines of a well-formed ratification block for the given targets. */
const ratificationLines = (targets, { channel = 'user-question' } = {}) => [
  'ratification:',
  `  channel: ${channel}`,
  "  at: '2026-09-15T00:00:00.000Z'",
  '  askedBy: fixture-session',
  '  targets:',
  ...targets.flatMap((target) => [
    `    - id: ${JSON.stringify(target.id)}`,
    `      contentHash: ${target.contentHash}`,
  ]),
]

/** One ADR file body, with the frontmatter shape the ratchet's parser requires. */
const fixtureAdr = (id, options = {}) => {
  const laws = options.laws ?? []
  const lines = [
    '---',
    `id: ${JSON.stringify(id)}`,
    `title: ${options.title ?? `fixture ${id}`}`,
    `type: ${options.type ?? 'adr'}`,
    `status: ${options.status ?? 'proposed'}`,
    'author:',
    `  authority: ${options.authority ?? 'agent'}`,
    '  name: fixture-author',
    'created: 2026-09-15',
    'source:',
    '  kind: file',
    `  path: ${options.sourcePath ?? 'docs/ratchet/sources/fixture.md'}`,
    `  hash: ${options.sourceHash ?? `sha256:${'0'.repeat(64)}`}`,
    ...yamlList('zones', options.zones ?? [], options.flowZones === true),
    ...yamlList('supersedes', options.supersedes ?? []),
    ...yamlList('approves', options.approves ?? []),
    ...(laws.length === 0
      ? ['laws: []']
      : [
          'laws:',
          ...laws.flatMap((law) => ['  - op: upsert', `    id: ${law.id}`, `    statement: ${law.statement}`, '    checks: []']),
        ]),
    ...(options.ratification === undefined || options.ratification === null ? [] : ratificationLines(options.ratification)),
    '---',
    '',
    '## Context',
    'fixture',
    '',
    '## Decision',
    options.body ?? 'fixture body',
    '',
    '## Reasoning',
    'a fixture decides a fixture',
    '',
    '## Consequences',
    'nothing outside the fixture changes',
    '',
  ]
  return lines.join('\n')
}

/** A manifest with one `enabled` ratchet section. */
const fixtureManifest = (zones, defaultAgentAuthority = undefined) =>
  JSON.stringify(
    {
      manifestVersion: 2,
      name: 'fixture-project',
      languages: [{ id: 'javascript', extensions: ['.mjs'], roots: ['src'] }],
      rules: [],
      verification: [],
      scopes: [],
      ratchet: {
        enabled: true,
        decisionsDir: 'docs/adrs',
        ...(defaultAgentAuthority === undefined ? {} : { defaultAgentAuthority }),
        zones,
      },
    },
    null,
    2,
  )

const ZONE_ACTIVE = [{ id: 'z', paths: ['src/**'], agentAuthority: 'activeIfNoConflict' }]
const ZONE_DEFAULTED = [{ id: 'z', paths: ['src/**'] }]
const fileNameOf = (id) => `docs/adrs/${id}-fixture-${id}.adr.md`

/** A fixture: a manifest plus its files, with the host state each record must settle in. */
const fixture = (name, { zones, defaultAgentAuthority, adrs, expect, expectProblem, expectRatify }) => {
  const files = { '.dsh/project.json': fixtureManifest(zones, defaultAgentAuthority) }
  for (const [id, options] of Object.entries(adrs)) files[fileNameOf(id)] = fixtureAdr(id, options)
  return { name, files, expect, expectProblem, expectRatify }
}

/**
 * Applies the bundle to a fresh context.
 *
 * The panel reads its data over `fetch` from the host state route, so a fresh
 * registration is all a fixture run needs; the state stub is global and the caller
 * points it at the root the run is about.
 *
 * @returns the fresh slot registry the bundle populated.
 */
function applyFresh() {
  const freshRegistry = {}
  const ctx = {
    effect(fn) { fn() },
    slots: {
      inject(_parent, fn) { fn() },
      register(config, Component) { freshRegistry[config.name] = { config, Component }; return () => {} },
    },
  }
  bundle.apply(ctx)
  return freshRegistry
}

/**
 * Materialises a fixture, points the state stub at it, and runs the PANEL's own `load`,
 * which fetches the REAL ratchet's view model over that root. The root is removed and the
 * previous stub root restored whatever happens, so one fixture cannot leak into the next.
 *
 * @param files - Repository-relative path to file text.
 * @returns the panel's loaded result, exactly as the overlay would receive it.
 */
async function panelOverFiles(files) {
  const root = materialise(files)
  const previous = stateRoot
  stateRoot = root
  try {
    const freshRegistry = applyFresh()
    const members = freshRegistry['shell.overlay'].config.inject()
    members.hooks.panel.set({ open: true, sessionId: 'fixture-session' })
    return await members.load(undefined)
  } finally {
    stateRoot = previous
    rmSync(root, { recursive: true, force: true })
  }
}

/** Runs the PANEL's own `loadPanel` over a fixture and indexes its decisions by id. */
async function panelDecisions(files) {
  const result = await panelOverFiles(files)
  const byId = {}
  for (const decision of result.decisions) byId[decision.id] = decision
  return byId
}

/** Runs the RATCHET's own derivation over a fixture. */
function hostView(files, manifestText) {
  const { config } = parseRatchetConfig(manifestText)
  const records = []
  const problems = []
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith('.adr.md')) continue
    const filename = path.split('/').pop()
    const parsed = parseAdr({ filename, source: text, decisionsDir: 'docs/adrs' })
    if (parsed.record !== null) records.push(parsed.record)
    problems.push(...parsed.problems)
  }
  const resolved = resolveActiveSet(records, config)
  const byId = {}
  for (const record of records) byId[record.id] = record
  return { resolved, byId, problems: [...problems, ...resolved.problems] }
}

/** The host's classification of one non-approval record, in the same vocabulary. */
function hostLabel(record) {
  if (record.supersededBy !== null && record.supersededBy !== undefined) return 'superseded'
  if (record.inForce === true) return 'in-force'
  if (record.status === 'proposed') return 'proposed'
  if (record.status === 'active') return 'excluded'
  return 'terminal'
}

/** Requires the panel's decision states and the host's to agree for one fixture. */
async function claimAgrees(caseFile) {
  const panel = await panelDecisions(caseFile.files)
  const manifestText = caseFile.files['.dsh/project.json']
  const host = hostView(caseFile.files, manifestText)
  const problems = new Set(host.problems.map((entry) => entry.code))
  const disagreements = []
  for (const [id, expected] of Object.entries(caseFile.expect)) {
    const record = host.byId[id]
    const actualHost = record === undefined ? 'missing' : hostLabel(record)
    if (actualHost !== expected) disagreements.push(`${id}: host is ${actualHost}, fixture expected ${expected}`)
    const decision = panel[id]
    if (decision === undefined) {
      disagreements.push(`${id}: the panel rendered no decision`)
      continue
    }
    const panelInForce = decision.state.kind === 'in-force'
    const panelSuperseded = /^superseded by /.test(decision.state.text)
    if (expected === 'in-force') {
      if (!panelInForce || panelSuperseded) disagreements.push(`${id}: host in force, panel ${JSON.stringify(decision.state)}`)
    } else {
      if (panelInForce) disagreements.push(`${id}: host ${expected}, panel ${JSON.stringify(decision.state)}`)
      if (expected === 'superseded' ? !panelSuperseded : panelSuperseded) disagreements.push(`${id}: supersession disagrees, panel ${JSON.stringify(decision.state)}`)
    }
  }
  if (caseFile.expectProblem !== undefined && !problems.has(caseFile.expectProblem)) {
    disagreements.push(`the ratchet reported no ${caseFile.expectProblem} (codes: ${[...problems].join(', ')})`)
  }
  for (const [id, expected] of Object.entries(caseFile.expectRatify ?? {})) {
    const decision = panel[id]
    if (decision === undefined) {
      disagreements.push(`${id}: the panel rendered no decision, so its ratify affordance cannot be read`)
      continue
    }
    if (Boolean(decision.canRatify) !== expected) {
      disagreements.push(`${id}: the ratchet would ${expected ? 'offer' : 'not offer'} ratification, panel canRatify=${Boolean(decision.canRatify)} (state ${JSON.stringify(decision.state)})`)
    }
  }
  claim(
    `the panel agrees with the ratchet's force model: ${caseFile.name}`,
    disagreements.length === 0,
    disagreements.length === 0 ? `checked ${Object.keys(caseFile.expect).join(', ')}` : disagreements.join(' | '),
  )
}

await claimAgrees(
  fixture('an approval whose ratification block is missing proves nothing', {
    zones: ZONE_ACTIVE,
    defaultAgentAuthority: 'activeIfNoConflict',
    adrs: {
      '0001': { status: 'proposed', zones: ['z'] },
      '0002': { type: 'approval', status: 'active', authority: 'human', approves: ['0001'], ratification: null },
    },
    expect: { '0001': 'proposed' },
    expectProblem: 'RATIFICATION_UNPROVEN',
    expectRatify: { '0001': true },
  }),
)
await claimAgrees(
  fixture('a ratification whose recorded hash is stale proves nothing', {
    zones: ZONE_ACTIVE,
    defaultAgentAuthority: 'activeIfNoConflict',
    adrs: {
      '0001': { status: 'proposed', zones: ['z'] },
      '0002': { type: 'approval', status: 'active', authority: 'human', approves: ['0001'], ratification: [{ id: '0001', contentHash: `sha256:${'f'.repeat(64)}` }] },
    },
    expect: { '0001': 'proposed' },
    expectProblem: 'RATIFICATION_STALE',
    expectRatify: { '0001': true },
  }),
)
await claimAgrees(
  fixture('a zone that omits agentAuthority inherits the proposeOnly default', {
    zones: ZONE_DEFAULTED,
    defaultAgentAuthority: 'proposeOnly',
    adrs: { '0001': { status: 'active', zones: ['z'] } },
    expect: { '0001': 'excluded' },
    expectRatify: { '0001': true },
  }),
)
await claimAgrees(
  fixture('an unzoned record is governed by the constant proposeOnly default', {
    zones: [],
    defaultAgentAuthority: undefined,
    adrs: { '0001': { status: 'active', zones: [] } },
    expect: { '0001': 'excluded' },
    expectRatify: { '0001': true },
  }),
)
await claimAgrees(
  fixture('an inline flow `zones` list names its zone', {
    zones: ZONE_ACTIVE,
    defaultAgentAuthority: 'proposeOnly',
    adrs: { '0001': { status: 'active', zones: ['z'], flowZones: true } },
    expect: { '0001': 'in-force' },
  }),
)
await claimAgrees(
  fixture('a withdrawn superseder retires nothing', {
    zones: ZONE_ACTIVE,
    defaultAgentAuthority: 'activeIfNoConflict',
    adrs: {
      '0001': { status: 'active', zones: ['z'] },
      '0002': { status: 'withdrawn', zones: ['z'], supersedes: ['0001'] },
    },
    expect: { '0001': 'in-force', '0002': 'terminal' },
  }),
)
await claimAgrees(
  fixture('an unauthorised agent superseder does not retire a human decision', {
    zones: ZONE_ACTIVE,
    defaultAgentAuthority: 'activeIfNoConflict',
    adrs: {
      '0001': { status: 'active', authority: 'human', zones: ['z'] },
      '0002': { status: 'active', authority: 'agent', zones: ['z'], supersedes: ['0001'] },
    },
    expect: { '0001': 'in-force', '0002': 'in-force' },
    expectProblem: 'LAW_REMOVE_UNAUTHORISED',
  }),
)
await claimAgrees(
  fixture('a valid ratification of unchanged text is honoured', {
    zones: ZONE_ACTIVE,
    defaultAgentAuthority: 'activeIfNoConflict',
    adrs: {
      '0001': { status: 'proposed', zones: ['z'] },
      '0002': {
        type: 'approval',
        status: 'active',
        authority: 'human',
        approves: ['0001'],
        ratification: [{ id: '0001', contentHash: hashSource(fixtureAdr('0001', { status: 'proposed', zones: ['z'] })) }],
      },
    },
    expect: { '0001': 'in-force' },
  }),
)

// ── the panel agrees with the ratchet over the kit's OWN corpus ─────────────
//
// The fixtures above are this test's own construction; the corpus is not, and a fixture can
// only fail the way its author imagined. So the SAME panel is driven over the kit's real
// `docs/adrs` through the real transport shape — a paged `read` that rebuilds a file's text
// from its lines and therefore drops a final newline, and a `readAll` that returns the exact
// bytes — and the set of decisions it shows as waiting is required to EQUAL the set the
// ratchet's own queue reports, read from `ratificationQueue`, which is the function
// `ratchet pending` calls. That equality is the requirement; the fixture cases are examples
// of it. It is the assertion that fails the moment a content hash stops being computed over
// the file's own bytes, which is the defect that made seven decisions in force read as
// `awaiting a human` while the ratchet reported seven waiting.
const { ratificationQueue } = await import(pathToFileURL(join(KIT, 'plugins', 'ratchet', 'ratchet-ratify.mjs')).href)

/**
 * The ids the PANEL shows as waiting, in a stable order.
 *
 * @param loaded - The overlay's `load` result.
 * @returns Sorted decision ids whose state kind is `pending`. An empty corpus
 *   yields `[]`, which is the correct answer for a corpus where everything is
 *   ratified rather than a failure of the panel.
 */
const waitingOf = (loaded) =>
  loaded.decisions
    .filter((decision) => decision.state !== null && decision.state !== undefined && decision.state.kind === 'pending')
    .map((decision) => decision.id)
    .sort()

/** Writes a fixture's files under a throwaway directory, so the real corpus reader can read it. */
function materialise(files) {
  const root = mkdtempSync(join(tmpdir(), 'adr-panel-fixture-'))
  for (const [relative, text] of Object.entries(files)) {
    const absolute = join(root, relative)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, text)
  }
  return root
}

/** Reads the panel's overlay over the kit's real corpus, through the state route. */
async function panelOverRealCorpus() {
  const previous = stateRoot
  stateRoot = KIT
  try {
    const freshRegistry = applyFresh()
    const members = freshRegistry['shell.overlay'].config.inject()
    members.hooks.panel.set({ open: true, sessionId: 'stub-session' })
    return await members.load(undefined)
  } finally {
    stateRoot = previous
  }
}

// A corpus with NOTHING waiting and a corpus with EVERYTHING waiting are two different
// cases, and only one of them can be stated of a named corpus. The kit's own corpus is a
// moving target — today every record is ratified, tomorrow two are proposed again — so a
// requirement that it hands out at least one waiter makes the mechanism's health depend on
// how much work happens to be outstanding: it holds exactly while the project has something
// pending and turns red the moment the project succeeds. That was this test's defect. The
// MECHANISM is therefore measured on a corpus this file controls, and the kit's own corpus
// is measured for the two properties that hold whatever state it is in: the queue reads it
// without a problem, and the panel derives exactly the waiting set the queue reports.
const pendingFixture = fixture('a decision waiting for a human', {
  zones: ZONE_ACTIVE,
  defaultAgentAuthority: 'activeIfNoConflict',
  adrs: {
    '0001': { status: 'active', zones: ['z'], title: 'already in force' },
    '0002': { status: 'proposed', zones: ['z'], title: 'awaiting a human' },
  },
  expect: { '0001': 'in-force', '0002': 'proposed' },
  expectRatify: { '0002': true },
})
{
  const pendingRoot = materialise(pendingFixture.files)
  try {
    const fixtureQueue = ratificationQueue(pendingRoot)
    const fixturePanel = await panelOverFiles(pendingFixture.files)
    claim(
      'the ratchet derives a waiting set over a corpus that has one',
      fixtureQueue.ok === true && fixtureQueue.pending.length > 0,
      `ok=${String(fixtureQueue.ok)} pending=${fixtureQueue.pending.length} problems=${JSON.stringify(fixtureQueue.problems.map((entry) => entry.code))}`,
    )
    const panelWaiting = waitingOf(fixturePanel)
    const ratchetWaiting = fixtureQueue.pending.map((entry) => entry.id).sort()
    claim(
      'the panel derives exactly the waiting set the ratchet reports for that corpus',
      JSON.stringify(panelWaiting) === JSON.stringify(ratchetWaiting) && ratchetWaiting.length > 0,
      `panel=${JSON.stringify(panelWaiting)} ratchet=${JSON.stringify(ratchetWaiting)}`,
    )
    // The hash is what makes the equality above mean "both read the same bytes". The panel
    // hashes through the whole-file read and the queue through `readFileSync`; it is the
    // hash the panel reports for each waiting record that has to be the hash the queue
    // recorded, and that is what a page-joined read destroys.
    const queueHash = fixtureQueue.pending.find((entry) => entry.id === '0002')?.contentHash ?? null
    const panelEntry = fixturePanel.decisions.find((decision) => decision.id === '0002') ?? null
    claim(
      'and the content hash it reports for a waiter is the hash the ratchet recorded',
      panelEntry !== null && panelEntry.contentHash !== null && panelEntry.contentHash === queueHash,
      `panel=${String(panelEntry?.contentHash)} ratchet=${String(queueHash)}`,
    )
  } finally {
    rmSync(pendingRoot, { recursive: true, force: true })
  }
}

// ── a human-authored proposal is offered the action, not left inert ─────────
//
// The reported bug: a `status: proposed`, `authority: human` record rendered as "not in
// force" with NO affordance at all, because the queue skipped anything not agent-authored.
// The ratchet now offers it the same question — authorship is not activation, the recorded
// consent is — so the window must render the SAME Approve and Decline on its row. The payload
// is the REAL derivation over a materialised fixture, not an object this file assembled.
const humanFixture = fixture('a human-authored record still waiting to be activated', {
  zones: ZONE_ACTIVE,
  defaultAgentAuthority: 'activeIfNoConflict',
  adrs: { '0001': { status: 'proposed', authority: 'human', zones: ['z'], title: 'a human draft' } },
  expect: { '0001': 'proposed' },
  expectRatify: { '0001': true },
})
await claimAgrees(humanFixture)
{
  const humanLoaded = await panelOverFiles(humanFixture.files)
  const humanDecision = humanLoaded.decisions.find((decision) => decision.id === '0001') ?? null
  claim(
    'the ratchet offers a human-authored proposed record as a waiter',
    humanDecision !== null && humanDecision.canRatify === true && humanDecision.state.kind === 'pending',
    JSON.stringify(humanDecision === null ? null : { canRatify: humanDecision.canRatify, state: humanDecision.state }),
  )
  const humanRendered = await renderOverlay('human-authored-row', () => Promise.resolve(humanLoaded))
  // The window opens on Needs a human (the fixture has a waiting consent), and the
  // "Open 0001" way in must land on the decision's own row — which is also what makes
  // Approve and Decline reachable from the to-do list.
  const openButton = nodes.find((node) => node.tag === 'button' && node.text === 'Open 0001')
  if (openButton !== undefined) openButton.props.onClick()
  await flush(humanRendered.root, 'human-authored-row')
  const humanRowButtons = [...new Set(nodes.filter((node) => node.tag === 'button').map((node) => node.text))]
  claim(
    'the window renders Approve and Decline on a human-authored proposed record, so the human can act',
    humanRowButtons.includes('Approve') && humanRowButtons.includes('Decline'),
    JSON.stringify(humanRowButtons),
  )
}

const realQueue = ratificationQueue(KIT)
claim(
  'the ratchet reads the kit’s own corpus into a queue without a problem',
  realQueue.ok === true && realQueue.problems.length === 0,
  `ok=${String(realQueue.ok)} pending=${realQueue.pending.length} problems=${JSON.stringify(realQueue.problems.map((entry) => entry.code))}`,
)
const realPanel = await panelOverRealCorpus()
const panelWaiting = waitingOf(realPanel)
const ratchetWaiting = realQueue.pending.map((entry) => entry.id).sort()
claim(
  'the panel derives exactly the waiting set the ratchet reports over the kit’s own corpus',
  JSON.stringify(panelWaiting) === JSON.stringify(ratchetWaiting),
  `panel=${JSON.stringify(panelWaiting)} ratchet=${JSON.stringify(ratchetWaiting)}`,
)
claim(
  'and the state it rendered came through the state route, without a failure',
  realPanel.decisions.length > 0 && realPanel.failures.length === 0,
  `decisions=${realPanel.decisions.length} failures=${JSON.stringify(realPanel.failures)}`,
)
claim(
  'the panel reached the state route rather than reading the corpus itself',
  stateCalls > 0,
  `stateCalls=${stateCalls}`,
)

// ── the "Needs a human" entry point ─────────────────────────────────────────
//
// LIMITATIONS §3.3: the ratchet derives ONE set of things a human must settle and the
// window shows it as the developer's entry point. This measures the RENDERED set against
// the ratchet's OWN `needsHuman` — the service is run over the materialised fixture, and
// the panel is rendered over the same files through the state route whose stub calls the
// real `deriveDecisions`. Nothing here is an object the test invented: if a derivation
// stops producing a kind, the service's set shrinks and this claim fails.
const NEEDS_KINDS = ['consent', 'contradiction', 'duplicate', 'stale-spec', 'red-gate']
const isNeedsPill = (node) => isPillNode(node) && /^(consent|contradiction|duplicate|stale-spec|red-gate) /.test(node.text)

// A fixture with one of each kind. 0001 is a human decision in force whose law is the
// contradiction's target and the duplicate's keeper; 0002 is a proposal waiting for a
// human; 0003 redeclares 0001's law id with a different statement (the guard's decidable
// contradiction) and is itself waiting; 0004 is a later record declaring the same law
// STATEMENT under a different id (the duplicate rule); the generated spec for the one law
// in force is absent (drift `missing`); and a persisted verify report records a problem
// (the red gate). Every source file exists and is hashed, so `draftResolutions` drafts.
const needsZone = [{ id: 'z', paths: ['src/**'], agentAuthority: 'proposeOnly', requiresDecisionRecord: true }]
const needsSources = {}
const needsFiles = { '.dsh/project.json': fixtureManifest(needsZone, 'proposeOnly') }
for (const id of ['0001', '0002', '0003', '0004']) {
  const text = `# reasoning for ${id}\n`
  const sourcePath = `docs/ratchet/sources/${id}.md`
  needsSources[id] = { sourcePath, sourceHash: hashSource(text) }
  needsFiles[sourcePath] = text
}
needsFiles['docs/adrs/0001-fixture-0001.adr.md'] = fixtureAdr('0001', { status: 'active', authority: 'human', zones: ['z'], laws: [{ id: 'law.shared', statement: 'Alpha' }], ...needsSources['0001'] })
needsFiles['docs/adrs/0002-fixture-0002.adr.md'] = fixtureAdr('0002', { status: 'proposed', authority: 'agent', zones: ['z'], laws: [{ id: 'law.other', statement: 'Beta' }], ...needsSources['0002'] })
needsFiles['docs/adrs/0003-fixture-0003.adr.md'] = fixtureAdr('0003', { status: 'proposed', authority: 'agent', zones: ['z'], laws: [{ id: 'law.shared', statement: 'Gamma' }], ...needsSources['0003'] })
needsFiles['docs/adrs/0004-fixture-0004.adr.md'] = fixtureAdr('0004', { status: 'active', authority: 'agent', zones: ['z'], laws: [{ id: 'law.dup', statement: 'Alpha' }], ...needsSources['0004'] })
needsFiles['reports/ratchet/verify-report.json'] = `${JSON.stringify({ generatedAt: '2026-09-15T00:00:00.000Z', problems: [{ code: 'FIXTURE_RED', severity: 'error', lawId: 'law.shared', message: 'the fixture records a red gate' }] }, null, 2)}\n`
{
  const needsRoot = materialise(needsFiles)
  const previousRoot = stateRoot
  stateRoot = needsRoot
  try {
    const serviceNeeds = stateModule.deriveDecisions({ root: needsRoot }).needsHuman
    // The batches start collapsed, so the render is expanded first: the equality claim is
    // about every entry being REPRESENTED, and an unexpanded batch would measure the
    // header alone.
    const rendered = await renderOverlayExpanded('needs')
    claim('the overlay renders the needs-a-human fixture', rendered.ok, rendered.ok ? undefined : rendered.error)
    const renderedNeeds = nodes.filter(isNeedsPill).map((node) => node.text).sort()
    const serviceKeys = serviceNeeds.map((entry) => `${entry.kind} ${entry.id}`).sort()
    claim(
      "the rendered \"Needs a human\" set equals the ratchet's own needsHuman",
      serviceKeys.length > 0 && JSON.stringify(renderedNeeds) === JSON.stringify(serviceKeys),
      `rendered=${JSON.stringify(renderedNeeds)} service=${JSON.stringify(serviceKeys)}`,
    )
    const kinds = [...new Set(serviceNeeds.map((entry) => entry.kind))].sort()
    claim(
      'the fixture exercises every needs-human kind',
      JSON.stringify(kinds) === JSON.stringify([...NEEDS_KINDS].sort()),
      JSON.stringify(kinds),
    )
    // A reason or action may carry a full hash that the window SHORTENS for display, so
    // the full text is looked for in the node's own `title` as well as its visible text.
    // Either way the ratchet's own words are in the DOM; short display never means lost.
    const shownFullText = (value) =>
      nodes.some((node) => node.text === value || (node.props !== undefined && typeof node.props.title === 'string' && node.props.title === value))
    const unrendered = []
    for (const entry of serviceNeeds) {
      if (!shownFullText(entry.reason)) unrendered.push(`reason of ${entry.kind} ${entry.id}`)
      if (!shownFullText(entry.action)) unrendered.push(`action of ${entry.kind} ${entry.id}`)
    }
    claim(
      "every needs-human entry renders the ratchet's own reason and action",
      unrendered.length === 0,
      unrendered.join(' | '),
    )
    const loaded = await panelOverFiles(needsFiles)
    claim(
      "the panel passes the ratchet's needsHuman set through unchanged",
      JSON.stringify(loaded.needsHuman) === JSON.stringify(serviceNeeds),
      `panel=${JSON.stringify(loaded.needsHuman)} service=${JSON.stringify(serviceNeeds)}`,
    )
  } finally {
    stateRoot = previousRoot
    rmSync(needsRoot, { recursive: true, force: true })
  }
}

// ── a homogeneous batch is ONE group, not one card per document ─────────────
//
// Seven stale specs used to render as five-plus near-identical tall cards, each repeating
// the same reason, note path and action. This measures the grouped rendering over a REAL
// four-zone fixture: each generated document is written to disk with a different recorded
// `spec-hash`, so all four are genuinely `stale` — not hand-edited `drifted` — and every
// reason carries the full "recorded vs current" hash pair this test also shortens.
const groupZones = ['a', 'b', 'c', 'd'].map((id) => ({ id, paths: [`src/${id}/**`], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }))
const groupFiles = { '.dsh/project.json': fixtureManifest(groupZones, 'activeIfNoConflict') }
for (const [index, id] of ['0001', '0002', '0003', '0004'].entries()) {
  const zone = groupZones[index].id
  const text = `# reasoning for ${id}\n`
  groupFiles[`docs/ratchet/sources/${id}.md`] = text
  groupFiles[`docs/adrs/${id}-fixture-${id}.adr.md`] = fixtureAdr(id, {
    status: 'active',
    authority: 'human',
    zones: [zone],
    laws: [{ id: `${zone}.law`, statement: `Law for ${zone}` }],
    sourcePath: `docs/ratchet/sources/${id}.md`,
    sourceHash: hashSource(text),
  })
}
{
  // Derive the freshly generated documents once so their real text (and hash) is known,
  // then write each to disk with a DIFFERENT recorded hash: the drift detector classifies
  // exactly that as `stale`.
  const probeRoot = materialise(groupFiles)
  const probe = stateModule.deriveDecisions({ root: probeRoot })
  rmSync(probeRoot, { recursive: true, force: true })
  probe.specs.forEach((spec, index) => {
    groupFiles[spec.path] = spec.text.replace(/(<!--\s*spec-hash:\s*sha256:)[0-9a-f]{64}/, `$1${String(index + 1).repeat(64)}`)
  })
}
{
  const groupRoot = materialise(groupFiles)
  const previousRoot = stateRoot
  stateRoot = groupRoot
  try {
    const serviceNeeds = stateModule.deriveDecisions({ root: groupRoot }).needsHuman
    const staleNeeds = serviceNeeds.filter((entry) => entry.kind === 'stale-spec')
    claim('the stale fixture derives four stale generated specs', staleNeeds.length === 4, JSON.stringify(serviceNeeds.map((entry) => `${entry.kind} ${entry.id}`)))
    const rendered = await renderOverlayExpanded('stale-group')
    claim('the overlay renders the stale-spec fixture', rendered.ok, rendered.ok ? undefined : rendered.error)
    const groupHeaders = nodes.filter((node) => node.tag === 'button' && typeof node.text === 'string' && node.text.includes('Stale specs · '))
    claim(
      'a homogeneous stale-spec batch renders ONE group whose header counts them',
      staleNeeds.length >= 4 && groupHeaders.length === 1 && groupHeaders[0].text.includes('Stale specs · ' + staleNeeds.length),
      `headers=${JSON.stringify(groupHeaders.map((node) => node.text))}`,
    )
    const missingPath = staleNeeds.filter((entry) => !nodes.some((node) => typeof node.text === 'string' && node.text.includes(entry.path)))
    const missingAction = staleNeeds.filter((entry) => !nodes.some((node) => node.text === entry.action))
    claim(
      'expanding the group reveals every stale document path and action',
      missingPath.length === 0 && missingAction.length === 0,
      `pathsMissing=${missingPath.length} actionsMissing=${missingAction.length}`,
    )
    // Display-only hash shortening: the visible reason abbreviates BOTH hashes, the FULL
    // reason is still in the DOM as the element's `title`, and no node anywhere in this
    // render shows a raw 64-hex value.
    const firstStale = staleNeeds[0]
    const abbreviated = String(firstStale.reason).replace(/sha256:[0-9a-fA-F]{64}/g, (match) => match.slice(0, 19) + '…')
    const fullInDom = nodes.some((node) => node.props !== undefined && node.props.title === firstStale.reason)
    claim(
      'a hash-bearing reason renders abbreviated with the full text kept in the DOM',
      firstStale.reason !== abbreviated && nodes.some((node) => node.text === abbreviated) && fullInDom,
      `abbreviated=${JSON.stringify(abbreviated)} fullInDom=${String(fullInDom)}`,
    )
    const rawHashNodes = nodes.filter((node) => typeof node.text === 'string' && /sha256:[0-9a-fA-F]{64}/.test(node.text))
    claim(
      'no raw 64-hex hash appears in any rendered node text',
      rawHashNodes.length === 0,
      rawHashNodes.map((node) => node.text).join(' | '),
    )
  } finally {
    stateRoot = previousRoot
    rmSync(groupRoot, { recursive: true, force: true })
  }
}

// The empty state is a real state, and it must be SHOWN: a corpus with nothing waiting,
// nothing contradicting, nothing duplicated, no drift and no recorded red verdict renders
// the section's own empty line, never a hidden section. The ratchet's own set is the
// requirement, so the claim is that it is empty AND the window says so.
{
  const emptyZone = [{ id: 'z', paths: ['src/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: true }]
  const emptyText = '# reasoning\n'
  const emptyFiles = {
    '.dsh/project.json': fixtureManifest(emptyZone, 'activeIfNoConflict'),
    'docs/ratchet/sources/0001.md': emptyText,
    'docs/adrs/0001-fixture-0001.adr.md': fixtureAdr('0001', { status: 'active', authority: 'human', zones: ['z'], sourcePath: 'docs/ratchet/sources/0001.md', sourceHash: hashSource(emptyText) }),
  }
  const emptyRoot = materialise(emptyFiles)
  const previousRoot = stateRoot
  stateRoot = emptyRoot
  try {
    const serviceEmpty = stateModule.deriveDecisions({ root: emptyRoot }).needsHuman
    claim('the ratchet reports nothing needs a human on a settled corpus', Array.isArray(serviceEmpty) && serviceEmpty.length === 0, JSON.stringify(serviceEmpty))
    const rendered = await renderOverlay('needs-empty')
    claim('the overlay renders the empty needs-a-human fixture', rendered.ok, rendered.ok ? undefined : rendered.error)
    // The settled corpus still has a decision, so the window opens on Decisions; the
    // Needs a human PART is reached through its tab, which must still state its zero.
    const needsTab = sectionTabsOf(nodes).find((node) => node.props['data-adr-panel-section'] === 'needs')
    claim(
      'the empty needs-a-human part is still a tab, stating zero',
      needsTab !== undefined && needsTab.text === 'Needs a human (0)',
      JSON.stringify(sectionTabsOf(nodes).map((node) => node.text)),
    )
    await showSection(rendered.root, 'needs-empty', 'needs')
    const emptyStateShown = nodes.some((node) => typeof node.text === 'string' && /^Nothing needs a human/.test(node.text))
    const needsPills = nodes.filter(isNeedsPill).length
    const sectionPresent = nodes.some((node) => node.tag === 'h3' && node.text === 'Needs a human')
    claim(
      'an empty needs-a-human set is a clear empty state, not a hidden section',
      sectionPresent && emptyStateShown && needsPills === 0,
      `heading=${sectionPresent} emptyState=${emptyStateShown} pills=${needsPills}`,
    )
  } finally {
    stateRoot = previousRoot
    rmSync(emptyRoot, { recursive: true, force: true })
  }
}

// ── a capped answer is STATED, not silently rendered as the whole corpus ────
// The host caps what it sends and marks the cut with `truncated`; the window must say so
// rather than draw a partial list as if it were complete. The claim drives a real render
// whose state answer carries the marker, and requires the sentence in the rendered tree.
{
  const full = stateModule.deriveDecisions({ root: stateRoot })
  stateViewOverride = {
    ...full,
    truncated: { records: { shown: 5, total: 52 }, specs: { shown: 1, total: 3 }, texts: { dropped: 4, total: 5 }, specTexts: null, queueTexts: null, byteLimit: 1500000 },
  }
  try {
    const rendered = await renderOverlay('truncated')
    const note = nodes.find((node) => typeof node.text === 'string' && /truncated to stay within/.test(node.text))
    claim(
      'a truncated state answer is stated in the window, not rendered as the whole corpus',
      rendered.ok &&
        note !== undefined &&
        /only 5 of 52 decisions are shown/.test(note.text) &&
        /only 1 of 3 spec documents/.test(note.text) &&
        /4 decision bodies were omitted/.test(note.text),
      `found=${note === undefined ? 'no note' : JSON.stringify(note.text)}`,
    )
  } finally {
    stateViewOverride = null
  }
}

// The record/spec ceiling is not the only one: a homogeneous batch of needs-a-human
// entries has its own per-kind and total ceiling, and a cut kind is named so it cannot
// vanish silently. Measured on the service's own cap, not on a hand-made shape.
{
  const baseView = { ok: true, project: {}, specHash: null, records: [], queue: {}, specs: [], drift: {}, problems: [], needsHuman: [], truncated: null }
  const manyNeeds = { ...baseView, needsHuman: Array.from({ length: 60 }, (_, index) => ({ kind: 'stale-spec', id: `docs/specs/s${index}.spec.md`, reason: 'r', action: 'a' })) }
  const capped = stateModule.capDecisionsView(manyNeeds)
  const cut = capped.truncated === null ? null : capped.truncated.needsHuman
  claim(
    'the state cap bounds a homogeneous needs-a-human batch and names the cut kind',
    capped.needsHuman.length < 60 &&
      capped.needsHuman.length === stateModule.MAX_STATE_NEEDS_PER_KIND &&
      cut !== null &&
      cut.total === 60 &&
      cut.shown === capped.needsHuman.length &&
      Array.isArray(cut.kinds) &&
      cut.kinds.some((entry) => entry.kind === 'stale-spec' && entry.shown < entry.total),
    `kept=${capped.needsHuman.length} cut=${JSON.stringify(cut)}`,
  )
}

// A needs-a-human set the host cut is stated in the SECTION it belongs to — the shown and
// total counts and every kind that lost an entry — never drawn as the whole to-do list.
{
  const full = stateModule.deriveDecisions({ root: stateRoot })
  const syntheticNeeds = Array.from({ length: 3 }, (_, index) => ({
    kind: 'stale-spec',
    id: `docs/specs/s${index}.spec.md`,
    title: `spec s${index}.spec.md`,
    path: `docs/specs/s${index}.spec.md`,
    reason: `detectSpecDrift reports the generated document as stale: it records spec sha256:${String(index + 1).repeat(64)} and the current laws hash to sha256:${'c'.repeat(64)}`,
    action: 'regenerate the document with "ratchet compile --write"',
    draft: { id: null, path: `reports/ratchet/drafts/stalewithdraw-${index}.md` },
    draftReason: null,
  }))
  stateViewOverride = {
    ...full,
    needsHuman: syntheticNeeds,
    truncated: { records: null, specs: null, needsHuman: { shown: 3, total: 9, kinds: [{ kind: 'stale-spec', shown: 3, total: 9 }] }, texts: null, specTexts: null, queueTexts: null, byteLimit: 1500000 },
  }
  try {
    const rendered = await renderOverlayExpanded('truncated-needs')
    const line = nodes.find((node) => typeof node.text === 'string' && /needs-a-human set was cut/.test(node.text))
    const header = nodes.find((node) => node.tag === 'button' && typeof node.text === 'string' && node.text.includes('Stale specs · '))
    claim(
      'a truncated needs-a-human set is stated in its section, counting the cut kind',
      rendered.ok &&
        line !== undefined &&
        /3 of 9/.test(line.text) &&
        /stale-spec 3 of 9/.test(line.text) &&
        header !== undefined &&
        header.text.includes('Stale specs · 3 of 9'),
      `line=${line === undefined ? 'none' : JSON.stringify(line.text)} header=${header === undefined ? 'none' : JSON.stringify(header.text)}`,
    )
  } finally {
    stateViewOverride = null
  }
}

// ── no section draws an unbounded list ──────────────────────────────────────
//
// The host caps what it sends at 500 records, which is still a 500-row DOM for a browser.
// The window draws at most 50 rows per section and offers the rest through a control that
// states the count, so a bounded list is never mistaken for a short one. Measured on a
// synthetic 60-record answer, because the kit's own corpus is smaller than the cap.
const ROW_CAP = 50 // must equal SECTION_ROW_CAP in the bundle
{
  const record = (index) => ({
    id: String(1000 + index),
    path: `docs/adrs/${1000 + index}-fixture.adr.md`,
    title: `fixture decision ${index}`,
    type: 'adr',
    status: 'active',
    authority: 'agent',
    authorName: 'fixture-author',
    created: '2026-09-15',
    source: { kind: 'file', path: 'docs/ratchet/sources/fixture.md', hash: `sha256:${'a'.repeat(64)}` },
    zones: [],
    supersedes: [],
    approves: [],
    laws: [],
    state: { text: 'in force', kind: 'in-force', derived: false },
    provenance: null,
    canRatify: false,
    text: `---\nid: ${1000 + index}\n---\n\n## Decision\n\nThe fixture decision number ${index} does one thing.\n`,
  })
  const manyDecisions = {
    ok: true,
    project: { decisionsDir: 'docs/adrs', specsDir: 'docs/specs', name: 'big fixture' },
    specHash: null,
    records: Array.from({ length: 60 }, (_, index) => record(index)),
    queue: {},
    specs: [],
    drift: {},
    problems: [],
    needsHuman: [],
    // The host's own cut is present too: the window must state both bounds, not one.
    truncated: { records: { shown: 60, total: 500 }, specs: null, needsHuman: null, texts: null, specTexts: null, queueTexts: null, byteLimit: 1500000 },
  }
  stateViewOverride = manyDecisions
  try {
    const rendered = await renderOverlay('bounded')
    const badges = () => nodes.filter((node) => typeof node.text === 'string' && /^#\d+$/.test(node.text)).length
    const drawn = badges()
    const countLine = nodes.find((node) => typeof node.text === 'string' && /^Showing \d+ of \d+$/.test(node.text))
    const moreButton = nodes.find((node) => node.tag === 'button' && typeof node.text === 'string' && /^Show \d+ more$/.test(node.text))
    claim(
      'a section draws at most the cap and states how many of the total it drew',
      rendered.ok && drawn === ROW_CAP && countLine !== undefined && countLine.text === `Showing ${ROW_CAP} of 60` && moreButton !== undefined,
      `drawn=${drawn} countLine=${countLine === undefined ? 'none' : JSON.stringify(countLine.text)} more=${moreButton === undefined ? 'none' : JSON.stringify(moreButton.text)}`,
    )
    claim(
      'the host-side truncation is stated too, so two different cuts are not confused',
      nodes.some((node) => typeof node.text === 'string' && /only 60 of 500 decisions are shown/.test(node.text)),
      JSON.stringify(nodes.filter((node) => typeof node.text === 'string' && /truncated to stay within/.test(node.text)).map((node) => node.text)),
    )
    if (moreButton !== undefined) moreButton.props.onClick()
    await flush(rendered.root, 'bounded')
    const afterMore = badges()
    claim(
      'the show-more control reveals the next batch rather than dropping the rows',
      afterMore > drawn && afterMore <= 60,
      `before=${drawn} after=${afterMore}`,
    )
  } finally {
    stateViewOverride = null
  }
}


// The window must never fall back to a derivation of its own. With the state capability
// absent it reports the state as unavailable, and it fetches nothing.
{
  const savedStateBridge = globalThis.__DSH_ADR_PANEL_STATE__
  delete globalThis.__DSH_ADR_PANEL_STATE__
  const before = consentCalls.length
  const unavailablePanel = await panelOverFiles(pendingFixture.files)
  claim(
    'an unreachable state route is reported as unavailable, and nothing is derived',
    unavailablePanel.decisions.length === 0 &&
      unavailablePanel.failures.some((line) => /state route is not available/.test(line)),
    `decisions=${unavailablePanel.decisions.length} failures=${JSON.stringify(unavailablePanel.failures)}`,
  )
  claim(
    'and no request was made without the state capability',
    consentCalls.length === before,
    `${consentCalls.length - before} unexpected request(s)`,
  )
  globalThis.__DSH_ADR_PANEL_STATE__ = savedStateBridge
}

// ── report ──────────────────────────────────────────────────────────────────
// The colour check runs here, after every render, so it measures the pills AND the
// toned buttons the later scenarios produced rather than only the overlay's pills.
checkColours()
for (const entry of claims) {
  process.stdout.write(`  [${entry.ok ? 'PASS' : 'FAIL'}] ${entry.name}${entry.ok ? '' : ` — ${entry.detail}`}\n`)
}
if (failures.length > 0) {
  process.stderr.write(`adr panel render FAILED\n${failures.map((entry) => `  - ${entry}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('adr panel render ok\n')
