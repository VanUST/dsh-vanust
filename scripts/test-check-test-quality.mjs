#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove the test-quality lint's two observable decisions by driving it over files
 *   whose verdict is known, rather than by reading its source: a shape-only assertion
 *   is reported as SHAPE_TYPEOF, and findings in report mode exit 0 while strict mode
 *   exits 1. The cases for the other finding codes, the allow marker and the unusable
 *   roots were removed as per-branch coverage under the small-behavioural-suite ruling.
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
 *   - A missing root is unusable rather than clean, so a lint that scanned nothing
 *     cannot read as a pass; that path was covered by a removed case and is not
 *     asserted here.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { analyzeText, main, scan } from './check-test-quality.mjs'

/** Materialise a `scripts/` directory with one test file; return its root. */
function fixture(body, name = 'test-fixture.mjs') {
  const root = mkdtempSync(join(tmpdir(), 'test-quality-'))
  mkdirSync(join(root, 'scripts'), { recursive: true })
  writeFileSync(join(root, 'scripts', name), body)
  return root
}

test('a typeof-function assertion is reported as SHAPE_TYPEOF', () => {
  const text = "import { bundle } from './b.mjs'\nassert.ok(typeof bundle.apply === 'function')\n"
  assert.deepEqual(
    analyzeText(text).map((finding) => finding.code),
    ['SHAPE_TYPEOF'],
  )
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

