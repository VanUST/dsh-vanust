/**
 * PURPOSE
 *   Answer the harness's two interactive waterfalls from a phone. When an agent asks the human a
 *   question, or wants permission for a risky action, and nobody is sitting at the desktop, this
 *   claims the request, pushes it to the phone, and returns whatever the human decides — so a turn
 *   that would otherwise fail closed or hang instead completes.
 *
 *   It is deliberately the LAST resort, never the first. The policy is desktop-first: if a GUI
 *   client is attached, the request is handed down the chain (`next()`) and this module does not
 *   even post it. If no phone is watching, it also hands down the chain, because an unattended
 *   bridge must leave the harness behaving exactly as it does today — a claimed question with
 *   nobody to answer it would turn a fail-closed default into a hung turn, which is strictly worse.
 *
 * INPUTS
 *   A hub that can report whether anyone is watching and can deliver a transient item, a logger
 *   sink, and `windowMs` — a safety-net deadline for a request that carries no cancellation signal
 *   of its own. Route handlers call `settle(pendingId, payload)` with the human's decision.
 *
 *   The authoritative deadline is the request's own `signal`, not `windowMs`. The timed
 *   `ask_user_question` tool waits 120 seconds by default (`dsh-tool-ask-user` config `timeout`)
 *   and then returns a *pending* notice; a bridge still holding the request after that is
 *   answering a question the harness has already stopped asking.
 *
 * OUTPUTS
 *   `askQuestions(request, next)` returns a `AskUserQuestionAnswer` (`{answers: [...]}`).
 *   `askApproval(request, next)` returns an `ApprovalOutcome`.
 *   `settle` returns a short status string a route can turn into a status code.
 *   Every listener returns a value or delegates; none of them throws into the turn.
 *
 * KEYWORDS
 *   chat bridge, waterfall, user-questions/request, approval/request, desktop-first, claim,
 *   pending request, timeout, cancellation signal, fail closed, phone
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No phone watching: delegates via `next()` without posting anything.
 *   - A GUI client attached: delegates via `next()` without posting anything.
 *   - The harness withdraws the request (its `signal` aborts): resolves immediately as unanswered,
 *     rather than waiting out `windowMs` on a question nobody is asking any more.
 *   - Timeout: questions resolve to `{answers: []}` (the human answered nothing); approvals
 *     resolve to `'cancelled'` (the request was withdrawn). Neither delegates at that point,
 *     because the chain may already have been abandoned and re-entering it is not safe.
 *   - The plugin unloading: every pending request is resolved as above rather than left hanging, so
 *     a reload cannot strand a turn.
 *   - An unknown `pendingId`, including one already answered: refused. The bridge keeps no settled
 *     ledger, so it reports that nothing is waiting rather than guessing which of the two it was.
 *   - A malformed answer from the phone: refused, and the request stays open — validation happens
 *     before the entry is touched, so a bad payload cannot destroy an answerable request.
 *   - A question whose `agent` carries no session identity: delegated, since the bridge cannot say
 *     which session it belongs to.
 */

/** Longest a pending question string may be, to bound what one phone frame can carry. */
const MAX_QUESTION_CHARS = 8000

/**
 * Read the session id a request belongs to.
 *
 * @param request - A question or approval request event.
 * @returns The session id as a string, or an empty string when the request names none.
 */
function sessionOf(request) {
  const agent = request?.agent
  const id = agent?.session?.id ?? agent?.id
  return typeof id === 'string' ? id : ''
}

/**
 * Trim one question item to the fields the phone renders, within a size bound.
 *
 * @param item - One `AskUserQuestionItem`.
 * @returns A plain object safe to send to a browser.
 */
function phoneQuestion(item) {
  const options = Array.isArray(item?.options)
    ? item.options
        .filter((option) => option !== null && typeof option === 'object')
        .map((option) => ({
          label: String(option.label ?? ''),
          ...(typeof option.description === 'string' ? { description: option.description } : {}),
        }))
    : undefined
  return {
    id: String(item?.id ?? ''),
    question: String(item?.question ?? '').slice(0, MAX_QUESTION_CHARS),
    ...(typeof item?.detail === 'string' ? { detail: item.detail.slice(0, MAX_QUESTION_CHARS) } : {}),
    ...(typeof item?.header === 'string' ? { header: item.header } : {}),
    ...(options === undefined ? {} : { options }),
    ...(item?.multiSelect === true ? { multiSelect: true } : {}),
    // The presentation intent is forwarded verbatim: `plan-review` NAMES the option that approves
    // a plan precisely so a UI never infers the verdict from option order.
    ...(item?.intent === undefined ? {} : { intent: item.intent }),
  }
}

/**
 * Validate one answer batch against the questions that were actually asked.
 *
 * The harness does not do this: an answer whose `id` matches no question is passed straight into
 * the tool result (measured — a batch for `recheck` was recorded verbatim for a question whose id
 * was `refactor`). That leaves the model reading an answer that answers nothing, so the bridge
 * checks it here while it still has the questions to check against.
 *
 * @param answers - Candidate answers from the phone.
 * @param allowed - Map of question id to `{labels, multi}`.
 * @returns `{ok: true, value}` or `{ok: false, reason}`.
 */
function validateAnswers(answers, allowed) {
  if (!Array.isArray(answers) || answers.length === 0) return { ok: false, reason: 'answers must be a non-empty array' }
  const cleaned = []
  for (const answer of answers) {
    if (answer === null || typeof answer !== 'object') return { ok: false, reason: 'each answer must be an object' }
    const id = String(answer.id ?? '')
    const question = allowed.get(id)
    if (question === undefined) {
      return { ok: false, reason: `no question with id ${JSON.stringify(id)} was asked` }
    }
    const selected = Array.isArray(answer.selected) ? answer.selected.map((value) => String(value)) : []
    for (const label of selected) {
      // A question that offered no options is free-form, so any label is acceptable; one that
      // offered options accepts only those labels.
      if (question.labels !== null && !question.labels.has(label)) {
        return { ok: false, reason: `${JSON.stringify(label)} is not an option of question ${JSON.stringify(id)}` }
      }
    }
    if (question.multi !== true && selected.length > 1) {
      return { ok: false, reason: `question ${JSON.stringify(id)} is single-select but ${String(selected.length)} options were chosen` }
    }
    const custom = typeof answer.custom === 'string' && answer.custom !== '' ? answer.custom.slice(0, MAX_QUESTION_CHARS) : undefined
    if (selected.length === 0 && custom === undefined) {
      return { ok: false, reason: `question ${JSON.stringify(id)} has neither a selection nor custom text` }
    }
    cleaned.push({ id, selected, ...(custom === undefined ? {} : { custom }) })
  }
  return { ok: true, value: cleaned }
}

/**
 * The broker between the harness's answerer waterfalls and a phone.
 */
export class AskBroker {
  /**
   * @param options - `{hub, log, windowMs}`.
   */
  constructor(options) {
    this.hub = options.hub
    this.log = options.log
    this.windowMs = Number.isFinite(options.windowMs) && options.windowMs > 0 ? options.windowMs : 10 * 60 * 1000
    /** In-flight requests by the opaque id the phone answers with. */
    this.pending = new Map()
  }

  /**
   * Whether the bridge should claim rather than delegate.
   *
   * @param ctx - Cordis context, for the gateway that answers "is the desktop attached?".
   * @returns `{ claim, reason }`; `reason` is logged when the bridge stands down.
   */
  shouldClaim(ctx) {
    const gateway = ctx.get('typertGateway')
    if (gateway !== undefined && gateway !== null && typeof gateway.hasLiveClient === 'function') {
      // A GUI client is attached, so the desktop is attending and owns this one. Note the
      // asymmetry: `hasLiveClient()` being false does NOT prove nobody is there — it is only
      // evidence that no Web client holds an event stream — so it is used to stand down, never to
      // justify claiming on its own.
      if (gateway.hasLiveClient() === true) return { claim: false, reason: 'a desktop client is attached' }
    }
    if (!this.hub.hasViewers()) return { claim: false, reason: 'no phone is watching' }
    return { claim: true, reason: 'the phone owns it' }
  }

  /**
   * Register one pending request and push it to the phone.
   *
   * The harness's own cancellation lifetime is the real deadline, not this broker's window. The
   * timed `ask_user_question` tool waits 120 s by default (`dsh-tool-ask-user` config `timeout`)
   * and then returns a *pending* notice; a bridge that held the request open past that would be
   * answering a question the harness has already stopped asking. So `signal` — the request's own
   * lifetime — resolves the request immediately when it aborts, and `windowMs` is only a safety
   * net for a request that carried no signal at all.
   *
   * @param pendingId - Opaque id the phone answers with.
   * @param kind - `question` or `approval`.
   * @param sessionId - Owning session.
   * @param item - The render item to deliver.
   * @param signal - The request's cancellation lifetime, when it has one.
   * @param allowed - Question ids and their permitted labels, for validating the answer.
   * @returns A promise for the human's answer.
   */
  park(pendingId, kind, sessionId, item, signal, allowed = new Map()) {
    const unanswered = kind === 'approval' ? 'cancelled' : { answers: [] }
    return new Promise((resolve) => {
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener?.('abort', onAbort)
        this.pending.delete(pendingId)
        resolve(value)
      }
      const onAbort = () => {
        this.log.warn(`chat-bridge: ${kind} ${pendingId} was withdrawn by the harness; resolving unanswered`)
        finish(unanswered)
      }
      const timer = setTimeout(() => {
        this.log.warn(`chat-bridge: ${kind} ${pendingId} expired with no answer; resolving unanswered`)
        finish(unanswered)
      }, this.windowMs)

      if (signal !== undefined && signal !== null && typeof signal.addEventListener === 'function') {
        if (signal.aborted === true) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }

      // `finish` owns deletion, so the entry is stored with the resolver the human's answer uses.
      this.pending.set(pendingId, { kind, sessionId, finish, allowed })

      if (!this.hub.deliver(sessionId, item)) {
        // Nobody received it (the last viewer left between the check and the delivery). Resolve
        // now rather than holding the turn for the full window on an undelivered question.
        this.log.warn(`chat-bridge: ${kind} ${pendingId} had no reachable viewer; resolving unanswered`)
        finish(unanswered)
      }
    })
  }

  /**
   * Claim a user question for the phone.
   *
   * @param ctx - Cordis context.
   * @param request - `AskUserQuestionRequestEvent`.
   * @param next - The rest of the answerer chain.
   * @returns The human's answer, or whatever the chain produced.
   */
  async askQuestions(ctx, request, next) {
    const decision = this.shouldClaim(ctx)
    if (!decision.claim) return next()
    const sessionId = sessionOf(request)
    if (sessionId === '') {
      this.log.warn('chat-bridge: a question named no session; delegating')
      return next()
    }
    const pendingId = `q_${globalThis.crypto.randomUUID()}`
    const questions = (Array.isArray(request?.questions) ? request.questions : []).map(phoneQuestion)
    // What an answer is allowed to say, derived from the questions as asked. A question with no
    // options is free-form (`labels: null`); one with options accepts only those labels.
    const allowed = new Map(
      questions.map((question) => [
        question.id,
        {
          labels: Array.isArray(question.options) ? new Set(question.options.map((option) => option.label)) : null,
          multi: question.multiSelect === true,
        },
      ]),
    )
    this.log.info(`chat-bridge: asking the phone ${String(questions.length)} question(s) for ${sessionId}`)
    const answer = await this.park(
      pendingId,
      'question',
      sessionId,
      {
        kind: 'question',
        seq: null,
        pendingId,
        sessionId,
        questions,
        expiresAt: Date.now() + this.windowMs,
      },
      request?.signal,
      allowed,
    )
    return answer
  }

  /**
   * Claim an approval for the phone.
   *
   * @param ctx - Cordis context.
   * @param request - `ApprovalRequestEvent`.
   * @param next - The rest of the answerer chain.
   * @returns An `ApprovalOutcome`, or whatever the chain produced.
   */
  async askApproval(ctx, request, next) {
    const decision = this.shouldClaim(ctx)
    if (!decision.claim) return next()
    const sessionId = sessionOf(request)
    if (sessionId === '') {
      this.log.warn('chat-bridge: an approval named no session; delegating')
      return next()
    }
    const pendingId = `a_${globalThis.crypto.randomUUID()}`
    this.log.info(`chat-bridge: asking the phone to approve ${String(request?.toolName ?? 'a tool')} in ${sessionId}`)
    return this.park(
      pendingId,
      'approval',
      sessionId,
      {
        kind: 'approval',
        seq: null,
        pendingId,
        sessionId,
        toolName: String(request?.toolName ?? 'a tool'),
        ...(typeof request?.reason === 'string' ? { reason: request.reason } : {}),
        expiresAt: Date.now() + this.windowMs,
      },
      request?.signal,
    )
  }

  /**
   * Accept one human decision from a route.
   *
   * @param pendingId - The id the item carried.
   * @param payload - `{answers}` for a question, `{outcome}` for an approval.
   * @returns `{status, reason?}` where status is `settled`, `unknown` or `bad-request`. The reason
   *   is carried out so the phone is told which rule it broke, rather than a generic refusal that
   *   sends its developer looking in the wrong place.
   */
  settle(pendingId, payload) {
    if (typeof pendingId !== 'string' || pendingId === '') return { status: 'bad-request', reason: 'a pendingId is required' }
    const entry = this.pending.get(pendingId)
    if (entry === undefined) {
      // Distinguishable from "already answered" only in the log; the phone is told the same thing
      // either way, which is the honest answer because the bridge does not keep a settled ledger.
      return { status: 'unknown', reason: 'no request is waiting under that pendingId' }
    }

    // Validation happens BEFORE the entry is touched, so a malformed answer leaves the request
    // open and answerable rather than destroying it. The earlier shape of this function removed
    // the entry, then re-inserted it with a fresh timer on the invalid path — which silently
    // discarded the request's own cancellation listener.
    if (entry.kind === 'approval') {
      const outcome = payload?.outcome
      // `unavailable` is the harness's own fail-closed value, not a human decision, so the phone
      // may not send it: a grant must be a grant and a refusal a refusal.
      if (outcome !== 'allowed-once' && outcome !== 'rejected') {
        return { status: 'bad-request', reason: 'outcome must be "allowed-once" or "rejected"' }
      }
      entry.finish(outcome)
      return { status: 'settled' }
    }

    const checked = validateAnswers(payload?.answers, entry.allowed)
    if (!checked.ok) {
      this.log.warn(`chat-bridge: refused an answer to ${pendingId}: ${checked.reason}`)
      return { status: 'bad-request', reason: checked.reason }
    }
    entry.finish({ answers: checked.value })
    return { status: 'settled' }
  }

  /** How many requests are waiting on the phone. */
  get size() {
    return this.pending.size
  }

  /**
   * Resolve every pending request as unanswered.
   *
   * Called when the plugin unloads. Resolving rather than dropping is what keeps a reload from
   * stranding a turn that is waiting on the bridge.
   *
   * @returns Nothing.
   */
  closeAll() {
    for (const entry of [...this.pending.values()]) entry.finish(entry.kind === 'approval' ? 'cancelled' : { answers: [] })
  }
}
