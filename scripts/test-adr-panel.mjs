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
 * INPUTS
 *   None. The kit root is derived from this script's location, and every file read
 *   is the kit's own source. No network, no credentials, no harness, no model.
 *
 * OUTPUTS
 *   One `[PASS]`/`[FAIL]` line per assertion, then `adr panel render ok` and exit 0
 *   when every assertion held, or the failures on stderr and exit 1. A caller that
 *   greps for the marker cannot mistake a partial run for a pass.
 *
 * KEYWORDS
 *   adr panel, client bundle, render test, slots, state pill, provenance, tone,
 *   contract, browser half, stub loader
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
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  nodes.push({ tag: type, style: element.props.style, text: collectText(element) })
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
  await import(CLIENT)
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
const fileApi = {
  list(_sessionId, directory) {
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
    try {
      const absolute = join(KIT, relativePath)
      if (!statSync(absolute).isFile()) throw new Error('not a file')
      return Promise.resolve({ ok: true, value: { text: readFileSync(absolute, 'utf8'), eof: true } })
    } catch (error) {
      return Promise.resolve({ ok: false, error: { message: String(error.message) } })
    }
  },
}

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
const pills = (label) => nodes.filter((entry) => entry.tag === 'span' && entry.text === label && entry.style && entry.style.borderRadius === 999)
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

// ── report ──────────────────────────────────────────────────────────────────
for (const entry of claims) {
  process.stdout.write(`  [${entry.ok ? 'PASS' : 'FAIL'}] ${entry.name}${entry.ok ? '' : ` — ${entry.detail}`}\n`)
}
if (failures.length > 0) {
  process.stderr.write(`adr panel render FAILED\n${failures.map((entry) => `  - ${entry}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('adr panel render ok\n')
