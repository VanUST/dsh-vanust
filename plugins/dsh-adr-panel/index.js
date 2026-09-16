/**
 * PURPOSE
 *   Host half of the ADR panel plugin. It serves the routes the panel window needs:
 *   `GET /adr-panel/state` is the window's ONE data path — the ratchet's own view model
 *   of a project's decisions, consents, compiled laws and spec hash — and
 *   `GET`/`POST /adr-panel/consent` records a human's Approve or Decline without a chat
 *   message and without an agent in the loop.
 *
 *   It is a thin adapter on purpose. It derives no decision state: the state route calls
 *   the ratchet's `ratchetDecisions` service, which is the one implementation of force,
 *   consent matching and the ratify queue, and which derives off the event loop and caps
 *   what it returns. It constructs no question, interprets no answer and writes no
 *   artifact: the consent route calls the ratchet's `ratchetConsent` service, which calls
 *   the same `ratify` operation the `ratchet_ratify` tool and the `/ratify` command call.
 *   A `GET` on that route therefore has exactly one durable effect — `ratify`'s prepare
 *   path appends one audit event to the ledger — and no approval or transcript. Everything
 *   this file owns is the transport and the fence in front of it.
 *
 * INPUTS
 *   Composed by the harness as a cordis plugin: `apply(ctx)` receives the root context.
 *   It requires no configuration. At request time it needs two services, reachable with
 *   `ctx.get` and never injected as a hard dependency:
 *     - `webServer` — the HTTP carrier the routes are registered on. Without it this
 *       plugin contributes nothing and the boot is unaffected, because a browser-facing
 *       plugin mounted in a composition with no web server has nothing to serve.
 *     - `connection` — the harness's browser trust fence (`requestRejection`). Its
 *       absence refuses every request: a route that cannot authenticate a browser must
 *       not act on one.
 *     - `ratchetConsent` — the ratchet's consent service. Its absence is a refusal with
 *       a named reason, never a fallback that mints something itself.
 *     - `ratchetDecisions` — the ratchet's decisions service. Its absence is a refusal
 *       naming it, never a fallback that derives a second view.
 *
 *   The routes are `<CONSENT_ROUTE>` and `<STATE_ROUTE>`:
 *     GET  <STATE_ROUTE>?session=<session-id>    → the ratchet's whole view model
 *     GET  <CONSENT_ROUTE>?session=<id>&id=<adr-id> → the ratchet's question; only the
 *       ratchet's own audit line is appended (see OUTPUTS), never an approval/transcript
 *     POST <CONSENT_ROUTE> { session, adrId, label, quiz } → the ratchet's verdict and artifact
 *   Each carries its own capability header ({@link CONSENT_HEADER}, {@link STATE_HEADER}).
 *
 * OUTPUTS
 *   Registers exactly two HTTP routes and one index-injection row, all inside
 *   `ctx.effect` scopes so a reload replaces them rather than colliding. It never
 *   throws out of a handler: every failure is a status code and a JSON body naming what
 *   was refused. It writes no artifact of its own. Two durable writes happen under it,
 *   and neither is this file's:
 *     - a `GET` consent request asks the ratchet for its question, and the ratchet's
 *       `ratify` prepare path appends exactly one audit event to
 *       `.dsh/ratchet/ledger.jsonl`. That is the whole durable effect of a GET: no
 *       approval ADR and no transcript is written, and the corpus is not touched. The
 *       route's own claim is therefore "a GET writes an audit line only, never a
 *       consent artifact", never the older "a GET writes nothing".
 *     - a `POST` that approves writes the approval ADR and its transcript, through the
 *       ratchet inside the `ratchetConsent` call.
 *
 *   Responses are `application/json` with `cache-control: no-store`, because every one
 *   of them is a live fact about a project:
 *     - 200 `{ ok, root, ...ratifyResult }` — the ratchet answered. `ok` is the
 *       ratchet's own verdict, so a refusal (`RATIFICATION_UNPROVEN`, nothing waiting,
 *       unreadable answer) arrives as 200 with `ok:false` and its `problems`, which is
 *       not the same thing as the request being malformed.
 *     - 200 `<view model>` — the ratchet's decision view, CAPPED. The view carries a
 *       `truncated` member that is null when it is whole and otherwise names what the
 *       cap dropped (record count, spec count, record bodies, spec bodies, queue
 *       copies), so a partial answer says so rather than reading as the whole corpus.
 *     - 400 `bad-request` — malformed query, body, media type or a missing field.
 *     - 401/403 — the browser trust fence, or a missing/wrong capability header.
 *     - 404 `unknown-session` / `no-project` — the Session is unknown, or no
 *       `.dsh/project.json` was found at or above its workspace.
 *     - 405 — a method the route does not accept (state is GET only).
 *     - 408 `request-timeout` — a `POST` body that did not arrive within
 *       {@link BODY_READ_TIMEOUT_MS}; the request is destroyed rather than held open.
 *     - 503 `consent-unavailable` / `state-unavailable` — the named service is not
 *       mounted, so no question can be built and no consent recorded, or no view derived.
 *
 * KEYWORDS
 *   host route, webServer, browser trust fence, capability token, index injection,
 *   ratification transport, consent service, decisions service, view model, adr panel,
 *   no composed answer, one source of truth
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `webServer` service ever appears: the plugin activates and does nothing, so a
 *     composition without a browser is unaffected.
 *   - No `connection` service: every request is refused with 503 and nothing is written.
 *     Failing closed is the only safe direction — the fence is what makes the routes
 *     unreachable by a non-browser caller.
 *   - No `ratchetConsent`/`ratchetDecisions` service: 503 with the service name, and
 *     nothing is written or derived.
 *   - Session id missing, empty, or naming no session the harness knows: 400/404, and
 *     the project root is never guessed from the server's launch directory.
 *   - The Session's workspace has no `.dsh/project.json` at or above it: 404 naming the
 *     workspace, because a route that fell back to another project would answer about
 *     decisions the human is not looking at.
 *   - A request body larger than {@link MAX_BODY_BYTES}: 413, stream drained, nothing
 *     parsed and nothing written.
 *   - A request body that does not complete within {@link BODY_READ_TIMEOUT_MS}: 408
 *     `request-timeout` and the request is destroyed, so a partial or never-ending body
 *     cannot hold the route (and its socket) open until Node's own default.
 *   - A body that is not JSON, or lacks `adrId`/`label`: 400; the ratchet is not called.
 *   - A `quiz` that is absent, foreign, or stale: the ratchet refuses, and the only
 *     durable effect is the audit event `ratify` appends for the attempt. This route
 *     deliberately does not re-implement any part of that check.
 *   - A wrong or missing capability header: 403 before the ratchet is reached, so a
 *     caller that has not been served this process's index cannot even build a question.
 *   - The state route's service rejects (its worker failed, or the derivation threw):
 *     500 `state-failed`, and the window says state is unavailable rather than falling
 *     back to a local derivation.
 *   - The corpus is larger than the ratchet's cap: the view arrives with `truncated`
 *     naming what was cut, and the window says so; the route does not grow the response.
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

/**
 * The route the window reads a project's whole decision state from.
 *
 * A second route rather than a parameter on the consent one: the consent route accepts a
 * POST that can write a durable record, while this route is read-only by construction. A
 * literal for the same reason as {@link CONSENT_ROUTE}, and asserted equal to the
 * bundle's copy by `scripts/check-consent-surface.mjs`.
 */
export const STATE_ROUTE = '/adr-panel/state'

/**
 * The name of the cordis service the ratchet provides for the decision view.
 *
 * Duplicated from `@cc/dsh-ratchet`'s `DECISIONS_SERVICE` for the same reason as
 * {@link CONSENT_SERVICE}, and asserted equal by the same check.
 */
export const STATE_SERVICE = 'ratchetDecisions'

/** The header the browser half sends the state capability token in. */
export const STATE_HEADER = 'x-adr-panel-state'

/**
 * The global the browser half reads the state route and its token from.
 *
 * A separate global from {@link CONSENT_GLOBAL} on purpose: it makes the read-only
 * surface and the consent surface separately observable, so the surface check can assert
 * the panel, the host and the ratchet agree on all four values of each. The token is the
 * same per-activation secret, published only through the served index.
 */
export const STATE_GLOBAL = '__DSH_ADR_PANEL_STATE__'

/** One request body is a question and two short strings; anything larger is hostile. */
const MAX_BODY_BYTES = 256 * 1024

/**
 * How long a `POST` body may take to arrive before the route gives up on it. A caller that
 * opens a socket, sends `content-type: application/json` and then sends a partial body (or
 * nothing) would otherwise hold the request open until Node's own request timeout, which is
 * minutes. Bounded here so the transport cannot be pinned by an unfinished write.
 *
 * Exported because a test drives the real route with a body that never ends: it reads this
 * value to know how long the refusal may take, rather than hard-coding a second copy.
 */
export const BODY_READ_TIMEOUT_MS = 3000

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
 * Sends 408 for a body that did not arrive, then destroys the request once the refusal
 * has been flushed.
 *
 * The destroy is deferred to the response's own `finish` (and repeated on `close`) rather
 * than called immediately: destroying the IncomingMessage first would tear down the socket
 * before the 408 could be written, so the caller would see a reset instead of the reason.
 * A response object with no event API is destroyed immediately, because there is no flush
 * to wait for and leaving the socket open is the failure this exists to prevent.
 *
 * @param req - The Node request.
 * @param res - The Node response.
 * @returns Nothing.
 */
function destroyRequestAfterResponse(req, res) {
  const destroy = () => {
    try {
      req.destroy()
    } catch {
      // The socket is already gone; the refusal was already written.
    }
  }
  if (typeof res.once === 'function') {
    res.once('finish', destroy)
    res.once('close', destroy)
    return
  }
  destroy()
}

/**
 * Collects a bounded request body as UTF-8 text within a deadline.
 *
 * @param req - The Node request.
 * @returns `{ text }`; `{ tooLarge: true }` past {@link MAX_BODY_BYTES}, in which case the
 *   stream is drained so the socket is reusable and the caller answers 413; or
 *   `{ timedOut: true }` when the body did not complete within
 *   {@link BODY_READ_TIMEOUT_MS}. On a timeout the read is abandoned and its eventual
 *   rejection is observed here, so the caller can answer 408 rather than hang.
 */
async function readBoundedBody(req) {
  const chunks = []
  let size = 0
  const read = (async () => {
    for await (const chunk of req) {
      size += chunk.byteLength
      if (size > MAX_BODY_BYTES) {
        req.resume()
        return { tooLarge: true }
      }
      chunks.push(chunk)
    }
    return { text: Buffer.concat(chunks, size).toString('utf8') }
  })()
  let timer = null
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), BODY_READ_TIMEOUT_MS)
    timer.unref?.()
  })
  const result = await Promise.race([read, deadline])
  if (timer !== null) clearTimeout(timer)
  if (result.timedOut === true) {
    // The abandoned read rejects once the caller destroys the request; observing it here
    // keeps that from surfacing as an unhandled rejection.
    read.catch(() => {})
    return { timedOut: true }
  }
  return result
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
 * Builds the browser-fence gate shared by both routes.
 *
 * The order of the gates is the design: the browser fence first (a request that is not
 * from an authenticated browser of this host never reaches the ratchet), then the
 * capability token (a request that was not served this process's index never reads a
 * decision and never builds a question). Each refusal names itself, and none of them
 * writes anything.
 *
 * @param ctx - The plugin context.
 * @param token - This activation's capability token.
 * @param header - The capability header this route requires.
 * @param label - A short noun for the log line and the refusal, e.g. `consent`.
 * @param log - A `{ info, warn }` sink; never given the token.
 * @returns A `(req, res) => boolean` that returns true when it refused and ended the response.
 */
function createFence(ctx, token, header, label, log) {
  return function fenced(req, res) {
    const connection = ctx.get('connection')
    if (connection === undefined || connection === null || typeof connection.requestRejection !== 'function') {
      // No fence, no route. An unauthenticated loopback caller and a browser are
      // indistinguishable without it, so the safe answer is to refuse rather than to
      // serve a decision surface to whoever is on the machine.
      log.warn(`refused ${label}: the connection service is not available to authenticate a browser`)
      sendRefusal(res, 503, 'consent-unavailable', 'the ADR panel cannot authenticate a browser in this composition, so no decision can be served or recorded through it')
      return true
    }
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) {
      log.warn(`refused ${label} by the browser trust fence with ${String(rejection)}`)
      res.statusCode = rejection
      res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
      return true
    }
    if (!tokenMatches(req.headers?.[header], token)) {
      log.warn(`refused ${label}: no capability token, or a wrong one`)
      sendRefusal(res, 403, 'forbidden', `this route acts only for the ADR panel this process served: the ${header} header must carry the token from ${CONSENT_GLOBAL}`)
      return true
    }
    return false
  }
}

/**
 * Resolves one Session's workspace to a project root, through a named ratchet service.
 *
 * The Session is the ONLY source of the project root. `process.cwd()` is where the
 * server was launched, which is a home or application directory rather than the project
 * a human is looking at, and answering about that project would be the worst possible
 * failure for a consent or a state surface.
 *
 * @param ctx - The plugin context.
 * @param sessionId - The Session id from the request.
 * @param requirement - `{ serviceName, valid(service), unavailable }` describing the one
 *   service this route needs and the refusal message when it is not mounted.
 * @returns `{ service, root }`, or `{ refusal: { status, code, message } }`. Never throws.
 */
async function resolveProject(ctx, sessionId, requirement) {
  const service = ctx.get(requirement.serviceName)
  if (service === undefined || service === null || !requirement.valid(service)) {
    return {
      refusal: {
        status: 503,
        code: requirement.code,
        message: requirement.unavailable,
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
  if (typeof service.rootFor !== 'function') {
    return {
      refusal: {
        status: 503,
        code: requirement.code,
        message: `the ${requirement.serviceName} service exposes no root resolver, so the project root cannot be resolved from the Session`,
      },
    }
  }
  const root = service.rootFor(workspace.cwd)
  if (root === null || root === undefined) {
    return { refusal: { status: 404, code: 'no-project', message: `Session "${sessionId}" is at "${workspace.cwd}", which has no .dsh/project.json at or above it` } }
  }
  return { service, root }
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
  const fenced = createFence(ctx, token, CONSENT_HEADER, 'consent', log)
  const consentRequirement = {
    serviceName: CONSENT_SERVICE,
    code: 'consent-unavailable',
    valid: (service) => typeof service.ask === 'function' && typeof service.settle === 'function',
    unavailable: `no ${CONSENT_SERVICE} service is mounted, so the ratchet cannot be asked anything: mount @cc/dsh-ratchet beside this plugin`,
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
    const located = await resolveProject(ctx, query.get("session"), consentRequirement)
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
    if (body.timedOut === true) {
      // The destroy handler is registered BEFORE the response is written: it runs on the
      // response's own `finish`, and `res.end` fires that synchronously in a test double,
      // so registering afterwards would miss it and leave the socket open.
      destroyRequestAfterResponse(req, res)
      sendRefusal(res, 408, 'request-timeout', `the request body was not received within ${String(BODY_READ_TIMEOUT_MS)} ms, so the route gave up on it and destroyed the request`)
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
    const located = await resolveProject(ctx, session, consentRequirement)
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
 * Builds the handler for the one READ-ONLY state route.
 *
 * It is the browser half's single data path: the window renders what the ratchet's
 * `ratchetDecisions` service derived and derives nothing itself. The route answers GET
 * only — there is no method here that could write — and every failure is a status code
 * and a JSON body naming what was refused. The gates are the consent route's: the
 * browser trust fence, then this route's own capability header, then the Session's
 * project, then the service. A window that cannot reach it is told so; it must never
 * fall back to reading the corpus itself, because a second derivation of one truth is the
 * defect this route exists to remove.
 *
 * @param ctx - The plugin context.
 * @param token - This activation's capability token.
 * @param log - A `{ info, warn }` sink; never given the token.
 * @returns An async `(req, res)` handler that never throws.
 */
function createStateHandler(ctx, token, log) {
  const fenced = createFence(ctx, token, STATE_HEADER, 'state', log)
  const stateRequirement = {
    serviceName: STATE_SERVICE,
    code: 'state-unavailable',
    valid: (service) => typeof service.view === 'function',
    unavailable: `no ${STATE_SERVICE} service is mounted, so the ratchet cannot derive a decision view: mount @cc/dsh-ratchet beside this plugin`,
  }

  return async function handleState(req, res) {
    try {
      if (fenced(req, res)) return
      if (String(req.method ?? '').toUpperCase() !== 'GET') {
        res.statusCode = 405
        res.setHeader('allow', 'GET')
        res.end()
        return
      }
      let query
      try {
        query = new URL(String(req.url), 'http://localhost').searchParams
      } catch {
        sendRefusal(res, 400, 'bad-request', 'the query string could not be read')
        return
      }
      const located = await resolveProject(ctx, query.get('session'), stateRequirement)
      if (located.refusal !== undefined) {
        sendRefusal(res, located.refusal.status, located.refusal.code, located.refusal.message)
        return
      }
      let view
      try {
        // The service is async on purpose: it derives a cache miss on a worker thread and
        // returns the cached, capped view on a hit, so this `await` is what keeps the
        // event loop free while a corpus is parsed.
        view = await located.service.view({ root: located.root })
      } catch (error) {
        log.warn(`the ratchet's view threw: ${String(error)}`)
        sendRefusal(res, 500, 'state-failed', `the ratchet could not derive the decision view: ${String(error)}`)
        return
      }
      log.info(
        `state root=${located.root} records=${Array.isArray(view?.records) ? view.records.length : 0} waiting=${Array.isArray(view?.queue?.pending) ? view.queue.pending.length : 0} blocked=${Array.isArray(view?.queue?.blocked) ? view.queue.blocked.length : 0} truncated=${view?.truncated === null || view?.truncated === undefined ? 'no' : 'yes'}`,
      )
      sendJson(res, 200, view)
    } catch (error) {
      log.warn(`the state route threw: ${String(error)}`)
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
 * Registers the consent route, the state route and the capability token they share.
 *
 * @param ctx - The root plugin context.
 * @returns Nothing. Every registration lives inside a `ctx.effect` scope, so a reload
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
          table.push({ kind: 'global', name: STATE_GLOBAL, value: { route: STATE_ROUTE, token } })
        }),
      'adr-panel: publish the consent and state capabilities',
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
    web.effect(
      () =>
        web.webServer.register({
          kind: 'exact',
          path: STATE_ROUTE,
          handler: createStateHandler(ctx, token, log),
        }),
      `adr-panel: GET ${STATE_ROUTE}`,
    )
    log.info(`consent route registered at ${CONSENT_ROUTE}`)
    log.info(`state route registered at ${STATE_ROUTE}`)
  })
}
