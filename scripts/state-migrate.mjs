#!/usr/bin/env node
/**
 * PURPOSE
 *   Fill the project state register from the sources that predate it, without rewriting them:
 *     docs/analysis/*.json  -> REQ   (one requirement = one REQ, analysisRef + criteria +
 *                                     criteriaHash, status by the plan rule)
 *     .dsh/taskboard.json   -> TASK  (boardId = board task id, status, revision; a task keeps its
 *                                     reqId/chore only when the source data says so)
 *     docs/cases/*.json     -> TEST  (caseId, reqId, authorRole, testPath, runCommand,
 *                                     frozenHash, evidenceRefs from the recorded runs, status)
 *
 * IDEMPOTENT: a row is found again by its source key (analysisRef / boardId / caseId) and
 * skipped, so a second run creates nothing and leaves every byte in `state/` unchanged.
 *
 * WHAT IT NEVER DOES
 *   It does not write, move or delete anything outside `state/`; the sources stay as they are.
 *
 * USAGE
 *   node scripts/state-migrate.mjs [--cwd DIR] [--dry-run]
 */

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createStateService } from '../plugins/project-state/lib/core.mjs'
import { criteriaHashOf, reqStatusOf } from '../plugins/analysis/mirror.mjs'
import { evidenceRefsOf, frozenHashOf } from '../plugins/test-cases/mirror.mjs'

const args = process.argv.slice(2)
const cwdIndex = args.indexOf('--cwd')
const cwd = resolve(cwdIndex >= 0 && args[cwdIndex + 1] !== undefined ? args[cwdIndex + 1] : process.cwd())
const dryRun = args.includes('--dry-run')

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const listDir = async (path, suffix) => {
  try {
    return (await readdir(path)).filter((name) => name.endsWith(suffix)).sort()
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

/** The sources as data: records, requirements, board tasks, cases. */
async function readSources(root) {
  const analysis = []
  for (const name of await listDir(join(root, 'docs', 'analysis'), '.json')) {
    const record = await readJson(join(root, 'docs', 'analysis', name))
    for (const requirement of Array.isArray(record.requirements) ? record.requirements : []) {
      analysis.push({ record, requirement })
    }
  }
  let tasks = []
  if (existsSync(join(root, '.dsh', 'taskboard.json'))) {
    tasks = (await readJson(join(root, '.dsh', 'taskboard.json'))).tasks ?? []
  }
  const cases = []
  for (const name of await listDir(join(root, 'docs', 'cases'), '.json')) {
    if (name.startsWith('.')) continue
    const record = await readJson(join(root, 'docs', 'cases', name))
    if (record.id !== undefined) cases.push(record)
  }
  return { analysis, tasks, cases }
}

/** The REQ payload of one analysis requirement (same shape the analysis mirror writes). */
function reqPayload(record, requirement) {
  const acceptance = Array.isArray(requirement.acceptance) ? requirement.acceptance.map(String) : []
  const analysisRef = { initiative: String(record.id ?? ''), requirementId: String(requirement.id ?? '') }
  return {
    title: String(requirement.text ?? requirement.id ?? ''),
    criteria: acceptance,
    criteriaHash: criteriaHashOf(acceptance),
    analysisRef,
    status: reqStatusOf(requirement.status),
    source: 'agent',
    body: String(requirement.text ?? ''),
  }
}

/** The TASK payload of one board task; reqId/chore only when the source carries them. */
function taskPayload(task) {
  const status = task.status === 'paused' ? 'blocked' : task.status
  const payload = {
    title: String(task.title ?? 'Untitled'),
    status: ['open', 'active', 'review', 'done', 'blocked', 'cancelled'].includes(status) ? status : 'open',
    ownerRole: typeof task.role === 'string' && task.role !== '' ? task.role : undefined,
    boardId: String(task.id ?? ''),
    body: [String(task.objective ?? ''), `Migrated from .dsh/taskboard.json (task ${task.id}, revision ${task.revision ?? 1}).`].filter((part) => part !== '').join('\n\n'),
  }
  if (typeof task.reqId === 'string' && task.reqId.trim() !== '') payload.reqId = task.reqId.trim()
  // A chore is recorded only when the source says it: the migration never invents a justification.
  if (task.chore === true) payload.chore = true
  if (typeof task.choreReason === 'string' && task.choreReason.trim() !== '') payload.choreReason = task.choreReason.trim()
  if (task.ownerRole !== undefined) payload.ownerRole = String(task.ownerRole)
  return payload
}

/** The TEST payload of one case, reusing the test-cases mirror's frozen hash and run refs. */
function testPayload(record) {
  const status = ['unverified', 'verified', 'failing', 'stale'].includes(record.status) ? record.status : 'unverified'
  const payload = {
    title: String(record.title ?? record.id ?? '').slice(0, 140),
    status,
    caseId: String(record.id ?? ''),
    frozenHash: frozenHashOf(record),
    evidenceRefs: evidenceRefsOf(record),
    body: String(record.requirement ?? ''),
  }
  if (typeof record.reqId === 'string' && record.reqId !== '') payload.reqId = record.reqId
  const author = typeof record.authorRole === 'string' && record.authorRole !== '' ? record.authorRole : (typeof record.createdBy === 'string' ? record.createdBy : '')
  if (author !== '' && author !== 'agent') payload.authorRole = author
  if (typeof record.runCommand === 'string' && record.runCommand !== '') payload.command = record.runCommand
  if (typeof record.testPath === 'string' && record.testPath !== '') payload.testPath = record.testPath
  return payload
}

const keyOfRef = (row) => `${row.analysisRef?.initiative ?? ''}::${row.analysisRef?.requirementId ?? ''}`

/** Migrate one source family; returns `{created, skipped, ids}`. */
async function migrateFamily(core, kind, rows, keyOfRow, payloadOfRow, existingKey, label) {
  const existing = await core.list(kind)
  const known = new Map()
  for (const row of existing.rows) {
    const key = existingKey(row)
    if (key !== '') known.set(key, row.id)
  }
  const report = { label, source: rows.length, created: 0, skipped: 0, ids: [] }
  for (const row of rows) {
    const key = keyOfRow(row)
    if (key === '') { report.skipped += 1; continue }
    if (known.has(key)) { report.skipped += 1; continue }
    if (dryRun) { report.created += 1; continue }
    const payload = payloadOfRow(row)
    for (const field of Object.keys(payload)) if (payload[field] === undefined) delete payload[field]
    const created = await core.create(kind, payload)
    if (created?.ok === false) throw new Error(`${label}: ${payload.title ?? key}: ${created.code} ${created.message ?? ''}`)
    known.set(key, created.id)
    report.created += 1
    report.ids.push(created.id)
  }
  return report
}

/** The state/ files, sorted with their sha256, for the idempotency check. */
async function hashState(root) {
  const crypto = await import('node:crypto')
  const out = []
  const walk = async (dir) => {
    let names = []
    try { names = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name !== '.lock' && !entry.name.endsWith('.tmp')) {
        out.push(`${path.slice(root.length + 1)} ${crypto.createHash('sha256').update(await readFile(path)).digest('hex')}`)
      }
    }
  }
  await walk(join(root, 'state'))
  return out
}

async function main() {
  const sources = await readSources(cwd)
  const core = createStateService({ cwd })
  const reqs = await migrateFamily(core, 'req', sources.analysis,
    (row) => `${row.record.id}::${row.requirement.id}`, (row) => reqPayload(row.record, row.requirement),
    (row) => keyOfRef(row), 'REQ')
  const tasks = await migrateFamily(core, 'task', sources.tasks,
    (task) => String(task.id ?? ''), (task) => taskPayload(task),
    (row) => String(row.boardId ?? ''), 'TASK')
  const tests = await migrateFamily(core, 'test', sources.cases,
    (record) => String(record.id ?? ''), (record) => testPayload(record),
    (row) => String(row.caseId ?? ''), 'TEST')
  const tasksWithoutReq = sources.tasks.filter((task) => typeof task.reqId !== 'string' || task.reqId.trim() === '').length
  const casesWithoutReq = sources.cases.filter((record) => typeof record.reqId !== 'string' || record.reqId.trim() === '').length
  if (!dryRun) await core.regenerateViews()
  const verdict = dryRun ? null : await core.verify()
  const stateHashes = dryRun ? [] : await hashState(cwd)
  const result = {
    ok: true,
    cwd,
    dryRun,
    sources: { analysisRecords: new Set(sources.analysis.map((row) => row.record.id)).size, requirements: sources.analysis.length, tasks: sources.tasks.length, cases: sources.cases.length },
    migrated: { req: reqs, task: tasks, test: tests },
    notes: {
      tasksWithoutReq,
      casesWithoutReq,
      hint: 'a TASK without reqId and without chore+reason is reported by verify() as task_req_missing; the migration does not invent a justification',
    },
    verify: verdict === null ? null : { ok: verdict.ok, findings: (verdict.findings ?? []).length, codes: [...new Set((verdict.findings ?? []).map((finding) => finding.code))].sort() },
    stateFiles: stateHashes.length,
    stateHashes,
  }
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(`state-migrate: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
