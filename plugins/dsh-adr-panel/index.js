/**
 * PURPOSE
 *   Host half of the ADR panel plugin. It serves the ONE route the panel window needs
 *   in order to record a human's Approve or Decline without a chat message and without
 *   an agent in the loop: `GET` builds the ratchet's own ratification question for one
 *   decision, `POST` hands the human's selected label back with that same question and
 *   lets the ratchet write the approval and its transcript.
 *
 *   It is a thin adapter on purpose. It constructs no question, interprets no answer and
 *   writes no file. Both operations are the ratchet's, reached through the cordis
 *   service `ratchetConsent` (`@cc/dsh-ratchet`), which calls the same `ratify`
 *   operation the `ratchet_ratify` tool and the `/ratify` command call. Everything this
 *   file owns is the transport and the fence in front of it.
 *
 * INPUTS
 *   Composed by the harness as a cordis plugin: `apply(ctx)` receives the root context.
 *   It requires no configuration. At request time it needs two services, reachable with
 *   `ctx.get` and never injected as a hard dependency:
 *     - `webServer` — the HTTP carrier the route is registered on. Without it this
 *       plugin contributes nothing and the boot is unaffected, because a browser-facing
 *       plugin mounted in a composition with no web server has nothing to serve.
 *     - `connection` — the harness's browser trust fence (`requestRejection`). Its
 *       absence refuses every request: a route that cannot authenticate a browser must
 *       not act on one.
 *     - `ratchetConsent` — the ratchet's consent service. Its absence is a refusal with
 *       a named reason, never a fallback that mints something itself.
 *
 *   The route is `<CONSENT_ROUTE>`:
 *     GET  ?session=<session-id>&id=<adr-id>      → the ratchet's question, nothing written
 *     POST { session, adrId, label, quiz }        → the ratchet's verdict and artifact
 *   Both carry the capability header {@link CONSENT_HEADER}.
 *
 * OUTPUTS
 *   Registers exactly one HTTP route and one index-injection row, both inside
 *   `ctx.effect` scopes so a reload replaces them rather than colliding. It never
 *   throws out of a handler: every failure is a status code and a JSON body naming what
 *   was refused. It writes no file of its own — the approval and transcript are written
 *   by the ratchet inside the `ratchetConsent` call.
 *
 *   Responses are `application/json` with `cache-control: no-store`, because every one
 *   of them is a live fact about a project:
 *     - 200 `{ ok, root, ...ratifyResult }` — the ratchet answered. `ok` is the
 *       ratchet's own verdict, so a refusal (`RATIFICATION_UNPROVEN`, nothing waiting,
 *       unreadable answer) arrives as 200 with `ok:false` and its `problems`, which is
 *       not the same thing as the request being malformed.
 *     - 400 `bad-request` — malformed query, body, media type or a missing field.
 *     - 401/403 — the browser trust fence, or a missing/wrong capability header.
 *     - 404 `unknown-session` / `no-project` — the Session is unknown, or no
 *       `.dsh/project.json` was found at or above its workspace.
 *     - 503 `consent-unavailable` — no `ratchetConsent` service is mounted, so no
 *       question can be built and no consent can be recorded.
 *
 * KEYWORDS
 *   host route, webServer, browser trust fence, capability token, index injection,
 *   ratification transport, consent service, adr panel, no composed answer
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `webServer` service ever appears: the plugin activates and does nothing, so a
 *     composition without a browser is unaffected.
 *   - No `connection` service: every request is refused with 503 and nothing is written.
 *     Failing closed is the only safe direction — the fence is what makes the route
 *     unreachable by a non-browser caller.
 *   - No `ratchetConsent` service: 503 with the service name, and nothing is written.
 *   - Session id missing, empty, or naming no session the harness knows: 400/404, and
 *     the project root is never guessed from the server's launch directory.
 *   - The Session's workspace has no `.dsh/project.json` at or above it: 404 naming the
 *     workspace, because a route that fell back to another project would answer about
 *     decisions the human is not looking at.
 *   - A request body larger than {@link MAX_BODY_BYTES}: 413, stream drained, nothing
 *     parsed and nothing written.
 *   - A body that is not JSON, or lacks `adrId`/`label`: 400; the ratchet is not called.
 *   - A `quiz` that is absent, foreign, or stale: the ratchet refuses and nothing is
 *     written. This route deliberately does not re-implement any part of that check.
 *   - A wrong or missing capability header: 403 before the ratchet is reached, so a
 *     caller that has not been served this process's index cannot even build a question.
 *   - Two requests at once: each is independent. The ratchet's own queue is what makes a
 *     replayed answer mint nothing, not a lock here.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'

/** Cordis function-plugin name; also the id a profile patch row targets. */
export const name = 'adr-panel'

/**
 * The one route this plugin serves.
 *
 * A literal, because the browser half cannot import it: `client.js` is a hand-written
 * closure bundle with no module graph served from its own tarball, so the path exists
 * twice. `scripts/check-consent-surface.mjs` fails when the two copies stop being equal.
 */
export const CONSENT_ROUTE = '/adr-panel/consent'

/**
 * The name of the cordis service the ratchet provides for consent.
 *
 * Duplicated from `@cc/dsh-ratchet`'s `CONSENT_SERVICE` for the same reason as
 * {@link CONSENT_ROUTE}, and asserted equal by the same check.
 */
export const CONSENT_SERVICE = 'ratchetConsent'

/**
 * The header the browser half sends the capability token in.
 *
 * A custom header rather than a query parameter on purpose: a query string is written
 * into access logs and into the browser's history, and this value is the one thing that
 * separates "a page this process served" from "anything else on loopback".
 */
export const CONSENT_HEADER = 'x-adr-panel-consent'

/**
 * The global the browser half reads the route and its token from.
 *
 * The token is minted per plugin activation with `randomBytes`, held in memory, and
 * delivered only through the served index document — it is never written to a file and
 * never printed. That is the property that makes "no tool can obtain it" true rather
 * than hopeful: there is nothing on disk for a tool to read.
 */
export const CONSENT_GLOBAL = '__DSH_ADR_PANEL_CONSENT__'

/** One request body is a question and two short strings; anything larger is hostile. */
const MAX_BODY_BYTES = 256 * 1024

/** The Session registry: where a Session id becomes that Session's workspace. */
const SESSIONS_SERVICE = 'sessions'

/** The persistence service that answers for a Session no longer live in this process. */
const SESSION_PERSISTENCE_SERVICE = 'sessionPersistence'

/**
 * Sends one JSON response.
 *
 * @param res - The Node response.
 * @param status - HTTP status code.
 * @param payload - A JSON-serializable value.
 * @returns Nothing. The response is ended.
 */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * Sends one refusal: a stable code plus a sentence a human can act on.
 *
 * @param res - The Node response.
 * @param status - HTTP status code.
 * @param code - A stable, machine-readable code.
 * @param message - One sentence naming what was refused and why.
 * @returns Nothing.
 */
function sendRefusal(res, status, code, message) {
  sendJson(res, status, { ok: false, error: code, message })
}

/**
 * Sends 405 with the methods the route accepts.
 *
 * @param res - The Node response.
 * @returns Nothing.
 */
function sendMethodNotAllowed(res) {
  res.statusCode = 405
  res.setHeader('allow', 'GET, POST')
  res.end()
}

/**
 * Collects a bounded request body as UTF-8 text.
 *
 * @param req - The Node request.
 * @returns `{ text }`, or `{ tooLarge: true }` past the ceiling — in which case the
 *   stream is drained so the socket is reusable and the caller answers 413.
 */
async function readBoundedBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return { tooLarge: true }
    }
    chunks.push(chunk)
  }
  return { text: Buffer.concat(chunks, size).toString('utf8') }
}

/**
 * Compares two tokens without leaking their lengths through timing.
 *
 * @param supplied - The header value, or any value.
 * @param expected - The process's token.
 * @returns true only when both are non-empty strings of equal length and equal content.
 */
function tokenMatches(supplied, expected) {
  if (typeof supplied !== 'string' || supplied.length === 0) return false
  const a = Buffer.from(supplied, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Resolves the workspace of one Session, through the live registry first.
 *
 * The Session is the ONLY source of the project root. `process.cwd()` is where the
 * server was launched, which is a home or application directory rather than the project
 * a human is looking at, and answering about that project would be the worst possible
 * failure for a consent surface.
 *
 * @param ctx - The plugin context.
 * @param sessionId - The Session id from the request.
 * @returns `{ cwd }` or `null` when the Session is unknown or carries no directory.
 *   Never throws: a service that is absent or a `stat` that rejects is an unknown
 *   Session, not an exception out of an HTTP handler.
 */
async function sessionWorkspace(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null
  let live = null
  const sessions = ctx.get(SESSIONS_SERVICE)
  if (sessions !== undefined && sessions !== null && typeof sessions.get === 'function') {
    try {
      live = sessions.get(sessionId) ?? null
    } catch {
      live = null
    }
  }
  const liveCwd = live?.header?.cwd
  if (typeof liveCwd === 'string' && liveCwd.length > 0) return { cwd: liveCwd }
  const persistence = ctx.get(SESSION_PERSISTENCE_SERVICE)
  if (persistence !== undefined && persistence !== null && typeof persistence.stat === 'function') {
    try {
      const stored = await persistence.stat(sessionId)
      const cwd = stored?.header?.cwd
      if (typeof cwd === 'string' && cwd.length > 0) return { cwd }
    } catch {
      return null
    }
  }
  return null
}

/**
 * Builds the handler for the one consent route.
 *
 * The order of the gates is the design: the browser fence first (a request that is not
 * from an authenticated browser of this host never reaches the ratchet), then the
 * capability token (a request that was not served this process's index never builds a
 * question), then the Session's project, then the ratchet. Each refusal names itself,
 * and none of them writes anything.
 *
 * @param ctx - The plugin context.
 * @param token - This activation's capability token.
 * @param log - A `{ info, warn }` sink; never given the token.
 * @returns An async `(req, res)` handler that never throws.
 */
function createConsentHandler(ctx, token, log) {
  /**
   * Applies the browser trust fence.
   *
   * @param req - The Node request.
   * @param res - The Node response.
   * @returns true when the request was refused and the response ended.
   */
  const fenced = (req, res) => {
    const connection = ctx.get('connection')
    if (connection === undefined || connection === null || typeof connection.requestRejection !== 'function') {
      // No fence, no route. An unauthenticated loopback caller and a browser are
      // indistinguishable without it, so the safe answer is to refuse rather than to
      // serve a consent surface to whoever is on the machine.
      log.warn('refused: the connection service is not available to authenticate a browser')
      sendRefusal(res, 503, 'consent-unavailable', 'the ADR panel cannot authenticate a browser in this composition, so no consent can be recorded through it')
      return true
    }
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) {
      log.warn(`refused by the browser trust fence with ${String(rejection)}`)
      res.statusCode = rejection
      res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
      return true
    }
    if (!tokenMatches(req.headers?.[CONSENT_HEADER], token)) {
      log.warn('refused: no capability token, or a wrong one')
      sendRefusal(res, 403, 'forbidden', `this route acts only for the ADR panel this process served: the ${CONSENT_HEADER} header must carry the token from ${CONSENT_GLOBAL}`)
      return true
    }
    return false
  }

  /**
   * Resolves the ratchet service and the project root for one request.
   *
   * @param sessionId - The Session id from the request.
   * @returns `{ service, root }`, or `{ refusal: { status, code, message } }`.
   */
  const locate = async (sessionId) => {
    const service = ctx.get(CONSENT_SERVICE)
    if (service === undefined || service === null || typeof service.ask !== 'function' || typeof service.settle !== 'function') {
      return {
        refusal: {
          status: 503,
          code: 'consent-unavailable',
          message: `no ${CONSENT_SERVICE} service is mounted, so the ratchet cannot be asked anything: mount @cc/dsh-ratchet beside this plugin`,
        },
      }
    }
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return { refusal: { status: 400, code: 'bad-request', message: 'a session id is required: the project root comes from the Session, never from the server directory' } }
    }
    const workspace = await sessionWorkspace(ctx, sessionId)
    if (workspace === null) {
      return { refusal: { status: 404, code: 'unknown-session', message: `no directory is known for Session "${sessionId}"` } }
    }
    const root = service.rootFor(workspace.cwd)
    if (root === null || root === undefined) {
      return { refusal: { status: 404, code: 'no-project', message: `Session "${sessionId}" is at "${workspace.cwd}", which has no .dsh/project.json at or above it` } }
    }
    return { service, root }
  }

  /**
   * Answers a question request: the ratchet's own question for one decision.
   *
   * @param req - The Node request.
   * @param res - The Node response.
   * @returns A promise; never rejects.
   */
  const onAsk = async (req, res) => {
    let query
    try {
      query = new URL(String(req.url), 'http://localhost').searchParams
    } catch {
      sendRefusal(res, 400, 'bad-request', 'the query string could not be read')
      return
    }
    const located = await locate(query.get('session'))
    if (located.refusal !== undefined) {
      sendRefusal(res, located.refusal.status, located.refusal.code, located.refusal.message)
      return
    }
    const adrId = query.get('id')
    if (typeof adrId !== 'string' || adrId.length === 0) {
      // An id is required rather than optional: the question carries the record's whole
      // file text as its detail, so "every decision waiting" would ship the corpus in one
      // response. The window always asks about the row the human clicked.
      sendRefusal(res, 400, 'bad-request', 'an "id" query parameter naming the decision is required')
      return
    }
    let result
    try {
      result = located.service.ask({ root: located.root, ids: [adrId] })
    } catch (error) {
      log.warn(`the ratchet's ask threw: ${String(error)}`)
      sendRefusal(res, 500, 'ask-failed', `the ratchet could not build its question: ${String(error)}`)
      return
    }
    log.info(`ask id=${adrId} questions=${Array.isArray(result?.quiz?.questions) ? result.quiz.questions.length : 0} waiting=${Array.isArray(result?.pending) ? result.pending.length : 0}`)
    sendJson(res, 200, { ...result, root: located.root })
  }

  /**
   * Answers an answer: the human's selected label, paired with the question it came from.
   *
   * @param req - The Node request.
   * @param res - The Node response.
   * @returns A promise; never rejects.
   */
  const onSettle = async (req, res) => {
    if (String(req.headers?.['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      sendRefusal(res, 415, 'unsupported-media-type', 'content-type must be application/json')
      return
    }
    let body
    try {
      body = await readBoundedBody(req)
    } catch {
      sendRefusal(res, 400, 'bad-request', 'the request body could not be read')
      return
    }
    if (body.tooLarge === true) {
      sendRefusal(res, 413, 'payload-too-large', `the request body exceeds ${String(MAX_BODY_BYTES)} bytes`)
      return
    }
    let parsed
    try {
      parsed = JSON.parse(body.text)
    } catch {
      sendRefusal(res, 400, 'bad-request', 'the request body is not JSON')
      return
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      sendRefusal(res, 400, 'bad-request', 'the request body must be a JSON object')
      return
    }
    const { session, adrId, label, quiz } = parsed
    if (typeof adrId !== 'string' || adrId.length === 0) {
      sendRefusal(res, 400, 'bad-request', 'the body must name the decision in "adrId"')
      return
    }
    if (typeof label !== 'string' || label.length === 0) {
      sendRefusal(res, 400, 'bad-request', 'the body must carry the selected option label in "label"')
      return
    }
    const located = await locate(session)
    if (located.refusal !== undefined) {
      sendRefusal(res, located.refusal.status, located.refusal.code, located.refusal.message)
      return
    }
    let result
    try {
      // The quiz travels back with the label because the ratchet requires the answer to
      // be paired with the question it answers: a payload with no quiz is refused as
      // `RATIFICATION_UNPROVEN` rather than interpreted. This route passes both through
      // untouched — it never builds a question, and it never decides what a label means.
      //
      // The `channel` is deliberately NOT a request field: the ratchet's consent service
      // records `adr-panel` for every consent it mints, because that is the surface that
      // carried the answer. Letting a caller name it would let a caller claim the harness
      // seam delivered a question the panel did.
      result = located.service.settle({
        root: located.root,
        adrId,
        label,
        quiz: quiz === undefined ? null : quiz,
        ids: [adrId],
        askedBy: `adr-panel ${String(session)}`,
      })
    } catch (error) {
      log.warn(`the ratchet's settle threw: ${String(error)}`)
      sendRefusal(res, 500, 'settle-failed', `the ratchet could not record the answer: ${String(error)}`)
      return
    }
    const wrote = Array.isArray(result?.wrote) ? result.wrote.length : 0
    log.info(
      `settle id=${adrId} ok=${String(result?.ok === true)} ratified=${Array.isArray(result?.ratified) ? result.ratified.join(',') : ''} rejected=${Array.isArray(result?.rejected) ? result.rejected.join(',') : ''} wrote=${String(wrote)}`,
    )
    sendJson(res, 200, { ...result, root: located.root })
  }

  return async function handleConsent(req, res) {
    try {
      if (fenced(req, res)) return
      const method = String(req.method ?? '').toUpperCase()
      if (method === 'GET') {
        await onAsk(req, res)
        return
      }
      if (method === 'POST') {
        await onSettle(req, res)
        return
      }
      sendMethodNotAllowed(res)
    } catch (error) {
      // A handler that throws is answered 400 by the webserver, which says nothing about
      // what happened. Every path above answers; this is the last resort, and it still
      // names the failure rather than leaving the browser with an empty response.
      log.warn(`the consent route threw: ${String(error)}`)
      try {
        if (!res.headersSent) sendRefusal(res, 500, 'internal-error', `the ADR panel could not answer: ${String(error)}`)
        else res.end()
      } catch {
        // The socket is already gone; there is nothing left to report to.
      }
    }
  }
}

/**
 * Registers the consent route and publishes the capability token to the browser.
 *
 * @param ctx - The root plugin context.
 * @returns Nothing. Both registrations live inside `ctx.effect` scopes, so a reload
 *   disposes them instead of colliding with the duplicate-route rule.
 */
export function apply(ctx) {
  // Per activation, in memory, never persisted and never logged. Two separate panels
  // would each mint their own; both would serve their own index and their own token.
  const token = randomBytes(32).toString('base64url')
  let logger = null
  try {
    logger = ctx.logger('adr-panel')
  } catch {
    logger = null
  }
  const log = {
    info: (message) => {
      try {
        logger?.info?.(message)
      } catch {
        // Logging must never be the reason a consent fails to be recorded.
      }
    },
    warn: (message) => {
      try {
        logger?.warn?.(message)
      } catch {
        // Same.
      }
    },
  }

  ctx.inject(['webServer'], (web) => {
    // The token reaches the browser as an index global, written by the harness's own
    // renderer before any module runs. It is the ONLY delivery path: the token is in no
    // file, no tool result and no log line, so nothing an agent can call can read it.
    web.effect(
      () =>
        web.on('webserver/index-inject', (table) => {
          table.push({ kind: 'global', name: CONSENT_GLOBAL, value: { route: CONSENT_ROUTE, token } })
        }),
      'adr-panel: publish the consent capability',
    )
    web.effect(
      () =>
        web.webServer.register({
          kind: 'exact',
          path: CONSENT_ROUTE,
          handler: createConsentHandler(ctx, token, log),
        }),
      `adr-panel: GET/POST ${CONSENT_ROUTE}`,
    )
    log.info(`consent route registered at ${CONSENT_ROUTE}`)
  })
}
