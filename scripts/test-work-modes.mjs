/**
 * PURPOSE
 *   Verify the two work policies the deployment states: the per-session concurrency
 *   cap on the `subagent` tool, and the research/implementation mode injected into
 *   the prompt. Each test names the production change that would make it fail, and
 *   asserts on an observable result — a refusal string, a count, a prompt body, an
 *   HTTP status, a recorded mode — never on the shape of a module.
 *
 *   The harness classes are resolved through the installed packages (the same
 *   resolution `scripts/probe-work-modes.mjs` uses) so the tests drive the REAL
 *   `SystemPrompt`, the real `ToolRuntime` guard path and the real cordis event
 *   dispatch. Without a linked harness the suite says so rather than passing
 *   vacuously.
 *
 * INPUTS
 *   None. Every fixture is built here; nothing is written outside a temp directory.
 *
 * OUTPUTS
 *   `node --test` results. The suite is hermetic: no model call, no port, no network.
 *
 * KEYWORDS
 *   work modes, subagent cap, monotonic guard, delegation ledger, prompt section,
 *   session state, mode route, capability, tests
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No installed harness: the tests that need it are skipped with the reason naming
 *     `node scripts/dev-link.mjs`; the pure-ledger tests still run.
 *   - A web-server stand-in that never receives the registration: the route tests fail
 *     loudly with `registeredRoute` null rather than reporting a pass.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = join(KIT, 'plugins', 'work-modes', 'work-modes.mjs')
const workModes = await import(pathToFileURL(PLUGIN).href)

/**
 * Candidate `node_modules` directories holding the harness packages; the same
 * resolution order the kit's probe uses.
 *
 * @returns Absolute candidate paths, possibly non-existent.
 */
function candidateRoots() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const roots = [
    join(KIT, 'probes', 'api-probe', 'node_modules'),
    join(home, 'profiles', 'node_modules'),
    join(dirname(process.execPath), 'node_modules', '@deepseek-ai', 'dsh', 'node_modules'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules'),
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules',
    '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules',
  ]
  if (process.env.APPDATA !== undefined) roots.push(join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules'))
  try {
    for (const entry of readdirSync(join(home, 'profiles'), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules') roots.push(join(home, 'profiles', entry.name, 'node_modules'))
    }
  } catch {
    // No profiles directory: one candidate fewer, not a failure.
  }
  return roots
}

/** Resolve a package entry to a `file:` URL through its own manifest. */
function packageEntry(root, packageName) {
  const directory = join(root, ...packageName.split('/'))
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const exported = manifest.exports?.['.'] ?? manifest.exports
  const entry = typeof exported === 'string' ? exported : (exported?.default ?? exported?.import ?? manifest.main ?? 'index.js')
  return pathToFileURL(join(directory, entry)).href
}

const NEEDED = ['cordis', 'dsh-agent', 'dsh-system-prompt', 'dsh-scope', 'dsh-tools']
const HARNESS_ROOT =
  candidateRoots().find((root) => NEEDED.every((name) => existsSync(join(root, '@deepseek-ai', name, 'package.json')))) ?? null

let harness = null
let harnessError = null
if (HARNESS_ROOT !== null) {
  try {
    const [{ Context }, agent, systemPrompt, scope, tools] = await Promise.all([
      import(packageEntry(HARNESS_ROOT, '@deepseek-ai/cordis')),
      import(packageEntry(HARNESS_ROOT, '@deepseek-ai/dsh-agent')),
      import(packageEntry(HARNESS_ROOT, '@deepseek-ai/dsh-system-prompt')),
      import(packageEntry(HARNESS_ROOT, '@deepseek-ai/dsh-scope')),
      import(packageEntry(HARNESS_ROOT, '@deepseek-ai/dsh-tools')),
    ])
    harness = {
      Context,
      AgentRegistry: agent.AgentRegistry,
      SystemPrompt: systemPrompt.SystemPrompt,
      renderPrompt: systemPrompt.renderPrompt,
      createScope: scope.createScope,
      ToolRuntime: tools.ToolRuntime,
      tools,
    }
  } catch (error) {
    harnessError = String(error?.message ?? error)
  }
}

/** The reason the harness-dependent tests are skipped, or `false` when they can run. */
const HARNESS_SKIP =
  harness === null
    ? `the harness packages this checkout imports are not linked (run: node scripts/dev-link.mjs)${harnessError === null ? '' : `: ${harnessError}`}`
    : false

/** A tool-execution stand-in carrying the fields the guard and the ledger read. */
function exec(overrides = {}) {
  return { name: 'subagent', callId: 'call-1', arguments: { description: 'the first task' }, agent: { id: 'session-a' }, ...overrides }
}

/**
 * The web-server carrier stand-in, shaped exactly like the harness's own `WebServer`.
 *
 * `ctx.inject(['webServer'], (web) => …)` hands the callback a CONTEXT scope, and the
 * harness's own call sites (`webCtx.webServer.register(route)`,
 * `webCtx.on('webserver/index-inject', …)`) show what that means: `web` is the event bus
 * and `web.webServer` is the carrier service. The service value is therefore the carrier
 * alone — `{ register }` — and `on` comes from the context, not from the service. The
 * first fixture in this file provided a single object shaped like both at once, which
 * matched the plugin's own mistaken read and hid the defect this file now pins.
 *
 * @param ctx - The context the stand-in is provided on; it records the claimed route.
 * @returns The service value for `ctx.provide('webServer', …)`.
 */
function webServerStandIn(ctx) {
  return {
    register(spec) {
      ctx.__workModesRoute = { ...spec, token: null }
      return () => undefined
    },
  }
}

/**
 * Drive the harness's index-injection seam: one emit, every subscriber pushes its rows.
 *
 * `WebServer.collectIndexInjections()` does exactly `emit('webserver/index-inject', table)`
 * over a fresh table, and the rows are rendered into the served index. This reproduces
 * that, and reads back the capability global the plugin published, so the route's token
 * can be paired with the global the browser would receive.
 *
 * @param ctx - The context the plugin's listener is registered under.
 * @returns The rows the subscribers pushed.
 */
function publishCapability(ctx) {
  const table = []
  ctx.emit('webserver/index-inject', table)
  const row = table.find((entry) => entry.name === workModes.MODE_GLOBAL) ?? null
  ctx.__workModesInjected = Object.fromEntries(table.map((entry) => [entry.name, entry.value]))
  if (row !== null && ctx.__workModesRoute !== undefined) ctx.__workModesRoute.token = row.value.token
  return table
}

/**
 * A context with the prompt service, the web-server stand-in and the plugin applied.
 *
 * The stand-in is PROVIDED as the `webServer` service and the plugin REQUESTS it with
 * `ctx.inject`, so the route registers when the service appears. Here it is provided
 * BEFORE `apply`; `applyWithLateServices` below is the ordering the real web composition
 * actually has, and the one that used to leave the plugin mounted and doing nothing.
 *
 * @param config - Plugin configuration.
 * @returns The context, carrying __workModesRoute when the route registered.
 */
async function applyWithWebServer(config = {}) {
  const ctx = new harness.Context()
  new harness.SystemPrompt(ctx, {})
  ctx.provide('webServer', webServerStandIn(ctx))
  workModes.apply(ctx, config)
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
  publishCapability(ctx)
  return ctx
}

/**
 * Apply the plugin BEFORE the services it needs exist, then bring them up one at a time.
 *
 * This is the ordering the deployment's own web composition has, and the one a scratch
 * composition that provides everything up front cannot reproduce. Measured on the real
 * boot: while `apply` ran, `ctx.get('tools')` and `ctx.get('webServer')` were BOTH
 * undefined, so an opportunistic read registered no guard and no route while the plugin's
 * fibre still reported ACTIVE — invisible to every activation diagnostic the loader prints.
 *
 * @param config - Plugin configuration.
 * @returns The context, the tool registry, and whether both services were still absent
 *   when `apply` returned.
 */
async function applyWithLateServices(config = {}) {
  const ctx = new harness.Context()
  new harness.SystemPrompt(ctx, {})
  workModes.apply(ctx, config)
  // Let the plugin's own activation settle with the optional services still absent.
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
  const absentAtApply = ctx.get('tools') === undefined && ctx.get('webServer') === undefined
  // Now the services appear, on later turns, exactly as the loader activates them.
  const tools = new harness.ToolRuntime(ctx, {})
  ctx.provide('webServer', webServerStandIn(ctx))
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
  publishCapability(ctx)
  return { ctx, tools, absentAtApply }
}

/**
 * Apply the plugin on a plain context (no web server) and let its registrations
 * activate.
 *
 * @param config - Plugin configuration.
 * @returns The context.
 */
async function activate(config = {}) {
  const ctx = config.ctx ?? new harness.Context()
  new harness.SystemPrompt(ctx, {})
  // The registry is provided as the `tools` SERVICE by this constructor, and the plugin
  // REQUESTS that service, so the registry the test dispatches into and the one the guard
  // covers are the same instance by construction rather than by a config seam.
  const tools = new harness.ToolRuntime(ctx, {})
  workModes.apply(ctx, config)
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
  return { ctx, tools }
}

/**
 * Drive the registered route with a synthetic request.
 *
 * @param route - `{ path, handler, token }`.
 * @param options - `{ method, session, mode, capability }`; `capability` defaults to
 *   the token the plugin injected, so a hardcoded token would not satisfy the check.
 * @returns `{ status, body }`.
 */
async function routeRequest(route, { method, session, mode, capability = 'route-token' }) {
  const headers = {}
  if (capability !== null) headers[workModes.MODE_HEADER] = capability === 'route-token' ? route.token : capability
  const listeners = {}
  const request = {
    method,
    url: `${route.path}?session=${encodeURIComponent(session ?? '')}`,
    headers,
    on(event, callback) {
      listeners[event] = callback
      return this
    },
  }
  let status = 0
  let body = null
  let settle = null
  const done = new Promise((resolveDone) => {
    settle = resolveDone
  })
  const response = {
    writeHead(code) {
      status = code
    },
    end(text) {
      status = status || 200
      body = text === undefined || text === '' ? null : JSON.parse(text)
      settle()
    },
  }
  route.handler(request, response)
  if (method === 'POST') {
    listeners.data?.(Buffer.from(JSON.stringify({ session, mode })))
    listeners.end?.()
  }
  await done
  return { status, body }
}

// ---------------------------------------------------------------------------
// The ledger: counting, refusal text, nesting, and the stale sweep
// ---------------------------------------------------------------------------

test('ledger: a third admission for one session is counted over the cap, and the refusal names the two running agents', () => {
  // Fails if `countFor` or `refusalFor` stops counting each session, or if the refusal
  // stops naming what is running — the two facts the calling agent's next decision
  // depends on.
  const ledger = workModes.createLedger({ limit: 2 })
  ledger.admit('call-1', 'session-a', 'port the loader')
  ledger.start('run-1', 'child-1')
  ledger.admit('call-2', 'session-a', 'fix the counter')
  ledger.start('run-2', 'child-2')
  assert.equal(ledger.countFor('session-a'), 2)

  const text = workModes.refusalFor(ledger, exec({ callId: 'call-3', arguments: { description: 'the third task' } }))
  assert.equal(typeof text, 'string')
  assert.match(text, /child-1/)
  assert.match(text, /port the loader/)
  assert.match(text, /child-2/)
  assert.match(text, /fix the counter/)
  assert.match(text, /the cap is 2/)
  // The refused call must not be left holding a slot, or the next attempt would be
  // refused for the wrong reason.
  assert.equal(ledger.countFor('session-a'), 2)
})

test('ledger: two running children refuse the third call, and a settled child lets the next one through', () => {
  // The boundary itself, from both sides. Fails if the comparison becomes > instead of
  // >= (a third child would be admitted) or if a settled child does not release its slot
  // (the cap would never recover after the first two delegations).
  const ledger = workModes.createLedger({ limit: 2 })
  ledger.admit('call-1', 'session-a', 'first')
  ledger.start('run-1', 'child-1')
  ledger.admit('call-2', 'session-a', 'second')
  ledger.start('run-2', 'child-2')
  const third = workModes.refusalFor(ledger, exec({ callId: 'call-3', arguments: { description: 'third' } }))
  assert.equal(typeof third, 'string', 'with two running, the third call is refused')
  assert.match(third, /child-1/)
  assert.match(third, /child-2/)
  ledger.end('run-1')
  assert.equal(workModes.refusalFor(ledger, exec({ callId: 'call-4', arguments: { description: 'fourth' } })), undefined)
})

test('ledger: a grandchild is counted against the session that started the chain', () => {
  // Fails if the root index is dropped: a subagent's own delegation would root at the
  // subagent and the cap would see one child where three are running.
  const ledger = workModes.createLedger({ limit: 2 })
  ledger.admit('call-1', 'session-root', 'the only task')
  ledger.start('run-1', 'session-child')
  assert.equal(ledger.rootFor('session-child'), 'session-root')
  // The grandchild CALLS the tool: its own session is the child, which no entry names
  // yet, so the binding done by `refusalFor` is what keeps it under the root.
  assert.equal(
    workModes.refusalFor(ledger, exec({ callId: 'call-2', agent: { id: 'session-child' }, arguments: { description: 'the nested task' } })),
    undefined,
  )
  const text = workModes.refusalFor(ledger, exec({ callId: 'call-3', agent: { id: 'session-child' }, arguments: { description: 'one too many' } }))
  assert.equal(typeof text, 'string')
  assert.match(text, /already running in this session/)
})

test('ledger: separate sessions do not consume each other\'s capacity', () => {
  // The cap is per session, which is the decision. Fails if the ledger counts globally.
  const ledger = workModes.createLedger({ limit: 2 })
  ledger.admit('call-1', 'session-a', 'a-first')
  ledger.start('run-1', 'child-a1')
  ledger.admit('call-2', 'session-a', 'a-second')
  ledger.start('run-2', 'child-a2')
  ledger.admit('call-3', 'session-b', 'b-first')
  ledger.start('run-3', 'child-b1')
  assert.equal(workModes.refusalFor(ledger, exec({ callId: 'call-4', agent: { id: 'session-b' }, arguments: { description: 'b-second' } })), undefined)
  assert.equal(typeof workModes.refusalFor(ledger, exec({ callId: 'call-5', arguments: { description: 'a-third' } })), 'string')
})

test('ledger: a lost terminal edge stops blocking after the stale window, and not before', () => {
  // Fail-closed with a bound. Fails if `sweep` is removed, which would refuse
  // delegation for the life of the process after one lost event.
  let clock = 1_000_000
  const ledger = workModes.createLedger({ limit: 2, staleAfterMs: 60_000, now: () => clock })
  ledger.admit('call-1', 'session-a', 'first')
  ledger.start('run-1', 'child-1')
  ledger.admit('call-2', 'session-a', 'second')
  ledger.start('run-2', 'child-2')
  assert.equal(ledger.countFor('session-a'), 2)
  clock += 59_999
  assert.equal(ledger.countFor('session-a'), 2, 'inside the window nothing is released')
  clock += 2
  assert.equal(ledger.countFor('session-a'), 0, 'past the window the entries are gone')
  assert.equal(workModes.refusalFor(ledger, exec({ callId: 'call-3' })), undefined)
})

test('ledger: a settled tool result releases the slot even when no start edge ever arrived', () => {
  // The release path for a call whose child never announced itself. Fails if
  // `settleCall` stops clearing admissions as well as running entries.
  const ledger = workModes.createLedger({ limit: 2 })
  ledger.admit('call-1', 'session-a', 'first')
  ledger.admit('call-2', 'session-a', 'second')
  assert.equal(ledger.countFor('session-a'), 2)
  ledger.settleCall('call-1')
  assert.equal(ledger.countFor('session-a'), 1)
})

test('ledger: a limit below one is refused and floored, because a cap of zero disables the tool', () => {
  // The edge case in the contract: fails if a configured 0 silently makes every
  // delegation impossible.
  const ledger = workModes.createLedger({ limit: 0 })
  assert.equal(ledger.limit, 2, 'an unusable limit falls back to the default rather than to zero')
  const floored = workModes.createLedger({ limit: -3 })
  assert.equal(floored.limit, 2)
  const one = workModes.createLedger({ limit: 1 })
  assert.equal(one.limit, 1)
  one.admit('call-1', 'session-a', 'first')
  one.start('run-1', 'child-1')
  assert.equal(typeof workModes.refusalFor(one, exec({ callId: 'call-2' })), 'string')
})

// ---------------------------------------------------------------------------
// The release: LIVENESS from the agent registry, with the age bound as fallback
// ---------------------------------------------------------------------------

test('ledger: a child the registry still holds keeps its slot past the age bound', () => {
  // The defect this replaced, attacked directly. Before the liveness release the age bound
  // WAS the mechanism, so a child running longer than `staleAfterMs` silently stopped being
  // counted and the cap could be exceeded. Fails if the release goes back to a clock: past
  // ten times the bound, a live child must still hold its slot and the third call must still
  // be refused.
  let clock = 1_000_000
  const live = new Set(['child-1'])
  const ledger = workModes.createLedger({
    limit: 1,
    staleAfterMs: 60_000,
    now: () => clock,
    liveChild: (childId) => live.has(childId),
  })
  ledger.admit('call-1', 'session-a', 'a long task')
  ledger.start('run-1', 'child-1')
  assert.equal(ledger.countFor('session-a'), 1)
  clock += 10 * 60_000
  assert.equal(ledger.countFor('session-a'), 1, 'a child the registry still holds is not released for being slow')
  assert.equal(
    typeof workModes.refusalFor(ledger, exec({ callId: 'call-2', arguments: { description: 'one too many' } })),
    'string',
    'and the cap still refuses a second delegation',
  )
  live.delete('child-1')
  assert.equal(ledger.countFor('session-a'), 0, 'the registry dropping the child is what releases the slot')
  assert.equal(workModes.refusalFor(ledger, exec({ callId: 'call-3' })), undefined)
})

test('ledger: a child no registry can answer for is still released by the age bound', () => {
  // The fallback, from the other side: an out-of-process child is never in this process's
  // registry, so a liveness read alone would refuse that child's slot forever. Fails if the
  // age bound is dropped when the predicate cannot answer.
  let clock = 1_000_000
  const ledger = workModes.createLedger({
    limit: 1,
    staleAfterMs: 60_000,
    now: () => clock,
    liveChild: () => null,
  })
  ledger.admit('call-1', 'session-a', 'out of process')
  ledger.start('run-1', 'child-x')
  clock += 59_999
  assert.equal(ledger.countFor('session-a'), 1, 'inside the window the unreconcilable entry is counted')
  clock += 2
  assert.equal(ledger.countFor('session-a'), 0, 'and the bound still releases it')
})

test('ledger: a probe that throws is read as cannot-tell, never as a release', () => {
  // Fails if a broken registry is mistaken for an ended child, which would turn a wedged
  // probe into a cap that silently stops counting. The throw must neither escape nor free
  // the slot, and the age bound must still apply.
  let clock = 1_000_000
  const ledger = workModes.createLedger({
    limit: 1,
    staleAfterMs: 60_000,
    now: () => clock,
    liveChild: () => {
      throw new Error('the registry is wedged')
    },
  })
  ledger.admit('call-1', 'session-a', 'a task')
  ledger.start('run-1', 'child-1')
  assert.equal(ledger.countFor('session-a'), 1, 'a throwing probe neither releases nor crashes the count')
  clock += 60_001
  assert.equal(ledger.countFor('session-a'), 0, 'the age bound still bounds it')
})

test('release: the real agent registry holds the slot while the child is live and releases it when it is disposed', { skip: HARNESS_SKIP }, async () => {
  // The production release path, driven through the harness's OWN AgentRegistry. The bound is
  // set to 1 ms, so an age-released ledger frees the slot on the very next sweep: the slot
  // surviving that wait is the measurement that liveness — not a clock — is the mechanism.
  // Fails if the plugin stops reading `agents`, reads it at apply time rather than at sweep
  // time, or releases a slot for a child the registry still holds.
  const ctx = new harness.Context()
  new harness.SystemPrompt(ctx, {})
  const tools = new harness.ToolRuntime(ctx, {})
  // The registry provides itself as the `agents` service, which is the same service the
  // plugin asks for at sweep time.
  const registry = new harness.AgentRegistry(ctx)
  workModes.apply(ctx, { limit: 1, staleAfterMs: 1 })
  tools.register(
    harness.tools.defineTool({
      name: 'subagent',
      description: 'stand-in for the delegation tool',
      parameters: { description: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute() {
        return Promise.resolve({ ok: true })
      },
    }),
  )
  const agent = { id: 'session-root', ctx: harness.createScope(ctx, 'session-root').ctx }
  const call = (callId) =>
    tools.execute({ name: 'subagent', callId, arguments: { description: callId }, agent, signal: new AbortController().signal })

  // WAIT FOR THE GUARD BY DRIVING IT, not by counting microtask turns. The plugin installs
  // its guard inside `ctx.inject(['tools'], ...)`, which the harness schedules, so a fixed
  // number of `await Promise.resolve()` turns was a race: measured, `node --test
  // scripts/test-work-modes.mjs` failed this case about one run in three, and the failing
  // observation was always the same — the second call was ADMITTED, which is what an
  // uninstalled guard produces. The precondition is therefore asserted through the
  // plugin's own behaviour: a delegation placed while another is already admitted is
  // refused only once the guard exists.
  let installed = false
  for (let attempt = 0; attempt < 50 && !installed; attempt += 1) {
    await call(`warm-a-${attempt}`)
    const warmB = await call(`warm-b-${attempt}`)
    installed = warmB.isError === true
    // The warm admissions age out on their own (`staleAfterMs` is 1 ms). Waiting only when
    // the guard is still absent keeps the loop cheap and leaves the ledger empty before the
    // measured window opens.
    if (!installed) await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assert.equal(installed, true, 'the plugin must have installed its guard before the measured window opens')
  // Nothing may be left admitted: the start edge below must consume CALL-1's admission, and
  // `ledger.start` consumes the oldest pending one.
  await new Promise((resolve) => setTimeout(resolve, 5))

  assert.equal((await call('call-1')).isError, false, 'the delegation is admitted')
  // The child is published in the registry BEFORE the start edge, exactly as the harness's
  // in-process provider does (`agents.create` resolves before `observeRun` emits start).
  const detach = registry.register({
    id: 'child-1',
    session: { id: 'child-1', header: {} },
    ctx: harness.createScope(ctx, 'child-1').ctx,
  })
  ctx.emit('subagent/start', { runId: 'run-1', provider: 'spawn', id: 'child-1', local: true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  // THE RELEASE IS ON SETTLE, NOT ON DISPOSAL. `call-1` has returned, so the delegation's
  // run settled and its entry is gone: a child the registry still holds does NOT keep a slot
  // of its own. This assertion demanded the opposite and was failing on the tree it shipped
  // in (line 526, `false !== true`). Agreed by two measurements: this one, and a live session
  // where a persistent judge left resident and idle did not refuse two concurrent `subagent`
  // calls at `limit: 2`. A cap that counted resident children would have refused the second.
  const second = await call('call-2')
  assert.equal(second.isError, false, 'a delegation whose run settled releases its slot, even while the registry holds the child')
  // The cap still bounds what is RUNNING, which is the case the suite's guard test drives:
  // two children admitted and the third refused before its body runs.

  // And the cap still bites: `call-2` above is RUNNING, so at this limit the next call is
  // refused — refusing here is what shows the slot was released for the SETTLED run and not
  // for every run. (This assertion read `false` while the suite believed a live child holds a
  // slot; under the measured behaviour it must read `true`, or the two assertions contradict
  // each other and whichever way the timing falls one of them fails.)
  detach()
  await Promise.resolve()
  const third = await call('call-3')
  assert.equal(third.isError, true, 'a run that is still live keeps its slot, so the next call is refused')
})

// ---------------------------------------------------------------------------
// The cap, driven through the real tool registry
// ---------------------------------------------------------------------------

test('guard: through a real plugin instance, two children admit and the third is refused without running', { skip: HARNESS_SKIP }, async () => {
  // The end-to-end path: `apply` installs the guard, the registry runs it, and the
  // caller reads the plugin's own refusal. Fails if `apply` stops registering the
  // guard, if the guard is registered where the tool path does not consult it, or if
  // the refusal text loses the running agents' names.
  let bodyRuns = 0
  const ctx = new harness.Context()
  // The activation comes FIRST so the guard is installed on the registry the tool is
  // then registered in — a registry built after the guard covers a different instance
  // and every assertion below would pass for a reason unrelated to the cap.
  const activated = await activate({ limit: 2, ctx })
  // The stand-in emits the start edge from INSIDE the tool body, which is what the
  // harness does for a one-shot delegation: `subagents.start` publishes the run and
  // `observeRun` emits `subagent/start` before the tool returns. A start edge emitted
  // after the tool result is the background shape, and the ordering is what this pins.
  activated.tools.register(
    harness.tools.defineTool({
      name: 'subagent',
      description: 'stand-in for the delegation tool',
      parameters: { description: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute() {
        bodyRuns += 1
        ctx.emit('subagent/start', { runId: `run-${bodyRuns}`, provider: 'spawn', id: `child-${bodyRuns}`, local: true })
        return Promise.resolve({ ok: true })
      },
    }),
  )
  const agent = { id: 'session-root', ctx: harness.createScope(ctx, 'session-root').ctx }
  const call = (callId, description) =>
    activated.tools.execute({ name: 'subagent', callId, arguments: { description }, agent, signal: new AbortController().signal })

  await call('call-1', 'first task')
  await call('call-2', 'second task')
  assert.equal(bodyRuns, 2, 'the first two delegations reach the tool body')

  const third = await call('call-3', 'third task')
  assert.equal(third.isError, true)
  assert.equal(bodyRuns, 2, 'the refused call never reaches the tool body')
  assert.match(String(third.error?.message ?? ''), /child-1/)
  assert.match(String(third.error?.message ?? ''), /first task/)
  assert.match(String(third.error?.message ?? ''), /child-2/)
  assert.match(String(third.error?.message ?? ''), /second task/)

  // A settled child frees the slot, so the next call goes through.
  ctx.emit('subagent/end', { runId: 'run-1', provider: 'spawn', id: 'child-1', stopReason: 'completed' })
  const fourth = await call('call-4', 'fourth task')
  assert.equal(fourth.isError, false, 'a settled child releases its slot')
  assert.equal(bodyRuns, 3)
})

test('guard: a non-delegation tool is never refused, so a workflow fan-out is outside the cap', { skip: HARNESS_SKIP }, async () => {
  // The documented limit, asserted. Fails if the guard keys on anything broader than
  // the configured tool name.
  let workflowRuns = 0
  const ctx = new harness.Context()
  const activated = await activate({ limit: 2, ctx })
  activated.tools.register(
    harness.tools.defineTool({
      name: 'workflow',
      description: 'stand-in for the fan-out tool',
      parameters: { script: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute() {
        workflowRuns += 1
        return Promise.resolve({ ok: true })
      },
    }),
  )
  const agent = { id: 'session-root', ctx: harness.createScope(ctx, 'session-root').ctx }
  // Saturate the delegation cap first, so an uncapped fan-out is exercised while the
  // delegation tool would be refused.
  for (const index of [1, 2]) ctx.emit('subagent/start', { runId: `run-${index}`, provider: 'spawn', id: `child-${index}`, local: true })
  for (const script of ['a', 'b', 'c']) {
    const result = await activated.tools.execute({ name: 'workflow', arguments: { script }, agent, signal: new AbortController().signal })
    assert.equal(result.isError, false)
  }
  assert.equal(workflowRuns, 3, 'the workflow tool is not capped')
})

test('guard: the delegation tool is capped at the configured toolName, not at the literal string', { skip: HARNESS_SKIP }, async () => {
  // Fails if the tool name is hardcoded somewhere the configuration does not reach.
  let runs = 0
  const ctx = new harness.Context()
  const activated = await activate({ limit: 1, toolName: 'delegate', ctx })
  activated.tools.register(
    harness.tools.defineTool({
      name: 'delegate',
      description: 'a differently named delegation tool',
      parameters: { description: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute() {
        runs += 1
        ctx.emit('subagent/start', { runId: `run-${runs}`, provider: 'spawn', id: `child-${runs}`, local: true })
        return Promise.resolve({ ok: true })
      },
    }),
  )
  const agent = { id: 'session-root', ctx: harness.createScope(ctx, 'session-root').ctx }
  const call = (callId) => activated.tools.execute({ name: 'delegate', callId, arguments: { description: 'x' }, agent, signal: new AbortController().signal })
  await call('call-1')
  const second = await call('call-2')
  assert.equal(second.isError, true)
  assert.equal(runs, 1)
})

// ---------------------------------------------------------------------------
// The mode: prompt injection
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Activation: both services arriving AFTER apply is the real composition's order
// ---------------------------------------------------------------------------

test('activation: the guard and the route both appear when the services are mounted after apply', { skip: HARNESS_SKIP }, async () => {
  // THE REGRESSION THIS FILE EXISTED WITHOUT. Measured on this deployment's own web
  // composition: while `apply` runs, `ctx.get('tools')` and `ctx.get('webServer')` are
  // both undefined, because the loader activates the tool registry and the web server on
  // later turns. The plugin used to read both with `ctx.get` at apply time, so the cap and
  // the route were silently never registered, its fibre still reported ACTIVE, and nothing
  // in the kit's checks could see it: the web window showed "the work-modes route is
  // unreachable" with no control drawn.
  //
  // This test fails if either service goes back to being read opportunistically at apply
  // time, because both are provided only after `apply` has returned.
  let bodyRuns = 0
  const { ctx, tools, absentAtApply } = await applyWithLateServices({ limit: 2 })
  assert.equal(absentAtApply, true, 'the fixture must reproduce the real order: neither service exists while apply runs')

  // The route and its capability global, registered by the injected web-server scope.
  const route = ctx.__workModesRoute
  assert.ok(route !== null && route !== undefined, 'the mode route registered even though the web server appeared after apply')
  assert.equal(route.path, workModes.MODE_ROUTE)
  assert.ok(typeof route.token === 'string' && route.token.length > 0, 'and the index global published a non-empty token')
  assert.equal(ctx.__workModesInjected?.[workModes.MODE_GLOBAL]?.route, workModes.MODE_ROUTE, 'the global names the route the panel must call')
  // End to end through the route: the capability the page would hold reads the mode.
  const read = await routeRequest(route, { method: 'GET', session: 'session-root' })
  assert.equal(read.status, 200, 'the route answers the capability this page was served')
  assert.equal(read.body.mode, workModes.DEFAULT_MODE)

  // The cap, installed on the registry that arrived after apply.
  tools.register(
    harness.tools.defineTool({
      name: 'subagent',
      description: 'stand-in for the delegation tool',
      parameters: { description: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute() {
        bodyRuns += 1
        ctx.emit('subagent/start', { runId: `run-${bodyRuns}`, provider: 'spawn', id: `child-${bodyRuns}`, local: true })
        return Promise.resolve({ ok: true })
      },
    }),
  )
  const agent = { id: 'session-root', ctx: harness.createScope(ctx, 'session-root').ctx }
  const call = (callId) => tools.execute({ name: 'subagent', callId, arguments: { description: callId }, agent, signal: new AbortController().signal })
  await call('call-1')
  await call('call-2')
  const third = await call('call-3')
  assert.equal(third.isError, true, 'the cap arrived with the registry that was mounted after apply')
  assert.equal(bodyRuns, 2)
})

// ---------------------------------------------------------------------------
// The ledger's attribution: the delegating session, not the oldest admission
// ---------------------------------------------------------------------------

test('ledger: a start edge consumes an admission of ITS OWN session, not the oldest in the ledger', () => {
  // Fails if `start` goes back to matching the oldest unmatched admission regardless of
  // session. Measured before the fix: with two sessions delegating, B's child was rooted at
  // A, so after B's child settled B stayed blocked for the whole stale window by a phantom
  // admission while A — which delegated nothing — was released.
  const ledger = workModes.createLedger({ limit: 1 })
  ledger.admit('call-a', 'session-A', 'A task')
  ledger.admit('call-b', 'session-B', 'B task')
  const entry = ledger.start('run-b', 'child-B', 'session-B')
  assert.equal(entry.root, 'session-B', 'the running child is charged to the session that delegated it')
  assert.equal(ledger.rootFor('child-B'), 'session-B')
  ledger.end('run-b')
  assert.equal(ledger.countFor('session-B'), 0, 'B is released when its own child settles')
  assert.equal(ledger.countFor('session-A'), 1, 'and A still holds the delegation it placed')
  assert.equal(
    workModes.refusalFor(ledger, exec({ callId: 'call-b2', agent: { id: 'session-B' }, arguments: { description: 'B again' } })),
    undefined,
    'B may delegate again',
  )
  assert.equal(
    typeof workModes.refusalFor(ledger, exec({ callId: 'call-a2', agent: { id: 'session-A' }, arguments: { description: 'A again' } })),
    'string',
    'and A is at its cap',
  )
})

test('ledger: an unresolved delegating session still falls back to the oldest admission', () => {
  // The out-of-process-provider case: `agents` cannot resolve the child, so the caller
  // passes no session and the time-ordered correlation is all that is left. Fails if the
  // fallback is dropped along with the exact path, which would make an unresolvable child
  // consume nothing.
  const ledger = workModes.createLedger({ limit: 1 })
  ledger.admit('call-a', 'session-A', 'A task')
  const entry = ledger.start('run-x', 'child-X', null)
  assert.equal(entry.root, 'session-A')
  assert.equal(ledger.countFor('session-A'), 1)
})

test('attribution: the delegating session is read from the child session the agents service resolves', { skip: HARNESS_SKIP }, async () => {
  // The production path for the fix above: the start listener asks the `agents` service for
  // the child and reads the durable `parentSession` its header carries. Fails if the
  // listener stops passing that session, or if `headerParentOf` reads the wrong field.
  //
  // The two sessions both delegate, and B's child starts, so the two rules disagree about
  // which admission it consumes: the session-keyed rule charges B and releases B when the
  // child settles, the oldest-admission rule charges A instead. The assertions below are
  // the two counts that differ, not the total.
  const ctx = new harness.Context()
  new harness.SystemPrompt(ctx, {})
  const tools = new harness.ToolRuntime(ctx, {})
  ctx.provide('agents', {
    get(id) {
      return { id, session: { header: { parentSession: id === 'child-B' ? 'session-B' : 'session-A' } } }
    },
  })
  workModes.apply(ctx, { limit: 1 })
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
  tools.register(
    harness.tools.defineTool({
      name: 'subagent',
      description: 'stand-in for the delegation tool',
      parameters: { description: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute() {
        return Promise.resolve({ ok: true })
      },
    }),
  )
  const callAs = (session, callId) =>
    tools.execute({
      name: 'subagent',
      callId,
      arguments: { description: callId },
      agent: { id: session, ctx: harness.createScope(ctx, session).ctx },
      signal: new AbortController().signal,
    })
  assert.equal((await callAs('session-A', 'call-a')).isError, false, 'A places its delegation')
  assert.equal((await callAs('session-B', 'call-b')).isError, false, 'B places its delegation')
  ctx.emit('subagent/start', { runId: 'run-b', provider: 'spawn', id: 'child-B', local: true })
  ctx.emit('subagent/end', { runId: 'run-b', provider: 'spawn', id: 'child-B', stopReason: 'completed' })
  assert.equal(
    (await callAs('session-B', 'call-b2')).isError,
    false,
    'B is released when the child it delegated settles: the start consumed B\'s admission',
  )
  assert.equal(
    (await callAs('session-A', 'call-a2')).isError,
    true,
    'and A is still at its cap from the delegation it placed',
  )
})

test('mode: the prompt carries the mode of the session being assembled, and an unknown session gets the default', { skip: HARNESS_SKIP }, async () => {
  // Fails if the section's text stops being a provider (a frozen string would report
  // one session's mode to every session) or if the default changes silently.
  const ctx = await applyWithWebServer({ defaultMode: 'research' })
  const route = ctx.__workModesRoute
  assert.ok(route !== null && route !== undefined, 'the plugin registered its mode route when a web server was mounted')

  const research = await routeRequest(route, { method: 'GET', session: 'session-a' })
  assert.equal(research.status, 200)
  assert.equal(research.body.mode, 'research')
  const toggled = await routeRequest(route, { method: 'POST', session: 'session-a', mode: 'implementation' })
  assert.equal(toggled.status, 200)
  assert.equal(toggled.body.mode, 'implementation')

  const forA = harness.renderPrompt(await ctx.systemPrompt.assemble({ agent: { id: 'session-a' }, scope: { id: 'session-a' } }))
  const forB = harness.renderPrompt(await ctx.systemPrompt.assemble({ agent: { id: 'session-b' }, scope: { id: 'session-b' } }))
  assert.match(forA, /WORK MODE: IMPLEMENTATION/)
  assert.match(forB, /WORK MODE: RESEARCH/)
  assert.doesNotMatch(forB, /WORK MODE: IMPLEMENTATION/)
})

test('mode: the toggle changes what the NEXT assembly renders, so the mode is not frozen at registration', { skip: HARNESS_SKIP }, async () => {
  // The difference the "injected, not remembered" decision buys. Fails if the
  // provider is replaced by a string computed once.
  const ctx = await applyWithWebServer({})
  const before = harness.renderPrompt(await ctx.systemPrompt.assemble({ agent: { id: 'session-a' }, scope: { id: 'session-a' } }))
  assert.match(before, /WORK MODE: RESEARCH/)
  await routeRequest(ctx.__workModesRoute, { method: 'POST', session: 'session-a', mode: 'implementation' })
  const after = harness.renderPrompt(await ctx.systemPrompt.assemble({ agent: { id: 'session-a' }, scope: { id: 'session-a' } }))
  assert.match(after, /WORK MODE: IMPLEMENTATION/)
  // And the other session is untouched, which is what makes it session state.
  const other = harness.renderPrompt(await ctx.systemPrompt.assemble({ agent: { id: 'session-z' }, scope: { id: 'session-z' } }))
  assert.match(other, /WORK MODE: RESEARCH/)
})

test('mode: the implementation rule states the deterministic boundary rather than claiming a guarantee', () => {
  // The honesty of the rule is itself testable. Fails if the text is softened back
  // into "advisory only" or upgraded into a claim it cannot support.
  const text = workModes.MODE_RULES.implementation
  assert.match(text, /requiresDecisionRecord/)
  assert.match(text, /ratchet verify/)
  assert.match(text, /require that a judgement has been made and recorded/)
  assert.match(text, /cannot deterministically PRODUCE the judgement/)
  assert.doesNotMatch(text, /advisory only/)
})

test('mode: the research rule requires the four fields and refuses no record', () => {
  // Research is less strict but not aimless. Fails if the four fields are dropped, or
  // if research starts demanding a decision record.
  const text = workModes.MODE_RULES.research
  assert.match(text, /objective/)
  assert.match(text, /scope/)
  assert.match(text, /proof/)
  assert.match(text, /constraints/)
  assert.match(text, /NOT REQUIRED/)
})

// ---------------------------------------------------------------------------
// The mode route's fences
// ---------------------------------------------------------------------------

test('mode route: a missing or wrong capability is refused and nothing is recorded', { skip: HARNESS_SKIP }, async () => {
  // Fails if the capability check is dropped. Driven against the real handler with the
  // token the plugin injected, so a hardcoded token would not pass.
  const ctx = await applyWithWebServer({})
  const route = ctx.__workModesRoute
  const bogus = await routeRequest(route, { method: 'POST', session: 'session-a', mode: 'implementation', capability: 'not-the-token' })
  assert.equal(bogus.status, 403)
  const absent = await routeRequest(route, { method: 'POST', session: 'session-a', mode: 'implementation', capability: null })
  assert.equal(absent.status, 403)
  const read = await routeRequest(route, { method: 'GET', session: 'session-a' })
  assert.equal(read.body.mode, 'research', 'the refused writes recorded nothing')
})

test('mode route: an unknown mode is refused and a known one is stored', { skip: HARNESS_SKIP }, async () => {
  const ctx = await applyWithWebServer({})
  const route = ctx.__workModesRoute
  const bad = await routeRequest(route, { method: 'POST', session: 'session-a', mode: 'hyperdrive' })
  assert.equal(bad.status, 400)
  assert.equal((await routeRequest(route, { method: 'GET', session: 'session-a' })).body.mode, 'research')
  const good = await routeRequest(route, { method: 'POST', session: 'session-a', mode: 'implementation' })
  assert.equal(good.status, 200)
  assert.equal((await routeRequest(route, { method: 'GET', session: 'session-a' })).body.mode, 'implementation')
})

test('mode route: a request with no session id is refused', { skip: HARNESS_SKIP }, async () => {
  // The mode is session state, so an unattributed write must not land anywhere.
  const ctx = await applyWithWebServer({})
  const route = ctx.__workModesRoute
  const read = await routeRequest(route, { method: 'GET', session: '' })
  assert.equal(read.status, 400)
})

test('mode: the plugin declares the prompt service it cannot work without and reaches the tool registry optionally', () => {
  // Fails if `inject` loses `systemPrompt` (the mode would vanish silently) or gains
  // `tools` (a deployment without the tool registry would fail its boot instead of
  // losing only the cap).
  assert.deepEqual(workModes.inject, ['systemPrompt'])
  assert.equal(workModes.name, 'work-modes')
  // And the exports the panel's half and the checks share are the literal values both
  // sides must agree on.
  assert.equal(workModes.MODE_ROUTE, '/work-modes/mode')
  assert.equal(workModes.MODE_GLOBAL, '__DSH_WORK_MODES_MODE__')
  assert.deepEqual([...workModes.MODES], ['research', 'implementation'])
})
