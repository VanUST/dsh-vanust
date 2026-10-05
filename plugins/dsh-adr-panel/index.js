/**
 * PURPOSE
 *   Host half of the ADR panel. It serves ONE capability-fenced route that the panel
 *   window uses to list, read, create, edit and delete SPEC items in either of the two
 *   scopes the prompt is built from: the GLOBAL items under `<harness home>/specs` and the
 *   LOCAL items under `<project>/docs/specs`.
 *
 *   Scope is named, never pathed: a request says `global` or `local` and the host resolves
 *   the directory itself. The global directory comes from the environment the server was
 *   started with, so a Session cannot point it at a directory of its choosing - which would
 *   let one project write into every other project's prompt.
 *
 *   Specs are plain markdown a human writes. This half is storage and transport only:
 *   it compiles nothing, verifies nothing, mints no consent, records no approval and
 *   keeps no ledger. There is no law, no check, no verdict and no session state here.
 *   The two things it does beyond moving bytes are refuse to touch a path outside the
 *   chosen scope's directory, and report which items the loader will REFUSE, because an
 *   item that saves cleanly and then reaches no prompt is invisible on disk.
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
 *     GET  ?session=<id>&scope=global|local
 *          -> { ok, scope, project, dir, specs: [{ file, title, status, slot, order, scope, body }] }
 *     GET  ?session=<id>&catalogue=1
 *          -> { ok, project, home, global, local, effective, problems } - every ACTIVE item
 *             from both scopes in render order, excluding the ones the loader refuses, with
 *             each refusal named.
 *     POST { session, scope, file, content }        -> write (create or overwrite) one item
 *     POST { session, scope, file, remove: true }   -> delete one item
 *     POST { session, scope, files: [{ file, content }] }
 *          -> write a BATCH. Every entry is validated before any is written, so one bad
 *             name cannot leave half a save on disk while the caller believes it failed.
 *
 * OUTPUTS
 *   Registers exactly one HTTP route and one index-injection row, both inside
 *   `ctx.effect` scopes so a reload replaces them rather than colliding. Sends JSON for
 *   every outcome; never throws out of a handler. A refusal is a status code plus a
 *   `{ error, message }` body naming what was refused.
 *
 * KEYWORDS
 *   adr panel, specs, storage, http route, capability token, browser fence, markdown,
 *   global scope, local scope, batch write, effective catalogue
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `webServer`: no route, no global, boot unaffected.
 *   - No `connection`: every request is refused 503 rather than served.
 *   - Missing or wrong capability header: refused 403 before anything is read or written.
 *   - Unknown or unattributable Session: refused 400; the project root is never guessed
 *     from the process directory.
 *   - `docs/specs` absent: GET answers an empty list, and POST creates the directory.
 *   - A `file` that is not a bare `*.md` name (a separator, `..`, an absolute path, an
 *     empty string): refused 400. The route writes inside the chosen scope's directory and
 *     nowhere else.
 *   - A `scope` other than `global` (or absent): `local`, because a project's own items are
 *     the ones a Session's window usually edits and the safer default of the two.
 *   - A batch with one invalid entry: refused 400 with NOTHING written.
 *   - A batch whose write fails midway: the error names the entries already written, so a
 *     partial save is stated rather than implied.
 *   - `$DSH_HOME` unset: the global scope falls back to the harness default home rather
 *     than to the process directory, so a write cannot land beside the server's launch dir.
 *   - `content` absent on a write: refused 400 rather than writing an empty document,
 *     because an empty spec is indistinguishable from a successful delete.
 *   - A delete naming a file that is not there: answered `{ ok: true, removed: false }`,
 *     which is not an error — the caller's intent already holds.
 *   - Unreadable file during a listing: that one spec is reported with an empty body and
 *     `unreadable: true` rather than dropping the whole listing.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

/** The path the panel calls. */
export const SPECS_ROUTE = '/adr-panel/specs'

/** The capability header every request must carry. */
export const SPECS_HEADER = 'x-adr-panel-specs'

/** The index global carrying the route and this activation's capability token. */
export const SPECS_GLOBAL = '__DSH_ADR_PANEL_SPECS__'

/** The directory, relative to a project root, that LOCAL specs live in. */
const SPECS_SEGMENTS = ['docs', 'specs']

/**
 * The two scopes the window reads and writes.
 *
 * `global` items live under the harness home and reach every agent on this machine;
 * `local` items live under the Session's own project and reach only that project's
 * agents. The scope is a property of the DIRECTORY, which is why this route takes a
 * scope name rather than a path: a request cannot name a directory at all.
 */
export const SPECS_SCOPES = ['global', 'local']

/**
 * The slots only a GLOBAL item may fill.
 *
 * Mirrors `SLOTS` in `@cc/dsh-specs`'s catalogue module, which REFUSES a local item that
 * names one of them. The panel does not enforce anything - it reports what the loader will
 * do - and `scripts/check-portability.mjs` fails when this list and the catalogue's
 * `authors` disagree, so the copy cannot drift in silence.
 */
export const GLOBAL_ONLY_SLOTS = ['identity', 'persona-prefix', 'rules', 'machine', 'persona-suffix']

/** The slot an item lands in when its frontmatter names none. */
const DEFAULT_SLOT = 'items'

/** Every slot the loader knows, used to tell "no slot" from "an unknown one". */
const ALL_SLOTS = [...GLOBAL_ONLY_SLOTS, DEFAULT_SLOT]

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
 * The harness home this process was started with.
 *
 * Derived from the environment, never from the request: a Session must not be able to
 * point the GLOBAL scope at a directory of its choosing, which would let a project write
 * into every other project's prompt. The fallback is the harness's own default home,
 * matching the catalogue module's.
 *
 * @returns Absolute path of the harness home.
 */
function harnessHome() {
  const fromEnv = process.env.DSH_HOME
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? resolve(fromEnv) : join(homedir(), '.dsh')
}

/**
 * The directory one scope reads and writes.
 *
 * @param scope - `global` or `local`.
 * @param root - The Session's project root; unused by the global scope.
 * @returns Absolute directory path.
 */
function scopeDir(scope, root) {
  return scope === 'global' ? join(harnessHome(), 'specs') : specsDir(root)
}

/**
 * Read one frontmatter field from a spec document.
 *
 * @param text - File contents.
 * @param key - The field name, e.g. `slot`.
 * @returns The trimmed value, or null when the frontmatter has no such field.
 */
function frontmatterField(text, key) {
  const pattern = new RegExp(`^---\\r?\\n[\\s\\S]*?^${key}\\s*:\\s*(.+)$`, 'm')
  const value = pattern.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, '')
  return value !== undefined && value.length > 0 ? value : null
}

/**
 * List one scope's specs, filename order, with the frontmatter the window shows.
 *
 * @param dir - Absolute scope directory.
 * @param scope - `global` or `local`, echoed onto every item so the window can badge it.
 * @returns Array of `{ file, title, status, slot, order, scope, body, unreadable? }`.
 *   Empty when the directory is absent. A file that cannot be read is reported with an
 *   empty body and `unreadable: true` rather than being removed from the listing.
 */
function listSpecs(dir, scope) {
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
    const text2 = text
    const rawSlot = frontmatterField(text2, 'slot')
    const title = frontmatterField(text2, 'title')
    const status = frontmatterField(text2, 'status')
    const order = Number(frontmatterField(text2, 'order'))
    out.push({
      file: name,
      title: title ?? name.replace(/\.md$/i, ''),
      status: status === null ? null : status.toLowerCase(),
      slot: rawSlot ?? DEFAULT_SLOT,
      order: Number.isFinite(order) ? order : 0,
      scope,
      body: text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text,
      ...(unreadable ? { unreadable: true } : {}),
    })
  }
  return out
}

/**
 * The items a human should know will NOT reach the prompt, with the reason.
 *
 * The loader is the enforcer and this is its mirror: an item whose slot is unknown, or
 * whose scope may not fill that slot, is refused by `@cc/dsh-specs`. Reporting it here is
 * what keeps a refusal visible in the window instead of looking like a saved requirement
 * that silently does nothing.
 *
 * @param specs - Items from {@link listSpecs}.
 * @returns Array of `{ file, scope, why }`.
 */
function problemsFor(specs) {
  const out = []
  for (const spec of specs) {
    if (!ALL_SLOTS.includes(spec.slot)) {
      out.push({ file: spec.file, scope: spec.scope, why: `unknown slot "${spec.slot}"` })
      continue
    }
    if (spec.scope === 'local' && GLOBAL_ONLY_SLOTS.includes(spec.slot)) {
      out.push({
        file: spec.file,
        scope: spec.scope,
        why: `a local spec may not fill the "${spec.slot}" slot; it will not reach the prompt`,
      })
    }
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
      if (url.searchParams.get('catalogue') === '1') {
        // The effective view: what the prompt will carry, from BOTH scopes, in the order
        // the loader sorts it, plus what that loader will refuse. One request, because a
        // window that fetched the scopes separately could show a half-updated picture.
        const globalSpecs = listSpecs(scopeDir('global', root), 'global')
        const localSpecs = listSpecs(scopeDir('local', root), 'local')
        const order = { identity: 0, 'persona-prefix': 1, rules: 2, machine: 3, 'persona-suffix': 4, items: 5 }
        // The problems are computed FIRST, because an item the loader will refuse is not
        // effective: listing it here would show a human a requirement that reaches no
        // prompt, which is the failure this view exists to make impossible.
        const problems = problemsFor(globalSpecs).concat(problemsFor(localSpecs))
        const refused = new Set(problems.map((problem) => `${problem.scope}/${problem.file}`))
        const effective = globalSpecs
          .concat(localSpecs)
          .filter((spec) => (spec.status === null || spec.status === 'active') && !refused.has(`${spec.scope}/${spec.file}`))
          .sort((a, b) => (order[a.slot] ?? 9) - (order[b.slot] ?? 9) || a.order - b.order || (a.file < b.file ? -1 : 1))
          .map((spec) => ({
            file: spec.file,
            scope: spec.scope,
            slot: spec.slot,
            title: spec.title,
            status: spec.status,
            chars: spec.body.length,
          }))
        sendJson(res, 200, {
          ok: true,
          project: root,
          home: harnessHome(),
          global: { dir: scopeDir('global', root), specs: globalSpecs },
          local: { dir: scopeDir('local', root), specs: localSpecs },
          effective,
          problems,
        })
        return
      }
      const scope = url.searchParams.get('scope') === 'global' ? 'global' : 'local'
      const dir = scopeDir(scope, root)
      sendJson(res, 200, { ok: true, scope, project: root, dir, specs: listSpecs(dir, scope) })
      return
    }
    if (method !== 'POST') {
      sendJson(res, 405, { error: 'method-not-allowed', message: 'GET lists a scope or the effective catalogue, POST writes, batch-writes or removes items' })
      return
    }

    const scope = body.scope === 'global' ? 'global' : 'local'
    const dir = scopeDir(scope, root)

    // ── batch write ─────────────────────────────────────────────────────────
    // Validate EVERY entry before writing ANY: a batch is what the window sends when a
    // human saves several items at once, and a name error in the third one must not leave
    // the first two written and the human believing all three landed.
    if (Array.isArray(body.files)) {
      if (body.files.length === 0) {
        sendJson(res, 400, { error: 'bad-request', message: 'files must not be empty' })
        return
      }
      const entries = []
      for (const entry of body.files) {
        const name = entry?.file
        const content = entry?.content
        if (typeof name !== 'string' || !SAFE_FILE.test(name)) {
          sendJson(res, 400, { error: 'bad-request', message: `files[].file must be a bare markdown filename; got ${JSON.stringify(name)}` })
          return
        }
        if (typeof content !== 'string' || content.trim().length === 0) {
          sendJson(res, 400, { error: 'bad-request', message: `files[${name}].content must be a non-empty string` })
          return
        }
        entries.push({ name, content })
      }
      const written = []
      try {
        mkdirSync(dir, { recursive: true })
        for (const entry of entries) {
          writeFileSync(join(dir, basename(entry.name)), entry.content, 'utf8')
          written.push(entry.name)
        }
      } catch (error) {
        log.warn(`batch write failed after ${written.length} item(s): ${String(error)}`)
        sendJson(res, 500, { error: 'write-failed', message: `could not write ${written.length + 1} of ${entries.length}: ${error.message}`, written, scope })
        return
      }
      log.info(`wrote ${written.length} ${scope} spec(s) in one batch`)
      sendJson(res, 200, { ok: true, scope, written })
      return
    }

    const file = body.file
    if (typeof file !== 'string' || !SAFE_FILE.test(file)) {
      sendJson(res, 400, { error: 'bad-request', message: 'file must be a bare markdown filename (letters, digits, dot, dash, underscore, ending .md)' })
      return
    }
    const target = join(dir, basename(file))

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
      log.info(`removed ${scope} spec ${file}`)
      sendJson(res, 200, { ok: true, removed: true, file })
      return
    }

    if (typeof body.content !== 'string' || body.content.trim().length === 0) {
      sendJson(res, 400, { error: 'bad-request', message: 'content must be a non-empty string' })
      return
    }
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(target, body.content, 'utf8')
    } catch (error) {
      sendJson(res, 500, { error: 'write-failed', message: `could not write ${file}: ${error.message}` })
      return
    }
    log.info(`wrote ${scope} spec ${file}`)
    sendJson(res, 200, { ok: true, scope, file, bytes: Buffer.byteLength(body.content, 'utf8') })
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
