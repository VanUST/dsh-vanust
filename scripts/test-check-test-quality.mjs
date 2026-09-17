#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove the test-quality lint by driving it over files whose verdict is known,
 *   rather than by reading its source. Each case is one shape the rule exists to
 *   refuse (or one shape it must NOT refuse), so a change that reverses a verdict
 *   fails here instead of shipping as a quiet false positive.
 *
 * INPUTS
 *   None. Fixtures are written into a fresh temporary directory and removed in a
 *   `finally` block; the kit's own test corpus is read only through `scan` for the
 *   no-false-positive case.
 *
 * OUTPUTS
 *   A `node:test` run. Exit 0 when every case holds; non-zero when one does not.
 *
 * KEYWORDS
 *   test quality, shape assertion, mirror assertion, mock assertion, lint,
 *   behavioural test, false positive
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The temporary directory is removed even when a case fails.
 *   - `scan` over a directory with no test files returns an empty list rather than
 *     throwing, which the "no files" case pins.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { analyzeText, importedBindings, main, scan } from './check-test-quality.mjs'

/** Materialise a `scripts/` directory with one test file; return its root. */
function fixture(body, name = 'test-fixture.mjs') {
  const root = mkdtempSync(join(tmpdir(), 'test-quality-'))
  mkdirSync(join(root, 'scripts'), { recursive: true })
  writeFileSync(join(root, 'scripts', name), body)
  return root
}

test('importedBindings collects default, named, renamed and namespace bindings', () => {
  const names = importedBindings(
    [
      "import def, { a, b as c } from 'x'",
      "import * as ns from 'y'",
      "const req = require('z')",
    ].join('\n'),
  )
  for (const name of ['def', 'a', 'c', 'ns', 'req']) assert.ok(names.has(name), `${name} is a binding`)
})

test('a typeof-function assertion is reported as SHAPE_TYPEOF', () => {
  const text = "import { bundle } from './b.mjs'\nassert.ok(typeof bundle.apply === 'function')\n"
  assert.deepEqual(
    analyzeText(text).map((finding) => finding.code),
    ['SHAPE_TYPEOF'],
  )
})

test('a typeof comparison used as program logic is not an assertion and is not reported', () => {
  const text = "import { bundle } from './b.mjs'\nconst f = typeof bundle.apply === 'function' ? bundle.apply : null\n"
  assert.deepEqual(analyzeText(text), [])
})

test('Object.keys inside a failure message is not a shape assertion', () => {
  const text =
    "import assert from 'node:assert/strict'\n" +
    "assert.ok(files[path], `expected ${path}, got ${Object.keys(files).join(', ')}`)\n"
  assert.deepEqual(analyzeText(text), [])
})

test('a membership test on an imported module binding is SHAPE_MEMBER', () => {
  const text = "import { schema } from './s.mjs'\nassert.ok('version' in schema)\n"
  assert.deepEqual(
    analyzeText(text).map((finding) => finding.code),
    ['SHAPE_MEMBER'],
  )
})

test('a membership test on a locally built object is not reported', () => {
  const text = "const entry = build()\nassert.ok('draft' in entry)\n"
  assert.deepEqual(analyzeText(text), [])
})

test('an expected value computed by the call under test is MIRROR', () => {
  const text = 'assert.deepEqual(buildQuery({ tag: 1 }), buildQuery({ tag: 1 }))\n'
  assert.deepEqual(
    analyzeText(text).map((finding) => finding.code),
    ['MIRROR'],
  )
})

test('a mock call count is MOCK_ONLY, and a real result is not', () => {
  const flagged = 'assert.equal(spy.calls.length, 3)\n' // test-quality:allow fixture text, not an assertion this suite makes
  assert.deepEqual(
    analyzeText(flagged).map((finding) => finding.code),
    ['MOCK_ONLY'],
  )
  assert.deepEqual(analyzeText('assert.deepEqual(parse(input), { ok: true })\n'), [])
})

test('an inline allow on the line or the line before exempts the finding', () => {
  const sameLine =
    "assert.ok(typeof bundle.apply === 'function') // test-quality:allow the bundle is loaded dynamically\n"
  const previousLine =
    "// test-quality:allow the bundle is loaded dynamically\nassert.ok(typeof bundle.apply === 'function')\n"
  assert.deepEqual(analyzeText(sameLine), [])
  assert.deepEqual(analyzeText(previousLine), [])
})

test('report mode exits 0 on findings and strict mode exits 1', () => {
  const root = fixture("assert.ok(typeof x.y === 'function')\n") // test-quality:allow fixture text, not an assertion this suite makes
  try {
    assert.equal(main(['--root', root]), 0)
    assert.equal(main(['--root', root, '--strict']), 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a missing root is unusable rather than clean', () => {
  assert.equal(main(['--root', join(tmpdir(), 'test-quality-does-not-exist')]), 2)
})

test('a directory with no test files scans to nothing rather than throwing', () => {
  const root = mkdtempSync(join(tmpdir(), 'test-quality-empty-'))
  try {
    assert.deepEqual(scan(root), { files: [], findings: [] })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("the kit's own suite is clean under the rule", () => {
  const root = join(new URL('.', import.meta.url).pathname, '..')
  assert.deepEqual(scan(root).findings, [])
})
