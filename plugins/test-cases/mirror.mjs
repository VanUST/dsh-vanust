/**
 * PURPOSE
 *   Mirror one case of `docs/cases/` into the project state as a TEST row, so the register knows
 *   which REQ a test protects, who wrote it and which runs back its verification.
 *
 * THE FIELDS THE REGISTER NEEDS
 *   reqId, authorRole, testPath, runCommand, a FROZEN hash of the test's identity (the text a
 *   later edit would silently change), the evidence refs of its recorded runs and its status.
 *   The row is found again by `caseId`, so an update rewrites the same TEST.
 *
 * WHAT THIS MODULE DOES NOT DO
 *   It does not run anything and does not decide whether a run passed: it copies the run records
 *   the runner already wrote into `evidenceRefs` as `<runId>:<mode>:<pass|fail>`.
 */

import { createHash } from 'node:crypto'

const STATUS = {
  unverified: 'unverified',
  verified: 'verified',
  failing: 'failing',
  stale: 'stale',
}

/** The frozen identity of the test: what it is, not how the file is formatted. */
export function frozenHashOf(record) {
  const identity = [record?.reqId ?? '', record?.authorRole ?? '', record?.testPath ?? '', record?.runCommand ?? '', record?.negativeControl ?? '', record?.kind ?? 'regression'].join('\u0000')
  return createHash('sha256').update(identity, 'utf8').digest('hex')
}

/** The run refs: one `<runId>:<mode>:<pass|fail>` per recorded run, newest last. */
export function evidenceRefsOf(record) {
  const runs = Array.isArray(record?.runs) ? record.runs : []
  return runs
    .filter((run) => run !== null && typeof run === 'object')
    .map((run) => `${String(run.runId ?? '')}:${String(run.mode ?? 'green')}:${run.passed === true ? 'pass' : 'fail'}`)
    .filter((ref) => !ref.startsWith(':'))
}

/** The TEST payload of a case. */
export function testPayload(record) {
  return {
    title: String(record?.title ?? '').slice(0, 140),
    status: STATUS[record?.status] ?? 'unverified',
    reqId: String(record?.reqId ?? ''),
    authorRole: String(record?.authorRole ?? ''),
    command: String(record?.runCommand ?? ''),
    testPath: String(record?.testPath ?? ''),
    frozenHash: frozenHashOf(record),
    evidenceRefs: evidenceRefsOf(record),
    caseId: String(record?.id ?? ''),
    body: String(record?.requirement ?? ''),
  }
}

/**
 * Create or update the TEST that mirrors one case.
 *
 * @returns {{ok: boolean, action?: 'created'|'updated', testId?: string, code?: string, message?: string}}
 */
export async function mirrorCase(core, { cwd, record }) {
  if (core === undefined || core === null) return { ok: true, skipped: 'no-core' }
  const state = typeof core.open === 'function' ? core.open(cwd) : core
  let rows = []
  try {
    const listed = await state.list('test')
    rows = Array.isArray(listed?.rows) ? listed.rows : []
  } catch {
    rows = []
  }
  const payload = testPayload(record)
  const existing = rows.find((row) => row.caseId === record.id)
  try {
    if (existing === undefined) {
      const created = await state.create('test', payload)
      if (created?.ok === false) return { ok: false, code: created.code, message: created.message }
      return { ok: true, action: 'created', testId: created.id }
    }
    const updated = await state.update(existing.id, { expectedRevision: existing.revision, ...payload })
    if (updated?.ok === false) return { ok: false, code: updated.code, message: updated.message }
    return { ok: true, action: 'updated', testId: existing.id }
  } catch (error) {
    return { ok: false, code: 'mirror_failed', message: error instanceof Error ? error.message : String(error) }
  }
}
