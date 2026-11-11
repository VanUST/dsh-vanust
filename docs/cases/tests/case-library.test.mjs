// PROOF:
// Behavior: the case library's stable id and drift rule — a changed surface hash or a missing
//   test marks a case `stale`; a matching hash keeps it verified.
// Fails when: `driftFor` stops comparing surface hashes, stops detecting a missing test, or
//   `slugify` stops producing a stable kebab id (a case file could then collide or be lost).
// Production path: plugins/test-cases/lib/schema.mjs, used by case_record, case_verify and
//   case_drift in plugins/test-cases/test-cases.mjs.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { driftFor, slugify } from '../../../plugins/test-cases/lib/schema.mjs'

test('slugify produces a stable kebab id', () => {
  assert.equal(slugify('Reviewer has NO write/edit'), 'reviewer-has-no-write-edit')
  assert.equal(slugify('  …  '), 'case')
})

test('driftFor keeps a verified case verified while its surface hash matches', () => {
  const record = { status: 'verified', automated: true, testPath: 'docs/cases/tests/case-library.test.mjs', surfaceFiles: [{ path: 'docs/cases/fixtures/surface.txt', sha256: 'aa' }] }
  const result = driftFor(record, process.cwd(), { hash: () => 'aa' })
  assert.equal(result.status, null)
  assert.deepEqual(result.changedFiles, [])
})

test('driftFor marks a case stale when a recorded surface file changed', () => {
  const record = { status: 'verified', automated: false, surfaceFiles: [{ path: 'docs/cases/fixtures/surface.txt', sha256: 'aa' }] }
  const result = driftFor(record, process.cwd(), { hash: () => 'bb' })
  assert.equal(result.status, 'stale')
  assert.deepEqual(result.changedFiles, ['docs/cases/fixtures/surface.txt'])
})

test('driftFor marks an automated case stale when its test file is missing', () => {
  const record = { status: 'verified', automated: true, testPath: 'docs/cases/tests/does-not-exist.test.mjs', surfaceFiles: [] }
  const result = driftFor(record, process.cwd(), { hash: () => null })
  assert.equal(result.status, 'stale')
  assert.equal(result.missingTest, true)
})
