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
  // FR15: a batch task names its requirements in reqIds; one of them is enough.
  if (Array.isArray(task?.reqIds) && task.reqIds.some((id) => String(id).trim() !== '')) return true
  // FR8: a requirement-less task may exist only with an explicit, recorded waiver.
  if (task?.waiver !== undefined && task.waiver !== null && typeof task.waiver === 'object' && task.waiver.by === 'human' && typeof task.waiver.reason === 'string' && task.waiver.reason.trim() !== '') return true
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

/**
 * The concrete task the Tasks panel edits, in the shape a TASK row stores it. Every field is
 * present — an empty list or string CLEARS the value on update — because the board is the
 * source of truth for its task: dropping a scope line in the panel must drop it here too.
 *
 * The sessions come from `childSessionIds`, the one-child-one-task lease, not from the
 * historical `children[]` rows: a session handed to another task must not be offered as
 * this task's executor. `owner.sessionId` is the linked child the lease already names.
 */
export function taskSpecifics(task) {
  const strings = (value) => (Array.isArray(value) ? value.map((item) => String(item).trim()).filter((item) => item !== '') : [])
  const acceptance = (Array.isArray(task?.acceptance) ? task.acceptance : [])
    .map((entry) => (typeof entry === 'string' ? { text: entry.trim(), done: false } : { text: String(entry?.text ?? '').trim(), done: entry?.done === true }))
    .filter((entry) => entry.text !== '')
  const children = new Map((Array.isArray(task?.children) ? task.children : []).filter((child) => typeof child?.sessionId === 'string').map((child) => [child.sessionId, child]))
  const sessions = []
  const seen = new Set()
  for (const sessionId of Array.isArray(task?.childSessionIds) ? task.childSessionIds : []) {
    if (typeof sessionId !== 'string' || sessionId === '' || seen.has(sessionId)) continue
    seen.add(sessionId)
    const child = children.get(sessionId)
    sessions.push({
      sessionId,
      ...(typeof child?.label === 'string' && child.label !== '' ? { label: child.label } : {}),
      ...(typeof child?.role === 'string' && child.role !== '' ? { role: child.role } : {}),
      ...(typeof child?.status === 'string' && child.status !== '' ? { status: child.status } : {}),
    })
  }
  const result = task?.result !== null && typeof task?.result === 'object' ? task.result : {}
  const owner = task?.owner !== null && typeof task?.owner === 'object' && typeof task.owner.label === 'string' && task.owner.label.trim() !== ''
    ? {
        kind: task.owner.kind === 'human' ? 'human' : 'agent',
        label: task.owner.label.trim(),
        ...(typeof task.owner.sessionId === 'string' && task.owner.sessionId !== '' ? { sessionId: task.owner.sessionId } : {}),
      }
    : null
  return {
    scope: strings(task?.scope),
    nonScope: strings(task?.nonScope),
    acceptance,
    role: typeof task?.role === 'string' ? task.role.trim() : '',
    preset: typeof task?.preset === 'string' ? task.preset.trim() : '',
    inline: task?.inline === true,
    owner,
    sessions,
    reqIds: strings(task?.reqIds),
    steps: strings(task?.steps),
    stepsDone: Number.isSafeInteger(task?.stepsDone) ? task.stepsDone : 0,
    resultSummary: typeof result.summary === 'string' ? result.summary : '',
    resultEvidence: strings(result.evidence),
    resultArtifacts: strings(result.artifacts),
  }
}

/** The TASK payload of a board task. */
export function taskPayload(task) {
  const reqId = typeof task?.reqId === 'string' && task.reqId.trim() !== '' ? task.reqId.trim() : undefined
  return {
    title: String(task?.title ?? '').slice(0, 140),
    status: STATUS[task?.status] ?? 'open',
    ...(reqId === undefined ? {} : { reqId }),
    // FR15: the batch — several requirements, the steps and their progress — travels with the
    // TASK, so the register and the board agree on what one acceptance unit covers.
    ...taskSpecifics(task),
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
