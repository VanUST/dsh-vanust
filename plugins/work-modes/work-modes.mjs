/**
 * PURPOSE
 *   Two deployment policies the kit's rules state and nothing enforced, in one
 *   plugin because both are session-scoped work-policy facts read on the same two
 *   seams:
 *
 *   1. **A concurrency cap on the `subagent` tool.** At most two of that tool's
 *      children (per session, grandchildren included) may be running; a third call
 *      is refused immediately with the two running agents named, and the calling
 *      agent decides what to do. A `workflow` fan-out is deliberately OUTSIDE this
 *      cap — the human chose that limit knowingly — so this is a cap on the
 *      delegation tool, never a ceiling on concurrent work.
 *   2. **A work mode per session, injected into the prompt every turn.** Research
 *      mode needs neither a decision record nor a specification; implementation
 *      mode does, and its rule says exactly which of those requirements a command
 *      can check and which a judge must judge. Only the decision-record requirement
 *      has an enforcement point, and it is a zone's `requiresDecisionRecord` flag
 *      rather than this plugin; the defined-task and defined-measure requirements
 *      are prompt-level, and the rule text says so instead of implying otherwise.
 *
 *   Both are read at a seam the harness already owns. The cap is a monotonic
 *   `tools.guard()`: a guard may only DENY, so no later listener can turn the
 *   refusal back into permission, and a denial is materialized by the registry as
 *   an error result carrying the guard's own text — measured with
 *   `node scripts/probe-work-modes.mjs`. The mode is a `systemPrompt.section()`
 *   whose text is a PROVIDER, which is what lets it read the calling session on
 *   every assembly instead of being frozen at registration.
 *
 * INPUTS
 *   Config (all optional, all with working defaults):
 *     `toolName` — the delegation tool to cap. Default `subagent`.
 *     `limit` — the most children of that tool that may run at once. Default 2.
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
 *     `defaultMode` — the mode a session starts in. Default `research`.
 *     `modeRoute` — the HTTP path the panel's toggle calls. Default
 *       `/work-modes/mode`.
 *   Services: `systemPrompt` (DECLARED in {@link inject}, so a missing prompt
 *   service leaves this plugin pending rather than silently dropping the mode
 *   section); `tools` and `webServer` (each requested with `ctx.inject`, so the
 *   registration happens when that service appears, whenever that is); and `agents`,
 *   read at call time through {@link liveChildProbe} and nowhere required, so a
 *   composition without an agent registry loses only the exact release and keeps the
 *   age-bounded fallback. None of the optional services is read with `ctx.get` while
 *   `apply` runs: a composition that mounts this plugin without the tool registry or
 *   without a web server still gets whichever halves are possible, and one that mounts
 *   them later still gets both.
 *
 * OUTPUTS
 *   Registers: one monotonic tool guard, two event listeners (`subagent/start`,
 *   `subagent/end`), one prompt section, and — when a web server is mounted — one
 *   route plus one index-injection row. Each registration lives in the `ctx.effect`
 *   scope of the service it uses, so a reload or a replaced service disposes the old
 *   registration instead of colliding with it.
 *   Never throws during prompt assembly or event dispatch: the section returns a
 *   string for every session, including one it has never seen.
 *
 * KEYWORDS
 *   subagent concurrency, delegation cap, monotonic guard, work mode, research,
 *   implementation, prompt section, session state, adr panel, ratchet
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
 *   - A session whose mode was never set: `defaultMode`, always. Nothing is persisted,
 *     so a restart resets every session to it rather than resurrecting a stale policy.
 *   - No web server mounted, or one mounted after this plugin applies: the route is
 *     registered when the service appears, and the cap and the prompt section work
 *     regardless.
 *   - No tool registry mounted: the cap is simply absent, and the mode section and
 *     the route still work.
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
 */

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'work-modes'

/** The prompt registry is the one service this plugin cannot work without. */
export const inject = ['systemPrompt']

/** The default delegation tool this plugin caps. */
export const DEFAULT_TOOL_NAME = 'subagent'

/** The default number of children of that tool that may run at once. */
export const DEFAULT_LIMIT = 2

/** How long an admission with no matching start is still counted. */
export const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000

/** The mode a session starts in when nothing has set one. */
export const DEFAULT_MODE = 'research'

/** The two modes, in the order the rule text names them. */
export const MODES = Object.freeze(['research', 'implementation'])

/** The HTTP path the mode toggle calls. */
export const MODE_ROUTE = '/work-modes/mode'

/** The global the browser reads the route and its capability from. */
export const MODE_GLOBAL = '__DSH_WORK_MODES_MODE__'

/** The header the browser sends the capability in. */
export const MODE_HEADER = 'x-work-modes-capability'

/** Section name this plugin registers; unique, so a duplicate is a defect. */
export const MODE_SECTION_NAME = 'work-modes:mode'

/** Section order used when the prompt registry allocates no central position. */
export const MODE_SECTION_ORDER = 10110

/**
 * The rule text injected for each mode.
 *
 * Deliberately self-contained: it names the requirement, the command that checks it,
 * and the part a command cannot check. The last paragraph is the boundary the
 * deployment must not paper over — the system can deterministically require that a
 * judgement has been made and recorded, and it cannot deterministically produce the
 * judgement.
 */
const MODE_RULES = {
  research: [
    'WORK MODE: RESEARCH.',
    '',
    'This session is in RESEARCH mode. Its output is understanding, not a change to the',
    'system.',
    '',
    'REQUIRED BEFORE WORK (all four, stated and confirmed with the user):',
    '  1. the objective, in one sentence, with no vague verb;',
    '  2. the scope: the paths or the subsystem the work may look at;',
    '  3. the proof: how the answer will be shown, or an explicit statement that no',
    '     measurement exists yet;',
    '  4. the constraints: what must not change, and whose authority the work needs.',
    '',
    'NOT REQUIRED: a decision record and a specification. Research produces no law and',
    'no work order, and nothing refuses it for that. Write a decision record only if the',
    'user asks for one in the conversation.',
    '',
    'What still binds: every general rule, including the read-only rule for remote',
    'systems and the evidence rule for anything you report as found.',
  ].join('\n'),
  implementation: [
    'WORK MODE: IMPLEMENTATION.',
    '',
    'This session is in IMPLEMENTATION mode. Its output is a change to the system, and',
    'three things must exist BEFORE the first write.',
    '',
    'REQUIRED BEFORE THE FIRST WRITE (all three, stated and confirmed with the user):',
    '  1. an underlying decision record — `status: proposed` is enough, because a',
    '     proposal licenses the work it describes; if none exists, propose one first',
    '     (`ratchet_ingest_source`, or an ADR written by hand).',
    '  2. a defined task: what is being changed, by name, with the paths it may write.',
    '  3. a defined measure of the result AND the procedure that measures it: the exact',
    '     command, run now, whose output shows the work done.',
    '',
    'What a command refuses, and what it does NOT — the boundary, stated exactly:',
    '  - Requirement 1 HAS an enforcement point: a zone whose manifest entry sets',
    '    `requiresDecisionRecord: true` makes the write guard refuse a write in that zone',
    '    until a record in force or proposed names it, and a `humanOnly` zone is never',
    '    licensed by a proposal. It is necessary and NOT sufficient, and the shortfall is',
    '    measured rather than suspected: the guard is satisfied by ANY record that ever',
    '    named the zone, so it cannot tell this task\'s decision from one written months',
    '    earlier, and it governs the harness\'s write tools rather than a shell command, a',
    '    Node script or a packing script that writes the same file.',
    '  - Requirements 2 and 3 are PROMPT-LEVEL ONLY. Nothing in this deployment fails when',
    '    a session in implementation mode declares no task and runs no measure. The nearest',
    '    command checks are narrower and land only where a measure is ALREADY declared: a',
    '    law whose check is a command fails until that command passes, and `ratchet verify`',
    '    reports a check that could not be evaluated rather than passing it; a work order',
    '    that is in flight with no acceptance criterion bound to a declared verification id',
    '    is reported by validateSpecs. Nothing requires a work order to exist, and binding',
    '    a write to one is a human\'s decision — it needs a manifest field and guard',
    '    semantics of its own, and a work order is keyed by path rather than by task, so it',
    '    would move the dilution down a level instead of removing it.',
    '  - The requirement that the change does not contradict the corpus in MEANING is',
    '    required and recorded, and the boundary is exact: the system can',
    '    deterministically require that a judgement has been made and recorded —',
    '    `ratchet compile` and `ratchet verify` print whether a corpus review has read',
    '    the law set now in force, and a review that is stale means no judgement covers',
    '    these laws — and it cannot deterministically PRODUCE the judgement. A recorded',
    '    blocking finding then refuses writes in the zones its law governs until the',
    '    change is fixed, the judged record is edited, or a human decides.',
    '  - A meaning check is never a law\'s `checks` entry: a check is a shell command and',
    '    a shell cannot spawn a judge. Never present it as one.',
    '  - Residual limits, stated so they are not mistaken for guarantees: a block is only',
    '    as good as the judge that raised it (a law-bound finding must quote the law it',
    '    judges, and a quote that does not match the compiled law makes the finding',
    '    unusable); a false positive refuses writes in the governed zones until it is',
    '    rebutted, and a false negative lets a contradiction through; and the block binds',
    '    writes in the governed zones, not every write.',
    '',
    'What still binds: every general rule, including the grilling rule. An ambiguous ask',
    'is itself the trigger: state the objective, the scope, the proof and the constraints,',
    'propose all four, and get them confirmed before the first write.',
  ].join('\n'),
}

/**
 * Decode a JWT-style capability token's signature, exactly as the panel's host half
 * does, so a token minted for this process is recognisable and a token from another
 * process is not trusted.
 *
 * @param token - The capability token from the index-injection row.
 * @returns The signature part, or the token itself when it carries no dot.
 */
function tokenSignature(token) {
  const text = String(token ?? '')
  const dot = text.lastIndexOf('.')
  return dot === -1 ? text : text.slice(dot + 1)
}

/**
 * Compare two capability tokens in constant time.
 *
 * A length difference short-circuits, which leaks the length only; every byte
 * comparison then runs over the whole shared prefix regardless of where it differs.
 *
 * @param left - Presented value.
 * @param right - Expected value.
 * @returns Whether the two are equal.
 */
function sameToken(left, right) {
  const a = Buffer.from(String(left ?? ''), 'utf8')
  const b = Buffer.from(String(right ?? ''), 'utf8')
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]
  return difference === 0
}

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
 * @returns The denial text.
 */
export function refusalText(ledger) {
  const entries = ledger.entries()
  const named = entries.map((entry) => {
    const who = entry.childId ?? entry.callId ?? '(unknown id)'
    const what = entry.label === null || entry.label === undefined || entry.label === '' ? '(no description given)' : entry.label
    return `  - ${who}: ${what}`
  })
  return [
    `refused: ${entries.length} subagent(s) are already running in this session and the cap is ${ledger.limit}.`,
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
 * @param ledger - A ledger from {@link createLedger}.
 * @param exec - The tool execution the guard received.
 * @param toolName - The delegation tool's registered name.
 * @returns The denial text, or `undefined` to leave the call allowed.
 */
export function refusalFor(ledger, exec, toolName = DEFAULT_TOOL_NAME) {
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
  if (ledger.countFor(root) >= ledger.limit) return refusalText(ledger)
  if (callId !== null) ledger.admit(callId, caller, exec.arguments?.description)
  return undefined
}

/**
 * The mode one session is in.
 *
 * @param modes - The session -> mode map.
 * @param session - The session id, or null for an unattributed assembly.
 * @param fallback - The mode to use when nothing has set one.
 * @returns One of {@link MODES}.
 */
export function resolveMode(modes, session, fallback = DEFAULT_MODE) {
  if (typeof session !== 'string' || session.length === 0) return fallback
  const mode = modes.get(session)
  return MODES.includes(mode) ? mode : fallback
}

/**
 * The rule text one session's mode contributes.
 *
 * @param modes - The session -> mode map.
 * @param session - The session id from the assembly's calling agent.
 * @param fallback - The mode to use when nothing has set one.
 * @returns The mode's rule text, never empty.
 */
export function modePromptText(modes, session, fallback = DEFAULT_MODE) {
  return MODE_RULES[resolveMode(modes, session, fallback)]
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
 * Install both policies.
 *
 * @param ctx - Cordis context; `systemPrompt` is present because `inject` names it.
 * @param config - Resolved plugin configuration; see the module header.
 * @returns Nothing; every registration is made through an effect scope owned by the fibre
 *   that supplies the service it uses, so a reload or a replaced service disposes the old
 *   registration instead of colliding with it.
 */
export function apply(ctx, config = {}) {
  const toolName = typeof config.toolName === 'string' && config.toolName.length > 0 ? config.toolName : DEFAULT_TOOL_NAME
  // The liveness probe is bound to the `agents` service LAZILY, for the same reason the
  // tool registry is requested rather than read: while `apply` runs, the registry may not
  // exist yet. `ctx.get` is therefore called at sweep time, and a composition with no
  // agent registry gets `null` — the age bound — rather than an error or a false release.
  const liveChild = (childId) => {
    const probe = liveChildProbe(ctx.get('agents'))
    return probe === null ? null : probe(childId)
  }
  const ledger = createLedger({ limit: usableLimit(config), staleAfterMs: config.staleAfterMs, liveChild })
  const defaultMode = MODES.includes(config.defaultMode) ? config.defaultMode : DEFAULT_MODE
  const modes = new Map()
  const route = typeof config.modeRoute === 'string' && config.modeRoute.startsWith('/') ? config.modeRoute : MODE_ROUTE

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
      () => scope.tools.guard((exec) => refusalFor(ledger, exec, toolName)),
      'work-modes: the subagent concurrency guard',
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
  // A settled tool result is deliberately NOT used to release the slot. Measured while
  // building this: for a background or continuable delegation the tool returns as soon
  // as the child is established, so releasing on the result would free the slot the
  // moment the child started working — the opposite of a concurrency cap. The slot a
  // call holds is released by the child's start edge consuming it, by a terminal edge,
  // by the agent registry no longer holding the child, or — for an entry no registry
  // answered for — by the age bound.

  // ── the work mode ─────────────────────────────────────────────────────────
  const order = ctx.systemPrompt.getSectionOrder?.(MODE_SECTION_NAME) ?? MODE_SECTION_ORDER
  ctx.effect(() => {
    const dispose = ctx.systemPrompt.section({
      name: MODE_SECTION_NAME,
      order,
      // A provider, not a string: this is what reads the calling session on every
      // assembly, so a toggle takes effect on the next request.
      text: (context) => modePromptText(modes, context?.agent?.id ?? null, defaultMode),
    })
    return () => dispose()
  })

  // ── the toggle's route ────────────────────────────────────────────────────
  // Requested, exactly as the tool registry is. A deployment with no web server still
  // gets the cap and the prompt section; a deployment whose web server is mounted on a
  // later turn still gets the route and the capability global, because the registration
  // happens when the service appears rather than when `apply` happens to run. The path,
  // the capability header and the browser fence follow the shape the ADR panel already
  // uses, so one reader learns one pattern: inside this callback `web` is the context
  // scope, `web.webServer` is the carrier service, and `web.on` is the event bus.
  ctx.inject(['webServer'], (web) => {
    const token = Buffer.from(`${Date.now()}.${Math.random().toString(36).slice(2)}`).toString('base64url')
    web.effect(
      () => web.on('webserver/index-inject', (table) => {
        table.push({ kind: 'global', name: MODE_GLOBAL, value: { route, token } })
      }),
      'work-modes: publish the mode capability',
    )
    web.effect(
      () => web.webServer.register({
        kind: 'exact',
        path: route,
        handler: (request, response) => handleModeRequest({ request, response, modes, defaultMode, token, ctx }),
      }),
      `work-modes: GET/POST ${route}`,
    )
    // The log line is best-effort: a logger that is absent or that throws must never be
    // the reason a route is missing, because the route's absence is silent.
    try {
      ctx.logger?.info?.(`work-modes: mode route registered at ${route}`)
    } catch {
      // Deliberately swallowed; see above.
    }
  })
}

/**
 * Serve the mode toggle.
 *
 * Four gates before anything is read or written, in this order: the browser trust
 * fence (the connection service rejects an untrusted authority or a missing cookie
 * before this handler runs), this route's capability header, a readable session id,
 * and a mode that is one of the two. A refusal is JSON with a status code and writes
 * nothing.
 *
 * @param options - `{ request, response, modes, defaultMode, token, ctx }`.
 * @returns Nothing; the response is owned by this handler.
 */
function handleModeRequest({ request, response, modes, defaultMode, token, ctx }) {
  const send = (status, body) => {
    const text = JSON.stringify(body)
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(text)
  }
  const presented = request.headers?.[MODE_HEADER]
  // A wrong capability is refused before anything else: a request that was not served
  // this process's index never holds the token it was injected with.
  if (!sameToken(tokenSignature(presented), tokenSignature(token))) {
    ctx.logger?.warn?.('work-modes: refused the mode route: no capability token, or a wrong one')
    send(403, { error: 'forbidden', message: 'the work-mode route requires this process\'s capability token' })
    return
  }
  const url = new URL(request.url ?? '/', 'http://localhost')
  if (request.method === 'GET') {
    const session = url.searchParams.get('session')
    if (typeof session !== 'string' || session.length === 0) {
      send(400, { error: 'bad-request', message: 'a session id is required: the mode is session state' })
      return
    }
    send(200, { session, mode: resolveMode(modes, session, defaultMode), modes: [...MODES] })
    return
  }
  if (request.method !== 'POST') {
    send(405, { error: 'method-not-allowed', message: 'GET reads the mode, POST sets it' })
    return
  }
  let body = ''
  request.on('data', (chunk) => {
    body += chunk
  })
  request.on('end', () => {
    let parsed = null
    try {
      parsed = JSON.parse(body === '' ? '{}' : body)
    } catch {
      send(400, { error: 'bad-request', message: 'the body is not JSON' })
      return
    }
    const session = parsed?.session
    const mode = parsed?.mode
    if (typeof session !== 'string' || session.length === 0) {
      send(400, { error: 'bad-request', message: 'a session id is required: the mode is session state' })
      return
    }
    if (!MODES.includes(mode)) {
      send(400, { error: 'bad-request', message: `mode must be one of ${MODES.join(', ')}` })
      return
    }
    modes.set(session, mode)
    send(200, { session, mode, modes: [...MODES] })
  })
}

export { MODE_RULES }
