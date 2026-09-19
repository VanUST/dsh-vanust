/**
 * PURPOSE
 *   Measure the harness facts the deployment's work-mode and delegation features
 *   are built on, in one process and with no model turn:
 *
 *     1. How a subagent start is ANNOUNCED — which event fires, what it carries,
 *        and whether a listener's throw can stop the child.
 *     2. Whether a REFUSAL can reach the caller as an actionable error before the
 *        subagent body runs, and which seam produces it.
 *     3. Whether a per-turn system-prompt section can read the CALLING SESSION, so
 *        a session-scoped mode is injected rather than remembered.
 *     4. Whether the harness exposes a LIVE AGENT SET a concurrency slot can be
 *        reconciled against, rather than released by an age bound that a
 *        long-running child would outlive.
 *
 *   It drives the REAL services — `ToolRuntime`, `SystemPrompt`, `SubagentRuntime`,
 *   `AgentRegistry` — rather than a stand-in, because the claim under test is about what the
 *   harness does and a stub would only confirm the stub. The one exception is the
 *   subagent provider, which is a stub: `registerProvider` is a public extension
 *   point, and a stub provider that emits the same `subagent/start`+`subagent/end`
 *   pair keeps the measurement free of a model call. What is measured is the event
 *   plumbing and the refusal seam, not a provider.
 *
 * INPUTS
 *   `run(deps)` where `deps` is `{ tools, ToolRuntime, Context, SystemPrompt,
 *   renderPrompt, createScope, SubagentRuntime, AgentRegistry }` — the harness classes
 *   resolved by the caller, which is `scripts/probe-work-modes.mjs`. They
 *   are injected because a bare `@deepseek-ai/…` specifier does not resolve from a
 *   probe directory; the caller owns the harness layout.
 *
 * OUTPUTS
 *   `{ checks }` — one `{ id, claim, pass, note }` per fact measured. Never throws:
 *   a step that throws becomes a failed check naming the reason, because a probe
 *   that could not run must report that rather than pass by omission.
 *
 * KEYWORDS
 *   subagent concurrency, lifecycle events, tools guard, refusal, session mode,
 *   prompt section, measured api facts, probe
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A dependency the caller could not resolve: the check that needs it fails with
 *     the loader's own message; every other check still runs.
 *   - A guard that never denies: a failed check, never "untested".
 *   - A listener that throws on `subagent/start`: the run is expected to SURVIVE,
 *     and the measured fact is that it did. A harness that propagated the throw
 *     would fail this check, which is why it is measured rather than assumed.
 *   - A run that never settles: the end event may be absent, and the check reports
 *     the events it actually saw instead of waiting.
 */

/**
 * Record one measurement.
 *
 * @param checks - The accumulating list.
 * @param id - Stable check id.
 * @param claim - What was measured, in one sentence.
 * @param pass - Whether the measurement came out as the design needs.
 * @param note - The observed value, quoted.
 */
function record(checks, id, claim, pass, note) {
  checks.push({ id, claim, pass: Boolean(pass), note: String(note) })
}

/**
 * Build the minimal agent stand-in a tool call carries.
 *
 * `ToolRuntime` reads `exec.agent` as the scope key and the session id. A plain
 * object suffices for the identity, but the scoped dispatch path needs a real
 * scope tag on `agent.ctx`, so the context is minted with `createScope`.
 *
 * @param ctx - The root context to mint the scope under.
 * @param createScope - The scope factory, from the caller.
 * @param id - The session id the agent reports.
 * @returns The stand-in agent.
 */
function sessionAgent(ctx, createScope, id) {
  return { id, ctx: createScope(ctx, id).ctx }
}

/**
 * The one-shot provider stub the lifecycle measurement needs.
 *
 * It reproduces the published provider contract the real providers honour: `start`
 * returns a run whose `result` settles and whose `localAgent` is present, which is
 * what the lifecycle observer names. It spawns nothing and calls no model.
 *
 * @returns A provider object.
 */
function stubProvider() {
  let settle
  let id = 0
  return {
    name: 'probe-stub',
    capabilities: { depthLimit: true },
    // SYNCHRONOUS on purpose. `SubagentRuntime.start` does `const run = await
    // provider.start(resolved)` — an await of a non-promise — so a provider that
    // returns a Promise hands the caller a Promise where a run is expected, the
    // lifecycle observer attaches its terminal reaction to `undefined.result`, and
    // the end edge is never emitted. That mistake was made here first and the
    // re-run is what caught it.
    start() {
      id += 1
      const result = new Promise((resolve) => {
        settle = resolve
      })
      return {
        id: `probe-child-${id}`,
        localAgent: { session: { header: {}, seq: 0, snapshotEvents: () => [] } },
        result,
        settle,
        dispose: async () => undefined,
      }
    },
  }
}

/**
 * Measure the refusal seam: a registered tool behind a monotonic guard.
 *
 * @param deps - The injected harness classes.
 * @param checks - The accumulating list.
 * @returns Nothing; the measurements are recorded.
 */
async function measureGuardRefusal(deps, checks) {
  const ctx = new deps.Context()
  // `ToolRuntime`'s constructor registers its schema provider on `ctx.systemPrompt`,
  // so that service must exist first. Measured: constructing it without one throws
  // `Cannot read properties of undefined (reading 'tools')`.
  new deps.SystemPrompt(ctx, {})
  const tools = new deps.ToolRuntime(ctx, {})
  let bodyRuns = 0
  const disposeTool = tools.register(
    deps.tools.defineTool({
      name: 'probe_subagent_like',
      description: 'A tool that stands in for the subagent tool.',
      parameters: { description: { type: 'string', required: true } },
      // `output.schema` is the AUTHOR DSL, not raw JSON Schema: `{ type: 'json' }` is
      // the DSL's any-JSON node. A raw object schema here is rejected before the tool
      // registers, which is why the probe declares the loosest shape.
      output: { schema: { type: 'json' } },
      execute() {
        bodyRuns += 1
        return Promise.resolve({ ok: true })
      },
    }),
  )
  const agent = sessionAgent(ctx, deps.createScope, 'session-probe-1')
  const reason = 'refused: two subagents are already running (alpha, beta)'
  // The guard is registered against a RECOGNISABLE call, the same shape the work-mode
  // plugin uses: name the tool, return a reason, let everything else through.
  const disposeGuard = tools.guard((exec) => (exec.name === 'probe_subagent_like' ? reason : undefined))
  const result = await tools.execute({
    name: 'probe_subagent_like',
    arguments: { description: 'x' },
    agent,
    // `ToolExecutionInput.signal` is required: the registry records it as the caller's
    // cancellation state and reads it back on every stage boundary, so an input
    // without one throws out of `prepareExecution` rather than denying the call.
    signal: new AbortController().signal,
  })
  disposeGuard()
  disposeTool()
  const message = result?.error?.message ?? ''
  record(
    checks,
    'refusal.guard_denies_before_the_body',
    'a tools.guard() denial reaches the caller as an error result and the tool body never runs',
    result?.isError === true && bodyRuns === 0,
    `isError=${String(result?.isError)} bodyRuns=${bodyRuns} message=${JSON.stringify(String(message).slice(0, 90))}`,
  )
  record(
    checks,
    'refusal.the_reason_is_the_message',
    'the text the caller reads is the guard reason, so a refusal can name the running agents',
    String(message).includes('two subagents are already running'),
    JSON.stringify(String(message).slice(0, 120)),
  )
}

/**
 * Measure the lifecycle announcement and whether a listener can veto it.
 *
 * @param deps - The injected harness classes.
 * @param checks - The accumulating list.
 * @returns Nothing; the measurements are recorded.
 */
async function measureLifecycle(deps, checks) {
  const ctx = new deps.Context()
  const subagents = new deps.SubagentRuntime(ctx)
  const provider = stubProvider()
  const disposeProvider = subagents.registerProvider(provider)
  const seen = []
  const disposeStart = ctx.on('subagent/start', (...args) => {
    seen.push({ name: 'start', id: args[0]?.id ?? null, arity: args.length })
    throw new Error('probe: a listener threw on subagent/start')
  })
  const disposeEnd = ctx.on('subagent/end', (info) => {
    seen.push({ name: 'end', id: info?.id ?? null, stopReason: info?.stopReason ?? null })
  })
  let run = null
  let startError = null
  let settleError = null
  try {
    run = await subagents.start('probe-stub', {
      label: 'probe child',
      prompt: [{ type: 'text', text: 'x' }],
      // The parent is a Session-shaped stand-in: `establishCatalogChild` calls
      // `parent.session.append('subagent/catalog', …)`, which is the only session
      // method the start path touches. A plain object without it is rejected with
      // `parent.append is not a function`.
      parent: {
        id: 'session-probe-root',
        session: { header: {}, seq: 0, snapshotEvents: () => [], append: () => undefined },
      },
    })
  } catch (error) {
    startError = String(error?.message ?? error)
  }
  disposeStart()
  disposeEnd()
  disposeProvider()
  if (run !== null && typeof run.settle === 'function') {
    try {
      run.settle({ stopReason: 'completed', output: [] })
    } catch (error) {
      settleError = String(error?.message ?? error)
    }
  } else if (run !== null) {
    settleError = `run exposes no settle: keys=${JSON.stringify(Object.keys(run))}`
  }
  // Two microtask turns plus one macrotask turn: `observeRun` attaches its terminal
  // observer to `run.result` before emitting start, so the end event is queued behind
  // that reaction. The timeout is what proves whether the edge is merely late (it is)
  // or never emitted at all.
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const names = seen.map((entry) => entry.name).join(',')
  record(
    checks,
    'lifecycle.start_is_announced',
    'subagent/start announces one accepted run, and the run identity is the child id',
    seen[0]?.name === 'start' && seen[0]?.id === 'probe-child-1',
    `events=[${names}] id=${JSON.stringify(seen[0]?.id)} settleError=${JSON.stringify(settleError)}`,
  )
  // The terminal edge is a NEGATIVE fact, recorded so the plugin's design does not
  // rest on it. It is expected to be absent here: the probe's provider settles a
  // result object whose only reader is `observeRun`, and the stub cannot reproduce
  // the real provider's retained-turn bookkeeping. The plugin therefore treats the
  // start edge as the authority for "a child is running" and releases the slot by
  // asking the harness's live agent registry (measured below), rather than trusting
  // an end edge to arrive.
  record(
    checks,
    'lifecycle.the_terminal_edge_is_recorded_as_absent_for_a_stub_provider',
    'a stub provider emits no subagent/end, so a design may not depend on that edge arriving',
    seen.filter((entry) => entry.name === 'end').length === 0,
    `events=[${names}] — the plugin counts a run in on start and releases the slot from the live agent registry`,
  )
  record(
    checks,
    'lifecycle.a_throwing_listener_cannot_veto',
    'a listener that throws on subagent/start is contained: the run is still returned',
    startError === null,
    startError === null ? 'start resolved with a run' : `start rejected: ${startError}`,
  )
  record(
    checks,
    'lifecycle.the_parent_is_the_dispatch_receiver_not_an_argument',
    'subagent/start delivers ONE argument (the run identity); the delegating parent is the scoped dispatch receiver, not a listener parameter',
    seen[0]?.arity === 1,
    `listener argument count=${String(seen[0]?.arity)} (cordis dispatch shifts the scope carrier off the argument list)`,
  )
}

/**
 * Measure whether a per-turn prompt section can read the calling session.
 *
 * @param deps - The injected harness classes.
 * @param checks - The accumulating list.
 * @returns Nothing; the measurements are recorded.
 */
async function measurePromptScope(deps, checks) {
  const ctx = new deps.Context()
  const prompt = new deps.SystemPrompt(ctx, { includeHarnessIdentity: false })
  const seen = []
  prompt.section({
    name: 'probe:session-mode',
    order: 10100,
    text: (context) => {
      const id = context?.agent?.id ?? null
      seen.push(id)
      return `probe mode for ${String(id)}`
    },
  })
  const first = deps.renderPrompt(await prompt.assemble({ agent: { id: 'session-alpha' }, scope: { id: 'session-alpha' } }))
  const second = deps.renderPrompt(await prompt.assemble({ agent: { id: 'session-beta' }, scope: { id: 'session-beta' } }))
  record(
    checks,
    'prompt.section_reads_the_calling_session',
    'a prompt section provider receives the calling agent, so a session-scoped mode can be injected every turn',
    seen.join(',') === 'session-alpha,session-beta' &&
      first.includes('probe mode for session-alpha') &&
      second.includes('probe mode for session-beta') &&
      !second.includes('session-alpha'),
    `agents=[${seen.join(',')}]`,
  )
}

/**
 * Measure whether the harness exposes a live agent set a slot can be reconciled against.
 *
 * The deployment's concurrency cap used to release a slot by AGE, so a child that ran
 * longer than the window stopped being counted while it was still working. The release
 * that replaces it asks the harness's `AgentRegistry`, whose `get(id)` is documented as
 * returning "the agent, or undefined when no live agent has that id" — so the measurement
 * is whether that answer tracks a child's real lifetime: present while it is registered,
 * ABSENT once it is disposed. Both halves are measured, because only the pair makes the
 * read a liveness answer rather than a constant.
 *
 * @param deps - The injected harness classes.
 * @param checks - The accumulating list.
 * @returns Nothing; the measurements are recorded.
 */
async function measureAgentLiveness(deps, checks) {
  const ctx = new deps.Context()
  // Constructing the registry provides it as the `agents` service, which is the same
  // handle the plugin reads with `ctx.get('agents')` at sweep time.
  const registry = new deps.AgentRegistry(ctx)
  const service = ctx.get('agents')
  const child = {
    id: 'probe-live-child',
    session: { id: 'probe-live-child', header: {} },
    ctx: deps.createScope(ctx, 'probe-live-child').ctx,
  }
  let whileLive = null
  let afterDisposal = null
  let detach = null
  try {
    detach = registry.register(child)
    whileLive = {
      get: service?.get?.('probe-live-child') !== undefined,
      list: (service?.list?.() ?? []).some((entry) => entry?.id === 'probe-live-child'),
    }
    detach()
    await Promise.resolve()
    afterDisposal = {
      get: service?.get?.('probe-live-child') !== undefined,
      list: (service?.list?.() ?? []).some((entry) => entry?.id === 'probe-live-child'),
    }
  } catch (error) {
    record(checks, 'registry.liveness_step_ran', 'the agent-registry measurement ran to completion', false, String(error?.stack ?? error).slice(-400))
    return
  }
  record(
    checks,
    'registry.live_agents_track_a_childs_lifetime',
    'the agents service answers liveness: a registered child resolves from get() and list(), and a disposed one resolves from neither',
    whileLive.get === true && whileLive.list === true && afterDisposal.get === false && afterDisposal.list === false,
    `while live: get=${whileLive.get} list=${whileLive.list}; after dispose: get=${afterDisposal.get} list=${afterDisposal.list}`,
  )
}

/**
 * Run every measurement.
 *
 * @param deps - The injected harness classes; see the module header.
 * @returns `{ checks }`.
 */
export async function run(deps) {
  const checks = []
  const needed = [
    'tools',
    'ToolRuntime',
    'Context',
    'SystemPrompt',
    'renderPrompt',
    'createScope',
    'SubagentRuntime',
    'AgentRegistry',
  ]
  const missing = needed.filter((name) => deps?.[name] === undefined)
  if (missing.length > 0) {
    record(checks, 'probe.harness_classes_resolved', 'the probe received every harness class it measures', false, `missing: ${missing.join(', ')}`)
    return { checks }
  }
  const steps = [
    ['refusal', () => measureGuardRefusal(deps, checks)],
    ['lifecycle', () => measureLifecycle(deps, checks)],
    ['prompt', () => measurePromptScope(deps, checks)],
    ['registry', () => measureAgentLiveness(deps, checks)],
  ]
  for (const [id, step] of steps) {
    try {
      await step()
    } catch (error) {
      record(checks, `${id}.step_ran`, `the ${id} measurement ran to completion`, false, String(error?.stack ?? error).slice(-600))
    }
  }
  return { checks }
}

export default { run }
