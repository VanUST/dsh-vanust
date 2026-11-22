/*
PROOF: a case that changed without a journal write is refused by name, and an old library still reads
Behavior: every case write appends a chained event to docs/cases/journal.ndjson
  ({ts, kind, id, payloadHash, prevHash, hash}); case_get verifies the chain and the case's last
  event, and a hand edit of the JSON without a matching event is CASE_JOURNAL_MISMATCH. A case with
  no event is legacy: readable, not signed. The journal is tamper-EVIDENT, not a signature.
Fails when: an edited case still reads as signed, a legacy case is refused, or the chain does not
  notice a rewritten line.
Production path: plugins/test-cases/lib/journal.mjs (appendCaseEvent, checkCase) and
  lib/store.mjs (writeCase appends), test-cases.mjs (case_get refuses).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JOURNAL_FILE, appendCaseEvent, checkCase, readJournal } from '../lib/journal.mjs'
import { createTools } from '../test-cases.mjs'

const exec = (cwd, preset = 'tester') => ({ agent: { session: { id: `sess-${preset}`, header: { cwd, agentPreset: preset } } } })

function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'test-cases-journal-'))
  mkdirSync(join(cwd, 'docs', 'cases'), { recursive: true })
  return cwd
}

const record = (overrides = {}) => ({
  title: 'The journal case',
  requirement: 'the door opens',
  expected: 'it opens',
  automated: false,
  reason: 'the door is physical',
  steps: ['push'],
  reqId: 'REQ-950',
  authorRole: 'tester',
  ...overrides,
})

test('a write appends one chained event, and the case checks out', async () => {
  const cwd = workspace()
  const tools = createTools({ dir: 'docs/cases' }, {})
  const created = await tools.case_record.execute(record(), exec(cwd))
  assert.equal(created.ok, true, JSON.stringify(created))
  const events = readJournal(join(cwd, 'docs', 'cases'))
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'write')
  assert.equal(events[0].prevHash, 'genesis')
  assert.match(events[0].hash, /^[0-9a-f]{64}$/)
  const read = await tools.case_get.execute({ id: created.case.id }, exec(cwd))
  assert.equal(read.ok, true, JSON.stringify(read))
})

test('a hand edit without a journal write is refused by name', async () => {
  const cwd = workspace()
  const tools = createTools({ dir: 'docs/cases' }, {})
  const created = await tools.case_record.execute(record(), exec(cwd))
  const path = join(cwd, 'docs', 'cases', `${created.case.id}.json`)
  const edited = JSON.parse(readFileSync(path, 'utf8'))
  edited.status = 'verified'
  writeFileSync(path, JSON.stringify(edited, null, 2) + '\n', 'utf8')
  const refused = await tools.case_get.execute({ id: created.case.id }, exec(cwd))
  assert.equal(refused.ok, false, 'an edited case still read as signed')
  assert.equal(refused.code, 'CASE_JOURNAL_MISMATCH', JSON.stringify(refused))
  assert.match(refused.message, /journal/)
})

test('a rewritten journal line breaks the chain, and a legacy case is readable', () => {
  const cwd = workspace()
  const dir = join(cwd, 'docs', 'cases')
  writeFileSync(join(dir, 'legacy.json'), JSON.stringify({ id: 'legacy', title: 'old', status: 'unverified' }, null, 2) + '\n', 'utf8')
  assert.equal(checkCase(dir, 'legacy', join(dir, 'legacy.json')).status, 'legacy')
  appendCaseEvent(dir, 'write', 'legacy', join(dir, 'legacy.json'))
  assert.equal(checkCase(dir, 'legacy', join(dir, 'legacy.json')).status, 'ok')
  // Rewrite the payload hash of the single line: the chain's own hash no longer matches.
  const lines = readFileSync(join(dir, JOURNAL_FILE), 'utf8').trim().split('\n')
  const event = JSON.parse(lines[0])
  event.payloadHash = 'f'.repeat(64)
  writeFileSync(join(dir, JOURNAL_FILE), JSON.stringify(event) + '\n', 'utf8')
  const broken = checkCase(dir, 'legacy', join(dir, 'legacy.json'))
  assert.equal(broken.status, 'broken', JSON.stringify(broken))
})
