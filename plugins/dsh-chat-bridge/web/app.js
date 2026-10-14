/*
 * PURPOSE
 *   The chat bridge's phone client. It renders one session's transcript, streams a live turn into
 *   it, sends what the human types, and puts the agent's questions and approval requests in front
 *   of them — the four things that make a session drivable from a phone.
 *
 *   Two rules shape the whole file:
 *     - Model output is DATA. Every string that came from a session is assigned through
 *       `textContent`, never `innerHTML`, so an agent cannot turn its own reply into markup or
 *       script in this app.
 *     - Nothing is re-rendered wholesale. Items are appended as they arrive, keyed by the
 *       harness's monotonic `seq`, so a long transcript does not flicker and a reconnect does not
 *       duplicate what is already on screen.
 *
 * INPUTS
 *   No configuration and no build step. It talks to the one origin that served it:
 *     GET  /chat-bridge/api/sessions
 *     GET  /chat-bridge/api/transcript?sessionId=&limit=
 *     GET  /chat-bridge/api/stream?sessionId=&after=      (Server-Sent Events)
 *     POST /chat-bridge/api/prompt   {sessionId, text, mode, requestId}
 *     POST /chat-bridge/api/answer   {pendingId, answers}
 *     POST /chat-bridge/api/approval {pendingId, outcome}
 *   The device cookie rides along automatically; it is HttpOnly and invisible to this code.
 *
 * OUTPUTS
 *   DOM only. A failed request becomes a message in `.state` and leaves what the human was reading
 *   on screen, because blanking a transcript they were mid-sentence in is worse than showing it
 *   slightly stale.
 *
 * KEYWORDS
 *   chat bridge, PWA, transcript, SSE, EventSource, seq watermark, composer, question card,
 *   approval card, idempotent prompt, reconnect
 *
 * BEHAVIOUR ON EDGE CASES
 *   - 401 from any route: says so and offers the pairing page, rather than rendering an empty view
 *     that looks like "no sessions".
 *   - A stream that drops: EventSource reconnects on its own and the bridge replays from the
 *     watermark, so the gap is closed without this code tracking it.
 *   - A `gap` frame: the bridge could not cover the watermark from its buffer, so the transcript is
 *     reloaded from scratch rather than continued with a hole in it.
 *   - A `question` or `approval` for a session that is not open: the card is shown anyway, because
 *     a decision the turn is blocked on outranks which session is on screen.
 *   - A prompt whose response is lost: the text stays in the box and the SAME requestId is reused
 *     on retry, so the harness deduplicates it instead of running the turn twice.
 *   - A question answered after it was already settled: the bridge answers 409 and the card is
 *     dismissed with a note, because the first answer won.
 *   - `assistant-stream` deltas for a turn whose durable message has already arrived: the live
 *     bubble is replaced by the durable item rather than appended to, so text is never doubled.
 */

import { renderMarkdown } from './markdown.js'

const ROUTE = '/chat-bridge'

/** Where the last session list is kept, so the app has something to show with no connection. */
const SESSION_CACHE = 'chat-bridge:sessions'

/**
 * Where the set of computers this phone has talked to is kept.
 *
 * `localStorage` is per-origin, and every machine is a different origin, so a list stored here
 * cannot be read by the other machine's copy of the app. The set is therefore carried in the URL
 * when you move between them: whichever machine you arrive at learns every machine you knew. That
 * needs no configuration on any of them and no cross-origin request — only that you visit each one
 * once, which is what connecting already means.
 */
const PEERS_KEY = 'chat-bridge:peers'

/**
 * What to tell someone whose phone cannot reach the harness.
 *
 * The common cause is not the harness at all: over USB the tunnel exists only while the cable is
 * attached, so a phone that was working a minute ago and is not now has almost certainly been
 * unplugged. A bare "failed to fetch" sends them to look at the harness, which is the wrong place.
 */
const UNREACHABLE = 'Showing the last known list. If this phone connects by USB, plug the cable back in and run "make connect-usb-device" on the computer.'

const dom = {
  // The scroll container is `#main`, not `#transcript`: `main` carries `overflow-y: auto`, so the
  // transcript's own `scrollTop` never moves. Reading the wrong element made `nearBottom()` always
  // true, which silently turned "follow only when the reader is at the end" into "always follow".
  main: document.getElementById('main'),
  back: document.getElementById('back'),
  title: document.getElementById('title'),
  reload: document.getElementById('reload'),
  listView: document.getElementById('list-view'),
  sessionView: document.getElementById('session-view'),
  state: document.getElementById('state'),
  sessionState: document.getElementById('session-state'),
  sessions: document.getElementById('sessions'),
  peers: document.getElementById('peers'),
  transcript: document.getElementById('transcript'),
  jump: document.getElementById('jump'),
  install: document.getElementById('install'),
  installGo: document.getElementById('install-go'),
  installNo: document.getElementById('install-no'),
  stop: document.getElementById('stop'),
  working: document.getElementById('working'),
  promptCard: document.getElementById('prompt-card'),
  composer: document.getElementById('composer'),
  text: document.getElementById('text'),
  send: document.getElementById('send'),
  steer: document.getElementById('steer'),
  connection: document.getElementById('connection'),
}

/** What the app is showing and what it has already displayed. */
const view = {
  kind: 'list',
  sessionId: null,
  lastSeq: 0,
  stream: null,
  live: null,
  pendingPrompt: null,
  pending: null,
  /** Whether a turn is believed to be running, so the Stop control is honest. */
  running: false,
}

/** Cookie string for fetches is implicit; this only sets JSON headers. */
const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' }

/**
 * The short, human-recognisable form of a session id.
 *
 * A session id is `session-<uuid>`, so slicing the raw string yields the literal prefix
 * `session-` and tells the human nothing. Older sessions carry a bare uuid, so the prefix is
 * removed rather than assumed.
 *
 * @param {string} id - The full session id.
 * @returns {string} The first uuid block, or the id when it has no such shape.
 */
function shortId(id) {
  const withoutPrefix = id.startsWith('session-') ? id.slice('session-'.length) : id
  const [first] = withoutPrefix.split('-')
  return first === undefined || first === '' ? withoutPrefix.slice(0, 8) : first
}

/**
 * The computers this phone knows about, excluding this one.
 *
 * @returns {Array<{origin: string, label: string, lastSeen: number}>} The stored peers.
 */
function readPeers() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PEERS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((peer) => peer !== null && typeof peer?.origin === 'string' && peer.origin !== location.origin)
  } catch {
    return []
  }
}

/**
 * Merge the computers carried in the URL into the stored set.
 *
 * @param {string|null} carried - Comma-separated origins, or null.
 * @returns {number} How many were new.
 */
function absorbPeers(carried) {
  if (typeof carried !== 'string' || carried === '') return 0
  const known = readPeers()
  const seen = new Set(known.map((peer) => peer.origin))
  let added = 0
  for (const raw of carried.split(',')) {
    let origin
    try {
      origin = new URL(raw).origin
    } catch {
      continue
    }
    if (origin === location.origin || seen.has(origin)) continue
    seen.add(origin)
    known.push({ origin, label: new URL(origin).host, lastSeen: Date.now() })
    added += 1
  }
  if (added > 0) {
    try {
      localStorage.setItem(PEERS_KEY, JSON.stringify(known.slice(0, 20)))
    } catch {
      // Storage unavailable; the chips still work for this visit.
    }
  }
  return added
}

/**
 * Ask whether one machine answers at all.
 *
 * The request is `no-cors` and the response is therefore opaque — the STATUS cannot be read, and
 * that is deliberate: reading it would require every machine to open itself to this one. What the
 * browser can still tell us is whether the request finished or failed, which is exactly the
 * question a switcher needs answered ("is this machine reachable right now?"), and gives a chip
 * that is honest about which computers are actually available.
 *
 * @param {string} origin - The machine's origin.
 * @returns {Promise<boolean>} True when it answered.
 */
async function probePeer(origin) {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 3000)
  try {
    await fetch(`${origin}${ROUTE}/api/whoami`, {
      mode: 'no-cors',
      credentials: 'include',
      cache: 'no-store',
      signal: abort.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Draw one chip per known computer, this one included, and mark which answer.
 *
 * @returns {void}
 */
function renderPeers() {
  const peers = readPeers()
  const all = [location.origin, ...peers.map((peer) => peer.origin)]
  const carried = encodeURIComponent(all.join(','))
  const chips = [el('span', new URL(location.origin).host, { class: 'peer here', title: 'this computer' })]
  const pending = []
  for (const peer of peers) {
    // A link, not a fetch, for the sessions themselves: reading another machine's sessions would
    // require that machine to allow it, and none does. Navigating is always allowed.
    const chip = el('a', peer.label, {
      class: 'peer',
      href: `${peer.origin}${ROUTE}/?peers=${carried}`,
      title: peer.origin,
    })
    chip.dataset.state = 'checking'
    chips.push(chip)
    pending.push([chip, peer.origin])
  }
  dom.peers.replaceChildren(...chips)
  dom.peers.hidden = chips.length < 2

  for (const [chip, origin] of pending) {
    void probePeer(origin).then((reachable) => {
      // The chip may have been replaced by a re-render while the probe was in flight.
      if (!dom.peers.contains(chip)) return
      chip.dataset.state = reachable ? 'up' : 'down'
      chip.title = reachable ? `${origin} — reachable` : `${origin} — not reachable right now`
    })
  }
}

/**
 * Read the cached session list.
 *
 * A phone that was just unplugged should show the sessions it had a moment ago rather than an empty
 * screen, provided it says they are not live. Storage failures (private mode, a full quota) are
 * silent: a cache is a convenience and must never break the view it exists to improve.
 *
 * @returns `{at, sessions}` or null when nothing usable is stored.
 */
function cachedSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_CACHE) ?? 'null')
    if (parsed === null || !Array.isArray(parsed.sessions)) return null
    return { at: Number.isFinite(parsed.at) ? parsed.at : Date.now(), sessions: parsed.sessions }
  } catch {
    return null
  }
}

/**
 * Remember the session list for the next time the harness is unreachable.
 *
 * @param {Array<object>} sessions - The records just rendered.
 * @returns {void}
 */
function rememberSessions(sessions) {
  try {
    localStorage.setItem(SESSION_CACHE, JSON.stringify({ at: Date.now(), sessions: sessions.slice(0, 50) }))
  } catch {
    // Storage unavailable; the live view is unaffected.
  }
}

/**
 * Shorten a home-directory prefix so a path fits a phone's width without losing its meaning.
 *
 * @param {string|null} path - An absolute path.
 * @returns {string} The path with the home prefix collapsed to `~`.
 */
function shortenPath(path) {
  if (typeof path !== 'string' || path === '') return ''
  return path.replace(/^\/home\/[^/]+/, '~').replace(/^\/Users\/[^/]+/, '~')
}

/**
 * Render a timestamp as how long ago it was.
 *
 * A phone shows a list, not a log: "3m ago" answers "is this current?" faster than a date, and the
 * exact time is available by opening the session.
 *
 * @param {number|null} ms - Epoch milliseconds.
 * @returns {string} A short relative description, or an empty string when there is no timestamp.
 */
function relativeTime(ms) {
  if (Number.isFinite(ms) === false) return ''
  const minutes = Math.round((Date.now() - ms) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${String(minutes)}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${String(hours)}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${String(days)}d ago`
  return new Date(ms).toLocaleDateString()
}

/**
 * Create an element with optional text and attributes.
 *
 * @param {string} tag - Tag name.
 * @param {string} [text] - Text content, assigned as text (never parsed).
 * @param {Record<string, string>} [attributes] - Attributes to set.
 * @returns {HTMLElement} The element.
 */
function el(tag, text, attributes) {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  for (const [name, value] of Object.entries(attributes ?? {})) node.setAttribute(name, value)
  return node
}

/**
 * Set the connection pill.
 *
 * @param {string} value - `connecting`, `online` or `offline`.
 * @param {string} text - Label to show.
 * @returns {void}
 */
function setConnection(value, text) {
  dom.connection.dataset.state = value
  dom.connection.textContent = text
}

/**
 * Show a message in the current view's state line.
 *
 * @param {string} text - Message.
 * @param {string} [href] - Optional link target.
 * @returns {void}
 */
function showState(text, href) {
  const target = view.kind === 'session' ? dom.sessionState : dom.state
  const other = view.kind === 'session' ? dom.state : dom.sessionState
  other.textContent = ''
  target.textContent = ''
  if (text === '') return
  if (href === undefined) {
    target.textContent = text
    return
  }
  const link = el('a', text, { href })
  target.append(link)
}

/**
 * Whether the reader is close enough to the end that following new output is helpful.
 *
 * A chat view that force-scrolls on every append is hostile to anyone reading back through a
 * transcript: the act of receiving a message moves the text under their eyes. So output follows
 * only when the reader was already at the end.
 *
 * @returns True when the view is within a short distance of the bottom.
 */
function nearBottom() {
  const gap = dom.main.scrollHeight - dom.main.scrollTop - dom.main.clientHeight
  return gap < 80
}

/**
 * Follow new output when it is welcome, and offer a way back when it is not.
 *
 * @param {boolean} force - Scroll regardless, for a deliberate jump.
 * @returns {void}
 */
function followOutput(force = false) {
  if (force || nearBottom()) {
    dom.main.scrollTop = dom.main.scrollHeight
    dom.jump.hidden = true
    return
  }
  dom.jump.hidden = false
}

dom.main.addEventListener('scroll', () => {
  if (nearBottom()) dom.jump.hidden = true
  else if (view.kind === 'session') dom.jump.hidden = false
})

dom.jump.addEventListener('click', () => followOutput(true))

/**
 * Show or hide the "agent working" indicator and its Stop control together: they describe the same
 * fact, and a Stop button with no running turn is a lie.
 *
 * @param {boolean} running - Whether a turn is believed to be running.
 * @returns {void}
 */
function setWorking(running) {
  view.running = running
  dom.working.hidden = !running
  dom.stop.hidden = !running || view.kind !== 'session'
  dom.steer.hidden = !running || view.kind !== 'session'
}

/* ── the session list ───────────────────────────────────────────────────── */

/**
 * Render one session row.
 *
 * @param {{id: string, title: string|null, cwd: string|null, updatedAt: number|null, live: boolean,
 *          subagent: boolean}} session - One record.
 * @returns {HTMLLIElement} The row.
 */
function renderSession(session) {
  const item = el('li')
  item.dataset.live = String(session.live === true)
  item.tabIndex = 0
  item.setAttribute('role', 'button')

  const head = el('div', undefined, { class: 'row' })
  if (session.live) head.append(el('span', undefined, { class: 'live', title: 'open in the harness right now' }))
  const project = session.cwd?.split('/').filter(Boolean).pop()
  head.append(el('strong', session.title ?? project ?? 'Untitled'))
  if (session.subagent) head.append(el('span', 'subagent', { class: 'tag' }))
  item.append(head)

  const meta = [shortenPath(session.cwd), relativeTime(session.updatedAt)].filter(Boolean).join(' · ')
  item.append(el('span', meta, { class: 'meta' }))
  item.append(el('code', shortId(session.id)))

  const open = () => openSession(session.id)
  item.addEventListener('click', open)
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  })
  return item
}

/** Load and render the session list. */
async function loadList() {
  setConnection('connecting', 'connecting')
  // Render what was last seen before asking, so the first frame is useful rather than empty. The
  // cache is labelled, never presented as current.
  if (dom.sessions.childElementCount === 0) {
    const cached = cachedSessions()
    if (cached !== null) {
      dom.sessions.replaceChildren(...cached.sessions.map(renderSession))
      showState(`Last seen ${relativeTime(cached.at)} — reconnecting…`)
    }
  }
  let response
  try {
    response = await fetch(`${ROUTE}/api/sessions`, { headers: { accept: 'application/json' } })
  } catch {
    setConnection('offline', 'offline')
    showState(UNREACHABLE)
    return
  }
  if (response.status === 401) {
    setConnection('offline', 'unpaired')
    showState('Pair this device first', `${ROUTE}/`)
    return
  }
  let body = {}
  try {
    body = await response.json()
  } catch {
    body = {}
  }
  if (!response.ok) {
    setConnection('offline', `error ${String(response.status)}`)
    showState(body.message ?? `The harness answered ${String(response.status)}`)
    return
  }
  setConnection('online', 'online')
  const sessions = Array.isArray(body.sessions) ? [...body.sessions] : []
  rememberSessions(sessions)
  // A session the harness is holding open right now is the one most likely to want attention, so
  // it sorts above the rest; within each group, the most recent first.
  sessions.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  })
  dom.sessions.replaceChildren(...sessions.map(renderSession))
  showState(sessions.length === 0 ? 'No sessions yet.' : '')
}

/* ── rendering one transcript item ──────────────────────────────────────── */

/**
 * Build the element for one render item.
 *
 * @param {Record<string, any>} item - A render item from the bridge.
 * @returns {HTMLElement|null} The element, or null for an item with nothing to draw.
 */
function renderItem(item) {
  const wrap = el('article', undefined, { class: `item ${item.kind}` })
  if (item.seq !== null && item.seq !== undefined) wrap.dataset.seq = String(item.seq)

  if (item.kind === 'user' || item.kind === 'answer') {
    wrap.append(el('div', item.kind === 'answer' ? 'You answered' : 'You', { class: 'who' }))
    // What the human typed is shown exactly as typed: reformatting their own words back at them is
    // surprising, and they already know what they meant.
    wrap.append(el('div', item.text, { class: 'body' }))
    return wrap
  }
  if (item.kind === 'assistant') {
    wrap.append(el('div', 'Agent', { class: 'who' }))
    const body = el('div', undefined, { class: 'body' })
    // The agent's Markdown is rendered — as DOM nodes, never as markup built from a string.
    body.append(renderMarkdown(item.text))
    wrap.append(body)
    if (item.interrupted) wrap.append(el('div', 'interrupted', { class: 'note' }))
    return wrap
  }
  if (item.kind === 'tool') {
    wrap.append(el('span', `🔧 ${item.name}`, { class: 'tool-name' }))
    if (item.summary) wrap.append(el('code', item.summary, { class: 'tool-args' }))
    return wrap
  }
  if (item.kind === 'result') {
    const text = String(item.text ?? '')
    if (text.trim() === '' && item.error !== true) return null
    wrap.append(el('div', item.error === true ? 'Result (error)' : 'Result', { class: 'who' }))
    // Results are long and rarely what the human is reading; a few lines is enough to recognise.
    wrap.append(el('pre', text.length > 1200 ? `${text.slice(0, 1200)}…` : text, { class: 'body result' }))
    return wrap
  }
  if (item.kind === 'turn-end') {
    if (item.failed === true) {
      wrap.append(el('div', `Turn failed${item.message === null || item.message === undefined ? '' : `: ${item.message}`}`, { class: 'error' }))
      return wrap
    }
    // A turn the human stopped is worth saying out loud: on a phone, "did my Stop do anything?" is
    // otherwise answered only by the absence of output.
    if (item.reason === 'aborted') {
      wrap.append(el('div', 'Stopped', { class: 'stopped' }))
      return wrap
    }
    return el('div', undefined, { class: 'turn-end' })
  }
  return null
}

/**
 * Append one item to the transcript, ignoring anything at or below the watermark.
 *
 * @param {Record<string, any>} item - The render item.
 * @returns {void}
 */
function appendItem(item) {
  if (typeof item.seq === 'number' && item.seq <= view.lastSeq) return
  if (typeof item.seq === 'number') view.lastSeq = item.seq
  const node = renderItem(item)
  if (node === null) return
  // A durable assistant message supersedes the live bubble it was streamed into.
  if (item.kind === 'assistant' && view.live !== null) {
    view.live.remove()
    view.live = null
  }
  dom.transcript.append(node)
  followOutput()
}

/* ── the session view ───────────────────────────────────────────────────── */

/**
 * Open one session: load its transcript tail, then follow it live.
 *
 * @param {string} sessionId - The session to open.
 * @returns {Promise<void>} Resolves once the transcript is on screen; the stream continues after.
 */
async function openSession(sessionId) {
  view.kind = 'session'
  view.sessionId = sessionId
  view.lastSeq = 0
  view.live = null
  dom.listView.hidden = true
  dom.sessionView.hidden = false
  dom.back.hidden = false
  dom.composer.hidden = false
  dom.text.placeholder = 'Message…'
  dom.title.textContent = shortId(sessionId)
  dom.sessions.replaceChildren()
  dom.transcript.replaceChildren()
  dom.jump.hidden = true
  setWorking(false)
  showState('Loading…')

  await loadTranscript()
  openStream()
}

/** Load the transcript tail and render it. */
async function loadTranscript() {
  let response
  try {
    response = await fetch(`${ROUTE}/api/transcript?sessionId=${encodeURIComponent(view.sessionId)}&limit=200`, {
      headers: { accept: 'application/json' },
    })
  } catch {
    setConnection('offline', 'offline')
    showState(UNREACHABLE)
    return
  }
  if (response.status === 401) {
    showState('This device is no longer paired', `${ROUTE}/`)
    return
  }
  let body = {}
  try {
    body = await response.json()
  } catch {
    body = {}
  }
  if (!response.ok) {
    showState(body.message ?? `The harness answered ${String(response.status)}`)
    return
  }
  dom.transcript.replaceChildren()
  view.lastSeq = typeof body.lastSeq === 'number' ? body.lastSeq : 0
  const items = Array.isArray(body.items) ? body.items : []
  for (const item of items) {
    const node = renderItem(item)
    if (node !== null) dom.transcript.append(node)
  }
  if (typeof body.header?.cwd === 'string') dom.title.textContent = body.header.cwd.split('/').filter(Boolean).pop() ?? shortId(view.sessionId)
  showState(items.length === 0 ? 'Nothing here yet — say something.' : '')
  followOutput(true)
}

/** Close the live stream, if one is open. */
function closeStream() {
  if (view.stream !== null) {
    view.stream.close()
    view.stream = null
  }
}

/** Follow the open session live, resuming from the transcript watermark. */
function openStream() {
  closeStream()
  const url = `${ROUTE}/api/stream?sessionId=${encodeURIComponent(view.sessionId)}&after=${String(view.lastSeq)}`
  const stream = new EventSource(url)
  view.stream = stream

  stream.addEventListener('open', () => setConnection('online', 'live'))
  stream.addEventListener('error', () => setConnection('connecting', 'reconnecting'))

  stream.addEventListener('item', (event) => {
    let item
    try {
      item = JSON.parse(event.data)
    } catch {
      return
    }
    handleFrame(item)
  })
}

/**
 * Handle one frame from the bridge's stream.
 *
 * @param {Record<string, any>} item - The frame.
 * @returns {void}
 */
function handleFrame(item) {
  if (item.kind === 'error') {
    showState(item.message ?? 'the stream reported an error')
    return
  }
  if (item.kind === 'gap') {
    // The bridge could not cover this watermark from its buffer. Continuing would render a
    // transcript with a hole in it, so the whole tail is reloaded instead.
    showState('Catching up…')
    void loadTranscript().then(() => openStream())
    return
  }
  if (item.kind === 'question') {
    showQuestionCard(item)
    return
  }
  if (item.kind === 'approval') {
    showApprovalCard(item)
    return
  }
  if (item.kind === 'assistant-stream') {
    if (item.frame?.type === 'start') setWorking(true)
    appendDelta(item.frame)
    return
  }
  if (item.kind === 'open') {
    if (typeof item.header?.cwd === 'string') {
      dom.title.textContent = item.header.cwd.split('/').filter(Boolean).pop() ?? shortId(view.sessionId)
    }
    return
  }
  if (item.kind === 'turn-end') {
    setWorking(false)
    // The turn is over, so a transient "Stopping…" must not outlive it.
    showState('')
  }
  appendItem(item)
}

/**
 * Append a live assistant delta to the open bubble.
 *
 * @param {Record<string, any>} frame - An `assistant-stream` frame.
 * @returns {void}
 */
function appendDelta(frame) {
  if (frame?.type === 'end') {
    // The durable assistant message follows; leave the bubble for it to replace.
    return
  }
  if (frame?.type !== 'chunk') return
  const chunk = frame.chunk
  if (chunk?.type !== 'text-delta' || typeof chunk.text !== 'string') return
  if (view.live === null) {
    view.live = el('article', undefined, { class: 'item assistant live' })
    view.live.append(el('div', 'Agent', { class: 'who' }))
    view.live.append(el('div', '', { class: 'body' }))
    dom.transcript.append(view.live)
  }
  view.live.lastChild.textContent += chunk.text
  followOutput()
}

/* ── decisions the turn is blocked on ───────────────────────────────────── */

/**
 * Show one question card.
 *
 * @param {Record<string, any>} frame - The `question` item from the bridge.
 * @returns {void}
 */
function showQuestionCard(frame) {
  const questions = Array.isArray(frame.questions) ? frame.questions : []
  const card = el('div', undefined, { class: 'card' })
  card.append(el('div', 'The agent is waiting for you', { class: 'card-head' }))

  /** Selected labels per question id. */
  const selected = new Map()
  /** Free-text answer per question id. */
  const custom = new Map()

  for (const question of questions) {
    const block = el('div', undefined, { class: 'question' })
    if (question.header) block.append(el('div', question.header, { class: 'q-header' }))
    block.append(el('p', question.question, { class: 'q-text' }))
    if (question.detail) block.append(el('pre', question.detail, { class: 'q-detail' }))

    selected.set(question.id, new Set())
    const options = Array.isArray(question.options) ? question.options : []
    const isPlan = question.intent?.kind === 'plan-review'
    for (const option of options) {
      const choice = el('button', option.label, { type: 'button', class: 'option' })
      // The plan-review intent NAMES the approving option; the app never infers a verdict from
      // option order, it reads the name the asker supplied.
      if (isPlan && option.label === question.intent.approve) choice.classList.add('approve')
      choice.addEventListener('click', () => {
        const chosen = selected.get(question.id)
        if (question.multiSelect === true) {
          if (chosen.has(option.label)) chosen.delete(option.label)
          else chosen.add(option.label)
          choice.classList.toggle('chosen', chosen.has(option.label))
        } else {
          chosen.clear()
          chosen.add(option.label)
          for (const sibling of block.querySelectorAll('.option')) sibling.classList.remove('chosen')
          choice.classList.add('chosen')
        }
      })
      block.append(choice)
    }
    // Free text is always offered, including alongside options: the harness's answer shape carries
    // `selected` and `custom` together, so "one of these, or something else" is expressible.
    const free = el('input', undefined, { type: 'text', placeholder: 'Or type an answer', class: 'q-custom' })
    free.addEventListener('input', () => custom.set(question.id, free.value))
    block.append(free)
    card.append(block)
  }

  const actions = el('div', undefined, { class: 'card-actions' })
  const submit = el('button', 'Send answer', { type: 'button', class: 'primary' })
  const skip = el('button', 'Skip', { type: 'button' })
  actions.append(skip, submit)
  card.append(actions)

  const dismiss = () => {
    card.remove()
    view.pending = null
    dom.promptCard.hidden = true
  }

  submit.addEventListener('click', async () => {
    const answers = questions.map((question) => ({
      id: question.id,
      selected: [...(selected.get(question.id) ?? [])],
      ...(custom.get(question.id) ? { custom: custom.get(question.id) } : {}),
    }))
    submit.disabled = true
    const result = await postJson(`${ROUTE}/api/answer`, { pendingId: frame.pendingId, answers })
    if (result.ok) {
      dismiss()
      return
    }
    submit.disabled = false
    if (result.status === 409) {
      dismiss()
      showState('That question was already answered.')
      return
    }
    showState(result.body?.message ?? 'The answer was refused.')
  })

  skip.addEventListener('click', async () => {
    skip.disabled = true
    // A skipped question is an answer item with nothing selected: the harness records it as an
    // explicit skip rather than leaving the turn waiting.
    const answers = questions.map((question) => ({ id: question.id, selected: [] }))
    const result = await postJson(`${ROUTE}/api/answer`, { pendingId: frame.pendingId, answers })
    skip.disabled = false
    if (result.ok || result.status === 409) dismiss()
    else showState(result.body?.message ?? 'The skip was refused.')
  })

  view.pending = { kind: 'question', pendingId: frame.pendingId }
  dom.promptCard.replaceChildren(card)
  dom.promptCard.hidden = false
}

/**
 * Show one approval card.
 *
 * @param {Record<string, any>} frame - The `approval` item from the bridge.
 * @returns {void}
 */
function showApprovalCard(frame) {
  const card = el('div', undefined, { class: 'card' })
  card.append(el('div', 'The agent needs permission', { class: 'card-head' }))
  const block = el('div', undefined, { class: 'question' })
  block.append(el('p', `${frame.toolName} wants to run`, { class: 'q-text' }))
  if (typeof frame.reason === 'string' && frame.reason !== '') block.append(el('pre', frame.reason, { class: 'q-detail' }))
  card.append(block)

  const actions = el('div', undefined, { class: 'card-actions' })
  const allow = el('button', 'Allow once', { type: 'button', class: 'primary' })
  const reject = el('button', 'Reject', { type: 'button', class: 'danger' })
  actions.append(reject, allow)
  card.append(actions)

  const decide = async (outcome, button) => {
    button.disabled = true
    const result = await postJson(`${ROUTE}/api/approval`, { pendingId: frame.pendingId, outcome })
    button.disabled = false
    if (result.ok || result.status === 409) {
      dom.promptCard.replaceChildren()
      dom.promptCard.hidden = true
      view.pending = null
      return
    }
    showState(result.body?.message ?? 'The decision was refused.')
  }

  // `allowed-once` is a one-shot grant and is the only allow the harness offers; the phone cannot
  // send `unavailable`, which is the harness's own fail-closed value rather than a human decision.
  allow.addEventListener('click', () => void decide('allowed-once', allow))
  reject.addEventListener('click', () => void decide('rejected', reject))

  view.pending = { kind: 'approval', pendingId: frame.pendingId }
  dom.promptCard.replaceChildren(card)
  dom.promptCard.hidden = false
}

/* ── the composer ───────────────────────────────────────────────────────── */

/**
 * POST JSON and decode the response without throwing.
 *
 * @param {string} url - Target URL.
 * @param {Record<string, any>} payload - JSON body.
 * @returns {Promise<{ok: boolean, status: number, body: any}>} The outcome.
 */
async function postJson(url, payload) {
  try {
    const response = await fetch(url, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) })
    let body = {}
    try {
      body = await response.json()
    } catch {
      body = {}
    }
    return { ok: response.ok, status: response.status, body }
  } catch (error) {
    return { ok: false, status: 0, body: { message: String(error) } }
  }
}

/**
 * Send the composer's text as a user turn.
 *
 * @param {'queue'|'steer'} mode - Whether to enqueue a turn or redirect the running one.
 * @returns {Promise<void>} Resolves when the text is dealt with or reported.
 */
async function sendPrompt(mode) {
  const text = dom.text.value
  if (text.trim() === '') return
  if (view.kind === 'list') {
    await startNewTask(text)
    return
  }
  // A retry reuses the requestId, which the harness deduplicates: losing the response must not
  // mean losing the turn, and retrying must not mean running it twice.
  view.pendingPrompt ??= { requestId: crypto.randomUUID(), text }
  view.pendingPrompt.text = text
  dom.send.disabled = true
  const result = await postJson(`${ROUTE}/api/prompt`, {
    sessionId: view.sessionId,
    text,
    mode,
    requestId: view.pendingPrompt.requestId,
  })
  dom.send.disabled = false
  if (result.ok) {
    dom.text.value = ''
    dom.text.style.height = 'auto'
    view.pendingPrompt = null
    // The turn is admitted; the indicator clears when the durable turn-end arrives, not here.
    setWorking(true)
    return
  }
  showState(result.body?.message ?? 'The message was not accepted — press Send to retry.')
}

/**
 * Create a session and seed it with the text in the composer.
 *
 * This is the only way to start work that does not exist yet, and it reuses the composer so a phone
 * needs no second input affordance: on the session list, the box in front of you makes a new
 * session; inside a session, it messages that one.
 *
 * @param {string} text - The first turn's text.
 * @returns {Promise<void>} Resolves once the session is open, or the failure is reported.
 */
async function startNewTask(text) {
  view.pendingPrompt ??= { requestId: crypto.randomUUID(), text }
  dom.send.disabled = true
  const result = await postJson(`${ROUTE}/api/new`, { text, requestId: view.pendingPrompt.requestId })
  dom.send.disabled = false
  const sessionId = result.body?.sessionId
  if (result.ok && typeof sessionId === 'string') {
    dom.text.value = ''
    dom.text.style.height = 'auto'
    view.pendingPrompt = null
    await openSession(sessionId)
    setWorking(true)
    return
  }
  showState(result.body?.message ?? 'The task was not started — press Send to retry.')
}

/* ── navigation ─────────────────────────────────────────────────────────── */

/** Return to the session list. */
function closeSession() {
  closeStream()
  view.kind = 'list'
  view.sessionId = null
  view.lastSeq = 0
  view.live = null
  view.pending = null
  dom.sessionView.hidden = true
  dom.listView.hidden = false
  dom.back.hidden = true
  // The composer stays: on the list it dispatches a NEW task, which is the one thing you cannot do
  // from inside a session.
  dom.composer.hidden = false
  dom.text.placeholder = 'Start a new task…'
  dom.promptCard.hidden = true
  dom.promptCard.replaceChildren()
  dom.title.textContent = 'Sessions'
  dom.jump.hidden = true
  setWorking(false)
}

dom.steer.addEventListener('click', () => {
  void sendPrompt('steer')
})

dom.stop.addEventListener('click', async () => {
  dom.stop.disabled = true
  const result = await postJson(`${ROUTE}/api/cancel`, { sessionId: view.sessionId })
  dom.stop.disabled = false
  if (result.ok) {
    showState('Stopping…')
    return
  }
  // 409 means the service found no attached agent: there is nothing to stop, so the indicator is
  // corrected rather than the human being told to try again.
  if (result.status === 409) {
    setWorking(false)
    showState('Nothing was running.')
    return
  }
  showState(result.body?.message ?? 'Could not stop the turn.')
})

dom.back.addEventListener('click', closeSession)
dom.reload.addEventListener('click', () => {
  if (view.kind === 'session') void loadTranscript()
  else void loadList()
})

dom.text.addEventListener('input', () => {
  dom.text.style.height = 'auto'
  dom.text.style.height = `${Math.min(dom.text.scrollHeight, 140)}px`
})
dom.text.addEventListener('keydown', (event) => {
  // Enter sends; Shift+Enter is a newline. On a phone keyboard the send key arrives as Enter.
  if (event.key === 'Enter' && event.shiftKey === false) {
    event.preventDefault()
    void sendPrompt('queue')
  }
})
dom.composer.addEventListener('submit', (event) => {
  event.preventDefault()
  void sendPrompt('queue')
})

// The app opens on the session list. There the composer starts a NEW task, which is the one thing
// that cannot be done from inside a session — so the box is present from the first paint.
dom.composer.hidden = false
dom.text.placeholder = 'Start a new task…'

/* ── installing as an app ───────────────────────────────────────────────── */

/**
 * Whether the app is already running as an installed app rather than in a browser tab.
 *
 * This is the difference the human actually notices: installed, there is no address bar and no
 * browser menu. Chromium answers through `display-mode`; Safari uses its legacy `standalone`
 * flag, so both are checked.
 *
 * @returns True when the app is running standalone.
 */
function runningStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true
  )
}

/** The deferred install prompt, when the browser has offered one. */
let installEvent = null

// Chromium fires this exactly when the app has become installable, which is the moment worth
// surfacing: the manifest is public, the service worker is registered, and the icons exist.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  installEvent = event
  if (!runningStandalone()) dom.install.hidden = false
})

window.addEventListener('appinstalled', () => {
  installEvent = null
  dom.install.hidden = true
  showState('Installed — open it from your home screen.')
})

dom.installGo.addEventListener('click', async () => {
  if (installEvent === null) {
    dom.install.hidden = true
    return
  }
  const event = installEvent
  installEvent = null
  dom.install.hidden = true
  try {
    await event.prompt()
  } catch {
    // The browser refused to re-prompt (it allows one prompt per install offer). Nothing to do:
    // the menu still has "Add to Home screen".
  }
})

dom.installNo.addEventListener('click', () => {
  dom.install.hidden = true
})

// Learn the computers carried from the one we came from, then take the list out of the address bar
// so it is not re-applied or bookmarked as if it were part of the app.
const carriedPeers = new URLSearchParams(location.search).get('peers')
if (carriedPeers !== null) {
  absorbPeers(carriedPeers)
  history.replaceState(null, '', location.href.split('?')[0])
}
renderPeers()

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${ROUTE}/sw.js`, { scope: `${ROUTE}/` }).catch(() => {})
}

void loadList()
