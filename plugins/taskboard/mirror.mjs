/**
 * PURPOSE
 *   Mirror one taskboard task into the project state as a TASK row, and hold the board's new
 *   precondition: a task needs a `reqId` (the REQ it implements) or an explicit `chore: true`
 *   with a non-empty `choreReason`. The TASK is found again by `boardId`, so every update of the
 *   board task updates the SAME state file.
 *
 * WHY THE REFUSAL IS HERE AND NOT IN THE TOOL
 *   `delegate_task`, `task_create` and the UI all reach the service; the precondition belongs
 *   where the write happens. It is enforced only when a project-state core is mounted: a
 *   composition without it keeps the old taskboard behaviour, which the existing proof scripts
 *   exercise directly.
 */

const STATUS = {
  open: 'open',
  active: 'active',
  review: 'review',
  blocked: 'blocked',
  done: 'done',
  cancelled: 'cancelled',
  paused: 'blocked',
}

/** Does this task carry a requirement reference or a justified chore? */
export function hasRequirement(task) {
  const reqId = typeof task?.reqId === 'string' ? task.reqId.trim() : ''
  if (reqId !== '') return true
  const reason = typeof task?.choreReason === 'string' ? task.choreReason.trim() : ''
  return task?.chore === true && reason !== ''
}

/** The refusal for `task_create`/`task_update` when the requirement is missing. */
export function reqRefusal() {
  return {
    ok: false,
    code: 'req_required',
    message: 'a task needs a reqId (the REQ it implements) or chore:true with a non-empty choreReason; link it to a requirement first (analysis_upsert mirrors requirements into REQ)',
  }
}

/** The TASK payload of a board task. */
export function taskPayload(task) {
  const reqId = typeof task?.reqId === 'string' && task.reqId.trim() !== '' ? task.reqId.trim() : undefined
  return {
    title: String(task?.title ?? '').slice(0, 140),
    status: STATUS[task?.status] ?? 'open',
    ...(reqId === undefined ? {} : { reqId }),
    ...(task?.chore === true ? { chore: true } : {}),
    ...(typeof task?.choreReason === 'string' && task.choreReason.trim() !== '' ? { choreReason: task.choreReason.trim() } : {}),
    boardId: String(task?.id ?? ''),
    body: typeof task?.objective === 'string' ? task.objective : '',
  }
}

/**
 * Create or update the TASK that mirrors one board task.
 *
 * @returns {{ok: boolean, action?: 'created'|'updated', taskId?: string, code?: string, message?: string}}
 */
export async function mirrorTask(core, { cwd, task }) {
  if (core === undefined || core === null) return { ok: true, skipped: 'no-core' }
  if (!hasRequirement(task)) return reqRefusal()
  const state = typeof core.open === 'function' ? core.open(cwd) : core
  const payload = taskPayload(task)
  let rows = []
  try {
    const listed = await state.list('task')
    rows = Array.isArray(listed?.rows) ? listed.rows : []
  } catch {
    rows = []
  }
  const existing = rows.find((row) => row.boardId === task.id)
  try {
    if (existing === undefined) {
      const created = await state.create('task', payload)
      if (created?.ok === false) return { ok: false, code: created.code, message: created.message }
      return { ok: true, action: 'created', taskId: created.id }
    }
    const updated = await state.update(existing.id, { expectedRevision: existing.revision, ...payload })
    if (updated?.ok === false) return { ok: false, code: updated.code, message: updated.message }
    return { ok: true, action: 'updated', taskId: existing.id }
  } catch (error) {
    return { ok: false, code: 'mirror_failed', message: error instanceof Error ? error.message : String(error) }
  }
}
