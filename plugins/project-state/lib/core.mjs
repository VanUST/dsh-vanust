/**
 * PURPOSE
 *   The project state core: the single writer of the `state/` directory. It owns the entity
 *   schema, the sequential typed IDs (allocated under a lock), links with a content hash of
 *   their target, compare-and-set transitions for TASK, the append-only journal with replay,
 *   `verify()` and `snapshot()`.
 *
 * WHAT IT IS NOT
 *   No model tools, no projections under `state/views/` and no migrations: those are their own
 *   tasks. Every public method returns a value `{ ok: true, ... }` or `{ ok: false, code,
 *   message }` and never throws into another agent's turn — a caller checks the code.
 *
 * WHY A LOCK FOR IDS
 *   Two agents can ask for the next TASK at the same moment. `state/.lock` is created with
 *   `O_EXCL` (mkdir), the directory is scanned and the file written under it, so the sequence
 *   cannot hand the same number twice. The lock is stale-tolerant: a directory older than
 *   `lockStaleMs` is removed with a warning instead of blocking the workspace forever.
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, relative, sep } from 'node:path'
import { parse, serialize } from './format.mjs'
import { buildModel, renderViews, VIEW_DIR } from './views.mjs'

const KINDS = {
  req: { prefix: 'REQ', status: ['proposed', 'open', 'accepted', 'done', 'rejected', 'dropped'] },
  decision: { prefix: 'DEC', status: ['proposed', 'accepted', 'superseded'] },
  task: { prefix: 'TASK', status: ['open', 'active', 'review', 'done', 'blocked', 'cancelled'] },
  test: { prefix: 'TEST', status: ['unverified', 'verified', 'failing', 'stale'] },
}
const DIRS = { req: 'req', decision: 'decision', task: 'task', test: 'test' }
const ID_PATTERN = /^(REQ|DEC|TASK|TEST)-(\d{3,})$/
const KIND_BY_PREFIX = { REQ: 'req', DEC: 'decision', TASK: 'task', TEST: 'test' }
const nowIso = () => new Date().toISOString()
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const fail = (code, message) => ({ ok: false, code, message })

/** Trimmed non-empty strings from a value; anything else yields `[]`. */
function stringList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter((item) => item !== '')
}

/**
 * Acceptance criteria as `[{text, done}]`. A bare string is an open criterion; an object
 * keeps only a non-empty text and the explicit `done: true` (a missing mark is not done).
 */
export function acceptanceList(value) {
  if (!Array.isArray(value)) return []
  const rows = []
  for (const item of value) {
    if (typeof item === 'string') {
      if (item.trim() !== '') rows.push({ text: item.trim(), done: false })
      continue
    }
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    if (text === '') continue
    rows.push({ text, done: item.done === true })
  }
  return rows
}

/**
 * The sessions of a TASK as `[{sessionId, label, role, status}]`. The session id is the
 * only required field and repeats are folded, so a list-of-maps frontmatter stays readable.
 */
export function sessionList(value) {
  if (!Array.isArray(value)) return []
  const rows = []
  const seen = new Set()
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const sessionId = typeof item.sessionId === 'string' ? item.sessionId.trim() : ''
    if (sessionId === '' || seen.has(sessionId)) continue
    seen.add(sessionId)
    rows.push({
      sessionId,
      ...(typeof item.label === 'string' && item.label.trim() !== '' ? { label: item.label.trim().slice(0, 200) } : {}),
      ...(typeof item.role === 'string' && item.role.trim() !== '' ? { role: item.role.trim().slice(0, 200) } : {}),
      ...(typeof item.status === 'string' && item.status.trim() !== '' ? { status: item.status.trim().slice(0, 40) } : {}),
    })
  }
  return rows
}

/** The owner of a TASK as `{kind, label, sessionId?}`, or undefined when it has no label. */
function ownerOf(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const label = typeof value.label === 'string' ? value.label.trim() : ''
  if (label === '') return undefined
  return {
    kind: value.kind === 'human' ? 'human' : 'agent',
    label: label.slice(0, 200),
    ...(typeof value.sessionId === 'string' && value.sessionId.trim() !== '' ? { sessionId: value.sessionId.trim() } : {}),
  }
}

/** The canonical relative path of an entity. */
export function entityPath(kind, id) {
  return join('state', DIRS[kind], `${id}.md`)
}

/**
 * Create the state service bound to one workspace.
 *
 * @param {object} options
 * @param {string} options.cwd - workspace root; `state/` lives directly under it.
 * @param {() => string} [options.now] - clock, injectable for deterministic bytes in tests.
 * @param {number} [options.lockTimeoutMs] - how long to wait for the ID lock.
 * @param {number} [options.lockStaleMs] - a lock older than this is considered abandoned.
 * @param {{warn?: Function}} [options.logger]
 * @returns the service object; see README for the API.
 */
export function createStateService(options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const root = join(cwd, typeof options.stateDir === 'string' && options.stateDir !== '' ? options.stateDir : 'state')
  const now = options.now ?? nowIso
  const lockTimeoutMs = options.lockTimeoutMs ?? 3000
  const lockStaleMs = options.lockStaleMs ?? 10000
  const logger = options.logger ?? { warn() {} }

  const abs = (rel) => join(cwd, rel)

  /** Run `fn` while holding `state/.lock`; finally removes the lock. */
  async function withLock(fn) {
    await mkdir(root, { recursive: true })
    const lock = join(root, '.lock')
    const started = Date.now()
    for (;;) {
      try {
        await mkdir(lock)
        break
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        try {
          const info = await stat(lock)
          if (Date.now() - info.mtimeMs > lockStaleMs) {
            logger.warn?.(`project-state: removing stale lock ${lock}`)
            await rm(lock, { recursive: true, force: true })
            continue
          }
        } catch {
          continue
        }
        if (Date.now() - started > lockTimeoutMs) throw new Error(`state lock busy: ${lock}`)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    try {
      return await fn()
    } finally {
      await rm(lock, { recursive: true, force: true })
    }
  }

  /** Read the journal lines; a malformed line is a finding, not a crash. */
  async function readJournal() {
    let text
    try {
      text = await readFile(join(root, 'events.jsonl'), 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
    const events = []
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      try {
        events.push(JSON.parse(line))
      } catch {
        events.push({ malformed: line })
      }
    }
    return events
  }

  async function appendJournal(event) {
    await mkdir(root, { recursive: true })
    const events = await readJournal()
    const seq = events.filter((entry) => typeof entry?.seq === 'number').length + 1
    const record = { seq, at: now(), ...event }
    await writeFile(join(root, 'events.jsonl'), `${JSON.stringify(record)}\n`, { flag: 'a', encoding: 'utf8' })
    return record
  }

  async function readEntity(rel) {
    let text
    try {
      text = await readFile(abs(rel), 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    const parsed = parse(text)
    if (parsed.ok === false) return { invalid: true, rel, error: parsed.error, line: parsed.line, text }
    return { rel, text, frontmatter: parsed.frontmatter, body: parsed.body }
  }

  async function writeEntity(rel, frontmatter, body) {
    const text = serialize({ frontmatter, body })
    await mkdir(dirname(abs(rel)), { recursive: true })
    await writeFile(abs(rel), text, { encoding: 'utf8' })
    return text
  }

  /** The next sequence number for a kind, from the files that exist now. */
  async function peekNextId(kind) {
    const dir = join(root, DIRS[kind])
    let names = []
    try {
      names = await readdir(dir)
    } catch (error) {
      if (error.code === 'ENOENT') return `${KINDS[kind].prefix}-001`
      throw error
    }
    let max = 0
    for (const name of names) {
      const match = /^([A-Z]+)-(\d+)\.md$/.exec(name)
      if (match === null) continue
      max = Math.max(max, Number(match[2]))
    }
    return `${KINDS[kind].prefix}-${String(max + 1).padStart(3, '0')}`
  }

  function normaliseKind(kind) {
    return typeof kind === 'string' && KINDS[kind] !== undefined ? kind : undefined
  }

  /** Fill the defaults of one kind and reject a field the kind does not declare. */
  function buildFrontmatter(kind, input, id) {
    const spec = KINDS[kind]
    const at = now()
    const status = input.status ?? spec.status[0]
    if (!spec.status.includes(status)) return fail('status_invalid', `status "${status}" is not one of ${spec.status.join(', ')}`)
    const frontmatter = {
      id,
      kind,
      title: String(input.title ?? ''),
      status,
      revision: 1,
      createdAt: at,
      updatedAt: at,
    }
    if (kind === 'req') {
      frontmatter.criteria = Array.isArray(input.criteria) ? input.criteria.map(String) : []
      frontmatter.source = input.source ?? 'agent'
      // The analysis mirror: the originating record is the REQ's justification, and the criteria
      // hash is frozen when the REQ was accepted from a proven requirement.
      if (input.analysisRef !== undefined && input.analysisRef !== null && typeof input.analysisRef === 'object') {
        frontmatter.analysisRef = { initiative: String(input.analysisRef.initiative ?? ''), requirementId: String(input.analysisRef.requirementId ?? '') }
      }
      if (typeof input.criteriaHash === 'string' && input.criteriaHash !== '') frontmatter.criteriaHash = input.criteriaHash
    }
    if (kind === 'task') {
      if (input.reqId !== undefined) frontmatter.reqId = String(input.reqId)
      if (input.chore === true) frontmatter.chore = true
      if (input.choreReason !== undefined) frontmatter.choreReason = String(input.choreReason)
      if (input.ownerRole !== undefined) frontmatter.ownerRole = String(input.ownerRole)
      // The taskboard's stable key: the TASK row keeps the id of the board task it mirrors.
      if (typeof input.boardId === 'string' && input.boardId !== '') frontmatter.boardId = input.boardId
      // BATCHING (FR15): one TASK may cover several requirements and a list of steps with a
      // progress counter; a task is the unit of acceptance, not a micro-step.
      if (Array.isArray(input.reqIds) && stringList(input.reqIds).length > 0) frontmatter.reqIds = stringList(input.reqIds)
      if (Array.isArray(input.steps) && stringList(input.steps).length > 0) {
        frontmatter.steps = stringList(input.steps)
        if (Number.isSafeInteger(input.stepsDone) && input.stepsDone >= 0) frontmatter.stepsDone = input.stepsDone
      }
      // THE CONCRETE TASK: the same fields the Tasks panel edits, so the register and the
      // board agree on what a task is. Empty values are omitted; the file stays readable.
      const scope = stringList(input.scope)
      if (scope.length > 0) frontmatter.scope = scope
      const nonScope = stringList(input.nonScope)
      if (nonScope.length > 0) frontmatter.nonScope = nonScope
      const acceptance = acceptanceList(input.acceptance)
      if (acceptance.length > 0) frontmatter.acceptance = acceptance
      if (typeof input.role === 'string' && input.role.trim() !== '') frontmatter.role = input.role.trim().slice(0, 80)
      if (typeof input.preset === 'string' && input.preset.trim() !== '') frontmatter.preset = input.preset.trim().slice(0, 80)
      if (input.inline === true) frontmatter.inline = true
      const owner = ownerOf(input.owner)
      if (owner !== undefined) frontmatter.owner = owner
      const sessions = sessionList(input.sessions)
      if (sessions.length > 0) frontmatter.sessions = sessions
      if (typeof input.resultSummary === 'string' && input.resultSummary.trim() !== '') frontmatter.resultSummary = input.resultSummary.trim()
      const resultEvidence = stringList(input.resultEvidence)
      if (resultEvidence.length > 0) frontmatter.resultEvidence = resultEvidence
      const resultArtifacts = stringList(input.resultArtifacts)
      if (resultArtifacts.length > 0) frontmatter.resultArtifacts = resultArtifacts
    }
    if (kind === 'test') {
      if (input.reqId !== undefined) frontmatter.reqId = String(input.reqId)
      if (input.authorRole !== undefined) frontmatter.authorRole = String(input.authorRole)
      if (input.command !== undefined) frontmatter.command = String(input.command)
      if (input.testPath !== undefined) frontmatter.testPath = String(input.testPath)
      if (input.frozenHash !== undefined) frontmatter.frozenHash = String(input.frozenHash)
      if (Array.isArray(input.evidenceRefs)) frontmatter.evidenceRefs = input.evidenceRefs.map(String)
      if (typeof input.caseId === 'string' && input.caseId !== '') frontmatter.caseId = input.caseId
    }
    if (kind === 'decision') {
      if (input.supersedes !== undefined) frontmatter.supersedes = String(input.supersedes)
    }
    frontmatter.links = []
    return { ok: true, frontmatter, body: typeof input.body === 'string' ? input.body : '' }
  }

  /** All entity files as `{rel, kind, id}`; unreadable/invalid files are listed separately. */
  async function scanEntities() {
    const entities = []
    const invalid = []
    for (const kind of Object.keys(DIRS)) {
      let names = []
      try {
        names = await readdir(join(root, DIRS[kind]))
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      for (const name of names.sort()) {
        if (!name.endsWith('.md')) continue
        const rel = entityPath(kind, name.slice(0, -3))
        const record = await readEntity(rel)
        if (record === null) continue
        if (record.invalid === true) {
          invalid.push(record)
          continue
        }
        entities.push({ ...record, kind, fileKind: kind })
      }
    }
    return { entities, invalid }
  }

  const service = {
    /** The state root, absolute. */
    get root() {
      return root
    },

    /**
     * The next ID for a kind, WITHOUT reserving it. Advisory for a model that wants to quote an
     * ID before writing; `create` is the authoritative allocation, under the lock.
     */
    async issueId(kind) {
      const clean = normaliseKind(kind)
      if (clean === undefined) return fail('kind_invalid', `kind must be one of ${Object.keys(KINDS).join(', ')}`)
      try {
        const id = await withLock(() => peekNextId(clean))
        return { ok: true, id }
      } catch (error) {
        return fail('lock_failed', error.message)
      }
    },

    /**
     * Append one journal record (the FR8 waiver trail): the code that was waived, the reason
     * and the human. Public so a gate that accepted an explicit waiver leaves the decision in
     * the state journal.
     */
    async journal(event) {
      if (event === null || typeof event !== 'object') return fail('journal_invalid', 'event must be an object')
      return appendJournal({ kind: 'waiver', ...event })
    },

    /** Create one entity and append its event to the journal. */
    async create(kind, input = {}) {
      const clean = normaliseKind(kind)
      if (clean === undefined) return fail('kind_invalid', `kind must be one of ${Object.keys(KINDS).join(', ')}`)
      if (typeof input.title !== 'string' || input.title.trim() === '') return fail('title_required', 'title must be a non-empty string')
      try {
        return await withLock(async () => {
          const id = await peekNextId(clean)
          const built = buildFrontmatter(clean, input, id)
          if (built.ok === false) return built
          const rel = entityPath(clean, id)
          const text = await writeEntity(rel, built.frontmatter, built.body)
          const event = await appendJournal({ op: 'create', id, kind: clean, revision: 1, record: built.frontmatter, body: built.body })
          return { ok: true, id, path: rel, revision: 1, hash: sha256(text), event: event.seq }
        })
      } catch (error) {
        return fail('write_failed', error.message)
      }
    },

    /** Read one entity. */
    async get(id) {
      const match = ID_PATTERN.exec(String(id))
      if (match === null) return fail('id_invalid', `id "${id}" is not a typed id`)
      const kind = KIND_BY_PREFIX[match[1]]
      const record = await readEntity(entityPath(kind, String(id)))
      if (record === null) return fail('not_found', `no entity ${id}`)
      if (record.invalid === true) return fail('frontmatter_invalid', `${record.rel}: ${record.error}`)
      return { ok: true, id: String(id), kind, path: record.rel, hash: sha256(record.text), frontmatter: record.frontmatter, body: record.body }
    },

    /** List entities, optionally of one kind; sorted by id. */
    async list(kind) {
      const clean = kind === undefined ? undefined : normaliseKind(kind)
      if (kind !== undefined && clean === undefined) return fail('kind_invalid', `kind must be one of ${Object.keys(KINDS).join(', ')}`)
      try {
        const { entities, invalid } = await scanEntities()
        const rows = entities
          .filter((entity) => clean === undefined || entity.fileKind === clean)
          .map((entity) => ({ id: entity.frontmatter.id, kind: entity.fileKind, title: entity.frontmatter.title, status: entity.frontmatter.status, revision: entity.frontmatter.revision, path: entity.rel, ...(entity.frontmatter.analysisRef === undefined ? {} : { analysisRef: entity.frontmatter.analysisRef }), ...(entity.frontmatter.criteriaHash === undefined ? {} : { criteriaHash: entity.frontmatter.criteriaHash }), ...(entity.frontmatter.boardId === undefined ? {} : { boardId: entity.frontmatter.boardId }), ...(entity.frontmatter.reqId === undefined ? {} : { reqId: entity.frontmatter.reqId }), ...(entity.frontmatter.authorRole === undefined ? {} : { authorRole: entity.frontmatter.authorRole }), ...(entity.frontmatter.caseId === undefined ? {} : { caseId: entity.frontmatter.caseId }), ...(entity.frontmatter.evidenceRefs === undefined ? {} : { evidenceRefs: entity.frontmatter.evidenceRefs }), ...(entity.frontmatter.reqIds === undefined ? {} : { reqIds: entity.frontmatter.reqIds }), ...(entity.frontmatter.steps === undefined ? {} : { steps: entity.frontmatter.steps }), ...(entity.frontmatter.stepsDone === undefined ? {} : { stepsDone: entity.frontmatter.stepsDone }) }))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        return { ok: true, rows, invalid: invalid.map((entry) => ({ path: entry.rel, error: entry.error })) }
      } catch (error) {
        return fail('read_failed', error.message)
      }
    },

    /** Compare-and-set update: a stale `expectedRevision` refuses and writes nothing. */
    async update(id, patch = {}) {
      // LIFE-8 (owner: FR8): a decision is replaced only by a named successor and a stated
      // reason; a decision cannot be dropped without one.
      if (patch && patch.status === 'superseded') {
        const current = await service.get(id)
        if (current?.ok !== false && current.kind === 'decision') {
          const successor = typeof patch.supersededBy === 'string' ? patch.supersededBy.trim() : ''
          const reason = typeof patch.reason === 'string' ? patch.reason.trim() : ''
          if (successor === '' || reason === '') {
            return fail('decision_superseded', 'superseding a decision needs supersededBy (the successor id) and reason')
          }
          if (successor === id) return fail('decision_superseded', 'a decision cannot supersede itself')
          const target = await service.get(successor)
          if (target?.ok === false) return fail('decision_superseded', `successor ${successor} does not exist`)
        }
      }
      const match = ID_PATTERN.exec(String(id))
      if (match === null) return fail('id_invalid', `id "${id}" is not a typed id`)
      const kind = KIND_BY_PREFIX[match[1]]
      const expected = patch.expectedRevision
      if (!Number.isInteger(expected)) return fail('revision_required', 'expectedRevision must be an integer')
      try {
        return await withLock(async () => {
          const rel = entityPath(kind, String(id))
          const record = await readEntity(rel)
          if (record === null) return fail('not_found', `no entity ${id}`)
          if (record.invalid === true) return fail('frontmatter_invalid', `${record.rel}: ${record.error}`)
          const current = record.frontmatter
          if (Number(current.revision) !== expected) {
            return fail('revision_conflict', `expected revision ${expected}, file has ${current.revision}`)
          }
          const next = { ...current, revision: expected + 1, updatedAt: now() }
          // A schema backfill adds fields to an old entity; it must not reset the file's own
          // last-change time, which the panels order by. This flag keeps it, and is not stored.
          if (patch.preserveUpdatedAt === true && typeof current.updatedAt === 'string') next.updatedAt = current.updatedAt
          for (const field of ['title', 'status', 'ownerRole', 'reqId', 'command', 'choreReason', 'criteriaHash', 'boardId', 'testPath', 'frozenHash', 'caseId', 'stepsDone', 'supersededBy', 'reason']) {
            if (patch[field] !== undefined) next[field] = patch[field]
          }
          if (patch.analysisRef !== undefined && patch.analysisRef !== null && typeof patch.analysisRef === 'object') {
            next.analysisRef = { initiative: String(patch.analysisRef.initiative ?? ''), requirementId: String(patch.analysisRef.requirementId ?? '') }
          }
          if (Array.isArray(patch.criteria)) next.criteria = patch.criteria.map(String)
          if (Array.isArray(patch.evidenceRefs)) next.evidenceRefs = patch.evidenceRefs.map(String)
          // An empty list or an empty string CLEARS the field: the Tasks panel can remove a
          // scope line, and the register must follow instead of keeping the stale value.
          const assignList = (field, list) => {
            if (list.length === 0) delete next[field]
            else next[field] = list
          }
          const assignText = (field, value) => {
            const text = String(value ?? '').trim()
            if (text === '') delete next[field]
            else next[field] = text
          }
          if (Array.isArray(patch.reqIds)) assignList('reqIds', stringList(patch.reqIds))
          if (Array.isArray(patch.steps)) {
            assignList('steps', stringList(patch.steps))
            // A cleared plan has no progress: a lone stepsDone would claim a plan that is gone.
            if (stringList(patch.steps).length === 0) delete next.stepsDone
          }
          if (Array.isArray(patch.scope)) assignList('scope', stringList(patch.scope))
          if (Array.isArray(patch.nonScope)) assignList('nonScope', stringList(patch.nonScope))
          if (Array.isArray(patch.acceptance)) assignList('acceptance', acceptanceList(patch.acceptance))
          if (Array.isArray(patch.sessions)) assignList('sessions', sessionList(patch.sessions))
          if (Array.isArray(patch.resultEvidence)) assignList('resultEvidence', stringList(patch.resultEvidence))
          if (Array.isArray(patch.resultArtifacts)) assignList('resultArtifacts', stringList(patch.resultArtifacts))
          if (patch.role !== undefined) assignText('role', patch.role)
          if (patch.preset !== undefined) assignText('preset', patch.preset)
          if (patch.resultSummary !== undefined) assignText('resultSummary', patch.resultSummary)
          if (patch.inline !== undefined) {
            if (patch.inline === true) next.inline = true
            else delete next.inline
          }
          if (patch.owner !== undefined) {
            const owner = ownerOf(patch.owner)
            if (owner === undefined) delete next.owner
            else next.owner = owner
          }
          if (kind === 'task' && patch.chore === true) next.chore = true
          if (next.status !== undefined && !KINDS[kind].status.includes(next.status)) {
            return fail('status_invalid', `status "${next.status}" is not one of ${KINDS[kind].status.join(', ')}`)
          }
          const body = typeof patch.body === 'string' ? patch.body : record.body
          const text = await writeEntity(rel, next, body)
          const event = await appendJournal({ op: 'update', id: String(id), kind, revision: next.revision, record: next, body })
          return { ok: true, id: String(id), revision: next.revision, hash: sha256(text), event: event.seq }
        })
      } catch (error) {
        return fail('write_failed', error.message)
      }
    },

    /** Transition a TASK to done under CAS; shorthand for `update` with a fixed status. */
    async complete(id, patch = {}) {
      return service.update(id, { ...patch, status: 'done' })
    },

    /** Add a link to another entity with the hash of the target's bytes at this moment. */
    async link(fromId, toId) {
      const from = ID_PATTERN.exec(String(fromId))
      if (from === null) return fail('id_invalid', `id "${fromId}" is not a typed id`)
      const target = ID_PATTERN.exec(String(toId))
      if (target === null) return fail('id_invalid', `id "${toId}" is not a typed id`)
      const kind = KIND_BY_PREFIX[from[1]]
      const targetKind = KIND_BY_PREFIX[target[1]]
      try {
        return await withLock(async () => {
          const rel = entityPath(kind, String(fromId))
          const record = await readEntity(rel)
          if (record === null) return fail('not_found', `no entity ${fromId}`)
          if (record.invalid === true) return fail('frontmatter_invalid', `${record.rel}: ${record.error}`)
          const targetRel = entityPath(targetKind, String(toId))
          const targetRecord = await readEntity(targetRel)
          if (targetRecord === null) return fail('link_target_missing', `no entity ${toId}`)
          if (targetRecord.invalid === true) return fail('frontmatter_invalid', `${targetRecord.rel}: ${targetRecord.error}`)
          const next = { ...record.frontmatter, revision: Number(record.frontmatter.revision) + 1, updatedAt: now() }
          const links = Array.isArray(next.links) ? [...next.links] : []
          if (links.some((entry) => entry.id === String(toId))) return fail('link_duplicate', `${fromId} already links ${toId}`)
          links.push({ kind: targetKind, id: String(toId), hash: sha256(targetRecord.text) })
          next.links = links
          const text = await writeEntity(rel, next, record.body)
          const event = await appendJournal({ op: 'link', id: String(fromId), kind, revision: next.revision, record: next, body: record.body })
          return { ok: true, id: String(fromId), path: rel, revision: next.revision, link: links[links.length - 1], hash: sha256(text), event: event.seq }
        })
      } catch (error) {
        return fail('write_failed', error.message)
      }
    },

    /** Claim a TASK for one owner (status active, a lease in the body is the caller's). */
    async claim(id, { owner } = {}) {
      if (typeof owner !== 'string' || owner.trim() === '') return fail('owner_required', 'claim needs a non-empty owner')
      const record = await service.get(id)
      if (record.ok === false) return record
      if (record.frontmatter.kind !== 'task') return fail('kind_invalid', 'only a TASK can be claimed')
      return service.update(id, { expectedRevision: record.frontmatter.revision, status: 'active', ownerRole: owner })
    },

    /** Release a claim: back to open, owner cleared. */
    async release(id) {
      const record = await service.get(id)
      if (record.ok === false) return record
      if (record.frontmatter.kind !== 'task') return fail('kind_invalid', 'only a TASK can be released')
      return service.update(id, { expectedRevision: record.frontmatter.revision, status: 'open', ownerRole: '' })
    },

    /**
     * Regenerate every projection under `state/views/` from the current entities, then write
     * the hash manifest `views/.hashes.json`. Read-only with respect to `state/` itself: only
     * `state/views/` is written. A second run on unchanged state produces identical bytes.
     */
    async regenerateViews() {
      try {
        const { entities } = await scanEntities()
        const pick = (kind) => entities.filter((entity) => entity.fileKind === kind).map((entity) => entity.frontmatter)
        const model = buildModel({ reqs: pick('req'), tasks: pick('task'), tests: pick('test'), decisions: pick('decision') })
        // Stale links: a REQ whose incoming link hash no longer matches the target bytes.
        const staleIds = new Set()
        for (const entity of entities) {
          for (const link of Array.isArray(entity.frontmatter.links) ? entity.frontmatter.links : []) {
            const target = entities.find((candidate) => candidate.frontmatter.id === link.id)
            if (target !== undefined && link.hash !== sha256(target.text)) {
              staleIds.add(entity.fileKind === 'req' ? entity.frontmatter.id : link.id)
            }
          }
        }
        const events = await readJournal()
        const lastSeq = events.reduce((max, event) => (typeof event?.seq === 'number' ? Math.max(max, event.seq) : max), 0)
        const files = renderViews(model, { lastSeq, staleIds })
        const viewsDir = join(root, VIEW_DIR)
        await mkdir(viewsDir, { recursive: true })
        // Remove a map subgraph whose REQ is gone, so a rename never leaves an orphan projection.
        try {
          for (const name of await readdir(join(viewsDir, 'map'))) {
            const rel = `map/${name}`
            if (files[rel] === undefined) await rm(join(viewsDir, name))
          }
        } catch {
          // No map directory yet.
        }
        const hashes = {}
        for (const [relPath, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
          await mkdir(dirname(join(viewsDir, relPath)), { recursive: true })
          await writeFile(join(viewsDir, relPath), text, { encoding: 'utf8' })
          hashes[relPath] = sha256(text)
        }
        const manifest = { schemaVersion: 1, files: hashes }
        await writeFile(join(viewsDir, '.hashes.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8' })
        // No journal event: a projection is derived, and appending one would move `lastSeq` on
        // every run — the digest would stop being byte-identical on unchanged state.
        return { ok: true, files: Object.keys(hashes), digestBytes: Buffer.byteLength(files['digest.md'], 'utf8') }
      } catch (error) {
        return fail('views_failed', error.message)
      }
    },

    /** Hash every state file; the replay comparison uses this map. */
    async snapshot() {
      const { entities, invalid } = await scanEntities()
      const files = {}
      for (const entity of entities) files[entity.rel.split(sep).join('/')] = sha256(entity.text)
      for (const entry of invalid) files[entry.rel.split(sep).join('/')] = sha256(entry.text)
      return { ok: true, files }
    },

    /**
     * Replay the journal into entities, serialize them with the same writer and compare the
     * bytes against the files on disk. Read-only; a mismatch names the file.
     */
    async replay() {
      try {
        const events = await readJournal()
        const state = new Map()
        const problems = []
        for (const event of events) {
          if (event === null || typeof event !== 'object' || event.malformed !== undefined) {
            problems.push({ seq: null, code: 'journal_invalid', message: 'unparsable journal line' })
            continue
          }
          if (event.op === 'create' || event.op === 'update' || event.op === 'link' || event.op === 'claim' || event.op === 'release' || event.op === 'complete') {
            if (event.kind === undefined || event.record === undefined) {
              problems.push({ seq: event.seq, code: 'journal_invalid', message: 'event without kind/record' })
              continue
            }
            state.set(event.id, { kind: event.kind, frontmatter: event.record, body: event.body ?? '' })
          }
        }
        const { entities } = await scanEntities()
        const mismatches = []
        const seen = new Set()
        for (const entity of entities) {
          seen.add(entity.frontmatter.id)
          const replayed = state.get(entity.frontmatter.id)
          const expected = replayed === undefined ? undefined : serialize({ frontmatter: replayed.frontmatter, body: replayed.body })
          if (expected === undefined) {
            mismatches.push({ id: entity.frontmatter.id, reason: 'missing_in_journal' })
          } else if (expected !== entity.text) {
            mismatches.push({ id: entity.frontmatter.id, reason: 'bytes_differ' })
          }
        }
        for (const id of state.keys()) if (!seen.has(id)) mismatches.push({ id, reason: 'missing_on_disk' })
        return { ok: mismatches.length === 0 && problems.length === 0, events: events.length, mismatches, problems }
      } catch (error) {
        return fail('replay_failed', error.message)
      }
    },

    /**
     * Structured findings; reads only. Codes: frontmatter_invalid, link_broken, link_stale,
     * req_criteria_missing, task_req_missing, orphan, status_invalid, id_mismatch.
     */
    async verify() {
      const findings = []
      try {
        const { entities, invalid } = await scanEntities()
        for (const entry of invalid) findings.push({ code: 'frontmatter_invalid', path: entry.rel.split(sep).join('/'), message: `${entry.error} (line ${entry.line})` })
        const byId = new Map()
        for (const entity of entities) {
          const fm = entity.frontmatter
          const id = fm.id
          const path = entity.rel.split(sep).join('/')
          if (typeof id !== 'string' || ID_PATTERN.exec(id) === null) {
            findings.push({ code: 'frontmatter_invalid', path, message: 'missing or malformed id' })
            continue
          }
          const expectedKind = KIND_BY_PREFIX[ID_PATTERN.exec(id)[1]]
          if (expectedKind !== entity.fileKind) findings.push({ code: 'id_mismatch', id, path, message: `id says ${expectedKind}, file is under ${entity.fileKind}/` })
          if (byId.has(id)) findings.push({ code: 'id_duplicate', id, path, message: `duplicate id, first at ${byId.get(id).rel}` })
          else byId.set(id, entity)
          if (fm.status !== undefined && !KINDS[entity.fileKind].status.includes(fm.status)) findings.push({ code: 'status_invalid', id, path, message: `status "${fm.status}"` })
        }
        const incoming = new Map()
        for (const entity of entities) {
          const fm = entity.frontmatter
          const id = fm.id
          if (typeof id !== 'string') continue
          const path = entity.rel.split(sep).join('/')
          const links = Array.isArray(fm.links) ? fm.links : []
          if (entity.fileKind === 'req' && (!Array.isArray(fm.criteria) || fm.criteria.filter((item) => String(item).trim() !== '').length === 0)) {
            findings.push({ code: 'req_criteria_missing', id, path, message: 'REQ has no acceptance criteria' })
          }
          if (entity.fileKind === 'task' && (fm.reqId === undefined || String(fm.reqId).trim() === '') && !(fm.chore === true && typeof fm.choreReason === 'string' && fm.choreReason.trim() !== '')) {
            findings.push({ code: 'task_req_missing', id, path, message: 'TASK has no reqId and is not chore+reason' })
          }
          for (const link of links) {
            const target = byId.get(link.id)
            if (target === undefined) {
              findings.push({ code: 'link_broken', id, path, message: `link to ${link.id} has no target` })
              continue
            }
            incoming.set(link.id, (incoming.get(link.id) ?? 0) + 1)
            if (link.hash !== sha256(target.text)) findings.push({ code: 'link_stale', id, path, message: `link to ${link.id} is stale: hash differs from the target's bytes` })
          }
          if (entity.fileKind !== 'req' && links.length === 0 && (incoming.get(id) ?? 0) === 0) {
            findings.push({ code: 'orphan', id, path, message: `${entity.fileKind} has no incoming or outgoing link` })
          }
        }
        // Projections: the manifest records what regenerateViews() wrote. A different or
        // missing file is a hand edit that regeneration would overwrite — report, never repair.
        try {
          const manifest = JSON.parse(await readFile(join(root, VIEW_DIR, '.hashes.json'), 'utf8'))
          for (const [relPath, expected] of Object.entries(manifest.files ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
            let actual = null
            try {
              actual = await readFile(join(root, VIEW_DIR, relPath), 'utf8')
            } catch {
              actual = null
            }
            if (actual === null) {
              findings.push({ code: 'view_modified', path: `${VIEW_DIR}/${relPath}`, message: 'projection is missing; run regenerateViews()' })
            } else if (sha256(actual) !== expected) {
              findings.push({ code: 'view_modified', path: `${VIEW_DIR}/${relPath}`, message: 'projection was edited by hand; run regenerateViews()' })
            }
          }
        } catch {
          // No manifest yet: nothing was generated, so nothing can have been modified.
        }
        return { ok: findings.length === 0, findings }
      } catch (error) {
        return fail('verify_failed', error.message)
      }
    },
  }

  return service
}

export { KINDS, DIRS }
