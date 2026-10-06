/**
 * PURPOSE
 *   Prove the observable behaviour of the Specs window's host route across the two
 *   scopes: a global write lands under the harness home and a local one inside the
 *   Session's project, a batch is validated before anything is written, a filename that
 *   could escape its directory is refused, and the effective catalogue names the items the
 *   loader will refuse.
 *
 *   It drives the exported handler with a fake request, a fake response and a fake agent
 *   registry, so the assertions are about what the route DOES - the files on disk and the
 *   JSON it answers - rather than about the source it is built from. The expected values
 *   are hand-written fixtures, never computed by the code under test.
 *
 * INPUTS
 *   None. The harness home and the project are temporary directories, removed afterwards;
 *   `DSH_HOME` is restored.
 *
 * OUTPUTS
 *   `node --test scripts/test-adr-panel-route.mjs` exits 0 when every case holds.
 *
 * KEYWORDS
 *   adr panel, specs window, route, scopes, global, local, batch, path escape, behaviour
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `connection` service: the route refuses before touching disk, which the fake
 *     supplies so the other cases can run.
 *   - The global directory does not exist yet: a write creates it.
 *   - A batch with one invalid entry: nothing is written at all.
 */

import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { createSpecsHandler, SPECS_HEADER } from '../plugins/dsh-adr-panel/index.js'

/** Every fixture directory created by this file, removed after the run. */
const roots = []

/** The `DSH_HOME` this process started with, restored after every case. */
const startingHome = process.env.DSH_HOME

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  if (startingHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = startingHome
})

/** A tracked temporary directory. */
function tempRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/** A project root carrying `.git`, which is what the route's Session resolves to. */
function projectWith(files = {}) {
  const root = tempRoot('panel-project-')
  mkdirSync(join(root, '.git'), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(root, 'docs', 'specs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'specs', name), content)
  }
  return root
}

/** A harness home; `DSH_HOME` points here for the case. */
function homeWith(files = {}) {
  const home = tempRoot('panel-home-')
  mkdirSync(join(home, 'specs'), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(home, 'specs', name), content)
  }
  process.env.DSH_HOME = home
  return home
}

/** A request whose body is `payload` and whose capability header is correct. */
function request(method, { payload, query = '', token }) {
  const chunks = payload === undefined ? [] : [Buffer.from(JSON.stringify(payload), 'utf8')]
  return {
    method,
    url: `/adr-panel/specs${query}`,
    headers: { [SPECS_HEADER]: token },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

/** A response that records what the handler wrote. */
function response() {
  return {
    statusCode: 200,
    body: null,
    writeHead(status) {
      this.statusCode = status
    },
    end(text) {
      this.body = text
    },
    json() {
      return JSON.parse(this.body)
    },
  }
}

/** The handler bound to one Session in `cwd`, with a working connection and registry. */
function handlerFor(cwd) {
  const token = 'test-token'
  const ctx = {
    get(name) {
      if (name === 'connection') return { requestRejection: () => undefined }
      if (name === 'agents') return { get: () => ({ session: { header: { cwd } } }) }
      return undefined
    },
  }
  const log = { info: () => {}, warn: () => {} }
  return { handle: createSpecsHandler(ctx, token, log), token }
}

describe('specs window route', () => {
  it('writes each scope into its own directory and lists it back with its slot', async () => {
    // Fails if the global scope resolves from anything but the harness home, if the local
    // scope leaves the Session's project, or if the listing stops reporting the slot the
    // window badges an item with.
    const home = homeWith()
    const project = projectWith()
    const { handle, token } = handlerFor(project)

    const globalWrite = response()
    await handle(request('POST', { token, payload: { session: 's', scope: 'global', file: '10-rules.md', content: '---\nslot: rules\n---\nGLOBAL-BODY\n' } }), globalWrite)
    assert.equal(globalWrite.statusCode, 200)
    assert.ok(existsSync(join(home, 'specs', '10-rules.md')), 'the global item did not land under the harness home')

    const localWrite = response()
    await handle(request('POST', { token, payload: { session: 's', scope: 'local', file: 'api.md', content: '---\ntitle: API\nslot: items\n---\nLOCAL-BODY\n' } }), localWrite)
    assert.equal(localWrite.statusCode, 200)
    assert.ok(existsSync(join(project, 'docs', 'specs', 'api.md')), 'the local item did not land in the project')
    assert.ok(!existsSync(join(home, 'specs', 'api.md')), 'the local item leaked into the global scope')

    const listGlobal = response()
    await handle(request('GET', { token, query: '?session=s&scope=global' }), listGlobal)
    const globalList = listGlobal.json()
    assert.equal(globalList.scope, 'global')
    assert.equal(globalList.specs[0].file, '10-rules.md')
    assert.equal(globalList.specs[0].slot, 'rules')

    const listLocal = response()
    await handle(request('GET', { token, query: '?session=s&scope=local' }), listLocal)
    assert.equal(listLocal.json().specs[0].slot, 'items')
  })

  it('validates a whole batch before writing any of it', async () => {
    // Fails if a batch is written entry by entry: one bad name would then leave the earlier
    // entries on disk while the human believes the whole save failed.
    const home = homeWith()
    const project = projectWith()
    const { handle, token } = handlerFor(project)

    const refused = response()
    await handle(
      request('POST', {
        token,
        payload: {
          session: 's',
          scope: 'global',
          files: [
            { file: 'good-one.md', content: '---\nslot: rules\n---\nONE\n' },
            { file: '../escape.md', content: '---\nslot: rules\n---\nTWO\n' },
          ],
        },
      }),
      refused,
    )
    assert.equal(refused.statusCode, 400)
    assert.ok(!existsSync(join(home, 'specs', 'good-one.md')), 'a refused batch still wrote its first entry')

    const accepted = response()
    await handle(
      request('POST', {
        token,
        payload: {
          session: 's',
          scope: 'global',
          files: [
            { file: 'good-one.md', content: '---\nslot: rules\n---\nONE\n' },
            { file: 'good-two.md', content: '---\nslot: rules\norder: 20\n---\nTWO\n' },
          ],
        },
      }),
      accepted,
    )
    assert.equal(accepted.statusCode, 200)
    assert.deepEqual(accepted.json().written, ['good-one.md', 'good-two.md'])
    assert.equal(readFileSync(join(home, 'specs', 'good-one.md'), 'utf8'), '---\nslot: rules\n---\nONE\n')
  })

  it('refuses a filename that could leave its directory', async () => {
    // Fails if the name guard is dropped: a write would then be able to place a file
    // anywhere the server can reach, including one every project reads.
    const home = homeWith()
    const project = projectWith()
    const { handle, token } = handlerFor(project)

    for (const file of ['../escape.md', 'nested/escape.md', 'escape.txt', '', '.md']) {
      const res = response()
      await handle(request('POST', { token, payload: { session: 's', scope: 'global', file, content: '---\nslot: rules\n---\nX\n' } }), res)
      assert.equal(res.statusCode, 400, `${JSON.stringify(file)} was not refused`)
    }
    assert.ok(!existsSync(join(home, 'escape.md')), 'a refused name still wrote a file')
  })

  it('sets and clears the subagent cap through the window', async () => {
    // Fails if the typed value does not reach a settings item, if the catalogue view stops
    // reporting the value in force (the bar would then show what was typed rather than what
    // applies), or if clearing leaves a value behind that keeps refusing delegations.
    const home = homeWith()
    const project = projectWith()
    const { handle, token } = handlerFor(project)

    const set = response()
    await handle(request('POST', { token, payload: { session: 's', scope: 'global', settings: { 'subagent-cap': 3 } } }), set)
    assert.equal(set.statusCode, 200, set.body)
    assert.ok(existsSync(join(home, 'specs', 'settings.spec.md')), 'the global cap did not land in a settings item')

    const view = response()
    await handle(request('GET', { token, query: '?session=s&catalogue=1' }), view)
    assert.equal(view.json().settings.effective['subagent-cap'], 3)

    // A project's own value is written into ITS scope and wins in the view.
    const localSet = response()
    await handle(request('POST', { token, payload: { session: 's', scope: 'local', settings: { 'subagent-cap': 5 } } }), localSet)
    assert.equal(localSet.statusCode, 200, localSet.body)
    const view2 = response()
    await handle(request('GET', { token, query: '?session=s&catalogue=1' }), view2)
    assert.equal(view2.json().settings.effective['subagent-cap'], 5)
    assert.equal(view2.json().settings.global['subagent-cap'], 3)

    // Clearing the project's own value falls back to the machine's, and the item is gone.
    const clear = response()
    await handle(request('POST', { token, payload: { session: 's', scope: 'local', settings: { 'subagent-cap': null } } }), clear)
    assert.equal(clear.statusCode, 200, clear.body)
    assert.ok(!existsSync(join(project, 'docs', 'specs', 'settings.spec.md')), 'a cleared setting left its item behind')
    const view3 = response()
    await handle(request('GET', { token, query: '?session=s&catalogue=1' }), view3)
    assert.equal(view3.json().settings.effective['subagent-cap'], 3, 'clearing the project value did not fall back to the machine value')

    // A value that would disable the tool is refused before it is written.
    const bad = response()
    await handle(request('POST', { token, payload: { session: 's', scope: 'local', settings: { 'subagent-cap': 0 } } }), bad)
    assert.equal(bad.statusCode, 400)
    assert.ok(!existsSync(join(project, 'docs', 'specs', 'settings.spec.md')), 'a refused value was written anyway')
  })

  it('reports the items the loader will refuse, in the effective catalogue', async () => {
    // Fails if the window cannot see a refusal: a project item that names `slot: rules` is
    // dropped by the loader, and a human who is not told writes a requirement that silently
    // does nothing.
    homeWith({ '10-rules.md': '---\nslot: rules\n---\nGLOBAL-RULE\n' })
    const project = projectWith({
      'keep.md': '---\ntitle: Keep\nstatus: active\n---\nKEEP-ME\n',
      'override.md': '---\ntitle: Override\nslot: rules\n---\nDROP-ME\n',
      'draft.md': '---\ntitle: Draft\nstatus: draft\n---\nNOT-YET\n',
    })
    const { handle, token } = handlerFor(project)

    const res = response()
    await handle(request('GET', { token, query: '?session=s&catalogue=1' }), res)
    const body = res.json()
    assert.equal(res.statusCode, 200)
    assert.ok(
      body.problems.some((problem) => problem.file === 'override.md' && /may not fill/.test(problem.why)),
      `the local rules override was not reported: ${JSON.stringify(body.problems)}`,
    )
    const effective = body.effective.map((item) => item.file)
    assert.ok(effective.includes('10-rules.md') && effective.includes('keep.md'), `effective: ${JSON.stringify(effective)}`)
    assert.ok(!effective.includes('override.md'), 'a refused item was listed as effective')
    assert.ok(!effective.includes('draft.md'), 'a draft was listed as effective')
    assert.ok(effective.indexOf('10-rules.md') < effective.indexOf('keep.md'), 'the global rules do not sort before the project items')
  })
})
