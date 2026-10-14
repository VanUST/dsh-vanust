/**
 * PURPOSE
 *   Serve the phone chat bridge. This is the host half: one capability-fenced HTTP route that
 *   hands an installable mobile PWA the session list and, in later increments, the session
 *   transcript, the composer and the agent's pending questions. It adds no tool, no prompt
 *   section and no service to the model's surface — its only influence on a turn is a user
 *   message and an answer to a question, exactly what a human at the desk would have supplied.
 *
 *   The deployment this exists for reaches the harness from a phone over a private tailnet, so
 *   the route is intentionally NOT part of the `/api` carrier: it authenticates with its own
 *   device cookie and fences itself with the harness's own browser trust check, rather than
 *   depending on the Web GUI's ephemeral launch token (which is memory-only and therefore cannot
 *   enrol a second device).
 *
 * INPUTS
 *   Config (all optional):
 *     `enabled`      - false mounts no route. Default true. `DSH_CHAT_BRIDGE_DISABLED=1` does the same.
 *     `stateDir`     - where the secret and the paired-device list live. Default
 *                      `$DSH_HOME/chat-bridge`, falling back to `~/.dsh/chat-bridge`.
 *     `pairWindowMs` - how long a pairing code stays valid. Default 900000 (15 minutes).
 *     `cookieDays`   - how long a paired device stays paired. Default 30.
 *     `sessionLimit` - largest session list returned. Default 50.
 *     `maxStreams`   - how many sessions may be followed at once; the least recently opened is
 *                      closed first. Default 4.
 *     `streamIdleMs` - how long a followed session with no viewer is kept before its iterator is
 *                      cancelled. Default 900000 (15 minutes).
 *     `historyLimit` - how many recent render items one followed session replays to a viewer that
 *                      joins late. Default 500.
 *     `answerWindowMs` - safety-net deadline for a question or approval the phone has not answered.
 *                      Default 600000 (10 minutes). The authoritative deadline is the request's own
 *                      cancellation signal, which the harness aborts when its own wait expires —
 *                      the timed `ask_user_question` tool waits 120 s by default.
 *   Services, resolved lazily so the plugin loads in a composition that lacks them:
 *     `webServer` (required to serve), `connection` (the browser trust fence, applied when
 *     present), `sessionQuery` (the session list, titles and transcript), `sessionController`
 *     (the `session/follow` live stream).
 *
 * OUTPUTS
 *   No tool, no prompt section, no service. `apply` returns nothing and never throws: a harness
 *   that cannot serve the bridge must still boot and run turns. Every request is answered;
 *   failures are 4xx/5xx with a JSON reason, never a dropped socket — except the SSE route, which
 *   owns its response and holds it open until the client goes away.
 *
 * KEYWORDS
 *   chat bridge, phone, PWA, session list, device pairing, signed cookie, capability route,
 *   user-questions, approval, SSE, tailnet
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `webServer` service in the composition: nothing is mounted, and that is logged once.
 *   - A secret file that exists but is too short: the route answers 503 rather than generating a
 *     new secret, because regenerating would silently un-pair every device.
 *   - Unauthenticated request: only the pairing page and `POST /pair` are served; every other
 *     path answers 401 without leaking whether a file exists.
 *   - Wrong pairing code, expired code, or a code replayed after use: 403, and the failure is
 *     logged with the reason but never with the code.
 *   - A request body larger than 64 KiB: rejected 413 without buffering it.
 *   - A malformed JSON body: 400, never a throw out of the handler.
 *   - Path traversal: assets are served from a fixed map of known names, so a request cannot
 *     name a file at all.
 *   - `sessionQuery` absent: the list endpoint answers 503 naming the missing service, rather
 *     than reporting an empty list that would look like "no sessions".
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  addDevice,
  constantTimeEquals,
  hasDevice,
  loadOrCreateSecret,
  newPairingCode,
  readDevices,
  signCookie,
  statePath,
  verifyCookie,
  writeJsonAtomic,
} from './bridge-state.mjs'
import { SessionStreamHub, renderItem } from './bridge-streams.mjs'
import { AskBroker } from './bridge-ask.mjs'

/** Cordis plugin name; also the id a profile patch targets. */
export const name = 'chat-bridge'

/** Nothing is required to exist before activation; services are resolved lazily. */
export const inject = []

/** The single path prefix this plugin owns. */
export const BRIDGE_ROUTE = '/chat-bridge'

/** Name of the device cookie. */
const COOKIE_NAME = 'chat_bridge'

/** Largest request body accepted, in bytes. */
const MAX_BODY_BYTES = 64 * 1024

/** Assets this route will serve, by exact pathname. A fixed map, so a request names no path. */
const ASSETS = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/markdown.js', 'markdown.js'],
  ['/app.css', 'app.css'],
  ['/manifest.webmanifest', 'manifest.webmanifest'],
  ['/sw.js', 'sw.js'],
  ['/icon.svg', 'icon.svg'],
  ['/icon-192.png', 'icon-192.png'],
  ['/icon-512.png', 'icon-512.png'],
  ['/icon-maskable-512.png', 'icon-maskable-512.png'],
])

/**
 * Assets served WITHOUT a device cookie.
 *
 * The pairing page already had to be public, but the manifest and the icons must be too, and that
 * is not cosmetic: a browser reads the manifest to decide whether the app is installable, and it
 * does so BEFORE any pairing exists. Serving them 401 means the browser cannot offer "Add to Home
 * screen" at all — every icon still renders, but the install affordance never appears. They carry
 * no session data: a name, a colour and some pixels.
 */
const PUBLIC_ASSETS = new Map([
  ['/manifest.webmanifest', 'manifest.webmanifest'],
  ['/icon.svg', 'icon.svg'],
  ['/icon-192.png', 'icon-192.png'],
  ['/icon-512.png', 'icon-512.png'],
  ['/icon-maskable-512.png', 'icon-maskable-512.png'],
])

/** Content type per asset file name. */
const CONTENT_TYPES = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['markdown.js', 'text/javascript; charset=utf-8'],
  ['app.css', 'text/css; charset=utf-8'],
  ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['sw.js', 'text/javascript; charset=utf-8'],
  ['icon.svg', 'image/svg+xml'],
  ['icon-192.png', 'image/png'],
  ['icon-512.png', 'image/png'],
  ['icon-maskable-512.png', 'image/png'],
])

/**
 * Resolve the state directory from config, the environment, or the harness home.
 *
 * @param config - Resolved plugin configuration.
 * @returns An absolute directory path.
 */
function resolveStateDir(config) {
  if (typeof config.stateDir === 'string' && config.stateDir !== '') return config.stateDir
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'chat-bridge')
}

/** Whether the operator silenced the bridge from a shell. */
function disabledFromEnv() {
  const value = process.env.DSH_CHAT_BRIDGE_DISABLED
  return typeof value === 'string' && value !== '' && value !== '0' && value.toLowerCase() !== 'false'
}

/**
 * Attach the bridge's defaults to a plugin configuration.
 *
 * @param config - The configuration the loader resolved.
 * @returns A complete configuration object.
 */
function resolveConfig(config = {}) {
  return {
    enabled: config.enabled !== false && !disabledFromEnv(),
    stateDir: resolveStateDir(config),
    pairWindowMs: Number.isFinite(config.pairWindowMs) && config.pairWindowMs > 0 ? config.pairWindowMs : 15 * 60 * 1000,
    cookieDays: Number.isFinite(config.cookieDays) && config.cookieDays > 0 ? config.cookieDays : 30,
    sessionLimit: Number.isFinite(config.sessionLimit) && config.sessionLimit > 0 ? config.sessionLimit : 50,
    maxStreams: Number.isFinite(config.maxStreams) && config.maxStreams > 0 ? config.maxStreams : 4,
    streamIdleMs: Number.isFinite(config.streamIdleMs) && config.streamIdleMs > 0 ? config.streamIdleMs : 15 * 60 * 1000,
    historyLimit: Number.isFinite(config.historyLimit) && config.historyLimit > 0 ? config.historyLimit : 500,
    allowedHosts: Array.isArray(config.allowedHosts)
      ? config.allowedHosts.filter((entry) => typeof entry === 'string' && entry !== '').map((entry) => entry.toLowerCase())
      : [],
    answerWindowMs: Number.isFinite(config.answerWindowMs) && config.answerWindowMs > 0 ? config.answerWindowMs : 10 * 60 * 1000,
  }
}

/**
 * Remove the on-disk pairing code.
 *
 * The code is a one-time credential, so leaving it in a file after it has been spent (or after
 * the device it was minted for exists) hands the next reader a code that no longer works and
 * looks like it should. Absence is never an error here.
 *
 * @param dir - Absolute state directory.
 * @param log - Logger sink.
 * @returns Nothing.
 */
function clearPairingFile(dir, log) {
  try {
    rmSync(statePath(dir, 'pairing.json'), { force: true })
  } catch (error) {
    log.warn(`chat-bridge: could not remove the spent pairing file: ${String(error?.message ?? error)}`)
  }
}

/**
 * Answer with JSON and end the response.
 *
 * @param res - The response to own.
 * @param status - HTTP status code.
 * @param value - JSON-serializable body.
 * @returns Nothing.
 */
function sendJson(res, status, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', String(body.byteLength))
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

/**
 * Answer with plain text and end the response.
 *
 * @param res - The response to own.
 * @param status - HTTP status code.
 * @param text - Body text.
 * @returns Nothing.
 */
function sendText(res, status, text) {
  const body = Buffer.from(text, 'utf8')
  res.statusCode = status
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.setHeader('content-length', String(body.byteLength))
  res.end(body)
}

/**
 * Read a JSON request body within the size cap.
 *
 * @param req - The incoming request.
 * @returns `{ value }` on success, or `{ bad: 'too-large' | 'malformed' }` — never a throw.
 */
async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.byteLength
    if (total > MAX_BODY_BYTES) return { bad: 'too-large' }
    chunks.push(chunk)
  }
  if (total === 0) return { value: {} }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { bad: 'malformed' }
    return { value: parsed }
  } catch {
    return { bad: 'malformed' }
  }
}

/**
 * Parse the request's cookies.
 *
 * @param req - The incoming request.
 * @returns A name-to-value map; empty when no Cookie header is present.
 */
function cookiesOf(req) {
  const header = req.headers?.cookie
  if (typeof header !== 'string' || header === '') return new Map()
  const out = new Map()
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    out.set(part.slice(0, at).trim(), part.slice(at + 1).trim())
  }
  return out
}

/**
 * The hostname a request names, without its port.
 *
 * @param req - The incoming request.
 * @returns A lower-cased hostname, or an empty string.
 */
function hostnameOf(req) {
  const raw = typeof req.headers?.host === 'string' ? req.headers.host : ''
  const match = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(raw)
  if (match === null) return ''
  return match[1].replace(/^\[|\]$/g, '').toLowerCase()
}

/**
 * Whether this deployment serves the authority a request names.
 *
 * Loopback is always served: that is the USB tunnel's `127.0.0.1:<port>` and it is also what a
 * DNS-rebinding attack cannot forge, since the attacker's page must send the attacker's own
 * hostname. Any other authority must be declared in `allowedHosts`.
 *
 * @param req - The incoming request.
 * @param allowedHosts - Configured hostnames this deployment is reached by.
 * @returns True when the authority is ours.
 */
function hostTrusted(req, allowedHosts) {
  const hostname = hostnameOf(req)
  if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') return true
  return hostname !== '' && allowedHosts.includes(hostname)
}

/**
 * Build the inline pairing page.
 *
 * It is inline on purpose: an unauthenticated request must not be able to fetch any file, so the
 * one page served before pairing carries no external asset at all.
 *
 * @returns The page as an HTML string.
 */
function pairingPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Pair this phone</title>
<style>
 :root { color-scheme: dark }
 body { margin:0; min-height:100dvh; display:grid; place-items:center;
        font: 16px/1.5 system-ui, sans-serif; background:#0e1116; color:#e6edf3; padding:24px }
 form { width:min(360px,100%); display:grid; gap:12px }
 h1 { font-size:1.15rem; margin:0 }
 p { margin:0; color:#9aa7b4; font-size:.9rem }
 input,button { font:inherit; padding:12px; border-radius:10px; border:1px solid #2b3543;
                background:#161b22; color:inherit }
 button { background:#2f81f7; border-color:#2f81f7; color:#fff; font-weight:600 }
 output { color:#ff7b72; font-size:.9rem; min-height:1.2em }
</style></head>
<body>
<form id="pair">
  <h1>Pair this phone</h1>
  <p>Enter the six-digit code printed by the harness — or open the link it prints and this fills itself in.</p>
  <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code"
         pattern="[0-9]{6}" maxlength="6" placeholder="000000" required>
  <input id="label" name="label" maxlength="64" placeholder="device name (optional)">
  <button type="submit">Pair</button>
  <output id="error"></output>
</form>
<script>
// A code in the query string pairs in one step, with no digits typed on a phone keyboard. It is
// single-use and short-lived, which is what makes putting it in a URL acceptable: it is the same
// secret the human would have typed, and it is spent the moment it is used.
const supplied = new URLSearchParams(location.search).get('code')
if (supplied !== null && /^[0-9]{6}$/.test(supplied)) {
  document.getElementById('code').value = supplied
  history.replaceState(null, '', location.href.split('?')[0])
}
document.getElementById('pair').addEventListener('submit', async (event) => {
  event.preventDefault()
  const out = document.getElementById('error')
  out.textContent = ''
  try {
    const response = await fetch('${BRIDGE_ROUTE}/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: document.getElementById('code').value,
        label: document.getElementById('label').value,
      }),
    })
    if (response.ok) { location.replace('${BRIDGE_ROUTE}/'); return }
    const detail = await response.json().catch(() => ({}))
    out.textContent = detail.message ?? 'pairing failed'
  } catch (error) {
    out.textContent = String(error)
  }
})
if (supplied !== null && /^[0-9]{6}$/.test(supplied)) {
  document.getElementById('pair').requestSubmit()
}
</script>
</body></html>
`
}

/**
 * Read one asset from the plugin's own `web/` directory.
 *
 * @param file - File name from the asset map.
 * @returns The file contents.
 */
function readAsset(file) {
  return readFileSync(new URL(`./web/${file}`, import.meta.url))
}

/**
 * Whether a request carries a valid, still-paired device cookie.
 *
 * @param req - The incoming request.
 * @param secret - The server secret.
 * @param stateDir - State directory holding the device list.
 * @param now - Current epoch milliseconds.
 * @returns True only when the cookie is well signed, unexpired and still paired.
 */
function isPaired(req, secret, stateDir, now = Date.now()) {
  const token = cookiesOf(req).get(COOKIE_NAME)
  const payload = verifyCookie(secret, token, now)
  if (payload === undefined) return false
  return hasDevice(stateDir, payload.deviceId)
}

/**
 * Build the request handler.
 *
 * @param ctx - The plugin's context, for `connection` and `sessionQuery`.
 * @param options - Resolved config plus the mutable pairing state.
 * @returns A `(req, res) => Promise<void>` handler that never throws.
 */
function createHandler(ctx, options) {
  const { config, state, log, hub, broker } = options

  /**
   * Serve the session list from the harness's own query service.
   *
   * @param res - The response to own.
   * @returns Nothing; the response is always ended.
   */
  async function serveSessions(res) {
    const sessionQuery = ctx.get('sessionQuery')
    if (sessionQuery === undefined || sessionQuery === null || typeof sessionQuery.listSessions !== 'function') {
      sendJson(res, 503, {
        error: 'unavailable',
        message: 'this composition mounts no sessionQuery service, so the bridge cannot list sessions',
      })
      return
    }
    const records = await sessionQuery.listSessions()
    const page = (Array.isArray(records) ? records : []).slice(0, config.sessionLimit)

    // A `SessionRecord` carries only `{header, live, persisted}` — there is no title on it. The
    // title is a separate fold, so it is read in one batch for the whole page and failures are
    // isolated per session by the service itself. A title fold that throws must not cost the
    // list: a session without a title still has an id and a directory worth showing.
    const titles = new Map()
    if (page.length > 0 && typeof sessionQuery.readTitleSnapshots === 'function') {
      try {
        const folded = await sessionQuery.readTitleSnapshots(page.map((record) => record.header.id))
        for (const result of Array.isArray(folded) ? folded : []) {
          if (result?.status !== 'fulfilled') continue
          titles.set(String(result.sessionId), result.value?.title ?? null)
        }
      } catch (error) {
        log.warn(`chat-bridge: could not fold session titles: ${String(error?.message ?? error)}`)
      }
    }

    const sessions = page.map((record) => {
      const id = String(record?.header?.id ?? '')
      const title = titles.get(id) ?? null
      return {
        id,
        title: typeof title?.title === 'string' ? title.title : null,
        cwd: typeof record?.header?.cwd === 'string' ? record.header.cwd : null,
        createdAt: Number.isSafeInteger(record?.header?.createdAt) ? record.header.createdAt : null,
        // Title recency is a better "when did anything happen here" than creation time, and it
        // falls back to creation for a session that has never been named.
        updatedAt: Number.isSafeInteger(title?.updatedAt)
          ? title.updatedAt
          : Number.isSafeInteger(record?.header?.createdAt)
            ? record.header.createdAt
            : null,
        live: record?.live === true,
        // `origin` is the discriminator the address validator itself uses for a subagent child,
        // and `parentSession` is how that child is addressed. A header can carry a parent without
        // being a subagent, so the flag follows `origin` rather than the presence of a parent.
        subagent: record?.header?.origin === 'subagent',
      }
    })
    sendJson(res, 200, { sessions })
  }

  /**
   * Admit one user turn into a session.
   *
   * Shared by `POST /api/prompt` and `POST /api/new` so the two cannot drift in how they admit a
   * turn — the idempotency, the whitespace rule and the cancellation signal are the same question
   * however the session came to exist.
   *
   * @param sessionId - Target session.
   * @param text - Turn text; the caller has already refused whitespace-only input.
   * @param mode - `queue` or `steer`.
   * @param requestId - Idempotency key.
   * @param signal - The service dereferences this unconditionally, so it is never optional.
   * @returns The service's acceptance value.
   */
  async function admitTurn(sessionId, text, mode, requestId, signal) {
    const controller = ctx.get('sessionController')
    if (controller === undefined || controller === null || typeof controller.prompt !== 'function') {
      throw new Error('this composition mounts no sessionController, so the bridge cannot send a turn')
    }
    return controller.prompt({ requestId, sessionId, mode, content: [{ type: 'text', text }] }, signal)
  }

  /**
   * Start a new session, optionally with its first turn.
   *
   * This is what "dispatch a task from the phone" means: without it the bridge could only continue
   * conversations that already existed. The working directory is optional and defaults to the
   * harness's own; `workspaceId` is deliberately not offered, because a workspace id is a host
   * concept a phone has no way to discover or choose between.
   *
   * @param req - The incoming request.
   * @param res - The response to own.
   * @returns Nothing; the response is always ended.
   */
  async function serveNew(req, res) {
    const body = await readJsonBody(req)
    if (body.bad !== undefined) {
      sendJson(res, body.bad === 'too-large' ? 413 : 400, { error: body.bad, message: 'the body must be a JSON object' })
      return
    }
    const text = typeof body.value.text === 'string' ? body.value.text : ''
    const cwd = typeof body.value.cwd === 'string' && body.value.cwd !== '' ? body.value.cwd : undefined
    const supplied = typeof body.value.requestId === 'string' && body.value.requestId !== '' ? body.value.requestId : null
    const requestId = supplied ?? randomUUID()

    const controller = ctx.get('sessionController')
    if (controller === undefined || controller === null || typeof controller.create !== 'function') {
      sendJson(res, 503, {
        error: 'unavailable',
        message: 'this composition mounts no sessionController, so the bridge cannot start a session',
      })
      return
    }

    const created = await controller.create(cwd === undefined ? {} : { cwd })
    const sessionId = created?.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') {
      sendJson(res, 502, { error: 'not-created', message: 'the harness returned no session id' })
      return
    }
    log.info(`chat-bridge: created ${sessionId}${cwd === undefined ? '' : ` in ${cwd}`}`)

    if (text.trim() === '') {
      sendJson(res, 201, { sessionId, prompted: false })
      return
    }

    const abort = new AbortController()
    res.once('close', () => abort.abort())
    await admitTurn(sessionId, text, 'queue', requestId, abort.signal)
    sendJson(res, 201, { sessionId, prompted: true, requestId, mode: 'queue' })
  }

  /**
   * Accept one user turn into a session.
   *
   * The two modes are the difference between dispatching work and guiding work already in flight:
   * `queue` adds a turn to the agent's inbox, `steer` redirects the turn that is running right
   * now. The client may supply its own `requestId`, and should: the harness is idempotent on it
   * (`hasPromptRequest` in dsh-api-session-controller/lib/index.js:855-856), so a phone that loses
   * the network after sending can retry the same id and the turn is not sent twice. That matters
   * on this network, which drops connections intermittently.
   *
   * @param req - The incoming request.
   * @param res - The response to own.
   * @returns Nothing; the response is always ended.
   */
  async function servePrompt(req, res) {
    const body = await readJsonBody(req)
    if (body.bad !== undefined) {
      sendJson(res, body.bad === 'too-large' ? 413 : 400, { error: body.bad, message: 'the body must be a JSON object' })
      return
    }
    const sessionId = typeof body.value.sessionId === 'string' ? body.value.sessionId : ''
    const text = typeof body.value.text === 'string' ? body.value.text : ''
    const mode = body.value.mode === 'steer' ? 'steer' : 'queue'
    const supplied = typeof body.value.requestId === 'string' && body.value.requestId !== '' ? body.value.requestId : null
    const requestId = supplied ?? randomUUID()

    if (sessionId === '') {
      sendJson(res, 400, { error: 'bad-request', message: 'a sessionId is required' })
      return
    }
    // The harness rejects whitespace-only content too; refusing here keeps the error a 400 with a
    // readable reason rather than a gateway error the phone has to interpret.
    if (text.trim() === '') {
      sendJson(res, 400, { error: 'bad-request', message: 'text must contain something other than whitespace' })
      return
    }

    // The service's `prompt` takes `(request, signal)` and dereferences the signal unconditionally
    // (`signal.throwIfAborted()` at its first statement, dsh-api-session-controller/lib/index.js),
    // so omitting it is a TypeError rather than a readable error. The signal is checked once, at
    // entry — it means "do not even begin admitting this turn" — which is why it is tied to the
    // client's connection: a phone that gave up before the turn was admitted should not enqueue it.
    const abort = new AbortController()
    res.once('close', () => abort.abort())

    const accepted = await admitTurn(sessionId, text, mode, requestId, abort.signal)
    log.info(`chat-bridge: ${mode} accepted for ${sessionId} (request ${requestId})`)
    sendJson(res, 200, { accepted: accepted?.accepted === true, requestId, mode })
  }

  /**
   * Accept one human decision for a pending question or approval.
   *
   * Both kinds share this handler because they share the property that matters: the decision must
   * be attributable to a request this bridge actually put to the phone, which is what `pendingId`
   * proves. An id the phone invented names nothing and is refused.
   *
   * @param req - The incoming request.
   * @param res - The response to own.
   * @param kind - `question` or `approval`; decides which payload field is read.
   * @returns Nothing; the response is always ended.
   */
  async function serveDecision(req, res, kind) {
    const body = await readJsonBody(req)
    if (body.bad !== undefined) {
      sendJson(res, body.bad === 'too-large' ? 413 : 400, { error: body.bad, message: 'the body must be a JSON object' })
      return
    }
    const pendingId = typeof body.value.pendingId === 'string' ? body.value.pendingId : ''
    const outcome = broker.settle(pendingId, body.value)
    if (outcome.status === 'settled') {
      log.info(`chat-bridge: ${kind} ${pendingId} settled by the phone`)
      sendJson(res, 200, { settled: true })
      return
    }
    if (outcome.status === 'bad-request') {
      // The broker's own reason, so a client developer is told which rule was broken rather than
      // being sent to look at a payload that was in fact well formed.
      sendJson(res, 400, { error: 'bad-request', message: outcome.reason ?? 'the payload was refused' })
      return
    }
    // Unknown id: the request either never existed or was already answered. The bridge keeps no
    // settled ledger, so it reports the one thing it knows rather than guessing which.
    sendJson(res, 409, { error: 'unknown-request', message: outcome.reason ?? 'no request is waiting under that pendingId' })
  }

  /**
   * Stop the turn a session is running.
   *
   * `cancel` is synchronous on the service and takes only `{sessionId}` — no signal. It throws when
   * the session has no attached agent, which is the honest answer to "stop it" for a session that
   * is running nothing, so that becomes a 409 rather than a 500.
   *
   * @param req - The incoming request.
   * @param res - The response to own.
   * @returns Nothing; the response is always ended.
   */
  async function serveCancel(req, res) {
    const body = await readJsonBody(req)
    if (body.bad !== undefined) {
      sendJson(res, body.bad === 'too-large' ? 413 : 400, { error: body.bad, message: 'the body must be a JSON object' })
      return
    }
    const sessionId = typeof body.value.sessionId === 'string' ? body.value.sessionId : ''
    if (sessionId === '') {
      sendJson(res, 400, { error: 'bad-request', message: 'a sessionId is required' })
      return
    }
    const controller = ctx.get('sessionController')
    if (controller === undefined || controller === null || typeof controller.cancel !== 'function') {
      sendJson(res, 503, {
        error: 'unavailable',
        message: 'this composition mounts no sessionController, so the bridge cannot stop a turn',
      })
      return
    }
    try {
      const value = controller.cancel({ sessionId })
      log.info(`chat-bridge: cancellation requested for ${sessionId}`)
      sendJson(res, 200, { accepted: value?.accepted === true })
    } catch (error) {
      sendJson(res, 409, { error: 'not-running', message: String(error?.message ?? error) })
    }
  }

  /**
   * Resolve the durable address `session/follow` accepts for one session id.
   *
   * A top-level session is addressed by `{kind:'session', sessionId}`. A subagent child is not:
   * following one with that shape throws "subagent Sessions require their durable parent
   * address", so its parent and child ids are supplied instead. The mode is `'unknown'` because
   * the header does not record whether the child was one-shot or continuable, and the vocabulary
   * admits exactly that uncertainty rather than inviting a guess.
   *
   * @param sessionId - The session to address.
   * @returns A `SessionAddress`.
   */
  async function resolveAddress(sessionId) {
    const sessionQuery = ctx.get('sessionQuery')
    if (sessionQuery !== undefined && sessionQuery !== null && typeof sessionQuery.readTitleSnapshots === 'function') {
      try {
        const [observation] = await sessionQuery.readTitleSnapshots([sessionId])
        // The field is `session`, not `header`: `SessionTitleObservation` is `{session, title?}`
        // (dsh-session-query/lib/types/types.d.ts:135-140). Reading `header` yields undefined and
        // silently degrades every subagent to the plain address, which the harness then refuses.
        const header = observation?.status === 'fulfilled' ? observation.value?.session : null
        const parent = header?.parentSession
        // The validator in the session controller refuses `{kind:'session'}` exactly when
        // `header.origin === 'subagent'` (dsh-api-session-controller/lib/index.js:1626-1631), so
        // that is the field that decides, not the mere presence of a parent.
        if (header?.origin === 'subagent' && typeof parent === 'string' && parent !== '') {
          return { kind: 'subagent', parentSessionId: parent, childSessionId: String(header.id), mode: 'unknown' }
        }
      } catch (error) {
        // Falling back to the plain session address is right for a top-level session and merely
        // re-produces the harness's own refusal for a subagent one, which the viewer then sees.
        log.warn(`chat-bridge: could not resolve the address of ${sessionId}: ${String(error?.message ?? error)}`)
      }
    }
    return { kind: 'session', sessionId }
  }

  /**
   * Serve the tail of one session's transcript as render items.
   *
   * `sessionQuery.listEvents` returns metadata only — `{sessionId, seq, type, time, surface}` and
   * no `data` — so the transcript is read with `readSession`, which returns the complete validated
   * event log. Only the tail is sent: a phone opening a long session wants the recent turns, and
   * the live stream carries everything after them.
   *
   * @param res - The response to own.
   * @param url - The parsed request URL.
   * @returns Nothing; the response is always ended.
   */
  async function serveTranscript(res, url) {
    const sessionId = url.searchParams.get('sessionId') ?? ''
    if (sessionId === '') {
      sendJson(res, 400, { error: 'bad-request', message: 'a sessionId query parameter is required' })
      return
    }
    const sessionQuery = ctx.get('sessionQuery')
    if (sessionQuery === undefined || sessionQuery === null || typeof sessionQuery.readSession !== 'function') {
      sendJson(res, 503, {
        error: 'unavailable',
        message: 'this composition mounts no sessionQuery service, so the bridge cannot read a transcript',
      })
      return
    }
    const requested = Number(url.searchParams.get('limit') ?? '200')
    const limit = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 500) : 200

    const snapshot = await sessionQuery.readSession(sessionId)
    const events = Array.isArray(snapshot?.events) ? snapshot.events : []
    const items = events.map((event) => renderItem(event)).filter((item) => item !== null)
    const tail = items.slice(-limit)
    const lastSeq = tail.length > 0 && Number.isSafeInteger(tail[tail.length - 1].seq) ? tail[tail.length - 1].seq : 0
    sendJson(res, 200, {
      sessionId,
      header: snapshot?.session ?? null,
      lastSeq,
      rendered: items.length,
      dropped: events.length - items.length,
      items: tail,
    })
  }

  /**
   * Serve the live stream over Server-Sent Events.
   *
   * SSE rather than a WebSocket: it is a plain HTTP response, so it survives the tailnet proxy
   * without upgrade handling, and the harness already uses that mechanism for its own plugin HMR.
   * Biddirection is not needed — every server-initiated message is a response to a stream the
   * client opened, and the client's writes are ordinary POSTs.
   *
   * @param req - The incoming request.
   * @param res - The response to own; held open until the client goes away.
   * @param url - The parsed request URL.
   * @returns Nothing.
   */
  async function serveStream(req, res, url) {
    const sessionId = url.searchParams.get('sessionId') ?? ''
    if (sessionId === '') {
      sendJson(res, 400, { error: 'bad-request', message: 'a sessionId query parameter is required' })
      return
    }
    const requested = Number(url.searchParams.get('after') ?? '0')
    const after = Number.isSafeInteger(requested) && requested > 0 ? requested : 0
    const address = await resolveAddress(sessionId)

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    // Ask the browser to reconnect on its own, which is what makes a dropped tailnet connection a
    // pause rather than a dead app.
    res.write('retry: 3000\n\n')

    let finished = false
    const write = (event, data) => {
      if (finished) return
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      } catch (error) {
        log.warn(`chat-bridge: stream write failed for ${sessionId}: ${String(error?.message ?? error)}`)
        finish()
      }
    }

    // `ready` is written BEFORE subscribing, because subscribing replays the stream's buffer
    // synchronously: a resuming viewer's first frames would otherwise precede the frame that tells
    // it the stream exists.
    write('ready', { sessionId, after, address })

    const unsubscribe = hub.subscribe(sessionId, address, after, (item) => write('item', item))
    // A comment line every 20s keeps an idle stream alive through a proxy that would otherwise
    // close a connection it considers silent.
    const heartbeat = setInterval(() => {
      if (finished) return
      try {
        res.write(': ping\n\n')
      } catch {
        finish()
      }
    }, 20000)

    function finish() {
      if (finished) return
      finished = true
      clearInterval(heartbeat)
      unsubscribe()
      try {
        res.end()
      } catch {
        // The socket is already gone; nothing to end.
      }
    }

    req.on('close', finish)
    res.on('close', finish)
  }

  return async function handle(req, res) {
    let pathname
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      sendText(res, 400, 'bad request target')
      return
    }
    const method = req.method ?? 'GET'
    const relative = pathname.slice(BRIDGE_ROUTE.length) || '/'

    try {
      if (state.secretError !== null) {
        log.warn(`chat-bridge: refusing ${relative}: ${state.secretError}`)
        sendJson(res, 503, { error: 'unavailable', message: 'the bridge has no usable server secret' })
        return
      }

      // This route applies its OWN trust rule rather than the harness's `requestRejection`, and the
      // reason is measured rather than stylistic. `requestRejection` refuses any request whose
      // `Sec-Fetch-Site` is `cross-site` (dsh-client-connection/lib/index.js:211), and a phone
      // LAUNCHING THE INSTALLED APP — or tapping a link to it — sends exactly that. The app would
      // therefore show "forbidden" every time it was opened from its own icon, which is the one
      // thing an installed app must do.
      //
      // So the rule is narrowed to what each half of it is actually for:
      //   - DNS rebinding: the Host must be an authority this deployment serves. Kept in full, and
      //     read here because the harness's own fence cannot be asked for half of itself.
      //   - Cross-site request forgery: refused for anything that is not a read. A navigation is a
      //     read, so opening the app is allowed; a POST from another site is not. Cross-site reads
      //     lose nothing anyway, because the device cookie is `SameSite=Strict` and is not sent on
      //     a cross-site request, so such a read arrives unauthenticated and gets the pairing page.
      if (!hostTrusted(req, config.allowedHosts)) {
        log.warn(`chat-bridge: refused ${relative}: ${JSON.stringify(req.headers?.host ?? '')} is not an authority this bridge serves`)
        sendText(res, 403, 'forbidden')
        return
      }
      const crossSite = req.headers?.['sec-fetch-site'] === 'cross-site'
      if (crossSite && method !== 'GET' && method !== 'HEAD') {
        log.warn(`chat-bridge: refused ${method} ${relative} from another site`)
        sendText(res, 403, 'forbidden')
        return
      }

      if (relative === '/pair' && method === 'POST') {
        const body = await readJsonBody(req)
        if (body.bad !== undefined) {
          sendJson(res, body.bad === 'too-large' ? 413 : 400, { error: body.bad, message: 'the body must be a JSON object' })
          return
        }
        const supplied = typeof body.value.code === 'string' ? body.value.code : ''
        if (state.pairing === null || Date.now() > state.pairing.expiresAt) {
          log.warn('chat-bridge: refused pairing with an expired or absent code')
          sendJson(res, 403, { error: 'forbidden', message: 'no pairing code is open; restart the harness to get one' })
          return
        }
        if (!constantTimeEquals(supplied, state.pairing.code)) {
          log.warn('chat-bridge: refused pairing with a wrong code')
          sendJson(res, 403, { error: 'forbidden', message: 'that pairing code is not right' })
          return
        }
        const device = addDevice(config.stateDir, body.value.label)
        // Single use: a code that has paired once is spent, so a shoulder-surfed code is worth
        // nothing after the intended phone has used it. The file goes with it, so nobody reads a
        // code that no longer works.
        state.pairing = null
        clearPairingFile(config.stateDir, log)
        const expiresAt = Date.now() + config.cookieDays * 24 * 60 * 60 * 1000
        const cookie = signCookie(state.secret, { deviceId: device.id, expiresAt, issuedAt: Date.now() })
        const secure = (req.headers?.['x-forwarded-proto'] ?? '') === 'https' ? '; Secure' : ''
        res.setHeader(
          'set-cookie',
          `${COOKIE_NAME}=${cookie}; Path=${BRIDGE_ROUTE}; HttpOnly; SameSite=Strict; Max-Age=${String(config.cookieDays * 24 * 60 * 60)}${secure}`,
        )
        log.info(`chat-bridge: paired device ${JSON.stringify(device.label)}`)
        sendJson(res, 200, { paired: true, device: { id: device.id, label: device.label } })
        return
      }

      if (!isPaired(req, state.secret, config.stateDir)) {
        if (relative === '/' || relative === '/index.html') {
          const page = Buffer.from(pairingPage(), 'utf8')
          res.statusCode = 200
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.setHeader('content-length', String(page.byteLength))
          res.setHeader('cache-control', 'no-store')
          res.end(page)
          return
        }
        const publicFile = PUBLIC_ASSETS.get(relative)
        if (method === 'GET' && publicFile !== undefined) {
          const asset = readAsset(publicFile)
          res.statusCode = 200
          res.setHeader('content-type', CONTENT_TYPES.get(publicFile) ?? 'application/octet-stream')
          res.setHeader('content-length', String(asset.byteLength))
          res.setHeader('cache-control', 'no-cache')
          res.end(asset)
          return
        }
        log.warn(`chat-bridge: refused ${relative} from an unpaired device`)
        sendJson(res, 401, { error: 'unauthorized', message: 'pair this device first' })
        return
      }

      if (method === 'GET' && relative === '/api/whoami') {
        const token = cookiesOf(req).get(COOKIE_NAME)
        const payload = verifyCookie(state.secret, token)
        sendJson(res, 200, { paired: true, deviceId: payload?.deviceId ?? null })
        return
      }
      if (method === 'GET' && relative === '/api/sessions') {
        await serveSessions(res)
        return
      }
      if (method === 'POST' && relative === '/api/new') {
        await serveNew(req, res)
        return
      }
      if (method === 'POST' && relative === '/api/prompt') {
        await servePrompt(req, res)
        return
      }
      if (method === 'POST' && relative === '/api/cancel') {
        await serveCancel(req, res)
        return
      }
      if (method === 'POST' && relative === '/api/answer') {
        await serveDecision(req, res, 'question')
        return
      }
      if (method === 'POST' && relative === '/api/approval') {
        await serveDecision(req, res, 'approval')
        return
      }
      if (method === 'GET' && (relative === '/api/transcript' || relative === '/api/stream')) {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (relative === '/api/transcript') await serveTranscript(res, url)
        else await serveStream(req, res, url)
        return
      }
      if (method === 'GET') {
        const file = ASSETS.get(relative)
        if (file === undefined) {
          sendJson(res, 404, { error: 'not-found', message: `no route for ${relative}` })
          return
        }
        const asset = readAsset(file)
        res.statusCode = 200
        res.setHeader('content-type', CONTENT_TYPES.get(file) ?? 'application/octet-stream')
        res.setHeader('content-length', String(asset.byteLength))
        res.setHeader('cache-control', file === 'sw.js' ? 'no-store' : 'no-cache')
        res.end(asset)
        return
      }
      sendJson(res, 405, { error: 'method-not-allowed', message: `${method} is not accepted at ${relative}` })
    } catch (error) {
      // A route that owns its response must answer rather than drop the socket, whatever a
      // service it merely read decided to throw.
      log.warn(`chat-bridge: ${relative} failed: ${String(error?.message ?? error)}`)
      if (!res.headersSent) sendJson(res, 500, { error: 'internal', message: String(error?.message ?? error) })
      else res.end()
    }
  }
}

/**
 * Mount the bridge route.
 *
 * @param ctx - Cordis context.
 * @param config - Resolved plugin configuration; see the module header.
 * @returns Nothing. Never throws: a harness that cannot serve the bridge still boots.
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  const log = {
    info: (message) => ctx.logger?.info?.(message),
    warn: (message) => ctx.logger?.warn?.(message),
  }

  if (!resolved.enabled) {
    log.info('chat-bridge: disabled by configuration or DSH_CHAT_BRIDGE_DISABLED')
    return
  }

  const state = { secret: null, secretError: null, pairing: null }
  try {
    state.secret = loadOrCreateSecret(resolved.stateDir)
  } catch (error) {
    // Not fatal to the harness: the route mounts and answers 503, so the operator learns the
    // reason from a request instead of from a boot that failed for a phone feature.
    state.secretError = String(error?.message ?? error)
    log.warn(`chat-bridge: ${state.secretError}`)
  }

  if (readDevices(resolved.stateDir).devices.length === 0) {
    const code = newPairingCode()
    state.pairing = { code, expiresAt: Date.now() + resolved.pairWindowMs }
    // Written as well as logged: the operator may be reading the file, and the log may be a
    // pager they have already scrolled past. The code is short-lived and single-use.
    try {
      writeJsonAtomic(statePath(resolved.stateDir, 'pairing.json'), {
        code,
        expiresAt: state.pairing.expiresAt,
        note: 'Pair a phone at /chat-bridge/ with this code. Single use; expires at the timestamp above.',
      })
    } catch (error) {
      log.warn(`chat-bridge: could not write the pairing file: ${String(error?.message ?? error)}`)
    }
    log.info(
      `chat-bridge: no device paired - pair one at ${BRIDGE_ROUTE}/ with code ${code} (expires in ${String(Math.round(resolved.pairWindowMs / 60000))} min)`,
    )
  } else {
    // A device is already paired, so no code is open. Any file left from an earlier boot names a
    // code this process will refuse; removing it keeps the file honest.
    clearPairingFile(resolved.stateDir, log)
  }

  // One hub for the process: two phones watching the same session share one `session/follow`,
  // and the hub's replay buffer is what lets the second one join without a gap.
  const hub = new SessionStreamHub({
    ctx,
    log,
    maxStreams: resolved.maxStreams,
    idleMs: resolved.streamIdleMs,
    historyLimit: resolved.historyLimit,
  })
  ctx.effect(() => () => hub.closeAll(), 'chat-bridge: close every followed session')

  const broker = new AskBroker({ hub, log, windowMs: resolved.answerWindowMs })
  ctx.effect(() => () => broker.closeAll(), 'chat-bridge: answer every pending question')

  // The two answerer waterfalls. Both are wrapped so that nothing they do can throw into the
  // turn: a question the bridge fumbled must still end up answered by the rest of the chain,
  // never turned into a broken turn.
  ctx.effect(
    () =>
      ctx.on('user-questions/request', async (request, next) => {
        try {
          return await broker.askQuestions(ctx, request, next)
        } catch (error) {
          log.warn(`chat-bridge: question handling failed, delegating: ${String(error?.message ?? error)}`)
          return next()
        }
      }),
    'chat-bridge: answer user questions from the phone',
  )
  ctx.effect(
    () =>
      ctx.on('approval/request', async (request, next) => {
        try {
          return await broker.askApproval(ctx, request, next)
        } catch (error) {
          log.warn(`chat-bridge: approval handling failed, delegating: ${String(error?.message ?? error)}`)
          return next()
        }
      }),
    'chat-bridge: answer approvals from the phone',
  )
  log.info('chat-bridge: claiming questions and approvals when no desktop client is attached')

  const handler = createHandler(ctx, { config: resolved, state, log, hub, broker })

  ctx.inject(['webServer'], (web) => {
    web.effect(
      () => web.webServer.register({ kind: 'prefix', path: BRIDGE_ROUTE, handler }),
      `chat-bridge: ${BRIDGE_ROUTE}`,
    )
    log.info(`chat-bridge: serving ${BRIDGE_ROUTE} (state in ${resolved.stateDir})`)
  })
}

