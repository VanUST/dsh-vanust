/**
 * PURPOSE
 *   One deployment policy: a concurrency cap on the `subagent` tool. At most the CONFIGURED
 *   number of
 *   that tool's children (per session, grandchildren included) may be running; a third
 *   call is refused immediately with the two running agents named, and the calling
 *   agent decides what to do. A `workflow` fan-out is deliberately OUTSIDE this cap —
 *   the human chose that limit knowingly — so this is a cap on the delegation tool,
 *   never a ceiling on concurrent work.
 *
 *   The cap is read at a seam the harness already owns: a monotonic `tools.guard()`,
 *   and a guard may only DENY, so no later listener can turn the refusal back into
 *   permission. A denial is materialized by the registry as an error result carrying
 *   the guard's own text — measured with `node scripts/probe-work-modes.mjs`.
 *
 * INPUTS
 *   Config (all optional, all with working defaults):
 *     `toolName` — the delegation tool to cap. Default `subagent`.
 *     `limit` — the most children of that tool that may run at once. Default 2. It is the
 *       MACHINE default: a project may override it for its own sessions with a
 *       `subagent-cap` setting in a settings spec item, which the Specs window writes as a
 *       typed value. That setting is read through the `specSettings` service the specs
 *       plugin publishes, at the moment of each call, so an edit applies to the next
 *       delegation rather than to the next restart. The service is bound with `inject`
 *       rather than declared, because a required dependency would leave this plugin
 *       pending - and the cap ABSENT - wherever no specs plugin is mounted.
 *     `staleAfterMs` — the FALLBACK bound on an entry the agent registry could not
 *       answer for (an out-of-process child, or a composition with no `agents` service).
 *       Default 900000 (15 minutes). It is not the release mechanism: a child this
 *       process can see is released when the registry stops holding it, however long it
 *       ran, so a lost terminal edge can never refuse delegation for the life of the
 *       process and a live child is never dropped for being slow.
 *     `liveChild` — the reconciliation predicate a ledger built directly may supply:
 *       `(childId) => true | false | null`. `true`/`false` are answers from a live
 *       agent registry; `null` (or no predicate at all) means "cannot tell", which
 *       leaves the entry on the age bound. {@link createLedger} is total for a
 *       predicate that throws — a throw is also "cannot tell".
 *   Services: `tools` (DECLARED in {@link inject}, so a composition with no tool
 *   registry leaves this plugin pending rather than silently capping nothing) and
 *   `agents`, read at call time through {@link liveChildProbe} and nowhere required, so
 *   a composition without an agent registry loses only the exact release and keeps the
 *   age-bounded fallback. `agents` is never read with `ctx.get` while `apply` runs, so
 *   a composition that mounts it on a later turn still gets the registration.
 *
 * OUTPUTS
 *   Registers: one monotonic tool guard and three event listeners (`subagent/start`,
 *   `subagent/end`, `tools/result`). Each registration lives in the `ctx.effect` scope
 *   of the service it uses, so a reload or a replaced service disposes the old
 *   registration instead of colliding with it.
 *   Never throws during event dispatch: a guard that cannot attribute a call lets it
 *   through rather than refusing unrelated work.
 *
 * KEYWORDS
 *   subagent concurrency, delegation cap, monotonic guard, session state
 *
 * BEHAVIOUR ON EDGE CASES
 *   - `limit` below 1: treated as 1, because a cap of zero would make the tool
 *     permanently unusable and is not a policy anyone can want; the configuration is
 *     reported on stderr once.
 *   - A tool call with no `callId` and no agent: the guard lets it through. A refusal
 *     the plugin cannot attribute to a session would refuse unrelated work.
 *   - A `subagent/start` with no recorded admission (a child established outside the
 *     delegation tool): it is counted, rooted at its parent's root when that parent is
 *     known, so the cap still sees it, and it is attributed to itself otherwise.
 *   - Two admissions and one start: the earliest unmatched admission is consumed, which
 *     is the only correlation the event vocabulary supports (the start edge carries the
 *     child id and no parent).
 *   - No tool registry mounted: the plugin stays pending, so the cap is absent rather
 *     than silently installed against a registry that does not exist.
 *   - An unknown reading of `exec.agent.session.header.parentSession`: treated as no
 *     parent, which makes the session its own root.
 *   - A start edge whose child session the `agents` service cannot resolve (an
 *     out-of-process provider): the delegating session is inferred from the oldest
 *     unmatched admission, which is exact when one session delegates at a time and
 *     can cross-attribute when two do. The same child is also UNRECONCILABLE, so its
 *     slot is released by `staleAfterMs` and not by a liveness read.
 *   - A child that never ends: its slot is released as soon as the agent registry
 *     stops holding it, because liveness is read from the registry rather than
 *     inferred from an edge or a clock. A child that runs longer than `staleAfterMs`
 *     therefore KEEPS its slot instead of silently freeing capacity the cap claims to
 *     bound.
 *   - A child the registry holds forever (a resident continuable child, or one the
 *     harness never disposes): its slot is held for as long as it is held. That is the
 *     fail-closed direction and it is deliberate — the alternative is the age bound
 *     silently counting a child that still exists as gone. The delegation is refused,
 *     not lost, and the refusal names the child holding the slot.
 *   - `staleAfterMs` therefore governs only an entry no registry answered for: an
 *     out-of-process child, a composition with no `agents` service, or a probe that
 *     threw. Those are the entries a lost terminal edge can still strand.
 *   - A delegation the guard admitted whose tool call then FAILED: the admission is
 *     settled on that call's failed result, because the call provably spawned no child
 *     the caller can reach. A successful result is not used this way — for a background
 *     or continuable delegation it arrives as soon as the child is established — so
 *     `staleAfterMs` no longer bounds a slot held by a call that never created anything.
 */

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'work-modes'

/** The prompt registry is the one service this plugin cannot work without. */
export const inject = ['tools']

/** The default delegation tool this plugin caps. */
export const DEFAULT_TOOL_NAME = 'subagent'

/** The default number of children of that tool that may run at once. */
export const DEFAULT_LIMIT = 2

/** How long an admission with no matching start is still counted. */
export const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000

/** The mode a session starts in when nothing has set one. */

/**
 * Read the session id a tool execution belongs to.
 *
 * @param exec - A tool execution (guard argument, or an event payload narrowed by the
 *   caller).
 * @returns The session id, or null when the execution cannot be attributed.
 */
export function sessionOf(exec) {
  const id = exec?.agent?.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * Read the parent session id recorded on a session's header.
 *
 * @param session - A Session-like object, or undefined.
 * @returns The parent session id, or null when the header does not carry one.
 */
export function headerParentOf(session) {
  const parent = session?.header?.parentSession
  return typeof parent === 'string' && parent.length > 0 ? parent : null
}

/**
 * The concurrent-delegation ledger.
 *
 * Two maps and one root index, because the harness's event vocabulary does not carry
 * the parent on a start edge (measured: the delegating parent is the scoped dispatch
 * receiver, and the listener receives the run identity alone). An admission recorded
 * at the pre-execute seam therefore carries the session, and a start edge is matched
 * to an admission for the SAME session when the caller knows that session, and to the
 * earliest unmatched admission otherwise.
 *
 * A running entry is released by LIVENESS first and by age only as a fallback. A start
 * edge whose child the caller could see in the harness's agent registry at that moment
 * (`liveChild(childId) === true`) marks the entry reconcilable, and a later `false` —
 * the registry no longer holds that child — releases the slot on the next sweep, however
 * long the child ran. This is what replaces an age bound that released a live child: an
 * entry the registry answers for is released by the registry, and `staleAfterMs` applies
 * only to an entry no registry answered for (out-of-process child, no `agents` service,
 * or a probe that threw).
 *
 * @param options - `{ limit, staleAfterMs, now, liveChild }`. `now` is injectable so a
 *   test can drive the stale sweep without waiting. `liveChild` is an optional
 *   `(childId) => boolean | null` liveness predicate; omitted, every entry is
 *   unreconcilable and the ledger behaves exactly as an age-bounded one. A predicate
 *   that throws is read as `null` ("cannot tell"), never as a release.
 * @returns The ledger's operations, all synchronous and all total.
 */
export function createLedger(options = {}) {
  const limit = Number.isFinite(options.limit) && options.limit >= 1 ? Math.floor(options.limit) : DEFAULT_LIMIT
  const staleAfterMs = Number.isFinite(options.staleAfterMs) ? options.staleAfterMs : DEFAULT_STALE_AFTER_MS
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const liveness = typeof options.liveChild === 'function' ? options.liveChild : null
  /** Session id -> root session id, so a grandchild counts against its origin session. */
  const rootOf = new Map()
  /** callId -> `{ session, label, at }`, an admitted delegation whose child has not started. */
  const pending = new Map()
  /** runId -> entry, a child believed to be running. */
  const running = new Map()

  /**
   * The root session a session's delegations count against.
   *
   * @param session - A session id.
   * @returns The root session id; the argument itself when no parent is recorded.
   */
  const rootFor = (session) => rootOf.get(session) ?? session

  /**
   * Ask the liveness predicate whether a child is still held by the agent registry.
   *
   * Total by construction: a predicate that throws, or one that is absent, answers
   * `null` ("cannot tell") rather than `false`, because a release inferred from a
   * broken probe is a cap that silently stops counting.
   *
   * @param childId - The child session id, or null when the start edge carried none.
   * @returns `true`/`false` when the registry answered, `null` otherwise.
   */
  const childIsLive = (childId) => {
    if (liveness === null || typeof childId !== 'string' || childId.length === 0) return null
    try {
      const answer = liveness(childId)
      return answer === true || answer === false ? answer : null
    } catch {
      return null
    }
  }

  /**
   * Drop entries released by liveness and then entries past the age bound.
   *
   * The two rules do not overlap: a reconcilable entry is released by the registry and
   * NEVER by the clock — the whole point of reading liveness is that a child the registry
   * still holds is still running, at minute 1 or minute 40. The age bound governs exactly
   * the entries no registry answered for, which is what keeps a lost terminal edge from
   * refusing delegation for the life of the process without ever releasing live work.
   */
  const sweep = () => {
    const cutoff = now() - staleAfterMs
    for (const [callId, entry] of pending) if (entry.at < cutoff) pending.delete(callId)
    for (const [runId, entry] of running) {
      if (entry.reconcilable) {
        if (childIsLive(entry.childId) === false) running.delete(runId)
        continue
      }
      if (entry.at < cutoff) running.delete(runId)
    }
  }

  return {
    limit,
    staleAfterMs,
    /** @returns The recorded root for a session id, or undefined. */
    rootFor: (session) => rootFor(session),
    /** @returns Every entry currently counted, for a refusal message. */
    entries() {
      sweep()
      return [...running.values()]
    },
    /** @returns How many children of the root session are counted right now. */
    countFor(root) {
      sweep()
      let total = 0
      for (const entry of running.values()) if (entry.root === root) total += 1
      for (const entry of pending.values()) if (rootFor(entry.session) === root) total += 1
      return total
    },
    /**
     * Record an admitted delegation.
     *
     * The methods on the returned object are arrow wrappers rather than the private
     * shorthand methods themselves: returning `admit` bare would expose a function a
     * caller invokes as `ledger.admit(...)`, whose first argument then lands in `callId`
     * with no receiver — a defect this suite caught as a cap that never counted.
     *
     * @param callId - The tool call id, which is the only correlation both the guard and
     *   the result event carry.
     * @param session - The session placing the call.
     * @param label - The tool's `description` argument, which is what names the agent.
     */
    admit: (callId, session, label) => {
      if (typeof callId !== 'string' || callId.length === 0) return
      if (typeof session !== 'string' || session.length === 0) return
      pending.set(callId, { session, label: label ?? null, at: now() })
    },
    /**
     * Promote an admitted delegation into a running child.
     *
     * @param runId - The run identity from the start edge.
     * @param childId - The child session id from the start edge.
     * @param delegatingSession - The session that placed the delegation, when the caller
     *   could resolve it (see {@link parentSessionOf}). Omitted when it could not, which is
     *   the out-of-process-provider case.
     * @returns The promoted entry, or null when no admission is waiting. A start with no
     *   admission is still counted — rooted at the child's own parent chain when known —
     *   because a child running outside the capped tool still consumes concurrency.
     */
    start: (runId, childId, delegatingSession = null) => {
      sweep()
      // Which admission this start consumes. The start edge carries no parent, so the
      // correlation is either the session the caller resolved for this child, or — when it
      // could not be resolved — the oldest unmatched admission. The session-keyed match is
      // what keeps two sessions delegating concurrently from consuming each other's
      // admission: measured, the oldest-admission rule charged a running child to whichever
      // session had admitted FIRST, so the session whose child actually started kept a
      // phantom admission (blocking it after its child settled) while the other session was
      // charged for a delegation it never placed.
      const known = typeof delegatingSession === 'string' && delegatingSession.length > 0 ? delegatingSession : null
      let earliest = null
      for (const [callId, entry] of pending) {
        if (known !== null && entry.session !== known) continue
        if (earliest === null || entry.at < earliest.entry.at) earliest = { callId, entry }
      }
      let admitted = null
      if (earliest !== null) {
        pending.delete(earliest.callId)
        admitted = { ...earliest.entry, callId: earliest.callId }
      }
      const parent = admitted?.session ?? known
      const root = parent === null ? childId : rootFor(parent)
      if (parent !== null && typeof childId === 'string' && childId.length > 0) rootOf.set(childId, root)
      // Reconcilable only when the registry ANSWERED `true` at this moment. A child the
      // registry does not hold while it starts (an out-of-process provider) is not
      // "ended"; it is one this ledger cannot read, so its slot stays age-bounded rather
      // than being released by a `false` the registry never meant.
      const entry = {
        session: parent,
        childId: childId ?? null,
        callId: admitted?.callId ?? null,
        label: admitted?.label ?? null,
        root,
        at: now(),
        reconcilable: childIsLive(childId) === true,
      }
      running.set(String(runId), entry)
      return entry
    },
    /** Remove a running entry whose start edge's run id settled. */
    end: (runId) => {
      running.delete(String(runId))
    },
    /** Remove every entry belonging to one tool call, admitted or running. */
    settleCall: (callId) => {
      if (typeof callId !== 'string' || callId.length === 0) return
      pending.delete(callId)
      for (const [runId, entry] of running) if (entry.callId === callId) running.delete(runId)
    },
    /** @returns The entry recorded for one run identity, or undefined. */
    entryFor: (runId) => running.get(String(runId)),
    /**
     * Record that a session belongs to a root, so a session seen only as a CALLER
     * still counts against the right origin.
     *
     * A grandchild's own tool call arrives with the grandchild as `exec.agent` and no
     * entry of its own, so without this its delegations would root at itself and the
     * cap would not see them. The parent chain is not on `exec.agent`, but the
     * delegation that CREATED the session was recorded, which is what makes this
     * callable at the moment the caller is first seen.
     *
     * @param session - The calling session.
     * @param root - The root it belongs to.
     */
    bind: (session, root) => {
      if (typeof session === 'string' && session.length > 0 && typeof root === 'string' && root.length > 0) {
        rootOf.set(session, root)
      }
    },
  }
}

/**
 * Build the refusal for one delegation call.
 *
 * The text names the two running agents because the calling agent's next decision —
 * batch the work, finish its own step first, or retry later — depends on what is
 * already in flight. It also states plainly that a `workflow` fan-out is not covered,
 * so nobody reads this refusal as a cap on concurrent work.
 *
 * @param ledger - A ledger from {@link createLedger}.
 * @param limit - The cap in force for this session; the ledger's own when omitted.
 * @returns The denial text.
 */
export function refusalText(ledger, limit = undefined) {
  const effective = Number.isFinite(limit) ? limit : ledger.limit
  const entries = ledger.entries()
  const named = entries.map((entry) => {
    const who = entry.childId ?? entry.callId ?? '(unknown id)'
    const what = entry.label === null || entry.label === undefined || entry.label === '' ? '(no description given)' : entry.label
    return `  - ${who}: ${what}`
  })
  return [
    `refused: ${entries.length} subagent(s) are already running in this session and the cap is ${effective}` +
      (effective === ledger.limit ? '.' : ' (this project\'s configured cap).'),
    'The subagents currently running are:',
    ...named,
    '',
    'Nothing was started and nothing was queued. Decide how to proceed and call again:',
    '  - batch the remaining work into the delegations already running,',
    '  - finish your own step first and delegate afterwards, or',
    '  - retry later, when one of them has settled.',
    '',
    `This cap counts the "${DEFAULT_TOOL_NAME}" tool's children per session, grandchildren included.`,
    'A `workflow` fan-out is deliberately NOT capped by it: this is a cap on the',
    'delegation tool, not a ceiling on concurrent work.',
  ].join('\n')
}

/**
 * Decide whether one tool call is a capped delegation, and refuse it when the cap is
 * already reached.
 *
 * The cap is resolved PER SESSION, not once at boot: a project may set its own in a spec
 * item, and the value is read at the moment of the call so an edit lands on the next
 * delegation rather than on the next restart.
 *
 * @param ledger - A ledger from {@link createLedger}.
 * @param exec - The tool execution the guard received.
 * @param toolName - The delegation tool's registered name.
 * @param limitFor - Optional `(sessionId) => number | null`: the cap configured for that
 *   session, or null to use the ledger's own. A value below one is ignored, because a cap
 *   of zero would make the delegation tool unusable.
 * @returns The denial text, or `undefined` to leave the call allowed.
 */
export function refusalFor(ledger, exec, toolName = DEFAULT_TOOL_NAME, limitFor = null) {
  if (exec?.name !== toolName) return undefined
  const caller = sessionOf(exec)
  // An unattributable call is allowed: the ledger keys everything by session, so a
  // refusal here would be a refusal of a call this plugin cannot place.
  if (caller === null) return undefined
  const callId = typeof exec.callId === 'string' && exec.callId.length > 0 ? exec.callId : null
  // The caller may be a subagent whose own session no entry has named yet — its own
  // delegations must still count against the session that started the chain.
  const root = ledger.rootFor(caller)
  ledger.bind(caller, root)
  // Capacity is decided BEFORE this call claims a slot. Admitting first and undoing it
  // on refusal made the boundary off by one: the call's own admission appeared in the
  // count and a call that should have been allowed was refused.
  let limit = ledger.limit
  if (typeof limitFor === 'function') {
    let configured = null
    try {
      configured = limitFor(root)
    } catch {
      // A settings read that throws is "no setting", never a failure of the guard.
      configured = null
    }
    if (Number.isFinite(configured) && configured >= 1) limit = Math.floor(configured)
  }
  if (ledger.countFor(root) >= limit) return refusalText(ledger, limit)
  if (callId !== null) ledger.admit(callId, caller, exec.arguments?.description)
  return undefined
}

/**
 * The configured limit, floored at one and reported when it was changed.
 *
 * @param config - Resolved plugin configuration.
 * @returns A usable limit.
 */
function usableLimit(config) {
  const raw = config?.limit
  if (raw === undefined) return DEFAULT_LIMIT
  if (!Number.isFinite(raw) || raw < 1) {
    process.stderr.write(`work-modes: limit ${JSON.stringify(raw)} is not a positive number; using 1\n`)
    return 1
  }
  return Math.floor(raw)
}

/**
 * The session that delegated a child, read from the child's own session header.
 *
 * The start edge carries the run identity and nothing else, so the parent cannot be read
 * from the event. It CAN be read from the child: the harness records the durable
 * `parentSession` on every subagent session's header, and for an in-process provider
 * `agents.get(childId)` resolves during the start notification. This is exact, which is
 * what makes two sessions delegating at once safe; the ledger falls back to the oldest
 * unmatched admission when it answers null.
 *
 * @param agents - The `agents` service, or undefined when the composition mounts none.
 * @param childId - The child session id from the start edge.
 * @returns The delegating session id, or null when it cannot be resolved. Never throws.
 */
export function parentSessionOf(agents, childId) {
  if (agents === undefined || agents === null || typeof agents.get !== 'function') return null
  if (typeof childId !== 'string' || childId.length === 0) return null
  try {
    return headerParentOf(agents.get(childId)?.session)
  } catch {
    // A service that throws on an unknown id is the same fact as one that returns nothing.
    return null
  }
}

/**
 * Build the liveness predicate a slot release reconciles against.
 *
 * The harness's agent registry IS the live set: `AgentRegistry.get(id)` is documented as
 * "Look up a live agent … the agent, or undefined when no live agent has that id", and a
 * child is published in it before `subagent/start` is emitted and removed when its run is
 * disposed — so an id that no longer resolves is a child that has ended, and an id that
 * still resolves is a child that has not. `list()` is the same set as an array; `get` is
 * used here because the ledger asks about one entry at a time.
 *
 * Distinguishing "the registry answered no" from "nothing could answer" is load-bearing:
 * an out-of-process child is never in THIS process's registry while it runs, so a `false`
 * read at start time must not be taken for an ending. That is why the ledger only trusts a
 * `false` from a predicate that answered `true` earlier for the same child.
 *
 * @param agents - The `agents` service (`ctx.get('agents')`), or anything else.
 * @returns The predicate, or `null` when the service cannot answer liveness at all —
 *   which leaves the caller on the age bound rather than releasing on no evidence.
 */
export function liveChildProbe(agents) {
  if (agents === undefined || agents === null || typeof agents.get !== 'function') return null
  return (childId) => {
    if (typeof childId !== 'string' || childId.length === 0) return null
    try {
      return agents.get(childId) !== undefined
    } catch {
      // A service that throws on an unknown id is the same fact as one that returns
      // nothing ONLY for the parent read; for liveness a throw means the question could
      // not be asked, which is "cannot tell".
      return null
    }
  }
}

/**
 * Install the delegation cap.
 *
 * @param ctx - Cordis context; `tools` is present because `inject` names it.
 * @param config - Resolved plugin configuration; see the module header.
 * @returns Nothing; every registration is made through an effect scope owned by the fibre
 *   that supplies the service it uses, so a reload or a replaced service disposes the old
 *   registration instead of colliding with it.
 */
export function apply(ctx, config = {}) {
  const toolName = typeof config.toolName === 'string' && config.toolName.length > 0 ? config.toolName : DEFAULT_TOOL_NAME
  // The liveness probe is bound to the `agents` service LAZILY: this plugin does not
  // depend on an agent registry, so a composition without one must still load. `ctx.get`
  // is therefore called at sweep time, and such a composition gets `null` — the age
  // bound — rather than an error or a false release.
  const liveChild = (childId) => {
    const probe = liveChildProbe(ctx.get('agents'))
    return probe === null ? null : probe(childId)
  }
  const ledger = createLedger({ limit: usableLimit(config), staleAfterMs: config.staleAfterMs, liveChild })
  // ── the per-project cap ───────────────────────────────────────────────────
  // A project may set `subagent-cap` in a settings spec item, in its own scope (or the
  // machine's, as a default). The value is read from the `specSettings` service the specs
  // plugin publishes - never parsed here, so the loader stays the one implementation of
  // scope precedence. The service is OPTIONAL and bound through `inject` rather than
  // declared in this plugin's own `inject` list: a required dependency would leave this
  // plugin pending, and therefore the cap ABSENT, in a composition that mounts no specs
  // plugin. That is the same rule the `agents` service is read under.
  let settingsService = null
  ctx.inject(['specSettings'], (scope) => {
    settingsService = scope.specSettings ?? null
  })
  /**
   * The cap configured for one session, or null when nothing configures it.
   *
   * @param sessionId - The root session the delegation counts against.
   * @returns A whole number of one or more, or null.
   */
  const limitFor = (sessionId) => {
    let service = settingsService
    if (service === null) {
      try {
        service = ctx.get('specSettings') ?? null
      } catch {
        service = null
      }
    }
    if (service === null || typeof service.forWorkspace !== 'function') return null
    const agents = ctx.get('agents')
    if (agents === undefined || agents === null || typeof agents.get !== 'function') return null
    let cwd = null
    try {
      cwd = agents.get(sessionId)?.session?.header?.cwd ?? null
    } catch {
      cwd = null
    }
    if (typeof cwd !== 'string' || cwd.length === 0) return null
    const settings = service.forWorkspace(cwd)
    const cap = settings?.['subagent-cap']
    return Number.isFinite(cap) && cap >= 1 ? Math.floor(cap) : null
  }
  // ── the concurrency cap ───────────────────────────────────────────────────
  // A monotonic guard, not a pre-execute listener: a guard may only deny, so no
  // listener ordering can turn the refusal back into permission. The tool registry
  // materializes the returned string as an error result the caller reads.
  //
  // The registry is REQUESTED, never read opportunistically. Measured in this
  // deployment's own web composition: while `apply` runs, `ctx.get('tools')` is
  // undefined — the loader activates the tool registry on a later turn — so an
  // opportunistic read here silently installed no guard at all while the plugin's
  // fibre still reported ACTIVE, and no activation diagnostic could see it.
  ctx.inject(['tools'], (scope) => {
    scope.effect(
      () => scope.tools.guard((exec) => refusalFor(ledger, exec, toolName, limitFor)),
      'work-modes: the subagent concurrency guard',
    )
    // The release for a call whose child never existed. The guard ADMITS a delegation
    // before the body runs, and the real tool throws before publishing any run for the
    // failures a model can actually cause — a route outside the session's allowed set, an
    // unavailable service, a cancelled call. Nothing then consumes that admission, so
    // without this listener it is counted until `staleAfterMs` and the cap refuses work
    // no child is running. Only a FAILED result releases: a successful background or
    // continuable delegation returns as soon as the child is established, so releasing on
    // success would free the slot the moment the child started working, which is the
    // opposite of a cap. A call the guard itself refused was never admitted, so settling
    // it is a no-op.
    scope.effect(
      () => scope.on('tools/result', (exec, result) => {
        if (exec?.name !== toolName) return
        if (result?.isError !== true) return
        ledger.settleCall(exec.callId)
      }),
      'work-modes: release the admission of a call that failed before any child existed',
    )
  })

  // The start edge is the only announcement that a child exists. It is a CONTAINED
  // emit (a throwing listener is logged, never propagated — measured), so this
  // listener records and never vetoes; the guard is where a veto lives.
  ctx.effect(() => ctx.on('subagent/start', (info) => {
    // `agents` is reached at CALL time, not at apply time, so a composition that mounts
    // no agent registry loses only the exact attribution and the liveness release, and
    // keeps the age-bounded fallback.
    ledger.start(info?.runId, info?.id, parentSessionOf(ctx.get('agents'), info?.id))
  }))
  // The terminal edge is recorded but not relied on: measured, a provider that settles
  // its result does not necessarily produce the end edge. It is a fast release, not the
  // mechanism — the slot is released by the agent registry no longer holding the child,
  // and by the age bound only for a child this process cannot see.
  ctx.effect(() => ctx.on('subagent/end', (info) => {
    ledger.end(info?.runId)
  }))
  // A settled SUCCESSFUL tool result is deliberately NOT used to release the slot.
  // Measured while building this: for a background or continuable delegation the tool
  // returns as soon as the child is established, so releasing on success would free the
  // slot the moment the child started working — the opposite of a concurrency cap. The
  // slot a call holds is released by the child's start edge consuming it, by a terminal
  // edge, by the agent registry no longer holding the child, or — for an entry no
  // registry answered for — by the age bound. A FAILED result is the one exception and
  // is handled at the guard's own scope above, because that call provably has no child.

}


