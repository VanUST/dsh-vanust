/**
 * Ratchet bootstrap: the plan a project needs before the ratchet can do anything,
 * and the writer that applies it.
 *
 * This exists as its own module because the predecessor's first defect was that
 * the tool was inert until a manifest existed — precisely the situation in which
 * an agent needs it. Bootstrap is therefore the one operation that must work when
 * nothing else does, including when there is no project root yet.
 *
 * The generator returns data rather than writing as it goes, so preview and apply
 * share one code path: a bootstrap that writes while it builds cannot be
 * previewed, and an operation that cannot be previewed is one people run twice.
 *
 * **Nothing here overwrites.** Every path that already exists is skipped and
 * reported. That is the whole safety property: a tool whose purpose is to preserve
 * decisions must not be the thing that destroys one.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MANIFEST_PATH, RATCHET_DIR_DEFAULT, hashSource } from './ratchet-schema.mjs'

/** The starter ADR bootstrap writes, so a project has one valid record at once. */
const STARTER_ADR = [
  '---',
  'id: "0001"',
  'title: Record architecture decisions as ADRs',
  'type: adr',
  'status: proposed',
  'author:',
  '  authority: agent',
  '  name: ratchet-bootstrap',
  'created: "1970-01-01T00:00:00Z"',
  'source:',
  '  kind: file',
  '  path: docs/ratchet/sources/README.md',
  // Filled in by {@link bootstrapPreview} with the hash of the README the same plan
  // writes. A placeholder here would ship a record whose source hash does not match
  // the file beside it — the first thing a reader would have to fix by hand.
  '  hash: __SOURCE_HASH__',
  'zones:',
  '  - main',
  'supersedes: []',
  'approves: []',
  'laws: []',
  '---',
  '',
  '## Context',
  '',
  'This project has no architecture decision record. Decisions are therefore made in',
  'conversation and survive only as long as the conversation does, so nothing can be',
  'checked against what was decided.',
  '',
  '## Decision',
  '',
  'Architecture decisions in this project are recorded as ADRs under the directory the',
  'manifest declares, and code is verified against the laws those ADRs compile to.',
  '',
  '## Reasoning',
  '',
  'A decision that is not written down cannot be verified, contradicted, or superseded',
  'deliberately. Recording it is what makes the rest of the ratchet possible at all.',
  '',
  '## Consequences',
  '',
  '- Every decision needs reasoning and a source file, and a decision without either is',
  '  reported rather than accepted.',
  '- This starter record is `proposed` and agent-authored, so a human must approve or',
  '  replace it before it becomes law.',
  '',
].join('\n')

/**
 * Builds the manifest and directory skeleton a project needs to use the ratchet.
 *
 * @param options - `{ name, languages, zones, decisionsDir, sourcesDir, specsDir,
 *   reportsDir, stateDir, defaultAgentAuthority, mainPaths, specsRequired }`. `name`
 *   defaults to `'unnamed-project'` and `languages` to an empty list, because a
 *   manifest may legitimately declare neither. `specsRequired` defaults to `true`, so a
 *   new project tracks the generated law cards; pass `false` only to opt out.
 * @returns `{ manifestText, manifest, files }` where `files` is
 *   `{ path, kind, text? }[]` with `kind` either `'directory'` or `'file'`.
 */
export function bootstrapPreview(options = {}) {
  const projectName =
    typeof options.name === 'string' && options.name.length > 0 ? options.name : 'unnamed-project'
  const decisionsDir = options.decisionsDir ?? RATCHET_DIR_DEFAULT
  const sourcesDir = options.sourcesDir ?? 'docs/ratchet/sources'
  const specsDir = options.specsDir ?? 'docs/specs'
  const reportsDir = options.reportsDir ?? 'reports/ratchet'
  const stateDir = options.stateDir ?? '.dsh/ratchet'

  const manifest = {
    manifestVersion: 2,
    name: projectName,
    languages: options.languages ?? [],
    rules: [],
    verification: [],
    scopes: [],
    ratchet: {
      enabled: true,
      decisionsDir,
      sourcesDir,
      specsDir,
      reportsDir,
      stateDir,
      defaultAgentAuthority: options.defaultAgentAuthority ?? 'proposeOnly',
      // Specs are ON by default. A compiled law card a reader can diff is the point of
      // tracking them, and a project that starts with tracking off never notices the
      // documents are missing: the laws exist in `.dsh/ratchet/specs.json` and nowhere a
      // reviewer reads. A caller that needs the old behaviour passes `specsRequired: false`,
      // which the compiler honours as an explicit opt-out.
      specsRequired: options.specsRequired ?? true,
      zones: options.zones ?? [
        {
          id: 'main',
          paths: [options.mainPaths ?? 'src/**'],
          agentAuthority: 'proposeOnly',
          requiresDecisionRecord: true,
        },
      ],
    },
  }

  // The README is built first because the starter record declares its hash: a generated
  // pair that disagrees about the source, from the very first file a project has, teaches
  // the reader that the hash is decoration.
  const sourcesReadme = [
    '# Decision sources',
    '',
    'Every ADR declares a `source` pointing at a file in this directory, and the hash of',
    'that file when the decision was taken. The source is the reasoning a decision came',
    'from — a grilling transcript, a task brief, an investigation note — so that "no',
    'decision without reasoning" is checkable rather than aspirational. When the file',
    'changes afterwards, the hash stops matching and the ratchet reports the decision as',
    'unverified rather than silently accepting the new text as the old reasoning.',
    '',
    'Compute the hash with:',
    '',
    '```',
    'ratchet hash <source-file>',
    '```',
    '',
    'The hash is taken over the file with line endings normalised to LF and a leading',
    'byte-order mark stripped, so a checkout that rewrites line endings cannot',
    'invalidate every decision in the repository at once.',
    '',
    'This README is itself the source of the starter record, which is why it carries a',
    'hash: the record was generated together with the text it cites.',
    '',
  ].join('\n')
  const starterAdr = STARTER_ADR.replace('__SOURCE_HASH__', hashSource(sourcesReadme))

  const files = [
    // The manifest is the FIRST entry rather than a special case in the writer, so the
    // preview lists it: an apply that creates a file the preview never mentioned is a
    // preview nobody can plan from.
    { path: MANIFEST_PATH, kind: 'file', text: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: stateDir, kind: 'directory' },
    { path: decisionsDir, kind: 'directory' },
    { path: sourcesDir, kind: 'directory' },
    { path: specsDir, kind: 'directory' },
    { path: reportsDir, kind: 'directory' },
    { path: `${decisionsDir}/0001-record-decisions-as-adrs.adr.md`, kind: 'file', text: starterAdr },
    { path: `${sourcesDir}/README.md`, kind: 'file', text: sourcesReadme },
  ]

  return {
    manifest,
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`,
    files,
  }
}

/**
 * Writes a bootstrap plan to disk.
 *
 * @param root - Absolute project root.
 * @param plan - Result of {@link bootstrapPreview}. Every path written comes from
 *   `plan.files`, the manifest included, so the preview lists exactly what apply
 *   creates — including the `kind: 'directory'` entries, which are created and
 *   reported like any other path.
 * @param options - `{ force }`; when not `true`, existing paths are skipped and
 *   reported rather than overwritten.
 * @returns `{ created, skipped, manifestWritten }` — repository-relative paths.
 *   `manifestWritten` is separate from `created` because a caller usually needs to
 *   know specifically whether it was allowed to write the manifest; it is derived
 *   from `created`, never tracked in a second place that could disagree.
 */
export function bootstrapApply(root, plan, options = {}) {
  const created = []
  const skipped = []
  // Every path comes from the plan, the manifest included, so preview and apply cannot
  // disagree about what lands: an apply that creates a file the preview never listed is
  // the failure this single loop removes.
  for (const entry of plan.files) {
    const absolute = join(root, entry.path)
    if (existsSync(absolute) && options.force !== true) {
      skipped.push(entry.path)
      continue
    }
    if (entry.kind === 'directory') {
      mkdirSync(absolute, { recursive: true })
    } else {
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, entry.text, 'utf8')
    }
    created.push(entry.path)
  }

  return { created, skipped, manifestWritten: created.includes(MANIFEST_PATH) }
}
