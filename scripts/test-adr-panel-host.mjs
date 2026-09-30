/**
 * PURPOSE
 *   Drive the SHIPPED host half of the ADR panel (`plugins/dsh-adr-panel/index.js`) through its
 *   real route handler and assert the observable storage contract: a capability-fenced GET
 *   lists a project's specs, a POST creates, overwrites and deletes them on disk, and every
 *   refusal (a wrong capability, a path outside `docs/specs`, an empty body, an unknown Session,
 *   a missing browser fence) writes nothing.
 *
 *   This half had NO test at all before this file. The panel's own render test stubs `fetch`, so
 *   a host route that refused every write would have passed every other check in the kit while
 *   the Create button did nothing — which is exactly the failure this file exists to catch.
 *
 * INPUTS
 *   None. The harness context is a stub; the project is a throwaway directory.
 *
 * OUTPUTS
 *   Prints one `[ok]`/`[FAIL]` line per claim and exits 0 only when every claim holds. Every
 *   assertion is about a status code, a response body, or bytes on disk.
 *
 * KEYWORDS
 *   adr panel, host route, specs, capability fence, path traversal, storage, behavioural
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The `connection` service absent: every request is refused 503, because without the browser
 *     fence an unauthenticated local caller and a browser are indistinguishable.
 *   - A `file` that could escape `docs/specs`: refused 400, and nothing is created anywhere.
 *   - `content` absent or blank: refused 400 rather than writing an empty document, because an
 *     empty spec is indistinguishable from a successful delete.
 *   - Deleting a file that is not there: 200 with `removed: false`, which is not an error.
 */

import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { createSpecsHandler, SPECS_HEADER, SPECS_ROUTE } from '../plugins/dsh-adr-panel/index.js'

/** Every fixture root created by this file, removed after the run. */
const roots = []

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/**
 * Build a throwaway project directory carrying `.dsh/project.json`.
 *
 * @param specs - `{ [filename]: content }` pre-written into `<root>/docs/specs`.
 * @returns Absolute project root.
 */
function project(specs = {}) {
  const root = mkdtempSync(join(tmpdir(), 'panel-host-'))
  roots.push(root)
  mkdirSync(join(root, '.dsh'), { recursive: true })
  writeFileSync(join(root, '.dsh', 'project.json'), '{}\n')
  if (Object.keys(specs).length > 0) {
    mkdirSync(join(root, 'docs', 'specs'), { recursive: true })
    for (const [file, content] of Object.entries(specs)) writeFileSync(join(root, 'docs', 'specs', file), content)
  }
  return root
}

const TOKEN = 'test-capability-token'

/**
 * Build the stub harness context the handler reaches through `ctx.get`.
 *
 * @param root - The project root a known Session resolves to, or null to mount no registry.
 * @param options - `{ fence }`; when false the `connection` service is withheld entirely.
 * @returns A context whose `get` answers like the real harness services.
 */
function context(root, { fence = true } = {}) {
  return {
    get(name) {
      if (name === 'connection') {
        return fence ? { requestRejection: () => undefined } : undefined
      }
      if (name === 'agents') {
        if (root === null) return undefined
        return { get: (id) => (id === 'sess-known' ? { session: { header: { cwd: root } } } : undefined) }
      }
      return undefined
    },
  }
}

/**
 * Build a fake request. Only the members the handler reads are present.
 *
 * @param options - `{ method, url, headers, body }`. A `body` is delivered as one JSON chunk.
 * @returns An async-iterable request object.
 */
function request({ method = 'GET', url = `${SPECS_ROUTE}?session=sess-known`, headers = {}, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

/**
 * Build a fake response that records the status and parsed body.
 *
 * @returns `{ res, read() }`; `read()` returns `{ status, body, raw }` once the handler is done.
 */
function response() {
  const state = { status: 0, raw: '', headers: {} }
  return {
    res: {
      writeHead(status, headers) {
        state.status = status
        state.headers = headers || {}
      },
      end(text) {
        state.raw = text === undefined ? '' : String(text)
        state.status = state.status === 0 ? 200 : state.status
      },
    },
    read() {
      let body = null
      try {
        body = state.raw === '' ? null : JSON.parse(state.raw)
      } catch {
        body = null
      }
      return { status: state.status, body, raw: state.raw }
    },
  }
}

/**
 * Issue one request against a fresh handler.
 *
 * @param root - Project root the Session resolves to.
 * @param options - Request options, plus `{ token, fence }` overrides.
 * @returns The recorded response.
 */
async function call(root, { token = TOKEN, fence = true, ...req } = {}) {
  const handler = createSpecsHandler(context(root, { fence }), TOKEN, { info() {}, warn() {} })
  const out = response()
  const headers = Object.assign({}, req.headers)
  if (token !== null) headers[SPECS_HEADER] = token
  await handler(request(Object.assign({}, req, { headers })), out.res)
  return out.read()
}

describe('adr panel host route', () => {
  it('lists a project specs for a known Session', async () => {
    // Fails if the route stops resolving the project from the SESSION, which is the one thing
    // that makes the panel show the project the human is actually looking at.
    const root = project({ 'alpha.spec.md': '---\ntitle: Alpha\nstatus: active\n---\nBODY\n' })
    const answer = await call(root)
    assert.equal(answer.status, 200)
    assert.equal(answer.body.ok, true)
    assert.equal(answer.body.project, root)
    assert.equal(answer.body.specs.length, 1)
    assert.equal(answer.body.specs[0].file, 'alpha.spec.md')
    assert.equal(answer.body.specs[0].title, 'Alpha')
  })

  it('creates a spec on disk and then lists it', async () => {
    // THE CASE THE PANEL'S CREATE BUTTON DEPENDS ON. Fails if the write path refuses a
    // well-formed request, or writes somewhere the next listing does not read.
    const root = project()
    const created = await call(root, {
      method: 'POST',
      body: { session: 'sess-known', file: 'from-panel.spec.md', content: '---\ntitle: From panel\nstatus: active\n---\nCREATE-BODY\n' },
    })
    assert.equal(created.status, 200)
    assert.equal(created.body.ok, true)
    assert.equal(existsSync(join(root, 'docs', 'specs', 'from-panel.spec.md')), true)
    assert.match(readFileSync(join(root, 'docs', 'specs', 'from-panel.spec.md'), 'utf8'), /CREATE-BODY/)

    const listed = await call(root)
    assert.equal(listed.body.specs.length, 1)
    assert.equal(listed.body.specs[0].file, 'from-panel.spec.md')
  })

  it('overwrites an existing spec', async () => {
    // Fails if a second save silently does nothing, which reads to the human as "Save is broken".
    const root = project({ 'edit.spec.md': 'FIRST\n' })
    await call(root, { method: 'POST', body: { session: 'sess-known', file: 'edit.spec.md', content: 'SECOND\n' } })
    assert.equal(readFileSync(join(root, 'docs', 'specs', 'edit.spec.md'), 'utf8'), 'SECOND\n')
  })

  it('deletes a spec, and reports a missing one without erroring', async () => {
    // Fails if delete reports failure for a file that is already gone, which would make the UI
    // claim an error for an intent that already holds.
    const root = project({ 'gone.spec.md': 'X\n' })
    const removed = await call(root, { method: 'POST', body: { session: 'sess-known', file: 'gone.spec.md', remove: true } })
    assert.equal(removed.status, 200)
    assert.equal(removed.body.removed, true)
    assert.equal(existsSync(join(root, 'docs', 'specs', 'gone.spec.md')), false)

    const again = await call(root, { method: 'POST', body: { session: 'sess-known', file: 'gone.spec.md', remove: true } })
    assert.equal(again.status, 200)
    assert.equal(again.body.removed, false)
  })

  it('refuses a wrong capability and writes nothing', async () => {
    // The fence that makes this route browser-only. Fails if a caller without the index global's
    // token can create a file.
    const root = project()
    const answer = await call(root, { token: 'not-the-token', method: 'POST', body: { session: 'sess-known', file: 'evil.spec.md', content: 'X\n' } })
    assert.equal(answer.status, 403)
    assert.equal(existsSync(join(root, 'docs', 'specs', 'evil.spec.md')), false)
  })

  it('refuses every request when the browser fence is not mounted', async () => {
    // Fails if the route serves an unauthenticated local caller when `connection` is absent.
    const root = project()
    const answer = await call(root, { fence: false })
    assert.equal(answer.status, 503)
  })

  it('refuses a file that could escape docs/specs', async () => {
    // Path traversal is the one way this route could write outside the project. Fails if the
    // filename check ever accepts a separator, `..`, or an absolute path.
    const root = project()
    for (const file of ['../escape.md', '..\\escape.md', 'sub/escape.md', 'C:\\escape.md', 'escape.txt', '']) {
      const answer = await call(root, { method: 'POST', body: { session: 'sess-known', file, content: 'X\n' } })
      assert.equal(answer.status, 400, `expected 400 for ${JSON.stringify(file)}`)
    }
    assert.equal(existsSync(join(root, 'escape.md')), false)
    assert.equal(existsSync(join(root, 'docs', 'escape.md')), false)
  })

  it('refuses a blank body rather than writing an empty document', async () => {
    // Fails if an empty save is accepted, which is indistinguishable from a delete.
    const root = project()
    for (const content of [undefined, '', '   \n']) {
      const answer = await call(root, { method: 'POST', body: { session: 'sess-known', file: 'blank.spec.md', content } })
      assert.equal(answer.status, 400, `expected 400 for content ${JSON.stringify(content)}`)
    }
    assert.equal(existsSync(join(root, 'docs', 'specs', 'blank.spec.md')), false)
  })

  it('refuses an unknown or missing Session without guessing a project', async () => {
    // Fails if the route falls back to the process directory, which is where the server was
    // launched rather than the project the human is looking at.
    const root = project()
    const unknown = await call(root, { url: `${SPECS_ROUTE}?session=sess-other` })
    assert.equal(unknown.status, 400)
    const missing = await call(root, { url: SPECS_ROUTE })
    assert.equal(missing.status, 400)
  })

  it('creates docs/specs when the project has none yet', async () => {
    // The very first Create in a fresh project: the directory does not exist.
    const root = project()
    assert.equal(existsSync(join(root, 'docs', 'specs')), false)
    const answer = await call(root, { method: 'POST', body: { session: 'sess-known', file: 'first.spec.md', content: 'FIRST\n' } })
    assert.equal(answer.status, 200)
    assert.equal(existsSync(join(root, 'docs', 'specs', 'first.spec.md')), true)
  })
})
