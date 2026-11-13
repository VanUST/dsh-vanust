#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove the taskboard's two limits are separate and that `maxTasks: 0` is a real
 *   UNLIMITED rather than a fallback to the 200 default.
 *
 * WHY IT EXISTS. On this workspace the board held more than 200 actionable rows and
 * `task_create` answered `board_full`; the only way to start work was to close a task that
 * was not finished. The requirement is exact: `maxTasks: 0` means no work-in-flight cap,
 * a missing or unusable value still means 200, and the FILE guard (`board_rows_full`) is
 * untouched. A check that cannot fail proves nothing, so this script also runs against an
 * earlier revision of the module (see INPUTS) and is expected to go red there.
 *
 * INPUTS
 *   --taskboard <path>  module under test (default plugins/taskboard/taskboard.mjs)
 *   --dir <path>        scratch directory (default: a fresh temp dir). Nothing in the
 *                       caller's workspace is read or written.
 *
 * OUTPUTS
 *   One PASS/FAIL line per check, then `n/m checks passed`; exit 0 only when every check
 *   passed. A red line names the defect, so the run is readable on its own.
 *
 * KEYWORDS
 *   taskboard, maxTasks, unlimited, board_full, board_rows_full, file guard, regression proof
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The ledger is built by the service itself (210 real `create` calls against a 1,000-row
 *     file guard), not by writing JSON by hand, so the fixture cannot encode a shape the
 *     service would refuse.
 *   - `maxRows` is exercised on its own board with its own cap, so the file guard is proven
 *     to still refuse while the work cap is unlimited.
 *   - A create that is refused must leave the file byte-identical: "history is not deleted"
 *     is checked as a row count and a hash, not as an absence of exceptions.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const value = (name) => {
  const at = argv.indexOf(name)
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : ''
}
const modulePath = value('--taskboard') !== '' ? resolve(value('--taskboard')) : join(KIT, 'plugins', 'taskboard', 'taskboard.mjs')
const dir = value('--dir') !== '' ? resolve(value('--dir')) : mkdtempSync(join(tmpdir(), 'taskboard-limit-proof-'))
mkdirSync(dir, { recursive: true })

const { createService } = await import(pathToFileURL(modulePath).href)
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}
const quiet = { warn() {}, info() {}, debug() {} }
const hash = (path) => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent')

/** A service over its own scratch board; `config` is the loader row's `config`. */
function service(name, config) {
  const workspace = join(dir, name)
  mkdirSync(workspace, { recursive: true })
  const svc = createService({ file: join(workspace, 'board.json'), linksFile: join(workspace, 'links.json'), ...config }, quiet)
  return { svc, workspace, file: svc.pathFor(workspace) }
}

/** Fill a board with `count` actionable rows through the service's own create path. */
function fill(box, count) {
  for (let i = 0; i < count; i += 1) {
    box.svc.create(box.workspace, { title: `row ${i + 1}`, objective: 'fixture row', role: 'BACKEND' })
  }
  return box.svc.list(box.workspace, { all: true }).length
}

// ── 1. maxTasks: 0 is UNLIMITED ───────────────────────────────────────────────
const unlimited = service('unlimited', { maxTasks: 0, maxRows: 1000 })
const filled = fill(unlimited, 210)
check('the fixture board really holds 210 actionable rows', filled === 210, `rows=${filled}`)
const before = hash(unlimited.file)
const created = unlimited.svc.create(unlimited.workspace, { title: 'the 211th task', role: 'BACKEND' })
const after = hash(unlimited.file)
// A successful create returns the TASK; a refusal returns { ok:false, code }. Both shapes
// are asserted by name, so a change that starts returning `ok:true` on the create path is a
// separate, visible break rather than a silent pass here.
const accepted = (value) => typeof value?.id === 'string' && value?.ok !== false
check(
  'maxTasks: 0 accepts a create on a board with 210 actionable rows',
  accepted(created),
  JSON.stringify({ id: created?.id ?? null, code: created?.code ?? null }),
)
check(
  'the accepted create APPENDS: 211 rows, every earlier row still there',
  unlimited.svc.list(unlimited.workspace, { all: true }).length === 211 && before !== after,
  `rows=${unlimited.svc.list(unlimited.workspace, { all: true }).length}`,
)
// A second real task, past the old cap by two, so the result is not a one-off.
const again = unlimited.svc.create(unlimited.workspace, { title: 'the 212th task', role: 'BACKEND' })
check('a second create past the old cap also passes', accepted(again), `id=${again?.id ?? 'none'} code=${again?.code ?? 'none'}`)

// ── 2. the default survives as the default ────────────────────────────────────
for (const [label, config] of [
  ['missing maxTasks', {}],
  ['maxTasks: null', { maxTasks: null }],
  ['maxTasks: "300"', { maxTasks: '300' }],
  ['maxTasks: -5', { maxTasks: -5 }],
  ['maxTasks: 0.5', { maxTasks: 0.5 }],
]) {
  const box = service(`default-${label.replaceAll(/[^a-z0-9]+/gi, '-')}`, config)
  fill(box, 200)
  const refused = box.svc.create(box.workspace, { title: 'over the default cap', role: 'BACKEND' })
  check(
    `${label} still means the 200 default (board_full)`,
    refused?.ok === false && refused?.code === 'board_full',
    `code=${refused?.code ?? 'none'} active=${refused?.active ?? 'n/a'} cap=${refused?.cap ?? 'n/a'}`,
  )
}

// ── 3. an explicit finite cap still works ─────────────────────────────────────
const finite = service('finite-5', { maxTasks: 5 })
fill(finite, 5)
const over = finite.svc.create(finite.workspace, { title: 'over five', role: 'BACKEND' })
check('maxTasks: 5 refuses the sixth actionable row with board_full', over?.ok === false && over?.code === 'board_full', `code=${over?.code ?? 'none'} cap=${over?.cap ?? 'n/a'}`)

// ── 4. the FILE guard is untouched and still refuses ──────────────────────────
const rows = service('rows-10', { maxTasks: 0, maxRows: 10 })
fill(rows, 10)
const rowsBefore = hash(rows.file)
const refusedRows = rows.svc.create(rows.workspace, { title: 'past the row guard', role: 'BACKEND' })
check(
  'maxRows still refuses with board_rows_full while maxTasks is unlimited',
  refusedRows?.ok === false && refusedRows?.code === 'board_rows_full',
  `code=${refusedRows?.code ?? 'none'} rows=${refusedRows?.rows ?? 'n/a'} cap=${refusedRows?.cap ?? 'n/a'}`,
)
check('the refused create did not touch the file', hash(rows.file) === rowsBefore && rows.svc.list(rows.workspace, { all: true }).length === 10, `rows=${rows.svc.list(rows.workspace, { all: true }).length}`)

// ── 5. history is never rewritten to make room ────────────────────────────────
const history = service('history', { maxTasks: 0 })
fill(history, 205)
for (let i = 0; i < 5; i += 1) history.svc.create(history.workspace, { title: `tail ${i}`, role: 'BACKEND' })
const titles = history.svc.list(history.workspace, { all: true }).map((task) => task.title)
check(
  'raising the cap NEVER evicts: all 210 titles survive in order',
  titles.length === 210 && titles[0] === 'row 1' && titles[204] === 'row 205' && titles[209] === 'tail 4',
  `rows=${titles.length} first=${titles[0]} last=${titles[209]}`,
)

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exitCode = passed === results.length ? 0 : 1
