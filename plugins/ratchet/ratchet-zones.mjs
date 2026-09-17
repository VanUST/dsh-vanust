/**
 * PURPOSE
 *   Report the health of the authority table: which zones exist, which zones the
 *   records actually reference, which of those the manifest does not declare, which
 *   declared paths no longer match anything, and which laws enforce outside the zones
 *   their record claims. It exists because the zone table is the one thing a record
 *   cannot supply for itself: a rename, a move or a new area silently orphans every
 *   record that referenced the old shape, and the first symptom is a blocked card. It
 *   turns that into a list, and with `--write` drafts the zone declaration a human can
 *   ratify, so the migration is mechanical rather than detective work.
 *
 *   It reports and drafts. It never edits the manifest, never writes a record, and
 *   never puts anything in force.
 *
 * INPUTS
 *   root - absolute project root. The manifest is read through the ratchet's own
 *     manifest reader; the records through the compiler's corpus reader.
 *   write - when true, write one draft per undeclared zone under
 *     `<reportsDir>/drafts/`. Existing drafts are never overwritten.
 *   Declared paths are matched against the verifier's own bounded file walk; a root
 *   that cannot be walked reports the emptiness check as not evaluated rather than
 *   as clean.
 *
 * OUTPUTS
 *   `{ ok, root, declared, undeclared, unused, outside, problems, drafts, summary }`.
 *   `declared` is `[{ id, authority, paths, records, emptyPaths }]`; `undeclared` is
 *   `[{ id, records, inferredPaths, suggestedAuthority }]`; `outside` is the compile
 *   problems of code `LAW_PATH_OUTSIDE_DECLARED_ZONE`. `problems` is empty exactly
 *   when no zone is referenced-but-undeclared, no declared path matches nothing, and
 *   no law enforces outside its record's zones. An unreadable project returns
 *   `{ ok: false, unusable: true, problems }` with the manifest reader's own code.
 *
 * KEYWORDS
 *   zone report, authority table, undeclared zone, path drift, structure change,
 *   migration draft, ratified decision
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `ratchet.zones` at all: every referenced id is undeclared, and the report
 *     says so rather than assuming a default authority.
 *   - A zone referenced only by approval records is not counted: an approval declares
 *     no law and governs nothing.
 *   - A zone path with a wildcard that matches no tracked file is a problem; a literal
 *     path that does not exist yet is the same problem, because the zone governs
 *     nothing until it does.
 *   - No git: `emptyPaths` is `null` for every zone and no `ZONE_PATH_EMPTY` problem is
 *     emitted, because the check could not be made. It is never reported as clean.
 *   - `--write` on a project where every referenced zone is declared writes nothing.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { checkTargets, compileProject, readAdrCorpus, readManifest } from './ratchet-compiler.mjs'
import { globFilesFor, listFiles } from './ratchet-verifier.mjs'

/**
 * Lists the tracked paths of a work tree.
 *
 * @param root - Absolute project root.
 * @returns The NUL-separated paths, or `null` when git is unavailable or the root is
 *   not a work tree. Never throws: an absent git must be reported, not fatal.
 */
function projectFiles(root) {
  try {
    // The verifier's own walker, not a `git ls-files` spawn: shipped source may not
    // assume a binary is on PATH, and the walk is bounded by the same budget every
    // other read uses. A root that cannot be walked yields `null`, which the report
    // states as NOT RUN rather than as clean.
    return listFiles(root)
  } catch {
    return null
  }
}

/** @returns A problem object in the compiler's shape. */
function problem(code, message, subject) {
  return { code, severity: 'error', message, subject: subject ?? null, lawId: null }
}

/**
 * Builds the zone report for one project.
 *
 * @param root - Absolute project root.
 * @param options - `{ write }`; `write` also drafts a declaration per undeclared zone.
 * @returns The report described in this module's OUTPUTS.
 */
export function zoneReport(root, { write = false } = {}) {
  const manifest = readManifest(root)
  if (manifest.config === null) {
    return {
      ok: false,
      unusable: true,
      root,
      declared: [],
      undeclared: [],
      unused: [],
      outside: [],
      problems: manifest.problems ?? [{ code: 'MANIFEST_MISSING', severity: 'error', message: 'the manifest could not be read', subject: null }],
      drafts: { written: [], skipped: [] },
      summary: null,
    }
  }
  const config = manifest.config
  const corpus = readAdrCorpus(root, config)
  const compiled = compileProject(root)
  const tracked = projectFiles(root)

  const declared = (config.zones ?? []).map((zone) => ({
    id: zone.id,
    authority: zone.agentAuthority ?? config.defaultAgentAuthority ?? 'proposeOnly',
    paths: Array.isArray(zone.paths) ? [...zone.paths] : [],
    records: [],
    emptyPaths: tracked === null ? null : (zone.paths ?? []).filter((glob) => globFilesFor(tracked, glob).length === 0),
  }))
  const declaredById = new Map(declared.map((zone) => [zone.id, zone]))

  const referenced = new Map()
  const inferred = new Map()
  for (const record of corpus.records ?? []) {
    if (record.type === 'approval') continue
    for (const zoneId of record.zones ?? []) {
      if (!referenced.has(zoneId)) referenced.set(zoneId, new Set())
      referenced.get(zoneId).add(record.id)
      const target = declaredById.get(zoneId)
      if (target !== undefined) {
        if (!target.records.includes(record.id)) target.records.push(record.id)
        continue
      }
      // An undeclared zone has no paths, so its jurisdiction is inferred from the
      // positive targets of the laws its records declare — the same targets the
      // compiler's path check refuses when no zone governs them.
      const targets = inferred.get(zoneId) ?? new Set()
      for (const law of record.laws ?? []) {
        for (const check of law.checks ?? []) {
          for (const path of checkTargets(check, config)) targets.add(path)
        }
      }
      inferred.set(zoneId, targets)
    }
  }

  const undeclared = [...referenced.keys()]
    .filter((id) => !declaredById.has(id))
    .sort()
    .map((id) => ({
      id,
      records: [...referenced.get(id)].sort(),
      inferredPaths: [...(inferred.get(id) ?? new Set())].sort(),
      suggestedAuthority: config.defaultAgentAuthority ?? 'proposeOnly',
    }))
  const unused = declared.filter((zone) => zone.records.length === 0).map((zone) => zone.id)
  const outside = compiled.problems.filter((entry) => entry.code === 'LAW_PATH_OUTSIDE_DECLARED_ZONE')

  const problems = []
  for (const entry of undeclared) {
    problems.push(
      problem(
        'ZONE_UNDECLARED_REFERENCE',
        `zone "${entry.id}" is referenced by ${entry.records.length} record(s) (${entry.records.join(', ')}) but the manifest does not declare it, so nothing those records declare can enter force; declare the zone with the inferred path(s) ${entry.inferredPaths.length === 0 ? '(none inferable from the laws)' : entry.inferredPaths.join(', ')} or point the records at a declared zone`,
        entry.id,
      ),
    )
  }
  for (const zone of declared) {
    for (const glob of zone.emptyPaths ?? []) {
      problems.push(
        problem('ZONE_PATH_EMPTY', `zone "${zone.id}" declares path "${glob}", which matches no tracked file; a zone that governs nothing cannot grant authority, so the path moved, the glob is stale, or the area is gone`, zone.id),
      )
    }
  }
  for (const entry of outside) problems.push(problem('LAW_PATH_OUTSIDE_DECLARED_ZONE', entry.message, entry.subject ?? null))

  const drafts = { written: [], skipped: [] }
  if (write) {
    const directory = join(root, config.reportsDir ?? 'reports/ratchet', 'drafts')
    mkdirSync(directory, { recursive: true })
    for (const entry of undeclared) {
      const path = join(directory, `zone-${entry.id}.md`)
      const relative = `${config.reportsDir ?? 'reports/ratchet'}/drafts/zone-${entry.id}.md`
      if (existsSync(path)) {
        drafts.skipped.push(relative)
        continue
      }
      const zone = { id: entry.id, paths: entry.inferredPaths, agentAuthority: entry.suggestedAuthority, requiresDecisionRecord: false }
      const text = [
        `<!-- DRAFTED BY ratchet zones --write. NOT APPLIED. A human decides. -->`,
        `# Zone draft: ${entry.id}`,
        '',
        `The manifest does not declare zone "${entry.id}", but ${entry.records.length} record(s) reference it:`,
        ...entry.records.map((id) => `- ${id}`),
        '',
        'The paths below are inferred from the positive targets of the laws those records declare.',
        'They are a proposal, not a reading: widen or narrow them before applying.',
        '',
        '```json',
        JSON.stringify(zone, null, 2),
        '```',
        '',
        `Apply by adding the object to \`ratchet.zones\` in .dsh/project.json, then run \`ratchet compile\`.`,
        '',
      ].join('\n')
      writeFileSync(path, text)
      drafts.written.push(relative)
    }
  }

  return {
    ok: problems.length === 0,
    root,
    declared,
    undeclared,
    unused,
    outside,
    problems,
    drafts,
    summary: {
      declared: declared.length,
      referenced: referenced.size,
      undeclared: undeclared.length,
      unused: unused.length,
      lawsOutside: outside.length,
      trackedPaths: tracked === null ? null : tracked.length,
    },
  }
}
