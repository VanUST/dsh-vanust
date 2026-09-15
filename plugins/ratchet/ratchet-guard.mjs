/**
 * Ratchet guard: refuse a write into a regulated zone that has no decision behind it,
 * or one whose only decision contradicts law a human already ratified.
 *
 * This is the piece that makes `requiresDecisionRecord` an actual rule rather than
 * a parsed manifest field nobody reads. The design's Part 17 says an architectural
 * change must have an ADR; until this existed, nothing failed when it did not, so
 * the rule was prose with a confident tone.
 *
 * **It is a `tools/pre-execute` guard, not a tool.** A tool is advisory — the model
 * may not call it. A guard sits in the dispatch pipeline after every extensible
 * pre-execute listener and before the tool body, and a reason it returns denies the
 * call. That is the difference between asking an agent to check something and
 * making the check happen.
 *
 * Four decisions shape it, each because the opposite would make the guard hostile:
 *
 * 1. **Inert unless the manifest asks.** No `.dsh/project.json`, no `ratchet`
 *    section, or no zone with `requiresDecisionRecord: true` means the guard allows
 *    everything and costs one file read. A guard that surprises a project that never
 *    opted in gets switched off, and a switched-off guard enforces nothing.
 * 2. **The ratchet's own files are never regulated.** Writing the ADR is how a
 *    contributor satisfies the rule, and a guard that blocks `.dsh/project.json`,
 *    the decisions directory or the sources directory would make the rule
 *    unsatisfiable.
 * 3. **A denial names the fix.** The message says which zone, which path, and what
 *    to create — an agent that cannot act on a refusal will retry it or route
 *    around it.
 * 4. **Only writes are guarded.** Reads, searches and shell commands that do not
 *    obviously write are allowed: guessing that a shell command mutates a file would
 *    refuse work the guard cannot actually see, and a false denial is worse than a
 *    missed one for a rule whose violator is already visible in the diff.
 * 6. **A judge's contradiction is checked first, and is not gated on the zone rule.** The block a
 *    judge creates is enforced before the inert answer and before `requiresDecisionRecord`, because
 *    a zone's record rule is opt-in per zone while a judge reporting that a change contradicts a
 *    decision is the price of enabling the ratchet at all. It is resolved through the same
 *    `zoneFor` the zone rule uses, so a path the zone table does not cover cannot dodge it.
 *
 * 5. **A proposal is enough, and a contradiction is not.** The rule exists to make an
 *    agent write down what it is doing, not to make it wait: a PROPOSED agent decision
 *    naming a zone licenses the write while contributing nothing to law, so an agent can
 *    work for an hour and a human can ratify, change or decline the record afterwards.
 *    The one thing that stops is a proposal that contradicts law ALREADY IN FORCE —
 *    a removal, or the same law id with a different statement — because that is a
 *    decision the agent is not entitled to make. Only the decidable form of a
 *    contradiction can be caught here (the guard runs before every write and asks no
 *    model); a contradiction only a reader can see stays with `ratchet_compile` and
 *    `ratchet_review`, and is reported as such rather than pretended.
 *
 * The cost is bounded by a cache keyed on the corpus's own hashes, so a session
 * making many edits inside one zone reads the decisions once.
 */
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { MANIFEST_PATH, zoneFor } from './ratchet-schema.mjs'
import { compileLaws, readAdrCorpus, readManifest, resolveActiveSet } from './ratchet-compiler.mjs'
import { CONTRADICTION_PATH, blockedZones, standingContradictions } from './ratchet-contradiction.mjs'

/**
 * Tool names whose arguments name a path they are about to change.
 *
 * `read` is deliberately absent: reading a file in a regulated zone without a
 * decision record is legitimate reconnaissance, and refusing it would make the
 * guard the thing that prevents a contributor from learning what to write.
 *
 * `str_replace_editor` is present because it is a real writer in this harness (its
 * client half is what the deliverables plugin reads to find a produced file) and its
 * argument is `path`. It is opt-in and not mounted in every profile, which is exactly
 * why the omission was easy to miss: a name-based allow-list only governs the tools
 * somebody thought to list, so an unlisted writer is a rule that silently allows.
 */
export const WRITE_TOOLS = Object.freeze(['write', 'edit', 'notebook_edit', 'multi_edit', 'str_replace_editor'])

/**
 * One tool on that list writes only for SOME of its commands.
 *
 * `str_replace_editor` is `view` to read a file and `create` / `str_replace` / `insert` /
 * `undo_edit` to change one. Governing the name alone refused a read, which is the one thing
 * decision 4 above says must never be refused — reconnaissance is how a contributor learns
 * what to write. An UNKNOWN or missing command is still treated as a write: the safe reading
 * of a command nobody recognises is that it might change the file.
 */
export const READ_ONLY_EDITOR_COMMANDS = Object.freeze(['view'])

/** Argument keys, in priority order, that carry the target path. */
const PATH_ARGUMENTS = Object.freeze(['file_path', 'path', 'filePath', 'filename', 'notebook_path'])

/**
 * Decides whether the ratchet should govern a path at all, and says why not when
 * it should not.
 *
 * @param path - Repository-relative path with forward slashes.
 * @param config - Parsed ratchet configuration.
 * @returns `{ governed, reason }`. `reason` is a short phrase for the allow
 *   decision, so the guard's behaviour is explainable rather than merely permissive.
 */
export function governanceOf(path, config) {
  const decisionsDir = (config?.decisionsDir ?? 'docs/adrs').replace(/\/+$/, '')
  const sourcesDir = (config?.sourcesDir ?? 'docs/ratchet/sources').replace(/\/+$/, '')
  const stateDir = (config?.stateDir ?? '.dsh/ratchet').replace(/\/+$/, '')
  const reportsDir = (config?.reportsDir ?? 'reports/ratchet').replace(/\/+$/, '')
  const specsDir = (config?.specsDir ?? 'docs/specs').replace(/\/+$/, '')

  if (path === MANIFEST_PATH) return { governed: false, reason: 'the manifest itself is how a project opts in' }
  if (path.startsWith(`${decisionsDir}/`) || path === decisionsDir) {
    return { governed: false, reason: 'the decisions directory is where the record is written' }
  }
  if (path.startsWith(`${sourcesDir}/`) || path === sourcesDir) {
    return { governed: false, reason: 'the sources directory holds the reasoning a record cites' }
  }
  if (path.startsWith(`${stateDir}/`) || path === stateDir) {
    return { governed: false, reason: 'ratchet state is machine-written' }
  }
  if (path.startsWith(`${reportsDir}/`) || path === reportsDir) {
    return { governed: false, reason: 'ratchet reports are machine-written' }
  }
  if (path.startsWith(`${specsDir}/`) || path === specsDir) {
    return { governed: false, reason: 'generated spec documents are produced by compile' }
  }
  if (path.startsWith('.dsh/')) {
    return { governed: false, reason: 'harness configuration is not architecture' }
  }

  const zone = zoneFor(path, config?.zones ?? [])
  if (zone === null) return { governed: false, reason: 'the path belongs to no declared zone' }
  if (zone.requiresDecisionRecord !== true) {
    return { governed: false, reason: `zone "${zone.id}" does not require a decision record` }
  }
  return { governed: true, reason: null, zone }
}

/**
 * The denial a standing judge-classified contradiction produces.
 *
 * It carries the judge's OWN reasoning rather than a summary of it. The point of the block is that
 * whoever proposed the change reads WHY it was declined, and a guard that says "a judge disagreed"
 * without saying what about is one that gets worked around. It also names both routes out, because
 * a refusal with no route out is a bug report waiting to be filed: change the change, or put the
 * question to a human.
 *
 * @param path - The repository-relative path the call named.
 * @param zone - The zone it falls in.
 * @param contradiction - `{ entries, zones }` from `loadDecisionState`.
 * @returns The denial text.
 */
function contradictingDenial(path, zone, contradiction) {
  const lines = [
    `the ratchet refuses this write: ${path} is in zone "${zone.id}", where a judge classified a change as CONTRADICTING a decision in force.`,
    '',
  ]
  for (const { entry } of contradiction.entries) {
    for (const finding of entry.findings) {
      const source = finding.sourceAdr === undefined || finding.sourceAdr === null ? '' : ` (${finding.sourceAdr})`
      lines.push(`  - ${finding.lawId}${source}: ${finding.explanation}`)
      if (finding.suggestedAction !== undefined) lines.push(`      suggested: ${finding.suggestedAction}`)
    }
  }
  lines.push(
    '',
    'A semantic contradiction: the code can satisfy every written check and still invert what the',
    'decision was for. Autonomy ends here.',
    '',
    'Change the change so it stops contradicting that decision, then review it again — an',
    'independent clean verdict retires this block, and a block bound to a proposed record retires by',
    'itself when the record is edited. Or ask a human: this is a question the ratchet exists to put',
    'to them, and ratchet_ratify is how it is put.',
    '',
    'Nothing was written. .dsh/ratchet/contradiction.json is machine-written state: editing it by',
    'hand does not settle the question, it hides it.',
  )
  return lines.join('\n')
}

/**
 * Reads a project's decision state once and answers governance questions from it.
 *
 * The cache is keyed on the decisions directory's entries — each name with its size and
 * modification time — because that changes whenever a record is added, removed or
 * rewritten in place, which is exactly when a cached answer would be wrong. Hashing every
 * ADR would be more precise and costs a full read per write; the entry listing is enough
 * to notice every change that matters here, and it is the listing rather than the
 * directory's own mtime because editing a file does not touch its directory.
 *
 * Three answers, in precedence order, and the order is the whole policy:
 *
 * 1. **A proposed record contradicts a law in force.** Writes are refused. An agent
 *    may work ahead of a human's ratification, but not against what a human already
 *    ratified: a contradiction is the one place autonomy has to stop and ask, and it
 *    is the only case here that refuses anything. The check is deliberately the
 *    DECIDABLE part — a proposed record that removes a law in force, or redeclares one
 *    with a different statement — because a guard runs before every write and cannot
 *    ask a model. A contradiction only a reader can see is out of its reach, and
 *    `ratchet_compile` and `ratchet_review` are where that is surfaced. This answer is
 *    checked FIRST and applies even to a zone a decision already covers: the point is to
 *    ask a human before working against what they ratified, and an in-force decision in
 *    the same zone does not make the contradiction go away.
 * 2. **A decision in force covers the zone.** Writes are allowed; this is what the
 *    rule asked for and it settles the question.
 * 3. **A proposed record names the zone.** Writes are allowed, and NOTHING about the
 *    proposal is law: `compileLaws` is fed `resolved.active` only, so a proposal adds
 *    no law, no spec and no check. This is the autonomy the rule exists for — an agent
 *    proposes, keeps working, and a human later ratifies, changes or declines it — and
 *    it is why a proposal is enough to satisfy the rule while contributing nothing.
 *
 * A `humanOnly` zone is deliberately excluded from (3): an agent's proposal can never
 * become law there (the compiler refuses it even when ratified), so letting a proposal
 * license a write would let an agent govern a zone the manifest reserves to humans by
 * writing a file the ratchet then refuses to activate. Only a decision IN FORCE opens
 * such a zone, which a human reaches by writing a human-authored record.
 *
 * @param root - Absolute project root.
 * @returns `{ config, governedZones, zonesWithRecords, licenceByZone, conflictsByZone,
 *   problems, decisionsDir }` or `{ inert }` when the project has not opted in.
 *   `licenceByZone` maps a zone id to the proposed record that licensed it;
 *   `conflictsByZone` maps a zone id to the contradictions found, each
 *   `{ adrId, path, lawId, why }`.
 */
export function loadDecisionState(root) {
  const manifest = readManifest(root)
  if (manifest.config === null || manifest.config.enabled !== true) {
    return { inert: true, reason: 'the project has no enabled ratchet section' }
  }
  const config = manifest.config

  const corpus = readAdrCorpus(root, config)
  const resolved = resolveActiveSet(corpus.records, config)

  // The judged-contradiction block, computed BEFORE the zone rule is consulted. A zone's
  // `requiresDecisionRecord` is opt-in per zone; a judge reporting that a change contradicts a
  // decision is the price of enabling the ratchet at all, so this answer is not gated on it —
  // otherwise a project could enable the ratchet, have a judge decline a change, and be told
  // nothing because every zone happened to leave the record rule off.
  const compiledForContradiction = compileLaws(resolved.active, config)
  const standing = standingContradictions(root, { resolved })
  const contradiction =
    standing.length === 0
      ? null
      : {
          entries: standing,
          zones: blockedZones(standing, {
            active: resolved.active,
            proposed: resolved.proposed,
            laws: compiledForContradiction.bundle.laws,
          }),
        }

  const governedZones = (config.zones ?? []).filter((zone) => zone.requiresDecisionRecord === true)
  if (governedZones.length === 0) {
    return { inert: true, reason: 'no zone declares requiresDecisionRecord', config, contradiction }
  }

  // (1) Only decisions IN FORCE satisfy the requirement outright. A proposal is intent,
  // not law: it never compiles, so it can never be what a check enforces.
  //
  // The law set comes from the COMPILER, not from a second reading of the records. This
  // started as a local loop over `resolved.active` that skipped `op: remove` and did not
  // know about the removal-authority rule, and it disagreed with `compileLaws` in exactly
  // the way a duplicate implementation does: a law an in-force record had RETIRED was still
  // treated as in force here, so a proposal that redeclared it was refused as a
  // contradiction — a guard denying work over a law the corpus no longer contains. Asking
  // the compiler cannot drift from it, and the compiler already resolves removals, a
  // removal an agent record is not allowed to make, and a law two active records contest.
  const zonesWithRecords = new Set()
  for (const record of resolved.active) {
    for (const zone of record.zones ?? []) zonesWithRecords.add(zone)
  }
  const compiled = compiledForContradiction
  const inForceLaws = new Map(
    compiled.bundle.laws.map((law) => [law.id, { statement: law.statement, sourceAdr: law.sourceAdr }]),
  )

  // (2) and (3), from the records a human has not decided yet.
  const licenceByZone = new Map()
  const conflictsByZone = new Map()
  const authorityByZone = new Map((config.zones ?? []).map((zone) => [zone.id, zone.agentAuthority ?? config.defaultAgentAuthority]))
  for (const record of resolved.proposed) {
    const conflicts = []
    for (const law of record.laws ?? []) {
      const existing = inForceLaws.get(law.id)
      if (existing === undefined) continue
      if (law.op === 'remove') {
        conflicts.push({
          adrId: record.id,
          path: record.path,
          lawId: law.id,
          why: `it removes law "${law.id}", which ${existing.sourceAdr} put in force`,
        })
      } else if (existing.statement !== law.statement) {
        conflicts.push({
          adrId: record.id,
          path: record.path,
          lawId: law.id,
          why: `it redeclares law "${law.id}" as ${JSON.stringify(law.statement)}, where ${existing.sourceAdr} put ${JSON.stringify(existing.statement)} in force`,
        })
      }
    }
    const zones = record.zones ?? []
    if (conflicts.length > 0) {
      // A proposal that contradicts law in force stops writes in the zones it names,
      // whether or not those zones are already governed: the point is to ask a human
      // before working against what they ratified, and that is true either way. A
      // conflict with no zone is not this guard's business — the compiler reports it.
      for (const zoneId of zones) {
        const existing = conflictsByZone.get(zoneId) ?? []
        conflictsByZone.set(zoneId, existing.concat(conflicts))
      }
      continue
    }
    for (const zoneId of zones) {
      if (authorityByZone.get(zoneId) === 'humanOnly') continue
      if (!licenceByZone.has(zoneId)) licenceByZone.set(zoneId, { adrId: record.id, path: record.path })
    }
  }

  return {
    config,
    governedZones,
    zonesWithRecords,
    licenceByZone,
    conflictsByZone,
    problems: corpus.problems,
    decisionsDir: config.decisionsDir,
    contradiction,
  }
}

/**
 * Extracts the repository-relative path a tool call is about to change.
 *
 * @param exec - The pending call's execution identity and parsed arguments.
 * @param root - Absolute project root.
 * @returns The repository-relative path with forward slashes, or `null` when the
 *   call does not name one — which the guard treats as "not governed" rather than
 *   guessing.
 */
export function changedPath(exec, root) {
  const args = exec?.arguments
  if (args === null || typeof args !== 'object') return null
  for (const key of PATH_ARGUMENTS) {
    const value = args[key]
    if (typeof value !== 'string' || value.length === 0) continue
    const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value)
    // Resolve FIRST, judge second. Comparing the lexical path against the project root before
    // resolving meant a path that READS as outside was never resolved at all, and two shapes
    // walked into governed zones through that gap: an absolute path spelled through the
    // project's real location when the root itself is a symlink, and a symlink OUTSIDE the
    // project pointing into a governed zone. In both the backend's target was inside the zone
    // and the guard answered before asking the filesystem. `resolvedInside` gives the same
    // answer for both spellings, and returns null for a path that genuinely leaves the project,
    // which the guard reads as "not its business" — the same answer a plain outside path gets.
    return resolvedInside(absolute, root)
  }
  return null
}

/**
 * Resolves a path through symlinks and returns it relative to the project, or `null` when it
 * leaves the project or cannot be resolved.
 *
 * The deepest EXISTING ancestor is resolved and the rest is re-appended, because a write
 * creates its target and the target therefore usually does not exist yet — resolving the whole
 * path would fail on exactly the calls this guard has to judge. A path whose real location is
 * outside the project returns `null`, which the guard reads as "not its business". There is no
 * separate lexical test: comparing the string first is what let a symlinked root and an outside
 * alias into governed zones, because it answered before this function could resolve them.
 *
 * @param absolute - The resolved-but-not-real path the call named.
 * @param root - Absolute project root.
 * @returns Repository-relative path with forward slashes, or `null`.
 */
function resolvedInside(absolute, root) {
  try {
    const realRoot = realpathSync(root)
    let head = absolute
    const tail = []
    while (!existsSync(head)) {
      const parent = dirname(head)
      if (parent === head) return null
      tail.unshift(basename(head))
      head = parent
    }
    const realHead = realpathSync(head)
    const real = tail.length === 0 ? realHead : join(realHead, ...tail)
    const relativePath = relative(realRoot, real).split('\\').join('/')
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null
    return relativePath
  } catch {
    return null
  }
}

/**
 * Builds the guard function the harness dispatches through.
 *
 * @param options - `{ root }` — the project the guard governs.
 * @returns A `ToolGuard`: a synchronous function returning a denial reason or
 *   `undefined`. Never throws; a guard that throws would deny calls for a reason
 *   nobody can read.
 */
export function createGuard({ root }) {
  /** Cache of decision state, invalidated when the decisions directory changes. */
  let cache = null
  let cachedSignature = null

  /**
   * A cheap signature of the decisions directory: name, size, mtime and ctime per entry.
   *
   * The DIRECTORY's own mtime is not enough, and believing it was a defect this file
   * shipped for a while: rewriting an existing record in place does not touch the
   * directory, so an agent that EDITED a proposal to remove a contradiction it had
   * introduced went on being refused until something unrelated altered the directory or
   * the session restarted. Reading the entries costs one `readdir` per write and is the
   * difference between "the corpus changed" being observed and being assumed.
   */
  const signatureOf = (decisionsDir) => {
    const directory = join(root, decisionsDir)
    if (!existsSync(directory)) return 'absent'
    try {
      return readdirSync(directory)
        .sort()
        .map((name) => {
          try {
            // Nanosecond mtime for resolution, and `ctimeNs` because it is the one field a
            // writer cannot set: a rewrite that restores the mtime to its old value — how a
            // same-size edit hides — still moves the inode's change time. Milliseconds of
            // mtime alone were measured missing 30 stale ALLOWs and 29 stale DENYs across 400
            // same-size rewrites, and a deterministic fixture that forced the mtime back made
            // a contradicting proposal invisible.
            const stats = statSync(join(directory, name), { bigint: true })
            return `${name}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}:${stats.ino}`
          } catch {
            return `${name}:unreadable`
          }
        })
        .join('|')
    } catch {
      return 'unreadable'
    }
  }

  /**
   * Returns the decision state, re-reading it when the manifest or the corpus changed.
   *
   * The manifest's contribution to the key is its PARSED CONFIG, not a `stat`: the guard's
   * answer depends on the zones table and `defaultAgentAuthority`, and `stateNow` already
   * parsed the file, so stringifying what it read is exact where a size-plus-mtime is a
   * guess about clock resolution. Keying on the decisions directory alone meant flipping a
   * zone's `requiresDecisionRecord`, or its `agentAuthority`, or the manifest default, was
   * invisible to a running session — a stale allow where the operator had just asked for a
   * denial, and a stale denial where they had just lifted one.
   */
  /**
   * A cheap signature of one machine-written file, or `'absent'`.
   *
   * The judged-contradiction record is part of the state this guard answers from, and it lives
   * OUTSIDE the decisions directory — so a cache keyed only on the corpus would not notice a judge
   * recording a contradiction, and a block would not take effect until something unrelated changed
   * the corpus. A block that only works after an unrelated edit is not a block.
   */
  const fileSignature = (relativePath) => {
    try {
      const stats = statSync(join(root, relativePath), { bigint: true })
      return `${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`
    } catch {
      return 'absent'
    }
  }

  const stateNow = () => {
    const manifest = readManifest(root)
    const decisionsDir = manifest.config?.decisionsDir ?? 'docs/adrs'
    const policy = manifest.config === null || manifest.config === undefined ? 'none' : JSON.stringify(manifest.config)
    const signature = `${policy}|${decisionsDir}:${signatureOf(decisionsDir)}|${CONTRADICTION_PATH}:${fileSignature(CONTRADICTION_PATH)}`
    if (cache !== null && cachedSignature === signature) return cache
    cache = loadDecisionState(root)
    cachedSignature = signature
    return cache
  }

  return (exec) => {
    try {
      const name = exec?.name
      if (typeof name !== 'string' || !WRITE_TOOLS.includes(name)) return undefined
      // A tool that writes only for some of its commands is read for the others, and a read is
      // reconnaissance rather than a change — see `READ_ONLY_EDITOR_COMMANDS`.
      if (name === 'str_replace_editor' && READ_ONLY_EDITOR_COMMANDS.includes(exec?.arguments?.command)) {
        return undefined
      }

      const state = stateNow()
      const path = changedPath(exec, root)
      if (path === null) return undefined

      // A judge's contradiction is checked FIRST, before the inert answer and before the zone
      // rule, and it is resolved by the same `zoneFor` that places a file — so a path the zone
      // table does not cover cannot dodge it.
      const contradiction = state.contradiction
      if (contradiction !== null && contradiction !== undefined && contradiction.zones.size > 0) {
        const judgedZone = zoneFor(path, state.config?.zones ?? [])
        if (judgedZone !== null && contradiction.zones.has(judgedZone.id)) {
          return contradictingDenial(path, judgedZone, contradiction)
        }
      }

      if (state.inert === true) return undefined

      const governance = governanceOf(path, state.config)
      if (governance.governed !== true) return undefined

      const zone = governance.zone
      // A contradiction comes first, before the in-force and proposal answers, because an
      // in-force decision in the same zone does not make the contradiction go away.
      const conflicts = state.conflictsByZone.get(zone.id)
      if (conflicts !== undefined && conflicts.length > 0) {
        return [
          `the ratchet refuses this write: a decision that is PROPOSED — not in force — contradicts law that is in force in zone "${zone.id}".`,
          ``,
          ...conflicts.map((entry) => `  - ${entry.adrId} (${entry.path}): ${entry.why}`),
          ``,
          `An agent may work ahead of a ratification, but not against what a human already ratified.`,
          `Autonomy stops here: resolve the contradiction before writing more in this zone —`,
          `  - edit or withdraw the proposal so it no longer contradicts the law in force, or`,
          `  - ask a human to ratify it, which is a decision this guard cannot make for them.`,
          ``,
          `Nothing was written. Once the proposal stops contradicting law in force, this denial`,
          `disappears on its own: the contradiction is recomputed from the corpus on every write.`,
        ].join('\n')
      }
      if (state.zonesWithRecords.has(zone.id)) return undefined
      const licence = state.licenceByZone.get(zone.id)
      if (licence !== undefined) return undefined

      // The denial has to be actionable: which zone, which path, and the smallest
      // thing that satisfies the rule.
      return [
        `the ratchet refuses this write: ${path} is in zone "${zone.id}", which the project manifest declares`,
        `requiresDecisionRecord, and no ADR — in force or proposed — names that zone.`,
        ``,
        `Create an ADR under ${state.decisionsDir}/ (the manifest declares that directory) with:`,
        `  - zones: [${zone.id}]`,
        `  - a non-empty "## Reasoning" section`,
        `  - a "source" pointing at the file the reasoning came from, with its sha256`,
        `    (compute it with: node <kit>/plugins/ratchet/ratchet-cli.mjs hash <file>)`,
        `  - author.authority, and status: active only if a human wrote it — an agent`,
        `    decision in a zone with agentAuthority proposeOnly must stay proposed until`,
        `    a human approval ADR names it.`,
        ``,
        `A PROPOSED record is enough to write here, and it adds no law: the ratchet compiles`,
        `only decisions in force, so an agent can propose, keep working, and let a human`,
        `ratify, change or decline the proposal later. What it may NOT do is contradict law`,
        `already in force, in this zone or in that record's other zones.`,
        ``,
        `Then call ratchet_compile to confirm it compiles. Writes inside the decisions`,
        `and sources directories are never refused, so the record can be created.`,
      ].join('\n')
    } catch (error) {
      // A guard that throws would deny an unrelated call for an unreadable reason.
      // Reporting and allowing keeps a broken guard from becoming a broken session.
      process.stderr.write(`ratchet: guard failed for ${String(exec?.name)}: ${String(error)}\n`)
      return undefined
    }
  }
}

/**
 * Builds a guard that governs whichever project the calling session is in.
 *
 * A guard is registered once per plugin, but a harness serves sessions in
 * different workspaces, so the project cannot be fixed at registration time. The
 * root is therefore resolved per call from `exec.agent.session.header.cwd` — the
 * same field the tools use — and the decision-state cache is keyed on the root as
 * well as the corpus signature, so two sessions in two projects cannot read each
 * other's decisions.
 *
 * @param options - `{ resolveRoot }` — maps an execution to an absolute project
 *   root or `null`. Injected rather than imported so this module keeps its
 *   ignorance of how the harness finds a workspace.
 * @returns A `ToolGuard` that never throws.
 */
export function createRootGuard({ resolveRoot }) {
  /** root -> { signature, state, guard } */
  const perRoot = new Map()

  /** Returns the per-root guard, creating it when the root is first seen. */
  const guardFor = (root) => {
    if (!perRoot.has(root)) perRoot.set(root, createGuard({ root }))
    return perRoot.get(root)
  }

  return (exec) => {
    try {
      const name = exec?.name
      if (typeof name !== 'string' || !WRITE_TOOLS.includes(name)) return undefined
      const root = resolveRoot(exec)
      if (root === null || root === undefined) return undefined
      return guardFor(root)(exec)
    } catch (error) {
      process.stderr.write(`ratchet: guard failed for ${String(exec?.name)}: ${String(error)}\n`)
      return undefined
    }
  }
}

/**
 * Registers the guard on a Cordis context.
 *
 * `ctx.tools.guard(fn)` is the documented extension point; the guard is registered
 * inside `ctx.effect` so a hot reload replaces it instead of stacking a second one.
 *
 * Registration is DEFENSIVE about the extension point existing. The guard is one
 * feature of the plugin, and a harness whose `tools` service lacks `guard` (an older
 * release, or a stub context in a test) must lose the guard rather than the whole
 * plugin — losing four working tools to protect one rule would be the wrong trade,
 * and it would look like a boot failure rather than a missing feature. The absence
 * is reported once on stderr so it is visible instead of silent.
 *
 * @param ctx - Cordis context exposing `tools`.
 * @param resolveRoot - Maps an execution to an absolute project root or `null`.
 * @returns `{ registered }` — whether the extension point was available.
 */
export function registerGuard(ctx, resolveRoot) {
  if (typeof ctx?.tools?.guard !== 'function') {
    process.stderr.write(
      'ratchet: this harness does not expose ctx.tools.guard, so requiresDecisionRecord is NOT enforced; ' +
        'the ratchet tools still work and ratchet_verify still reports on the decisions themselves\n',
    )
    return { registered: false }
  }
  ctx.effect(() => {
    const dispose = ctx.tools.guard(createRootGuard({ resolveRoot }))
    return () => dispose()
  })
  return { registered: true }
}
