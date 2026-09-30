/**
 * PURPOSE
 *   Host half of the ADR panel. It serves ONE capability-fenced route that the panel
 *   window uses to list, read, create, edit and delete a project's SPEC documents.
 *
 *   Specs are plain markdown a human writes. This half is storage and transport only:
 *   it compiles nothing, verifies nothing, mints no consent, records no approval and
 *   keeps no ledger. There is no law, no check, no verdict and no session state here.
 *   The one thing it does beyond moving bytes is refuse to touch a path outside
 *   `<project>/docs/specs`.
 *
 * INPUTS
 *   Composed by the harness as a cordis plugin: `apply(ctx)`. No configuration.
 *   At request time it reaches two services with `ctx.get`, never as a hard dependency:
 *     - `webServer` — the HTTP carrier the route is registered on. Without it this plugin
 *       contributes nothing, because a browser-facing plugin with no web server has
 *       nothing to serve.
 *     - `connection` — the harness's browser trust fence (`requestRejection`). Its
 *       absence REFUSES every request: without it an unauthenticated loopback caller and
 *       a browser are indistinguishable, so serving a write surface would be unsafe.
 *     - `agents` — the live-agent registry, used only to resolve a Session id to the
 *       workspace it was opened on. Its absence is a named refusal, never a guess from
 *       `process.cwd()`, which is where the server was launched rather than the project
 *       the human is looking at.
 *
 *   Route `<SPECS_ROUTE>`, every request carrying the `<SPECS_HEADER>` capability:
 *     GET  ?session=<id>                  -> { ok, project, specs: [{ file, title, status, body }] }
 *     POST { session, file, content }     -> write (create or overwrite) one spec
 *     POST { session, file, remove: true }-> delete one spec
 *
 * OUTPUTS
 *   Registers exactly one HTTP route and one index-injection row, both inside
 *   `ctx.effect` scopes so a reload replaces them rather than colliding. Sends JSON for
 *   every outcome; never throws out of a handler. A refusal is a status code plus a
 *   `{ error, message }` body naming what was refused.
 *
 * KEYWORDS
 *   adr panel, specs, storage, http route, capability token, browser fence, markdown
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `webServer`: no route, no global, boot unaffected.
 *   - No `connection`: every request is refused 503 rather than served.
 *   - Missing or wrong capability header: refused 403 before anything is read or written.
 *   - Unknown or unattributable Session: refused 400; the project root is never guessed
 *     from the process directory.
 *   - `docs/specs` absent: GET answers an empty list, and POST creates the directory.
 *   - A `file` that is not a bare `*.md` name (a separator, `..`, an absolute path, an
 *     empty string): refused 400. The route writes inside `docs/specs` and nowhere else.
 *   - `content` absent on a write: refused 400 rather than writing an empty document,
 *     because an empty spec is indistinguishable from a successful delete.
 *   - A delete naming a file that is not there: answered `{ ok: true, removed: false }`,
 *     which is not an error — the caller's intent already holds.
 *   - Unreadable file during a listing: that one spec is reported with an empty body and
 *     `unreadable: true` rather than dropping the whole listing.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

/** The path the panel calls. */
export const SPECS_ROUTE = '/adr-panel/specs'

/** The capability header every request must carry. */
export const SPECS_HEADER = 'x-adr-panel-specs'

/** The index global carrying the route and this activation's capability token. */
export const SPECS_GLOBAL = '__DSH_ADR_PANEL_SPECS__'

/** The directory, relative to a project root, that specs live in. */
const SPECS_SEGMENTS = ['docs', 'specs']

/** Longest spec body the route will return, so one huge file cannot wedge the window. */
const MAX_BODY_CHARS = 200000

/**
 * A bare markdown filename, and nothing else.
 *
 * The route joins this onto the project's specs directory, so anything that could
 * escape it — a separator, a drive letter, `..`, an empty string — must not match.
 */
const SAFE_FILE = /^[A-Za-z0-9._-]{1,120}\.md$/i

/**
 * Write a JSON response.
 *
 * @param res - The response to own.
 * @param status - HTTP status code.
 * @param body - A JSON-serializable value.
 * @returns Nothing; the response is ended.
 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

/**
 * Compare a presented capability token with this activation's, in constant time.
 *
 * @param presented - The header value, or undefined.
 * @param expected - The token this process minted.
 * @returns Whether they are the same non-empty string.
 */
function tokenMatches(presented, expected) {
  const a = Buffer.from(String(presented ?? ''), 'utf8')
  const b = Buffer.from(String(expected ?? ''), 'utf8')
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Resolve the project root a Session was opened on.
 *
 * @param ctx - The plugin context.
 * @param sessionId - The Session id from the request.
 * @returns `{ root }` on success, or `{ refusal }` with a status, code and message.
 */
function rootFor(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return { refusal: { status: 400, code: 'bad-request', message: 'a session id is required: a project is resolved from the Session it was opened on' } }
  }
  const agents = ctx.get('agents')
  if (agents === undefined || agents === null || typeof agents.get !== 'function') {
    return { refusal: { status: 503, code: 'agents-unavailable', message: 'the agent registry is not mounted, so a Session cannot be resolved to its project' } }
  }
  let cwd = null
  try {
    cwd = agents.get(sessionId)?.session?.header?.cwd ?? null
  } catch {
    cwd = null
  }
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return { refusal: { status: 400, code: 'unknown-session', message: `no live Session ${sessionId}, so its project is unknown` } }
  }
  return { root: resolve(cwd) }
}

/**
 * The specs directory of a project root.
 *
 * @param root - Absolute project root.
 * @returns Absolute path of `<root>/docs/specs`.
 */
function specsDir(root) {
  return join(root, ...SPECS_SEGMENTS)
}

/**
 * List a project's specs, filename order.
 *
 * @param root - Absolute project root.
 * @returns Array of `{ file, title, status, body, unreadable? }`. Empty when the
 *   directory is absent. A file that cannot be read is reported with an empty body and
 *   `unreadable: true` rather than removing it from the listing.
 */
function listSpecs(root) {
  const dir = specsDir(root)
  let names
  try {
    if (!statSync(dir).isDirectory()) return []
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out = []
  for (const name of names.filter((entry) => entry.toLowerCase().endsWith('.md')).sort()) {
    let text = ''
    let unreadable = false
    try {
      text = readFileSync(join(dir, name), 'utf8').replace(/^\uFEFF/, '')
    } catch {
      unreadable = true
    }
    const title = /^---\r?\n[\s\S]*?^title\s*:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, '')
    const status = /^---\r?\n[\s\S]*?^status\s*:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, '')
    out.push({
      file: name,
      title: title && title.length > 0 ? title : name.replace(/\.md$/i, ''),
      status: status && status.length > 0 ? status.toLowerCase() : null,
      body: text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text,
      ...(unreadable ? { unreadable: true } : {}),
    })
  }
  return out
}

/**
 * Read a request body as JSON.
 *
 * @param req - The incoming request.
 * @returns The parsed object, or `{ bad: true }` when it is not a JSON object. Never throws.
 */
async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    const parsed = JSON.parse(text === '' ? '{}' : text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { bad: true }
    return parsed
  } catch {
    return { bad: true }
  }
}

/**
 * Build the route handler.
 *
 * Gate order is the design: the browser fence first, then the capability token, then
 * anything that reads or writes. Each refusal names itself and none of them touches disk.
 *
 * @param ctx - The plugin context.
 * @param token - This activation's capability token.
 * @param log - A `{ info, warn }` sink; never given the token.
 * @returns A `(req, res) => Promise<void>` handler.
 */
export function createSpecsHandler(ctx, token, log) {
  return async function handleSpecs(req, res) {
    const connection = ctx.get('connection')
    if (connection === undefined || connection === null || typeof connection.requestRejection !== 'function') {
      log.warn('refused specs: no connection service to authenticate a browser')
      sendJson(res, 503, { error: 'unavailable', message: 'the panel cannot authenticate a browser in this composition' })
      return
    }
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) {
      log.warn(`refused specs by the browser trust fence with ${String(rejection)}`)
      res.statusCode = rejection
      res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
      return
    }
    if (!tokenMatches(req.headers?.[SPECS_HEADER], token)) {
      log.warn('refused specs: no capability token, or a wrong one')
      sendJson(res, 403, { error: 'forbidden', message: `the ${SPECS_HEADER} header must carry the token from ${SPECS_GLOBAL}` })
      return
    }

    let method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', 'http://localhost')
    let body = {}
    if (method === 'POST') {
      body = await readJson(req)
      if (body.bad === true) {
        sendJson(res, 400, { error: 'bad-request', message: 'the body must be a JSON object' })
        return
      }
    }
    const sessionId = method === 'POST' ? body.session : url.searchParams.get('session')
    const resolved = rootFor(ctx, sessionId)
    if (resolved.refusal !== undefined) {
      sendJson(res, resolved.refusal.status, { error: resolved.refusal.code, message: resolved.refusal.message })
      return
    }
    const root = resolved.root

    if (method === 'GET') {
      sendJson(res, 200, { ok: true, project: root, specs: listSpecs(root) })
      return
    }
    if (method !== 'POST') {
      sendJson(res, 405, { error: 'method-not-allowed', message: 'GET lists specs, POST writes or removes one' })
      return
    }

    const file = body.file
    if (typeof file !== 'string' || !SAFE_FILE.test(file)) {
      sendJson(res, 400, { error: 'bad-request', message: 'file must be a bare markdown filename (letters, digits, dot, dash, underscore, ending .md)' })
      return
    }
    const target = join(specsDir(root), basename(file))

    if (body.remove === true) {
      if (!existsSync(target)) {
        sendJson(res, 200, { ok: true, removed: false, file })
        return
      }
      try {
        unlinkSync(target)
      } catch (error) {
        sendJson(res, 500, { error: 'delete-failed', message: `could not delete ${file}: ${error.message}` })
        return
      }
      log.info(`removed spec ${file}`)
      sendJson(res, 200, { ok: true, removed: true, file })
      return
    }

    if (typeof body.content !== 'string' || body.content.trim().length === 0) {
      sendJson(res, 400, { error: 'bad-request', message: 'content must be a non-empty string' })
      return
    }
    try {
      mkdirSync(specsDir(root), { recursive: true })
      writeFileSync(target, body.content, 'utf8')
    } catch (error) {
      sendJson(res, 500, { error: 'write-failed', message: `could not write ${file}: ${error.message}` })
      return
    }
    log.info(`wrote spec ${file}`)
    sendJson(res, 200, { ok: true, file, bytes: Buffer.byteLength(body.content, 'utf8') })
  }
}

/**
 * Install the specs route and publish its capability.
 *
 * @param ctx - Cordis context; `webServer` is requested rather than read, so a
 *   composition that mounts it on a later turn still registers the route.
 * @returns Nothing.
 */
export function apply(ctx) {
  const token = randomBytes(32).toString('base64url')
  const log = {
    info: (message) => {
      try {
        ctx.logger?.info?.(message)
      } catch {
        // Logging must never be the reason a route is missing.
      }
    },
    warn: (message) => {
      try {
        ctx.logger?.warn?.(message)
      } catch {
        // Same.
      }
    },
  }
  ctx.inject(['webServer'], (web) => {
    web.effect(
      () =>
        web.on('webserver/index-inject', (table) => {
          table.push({ kind: 'global', name: SPECS_GLOBAL, value: { route: SPECS_ROUTE, header: SPECS_HEADER, token } })
        }),
      'adr-panel: publish the specs capability',
    )
    web.effect(
      () =>
        web.webServer.register({
          kind: 'exact',
          path: SPECS_ROUTE,
          handler: createSpecsHandler(ctx, token, log),
        }),
      `adr-panel: GET/POST ${SPECS_ROUTE}`,
    )
    log.info(`specs route registered at ${SPECS_ROUTE}`)
  })
}
