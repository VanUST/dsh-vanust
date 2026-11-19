/*
PROOF: the `/state` host command is the panel's only way in, and it writes through the core
Behavior: the project-state row registers a `state` command; its handler turns
  {"op":"edit","id":"REQ-001","expectedRevision":N,"patch":{...},"release":[...]} into a
  `ccProjectState.update` with `origin: "human"`, regenerates the projections and answers
  `{kind:'success', text:JSON}`. A refusal keeps the core's code in `state: CODE; message`,
  carries the revision the file actually holds, and the file keeps its bytes. A payload with no
  revision is refused REVISION_REQUIRED without touching the core, and an unknown op is refused.
Fails when: the command is missing, a hand edit is written without origin human, a refusal loses
  its code or writes anyway, or the panel gains a second way to reach the register.
Production path: plugins/project-state/index.mjs (apply → ctx.commands.register 'state'),
  plugins/project-state/lib/core.mjs (update with origin human).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, name, inject } from '../index.mjs'
import { parse } from '../lib/format.mjs'

const clock = () => '2026-01-01T00:00:00.000Z'

/** One host row over one disposable workspace, with the command captured instead of mounted. */
function host(cwd) {
  let command = null
  const ctx = {
    logger: { warn() {}, info() {} },
    provide() {
      return () => {}
    },
    effect() {
      return () => {}
    },
    commands: {
      register(definition) {
        command = definition
      },
    },
  }
  const service = apply(ctx, {})
  const invoke = async (op) => command.handler({ rawInput: typeof op === 'string' ? op : JSON.stringify(op), agent: { session: { header: { cwd } } } })
  return { command, service, invoke }
}

async function seed() {
  const cwd = await mkdtemp(join(tmpdir(), 'state-command-'))
  const { service } = host(cwd)
  const created = await service.create(cwd, 'req', { title: 'Draft title', criteria: ['old'], body: 'old text' })
  assert.equal(created.ok, true, JSON.stringify(created))
  return { cwd, id: created.id }
}

test('the row declares the commands injection and registers the state command', () => {
  const { command } = host(process.cwd())
  assert.equal(name, '@cc/dsh-project-state')
  assert.ok(inject.includes('commands'), 'the row must inject commands, not hope for it')
  assert.notEqual(command, null, 'no command was registered')
  assert.equal(command.name, 'state')
  assert.equal(command.recordInput, false, 'entity text must not be recorded as command input')
})

test('a hand edit is written with origin human, the revision moves and the projections follow', async () => {
  const { cwd, id } = await seed()
  const { invoke } = host(cwd)
  const reply = await invoke({ op: 'edit', id, expectedRevision: 1, patch: { title: 'Owner title', source: 'human' }, body: 'Owner authored text.' })
  assert.equal(reply.kind, 'success', reply.text)
  const payload = JSON.parse(reply.text)
  assert.equal(payload.ok, true)
  assert.equal(payload.revision, 2)
  assert.ok(Array.isArray(payload.manualFields) && payload.manualFields.includes('title'), 'the mask records the hand-edited field')
  const written = parse(await readFile(join(cwd, 'state', 'req', `${id}.md`), 'utf8'))
  assert.equal(written.frontmatter.title, 'Owner title')
  assert.deepEqual(written.frontmatter.manualFields, ['body', 'source', 'title'])
  assert.equal(written.body.trim(), 'Owner authored text.')
})

test('a stale revision is refused with its code and the revision the file holds', async () => {
  const { cwd, id } = await seed()
  const { invoke } = host(cwd)
  const before = await readFile(join(cwd, 'state', 'req', `${id}.md`), 'utf8')
  const reply = await invoke({ op: 'edit', id, expectedRevision: 9, patch: { title: 'Too late' } })
  assert.equal(reply.kind, 'error')
  assert.match(reply.text, /^state: revision_conflict;/)
  assert.match(reply.text, /file has 1/)
  assert.equal(await readFile(join(cwd, 'state', 'req', `${id}.md`), 'utf8'), before, 'a refusal writes nothing')
})

test('a protected field is refused with field_not_editable and writes nothing', async () => {
  const { cwd, id } = await seed()
  const { invoke } = host(cwd)
  const before = await readFile(join(cwd, 'state', 'req', `${id}.md`), 'utf8')
  const reply = await invoke({ op: 'edit', id, expectedRevision: 1, patch: { analysisRef: { initiative: 'x', requirementId: 'FR1' } } })
  assert.equal(reply.kind, 'error')
  assert.match(reply.text, /^state: field_not_editable;/)
  assert.equal(await readFile(join(cwd, 'state', 'req', `${id}.md`), 'utf8'), before)
})

test('a payload with no revision is refused before the core is reached', async () => {
  const { cwd, id } = await seed()
  const { invoke } = host(cwd)
  const before = await readFile(join(cwd, 'state', 'req', `${id}.md`), 'utf8')
  const reply = await invoke({ op: 'edit', id, patch: { title: 'No revision' } })
  assert.equal(reply.kind, 'error')
  assert.match(reply.text, /REVISION_REQUIRED/)
  assert.equal(await readFile(join(cwd, 'state', 'req', `${id}.md`), 'utf8'), before)
})

test('an unknown op and a broken payload are named, not half-applied', async () => {
  const { cwd } = await seed()
  const { invoke } = host(cwd)
  const unknown = await invoke({ op: 'delete', id: 'REQ-001' })
  assert.equal(unknown.kind, 'error')
  assert.match(unknown.text, /unknown op "delete"/)
  const broken = await invoke('not json')
  assert.equal(broken.kind, 'error')
  assert.match(broken.text, /expected a JSON operation/)
})

test('release returns a field to its source', async () => {
  const { cwd, id } = await seed()
  const { invoke } = host(cwd)
  await invoke({ op: 'edit', id, expectedRevision: 1, patch: { title: 'Owner title' } })
  const released = await invoke({ op: 'edit', id, expectedRevision: 2, release: ['title'] })
  assert.equal(released.kind, 'success', released.text)
  const payload = JSON.parse(released.text)
  assert.equal(payload.manualFields, undefined, 'the mask is empty again')
  const file = await readFile(join(cwd, 'state', 'req', `${id}.md`), 'utf8')
  assert.doesNotMatch(file, /manualFields/)
})
