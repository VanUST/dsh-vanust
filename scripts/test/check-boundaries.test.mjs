/*
PROOF: the boundary check catches a change that breaks one of the two boundaries and lets a
  lawful change through
Behavior: scripts/check-boundaries.mjs reports an import of harness internals outside the seam
  (an undeclared harness package, a subpath inside a harness package, a path into the installed
  harness) and a write call that names a state's path outside that state's owning component, and
  its gate (--check) exits 1 on either while a plugin that uses the declared plugin API and writes
  its own file passes.
Fails when: the check misses a second writer of the board or a reach into the harness, the gate
  returns 0 with a breach present, a lawful declared-API plugin is reported, or an exception that
  matches nothing no longer refuses the gate.
Production path: scripts/check-boundaries.mjs — importSpecifiers, seamViolation, writeCalls, scan
  and main; the seam plugins/orchestrator/harness-seam.mjs and the states in STATES.
*/

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { EXCEPTIONS, main, scan } from '../check-boundaries.mjs'

const control = process.env.CASE_NEGATIVE_CONTROL ?? ''

/** A lawful plugin: the declared plugin API, and a file this plugin owns. */
const LEGAL = [
  "import { defineTool } from '@deepseek-ai/dsh-tools'",
  "import { writeFileSync } from 'node:fs'",
  'export const tool = defineTool({ name: "pilot_legal" })',
  'export const write = (cwd) => writeFileSync(cwd + "/.dsh/pilot-legal.json", "{}")',
  '',
].join('\n')

/** A reach into the harness outside the seam: an undeclared package and a subpath of a declared one. */
const SEAM_BREACH = [
  "import { Session } from '@deepseek-ai/dsh-session'",
  "import { defineTool } from '@deepseek-ai/dsh-tools/lib/index.js'",
  'export const breached = () => Session',
  'export const tool = defineTool',
  '',
].join('\n')

/** A second writer of the board, outside plugins/taskboard. */
const BOARD_BREACH = [
  "import { writeFileSync } from 'node:fs'",
  "import { join } from 'node:path'",
  'export const writeBoard = (cwd, board) => {',
  "  writeFileSync(join(cwd, '.dsh', 'taskboard.rows.json'), JSON.stringify(board))",
  '}',
  '',
].join('\n')

function fixture(modules) {
  const root = mkdtempSync(join(tmpdir(), 'boundaries-fixture-'))
  for (const [rel, source] of Object.entries(modules)) {
    const path = join(root, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, source, 'utf8')
  }
  return root
}

/** Run the CLI entry without printing its report; return its exit code. */
function quietly(argv) {
  const log = console.log
  const error = console.error
  console.log = () => {}
  console.error = () => {}
  try {
    return main(argv)
  } finally {
    console.log = log
    console.error = error
  }
}

test('a lawful change is not a finding', () => {
  const root = fixture({ 'plugins/pilot-legal/tool.mjs': LEGAL })
  try {
    const result = scan(root)
    assert.deepEqual(result.open, [])
    assert.equal(result.scanned, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a reach into the harness outside the seam is caught, both shapes', () => {
  const root = fixture({ 'plugins/pilot-breach/seam.mjs': SEAM_BREACH })
  try {
    const kinds = scan(root).open.map((finding) => finding.rule + '/' + finding.kind + '/' + finding.match).sort()
    assert.deepEqual(kinds, ['I-SEAM-ONLY/deep-import/@deepseek-ai/dsh-tools/lib/index.js', 'I-SEAM-ONLY/undeclared-package/@deepseek-ai/dsh-session'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a second writer of the board is caught', () => {
  const root = fixture({ 'plugins/pilot-breach/board.mjs': BOARD_BREACH })
  try {
    const found = scan(root).open
    assert.equal(found.length, 1)
    assert.equal(found[0].rule, 'I-ONE-WRITER')
    assert.equal(found[0].kind, 'second-writer')
    assert.equal(found[0].state, 'board')
    assert.equal(found[0].match, 'taskboard.rows.json')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the gate refuses a breach with exit 1; an exception that matches nothing refuses too', () => {
  const root = fixture({ 'plugins/pilot-breach/board.mjs': BOARD_BREACH, 'plugins/pilot-breach/seam.mjs': SEAM_BREACH })
  const lawful = fixture({ 'plugins/pilot-legal/tool.mjs': LEGAL })
  try {
    assert.equal(quietly(['--check', '--root', root]), 1)
    // A fixture that holds none of the excepted files: every exception is stale, so the gate
    // refuses even a lawful tree. That is what keeps the exception list from rotting.
    assert.equal(quietly(['--check', '--root', lawful]), 1)
    assert.ok(EXCEPTIONS.length > 0)
    assert.equal(quietly(['--root', root]), 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(lawful, { recursive: true, force: true })
  }
})

test('negative control expect-no-gate: the pre-fix gate let the breach through', () => {
  if (control !== 'expect-no-gate') return
  const root = fixture({ 'plugins/pilot-breach/board.mjs': BOARD_BREACH })
  try {
    assert.equal(quietly(['--check', '--root', root]), 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
