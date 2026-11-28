/*
PROOF: the boundary check catches a change that breaks one of the two boundaries and lets a
  lawful change through
Behavior: scripts/check-boundaries.mjs reports an import of harness internals outside the seam
  (an undeclared harness package, a subpath inside a harness package, a path into the installed
  harness) and a write call that names a state's path outside that state's owning component, and
  its gate (--check) exits 1 on either while a plugin that uses the declared plugin API and writes
  its own file passes. The report also names how docs/ARCHITECTURE.md's component table differs
  from the tree — a declared path the tree lacks, a code file no component claims — as a section
  of its own, says the page is missing instead of failing, and the gate's exit code ignores it.
Fails when: the check misses a second writer of the board or a reach into the harness, the gate
  returns 0 with a breach present, a lawful declared-API plugin is reported, an exception that
  matches nothing no longer refuses the gate, a missing path or an unclaimed code file is not
  named, a missing architecture page throws, or the drift counts as a finding that refuses the gate.
Production path: scripts/check-boundaries.mjs — importSpecifiers, seamViolation, writeCalls,
  architecturePaths, architectureDrift, scan and main; the seam
  plugins/orchestrator/harness-seam.mjs and the states in STATES.
*/

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DRIFT_EXAMPLES, EXCEPTIONS, architectureDrift, main, scan } from '../check-boundaries.mjs'

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

/** Run the CLI and return its exit code and what it printed. */
function reportOf(argv) {
  const lines = []
  const log = console.log
  console.log = (...args) => lines.push(args.join(' '))
  try {
    return { code: main(argv), text: lines.join('\n') }
  } finally {
    console.log = log
  }
}

/** A minimal architecture page: the §2 component table names the paths in its first column. */
function architecturePage(...rows) {
  return [
    '## 2. Компоненты, владельцы, контракты',
    '',
    '| Компонент и путь | Что держит → кому отдаёт |',
    '|---|---|',
    ...rows,
    '',
  ].join('\n')
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

/*
PROOF: the report names how the architecture page differs from the tree, without gating
Behavior: the report prints the declared component paths the tree does not have and the scanned
  code files no declared path claims as a section of its own; a page with no component table and a
  missing page are named states; scan() keeps the drift out of open/stale, so the gate's verdict
  and exit code stay what they were. A wide drift is ONE line of counts (declared paths, paths the
  tree lacks, code files no component claims) plus at most DRIFT_EXAMPLES examples and a line
  naming how many are left and how to see them; --drift-all prints every path, --json keeps the
  complete lists.
Fails when: a missing path or an unclaimed code file is not named, a missing architecture page
  throws or silences the rest of the report, the drift counts as a finding, a table that
  matches the tree still reports drift, or the report drowns the counts in the full list.
Production path: scripts/check-boundaries.mjs — architecturePaths, architectureDrift, scan, main.
*/
test('the report names a missing declared path and a code file no component claims', () => {
  const root = fixture({
    'docs/ARCHITECTURE.md': architecturePage(
      '| Пилот `plugins/pilot-legal/` | файл → никто |',
      '| Ушедший `plugins/pilot-gone/` | ничего → никто |',
    ),
    'plugins/pilot-legal/tool.mjs': LEGAL,
    'plugins/pilot-extra/tool.mjs': LEGAL,
  })
  try {
    const drift = architectureDrift(root)
    assert.equal(drift.present, true)
    assert.equal(drift.components, true)
    assert.deepEqual(drift.paths, ['plugins/pilot-legal/', 'plugins/pilot-gone/'])
    assert.deepEqual(drift.missing, ['plugins/pilot-gone/'])
    assert.deepEqual(drift.unowned, ['plugins/pilot-extra/tool.mjs'])
    const report = reportOf(['--root', root])
    assert.equal(report.code, 0)
    assert.ok(report.text.includes('архитектура расходится с деревом'), report.text)
    assert.ok(report.text.includes('нет такого пути: plugins/pilot-gone/'), report.text)
    assert.ok(report.text.includes('файл кода вне компонентов: plugins/pilot-extra/tool.mjs'), report.text)
    // The drift is a report section: the findings and the gate's inputs do not see it.
    const result = scan(root)
    assert.deepEqual(result.open, [])
    assert.equal(result.stale.length, EXCEPTIONS.length, 'a fixture holds none of the excepted files')
    assert.equal(result.architecture.missing.length, 1)
    assert.equal(result.architecture.unowned.length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a wide drift prints the counts and five examples; --drift-all prints every path', () => {
  const modules = {
    'docs/ARCHITECTURE.md': architecturePage(
      '| Пилот `plugins/pilot-legal/` | файл → никто |',
      '| Ушедший `plugins/pilot-gone/` | ничего → никто |',
    ),
    'plugins/pilot-legal/tool.mjs': LEGAL,
  }
  for (let index = 0; index < 9; index += 1) modules['plugins/pilot-extra/tool-' + index + '.mjs'] = LEGAL
  const root = fixture(modules)
  try {
    const report = reportOf(['--root', root])
    assert.equal(report.code, 0)
    assert.ok(
      report.text.includes('  архитектура расходится с деревом (docs/ARCHITECTURE.md): объявлено путей: 2, нет в дереве: 1, файлов кода вне компонентов: 9'),
      report.text,
    )
    const examplesOf = (text) =>
      text.split('\n').filter((line) => line.startsWith('    нет такого пути: ') || line.startsWith('    файл кода вне компонентов: '))
    const examples = examplesOf(report.text)
    assert.equal(examples.length, DRIFT_EXAMPLES, 'the report prints ' + examples.length + ' examples')
    assert.ok(examples.includes('    нет такого пути: plugins/pilot-gone/'), 'the missing declared path is not named')
    assert.ok(report.text.includes('    ещё 5 — полный список: --drift-all или --json'), report.text)

    const full = reportOf(['--root', root, '--drift-all'])
    assert.equal(full.code, 0)
    assert.equal(examplesOf(full.text).length, 10, '--drift-all does not print the whole list')
    assert.equal(full.text.includes('ещё '), false, '--drift-all still says how many are left')

    const parsed = JSON.parse(reportOf(['--root', root, '--json']).text)
    assert.deepEqual(parsed.architecture.missing, ['plugins/pilot-gone/'])
    assert.equal(parsed.architecture.unowned.length, 9, '--json does not carry the complete list')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a missing architecture page says "архитектуры нет" and does not fail', () => {
  const root = fixture({ 'plugins/pilot-legal/tool.mjs': LEGAL })
  try {
    const drift = architectureDrift(root)
    assert.equal(drift.present, false)
    assert.deepEqual(drift.missing, [])
    assert.deepEqual(drift.unowned, [])
    const report = reportOf(['--root', root])
    assert.equal(report.code, 0)
    assert.ok(report.text.includes('архитектуры нет'), report.text)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an architecture table that matches the tree reports no drift', () => {
  const root = fixture({
    'docs/ARCHITECTURE.md': architecturePage('| Пилот `plugins/pilot-legal/` | файл → никто |'),
    'plugins/pilot-legal/tool.mjs': LEGAL,
  })
  try {
    const drift = architectureDrift(root)
    assert.deepEqual(drift.missing, [])
    assert.deepEqual(drift.unowned, [])
    const report = reportOf(['--root', root])
    assert.equal(report.code, 0)
    assert.ok(report.text.includes('архитектура сходится с деревом'), report.text)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an architecture page without a component table is a named state, not drift', () => {
  const root = fixture({
    'docs/ARCHITECTURE.md': '# Архитектура\n\nбез таблицы компонентов\n',
    'plugins/pilot-legal/tool.mjs': LEGAL,
  })
  try {
    const drift = architectureDrift(root)
    assert.equal(drift.present, true)
    assert.equal(drift.components, false)
    assert.deepEqual(drift.unowned, [])
    const report = reportOf(['--root', root])
    assert.equal(report.code, 0)
    assert.ok(report.text.includes('нет таблицы компонентов'), report.text)
  } finally {
    rmSync(root, { recursive: true, force: true })
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
