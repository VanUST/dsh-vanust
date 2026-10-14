/**
 * PURPOSE
 *   Turn one session's durable log into a live stream of render items that the phone client can
 *   draw, and share that one stream between every client watching the same session. This is the
 *   bridge's read path: a session opened by two phones, or reopened after a reload, costs the
 *   harness one `session/follow`, not one per viewer.
 *
 *   It is also where the at-least-once delivery contract is enforced. The harness numbers every
 *   durable event with a monotonic `seq`, so "what has this viewer already seen?" is one integer
 *   comparison per event. A viewer reconnecting with `after=N` receives the opening snapshot
 *   filtered to `seq > N`, and the live frames that follow it — so a phone that slept through a
 *   turn sees exactly the gap, and one that did not never sees a repeat.
 *
 * INPUTS
 *   A Cordis context carrying `sessionController`, a logger sink, and limits: `maxStreams` (how
 *   many sessions may be followed at once) and `idleMs` (how long a stream with no viewer is kept
 *   before it is closed, so a phone left on a shelf does not hold the harness open).
 *   Viewers call `subscribe(sessionId, after, sink)`; `sink(item)` receives render items.
 *
 * OUTPUTS
 *   `subscribe` returns an unsubscribe function. Items are `{seq, ...}` render items produced by
 *   `renderItem`. A stream failure is reported to viewers as `{kind:'error', message}` and the
 *   stream is dropped, so the next subscribe reopens it rather than serving a dead iterator.
 *
 * KEYWORDS
 *   chat bridge, session/follow, SSE, seq watermark, at-least-once, transcript, render item,
 *   stream hub, idle close, backpressure
 *
 * BEHAVIOUR ON EDGE CASES
 *   - `sessionController` absent: `subscribe` reports `{kind:'error'}` to the viewer rather than
 *     throwing, so a composition without the controller degrades to a visible message.
 *   - Unknown session id: the harness's follow iterator throws or ends; the viewer sees one error
 *     item and the stream is discarded.
 *   - No viewers for longer than `idleMs`: the iterator is cancelled and the entry removed.
 *   - More than `maxStreams` sessions: the least recently viewed stream is closed first.
 *   - A viewer that throws inside its sink: it is unsubscribed; the other viewers are unaffected,
 *     because one broken browser must not stop the stream for another.
 *   - Frame kinds this module does not recognise: ignored, and counted, rather than throwing.
 *   - Assistant stream frames are process-local and carry no durable seq; they are passed through
 *     with `seq: null` so a client never mistakes one for durable history.
 */

/** Event types this module turns into render items. Anything else is ignored and counted. */
const RENDERED = new Set(['user/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/end'])

/**
 * Concatenate the text blocks of a message content array.
 *
 * Only `text` blocks carry prose. Every other block kind is skipped rather than stringified, so a
 * reasoning or image block can never be mistaken for the model's answer.
 *
 * @param content - The `content` array of a message, or anything else.
 * @returns The concatenated text, or an empty string.
 */
function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

/** Argument fields worth showing first, most specific to least: a tool line on a phone has room
 *  for one fact, and the command or the path is almost always the useful one. */
const PREFERRED_ARGS = ['command', 'file_path', 'path', 'query', 'pattern', 'url', 'task', 'prompt', 'message', 'name']

/**
 * Summarise tool arguments in one short line.
 *
 * The phone shows a single line per tool call, so this picks the most informative field rather than
 * dumping the object. Arguments sometimes arrive already serialised as a JSON string (measured with
 * `ask_user_question`), in which case the string is parsed first — otherwise the summary would be
 * the whole payload with its quotes escaped, which is both unreadable and uninformative.
 *
 * @param args - The `arguments` payload of a `tool/call` event.
 * @returns A single-line summary, possibly empty.
 */
function summarizeArgs(args) {
  let value = args
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        value = JSON.parse(trimmed)
      } catch {
        // Not JSON after all: show the string itself rather than pretending to parse it.
        return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed
      }
    } else {
      return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed
    }
  }
  if (value === null || typeof value !== 'object') return ''
  for (const key of PREFERRED_ARGS) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate !== '') {
      return candidate.length > 120 ? `${candidate.slice(0, 117)}...` : candidate
    }
  }
  // No preferred field. Showing an arbitrary scalar here is worse than showing nothing: with
  // `{questions: [...], note: "ignored"}` the first scalar is the incidental one, so the tool line
  // would confidently report a value that is not what the call is about. One property can be shown
  // honestly; several are reported as the shape they have.
  const entries = Object.entries(value)
  if (entries.length === 1) {
    const only = entries[0][1]
    if (typeof only === 'string') return only.length > 120 ? `${only.slice(0, 117)}...` : only
    try {
      const text = JSON.stringify(only)
      if (text !== undefined && text.length <= 120) return text
    } catch {
      // Fall through to the key list.
    }
  }
  const keys = entries.map(([key]) => key)
  const shape = keys.length === 0 ? '' : keys.length <= 5 ? keys.join(', ') : `${keys.slice(0, 5).join(', ')}, …`
  return shape.length > 120 ? `${shape.slice(0, 117)}...` : shape
}

/**
 * Map one durable session event to a render item, or null when the client does not draw it.
 *
 * @param event - A `SessionWireEvent` (`{type, seq, time, data}`).
 * @returns A render item, or null.
 */
export function renderItem(event) {
  if (event === null || typeof event !== 'object') return null
  const type = event.type
  if (typeof type !== 'string' || !RENDERED.has(type)) return null
  const seq = Number.isSafeInteger(event.seq) ? event.seq : null
  const time = Number.isSafeInteger(event.time) ? event.time : null
  const data = event.data !== null && typeof event.data === 'object' ? event.data : {}

  if (type === 'user/message') {
    const text = textOf(data.content)
    if (text === '') return null
    // A reply the harness steered in as an answer to a question is still a user message, but the
    // phone should see it as the answer it was, not as something the human typed.
    const source = data.source !== null && typeof data.source === 'object' ? data.source : {}
    const kind = source.kind === 'user-question-reply' ? 'answer' : 'user'
    return { seq, time, kind, text }
  }

  if (type === 'assistant/message') {
    const message = data.message !== null && typeof data.message === 'object' ? data.message : {}
    const text = textOf(message.content)
    if (text === '') return null
    return { seq, time, kind: 'assistant', text, interrupted: data.interrupted === true }
  }

  if (type === 'tool/call') {
    return {
      seq,
      time,
      kind: 'tool',
      name: typeof data.name === 'string' ? data.name : 'tool',
      summary: summarizeArgs(data.arguments),
      callId: typeof data.callId === 'string' ? data.callId : null,
    }
  }

  if (type === 'tool/result') {
    const message = data.message !== null && typeof data.message === 'object' ? data.message : {}
    return {
      seq,
      time,
      kind: 'result',
      error: data.error !== undefined,
      text: textOf(message.content).slice(0, 4000),
    }
  }

  // turn/end
  const reason = data.reason !== null && typeof data.reason === 'object' ? data.reason : null
  const failed = reason?.kind === 'error'
  return {
    seq,
    time,
    kind: 'turn-end',
    failed,
    reason: typeof reason?.kind === 'string' ? reason.kind : null,
    message: failed && typeof reason?.message === 'string' ? reason.message : null,
  }
}

/**
 * One followed session, shared by every viewer watching it.
 */
class SessionStream {
  /**
   * @param options - Hub options plus the target session id.
   */
  constructor(options) {
    this.sessionId = options.sessionId
    // The durable address, not just the id: a subagent Session is addressed by its parent, and
    // `follow` refuses `{kind:'session'}` for one with "subagent Sessions require their durable
    // parent address". The caller resolves which shape applies; this class only carries it.
    this.address = options.address ?? { kind: 'session', sessionId: options.sessionId }
    this.ctx = options.ctx
    this.log = options.log
    this.idleMs = options.idleMs
    this.viewers = new Set()
    this.controller = new AbortController()
    this.lastSeq = 0
    this.ignored = 0
    this.closed = false
    this.idleTimer = null
    this.closing = options.onClose
    this.openedAt = Date.now()
    // A bounded replay buffer is what lets a second viewer join an ALREADY-OPEN stream without
    // missing the events that arrived before it connected. A stream opened an hour ago cannot
    // replay its whole history to a fresh phone out of memory, so the buffer is bounded and the
    // gap it cannot cover is reported explicitly rather than silently skipped.
    this.history = []
    this.historyLimit = Number.isFinite(options.historyLimit) && options.historyLimit > 0 ? options.historyLimit : 500
    this.oldestBufferedSeq = null
    this.task = this.run()
  }

  /** Whether this stream still accepts viewers. */
  get alive() {
    return !this.closed
  }

  /** Whether anyone is watching this stream right now. */
  hasViewers() {
    return this.viewers.size > 0
  }

  /**
   * Add one viewer, catching it up from the replay buffer before live frames reach it.
   *
   * The order matters and is why this is not simply a set insertion: the viewer is registered
   * first, so no live frame can slip past between catch-up and subscription, and the buffered
   * items it has already seen are suppressed by the same watermark check that live frames use.
   *
   * @param after - Highest durable seq the viewer already holds.
   * @param sink - Called with each render item; a sink that throws is removed.
   * @returns An unsubscribe function.
   */
  add(after, sink) {
    const viewer = { after: Number.isSafeInteger(after) && after > 0 ? after : 0, sink, error: false }
    this.viewers.add(viewer)
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }

    // A viewer whose watermark predates the buffer cannot be caught up from memory. It is told so
    // rather than handed a transcript with a hole in it, which is the one failure a chat client
    // must never render as continuity.
    if (viewer.after > 0 && this.oldestBufferedSeq !== null && viewer.after < this.oldestBufferedSeq - 1) {
      try {
        viewer.sink({
          kind: 'gap',
          seq: null,
          from: viewer.after,
          oldest: this.oldestBufferedSeq,
          message: 'this viewer is behind the replay buffer; reload the transcript and resubscribe',
        })
      } catch {
        // A sink that throws on the gap notice is removed by the next publish; nothing else to do.
      }
      viewer.after = this.oldestBufferedSeq - 1
    }

    for (const item of this.history) {
      if (Number.isSafeInteger(item.seq) && item.seq !== null && item.seq <= viewer.after) continue
      try {
        viewer.sink(item)
        if (Number.isSafeInteger(item.seq) && item.seq !== null) viewer.after = Math.max(viewer.after, item.seq)
      } catch (error) {
        this.viewers.delete(viewer)
        this.log?.warn?.(`chat-bridge: dropping a viewer of ${this.sessionId} during replay: ${String(error?.message ?? error)}`)
        if (this.viewers.size === 0) this.scheduleIdleClose()
        return () => {}
      }
    }

    return () => {
      this.viewers.delete(viewer)
      if (this.viewers.size === 0) this.scheduleIdleClose()
    }
  }

  /** Close the stream once it has had no viewers for `idleMs`. */
  scheduleIdleClose() {
    if (this.idleTimer !== null || this.closed) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.viewers.size === 0) this.close('idle')
    }, this.idleMs)
  }

  /**
   * Deliver one item to every viewer, respecting each viewer's watermark.
   *
   * @param item - A render item.
   * @returns Nothing.
   */
  publish(item) {
    // Only durable items enter the replay buffer. Assistant-stream frames are cursorless and
    // process-local, so replaying one to a later viewer would present a stale partial answer as
    // current text.
    if (Number.isSafeInteger(item.seq) && item.seq !== null) {
      this.history.push(item)
      if (Number.isSafeInteger(this.lastSeq)) this.lastSeq = Math.max(this.lastSeq, item.seq)
      if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit)
      const first = this.history[0]
      this.oldestBufferedSeq = Number.isSafeInteger(first?.seq) ? first.seq : null
    }

    for (const viewer of [...this.viewers]) {
      if (Number.isSafeInteger(item.seq) && item.seq !== null && item.seq <= viewer.after) continue
      try {
        viewer.sink(item)
        if (Number.isSafeInteger(item.seq) && item.seq !== null) viewer.after = Math.max(viewer.after, item.seq)
      } catch (error) {
        // One broken viewer must not stop the stream for another.
        viewer.error = true
        this.viewers.delete(viewer)
        this.log.warn(`chat-bridge: dropping a viewer of ${this.sessionId}: ${String(error?.message ?? error)}`)
        if (this.viewers.size === 0) this.scheduleIdleClose()
      }
    }
  }

  /** Consume the follow iterator until it ends, fails, or is cancelled. */
  async run() {
    const controller = this.ctx.get('sessionController')
    if (controller === undefined || controller === null || typeof controller.follow !== 'function') {
      this.publish({ kind: 'error', seq: null, message: 'this composition mounts no sessionController, so no transcript can be read' })
      this.close('no-controller')
      return
    }
    try {
      const frames = controller.follow(
        { address: this.address, assistantStream: true },
        this.controller.signal,
      )
      for await (const frame of frames) {
        if (this.closed) break
        if (frame === null || typeof frame !== 'object') continue
        if (frame.type === 'snapshot') {
          // The opening frame is split rather than forwarded whole. A snapshot carries a bulk
          // `records` array with no per-viewer filtering, so a viewer resuming at `after=N` would
          // receive history it already holds. Publishing the header separately and each rendered
          // event individually puts the whole opening through the same watermark check and the
          // same replay buffer as live traffic — one code path, one guarantee.
          this.publish({
            kind: 'open',
            seq: null,
            header: frame.header ?? null,
            cursor: Number.isSafeInteger(frame.cursor) ? frame.cursor : null,
            hasMore: frame.hasMore === true,
          })
          for (const record of Array.isArray(frame.records) ? frame.records : []) {
            const item = renderItem(record?.event)
            if (item === null) this.ignored += 1
            else this.publish(item)
          }
          continue
        }
        if (frame.type === 'event') {
          const item = renderItem(frame.event)
          if (item === null) this.ignored += 1
          else this.publish(item)
          continue
        }
        if (frame.type === 'assistant-stream') {
          // Process-local and cursorless: passed through with a null seq so no client mistakes it
          // for durable history, and skipped by the watermark check.
          this.publish({ kind: 'assistant-stream', seq: null, frame: frame.frame })
          continue
        }
      }
      this.close('ended')
    } catch (error) {
      if (!this.closed) {
        this.publish({ kind: 'error', seq: null, message: String(error?.message ?? error) })
        this.close('failed')
      }
    }
  }

  /**
   * Stop the stream and remove it from the hub.
   *
   * @param reason - Why it closed, for the log.
   * @returns Nothing.
   */
  close(reason) {
    if (this.closed) return
    this.closed = true
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    this.controller.abort()
    this.closing?.(this.sessionId, reason)
  }
}

/**
 * The set of sessions currently being followed, one stream each.
 */
export class SessionStreamHub {
  /**
   * @param options - `{ctx, log, maxStreams, idleMs}`.
   */
  constructor(options) {
    this.ctx = options.ctx
    this.log = options.log
    this.maxStreams = Number.isFinite(options.maxStreams) && options.maxStreams > 0 ? options.maxStreams : 4
    this.idleMs = Number.isFinite(options.idleMs) && options.idleMs > 0 ? options.idleMs : 15 * 60 * 1000
    this.historyLimit = Number.isFinite(options.historyLimit) && options.historyLimit > 0 ? options.historyLimit : 500
    this.streams = new Map()
  }

  /**
   * Subscribe to one session, opening its stream if this is the first viewer.
   *
   * @param sessionId - The session to follow; also the hub's key.
   * @param address - The durable address `follow` accepts for it.
   * @param after - Highest durable seq the caller already holds; lower frames are suppressed.
   * @param sink - Receives render items.
   * @returns An unsubscribe function.
   */
  subscribe(sessionId, address, after, sink) {
    if (typeof sessionId !== 'string' || sessionId === '') {
      sink({ kind: 'error', seq: null, message: 'a session id is required' })
      return () => {}
    }
    let stream = this.streams.get(sessionId)
    if (stream === undefined || !stream.alive) {
      this.evictIfFull()
      stream = new SessionStream({
        sessionId,
        address,
        ctx: this.ctx,
        log: this.log,
        idleMs: this.idleMs,
        historyLimit: this.historyLimit,
        onClose: (id, reason) => {
          if (this.streams.get(id) === stream) this.streams.delete(id)
          this.log.info(`chat-bridge: stream ${id} closed (${reason})`)
        },
      })
      this.streams.set(sessionId, stream)
      this.log.info(`chat-bridge: following session ${sessionId}`)
    }
    return stream.add(after, sink)
  }

  /**
   * Close the least recently opened stream to stay within the cap.
   *
   * @returns Nothing.
   */
  evictIfFull() {
    if (this.streams.size < this.maxStreams) return
    let oldest = null
    for (const stream of this.streams.values()) {
      if (oldest === null || stream.openedAt < oldest.openedAt) oldest = stream
    }
    if (oldest !== null) {
      this.log.warn(`chat-bridge: closing the least recently opened stream to stay within ${String(this.maxStreams)}`)
      oldest.close('evicted')
    }
  }

  /** How many sessions are currently followed. */
  get size() {
    return this.streams.size
  }

  /**
   * Whether any phone is watching any session.
   *
   * This is the "is anybody there to answer?" half of the claim policy. It is deliberately about
   * *watchers*, not about the hub holding an iterator: a stream with no viewer is one this plugin
   * opened and nobody is reading, and claiming a question for it would hang the turn.
   *
   * @returns True when at least one viewer is connected anywhere.
   */
  hasViewers() {
    for (const stream of this.streams.values()) {
      if (stream.alive && stream.hasViewers()) return true
    }
    return false
  }

  /**
   * Deliver one transient item to the phone.
   *
   * A question or an approval belongs to the session whose agent asked it, so it goes to that
   * session's viewers when there are any. When the phone is watching a different session, the item
   * is delivered to every connected viewer instead: a question the human can see but is not
   * looking at beats a question nobody ever sees. Transient items carry no `seq`, so they never
   * enter a replay buffer — a question that arrived while the phone was asleep is not replayed
   * later as if it were still answerable.
   *
   * @param sessionId - The session the item belongs to.
   * @param item - A render item; `seq` must be null.
   * @returns True when at least one viewer received it.
   */
  deliver(sessionId, item) {
    const own = this.streams.get(sessionId)
    if (own !== undefined && own.alive && own.hasViewers()) {
      own.publish(item)
      return true
    }
    let delivered = false
    for (const stream of this.streams.values()) {
      if (stream.alive && stream.hasViewers()) {
        stream.publish(item)
        delivered = true
      }
    }
    return delivered
  }

  /** Close every stream; used when the plugin unloads. */
  closeAll() {
    for (const stream of [...this.streams.values()]) stream.close('shutdown')
    this.streams.clear()
  }
}
