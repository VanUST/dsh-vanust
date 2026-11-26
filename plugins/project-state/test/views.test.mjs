/*
PROOF: project-state projections
Behavior: regenerateViews() writes digest.md (hard-capped), board.md, traceability.md, one
  mermaid map per REQ, snapshot.md and a machine-readable index.json with the REQ ↔ TASK ↔
  TEST ↔ evidence links; a second run on unchanged state is byte-identical; verify() reports a
  hand-edited projection as view_modified and regeneration repairs it; the index carries every
  REQ's tasks and tests and every TEST's reqId and evidenceRefs; the snapshot carries the count of
  agents the ledger records as working.
Fails when: two regenerations differ, a manual edit goes unnoticed, the index drops a link, or
  the digest grows past its byte cap.
Production path: plugins/project-state/lib/core.mjs (regenerateViews, verify) with
  plugins/project-state/lib/views.mjs; the panel reads index.json instead of parsing markdown.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createStateService } from '../lib/core.mjs'

const clock = () => '2026-01-02T00:00:00.000Z'
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'project-state-views-'))
  return { cwd, state: createStateService({ cwd, now: clock }) }
}

/** Every file under state/views, keyed by its path relative to it. */
async function viewFiles(cwd) {
  const base = join(cwd, 'state', 'views')
  const out = {}
  const walk = async (dir, prefix) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel)
      else out[rel] = await readFile(join(dir, entry.name), 'utf8')
    }
  }
  await walk(base, '')
  return out
}

async function seeded() {
  const { cwd, state } = await workspace()
  const req = await state.create('req', { title: 'Budget gate', criteria: ['it fails above 1.5x', 'warn above the table'] })
  const covered = await state.create('req', { title: 'Coverage', criteria: ['every link is in the index'] })
  const task = await state.create('task', { title: 'Implement the gate', reqId: req.id })
  const chore = await state.create('task', { title: 'Bump the docs', chore: true, choreReason: 'doc rot' })
  const test = await state.create('test', { title: 'Gate is red', reqId: req.id, authorRole: 'orchestrator', command: 'node --test' })
  await state.link(task.id, req.id)
  await state.link(test.id, req.id)
  await state.link(test.id, task.id)
  await state.regenerateViews()
  return { cwd, state, req, covered, task, chore, test }
}

test('regenerateViews writes every projection and is byte-identical on a second run', async () => {
  const { cwd, state } = await seeded()
  const first = await viewFiles(cwd)
  for (const name of ['digest.md', 'board.md', 'traceability.md', 'snapshot.md', 'index.json', '.hashes.json', 'map/REQ-001.mmd', 'map/REQ-002.mmd']) {
    assert.ok(first[name] !== undefined, `missing ${name}`)
  }
  assert.ok(Buffer.byteLength(first['digest.md'], 'utf8') <= 3072)
  const before = await state.snapshot()
  const again = await state.regenerateViews()
  assert.equal(again.ok, true)
  const second = await viewFiles(cwd)
  assert.deepEqual(second, first)
  assert.deepEqual(await state.snapshot(), before, 'regeneration never rewrites the entities')
})

test('a hand-edited projection is a view_modified finding and regeneration repairs it', async () => {
  const { cwd, state } = await seeded()
  const path = join(cwd, 'state', 'views', 'digest.md')
  const original = await readFile(path, 'utf8')
  await writeFile(path, `${original}\nhand edit\n`)
  const verdict = await state.verify()
  const modified = verdict.findings.filter((finding) => finding.code === 'view_modified')
  assert.equal(modified.length, 1, JSON.stringify(verdict.findings))
  assert.equal(modified[0].path, 'views/digest.md')
  const repaired = await state.regenerateViews()
  assert.equal(repaired.ok, true)
  assert.equal(await readFile(path, 'utf8'), original)
  const clean = await state.verify()
  assert.equal(clean.findings.some((finding) => finding.code === 'view_modified'), false)
})

test('index.json is the full link contract: REQ tasks/tests, TEST reqId and evidenceRefs', async () => {
  const { cwd, state, req, covered, task, test } = await seeded()
  const index = JSON.parse(await readFile(join(cwd, 'state', 'views', 'index.json'), 'utf8'))
  assert.equal(index.schemaVersion, 1)
  const reqRow = index.reqs.find((row) => row.id === req.id)
  const coveredRow = index.reqs.find((row) => row.id === covered.id)
  assert.deepEqual(reqRow.tasks, [task.id])
  assert.deepEqual(reqRow.tests, [test.id])
  assert.deepEqual(coveredRow.tasks, [])
  const testRow = index.tests.find((row) => row.id === test.id)
  assert.equal(testRow.reqId, req.id)
  assert.deepEqual(testRow.evidenceRefs.map((ref) => ref.id), [task.id])
  assert.equal(index.counts.req, 2)
  assert.equal(index.counts.task, 2)
  assert.equal(index.counts.test, 1)
})

/*
PROOF: the snapshot names the agents the ledger records as working
Behavior: snapshot.md carries "- active agents: N", counted from the sessions on the task rows:
  a session whose recorded status is active or running counts once, a sleeping or paused session
  does not count, and one session id on two rows is one agent. It is the ledger's record, not a
  live probe: regenerating with the sessions settled reads zero.
Fails when: the snapshot drops the line, counts a settled session, or counts one session twice.
*/
test('snapshot.md counts the working sessions the ledger records', async () => {
  const { cwd, state } = await workspace()
  const req = await state.create('req', { title: 'Agents', criteria: ['the snapshot names them'] })
  const first = await state.create('task', {
    title: 'A task with a working session',
    reqId: req.id,
    sessions: [
      { sessionId: 'sess-working', label: 'BACKEND', status: 'active' },
      { sessionId: 'sess-sleeping', label: 'TESTER', status: 'sleeping' },
      { sessionId: 'sess-paused', label: 'REVIEWER', status: 'paused' },
    ],
  })
  const second = await state.create('task', {
    title: 'A second task, one session and one repeat',
    reqId: req.id,
    sessions: [
      { sessionId: 'sess-running', label: 'ARCHITECT', status: 'running' },
      { sessionId: 'sess-working', label: 'BACKEND', status: 'active' },
    ],
  })
  await state.regenerateViews()
  const snapshot = await readFile(join(cwd, 'state', 'views', 'snapshot.md'), 'utf8')
  assert.match(snapshot, /^- active agents: 2$/m, 'active + running count once each; sleeping and paused do not count')

  const settledFirst = await state.update(first.id, { expectedRevision: 1, sessions: [{ sessionId: 'sess-working', status: 'sleeping' }] })
  const settledSecond = await state.update(second.id, { expectedRevision: 1, sessions: [] })
  assert.equal(settledFirst.ok, true, JSON.stringify(settledFirst))
  assert.equal(settledSecond.ok, true, JSON.stringify(settledSecond))
  await state.regenerateViews()
  const settled = await readFile(join(cwd, 'state', 'views', 'snapshot.md'), 'utf8')
  assert.match(settled, /^- active agents: 0$/m, 'settled sessions are not working agents')
})

test('digest stays inside its byte cap and truncates deterministically', async () => {
  const { cwd, state } = await workspace()
  for (let index = 0; index < 60; index += 1) {
    await state.create('req', { title: `Requirement ${index} with a reasonably long title for the digest budget`, criteria: ['c'] })
  }
  const generated = await state.regenerateViews()
  assert.equal(generated.ok, true)
  const digest = await readFile(join(cwd, 'state', 'views', 'digest.md'), 'utf8')
  assert.ok(Buffer.byteLength(digest, 'utf8') <= 3072, `digest is ${Buffer.byteLength(digest, 'utf8')} B`)
  // PROOF: the digest summarises instead of growing — open requirements are listed by id (up to
  // 20) and the gaps section reports the missing links, so the hard cap bounds the lists rather
  // than cutting the text mid-sentence. Behavior: a register of 60 REQ with one criterion each
  // stays under 3072 bytes and names its gaps and open requirements. Fails when: the digest
  // either drops the gaps line or grows past the byte budget.
  assert.match(digest, /## Gaps/)
  assert.match(digest, /REQ without TASK: 60/)
  assert.match(digest, /## Open requirements \(60\)/)
  assert.match(digest, /- REQ-001 proposed:/)
  const second = await state.regenerateViews()
  assert.equal(second.ok, true)
  const again = await readFile(join(cwd, 'state', 'views', 'digest.md'), 'utf8')
  assert.equal(again, digest)
})

/*
PROOF: a retired TEST row stays in the register and stops counting as live work
Behavior: a TEST row whose case was retired (status deprecated) is kept with its reqId and shown in
  the traceability table as terminal; the snapshot's TEST figure counts only live rows and names the
  retired ones beside it ("- TEST: 1 (1 retired)"), the digest carries the same figure, and index.json
  reports counts.test as live plus counts.testRetired. A register with no retired row prints the figure
  it always printed, and the panel's index count agrees with the snapshot.
Fails when: the figure counts a retired row, the retired row disappears from the register, or the
  index count and the snapshot disagree.
*/
test('a retired TEST row stays in the register and stops counting as live work', async () => {
  const { cwd, state } = await workspace()
  const req = await state.create('req', { title: 'Retired cases', criteria: ['the figure counts live rows'] })
  const live = await state.create('test', { title: 'A live case', reqId: req.id, status: 'unverified' })
  const retired = await state.create('test', { title: 'A retired case', reqId: req.id, status: 'deprecated' })
  assert.equal(retired.ok, true)
  assert.equal(live.ok, true)
  const regenerated = await state.regenerateViews()
  assert.equal(regenerated.ok, true)
  const snapshot = await readFile(join(cwd, 'state', 'views', 'snapshot.md'), 'utf8')
  assert.match(snapshot, /^- TEST: 1 \(1 retired\)$/m)
  const digest = await readFile(join(cwd, 'state', 'views', 'digest.md'), 'utf8')
  assert.match(digest, /TEST 1 \(1 retired\)/)
  const index = JSON.parse(await readFile(join(cwd, 'state', 'views', 'index.json'), 'utf8'))
  assert.equal(index.counts.test, 1)
  assert.equal(index.counts.testRetired, 1)
  const traceability = await readFile(join(cwd, 'state', 'views', 'traceability.md'), 'utf8')
  assert.match(traceability, new RegExp(`\\| ${retired.id} \\| ${req.id} \\| deprecated \\|`))
  const kept = await state.get(retired.id)
  assert.equal(kept.ok, true)
  assert.equal(kept.frontmatter.status, 'deprecated')
  assert.equal(kept.frontmatter.reqId, req.id)
})

