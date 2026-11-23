/**
 * Merge two versions of the project state (`state/`) into one, as a pure function.
 *
 * WHY THIS EXISTS. `state/` is the project ledger, and two machines edit it independently:
 * the numbers TASK-N/REQ-N/TEST-N are allocated from the local directory, and `seq` is the
 * line count, so both machines hand out the same number to different rows. Git reports that as
 * an add/add conflict on the row file and a content conflict on `events.jsonl`; picking a side
 * loses a machine's history, keeping both leaves duplicate ids, and `replay()` refuses a file
 * whose last event does not serialize back to it.
 *
 * THE RULE. A row is identified by what it IS, not by the number it happens to hold:
 *   - TASK -> its `boardId` (the board row it mirrors),
 *   - TEST -> its `caseId`,
 *   - REQ  -> its `analysisRef` (initiative + requirement id),
 *   - anything else -> a key derived from `createdAt` and `title`.
 * Two rows with the same number and different identities keep one number and the later one is
 * renumbered; one identity under two numbers is one row and the second number disappears. Every
 * such decision is reported, so an agent can tell the human what it changed.
 *
 * EVENTS are identified by their content (`at`, `op`, `kind`, `id`, `record`, `body`): the same
 * event from both machines enters once, and `seq` is reassigned 1..N because it is a line number,
 * not an identity. After the union, a row whose last event no longer serializes to the merged
 * file gets a synthetic `update` event at the merge time: the journal then says what happened
 * instead of pretending the merged bytes were written by the old event.
 *
 * WHAT IT DOES NOT DO. It does not touch anything outside `state/`, does not write to the
 * worktree (that is the CLI's job) and does not resolve edits to the SAME row that conflict in
 * meaning: it keeps the later `updatedAt` and reports both revisions.
 */
import { createHash } from 'node:crypto'
import { parse, serialize } from './format.mjs'

const ID_RE = /^(REQ|DEC|TASK|TEST)-(\d+)$/
const KIND_BY_PREFIX = { REQ: 'req', DEC: 'decision', TASK: 'task', TEST: 'test' }
const PREFIX_BY_KIND = { req: 'REQ', decision: 'DEC', task: 'TASK', test: 'TEST' }

/** `state/<dir>/<ID>.md`: the only paths this module reads as rows. */
export const ENTITY_PATH_RE = /^state\/(req|task|test|decision)\/([A-Z]+-\d+)\.md$$/
/** The journal this module merges. */
export const JOURNAL_PATH = 'state/events.jsonl'

export const sha256 = (text) => createHash('sha256').update(String(text), 'utf8').digest('hex')

/** The kind a typed id names, or undefined. */
export function kindOfId(id) {
  const match = ID_RE.exec(String(id ?? ''))
  return match === null ? undefined : KIND_BY_PREFIX[match[1]]
}

function numberOf(id) {
  const match = ID_RE.exec(String(id ?? ''))
  return match === null ? 0 : Number(match[2])
}

function formatId(kind, number) {
  return `${PREFIX_BY_KIND[kind]}-${String(number).padStart(3, '0')}`
}

/**
 * The machine-independent identity of one row. The source keys are the ones the mirrors already
 * carry, so no state file has to be migrated; a row created by hand falls back to a key derived
 * from its creation time and title, which two machines do not share for two different rows.
 */
export function identityOf(kind, frontmatter = {}) {
  if (kind === 'task' && typeof frontmatter.boardId === 'string' && frontmatter.boardId.trim() !== '') return `task-board:${frontmatter.boardId.trim()}`
  if (kind === 'test' && typeof frontmatter.caseId === 'string' && frontmatter.caseId.trim() !== '') return `test-case:${frontmatter.caseId.trim()}`
  if (kind === 'req' && frontmatter.analysisRef !== null && typeof frontmatter.analysisRef === 'object') {
    const initiative = String(frontmatter.analysisRef.initiative ?? '').trim()
    const requirementId = String(frontmatter.analysisRef.requirementId ?? '').trim()
    if (initiative !== '') return `req-analysis:${initiative}#${requirementId}`
  }
  // A hand-created row (no source key) is keyed by its CREATION time, never by its title: a
  // title is edit history, and an edit on one machine must not read as a different row.
  if (typeof frontmatter.createdAt === 'string' && frontmatter.createdAt !== '') return `${kind}-created:${sha256([kind, frontmatter.createdAt].join('|')).slice(0, 16)}`
  return `${kind}-title:${sha256([kind, frontmatter.title ?? ''].join('|')).slice(0, 16)}`
}

/** The content identity of one journal event; a stored `eid` wins when the writer set one. */
export function eidOf(event) {
  if (typeof event?.eid === 'string' && event.eid !== '') return event.eid
  if (event?.malformed !== undefined) return `malformed:${sha256(String(event.malformed))}`
  return sha256([event?.at ?? '', event?.op ?? '', event?.kind ?? '', event?.id ?? '', JSON.stringify(event?.record ?? null), typeof event?.body === 'string' ? event.body : ''].join('|'))
}

/** One line per event; a malformed line is kept as `{ malformed: line }` so it is not lost. */
export function parseJournal(text) {
  const events = []
  for (const line of String(text ?? '').split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line)
      events.push(parsed !== null && typeof parsed === 'object' ? parsed : { malformed: line })
    } catch {
      events.push({ malformed: line })
    }
  }
  return events
}

function emptySide() {
  return { entities: new Map(), byIdentity: new Map(), events: [], invalid: [] }
}

/**
 * Read one side of the merge from its `state/` files.
 *
 * @param {Map<string, string>|object} files - path -> text, paths relative to the workspace.
 */
export function readSide(files) {
  const source = files instanceof Map ? files : new Map(Object.entries(files ?? {}))
  const side = emptySide()
  for (const [path, text] of source) {
    if (path === JOURNAL_PATH) {
      side.events = parseJournal(text)
      continue
    }
    const match = ENTITY_PATH_RE.exec(path)
    if (match === null) continue
    const parsed = parse(text)
    if (parsed.ok === false) {
      side.invalid.push({ path, error: parsed.error })
      continue
    }
    const kind = match[1]
    const id = String(parsed.frontmatter?.id ?? '')
    if (!ID_RE.test(id)) {
      side.invalid.push({ path, error: 'missing or malformed id' })
      continue
    }
    const identity = identityOf(kind, parsed.frontmatter)
    const entity = { path, kind, id, identity, fm: parsed.frontmatter, body: parsed.body, text }
    side.entities.set(id, entity)
    if (!side.byIdentity.has(identity)) side.byIdentity.set(identity, entity)
  }
  return side
}

/** Rewrite the references a row holds into its final numbering. */
function rewriteReferences(frontmatter, map) {
  const out = frontmatter
  if (Array.isArray(frontmatter.links)) {
    out.links = frontmatter.links.map((link) => (link !== null && typeof link === 'object' && map.has(String(link.id)) ? { ...link, id: map.get(String(link.id)) } : link))
  }
  if (typeof frontmatter.reqId === 'string' && map.has(frontmatter.reqId)) out.reqId = map.get(frontmatter.reqId)
  if (Array.isArray(frontmatter.reqIds)) out.reqIds = frontmatter.reqIds.map((id) => (map.has(String(id)) ? map.get(String(id)) : id))
  if (typeof frontmatter.supersededBy === 'string' && map.has(frontmatter.supersededBy)) out.supersededBy = map.get(frontmatter.supersededBy)
  return out
}

/** The later of two versions of one row, deterministically. */
function laterVersion(left, right) {
  const at = (entity) => String(entity?.fm?.updatedAt ?? '')
  if (at(left) !== at(right)) return at(left) > at(right) ? left : right
  const revision = (entity) => Number(entity?.fm?.revision ?? 0)
  if (revision(left) !== revision(right)) return revision(left) > revision(right) ? left : right
  return sha256(left.text) > sha256(right.text) ? left : right
}

/** Recompute every link hash against the merged target bytes until stable. */
function rehashLinks(final) {
  let rewrites = 0
  for (let pass = 0; pass < 6; pass += 1) {
    let dirty = false
    for (const entity of final.values()) entity.text = serialize({ frontmatter: entity.fm, body: entity.body })
    for (const entity of final.values()) {
      for (const link of Array.isArray(entity.fm.links) ? entity.fm.links : []) {
        const target = final.get(String(link.id))
        if (target === undefined) continue
        const hash = sha256(target.text)
        if (link.hash !== hash) {
          link.hash = hash
          dirty = true
          rewrites += 1
        }
      }
    }
    if (!dirty) break
  }
  for (const entity of final.values()) entity.text = serialize({ frontmatter: entity.fm, body: entity.body })
  return rewrites
}

/** One event with its references in the final numbering. */
function rewriteEvent(event, map) {
  if (event?.malformed !== undefined) return { malformed: event.malformed }
  const out = { ...event }
  if (typeof out.id === 'string' && map.has(out.id)) out.id = map.get(out.id)
  if (out.record !== null && typeof out.record === 'object') {
    const frontmatter = rewriteReferences(structuredClone(out.record), map)
    if (typeof out.id === 'string') frontmatter.id = out.id
    out.record = frontmatter
  }
  return out
}

/**
 * Merge ours and theirs (against a base, when the caller has one).
 *
 * @param {{base?: Map<string,string>|object, ours: Map<string,string>|object, theirs: Map<string,string>|object, now?: string}} input
 * @returns {{ok: true, entities: object[], events: object[], report: object} | {ok: false, code: string, message: string, invalid?: object[]}}
 */
/** The latest event time either side recorded; a merged journal writes its synthetic rows there. */
function latestEventAt(events) {
  let latest = ''
  for (const event of events) if (typeof event?.at === 'string' && event.at > latest) latest = event.at
  return latest
}

export function mergeStates({ base = new Map(), ours: oursFiles, theirs: theirsFiles, now } = {}) {
  const baseSide = readSide(base)
  const ours = readSide(oursFiles)
  const theirs = readSide(theirsFiles)
  const invalid = [...ours.invalid, ...theirs.invalid]
  if (invalid.length > 0) {
    const first = invalid[0]
    return { ok: false, code: 'merge_invalid_entity', message: `cannot merge ${first.path}: ${first.error}`, invalid }
  }

  // THE MERGE TIME IS DERIVED, NOT READ FROM THE CLOCK: a second run over the same refs must
  // write the same bytes, or "idempotent" is a claim the file hashes refute. The latest event
  // either side recorded is stable for a given pair of refs.
  const mergeAt = typeof now === 'string' && now !== '' ? now : latestEventAt([...ours.events, ...theirs.events]) || new Date().toISOString()
  const report = {
    at: mergeAt,
    renamed: [],
    aliased: [],
    editedBothSides: [],
    keptDeleted: [],
    events: { ours: ours.events.length, theirs: theirs.events.length, duplicates: 0, synthetic: 0, total: 0 },
    linksRehashed: 0,
    clean: true,
  }

  // Every identity either side knows, with the versions that exist.
  const identities = new Map()
  for (const [identity, entity] of ours.byIdentity) identities.set(identity, { identity, ours: entity })
  for (const [identity, entity] of theirs.byIdentity) {
    const row = identities.get(identity) ?? { identity }
    row.theirs = entity
    identities.set(identity, row)
  }
  for (const [identity, entity] of baseSide.byIdentity) {
    const row = identities.get(identity) ?? { identity }
    row.base = entity
    identities.set(identity, row)
  }

  const identityList = [...identities.keys()].sort()
  const sideMap = { ours: new Map(), theirs: new Map() }
  const finalIdOf = new Map()

  // 1. ONE IDENTITY UNDER TWO NUMBERS: keep one number and remember where the other pointed.
  for (const identity of identityList) {
    const row = identities.get(identity)
    const candidates = []
    if (row.ours !== undefined) candidates.push({ side: 'ours', id: row.ours.id })
    if (row.theirs !== undefined) candidates.push({ side: 'theirs', id: row.theirs.id })
    let kept
    if (row.base !== undefined && candidates.some((candidate) => candidate.id === row.base.id)) kept = row.base.id
    else if (candidates.length > 0) {
      const ids = [...new Set(candidates.map((candidate) => candidate.id))].sort((a, b) => numberOf(a) - numberOf(b) || a.localeCompare(b))
      kept = ids[0]
    } else kept = row.base.id
    finalIdOf.set(identity, kept)
    for (const candidate of candidates) if (candidate.id !== kept) sideMap[candidate.side].set(candidate.id, kept)
    if (row.ours !== undefined && row.theirs !== undefined && row.ours.id !== row.theirs.id) {
      const dropped = row.ours.id === kept ? row.theirs : row.ours
      report.aliased.push({ from: dropped.id, to: kept, kind: dropped.kind, title: dropped.fm.title ?? '', identity })
    }
    if (row.base !== undefined && (row.ours === undefined) !== (row.theirs === undefined)) {
      const keptSide = row.ours ?? row.theirs
      report.keptDeleted.push({ id: kept, kind: keptSide.kind, title: keptSide.fm.title ?? '', identity, missingFrom: row.ours === undefined ? 'ours' : 'theirs' })
    }
  }

  // 2. TWO IDENTITIES UNDER ONE NUMBER: one keeps it, the others move past the highest number seen.
  const claims = new Map()
  for (const identity of identityList) {
    const id = finalIdOf.get(identity)
    const list = claims.get(id) ?? []
    list.push(identity)
    claims.set(id, list)
  }
  // NUMBERS ARE PER KIND: TASK-002 and REQ-002 are different sequences, so a task must never be
  // pushed past the highest requirement number.
  const nextByKind = new Map()
  for (const side of [baseSide, ours, theirs]) {
    for (const id of side.entities.keys()) {
      const kind = kindOfId(id)
      if (kind === undefined) continue
      nextByKind.set(kind, Math.max(nextByKind.get(kind) ?? 0, numberOf(id)))
    }
  }
  const nextNumber = (kind) => {
    const value = (nextByKind.get(kind) ?? 0) + 1
    nextByKind.set(kind, value)
    return value
  }
  for (const id of [...claims.keys()].sort()) {
    const identitiesAtId = claims.get(id)
    if (identitiesAtId.length < 2) continue
    const first = identities.get(identitiesAtId[0])
    const kind = (first.ours ?? first.theirs).kind
    const ranked = identitiesAtId.slice().sort((left, right) => {
      const inBase = (identity) => (identities.get(identity).base?.id === id ? 0 : 1)
      if (inBase(left) !== inBase(right)) return inBase(left) - inBase(right)
      const createdAt = (identity) => String((identities.get(identity).ours ?? identities.get(identity).theirs).fm.createdAt ?? '')
      if (createdAt(left) !== createdAt(right)) return createdAt(left) < createdAt(right) ? -1 : 1
      return left.localeCompare(right)
    })
    for (const loser of ranked.slice(1)) {
      const assigned = formatId(kind, nextNumber(kind))
      finalIdOf.set(loser, assigned)
      const row = identities.get(loser)
      for (const side of ['ours', 'theirs']) if (row[side] !== undefined) sideMap[side].set(row[side].id, assigned)
      const dropped = row.ours ?? row.theirs
      const winner = identities.get(ranked[0])
      report.renamed.push({
        from: dropped.id,
        to: assigned,
        kind,
        title: dropped.fm.title ?? '',
        identity: loser,
        keptBy: (winner.ours ?? winner.theirs).fm.title ?? '',
      })
    }
  }

  // 3. PICK THE VERSION. Same bytes: one row. One side unchanged: the changed side wins.
  //    Both changed: the later updatedAt wins, deterministically, and the report names both.
  const final = new Map()
  for (const identity of identityList) {
    const row = identities.get(identity)
    const finalId = finalIdOf.get(identity)
    let source = null
    let side = null
    if (row.ours !== undefined && row.theirs !== undefined) {
      if (row.ours.text === row.theirs.text) {
        source = row.ours
        side = 'ours'
      } else if (row.base !== undefined && row.ours.text === row.base.text) {
        source = row.theirs
        side = 'theirs'
      } else if (row.base !== undefined && row.theirs.text === row.base.text) {
        source = row.ours
        side = 'ours'
      } else {
        const later = laterVersion(row.ours, row.theirs)
        const dropped = later === row.ours ? row.theirs : row.ours
        source = later
        side = later === row.ours ? 'ours' : 'theirs'
        report.editedBothSides.push({
          id: finalId,
          kind: source.kind,
          title: source.fm.title ?? '',
          kept: side,
          keptAt: source.fm.updatedAt ?? '',
          droppedAt: dropped.fm.updatedAt ?? '',
          keptRevision: source.fm.revision ?? null,
          droppedRevision: dropped.fm.revision ?? null,
        })
      }
    } else if (row.ours !== undefined) {
      source = row.ours
      side = 'ours'
    } else if (row.theirs !== undefined) {
      source = row.theirs
      side = 'theirs'
    } else {
      continue
    }
    const map = side === 'theirs' ? sideMap.theirs : sideMap.ours
    const frontmatter = rewriteReferences(structuredClone(source.fm), map)
    frontmatter.id = finalId
    final.set(finalId, { kind: source.kind, id: finalId, fm: frontmatter, body: source.body, text: serialize({ frontmatter, body: source.body }) })
  }
  report.linksRehashed = rehashLinks(final)

  // 4. THE JOURNAL: the same event enters once; seq is the merged line number.
  const journal = []
  const seen = new Set()
  let oursAt = 0
  let theirsAt = 0
  while (oursAt < ours.events.length || theirsAt < theirs.events.length) {
    let takeOurs
    if (oursAt >= ours.events.length) takeOurs = false
    else if (theirsAt >= theirs.events.length) takeOurs = true
    else takeOurs = String(ours.events[oursAt].at ?? '') <= String(theirs.events[theirsAt].at ?? '')
    const event = takeOurs ? ours.events[oursAt++] : theirs.events[theirsAt++]
    const side = takeOurs ? 'ours' : 'theirs'
    const eid = eidOf(event)
    if (seen.has(eid)) {
      report.events.duplicates += 1
      continue
    }
    seen.add(eid)
    journal.push(rewriteEvent(event, sideMap[side]))
  }

  // A row whose last event does not serialize to the merged bytes gets an honest new event.
  const lastById = new Map()
  for (const event of journal) if (typeof event?.id === 'string' && event.record !== undefined) lastById.set(event.id, event)
  for (const entity of [...final.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const expected = serialize({ frontmatter: entity.fm, body: entity.body })
    const last = lastById.get(entity.id)
    if (last === undefined) {
      journal.push({ at: mergeAt, op: 'create', id: entity.id, kind: entity.kind, revision: entity.fm.revision ?? 1, record: entity.fm, body: entity.body })
      report.events.synthetic += 1
    } else if (serialize({ frontmatter: last.record, body: last.body ?? '' }) !== expected) {
      journal.push({ at: mergeAt, op: 'update', id: entity.id, kind: entity.kind, revision: entity.fm.revision ?? last.revision ?? 1, record: entity.fm, body: entity.body })
      report.events.synthetic += 1
    }
  }
  journal.forEach((event, index) => {
    if (event?.malformed === undefined) event.seq = index + 1
  })
  report.events.total = journal.length
  report.clean = report.renamed.length === 0 && report.aliased.length === 0 && report.editedBothSides.length === 0 && report.keptDeleted.length === 0 && report.events.synthetic === 0

  return { ok: true, entities: [...final.values()].sort((left, right) => left.id.localeCompare(right.id)), events: journal, report }
}
