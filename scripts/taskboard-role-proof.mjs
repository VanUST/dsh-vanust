#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove the role/catalog/state contract end to end against the REAL plugin modules - the
 *   taskboard service the tools call and the orchestrator's exported helpers - on a
 *   disposable board. One run answers: can a role label switch presets behind the caller's
 *   back, is a preset-less row still offered for reuse, does the catalog show a (name, preset)
 *   pair once, does an erring child read as finished, and does reconciliation settle a stale
 *   `active` row without touching a live child.
 *
 * WHY IT EXISTS. Each of those was a real defect on ~/tasks/autolabel_pipeline (2026-11-11):
 *   `AUDIT [reviewer]` and `AUDIT [critic]` collapsed into one row whose preset the second
 *   delegation silently overwrote; four preset-less rows were listed as if reusable; a
 *   RESEARCH child died with `error` and its task stayed `active`. A check that cannot fail
 *   proves nothing, so this script is meant to be run against the previous modules too (see
 *   INPUTS) and observed red.
 *
 * INPUTS
 *   --taskboard <path>     taskboard module to test (default plugins/taskboard/taskboard.mjs)
 *   --orchestrator <path>  orchestrator module to test (default plugins/orchestrator/orchestrator.mjs)
 *   --dir <path>           scratch directory for the disposable board (default: a temp dir)
 *   Nothing in the caller's workspace is read or written: the board, the links file and the
 *   backups all live under `--dir`.
 *
 * OUTPUTS
 *   One PASS/FAIL line per check, then `n/m checks passed`; exit 0 when every check passed,
 *   1 otherwise. The failing lines are the defect list, so a red run is readable on its own.
 *
 * KEYWORDS
 *   role identity, preset conflict, legacy role, role catalog, taskboard, child error,
 *   reconciliation, regression proof
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The module paths are imported through `pathToFileURL`, so the same script proves the
 *     working tree and a checkout of an older revision on either platform.
 *   - Every check runs against one scratch directory and rewrites the board between groups;
 *     a failure is recorded, never thrown, so one defect does not hide the others.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const value = (name) => {
  const at = argv.indexOf(name)
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : ''
}
const taskboardModule = value('--taskboard') !== '' ? resolve(value('--taskboard')) : join(KIT, 'plugins', 'taskboard', 'taskboard.mjs')
const orchestratorModule = value('--orchestrator') !== '' ? resolve(value('--orchestrator')) : join(KIT, 'plugins', 'orchestrator', 'orchestrator.mjs')
const dir = value('--dir') !== '' ? resolve(value('--dir')) : mkdtempSync(join(tmpdir(), 'taskboard-role-proof-'))
mkdirSync(dir, { recursive: true })

const { createService } = await import(pathToFileURL(taskboardModule).href)
const { renderRoleCatalog, presetForRole, canReuseAgent } = await import(pathToFileURL(orchestratorModule).href)

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`)
}
const boardPath = join(dir, 'taskboard.json')
const reset = (agents = []) => writeFileSync(boardPath, `${JSON.stringify({ version: 1, revision: 1, tasks: [], agents }, null, 2)}\n`)
reset()
const svc = createService({ file: boardPath, linksFile: join(dir, 'links.json') }, { warn() {} }, {})
const cwd = dir

// 1. A role label keeps one preset.
svc.registerAgent(cwd, { role: 'AUDIT', sessionId: 'sess-reviewer', preset: 'reviewer', taskId: 't1' })
const conflict = svc.registerAgent(cwd, { role: 'AUDIT', sessionId: 'sess-critic', preset: 'critic', taskId: 't2' })
const row = svc.findAgent(cwd, 'AUDIT')
check('a role label cannot switch presets', conflict?.ok === false && conflict.code === 'preset_conflict', conflict)
check('the refused switch left the row untouched', row?.preset === 'reviewer' && row?.sessionId === 'sess-reviewer', { preset: row?.preset, sessionId: row?.sessionId })
check('force records the deliberate re-composition', svc.registerAgent(cwd, { role: 'AUDIT', sessionId: 'sess-critic', preset: 'critic', force: true })?.ok === true && svc.findAgent(cwd, 'AUDIT')?.preset === 'critic')

// 2. A preset-less row is legacy: visible as history, never a reuse target.
reset([{ role: 'DASHBOARD', label: 'DASHBOARD', sessionId: 'sess-old', status: 'sleeping', taskCount: 5, generation: 3, history: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }])
const legacy = svc.findAgent(cwd, 'DASHBOARD')
check('a preset-less row reads as legacy', legacy?.legacy === true, { preset: legacy?.preset ?? null, legacy: legacy?.legacy })
check('a legacy session is never reused', canReuseAgent(legacy, 'backend') === false)
const adopted = svc.registerAgent(cwd, { role: 'DASHBOARD', sessionId: 'sess-new', preset: 'backend' })
check('an explicit preset upgrades a legacy row and records it', adopted?.ok === true && svc.findAgent(cwd, 'DASHBOARD')?.history?.some((entry) => entry.adoptedAt !== undefined))

// 3. The catalog: one line per pair, ambiguity named, legacy excluded from reuse.
const catalog = renderRoleCatalog([
  { role: 'BACKEND', preset: 'backend', status: 'sleeping', taskCount: 52 },
  { role: 'AUDIT', preset: 'reviewer', status: 'sleeping', taskCount: 3 },
  { role: 'AUDIT', preset: 'critic', status: 'sleeping', taskCount: 4, conflict: true },
  { role: 'BACKEND', preset: 'backend', status: 'sleeping', taskCount: 52 },
  { role: 'DASHBOARD', status: 'sleeping', taskCount: 5, legacy: true },
])
check('the catalog lists a role once per (name, preset)', (catalog.match(/- BACKEND \[backend\]/g) ?? []).length === 1)
check('two presets for one name are called out as ambiguous', catalog.includes('ambiguous') && catalog.includes('REVIEWER judges a change, CRITIC attacks'))
check('legacy rows are in their own not-reusable section', catalog.includes('Legacy roles (history only - do not reuse)') && catalog.includes('- DASHBOARD - 5 tasks'))
check('AUDIT no longer resolves to a preset', presetForRole('AUDIT') === undefined && presetForRole('audit') === undefined)

// 4. A child that ended in error did not finish: the task is blocked, not "ready to accept".
reset()
const errTask = svc.create(cwd, { title: 'erring child', role: 'RESEARCH', preset: 'research', chatId: 'chat-1' })
svc.linkChild(cwd, { id: errTask.id, sessionId: 'child-err', label: 'RESEARCH', role: 'RESEARCH', chatId: 'chat-1' })
svc.childEnded('child-err', { stopReason: 'error' })
const errAfter = svc.get(cwd, errTask.id)
check('a child that ended in error blocks the task instead of review', errAfter?.status === 'blocked' && String(errAfter?.reason).includes('error'), { status: errAfter?.status, reason: errAfter?.reason })
const okTask = svc.create(cwd, { title: 'finishing child', role: 'BACKEND', preset: 'backend', chatId: 'chat-1' })
svc.linkChild(cwd, { id: okTask.id, sessionId: 'child-ok', label: 'BACKEND', role: 'BACKEND', chatId: 'chat-1' })
svc.childEnded('child-ok', { stopReason: 'stop' })
check('a child that finished still goes to review', svc.get(cwd, okTask.id)?.status === 'review')

// 5. Reconciliation settles the stale row and never touches a running child.
const stale = svc.create(cwd, { title: 'stale active', role: 'DESIGN', preset: 'ux', chatId: 'chat-1' })
svc.linkChild(cwd, { id: stale.id, sessionId: 'child-stale', label: 'DESIGN', role: 'DESIGN', chatId: 'chat-1' })
svc.childEnded('child-stale', { stopReason: 'error' })
const running = svc.create(cwd, { title: 'really running', role: 'CONFIG', preset: 'backend', chatId: 'chat-1' })
svc.linkChild(cwd, { id: running.id, sessionId: 'child-live', label: 'CONFIG', role: 'CONFIG', chatId: 'chat-1' })
// Reproduce the stuck shape the live path can leave behind: the child settled, the task did not move.
const raw = JSON.parse(readFileSync(boardPath, 'utf8'))
const staleRow = raw.tasks.find((task) => task.id === stale.id)
staleRow.status = 'active'
delete staleRow.reason
raw.tasks.find((task) => task.id === running.id).status = 'active'
writeFileSync(boardPath, JSON.stringify(raw))
const reconciled = typeof svc.reconcile === 'function' ? svc.reconcile(cwd) : { missing: true }
check('reconcile settles the stale row', svc.get(cwd, stale.id)?.status === 'blocked', { now: svc.get(cwd, stale.id)?.status, reconciled })
check('reconcile never touches a running child', svc.get(cwd, running.id)?.status === 'active', { now: svc.get(cwd, running.id)?.status, running: reconciled.running })
check('reconcile is idempotent', typeof svc.reconcile === 'function' && svc.reconcile(cwd).fixed === 0)

const failed = results.filter((entry) => !entry.ok)
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`)
process.exitCode = failed.length === 0 ? 0 : 1
