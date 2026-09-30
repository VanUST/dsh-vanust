/**
 * The ratchet judge pool: one durable judge child per calling parent, reused across
 * every ratchet review and ingestion in that session.
 *
 * WHY THIS EXISTS
 *   The dynamic layer used to call `subagents.start('spawn', …)` once per judge job and
 *   always `dispose()` the run in `finally`. Each call therefore paid to create a fresh
 *   child agent (new session, new system prompt, the whole judge orientation re-read)
 *   and threw it away at the end. A session that ran four reviews paid for four child
 *   agents. This module keeps ONE continuable child per parent and drives each later job
 *   as a follow-up turn on that child, so the agent and its loaded context are paid for
 *   once.
 *
 * THE JUDGE IS KEYED ON ITS ROLE, NOT ON THE CORPUS
 *   The first version of this pool reused the child only while the new prompt started with
 *   a stored byte prefix, and for a review that prefix was `renderStableContext` — the law
 *   list and the spec hash. Every accepted, edited or ratified decision therefore changed
 *   the prefix and destroyed the judge, which is the one moment the pool existed to serve:
 *   the ratchet's whole job is to change the corpus. Measured on one session, two children
 *   were created two hours apart with five decision commits between them, and the second
 *   then served thirteen turns and re-read its whole orientation each time.
 *
 *   Reuse is therefore keyed on `cacheKey` (the judge's role), never on the material. When
 *   the stored material is still a prefix of the new prompt the cheap path is unchanged and
 *   only the tail travels; when it is not, the WHOLE prompt travels again on the SAME child,
 *   prefixed with {@link SUPERSEDE_NOTE}, which tells the judge that what it was shown before
 *   is withdrawn. A child is replaced only when it is genuinely gone or the caller changes
 *   the role key.
 *
 *   The alternative — a fresh one-shot child per job with an `outputSchema` — is cheaper per
 *   call and gives structured output, but it is exactly the behaviour this pool exists to
 *   stop, and it does not remove the per-call model cost.
 *
 * NON-RESIDENCY IS NOT DEATH
 *   In the installed harness a continuable child is a durable Session with a DISPOSABLE
 *   Agent: the live Agent is torn down once its turn settles
 *   (`dsh-subagent/lib/types/continuation-activation.js` `settlementState`/`dispose`), and
 *   the next `sendMessage` cold-resumes it from persistence
 *   (`.../continuation.js` rejects nothing when the activation is absent — it resumes). So
 *   an agent-registry read that does not currently hold the child is the normal between-turns
 *   state, not a death, and this pool no longer treats it as one. It also no longer treats a
 *   `max-tokens` or `refusal` STOP REASON as a death: that is a property of one answer, not of
 *   the child. A child is replaced when a creation or a delivery throws, and not otherwise.
 *
 * MEASURED HARNESS FACTS (from the installed harness source, not from tool prose)
 *   - `subagents.startContinuable({ provider, label, request, signal })` establishes a
 *     durable child and resolves once the child's inbox accepts the initial prompt, which is
 *     after materialization registers it in the agent registry: the child IS reachable with
 *     `agents.get(childId)` at that instant. It returns `{ childId, messageId }` — a DURABLE
 *     id and no run, no result promise.
 *     (`@deepseek-ai/dsh-subagent` `src/index.ts` `startContinuable`; `src/types.ts`
 *     `ContinuableStartSpec` / `ContinuableStart`.)
 *   - `subagents.sendMessage(parent, childId, content, { signal })` steers one message to
 *     an existing direct continuable child, starting a turn when it is idle and cold-resuming
 *     it from persistence when it is not resident. It returns inside the per-child lock, so a
 *     returned send means the child was resident in that critical section; it resolves with
 *     the accepted inbox message id, NOT a result. (`src/index.ts` `sendMessage`;
 *     `src/types.ts` `SubagentSendMessageOptions`.)
 *   - A continuable child CANNOT carry an `outputSchema`: `ContinuableStartSpec.request` is
 *     `Omit<SubagentStartRequest, 'label' | 'signal' | 'outputSchema'>`, so there is no
 *     structured capture on the durable path, and `sendMessage` carries no schema parameter at
 *     all. Per-call structured output to an existing child is therefore impossible through the
 *     public seam; the closest thing — used here — is to read the child's final assistant
 *     message for each turn and parse the JSON out of it, which `ratchet-dynamic.parseVerdict`
 *     already supports (`source: 'text' | 'fenced' | 'embedded'`). The production prompts
 *     already instruct "reply with ONLY this JSON object" in their `# Answer format` section.
 *   - The live child is reached with `agents.get(childId)` (`@deepseek-ai/dsh-agent`
 *     `AgentRegistry.get`), its status via `agent.status`, and its turn is awaited with
 *     `agent.whenIdle()` (`src/runtime-types.ts`, "Resolve after the current whole-agent
 *     activity reaches quiescence"). This turn's output is read from
 *     `agent.session.snapshotEvents(boundary)` (`@deepseek-ai/dsh-session`).
 *   - `subagents.interrupt(childId, { kind: 'ancestor', agent: parent })` stops one live
 *     child's current turn WITHOUT releasing the Activation (`src/index.ts`), which is
 *     what lets a cancelled tool call cancel only its own turn.
 *   - `subagents.drainContinuableChildren(parent, [childId])` releases selected resident
 *     children of one exact parent (`src/index.ts`), used here when a judge is stale or
 *     has errored and must be replaced.
 *   - A continuable child is OWNED BY THE RUNTIME, not by this pool. It is designed to
 *     persist across parent turns (and to cold-resume after a restart), so the pool does
 *     not dispose it when a call finishes — that per-call disposal was the defect. The
 *     harness releases a parent's continuable descendants when a host tears the parent
 *     down (`drainContinuableDescendants`, e.g. the ACP session) or at process exit; the
 *     pool's own registry is a `WeakMap` keyed by the exact parent Agent, so an entry
 *     becomes unreachable with its parent and never keeps it alive.
 *
 * A RESTART LOSES THE MAP, NOT THE CHILD
 *   The `WeakMap` is process memory, so a restart (or a resumed Agent) builds a pool that holds
 *   no child for a session that already has one — and the old pool-created second judge: measured
 *   on the `Unnamed` project, one session held two judges and two resolvers across a `dsh web`
 *   restart, the duplicate pair spending about 1.5M prompt tokens on work already done. The id
 *   is not lost: `establishCatalogChild` writes a `subagent/catalog` record into the PARENT
 *   session's durable log for every continuable child it creates, and `Session.snapshotEvents()`
 *   reads it back. {@link cataloguedJudgeChild} folds those records for this pool's label, and a
 *   fresh entry adopts the id and delivers to it, so a restart continues the child instead of
 *   paying for another. The adopted child's static prefix is unknown, so the whole task travels
 *   with {@link SUPERSEDE_NOTE} — the same shape a corpus change already uses. Replacement is
 *   unchanged: a delivery the runtime refuses still marks the child gone and creates one.
 *
 * @module @cc/dsh-ratchet/judge
 */

/** Provider name the judge child is created on. The in-process `spawn` provider supports continuable creation. */
export const JUDGE_PROVIDER = 'spawn'

/** Persisted short label for every judge child, so a reader can tell one from a task subagent. */
export const JUDGE_LABEL = 'ratchet-judge'

/**
 * Prefix on a re-orientation turn: the judge is told in the same message that the material it
 * was shown before is withdrawn.
 *
 * The reused child's context spans law sets, so the supersede has to be explicit. It is part
 * of the message and not a separate turn, because a separate "forget that" turn would be a
 * second model call for every corpus change.
 */
export const SUPERSEDE_NOTE =
  'The material shown in your earlier turns is OUT OF DATE. Everything below SUPERSEDES it ' +
  'completely: answer only from the material that follows, and treat any earlier law list or ' +
  'question as withdrawn.\n\n'

/** How long a just-sent turn waits for its child to become reachable in the agent registry. */
export const RESIDENCY_WAIT_MS = 2000

/** The poll interval for that wait. */
export const RESIDENCY_POLL_MS = 20

/**
 * Finds the judge child a session ALREADY created, from the session's own durable log.
 *
 * PURPOSE: Let a pool that holds no entry for a session continue the child that session
 *   already has, instead of creating a second one. A process restart builds a new pool and a
 *   new Agent for the same session; the child itself is durable, and the harness cold-resumes
 *   it from its id, so the id is the only thing missing.
 * INPUTS: `parent` — the calling agent; `parent.session.snapshotEvents()` is the session's log,
 *   and anything without that method answers `null` rather than throwing. `label` — the child
 *   label to match; defaults to {@link JUDGE_LABEL}.
 * OUTPUTS: The `childId` of the LAST `subagent/catalog` record whose `mode` is `continuable`
 *   and whose `label` matches, or `null` when the session's log holds none. Never throws.
 * KEYWORDS: judge reuse, restart, durable child, session log, subagent catalog, cold resume
 *
 * Edge cases:
 *   - No `session`, no `snapshotEvents`, or a non-array answer: `null`, so a pool in a
 *     composition that exposes no log creates a child exactly as it did before.
 *   - A log whose last matching record names a child that is gone: the id is still returned;
 *     the delivery that follows is what discovers it is unreachable, and the existing
 *     replacement path then creates one child.
 *
 * @param parent - The calling agent, or anything.
 * @param label - The child label to match.
 * @returns The catalogued child id, or `null`.
 */
export function cataloguedJudgeChild(parent, label = JUDGE_LABEL) {
  const events = typeof parent?.session?.snapshotEvents === 'function' ? parent.session.snapshotEvents() : null
  if (!Array.isArray(events)) return null
  let found = null
  for (const event of events) {
    if (event === null || typeof event !== 'object' || event.type !== 'subagent/catalog') continue
    const data = event.data
    if (data === null || typeof data !== 'object') continue
    if (data.mode !== 'continuable') continue
    if (data.label !== label) continue
    if (!isText(data.childId)) continue
    found = data.childId
  }
  return found
}

/** Whether a value is a non-empty string. */
function isText(value) {
  return typeof value === 'string' && value.length > 0
}

/**
 * Joins the text blocks of an assistant message.
 *
 * @param content - A message content array, or any value.
 * @returns The joined text, or `null` when there is no non-empty text.
 */
function messageText(content) {
  if (!Array.isArray(content)) return null
  const text = content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
  return text.length > 0 ? text : null
}

/**
 * Reads the assistant stream text out of one `assistant/attempt` / `assistant/message` event.
 *
 * The stream record shape is backend-owned, so this is deliberately defensive: a record that
 * is not recognisable contributes nothing rather than throwing inside a judge call.
 *
 * @param stream - The event's `data.stream`, or any value.
 * @returns The concatenated stream text, or an empty string.
 */
function streamText(stream) {
  if (!Array.isArray(stream)) return ''
  let text = ''
  for (const record of stream) {
    if (typeof record?.text === 'string') text += record.text
    else if (typeof record?.delta === 'string') text += record.delta
  }
  return text
}

/**
 * Maps a harness turn-end reason to the subagent result vocabulary the ratchet reads.
 *
 * @param kind - The `reason.kind` of a `turn/end` event, or any value.
 * @returns One of `completed`, `aborted`, `max-tokens`, `error`, `refusal`.
 */
function stopReasonOf(kind) {
  switch (kind) {
    case undefined:
    case 'completed':
      return 'completed'
    case 'max-tokens':
      return 'max-tokens'
    case 'aborted':
    case 'interrupted':
      return 'aborted'
    case 'blocked':
      return 'refusal'
    default:
      return 'error'
  }
}

/**
 * Reads one turn's answer out of a child session's events.
 *
 * A reused child's Agent is torn down between turns, so its next send cold-resumes it and the
 * reader is handed the WHOLE log rather than a suffix (see `deliver`). The current turn's
 * events are the ones after the previous `turn/end`; without that cut the stream fallback below
 * would concatenate every earlier turn's text and answer with the whole conversation.
 *
 * @param events - The events appended since the turn boundary, or a child's whole log.
 * @returns `{ text, stopReason }`; `text` is the last non-empty assistant message of the
 *   current turn (falling back to that turn's accumulated stream text), or an empty string
 *   when the turn produced none.
 */
export function readTurn(events) {
  const list = Array.isArray(events) ? events : []
  // Cut at the second `turn/end` counted from the end: the last one closes the turn being read,
  // so the one before it is where that turn began. A log holding a single turn starts at 0.
  let start = 0
  let endsSeen = 0
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.type === 'turn/end') {
      endsSeen += 1
      if (endsSeen === 2) {
        start = index + 1
        break
      }
    }
  }
  let message = null
  let streamed = ''
  let stopReason = 'completed'
  for (const event of list.slice(start)) {
    if (event?.type === 'assistant/message') {
      const text = messageText(event.data?.message?.content)
      if (text !== null) message = text
      streamed += streamText(event.data?.stream)
    } else if (event?.type === 'assistant/attempt') {
      streamed += streamText(event.data?.stream)
    } else if (event?.type === 'turn/end') {
      stopReason = stopReasonOf(event.data?.reason?.kind)
    }
  }
  return { text: message ?? streamed, stopReason }
}

/**
 * Creates the per-session judge pool.
 *
 * PURPOSE: Serve every ratchet judge job in one session from ONE durable judge child,
 *   loading the judge's role and context once instead of creating and disposing a child
 *   per job, and keeping that child across the corpus changes the ratchet exists to make.
 * INPUTS: An options object `{ runtimeOf, agentsOf, provider = 'spawn', label = 'ratchet-judge',
 *   log = () => {} }`. `runtimeOf()` returns the subagents runtime or `undefined`;
 *   `agentsOf()` returns the agent registry or `undefined`; `log(event)` receives a
 *   structured lifecycle event and must never throw.
 * OUTPUTS: `{ judge(options), dispose({ parent }) }`. `judge({ parent, signal, prompt,
 *   outputSchema, staticPrompt, cacheKey })` returns `Promise<{ structured, output, stopReason,
 *   diagnostic, childId, created, reused }>`, or rejects when no runtime/agents are mounted
 *   or the judge could not be driven. `structured` is ALWAYS `null` on this path — the
 *   continuable seam accepts no output schema — and `output` carries the judge's JSON text.
 *   `outputSchema` is accepted for signature compatibility with the one-shot spawner and is
 *   ignored. `dispose({ parent })` releases that parent's judge if one is resident.
 * KEYWORDS: ratchet, judge, subagent, continuable, reuse, supersede, serialization, lifecycle, cost
 *
 * Edge cases:
 *   - No runtime or no agent registry: `judge()` rejects; the tool layer never builds a
 *     pool in that composition (it returns `null` as the spawner instead).
 *   - Two concurrent `judge()` calls for one parent: serialized by a per-parent promise
 *     chain, so their turns never interleave.
 *   - A cancelled call: its own turn is interrupted, the shared child is kept, and only
 *     that call's promise rejects.
 *   - A delivery that throws: the child is released best-effort and recreated once for the
 *     call that discovered it. A registry read that misses the child, and a `max-tokens` or
 *     `refusal` answer, are NOT deaths and replace nothing.
 *   - A fresh pool over a session whose log catalogs an existing judge: the child is ADOPTED
 *     and delivered to, never replaced, so a restart costs no second judge. If that delivery
 *     is refused the existing replacement path creates one — the same path a dead child takes.
 *   - `staticPrompt` absent, empty, or not a prefix of `prompt`: the full prompt is sent and
 *     no prefix is assumed, so every call is treated as its own static anchor.
 *   - `cacheKey` absent: the pool's `label` is the role, so one pool with no explicit keys
 *     reuses one judge for every job.
 *
 * @param options - See INPUTS.
 * @returns The pool.
 */
export function createJudgePool({
  runtimeOf,
  agentsOf,
  provider = JUDGE_PROVIDER,
  label = JUDGE_LABEL,
  log = () => {},
} = {}) {
  /** Parent Agent -> { childId, staticText, cacheKey, dead, chain }. A WeakMap so a parent can be collected with its entry. */
  const entries = new WeakMap()

  /** Reads a service, tolerating either a getter function or a raw value. */
  const service = (getter) => {
    if (typeof getter === 'function') {
      try {
        return getter()
      } catch {
        return undefined
      }
    }
    return getter
  }

  /** Reports one structured lifecycle event, never letting logging break a judge call. */
  const emit = (event) => {
    try {
      log(event)
    } catch {
      /* logging is diagnostics; a broken logger must not fail a review */
    }
  }

  /** Returns (creating when needed) the mutable entry for one parent. */
  const entryFor = (parent) => {
    let entry = entries.get(parent)
    if (entry === undefined) {
      entry = { childId: null, staticText: null, cacheKey: null, dead: false, chain: Promise.resolve() }
      entries.set(parent, entry)
    }
    return entry
  }

  /**
   * Marks an error as "the child itself is gone".
   *
   * Only a creation or a delivery can raise this. Everything else — a residency read that
   * missed the child, an unreadable answer — leaves the child reusable, and the marker is how
   * the call site tells the two apart without a second error channel.
   */
  const asChildGone = (error) => {
    const wrapped = new Error(String(error?.message ?? error))
    wrapped.ratchetChildGone = true
    wrapped.cause = error
    return wrapped
  }

  /** Releases one resident judge child of `parent`, best-effort; never throws. */
  const release = async (runtime, parent, entry) => {
    const childId = entry.childId
    entry.childId = null
    entry.staticText = null
    entry.cacheKey = null
    if (childId === null) return
    try {
      if (typeof runtime.drainContinuableChildren === 'function') {
        await runtime.drainContinuableChildren(parent, [childId])
      }
    } catch (error) {
      emit({ event: 'judge.release.failed', childId, reason: String(error) })
    }
  }

  /**
   * Waits, briefly and boundedly, for a just-sent child to appear in the agent registry.
   *
   * A continuable child is torn down once its turn settles, so a read that misses it can be a
   * turn that is already over — not a child that is gone. `sendMessage` returns inside the
   * lock that materializes the child, so this wait is a safety net for the tick between the
   * send returning and the driver waking, and never a liveness test.
   *
   * @returns The live agent, or `undefined` when it did not appear within the bound.
   */
  const waitForResident = async (agents, childId, signal) => {
    const deadline = Date.now() + RESIDENCY_WAIT_MS
    for (;;) {
      const live = agents.get(childId)
      if (live !== undefined) return live
      if (signal?.aborted === true) return undefined
      if (Date.now() >= deadline) return undefined
      await new Promise((resolve) => setTimeout(resolve, RESIDENCY_POLL_MS))
    }
  }

  /**
   * Awaits the current turn of a child and reads its answer.
   *
   * `live` is the handle captured in the same tick the send returned, which is the only moment
   * residency is guaranteed. When it is absent the child is re-read with a short bounded wait;
   * a child that still cannot be reached fails THIS call without being marked dead, because the
   * session it belongs to is durable and the next send resumes it.
   *
   * A boundary is taken from the live session before awaiting when the child is resident; for a
   * freshly created or cold-resumed child the boundary is `0`, so the last assistant message in
   * the child's log is this turn's answer.
   */
  const awaitTurn = async (runtime, agents, parent, entry, live, boundary, signal) => {
    const childId = entry.childId
    const target = live ?? (await waitForResident(agents, childId, signal))
    if (target === undefined) {
      throw new Error(`the judge child ${String(childId)} was not reachable for this turn`)
    }
    let interrupted = false
    const onAbort = () => {
      interrupted = true
      try {
        runtime.interrupt?.(childId, { kind: 'ancestor', agent: parent })
      } catch (error) {
        emit({ event: 'judge.interrupt.failed', childId, reason: String(error) })
      }
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener?.('abort', onAbort, { once: true })
    try {
      if (typeof target.whenIdle === 'function') await target.whenIdle()
    } finally {
      signal?.removeEventListener?.('abort', onAbort)
    }
    const events = typeof target.session?.snapshotEvents === 'function'
      ? target.session.snapshotEvents(boundary)
      : []
    const read = readTurn(events)
    if (interrupted || signal?.aborted) {
      throw new Error('the ratchet judge call was cancelled')
    }
    return {
      structured: null,
      output: read.text,
      stopReason: read.stopReason,
      diagnostic: null,
      childId,
    }
  }

  /**
   * Creates one durable judge child and delivers its first task.
   *
   * The creation prompt is the FULL first task (static orientation plus its question), so
   * the first job is answered in the child's first turn: no separate "boot" turn is paid
   * for. `entry.staticText` records the caller's static prefix so later calls can send only
   * the material after it, and `entry.cacheKey` records the role the child was created for.
   */
  const create = async (runtime, parent, entry, task, staticText, cacheKey, signal) => {
    let started
    try {
      started = await runtime.startContinuable({
        provider,
        label,
        request: {
          prompt: [{ type: 'text', text: task }],
          parent,
        },
        signal,
      })
    } catch (error) {
      throw asChildGone(error)
    }
    entry.childId = started?.childId ?? null
    entry.staticText = staticText
    entry.cacheKey = cacheKey
    entry.dead = false
    emit({
      event: 'judge.created',
      childId: entry.childId,
      provider,
      staticBytes: staticText.length,
      taskBytes: task.length,
    })
    return entry.childId
  }

  /** Sends one turn's material to the child, then awaits and reads its answer. */
  const deliver = async (runtime, agents, parent, entry, content, signal) => {
    const childId = entry.childId
    const boundary = agents.get(childId)?.session?.seq ?? 0
    try {
      await runtime.sendMessage(parent, childId, [{ type: 'text', text: content }], { signal })
    } catch (error) {
      throw asChildGone(error)
    }
    // Capture the handle in the same tick: the child's Agent is torn down once the turn
    // settles, so a registry read deferred to a later tick races that teardown.
    return awaitTurn(runtime, agents, parent, entry, agents.get(childId), boundary, signal)
  }

  /** One serialized judge call for one parent's entry. */
  const runCall = async ({ parent, signal, prompt, staticPrompt, cacheKey }) => {
    const runtime = service(runtimeOf)
    const agents = service(agentsOf)
    if (runtime === undefined || agents === undefined) {
      throw new Error('the ratchet judge needs the subagents runtime and the agent registry, and one is not mounted')
    }
    const task = String(prompt ?? '')
    if (task.length === 0) throw new Error('the ratchet judge was given an empty task')
    const key = isText(cacheKey) ? cacheKey : label
    const requestedStatic = isText(staticPrompt) && task.startsWith(staticPrompt)
      ? staticPrompt
      : task
    const entry = entryFor(parent)

    // A pool with no child for this session is not looking at a session that has none. The
    // session's own log catalogs every continuable child it created, and a restarted process (or
    // a resumed Agent) builds a fresh pool over a durable child. Adopting the catalogued id is
    // what keeps a restart from paying for a second judge; the delivery below is what proves the
    // child is reachable, and a runtime that refuses it falls through to the replacement path.
    if (entry.childId === null && entry.dead === false && entry.cacheKey === null) {
      const catalogued = cataloguedJudgeChild(parent, label)
      if (catalogued !== null) {
        entry.childId = catalogued
        entry.cacheKey = key
        // The adopted child's static prefix is unknown to this pool, so the whole task travels
        // with the supersede note — the same shape a corpus change already uses.
        entry.staticText = null
        emit({ event: 'judge.reattached', childId: catalogued, provider })
      }
    }

    // At most two attempts: the second is the "replace a child whose creation or delivery
    // failed" path. A cancellation is never retried, and neither a residency read that missed
    // the child nor an unusable answer is a reason to replace it.
    let lastError = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const needsCreate = entry.childId === null || entry.dead === true || entry.cacheKey !== key
      try {
        if (needsCreate) {
          if (entry.childId !== null) {
            emit({ event: 'judge.recreate', childId: entry.childId, dead: entry.dead, reason: 'gone-or-role-changed' })
            await release(runtime, parent, entry)
          }
          await create(runtime, parent, entry, task, requestedStatic, key, signal)
          const result = await awaitTurn(runtime, agents, parent, entry, agents.get(entry.childId), 0, signal)
          return { ...result, created: true, reused: false }
        }
        // Reuse the SAME child. The stored material is still a prefix only while the corpus has
        // not moved; when it has, the whole prompt travels again with the supersede note rather
        // than a new child being created.
        const sameMaterial = entry.staticText !== null && task.startsWith(entry.staticText)
        const content = sameMaterial ? task.slice(entry.staticText.length) : `${SUPERSEDE_NOTE}${task}`
        const result = await deliver(runtime, agents, parent, entry, content, signal)
        if (!sameMaterial) entry.staticText = requestedStatic
        return { ...result, created: false, reused: true }
      } catch (error) {
        lastError = error
        if (signal?.aborted === true) throw error
        if (error?.ratchetChildGone !== true) throw error
        entry.dead = true
        emit({ event: 'judge.failed', childId: entry.childId, attempt, reason: String(error) })
        await release(runtime, parent, entry)
      }
    }
    throw lastError ?? new Error('the ratchet judge could not be driven')
  }

  /**
   * Queues `runCall` behind every earlier call for the same parent.
   *
   * The queue is the serialization guarantee: two concurrent tools cannot interleave
   * their turns on the one child, and a rejected call does not stall the queue.
   */
  const judge = ({ parent, signal, prompt, outputSchema, staticPrompt, cacheKey } = {}) => {
    if (parent === undefined || parent === null) {
      return Promise.reject(new Error('the ratchet judge needs the calling agent as its parent'))
    }
    const entry = entryFor(parent)
    const run = entry.chain.then(() => runCall({ parent, signal, prompt, outputSchema, staticPrompt, cacheKey }))
    entry.chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Releases the judge held for a parent, if any. Safe for a parent that never had one. */
  const dispose = async (parent) => {
    if (parent === undefined || parent === null) return
    const entry = entries.get(parent)
    if (entry === undefined) return
    // Serialize behind in-flight work so a release cannot close a child mid-turn.
    await entry.chain
    const runtime = service(runtimeOf)
    if (runtime !== undefined) await release(runtime, parent, entry)
    entries.delete(parent)
    emit({ event: 'judge.disposed', parent: parent?.id ?? null })
  }

  return { judge, dispose }
}
