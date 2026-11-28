/* @cc/dsh-project-state-panel — the Project state panel.
 *
 * One panel, four modes over ONE selection:
 *   Requirements   the REQ registry with criteria and its gaps
 *   Board          TASK grouped by status, filtered by the selected REQ
 *   Design map     the designmap PAGE EDITOR over designmap/pages/*.excalidraw (v2 P2)
 *   Tests & trace  TEST rows and the REQ x TASK/TEST/DECISION matrix
 *
 * Data: `state/views/index.json` is the link contract. The entity files under
 * `state/req|task|test|decision/` are read only for the fields index.json does not carry
 * (title, criteria, body, command, revision); the panel never parses a markdown projection.
 * The map-to-requirement link comes from the analysis records (`docs/analysis/*.json`,
 * `trace[].componentId`), because index.json carries no map link; the matcher is exact id,
 * dotted suffix, then `node.id = <componentId>`.
 *
 * Writes: TWO, both the owner's, both through the command Remote. The status badge (in the list,
 * on a board card and in the task drawer) runs the taskboard's `owner-status` op, because the
 * board owns that row. The Edit tab runs the state core's `/state` command for any field of a
 * REQ, TASK or TEST: the core writes, checks the revision, journals `origin: human` and marks the
 * field as the owner's own (`manualFields`), so a later mirror leaves it alone. The panel writes
 * no file itself, and the header badge says so.
 */
window.__ModuleLoader__.load({
  id: '@cc/dsh-project-state-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const designmap = require('@cc/dsh-designmap')
    // v2 P2: the design map mode hosts the PAGE EDITOR, not the v1 React Flow scene. The client
    // external stays in package.json; only the import target changes.
    const PageEditor = designmap !== null && typeof designmap === 'object' ? designmap.PageEditor : undefined
    const createDesignmapHost = designmap !== null && typeof designmap === 'object' ? designmap.createRemoteHost : undefined

    const PANEL_ID = 'project-state'
    const SESSION_KEY = 'dsh:project-state-panel:session'
    // A WINDOW EVENT, NOT A SHARED STORE. The panel and the session header are two slots of the
    // same document, so a status the owner just wrote can move the header counters immediately
    // instead of waiting for their five-second poll (REQ-136: the panel shows the new status
    // without a reload).
    const STATE_CHANGED_EVENT = 'dsh:project-state-changed'
    const INDEX_PATH = 'state/views/index.json'
    const ANALYSIS_DIR = 'docs/analysis'
    // THE LONG-TERM PLAN IS READ FROM ITS GENERATED VIEW, NOT FROM state/plan.yaml: the yaml is a
    // summary that lists ten initiatives and points at this file for the rest ("+20 more ..."),
    // so the full view is the only one that answers "what is the plan" in one read.
    const PLAN_VIEW_PATH = 'state/views/plan.md'
    const KIND_DIR = { req: 'req', task: 'task', test: 'test', decision: 'decision' }
    const KIND_LABEL = { req: 'REQ', task: 'TASK', test: 'TEST', decision: 'DEC', evidence: 'EVIDENCE', node: 'NODE' }
    const KIND_NAME = { req: 'Requirement', task: 'Task', test: 'Test', decision: 'Decision', evidence: 'Evidence', node: 'Map node' }
    // The prototype's entity grammar: one colour per type, used only as the chip marker and
    // as a tint; the text stays the theme's ink so contrast does not depend on the type.
    const TYPE_COLOR = { req: '#FFB020', task: '#38BDF8', test: '#A3E635', decision: '#E879F9', evidence: '#22D3EE', node: '#94A3B8' }
    const TASK_COLUMNS = [
      { id: 'open', label: 'Open', statuses: ['open'] },
      { id: 'active', label: 'Active', statuses: ['active'] },
      { id: 'review', label: 'Review', statuses: ['review'] },
      { id: 'blocked', label: 'Blocked', statuses: ['blocked'] },
      { id: 'done', label: 'Done', statuses: ['done', 'cancelled'] },
    ]
    // Relevance is the owner's reading order (D3): work in flight first, history at the bottom.
    // Inside a status the task that has moved furthest comes first, then the newest update, then id.
    const STATUS_RELEVANCE = { active: 0, blocked: 1, review: 2, open: 3, done: 4, cancelled: 5 }
    const SORT_TAGS = [
      { id: 'relevance', label: 'Relevance', title: 'Active, blocked, review, open, done, cancelled; then more steps done, newest update, id' },
      { id: 'updated', label: 'Updated', title: 'Newest update first' },
      { id: 'status', label: 'Status', title: 'Status name A–Z, newest update, id' },
      { id: 'title', label: 'Title', title: 'Task title A–Z, id' },
    ]
    // THE OWNER'S STATUS CONTROL offers the six statuses the TASK registry holds. `paused` is a
    // board state the register maps to blocked (the mirror's STATUS table), so offering it here
    // would show a status the panel cannot read back.
    const TASK_STATUS_CHOICES = ['open', 'active', 'review', 'blocked', 'done', 'cancelled']

    function statusRank(status) {
      return Object.prototype.hasOwnProperty.call(STATUS_RELEVANCE, status) ? STATUS_RELEVANCE[status] : 6
    }

    function byIdAsc(left, right) {
      return String(left.id).localeCompare(String(right.id))
    }

    /** A copy, sorted: the callers pass projection rows and must never see them reordered. */
    function sortTasks(rows, sort) {
      const list = Array.isArray(rows) ? rows.slice() : []
      if (sort === 'updated') {
        return list.sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')) || byIdAsc(left, right))
      }
      if (sort === 'status') {
        return list.sort((left, right) => String(left.status ?? '').localeCompare(String(right.status ?? '')) || String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')) || byIdAsc(left, right))
      }
      if (sort === 'title') {
        return list.sort((left, right) => String(left.title ?? '').toLowerCase().localeCompare(String(right.title ?? '').toLowerCase()) || byIdAsc(left, right))
      }
      return list.sort((left, right) => (statusRank(left.status) - statusRank(right.status))
        || ((Number(right.stepsDone) || 0) - (Number(left.stepsDone) || 0))
        || String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''))
        || byIdAsc(left, right))
    }

    /** Unfinished = not done and not cancelled; active = the status "active" itself. */
    function taskCounts(tasks) {
      let unfinished = 0
      let active = 0
      for (const row of Array.isArray(tasks) ? tasks : []) {
        if (row?.status === 'active') active += 1
        if (row?.status !== 'done' && row?.status !== 'cancelled') unfinished += 1
      }
      return { unfinished, active }
    }

    /** The root session of a chat: a child's work is the chat's work (same walk as the taskboard). */
    function chatRootOf(sessionId, sessionsById) {
      if (typeof sessionId !== 'string' || sessionId === '') return ''
      let id = sessionId
      for (let hop = 0; hop < 8; hop += 1) {
        const parent = sessionsById?.[id]?.parentId
        if (typeof parent !== 'string' || parent === '') break
        if (sessionsById?.[parent] === undefined) break
        id = parent
      }
      return id
    }

    /** Live child sessions of this chat: a running subagent of the chat root, never the current one. */
    function activeSubagents(sessionsById, sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return 0
      const root = chatRootOf(sessionId, sessionsById)
      let count = 0
      for (const [id, summary] of Object.entries(sessionsById ?? {})) {
        if (id === sessionId) continue
        if (summary?.origin !== 'subagent' || summary?.running !== true) continue
        if (chatRootOf(id, sessionsById) === root) count += 1
      }
      return count
    }

    /**
     * One list row: index.json carries id/status/reqId (and sometimes steps), the entity
     * frontmatter carries title, steps/stepsDone, reqIds and updatedAt. Read-only merge.
     */
    function taskRow(task, entities, sessionsById = {}) {
      const entity = typeof entities?.get === 'function' ? entities.get(task.id) : undefined
      const fm = entity?.frontmatter ?? {}
      // The index carries the step COUNT; the planned list is in the entity file the drawer
      // fetches on open (a list per task was what pushed the index over one gateway page).
      const steps = typeof task.steps === 'number'
        ? task.steps
        : (Array.isArray(task.steps) ? task.steps.length : (Array.isArray(fm.steps) ? fm.steps.length : 0))
      const rawDone = task.stepsDone !== undefined ? task.stepsDone : fm.stepsDone
      const stepsDone = typeof rawDone === 'number' && Number.isFinite(rawDone) ? rawDone : 0
      const reqIds = requirementIdsOf(task, fm)
      const sessions = taskSessions({ ...fm, status: task.status ?? fm.status }, sessionsById)
      return {
        id: task.id,
        status: task.status,
        title: titleOf(entity, typeof task.title === 'string' && task.title !== '' ? task.title : task.id),
        reqIds,
        chore: task.chore === true || fm.chore === true,
        steps,
        stepsDone,
        updatedAt: String(fm.updatedAt ?? task.updatedAt ?? ''),
        role: typeof task.role === 'string' && task.role !== '' ? task.role : (typeof fm.role === 'string' ? fm.role : ''),
        preset: typeof task.preset === 'string' && task.preset !== '' ? task.preset : (typeof fm.preset === 'string' ? fm.preset : ''),
        inline: task.inline === true || fm.inline === true,
        sessions,
        // LIVE, NOT THE STATUS: a task stays `active` until it is accepted, while its child
        // may be idle or gone. The count is what the list shows beside the status.
        running: sessions.filter((session) => session.running).length,
      }
    }

    /**
     * THE REQUIREMENTS ONE TASK IS LINKED TO. A batch task carries `reqIds` and no `reqId`; the
     * card and the drawer used to read only `reqId`, so a task with two requirements read as
     * "no requirement" there and vanished from a board filtered by either one. One helper, used
     * by the list, the card, the drawer, the filter and the header count, so the four cannot
     * disagree again. Both spellings are folded: the row's and the entity's.
     */
    function requirementIdsOf(row, fm = {}) {
      const single = typeof row?.reqId === 'string' && row.reqId !== ''
        ? [row.reqId]
        : (typeof fm?.reqId === 'string' && fm.reqId !== '' ? [fm.reqId] : [])
      const listed = Array.isArray(row?.reqIds) ? row.reqIds : (Array.isArray(fm?.reqIds) ? fm.reqIds : [])
      const ids = []
      for (const value of [...listed, ...single]) {
        const id = String(value ?? '').trim()
        if (id !== '' && !ids.includes(id)) ids.push(id)
      }
      return ids
    }

    /**
     * IS THIS A CHORE? A chore is work the board keeps next to the requirement-linked tasks and
     * that the owner may want out of the view. The index row carries the flag; an older or a
     * hand-written TASK may only carry it in its frontmatter, so both are read.
     */
    function isChoreTask(row, fm = {}) {
      return row?.chore === true || fm?.chore === true
    }

    /**
     * The `/taskboard` request for one owner status change: the board id the TASK records, the
     * target status and the reason. A TASK without a board row is refused with `no_board_row`
     * instead of writing a status the next mirror would overwrite.
     */
    function taskStatusRequest(entity, status) {
      const fm = entity?.frontmatter ?? {}
      const boardId = typeof fm.boardId === 'string' ? fm.boardId.trim() : ''
      if (boardId === '') {
        return { ok: false, code: 'no_board_row', message: 'this TASK has no board row (boardId), so the panel cannot change its status' }
      }
      if (!TASK_STATUS_CHOICES.includes(status)) {
        return { ok: false, code: 'status_invalid', message: `status "${String(status)}" is not one of ${TASK_STATUS_CHOICES.join(', ')}` }
      }
      return { ok: true, boardId, status }
    }

    /**
     * One `/taskboard` reply, as the command Remote returns it: `value.result` is
     * `{kind:'success', text}` or `{kind:'error', text: "taskboard: CODE; message"}`. A refusal
     * keeps its code so the panel can quote it rather than paraphrase.
     */
    function parseTaskboardReply(result) {
      if (result === null || result === undefined) return { ok: false, code: 'command_failed', message: 'the taskboard command returned no result' }
      if (result.ok !== true) return { ok: false, code: result?.error?.code ?? 'command_failed', message: errorText(result?.error) }
      const outcome = result.value?.result
      if (outcome === null || outcome === undefined) return { ok: false, code: 'command_result_invalid', message: 'the taskboard command returned no result' }
      if (outcome.kind === 'error') {
        const text = String(outcome.text ?? '')
        const match = /^taskboard:\s*([A-Za-z0-9_-]+)\s*(?:[;:]\s*)?([\s\S]*)$/.exec(text)
        if (match === null) return { ok: false, code: 'command_failed', message: text }
        return { ok: false, code: match[1], message: match[2] }
      }
      if (outcome.kind !== 'success') return { ok: false, code: 'command_failed', message: 'the taskboard command returned an unexpected result' }
      let payload
      try {
        payload = JSON.parse(outcome.text)
      } catch (error) {
        return { ok: false, code: 'command_result_invalid', message: errorText(error) }
      }
      if (payload === null || typeof payload !== 'object') return { ok: false, code: 'command_result_invalid', message: 'the taskboard command returned no payload' }
      if (payload.ok !== true) return { ok: false, code: payload.code ?? 'command_result_invalid', message: payload.message ?? 'the taskboard command refused the change' }
      return { ok: true, payload }
    }

    /** One `/taskboard` op through the command Remote; the same transport the Tasks panel uses. */
    async function runTaskboard(remote, sessionId, op) {
      if (remote?.commands === undefined || typeof remote.commands.execute !== 'function') {
        return { ok: false, code: 'command_unavailable', message: 'this build has no command transport, so the status cannot be changed' }
      }
      let result
      try {
        result = await remote.commands.execute(sessionId, `/taskboard ${JSON.stringify(op)}`, [])
      } catch (error) {
        return { ok: false, code: 'command_failed', message: errorText(error) }
      }
      return parseTaskboardReply(result)
    }

    /**
     * Change one task status AS THE OWNER. The board owns a task's status, so the write goes
     * there (`owner-status`, a compare-and-set on the revision the panel just read), and the
     * mirror moves the TASK in `state/` and the projections with it. The panel itself writes no
     * file: it reads the TASK for its `boardId`, reads the row's revision, then asks the board.
     */
    async function changeTaskStatus(remote, sessionId, { taskId, status, reason = '', signal }) {
      const entity = await loadEntity(remote, sessionId, taskId, 'task', signal)
      if (entity.error !== undefined) return { ok: false, code: 'entity_unreadable', message: entity.error }
      const plan = taskStatusRequest(entity, status)
      if (plan.ok !== true) return plan
      const got = await runTaskboard(remote, sessionId, { op: 'get', id: plan.boardId })
      if (got.ok !== true) return got
      const boardTask = got.payload.task
      // TWO FACTS, TWO CODES. A TASK whose `boardId` is not on the board has no row to compare a
      // revision against, and blaming "no revision" sent the owner looking for a stale row that
      // was never there. The board answers `not_found` for that case now; this branch keeps a
      // server that still answers `{ok:true}` from reading as a revision problem.
      if (boardTask === null || typeof boardTask !== 'object') {
        return { ok: false, code: 'no_board_row', message: `the board has no row ${plan.boardId}, so the panel cannot change this status` }
      }
      if (!Number.isSafeInteger(boardTask.revision)) {
        return { ok: false, code: 'command_result_invalid', message: `the board row ${plan.boardId} carries no revision` }
      }
      const applied = await runTaskboard(remote, sessionId, {
        op: 'owner-status',
        id: plan.boardId,
        expectedRevision: boardTask.revision,
        status,
        ...(String(reason ?? '').trim() === '' ? {} : { reason: String(reason).trim().slice(0, 1000) }),
      })
      if (applied.ok !== true) return applied
      return { ok: true, payload: applied.payload, boardId: plan.boardId }
    }

    // ── THE OWNER'S HAND EDIT ───────────────────────────────────────────────────────────────
    // The Edit tab writes ONLY through the state core: `/state` is the same command Remote the
    // status control uses for `/taskboard`. The core is the single writer, so the revision, the
    // journal and the projections stay consistent, and the entity records which fields the
    // owner has taken over (`manualFields`), so a later mirror leaves them alone until the
    // owner releases them. The panel still writes no file: pointing it at the workspace files
    // would bypass the lock and let a mirror overwrite the edit on its next pass.
    const EDIT_STATUS_CHOICES = {
      req: ['proposed', 'open', 'accepted', 'done', 'rejected', 'dropped'],
      task: TASK_STATUS_CHOICES,
      test: ['unverified', 'verified', 'failing', 'stale'],
    }
    const EDIT_FIELDS = {
      req: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'status', label: 'Status', type: 'status' },
        { key: 'source', label: 'Source', type: 'select', options: ['agent', 'human'] },
        { key: 'criteria', label: 'Criteria', type: 'list', hint: 'One per line. Edits do not recompute the frozen criteria hash, which keeps saying what the source accepted.' },
        { key: 'reason', label: 'Reason', type: 'textarea', rows: 2, hint: 'The "why" the source gave (a deferral, a rejection, a correction).' },
        { key: 'body', label: 'Text', type: 'body', rows: 8, hint: 'The requirement text itself.' },
      ],
      task: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'status', label: 'Status', type: 'status', hint: 'The board owns a task status: a value set here stays until you release it.' },
        { key: 'reqIds', label: 'Requirements', type: 'list', hint: 'REQ ids, one per line. The first becomes the task\'s primary requirement.' },
        { key: 'ownerRole', label: 'Owner role', type: 'text' },
        { key: 'role', label: 'Role', type: 'text' },
        { key: 'preset', label: 'Preset', type: 'text' },
        { key: 'scope', label: 'Scope', type: 'list', hint: 'One item per line.' },
        { key: 'nonScope', label: 'Non-scope', type: 'list', hint: 'One item per line.' },
        { key: 'acceptance', label: 'Acceptance', type: 'acceptance', hint: 'One per line. A line that keeps its exact wording keeps its done mark.' },
        { key: 'steps', label: 'Steps', type: 'list', hint: 'One per line; the plan and its progress are frozen together.' },
        { key: 'stepsDone', label: 'Steps done', type: 'number', hint: 'Leave empty to clear.' },
        { key: 'chore', label: 'Chore (no requirement)', type: 'bool' },
        { key: 'choreReason', label: 'Chore reason', type: 'text' },
        { key: 'reason', label: 'Blocked reason', type: 'text' },
        { key: 'resultSummary', label: 'Result summary', type: 'textarea', rows: 3 },
        { key: 'resultEvidence', label: 'Result evidence', type: 'list', hint: 'One per line.' },
        { key: 'resultArtifacts', label: 'Result artifacts', type: 'list', hint: 'One per line.' },
        { key: 'body', label: 'Objective', type: 'body', rows: 6, hint: 'The task text: what it is for.' },
      ],
      test: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'status', label: 'Status', type: 'status' },
        { key: 'reqId', label: 'Requirement', type: 'text', hint: 'The REQ this test protects.' },
        { key: 'authorRole', label: 'Author role', type: 'text' },
        { key: 'testPath', label: 'Test path', type: 'text' },
        { key: 'command', label: 'Run command', type: 'text' },
        { key: 'evidenceRefs', label: 'Evidence refs', type: 'list', hint: 'One per line; the case library writes these when a run passes.' },
        { key: 'body', label: 'Description', type: 'body', rows: 6, hint: 'What the test proves.' },
      ],
    }
    /** Keys the core owns: shown read-only so the owner sees why they are not text boxes. */
    const EDIT_READONLY = ['id', 'revision', 'createdAt', 'updatedAt', 'analysisRef', 'boardId', 'caseId', 'criteriaHash', 'frozenHash', 'links', 'sessions', 'manualAt']

    /** The form's initial values, one string per control, from the entity as read. */
    function initialDraft(entity, kind) {
      const fm = entity?.frontmatter ?? {}
      const draft = {}
      for (const field of EDIT_FIELDS[kind] ?? []) {
        if (field.type === 'body') draft[field.key] = String(entity?.body ?? '')
        else if (field.type === 'acceptance') draft[field.key] = (Array.isArray(fm.acceptance) ? fm.acceptance : []).map((row) => String(row?.text ?? row ?? '')).filter((text) => text !== '').join('\n')
        else if (field.type === 'list') draft[field.key] = listOf(fm[field.key]).join('\n')
        else if (field.type === 'number') draft[field.key] = fm[field.key] === undefined || fm[field.key] === null ? '' : String(fm[field.key])
        else if (field.type === 'bool') draft[field.key] = fm[field.key] === true
        else draft[field.key] = fm[field.key] === undefined || fm[field.key] === null ? '' : String(fm[field.key])
      }
      // A TASK may carry one `reqId` (older rows) or a `reqIds` batch: the form edits one list.
      if (kind === 'task') {
        draft.reqIds = [...new Set([...(fm.reqId === undefined || fm.reqId === '' ? [] : [String(fm.reqId)]), ...listOf(fm.reqIds)])].join('\n')
      }
      return draft
    }

    /**
     * What changed, as the core's patch. Only changed fields are sent, so a save cannot
     * silently take ownership of a field the owner did not touch. An acceptance line keeps its
     * done mark when its exact wording is unchanged; a new line starts not done.
     */
    function buildEditPatch(entity, kind, draft) {
      const fm = entity?.frontmatter ?? {}
      const patch = {}
      const acceptanceDone = new Map(
        (Array.isArray(fm.acceptance) ? fm.acceptance : []).map((row) => [String(row?.text ?? row ?? ''), row?.done === true]),
      )
      for (const field of EDIT_FIELDS[kind] ?? []) {
        const value = draft[field.key]
        if (field.type === 'list' || field.type === 'acceptance') {
          const lines = String(value ?? '').split('\n').map((line) => line.trim()).filter((line) => line !== '')
          const current = field.key === 'reqIds' && kind === 'task'
            ? [...new Set([...(fm.reqId === undefined || fm.reqId === '' ? [] : [String(fm.reqId)]), ...listOf(fm.reqIds)])]
            : listOf(fm[field.key])
          const next = field.type === 'acceptance' ? lines.map((text) => ({ text, done: acceptanceDone.get(text) === true })) : lines
          const currentRows = field.type === 'acceptance'
            ? (Array.isArray(fm.acceptance) ? fm.acceptance : []).map((row) => ({ text: String(row?.text ?? row ?? ''), done: row?.done === true }))
            : current
          if (JSON.stringify(next) !== JSON.stringify(currentRows)) patch[field.key] = next
        } else if (field.type === 'number') {
          const text = String(value ?? '').trim()
          const current = fm[field.key]
          if (text === '') {
            if (current !== undefined) patch[field.key] = null
          } else {
            const number = Number(text)
            if (Number.isSafeInteger(number) && number !== current) patch[field.key] = number
          }
        } else if (field.type === 'bool') {
          if (Boolean(value) !== (fm[field.key] === true)) patch[field.key] = Boolean(value)
        } else if (field.type === 'body') {
          if (String(value ?? '') !== String(entity?.body ?? '')) patch.body = String(value ?? '')
        } else {
          const text = field.key === 'title' ? String(value ?? '').trim() : String(value ?? '')
          const current = fm[field.key] === undefined || fm[field.key] === null ? '' : String(fm[field.key])
          if (text !== current) patch[field.key] = text
        }
      }
      // The requirement list is one value in two keys: the first becomes `reqId` so older
      // readers (and the board's single-requirement path) keep working.
      if (kind === 'task' && Array.isArray(patch.reqIds)) patch.reqId = patch.reqIds[0] ?? ''
      return patch
    }

    /** One `/state` reply: `{kind:'success'|'error', text}`, errors as `state: CODE; message`. */
    function parseStateReply(result) {
      if (result === null || result === undefined) return { ok: false, code: 'command_failed', message: 'the state command returned no result' }
      if (result.ok !== true) return { ok: false, code: result?.error?.code ?? 'command_failed', message: errorText(result?.error) }
      const outcome = result.value?.result
      if (outcome === null || outcome === undefined) return { ok: false, code: 'command_result_invalid', message: 'the state command returned no result' }
      if (outcome.kind === 'error') {
        const text = String(outcome.text ?? '')
        const match = /^state:\s*([A-Za-z0-9_-]+)\s*(?:[;:]\s*)?([\s\S]*)$/.exec(text)
        if (match === null) return { ok: false, code: 'command_failed', message: text }
        return { ok: false, code: match[1], message: match[2] }
      }
      if (outcome.kind !== 'success') return { ok: false, code: 'command_failed', message: 'the state command returned an unexpected result' }
      let payload
      try {
        payload = JSON.parse(outcome.text)
      } catch (error) {
        return { ok: false, code: 'command_result_invalid', message: errorText(error) }
      }
      if (payload === null || typeof payload !== 'object') return { ok: false, code: 'command_result_invalid', message: 'the state command returned no payload' }
      if (payload.ok !== true) return { ok: false, code: payload.code ?? 'command_result_invalid', message: payload.message ?? 'the state command refused the change' }
      return { ok: true, payload }
    }

    async function runStateCommand(remote, sessionId, op) {
      if (remote?.commands === undefined || typeof remote.commands.execute !== 'function') {
        return { ok: false, code: 'command_unavailable', message: 'this build has no command transport, so the entity cannot be edited' }
      }
      let result
      try {
        result = await remote.commands.execute(sessionId, `/state ${JSON.stringify(op)}`, [])
      } catch (error) {
        return { ok: false, code: 'command_failed', message: errorText(error) }
      }
      return parseStateReply(result)
    }

    /**
     * Save a hand edit. `expectedRevision` is the revision of the file the form was built from;
     * a refusal keeps its code (`revision_conflict`, `status_invalid`, `field_not_editable`) so
     * the panel quotes the core instead of paraphrasing it.
     */
    async function editStateEntity(remote, sessionId, { id, kind, expectedRevision, patch, release }) {
      if (typeof id !== 'string' || id === '') return { ok: false, code: 'id_required', message: 'the edit has no entity id' }
      if (!Number.isInteger(expectedRevision)) return { ok: false, code: 'revision_required', message: `the form has no revision for ${id}; close and reopen it` }
      const op = { op: 'edit', id, expectedRevision, ...(Object.keys(patch ?? {}).length === 0 ? {} : { patch }), ...(Array.isArray(release) && release.length > 0 ? { release } : {}) }
      return runStateCommand(remote, sessionId, op)
    }

    /**
     * Elapsed time, not a wall clock: a board is read to see what is fresh, and
     * `2026-11-18 18:20` makes the reader do the subtraction. The full timestamp stays in the
     * cell's title, so nothing is lost. Russian units because the owner reads this UI.
     */
    function relativeLabel(value, nowMs = Date.now()) {
      const time = Date.parse(String(value ?? ''))
      if (!Number.isFinite(time)) return '—'
      const delta = nowMs - time
      const abs = Math.abs(delta)
      if (abs < 45_000) return 'сейчас'
      if (abs < 3_600_000) return `${delta < 0 ? 'через ' : ''}${Math.max(1, Math.round(abs / 60_000))} мин ${delta < 0 ? '' : 'назад'}`.trim()
      if (abs < 86_400_000) return `${delta < 0 ? 'через ' : ''}${Math.max(1, Math.round(abs / 3_600_000))} ч ${delta < 0 ? '' : 'назад'}`.trim()
      if (abs < 30 * 86_400_000) return `${delta < 0 ? 'через ' : ''}${Math.max(1, Math.round(abs / 86_400_000))} дн ${delta < 0 ? '' : 'назад'}`.trim()
      try {
        return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(new Date(time))
      } catch {
        return new Date(time).toISOString().slice(0, 10)
      }
    }

    /** Kept for callers that want the wall clock; the list and the drawer use relativeLabel. */
    function updatedLabel(value) {
      const text = String(value ?? '')
      return text === '' ? '—' : text.replace('T', ' ').slice(0, 16)
    }

    /**
     * The sessions a TASK recorded, with the live state folded in. The register stores the
     * status at write time; the session snapshot knows whether the child runs NOW, so a
     * running child wins and a finished one keeps its recorded word. Read-only.
     */
    function taskSessions(frontmatter, sessionsById) {
      const rows = Array.isArray(frontmatter?.sessions) ? frontmatter.sessions : []
      const out = []
      const seen = new Set()
      for (const row of rows) {
        if (row === null || typeof row !== 'object' || typeof row.sessionId !== 'string' || row.sessionId === '') continue
        if (seen.has(row.sessionId)) continue
        seen.add(row.sessionId)
        const live = sessionsById?.[row.sessionId]
        // A CLOSED TASK CANNOT BE WORKING. The session may still be listed (history) and may
        // even be running for a DIFFERENT task after a reuse; echoing `running` here would show
        // activity on review/done/cancelled rows. Only `active` owns live work now.
        const liveAllowed = frontmatter?.status === 'active'
        const running = liveAllowed && live?.running === true
        const recorded = typeof row.status === 'string' && row.status !== '' ? row.status : ''
        out.push({
          sessionId: row.sessionId,
          label: typeof row.label === 'string' && row.label !== '' ? row.label : (typeof live?.title === 'string' && live.title !== '' ? live.title : row.sessionId),
          role: typeof row.role === 'string' ? row.role : '',
          // LIVE MEANS RUNNING OR NOT. The ledger writes `active` when a child is linked and
          // only settles it later, so echoing that status as "active" next to "running" made
          // two different states look alike. The recorded word stays as the tooltip history.
          status: running ? 'running' : 'idle',
          recorded,
          running,
        })
      }
      return out
    }

    /** Trimmed non-empty strings from a frontmatter list; anything else yields `[]`. */
    function listOf(value) {
      return Array.isArray(value) ? value.map((item) => String(item).trim()).filter((item) => item !== '') : []
    }

    const CSS = `
.ps-root {
  /* The panel owns no palette of its own: every surface, label, border and state colour is
     a shell alias token, so the same rules follow the light and the dark theme. Entity
     accents (TYPE_COLOR: REQ/TASK/TEST/DEC) stay semantic and are deliberately not themed.
     State colours are mixed with the theme ink so a saturated token keeps a readable text
     contrast on both backgrounds instead of being used raw. */
  --ps-paper: var(--dsw-alias-bg-base);
  --ps-surface: var(--dsw-alias-bg-layer-1);
  --ps-surface-2: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-base));
  --ps-surface-3: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, var(--dsw-alias-bg-base));
  --ps-open: #93C5FD;
  /* THE TWO SMALL-TEXT INKS. --ps-open and --ps-ok stay the accent colours for dots, borders and
     card edges, where no contrast minimum applies; as 10.5-11 px text they read at 1.8:1 and
     4.3:1 on the light theme (axe: color-contrast). Each ink is the same colour mixed with the
     theme ink, so it darkens on light and lightens on dark and keeps following the shell theme
     instead of pinning a hex. */
  --ps-open-ink: color-mix(in srgb, var(--ps-open) 50%, var(--ps-ink));
  --ps-ok-ink: color-mix(in srgb, var(--ps-ok) 85%, var(--ps-ink));
  --ps-violet: #C4B5FD;
  --ps-ink: var(--dsw-alias-label-primary);
  --ps-muted: var(--dsw-alias-label-secondary);
  --ps-line: var(--dsw-alias-border-l1);
  --ps-line-strong: var(--dsw-alias-border-l2);
  --ps-accent: var(--dsw-alias-brand-primary);
  --ps-accent-hover: var(--dsw-alias-button-primary-hover);
  --ps-accent-ink: var(--dsw-alias-label-primary-inverted);
  --ps-ok: color-mix(in srgb, var(--dsw-alias-state-success-primary) 62%, var(--dsw-alias-label-primary));
  --ps-warn: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 50%, var(--dsw-alias-label-primary));
  --ps-bad: color-mix(in srgb, var(--dsw-alias-state-error-primary) 78%, var(--dsw-alias-label-primary));
  --ps-info: color-mix(in srgb, var(--dsw-alias-state-business-primary) 68%, var(--dsw-alias-label-primary));
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--ps-paper);
  color: var(--ps-ink);
  font: 13.5px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  container-type: inline-size;
}
.ps-root * { box-sizing: border-box; }
.ps-root :focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 2px; border-radius: 4px; }
.ps-top { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--ps-line); flex: none; flex-wrap: wrap; min-height: 48px; }
.ps-title { font-size: 16px; font-weight: 700; letter-spacing: -.01em; margin: 0; }
.ps-modebar { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--ps-line); border-radius: 8px; background: var(--ps-surface-2); }
.ps-mode { border: 0; background: transparent; color: var(--ps-muted); border-radius: 6px; padding: 4px 9px; font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; white-space: nowrap; }
.ps-mode[aria-selected="true"] { background: var(--ps-surface); color: var(--ps-ink); box-shadow: 0 0 0 1px var(--ps-line); }
.ps-mode:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 1px; }
.ps-spacer { flex: 1; }
.ps-ro { display: inline-flex; align-items: center; gap: 5px; border: 1px solid color-mix(in srgb, var(--ps-ok) 38%, var(--ps-line)); background: color-mix(in srgb, var(--ps-ok) 8%, transparent); color: var(--ps-ok-ink); border-radius: 999px; padding: 2px 8px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.ps-ro:before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.ps-meta { color: var(--ps-muted); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ps-counts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ps-count { display: inline-flex; align-items: center; gap: 4px; color: var(--ps-muted); font-size: 11px; white-space: nowrap; }
.ps-count b { color: var(--ps-ink); font-variant-numeric: tabular-nums; }
.ps-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.ps-btn { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--ps-line); background: var(--ps-surface-2); color: var(--ps-ink); border-radius: 7px; padding: 4px 9px; font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; white-space: nowrap; }
.ps-btn:hover { background: var(--ps-surface-3); }
.ps-btn:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 1px; }
.ps-btn.small { min-height: 24px; padding: 3px 7px; font-size: 11px; font-weight: 600; }
.ps-btn.icon { min-width: 24px; min-height: 24px; padding: 3px 7px; font-size: 13px; line-height: 1.2; }
.ps-filterbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 7px 14px; border-bottom: 1px solid var(--ps-line); background: color-mix(in srgb, var(--ps-accent) 6%, var(--ps-surface)); flex: none; font-size: 11.5px; }
.ps-filterbar b { font-weight: 700; }
.ps-filterbar .ps-gap { margin-left: 0; }
.ps-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.ps-body.with-drawer { grid-template-columns: minmax(0, 1fr) 390px; }
.ps-main { min-width: 0; min-height: 0; overflow: auto; padding: 12px 14px 28px; scrollbar-width: thin; }
.ps-drawer { border-left: 1px solid var(--ps-line); background: var(--ps-surface-2); min-height: 0; overflow: auto; padding: 12px 14px 28px; scrollbar-width: thin; }
@container (max-width: 760px) {
  .ps-body.with-drawer { grid-template-columns: minmax(0, 1fr); }
  .ps-drawer { border-left: 0; border-top: 1px solid var(--ps-line); max-height: 55vh; }
  .ps-top { align-items: flex-start; }
}
.ps-kicker { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ps-muted); font-weight: 700; margin: 0 0 3px; }
.ps-h2 { font-size: 14px; line-height: 1.3; margin: 0 0 6px; overflow-wrap: anywhere; }
.ps-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; min-height: 24px; border: 1px solid color-mix(in srgb, var(--ps-type) 55%, var(--ps-line)); background: color-mix(in srgb, var(--ps-type) 15%, var(--ps-surface)); color: var(--ps-ink); border-radius: 6px; padding: 3px 6px 3px 4px; font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 650; cursor: pointer; }
.ps-chip .mark { width: 7px; height: 7px; flex: none; background: var(--ps-type); }
.ps-chip code { font: inherit; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-chip.static { cursor: default; }
.ps-chip:hover { background: color-mix(in srgb, var(--ps-type) 24%, var(--ps-surface)); }
.ps-chip:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 1px; }
.ps-chip.evidence { border-style: dashed; }
.ps-status { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--ps-line); border-radius: 999px; padding: 1px 7px; font-size: 10.5px; font-weight: 650; color: var(--ps-muted); background: var(--ps-surface); white-space: nowrap; }
.ps-status.ok { color: var(--ps-ok); border-color: color-mix(in srgb, var(--ps-ok) 35%, var(--ps-line)); background: color-mix(in srgb, var(--ps-ok) 8%, transparent); }
.ps-status.bad { color: var(--ps-bad); border-color: color-mix(in srgb, var(--ps-bad) 35%, var(--ps-line)); background: color-mix(in srgb, var(--ps-bad) 8%, transparent); }
.ps-status.warn { color: var(--ps-warn); border-color: color-mix(in srgb, var(--ps-warn) 35%, var(--ps-line)); background: color-mix(in srgb, var(--ps-warn) 8%, transparent); }
.ps-status.info { color: var(--ps-accent); border-color: color-mix(in srgb, var(--ps-accent) 35%, var(--ps-line)); background: color-mix(in srgb, var(--ps-accent) 8%, transparent); }
.ps-status.muted { color: var(--ps-muted); border-style: dashed; }
.ps-status.open { color: var(--ps-open-ink); border-color: color-mix(in srgb, var(--ps-open) 40%, var(--ps-line)); background: color-mix(in srgb, var(--ps-open) 10%, transparent); }
.ps-status.proposed { color: var(--ps-violet); border-color: color-mix(in srgb, var(--ps-violet) 40%, var(--ps-line)); background: color-mix(in srgb, var(--ps-violet) 10%, transparent); }
.ps-status.unverified { color: var(--ps-open-ink); border-color: color-mix(in srgb, var(--ps-open) 40%, var(--ps-line)); background: color-mix(in srgb, var(--ps-open) 10%, transparent); }
.ps-status.active, .ps-status.running { color: var(--ps-accent); border-color: color-mix(in srgb, var(--ps-accent) 45%, var(--ps-line)); background: color-mix(in srgb, var(--ps-accent) 12%, transparent); }
.ps-status.review, .ps-status.stale { color: var(--ps-warn); border-color: color-mix(in srgb, var(--ps-warn) 45%, var(--ps-line)); background: color-mix(in srgb, var(--ps-warn) 10%, transparent); }
.ps-status.blocked, .ps-status.failing, .ps-status.rejected { color: var(--ps-bad); border-color: color-mix(in srgb, var(--ps-bad) 45%, var(--ps-line)); background: color-mix(in srgb, var(--ps-bad) 10%, transparent); }
.ps-status.done, .ps-status.verified, .ps-status.accepted { color: var(--ps-ok); border-color: color-mix(in srgb, var(--ps-ok) 45%, var(--ps-line)); background: color-mix(in srgb, var(--ps-ok) 10%, transparent); }
.ps-status.cancelled, .ps-status.superseded, .ps-status.dropped { color: var(--ps-muted); border-style: dashed; }
.ps-gap { display: inline-flex; align-items: center; gap: 4px; min-height: 24px; border: 1px dashed color-mix(in srgb, var(--ps-warn) 55%, var(--ps-line)); background: color-mix(in srgb, var(--ps-warn) 6%, transparent); color: var(--ps-ink); border-radius: 6px; padding: 3px 6px; font: 11px/1.55 inherit; font-weight: 600; cursor: pointer; }
.ps-gap:before { content: "△"; color: var(--ps-warn); font-size: 10px; }
.ps-gap:hover { background: color-mix(in srgb, var(--ps-warn) 12%, transparent); }
.ps-gap.static { cursor: default; }
.ps-reqlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ps-reqrow { display: flex; align-items: flex-start; gap: 10px; border: 1px solid var(--ps-line); background: var(--ps-surface-2); border-radius: 10px; padding: 9px 11px; }
.ps-reqrow.sel { border-color: var(--ps-accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ps-accent) 45%, transparent); background: color-mix(in srgb, var(--ps-accent) 5%, var(--ps-surface-2)); }
.ps-reqrow .body { flex: 1; min-width: 0; }
.ps-rowbtn { display: block; width: 100%; text-align: left; border: 0; background: transparent; color: inherit; font: inherit; padding: 0; cursor: pointer; }
.ps-rowbtn:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 2px; border-radius: 4px; }
.ps-rowtitle { font-size: 13.5px; font-weight: 650; line-height: 1.35; overflow-wrap: anywhere; }
.ps-rowmeta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 5px; }
.ps-criteria { margin: 6px 0 0; padding: 0 0 0 18px; color: var(--ps-muted); font-size: 12px; }
.ps-criteria li { margin: 1px 0; }
.ps-board { display: flex; gap: 8px; align-items: flex-start; overflow-x: auto; padding-bottom: 6px; }
.ps-col { flex: 1 0 186px; min-width: 186px; border: 1px solid var(--ps-line); border-radius: 10px; background: var(--ps-surface-2); padding: 8px; min-height: 120px; }
.ps-col h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 7px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ps-muted); font-weight: 700; }
.ps-col h3:before { content: ""; width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--ps-line-strong); }
.ps-col[data-status="open"] h3:before { background: var(--ps-open); }
.ps-col[data-status="active"] h3:before { background: var(--ps-accent); }
.ps-col[data-status="review"] h3:before { background: var(--ps-warn); }
.ps-col[data-status="blocked"] h3:before { background: var(--ps-bad); }
.ps-col[data-status="done"] h3:before { background: var(--ps-ok); }
.ps-col h3 .n { margin-left: auto; color: var(--ps-muted); font-weight: 500; letter-spacing: 0; font-variant-numeric: tabular-nums; }
.ps-card { display: block; width: 100%; text-align: left; border: 1px solid var(--ps-line); border-left: 3px solid var(--ps-line); background: var(--ps-surface); border-radius: 8px; padding: 7px 8px; margin: 0 0 6px; font: inherit; color: inherit; cursor: pointer; }
.ps-card[data-status="open"] { border-left-color: var(--ps-open); }
.ps-card[data-status="active"] { border-left-color: var(--ps-accent); }
.ps-card[data-status="review"] { border-left-color: var(--ps-warn); }
.ps-card[data-status="blocked"] { border-left-color: var(--ps-bad); }
.ps-card[data-status="done"] { border-left-color: var(--ps-ok); }
.ps-card[data-status="cancelled"] { border-left-color: var(--ps-muted); }
.ps-card:hover { background: var(--ps-surface-3); }
.ps-card .ps-cardopen { display: block; width: 100%; text-align: left; border: 0; background: transparent; color: inherit; font: inherit; padding: 0; cursor: pointer; }
.ps-card .ps-cardopen:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 2px; border-radius: 4px; }
.ps-cardfoot { display: flex; align-items: center; margin-top: 5px; }
/* THE BADGE IS THE SELECT: a native dropdown wearing the status chip, with a CSS caret. */
.ps-statuswrap { position: relative; display: inline-flex; align-items: center; }
.ps-statuswrap::after { content: "▾"; position: absolute; right: 5px; pointer-events: none; font-size: 9px; line-height: 1; color: var(--ps-muted); }
.ps-status.ps-statusselect { display: inline-block; appearance: none; -webkit-appearance: none; padding: 1px 16px 1px 7px; line-height: 1.6; cursor: pointer; font-family: inherit; /* THE STATUS CHIP IS A NATIVE SELECT, and its popup is drawn by the browser: a translucent
   chip background left the option list on the default WHITE sheet while the option text
   inherited the status colour (amber/green), which is the unreadable white-on-yellow the
   owner reported. An opaque surface plus explicit option colours keep the list inside the
   theme; the status colour stays in the chip's own text and border. */
  background: var(--ps-surface); }
.ps-status.ps-statusselect:disabled { cursor: progress; opacity: .7; }
.ps-status.ps-statusselect option { background-color: var(--ps-surface); color: var(--ps-ink); }
.ps-statuscontrol { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ps-input { border: 1px solid var(--ps-line); background: var(--ps-surface); color: var(--ps-ink); border-radius: 6px; padding: 3px 6px; font: inherit; font-size: 12px; width: 100%; }
.ps-input:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 1px; }
.ps-reason { width: 170px; font-size: 11px; padding: 2px 6px; }
.ps-notice { border: 1px solid var(--ps-line); border-radius: 8px; padding: 6px 9px; margin-bottom: 10px; font-size: 12px; line-height: 1.4; }
.ps-notice.ok { border-color: color-mix(in srgb, var(--ps-ok) 45%, var(--ps-line)); background: color-mix(in srgb, var(--ps-ok) 10%, transparent); color: var(--ps-ok-ink); }
.ps-notice.bad { border-color: color-mix(in srgb, var(--ps-bad) 45%, var(--ps-line)); background: color-mix(in srgb, var(--ps-bad) 10%, transparent); color: var(--ps-bad); }
.ps-notice code { font-weight: 700; }
.ps-card .t { font-size: 12.4px; font-weight: 650; line-height: 1.3; overflow-wrap: anywhere; }
.ps-card .m { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; margin-top: 5px; }
.ps-card .none { color: var(--ps-muted); font-size: 11px; }
.ps-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ps-table th { white-space: nowrap; overflow-wrap: normal; text-align: left; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ps-muted); font-weight: 700; padding: 6px 8px; border-bottom: 1px solid var(--ps-line); }
.ps-table td { padding: 7px 8px; border-bottom: 1px solid var(--ps-line); vertical-align: top; font-size: 12px; overflow-wrap: anywhere; }
.ps-table tbody tr { cursor: pointer; }
.ps-table tbody tr:hover { background: var(--ps-surface-2); }
.ps-table tbody tr:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: -2px; }
.ps-table .nowrap { white-space: nowrap; }
.ps-table th:nth-child(1), .ps-table td:nth-child(1) { width: 37%; }
.ps-table th:nth-child(2), .ps-table td:nth-child(2) { width: 25%; }
.ps-table th:nth-child(3), .ps-table td:nth-child(3) { width: 16%; }
.ps-table th:nth-child(4), .ps-table td:nth-child(4) { width: 22%; }
.ps-tablewrap { overflow-x: auto; max-width: 100%; }
.ps-planh { margin: 2px 0 6px; font-size: 16px; line-height: 1.3; }
.ps-plansec { margin: 16px 0 0; }
.ps-plansec h3 { margin: 0 0 6px; }
.ps-planlist { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.ps-planlist li { border-bottom: 1px solid var(--ps-line); padding-bottom: 6px; }
.ps-planinit th:nth-child(1), .ps-planinit td:nth-child(1) { width: 58%; }
.ps-planinit th:nth-child(2), .ps-planinit td:nth-child(2) { width: 14%; }
.ps-planinit th:nth-child(3), .ps-planinit td:nth-child(3) { width: 28%; }
/* The list must FIT the panel: fixed px widths for the narrow columns, the rest to Task. */
.ps-table.ps-tasklist { min-width: 690px; }
.ps-table.ps-tasklist th:nth-child(1), .ps-table.ps-tasklist td:nth-child(1) { width: 84px; }
.ps-table.ps-tasklist th:nth-child(2), .ps-table.ps-tasklist td:nth-child(2) { width: auto; }
.ps-table.ps-tasklist th:nth-child(3), .ps-table.ps-tasklist td:nth-child(3) { width: 96px; }
.ps-table.ps-tasklist th:nth-child(4), .ps-table.ps-tasklist td:nth-child(4) { width: 140px; }
.ps-table.ps-tasklist th:nth-child(5), .ps-table.ps-tasklist td:nth-child(5) { width: 78px; }
.ps-table.ps-tasklist th:nth-child(6), .ps-table.ps-tasklist td:nth-child(6) { width: 92px; }
.ps-table.ps-tasklist th:nth-child(7), .ps-table.ps-tasklist td:nth-child(7) { width: 120px; }
.ps-rolecell { display: flex; flex-direction: column; gap: 1px; font-size: 11.5px; overflow-wrap: anywhere; }
.ps-rolecell b { font-weight: 650; }
.ps-table.ps-tasklist .ps-updated { white-space: nowrap; font-variant-numeric: tabular-nums; font-size: 11px; color: var(--ps-muted); }
.ps-subbar .ps-count { color: var(--ps-muted); font-size: 11px; }
.ps-cellchips { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.ps-subbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 8px; }
.ps-group { display: inline-flex; align-items: center; gap: 2px; border: 1px solid var(--ps-line); border-radius: 8px; padding: 2px; background: var(--ps-surface-2); }
.ps-group button { min-height: 24px; border: 0; border-radius: 6px; background: transparent; color: var(--ps-muted); padding: 3px 8px; font: inherit; font-size: 11.5px; font-weight: 650; cursor: pointer; }
.ps-group button.on { background: var(--ps-surface); color: var(--ps-ink); box-shadow: 0 0 0 1px var(--ps-line); }
.ps-group button:disabled { opacity: .55; cursor: default; }
.ps-empty { max-width: 64ch; padding: 26px 4px; color: var(--ps-muted); }
.ps-empty h2 { margin: 0 0 5px; font-size: 15px; color: var(--ps-ink); }
.ps-empty p { margin: 0 0 6px; }
.ps-empty code, .ps-code { font: 11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--ps-surface-2); border: 1px solid var(--ps-line); border-radius: 5px; padding: 0 4px; overflow-wrap: anywhere; }
.ps-alert { border: 1px solid color-mix(in srgb, var(--ps-bad) 40%, var(--ps-line)); background: color-mix(in srgb, var(--ps-bad) 8%, transparent); color: var(--ps-bad); border-radius: 8px; padding: 7px 9px; margin: 0 0 10px; font-size: 12px; overflow-wrap: anywhere; }
.ps-alert code { font: 11px/1.5 ui-monospace, monospace; }
.ps-warnline { border: 1px solid color-mix(in srgb, var(--ps-warn) 40%, var(--ps-line)); background: color-mix(in srgb, var(--ps-warn) 7%, transparent); color: var(--ps-ink); border-radius: 8px; padding: 6px 9px; margin: 0 0 10px; font-size: 11.5px; }
.ps-mapbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 8px; font-size: 11.5px; color: var(--ps-muted); }
.ps-mapstage { height: 100%; min-height: 0; border: 0; border-radius: 0; overflow: hidden; background: var(--ps-surface); }
.ps-mapstage > .dmv { height: 100%; }
/* The Design map is the one mode that is a canvas rather than a document: it takes the whole
   body (no 14px padding, no page scroll) so the editor fills the panel and grows with it. The
   620px ceiling the map used to have is what made the Excalidraw page a strip. */
.ps-main-map { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.ps-main-map .ps-mapstage { flex: 1 1 auto; }
.ps-maplist { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.ps-maplist li { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; }
.ps-nodebadge { position: absolute; min-width: 18px; height: 16px; padding: 0 4px; border-radius: 999px; border: 1px solid color-mix(in srgb, #FFB020 58%, var(--ps-line)); /* #FFB020 is TYPE_COLOR.req */ background: color-mix(in srgb, #FFB020 22%, var(--ps-surface)); color: var(--ps-ink); font: 9.5px/14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 700; text-align: center; white-space: nowrap; pointer-events: none; }
.ps-nodefacts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 10px; margin: 0 0 12px; font-size: 12px; }
.ps-nodefacts dt { color: var(--ps-muted); }
.ps-nodefacts dd { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.ps-drawer .ps-drawerhead { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 8px; }
.ps-drawer .ps-drawerhead .grow { flex: 1; min-width: 0; }
.ps-drawer .ps-drawerhead .ps-btn.close { flex: none; }
.ps-drawer h2 { font-size: 15px; line-height: 1.3; margin: 0 0 5px; overflow-wrap: anywhere; }
.ps-drawer h3 { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--ps-muted); margin: 0 0 4px; }
.ps-sec { margin: 0 0 14px; }
.ps-sec p { margin: 0 0 5px; font-size: 12.5px; overflow-wrap: anywhere; }
.ps-sec .muted { color: var(--ps-muted); font-size: 11.5px; }
.ps-defs { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 10px; margin: 0; font-size: 12px; }
.ps-defs dt { color: var(--ps-muted); }
.ps-defs dd { margin: 0; overflow-wrap: anywhere; }
.ps-pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 11.5px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--ps-surface); border: 1px solid var(--ps-line); border-radius: 8px; padding: 8px; max-height: 340px; overflow: auto; }
.ps-pre .red { color: var(--ps-bad); font-weight: 700; }
.ps-pre .green { color: var(--ps-ok); font-weight: 700; }
.ps-pre .dim { color: var(--ps-muted); }
.ps-chiplist { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.ps-visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.ps-loading { display: inline-flex; align-items: center; gap: 7px; color: var(--ps-muted); font-size: 12px; }
.ps-loading:before { content: ""; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--ps-line); border-top-color: var(--ps-accent); animation: ps-spin .8s linear infinite; }
@keyframes ps-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ps-loading:before { animation: none; } }

/* ── Night desk shell: a navigation rail, the mode, and a persistent evidence rail ── */
.ps-top { background: var(--ps-surface); border-bottom-color: var(--ps-line); min-height: 52px; padding: 8px 16px; }
.ps-title { font-size: 18px; letter-spacing: -.015em; }
.ps-back { margin-right: 2px; }
.ps-windowgroup { display: inline-flex; align-items: center; gap: 2px; padding-left: 8px; border-left: 1px solid var(--ps-line); }
.ps-modebar { display: none; }
.ps-shell { flex: 1; min-height: 0; display: grid; grid-template-columns: 212px minmax(0, 1fr) 360px; }
.ps-shell.ps-no-rail { grid-template-columns: 212px minmax(0, 1fr); }
.ps-nav { min-width: 0; min-height: 0; overflow: auto; border-right: 1px solid var(--ps-line); background: var(--ps-paper); padding: 14px 12px 18px; scrollbar-width: thin; }
.ps-nav .ps-kicker { margin: 0 0 7px; }
.ps-modes { display: flex; flex-direction: column; gap: 2px; }
.ps-mode { display: flex; align-items: center; width: 100%; min-height: 36px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--ps-muted); padding: 5px 8px; text-align: left; font: inherit; font-size: 12.5px; font-weight: 650; cursor: pointer; }
.ps-mode:hover { background: var(--ps-surface-2); color: var(--ps-ink); }
.ps-mode[aria-selected="true"] { background: var(--ps-surface-2); color: var(--ps-ink); border-color: var(--ps-line-strong); }
.ps-mode[aria-selected="true"]:before { content: ""; width: 2px; height: 16px; margin-right: 7px; background: var(--ps-type, var(--ps-accent)); }
.ps-navsec { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--ps-line); }
.ps-navsec .ps-muted, .ps-navsec p.muted { margin: 0; color: var(--ps-muted); font-size: 12px; line-height: 1.5; }
.ps-navfilter { border: 1px solid var(--ps-line); border-radius: 8px; background: var(--ps-surface); padding: 8px; }
.ps-navfilter .t { font-size: 12.5px; font-weight: 650; line-height: 1.35; margin: 6px 0; overflow-wrap: anywhere; }
.ps-navfilter .ps-meta { white-space: normal; display: block; margin-top: 4px; }
.ps-navfoot { margin-top: 18px; color: var(--ps-muted); font-size: 11px; line-height: 1.5; }
.ps-mail { display: inline-flex; align-items: center; gap: 4px; color: var(--ps-muted); font-size: 11px; }
.ps-rail { min-width: 0; min-height: 0; overflow: auto; border-left: 1px solid var(--ps-line); background: var(--ps-surface); padding: 14px 14px 24px; scrollbar-width: thin; }
.ps-rail > .ps-drawer { border: 0; background: transparent; padding: 0; min-height: 0; overflow: visible; }
.ps-rail .ps-meta, .ps-railreq .ps-meta { white-space: normal; }
.ps-railhead { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; }
.ps-railhead .ps-kicker { margin: 0; }
.ps-railhead .ps-spacer { flex: 1; }
.ps-railreq { border-bottom: 1px solid var(--ps-line); padding-bottom: 10px; margin-bottom: 12px; }
.ps-railreq .t { font-size: 14px; font-weight: 650; line-height: 1.35; margin: 6px 0 0; overflow-wrap: anywhere; }
.ps-railsec { margin: 0 0 14px; }
.ps-railsec h3 { margin: 0 0 5px; font: 700 11px/1.4 var(--ps-sans, system-ui, sans-serif); letter-spacing: .1em; text-transform: uppercase; color: var(--ps-muted); }
.ps-evrow { display: flex; align-items: flex-start; gap: 6px; flex-wrap: wrap; padding: 6px 0; border-bottom: 1px solid var(--ps-line); }
.ps-evrow:last-child { border-bottom: 0; }
.ps-evrow .cmd { flex: 1 1 100%; min-width: 0; color: var(--ps-muted); font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-evsum { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 0 0 12px; }
.ps-evsum .cell { border: 1px solid var(--ps-line); border-radius: 6px; background: var(--ps-surface-2); padding: 7px 8px; }
.ps-evsum .n { display: block; color: var(--ps-ink); font: 700 18px/1.1 var(--ps-sans, system-ui, sans-serif); font-variant-numeric: tabular-nums; }
.ps-evsum .l { display: block; color: var(--ps-muted); font-size: 11px; margin-top: 2px; }
.ps-railnote { margin: 12px 0 0; color: var(--ps-muted); font-size: 11.5px; line-height: 1.5; }
.ps-root .dmv {
  --dmv-surface: var(--ps-paper);
  --dmv-surface-2: var(--ps-surface);
  --dmv-surface-3: var(--ps-surface-2);
  --dmv-ink: var(--ps-ink);
  --dmv-muted: var(--ps-muted);
  --dmv-line: var(--ps-line);
  --dmv-line-strong: var(--ps-line-strong);
  --dmv-accent: var(--ps-accent);
  --dmv-accent-ink: var(--ps-paper);
  --dmv-ok: var(--ps-ok);
  --dmv-warn: var(--ps-warn);
  --dmv-danger: var(--ps-bad);
}
.ps-root .ps-status.info { color: var(--ps-info); }
.ps-root .ps-kicker { font-size: 11px; letter-spacing: .1em; }
.ps-root .ps-status { font-size: 11px; }
.ps-root .ps-col h3, .ps-root .ps-table th, .ps-root .ps-drawer h3, .ps-root .ps-sec h3 { font-size: 11px; }
.ps-root .ps-meta { font-size: 11px; }
.ps-root .ps-btn { background: var(--ps-surface-2); border-color: var(--ps-line-strong); }
.ps-root .ps-btn:hover { background: var(--ps-surface-3); }
.ps-root .ps-btn.small { min-height: 24px; }
.ps-root .ps-ro { background: color-mix(in srgb, var(--ps-ok) 10%, transparent); }
.ps-root .ps-chip { background: color-mix(in srgb, var(--ps-type) 18%, var(--ps-surface-2)); }
.ps-root .ps-chip:hover { background: color-mix(in srgb, var(--ps-type) 28%, var(--ps-surface-2)); }
.ps-root .ps-reqrow { background: var(--ps-surface-2); }
.ps-root .ps-reqrow.sel { background: color-mix(in srgb, var(--ps-accent) 8%, var(--ps-surface-2)); }
.ps-root .ps-col, .ps-root .ps-card, .ps-root .ps-table tbody tr:hover { background: var(--ps-surface-2); }
.ps-root .ps-card { background: var(--ps-surface); }
.ps-root .ps-pre { background: var(--ps-paper); }
@container (max-width: 1000px) {
  .ps-shell { grid-template-columns: 196px minmax(0, 1fr); }
  .ps-rail { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--ps-line); max-height: 46vh; }
}
@container (max-width: 760px) {
  .ps-shell { grid-template-columns: minmax(0, 1fr); }
  .ps-nav { border-right: 0; border-bottom: 1px solid var(--ps-line); overflow: visible; }
  .ps-modes { flex-direction: row; overflow-x: auto; padding-bottom: 2px; }
  .ps-mode { flex: 0 0 auto; width: auto; }
  .ps-mode[aria-selected="true"]:before { display: none; }
  .ps-navsec, .ps-navfoot { display: none; }
  .ps-rail { max-height: 55vh; }
}
/* ── the owner's Edit mode ──────────────────────────────────────────────────────────────
   The form is the drawer's third tab. A field the owner has taken over keeps a badge and a
   release action on the same row, so "why did my text not move?" is answered where it happened. */
.ps-edit-form { display: grid; gap: 10px; margin: 0 0 12px; }
.ps-edit-field { display: grid; gap: 3px; }
.ps-edit-field > .ps-edit-label { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--ps-muted); }
.ps-edit-field input[type="text"], .ps-edit-field input[type="number"], .ps-edit-field textarea, .ps-edit-field select {
  width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 8px;
  border: 1px solid var(--ps-line); background: var(--ps-surface); color: var(--ps-ink);
  font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.ps-edit-field textarea { resize: vertical; min-height: 34px; }
.ps-edit-field input:focus-visible, .ps-edit-field textarea:focus-visible, .ps-edit-field select:focus-visible {
  outline: 2px solid var(--ps-accent); outline-offset: 1px;
}
.ps-edit-field .ps-edit-hint { color: var(--ps-muted); font-size: 11px; }
.ps-edit-field.manual > .ps-edit-label { color: var(--ps-ink); }
.ps-manual-badge { display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; border-radius: 999px; font-size: 9.5px; letter-spacing: .04em; text-transform: none; border: 1px solid color-mix(in srgb, #FFB020 55%, var(--ps-line)); background: color-mix(in srgb, #FFB020 16%, transparent); color: var(--ps-ink); }
.ps-edit-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 0 0 10px; }
.ps-edit-actions .ps-btn.primary { background: var(--ps-accent); border-color: var(--ps-accent); color: var(--ps-accent-ink, #fff); }
.ps-edit-note { border-radius: 8px; padding: 7px 9px; font-size: 11.5px; margin: 0 0 10px; border: 1px solid var(--ps-line); background: var(--ps-surface); }
.ps-edit-note.bad { border-color: color-mix(in srgb, var(--ps-bad) 55%, var(--ps-line)); color: var(--ps-bad); }
.ps-edit-note.ok { border-color: color-mix(in srgb, var(--ps-ok) 55%, var(--ps-line)); }
.ps-edit-readonly { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 10px; font-size: 11px; color: var(--ps-muted); margin: 0; }
.ps-edit-readonly dt { white-space: nowrap; }
.ps-edit-readonly dd { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
`

    /* ---------- read + parse helpers (read-only) ---------- */

    function isMissing(error) {
      const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
      return text.includes('not-found') || text.includes('not found') || text.includes('no such file') || text.includes('enoent') || text.includes('no entry at')
    }

    function errorText(error) {
      if (error === null || error === undefined) return 'unknown error'
      return String(error.message ?? error.code ?? error)
    }

    async function readText(remote, sessionId, path, signal) {
      if (remote?.workspaceFiles === undefined || typeof remote.workspaceFiles.read !== 'function') {
        return { ok: false, code: 'workspace_files_unavailable', message: 'This build has no workspaceFiles read API.' }
      }
      let offset = 1
      let text = ''
      let complete = false
      for (let page = 0; page < 60; page += 1) {
        let result
        try {
          // 5000 is the gateway's maximum page; the index is kept under it so a read is one trip.
          result = await remote.workspaceFiles.read(sessionId, path, { offset, limit: 5000 }, signal)
        } catch (error) {
          return { ok: false, code: 'read_failed', message: errorText(error) }
        }
        if (result?.ok !== true) return { ok: false, code: result?.error?.code ?? 'read_failed', message: errorText(result?.error), missing: isMissing(result?.error) }
        const value = result.value
        if (value === null || value === undefined) return { ok: false, code: 'read_failed', message: `${path}: read returned no value` }
        text += value.text
        if (value.eof) {
          complete = true
          break
        }
        if (value.lines === 0) return { ok: false, code: 'read_too_large', message: `${path}: the read did not reach EOF` }
        offset = value.offset + value.lines
        text += '\n'
      }
      if (!complete) return { ok: false, code: 'read_too_large', message: `${path}: more than 60 pages` }
      return { ok: true, text }
    }

    async function readJson(remote, sessionId, path, signal) {
      const read = await readText(remote, sessionId, path, signal)
      if (read.ok !== true) return read
      if (read.text.trim() === '') return { ok: false, code: 'empty_file', message: `${path} is empty` }
      try {
        return { ok: true, value: JSON.parse(read.text), text: read.text }
      } catch (error) {
        return { ok: false, code: 'invalid_json', message: `${path}: ${errorText(error)}` }
      }
    }

    function unquoteScalar(text) {
      const trimmed = String(text ?? '').trim()
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        try {
          return JSON.parse(trimmed)
        } catch {
          return trimmed.slice(1, -1)
        }
      }
      if (trimmed === 'true') return true
      if (trimmed === 'false') return false
      if (trimmed === 'null' || trimmed === '~') return null
      // The state writer emits a number unquoted and quotes a numeric STRING, so a bare
      // number here is a number (stepsDone, revision) and never a lost title.
      if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
      if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed)
      return trimmed
    }

    /**
     * Split an inline list on commas OUTSIDE a JSON string. The state writer quotes an item
     * that would not read back as itself, so an item may contain a comma or a bracket; a
     * backslash escapes only inside a double-quoted string, and an apostrophe is literal.
     */
    function splitInlineList(value) {
      const out = []
      let current = ''
      let quoted = false
      let escaped = false
      for (const character of String(value)) {
        if (escaped) {
          current += character
          escaped = false
        } else if (quoted && character === '\\') {
          current += character
          escaped = true
        } else if (character === '"') {
          quoted = !quoted
          current += character
        } else if (character === ',' && !quoted) {
          out.push(current)
          current = ''
        } else {
          current += character
        }
      }
      if (current.trim() !== '') out.push(current)
      return out.map(unquoteScalar)
    }

    /** The state entity format is line-based (lib/format.mjs); this reads only its subset. */
    function parseEntityText(text) {
      const normalized = String(text ?? '').replace(/\r\n/g, '\n')
      const lines = normalized.split('\n')
      if (lines[0] !== '---') return { frontmatter: {}, body: normalized }
      const close = lines.indexOf('---', 1)
      if (close < 0) return { frontmatter: {}, body: normalized }
      const frontmatter = {}
      let currentList = null
      let currentMap = null
      for (let index = 1; index < close; index += 1) {
        const line = lines[index]
        if (line.trim() === '' || line.trim().startsWith('#')) continue
        const top = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
        if (top !== null) {
          const key = top[1]
          const value = top[2]
          currentList = null
          currentMap = null
          if (value.trim() === '') {
            let next = ''
            for (let probe = index + 1; probe < close; probe += 1) {
              if (lines[probe].trim() === '') continue
              next = lines[probe]
              break
            }
            if (/^\s{2}[A-Za-z][\w-]*:\s/.test(next)) {
              frontmatter[key] = {}
              currentMap = frontmatter[key]
            } else {
              frontmatter[key] = []
              currentList = frontmatter[key]
            }
            continue
          }
          if (value.trim().startsWith('[') && value.trim().endsWith(']')) {
            frontmatter[key] = splitInlineList(value.trim().slice(1, -1).trim())
            continue
          }
          frontmatter[key] = unquoteScalar(value)
          continue
        }
        const item = /^\s{2}-\s*(.*)$/.exec(line)
        if (item !== null && currentList !== null) {
          const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(item[1])
          if (pair !== null) currentList.push({ [pair[1]]: unquoteScalar(pair[2]) })
          else currentList.push(unquoteScalar(item[1]))
          continue
        }
        const nested = /^\s{2,4}([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
        if (nested !== null && currentMap !== null) currentMap[nested[1]] = unquoteScalar(nested[2])
        // A LIST OF MAPS (acceptance `- text:` + `done:`, sessions `- sessionId:` + `role:`):
        // the later fields belong to the entry the `- ` line opened, not to the enclosing map.
        else if (nested !== null && currentList !== null && currentList.length > 0) {
          const last = currentList[currentList.length - 1]
          if (last !== null && typeof last === 'object' && !Array.isArray(last)) last[nested[1]] = unquoteScalar(nested[2])
        }
      }
      const body = lines.slice(close + 1).join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
      return { frontmatter, body }
    }

    /* ---------- data loading ---------- */

    function validateIndex(index) {
      if (index === null || typeof index !== 'object' || Array.isArray(index)) return 'index.json is not an object'
      if (index.schemaVersion !== 1) return `unsupported index schemaVersion ${String(index.schemaVersion)}; this panel reads version 1`
      for (const key of ['reqs', 'tasks', 'tests', 'decisions']) {
        if (!Array.isArray(index[key])) return `index.json has no ${key} array`
      }
      if (index.reqs.some((row) => typeof row?.id !== 'string')) return 'index.json has a REQ row without an id'
      return null
    }

    async function loadAnalysis(remote, sessionId, signal) {
      if (remote?.workspaceFiles === undefined || typeof remote.workspaceFiles.list !== 'function') {
        return { records: [], error: 'The workspaceFiles listing API is unavailable.' }
      }
      let listing
      try {
        listing = await remote.workspaceFiles.list(sessionId, ANALYSIS_DIR, signal)
      } catch (error) {
        return { records: [], error: errorText(error) }
      }
      if (listing?.ok !== true) {
        if (isMissing(listing?.error)) return { records: [], error: null, note: 'no docs/analysis directory' }
        return { records: [], error: errorText(listing?.error) }
      }
      const entries = Array.isArray(listing.value?.entries) ? listing.value.entries : []
      const files = entries.filter((entry) => entry.type === 'file' && String(entry.name).endsWith('.json')).slice(0, 40)
      const records = []
      for (const file of files) {
        const read = await readJson(remote, sessionId, `${ANALYSIS_DIR}/${file.name}`, signal)
        if (read.ok === true && read.value !== null && typeof read.value === 'object' && !Array.isArray(read.value)) records.push(read.value)
      }
      return { records, error: null, truncated: listing.value?.truncated === true, count: files.length }
    }

    /**
     * Keep the entity files already read when the workspace object is replaced (the cached
     * paint, the fresh read, a reload after a save). The drawer for an open entity would
     * otherwise lose its frontmatter and body, blanking the Edit form exactly when the owner is
     * looking at it. An entity is an immutable snapshot per read, so keeping the loaded one is
     * safe; re-opening the card re-reads it.
     */
    function withLoadedEntities(previous, next) {
      if (next?.phase !== 'ready' && next?.phase !== 'refreshing' && next?.phase !== 'loading') return next
      if (!(previous?.entities instanceof Map) || previous.entities.size === 0) return next
      return { ...next, entities: new Map([...previous.entities, ...(next.entities ?? new Map())]) }
    }

    async function loadWorkspace(remote, sessionId, signal) {
      const indexRead = await readJson(remote, sessionId, INDEX_PATH, signal)
      if (indexRead.ok !== true) {
        if (indexRead.missing === true) return { phase: 'empty', reason: 'missing-index' }
        return { phase: 'error', code: indexRead.code ?? 'index_unreadable', message: indexRead.message ?? 'index.json could not be read' }
      }
      const invalid = validateIndex(indexRead.value)
      if (invalid !== null) return { phase: 'error', code: 'projections_invalid', message: invalid }
      const index = indexRead.value
      const { workspace, legacy } = workspaceFromIndex(index)
      // A LEGACY index (written before the rows carried titles) still has to read as text:
      // the rows without a title are filled from their entity files, and only those. A current
      // index never enters this branch, so the fast path keeps its single read.
      // AN ALL-LEGACY INDEX IS NOT PATCHED BY READING 400+ FILES: that is the old several-second
      // open the owner complained about, and the titles come back the moment the state core
      // regenerates the projection. It is named instead, so the wait is one read, not 449.
      const rowCount = index.reqs.length + index.tasks.length + index.tests.length + index.decisions.length
      if (legacy.length > 0 && legacy.length < rowCount) {
        await Promise.all(legacy.map(async ({ kind, id }) => {
          const path = `state/${KIND_DIR[kind]}/${id}.md`
          const read = await readText(remote, sessionId, path, signal)
          if (read.ok !== true) return
          const parsed = parseEntityText(read.text)
          workspace.entities.set(id, { kind, id, path, frontmatter: parsed.frontmatter, body: parsed.body })
        }))
      } else if (legacy.length > 0) {
        workspace.issues.push('index.json carries no titles (old projection); regenerate state/views to restore titles')
      }
      return workspace
    }

    /**
     * The panel state of one index: the list fields are drawn from the rows, and the entity
     * map is a lookup over those same rows. Building it from a CACHED index lets the next open
     * paint before the network answers (stale-while-revalidate).
     */
    function workspaceFromIndex(index) {
      const entities = new Map()
      const legacy = []
      const track = (kind, row) => {
        if (row === null || typeof row !== 'object' || typeof row.id !== 'string') return
        entities.set(row.id, {
          kind,
          id: row.id,
          path: `state/${KIND_DIR[kind]}/${row.id}.md`,
          frontmatter: { ...row, id: row.id, kind, title: typeof row.title === 'string' && row.title !== '' ? row.title : row.id },
          body: undefined,
        })
        if (typeof row.title !== 'string' || row.title === '') legacy.push({ kind, id: row.id })
      }
      for (const row of index.reqs) track('req', row)
      for (const row of index.tasks) track('task', row)
      for (const row of index.tests) track('test', row)
      for (const row of index.decisions) track('decision', row)
      return { workspace: { phase: 'ready', index, entities, analysis: [], analysisLoaded: false, issues: [] }, legacy }
    }

    const INDEX_CACHE_PREFIX = 'dsh:project-state-panel:index:'
    function readCachedIndex(sessionId) {
      try {
        const text = sessionStorage.getItem(INDEX_CACHE_PREFIX + sessionId)
        if (typeof text !== 'string' || text === '') return null
        const index = JSON.parse(text)
        return validateIndex(index) === null ? index : null
      } catch {
        return null
      }
    }
    function writeCachedIndex(sessionId, index) {
      try {
        sessionStorage.setItem(INDEX_CACHE_PREFIX + sessionId, JSON.stringify(index))
      } catch {
        /* private mode or quota: the cache is an optimisation, never a requirement */
      }
    }

    /** Fetch one entity file for the drawer body; the index already drew its card. */
    async function loadEntity(remote, sessionId, id, kind, signal) {
      const path = `state/${KIND_DIR[kind]}/${id}.md`
      const read = await readText(remote, sessionId, path, signal)
      if (read.ok !== true) return { error: read.message ?? read.code ?? 'unreadable' }
      const parsed = parseEntityText(read.text)
      return { kind, id, path, frontmatter: parsed.frontmatter, body: parsed.body }
    }


    /* ---------- cross-links ---------- */

    function kindOfId(id) {
      const text = String(id ?? '')
      if (text.startsWith('REQ-')) return 'req'
      if (text.startsWith('TASK-')) return 'task'
      if (text.startsWith('TEST-')) return 'test'
      if (text.startsWith('DEC-')) return 'decision'
      return 'evidence'
    }

    function buildAnalysisLinks(analysis, entities) {
      const reqByAnalysisKey = new Map()
      for (const entity of entities.values()) {
        if (entity.kind !== 'req') continue
        const ref = entity.frontmatter?.analysisRef
        if (ref === null || typeof ref !== 'object') continue
        reqByAnalysisKey.set(`${String(ref.initiative ?? '')}#${String(ref.requirementId ?? '')}`, entity.id)
      }
      const componentReqs = new Map()
      for (const record of analysis?.records ?? []) {
        const recordId = String(record?.id ?? '')
        const trace = Array.isArray(record?.trace) ? record.trace : []
        for (const row of trace) {
          if (row === null || typeof row !== 'object') continue
          const componentId = String(row.componentId ?? '')
          if (componentId === '') continue
          const reqId = reqByAnalysisKey.get(`${recordId}#${String(row.requirementId ?? '')}`)
          if (reqId === undefined) continue
          if (!componentReqs.has(componentId)) componentReqs.set(componentId, new Set())
          componentReqs.get(componentId).add(reqId)
        }
      }
      return { componentReqs, reqByAnalysisKey }
    }

    function requirementsForNode(node, links) {
      if (node === null || node === undefined || links === null || links === undefined) return []
      const ids = new Set()
      const nodeId = String(node.id ?? '')
      const suffix = nodeId.includes('.') ? nodeId.slice(nodeId.lastIndexOf('.') + 1) : nodeId
      for (const componentId of [nodeId, suffix]) {
        const set = links.componentReqs.get(componentId)
        if (set !== undefined) for (const id of set) ids.add(id)
      }
      for (const [componentId, set] of links.componentReqs) {
        if (nodeId.endsWith(`.${componentId}`)) for (const id of set) ids.add(id)
      }
      return [...ids].sort()
    }


    /**
     * One class per status, not four shared tones: `active` and `review` used to be the same
     * colour, and `open` had none, so a board could not be read by colour. Unknown statuses
     * fall back to a neutral chip instead of looking like a completed one.
     */
    const STATUS_TONE = {
      proposed: 'proposed', open: 'open', active: 'active', running: 'running', idle: 'muted', review: 'review',
      blocked: 'blocked', failing: 'failing', rejected: 'rejected', done: 'done',
      verified: 'verified', accepted: 'accepted', cancelled: 'cancelled', superseded: 'superseded',
      dropped: 'dropped', stale: 'stale', unverified: 'unverified',
    }
    function statusTone(status) {
      return STATUS_TONE[String(status ?? '')] ?? 'muted'
    }

    function titleOf(entity, fallback) {
      const title = entity?.frontmatter?.title
      return typeof title === 'string' && title.trim() !== '' ? title : fallback ?? String(entity?.id ?? '')
    }

    function shortHash(value) {
      if (typeof value !== 'string' || value === '') return 'no hash recorded'
      const bare = value.startsWith('sha256:') ? value.slice(7) : value
      return `${value.startsWith('sha256:') ? 'sha256:' : ''}${bare.slice(0, 12)}…`
    }

    /* ---------- small shared components ---------- */

    function TypeChip({ kind, id, title, onClick, static: isStatic }) {
      const label = KIND_LABEL[kind] ?? KIND_LABEL.evidence
      const style = { '--ps-type': TYPE_COLOR[kind] ?? TYPE_COLOR.evidence }
      const className = `ps-chip ${isStatic === true || typeof onClick !== 'function' ? 'static' : ''} ${kind === 'evidence' ? 'evidence' : ''}`
      const content = [
        h('span', { className: 'mark', key: 'mark', 'aria-hidden': 'true' }),
        h('code', { key: 'id' }, String(id ?? '')),
      ]
      if (isStatic === true || typeof onClick !== 'function') {
        return h('span', { className, style, title: title ?? `${label} ${id}` }, ...content)
      }
      return h('button', { type: 'button', className, style, onClick, title: title ?? `${label} ${id}`, 'aria-label': title ?? `Open ${label} ${id}` }, ...content)
    }

    function Status({ status }) {
      return h('span', { className: `ps-status ${statusTone(status)}` }, String(status ?? 'unknown'))
    }

    function Gap({ children, onClick, title, static: isStatic }) {
      if (isStatic === true || typeof onClick !== 'function') return h('span', { className: 'ps-gap static' }, children)
      return h('button', { type: 'button', className: 'ps-gap', onClick, title: title ?? children }, children)
    }

    function Alert({ code, children }) {
      return h('div', { className: 'ps-alert', role: 'alert' }, code === undefined ? null : h('code', null, `${code}: `), children)
    }

    function Empty({ title, children, onReload }) {
      return h('div', { className: 'ps-empty' },
        h('h2', null, title),
        children,
        typeof onReload === 'function' ? h('button', { type: 'button', className: 'ps-btn small', onClick: onReload, style: { marginTop: 8 } }, 'Reload') : null,
      )
    }

    /* ---------- requirements mode ---------- */

    function RequirementRow({ req, data, selected, onSelect, onOpen, onOpenEntityDrawer }) {
      const entity = data.entities.get(req.id)
      const fm = entity?.frontmatter ?? {}
      const criteria = Array.isArray(fm.criteria) ? fm.criteria : []
      const taskCount = req.tasks.length
      const testCount = req.tests.length
      return h('li', { className: `ps-reqrow${selected ? ' sel' : ''}` },
        h('div', { className: 'body' },
          h('button', {
            type: 'button',
            className: 'ps-rowbtn',
            'aria-pressed': selected,
            onClick: () => onSelect(req.id),
            title: selected ? `Clear the ${req.id} filter` : `Filter the other modes by ${req.id}`,
          },
          h('div', { className: 'ps-rowmeta' },
            h(TypeChip, { kind: 'req', id: req.id, static: true }),
            h(Status, { status: req.status }),
            selected ? h('span', { className: 'ps-status info' }, 'filter') : null,
          ),
          h('div', { className: 'ps-rowtitle' }, titleOf(entity, req.id)),
          ),
          criteria.length > 0
            ? h('ol', { className: 'ps-criteria' }, criteria.slice(0, 4).map((criterion, index) => h('li', { key: index }, String(criterion))))
            : h('p', { className: 'ps-criteria' }, 'No criteria recorded — the state core reports `req_criteria_missing`.'),
          h('div', { className: 'ps-rowmeta' },
            taskCount > 0
              ? h('span', { className: 'ps-count' }, h('b', null, String(taskCount)), taskCount === 1 ? ' task' : ' tasks')
              : h(Gap, { onClick: () => { onSelect(req.id); onOpen('board', req.id) }, title: `No task is linked to ${req.id}; open the board filtered by it` }, 'no task'),
            testCount > 0
              ? h('span', { className: 'ps-count' }, h('b', null, String(testCount)), testCount === 1 ? ' test' : ' tests')
              : h(Gap, { onClick: () => { onSelect(req.id); onOpen('trace', req.id) }, title: `No test is linked to ${req.id}; open tests and trace filtered by it` }, 'no test'),
            h('span', { className: 'ps-spacer' }),
            h('button', { type: 'button', className: 'ps-btn small', onClick: () => onOpenEntityDrawer(req.id) }, 'Details'),
          ),
        ),
      )
    }

    function RequirementsMode({ data, filter, onSelect, onOpenMode, onOpenEntityDrawer }) {
      const reqs = data.index.reqs
      if (reqs.length === 0) return h(Empty, { title: 'No requirement in the registry' }, h('p', null, 'The state core wrote projections, but the REQ registry is empty. Requirements are created through the state core; this panel does not create them.'))
      return h('div', null,
        h('p', { className: 'ps-kicker' }, 'Business requirements'),
        h('ul', { className: 'ps-reqlist' }, reqs.map((req) => h(RequirementRow, {
          key: req.id,
          req,
          data,
          selected: filter === req.id,
          onSelect: (id) => onSelect(filter === id ? null : id),
          onOpen: onOpenMode,
          onOpenEntityDrawer,
        }))),
      )
    }

    /* ---------- board mode ---------- */

    /**
     * THE STATUS BADGE IS THE CONTROL. There is no second control repeating the state: the
     * tone-coloured badge itself is a native `<select>`, so clicking it opens the status list and
     * choosing one writes through the board. Native select keeps keyboard, screen-reader and
     * touch behaviour for free; the caret is CSS (`.ps-statuswrap::after`), not a second element
     * with its own text. Without a write path (no command transport) the plain read-only chip is
     * rendered instead, so a consumer of this component cannot offer a control that cannot work.
     */
    function StatusSelect({ taskId, status, onChange, busy }) {
      if (typeof onChange !== 'function') return h(Status, { status })
      const current = String(status ?? '')
      // A legacy row may carry a status the registry does not list (`paused` maps to blocked on
      // the mirror, but a hand-written TASK can say anything): it is still shown, as the selected
      // option, instead of the browser silently displaying the first choice.
      const choices = TASK_STATUS_CHOICES.includes(current) ? TASK_STATUS_CHOICES : (current === '' ? TASK_STATUS_CHOICES : [current, ...TASK_STATUS_CHOICES])
      return h('span', { className: 'ps-statuswrap' },
        h('select', {
          className: `ps-status ps-statusselect ${statusTone(current)}`,
          value: current,
          disabled: busy === true,
          'aria-label': `Status of ${taskId}: ${current || 'unknown'}. Choose another status to change it as the owner`,
          title: 'Click the status and pick another: as the owner this overrides the lifecycle rules, and the board records it in the state journal',
          onClick: (event) => event.stopPropagation(),
          onKeyDown: (event) => event.stopPropagation(),
          onChange: (event) => onChange(taskId, event.target.value),
        }, choices.map((choice) => h('option', { key: choice, value: choice }, choice))),
      )
    }

    /**
     * The drawer's status badge plus the one thing a click cannot carry: WHY the owner changed it.
     * The reason is optional and travels with the next pick (the journal event records it).
     */
    function TaskStatusBadge({ taskId, status, onChange, busy }) {
      const [reason, setReason] = useState('')
      return h('span', { className: 'ps-statuscontrol' },
        h(StatusSelect, { taskId, status, onChange: (id, next) => { onChange(id, next, reason); setReason('') }, busy }),
        h('input', {
          className: 'ps-input ps-reason',
          type: 'text',
          value: reason,
          maxLength: 200,
          disabled: busy === true,
          placeholder: 'why? (optional, goes to the journal)',
          'aria-label': `Why ${taskId} changes status (optional, recorded in the state journal)`,
          onClick: (event) => event.stopPropagation(),
          onChange: (event) => setReason(event.target.value),
        }),
      )
    }

    /**
     * One task on the board. The open action and the status badge are siblings — a card that
     * opens a drawer must not contain a nested control — so the badge sits in the card's corner
     * and the rest of the card is one button.
     */
    function TaskCard({ task, data, onOpen, sessionsById = {}, onChangeStatus, busy }) {
      const entity = data.entities.get(task.id)
      const fm = entity?.frontmatter ?? {}
      const tests = data.index.tests.filter((test) => Array.isArray(test.evidenceRefs) && test.evidenceRefs.some((ref) => ref.kind === 'task' && ref.id === task.id))
      const sessions = taskSessions(fm, sessionsById)
      const running = sessions.filter((session) => session.running).length
      const reqIds = requirementIdsOf(task, fm)
      const title = titleOf(entity, task.id)
      return h('div', { className: 'ps-card', 'data-status': task.status },
        h('button', {
          type: 'button',
          className: 'ps-cardopen',
          onClick: () => onOpen(task.id),
          'aria-label': `${task.id}: ${title}, ${task.status}${reqIds.length === 0 ? (task.chore === true ? ', chore' : ', no requirement') : `, requirement ${reqIds.join(', ')}`}`,
        },
          h('div', { className: 't' }, title),
          h('div', { className: 'm' }, h(TypeChip, { kind: 'task', id: task.id, static: true })),
          h('div', { className: 'm' },
            reqIds.length > 0
              ? reqIds.map((id) => h(TypeChip, { key: id, kind: 'req', id, static: true }))
              : (task.chore === true ? h('span', { className: 'ps-chip static', style: { '--ps-type': TYPE_COLOR.evidence } }, h('span', { className: 'mark' }), h('code', null, 'chore')) : h('span', { className: 'none' }, 'no requirement')),
            tests.length > 0 ? h('span', { className: 'ps-count' }, h('b', null, String(tests.length)), tests.length === 1 ? ' test' : ' tests') : h('span', { className: 'none' }, fm.status === 'done' ? 'no test' : ''),
          ),
          // WHO IS WORKING NOW, as a row of its own: a task can be active with an idle child,
          // and a running child is the claim the board must be able to show without opening it.
          sessions.length === 0
            ? null
            : h('div', { className: 'm', 'aria-label': `${running} of ${sessions.length} subagents running` },
                running > 0
                  ? h('span', { className: 'ps-count', style: { color: 'var(--ps-ok)' } }, h('span', { className: 'ps-dot', 'aria-hidden': 'true' }), h('b', null, String(running)), ` of ${sessions.length} subagent${sessions.length === 1 ? '' : 's'} running`)
                  : h('span', { className: 'ps-count', style: { color: 'var(--ps-muted)' } }, h('span', { className: 'ps-dot', 'aria-hidden': 'true' }), `${sessions.length} subagent${sessions.length === 1 ? '' : 's'} idle`),
              ),
        ),
        // THE BADGE IS THE CONTROL, AND THE ONLY STATUS DISPLAY ON THE CARD: it sits in its own
        // row under the open button (a button must not contain another control), so the title
        // keeps the card's full width and nothing repeats the state.
        h('div', { className: 'ps-cardfoot' },
          h(StatusSelect, { taskId: task.id, status: task.status, onChange: onChangeStatus, busy }),
        ),
      )
    }

    function TaskListTable({ rows, onOpenTask, onChangeStatus, statusBusy }) {
      return h('table', { className: 'ps-table ps-tasklist' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Status'),
          h('th', { scope: 'col' }, 'Task'),
          h('th', { scope: 'col' }, 'Role'),
          h('th', { scope: 'col' }, 'Requirement'),
          h('th', { scope: 'col' }, 'Progress'),
          h('th', { scope: 'col' }, 'Subagents'),
          h('th', { scope: 'col' }, 'Updated'),
        )),
        h('tbody', null, rows.map((row) => h('tr', {
          key: row.id,
          tabIndex: 0,
          onClick: () => onOpenTask(row.id),
          onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenTask(row.id) } },
          'aria-label': `${row.id}: ${row.title}, ${row.status}${row.reqIds.length === 0 ? '' : `, requirement ${row.reqIds.join(', ')}`}`,
        },
          // THE BADGE ITSELF IS THE CONTROL (the list is the default view, so it must be here).
          // Its click stops at the badge; the row's click opens the drawer.
          h('td', null, h(StatusSelect, { taskId: row.id, status: row.status, onChange: onChangeStatus, busy: statusBusy === row.id })),
          h('td', null,
            h('div', { className: 'ps-cellchips' }, h(TypeChip, { kind: 'task', id: row.id, static: true })),
            h('div', { style: { marginTop: 3, fontWeight: 600 } }, row.title),
          ),
          h('td', null, row.inline
            ? h('span', { className: 'ps-meta' }, 'inline')
            : (row.role !== ''
                ? h('span', { className: 'ps-rolecell', title: row.preset === '' ? row.role : `${row.role} · ${row.preset}` },
                    h('b', null, row.role),
                    row.preset === '' ? null : h('span', { className: 'ps-meta' }, row.preset))
                : h('span', { className: 'none' }, '—'))),
          h('td', null, row.reqIds.length === 0
            ? (row.chore ? h('span', { className: 'ps-chip static' }, h('span', { className: 'mark' }), h('code', null, 'chore')) : h('span', { className: 'none' }, 'no requirement'))
            : h('div', { className: 'ps-cellchips' }, row.reqIds.map((id) => h(TypeChip, { key: id, kind: 'req', id, static: true })))),
          h('td', { className: 'ps-updated', title: row.steps === 0 ? 'No steps are recorded on this task' : `${row.stepsDone} of ${row.steps} steps done` }, row.steps === 0 ? '—' : `${row.stepsDone}/${row.steps}`),
          h('td', {
            className: 'ps-updated',
            title: row.sessions.length === 0
              ? 'No subagent session is recorded on this task'
              : `${row.running} of ${row.sessions.length} subagent sessions running now (a task stays active until it is accepted, so its status is not this number)`,
          }, row.sessions.length === 0
            ? '—'
            : h('span', { style: { color: row.running > 0 ? 'var(--ps-ok)' : 'var(--ps-muted)', fontWeight: 600 } },
                row.running > 0 ? `${row.running} running` : `${row.sessions.length} idle`)),
          h('td', { className: 'ps-updated', title: row.updatedAt === '' ? 'No updatedAt in the projection' : row.updatedAt }, relativeLabel(row.updatedAt)),
        ))),
      )
    }

    function BoardMode({ data, filter, onOpenTask, onClearFilter, view, sort, onView, onSort, sessionsById = {}, onChangeStatus, statusBusy, hideChores, onHideChores }) {
      // A FILTER MATCHES EVERY LINKED REQUIREMENT, not just `reqId`: a batch task carries
      // `reqIds` and used to disappear from a board filtered by one of them.
      const scoped = data.index.tasks.filter((task) => filter === null || requirementIdsOf(task, data.entities.get(task.id)?.frontmatter).includes(filter))
      if (data.index.tasks.length === 0) return h(Empty, { title: 'No task on the board' }, h('p', null, 'The task board is a projection of state/task/. Tasks are created in the Tasks panel or by the orchestrator.'))
      if (filter !== null && scoped.length === 0) return h('div', null,
        h('p', { className: 'ps-kicker' }, 'Task board'),
        h('p', { className: 'ps-empty' }, `No task is linked to ${filter}. This is a traceability gap, not an empty board: `, h('button', { type: 'button', className: 'ps-gap', onClick: onClearFilter }, 'clear the filter'), ' to see every task.'),
      )
      // VIEW ONLY: the hidden rows stay in the projection and on the board; this filter decides
      // what is DRAWN, so hiding chores never touches state/ or .dsh/taskboard.json.
      const choreCount = scoped.filter((task) => isChoreTask(task, data.entities.get(task.id)?.frontmatter)).length
      const visible = hideChores === true ? scoped.filter((task) => !isChoreTask(task, data.entities.get(task.id)?.frontmatter)) : scoped
      const allHidden = hideChores === true && visible.length === 0 && scoped.length > 0
      const rows = sortTasks(visible.map((task) => taskRow(task, data.entities, sessionsById)), sort)
      const kicker = view === 'list' ? 'Task list' : 'Task board'
      return h('div', null,
        h('p', { className: 'ps-kicker' }, filter === null ? kicker : `${kicker} · filtered by ${filter}`),
        h('div', { className: 'ps-subbar' },
          h('div', { className: 'ps-group', role: 'group', 'aria-label': 'Task view' },
            h('button', { type: 'button', className: view === 'board' ? 'on' : '', 'aria-pressed': view === 'board', title: 'Group tasks by status', onClick: () => onView('board') }, 'Board'),
            h('button', { type: 'button', className: view === 'list' ? 'on' : '', 'aria-pressed': view === 'list', title: 'Read tasks as a sortable table', onClick: () => onView('list') }, 'List'),
          ),
          view === 'list'
            ? h('div', { className: 'ps-group', role: 'group', 'aria-label': 'Sort tasks' }, SORT_TAGS.map((tag) => h('button', {
                key: tag.id,
                type: 'button',
                className: sort === tag.id ? 'on' : '',
                'aria-pressed': sort === tag.id,
                title: tag.title,
                onClick: () => onSort(tag.id),
              }, tag.label)))
            : null,
          // ONE BUTTON, BOTH VIEWS. The count is the chore tasks in the current requirement
          // filter, so the control says what it would hide before it is pressed.
          h('div', { className: 'ps-group', role: 'group', 'aria-label': 'Task visibility' },
            h('button', {
              type: 'button',
              className: hideChores === true ? 'on' : '',
              'aria-pressed': hideChores === true,
              disabled: choreCount === 0,
              title: choreCount === 0
                ? 'No chore task in this view'
                : `${choreCount} chore task${choreCount === 1 ? '' : 's'} in this view; ${hideChores === true ? 'hidden' : 'shown'}. Hiding is a view setting: no file is written.`,
              onClick: () => onHideChores(hideChores !== true),
            }, `Hide chores (${choreCount})`),
          ),
          h('span', { className: 'ps-meta' }, `${rows.length} task${rows.length === 1 ? '' : 's'}`),
        ),
        view === 'list'
          ? (allHidden
              ? h('p', { className: 'ps-empty' }, `Every task in this view is a chore (${choreCount}) and chore tasks are hidden. `, h('button', { type: 'button', className: 'ps-gap', onClick: () => onHideChores(false) }, 'Show chores'), ' to see them.')
              : h('div', { className: 'ps-tablewrap' }, h(TaskListTable, { rows, onOpenTask, onChangeStatus, statusBusy })))
          : (allHidden
              ? h('p', { className: 'ps-empty' }, `Every task in this view is a chore (${choreCount}) and chore tasks are hidden. `, h('button', { type: 'button', className: 'ps-gap', onClick: () => onHideChores(false) }, 'Show chores'), ' to see them.')
              : h('div', { className: 'ps-board', role: 'list' }, TASK_COLUMNS.map((column) => {
              const items = visible.filter((task) => column.statuses.includes(task.status))
              return h('div', { className: 'ps-col', key: column.id, role: 'group', 'aria-label': `${column.label} tasks`, 'data-status': column.statuses[0] },
                h('h3', null, column.label, h('span', { className: 'n' }, String(items.length))),
                items.length === 0
                  ? h('div', { className: 'ps-empty', style: { padding: '6px 2px', fontSize: 11 } }, '—')
                  : items.map((task) => h('div', { key: task.id, role: 'listitem' }, h(TaskCard, { task, data, onOpen: onOpenTask, sessionsById, onChangeStatus, busy: statusBusy === task.id }))),
              )
            }))),
      )
    }

    /* ---------- tests + trace mode ---------- */

    function TestsTable({ data, filter, onOpenTest, onSelectReq }) {
      const tests = data.index.tests.filter((test) => filter === null || test.reqId === filter)
      if (data.index.tests.length === 0) return h(Empty, { title: 'No test recorded' }, h('p', null, 'The TEST registry is empty. Tests are recorded by the test-case runner and the state core; this panel does not create them.'))
      if (tests.length === 0) return h('p', { className: 'ps-empty' }, `No test is linked to ${filter}. That is a traceability gap; clear the filter to see every test.`)
      return h('table', { className: 'ps-table' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Test'),
          h('th', { scope: 'col' }, 'Requirement'),
          h('th', { scope: 'col' }, 'Status'),
          // No Evidence column: the evidence of a test is shown in its card, and the trace
          // matrix already names the TEST it belongs to. A second chip row here repeated it.
        )),
        h('tbody', null, tests.map((test) => {
          const entity = data.entities.get(test.id)
          const fm = entity?.frontmatter ?? {}
          return h('tr', {
            key: test.id,
            tabIndex: 0,
            onClick: () => onOpenTest(test.id),
            onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenTest(test.id) } },
            'aria-label': `${test.id}: ${titleOf(entity, test.id)}`,
          },
            h('td', null,
              h('div', { className: 'ps-cellchips' }, h(TypeChip, { kind: 'test', id: test.id, static: true })),
              h('div', { style: { marginTop: 3, fontWeight: 600 } }, titleOf(entity, test.id)),
              typeof fm.command === 'string' && fm.command !== '' ? h('div', { className: 'ps-meta', style: { marginTop: 2 } }, h('code', null, fm.command)) : null,
            ),
            h('td', null, test.reqId ? h(TypeChip, { kind: 'req', id: test.reqId, onClick: (event) => { event.stopPropagation(); onSelectReq(test.reqId) } }) : h(Gap, { static: true }, 'no requirement')),
            h('td', null, h(Status, { status: test.status })),
          )
        })),
      )
    }

    function TraceMatrix({ data, filter, onSelectReq, onOpenMode }) {
      const reqs = data.index.reqs.filter((req) => filter === null || req.id === filter)
      if (reqs.length === 0) return h('p', { className: 'ps-empty' }, 'No requirement matches the filter.')
      const chips = (ids, kind, emptyLabel, emptyMode) => ids.length > 0
        ? h('div', { className: 'ps-cellchips' }, ids.map((id) => h(TypeChip, { key: id, kind, id })))
        : h(Gap, { onClick: () => onOpenMode(emptyMode, filter) }, emptyLabel)
      return h('table', { className: 'ps-table' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Requirement'),
          h('th', { scope: 'col' }, 'Tasks'),
          h('th', { scope: 'col' }, 'Tests'),
        )),
        h('tbody', null, reqs.map((req) => {
          const entity = data.entities.get(req.id)
          return h('tr', { key: req.id },
            h('td', null,
              h('div', { className: 'ps-cellchips' },
                h(TypeChip, { kind: 'req', id: req.id, onClick: () => onSelectReq(filter === req.id ? null : req.id) }),
                h(Status, { status: req.status }),
              ),
              h('div', { style: { marginTop: 3, fontWeight: 600 } }, titleOf(entity, req.id)),
            ),
            h('td', null, chips(req.tasks, 'task', 'no task', 'board')),
            h('td', null, chips(req.tests, 'test', 'no test', 'trace')),
          )
        })),
      )
    }

    function TestsMode({ data, filter, subview, setSubview, onOpenTest, onSelectReq, onOpenMode }) {
      if (data.index.tests.length === 0 && data.index.reqs.length === 0) return h(Empty, { title: 'No test and no trace' }, h('p', null, 'The projections carry no TEST and no REQ row.'))
      return h('div', null,
        h('div', { className: 'ps-subbar' },
          h('p', { className: 'ps-kicker', style: { margin: 0 } }, 'Tests and traceability'),
          h('span', { className: 'ps-spacer' }),
          h('div', { className: 'ps-group', role: 'group', 'aria-label': 'Tests or trace matrix' },
            h('button', { type: 'button', className: subview === 'tests' ? 'on' : '', 'aria-pressed': subview === 'tests', onClick: () => setSubview('tests') }, 'Tests'),
            h('button', { type: 'button', className: subview === 'trace' ? 'on' : '', 'aria-pressed': subview === 'trace', onClick: () => setSubview('trace') }, 'Trace matrix'),
          ),
        ),
        subview === 'trace'
          ? h(TraceMatrix, { data, filter, onSelectReq, onOpenMode })
          : h(TestsTable, { data, filter, onOpenTest, onSelectReq }),
      )
    }

    /* ---------- map mode ---------- */

    /**
     * Design map = the page editor (v2 P2). The editor lives here because the state panel has a
     * control that opens it and the designmap package no longer registers a main slot. The page
     * file is the only store: the editor lists designmap/pages, opens one scene, and writes that
     * scene back through the designmap command (pages | page | save | tidy-page | render-page).
     */
    function MapMode({ remote, sessionId }) {
      const host = useMemo(
        () => (createDesignmapHost === undefined || typeof createDesignmapHost !== 'function'
          ? null
          : createDesignmapHost({ remote, sessionId })),
        [remote, sessionId],
      )
      if (PageEditor === undefined) {
        return h('div', null,
          h('p', { className: 'ps-kicker' }, 'Design map'),
          h(Empty, { title: 'The page editor is not available' },
            h('p', null, 'The installed @cc/dsh-designmap client does not export PageEditor. Update the designmap plugin to the v2 build.')),
        )
      }
      if (host === null) {
        return h('div', null,
          h('p', { className: 'ps-kicker' }, 'Design map'),
          h('p', { className: 'ps-empty' }, 'Open a conversation to load the design map.'),
        )
      }
      return h('div', { className: 'ps-mapstage', 'data-designmap-page-editor': 'true' }, h(PageEditor, { host }))
    }

    /**
     * The generated plan view (state/views/plan.md), read once per panel session.
     *
     * The view is written by regenerateViews() from docs/analysis/*.json and the journal; the
     * panel parses its tables and its bullet list and renders them. Nothing here writes, polls or
     * re-reads on a tab switch: the parsed object lives in the panel, so opening Plan again costs
     * no request (REQ-309).
     */
    function parsePlanView(text) {
      const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
      const cells = (line) => line.split('|').slice(1, -1).map((cell) => cell.trim())
      const meta = /Инициатив:\s*(\d+);\s*с открытыми задачами:\s*(\d+);\s*с несделанными требованиями:\s*(\d+)/.exec(String(text ?? ''))
      const initiatives = []
      const decisions = []
      const openTasks = []
      let section = null
      for (const line of lines) {
        const heading = /^##\s+(.*)$/.exec(line)
        if (heading !== null) {
          section = heading[1].startsWith('Решения') ? 'decisions' : (heading[1].startsWith('Открытые задачи') ? 'tasks' : null)
          continue
        }
        if (section === 'decisions' && line.startsWith('|')) {
          const row = cells(line)
          if (row.length < 4 || row[0] === 'Решение' || /^-+$/.test(row[0])) continue
          decisions.push({ id: row[0], status: row[1], initiative: row[2], title: row[3] })
          continue
        }
        if (section === 'tasks') {
          const bullet = /^-\s+(\S+)\s+\(([^)]+)\):\s*(.*)$/.exec(line.trim())
          if (bullet !== null) openTasks.push({ id: bullet[1], status: bullet[2], title: bullet[3] })
          continue
        }
        if (section !== null || !line.startsWith('|')) continue
        // The initiative table is the one before the first "## " heading.
        const row = cells(line)
        if (row.length < 5 || row[0] === 'Инициатива' || /^-+$/.test(row[0])) continue
        const dash = row[0].indexOf(' — ')
        const confirmed = /^(\d+)\s+из\s+(\d+)$/.exec(row[2])
        initiatives.push({
          id: dash < 0 ? row[0] : row[0].slice(0, dash),
          title: dash < 0 ? row[0] : row[0].slice(dash + 3),
          stage: row[1],
          confirmed: confirmed === null ? null : Number(confirmed[1]),
          requirements: confirmed === null ? null : Number(confirmed[2]),
          remaining: row[3],
          openTasks: row[4] === '—' ? 0 : row[4],
        })
      }
      // UNFINISHED WORK ONLY, and the newest decision first (DEC-004 before DEC-001).
      const withWork = initiatives.filter((row) => row.remaining !== '—' || row.openTasks !== 0)
      decisions.sort((left, right) => right.id.localeCompare(left.id))
      return {
        totals: meta === null ? null : { initiatives: Number(meta[1]), withOpenTasks: Number(meta[2]), withWork: Number(meta[3]) },
        initiatives: withWork,
        decisions,
        openTasks,
      }
    }

    function PlanMode({ plan, reload }) {
      if (plan.phase === 'loading' || plan.phase === 'idle') {
        return h('div', null, h('p', { className: 'ps-kicker' }, 'Plan'), h('p', { className: 'ps-loading' }, 'Reading state/views/plan.md…'))
      }
      if (plan.phase === 'error') {
        return h('div', null,
          h('p', { className: 'ps-kicker' }, 'Plan'),
          h(Alert, { code: plan.code }, plan.message),
          h('button', { type: 'button', className: 'ps-btn small', onClick: reload }, 'Read it again'),
        )
      }
      if (plan.phase === 'empty') {
        return h('div', null,
          h('p', { className: 'ps-kicker' }, 'Plan'),
          h(Empty, { title: 'No generated plan in this workspace' },
            h('p', null, 'Expected ', h('code', null, PLAN_VIEW_PATH), '. The state core writes it with ', h('code', null, 'regenerateViews()'), ' from docs/analysis/*.json and the journal; the panel never creates it.'),
            h('button', { type: 'button', className: 'ps-btn small', onClick: reload }, 'Read it again'),
          ),
        )
      }
      const view = plan.view
      const nothing = view.initiatives.length === 0 && view.decisions.length === 0 && view.openTasks.length === 0
      return h('div', null,
        h('p', { className: 'ps-kicker' }, 'Plan'),
        h('h2', { className: 'ps-planh' }, 'Long-term plan'),
        h('p', { className: 'ps-meta' },
          view.totals === null
            ? PLAN_VIEW_PATH
            // The header's "with open tasks" count is NOT printed: the view's own header says 0 while
            // the file lists six open tasks below, and a pane that repeats a number it contradicts
            // reads as broken. The section headings carry the counts the panel actually drew.
            : `${view.totals.initiatives} initiative${view.totals.initiatives === 1 ? '' : 's'}, ${view.totals.withWork} with requirements left. Read from ${PLAN_VIEW_PATH}.`),
        nothing
          ? h('p', { className: 'ps-empty' }, 'The plan is empty: no initiative has work left, no decision is recorded and no task is open.')
          : null,
        view.initiatives.length === 0
          ? null
          : h('section', { className: 'ps-plansec' },
              h('h3', null, `Initiatives with work left (${view.initiatives.length})`),
              h('div', { className: 'ps-tablewrap' },
                h('table', { className: 'ps-table ps-planinit' },
                  h('thead', null, h('tr', null,
                    h('th', { scope: 'col' }, 'Initiative'),
                    h('th', { scope: 'col' }, 'Stage'),
                    h('th', { scope: 'col' }, 'Confirmed'),
                  )),
                  h('tbody', null, view.initiatives.map((row) => h('tr', { key: row.id },
                    h('td', null, h('b', null, row.title), h('div', { className: 'ps-meta' }, h('code', null, row.id))),
                    h('td', null, h('span', { className: 'ps-meta' }, row.stage)),
                    h('td', null, row.confirmed === null ? h('span', { className: 'none' }, '—') : `${row.confirmed} of ${row.requirements}`),
                  ))),
                ),
              ),
            ),
        view.decisions.length === 0
          ? null
          : h('section', { className: 'ps-plansec' },
              h('h3', null, `Decisions (${view.decisions.length})`),
              h('ul', { className: 'ps-planlist' }, view.decisions.map((row) => h('li', { key: row.id },
                h('code', null, row.id), ' ', h('b', null, row.title),
                h('span', { className: 'ps-meta' }, ` · ${row.initiative} · ${row.status}`),
              ))),
            ),
        view.openTasks.length === 0
          ? null
          : h('section', { className: 'ps-plansec' },
              h('h3', null, `Open tasks (${view.openTasks.length})`),
              h('ul', { className: 'ps-planlist' }, view.openTasks.map((row) => h('li', { key: row.id },
                h('code', null, row.id), ' ', h('b', null, row.title),
                h('span', { className: 'ps-meta' }, ` · ${row.status}`),
              ))),
            ),
      )
    }

    /* ---------- evidence block + drawer ---------- */

    function EvidenceBlock({ text }) {
      if (typeof text !== 'string' || text.trim() === '') return null
      const lines = text.split('\n')
      return h('pre', { className: 'ps-pre' }, lines.map((line, index) => {
        const trimmed = line.trimStart()
        const tone = /^RED\b/i.test(trimmed) ? 'red' : /^GREEN\b/i.test(trimmed) ? 'green' : /^(exit|evidence|run)\b/i.test(trimmed) ? 'dim' : null
        return h('span', { key: index, className: tone ?? undefined }, `${line}${index < lines.length - 1 ? '\n' : ''}`)
      }))
    }

    function EntityLinks({ kind, id, filter, data, analysisLinks, node, onOpenEntity, onOpenRequirement, onOpenMode, onCloseFilter }) {
      const index = data.index
      const req = kind === 'req' ? index.reqs.find((row) => row.id === id) : null
      const test = kind === 'test' ? index.tests.find((row) => row.id === id) : null
      const task = kind === 'task' ? index.tasks.find((row) => row.id === id) : null
      const entity = data.entities.get(id)
      const fm = entity?.frontmatter ?? {}
      const sections = []

      if (req !== null) {
        sections.push(h('div', { className: 'ps-sec', key: 'tasks' },
          h('h3', null, `Tasks (${req.tasks.length})`),
          req.tasks.length > 0
            ? h('div', { className: 'ps-chiplist' }, req.tasks.map((taskId) => h(TypeChip, { key: taskId, kind: 'task', id: taskId, onClick: () => onOpenEntity(taskId) })))
            : h('p', { className: 'muted' }, h(Gap, { onClick: () => onOpenMode('board', req.id) }, 'no task'), ' This requirement has no task in the projections.'),
        ))
        sections.push(h('div', { className: 'ps-sec', key: 'tests' },
          h('h3', null, `Tests (${req.tests.length})`),
          req.tests.length > 0
            ? h('div', { className: 'ps-chiplist' }, req.tests.map((testId) => h(TypeChip, { key: testId, kind: 'test', id: testId, onClick: () => onOpenEntity(testId) })))
            : h('p', { className: 'muted' }, h(Gap, { onClick: () => onOpenMode('trace', req.id) }, 'no test'), ' No test proves this requirement yet.'),
        ))
      }

      if (task !== null) {
        sections.push(h('div', { className: 'ps-sec', key: 'req' },
          h('h3', null, 'Requirement'),
          task.reqId
            ? h('div', { className: 'ps-chiplist' }, h(TypeChip, { kind: 'req', id: task.reqId, onClick: () => onOpenEntity(task.reqId) }))
            : h('p', { className: 'muted' }, task.chore === true ? `Chore: ${String(fm.choreReason ?? 'reason not recorded')}.` : 'This task has no requirement.', ' The state core reports `task_req_missing` for a non-chore task.'),
        ))
        const tests = index.tests.filter((row) => Array.isArray(row.evidenceRefs) && row.evidenceRefs.some((ref) => ref.kind === 'task' && ref.id === task.id))
        sections.push(h('div', { className: 'ps-sec', key: 'tests' },
          h('h3', null, `Tests (${tests.length})`),
          tests.length > 0
            ? h('div', { className: 'ps-chiplist' }, tests.map((row) => h(TypeChip, { key: row.id, kind: 'test', id: row.id, onClick: () => onOpenEntity(row.id) })))
            : h('p', { className: 'muted' }, 'No test links this task as evidence.'),
        ))
      }

      if (test !== null) {
        const reqId = test.reqId
        sections.push(h('div', { className: 'ps-sec', key: 'req' },
          h('h3', null, 'Requirement'),
          reqId
            ? h('div', { className: 'ps-chiplist' }, h(TypeChip, { kind: 'req', id: reqId, onClick: () => onOpenEntity(reqId) }))
            : h('p', { className: 'muted' }, 'This test has no requirement. The state core reports `test_req_required` for a test without one.'),
        ))
        const refs = Array.isArray(test.evidenceRefs) ? test.evidenceRefs : []
        const extra = Array.isArray(fm.evidenceRefs) ? fm.evidenceRefs : []
        sections.push(h('div', { className: 'ps-sec', key: 'evidence' },
          h('h3', null, `Evidence references (${refs.length + extra.length})`),
          refs.length + extra.length > 0
            ? h('div', { className: 'ps-chiplist' },
                refs.map((ref, position) => h(TypeChip, {
                  key: `${ref.id}-${position}`,
                  kind: kindOfId(ref.id),
                  id: ref.id,
                  title: `${ref.kind ?? kindOfId(ref.id)} ${ref.id}; ${shortHash(ref.hash)}`,
                  onClick: data.entities.has(ref.id) ? () => onOpenEntity(ref.id) : undefined,
                  static: !data.entities.has(ref.id),
                })),
                extra.map((refId, position) => h(TypeChip, {
                  key: `${refId}-extra-${position}`,
                  kind: kindOfId(refId),
                  id: refId,
                  static: !data.entities.has(refId),
                  onClick: data.entities.has(refId) ? () => onOpenEntity(refId) : undefined,
                })),
              )
            : h('p', { className: 'muted' }, h(Gap, { static: true }, 'no evidence'), ' A test without a recorded reference cannot carry a red→green pair.'),
        ))
      }

      if (kind === 'node') {
        const reqIds = requirementsForNode(node, analysisLinks)
        sections.push(h('div', { className: 'ps-sec', key: 'reqs' },
          h('h3', null, `Requirements traced to ${node.label || node.id} (${reqIds.length})`),
          reqIds.length > 0
            ? h('div', { className: 'ps-chiplist' }, reqIds.map((reqId) => h(TypeChip, { key: reqId, kind: 'req', id: reqId, title: `Go to requirement ${reqId} in Requirements mode`, onClick: () => onOpenRequirement(reqId) })))
            : h('p', { className: 'muted' }, 'No requirement is traced to this node. The link comes from the analysis record trace[].componentId; an unmatched node is a gap in the analysis, not a missing requirement.'),
        ))
      }

      return h('div', null,
        sections,
        filter !== null && req === null
          ? h('div', { className: 'ps-sec' }, h('h3', null, 'Current filter'), h('p', { className: 'muted' }, `The panel is filtered by ${filter}. `, h('button', { type: 'button', className: 'ps-gap', onClick: onCloseFilter }, 'clear filter'), ' to see every row.'))
          : null,
      )
    }

    /**
     * The concrete task a TASK row carries: the same fields the Tasks panel edits. A row
     * written before the schema grew them says "not recorded" instead of rendering an empty
     * section, and a row with no child session says so rather than offering a dead Open.
     */
    function TaskSpecifics({ fm, sessionsById = {}, onOpenSession }) {
      const scope = listOf(fm.scope)
      const nonScope = listOf(fm.nonScope)
      const steps = listOf(fm.steps)
      const stepsDone = Number.isSafeInteger(fm.stepsDone) ? fm.stepsDone : 0
      const acceptance = (Array.isArray(fm.acceptance) ? fm.acceptance : [])
        .filter((row) => row !== null && typeof row === 'object' && typeof row.text === 'string' && row.text.trim() !== '')
      const sessions = taskSessions(fm, sessionsById)
      const resultSummary = typeof fm.resultSummary === 'string' ? fm.resultSummary.trim() : ''
      const resultEvidence = listOf(fm.resultEvidence)
      const owner = fm.owner !== null && typeof fm.owner === 'object' ? fm.owner : null
      const notRecorded = (what) => h('p', { className: 'muted' }, `${what} not recorded in this TASK (written before the field existed, or the task has none).`)
      const bulletList = (title, items) => h('div', { className: 'ps-sec' },
        h('h3', null, title),
        h('ul', { className: 'ps-criteria', style: { color: 'var(--ps-ink)' } }, items.map((item, position) => h('li', { key: position }, item))),
      )
      return h('div', null,
        h('div', { className: 'ps-sec' },
          h('h3', null, 'Concrete task'),
          h('dl', { className: 'ps-defs' },
            h('dt', null, 'Role'), h('dd', null, typeof fm.role === 'string' && fm.role !== '' ? String(fm.role) : (fm.inline === true ? 'inline — the owner does it' : 'not recorded')),
            h('dt', null, 'Owner'), h('dd', null, owner === null
              ? 'not recorded'
              : `${String(owner.label ?? '')}${owner.sessionId === undefined || owner.sessionId === null ? '' : ` · ${String(owner.sessionId)}`}`),
            h('dt', null, 'Steps'), h('dd', null, steps.length === 0 ? 'not recorded' : `${stepsDone} of ${steps.length} done`),
          ),
        ),
        steps.length === 0
          ? null
          : h('div', { className: 'ps-sec' },
              h('h3', null, 'Planned steps'),
              h('p', { className: 'muted', style: { marginTop: -2 } }, 'The count above is the task\'s stepsDone counter, written by its owner with task_update; it does not advance on its own, so the first stepsDone steps are shown as done.'),
              h('ol', { className: 'ps-criteria', style: { color: 'var(--ps-ink)' } }, steps.map((step, position) => h('li', { key: position },
                h('span', { 'aria-hidden': 'true', style: { color: position < stepsDone ? 'var(--ps-ok)' : 'var(--ps-muted)', marginRight: 5 } }, position < stepsDone ? '✓' : '•'),
                step,
              ))),
            ),
        scope.length === 0 ? notRecorded('Scope') : bulletList('Scope', scope),
        nonScope.length === 0 ? notRecorded('Non-scope') : bulletList('Non-scope', nonScope),
        h('div', { className: 'ps-sec' },
          h('h3', null, 'Acceptance'),
          acceptance.length === 0
            ? notRecorded('Acceptance')
            : h('ul', { className: 'ps-criteria', style: { color: 'var(--ps-ink)' } }, acceptance.map((row, position) => h('li', { key: position },
                h('span', { 'aria-hidden': 'true', style: { color: row.done === true ? 'var(--ps-ok)' : 'var(--ps-muted)', marginRight: 5 } }, row.done === true ? '✓' : '•'),
                row.text,
              ))),
        ),
        h('div', { className: 'ps-sec' },
          h('h3', null, 'Subagents'),
          sessions.length === 0
            ? notRecorded('A subagent session')
            : h('ul', { style: { listStyle: 'none', paddingLeft: 0, margin: 0 } }, sessions.map((row) => h('li', { key: row.sessionId, style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' } },
                h(Status, { status: row.status }),
                h('span', { style: { fontWeight: 600, overflowWrap: 'anywhere' } }, row.label),
                row.role !== '' ? h('span', { className: 'ps-meta' }, row.role) : null,
                h('code', { className: 'ps-meta', style: { marginLeft: 'auto', fontSize: 10, overflowWrap: 'anywhere' }, title: row.sessionId }, row.sessionId),
                typeof onOpenSession === 'function'
                  ? h('button', {
                      type: 'button',
                      className: 'ps-btn small',
                      onClick: () => onOpenSession(row.sessionId),
                      title: `Open session ${row.sessionId}`,
                      'aria-label': `Open subagent session ${row.label}`,
                    }, 'Open')
                  : h('span', { className: 'ps-meta', title: 'This shell does not expose session navigation to the panel' }, 'Open unavailable'),
              ))),
        ),
        resultSummary !== '' || resultEvidence.length > 0
          ? h('div', { className: 'ps-sec' },
              h('h3', null, 'Result'),
              resultSummary !== '' ? h('p', null, resultSummary) : null,
              resultEvidence.length > 0 ? h('ul', { className: 'ps-criteria', style: { color: 'var(--ps-ink)' } }, resultEvidence.map((item, position) => h('li', { key: position }, item))) : null,
            )
          : null,
      )
    }

    /**
     * THE OWNER'S EDIT FORM. Every field of the kind's schema gets a typed control, because a
     * free-form frontmatter box would let a typo break the file and would hide which keys the
     * core owns. A field the owner already took over carries a badge and a release action on
     * its own row: that is where "why did my text not move?" gets answered.
     *
     * The form never writes: Save and Release hand the patch to the panel, which runs the
     * `/state` command. Only changed fields are in the patch, so saving does not take ownership
     * of a field the owner left alone.
     */
    function EntityEditor({ entity, kind, busy, notice, onSave, onRelease }) {
      const fm = entity?.frontmatter ?? {}
      const [draft, setDraft] = useState(() => initialDraft(entity, kind))
      const revision = Number.isInteger(fm.revision) ? fm.revision : null
      // Re-seed when another write moved the entity (a save, or a mirror while the drawer was
      // open): the revision shown in the header is exactly the one the next save sends.
      useEffect(() => {
        setDraft(initialDraft(entity, kind))
      }, [entity?.frontmatter?.revision, entity?.id, kind])
      if (entity === undefined || entity === null) return h('p', { className: 'muted' }, 'The entity file is still loading.')
      if (entity.error !== undefined) return h('p', { className: 'muted' }, `The entity file could not be read: ${entity.error}`)
      const fields = EDIT_FIELDS[kind] ?? []
      const manualFields = Array.isArray(fm.manualFields) ? fm.manualFields : []
      const patch = buildEditPatch(entity, kind, draft)
      const dirty = Object.keys(patch).length > 0
      const setValue = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }))
      const control = (field) => {
        const id = `ps-edit-${field.key}`
        const value = draft[field.key]
        if (field.type === 'status') {
          const choices = EDIT_STATUS_CHOICES[kind] ?? []
          const options = choices.includes(value) ? choices : [...choices, value].filter((entry) => entry !== undefined && entry !== '')
          return h('select', { id, value: value ?? '', onChange: (event) => setValue(field.key, event.target.value) },
            options.map((option) => h('option', { key: option, value: option }, option)))
        }
        if (field.type === 'select') {
          const options = field.options ?? []
          return h('select', { id, value: value ?? '', onChange: (event) => setValue(field.key, event.target.value) },
            options.map((option) => h('option', { key: option, value: option }, option)))
        }
        if (field.type === 'bool') {
          return h('input', { id, type: 'checkbox', checked: Boolean(value), onChange: (event) => setValue(field.key, event.target.checked) })
        }
        if (field.type === 'number') {
          return h('input', { id, type: 'number', min: 0, value: value ?? '', onChange: (event) => setValue(field.key, event.target.value) })
        }
        if (field.type === 'body' || field.type === 'textarea') {
          return h('textarea', { id, rows: field.rows ?? 3, value: value ?? '', onChange: (event) => setValue(field.key, event.target.value) })
        }
        if (field.type === 'list') {
          return h('textarea', { id, rows: Math.min(10, Math.max(3, String(value ?? '').split('\n').length)), value: value ?? '', onChange: (event) => setValue(field.key, event.target.value) })
        }
        return h('input', { id, type: 'text', value: value ?? '', onChange: (event) => setValue(field.key, event.target.value) })
      }
      return h('div', null,
        h('div', { className: 'ps-sec' },
          h('h3', null, `Edit ${KIND_NAME[kind] ?? kind}`),
          h('p', { className: 'muted' }, `Saved through the state core, which checks revision ${revision ?? '—'}. A field you change becomes yours: the mirrors leave it alone until you release it.`),
          notice === null || notice === undefined ? null : h('p', { className: `ps-edit-note ${notice.tone === 'bad' ? 'bad' : 'ok'}` }, notice.message),
          h('div', { className: 'ps-edit-form' },
            fields.map((field) => {
              const manual = manualFields.includes(field.key)
              return h('div', { key: field.key, className: manual ? 'ps-edit-field manual' : 'ps-edit-field' },
                h('label', { className: 'ps-edit-label', htmlFor: `ps-edit-${field.key}` },
                  field.label,
                  manual ? h('span', { className: 'ps-manual-badge', title: 'You edited this field by hand; a mirror write will not overwrite it until you release it.' }, 'правит человек') : null,
                  manual
                    ? h('button', {
                        type: 'button',
                        className: 'ps-btn',
                        disabled: busy === true || revision === null,
                        title: 'Return this field to its source: the next mirror write will set it again.',
                        onClick: () => onRelease(field.key),
                      }, '↺ вернуть источнику')
                    : null,
                ),
                control(field),
                field.hint === undefined ? null : h('span', { className: 'ps-edit-hint' }, field.hint),
              )
            }),
          ),
        ),
        h('div', { className: 'ps-edit-actions' },
          h('button', { type: 'button', className: 'ps-btn primary', disabled: busy === true || dirty !== true || revision === null, onClick: () => onSave(patch, []) }, busy === true ? 'Saving…' : 'Save'),
          h('button', { type: 'button', className: 'ps-btn', disabled: busy === true || dirty !== true, onClick: () => setDraft(initialDraft(entity, kind)) }, 'Reset'),
          h('span', { className: 'muted' }, dirty ? `${Object.keys(patch).length} field(s) changed` : 'no changes'),
        ),
        h('div', { className: 'ps-sec' },
          h('h3', null, 'Owned by the core'),
          h('dl', { className: 'ps-edit-readonly' },
            h('dt', null, 'id'), h('dd', null, String(fm.id ?? entity.id ?? '—')),
            h('dt', null, 'revision'), h('dd', null, revision === null ? '—' : String(revision)),
            h('dt', null, 'updated'), h('dd', null, String(fm.updatedAt ?? '—')),
            fm.analysisRef === undefined ? null : h('dt', null, 'analysisRef'),
            fm.analysisRef === undefined ? null : h('dd', null, `${String(fm.analysisRef.initiative ?? '')} / ${String(fm.analysisRef.requirementId ?? '')}`),
            fm.boardId === undefined ? null : h('dt', null, 'boardId'),
            fm.boardId === undefined ? null : h('dd', null, String(fm.boardId)),
            fm.caseId === undefined ? null : h('dt', null, 'caseId'),
            fm.caseId === undefined ? null : h('dd', null, String(fm.caseId)),
            fm.criteriaHash === undefined ? null : h('dt', null, 'criteriaHash'),
            fm.criteriaHash === undefined ? null : h('dd', null, String(fm.criteriaHash).slice(0, 16)),
            manualFields.length === 0 ? null : h('dt', null, 'yours'),
            manualFields.length === 0 ? null : h('dd', null, manualFields.join(', ')),
          ),
          h('p', { className: 'muted' }, 'These keys are how the mirrors find their row or how other fields are derived. Editing them from a text box would duplicate a mirrored row or leave a hash that claims something the record no longer says, so the core refuses them.'),
        ),
      )
    }

    function Drawer({ drawer, data, analysisLinks, filter, onClose, onOpenEntity, onOpenRequirement, onOpenMode, onClearFilter, tab, setTab, sessionsById = {}, onOpenSession, onChangeStatus, statusBusy, onSaveEntity, onReleaseField, entityBusy, entityNotice }) {
      const closeRef = useRef(null)
      const isNode = drawer.kind === 'node'
      const editable = !isNode && (drawer.kind === 'req' || drawer.kind === 'task' || drawer.kind === 'test')
      const entity = isNode ? null : data.entities.get(drawer.id)
      const fm = entity?.frontmatter ?? {}
      const node = drawer.node ?? null
      const title = isNode ? (node?.label || node?.id || drawer.id) : titleOf(entity, drawer.id)
      const status = isNode ? null : fm.status ?? (drawer.kind === 'req' ? data.index.reqs.find((row) => row.id === drawer.id)?.status : null)
      const kindLabel = KIND_NAME[drawer.kind] ?? drawer.kind

      useEffect(() => {
        if (closeRef.current !== null) closeRef.current.focus()
      }, [drawer.id, drawer.kind])

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [onClose])

      const revision = fm.revision === undefined ? null : String(fm.revision)
      const updatedAt = typeof fm.updatedAt === 'string' ? fm.updatedAt : null
      const indexRow = isNode ? null : drawer.kind === 'task'
        ? data.index.tasks.find((row) => row.id === drawer.id)
        : drawer.kind === 'test'
          ? data.index.tests.find((row) => row.id === drawer.id)
          : drawer.kind === 'req'
            ? data.index.reqs.find((row) => row.id === drawer.id)
            : null
      // A TASK is linked through `reqId` OR `reqIds` (a batch); reading only the first made a
      // two-requirement task say "no requirement" here while the board showed both.
      const requirementIds = isNode ? [] : requirementIdsOf(indexRow, fm)
      const evidenceRefs = indexRow !== null && Array.isArray(indexRow.evidenceRefs) ? indexRow.evidenceRefs : []
      const extraEvidence = Array.isArray(fm.evidenceRefs) ? fm.evidenceRefs : []

      return h('aside', { className: 'ps-drawer', 'aria-labelledby': 'ps-drawer-title' },
        h('div', { className: 'ps-drawerhead' },
          h('div', { className: 'grow' },
            h('p', { className: 'ps-kicker' }, kindLabel),
            h('h2', { id: 'ps-drawer-title' }, title),
          ),
          h('button', { ref: closeRef, type: 'button', className: 'ps-btn close icon', onClick: onClose, title: 'Close details (Escape)', 'aria-label': 'Close details' }, '✕'),
        ),
        h('div', { className: 'ps-rowmeta', style: { marginTop: -2, marginBottom: 10 } },
          isNode
            ? h('span', { className: 'ps-chip static', style: { '--ps-type': TYPE_COLOR.node } }, h('span', { className: 'mark' }), h('code', null, String(node?.id ?? drawer.id)))
            : h(TypeChip, { kind: drawer.kind, id: drawer.id, static: true }),
          status === null
            ? null
            : (drawer.kind === 'task' && typeof onChangeStatus === 'function'
                ? h(TaskStatusBadge, { taskId: drawer.id, status: fm.status ?? '', onChange: onChangeStatus, busy: statusBusy === drawer.id })
                : h(Status, { status })),
          revision === null ? null : h('span', { className: 'ps-meta' }, `revision ${revision}`),
        ),
        h('div', { className: 'ps-group', role: 'tablist', 'aria-label': 'Entity detail sections', style: { marginBottom: 10 } },
          h('button', { type: 'button', role: 'tab', id: 'ps-dtab-overview', 'aria-selected': tab === 'overview', 'aria-controls': 'ps-drawer-panel', className: tab === 'overview' ? 'on' : '', onClick: () => setTab('overview') }, 'Overview'),
          h('button', { type: 'button', role: 'tab', id: 'ps-dtab-links', 'aria-selected': tab === 'links', 'aria-controls': 'ps-drawer-panel', className: tab === 'links' ? 'on' : '', onClick: () => setTab('links') }, 'Links'),
          editable
            ? h('button', { type: 'button', role: 'tab', id: 'ps-dtab-edit', 'aria-selected': tab === 'edit', 'aria-controls': 'ps-drawer-panel', className: tab === 'edit' ? 'on' : '', onClick: () => setTab('edit') }, 'Edit')
            : null,
        ),
        h('div', { id: 'ps-drawer-panel', role: 'tabpanel', 'aria-labelledby': `ps-dtab-${tab === 'links' ? 'links' : tab === 'edit' ? 'edit' : 'overview'}` },
          tab === 'edit' && editable
            ? h(EntityEditor, {
                entity,
                kind: drawer.kind,
                busy: entityBusy,
                notice: entityNotice,
                onSave: (patch, release) => onSaveEntity(drawer.id, drawer.kind, fm.revision, patch, release),
                onRelease: (field) => onReleaseField(drawer.id, drawer.kind, fm.revision, field),
              })
            : tab === 'links'
            ? h(EntityLinks, { kind: drawer.kind, id: drawer.id, filter, data, analysisLinks, node, onOpenEntity, onOpenRequirement, onOpenMode, onCloseFilter: onClearFilter })
            : isNode
              ? h('div', null,
                  h('div', { className: 'ps-sec' },
                    h('h3', null, 'Scene facts'),
                    h('dl', { className: 'ps-nodefacts' },
                      h('dt', null, 'Node'), h('dd', null, String(node?.id ?? '—')),
                      h('dt', null, 'Type'), h('dd', null, String(node?.type ?? '—')),
                      h('dt', null, 'Source'), h('dd', null, String(node?.source ?? 'no source path')),
                      h('dt', null, 'View'), h('dd', null, String(drawer.view?.view?.title || drawer.view?.view?.viewId || '—')),
                    ),
                    node?.stale === true ? h('p', { className: 'muted' }, 'This node is marked stale by designmap: the source file changed after the scene was rendered.') : null,
                  ),
                  h('p', { className: 'muted' }, 'The node is a design-map node, not a state entity. Its requirement links come from the analysis trace; open Links to follow them.'),
                )
              : h('div', null,
                  h('div', { className: 'ps-sec' },
                    h('h3', null, 'Overview'),
                    drawer.kind === 'task' || drawer.kind === 'test'
                      ? h('div', { className: 'ps-chiplist', style: { marginBottom: 6 } },
                          h('span', { className: 'muted' }, requirementIds.length === 1 ? 'Requirement: ' : 'Requirements: '),
                          requirementIds.length > 0
                            ? requirementIds.map((id) => h(TypeChip, { key: id, kind: 'req', id, onClick: () => onOpenEntity(id) }))
                            : h(Gap, { static: true }, drawer.kind === 'task' ? 'no requirement' : 'no requirement'),
                        )
                      : null,
                    drawer.kind === 'task'
                      ? h('p', { className: 'ps-chiplist', style: { marginBottom: 6 } },
                          h('span', { className: 'muted' }, 'Tests: '),
                          (() => {
                            const tests = data.index.tests.filter((row) => Array.isArray(row.evidenceRefs) && row.evidenceRefs.some((ref) => ref.kind === 'task' && ref.id === drawer.id))
                            return tests.length > 0
                              ? tests.map((row) => h(TypeChip, { key: row.id, kind: 'test', id: row.id, onClick: () => onOpenEntity(row.id) }))
                              : h('span', { className: 'muted' }, 'none linked as evidence')
                          })(),
                        )
                      : null,
                    drawer.kind === 'task'
                      ? h(TaskSpecifics, { fm, sessionsById, onOpenSession })
                      : null,
                    drawer.kind === 'test' && (evidenceRefs.length > 0 || extraEvidence.length > 0)
                      ? h('p', { className: 'ps-chiplist', style: { marginBottom: 6 } },
                          h('span', { className: 'muted' }, 'Evidence: '),
                          evidenceRefs.map((ref, position) => h(TypeChip, {
                            key: `${ref.id}-${position}`,
                            kind: kindOfId(ref.id),
                            id: ref.id,
                            title: `${ref.kind ?? kindOfId(ref.id)} ${ref.id}; ${shortHash(ref.hash)}`,
                            onClick: data.entities.has(ref.id) ? () => onOpenEntity(ref.id) : undefined,
                            static: !data.entities.has(ref.id),
                          })),
                          extraEvidence.map((id, position) => h(TypeChip, {
                            key: `${id}-extra-${position}`,
                            kind: kindOfId(id),
                            id,
                            onClick: data.entities.has(id) ? () => onOpenEntity(id) : undefined,
                            static: !data.entities.has(id),
                          })),
                        )
                      : null,
                    drawer.kind === 'req'
                      ? (Array.isArray(fm.criteria) && fm.criteria.length > 0
                          ? h('ol', { className: 'ps-criteria', style: { color: 'var(--ps-ink)' } }, fm.criteria.map((criterion, position) => h('li', { key: position }, String(criterion))))
                          : h('p', { className: 'muted' }, h(Gap, { static: true }, 'no criteria'), ' The state core rejects acceptance without criteria (`req_criteria_missing`).'))
                      : null,
                    drawer.kind === 'task' && requirementIds.length === 0 && fm.chore !== true
                      ? h('p', { className: 'muted' }, h(Gap, { static: true }, 'no requirement'), ' The state core reports `task_req_missing` for a non-chore task.')
                      : null,
                    drawer.kind === 'task' && fm.chore === true ? h('p', null, h('b', null, 'Chore: '), String(fm.choreReason ?? 'reason not recorded')) : null,
                    drawer.kind === 'test'
                      ? h('dl', { className: 'ps-defs' },
                          h('dt', null, 'Command'), h('dd', null, typeof fm.command === 'string' && fm.command !== '' ? h('code', { className: 'ps-code' }, fm.command) : 'not recorded'),
                          h('dt', null, 'Author role'), h('dd', null, String(fm.authorRole ?? 'not recorded')),
                        )
                      : null,
                    fm.analysisRef !== undefined && fm.analysisRef !== null
                      ? h('p', { className: 'muted', style: { marginTop: 6 } }, `Analysis: ${String(fm.analysisRef.initiative ?? '')} / ${String(fm.analysisRef.requirementId ?? '')}`)
                      : null,
                    entity?.error !== undefined ? h('p', { className: 'muted' }, `The entity file could not be read (${entity.error}); the index row is shown.`) : null,
                  ),
                  entity !== null && typeof entity.body === 'string' && entity.body !== ''
                    ? h('div', { className: 'ps-sec' },
                        h('h3', null, drawer.kind === 'test' ? 'Recorded evidence' : (drawer.kind === 'task' ? 'Objective' : 'Body')),
                        drawer.kind === 'test'
                          ? h(EvidenceBlock, { text: entity.body })
                          : h('pre', { className: 'ps-pre' }, entity.body),
                      )
                    : drawer.kind === 'test'
                      ? h('div', { className: 'ps-sec' }, h('h3', null, 'Recorded evidence'), h('p', { className: 'muted' }, h(Gap, { static: true }, 'no red→green pair recorded'), ' A green result without a red run is not evidence; the state core refuses closure with `evidence_required`.'))
                      : null,
                  updatedAt !== null
                    ? h('p', { className: 'ps-meta', title: `updated ${updatedAt}${fm.createdAt === undefined ? '' : ` · created ${String(fm.createdAt)}`}` }, `Обновлено ${relativeLabel(updatedAt)}${fm.createdAt === undefined ? '' : ` · создано ${relativeLabel(fm.createdAt)}`}`)
                    : null,
                ),
        ),
      )
    }

    /* ---------- page ---------- */

    function sessionsOfWorkspace(workspace) {
      return Array.isArray(workspace?.sessionIds) ? workspace.sessionIds.filter((id) => typeof id === 'string' && id !== '') : []
    }

    function pickSession(workspaces, sessionsById) {
      let stored = null
      try {
        stored = sessionStorage.getItem(SESSION_KEY)
      } catch {
        stored = null
      }
      const storedLive = typeof stored === 'string' && stored !== '' && sessionsById?.[stored] !== undefined && (sessionsById[stored]?.retainedBy?.mainView ?? 0) > 0
      if (storedLive) return stored
      const candidates = (Array.isArray(workspaces) ? workspaces : []).filter((workspace) => sessionsOfWorkspace(workspace).length > 0)
        .slice()
        .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
      for (const workspace of candidates) {
        const ids = sessionsOfWorkspace(workspace)
        const live = ids.find((id) => (sessionsById?.[id]?.retainedBy?.mainView ?? 0) > 0)
        if (live !== undefined) return live
      }
      if (typeof stored === 'string' && stored !== '' && sessionsById?.[stored] !== undefined) return stored
      return candidates[0] === undefined ? null : sessionsOfWorkspace(candidates[0])[0] ?? null
    }

    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error, info) {
        console.error('[project-state-panel] render failed:', error, info?.componentStack ?? '')
      }
      render() {
        if (this.state.error === null) return this.props.children
        return h('div', { className: 'ps-root', role: 'main', 'aria-label': 'Project state' },
          h('div', { role: 'alert', style: { padding: 16 } },
          h('h1', { className: 'ps-title' }, 'Project state panel failed'),
          h('p', null, 'The projections were not drawn. The error is below and in the browser console.'),
          h('pre', { className: 'ps-pre' }, String(this.state.error?.message ?? this.state.error)),
          ),
        )
      }
    }

    function BackIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M14.5 5.5 8 12l6.5 6.5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function SidebarToggleIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M9.5 4.5v15', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M6 9.5h1.5M6 12h1.5M6 14.5h1.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      )
    }

    function RightColumnIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M14.5 4.5v15', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M6.5 9.5h5M6.5 12.5h5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      )
    }

    /**
     * The owner's optimistic status, applied to the panel's one data object.
     *
     * WHY IT IS A PURE HELPER. The status badge is a controlled select: until `data` carries the
     * new status, the browser paints the old one back even though the board and the TASK already
     * changed. The patch therefore runs BEFORE the command, and after a refusal it is undone
     * with the same helper. It touches the index row and the loaded entity, nothing else.
     */
    function applyTaskStatus(data, taskId, status, written = null) {
      if (data === null || typeof data !== 'object') return data
      if (data.phase !== 'ready' && data.phase !== 'refreshing') return data
      if (data.index === null || typeof data.index !== 'object' || !Array.isArray(data.index.tasks)) return data
      // THE BOARD ALREADY ANSWERED WITH THE ROW IT WROTE. Its revision and updatedAt are the
      // same facts a re-read of the projection would return, so the row is patched from the
      // reply instead of reloading 484 rows for one status (REQ-306). A caller that has no
      // reply (the optimistic paint, a restore after a refusal) passes nothing.
      const patch = { status }
      if (written !== null && typeof written === 'object') {
        if (Number.isSafeInteger(written.revision)) patch.revision = written.revision
        if (typeof written.updatedAt === 'string' && written.updatedAt !== '') patch.updatedAt = written.updatedAt
      }
      const tasks = data.index.tasks.map((row) => (row.id === taskId ? { ...row, ...patch } : row))
      const entities = new Map(data.entities)
      const current = entities.get(taskId)
      if (current !== undefined && current.frontmatter !== undefined) {
        entities.set(taskId, { ...current, frontmatter: { ...current.frontmatter, ...patch } })
      }
      return { ...data, index: { ...data.index, tasks }, entities }
    }

    function ProjectStatePage(props) {
      const remote = props.remote
      const sessionsById = props.useSessions === undefined ? {} : props.useSessions((snapshot) => snapshot.byId)
      const workspaces = props.useWorkspaces === undefined ? [] : props.useWorkspaces((snapshot) => snapshot.items)
      const sessionId = useMemo(() => pickSession(workspaces, sessionsById), [workspaces, sessionsById])
      const [mode, setModeState] = useState('req')
      const [filter, setFilter] = useState(null)
      const [subview, setSubview] = useState('tests')
      const [reloadToken, setReloadToken] = useState(0)
      const [data, setData] = useState({ phase: 'loading' })
      // The previous status a refused write must restore; a ref because the callback cannot
      // read the state it is about to replace.
      const dataRef = useRef(data)
      dataRef.current = data
      const [drawer, setDrawer] = useState(null)
      const [drawerTab, setDrawerTab] = useState('overview')
      // The evidence column belongs to the panel, not to the shell layout: layout has no
      // handle on it, so the panel keeps the show/hide state and the button reflects it.
      const [railOpen, setRailOpen] = useState(false)
      // D4: the view and sort choice lives in the panel memory, not in localStorage.
      const [taskView, setTaskView] = useState('list')
      const [taskSort, setTaskSort] = useState('relevance')
      // VIEW ONLY, like the view and the sort: the owner asked to be able to hide chore tasks;
      // the default keeps the board exactly as before.
      const [hideChores, setHideChores] = useState(false)
      // The parsed plan view lives in the panel, not in the tab: opening Plan a second time in the
      // same session must not read the file again (REQ-309).
      const [plan, setPlan] = useState({ phase: 'idle' })
      const returnFocus = useRef(null)
      // Elapsed labels are computed at render; a minute tick keeps them honest without a poll.
      const [, setClockTick] = useState(0)
      useEffect(() => {
        const timer = setInterval(() => setClockTick((value) => value + 1), 60_000)
        return () => clearInterval(timer)
      }, [])

      useEffect(() => {
        setFilter(null)
        setDrawer(null)
      }, [sessionId])

      useEffect(() => {
        if (sessionId === null || sessionId === undefined || sessionId === '') {
          setData({ phase: 'no-session' })
          return undefined
        }
        const controller = new AbortController()
        // STALE-WHILE-REVALIDATE: paint the last index of this session at once, then replace
        // it with the fresh one. A cold open makes one read; every later open is instant.
        const cached = readCachedIndex(sessionId)
        // The cached paint REPLACES the workspace object too, so it gets the same entity merge
        // as the fresh read below: a drawer that is open while the index refreshes must keep
        // its entity, otherwise its Edit form blanks out on every reload.
        // THE CACHE IS A FIRST-PAINT DEVICE, NOT A REFRESH. Repainting it on every reload put
        // the pre-write status back after the owner changed one (the optimistic patch was
        // overwritten by the cached old index, and the fresh read landed ~1.5 s later - the
        // owner's "nothing changes"). A panel that is already showing data keeps it until the
        // fresh read replaces it.
        if (cached !== null) {
          setData((previous) => (previous.phase === 'ready' || previous.phase === 'refreshing'
            ? previous
            : withLoadedEntities(previous, workspaceFromIndex(cached).workspace)))
        }
        setData((previous) => (previous.phase === 'ready' ? { ...previous, phase: 'refreshing' } : { phase: 'loading' }))
        loadWorkspace(remote, sessionId, controller.signal).then(
          (next) => {
            if (controller.signal.aborted) return
            // KEEP THE ENTITY FILES ALREADY READ. A reload replaces the workspace object, and
            // the drawer for an open entity would be left with no frontmatter and no body - the
            // Edit form would blank out right after a save, which is exactly when the owner is
            // looking at it. An entity is an immutable snapshot per read, so keeping the loaded
            // one is safe; re-opening the card re-reads it.
            setData((previous) => withLoadedEntities(previous, next))
            if (next.phase === 'ready') writeCachedIndex(sessionId, next.index)
          },
          (error) => {
            if (!controller.signal.aborted) setData({ phase: 'error', code: 'load_failed', message: errorText(error) })
          },
        )
        return () => controller.abort()
      }, [remote, sessionId, reloadToken])

      // Reload re-reads the plan as well, and only then: every other paint keeps the parsed one.
      useEffect(() => {
        setPlan({ phase: 'idle' })
      }, [reloadToken])

      // ONE READ FOR THE PLAN. It runs when the Plan tab is first opened (and after Reload), never
      // on a tab switch: a ready plan stays in the panel.
      //
      // WHICH LOAD THIS PANEL HAS STARTED IS A REF, NOT plan.phase. React runs an effect's
      // cleanup before the next setup whenever the dependencies changed, so an effect that sets
      // plan.phase AND depends on plan.phase aborts its own read on the commit that shows
      // "Reading…" — the aborted signal makes the reply land nowhere and the tab hangs there for
      // good (seen in Chrome with a 25 ms transport; an instant mock hid it). The key is the
      // reload token, so Reload still re-reads and a tab switch does not.
      const planLoad = useRef({ token: -1 })
      useEffect(() => {
        if (mode !== 'plan') return undefined
        if (planLoad.current.token === reloadToken) return undefined
        if (typeof sessionId !== 'string' || sessionId === '') {
          setPlan({ phase: 'empty' })
          return undefined
        }
        planLoad.current.token = reloadToken
        let finished = false
        const controller = new AbortController()
        setPlan({ phase: 'loading' })
        readText(remote, sessionId, PLAN_VIEW_PATH, controller.signal).then(
          (read) => {
            finished = true
            if (controller.signal.aborted) return
            if (read.ok !== true) {
              setPlan(read.missing === true ? { phase: 'empty' } : { phase: 'error', code: read.code ?? 'plan_unreadable', message: read.message ?? 'state/views/plan.md could not be read' })
              return
            }
            setPlan({ phase: 'ready', view: parsePlanView(read.text) })
          },
          (error) => {
            finished = true
            if (!controller.signal.aborted) setPlan({ phase: 'error', code: 'plan_unreadable', message: errorText(error) })
          },
        )
        return () => {
          controller.abort()
          // Leaving the tab (or the panel) mid-read leaves the plan unparsed: let the next open
          // start it again instead of sticking on "Reading…" for this session.
          if (!finished) planLoad.current.token = -1
        }
      }, [mode, reloadToken, remote, sessionId])

      // v2 P2: the Design map mode no longer asks designmap for a rendered scene; the page
      // editor loads designmap/pages itself through the same command transport.

      // The analysis records are needed only by the Design map's REQ links: fetch them the
      // first time that mode opens instead of holding the first paint for ~20 JSON files.
      useEffect(() => {
        if (mode !== 'map' || typeof sessionId !== 'string' || sessionId === '') return undefined
        if (data.phase !== 'ready' || data.analysisLoaded === true || data.analysisLoading === true) return undefined
        let cancelled = false
        const controller = new AbortController()
        setData((previous) => ({ ...previous, analysisLoading: true }))
        loadAnalysis(remote, sessionId, controller.signal).then((result) => {
          if (cancelled) return
          setData((previous) => ({
            ...previous,
            analysis: Array.isArray(result.records) ? result.records : [],
            analysisError: result.error ?? null,
            analysisLoaded: true,
            analysisLoading: false,
          }))
        }, () => {
          if (!cancelled) setData((previous) => ({ ...previous, analysisLoaded: true, analysisLoading: false, analysis: [] }))
        })
        return () => { cancelled = true; controller.abort() }
      }, [mode, sessionId, remote, data.phase, data.analysisLoaded, data.analysisLoading])

      const analysisLinks = useMemo(() => (data.phase === 'ready' ? buildAnalysisLinks(data.analysis ?? [], data.entities) : null), [data])

      const setMode = useCallback((next) => {
        setModeState(next)
      }, [])

      const openMode = useCallback((nextMode, reqId) => {
        if (typeof reqId === 'string' && reqId !== '') setFilter(reqId)
        setModeState(nextMode)
      }, [])

      const openEntity = useCallback((id) => {
        const kind = kindOfId(id)
        returnFocus.current = document.activeElement
        setDrawer({ kind, id })
        setDrawerTab('overview')
        setRailOpen(true)
        if (kind === 'req') setFilter(id)
        // The card is drawn from index.json; the BODY is one file, fetched only now.
        if (typeof sessionId !== 'string' || sessionId === '') return
        loadEntity(remote, sessionId, id, kind).then((entity) => {
          if (entity === undefined) return
          setData((previous) => {
            if (previous.phase !== 'ready' && previous.phase !== 'refreshing') return previous
            const entities = new Map(previous.entities)
            const current = entities.get(id)
            entities.set(id, entity.error === undefined ? entity : { ...current, error: entity.error })
            return { ...previous, entities }
          })
        }).catch(() => {})
      }, [remote, sessionId])


      const closeDrawer = useCallback(() => {
        setDrawer(null)
        const target = returnFocus.current
        if (target !== null && typeof target.focus === 'function') window.setTimeout(() => target.focus(), 0)
      }, [])

      const clearFilter = useCallback(() => setFilter(null), [])

      // OPENING A SUBAGENT'S CONVERSATION IS NAVIGATION, not a write: the shell service does
      // it, and the panel only names the exact session id the TASK recorded. A composition
      // without the service keeps the card and says Open is unavailable.
      const openSession = useCallback((id) => {
        const navigate = props.uiWorkspace?.openSession
        if (typeof navigate !== 'function' || typeof id !== 'string' || id === '') return
        try {
          navigate.call(props.uiWorkspace, id)
        } catch (error) {
          console.error('[project-state-panel] could not open session', id, error)
        }
      }, [props.uiWorkspace])

      // THE OWNER'S STATUS WRITE. One write in the whole panel: the task status goes through the
      // board (which owns the row), the mirror moves the TASK and the projections, and the
      // panel re-reads index.json. A refusal is quoted with its code, never swallowed.
      const [statusNotice, setStatusNotice] = useState(null)
      const [statusBusy, setStatusBusy] = useState(null)
      useEffect(() => {
        // A REFUSAL STAYS. An error that erased itself after nine seconds left the owner with
        // one unannounced flash ("no revision" reached nobody); it now stays until the next
        // status action, while a success notice still clears.
        if (statusNotice === null || statusNotice.tone === 'bad') return undefined
        const timer = setTimeout(() => setStatusNotice(null), 9000)
        return () => clearTimeout(timer)
      }, [statusNotice])
      const changeStatus = useCallback((taskId, status, reason = '') => {
        if (typeof sessionId !== 'string' || sessionId === '') return
        const before = (dataRef.current?.index?.tasks ?? []).find((row) => row.id === taskId)?.status
        // OPTIMISTIC FIRST. The badge is a controlled select: it paints the old value until the
        // data object carries the new one, and the command's round trip (board write, TASK
        // mirror, projections) is long enough for "nothing changed" to be what the owner sees.
        // The write is confirmed below; a refusal restores the previous status.
        setData((previous) => applyTaskStatus(previous, taskId, status))
        setStatusBusy(taskId)
        setStatusNotice(null)
        changeTaskStatus(remote, sessionId, { taskId, status, reason }).then(
          (result) => {
            setStatusBusy(null)
            if (result.ok !== true) {
              if (typeof before === 'string' && before !== '') {
                setData((previous) => applyTaskStatus(previous, taskId, before))
              }
              setStatusNotice({ tone: 'bad', code: result.code, message: result.message ?? 'the status change was refused' })
              // A stale revision means the board moved under the panel: re-read it so the next
              // attempt carries the revision it needs.
              if (result.code === 'stale') setReloadToken((value) => value + 1)
              return
            }
            // The board answered with the row it wrote and the command mirrored it before
            // answering; keep the optimistic value (the controlled select must not flicker) and
            // settle the row from that reply. NO FULL RE-READ FOR ONE STATUS: a reload replaced
            // the whole workspace object, so 484 rows went through React again and the 221 KB
            // index was fetched a second time for a revision the reply already carried
            // (REQ-306). Only a terminal status changes OTHER rows - the board stops the linked
            // children - so only then is the projection re-read.
            const written = result.payload !== null && typeof result.payload === 'object' ? result.payload.task ?? null : null
            setData((previous) => applyTaskStatus(previous, taskId, status, written))
            setStatusNotice({ tone: 'ok', code: null, message: `${taskId} is now ${status}; the state journal records the change` })
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
              window.dispatchEvent(new CustomEvent(STATE_CHANGED_EVENT))
            }
            if (status === 'done' || status === 'cancelled') setReloadToken((value) => value + 1)
          },
          (error) => {
            setStatusBusy(null)
            if (typeof before === 'string' && before !== '') {
              setData((previous) => applyTaskStatus(previous, taskId, before))
            }
            setStatusNotice({ tone: 'bad', code: 'status_change_failed', message: errorText(error) })
          },
        )
      }, [remote, sessionId])

      // THE OWNER'S HAND EDIT. Save and release go through the same `/state` command, and the
      // file is read back afterwards, so the form shows what the core wrote rather than what the
      // panel sent. A refusal keeps its code (`revision_conflict`, `status_invalid`,
      // `field_not_editable`); a stale revision re-reads the index so the next try is fresh.
      const [entityNotice, setEntityNotice] = useState(null)
      const [entityBusy, setEntityBusy] = useState(false)
      useEffect(() => {
        if (entityNotice === null) return undefined
        const timer = setTimeout(() => setEntityNotice(null), 9000)
        return () => clearTimeout(timer)
      }, [entityNotice])
      const saveEntityFields = useCallback((id, kind, expectedRevision, patch, release) => {
        if (typeof sessionId !== 'string' || sessionId === '') return
        setEntityBusy(true)
        setEntityNotice(null)
        editStateEntity(remote, sessionId, { id, kind, expectedRevision, patch, release }).then(
          (result) => {
            setEntityBusy(false)
            // A REFUSED EDIT RE-READS THE ENTITY, not the whole index: the form is what was
            // stale (a mirror moved the revision), and a full reload would blank the open drawer.
            const refresh = () => {
              loadEntity(remote, sessionId, id, kind).then((fresh) => {
                if (fresh === undefined || fresh.error !== undefined) return
                setData((previous) => {
                  if (previous.phase !== 'ready' && previous.phase !== 'refreshing') return previous
                  const entities = new Map(previous.entities)
                  entities.set(id, fresh)
                  return { ...previous, entities }
                })
              }).catch(() => {})
            }
            if (result.ok !== true) {
              setEntityNotice({ tone: 'bad', message: `${result.code ?? 'refused'}: ${result.message ?? 'the edit was refused'}` })
              if (result.code === 'revision_conflict' || result.code === 'not_found') refresh()
              return
            }
            const saved = result.payload ?? {}
            const mine = Array.isArray(saved.manualFields) ? saved.manualFields : []
            const released = Array.isArray(release) && release.length > 0
            setEntityNotice({
              tone: 'ok',
              message: released
                ? `${id}: ${release.join(', ')} returned to the source; revision ${saved.revision}`
                : `${id} saved at revision ${saved.revision}${mine.length === 0 ? '' : `; yours now: ${mine.join(', ')}`}`,
            })
            // A status edited by hand moves the same counters: the header re-reads at once.
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
              window.dispatchEvent(new CustomEvent(STATE_CHANGED_EVENT))
            }
            // SETTLE THE PANEL IN PLACE: the entity from disk plus the index row it affects
            // (title, status, revision, updatedAt). No index reload - a reload replaces the
            // workspace object and the open drawer with it, which blanked the form the owner
            // had just saved. The next natural paint re-reads everything anyway.
            loadEntity(remote, sessionId, id, kind).then((fresh) => {
              if (fresh === undefined || fresh.error !== undefined) return
              setData((previous) => {
                if (previous.phase !== 'ready' && previous.phase !== 'refreshing') return previous
                const entities = new Map(previous.entities)
                entities.set(id, fresh)
                const fm = fresh.frontmatter ?? {}
                const patchRow = (rows) => rows.map((row) => (row.id === id
                  ? { ...row, ...(fm.title === undefined ? {} : { title: fm.title }), ...(fm.status === undefined ? {} : { status: fm.status }), ...(fm.revision === undefined ? {} : { revision: fm.revision }), ...(fm.updatedAt === undefined ? {} : { updatedAt: fm.updatedAt }), ...(Array.isArray(fm.reqIds) ? { reqIds: fm.reqIds } : {}) }
                  : row))
                return {
                  ...previous,
                  index: {
                    ...previous.index,
                    reqs: patchRow(previous.index.reqs),
                    tasks: patchRow(previous.index.tasks),
                    tests: patchRow(previous.index.tests),
                  },
                  entities,
                }
              })
            }).catch(() => {})
          },
          (error) => {
            setEntityBusy(false)
            setEntityNotice({ tone: 'bad', message: errorText(error) })
          },
        )
      }, [remote, sessionId])
      const releaseEntityField = useCallback((id, kind, expectedRevision, field) => {
        saveEntityFields(id, kind, expectedRevision, {}, [field])
      }, [saveEntityFields])

      const onModeKeyDown = (event) => {
        // The mode list is a VERTICAL tablist in the Night desk shell; keep the horizontal
        // arrows working for muscle memory, but Up/Down is the pattern the orientation promises.
        const order = ['req', 'board', 'map', 'trace', 'plan']
        const index = order.indexOf(mode)
        const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
        if (delta !== 0) {
          event.preventDefault()
          const next = order[(index + delta + order.length) % order.length]
          setMode(next)
          const element = document.getElementById(`ps-tab-${next}`)
          if (element !== null) element.focus()
        }
      }

      if (data.phase === 'no-session') {
        return h('div', { className: 'ps-root', role: 'main', 'aria-label': 'Project state' },
          h('style', null, CSS),
          h('div', { className: 'ps-top' }, h('h1', { className: 'ps-title' }, 'Project state'), h('span', { className: 'ps-spacer' }), h('span', { className: 'ps-ro', title: 'No conversation, so nothing to write: the panel reads state/views and the entity files.' }, 'lens · owner edits via the core')),
          h('div', { className: 'ps-main' },
            h(Empty, { title: 'Open a live conversation' }, h('p', null, 'The panel reads the projections of the workspace the conversation belongs to. There is no live conversation to anchor that workspace.')),
          ),
        )
      }

      const ready = data.phase === 'ready' || data.phase === 'refreshing'
      const index = ready ? data.index : null
      const counts = index === null ? null : {
        req: index.reqs.length,
        task: index.tasks.length,
        test: index.tests.length,
        decision: index.decisions.length,
      }
      const filteredTasks = index === null || filter === null ? null : index.tasks.filter((task) => requirementIdsOf(task, data.entities?.get?.(task.id)?.frontmatter).includes(filter)).length
      const filteredTests = index === null || filter === null ? null : index.tests.filter((test) => test.reqId === filter).length

      const MODE_COLOR = { req: TYPE_COLOR.req, board: TYPE_COLOR.task, map: TYPE_COLOR.node, trace: TYPE_COLOR.test, plan: TYPE_COLOR.evidence }
      const modeButton = (id, label) => h('button', {
        id: `ps-tab-${id}`,
        type: 'button',
        role: 'tab',
        'aria-selected': mode === id,
        'aria-controls': 'ps-panel',
        className: 'ps-mode',
        style: { '--ps-type': MODE_COLOR[id] },
        onClick: () => setMode(id),
        onKeyDown: onModeKeyDown,
        tabIndex: mode === id ? 0 : -1,
      }, label)

      const filterEntity = filter === null ? null : data.entities.get(filter)
      const filterTitle = filter === null ? '' : titleOf(filterEntity, filter)

      return h('div', { className: 'ps-root', role: 'main', 'aria-label': 'Project state' },
        h('style', null, CSS),
        // THE ANNOUNCEMENT, not the visible notice. A live region created together with its
        // text is not reliably announced (MDN: establish the region first, start empty), and
        // the refusal used to arrive as a notice nobody heard. This one is in the first paint
        // and only its text changes; the visible .ps-notice stays for the eye.
        h('p', { className: 'ps-visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
          statusNotice !== null
            ? `${statusNotice.code === null || statusNotice.code === undefined ? '' : `${statusNotice.code}: `}${statusNotice.message}`
            : (entityNotice !== null && entityNotice !== undefined ? entityNotice.message : ''),
        ),
        h('div', { className: 'ps-top' },
          h('button', { type: 'button', className: 'ps-btn icon ps-back', onClick: () => props.layout.selectPanel(null), title: 'Back to chat', 'aria-label': 'Back to chat' }, h(BackIcon, { size: 16 })),
          h('h1', { className: 'ps-title' }, 'Project state'),
          h('span', { className: 'ps-ro', title: 'The panel is a lens over the state projections and writes no file. Your two writes go through commands: a task status to the taskboard (which owns the row) and any field of a REQ/TASK/TEST to the state core (which checks the revision and marks the field as yours).' }, 'lens · owner edits via the core'),
          h('span', { className: 'ps-spacer' }),
          counts === null ? null : h('div', { className: 'ps-counts', 'aria-label': 'Projection counts' },
            h('span', { className: 'ps-count', title: 'Requirements in index.json' }, h('b', null, String(counts.req)), 'REQ'),
            h('span', { className: 'ps-count', title: 'Tasks in index.json' }, h('b', null, String(counts.task)), 'TASK'),
            h('span', { className: 'ps-count', title: 'Tests in index.json' }, h('b', null, String(counts.test)), 'TEST'),
          ),
          index === null ? null : h('span', { className: 'ps-meta', title: 'The machine-readable link contract this panel reads' }, `index.json v${index.schemaVersion} · event ${String(index.lastSeq ?? 0)}`),
          h('div', { className: 'ps-windowgroup', role: 'group', 'aria-label': 'Window controls' },
            h('button', { type: 'button', className: 'ps-btn icon', onClick: () => props.layout.toggleSidebar(), title: 'Toggle left sidebar', 'aria-label': 'Toggle left sidebar' }, h(SidebarToggleIcon, { size: 16 })),
            h('button', {
              type: 'button',
              className: 'ps-btn icon',
              'aria-pressed': !railOpen,
              'aria-controls': 'ps-rail',
              title: railOpen ? 'Скрыть правую колонку' : 'Показать правую колонку',
              'aria-label': railOpen ? 'Скрыть правую колонку' : 'Показать правую колонку',
              onClick: () => setRailOpen((value) => !value),
            }, h(RightColumnIcon, { size: 16 })),
          ),
          h('button', { type: 'button', className: 'ps-btn small', onClick: () => setReloadToken((value) => value + 1), disabled: data.phase === 'loading' || data.phase === 'refreshing', title: 'Re-read state/views and the entity files' }, 'Reload'),
        ),
        filter === null ? null : h('div', { className: 'ps-filterbar', role: 'status' },
          h(TypeChip, { kind: 'req', id: filter, static: true }),
          h('b', null, 'filters the other modes'),
          filteredTasks === null ? null : h('span', { className: 'ps-meta' }, `${filteredTasks} task${filteredTasks === 1 ? '' : 's'} · ${filteredTests} test${filteredTests === 1 ? '' : 's'}`),
          h('span', { className: 'ps-spacer' }),
          h('button', { type: 'button', className: 'ps-btn small', onClick: clearFilter, title: 'Show every mode without the requirement filter' }, 'Clear filter'),
        ),
        data.phase === 'refreshing' ? h('div', { className: 'ps-filterbar' }, h('span', { className: 'ps-loading' }, 'Reloading the projections…')) : null,
        !ready && data.phase === 'loading' ? h('div', { className: 'ps-main' }, h('p', { className: 'ps-loading' }, 'Reading state/views/index.json…')) : null,
        data.phase === 'empty' ? h('div', { className: 'ps-main' },
          h(Empty, { title: 'No generated projections in this workspace', onReload: () => setReloadToken((value) => value + 1) },
            h('p', null, 'Expected ', h('code', null, 'state/views/index.json'), '. The state core writes the projections with ', h('code', null, 'regenerateViews()'), '; this panel never creates them.'),
            h('p', null, 'Until then the Requirements, Board, Design map and Tests & trace modes have nothing to read.'),
          ),
        ) : null,
        data.phase === 'error' ? h('div', { className: 'ps-main' },
          h(Alert, { code: data.code }, data.message),
          h('p', { className: 'ps-muted' }, 'The panel shows the named failure instead of guessing. Reload after the projections are regenerated.'),
          h('button', { type: 'button', className: 'ps-btn small', onClick: () => setReloadToken((value) => value + 1) }, 'Reload'),
        ) : null,
        ready ? h('div', { className: railOpen && drawer !== null ? 'ps-shell' : 'ps-shell ps-no-rail' },
          h('nav', { className: 'ps-nav', 'aria-label': 'Project state modes' },
            h('p', { className: 'ps-kicker' }, 'Modes'),
            h('div', { className: 'ps-modes', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Project state modes' },
              modeButton('req', 'Requirements'),
              modeButton('board', 'Board'),
              modeButton('map', 'Design map'),
              modeButton('trace', 'Tests & trace'),
              modeButton('plan', 'Plan'),
            ),
            h('div', { className: 'ps-navsec' },
              h('p', { className: 'ps-kicker' }, 'Requirement filter'),
              filter === null
                ? h('p', { className: 'muted' }, 'Choose a requirement in Requirements to filter the other modes.')
                : h('div', { className: 'ps-navfilter' },
                    h(TypeChip, { kind: 'req', id: filter, static: true }),
                    h('p', { className: 't' }, filterTitle),
                    h('span', { className: 'ps-meta' }, `${filteredTasks} task${filteredTasks === 1 ? '' : 's'} · ${filteredTests} test${filteredTests === 1 ? '' : 's'}`),
                    h('button', { type: 'button', className: 'ps-btn small', onClick: clearFilter, style: { marginTop: 7 } }, 'Clear filter'),
                  ),
            ),
            h('div', { className: 'ps-navfoot' },
              h('p', { className: 'ps-kicker' }, 'Projection'),
              index === null ? null : h('p', null, `index.json v${index.schemaVersion}`, h('br'), `event ${String(index.lastSeq ?? 0)}`),
              h('p', { style: { marginTop: 6 } }, 'Lens over state/views; you can change a task status here (recorded in the journal).'),
            ),
          ),
          h('section', {
            className: mode === 'map' ? 'ps-main ps-main-map' : 'ps-main',
            id: 'ps-panel',
            role: 'tabpanel',
            'aria-labelledby': `ps-tab-${mode}`,
            // THE PLAN TAB HOLDS NO CONTROL, AND THIS SECTION IS THE SCROLLER. A scrollable
            // region with nothing focusable cannot be scrolled from the keyboard; the plan (a
            // table, two lists, no buttons) is exactly that, so the panel itself takes the tab
            // stop there and answers the arrow keys (axe: scrollable-region-focusable). The other
            // tabs keep their own controls as the stop.
            tabIndex: mode === 'plan' ? 0 : undefined,
          },
            statusNotice === null
              ? null
              : h('div', { className: `ps-notice ${statusNotice.tone}` },
                  statusNotice.code === null || statusNotice.code === undefined ? null : h('code', null, `${statusNotice.code}: `),
                  statusNotice.message,
                ),
            data.issues !== undefined && data.issues.length > 0 ? h('div', { className: 'ps-warnline', role: 'status' }, `Entity metadata issues: ${data.issues.join('; ')}`) : null,
            mode === 'req'
              ? h(RequirementsMode, { data, filter, onSelect: setFilter, onOpenMode: openMode, onOpenEntityDrawer: openEntity })
              : mode === 'board'
                ? h(BoardMode, { data, filter, onOpenTask: openEntity, onClearFilter: clearFilter, view: taskView, sort: taskSort, onView: setTaskView, onSort: setTaskSort, sessionsById, onChangeStatus: changeStatus, statusBusy, hideChores, onHideChores: setHideChores })
                : mode === 'map'
                  ? h(MapMode, { remote, sessionId })
                  : mode === 'plan'
                    ? h(PlanMode, { plan, reload: () => setReloadToken((value) => value + 1) })
                    : h(TestsMode, { data, filter, subview, setSubview, onOpenTest: openEntity, onSelectReq: setFilter, onOpenMode: openMode }),
          ),
          // THE COLUMN EXISTS EVEN WHEN IT IS CLOSED. The header's right-column toggle names it
          // with aria-controls; an IDREF to an element that is absent while the drawer is closed is
          // exactly what axe reports as aria-valid-attr-value (critical). Hidden, the element takes
          // no grid cell and draws nothing, so the panel looks the same.
          h('div', { className: 'ps-rail', id: 'ps-rail', hidden: !(railOpen && drawer !== null) },
            railOpen && drawer !== null ? h(Drawer, {
                  drawer,
                  data,
                  analysisLinks,
                  filter,
                  onClose: closeDrawer,
                  onOpenEntity: (id) => { openEntity(id); if (kindOfId(id) !== 'req') setDrawerTab('links') },
                  onOpenRequirement: (id) => { openEntity(id); setModeState('req') },
                  onOpenMode: openMode,
                  onClearFilter: clearFilter,
                  tab: drawerTab,
                  setTab: setDrawerTab,
                  sessionsById,
                  onOpenSession: typeof props.uiWorkspace?.openSession === 'function' ? openSession : undefined,
                  onChangeStatus: changeStatus,
                  statusBusy,
                  onSaveEntity: saveEntityFields,
                  onReleaseField: releaseEntityField,
                  entityBusy,
                  entityNotice,
                }) : null,
          ),
        ) : null,
        h('p', { className: 'ps-visually-hidden', 'aria-live': 'polite' },
          filter === null ? 'No requirement filter.' : `Filtered by ${filter}.`,
        ),
      )
    }

    /* ---------- shell registration ---------- */

    /**
     * The State entry in the session header: the panel, plus the three load counters the owner
     * asked for (D1/D2) — unfinished tasks, active tasks (both from the workspace projections the
     * panel opens) and active subagents (live child sessions of this chat). It reads index.json
     * every five seconds, so a status change or a finished child moves the number without a reload.
     */
    function PanelTrigger({ layout, sessionId, remote, useSessions }) {
      const sessionsRaw = useSessions === undefined ? {} : useSessions((snapshot) => snapshot.byId)
      const sessionsById = sessionsRaw !== null && typeof sessionsRaw === 'object' ? sessionsRaw : {}
      const [counts, setCounts] = useState({ phase: 'loading' })

      useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') {
          setCounts({ phase: 'empty' })
          return undefined
        }
        let cancelled = false
        const controller = new AbortController()
        const tick = async () => {
          const result = await readJson(remote, sessionId, INDEX_PATH, controller.signal)
          if (cancelled) return
          if (result.ok !== true) {
            setCounts({ phase: 'error', message: result.message ?? result.code ?? 'the projections could not be read' })
            return
          }
          const invalid = validateIndex(result.value)
          if (invalid !== null) {
            setCounts({ phase: 'error', message: invalid })
            return
          }
          const next = taskCounts(result.value.tasks)
          setCounts({ phase: 'ready', unfinished: next.unfinished, active: next.active })
        }
        tick().catch((error) => { if (!cancelled) setCounts({ phase: 'error', message: errorText(error) }) })
        const timer = setInterval(() => { tick().catch(() => {}) }, 5000)
        // The panel just wrote a status: do not make the owner wait for the next poll.
        const onChanged = () => { tick().catch(() => {}) }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener(STATE_CHANGED_EVENT, onChanged)
        return () => {
          cancelled = true
          controller.abort()
          clearInterval(timer)
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener(STATE_CHANGED_EVENT, onChanged)
        }
      }, [remote, sessionId])

      const subagents = activeSubagents(sessionsById, sessionId)
      const failed = counts.phase === 'error'
      const unfinished = counts.phase === 'ready' ? String(counts.unfinished) : '—'
      const active = counts.phase === 'ready' ? String(counts.active) : '—'
      const subagentText = failed ? '—' : String(subagents)
      const scope = 'Задачи считаются по state/views/index.json этого рабочего пространства; субагенты — живые дочерние сессии этого чата.'
      const hover = failed
        ? `Счётчики недоступны: ${counts.message}. Открыть панель состояния.`
        : `Незакрытых задач: ${unfinished}. Активных задач: ${active}. Активных субагентов: ${subagentText}.`
      const label = failed
        ? `Counts unavailable: ${counts.message}. Open the project state panel.`
        : `Open the project state panel. Unfinished tasks in this workspace: ${unfinished}. Active tasks in this workspace: ${active}. Active subagents in this chat: ${subagentText}.`
      return h('button', {
        type: 'button',
        title: failed ? `Счётчики недоступны: ${counts.message}. ${scope}` : `${hover} ${scope}`,
        'aria-label': label,
        style: { display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', borderRadius: 7, minHeight: 24, padding: '3px 8px', font: 'inherit', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' },
        onClick: () => {
          try {
            if (typeof sessionId === 'string' && sessionId !== '') sessionStorage.setItem(SESSION_KEY, sessionId)
          } catch {
            /* private mode: the panel falls back to the live session */
          }
          layout.selectPanel(PANEL_ID)
        },
      },
        h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
          h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.6 }),
          h('path', { d: 'M7 9.5h10M7 13h10M7 16.5h6', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        ),
        h('span', null, 'State'),
        h('span', { 'aria-hidden': 'true', style: { display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 2, color: 'var(--dsw-alias-label-secondary)', fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' } },
          // Each number says what it counts on hover; the group is too terse to read otherwise.
          h('span', { title: `Незакрытых задач: ${unfinished} — всё, что не done и не cancelled` }, unfinished),
          h('span', null, '/'),
          h('span', { title: `Активных задач: ${active} — статус active` }, active),
          h('span', null, '/'),
          h('span', { title: `Активных субагентов: ${subagentText} — живые дочерние сессии этого чата` }, subagentText),
        ),
      )
    }

    return {
      inject: ['slots', 'remote', 'remote.workspaceFiles', 'remote.commands', 'uiWorkspace', 'layout'],
      // The pure count/sort helpers, so the test can exercise what the UI calls instead of a copy.
      __test: {
        statusRank, sortTasks, taskCounts, activeSubagents, taskRow, chatRootOf, taskSessions, parseEntityText,
        loadWorkspace, loadEntity, relativeLabel,
        requirementIdsOf, TASK_STATUS_CHOICES, taskStatusRequest, parseTaskboardReply, changeTaskStatus, runTaskboard,
        isChoreTask,
        // The hand-edit surface: what the Edit tab builds and what it sends, so a test proves the
        // patch and the refusal codes instead of re-implementing them.
        EDIT_FIELDS, EDIT_STATUS_CHOICES, initialDraft, buildEditPatch, parseStateReply, editStateEntity, runStateCommand,
        applyTaskStatus, STATE_CHANGED_EVENT,
      },
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          inject: () => ({ remote: ctx.remote, layout: ctx.layout, uiWorkspace: ctx.uiWorkspace }),
        }, ProjectStatePage))
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'project-state',
          order: 15,
          inject: (sessionId) => ({ layout: ctx.layout, sessionId, remote: ctx.remote }),
        }, PanelTrigger))
      },
    }
  },
})
