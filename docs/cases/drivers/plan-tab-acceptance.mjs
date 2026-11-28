#!/usr/bin/env node
/*
PROOF: the plan tab is the interface for the long-term plan: it lists the initiatives with work
left, the decisions newest first and the journal's open tasks from the real state/views/plan.md,
with one read and no command when it opens, names an empty and a missing plan in words, passes an
axe scan and switches tabs from the keyboard.
Behavior: mounting the real plugins/project-state-panel/client.js in Chromium on the real
  state/views/plan.md through the workspace-files transport: one read of that path, zero command
  calls; the rendered tab names the initiatives with work left, the decisions newest first and the
  open tasks; an empty file and a missing file are named; axe reports no violations; ArrowRight
  moves the selection and the focus between the five tabs.
Fails when: the plan tab is absent, the plan is read more than once or through a command, a section
  is missing or ordered wrongly, empty/missing is silent, axe finds a violation, or the keyboard
  does not move the tab.
Production path: plugins/project-state-panel/client.js (ProjectStatePage, the Plan tab) over the
  generated state/views/plan.md; Playwright, esbuild and axe are test engines, not product
  dependencies.
*/
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = process.env.PANEL_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DEPS = process.env.PANEL_DEPS ?? 'C:/Users/1/AppData/Local/Temp/panel-deps/node_modules'
const BROWSER = process.env.PANEL_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const { chromium } = await import(pathToFileURL(join(DEPS, 'playwright-core', 'index.mjs')).href)
const esbuild = await import(pathToFileURL(join(DEPS, 'esbuild', 'lib', 'main.js')).href)

let failures = 0
const check = (ok, label, detail) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail === undefined ? '' : ' - ' + detail))
  if (!ok) failures += 1
}

// The harness bundle: React, ReactDOM and axe, exposed to the page; the client source is fetched
// from the test server and evaluated by the harness, exactly as the shell's module loader does.
const buildDir = mkdtempSync(join(tmpdir(), 'plan-tab-harness-'))
const entry = join(DEPS, 'plan-harness-entry.mjs')
writeFileSync(entry, [
  "import React from 'react'",
  "import { createRoot } from 'react-dom/client'",
  "import axe from 'axe-core'",
  "window.__HARNESS__ = { React, createRoot, axe, reads: {}, commands: 0, page: null }",
  "",
].join('\n'))
const bundle = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  absWorkingDir: DEPS,
  logLevel: 'silent',
})
const bundleText = bundle.outputFiles[0].text

const HARNESS = `
const h = window.__HARNESS__;
async function mount(mode) {
  h.mode = mode;
  const source = await (await fetch('/client.js')).text();
  let exported = null;
  window.__ModuleLoader__ = { load: ({ factory }) => { exported = factory((name) => (name === 'react' ? h.React : null)); } };
  new Function('window', 'document', 'sessionStorage', source)(window, document, sessionStorage);
  let Page = null;
  const ctx = {
    slots: { inject(name, register) { register(); }, register(options, component) { if (options && options.name === 'main') Page = component; return () => {}; } },
    remote: {}, layout: {}, uiWorkspace: {}, logger: { warn() {}, info() {} }, effect: (fn) => { fn(); },
  };
  exported.apply(ctx);
  const remote = {
    workspaceFiles: {
      async read(sessionId, path, range) {
        h.reads[path] = (h.reads[path] || 0) + 1;
        const response = await fetch('/file?path=' + encodeURIComponent(path) + '&plan=' + encodeURIComponent(h.mode || 'real') + '&offset=' + (range && range.offset ? range.offset : 1) + '&limit=' + (range && range.limit ? range.limit : 5000));
        if (!response.ok) return { ok: false, error: { code: 'ENOENT', message: path + ' not found' } };
        return { ok: true, value: await response.json() };
      },
      async list() { return { ok: true, value: { entries: [] } }; },
    },
    commands: { call: async () => { h.commands += 1; return { ok: false }; } },
  };
  const props = {
    remote,
    useSessions: (selector) => selector({ byId: { 'session-1': { id: 'session-1', retainedBy: { mainView: 1 } } } }),
    useWorkspaces: (selector) => selector({ items: [{ id: 'ws-1', sessionIds: ['session-1'], updatedAt: '2026-01-01T00:00:00.000Z' }] }),
  };
  document.body.innerHTML = '<div id="root"></div>';
  h.page = h.createRoot(document.getElementById('root'));
  h.page.render(h.React.createElement(Page, props));
  return true;
}
h.mount = mount;
h.waitText = async (needle, timeout) => {
  const started = Date.now();
  while (Date.now() - started < (timeout || 4000)) {
    if (document.body.textContent.includes(needle)) return true;
    await new Promise((done) => setTimeout(done, 50));
  }
  return false;
};
h.bodyText = () => document.body.textContent;
window.__READY__ = true;
`

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><html lang="en"><head><title>Project state plan</title></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>')
    return
  }
  if (url.pathname === '/harness.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    response.end(bundleText + '\n' + HARNESS)
    return
  }
  if (url.pathname === '/client.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    response.end(readFileSync(join(ROOT, 'plugins', 'project-state-panel', 'client.js'), 'utf8'))
    return
  }
  if (url.pathname === '/file') {
    const path = url.searchParams.get('path') ?? ''
    const mode = url.searchParams.get('plan') ?? ''
    if (path === 'state/views/plan.md' && mode === 'empty') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ text: '', lines: 0, offset: 1, eof: true }))
      return
    }
    if (path === 'state/views/plan.md' && mode === 'missing') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'ENOENT' }))
      return
    }
    let text
    try {
      text = readFileSync(join(ROOT, path), 'utf8')
    } catch {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'ENOENT' }))
      return
    }
    const lines = text.split('\n')
    const offset = Number(url.searchParams.get('offset') ?? '1')
    const limit = Number(url.searchParams.get('limit') ?? '5000')
    const slice = lines.slice(Math.max(0, offset - 1), Math.max(0, offset - 1) + limit)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ text: slice.join('\n'), lines: slice.length, offset, eof: Math.max(0, offset - 1) + slice.length >= lines.length }))
    return
  }
  response.writeHead(404)
  response.end('not found')
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch({ executablePath: BROWSER, headless: true })
const context = await browser.newContext()
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
async function open(mode) {
  await page.goto(origin + '/?plan=' + mode)
  await page.waitForFunction('window.__READY__ === true')
  await page.evaluate('window.__HARNESS__.mount("' + mode + '")')
  await page.waitForTimeout(600)
}

// A. The real plan.
await open('real')
const planTab = await page.$('#ps-tab-plan')
check(planTab !== null, 'the panel has a plan tab (ps-tab-plan)')
if (planTab !== null) {
  await planTab.click()
  await page.waitForFunction('window.__HARNESS__.waitText("Long-term plan", 4000) || window.__HARNESS__.waitText("No generated plan", 4000)')
}
const live = await page.evaluate('({ reads: window.__HARNESS__.reads, commands: window.__HARNESS__.commands, text: window.__HARNESS__.bodyText() })')
const planReads = live.reads['state/views/plan.md'] ?? 0
check(planReads === 1, 'opening the plan reads state/views/plan.md exactly once', String(planReads))
check(live.commands === 0, 'opening the plan calls no command', String(live.commands))
check(live.text.includes('Initiatives with work left'), 'the tab lists the initiatives with work left')
check(live.text.includes('Decisions'), 'the tab lists the decisions')
const planText = readFileSync(join(ROOT, 'state/views/plan.md'), 'utf8')
const decisionIds = [...planText.matchAll(/^\| ?(DEC-[^ |]+)/gm)].map((match) => match[1])
if (decisionIds.length >= 2) {
  check(live.text.indexOf(decisionIds[0]) >= 0 && live.text.indexOf(decisionIds[0]) < live.text.indexOf(decisionIds[1]), 'the decisions are freshest first', decisionIds.slice(0, 2).join(' > '))
}
check(/Открытые задачи|Open journal tasks|open task/i.test(live.text), 'the tab lists the open tasks')
const axeResult = await page.evaluate('window.__HARNESS__.axe.run(document.getElementById("root"))')
check((axeResult.violations ?? []).length === 0, 'axe reports no violations', JSON.stringify((axeResult.violations ?? []).map((violation) => violation.id)))

// B. Empty and missing plans are named in words.
await open('empty')
if (await page.$('#ps-tab-plan') !== null) {
  await page.click('#ps-tab-plan')
  await page.waitForFunction('window.__HARNESS__.waitText("plan is empty", 4000) || window.__HARNESS__.waitText("No generated plan", 4000)')
}
const emptyText = await page.evaluate('window.__HARNESS__.bodyText()')
check(/plan is empty|No generated plan/i.test(emptyText), 'an empty plan is named in words', emptyText.slice(-200))
await open('missing')
if (await page.$('#ps-tab-plan') !== null) {
  await page.click('#ps-tab-plan')
  await page.waitForFunction('window.__HARNESS__.waitText("No generated plan", 4000)')
}
const missingText = await page.evaluate('window.__HARNESS__.bodyText()')
check(/No generated plan|Expected/i.test(missingText), 'a missing plan is named in words', missingText.slice(-200))

// C. The keyboard switches tabs from the plan tab and the focus follows.
await open('real')
const keyboardTab = await page.$('#ps-tab-plan')
if (keyboardTab === null) {
  check(false, 'ArrowRight moves the selection off the plan tab - the plan tab is absent')
} else {
  await page.click('#ps-tab-plan')
  await page.waitForFunction('window.__HARNESS__.waitText("Long-term plan", 4000)')
  await page.focus('#ps-tab-plan')
  await page.keyboard.press('ArrowRight')
  const afterKey = await page.evaluate('({ selected: document.querySelector("[role=tab][aria-selected=true]").id, focused: document.activeElement && document.activeElement.id })')
  check(afterKey.selected === 'ps-tab-req', 'ArrowRight moves the selection off the plan tab', afterKey.selected)
  check(afterKey.focused === afterKey.selected, 'the focus follows the selected tab', String(afterKey.focused))
}

check(errors.length === 0, 'the page logged no script error', errors.join(' | '))
await browser.close()
server.close()

if (failures > 0) {
  console.error('plan tab acceptance: ' + failures + ' check(s) failed')
  process.exit(1)
}
console.log('plan tab acceptance: all checks passed')

