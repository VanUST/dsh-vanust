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
 * MEASURED HARNESS FACTS (from the installed harness source, not from tool prose)
 *   - `subagents.startContinuable({ provider, label, request, signal })` establishes a
 *     durable child and resolves once the child's inbox accepts the initial prompt. It
 *     returns `{ childId, messageId }` — a DURABLE id and no run, no result promise.
 *     (`@deepseek-ai/dsh-subagent` `src/index.ts` `startContinuable`; `src/types.ts`
 *     `ContinuableStartSpec` / `ContinuableStart`.)
 *   - `subagents.sendMessage(parent, childId, content, { signal })` steers one message to
 *     an existing direct continuable child, starting a turn when it is idle and
 *     cold-resuming it from persistence when it is not resident. It resolves with the
 *     accepted inbox message id, NOT a result. (`src/index.ts` `sendMessage`;
 *     `src/types.ts` `SubagentSendMessageOptions`.)
 *   - A continuable child CANNOT carry an `outputSchema`: `ContinuableStartSpec.request`
 *     is `Omit<SubagentStartRequest, 'label' | 'signal' | 'outputSchema'>`, so there is no
 *     structured capture on the durable path, and `sendMessage` carries no schema
 *     parameter at all. Per-call structured output to an existing child is therefore
 *     impossible through the public seam; the closest thing — used here — is to read the
 *     child's final assistant message for each turn and parse the JSON out of it, which
 *     `ratchet-dynamic.parseVerdict` already supports (`source: 'text' | 'fenced' |
 *     'embedded'`). The production prompts already instruct "reply with ONLY this JSON
 *     object" in their `# Answer format` section.
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
 * @module @cc/dsh-ratchet/judge
 */

/** Provider name the judge child is created on. The in-process `spawn` provider supports continuable creation. */
export const JUDGE_PROVIDER = 'spawn'

/** Persisted short label for every judge child, so a reader can tell one from a task subagent. */
export const JUDGE_LABEL = 'ratchet-judge'

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
 * Reads one turn's answer out of a child session's event suffix.
 *
 * @param events - The events appended since the turn boundary.
 * @returns `{ text, stopReason }`; `text` is the last non-empty assistant message (falling
 *   back to the accumulated stream text), or an empty string when the turn produced none.
 */
export function readTurn(events) {
  const list = Array.isArray(events) ? events : []
  let message = null
  let streamed = ''
  let stopReason = 'completed'
  for (const event of list) {
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
 *   per job.
 * INPUTS: An options object `{ runtimeOf, agentsOf, provider = 'spawn', label = 'ratchet-judge',
 *   log = () => {} }`. `runtimeOf()` returns the subagents runtime or `undefined`;
 *   `agentsOf()` returns the agent registry or `undefined`; `log(event)` receives a
 *   structured lifecycle event and must never throw.
 * OUTPUTS: `{ judge(options), dispose({ parent }) }`. `judge({ parent, signal, prompt,
 *   outputSchema, staticPrompt })` returns `Promise<{ structured, output, stopReason,
 *   diagnostic, childId, created, reused }>`, or rejects when no runtime/agents are mounted
 *   or the judge could not be driven. `structured` is ALWAYS `null` on this path — the
 *   continuable seam accepts no output schema — and `output` carries the judge's JSON text.
 *   `outputSchema` is accepted for signature compatibility with the one-shot spawner and is
 *   ignored. `dispose({ parent })` releases that parent's judge if one is resident.
 * KEYWORDS: ratchet, judge, subagent, continuable, reuse, serialization, lifecycle, cost
 *
 * Edge cases:
 *   - No runtime or no agent registry: `judge()` rejects; the tool layer never builds a
 *     pool in that composition (it returns `null` as the spawner instead).
 *   - Two concurrent `judge()` calls for one parent: serialized by a per-parent promise
 *     chain, so their turns never interleave.
 *   - A cancelled call: its own turn is interrupted, the shared child is kept, and only
 *     that call's promise rejects.
 *   - A dead/errored or stale child: released best-effort and recreated once for the call
 *     that discovered it.
 *   - `staticPrompt` absent, empty, or not a prefix of `prompt`: the full prompt is sent and
 *     no prefix is assumed, so every call is treated as its own static anchor.
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
  /** Parent Agent -> { childId, staticText, dead, chain }. A WeakMap so a parent can be collected with its entry. */
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
      entry = { childId: null, staticText: null, dead: false, chain: Promise.resolve() }
      entries.set(parent, entry)
    }
    return entry
  }

  /** Releases one resident judge child of `parent`, best-effort; never throws. */
  const release = async (runtime, parent, entry) => {
    const childId = entry.childId
    entry.childId = null
    entry.staticText = null
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
   * Awaits the current turn of a child and reads its answer.
   *
   * A boundary is taken from the live session before awaiting when the child is resident;
   * for a freshly created or cold-resumed child the boundary is `0`, so the last assistant
   * message in the child's log is this turn's answer.
   */
  const awaitTurn = async (runtime, agents, parent, entry, boundary, signal) => {
    const childId = entry.childId
    const live = agents.get(childId)
    if (live === undefined) {
      entry.dead = true
      throw new Error(`the judge child ${String(childId)} did not become resident`)
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
      if (typeof live.whenIdle === 'function') await live.whenIdle()
    } finally {
      signal?.removeEventListener?.('abort', onAbort)
    }
    const events = typeof live.session?.snapshotEvents === 'function'
      ? live.session.snapshotEvents(boundary)
      : []
    const read = readTurn(events)
    if (read.stopReason === 'error' || read.stopReason === 'refusal' || read.stopReason === 'max-tokens') {
      entry.dead = true
    }
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
   * the material after it.
   */
  const create = async (runtime, parent, entry, task, staticText, signal) => {
    const started = await runtime.startContinuable({
      provider,
      label,
      request: {
        prompt: [{ type: 'text', text: task }],
        parent,
      },
      signal,
    })
    entry.childId = started?.childId ?? null
    entry.staticText = staticText
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
    await runtime.sendMessage(parent, childId, [{ type: 'text', text: content }], { signal })
    return awaitTurn(runtime, agents, parent, entry, boundary, signal)
  }

  /** One serialized judge call for one parent's entry. */
  const runCall = async ({ parent, signal, prompt, staticPrompt }) => {
    const runtime = service(runtimeOf)
    const agents = service(agentsOf)
    if (runtime === undefined || agents === undefined) {
      throw new Error('the ratchet judge needs the subagents runtime and the agent registry, and one is not mounted')
    }
    const task = String(prompt ?? '')
    if (task.length === 0) throw new Error('the ratchet judge was given an empty task')
    const requestedStatic = isText(staticPrompt) && task.startsWith(staticPrompt)
      ? staticPrompt
      : task
    const entry = entryFor(parent)

    // At most two attempts: the second is the "recreate a dead or stale judge once" path.
    // A cancellation is never retried and never marks the shared child dead — the child is
    // healthy, only this tool call was stopped.
    let lastError = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const needsCreate =
        entry.childId === null ||
        entry.dead === true ||
        entry.staticText === null ||
        !task.startsWith(entry.staticText)
      try {
        if (needsCreate) {
          if (entry.childId !== null) {
            emit({ event: 'judge.recreate', childId: entry.childId, dead: entry.dead, reason: 'stale-or-dead' })
            await release(runtime, parent, entry)
          }
          await create(runtime, parent, entry, task, requestedStatic, signal)
          const result = await awaitTurn(runtime, agents, parent, entry, 0, signal)
          return { ...result, created: true, reused: false }
        }
        const content = task.slice(entry.staticText.length)
        const result = await deliver(runtime, agents, parent, entry, content, signal)
        return { ...result, created: false, reused: true }
      } catch (error) {
        lastError = error
        if (signal?.aborted === true) throw error
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
  const judge = ({ parent, signal, prompt, outputSchema, staticPrompt } = {}) => {
    if (parent === undefined || parent === null) {
      return Promise.reject(new Error('the ratchet judge needs the calling agent as its parent'))
    }
    const entry = entryFor(parent)
    const run = entry.chain.then(() => runCall({ parent, signal, prompt, outputSchema, staticPrompt }))
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
