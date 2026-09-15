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
import { AUTHORITIES, CHECK_TARGET_FIELDS, MANIFEST_PATH, PROBLEM_CODES, RATCHET_DIR_DEFAULT, TERMINAL_ADR_STATUSES, globsMayOverlap, hashSource, normaliseText, parseAdr, parseRatchetConfig, problem, zonePathCovers } from './ratchet-schema.mjs'

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
      if (supersededBy.has(target)) continue
      const targetRecord = byId.get(target)
      // Consent is not durable if a supersession can do what an `op: remove` may not: retire a
      // whole record, and every law it contributed, in one line. The law loop below refuses an
      // agent-authored, unratified record that removes a law whose force came from a human
      // ratification. A supersession retires the record that DECLARES such laws, so it must meet
      // the same bar; a human-authored record is protected too, because retiring a person's
      // decision wholesale is a stronger act than removing one of its laws.
      const authorized = record.authority === 'human' || consents.has(record.id)
      if (
        !authorized &&
        targetRecord !== undefined &&
        (targetRecord.authority === 'human' || consents.has(targetRecord.id))
      ) {
        const consent = consents.get(targetRecord.id)
        problems.push(
          problem(
            'LAW_REMOVE_UNAUTHORISED',
            `${record.path} supersedes ${targetRecord.path}, whose force came from ${
              consent === undefined ? 'a human-authored decision' : `a human ratification (${consent.approvalId})`
            }; a ratification is not undone by an agent-authored record, however the zone that record sits in is governed. Ask a human to ratify the supersession, or retire the laws one by one with an explicit op: remove`,
            target,
            { path: record.path, supersedes: targetRecord.path },
          ),
        )
        continue
      }
      supersededBy.set(target, record.id)
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

    // Authority comes from the zones a record declares, so a law may not enforce
    // against a path those zones do not govern. Without this, declaring a permissive
    // zone grants authority over a path the manifest reserves to a human — the
    // declaration becomes a formality rather than the thing that grants power. Only a
    // positive target is checked: a law may legitimately READ outside its zone, and
    // refusing that would break honest records, but only a target it checks against
    // gives it power over the path.
    const declaredPaths = declaredZonePaths(record, config)
    for (const law of record.laws) {
      for (const check of law.checks ?? []) {
        for (const target of checkTargets(check, config)) {
          if (pathIsGoverned(target, declaredPaths)) continue
          problems.push(
            problem(
              'LAW_PATH_OUTSIDE_DECLARED_ZONE',
              `law "${law.id}" enforces against ${target}, which none of its record's declared zones govern (${record.zones.length === 0 ? 'the record declares no zone' : `declared: ${record.zones.join(', ')}`}); a law may only enforce inside the authority its record claims, or the zone declaration is not what grants it`,
              record.id,
              { path: record.path, lawId: law.id, target, zones: record.zones },
            ),
          )
        }
      }
    }

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
 * Every path a record's declared zones actually govern.
 *
 * `zonesForRecord` deliberately returns policy without paths, because authority is
 * the only thing activation needs. A law's target is a different question, and it
 * needs the paths — so this resolves the same declaration a second way rather than
 * widening the first. A zone the manifest does not declare contributes nothing: its
 * policy is a reported problem already, and inventing paths for it would let an
 * unknown zone grant authority.
 *
 * @param record - A parsed ADR record.
 * @param config - Parsed ratchet configuration.
 * @returns An array of zone path globs; empty when the record declares no zone, or
 *   only zones the manifest does not declare.
 */
export function declaredZonePaths(record, config) {
  const zones = config?.zones ?? []
  const declared = []
  for (const entry of zonesForRecord(record, config)) {
    if (entry.missing === true) continue
    const zone = zones.find((candidate) => candidate.id === entry.id)
    if (zone !== undefined) declared.push(...(zone.paths ?? []))
  }
  return declared
}

/**
 * Whether any of a record's declared zone globs covers a law's target path.
 *
 * The two sides are compared the way `validateZones` already compares zone globs:
 * a trailing `/**` is a prefix claim, and containment counts in either direction so
 * that a target naming a directory is covered by a zone naming a file inside it.
 *
 * @param target - A positive glob or path from a law's check.
 * @param zonePaths - Zone path globs from {@link declaredZonePaths}.
 * @returns `true` when the target falls inside the declared authority.
 */
export function pathIsGoverned(target, zonePaths) {
  const clean = normaliseGlobPath(target)
  // A target that climbs above the repository root is not a path the project can govern,
  // whatever it names. `plugins/../rules/**` resolves to `rules/**` — outside a zone of
  // `plugins/**` — and comparing the two as strings accepted it, because the text began
  // with the zone's prefix. The verifier happens not to normalise `..` either, so such a
  // target matches no walked file and enforces nothing; that makes it inert, not
  // authorised, and a target the compiler cannot place is refused rather than trusted.
  if (clean.escaped) return false
  // Containment is ONE-WAY — the target must fall inside the zone — and it is decided by the SAME
  // predicate `zoneFor` places a file with. It was a second implementation here, and the two
  // disagreed in both directions: a zone declaring `src/auth` governed a write in the guard and
  // was invisible to this check, while a zone with a wildcard mid-path was governed by the guard
  // and refused here. The reverse test — "is the zone inside the target?" — was removed earlier
  // for a different reason: a law whose target was `plugins/**` was accepted by a record that
  // declared only `plugins/demo/**`, and then enforced on `plugins/other/**`, outside the
  // authority that record claimed. A target broader than the zone reaches outside it by
  // construction and must be refused, not accommodated.
  return (zonePaths ?? []).some((entry) => zonePathCovers(entry, clean.path))
}

/**
 * A target glob with `.` and `..` segments resolved lexically.
 *
 * Lexical, not filesystem: the target names files that may not exist yet, and a check is
 * a claim about paths rather than about the tree at this instant. A backslash is left
 * alone rather than treated as a separator, because the verifier's matcher does not treat
 * it as one — normalising it here would make the cross-check accept a target the matcher
 * reads as a single literal filename.
 *
 * @param value - A target path or glob.
 * @returns `{ path, escaped }`. `escaped` is true when the target climbs above the root,
 *   which no zone can govern.
 */
export function normaliseGlobPath(value) {
  const parts = String(value).replace(/^\.\//, '').split('/')
  const out = []
  let escaped = false
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) escaped = true
      else out.pop()
      continue
    }
    out.push(part)
  }
  return { path: out.join('/'), escaped }
}

/**
 * Every positive path target a check enforces against, whichever field holds it.
 *
 * A check names its target in one of four places, and the field depends on the type:
 * `paths` for the text checks, the singular `path` for the file checks
 * (`required_file`, `forbidden_file`, `required_file_in_list`), `pattern` for the glob
 * checks where it is a path glob rather than a regex, and for `path_boundary` both the
 * `deny` list and the paths of the ZONE it constrains. Missing a field is how this rule
 * was evaded twice: a `required_file` on `path:` was invisible while only `paths` was
 * read, and a `path_boundary` was invisible while `deny` and `zone` were not read at
 * all.
 *
 * A `path_boundary` is worth spelling out, because it makes two path claims at once: it
 * denies files under the named zone anything matching `deny`. Both halves reach into a
 * path, so both are targets — the `deny` patterns themselves, and the zone's own paths,
 * resolved through the manifest. A record that constrains another zone while declaring
 * only its own has reached outside its authority whichever half you look at.
 *
 * Dependency checks name packages, not paths, so `patterns` is not a target and is
 * deliberately not read. Negations are exclusions, not claims, and are skipped.
 *
 * @param check - One parsed check.
 * @param config - Parsed ratchet configuration, used to resolve a `path_boundary`'s
 *   zone to the paths it governs. A zone the manifest does not declare contributes
 *   nothing here; the verifier reports `LAW_ZONE_MISSING` for it.
 * @returns An array of target paths or globs; empty when the check enforces on none.
 */
export function checkTargets(check, config = null) {
  const targets = []
  for (const field of CHECK_TARGET_FIELDS[check.type] ?? []) {
    // Not a field on the check: the paths of the zone the check names, resolved through
    // the manifest. A zone the manifest does not declare contributes nothing — the
    // verifier reports `LAW_ZONE_MISSING` for it.
    if (field === 'zonePaths') {
      const zone = (config?.zones ?? []).find((candidate) => candidate.id === check.zone)
      for (const entry of zone?.paths ?? []) {
        if (typeof entry === 'string' && entry.length > 0 && !entry.startsWith('!')) targets.push(entry)
      }
      continue
    }
    const value = check[field]
    const entries = Array.isArray(value) ? value : [value]
    for (const entry of entries) {
      if (typeof entry === 'string' && entry.length > 0 && !entry.startsWith('!')) targets.push(entry)
    }
  }
  return targets
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
  // Law ids an active record retires by an explicit `remove` op. Collected rather
  // than derived later, because once the bundle is built the difference between a
  // retirement and a deletion has already been erased.
  const retired = new Set()
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
        retired.add(law.id)
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
        // The same law id declared by two records is ONE law, and it is bound to the union of the
        // zones both records named. Only the first record's zones used to survive, so a contradicted
        // law in force in two zones blocked only the first record's zone and a write in the second
        // went through — while the law's own statement claims to govern both.
        for (const zoneId of record.zones ?? []) {
          if (!existing.zones.includes(zoneId)) existing.zones.push(zoneId)
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
    // Which laws an active record explicitly retires. Returned because "a law is
    // gone" and "a law was retired" are different facts, and only the corpus knows
    // the second: a caller comparing law sets against history needs it to tell a
    // deliberate retirement from a deletion.
    removedByDecision: [...retired],
  }
}

/**
 * Audits every `resolves` list against the corpus.
 *
 * A resolution is an ordinary record that settles a conflict by removing the losing laws
 * and superseding the losing record; `resolves` names BOTH sides so a reader can audit
 * which conflict was settled and by what. The form of the list is judged by `parseAdr`,
 * because it is a property of one file. The two questions here are properties of the
 * corpus: does an id name a record at all, and is that record one of the two sides — a
 * record holding force, or one on its way out of it?
 *
 * "Leaving force" is judged from what the corpus and THIS record declare, not only from
 * what is already true, because a resolution has to be writable before it can be ratified.
 * A record is leaving force when a record in force supersedes it, when a record in force
 * removes one of its laws, or when this resolution supersedes it or removes one of its
 * laws. Reading it any other way made the mechanism unusable in the flow it exists for: a
 * proposed resolution is not in force yet, so it cannot have already emptied the record it
 * names, and a check that demanded the emptiness first would refuse every resolution until
 * after the moment it was needed.
 *
 * @param records - Parsed ADR records.
 * @param options - `{ active, removedByDecision }`: the records in force, and the law ids an
 *   active record retires with an explicit `op: remove` (both from `resolveActiveSet` and
 *   `compileLaws`). Both default to empty, which makes every side "not leaving" — a caller
 *   that has not resolved the corpus gets refusals rather than silent passes.
 * @returns An array of problems; empty when every resolution names two sides that exist and
 *   that hold or are losing force.
 */
export function validateResolutions(records, { active = [], removedByDecision = [] } = {}) {
  const problems = []
  const byId = new Map(records.map((record) => [record.id, record]))
  const inForce = new Set((active ?? []).map((record) => record.id))
  const removed = new Set(removedByDecision ?? [])

  for (const record of records) {
    for (const target of record.resolves ?? []) {
      const named = byId.get(target)
      if (named === undefined) {
        problems.push(
          problem(
            'ADR_RESOLVES_DANGLING',
            `${record.path} resolves "${target}", which is not the id of any ADR in this project; a resolution of a record nobody wrote settles nothing, and the corpus cannot audit which conflict it was about`,
            record.id,
            { path: record.path, target },
          ),
        )
        continue
      }
      if (inForce.has(target)) continue
      const supersededByForce = named.supersededBy !== null && named.supersededBy !== undefined
      const emptiedByForce = named.laws.some((law) => law.op === 'upsert' && removed.has(law.id))
      const supersededHere = (record.supersedes ?? []).includes(target)
      const emptiedHere = (record.laws ?? []).some(
        (law) => law.op === 'remove' && named.laws.some((declared) => declared.op === 'upsert' && declared.id === law.id),
      )
      if (supersededByForce || emptiedByForce || supersededHere || emptiedHere) continue
      problems.push(
        problem(
          'ADR_RESOLVES_OUTSIDE_FORCE',
          `${record.path} resolves "${target}" (${named.path}), which is neither in force nor leaving it: no record in force supersedes it or removes one of its laws, and this resolution neither supersedes it nor removes one of its laws, so the record named is standing exactly where it was and the conflict the resolution claims to settle is not the one the corpus has`,
          record.id,
          { path: record.path, target, targetPath: named.path, targetStatus: named.status },
        ),
      )
    }
  }
  return problems
}

/**
 * Requires a record a decision retired to say so, and a retired record to hold nothing in
 * force.
 *
 * Both halves exist because a reader follows the FILES, not the compiler. The first: a
 * record a resolution took out of force, whose laws are therefore all out of force too, is
 * retired, and its frontmatter has to say so — otherwise a reader finds a record that looks
 * live and governs nothing, which is exactly the state ADR 0031 exists to make visible. The
 * second: a record that says `superseded`, `rejected` or `withdrawn` must not still be the
 * SOURCE of a law in force, or the corpus is governing by a decision it has retired.
 *
 * The FIRST half fires on a record another record in force supersedes AND that contributes
 * no law to the bundle. Supersession is the signal, not an `op: remove` of the last law,
 * and that is a measured property of the machinery rather than a preference: a law can only
 * be removed while the record declaring it is in force, so a record whose laws were all
 * removed one by one is still in force — and marking it terminal makes every one of those
 * removals `LAW_TARGET_DANGLING`, because a terminal record contributes no law to remove.
 * There is therefore no green corpus in which a fully removed record carries a terminal
 * status, and a check that demanded one would be a rule nobody can satisfy. A resolution
 * that retires a record says so with `supersedes`; removing individual laws remains the
 * partial tool it is. The case the machinery cannot express is recorded in ADR 0031's
 * consequences rather than enforced here.
 *
 * The second half deliberately asks whether the record is the source of the law, not
 * whether a law with one of its ids is in force. Two records may re-declare one law id with
 * an identical statement, and the compiler merges them into a single law bound to the union
 * of both records' zones — so a retired record's statement can legitimately still hold,
 * declared by the record that replaced it. What may not survive is the retired record's own
 * contribution, because force that outlives its source is the retirement failing silently.
 *
 * @param records - Parsed ADR records.
 * @param bundle - The compiled spec bundle, or `null` when the corpus did not compile.
 * @param options - Unused by this audit today; accepted so its call shape matches the other
 *   corpus audits and a later rule that needs retired law ids does not change every caller.
 * @returns An array of problems; empty when every retired record is terminal and no terminal
 *   record is the source of a law in force. A `null` bundle yields an empty result rather
 *   than a throw, because a compile that could not build a bundle has already reported why.
 */
export function validateRetirement(records, bundle) {
  const problems = []
  if (bundle === null || bundle === undefined) return problems
  const laws = bundle.laws ?? []
  const liveById = new Map(laws.map((law) => [law.id, law]))

  for (const record of records) {
    if (record.type !== 'adr') continue
    const upserts = record.laws.filter((law) => law.op === 'upsert')
    if (TERMINAL_ADR_STATUSES.includes(record.status)) {
      const stillSourced = upserts.filter((law) => liveById.get(law.id)?.sourceAdr === record.id)
      if (stillSourced.length > 0) {
        problems.push(
          problem(
            'TERMINAL_RECORD_DECLARES_LIVE_LAW',
            `${record.path} declares status "${record.status}" and is still the source of ${stillSourced.map((law) => `"${law.id}"`).join(', ')} in force; a reader who trusts the status stops following this record while the gate keeps enforcing it, so either the status is wrong or the law should have left force with it`,
            record.id,
            { path: record.path, status: record.status, laws: stillSourced.map((law) => law.id) },
          ),
        )
      }
      continue
    }
    if (upserts.length === 0) continue
    const superseded = record.supersededBy !== null && record.supersededBy !== undefined
    if (!superseded) continue
    const allOut = upserts.every((law) => !liveById.has(law.id))
    if (!allOut) continue
    problems.push(
      problem(
        'RETIREMENT_STATUS_MISSING',
        `${record.path} was superseded by ${record.supersededBy} and every law it declares is out of force, but its status is "${record.status}"; a retired record has to say so in its own frontmatter — set a terminal status (${TERMINAL_ADR_STATUSES.join(', ')}) so a reader is not left following a decision whose laws no longer hold`,
        record.id,
        {
          path: record.path,
          status: record.status,
          supersededBy: record.supersededBy ?? null,
          laws: upserts.map((law) => law.id),
        },
      ),
    )
  }
  return problems
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
          // The one overlap test that sees every shape a declaration can take: the old prefix
          // comparison missed a whole-repository `**` (which covers everything) and a mid-path
          // wildcard such as `**/auth/**`. `globsMayOverlap` is deliberately conservative.
          const overlaps = globsMayOverlap(a, b)
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

  // Two audits that need the whole corpus and the compiled bundle, so they run here rather
  // than inside either half. `validateResolutions` asks whether each `resolves` list names
  // two sides that exist and that hold or are losing force; `validateRetirement` asks that a
  // record a decision emptied says it is retired, and that a retired record sources no law
  // in force.
  problems.push(...validateResolutions(corpus.records, { active: resolved.active, removedByDecision: compiled.removedByDecision }))
  problems.push(...validateRetirement(corpus.records, compiled.bundle))

  report.problems = problems
  report.specHash = bundleHash(compiled.bundle)

  return {
    ok: problems.length === 0,
    report,
    bundle: compiled.bundle,
    problems,
    // Forwarded from `compileLaws` because it is a fact about the corpus, not about the
    // bundle: once the bundle is built, a law retired by a decision and a law deleted
    // from the corpus are both simply absent.
    removedByDecision: compiled.removedByDecision,
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
export function renderSpecs(bundle, specsDir = 'docs/specs') {
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
    // The MANIFEST's specs directory. It used to be hardcoded to `docs/specs` while every READER
    // — `tracksSpecDocuments`, `detectSpecDrift`, the guard — resolved `config.specsDir`, so a
    // project that declared any other directory had its compile write to `docs/specs`, its verify
    // report every spec as MISSING, and no way to become green: the failure was blamed on the
    // project, and re-running the compile it prescribed wrote to the same wrong place again.
    // The name is injective because a zone id is restricted to [A-Za-z0-9_-] at parse time: the
    // replacement is then the identity, so two zones cannot share one file and drop a zone's laws.
    files[`${String(specsDir).replace(/\/+$/, '')}/${zone.replace(/[^A-Za-z0-9_-]+/g, '-')}.spec.md`] = body
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
 * Four distinct situations, four distinct codes: an EDITED document means a human
 * changed generated output; a MISSING one means the project tracks specs and one has
 * gone; a STALE one is unedited but was generated from older laws; and an ORPHANED one
 * is current-looking and simply belongs to no law in force, which is what renaming or
 * removing a zone leaves behind. The stale document is the quietest of the first three
 * — it looks perfect and describes a law that no longer exists — which is why the
 * header stamp exists and why it is read. The orphan is quieter still: nothing in the
 * current bundle names it, so a comparison driven by the bundle never looks at it.
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
  for (const entry of drift?.orphaned ?? []) {
    problems.push(
      problem(
        'SPEC_ORPHANED',
        `the generated spec document ${entry.path} records spec ${entry.recorded ?? 'no hash'} and no decision in force generates it any more; a zone that was renamed or removed left its document behind, and the document describes laws that no longer exist`,
        entry.path,
        { path: entry.path, recorded: entry.recorded ?? null },
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
