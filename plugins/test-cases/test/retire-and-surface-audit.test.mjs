/*
PROOF: a case can be retired from a shell as well as from a tool, and the audit names the cases whose declared surface is gone
Behavior: `cases deprecate --id <case> --reason <text>` moves the case to deprecated, puts the reason in its
  history and keeps its steps; it refuses an unknown id (CASE_NOT_FOUND), a missing reason (INVALID_CASE) and
  an already-retired case (CASE_CLOSED) with exit 2. The same store function backs `case_deprecate`, so the
  tool refuses the same three (plus REVISION_REQUIRED without the revision it read). `cases audit` lists every
  case whose `surfaceFiles` entry or `testPath` is gone, with the missing paths and a count, and writes
  nothing: the files are byte-identical after the sweep.
Fails when: a shell cannot retire a case, a retirement loses the steps or the history entry, an unknown id or a
  missing reason passes, an already-retired case is retired twice, or the audit finds stale cases by guessing
  from titles instead of reading the declared surface.
Production path: plugins/test-cases/lib/store.mjs (deprecateCase, CLOSED), test-cases.mjs (case_deprecate),
  bin/cases.mjs (deprecate, audit missing-surface).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTools } from '../test-cases.mjs'
import { createStateService } from '../../project-state/lib/core.mjs'
import { deprecateCase, readCase } from '../lib/store.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cases.mjs')

const caseRecord = (id, overrides = {}) => ({
  schemaVersion: 1,
  id,
  title: id,
  requirement: 'The panel shows one selection in every mode',
  expected: 'Picking a requirement filters the other modes',
  steps: ['open the panel', 'pick a requirement', 'read the other modes'],
  status: 'unverified',
  kind: 'regression',
  source: 'human',
  automated: false,
  reason: 'documented for the retirement proof',
  reqId: 'REQ-001',
  authorRole: 'orchestrator',
  revision: 1,
  history: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

function library(cases) {
  const cwd = mkdtempSync(join(tmpdir(), 'cases-retire-'))
  mkdirSync(join(cwd, 'docs', 'cases'), { recursive: true })
  for (const record of cases) writeFileSync(join(cwd, 'docs', 'cases', `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`)
  return cwd
}

function cli(cwd, ...args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args, '--workspace', cwd, '--json'], { encoding: 'utf8' }) }
  } catch (error) {
    return { code: error.status, out: String(error.stdout ?? '') }
  }
}

function cliHuman(cwd, ...args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args, '--workspace', cwd], { encoding: 'utf8' }) }
  } catch (error) {
    return { code: error.status, out: String(error.stdout ?? '') }
  }
}

/** The library as bytes: the audit must leave it exactly as it found it. */
function digest(cwd) {
  const root = join(cwd, 'docs', 'cases')
  const text = readdirSync(root).sort().map((name) => `${name}\u0000${readFileSync(join(root, name), 'utf8')}`).join('\u0000')
  return createHash('sha256').update(text).digest('hex')
}

test('the store keeps the steps and puts the reason in history', () => {
  const cwd = library([caseRecord('retire-me')])
  const before = readCase(join(cwd, 'docs', 'cases'), 'retire-me').record
  const { record } = deprecateCase(join(cwd, 'docs', 'cases'), 'retire-me', { reason: 'the map it asserts was retired' })
  assert.equal(record.status, 'deprecated')
  assert.equal(record.deprecateReason, 'the map it asserts was retired')
  assert.deepEqual(record.steps, before.steps)
  assert.equal(record.revision, before.revision + 1)
  const entry = record.history.at(-1)
  assert.equal(entry.action, 'deprecated')
  assert.equal(entry.reason, 'the map it asserts was retired')
  assert.equal(entry.revision, before.revision)
})

test('the tool refuses an unknown id, a missing reason, a stale revision and an already-retired case by name', async () => {
  const cwd = library([caseRecord('retire-me')])
  const tools = createTools({ dir: 'docs/cases' })
  const exec = { agent: { session: { id: 'sess-retire', header: { cwd } } } }
  const unknown = await tools.case_deprecate.execute({ id: 'no-such-case', reason: 'r', expectedRevision: 1 }, exec)
  assert.equal(unknown.code, 'CASE_NOT_FOUND')
  // The tool runtime validates the declared parameters before execute: a missing reason is
  // INVALID_ARGS there, and the store refuses it again as INVALID_CASE if the schema is bypassed.
  let noReason
  try {
    noReason = await tools.case_deprecate.execute({ id: 'retire-me', expectedRevision: 1 }, exec)
  } catch (error) {
    noReason = error
  }
  assert.equal(noReason.code, 'INVALID_ARGS')
  assert.equal(noReason.violations.some((line) => line.includes('reason')), true)
  const stale = await tools.case_deprecate.execute({ id: 'retire-me', reason: 'r', expectedRevision: 99 }, exec)
  assert.equal(stale.code, 'REVISION_CONFLICT')
  const first = await tools.case_deprecate.execute({ id: 'retire-me', reason: 'the map it asserts was retired', expectedRevision: 1 }, exec)
  assert.equal(first.ok, true)
  assert.equal(first.case.status, 'deprecated')
  const again = await tools.case_deprecate.execute({ id: 'retire-me', reason: 'again', expectedRevision: first.case.revision }, exec)
  assert.equal(again.code, 'CASE_CLOSED')
  assert.throws(
    () => deprecateCase(join(cwd, 'docs', 'cases'), 'retire-me', { reason: '   ' }),
    (error) => error.code === 'INVALID_CASE',
    'a blank reason must be refused by the store itself, not only by the tool schema',
  )
})


/*
PROOF: a retirement from the shell updates the register the same way the tool's mirror does
Behavior: `cases deprecate` writes the case, then mirrors it through the SAME `mirrorCase` the host tool
  calls (opening the profile's state core as scripts/state-merge.mjs does): the TEST row is updated to
  deprecated with its caseId kept and the snapshot's TEST figure drops by one, immediately. A workspace
  without a `state/` ledger, or whose ledger cannot be opened, still retires the case and says the board
  was not updated (exit 0), instead of failing the retirement.
Fails when: the figure does not move after the shell command, the CLI carries its own copy of the mirror,
  or an unreachable state turns a completed retirement into an error.
*/
test('a shell retirement updates the register through the same mirror the tool uses', async () => {
  const cwd = library([caseRecord('retire-me')])
  const core = createStateService({ cwd })
  const req = await core.create('req', { title: 'Retirement', criteria: ['the figure drops by one'] })
  const row = await core.create('test', { title: 'The retired case', reqId: req.id, caseId: 'retire-me', status: 'unverified' })
  await core.regenerateViews()
  assert.match(readFileSync(join(cwd, 'state', 'views', 'snapshot.md'), 'utf8'), /^- TEST: 1$/m)

  const retired = cli(cwd, 'deprecate', '--id', 'retire-me', '--reason', 'the map it asserts was retired')
  assert.equal(retired.code, 0)
  const body = JSON.parse(retired.out)
  assert.equal(body.status, 'deprecated')
  assert.equal(body.board.updated, true)
  assert.equal(body.board.testId, row.id)
  assert.match(readFileSync(join(cwd, 'state', 'views', 'snapshot.md'), 'utf8'), /^- TEST: 0 \(1 retired\)$/m)
  const kept = await core.get(row.id)
  assert.equal(kept.frontmatter.status, 'deprecated')
  assert.equal(kept.frontmatter.caseId, 'retire-me')
})

test('a workspace without a ledger still retires the case and reports the board untouched', () => {
  const cwd = library([caseRecord('retire-me'), caseRecord('retire-two')])
  const retired = cli(cwd, 'deprecate', '--id', 'retire-me', '--reason', 'the map it asserts was retired')
  assert.equal(retired.code, 0)
  const body = JSON.parse(retired.out)
  assert.equal(body.status, 'deprecated')
  assert.equal(body.board.updated, false)
  assert.equal(body.board.code, 'no_state')
  const human = cliHuman(cwd, 'deprecate', '--id', 'retire-two', '--reason', 'the map it asserts was retired')
  assert.equal(human.code, 0)
  assert.match(human.out, /board: not updated \(no_state: no state\/ ledger in /)
})

test('a ledger that cannot be opened leaves the retirement done and the board reported', () => {
  const cwd = library([caseRecord('retire-me')])
  writeFileSync(join(cwd, 'state'), 'not a directory\n')
  const retired = cli(cwd, 'deprecate', '--id', 'retire-me', '--reason', 'the map it asserts was retired')
  assert.equal(retired.code, 0)
  const body = JSON.parse(retired.out)
  assert.equal(body.status, 'deprecated')
  assert.equal(body.board.updated, false)
  assert.equal(['mirror_failed', 'write_failed'].includes(body.board.code), true, body.board.code)
  assert.equal(readCase(join(cwd, 'docs', 'cases'), 'retire-me').record.status, 'deprecated')
})

test('the shell retires a case through the same path and refuses the same three', () => {
  const cwd = library([caseRecord('retire-me')])
  const unknown = cli(cwd, 'deprecate', '--id', 'no-such-case', '--reason', 'r')
  assert.equal(unknown.code, 2)
  assert.equal(JSON.parse(unknown.out).code, 'CASE_NOT_FOUND')
  const noReason = cli(cwd, 'deprecate', '--id', 'retire-me', '--reason', '')
  assert.equal(noReason.code, 2)
  assert.equal(JSON.parse(noReason.out).code, 'INVALID_CASE')
  const retired = cli(cwd, 'deprecate', '--id', 'retire-me', '--reason', 'the map it asserts was retired')
  assert.equal(retired.code, 0)
  const body = JSON.parse(retired.out)
  assert.equal(body.ok, true)
  assert.equal(body.status, 'deprecated')
  assert.equal(body.revision, 2)
  const again = cli(cwd, 'deprecate', '--id', 'retire-me', '--reason', 'again')
  assert.equal(again.code, 2)
  assert.equal(JSON.parse(again.out).code, 'CASE_CLOSED')
  const listed = JSON.parse(cli(cwd, 'list').out)
  assert.deepEqual(listed.cases.map((entry) => [entry.id, entry.status]), [['retire-me', 'deprecated']])
  const { record } = readCase(join(cwd, 'docs', 'cases'), 'retire-me')
  assert.deepEqual(record.steps, caseRecord('retire-me').steps)
})

test('the audit names the missing declared paths and writes nothing', () => {
  const cwd = library([
    caseRecord('surface-gone', {
      surfaceFiles: [{ path: 'plugins/gone/a.mjs', sha256: '0'.repeat(64) }, { path: 'docs/cases/surface-gone.json', sha256: '0'.repeat(64) }],
      testPath: 'tests/gone.test.mjs',
    }),
    caseRecord('surface-there', { surfaceFiles: [{ path: 'docs/cases/surface-there.json', sha256: '0'.repeat(64) }] }),
  ])
  const before = digest(cwd)
  const audit = cli(cwd, 'audit')
  assert.equal(audit.code, 0)
  const body = JSON.parse(audit.out)
  const group = body.groups['missing-surface']
  assert.equal(group.count, 1)
  assert.deepEqual(group.cases[0].missing, ['plugins/gone/a.mjs', 'tests/gone.test.mjs'])
  assert.equal(body.total, 2)
  assert.equal(digest(cwd), before, 'the audit wrote to the library')
  const human = cliHuman(cwd, 'audit')
  assert.equal(human.code, 0)
  assert.match(human.out, /missing-surface: 1/)
  assert.match(human.out, /missing  plugins\/gone\/a\.mjs/)
  assert.match(human.out, /missing  tests\/gone\.test\.mjs/)
})
