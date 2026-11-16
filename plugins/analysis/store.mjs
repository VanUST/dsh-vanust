/**
 * PURPOSE
 *   The Analysis Record store: one repo-tracked JSON document per initiative under
 *   `docs/analysis/<initiative>.json`, with compare-and-set writes, an atomic temp-file +
 *   rename, a semantic fingerprint, a completeness checker and an impact calculator. It is
 *   the only place requirement → process → component → task → evidence is stored; the
 *   taskboard stays a lifecycle ledger and the design map stays a visual scene.
 *
 * INPUTS
 *   Config (all optional):
 *     dir            store directory relative to the session workspace. Default 'docs/analysis'.
 *     designMapFile  design-map scene relative to the workspace. Default 'design.excalidraw'.
 *     historyLimit   retained history entries. Default 50.
 *   The service is created by `analysis.mjs` and provided as `analysis`.
 *
 * OUTPUTS
 *   A service object: read, list, upsert, check, impact, linkTask, gate. Each method takes
 *   the workspace directory first and returns a canonical JSON value. A refusal is a value
 *   `{ok:false, code, message}`, not a throw, except an invalid patch which throws an
 *   AnalysisError carrying `code: 'invalid_record'`.
 *
 * KEYWORDS
 *   analysis record, CAS, atomic rename, semantic fingerprint, completeness, trace,
 *   requirement, process, component, contract, invariant, designMapRev, impact
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A missing record is `{exists:false}` for a read and `analysis_required` for a gate,
 *     never an empty document silently treated as ready.
 *   - A malformed file or one that no longer matches its semantic fingerprint is refused
 *     (`malformed` / `fingerprint_mismatch`), never overwritten by a read.
 *   - A write is temp-file + rename in the same directory, so a crash cannot leave half a
 *     JSON document.
 *   - An existing record needs the `expectedRev` it read; a moved revision returns `stale`
 *     with the current revision. A new record accepts no revision or 0.
 *   - Trace-only edits (linking a task) do not change the semantic fingerprint; a requirement
 *     text/acceptance change on a ready or completed record automatically records a pending
 *     impact and reopens the record as `draft`, so the next delegation sees `analysis_stale`.
 *   - A record becomes `ready` only when the completeness checker has no errors; it becomes
 *     `completed` only when every requirement is proven with task+evidence or explicitly
 *     deferred/rejected with a reason.
 *   - The design map revision is a reference, not a second store: a ready record captures it
 *     at the transition, and a newer map makes an architecture-affecting delegation stale.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export const SCHEMA_VERSION = 1
export const RECORD_STATUSES = ['draft', 'ready', 'completed']
export const CHANGE_CLASSES = ['L0', 'L1', 'L2']
export const REQUIREMENT_KINDS = ['BR', 'FR', 'NFR']
export const REQUIREMENT_STATUSES = ['planned', 'proven', 'deferred', 'rejected']
export const TRACE_STATUSES = ['planned', 'in_progress', 'proven', 'deferred', 'rejected']
export const CONTRACT_CHANGES = ['none', 'additive', 'breaking']

/**
 * Semantic content limits. They are enforced on WRITE and never repaired by truncation: an
 * over-limit value is refused with `limit_exceeded` carrying path/max/actual, so a successful
 * write cannot silently lose bytes and a UTF-16 slice can never split a surrogate pair.
 */
export const LIMITS = Object.freeze({
  title: 200,
  requestedSolution: 8000,
  outcomeText: 4000,
  successMetrics: 20,
  processName: 200,
  processActors: 20,
  processSteps: 50,
  requirementText: 4000,
  acceptance: 30,
  reason: 1000,
  name: 200,
  responsibility: 1000,
  owner: 120,
  ownerComponentId: 200,
  description: 1000,
  invariantText: 2000,
  invariantScope: 400,
  decision: 2000,
  rationale: 2000,
  alternatives: 10,
  question: 2000,
  answer: 2000,
  sizingReasons: 20,
  taskRole: 80,
  evidence: 20,
  goalId: 120,
  goalHistory: 50,
})

/** The fields that decide whether an analysis is still the analysis the caller read. */
const SEMANTIC_FIELDS = [
  'title',
  'requestedSolution',
  'businessOutcome',
  'process',
  'requirements',
  'architecture',
  'data',
  'contracts',
  'invariants',
  'decisions',
  'openQuestions',
  'sizing',
  'designRef',
  'goalId',
  'goalHistory',
  'status',
]
/** Top-level object patches merge one level; arrays are always replacements. */
const OBJECT_PATCHES = new Set(['businessOutcome', 'process', 'architecture', 'sizing', 'designRef'])
/** The only fields a patch may carry. Trace is edited explicitly, never inferred. */
const PATCHABLE = new Set([
  ...SEMANTIC_FIELDS,
  'trace',
])

/** A refusal the tool layer can quote as `{ok:false, code, message}`. */
export class AnalysisError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'AnalysisError'
    this.code = code
    this.details = details
  }
}

const invalid = (message, path) => {
  throw new AnalysisError('invalid_record', path === undefined ? message : `${path}: ${message}`, path === undefined ? {} : { path })
}

/** Stable JSON: sorted keys, arrays in order, undefined dropped. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = canonical(value[key])
    }
    return out
  }
  return value
}

/**
 * The trace MAPPING a requirement points at. Tasks, evidence, status and reason are
 * deliberately excluded: linking a task or proving a requirement is not a redesign, while
 * moving a requirement to another process/component/contract is.
 */
function traceMappingOf(record) {
  return (record.trace ?? []).map((row) => ({
    requirementId: row.requirementId,
    processId: row.processId,
    componentId: row.componentId,
    contractIds: [...row.contractIds].sort(),
    dataIds: [...row.dataIds].sort(),
  }))
}

function semanticSlice(record) {
  const out = {}
  for (const field of SEMANTIC_FIELDS) out[field] = record[field]
  out.traceMap = traceMappingOf(record)
  return out
}

/** The semantic fingerprint: trace-only edits must not move it. */
export function fingerprintOf(record) {
  return createHash('sha256').update(JSON.stringify(canonical(semanticSlice(record)))).digest('hex')
}

/**
 * Versioned recognition of fingerprints written by an earlier plugin version.
 *
 * 0.1.4 normalized `data[]` without `ownerComponentId`, so its stored hash covers a record
 * where the canonical owner does not exist yet. The view below reconstructs exactly that
 * semantic shape, so a genuine old record is recognised as LEGACY instead of being called a
 * hand edit. Recognition is deterministic and version-labelled; the next successful write
 * seals the current fingerprint and records a `migrate` history entry.
 */
export const LEGACY_FINGERPRINT_VERSIONS = ['0.1.4']

function legacySemanticView(record) {
  const copy = JSON.parse(JSON.stringify(record))
  for (const row of copy.data ?? []) delete row.ownerComponentId
  return copy
}

/**
 * Which fingerprint the stored document actually carries.
 * `{matches, legacy, version}`: `matches` means "written by a known version, not a hand edit".
 */
export function fingerprintStatusOf(record) {
  const stored = asString(record.fingerprint)
  if (stored === '') return { matches: false, legacy: false, version: '' }
  if (stored === fingerprintOf(record)) return { matches: true, legacy: false, version: '' }
  for (const version of LEGACY_FINGERPRINT_VERSIONS) {
    if (stored === fingerprintOf(legacySemanticView(record))) return { matches: true, legacy: true, version }
  }
  return { matches: false, legacy: false, version: '' }
}

/** Legacy `components[].owns` with more than one owner and no canonical owner. */
function ambiguousOwnershipOf(record) {
  return record.data.some((data) => (data.ownerComponentId ?? '') === ''
    && record.architecture.components.filter((component) => component.owns.includes(data.id)).length > 1)
}

function requirementSpecHash(requirement) {
  // planned and proven are the same ANALYSIS; deferred/rejected are a scope decision and
  // therefore a semantic change. The reason is part of that decision.
  const parked = requirement.status === 'deferred' || requirement.status === 'rejected'
  return createHash('sha256')
    .update(JSON.stringify(canonical({
      id: requirement.id,
      kind: requirement.kind,
      text: requirement.text,
      acceptance: requirement.acceptance,
      status: parked ? requirement.status : 'active',
      reason: parked ? requirement.reason ?? '' : '',
    })))
    .digest('hex')
}

const asString = (value) => (typeof value === 'string' ? value.trim() : '')
const asStringArray = (value) => {
  if (typeof value === 'string') return value.trim() === '' ? [] : [value.trim()]
  if (!Array.isArray(value)) return []
  return value.filter((entry) => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim())
}
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
function objectAt(value, path) {
  if (!plainObject(value)) invalid('must be an object', path)
  return value
}
function arrayAt(value, path, fallback = []) {
  if (value === undefined) return fallback
  if (!Array.isArray(value)) invalid('must be an array', path)
  return value
}
function uniqueIds(rows, path) {
  const seen = new Set()
  for (let at = 0; at < rows.length; at += 1) {
    const id = asString(rows[at]?.id)
    if (id === '') invalid('needs a non-empty id', `${path}[${at}]`)
    if (seen.has(id)) invalid(`duplicate id "${id}"`, `${path}[${at}]`)
    seen.add(id)
  }
  return seen
}

function normalizeBusinessOutcome(value) {
  const raw = value === undefined ? {} : objectAt(value, 'businessOutcome')
  return {
    problem: asString(raw.problem),
    outcome: asString(raw.outcome),
    successMetrics: asStringArray(raw.successMetrics),
  }
}

function normalizeProcessList(value, path) {
  return arrayAt(value, path).map((entry, at) => {
    const raw = objectAt(entry, `${path}[${at}]`)
    const id = asString(raw.id)
    if (id === '') invalid('needs an id', `${path}[${at}]`)
    return {
      id,
      name: asString(raw.name) || id,
      actors: asStringArray(raw.actors),
      steps: asStringArray(raw.steps),
    }
  })
}

function normalizeRequirements(value) {
  const rows = arrayAt(value, 'requirements').map((entry, at) => {
    const raw = objectAt(entry, `requirements[${at}]`)
    const id = asString(raw.id)
    if (id === '') invalid('needs an id', `requirements[${at}]`)
    const kind = asString(raw.kind).toUpperCase()
    if (!REQUIREMENT_KINDS.includes(kind)) invalid(`kind must be one of ${REQUIREMENT_KINDS.join(', ')}`, `requirements[${at}].kind`)
    const status = raw.status === undefined ? 'planned' : asString(raw.status)
    if (!REQUIREMENT_STATUSES.includes(status)) invalid(`status must be one of ${REQUIREMENT_STATUSES.join(', ')}`, `requirements[${at}].status`)
    return {
      id,
      kind,
      text: asString(raw.text),
      acceptance: asStringArray(raw.acceptance),
      status,
      ...(asString(raw.reason) === '' ? {} : { reason: asString(raw.reason) }),
    }
  })
  uniqueIds(rows, 'requirements')
  return rows
}

function normalizeArchitecture(value) {
  const raw = value === undefined ? {} : objectAt(value, 'architecture')
  const components = arrayAt(raw.components, 'architecture.components').map((entry, at) => {
    const item = objectAt(entry, `architecture.components[${at}]`)
    const id = asString(item.id)
    if (id === '') invalid('needs an id', `architecture.components[${at}]`)
    return {
      id,
      name: asString(item.name) || id,
      responsibility: asString(item.responsibility),
      owner: asString(item.owner),
      owns: asStringArray(item.owns),
      dependsOn: asStringArray(item.dependsOn),
    }
  })
  uniqueIds(components, 'architecture.components')
  const contractImpact = asString(raw.contractImpact)
  if (contractImpact !== '' && !CONTRACT_CHANGES.includes(contractImpact)) {
    invalid(`contractImpact must be one of ${CONTRACT_CHANGES.join(', ')} or empty`, 'architecture.contractImpact')
  }
  return { contractImpact, components }
}

function normalizeData(value) {
  const rows = arrayAt(value, 'data').map((entry, at) => {
    const raw = objectAt(entry, `data[${at}]`)
    const id = asString(raw.id)
    if (id === '') invalid('needs an id', `data[${at}]`)
    const ownerComponentId = asString(raw.ownerComponentId)
    return {
      id,
      name: asString(raw.name) || id,
      owner: asString(raw.owner),
      ...(ownerComponentId === '' ? {} : { ownerComponentId }),
      description: asString(raw.description),
    }
  })
  uniqueIds(rows, 'data')
  return rows
}

function normalizeContracts(value) {
  const rows = arrayAt(value, 'contracts').map((entry, at) => {
    const raw = objectAt(entry, `contracts[${at}]`)
    const id = asString(raw.id)
    if (id === '') invalid('needs an id', `contracts[${at}]`)
    const change = asString(raw.change)
    return {
      id,
      name: asString(raw.name) || id,
      between: asStringArray(raw.between),
      change: CONTRACT_CHANGES.includes(change) ? change : '',
      description: asString(raw.description),
    }
  })
  uniqueIds(rows, 'contracts')
  return rows
}

function normalizeInvariants(value) {
  const rows = arrayAt(value, 'invariants').map((entry, at) => {
    const raw = objectAt(entry, `invariants[${at}]`)
    const id = asString(raw.id)
    if (id === '') invalid('needs an id', `invariants[${at}]`)
    return { id, text: asString(raw.text), scope: asString(raw.scope) }
  })
  uniqueIds(rows, 'invariants')
  return rows
}

function normalizeDecisions(value) {
  const rows = arrayAt(value, 'decisions').map((entry, at) => {
    const raw = objectAt(entry, `decisions[${at}]`)
    const id = asString(raw.id)
    if (id === '') invalid('needs an id', `decisions[${at}]`)
    return {
      id,
      decision: asString(raw.decision),
      rationale: asString(raw.rationale),
      alternatives: asStringArray(raw.alternatives),
    }
  })
  uniqueIds(rows, 'decisions')
  return rows
}

function normalizeOpenQuestions(value) {
  const rows = arrayAt(value, 'openQuestions').map((entry, at) => {
    const raw = objectAt(entry, `openQuestions[${at}]`)
    const id = asString(raw.id)
    if (id === '') invalid('needs an id', `openQuestions[${at}]`)
    return {
      id,
      question: asString(raw.question),
      owner: asString(raw.owner),
      blocks: raw.blocks === true,
      answer: asString(raw.answer),
    }
  })
  uniqueIds(rows, 'openQuestions')
  return rows
}

function normalizeSizing(value) {
  const raw = value === undefined ? {} : objectAt(value, 'sizing')
  const klass = raw.class === undefined || raw.class === null ? '' : asString(raw.class)
  if (klass !== '' && !CHANGE_CLASSES.includes(klass)) invalid(`class must be one of ${CHANGE_CLASSES.join(', ')}`, 'sizing.class')
  return { class: klass, reasons: asStringArray(raw.reasons) }
}

function normalizeDesignRef(value) {
  if (value === undefined || value === null) return null
  const raw = objectAt(value, 'designRef')
  const mapRev = raw.mapRev
  if (!Number.isSafeInteger(mapRev) || mapRev < 0) invalid('mapRev must be a non-negative integer', 'designRef.mapRev')
  const at = asString(raw.at)
  if (at !== '' && Number.isNaN(Date.parse(at))) invalid('at must be a parseable ISO timestamp', 'designRef.at')
  return {
    mapRev,
    at,
    source: asString(raw.source) || 'design.excalidraw',
  }
}

function normalizeTrace(value) {
  const rows = arrayAt(value, 'trace').map((entry, at) => {
    const raw = objectAt(entry, `trace[${at}]`)
    const requirementId = asString(raw.requirementId)
    if (requirementId === '') invalid('needs a requirementId', `trace[${at}]`)
    const status = raw.status === undefined ? 'planned' : asString(raw.status)
    if (!TRACE_STATUSES.includes(status)) invalid(`status must be one of ${TRACE_STATUSES.join(', ')}`, `trace[${at}].status`)
    const tasks = arrayAt(raw.tasks, `trace[${at}].tasks`, []).map((task, taskAt) => {
      const item = objectAt(task, `trace[${at}].tasks[${taskAt}]`)
      const taskId = asString(item.taskId)
      if (taskId === '') invalid('needs a taskId', `trace[${at}].tasks[${taskAt}]`)
      return {
        taskId,
        role: asString(item.role),
        at: asString(item.at),
        evidence: asStringArray(item.evidence),
      }
    })
    return {
      requirementId,
      processId: asString(raw.processId),
      componentId: asString(raw.componentId),
      contractIds: asStringArray(raw.contractIds),
      dataIds: asStringArray(raw.dataIds),
      status,
      tasks,
      ...(asString(raw.reason) === '' ? {} : { reason: asString(raw.reason) }),
    }
  })
  return rows
}

function normalizeImpacts(value) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    if (!plainObject(entry)) return null
    return {
      id: asString(entry.id),
      at: asString(entry.at),
      source: asString(entry.source) || 'impact',
      kind: asString(entry.kind) || 'requirement',
      requirementId: asString(entry.requirementId),
      targetId: asString(entry.targetId),
      change: asString(entry.change),
      status: 'pending',
      affected: plainObject(entry.affected) ? {
        requirementIds: asStringArray(entry.affected.requirementIds),
        processIds: asStringArray(entry.affected.processIds),
        componentIds: asStringArray(entry.affected.componentIds),
        contractIds: asStringArray(entry.affected.contractIds),
        dataIds: asStringArray(entry.affected.dataIds),
        taskIds: asStringArray(entry.affected.taskIds),
        global: entry.affected.global === true,
      } : { requirementIds: [], processIds: [], componentIds: [], contractIds: [], dataIds: [], taskIds: [], global: false },
    }
  }).filter((entry) => entry !== null)
}


/**
 * Strict, aggregate validation of one caller-supplied record shape.
 *
 * It walks every nested section, rejects unknown keys and invalid types/enums with the
 * exact JSON path, and collects every independent finding before anything is written. It
 * does not replace the semantic readiness check: missing acceptance, ownership roles and
 * unresolved trace are findings there, not structural projection errors.
 */
const TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'id', 'rev', 'status', 'createdAt', 'updatedAt', 'updatedBy',
  'title', 'requestedSolution', 'businessOutcome', 'process', 'requirements',
  'architecture', 'data', 'contracts', 'invariants', 'decisions', 'openQuestions',
  'sizing', 'designRef', 'goalId', 'goalHistory', 'trace', 'pendingImpacts',
  'fingerprint', 'history',
])

export function validateStrict(raw, options = {}) {
  const findings = []
  const add = (code, path, message, extra) => findings.push({ code, path, message, severity: 'error', ...(extra === undefined ? {} : extra) })
  if (!plainObject(raw)) {
    add('invalid_type', '', 'the record must be a JSON object')
    return { ok: false, findings }
  }
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) add('unknown_key', key, `unknown top-level key "${key}"`)
  }
  const keys = (value, path, allowed) => {
    if (!plainObject(value)) {
      add('invalid_type', path, 'must be an object')
      return null
    }
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) add('unknown_key', path === '' ? key : `${path}.${key}`, `unknown key "${key}"`)
    }
    return value
  }
  const object = (parent, key, path) => {
    const value = parent[key]
    if (value === undefined || value === null) return null
    if (!plainObject(value)) {
      add('invalid_type', path, 'must be an object')
      return null
    }
    return value
  }
  const list = (parent, key, path) => {
    const value = parent[key]
    if (value === undefined) return []
    if (!Array.isArray(value)) {
      add('invalid_type', path, 'must be an array')
      return []
    }
    return value
  }
  const enforcing = options.enforceLimits !== false
  const string = (parent, key, path, required = false, max = 0) => {
    const value = parent[key]
    if (value === undefined) {
      if (required && options.requireContent !== false) add('missing_field', path, 'is required')
      return ''
    }
    if (typeof value !== 'string') {
      add('invalid_type', path, 'must be a string')
      return ''
    }
    const text = value.trim()
    if (text === '' && required && options.requireContent !== false) add('missing_field', path, 'must not be empty')
    if (max > 0 && enforcing && text.length > max) {
      add('limit_exceeded', path, `must be at most ${max} UTF-16 code units (got ${text.length})`, { max, actual: text.length })
    }
    return text
  }
  const strings = (parent, key, path, max = 0) => {
    const value = parent[key]
    if (value === undefined) return []
    if (!Array.isArray(value)) {
      add('invalid_type', path, 'must be an array of strings')
      return []
    }
    for (let at = 0; at < value.length; at += 1) {
      if (typeof value[at] !== 'string') add('invalid_type', `${path}[${at}]`, 'must be a string')
    }
    if (max > 0 && enforcing && value.length > max) {
      add('limit_exceeded', path, `must have at most ${max} items (got ${value.length})`, { max, actual: value.length })
    }
    return value.filter((entry) => typeof entry === 'string')
  }
  const unique = (rows, path) => {
    const seen = new Set()
    for (let at = 0; at < rows.length; at += 1) {
      // Ids are compared AFTER the same trim the normalizer applies, so " REQ-1 " and
      // "REQ-1" are the duplicate they become on write, reported in this same response.
      const id = typeof rows[at]?.id === 'string' ? rows[at].id.trim() : ''
      if (id === '') continue
      if (seen.has(id)) add('duplicate_id', `${path}[${at}].id`, `duplicate id "${id}"`)
      seen.add(id)
    }
    return seen
  }

  // title and requestedSolution are semantic content too: same limit rule, same refusal.
  string(raw, 'title', 'title', false, LIMITS.title)
  string(raw, 'requestedSolution', 'requestedSolution', false, LIMITS.requestedSolution)
  const status = raw.status === undefined ? 'draft' : string(raw, 'status', 'status')
  if (!RECORD_STATUSES.includes(status)) add('invalid_enum', 'status', `status must be one of ${RECORD_STATUSES.join(', ')}`)
  if (raw.id !== undefined && string(raw, 'id', 'id') === '') add('missing_field', 'id', 'must not be empty')

  // businessOutcome
  const business = object(raw, 'businessOutcome', 'businessOutcome')
  if (business !== null) {
    keys(business, 'businessOutcome', ['problem', 'outcome', 'successMetrics'])
    string(business, 'problem', 'businessOutcome.problem', false, LIMITS.outcomeText)
    string(business, 'outcome', 'businessOutcome.outcome', false, LIMITS.outcomeText)
    strings(business, 'successMetrics', 'businessOutcome.successMetrics', LIMITS.successMetrics)
  }

  // process {current,target}
  const process = object(raw, 'process', 'process')
  const processIds = new Set()
  if (process !== null) {
    keys(process, 'process', ['current', 'target'])
    for (const section of ['current', 'target']) {
      const rows = list(process, section, `process.${section}`)
      for (let at = 0; at < rows.length; at += 1) {
        const path = `process.${section}[${at}]`
        const item = keys(rows[at], path, ['id', 'name', 'actors', 'steps'])
        if (item === null) continue
        const id = string(item, 'id', `${path}.id`, true)
        if (id !== '') {
          if (processIds.has(id)) add('duplicate_id', `${path}.id`, `duplicate process id "${id}" across process.current/process.target`)
          processIds.add(id)
        }
        string(item, 'name', `${path}.name`, true, LIMITS.processName)
        strings(item, 'actors', `${path}.actors`, LIMITS.processActors)
        strings(item, 'steps', `${path}.steps`, LIMITS.processSteps)
      }
    }
  }

  // requirements
  const requirementIds = new Set()
  const requirements = list(raw, 'requirements', 'requirements')
  for (let at = 0; at < requirements.length; at += 1) {
    const path = `requirements[${at}]`
    const item = keys(requirements[at], path, ['id', 'kind', 'text', 'acceptance', 'status', 'reason'])
    if (item === null) continue
    const id = string(item, 'id', `${path}.id`, true)
    if (id !== '') requirementIds.add(id)
    const kind = string(item, 'kind', `${path}.kind`, true).toUpperCase()
    if (kind !== '' && !REQUIREMENT_KINDS.includes(kind)) add('invalid_enum', `${path}.kind`, `kind must be one of ${REQUIREMENT_KINDS.join(', ')}`)
    string(item, 'text', `${path}.text`, false, LIMITS.requirementText)
    strings(item, 'acceptance', `${path}.acceptance`, LIMITS.acceptance)
    const reqStatus = item.status === undefined ? 'planned' : string(item, 'status', `${path}.status`)
    if (!REQUIREMENT_STATUSES.includes(reqStatus)) add('invalid_enum', `${path}.status`, `status must be one of ${REQUIREMENT_STATUSES.join(', ')}`)
    string(item, 'reason', `${path}.reason`, false, LIMITS.reason)
  }
  unique(requirements, 'requirements')

  // architecture components
  const componentIds = new Set()
  const components = []
  const architecture = object(raw, 'architecture', 'architecture')
  if (architecture !== null) {
    keys(architecture, 'architecture', ['contractImpact', 'components'])
    const impact = architecture.contractImpact === undefined ? '' : string(architecture, 'contractImpact', 'architecture.contractImpact')
    if (impact !== '' && !CONTRACT_CHANGES.includes(impact)) add('invalid_enum', 'architecture.contractImpact', `contractImpact must be one of ${CONTRACT_CHANGES.join(', ')} or empty`)
    const rows = list(architecture, 'components', 'architecture.components')
    for (let at = 0; at < rows.length; at += 1) {
      const path = `architecture.components[${at}]`
      const item = keys(rows[at], path, ['id', 'name', 'responsibility', 'owner', 'owns', 'dependsOn'])
      if (item === null) continue
      const id = string(item, 'id', `${path}.id`, true)
      if (id !== '') componentIds.add(id)
      string(item, 'name', `${path}.name`, false, LIMITS.name)
      string(item, 'responsibility', `${path}.responsibility`, false, LIMITS.responsibility)
      string(item, 'owner', `${path}.owner`, false, LIMITS.owner)
      const owns = strings(item, 'owns', `${path}.owns`)
      const dependsOn = strings(item, 'dependsOn', `${path}.dependsOn`)
      components.push({ id, owns, dependsOn })
    }
    unique(rows, 'architecture.components')
  }

  // data
  const dataIds = new Set()
  const dataItems = []
  const dataRows = list(raw, 'data', 'data')
  for (let at = 0; at < dataRows.length; at += 1) {
    const path = `data[${at}]`
    const item = keys(dataRows[at], path, ['id', 'name', 'owner', 'ownerComponentId', 'description'])
    if (item === null) continue
    const id = string(item, 'id', `${path}.id`, true)
    if (id !== '') dataIds.add(id)
    string(item, 'name', `${path}.name`, false, LIMITS.name)
    string(item, 'owner', `${path}.owner`, false, LIMITS.owner)
    const ownerComponentId = string(item, 'ownerComponentId', `${path}.ownerComponentId`, false, LIMITS.ownerComponentId)
    string(item, 'description', `${path}.description`, false, LIMITS.description)
    dataItems.push({ id, ownerComponentId })
  }
  unique(dataRows, 'data')

  // contracts: removed is deliberately not an enum value.
  const contractIds = new Set()
  const contracts = list(raw, 'contracts', 'contracts')
  for (let at = 0; at < contracts.length; at += 1) {
    const path = `contracts[${at}]`
    const item = keys(contracts[at], path, ['id', 'name', 'between', 'change', 'description'])
    if (item === null) continue
    const id = string(item, 'id', `${path}.id`, true)
    if (id !== '') contractIds.add(id)
    string(item, 'name', `${path}.name`, false, LIMITS.name)
    strings(item, 'between', `${path}.between`)
    const change = string(item, 'change', `${path}.change`, true)
    if (change === 'removed') {
      add('invalid_enum', `${path}.change`, 'change:"removed" is not supported; use change:"breaking" and describe the removal in description')
    } else if (change !== '' && !CONTRACT_CHANGES.includes(change)) {
      add('invalid_enum', `${path}.change`, `change must be one of ${CONTRACT_CHANGES.join(', ')}`)
    }
    string(item, 'description', `${path}.description`, false, LIMITS.description)
  }
  unique(contracts, 'contracts')

  // invariants
  const invariants = list(raw, 'invariants', 'invariants')
  for (let at = 0; at < invariants.length; at += 1) {
    const path = `invariants[${at}]`
    const item = keys(invariants[at], path, ['id', 'text', 'scope'])
    if (item === null) continue
    string(item, 'id', `${path}.id`, true)
    string(item, 'text', `${path}.text`, true, LIMITS.invariantText)
    string(item, 'scope', `${path}.scope`, false, LIMITS.invariantScope)
  }
  unique(invariants, 'invariants')

  // decisions
  const decisions = list(raw, 'decisions', 'decisions')
  for (let at = 0; at < decisions.length; at += 1) {
    const path = `decisions[${at}]`
    const item = keys(decisions[at], path, ['id', 'decision', 'rationale', 'alternatives'])
    if (item === null) continue
    string(item, 'id', `${path}.id`, true)
    string(item, 'decision', `${path}.decision`, true, LIMITS.decision)
    string(item, 'rationale', `${path}.rationale`, true, LIMITS.rationale)
    strings(item, 'alternatives', `${path}.alternatives`, LIMITS.alternatives)
  }
  unique(decisions, 'decisions')

  // openQuestions
  const questions = list(raw, 'openQuestions', 'openQuestions')
  for (let at = 0; at < questions.length; at += 1) {
    const path = `openQuestions[${at}]`
    const item = keys(questions[at], path, ['id', 'question', 'owner', 'blocks', 'answer'])
    if (item === null) continue
    string(item, 'id', `${path}.id`, true)
    string(item, 'question', `${path}.question`, true, LIMITS.question)
    string(item, 'owner', `${path}.owner`, false, LIMITS.owner)
    if (item.blocks !== undefined && typeof item.blocks !== 'boolean') add('invalid_type', `${path}.blocks`, 'must be a boolean')
    string(item, 'answer', `${path}.answer`, false, LIMITS.answer)
  }
  unique(questions, 'openQuestions')

  // sizing
  const sizing = object(raw, 'sizing', 'sizing')
  if (sizing !== null) {
    keys(sizing, 'sizing', ['class', 'reasons'])
    const klass = sizing.class === undefined || sizing.class === null ? '' : string(sizing, 'class', 'sizing.class')
    if (klass !== '' && !CHANGE_CLASSES.includes(klass)) add('invalid_enum', 'sizing.class', `class must be one of ${CHANGE_CLASSES.join(', ')}`)
    strings(sizing, 'reasons', 'sizing.reasons', LIMITS.sizingReasons)
  }

  // designRef: mapRev is the drift key; at is a validated timestamp when supplied.
  const designRef = object(raw, 'designRef', 'designRef')
  if (designRef !== null) {
    keys(designRef, 'designRef', ['mapRev', 'at', 'source'])
    if (!Number.isSafeInteger(designRef.mapRev) || designRef.mapRev < 0) add('invalid_type', 'designRef.mapRev', 'must be a non-negative integer')
    const at = string(designRef, 'at', 'designRef.at')
    if (at !== '' && Number.isNaN(Date.parse(at))) add('invalid_timestamp', 'designRef.at', 'must be a parseable ISO timestamp')
    string(designRef, 'source', 'designRef.source')
  }

  // goalId / goalHistory
  string(raw, 'goalId', 'goalId', false, LIMITS.goalId)
  strings(raw, 'goalHistory', 'goalHistory', LIMITS.goalHistory)

  // trace
  const trace = list(raw, 'trace', 'trace')
  for (let at = 0; at < trace.length; at += 1) {
    const path = `trace[${at}]`
    const item = keys(trace[at], path, ['requirementId', 'processId', 'componentId', 'contractIds', 'dataIds', 'status', 'tasks', 'reason'])
    if (item === null) continue
    const requirementId = string(item, 'requirementId', `${path}.requirementId`, true)
    if (requirementId !== '' && !requirementIds.has(requirementId)) add('invalid_reference', `${path}.requirementId`, `unknown requirementId "${requirementId}"`)
    const processId = string(item, 'processId', `${path}.processId`)
    if (processId !== '' && !processIds.has(processId)) add('invalid_reference', `${path}.processId`, `unknown processId "${processId}"`)
    const componentId = string(item, 'componentId', `${path}.componentId`)
    if (componentId !== '' && !componentIds.has(componentId)) add('invalid_reference', `${path}.componentId`, `unknown componentId "${componentId}"`)
    for (const id of strings(item, 'contractIds', `${path}.contractIds`)) {
      if (!contractIds.has(id)) add('invalid_reference', `${path}.contractIds`, `unknown contract id "${id}"`)
    }
    for (const id of strings(item, 'dataIds', `${path}.dataIds`)) {
      if (!dataIds.has(id)) add('invalid_reference', `${path}.dataIds`, `unknown data id "${id}"`)
    }
    const traceStatus = item.status === undefined ? 'planned' : string(item, 'status', `${path}.status`)
    if (!TRACE_STATUSES.includes(traceStatus)) add('invalid_enum', `${path}.status`, `status must be one of ${TRACE_STATUSES.join(', ')}`)
    string(item, 'reason', `${path}.reason`, false, LIMITS.reason)
    const tasks = list(item, 'tasks', `${path}.tasks`)
    for (let taskAt = 0; taskAt < tasks.length; taskAt += 1) {
      const taskPath = `${path}.tasks[${taskAt}]`
      const task = keys(tasks[taskAt], taskPath, ['taskId', 'role', 'at', 'evidence'])
      if (task === null) continue
      string(task, 'taskId', `${taskPath}.taskId`, true)
      string(task, 'role', `${taskPath}.role`, false, LIMITS.taskRole)
      string(task, 'at', `${taskPath}.at`)
      strings(task, 'evidence', `${taskPath}.evidence`, LIMITS.evidence)
    }
  }

  // ownership: data.ownerComponentId is canonical, component.owns is legacy input/projection.
  for (const component of components) {
    for (const owned of component.owns) {
      if (!dataIds.has(owned)) add('invalid_reference', `architecture.components[${components.indexOf(component)}].owns`, `unknown owned data "${owned}"`)
    }
    for (const dependency of component.dependsOn) {
      if (!componentIds.has(dependency)) add('invalid_reference', `architecture.components[${components.indexOf(component)}].dependsOn`, `unknown dependency "${dependency}"`)
    }
  }
  for (const data of dataItems) {
    const legacyOwners = components.filter((component) => component.owns.includes(data.id)).map((component) => component.id)
    if (data.ownerComponentId !== '' && !componentIds.has(data.ownerComponentId)) {
      add('invalid_reference', `data[${dataItems.indexOf(data)}].ownerComponentId`, `unknown component id "${data.ownerComponentId}"`)
    }
    if (data.ownerComponentId !== '' && legacyOwners.length > 0 && (legacyOwners.length !== 1 || legacyOwners[0] !== data.ownerComponentId)) {
      add('ownership_conflict', `data[${dataItems.indexOf(data)}].ownerComponentId`, `data "${data.id}" says ownerComponentId "${data.ownerComponentId}" but legacy owns says ${legacyOwners.join(', ')}`)
    }
    if (data.ownerComponentId === '' && legacyOwners.length > 1 && options.allowAmbiguousOwnership !== true) {
      add('ownership_ambiguous', `data[${dataItems.indexOf(data)}].id`, `data "${data.id}" has multiple legacy owners: ${legacyOwners.join(', ')}`)
    }
  }

  return { ok: findings.length === 0, findings }
}

/** Validate and normalize one stored document. Throws AnalysisError on a structural defect. */
export function normalizeRecord(raw, initiative, options = {}) {
  const input = objectAt(raw, 'record')
  if (input.id !== undefined && asString(input.id) !== initiative) invalid(`id "${asString(input.id)}" does not match the file name "${initiative}"`, 'id')
  const process = input.process === undefined ? {} : objectAt(input.process, 'process')
  const current = normalizeProcessList(process.current, 'process.current')
  const target = normalizeProcessList(process.target, 'process.target')
  uniqueIds([...current, ...target], 'process')
  const record = {
    schemaVersion: SCHEMA_VERSION,
    id: initiative,
    rev: Number.isSafeInteger(input.rev) ? input.rev : 0,
    status: input.status === undefined ? 'draft' : asString(input.status),
    createdAt: asString(input.createdAt),
    updatedAt: asString(input.updatedAt),
    updatedBy: asString(input.updatedBy) || 'agent',
    title: asString(input.title),
    requestedSolution: asString(input.requestedSolution),
    businessOutcome: normalizeBusinessOutcome(input.businessOutcome),
    process: { current, target },
    requirements: normalizeRequirements(input.requirements),
    architecture: normalizeArchitecture(input.architecture),
    data: normalizeData(input.data),
    contracts: normalizeContracts(input.contracts),
    invariants: normalizeInvariants(input.invariants),
    decisions: normalizeDecisions(input.decisions),
    openQuestions: normalizeOpenQuestions(input.openQuestions),
    sizing: normalizeSizing(input.sizing),
    designRef: normalizeDesignRef(input.designRef),
    goalId: asString(input.goalId),
    goalHistory: [...new Set(asStringArray(input.goalHistory))],
    trace: normalizeTrace(input.trace),
    pendingImpacts: normalizeImpacts(input.pendingImpacts),
    fingerprint: asString(input.fingerprint),
    history: Array.isArray(input.history) ? input.history.slice(-50) : [],
  }
  if (!RECORD_STATUSES.includes(record.status)) invalid(`status must be one of ${RECORD_STATUSES.join(', ')}`, 'status')
  // Referential integrity is structural: a trace row that points at nothing is a broken
  // document, not a completeness finding, because no later check can decide what it meant.
  const requirementIds = new Set(record.requirements.map((entry) => entry.id))
  const processIds = new Set([...current, ...target].map((entry) => entry.id))
  const componentIds = new Set(record.architecture.components.map((entry) => entry.id))
  const contractIds = new Set(record.contracts.map((entry) => entry.id))
  const dataIds = new Set(record.data.map((entry) => entry.id))
  for (let at = 0; at < record.trace.length; at += 1) {
    const row = record.trace[at]
    if (!requirementIds.has(row.requirementId)) invalid(`unknown requirementId "${row.requirementId}"`, `trace[${at}].requirementId`)
    if (row.processId !== '' && !processIds.has(row.processId)) invalid(`unknown processId "${row.processId}"`, `trace[${at}].processId`)
    if (row.componentId !== '' && !componentIds.has(row.componentId)) invalid(`unknown componentId "${row.componentId}"`, `trace[${at}].componentId`)
    for (const id of row.contractIds) if (!contractIds.has(id)) invalid(`unknown contract id "${id}"`, `trace[${at}].contractIds`)
    for (const id of row.dataIds) if (!dataIds.has(id)) invalid(`unknown data id "${id}"`, `trace[${at}].dataIds`)
  }
  for (let at = 0; at < record.architecture.components.length; at += 1) {
    for (const dependency of record.architecture.components[at].dependsOn) {
      if (!componentIds.has(dependency)) invalid(`unknown dependency "${dependency}"`, `architecture.components[${at}].dependsOn`)
    }
    for (const owned of record.architecture.components[at].owns) {
      if (!dataIds.has(owned)) invalid(`unknown owned data "${owned}"`, `architecture.components[${at}].owns`)
    }
  }
  // data.ownerComponentId is canonical; components[].owns is legacy input and a derived
  // projection. A unique legacy owner migrates losslessly; a conflict or two owners is an
  // invalid record on WRITE (the aggregate validator reports it with the exact path). On
  // READ an older ambiguous record stays legible and byte-faithful, so it is not silently
  // assigned an owner and its stored fingerprint still matches.
  const ambiguous = record.data.some((data) => (data.ownerComponentId ?? '') === '' && record.architecture.components.filter((component) => component.owns.includes(data.id)).length > 1)
  if (options.allowAmbiguousOwnership === true && ambiguous) return record
  for (const data of record.data) {
    const legacyOwners = record.architecture.components
      .filter((component) => component.owns.includes(data.id))
      .map((component) => component.id)
    const canonicalOwner = data.ownerComponentId ?? ''
    if (canonicalOwner !== '' && !componentIds.has(canonicalOwner)) {
      invalid(`unknown ownerComponentId "${canonicalOwner}"`, `data[${record.data.indexOf(data)}].ownerComponentId`)
    }
    if (canonicalOwner !== '' && legacyOwners.length > 0 && (legacyOwners.length !== 1 || legacyOwners[0] !== canonicalOwner)) {
      invalid('canonical ownerComponentId contradicts legacy owns', `data[${record.data.indexOf(data)}].ownerComponentId`)
    }
    if (canonicalOwner === '' && legacyOwners.length > 1) {
      invalid('legacy owns has more than one owner', `data[${record.data.indexOf(data)}].id`)
    }
    if (canonicalOwner === '' && legacyOwners.length === 1) data.ownerComponentId = legacyOwners[0]
  }
  for (const component of record.architecture.components) {
    component.owns = record.data.filter((data) => (data.ownerComponentId ?? '') === component.id).map((data) => data.id)
  }
  return record
}

/** A complete-enough record for a fresh initiative; every field is explicit. */
export function emptyRecord(initiative, at = new Date().toISOString()) {
  return normalizeRecord({
    schemaVersion: SCHEMA_VERSION,
    id: initiative,
    rev: 0,
    status: 'draft',
    createdAt: at,
    updatedAt: at,
    updatedBy: 'agent',
    title: '',
    requestedSolution: '',
    businessOutcome: {},
    process: { current: [], target: [] },
    requirements: [],
    architecture: { contractImpact: '', components: [] },
    data: [],
    contracts: [],
    invariants: [],
    decisions: [],
    openQuestions: [],
    sizing: {},
    designRef: null,
    goalId: '',
    goalHistory: [],
    trace: [],
    pendingImpacts: [],
    fingerprint: '',
    history: [],
  }, initiative)
}

function addFinding(findings, code, severity, path, message) {
  findings.push({ code, severity, path, message })
}

/**
 * Completeness: the part a shape validator cannot see.
 *
 * @param record - A normalized record.
 * @param context - `{ design, fingerprintMatches }`.
 * @returns `{ ok, findings, errors, warnings }` where `ok` means no error-severity finding.
 */
export function checkRecord(record, context = {}) {
  const findings = []
  if (asString(record.businessOutcome.problem) === '') addFinding(findings, 'missing_business_problem', 'error', 'businessOutcome.problem', 'state the business problem the initiative exists to solve')
  if (asString(record.businessOutcome.outcome) === '') addFinding(findings, 'missing_business_outcome', 'error', 'businessOutcome.outcome', 'state the business outcome, separate from the requested solution')
  if (record.requestedSolution === '') addFinding(findings, 'missing_requested_solution', 'error', 'requestedSolution', 'record what was asked for, separately from the business outcome')
  if (record.process.current.length === 0 && record.process.target.length === 0) addFinding(findings, 'missing_process', 'error', 'process', 'name the current and/or target process')
  if (record.architecture.components.length === 0) addFinding(findings, 'missing_architecture', 'error', 'architecture.components', 'name at least one component and who owns it')
  if (record.requirements.length === 0) addFinding(findings, 'missing_requirements', 'error', 'requirements', 'name at least one BR/FR/NFR requirement')
  if (record.sizing.class === '') addFinding(findings, 'missing_change_class', 'error', 'sizing.class', 'classify the change as L0, L1 or L2')
  if (record.designRef === null) addFinding(findings, 'missing_design_ref', 'error', 'designRef', 'the record must reference the design map revision it was written against')

  for (let at = 0; at < record.requirements.length; at += 1) {
    const requirement = record.requirements[at]
    const path = `requirements[${at}]`
    if (requirement.text === '') addFinding(findings, 'missing_requirement_text', 'error', `${path}.text`, 'state the requirement')
    if (requirement.acceptance.length === 0) addFinding(findings, 'missing_acceptance', 'error', `${path}.acceptance`, `requirement "${requirement.id}" has no acceptance criterion`)
    if ((requirement.status === 'deferred' || requirement.status === 'rejected') && asString(requirement.reason) === '') {
      addFinding(findings, 'deferred_without_reason', 'error', `${path}.reason`, `requirement "${requirement.id}" is ${requirement.status} without a reason`)
    }
    if (requirement.status === 'proven') {
      const rows = record.trace.filter((row) => row.requirementId === requirement.id)
      if (!rows.some((row) => row.status === 'proven')) addFinding(findings, 'proven_without_trace', 'error', path, `requirement "${requirement.id}" is proven but no trace row proves it`)
      for (const row of rows.filter((entry) => entry.status === 'proven')) {
        if (!row.tasks.some((task) => task.evidence.length > 0)) {
          addFinding(findings, 'proven_without_evidence', 'error', path, `requirement "${requirement.id}" is proven without task evidence`)
        }
      }
    }
  }

  for (let at = 0; at < record.architecture.components.length; at += 1) {
    const component = record.architecture.components[at]
    if (component.owner === '') addFinding(findings, 'missing_component_ownership', 'error', `architecture.components[${at}].owner`, `component "${component.id}" has no owner`)
  }
  for (let at = 0; at < record.data.length; at += 1) {
    const item = record.data[at]
    if (item.owner === '') addFinding(findings, 'missing_data_ownership', 'error', `data[${at}].owner`, `data "${item.id}" has no owner`)
    const legacyOwners = record.architecture.components.filter((component) => component.owns.includes(item.id))
    if ((item.ownerComponentId ?? '') === '' && legacyOwners.length > 1) {
      addFinding(findings, 'ownership_ambiguous_compat', 'warning', `data[${at}]`, `legacy data "${item.id}" has multiple owners (${legacyOwners.map((component) => component.id).join(', ')}); read-compatible, but resolve it to one ownerComponentId before editing`)
    }
  }
  if (record.architecture.contractImpact === '') {
    addFinding(findings, 'missing_contract_impact', 'error', 'architecture.contractImpact', 'state the contract impact, even when it is "none"')
  } else if (record.contracts.length === 0 && record.architecture.contractImpact !== 'none' && record.architecture.components.length > 0) {
    addFinding(findings, 'missing_contract_impact', 'error', 'contracts', 'declare a contract or set architecture.contractImpact to "none"')
  } else if (record.contracts.length > 0 && record.architecture.contractImpact === 'none') {
    addFinding(findings, 'contract_impact_contradiction', 'error', 'architecture.contractImpact', 'contracts are declared while contractImpact says "none"')
  }
  for (let at = 0; at < record.contracts.length; at += 1) {
    if (record.contracts[at].change === '') addFinding(findings, 'missing_contract_impact', 'error', `contracts[${at}].change`, `contract "${record.contracts[at].id}" has no impact verdict`)
  }

  const traced = new Set(record.trace.map((row) => row.requirementId))
  for (let at = 0; at < record.requirements.length; at += 1) {
    const requirement = record.requirements[at]
    if (traced.has(requirement.id)) continue
    // A deferred/rejected requirement is explicitly out of the build; everything else must
    // reach a process and a component before the record can be ready.
    if (requirement.status === 'deferred' || requirement.status === 'rejected') continue
    addFinding(findings, 'unresolved_trace', 'error', `requirements[${at}]`, `requirement "${requirement.id}" has no trace row to a process and component`)
  }
  for (let at = 0; at < record.trace.length; at += 1) {
    const row = record.trace[at]
    const path = `trace[${at}]`
    if (row.processId === '') addFinding(findings, 'unresolved_trace', 'error', `${path}.processId`, `trace for "${row.requirementId}" names no process`)
    if (row.componentId === '') addFinding(findings, 'unresolved_trace', 'error', `${path}.componentId`, `trace for "${row.requirementId}" names no component`)
    if (row.status === 'proven') {
      if (row.tasks.length === 0) addFinding(findings, 'proven_without_task', 'error', path, `trace for "${row.requirementId}" is proven with no task`)
      if (!row.tasks.some((task) => task.evidence.length > 0)) addFinding(findings, 'proven_without_evidence', 'error', path, `trace for "${row.requirementId}" is proven with no evidence`)
    }
    if (row.status === 'deferred' && asString(row.reason) === '') addFinding(findings, 'deferred_without_reason', 'error', `${path}.reason`, `trace for "${row.requirementId}" is deferred without a reason`)
  }

  for (let at = 0; at < record.openQuestions.length; at += 1) {
    const question = record.openQuestions[at]
    if (question.blocks && question.answer === '') addFinding(findings, 'unresolved_open_question', 'error', `openQuestions[${at}]`, `blocking question "${question.id}" has no answer`)
  }
  for (let at = 0; at < record.pendingImpacts.length; at += 1) {
    const impact = record.pendingImpacts[at]
    addFinding(findings, 'pending_impact', 'error', `pendingImpacts[${at}]`, `unresolved impact "${impact.id}" (${impact.change || impact.kind})`)
  }
  if (context.fingerprintMatches === false) {
    addFinding(findings, 'fingerprint_mismatch', 'error', 'fingerprint', 'the semantic contents no longer match the recorded fingerprint; the file was edited outside analysis_upsert')
  }
  if (context.legacyFingerprint === true) {
    addFinding(findings, 'legacy_fingerprint', 'warning', 'fingerprint', `the stored fingerprint matches the ${context.legacyVersion || 'legacy'} algorithm; the record is recognised as legacy, and the next analysis_upsert migrates it to the current schema`)
  }
  if (context?.design?.exists === true && record.designRef !== null && context.design.rev > record.designRef.mapRev) {
    // A moved map is a warning for ordinary work: only an architecture-affecting delegation
    // (or an explicit analysis_impact on the design) has to wait for the analysis to catch up.
    addFinding(findings, 'design_drift', 'warning', 'designRef', `the design map is at rev ${context.design.rev}, the record references ${record.designRef.mapRev}`)
  }
  const errors = findings.filter((finding) => finding.severity === 'error').length
  return { ok: errors === 0, findings, errors, warnings: findings.length - errors }
}

/**
 * Completion is a different question from readiness: every requirement has to be proven
 * with task+evidence, or explicitly deferred/rejected with a reason.
 */
export function completionOf(record, readiness = checkRecord(record)) {
  const counts = { total: record.requirements.length, proven: 0, deferred: 0, rejected: 0, planned: 0 }
  const findings = []
  for (const requirement of record.requirements) {
    counts[requirement.status] = (counts[requirement.status] ?? 0) + 1
    if (requirement.status === 'planned') {
      addFinding(findings, 'requirement_not_resolved', 'error', `requirements.${requirement.id}`, `requirement "${requirement.id}" is still planned; prove it or defer it explicitly`)
      continue
    }
    if (requirement.status === 'proven') {
      const rows = record.trace.filter((row) => row.requirementId === requirement.id)
      const proven = rows.filter((row) => row.status === 'proven')
      if (proven.length === 0) addFinding(findings, 'proven_without_trace', 'error', `requirements.${requirement.id}`, `requirement "${requirement.id}" is proven without a trace row`)
      if (!proven.some((row) => row.tasks.some((task) => task.evidence.length > 0))) {
        addFinding(findings, 'proven_without_evidence', 'error', `requirements.${requirement.id}`, `requirement "${requirement.id}" is proven without task evidence`)
      }
      for (const row of rows.filter((entry) => entry.status === 'planned' || entry.status === 'in_progress')) {
        addFinding(findings, 'trace_not_resolved', 'error', `trace.${requirement.id}`, `requirement "${requirement.id}" is proven but a trace row is still ${row.status}`)
      }
    }
    if ((requirement.status === 'deferred' || requirement.status === 'rejected') && asString(requirement.reason) === '') {
      addFinding(findings, 'deferred_without_reason', 'error', `requirements.${requirement.id}.reason`, `requirement "${requirement.id}" is ${requirement.status} without a reason`)
    }
  }
  const errors = findings.filter((finding) => finding.severity === 'error').length
  return {
    ok: readiness.ok && errors === 0,
    state: readiness.ok && errors === 0 ? 'complete' : 'in_progress',
    counts,
    findings,
    errors,
    message: readiness.ok && errors === 0
      ? `${counts.proven} proven, ${counts.deferred} deferred, ${counts.rejected} rejected`
      : 'the initiative is not finished: resolve the findings or defer each requirement explicitly',
  }
}

function normalizedInitiative(value) {
  const initiative = asString(value)
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(initiative)) {
    throw new AnalysisError('invalid_initiative', `initiative must be a kebab-case id (a-z, 0-9, '-', at most 64 chars), got ${JSON.stringify(value)}`)
  }
  return initiative
}

function mergePatch(current, patch) {
  const merged = JSON.parse(JSON.stringify(current))
  for (const key of Object.keys(patch)) {
    const value = patch[key]
    if (!PATCHABLE.has(key)) throw new AnalysisError('unknown_field', `patch field "${key}" is not part of the Analysis Record; allowed: ${[...PATCHABLE].join(', ')}`)
    if (OBJECT_PATCHES.has(key) && plainObject(value) && plainObject(merged[key])) merged[key] = { ...merged[key], ...value }
    else merged[key] = value
  }
  return merged
}

function requirementMap(requirements) {
  return new Map(requirements.map((requirement) => [requirement.id, requirement]))
}

function requirementChanges(before, after) {
  const previous = requirementMap(before)
  const next = requirementMap(after)
  const changes = []
  for (const requirement of after) {
    if (!previous.has(requirement.id)) changes.push({ id: requirement.id, kind: 'added' })
    else if (requirementSpecHash(previous.get(requirement.id)) !== requirementSpecHash(requirement)) changes.push({ id: requirement.id, kind: 'changed' })
  }
  for (const requirement of before) {
    if (!next.has(requirement.id)) changes.push({ id: requirement.id, kind: 'removed' })
  }
  return changes
}

/**
 * The non-requirement semantic shape. A changed process, decision or open question is as
 * much a change to the analysis as a new component or a breaking contract, so any of them
 * reopens a ready record. Requirements and designRef are handled separately.
 */
function architectureHash(record) {
  return createHash('sha256')
    .update(JSON.stringify(canonical({
      title: record.title,
      requestedSolution: record.requestedSolution,
      businessOutcome: record.businessOutcome,
      process: record.process,
      architecture: record.architecture,
      data: record.data,
      contracts: record.contracts,
      invariants: record.invariants,
      decisions: record.decisions,
      openQuestions: record.openQuestions,
      sizing: record.sizing,
      traceMap: traceMappingOf(record),
    })))
    .digest('hex')
}

function affectedOf(record, input) {
  const affected = {
    requirementIds: new Set(), processIds: new Set(), componentIds: new Set(),
    contractIds: new Set(), dataIds: new Set(), taskIds: new Set(), global: false,
  }
  const kind = asString(input.kind) || 'requirement'
  const targetId = asString(input.targetId)
  const requirementId = asString(input.requirementId)
  let rows = record.trace
  if (requirementId !== '') {
    rows = rows.filter((row) => row.requirementId === requirementId)
    affected.requirementIds.add(requirementId)
  } else if (targetId === '' || kind === 'architecture' || kind === 'design') {
    affected.global = true
  } else if (kind === 'component') {
    affected.componentIds.add(targetId)
    for (const component of record.architecture.components) {
      if (component.dependsOn.includes(targetId)) affected.componentIds.add(component.id)
    }
    for (const data of record.data) {
      const owner = record.architecture.components.find((component) => component.owns.includes(data.id))
      if (owner !== undefined && affected.componentIds.has(owner.id)) affected.dataIds.add(data.id)
    }
    for (const contract of record.contracts) {
      if (contract.between.includes(targetId) || contract.between.some((id) => affected.componentIds.has(id))) affected.contractIds.add(contract.id)
    }
    rows = rows.filter((row) => affected.componentIds.has(row.componentId))
  } else if (kind === 'contract') {
    affected.contractIds.add(targetId)
    const contract = record.contracts.find((entry) => entry.id === targetId)
    for (const id of contract?.between ?? []) affected.componentIds.add(id)
    rows = rows.filter((row) => row.contractIds.includes(targetId) || affected.componentIds.has(row.componentId))
  } else if (kind === 'data') {
    affected.dataIds.add(targetId)
    const owner = record.architecture.components.find((component) => component.owns.includes(targetId))
    if (owner !== undefined) affected.componentIds.add(owner.id)
    rows = rows.filter((row) => row.dataIds.includes(targetId) || affected.componentIds.has(row.componentId))
  } else if (kind === 'invariant') {
    affected.global = true
  } else {
    affected.global = true
  }
  for (const row of rows) {
    affected.requirementIds.add(row.requirementId)
    if (row.processId !== '') affected.processIds.add(row.processId)
    if (row.componentId !== '') affected.componentIds.add(row.componentId)
    for (const id of row.contractIds) affected.contractIds.add(id)
    for (const id of row.dataIds) affected.dataIds.add(id)
    for (const task of row.tasks) affected.taskIds.add(task.taskId)
  }
  if (affected.requirementIds.size === 0) {
    for (const requirement of record.requirements) affected.requirementIds.add(requirement.id)
  }
  return {
    requirementIds: [...affected.requirementIds].sort(),
    processIds: [...affected.processIds].sort(),
    componentIds: [...affected.componentIds].sort(),
    contractIds: [...affected.contractIds].sort(),
    dataIds: [...affected.dataIds].sort(),
    taskIds: [...affected.taskIds].sort(),
    global: affected.global,
  }
}

/**
 * Create the service over one workspace.
 *
 * @param config - `{ dir, designMapFile, historyLimit }`.
 * @param logger - Optional logger; failures never depend on it.
 */
export function createService(config = {}, logger = undefined) {
  const dirName = asString(config.dir) || 'docs/analysis'
  const designMapFile = asString(config.designMapFile) || 'design.excalidraw'
  const historyLimit = Number.isSafeInteger(config.historyLimit) && config.historyLimit > 0 ? config.historyLimit : 50
  const storeDir = (cwd) => (isAbsolute(dirName) ? dirName : resolve(cwd, dirName))
  const recordPath = (cwd, initiative) => join(storeDir(cwd), `${initiative}.json`)
  const timestamp = () => new Date().toISOString()

  const designOf = (cwd) => {
    const path = isAbsolute(designMapFile) ? designMapFile : resolve(cwd, designMapFile)
    if (!existsSync(path)) return { exists: false, rev: 0, path }
    try {
      const scene = JSON.parse(readFileSync(path, 'utf8'))
      const rev = scene?.designMap?.rev
      return { exists: true, rev: Number.isSafeInteger(rev) && rev >= 0 ? rev : 0, path }
    } catch {
      // A broken scene is the design map's own problem; the analysis does not pretend it moved.
      return { exists: true, rev: 0, path, error: 'malformed design map' }
    }
  }

  const load = (cwd, initiative) => {
    const path = recordPath(cwd, initiative)
    if (!existsSync(path)) return { exists: false, ok: true, path }
    let raw
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      return { exists: true, ok: false, code: 'malformed', message: `${path} is not readable JSON: ${error.message}`, path }
    }
    // Reading never writes, so content limits are not enforced here: a record stored by an
    // earlier version (or before a limit existed) stays legible rather than becoming
    // unreadable. Every WRITE path validates with the limits enforced.
    const validation = validateStrict(raw, { allowAmbiguousOwnership: true, requireContent: false, enforceLimits: false })
    if (!validation.ok) {
      return { exists: true, ok: false, code: 'invalid_record', message: validation.findings[0]?.message ?? 'invalid record', findings: validation.findings, path }
    }
    try {
      const record = normalizeRecord(raw, initiative, { allowAmbiguousOwnership: true })
      return {
        exists: true,
        ok: true,
        record,
        path,
        fingerprint: fingerprintStatusOf(record),
        ambiguousOwnership: ambiguousOwnershipOf(record),
      }
    } catch (error) {
      return { exists: true, ok: false, code: error?.code ?? 'invalid_record', message: error?.message ?? String(error), path }
    }
  }

  const write = (path, record) => {
    mkdirSync(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    renameSync(temp, path)
  }

  const staleOf = (record, design, fingerprintState) => {
    if (!fingerprintState.matches) return { code: 'fingerprint_mismatch', message: 'the semantic contents no longer match the recorded fingerprint' }
    if (record.pendingImpacts.length > 0) {
      return { code: 'pending_impact', message: `${record.pendingImpacts.length} unresolved impact(s): ${record.pendingImpacts.map((impact) => impact.id || impact.change).join(', ')}` }
    }
    if (design.exists && record.designRef !== null && design.rev > record.designRef.mapRev) {
      return { code: 'design_drift', message: `the design map moved to rev ${design.rev}, the record references ${record.designRef.mapRev}` }
    }
    return null
  }

  const describe = (record, design, fingerprintState = fingerprintStatusOf(record)) => {
    const fingerprintMatches = fingerprintState.matches
    const check = checkRecord(record, { design, fingerprintMatches, legacyFingerprint: fingerprintState.legacy, legacyVersion: fingerprintState.version })
    const completion = completionOf(record, check)
    return {
      rev: record.rev,
      status: record.status,
      updatedAt: record.updatedAt,
      fingerprint: record.fingerprint,
      fingerprintMatches,
      legacyFingerprint: fingerprintState.legacy ? { recognized: true, version: fingerprintState.version } : null,
      stale: staleOf(record, design, fingerprintState),
      design: { currentRev: design.rev, designRefRev: record.designRef?.mapRev ?? null, drift: record.designRef !== null && design.rev > record.designRef.mapRev },
      readiness: check,
      check,
      completion,
    }
  }

  const read = (cwd, input = {}) => {
    const initiative = normalizedInitiative(input.initiative)
    const loaded = load(cwd, initiative)
    if (!loaded.ok) return { ok: false, code: loaded.code, message: loaded.message }
    if (!loaded.exists) return { ok: true, exists: false, initiative }
    const design = designOf(cwd)
    return {
      ok: true,
      exists: true,
      initiative,
      record: loaded.record,
      ambiguousOwnership: loaded.ambiguousOwnership === true,
      ...describe(loaded.record, design, loaded.fingerprint),
    }
  }

  const list = (cwd) => {
    const path = storeDir(cwd)
    if (!existsSync(path)) return { ok: true, records: [] }
    const records = []
    for (const name of readdirSync(path).filter((entry) => entry.endsWith('.json')).sort()) {
      const initiative = name.slice(0, -'.json'.length)
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(initiative)) continue
      const loaded = load(cwd, initiative)
      if (!loaded.ok) {
        records.push({ id: initiative, ok: false, code: loaded.code, message: loaded.message })
        continue
      }
      records.push({
        id: initiative,
        ok: true,
        rev: loaded.record.rev,
        status: loaded.record.status,
        class: loaded.record.sizing.class,
        title: loaded.record.title,
        updatedAt: loaded.record.updatedAt,
        legacyFingerprint: loaded.fingerprint?.legacy === true ? { recognized: true, version: loaded.fingerprint.version } : null,
        ambiguousOwnership: loaded.ambiguousOwnership === true,
        stale: staleOf(loaded.record, designOf(cwd), loaded.fingerprint ?? { matches: false }),
      })
    }
    return { ok: true, records }
  }

  /**
   * Independent readiness findings for a structurally invalid patch. Structural and semantic
   * defects are reported in the SAME response, but a semantic finding inside a structurally
   * broken subtree is dropped: it is a cascade of that defect, not new information.
   */
  const independentSemanticFindings = (cwd, merged, structural) => {
    let normalized
    try {
      normalized = normalizeRecord(merged, merged.id)
    } catch {
      return []
    }
    const check = checkRecord(normalized, { design: designOf(cwd), fingerprintMatches: true })
    const broken = structural.map((finding) => finding.path).filter((path) => typeof path === 'string' && path !== '')
    const suppressed = (path) => broken.some((prefix) => path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`))
    const seen = new Set(structural.map((finding) => `${finding.code}@${finding.path}`))
    const extra = []
    for (const finding of check.findings) {
      if (finding.severity !== 'error' || finding.code === 'fingerprint_mismatch') continue
      if (suppressed(finding.path)) continue
      const key = `${finding.code}@${finding.path}`
      if (seen.has(key)) continue
      seen.add(key)
      extra.push({ ...finding, source: 'semantic' })
    }
    return extra
  }

  const upsert = (cwd, input = {}) => {
    const initiative = normalizedInitiative(input.initiative)
    const loaded = load(cwd, initiative)
    if (loaded.exists && !loaded.ok) return { ok: false, code: loaded.code, message: loaded.message }
    const exists = loaded.exists === true
    const fingerprintState = loaded.fingerprint ?? { matches: false, legacy: false, version: '' }
    const current = exists ? loaded.record : emptyRecord(initiative, timestamp())
    if (exists) {
      if (!Number.isSafeInteger(input.expectedRev)) return { ok: false, code: 'needs_revision', currentRev: current.rev, message: `an edit of "${initiative}" needs the expectedRev it read (current rev ${current.rev})` }
      if (input.expectedRev !== current.rev) return { ok: false, code: 'stale', currentRev: current.rev, message: `expected rev ${input.expectedRev}, the record is at rev ${current.rev}` }
    } else if (input.expectedRev !== undefined && input.expectedRev !== null && input.expectedRev !== 0) {
      return { ok: false, code: 'needs_revision', currentRev: 0, message: `"${initiative}" does not exist yet; create it without expectedRev or with 0` }
    }
    // A hand edit must be acknowledged, not silently blessed by the next write. A fingerprint
    // written by a known earlier version is NOT a hand edit: it is recognised as legacy and
    // this write migrates it (history action "migrate").
    if (exists && fingerprintState.matches !== true && input.acceptHandEdit !== true) {
      return {
        ok: false,
        code: 'fingerprint_mismatch',
        currentRev: current.rev,
        message: `"${initiative}" was edited outside analysis_upsert (semantic fingerprint mismatch). Inspect it, then pass acceptHandEdit: true to record the acknowledgement before any other edit.`,
      }
    }
    const patch = input.patch === undefined ? {} : input.patch
    if (!plainObject(patch)) return { ok: false, code: 'invalid_patch', message: 'patch must be an object' }
    let merged
    try {
      merged = mergePatch(current, patch)
    } catch (error) {
      return { ok: false, code: error?.code ?? 'invalid_record', message: error?.message ?? String(error) }
    }
    // A trace row that omits `tasks` keeps the links it already has: updating a status or a
    // process mapping must not erase the task -> evidence trace as a side effect.
    if (Array.isArray(patch.trace)) {
      const oldTasks = new Map()
      for (const row of current.trace) {
        const list = oldTasks.get(row.requirementId) ?? []
        oldTasks.set(row.requirementId, [...list, ...row.tasks])
      }
      merged.trace = merged.trace.map((row) => {
        if (row === null || typeof row !== 'object' || row.tasks !== undefined) return row
        const inherited = oldTasks.get(row.requirementId)
        return inherited === undefined ? row : { ...row, tasks: inherited }
      })
    }
    const now = timestamp()
    merged.id = initiative
    merged.schemaVersion = SCHEMA_VERSION
    merged.rev = current.rev + 1
    merged.createdAt = exists ? current.createdAt || now : now
    merged.updatedAt = now
    merged.updatedBy = input.by === 'human' ? 'human' : 'agent'
    merged.pendingImpacts = current.pendingImpacts
    merged.history = current.history
    const validation = validateStrict(merged)
    if (!validation.ok) {
      // Structural and SEMANTIC findings come back in one response. A semantic finding that
      // sits inside a structurally broken subtree is suppressed: it is a cascade of the same
      // defect, not independent information.
      const findings = [...validation.findings, ...independentSemanticFindings(cwd, merged, validation.findings)]
      return {
        ok: false,
        code: 'invalid_record',
        currentRev: current.rev,
        findings,
        message: `"${initiative}" has ${findings.length} validation finding(s); first: ${findings[0].path}: ${findings[0].message}`,
      }
    }
    let next
    try {
      next = normalizeRecord(merged, initiative)
    } catch (error) {
      return { ok: false, code: error?.code ?? 'invalid_record', message: error?.message ?? String(error) }
    }

    // goalId is a commitment, not a label: a linked record cannot be detached or relinked
    // while it is ready/completed, because that would let goal completion skip the gate.
    if (exists && current.goalId !== next.goalId) {
      if (current.goalId !== '' && (current.status === 'ready' || current.status === 'completed') && patch.status !== 'completed') {
        return {
          ok: false,
          code: 'goal_link_locked',
          currentRev: current.rev,
          message: `"${initiative}" is linked to goal "${current.goalId}" and is ${current.status}; complete it (or reopen it deliberately) before changing goalId.`,
        }
      }
      if (current.goalId !== '') next.goalHistory = [...new Set([...next.goalHistory, current.goalId])].slice(-50)
    }

    // A semantic change on a ready/completed record is a mid-work change: record the impact
    // immediately so the next delegation cannot silently use the old analysis. ADDED and
    // REMOVED requirements count, not only an edited one; so do process/architecture/data/
    // contract/invariant/decision/open-question edits and a moved designRef.
    const changes = exists ? requirementChanges(current.requirements, next.requirements) : []
    for (const change of changes) {
      if (change.kind !== 'removed') continue
      const tracedTasks = current.trace
        .filter((row) => row.requirementId === change.id)
        .flatMap((row) => row.tasks)
      if (tracedTasks.length > 0) {
        return {
          ok: false,
          code: 'requirement_has_tasks',
          currentRev: current.rev,
          message: `requirement "${change.id}" still has ${tracedTasks.length} traced task(s); removing it would erase the task trace. Mark it rejected or deferred with a reason instead.`,
        }
      }
    }
    // Removing a task link from a ready record is the same kind of erasure as removing a
    // requirement that still has tasks: refuse it, so task_close cannot be re-opened by
    // rewriting the trace.
    const oldTaskIds = new Set(current.trace.flatMap((row) => row.tasks.map((task) => task.taskId)))
    for (const row of next.trace) for (const task of row.tasks) oldTaskIds.delete(task.taskId)
    if (exists && oldTaskIds.size > 0) {
      return {
        ok: false,
        code: 'trace_task_removal',
        currentRev: current.rev,
        message: `the trace still links task(s) ${[...oldTaskIds].join(', ')}; removing a task link from a ${current.status} record is refused. Update the requirement status or evidence instead.`,
      }
    }
    const semanticImpacts = []
    if (exists && (current.status === 'ready' || current.status === 'completed')) {
      for (const change of changes) {
        semanticImpacts.push({
          kind: 'requirement',
          requirementId: change.id,
          change: `requirement "${change.id}" ${change.kind} in analysis_upsert`,
          affected: affectedOf(current, { requirementId: change.id }),
        })
      }
      if (architectureHash(current) !== architectureHash(next)) {
        semanticImpacts.push({
          kind: 'architecture',
          requirementId: '',
          change: 'semantic shape changed in analysis_upsert (process/business outcome/architecture/data/contracts/invariants/decisions/open questions/sizing)',
          affected: affectedOf(current, { kind: 'architecture' }),
        })
      }
      const previousMapRev = current.designRef?.mapRev ?? null
      const nextMapRev = next.designRef?.mapRev ?? null
      if (previousMapRev !== null && nextMapRev !== null && previousMapRev !== nextMapRev) {
        semanticImpacts.push({
          kind: 'design',
          requirementId: '',
          change: `designRef moved from rev ${previousMapRev} to ${nextMapRev} in analysis_upsert`,
          affected: affectedOf(current, { kind: 'design' }),
        })
      }
    }
    if (semanticImpacts.length > 0) {
      for (const impact of semanticImpacts) {
        next.pendingImpacts.push({
          id: `impact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          at: now,
          source: 'upsert',
          kind: impact.kind,
          requirementId: impact.requirementId,
          targetId: '',
          change: impact.change,
          status: 'pending',
          affected: impact.affected,
        })
      }
      if (patch.status === undefined) next.status = 'draft'
    }
    if (input.resolveImpacts !== undefined) {
      if (input.resolveImpacts === 'all') next.pendingImpacts = []
      else if (Array.isArray(input.resolveImpacts)) {
        const ids = new Set(asStringArray(input.resolveImpacts))
        const known = new Set(next.pendingImpacts.map((impact) => impact.id))
        const unknown = [...ids].filter((id) => !known.has(id))
        if (unknown.length > 0) return { ok: false, code: 'unknown_impact', message: `no pending impact with id ${unknown.join(', ')}` }
        next.pendingImpacts = next.pendingImpacts.filter((impact) => !ids.has(impact.id))
      } else {
        return { ok: false, code: 'invalid_resolve', message: "resolveImpacts must be 'all' or an array of impact ids" }
      }
    }
    const design = designOf(cwd)
    if (next.status === 'ready' && next.designRef === null) {
      next.designRef = { mapRev: design.rev, at: now, source: designMapFile }
    }
    if (next.designRef !== null && next.designRef.at === '') next.designRef.at = now
    next.fingerprint = fingerprintOf(next)
    const readiness = checkRecord(next, { design, fingerprintMatches: true })
    const completion = completionOf(next, readiness)
    if (next.status === 'ready' && !readiness.ok) {
      return { ok: false, code: 'analysis_incomplete', currentRev: current.rev, findings: readiness.findings, message: `"${initiative}" cannot be ready: ${readiness.errors} error(s), first: ${readiness.findings.find((finding) => finding.severity === 'error')?.message ?? 'unknown'}` }
    }
    if (next.status === 'completed' && !completion.ok) {
      return { ok: false, code: 'completion_blocked', currentRev: current.rev, findings: [...readiness.findings, ...completion.findings], message: `"${initiative}" cannot be completed: ${completion.findings.find((finding) => finding.severity === 'error')?.message ?? completion.message}` }
    }
    const migrating = exists && fingerprintState.legacy === true
    next.history = [...next.history, {
      revision: next.rev,
      at: now,
      editedBy: next.updatedBy,
      action: migrating ? 'migrate' : (exists ? 'upsert' : 'create'),
      status: next.status,
      summary: migrating
        ? `migrated the ${fingerprintState.version} semantic fingerprint to the current schema${semanticImpacts.length > 0 ? `; impacts: ${semanticImpacts.length}` : ''}`
        : (input.acceptHandEdit === true
          ? 'accepted a hand edit'
          : (changes.length > 0
            ? `requirements: ${changes.map((change) => `${change.id} ${change.kind}`).join(', ')}${semanticImpacts.length > 0 ? `; impacts: ${semanticImpacts.length}` : ''}`
            : (semanticImpacts.length > 0 ? `impacts: ${semanticImpacts.length}` : ''))),
    }].slice(-historyLimit)
    write(loaded.path, next)
    return {
      ok: true,
      created: !exists,
      rev: next.rev,
      record: next,
      readiness: checkRecord(next, { design, fingerprintMatches: true }),
      check: checkRecord(next, { design, fingerprintMatches: true }),
      completion: completionOf(next, checkRecord(next, { design, fingerprintMatches: true })),
    }
  }

  const check = (cwd, input = {}) => {
    const initiative = normalizedInitiative(input.initiative)
    const loaded = load(cwd, initiative)
    if (!loaded.ok) return { ok: false, code: loaded.code, message: loaded.message }
    if (!loaded.exists) return { ok: false, code: 'analysis_required', message: `no Analysis Record "${initiative}" in ${storeDir(cwd)}` }
    const design = designOf(cwd)
    const described = describe(loaded.record, design)
    const forCompletion = input.forCompletion === true
    const findings = forCompletion ? [...described.check.findings, ...described.completion.findings] : described.check.findings
    return {
      ok: forCompletion ? described.completion.ok : described.check.ok,
      initiative,
      rev: described.rev,
      status: described.status,
      fingerprintMatches: described.fingerprintMatches,
      stale: described.stale,
      findings,
      readiness: described.check,
      check: described.check,
      completion: described.completion,
    }
  }

  const impact = (cwd, input = {}) => {
    const initiative = normalizedInitiative(input.initiative)
    const loaded = load(cwd, initiative)
    if (!loaded.ok) return { ok: false, code: loaded.code === 'malformed' ? 'analysis_required' : loaded.code, message: loaded.message }
    if (!loaded.exists) return { ok: false, code: 'analysis_required', message: `no Analysis Record "${initiative}" to receive an impact` }
    const record = loaded.record
    const fingerprintState = loaded.fingerprint ?? { matches: false }
    if (fingerprintState.matches !== true) return { ok: false, code: 'fingerprint_mismatch', currentRev: record.rev, message: `the Analysis Record "${initiative}" was edited outside analysis_upsert; repair it before recording an impact` }
    if (!Number.isSafeInteger(input.expectedRev)) return { ok: false, code: 'needs_revision', currentRev: record.rev, message: `analysis_impact needs the expectedRev it read (current rev ${record.rev})` }
    if (input.expectedRev !== record.rev) return { ok: false, code: 'stale', currentRev: record.rev, message: `expected rev ${input.expectedRev}, the record is at rev ${record.rev}` }
    const change = asString(input.change)
    if (change === '') return { ok: false, code: 'needs_change', message: 'analysis_impact needs the change it is asking about' }
    const kind = asString(input.kind) || 'requirement'
    if (!['requirement', 'process', 'component', 'contract', 'data', 'invariant', 'architecture', 'design'].includes(kind)) {
      return { ok: false, code: 'invalid_kind', message: `kind must be requirement, process, component, contract, data, invariant, architecture or design; got ${JSON.stringify(kind)}` }
    }
    const requirementId = asString(input.requirementId)
    if (requirementId !== '' && !record.requirements.some((requirement) => requirement.id === requirementId)) {
      return { ok: false, code: 'analysis_required', message: `the record has no requirement "${requirementId}"` }
    }
    const targetId = asString(input.targetId)
    const affected = affectedOf(record, { kind, requirementId, targetId })
    const now = timestamp()
    const next = JSON.parse(JSON.stringify(record))
    next.rev = record.rev + 1
    next.updatedAt = now
    next.updatedBy = 'agent'
    next.status = record.status === 'ready' || record.status === 'completed' ? 'draft' : record.status
    const entry = {
      id: `impact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      at: now,
      source: 'analysis_impact',
      kind,
      requirementId,
      targetId,
      change,
      status: 'pending',
      affected,
    }
    next.pendingImpacts = [...record.pendingImpacts, entry]
    next.fingerprint = fingerprintOf(next)
    next.history = [...record.history, {
      revision: next.rev,
      at: now,
      editedBy: 'agent',
      action: 'impact',
      status: next.status,
      summary: change,
    }].slice(-historyLimit)
    const design = designOf(cwd)
    write(loaded.path, next)
    return {
      ok: true,
      code: 'analysis_stale',
      stale: true,
      initiative,
      rev: next.rev,
      impactId: entry.id,
      affected,
      status: next.status,
      design: { currentRev: design.rev, designRefRev: next.designRef?.mapRev ?? null },
      message: `"${initiative}" is stale after: ${change}; affected requirement(s): ${affected.requirementIds.join(', ') || 'all'}. Update the record and resolve the impact before delegating again.`,
    }
  }

  const linkTask = (cwd, input = {}) => {
    const initiative = normalizedInitiative(input.initiative)
    const taskId = asString(input.taskId)
    const requirementIds = asStringArray(input.requirementIds)
    if (taskId === '') return { ok: false, code: 'invalid_task', message: 'linkTask needs a taskId' }
    if (requirementIds.length === 0) return { ok: false, code: 'analysis_required', message: 'linkTask needs at least one requirementId' }
    const loaded = load(cwd, initiative)
    if (!loaded.ok) return { ok: false, code: loaded.code, message: loaded.message }
    if (!loaded.exists) return { ok: false, code: 'analysis_required', message: `no Analysis Record "${initiative}" to trace the task on` }
    const record = loaded.record
    if (Number.isSafeInteger(input.expectedRev) && input.expectedRev !== record.rev) {
      return { ok: false, code: 'stale', currentRev: record.rev, message: `linkTask read rev ${input.expectedRev}, the record is at rev ${record.rev}` }
    }
    const fingerprintState = loaded.fingerprint ?? { matches: false }
    if (fingerprintState.matches !== true) return { ok: false, code: 'analysis_stale', message: `the Analysis Record "${initiative}" no longer matches its semantic fingerprint` }
    if (loaded.ambiguousOwnership === true) {
      return { ok: false, code: 'analysis_stale', message: `the Analysis Record "${initiative}" has unresolved legacy data ownership; resolve data[].ownerComponentId to one owner before linking a task` }
    }
    if (record.pendingImpacts.length > 0) return { ok: false, code: 'analysis_stale', message: `the Analysis Record "${initiative}" has ${record.pendingImpacts.length} unresolved impact(s)` }
    if (record.status !== 'ready') return { ok: false, code: 'analysis_required', message: `the Analysis Record "${initiative}" is ${record.status}, not ready` }
    const unavailable = requirementIds.filter((id) => {
      const status = record.requirements.find((requirement) => requirement.id === id)?.status
      return status === 'deferred' || status === 'rejected'
    })
    if (unavailable.length > 0) return { ok: false, code: 'analysis_required', message: `requirement ${unavailable.join(', ')} is explicitly deferred/rejected; reopen it before starting work` }
    const missing = requirementIds.filter((id) => !record.trace.some((row) => row.requirementId === id))
    if (missing.length > 0) return { ok: false, code: 'unresolved_trace', message: `the record has no trace row for ${missing.join(', ')}; update the trace before delegating` }
    const next = JSON.parse(JSON.stringify(record))
    const now = timestamp()
    for (const row of next.trace) {
      if (!requirementIds.includes(row.requirementId)) continue
      if (!row.tasks.some((task) => task.taskId === taskId)) {
        row.tasks.push({ taskId, role: asString(input.role), at: now, evidence: [] })
      }
    }
    next.rev = record.rev + 1
    next.updatedAt = now
    next.updatedBy = 'agent'
    // Linking a task is trace-only and moves no semantic bytes, so the stored fingerprint is
    // left exactly as written. Re-sealing it here would silently "migrate" a recognised legacy
    // record as a side effect of an operational link; semantic writes do that explicitly.
    next.history = [...record.history, {
      revision: next.rev,
      at: now,
      editedBy: 'agent',
      action: 'link_task',
      status: next.status,
      summary: `${taskId} -> ${requirementIds.join(', ')}`,
    }].slice(-historyLimit)
    write(loaded.path, next)
    return { ok: true, rev: next.rev, linked: requirementIds, taskId }
  }

  /** Every record plus the raw text of the ones that could not be parsed. */
  const loadAll = (cwd) => {
    const path = storeDir(cwd)
    if (!existsSync(path)) return { records: [], malformed: [] }
    const records = []
    const malformed = []
    for (const name of readdirSync(path).filter((entry) => entry.endsWith('.json')).sort()) {
      const initiative = name.slice(0, -'.json'.length)
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(initiative)) continue
      const loaded = load(cwd, initiative)
      if (loaded.exists !== true) continue
      if (loaded.ok === true) {
        records.push({ initiative, record: loaded.record, fingerprint: loaded.fingerprint, ambiguousOwnership: loaded.ambiguousOwnership })
        continue
      }
      let text = ''
      try { text = readFileSync(loaded.path, 'utf8') } catch { text = '' }
      malformed.push({ initiative, path: loaded.path, code: loaded.code, message: loaded.message, text })
    }
    return { records, malformed }
  }

  /**
   * Can `task_close` accept this task? A traced task may close only when the record is
   * completed, the requirement is proven with evidence, the requirement is explicitly
   * deferred/rejected, or another open task still carries the planned requirement (this is
   * not the last outstanding task). Untraced tasks (L0, read-only, legacy) are allowed.
   */
  const taskCloseRefusal = (cwd, taskId, options = {}) => {
    const id = asString(taskId)
    if (id === '') return { ok: false, code: 'invalid_task', message: 'task_close needs a task id the Analysis Record can be checked against' }
    const { records, malformed } = loadAll(cwd)
    for (const entry of malformed) {
      if (entry.text.includes(id)) {
        return { ok: false, code: 'analysis_stale', message: `task "${id}" may be traced in the unreadable record "${entry.initiative}" (${entry.code}); repair the record before closing the task` }
      }
    }
    const closing = asStringArray(options.closingIds)
    const closingIds = new Set(closing.length > 0 ? closing : [id])
    const isOpenTask = typeof options.isOpenTask === 'function' ? options.isOpenTask : () => true
    const found = []
    for (const { initiative, record, fingerprint, ambiguousOwnership } of records) {
      for (const row of record.trace) {
        const task = row.tasks.find((entry) => entry.taskId === id)
        if (task !== undefined) found.push({ initiative, record, fingerprint, ambiguousOwnership, row, task })
      }
    }
    if (found.length === 0) return { ok: true, traced: false }
    for (const { initiative, record, fingerprint, ambiguousOwnership, row, task } of found) {
      if (record.status === 'completed') continue
      if (fingerprint?.matches !== true) {
        return { ok: false, code: 'analysis_stale', message: `task "${id}" is traced to "${initiative}", whose record was edited outside analysis_upsert; repair it before closing the task` }
      }
      if (ambiguousOwnership === true) {
        return { ok: false, code: 'analysis_stale', message: `task "${id}" is traced to "${initiative}", whose legacy data ownership is ambiguous; resolve data[].ownerComponentId before closing the task` }
      }
      if (record.pendingImpacts.length > 0) {
        return { ok: false, code: 'analysis_stale', message: `task "${id}" is traced to "${initiative}", which has ${record.pendingImpacts.length} unresolved impact(s); resolve them before closing the task` }
      }
      if (record.status !== 'ready') {
        return { ok: false, code: 'analysis_required', message: `task "${id}" is traced to "${initiative}", whose record is ${record.status}, not ready` }
      }
      const requirement = record.requirements.find((entry) => entry.id === row.requirementId)
      if (requirement === undefined) {
        return { ok: false, code: 'analysis_required', message: `task "${id}" is traced to a requirement that "${initiative}" no longer holds` }
      }
      if (requirement.status === 'planned') {
        const stillOpen = record.trace
          .filter((entry) => entry.requirementId === requirement.id)
          .flatMap((entry) => entry.tasks)
          .some((entry) => entry.taskId !== id && !closingIds.has(entry.taskId) && isOpenTask(entry.taskId))
        if (!stillOpen) {
          return { ok: false, code: 'analysis_incomplete', message: `task "${id}" is the last outstanding task for requirement "${requirement.id}" in "${initiative}", which is still planned; prove it with task evidence or defer/reject it explicitly before closing the task` }
        }
        continue
      }
      if (requirement.status === 'proven' && task.evidence.length === 0) {
        return { ok: false, code: 'analysis_evidence_required', message: `task "${id}" is traced to proven requirement "${requirement.id}" in "${initiative}" but the trace carries no evidence; record the evidence with analysis_upsert before closing the task` }
      }
    }
    return { ok: true, traced: true, records: found.map((entry) => entry.initiative) }
  }

  /**
   * Can `update_goal action:"complete"` accept this goal? Only when every record that links
   * the goal (now or in its history) is completed. An unlinked goal is allowed.
   */
  const goalRefusal = (cwd, goalId) => {
    const id = asString(goalId)
    if (id === '') return { ok: true, linked: false }
    const { records, malformed } = loadAll(cwd)
    for (const entry of malformed) {
      if (entry.text.includes(id)) {
        return { ok: false, code: 'analysis_stale', message: `goal "${id}" may be linked in the unreadable record "${entry.initiative}" (${entry.code}); repair the record before completing the goal` }
      }
    }
    for (const { initiative, record, fingerprint, ambiguousOwnership } of records) {
      if (record.goalId !== id && !record.goalHistory.includes(id)) continue
      if (fingerprint?.matches !== true) {
        return { ok: false, code: 'analysis_stale', message: `goal "${id}" is linked to "${initiative}", whose record was edited outside analysis_upsert` }
      }
      if (ambiguousOwnership === true) {
        return { ok: false, code: 'analysis_stale', message: `goal "${id}" is linked to "${initiative}", whose legacy data ownership is ambiguous; resolve data[].ownerComponentId before completing the goal` }
      }
      if (record.pendingImpacts.length > 0) {
        return { ok: false, code: 'analysis_stale', message: `goal "${id}" is linked to "${initiative}", which has ${record.pendingImpacts.length} unresolved impact(s)` }
      }
      if (record.status !== 'completed') {
        const completion = completionOf(record, checkRecord(record, { design: designOf(cwd), fingerprintMatches: true }))
        return { ok: false, code: 'analysis_incomplete', message: `goal "${id}" is linked to "${initiative}", which is ${record.status} (${completion.counts.proven} proven, ${completion.counts.planned} planned); complete the analysis before completing the goal` }
      }
    }
    return { ok: true, linked: true }
  }

  /**
   * The delegation gate. Proportional by construction: L0 is answered before a record is
   * read; L1/L2 need a ready record whose requirements exist and whose semantic contents
   * have not moved.
   */
  const gate = (cwd, input = {}) => {
    const klass = input.changeClass
    // READ-ONLY WORK IS EXEMPT. A research/review/critic/gatherer child reads and reports; it
    // changes no product bytes, so it must not require the heavy document. The orchestrator
    // passes the resolved role and preset; an unrecognised name stays gated (fail closed). The
    // exemption is the composition, not the label: `gatherer` has no write or edit tool at all.
    const readOnly = new Set(['research', 'reviewer', 'critic', 'gatherer'])
    const explicit = klass !== undefined
      || asString(input.initiative) !== ''
      || asStringArray(input.requirementIds).length > 0
      || input.architectureImpact === true
    // The exemption is the RESOLVED PRESET, never the role label: a write-capable preset
    // behind a read-only-sounding role is still gated. An explicit class/record opts in.
    if (readOnly.has(asString(input.preset).toLowerCase()) && !explicit) {
      return { ok: true, class: klass ?? 'L0', analysisRequired: false, readOnly: true, message: 'read-only preset: no Analysis Record is required' }
    }
    // A pre-existing task may be continued without retrofitting a record, but only through
    // an EXPLICIT legacyAttach:true declaration by the root. No timestamp is inferred.
    if (input.legacyAttach === true) {
      return { ok: true, class: 'legacy', analysisRequired: false, legacy: true, message: 'legacy task attach: no Analysis Record is required' }
    }
    if (klass === 'L0') return { ok: true, class: 'L0', analysisRequired: false, message: 'L0: a question or local fix needs no Analysis Record' }
    if (klass !== undefined && klass !== 'L1' && klass !== 'L2') {
      return { ok: false, code: 'analysis_required', message: `changeClass must be L0, L1 or L2; got ${JSON.stringify(klass)}` }
    }
    const effective = klass ?? 'L1'
    const initiative = asString(input.initiative)
    if (initiative === '') {
      return { ok: false, code: 'analysis_required', message: `an ${effective} delegation needs analysisId naming the Analysis Record in docs/analysis/ (L0 is the only class that skips it)` }
    }
    let normalized
    try {
      normalized = normalizedInitiative(initiative)
    } catch (error) {
      return { ok: false, code: 'analysis_required', message: error.message }
    }
    const loaded = load(cwd, normalized)
    if (!loaded.ok) return { ok: false, code: 'analysis_required', message: `the Analysis Record "${normalized}" is ${loaded.code}: ${loaded.message}` }
    if (!loaded.exists) return { ok: false, code: 'analysis_required', message: `no Analysis Record "${normalized}" in ${storeDir(cwd)}; write one with analysis_upsert before delegating ${effective} work` }
    const record = loaded.record
    const design = designOf(cwd)
    const fingerprintState = loaded.fingerprint ?? { matches: false }
    if (fingerprintState.matches !== true) {
      return { ok: false, code: 'analysis_stale', rev: record.rev, message: `the Analysis Record "${normalized}" no longer matches its semantic fingerprint; re-run analysis_upsert after inspecting the hand edit` }
    }
    // An older record may READ with ambiguous legacy ownership, but a delegation cannot start
    // against it: the canonical owner is unknown, so the gate fails closed until it is resolved.
    if (loaded.ambiguousOwnership === true) {
      return {
        ok: false,
        code: 'analysis_stale',
        rev: record.rev,
        message: `the Analysis Record "${normalized}" has unresolved legacy data ownership (data without data[].ownerComponentId owned by several components); read is compatible, but resolve the canonical owner before delegating`,
      }
    }
    if (record.pendingImpacts.length > 0) {
      return {
        ok: false,
        code: 'analysis_stale',
        rev: record.rev,
        findings: record.pendingImpacts.map((impact) => ({ code: 'pending_impact', severity: 'error', path: impact.id, message: impact.change })),
        message: `the Analysis Record "${normalized}" is stale: ${record.pendingImpacts.map((impact) => impact.change || impact.id).join('; ')}. Update it, call analysis_upsert with resolveImpacts, and try again.`,
      }
    }
    if (input.architectureImpact === true && design.exists && record.designRef !== null && design.rev > record.designRef.mapRev) {
      return { ok: false, code: 'analysis_stale', rev: record.rev, message: `the design map moved to rev ${design.rev} after "${normalized}" recorded rev ${record.designRef.mapRev}; re-read the map and update the analysis before an architecture-affecting delegation` }
    }
    if (record.status !== 'ready') {
      return { ok: false, code: 'analysis_required', rev: record.rev, message: `the Analysis Record "${normalized}" is ${record.status}, not ready; an ${effective} delegation cannot start against it` }
    }
    const requirementIds = asStringArray(input.requirementIds)
    if (requirementIds.length === 0) {
      return { ok: false, code: 'analysis_required', rev: record.rev, message: `an ${effective} delegation must name the requirementIds it implements; the Analysis Record holds ${record.requirements.map((requirement) => requirement.id).join(', ')}` }
    }
    const known = new Set(record.requirements.map((requirement) => requirement.id))
    const unknown = requirementIds.filter((id) => !known.has(id))
    if (unknown.length > 0) {
      return { ok: false, code: 'analysis_required', rev: record.rev, message: `the Analysis Record "${normalized}" has no requirement ${unknown.join(', ')}; add it and trace it before delegating` }
    }
    const unavailable = requirementIds.filter((id) => {
      const status = record.requirements.find((requirement) => requirement.id === id)?.status
      return status === 'deferred' || status === 'rejected'
    })
    if (unavailable.length > 0) {
      return { ok: false, code: 'analysis_required', rev: record.rev, message: `requirement ${unavailable.join(', ')} is explicitly deferred/rejected in "${normalized}"; reopen it with analysis_upsert before delegating implementation` }
    }
    if (input.architectureImpact === true && record.architecture.components.length === 0) {
      return { ok: false, code: 'analysis_required', rev: record.rev, message: `architectureImpact was declared but "${normalized}" names no component` }
    }
    const readiness = checkRecord(record, { design, fingerprintMatches: true })
    if (!readiness.ok) {
      return {
        ok: false,
        code: 'analysis_stale',
        rev: record.rev,
        findings: readiness.findings,
        message: `the Analysis Record "${normalized}" is ready but no longer complete: ${readiness.findings.find((finding) => finding.severity === 'error')?.message ?? 'see findings'}`,
      }
    }
    return {
      ok: true,
      class: effective,
      analysisRequired: true,
      initiative: normalized,
      rev: record.rev,
      requirements: requirementIds.map((id) => record.requirements.find((requirement) => requirement.id === id)),
      designRef: record.designRef,
      check: readiness,
    }
  }

  return { read, list, upsert, check, impact, linkTask, gate, taskCloseRefusal, goalRefusal, dir: storeDir, designOf }
}

export const service = { createService, fingerprints: { fingerprintOf, requirementSpecHash } }
