/**
 * PURPOSE
 *   Verify the one work policy the deployment states: the per-session concurrency cap
 *   on the `subagent` tool. The cases assert an observable result — a refusal naming
 *   the two running agents, an admission that happens, a non-delegation call that is
 *   never refused, and the ledger's own count letting the next child through once a
 *   settled run releases its slot. The per-branch cases over the ledger's internals
 *   (grandchildren, separate sessions, the stale window, a throwing probe, a floored
 *   limit) were removed under the small-behavioural-suite ruling.
 *
 *   There are NO work modes. The research/implementation mode was removed, so nothing
 *   here asserts on a prompt section, a mode route or per-session mode state; the tests
 *   for those were deleted with the mechanism.
 *
 *   The harness classes are resolved through the installed packages (the same
 *   resolution `scripts/probe-work-modes.mjs` uses) so the tests drive the REAL
 *   `ToolRuntime` guard path and the real cordis event dispatch. Without a linked
 *   harness the suite says so rather than passing vacuously.
 *
 * INPUTS
 *   None. Every fixture is built here; nothing is written outside a temp directory.
 *
 * OUTPUTS
 *   `node --test` results. The suite is hermetic: no model call, no port, no network.
 *
 * KEYWORDS
 *   subagent cap, monotonic guard, delegation ledger, tests
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No installed harness: the cases that need it are skipped with the reason naming
 *     `node scripts/dev-link.mjs`. One case drives the ledger directly and always runs,
 *     so a suite whose harness is missing fails on a wrong cap instead of passing with
 *     every assertion skipped.
 *   - A guard that never refuses: the cap cases fail loudly rather than passing
 *     vacuously.
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

// ---------------------------------------------------------------------------
// The ledger: counting, refusal text, nesting, and the stale sweep
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The release: LIVENESS from the agent registry, with the age bound as fallback
// ---------------------------------------------------------------------------

test('release: a run that is still live holds the slot, and its terminal edge releases it', { skip: HARNESS_SKIP }, async () => {
  // The mechanism, driven through a real plugin instance and the real tool registry: a child that
  // has started holds its slot however much wall-clock passes, and the run's terminal edge is what
  // releases it. NOTHING here waits on a clock, which is what makes the suite reproducible. The
  // version this replaces set the age bound to 1 ms, slept 20 ms and asserted the slot had been
  // released; measured over five consecutive runs on one unchanged tree it failed four times, and
  // the failing assertion alternated between the two either side of the race — because under a
  // 1 ms bound "released by age" and "released by settle" are indistinguishable, so the two
  // assertions could not both hold under either timing.
  //
  // Fails if the plugin stops installing the guard, stops counting a started child, or stops
  // releasing on the terminal edge.
  let bodyRuns = 0
  const ctx = new harness.Context()
  const activated = await activate({ limit: 1, ctx })
  // The start edge is emitted from INSIDE the body, which is the shape the harness produces for a
  // one-shot delegation: `subagents.start` publishes the run and `observeRun` emits
  // `subagent/start` before the tool returns. That ordering is also what lets the ledger correlate
  // the start with the admission (`ledger.start` consumes the oldest unmatched admission when the
  // edge carries no resolvable parent), so the entry is charged to this session.
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
  const call = (callId) =>
    activated.tools.execute({ name: 'subagent', callId, arguments: { description: callId }, agent, signal: new AbortController().signal })

  const first = await call('call-1')
  assert.equal(first.isError, false, 'the first delegation is admitted')
  assert.equal(bodyRuns, 1, 'and it reaches the tool body, so the child has started')

  // THE SLOT IS HELD WHILE THE RUN IS LIVE. No sleep and no registry: the started child is counted
  // by the ledger's own state, so this reads the same on every run and every machine.
  const second = await call('call-2')
  assert.equal(second.isError, true, 'a run that is still live keeps its slot, so the next delegation is refused')
  assert.equal(bodyRuns, 1, 'the refused call never reaches the tool body')

  // THE TERMINAL EDGE RELEASES IT, which is the release the harness emits once per activation
  // epoch when a turn settles, and the fact the rules' cap wording rests on: the cap counts
  // RUNNING children, so a run that has ended holds no slot however long its agent stays resident.
  ctx.emit('subagent/end', { runId: 'run-1', provider: 'spawn', id: 'child-1', stopReason: 'completed' })
  const third = await call('call-3')
  assert.equal(third.isError, false, 'the terminal edge releases the slot, so the next delegation is admitted')
  assert.equal(bodyRuns, 2, 'and the admitted call reaches the tool body')
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

test('ledger: a session configured with its own cap is refused at THAT cap, not the default', () => {
  // Fails if the per-session limit is ignored - the guard would refuse at the machine
  // default even where a project set its own - or if the refusal stops naming the number
  // that actually applied, which is the only thing that tells a caller what to do.
  const ledger = workModes.createLedger({ limit: 2 })
  ledger.admit('call-1', 'session-a', 'first')
  ledger.start('run-1', 'child-1')
  ledger.admit('call-2', 'session-a', 'second')
  ledger.start('run-2', 'child-2')
  // Two are running and the machine default is 2, but this session's project allows four.
  const limitFor = (session) => (session === 'session-a' ? 4 : null)
  assert.equal(
    workModes.refusalFor(ledger, exec({ callId: 'call-3', arguments: { description: 'third' } }), 'subagent', limitFor),
    undefined,
    'a session with a cap of four was refused at the default of two',
  )
  // An admitted delegation is counted while its child is pending, so two more admissions
  // bring this session to four - and only then is the next call refused.
  assert.equal(
    workModes.refusalFor(ledger, exec({ callId: 'call-4', arguments: { description: 'fourth' } }), 'subagent', limitFor),
    undefined,
    'the fourth call must be admitted at a cap of four',
  )
  const fifth = workModes.refusalFor(ledger, exec({ callId: 'call-5', arguments: { description: 'fifth' } }), 'subagent', limitFor)
  assert.equal(typeof fifth, 'string', 'with four configured and four counted, the fifth must be refused')
  assert.match(fifth, /the cap is 4/)
  assert.match(fifth, /this project's configured cap/)
  // A session the function answers null for keeps the ledger's own limit, and its refusal
  // names that number rather than the project's.
  const atDefault = workModes.refusalFor(ledger, exec({ callId: 'call-6', arguments: { description: 'other' } }), 'subagent', () => null)
  assert.equal(typeof atDefault, 'string', 'the default cap must still refuse a busy session')
  assert.match(atDefault, /the cap is 2\./)
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
