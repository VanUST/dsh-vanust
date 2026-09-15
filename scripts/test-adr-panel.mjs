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
 *   It also checks the pills' COLOUR, not just the token each one names. A pill can
 *   cite the right theme variable and still be unreadable, because what matters is
 *   the value that variable resolves to: the theme's dark variant maps both
 *   `state-error-primary` and `state-error-secondary` to the same solid red, so a
 *   pill whose background used `-secondary` was filled with exactly its own text
 *   colour and its label vanished. Where the shell's theme bundle can be found,
 *   every rendered pill's foreground and background are resolved through it in both
 *   variants and required to differ by a minimum contrast ratio.
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
 *   - No installed theme, or a pill whose colour cannot be resolved to a concrete
 *     value, is reported as skipped or unresolved rather than counted as contrast
 *     it never measured.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
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
claim('the factory exports an apply', typeof bundle.apply === 'function', `apply=${typeof bundle.apply}`)

// ── a fake workspace file API over the kit's real corpus ────────────────────
//
// The surface deliberately exposes ONLY the two reads the panel is allowed to make, and
// records every call. A panel that writes anything would have to invent a method name, and
// `scripts/check-consent-surface.mjs` is where the claim that it does not is enforced
// against the bundle: here the point is that the whole render is watched, so "it reads and
// does nothing else" is measured rather than asserted from the source text.
const fileCalls = []
const fileSurface = {
  list(_sessionId, directory) {
    fileCalls.push('list')
    try {
      const entries = readdirSync(join(KIT, directory), { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        type: entry.isFile() ? 'file' : 'dir',
      }))
      return Promise.resolve({ ok: true, value: { path: directory, entries, truncated: false } })
    } catch (error) {
      return Promise.resolve({ ok: false, error: { message: String(error.message) } })
    }
  },
  read(_sessionId, relativePath) {
    fileCalls.push('read')
    try {
      const absolute = join(KIT, relativePath)
      if (!statSync(absolute).isFile()) throw new Error('not a file')
      return Promise.resolve({ ok: true, value: { text: readFileSync(absolute, 'utf8'), eof: true } })
    } catch (error) {
      return Promise.resolve({ ok: false, error: { message: String(error.message) } })
    }
  },
}

// A Proxy, not the bare object: the claim under test is "the whole render calls nothing
// but list and read", and against a stub that defines only those two an extra call is a
// TypeError the bundle swallows — so `stat`, `readAll` or `write` would execute and never
// appear in the record. Every unlisted member is now reachable, records itself, and is
// reported, which is what makes the claim about the CALLS rather than about the stub.
const fileApi = new Proxy(fileSurface, {
  get(target, prop) {
    if (typeof prop === 'symbol' || prop in target) return target[prop]
    return () => {
      fileCalls.push(String(prop))
      return Promise.resolve({ ok: false, error: { message: `the panel reached an unexposed workspace-files method: ${String(prop)}` } })
    }
  },
})

// ── apply the bundle and capture its registrations ──────────────────────────
const registry = {}
const context = {
  remote: { workspaceFiles: fileApi },
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

/** Every pill rendered so far, across all scenarios, for the colour check. */
const renderedPills = []

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
    for (const node of nodes) if (isPillNode(node)) renderedPills.push({ text: node.text, style: node.style })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

const first = await renderOverlay('root')
claim('the overlay renders over the real corpus', first.ok, first.ok ? undefined : first.error)

const texts = nodes.map((node) => node.text)
const headings = nodes.filter((node) => node.tag === 'h3').map((node) => node.text)
claim(
  'the section headings are the reader-facing three',
  JSON.stringify(headings) === JSON.stringify(['Decisions', 'Consents', 'Specs']),
  JSON.stringify(headings),
)
// The header chip is the only way a reader tells a stale client bundle from a bug, so
// it must name the version the package actually declares — a hand-maintained constant
// next to a versioned manifest drifts silently otherwise.
const packageVersion = JSON.parse(readFileSync(join(KIT, 'plugins', 'dsh-adr-panel', 'package.json'), 'utf8')).version
claim(
  'the window header names the bundle version the package declares',
  texts.includes(`adr-panel ${packageVersion}`),
  `package=${packageVersion}; header chips=${JSON.stringify(texts.filter((text) => /^adr-panel /.test(text)))}`,
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

const decidedIn = nodes.filter((node) => node.tag === 'span' && /^decided in /.test(node.text))
claim('a law card names its deciding record', decidedIn.length > 0, `chips=${decidedIn.length}`)
const knownChip = decidedIn.find((node) => node.text === 'decided in 0001')
claim(
  'a decided-in chip takes its decision in-force tone',
  knownChip !== undefined && /state-success/.test(backgroundOf(knownChip)),
  JSON.stringify(knownChip === undefined ? null : knownChip.style),
)

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
  ],
  consents: [],
  specs: [{
    name: 'spec', zone: 'zone-a', project: null, hash: 'deadbeef', eof: true, error: null,
    counts: { laws: 2, checks: 0 },
    laws: [syntheticLaw('L-super', '0002'), syntheticLaw('L-unknown', '9999')],
  }],
  relations: { approvedBy: {}, supersededBy: { '0002': ['0009'] } },
  lawsByDecision: { '0002': [{ law: syntheticLaw('L-super', '0002'), zone: 'zone-a' }] },
  decisionIds: { '0002': true },
  recordIds: { '0002': true, '0009': true },
  dirs: { decisionsDir: 'docs/adrs', specsDir: 'docs/specs' },
  projectName: 'synthetic project',
  notes: [],
  failures: [],
}
const second = await renderOverlay('synthetic', () => Promise.resolve(synthetic))
claim('the overlay renders a synthetic corpus', second.ok, second.ok ? undefined : second.error)
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

const themeFile = findTheme()
if (themeFile === null) {
  process.stdout.write('  [SKIP] every pill is legible against its own fill — no installed shell theme to resolve against\n')
} else {
  const themeSource = readFileSync(themeFile, 'utf8')
  const variants = { light: themeVariant(themeSource, 'body'), dark: themeVariant(themeSource, 'body[data-ds-dark-theme]') }
  const unresolved = []
  const inherited = []
  const measured = []
  for (const [variant, vars] of Object.entries(variants)) {
    if (vars === null) continue
    const surface = parseColour(resolveToken(vars.get('--dsw-specific-menu'), vars))
    if (surface === null) continue
    for (const pill of renderedPills) {
      // A plain chip sets neither: it inherits the surrounding text colour on the card,
      // so there is no pair to compare and claiming one would be measuring nothing.
      if (pill.style.color === undefined && pill.style.background === undefined) {
        inherited.push(`${variant}:${pill.text}`)
        continue
      }
      const foreground = parseColour(resolveToken(pill.style.color, vars))
      const background = parseColour(resolveToken(pill.style.background, vars))
      if (foreground === null || background === null) {
        unresolved.push(`${variant}:${pill.text}`)
        continue
      }
      measured.push({ variant, text: pill.text, ratio: contrastRatio(foreground, over(background, surface)) })
    }
  }
  const worst = measured.reduce((low, entry) => (low === null || entry.ratio < low.ratio ? entry : low), null)
  const failing = measured.filter((entry) => entry.ratio < MINIMUM_CONTRAST)
  claim(
    `no pill is filled with its own text colour (contrast >= ${MINIMUM_CONTRAST})`,
    measured.length > 0 && failing.length === 0,
    failing.length > 0
      ? failing.map((entry) => `${entry.variant} "${entry.text}" ${entry.ratio.toFixed(2)}`).join(' | ')
      : `worst ${worst === null ? 'n/a' : `${worst.variant} "${worst.text}" ${worst.ratio.toFixed(2)}`} of ${measured.length} toned pill(s), ${inherited.length} plain chip(s) inherit their colour`,
  )
  claim(
    'every toned pill colour resolved through the theme',
    unresolved.length === 0,
    `${unresolved.length} unresolvable: ${unresolved.slice(0, 6).join(', ')}`,
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


// ── the row's buttons answer the ratchet's question directly ────────────────
//
// The requirement, in the operator's words: "Buttons in ADR should approve/decline adr
// directly, without intermediate chat". Two halves, each tested on its own, because getting
// either wrong produces the thing that was rejected — a click that does nothing, or a quiz the
// human is sent away to answer.
//
// The REAL `requestRatify` runs here. An earlier version of this test replaced it with a spy,
// and that stub is what let three mutations through: it never asked, never recorded, and never
// reached the file surface.

const asked = []
const overlayForRows = registry['shell.overlay'].config.inject()
panelStore.set({ ask: function (adrId) { asked.push(adrId) }, ratify: null, request: null })

/** Renders the window over the real corpus and returns its buttons. */
const renderRows = async (tag) => {
  await flush(
    React.createElement(
      registry['shell.overlay'].Component,
      Object.assign({}, overlayForRows, { usePanel: (selector) => selector(panelStore.getSnapshot()) }),
    ),
    tag,
  )
  return nodes.filter((node) => node.tag === 'button')
}

const rowButtons = await renderRows('ratify-row')
const rowLabels = [...new Set(rowButtons.map((node) => node.text))]
claim(
  'a ratifiable decision offers Approve and Decline on its own row',
  rowLabels.includes('Approve') && rowLabels.includes('Decline'),
  JSON.stringify(rowLabels),
)
claim(
  'and no row asks the human to go and answer a quiz somewhere else',
  !rowLabels.includes('Ratify…'),
  JSON.stringify(rowLabels),
)

// Approve: the click must record (record, decision) AND make the ratchet ask.
const rowApprove = rowButtons.find((node) => node.text === 'Approve')
if (rowApprove !== undefined) rowApprove.props.onClick()
const afterApprove = panelStore.getSnapshot().request
claim(
  'the Approve click records the record, the decision and when it happened',
  afterApprove !== null && afterApprove !== undefined &&
    typeof afterApprove.adrId === 'string' && afterApprove.adrId !== '' &&
    afterApprove.decision === 'approve' && typeof afterApprove.at === 'number',
  JSON.stringify(afterApprove),
)
claim(
  'and it makes the ratchet ask about that same record',
  asked.length === 1 && asked[0] === afterApprove.adrId,
  JSON.stringify(asked),
)

// Decline: the other button routes the OTHER decision, which a test that only clicked Approve
// could not tell.
panelStore.set({ request: null })
const declineButtons = await renderRows('ratify-row-decline')
const rowDecline = declineButtons.find((node) => node.text === 'Decline')
if (rowDecline !== undefined) rowDecline.props.onClick()
const afterDecline = panelStore.getSnapshot().request
claim(
  'the Decline click records a decline for that record, and asks for it',
  afterDecline !== null && afterDecline !== undefined &&
    afterDecline.decision === 'decline' && afterDecline.adrId === asked[1] && asked.length === 2,
  `request=${JSON.stringify(afterDecline)} asked=${JSON.stringify(asked)}`,
)

// ── the claiming entry, which is the only thing that can answer ─────────────
const composerRegistrationForRow = registry['conversation.composer']
const settleMembers = composerRegistrationForRow.config.inject()
/** One fresh interaction, so the once-only guard does not carry between cases. */
const freshPending = (answers) => ({
  questions: quiz.questions,
  answer(batch) {
    answers.push(batch)
    return Promise.resolve()
  },
  cancel() {
    return Promise.resolve()
  },
})
const targetId = ratifyQuestion.intent.targetId
let clearCount = 0

/**
 * Renders the claiming entry with one recorded request and reports what it settled.
 * @param expectCleared - whether the entry must also have consumed the request.
 */
const settleCase = async (name, request, expectedLabel, expectedDecision, expectCleared = false) => {
  const answers = []
  const clearsBefore = clearCount
  await flush(
    React.createElement(
      composerRegistrationForRow.Component,
      Object.assign({}, settleMembers, {
        matched: freshPending(answers),
        publishRatify: () => {},
        clearRequest: () => { clearCount += 1 },
        openPanel: () => {},
        usePanel: () => request,
      }),
    ),
    name,
  )
  const derived = answers.length === 0 ? null : deriveDecisions(quiz, answers[0])
  const settledOk =
    expectedLabel === null
      ? answers.length === 0
      : JSON.stringify(answers[0]) === JSON.stringify({ answers: [{ id: ratifyQuestion.id, selected: [expectedLabel] }] }) &&
        derived !== null &&
        derived.decisions.length === 1 &&
        derived.decisions[0].decision === expectedDecision &&
        derived.unreadable.length === 0
  const clearedOk = expectCleared ? clearCount === clearsBefore + 1 : true
  claim(name, settledOk && clearedOk, `answers=${JSON.stringify(answers)} cleared=${clearCount - clearsBefore} derived=${derived === null ? 'none' : JSON.stringify(derived.decisions)}`)
}
const fresh = () => Date.now()

await settleCase(
  "a click on Approve answers the question with the ratchet's own approve label",
  { adrId: targetId, decision: 'approve', at: fresh() },
  approveLabel,
  'approved',
)
await settleCase(
  "a click on Decline answers it with the ratchet's own reject label",
  { adrId: targetId, decision: 'decline', at: fresh() },
  declineLabel,
  'rejected',
)

// The record the click named, matched EXACTLY. A prefix, a suffix or stray whitespace is a
// different record, and answering it would consent to a decision nobody clicked on.
await settleCase(
  'a request naming a different record does not answer this question',
  { adrId: '0000-not-the-target', decision: 'approve', at: fresh() },
  null,
  null,
)
await settleCase(
  "a request whose id is only a PREFIX of this question's does not answer it",
  { adrId: targetId.slice(0, 1), decision: 'approve', at: fresh() },
  null,
  null,
)
await settleCase(
  'a request whose id carries an extra character does not answer it',
  { adrId: `${targetId}X`, decision: 'approve', at: fresh() },
  null,
  null,
)
await settleCase(
  'a request whose id differs by whitespace does not answer it',
  { adrId: ` ${targetId}`, decision: 'approve', at: fresh() },
  null,
  null,
)

// A click that outlived its ask. The record can be edited between the click and the question, so
// an armed answer must expire rather than consent to text the human never saw.
await settleCase(
  'a click older than the request lifetime does not answer a later question, and is discarded',
  { adrId: targetId, decision: 'approve', at: fresh() - 10 * 60 * 1000 },
  null,
  null,
  true,
)
await settleCase(
  'a request with no timestamp is not trusted either',
  { adrId: targetId, decision: 'approve' },
  null,
  null,
  true,
)
await settleCase(
  "with no click recorded, the panel does not answer on the human's behalf",
  null,
  null,
  null,
)

// One question, one answer. The harness THROWS on a second settlement, and a re-render or a
// re-mount is how a second one happens.
{
  const answers = []
  const element = React.createElement(
    composerRegistrationForRow.Component,
    Object.assign({}, settleMembers, {
      matched: freshPending(answers),
      publishRatify: () => {},
      clearRequest: () => {},
      openPanel: () => {},
      usePanel: () => ({ adrId: targetId, decision: 'approve', at: fresh() }),
    }),
  )
  await flush(element, 'settle-once-a')
  await flush(element, 'settle-once-b')
  claim(
    'the same question is answered once, however many renders it takes',
    answers.length === 1,
    `answers=${answers.length}`,
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
// ── the panel reads and does nothing else ───────────────────────────────────
// Every render above ran against a file surface that exposes only `list` and `read`, and
// every call was recorded. So this is a measurement of the whole plugin, not a reading of
// its source: there is no write path for the panel to record a consent through, which is
// the half of the consent surface that a bundle cannot be trusted to state about itself.
const distinctFileCalls = [...new Set(fileCalls)].sort()
claim(
  'the whole render lists and reads, and calls nothing else',
  distinctFileCalls.length > 0 && distinctFileCalls.every((name) => name === 'list' || name === 'read'),
  `calls=${JSON.stringify(distinctFileCalls)} of ${fileCalls.length}`,
)

// ── report ──────────────────────────────────────────────────────────────────
for (const entry of claims) {
  process.stdout.write(`  [${entry.ok ? 'PASS' : 'FAIL'}] ${entry.name}${entry.ok ? '' : ` — ${entry.detail}`}\n`)
}
if (failures.length > 0) {
  process.stderr.write(`adr panel render FAILED\n${failures.map((entry) => `  - ${entry}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('adr panel render ok\n')
