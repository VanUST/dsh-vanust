/**
 * Ratchet compiler: read the decision corpus, validate the authority graph, and
 * compile the active decisions into the laws the verifier enforces.
 *
 * The split from `ratchet-schema.mjs` is the split between *one file being well
 * formed* and *the corpus making sense*. Everything here is about relations
 * between records — supersession links, duplicate ids, laws that two decisions
 * constrain differently — and about the authority question: who was allowed to
 * make this decision, and is it in force?
 *
 * The compiler never guesses. Where a conflict cannot be decided by comparing
 * structure — two `forbidden_text` checks with different patterns on the same
 * path are not provably incompatible — it does not pick a winner and does not
 * silently drop one. It records `DYNAMIC_REVIEW_REQUIRED`, which is the input to
 * the agentic layer. The deterministic layer decides only what it can prove.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  AUTHORITIES,
  MANIFEST_PATH,
  PROBLEM_CODES,
  RATCHET_DIR_DEFAULT,
  hashSource,
  normaliseText,
  parseAdr,
  parseRatchetConfig,
  problem,
} from './ratchet-schema.mjs'

/** Report title embedded in every bundle, so a consumer can reject a foreign file. */
export const COMPILE_REPORT_KIND = 'ratchet/compile-report'

/** Bundle format version. Bumped when the bundle's shape changes incompatibly. */
export const SPEC_BUNDLE_VERSION = 1

/**
 * Reads the project manifest from disk.
 *
 * @param root - Absolute project root.
 * @returns `{ config, text, problems }`. `config` is `null` when the manifest is
 *   missing or unusable; `text` is the raw manifest text (also `null`), kept so
 *   callers can hash exactly the bytes they read.
 */
export function readManifest(root) {
  const path = join(root, MANIFEST_PATH)
  if (!existsSync(path)) {
    return {
      config: null,
      text: null,
      problems: [
        problem(
          'MANIFEST_MISSING',
          `no ${MANIFEST_PATH} in ${root}; the ratchet reads its configuration from that file and cannot guess one`,
        ),
      ],
    }
  }
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return {
      config: null,
      text: null,
      problems: [
        problem('MANIFEST_INVALID', `${MANIFEST_PATH} exists but could not be read: ${String(error)}`),
      ],
    }
  }
  const parsed = parseRatchetConfig(normaliseText(text), hashSource(text))
  return { config: parsed.config, text, problems: parsed.problems }
}

/**
 * Reads and parses every ADR in the project's decisions directory.
 *
 * The three failure modes are reported separately and never collapsed:
 *   - the directory does not exist (`DIR_MISSING`),
 *   - the path exists but is not a directory (`DIR_NOT_A_DIRECTORY`),
 *   - the directory exists and lists but holds no file that parses
 *     (`NO_VALID_ADRS`).
 * A project with no decisions directory and a project with an empty one need
 * different fixes, and the predecessor's single empty list told them apart from
 * neither.
 *
 * @param root - Absolute project root.
 * @param config - Parsed ratchet configuration.
 * @returns `{ records, files, problems, directory }` where `files` lists every
 *   entry examined so a report can name what it looked at.
 */
export function readAdrCorpus(root, config) {
  const decisionsDir = config?.decisionsDir ?? RATCHET_DIR_DEFAULT
  const directory = join(root, decisionsDir)
  const records = []
  const files = []
  const problems = []

  if (!existsSync(directory)) {
    return {
      records,
      files,
      directory,
      problems: [
        problem(
          'DIR_MISSING',
          `the decisions directory ${decisionsDir} does not exist; create it and add an ADR, or point ratchet.decisionsDir at the directory that holds the decisions`,
        ),
      ],
    }
  }

  let entries
  try {
    const stats = readdirSync(directory, { withFileTypes: true })
    entries = stats.filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
    if (stats.length > 0 && entries.length === 0) {
      return {
        records,
        files,
        directory,
        problems: [
          problem(
            'DIR_NOT_A_DIRECTORY',
            `${decisionsDir} exists but contains no regular files; a decisions directory holds NNNN-slug.adr.md files`,
          ),
        ],
      }
    }
  } catch (error) {
    return {
      records,
      files,
      directory,
      problems: [
        problem('DIR_UNREADABLE', `${decisionsDir} could not be listed: ${String(error)}`),
      ],
    }
  }

  const ids = new Map()
  for (const filename of entries) {
    files.push(`${decisionsDir}/${filename}`)
    // Non-ADR files are NOT silently ignored: a `README.md` next to the records
    // is normal, so it is listed, but a candidate that looks like an ADR and
    // does not parse is a problem the report must carry.
    if (!filename.endsWith('.md')) continue
    let source
    try {
      source = readFileSync(join(directory, filename), 'utf8')
    } catch (error) {
      problems.push(
        problem(
          'ADR_UNREADABLE',
          `${decisionsDir}/${filename} could not be read: ${String(error)}`,
          filename,
          { path: `${decisionsDir}/${filename}` },
        ),
      )
      continue
    }
    const parsed = parseAdr({ filename, source, root, decisionsDir })
    for (const entry of parsed.problems) problems.push(entry)
    if (parsed.record === null) continue

    if (ids.has(parsed.record.id)) {
      problems.push(
        problem(
          'ADR_ID_DUPLICATE',
          `ADR id "${parsed.record.id}" is declared by both ${ids.get(parsed.record.id)} and ${parsed.record.path}`,
          parsed.record.id,
          { path: parsed.record.path },
        ),
      )
      continue
    }
    ids.set(parsed.record.id, parsed.record.path)
    records.push(parsed.record)
  }

  if (records.length === 0) {
    // Reported whenever the directory yielded no ADR, regardless of whether
    // malformed candidates were also reported. The predecessor's failure was
    // silence here: a directory full of files that are not records produced
    // `problems: []` and an empty corpus, which read as "nothing wrong".
    problems.push(
      problem(
        'NO_VALID_ADRS',
        `${decisionsDir} holds no file that parses as an ADR; an ADR is named NNNN-slug.adr.md and declares id, title, type, status, author, source, zones and laws in its frontmatter`,
      ),
    )
  }

  return { records, files, directory, problems }
}

/**
 * Validates the supersession graph.
 *
 * @param records - Parsed ADR records.
 * @returns An array of problems; empty when every link resolves and the graph is
 *   acyclic. Dangling links are errors, not warnings: the predecessor let a
 *   reference to a nonexistent ADR silently remove a live decision from review.
 */
export function validateSupersessionGraph(records) {
  const problems = []
  const byId = new Map(records.map((record) => [record.id, record]))
  for (const record of records) {
    for (const target of record.supersedes) {
      if (!byId.has(target)) {
        problems.push(
          problem(
            'ADR_SUPERSEDES_DANGLING',
            `${record.path} supersedes "${target}", which is not the id of any ADR in this project`,
            record.id,
            { path: record.path },
          ),
        )
      }
    }
  }

  // Cycle detection over the supersedes edges. A cycle means no member of it can
  // be the current law, which is a corpus-level contradiction rather than a
  // per-record mistake, so the problem is reported once per participating id.
  const state = new Map()
  const reported = new Set()
  const visit = (id, trail) => {
    const current = state.get(id)
    if (current === 'done') return
    if (current === 'visiting') {
      const start = trail.indexOf(id)
      for (const member of trail.slice(start === -1 ? 0 : start)) {
        if (reported.has(member)) continue
        reported.add(member)
        problems.push(
          problem(
            'ADR_SUPERSEDES_CYCLE',
            `supersedes links form a cycle through ${[...trail.slice(start === -1 ? 0 : start), id].join(' -> ')}; no member of a cycle can be the current decision`,
            member,
          ),
        )
      }
      return
    }
    state.set(id, 'visiting')
    const record = byId.get(id)
    for (const target of record?.supersedes ?? []) {
      if (byId.has(target)) visit(target, [...trail, id])
    }
    state.set(id, 'done')
  }
  for (const record of records) visit(record.id, [])
  return problems
}

/**
 * Decides which records are in force, and which are only proposed.
 *
 * A record is **active** when its own status is `active` and the zone permits an
 * agent to activate its own decision, or when a human-authored `approval` ADR
 * carries an intact ratification of it. The approved ADR keeps its own author
 * authority: the approval changes whether the decision is in force, never who
 * made it, which is what keeps the history readable and the accountability intact.
 *
 * A ratification is a claim about a TEXT, not about a title. The approval records
 * a content hash per approved record, and this function honours it only while the
 * file still hashes to that value — so editing an approved decision voids the
 * consent instead of silently inheriting it. Three failures stay distinct, because
 * the fix differs: a target that exists nowhere, an approval that proves nothing,
 * and a decision edited after it was approved.
 *
 * A record the zone does not authorise is **not** in force. Reporting a
 * self-declared active decision while quietly enforcing it was the worst of both
 * worlds: the gate said an agent had no authority to make the decision and then
 * checked the code against it anyway.
 *
 * @param records - Parsed ADR records.
 * @param config - Parsed ratchet configuration.
 * @returns `{ active, proposed, excluded, approvals, problems }` where `active`,
 *   `proposed` and `excluded` are arrays of records. `excluded` holds records that
 *   claim force without being permitted it — neither active nor waiting, because
 *   counting a refused decision as pending work hides what has to change.
 */
export function resolveActiveSet(records, config) {
  const problems = []
  const byId = new Map(records.map((record) => [record.id, record]))

  // Consent, gathered before force is decided because a ratification is what
  // makes a proposed record forcible. Everything about the approval ADR that can
  // be judged from that file alone — authority, a well-formed ratification block,
  // coverage of every approved id, a hash in the right form — is reported by
  // `parseAdr`; what is judged here is what only the corpus can answer.
  const consents = new Map()
  for (const record of records) {
    if (record.type !== 'approval') continue
    if (record.authority !== 'human') {
      problems.push(
        problem(
          'ADR_AGENT_REQUIRES_APPROVAL',
          `${record.path} is an approval ADR but its authority is ${JSON.stringify(record.authority)}; only a human-authored ADR can approve another decision`,
          record.id,
          { path: record.path },
        ),
      )
      continue
    }
    const ratification = record.ratification ?? null
    for (const approved of record.approves) {
      const target = byId.get(approved)
      if (target === undefined) {
        problems.push(
          problem(
            'APPROVAL_TARGET_UNKNOWN',
            `${record.path} approves "${approved}", which no ADR in this project declares; an approval of something that does not exist approves nothing`,
            record.id,
            { path: record.path, approved },
          ),
        )
        continue
      }
      // An approval with no ratification block, or one that does not cover this
      // target, confers nothing. It is already reported against its own file, so
      // this is the consequence rather than a second complaint.
      if (ratification === null) continue
      const entry = ratification.targets.find((candidate) => candidate.id === approved)
      if (entry === undefined) continue
      if (entry.contentHash !== target.contentHash) {
        problems.push(
          problem(
            'RATIFICATION_STALE',
            `${record.path} ratified ${target.path} at content hash ${entry.contentHash}, but that file now hashes to ${target.contentHash}: the decision was edited after the human consented to it, so the consent covers text the file no longer contains and nothing is in force through this approval until it is ratified again`,
            approved,
            {
              path: record.path,
              approval: record.id,
              target: target.path,
              recorded: entry.contentHash,
              actual: target.contentHash,
            },
          ),
        )
        continue
      }
      consents.set(approved, {
        approvalId: record.id,
        channel: ratification.channel,
        at: ratification.at,
        askedBy: ratification.askedBy,
        contentHash: entry.contentHash,
      })
    }
  }

  // A record is superseded when another record IS IN FORCE and names it, not
  // merely when one exists that names it: a withdrawn superseding ADR must not
  // retire a law, a self-declared active one the zone refuses must not either, and
  // neither must a RATIFIED one whose ratification the zone refuses — consent does
  // not transfer authorship, so a `humanOnly` zone rejects it, and it cannot then
  // retire the human decision it names. A refused record that still retired a law
  // emptied the bundle with nothing naming the cause.
  const refusedConsent = new Set(
    records
      .filter(
        (record) =>
          consents.has(record.id) &&
          record.authority === 'agent' &&
          zonesForRecord(record, config).some((zone) => zone.agentAuthority === 'humanOnly'),
      )
      .map((record) => record.id),
  )
  const supersededBy = new Map()
  const candidateSuperseders = records.filter(
    (record) =>
      (consents.has(record.id) && !refusedConsent.has(record.id)) ||
      (record.status === 'active' && selfActivationPermitted(record, config)),
  )
  for (const record of candidateSuperseders) {
    for (const target of record.supersedes) {
      if (!supersededBy.has(target)) supersededBy.set(target, record.id)
    }
  }

  const active = []
  const proposed = []
  const excluded = []

  for (const record of records) {
    if (record.type === 'approval') continue
    const retired = supersededBy.get(record.id)
    if (retired !== undefined) {
      record.inForce = false
      record.supersededBy = retired
      continue
    }

    const consent = consents.get(record.id) ?? null
    // A record that declares no zone falls under the manifest default, so an
    // unzoned agent decision cannot escape regulation by staying unzoned.
    const relevantZones = zonesForRecord(record, config)

    let selfAuthorised = record.status === 'active'
    let effectiveConsent = consent
    const refusals = []

    if (record.authority === 'agent') {
      for (const zone of relevantZones) {
        if (zone.missing === true) {
          problems.push(
            problem(
              'LAW_ZONE_MISSING',
              `${record.path} names zone "${zone.id}", which the manifest does not declare`,
              record.id,
              { path: record.path },
            ),
          )
        }
        if (zone.agentAuthority === 'humanOnly') {
          selfAuthorised = false
          if (effectiveConsent !== null) {
            // Consent does not transfer authorship. A zone reserved to humans
            // refuses a ratified agent record for the same reason it refuses an
            // unratified one, and saying so is better than quietly activating it.
            refusals.push(
              problem(
                'ADR_AGENT_ACTIVE_IN_HUMAN_ONLY_ZONE',
                `${record.path} was ratified by ${effectiveConsent.approvalId}, but zone "${zone.id}" declares agentAuthority humanOnly: a ratified agent record is still agent-authored, and only a human-authored ADR may govern this zone`,
                record.id,
                { path: record.path, zone: zone.id, approvedBy: effectiveConsent.approvalId },
              ),
            )
            effectiveConsent = null
          } else if (record.status === 'active') {
            refusals.push(
              problem(
                'ADR_AGENT_ACTIVE_IN_HUMAN_ONLY_ZONE',
                `${record.path} is agent-authored and declares itself active, but zone "${zone.id}" declares agentAuthority humanOnly; only a human-authored ADR may govern this zone`,
                record.id,
                { path: record.path, zone: zone.id },
              ),
            )
          }
        } else if (zone.agentAuthority === 'proposeOnly' && record.status === 'active' && consent === null) {
          selfAuthorised = false
          refusals.push(
            problem(
              'ADR_AGENT_REQUIRES_APPROVAL',
              `${record.path} is agent-authored and declares itself active, but zone "${zone.id}" declares agentAuthority proposeOnly; it stays out of force until a human ratifies this exact text, and declaring it active is not a ratification`,
              record.id,
              { path: record.path, zone: zone.id },
            ),
          )
        }
      }
    }

    const inForce = selfAuthorised || effectiveConsent !== null
    record.inForce = inForce
    record.approvedBy = effectiveConsent === null ? null : effectiveConsent.approvalId
    record.ratified = effectiveConsent
    record.supersededBy = null
    problems.push(...refusals)

    if (!inForce) {
      // Three situations, three homes. `proposed` waits for a human. `excluded`
      // claims force the zone does not grant: neither in force nor waiting, and
      // counting it as pending work hides what has to change. A TERMINAL status
      // (rejected, withdrawn, or superseded by status) claims nothing at all — it is
      // simply not in force, and treating it as "excluded" put decisions the project
      // retired into the ratification queue, where a "yes" turned one back into law.
      if (record.status === 'proposed') proposed.push(record)
      else if (record.status === 'active') excluded.push(record)
      continue
    }

    active.push(record)
  }

  return { active, proposed, excluded, approvals: consents, problems }
}

/**
 * Reports whether a record's own status may put it into force without consent.
 *
 * Deliberately a predicate and not a reporter: the supersession pass needs the
 * same answer without emitting the authority problems twice, and two copies of
 * this rule would eventually disagree about which records are in force.
 *
 * @param record - A parsed ADR record.
 * @param config - Parsed ratchet configuration.
 * @returns `true` when the record is human-authored, or agent-authored under
 *   zones that all declare `activeIfNoConflict`. A record naming a zone the
 *   manifest does not declare falls back to the default policy, which is
 *   `proposeOnly` unless the manifest says otherwise, so a missing zone never
 *   widens authority by accident.
 */
function selfActivationPermitted(record, config) {
  if (record.authority !== 'agent') return true
  return zonesForRecord(record, config).every((zone) => zone.agentAuthority === 'activeIfNoConflict')
}

/**
 * Resolves the zones whose policy governs one record.
 *
 * The one place this mapping exists, so the compiler, the ratification queue and
 * anything added later cannot disagree about which policy applies — a second copy
 * is a second answer, and the two would drift the first time one of them was
 * edited.
 *
 * @param record - A parsed ADR record.
 * @param config - Parsed ratchet configuration.
 * @returns One entry per declared zone, in declaration order:
 *   `{ id, agentAuthority, missing? }`. A record declaring no zone yields the
 *   single synthetic `(unzoned)` entry carrying the manifest default; a zone the
 *   manifest does not declare yields the default policy with `missing: true`, so
 *   an unknown zone is reported rather than treated as permissive. Never `null`,
 *   and never empty: a record always has at least one governing policy.
 */
export function zonesForRecord(record, config) {
  const zones = config?.zones ?? []
  if (record.zones.length === 0) {
    return [{ id: '(unzoned)', agentAuthority: config?.defaultAgentAuthority ?? 'proposeOnly' }]
  }
  return record.zones.map((zoneId) => {
    const found = zones.find((zone) => zone.id === zoneId)
    return found ?? {
      id: zoneId,
      agentAuthority: config?.defaultAgentAuthority ?? 'proposeOnly',
      missing: true,
    }
  })
}

/**
 * Compiles the active records into a spec bundle.
 *
 * Collisions are reported rather than resolved. A duplicate law id is an error,
 * because two decisions claiming one id means the second silently replaced the
 * first. Two different `statement` values for one id from two active records are
 * also an error — the corpus contradicts itself. Anything the compiler cannot
 * prove incompatible is marked for dynamic review instead of being dropped.
 *
 * @param active - Records in force.
 * @param config - Parsed ratchet configuration.
 * @returns `{ bundle, problems, reviewRequired }` where `bundle.laws` is the
 *   compiled law list, sorted by law id for a stable hash.
 */
export function compileLaws(active, config) {
  const problems = []
  const reviewRequired = []
  const laws = new Map()

  for (const record of active) {
    for (const law of record.laws) {
      if (law.op === 'remove') {
        if (!laws.has(law.id)) {
          problems.push(
            problem(
              'LAW_TARGET_DANGLING',
              `${record.path} removes law "${law.id}", which no active ADR declares`,
              record.id,
              { lawId: law.id, path: record.path },
            ),
          )
          continue
        }
        // Consent is not durable if the next record can undo it. A law whose force
        // came from a human ratification is removed only by a record with the same
        // authority — a human-authored record, or one a human ratified — because a
        // zone that lets an agent activate its OWN decision is not the authority that
        // made this law. Without this, one agent-authored ADR retired a ratified
        // boundary law with no problem reported and the gate still green.
        const removing = laws.get(law.id)
        if (removing.approvedBy !== null && record.authority !== 'human' && record.approvedBy === null) {
          problems.push(
            problem(
              'LAW_REMOVE_UNAUTHORISED',
              `${record.path} removes law "${law.id}", whose force came from a human ratification (${removing.approvedBy} in ${removing.sourceAdr}); a ratification is not undone by an agent-authored record, however the zone that record sits in is governed. Ask a human to ratify the removal`,
              law.id,
              { lawId: law.id, path: record.path, approvedBy: removing.approvedBy },
            ),
          )
          continue
        }
        laws.delete(law.id)
        continue
      }

      const existing = laws.get(law.id)
      if (existing !== undefined) {
        if (existing.statement !== law.statement) {
          problems.push(
            problem(
              'LAW_CONFLICT',
              `law "${law.id}" is declared by ${existing.sourceAdr} as ${JSON.stringify(existing.statement)} and by ${record.id} as ${JSON.stringify(law.statement)}; the corpus contradicts itself and the ratchet will not choose`,
              law.id,
              { lawId: law.id, records: [existing.sourceAdr, record.id] },
            ),
          )
          // The contested law is REMOVED from the bundle, not left at the first
          // declaration. Leaving it in produced a bundle whose hash depended on
          // ADR file order, so a project with an unresolved conflict could obtain
          // two different "current laws" by renaming a file — and would verify
          // code against whichever one it happened to read first.
          laws.delete(law.id)
          continue
        }
        // Same id, same statement: the checks AND the stated enforcement gap must
        // also agree, or the two records are enforcing different things under one
        // name. Comparing only the checks made a law's `unenforced` note depend on
        // which ADR the compiler read first: the same corpus verified clean or failed
        // depending on file order.
        const existingChecks = JSON.stringify(existing.checks)
        const incomingChecks = JSON.stringify(law.checks ?? [])
        const existingGap = existing.unenforced ?? null
        const incomingGap = typeof law.unenforced === 'string' ? law.unenforced.trim() : null
        if (existingChecks !== incomingChecks || existingGap !== incomingGap) {
          reviewRequired.push({
            lawId: law.id,
            records: [existing.sourceAdr, record.id],
            reason:
              'two active ADRs declare the same law id and statement with different checks or different enforcement gaps; whether the two are compatible is a question about intent',
          })
        }
        continue
      }

      const zones = record.zones.length > 0 ? record.zones : []
      for (const zoneId of zones) {
        if (!(config?.zones ?? []).some((zone) => zone.id === zoneId)) {
          problems.push(
            problem(
              'LAW_ZONE_MISSING',
              `law "${law.id}" in ${record.path} is bound to zone "${zoneId}", which the manifest does not declare`,
              law.id,
              { lawId: law.id, path: record.path },
            ),
          )
        }
      }

      laws.set(law.id, {
        id: law.id,
        statement: law.statement,
        // A law with several zones is listed under each for reporting, but its
        // identity is the law id alone: the same law in two zones is one law.
        zones,
        authority: record.authority,
        sourceAdr: record.id,
        sourcePath: record.path,
        approvedBy: record.approvedBy ?? null,
        checks: (law.checks ?? []).map((check) => ({ ...check })),
        // Carried into the bundle because it is part of what the law claims: a law
        // that says nothing verifies it is a different law from one that claims a
        // check, and the verifier has to be able to tell them apart.
        unenforced: typeof law.unenforced === 'string' ? law.unenforced.trim() : null,
      })
    }
  }

  const sorted = [...laws.values()].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  return {
    bundle: {
      version: SPEC_BUNDLE_VERSION,
      project: config?.project ?? null,
      laws: sorted,
    },
    problems,
    reviewRequired,
  }
}

/**
 * Verifies the declared zones describe a usable partition of the repository.
 *
 * @param config - Parsed ratchet configuration.
 * @returns An array of problems; empty when the zone set is coherent.
 */
export function validateZones(config) {
  const problems = []
  const zones = config?.zones ?? []
  for (let left = 0; left < zones.length; left += 1) {
    for (let right = left + 1; right < zones.length; right += 1) {
      for (const a of zones[left].paths) {
        for (const b of zones[right].paths) {
          const prefixA = a.replace(/\/\*\*$/, '')
          const prefixB = b.replace(/\/\*\*$/, '')
          const overlaps =
            prefixA === prefixB ||
            prefixA.startsWith(`${prefixB}/`) ||
            prefixB.startsWith(`${prefixA}/`)
          if (overlaps && zones[left].agentAuthority !== zones[right].agentAuthority) {
            problems.push(
              problem(
                'ZONE_OVERLAP',
                `zones "${zones[left].id}" (${a}, ${zones[left].agentAuthority}) and "${zones[right].id}" (${b}, ${zones[right].agentAuthority}) overlap and declare different agent authority, so which one governs a file depends on resolution rules rather than on the manifest`,
                zones[left].id,
              ),
            )
          }
        }
      }
    }
  }
  return problems
}

/**
 * Compiles the whole corpus into a spec bundle and a report.
 *
 * This is the single entry point `ratchet_compile` calls, and it is deliberately
 * a pure-ish function of the filesystem: given a root it reads, validates,
 * resolves and compiles, and returns everything a report needs. It never writes.
 *
 * @param root - Absolute project root.
 * @returns `{ ok, report, bundle, problems }`. `ok` is true only when there are
 *   no error-severity problems. `report` is the structured compile report; it is
 *   always present, because a report that exists only on success cannot record a
 *   failure.
 */
export function compileProject(root) {
  const manifest = readManifest(root)
  const problems = [...manifest.problems]
  const report = {
    kind: COMPILE_REPORT_KIND,
    project: manifest.config?.project ?? null,
    root,
    enabled: manifest.config?.enabled === true,
    manifestHash: manifest.config?.manifestHash ?? null,
    counts: { files: 0, records: 0, active: 0, proposed: 0, excluded: 0, laws: 0 },
    problems: [],
    reviewRequired: [],
    specHash: null,
  }

  if (manifest.config === null) {
    report.problems = problems
    return { ok: false, report, bundle: null, problems }
  }
  if (!report.enabled) {
    problems.push(
      problem(
        'RATCHET_DISABLED',
        `${MANIFEST_PATH} exists but does not declare ratchet.enabled: true, so no decision is enforced in this project`,
      ),
    )
    report.problems = problems
    return { ok: false, report, bundle: null, problems }
  }

  problems.push(...validateZones(manifest.config))

  const corpus = readAdrCorpus(root, manifest.config)
  report.counts.files = corpus.files.length
  report.counts.records = corpus.records.length
  problems.push(...corpus.problems)

  problems.push(...validateSupersessionGraph(corpus.records))

  const resolved = resolveActiveSet(corpus.records, manifest.config)
  problems.push(...resolved.problems)
  report.counts.active = resolved.active.length
  report.counts.proposed = resolved.proposed.length
  report.counts.excluded = resolved.excluded.length

  const compiled = compileLaws(resolved.active, manifest.config)
  problems.push(...compiled.problems)
  report.reviewRequired = compiled.reviewRequired
  report.counts.laws = compiled.bundle.laws.length

  report.problems = problems
  report.specHash = bundleHash(compiled.bundle)

  return {
    ok: problems.length === 0,
    report,
    bundle: compiled.bundle,
    problems,
  }
}

/**
 * Computes the stable hash of a spec bundle.
 *
 * The hash covers the laws, their statements, their checks and their provenance,
 * so any change to what the ratchet enforces changes the hash, while a change to
 * a report's timestamps does not. That property is what lets a verification
 * report be tied to the exact law set it judged.
 *
 * @param bundle - A compiled spec bundle.
 * @returns `sha256:<64 hex>` over the canonical JSON of the bundle's meaning.
 */
export function bundleHash(bundle) {
  const canonical = JSON.stringify({
    version: bundle.version,
    project: bundle.project,
    laws: [...bundle.laws]
      .map((law) => ({
        id: law.id,
        statement: law.statement,
        zones: [...law.zones].sort(),
        authority: law.authority,
        sourceAdr: law.sourceAdr,
        approvedBy: law.approvedBy,
        checks: law.checks,
        unenforced: law.unenforced ?? null,
      }))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
  })
  return hashSource(canonical)
}

/**
 * Renders the human-readable spec documents from a bundle.
 *
 * Generated files carry a hash header. A hand-edit changes the file without
 * changing the bundle, so the next compile reports `SPEC_HASH_MISMATCH` — which
 * is how spec drift is detected rather than discussed.
 *
 * @param bundle - A compiled spec bundle.
 * @returns `{ files, specHash }` where `files` maps a repository-relative path to
 *   its full text.
 */
export function renderSpecs(bundle) {
  const specHash = bundleHash(bundle)
  const byZone = new Map()
  for (const law of bundle.laws) {
    const keys = law.zones.length > 0 ? law.zones : ['(unzoned)']
    for (const zone of keys) {
      if (!byZone.has(zone)) byZone.set(zone, [])
      byZone.get(zone).push(law)
    }
  }

  const files = {}
  for (const [zone, laws] of [...byZone.entries()].sort((left, right) =>
    left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0,
  )) {
    const body = [
      '<!-- GENERATED BY ratchet compile. DO NOT EDIT BY HAND. -->',
      `<!-- spec-hash: ${specHash} -->`,
      '',
      `# Spec: ${zone}`,
      '',
      `Project: ${bundle.project ?? '(unnamed)'}`,
      '',
      ...laws
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
        .flatMap((law) => [
          `## ${law.id}`,
          '',
          law.statement,
          '',
          `- authority: ${law.authority}`,
          `- decided in: ${law.sourceAdr}${law.approvedBy === null ? '' : ` (approved by ${law.approvedBy})`}`,
          ...(law.checks.length === 0
            ? [
                typeof law.unenforced === 'string'
                  ? `- checks: none, and this law says why: ${law.unenforced}`
                  : '- checks: none, and the law does not say why — nothing verifies it',
              ]
            : [
                '- checks:',
                ...law.checks.map((check) => `  - ${check.type}: ${describeCheck(check)}`),
                ...(typeof law.unenforced === 'string' ? [`- not fully covered: ${law.unenforced}`] : []),
              ]),
          '',
        ]),
    ].join('\n')
    files[`docs/specs/${zone.replace(/[^A-Za-z0-9_-]+/g, '-')}.spec.md`] = body
  }
  return { files, specHash }
}

/**
 * Renders one check as a short human-readable phrase.
 *
 * A command check describes itself by the command it runs and what it asserts
 * about the output, because the generated spec is the human view of the law: a
 * reader who sees "(no target)" for every command check is looking at a document
 * that names the law and hides what enforces it.
 *
 * @param check - A parsed check.
 * @returns A one-line description.
 */
function describeCheck(check) {
  if (typeof check.run === 'string') {
    const assertions = [
      typeof check.outputContains === 'string' ? `contains ${JSON.stringify(check.outputContains)}` : null,
      typeof check.outputNotContains === 'string' ? `excludes ${JSON.stringify(check.outputNotContains)}` : null,
      typeof check.outputMatches === 'string' ? `matches /${check.outputMatches}/` : null,
      check.stream === undefined ? null : `read from ${check.stream}`,
    ].filter((entry) => entry !== null)
    return assertions.length === 0 ? `run: ${check.run}` : `run: ${check.run} (${assertions.join(', ')})`
  }
  if (check.path !== undefined) return check.path
  if (check.pattern !== undefined) return check.pattern
  if (Array.isArray(check.patterns)) return check.patterns.join(', ')
  if (Array.isArray(check.paths)) return check.paths.join(', ')
  if (Array.isArray(check.deny)) return `deny ${check.deny.join(', ')}`
  return '(no target)'
}

/**
 * Confirms that a rendered spec file still matches its generated content.
 *
 * @param expectedText - The text `renderSpecs` would produce now.
 * @param actualText - The text on disk.
 * @returns `true` when the file is byte-identical, i.e. unmodified.
 */
export function specFileMatches(expectedText, actualText) {
  return normaliseText(expectedText) === normaliseText(actualText)
}

/**
 * Compares the persisted spec bundle with the one the corpus compiles to now.
 *
 * A persisted bundle that differs means the decisions changed without a compile,
 * or a compile failed and left the old bundle in place. Either way the bundle on
 * disk is not the current law, and anything reading it — including a verification
 * report written against it — is reasoning about a state the project has left.
 *
 * The comparison is by hash and by law id, so the message can say which law
 * appeared or disappeared rather than only that something differs.
 *
 * @param persisted - Parsed `.dsh/ratchet/specs.json`, or `null` when absent.
 * @param current - The bundle compiled now.
 * @returns `{ stale, problems, added, removed }`.
 */
export function comparePersistedBundle(persisted, current) {
  if (persisted === null) {
    return { stale: true, problems: [], added: [], removed: [] }
  }
  const persistedLaws = Array.isArray(persisted.laws) ? persisted.laws : null
  if (persistedLaws === null) {
    return {
      stale: true,
      added: [],
      removed: [],
      problems: [
        problem(
          'SPEC_OUT_OF_DATE',
          'the persisted spec bundle has no laws array, so it cannot be compared with the corpus; re-run ratchet_compile to rewrite it',
        ),
      ],
    }
  }

  const persistedHash = bundleHash({ version: persisted.version ?? SPEC_BUNDLE_VERSION, project: persisted.project, laws: persistedLaws })
  const currentHash = bundleHash(current)
  if (persistedHash === currentHash) {
    return { stale: false, problems: [], added: [], removed: [] }
  }

  const persistedIds = new Set(persistedLaws.map((law) => law.id))
  const currentIds = new Set(current.laws.map((law) => law.id))
  const added = [...currentIds].filter((id) => !persistedIds.has(id)).sort()
  const removed = [...persistedIds].filter((id) => !currentIds.has(id)).sort()
  const changed = current.laws
    .filter((law) => persistedIds.has(law.id))
    .filter((law) => {
      const before = persistedLaws.find((entry) => entry.id === law.id)
      return JSON.stringify(before.checks) !== JSON.stringify(law.checks) || before.statement !== law.statement
    })
    .map((law) => law.id)
    .sort()

  const detail = [
    added.length > 0 ? `added: ${added.join(', ')}` : null,
    removed.length > 0 ? `removed: ${removed.join(', ')}` : null,
    changed.length > 0 ? `changed: ${changed.join(', ')}` : null,
  ]
    .filter((entry) => entry !== null)
    .join('; ')

  return {
    stale: true,
    added,
    removed,
    problems: [
      problem(
        'SPEC_OUT_OF_DATE',
        `the persisted spec bundle hashes to ${persistedHash} but the corpus now compiles to ${currentHash}${detail.length === 0 ? '' : ` (${detail})`}; the bundle on disk is not the current law until ratchet_compile writes it`,
        null,
        { persistedHash, currentHash, added, removed, changed },
      ),
    ],
  }
}

/**
 * Reports the spec documents that are missing, edited, or out of date.
 *
 * Three distinct situations, three distinct codes: an EDITED document means a
 * human changed generated output; a MISSING one means the project tracks specs and
 * one has gone; a STALE one is unedited but was generated from older laws. A stale
 * document is the quietest of the three — it looks perfect and describes a law that
 * no longer exists — which is why the header stamp exists and why it is read.
 *
 * @param drift - Result of comparing generated text with disk.
 * @returns An array of problems; empty when every produced file matches.
 */
export function specDriftProblems(drift) {
  const problems = []
  for (const entry of drift?.drifted ?? []) {
    problems.push(
      problem(
        'SPEC_HASH_MISMATCH',
        `the generated spec document ${entry.path} has been edited since it was written (${entry.reason}); generated specs carry a DO NOT EDIT banner, so a hand edit desynchronises the document from the laws the code is checked against`,
        entry.path,
        { path: entry.path },
      ),
    )
  }
  for (const entry of drift?.stale ?? []) {
    problems.push(
      problem(
        'SPEC_OUT_OF_DATE',
        `the generated spec document ${entry.path} was written from spec ${entry.recorded} but the laws now hash to ${entry.wanted}; the document is unedited and describes decisions that are no longer in force, so regenerate it`,
        entry.path,
        { path: entry.path, recorded: entry.recorded, wanted: entry.wanted },
      ),
    )
  }
  for (const path of drift?.missing ?? []) {
    problems.push(
      problem(
        'SPEC_OUT_OF_DATE',
        `the generated spec document ${path} does not exist, so the human-readable view of the laws is missing; run the compile command with write enabled`,
        path,
        { path },
      ),
    )
  }
  return problems
}

/** Re-exported so a caller needs one import for the whole compile path. */
export { PROBLEM_CODES, AUTHORITIES }
