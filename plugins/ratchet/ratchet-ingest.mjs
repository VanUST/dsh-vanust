/**
 * Ratchet ingestion: turn raw reasoning into a proposed ADR.
 *
 * This is the front door of the whole subsystem. A grilling transcript, a task
 * brief, an investigation note — none of them is a decision record, and asking a
 * human to write frontmatter is how a project ends up with no records at all. So a
 * judge reads the source and proposes the structured parts, and this module does the
 * two things a model cannot be trusted to do:
 *
 * 1. **It proves the reasoning came from the source.** Every quoted basis the judge
 *    returns is checked against the source text, verbatim. A judge asked to explain
 *    a decision will explain plausibly, and a plausible explanation that appears
 *    nowhere in the source is exactly the fabricated rationale this whole subsystem
 *    exists to prevent — so the check is mechanical, not a matter of trust.
 * 2. **It refuses when the source does not justify a decision.** `INSUFFICIENT_
 *    REASONING` is a first-class result, not an error: the answer to "why Redis?"
 *    when the transcript only says "use Redis" is a grilling session, and saying so
 *    is more useful than writing a record with invented justification.
 *
 * Three further properties are deliberate:
 *
 * - **Nothing is written unless asked.** `ingest` returns the ADR text; a separate
 *   `writeIngested` puts it on disk. A tool that writes as it generates cannot be
 *   reviewed, and a record nobody reviewed is a record nobody trusts.
 * - **The id is chosen from what exists**, never invented, so ingestion cannot
 *   collide with a record already on disk.
 * - **The ADR it produces compiles.** Generation is not finished until
 *   `compileProject` accepts the result, because an ADR that fails the compiler has
 *   produced work rather than a decision.
 *
 * The module never imports the harness and never spawns anything: the judge is
 * injected, exactly as it is for review.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CHECK_FIELD_KINDS, MIN_UNENFORCED_LENGTH, PROBLEM_CODES, UNIVERSAL_CHECK_FIELDS, hashSource, normaliseText, problem, validateLawChecks } from './ratchet-schema.mjs'

/**
 * The output contract for ingestion.
 *
 * Every text field the judge supplies about the DECISION carries a matching `basis`
 * field: the sentence from the source it came from. That pairing is what makes the
 * verbatim check possible — without it there is nothing to check, and the guard
 * against invented reasoning would be a hope.
 */
export const INGEST_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    /** True when the source does not carry enough reasoning for a decision. */
    insufficientReasoning: { type: 'boolean' },
    /** Why it is insufficient, when it is. */
    insufficiencyReason: { type: 'string' },
    title: { type: 'string' },
    /** The decision, one sentence. */
    decision: { type: 'string' },
    /** The reasoning, quoted or near-quoted from the source. */
    reasoning: { type: 'string' },
    /** The sentence in the source that supports the decision. */
    reasoningBasis: { type: 'string' },
    context: { type: 'string' },
    /** The sentence in the source stating the problem. */
    contextBasis: { type: 'string' },
    consequences: { type: 'array', items: { type: 'string' } },
    /** Zone ids the decision governs; must be zones the manifest declares. */
    zones: { type: 'array', items: { type: 'string' } },
    /** Laws the decision implies, in the shape an ADR declares. */
    laws: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          statement: { type: 'string' },
          /** Why nothing can check this law, when nothing can. */
          unenforced: { type: 'string' },
          /** The sentence in the source that says so. */
          unenforcedBasis: { type: 'string' },
          checks: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
        required: ['id', 'statement'],
      },
    },
  },
  required: ['insufficientReasoning'],
})

/** Shortest quote that can meaningfully prove attribution. */
const MIN_QUOTE_LENGTH = 16

/** The system instruction for an ingestion judge. */
export const INGEST_SYSTEM = [
  'You turn a project\'s raw reasoning into a proposed architecture decision record.',
  '',
  'The source below is the ONLY evidence. Do not add reasoning it does not contain,',
  'do not soften it, and do not supply the justification a reader would expect.',
  '',
  'For every claim you make about why the decision is right, quote the sentence from',
  'the source that supports it, verbatim and in the original language. The quote is',
  'checked against the source; a quote that does not appear there invalidates the',
  'record.',
  '',
  'If the source states a decision but gives no reason for it, set',
  'insufficientReasoning to true and explain what is missing. That is a useful answer:',
  'it means the reasoning needs to be captured before the decision is recorded.',
  '',
  'The record you produce is PROPOSED, never active. A human decides whether it',
  'becomes law.',
].join('\n')

/** The output contract, with the basis pairing explained. */
export const INGEST_FORMAT = [
  'Reply with ONLY this JSON object and nothing else — no prose, no code fence:',
  '',
  '{',
  '  "insufficientReasoning": <boolean>,',
  '  "insufficiencyReason": "<what is missing, when it is>",',
  '  "title": "<short, imperative, no trailing period>",',
  '  "decision": "<what was decided, one sentence>",',
  '  "reasoning": "<why, drawn from the source>",',
  '  "reasoningBasis": "<the sentence in the source that supports it, verbatim>",',
  '  "context": "<the problem the decision addresses>",',
  '  "contextBasis": "<the sentence in the source that states the problem, verbatim>",',
  '  "consequences": ["<what follows from the decision>"],',
  '  "zones": ["<zone ids from the manifest, chosen from the list in the material>"],',
  '  "laws": [',
  '    {',
  '      "id": "<zone>.<area>.<subject>, e.g. auth.session-storage.redis>",',
  '      "statement": "<what must be true of the code, stated as a requirement>",',
  '      "checks": [',
  '        {',
  '          "type": "<one of: required_file, forbidden_file, required_glob, forbidden_glob, required_text, forbidden_text,',
  '                    required_text_glob, forbidden_text_glob, required_dependency, forbidden_dependency, path_boundary,',
  '                    required_file_in_list, command>",',
  '          "<the fields that type needs: path+pattern+paths for the text checks, patterns for the dependency checks,',
  '            path+list+contains for required_file_in_list, zone+deny for path_boundary, run for command>": "<value>",',
  '          "basis": "<the sentence in the source that requires this check, verbatim>"',
  '        }',
  '      ],',
  '      "unenforced": "<only when nothing can check this law: what cannot be checked, and why>",',
  '      "unenforcedBasis": "<the sentence in the source that says so, verbatim>"',
  '    }',
  '  ]',
  '}',
  '',
  'Derive a check whenever the source makes one possible: a decision that says which',
  'file must exist, which text must appear, which dependency is forbidden or which',
  'command proves it can be checked, and a law nothing checks is a rule with no',
  'enforcement point. Every check carries a `basis` quoting the sentence that requires',
  'it; a check whose basis is not in the source is DROPPED and reported, never',
  'recorded as if the decision had asked for it. When nothing can check a law, say so',
  'in `unenforced` with its own basis rather than leaving the field out — silence is',
  'reported as an unenforced law, and an unexplained silence is treated as a defect.',
  '',
  'A `command` check runs only on demand and never from a tool, so it must be a',
  'command the repository can actually run: `node <script>` invoking a script that',
  'exists is the usual shape.',
  '',
  'Set insufficientReasoning to true and leave the other fields out when the source',
  'does not justify a decision. Do not guess a zone: use only ids from the material.',
].join('\n')

/**
 * Builds the material an ingestion judge reads.
 *
 * @param options - `{ config, sourceText, sourcePath, existingIds, corpusSummary }`.
 * @returns The prompt text.
 */
export function renderIngestPrompt({ config = null, sourceText, sourcePath, existingIds = [], corpusSummary = null }) {
  const zones = (config?.zones ?? []).map((zone) => `${zone.id} (${zone.paths.join(', ')})`)
  return [
    INGEST_SYSTEM,
    '',
    '# Project',
    '',
    `Name: ${config?.project ?? '(unnamed)'}`,
    `Decisions directory: ${config?.decisionsDir ?? 'docs/adrs'}`,
    '',
    'Zones, and who may decide in them:',
    zones.length === 0 ? '(no zones declared)' : zones.map((zone) => `- ${zone}`).join('\n'),
    `Default agent authority: ${config?.defaultAgentAuthority ?? 'proposeOnly'}`,
    '',
    `Existing ADR ids (do not reuse): ${existingIds.length === 0 ? '(none)' : existingIds.join(', ')}`,
    '',
    ...(corpusSummary === null ? [] : ['# Decisions already on record', '', corpusSummary, '']),
    `# Source: ${sourcePath}`,
    '',
    '```',
    sourceText.trim(),
    '```',
    '',
    '# Answer format',
    '',
    INGEST_FORMAT,
  ].join('\n')
}

/**
 * Chooses the next free ADR id.
 *
 * @param existingIds - Ids already on disk.
 * @returns The next four-digit id, zero-padded, starting at `0001`.
 */
export function nextAdrId(existingIds = []) {
  let highest = 0
  for (const id of existingIds) {
    const numeric = Number.parseInt(String(id), 10)
    if (Number.isFinite(numeric) && numeric > highest) highest = numeric
  }
  return String(highest + 1).padStart(4, '0')
}

/**
 * Turns a title into the filename slug the strict naming rule requires.
 *
 * Lowercase, hyphenated, alphanumeric only — because `ADR_FILE_INVALID` rejects
 * anything else, and a generated record that fails its own naming rule is a
 * generation bug wearing a decision's clothes.
 *
 * @param title - The record's title.
 * @returns A slug suitable for `NNNN-<slug>.adr.md`.
 */
export function slugFor(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'decision'
}

/**
 * Checks that a quote a judge supplied actually appears in the source.
 *
 * This is the anti-fabrication guard, and it is deliberately forgiving about
 * whitespace and case while being strict about wording: a judge that reformats a
 * sentence has still grounded the record in the source, whereas a judge that
 * invents one has not. Anything shorter than a handful of characters is refused
 * outright, because a two-word quote matches almost any source and would make the
 * check meaningless.
 *
 * @param quote - The sentence the judge attributed to the source.
 * @param sourceText - The source.
 * @returns `{ ok, reason }`.
 */
export function quoteAppears(quote, sourceText) {
  const needle = normaliseText(String(quote ?? '')).trim()
  if (needle.length < MIN_QUOTE_LENGTH) {
    return {
      ok: false,
      reason: `the quote is shorter than ${MIN_QUOTE_LENGTH} characters, which would match almost any source and proves nothing`,
    }
  }
  const haystack = normaliseText(sourceText).toLowerCase()
  const collapsedNeedle = needle.toLowerCase().replace(/\s+/g, ' ')
  const collapsedHaystack = haystack.replace(/\s+/g, ' ')
  if (collapsedHaystack.includes(collapsedNeedle)) return { ok: true, reason: null }

  // A judge may quote a sentence that wraps a line break or repeats a word; the
  // fallback below tolerates that. It does NOT tolerate a MISSING phrase: every
  // fragment of the quote that is long enough to prove anything must be present, so
  // an invented sentence cannot ride along behind a real one — which is what the
  // longest-fragment version allowed, and it is exactly the fabrication this check
  // exists to catch.
  const fragments = collapsedNeedle
    .split(/[.;:]\s+/)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length >= MIN_QUOTE_LENGTH)
  if (fragments.length === 0) {
    return {
      ok: false,
      reason: 'the quote does not appear in the source, so the reasoning it supports cannot be attributed to it',
    }
  }
  const missing = fragments.filter((fragment) => !collapsedHaystack.includes(fragment))
  if (missing.length === 0) return { ok: true, reason: null, matched: 'fragments' }
  return {
    ok: false,
    reason: `the quote does not appear in the source: ${JSON.stringify(missing[0].slice(0, 120))} is not there, so the reasoning it supports cannot be attributed to it`,
  }
}

/**
 * Validates the checks and the enforcement gap a judge derived, one law at a time.
 *
 * Two rules, both of which exist because a derived check is a claim about the
 * SOURCE and not only about the code:
 *
 * 1. **Every check quotes its reason.** A check carries a `basis`, the sentence that
 *    requires it, and that sentence is looked for in the source verbatim — the same
 *    test the reasoning faces. A check nobody asked for is a rule the judge
 *    invented, and an invented check is worse than a missing one: it fails a build
 *    over a decision the project never took.
 * 2. **A check that cannot be evaluated is DROPPED, not repaired.** Validation runs
 *    per check through the same `validateLawChecks` the compiler uses, so a check
 *    whose type is unknown or whose required fields are absent is removed with the
 *    reason recorded. Repairing it here would mean this module deciding what the
 *    judge meant.
 *
 * A dropped check does not invalidate the record: the law still stands and the
 * caller reports what was dropped. A law that nothing can check is recorded as
 * `unenforced` — with its own quoted basis, because "this cannot be checked" is a
 * claim like any other — and a law that says nothing at all is left silent, which
 * the verifier reports as `LAW_UNCHECKED`.
 *
 * @param laws - The judge's law candidates.
 * @param sourceText - The source the record is being ingested from.
 * @returns `{ laws, dropped }` where `laws` are `{ id, statement, checks, unenforced }`
 *   ready to render, and `dropped` holds `{ lawId, type, reason }` for every check or
 *   unenforced claim that was removed. Empty or non-array input yields
 *   `{ laws: [], dropped: [] }`.
 */
export function validateDerivedChecks(laws, sourceText) {
  const dropped = []
  const kept = []
  for (const law of Array.isArray(laws) ? laws : []) {
    if (law === null || typeof law !== 'object' || Array.isArray(law)) {
      dropped.push({ lawId: '(not a law)', type: null, reason: 'the entry is not a mapping, so no law could be read from it' })
      continue
    }
    const lawId = typeof law.id === 'string' && law.id.trim().length > 0 ? law.id.trim() : '(no id)'
    const checks = []

    if (law.checks !== undefined && !Array.isArray(law.checks)) {
      dropped.push({
        lawId,
        type: null,
        reason: `the law's checks is ${JSON.stringify(law.checks)} rather than a list, so every check it proposed was discarded instead of recorded`,
      })
    }

    for (const check of Array.isArray(law.checks) ? law.checks : []) {
      if (check === null || typeof check !== 'object' || Array.isArray(check)) {
        dropped.push({ lawId, type: null, reason: 'the derived check is not a mapping' })
        continue
      }
      const type = typeof check.type === 'string' ? check.type : null
      const basis = typeof check.basis === 'string' ? check.basis.trim() : ''
      if (basis.length === 0) {
        dropped.push({
          lawId,
          type,
          reason: 'the check quotes no sentence from the source, so nothing shows the decision requires it',
        })
        continue
      }
      const appears = quoteAppears(basis, sourceText)
      if (!appears.ok) {
        dropped.push({
          lawId,
          type,
          reason: `the sentence this check quotes is not in the source: ${appears.reason}`,
        })
        continue
      }
      const shape = validateLawChecks({ id: lawId, checks: [check] }, 'ingest')
      if (shape.length > 0) {
        dropped.push({ lawId, type, reason: shape.map((entry) => entry.message).join('; ') })
        continue
      }
      const { basis: _basis, ...rest } = check
      const renderable = checkIsRenderable(rest)
      if (!renderable.ok) {
        dropped.push({ lawId, type, reason: renderable.reason })
        continue
      }
      checks.push(rest)
    }

    let unenforced = null
    const claim = typeof law.unenforced === 'string' ? law.unenforced.trim() : ''
    if (claim.length > 0) {
      // The same floor the compiler applies, applied BEFORE the record is written:
      // accepting a note the compiler will reject produced a record that fails to
      // compile for a reason the ingestion result never mentioned.
      if (claim.length < MIN_UNENFORCED_LENGTH) {
        dropped.push({
          lawId,
          type: 'unenforced',
          reason: `the reason nothing can check this law is only ${claim.length} characters; the compiler requires at least ${MIN_UNENFORCED_LENGTH} so an exemption is a sentence a reader can weigh`,
        })
      } else {
        const basis = typeof law.unenforcedBasis === 'string' ? law.unenforcedBasis.trim() : ''
        if (basis.length === 0) {
          dropped.push({
            lawId,
            type: 'unenforced',
            reason: 'the law says nothing can check it but quotes no sentence saying so',
          })
        } else {
          const appears = quoteAppears(basis, sourceText)
          if (!appears.ok) {
            dropped.push({
              lawId,
              type: 'unenforced',
              reason: `the sentence saying the law cannot be checked is not in the source: ${appears.reason}`,
            })
          } else {
            unenforced = claim
          }
        }
      }
      if (unenforced !== null && renderScalar(unenforced) === null) {
        dropped.push({
          lawId,
          type: 'unenforced',
          reason: 'the reason the law cannot be checked cannot be written faithfully (it spans lines or mixes both quote kinds)',
        })
        unenforced = null
      }
    }

    kept.push({
      id: typeof law.id === 'string' ? law.id.trim() : '',
      statement: typeof law.statement === 'string' ? law.statement.trim() : '',
      checks,
      unenforced,
    })
  }
  return { laws: kept, dropped }
}

/**
 * Validates an ingestion result against the source and the manifest.
 *
 * @param candidate - The parsed judge output.
 * @param options - `{ sourceText, config, existingIds }`.
 * @returns `{ ok, insufficientReasoning, fields, problems, dropped }`. `fields` is
 *   present only when the record may be generated; a refusal carries no fields,
 *   because a half-populated record is how invented reasoning gets written by
 *   accident. `dropped` names the derived checks that were removed and why — a
 *   removal is reported, never silent.
 */
export function validateIngest(candidate, { sourceText, config = null, existingIds = [] } = {}) {
  const problems = []
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {
      ok: false,
      insufficientReasoning: false,
      fields: null,
      dropped: [],
      problems: [
        problem(
          'DYNAMIC_REVIEW_REQUIRED',
          'the judge returned no usable ingestion result, so no record was proposed; this is reported rather than treated as an empty source',
        ),
      ],
    }
  }

  if (candidate.insufficientReasoning === true) {
    return {
      ok: false,
      insufficientReasoning: true,
      fields: null,
      dropped: [],
      problems: [],
      reason:
        typeof candidate.insufficiencyReason === 'string' && candidate.insufficiencyReason.trim().length > 0
          ? candidate.insufficiencyReason
          : 'the source states a decision without stating why, so a record would have to invent its reasoning',
    }
  }

  const required = ['title', 'decision', 'reasoning', 'reasoningBasis', 'context', 'contextBasis']
  const missing = required.filter(
    (field) => typeof candidate[field] !== 'string' || candidate[field].trim().length === 0,
  )
  if (missing.length > 0) {
    problems.push(
      problem(
        'ADR_MISSING_REASONING',
        `the ingestion result is incomplete (${missing.join(', ')}), and a record is not generated from a partial proposal`,
        null,
        { missing },
      ),
    )
    return { ok: false, insufficientReasoning: false, fields: null, dropped: [], problems }
  }

  // The anti-fabrication check, on the two claims that carry the record's meaning.
  const bases = [
    { field: 'reasoningBasis', supports: 'reasoning', quote: candidate.reasoningBasis },
    { field: 'contextBasis', supports: 'context', quote: candidate.contextBasis },
  ]
  for (const basis of bases) {
    const check = quoteAppears(basis.quote, sourceText)
    if (!check.ok) {
      problems.push(
        problem(
          'ADR_MISSING_REASONING',
          `the ${basis.supports} is attributed to a source sentence that is not there (${check.reason}): ${JSON.stringify(String(basis.quote).slice(0, 160))}`,
          null,
          { field: basis.field, quote: basis.quote },
        ),
      )
    }
  }

  // Zones must be ones the manifest declares. A judge that invents a zone writes a
  // record bound to nothing, and `LAW_ZONE_MISSING` would report it only on the next
  // compile — after the record exists.
  const declared = new Set((config?.zones ?? []).map((zone) => zone.id))
  const zones = Array.isArray(candidate.zones) ? candidate.zones.filter((zone) => typeof zone === 'string') : []
  const unknownZones = zones.filter((zone) => !declared.has(zone))
  if (unknownZones.length > 0) {
    problems.push(
      problem(
        'LAW_ZONE_MISSING',
        `the ingestion result names zones the manifest does not declare (${unknownZones.join(', ')}), so the record would be bound to nothing`,
        null,
        { unknownZones, declared: [...declared] },
      ),
    )
  }
  if (zones.length === 0) {
    problems.push(
      problem(
        'LAW_ZONE_MISSING',
        'the ingestion result names no zone, so the decision would govern nothing and no guard could ever require it',
      ),
    )
  }

  const laws = Array.isArray(candidate.laws) ? candidate.laws : []
  for (const law of laws) {
    if (law === null || typeof law !== 'object') continue
    if (typeof law.id !== 'string' || law.id.trim().length === 0) {
      problems.push(problem('ADR_FIELD_INVALID', 'an ingested law declares no id'))
    } else if (renderScalar(law.id.trim()) === null) {
      // An id that spans lines would be written unquoted and inject the next line as
      // frontmatter, so the record would carry a field nobody proposed.
      problems.push(
        problem(
          'ADR_FIELD_INVALID',
          `ingested law ${JSON.stringify(law.id)} has an id that cannot be written as one line, and an id is what the record is addressed by`,
        ),
      )
    }
    if (typeof law.statement !== 'string' || law.statement.trim().length === 0) {
      problems.push(
        problem('ADR_FIELD_INVALID', `ingested law ${JSON.stringify(law.id)} states no requirement`),
      )
    } else if (renderScalar(law.statement.trim()) === null) {
      // Rendering it would emit `statement: null` — the requirement the law is about
      // would be gone from the record while the record still compiled.
      problems.push(
        problem(
          'ADR_FIELD_INVALID',
          `ingested law ${JSON.stringify(law.id)} states a requirement that spans lines or mixes both quote kinds, so it cannot be written into the frontmatter as one value`,
        ),
      )
    }
  }

  const id = nextAdrId(existingIds)
  if (existingIds.includes(id)) {
    problems.push(
      problem(
        'ADR_ID_DUPLICATE',
        `the chosen id ${id} already exists, so the record would fail to compile`,
        id,
      ),
    )
  }

  if (problems.length > 0) return { ok: false, insufficientReasoning: false, fields: null, problems, dropped: [] }

  const derived = validateDerivedChecks(laws, sourceText)

  return {
    ok: true,
    insufficientReasoning: false,
    fields: {
      id,
      title: candidate.title.trim(),
      decision: candidate.decision.trim(),
      reasoning: candidate.reasoning.trim(),
      context: candidate.context.trim(),
      consequences: Array.isArray(candidate.consequences)
        ? candidate.consequences.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
        : [],
      zones,
      laws: derived.laws,
    },
    dropped: derived.dropped,
    problems: [],
  }
}

/**
 * Renders an ADR document from validated ingestion fields.
 *
 * The output is deliberately the format the compiler accepts, with every mandatory
 * section present and the source hash recorded, so the record it produces is
 * verifiable the moment it lands rather than after a human repairs it.
 *
 * @param options - `{ fields, sourcePath, sourceHash, createdAt, authorName }`.
 * @returns `{ filename, path, text }` with a repository-relative path.
 */
export function renderAdr({ fields, sourcePath, sourceHash, createdAt, authorName = 'ratchet-ingest', decisionsDir = 'docs/adrs' }) {
  const slug = slugFor(fields.title)
  const filename = `${fields.id}-${slug}.adr.md`
  const zones = fields.zones.length === 0 ? '  - main' : fields.zones.map((zone) => `  - ${zone}`).join('\n')

  const laws =
    fields.laws.length === 0
      ? ['laws: []']
      : [
          'laws:',
          ...fields.laws.flatMap((law) => {
            const lines = [
              '  - op: upsert',
              // Quoted, because an id of `123`, `true` or `null` is written unquoted
              // as a YAML scalar of another type and reads back as a number, a
              // boolean or null — after which the record "declares no id" and fails
              // to compile for a reason the judge never intended.
              `    id: ${renderScalar(law.id)}`,
              `    statement: ${renderScalar(law.statement)}`,
            ]
            if (law.checks.length === 0) lines.push('    checks: []')
            else lines.push('    checks:', ...renderChecks(law.checks))
            // Rendered only when the judge's claim survived its basis check, so a
            // record never carries an exemption the source did not state.
            if (typeof law.unenforced === 'string' && law.unenforced.length > 0) {
              lines.push(`    unenforced: ${renderScalar(law.unenforced)}`)
            }
            return lines
          }),
        ]

  const text = [
    '---',
    `id: "${fields.id}"`,
    // Quoted, like every value the frontmatter subset would otherwise reinterpret:
    // an unquoted `title: 2026` comes back as a number and a title that already
    // looks quoted comes back without its quotes.
    `title: ${renderScalar(fields.title)}`,
    'type: adr',
    // Always proposed. A generator that could emit `active` would be an agent
    // activating its own decision, which the authority model forbids outright.
    'status: proposed',
    'author:',
    '  authority: agent',
    `  name: ${authorName}`,
    `created: ${createdAt}`,
    'source:',
    '  kind: file',
    `  path: ${sourcePath}`,
    `  hash: ${sourceHash}`,
    'zones:',
    zones,
    'supersedes: []',
    'approves: []',
    ...laws,
    '---',
    '',
    '## Context',
    '',
    fields.context,
    '',
    '## Decision',
    '',
    fields.decision,
    '',
    '## Reasoning',
    '',
    fields.reasoning,
    '',
    '## Consequences',
    '',
    ...(fields.consequences.length === 0
      ? ['- (none recorded; the source did not state any)']
      : fields.consequences.map((entry) => `- ${entry}`)),
    '',
  ].join('\n')

  return { filename, path: `${decisionsDir.replace(/\/+$/, '')}/${filename}`, text }
}

/**
 * Every field a rendered check may carry.
 *
 * The renderer writes these and nothing else, so a check carrying any other key is
 * dropped by {@link validateDerivedChecks} rather than rendered without it: a
 * silently omitted field is a check that means something different from what the
 * judge said, which is worse than a check that was refused out loud.
 */
export const RENDERABLE_CHECK_KEYS = Object.freeze([
  'type',
  // Derived from the schema, not written out again. Three separate hand-written lists of
  // check keys existed — this one, the schema's field kinds, and the compiler's target
  // fields — and the compiler's missed a path field six times over. A list that is only
  // ever derived cannot drift from the thing it describes.
  ...new Set([
    ...Object.values(CHECK_FIELD_KINDS).flatMap((fields) => Object.keys(fields)),
    ...Object.keys(UNIVERSAL_CHECK_FIELDS),
  ]),
])

/** Check fields the record format stores as one quoted scalar. */
const SCALAR_CHECK_KEYS = Object.freeze([
  'path',
  'pattern',
  'zone',
  'run',
  'expects',
  'outputContains',
  'outputNotContains',
  'outputMatches',
  'stream',
  'list',
  'contains',
  'containsIs',
  // The verifier reads `flags`, the schema validates them, and a hand-written
  // record carries them — so a renderer that did not know the key dropped every
  // correct case-insensitive check as unwritable and left the law unenforced.
  'flags',
])

/** Check fields the record format stores as a list of quoted scalars. */
const LIST_CHECK_KEYS = Object.freeze(['paths', 'patterns', 'deny', 'keys'])

/**
 * Renders a string as a YAML scalar this module's parser reads back verbatim.
 *
 * Quoted, and escaped, because the two halves have to be exact inverses of each
 * other. The parser unescapes `\\` and `\"` inside a double-quoted scalar (that is
 * how a `run:` carrying an escaped quote survives), so a renderer that quoted
 * WITHOUT escaping collapsed every run of two or more backslashes: `a\\b` came back
 * as `a\b`, a regex needing a literal backslash silently started matching `a b`, and
 * nothing was reported. Escaping the backslash first and the quote second is what
 * makes the pair symmetric.
 *
 * @param value - The value to render.
 * @returns The quoted scalar, or `null` when no single-line rendering is faithful —
 *   any line terminator breaks the line-based parser, and `\n`, `\r`, U+2028 and
 *   U+2029 all count: the parser's end-of-line anchor cannot match the last two, so
 *   the whole pair would be rejected and the FIELD would vanish rather than mangle.
 */
export function renderScalar(value) {
  const text = String(value)
  if (/[\n\r\u2028\u2029]/.test(text)) return null
  const escaped = text.split('\\').join('\\\\').split('"').join('\\"')
  return `"${escaped}"`
}

/**
 * Checks whether a derived check can be written back without changing it.
 *
 * The test is per KEY SHAPE, not per key name, and that distinction was learned the
 * hard way: advertising a key here while the renderer wrote only one of its shapes
 * meant a check whose `anyOf: true` was silently dropped — the record then enforced
 * something stricter than the judge proposed, with nothing reported. The same gap
 * stringified nested arrays (`paths: [[]]` rendered as a bare `- ` line, which the
 * parser folded the FOLLOWING check into, losing it entirely).
 *
 * @param check - One check candidate.
 * @returns `{ ok, reason }`; `reason` names the field whose value cannot be written
 *   back faithfully, or the key the renderer does not know. A check that fails this
 *   is dropped by the caller and reported — it is never repaired, because repairing
 *   it would mean this module deciding what the judge meant.
 */
export function checkIsRenderable(check) {
  for (const key of Object.keys(check)) {
    if (!RENDERABLE_CHECK_KEYS.includes(key)) {
      return { ok: false, reason: `the check carries ${JSON.stringify(key)}, which this ratchet cannot write into a record, so the check would mean something else once stored` }
    }
  }
  for (const [key, value] of Object.entries(check)) {
    if (key === 'type') continue
    if (SCALAR_CHECK_KEYS.includes(key)) {
      if (typeof value !== 'string' || value.length === 0) {
        return { ok: false, reason: `the check's ${key} is ${JSON.stringify(value)}, and this ratchet stores it as one non-empty line of text` }
      }
      if (renderScalar(value) === null) {
        return { ok: false, reason: `the check's ${key} cannot be written faithfully (it spans lines or mixes both quote kinds)` }
      }
      continue
    }
    if (LIST_CHECK_KEYS.includes(key)) {
      if (!Array.isArray(value) || value.length === 0) {
        return { ok: false, reason: `the check's ${key} is ${JSON.stringify(value)}, and this ratchet stores it as a non-empty list of strings` }
      }
      for (const entry of value) {
        if (typeof entry !== 'string' || entry.length === 0) {
          return { ok: false, reason: `the check's ${key} contains ${JSON.stringify(entry)}, which is not a non-empty string; a nested or empty value would be written as a bare list item and swallow whatever follows it` }
        }
        if (renderScalar(entry) === null) {
          return { ok: false, reason: `the check's ${key} contains an entry that cannot be written faithfully` }
        }
      }
      continue
    }
    if (key === 'anyOf') {
      // The verifier reads `anyOf === true` and nothing else, so any other value is
      // a claim the record cannot carry. Writing it as a list (the shape it used to
      // get) produced a field the verifier ignores: stricter enforcement, silently.
      if (value !== true) {
        return { ok: false, reason: `the check's anyOf is ${JSON.stringify(value)}; expected true, which is the only form the verifier reads` }
      }
      continue
    }
    if (key === 'timeoutMs') {
      // Bounded, because the format's integer form is what the parser reads back: a
      // value of 1e21 renders as `1e+21`, comes back as the STRING "1e+21", and the
      // record then fails to compile for a reason that has nothing to do with the
      // decision. A millisecond budget above a day is a typo, not a requirement.
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 86_400_000) {
        return { ok: false, reason: `the check's timeoutMs is ${JSON.stringify(value)}; expected a whole number of milliseconds between 1 and 86400000` }
      }
      continue
    }
    return { ok: false, reason: `the check's ${key} is not a field this ratchet knows how to write` }
  }
  return { ok: true }
}

/**
 * Renders a check list back to YAML.
 *
 * Written out rather than delegated to a YAML library for the same reason the
 * frontmatter parser is hand-rolled: the plugin depends on nothing a profile must
 * hoist, and the subset the ADR format uses is small and fixed.
 *
 * @param checks - Validated checks, already known to be renderable.
 * @returns Lines of YAML for the `checks:` key.
 */
function renderChecks(checks) {
  const lines = []
  for (const check of checks) {
    if (check === null || typeof check !== 'object' || typeof check.type !== 'string') continue
    lines.push(`      - type: ${check.type}`)
    for (const key of ['path', 'pattern', 'zone', 'run', 'expects', 'outputContains', 'outputNotContains', 'outputMatches', 'stream', 'list', 'contains', 'containsIs', 'flags']) {
      if (typeof check[key] === 'string') lines.push(`        ${key}: ${renderScalar(check[key])}`)
    }
    if (typeof check.timeoutMs === 'number') lines.push(`        timeoutMs: ${check.timeoutMs}`)
    // The boolean form, written as the verifier reads it. Rendering it as a list
    // produced a field the verifier ignores — a check that enforced more than the
    // judge proposed, with nothing reported anywhere.
    if (check.anyOf === true) lines.push('        anyOf: true')
    for (const key of ['paths', 'patterns', 'deny', 'keys']) {
      if (!Array.isArray(check[key]) || check[key].length === 0) continue
      lines.push(`        ${key}:`)
      for (const entry of check[key]) {
        // Strings only: `checkIsRenderable` refuses anything else before this runs,
        // and a bare `- ` line for an empty value is how the parser came to fold the
        // NEXT check into this one.
        if (typeof entry === 'string' && entry.length > 0) lines.push(`          - ${renderScalar(entry)}`)
      }
    }
  }
  return lines
}

/**
 * Reads the source a decision is being ingested from.
 *
 * @param root - Absolute project root.
 * @param sourcePath - Repository-relative path.
 * @returns `{ text, hash, absolute }` or `{ error }`.
 */
export function readSource(root, sourcePath) {
  const absolute = join(root, sourcePath)
  if (!existsSync(absolute)) {
    return { error: `no source file at ${sourcePath}; the reasoning a decision cites must exist before the decision does` }
  }
  try {
    const text = readFileSync(absolute, 'utf8')
    return { text: normaliseText(text), hash: hashSource(text), absolute }
  } catch (error) {
    return { error: `cannot read ${sourcePath}: ${String(error)}` }
  }
}

/**
 * Writes a generated ADR, refusing to overwrite anything.
 *
 * @param root - Absolute project root.
 * @param rendered - Result of {@link renderAdr}.
 * @returns `{ written }` or `{ error }`. An existing file is an error rather than a
 *   skip: silently keeping the old record would leave the caller believing the new
 *   reasoning was recorded.
 */
export function writeIngested(root, rendered) {
  const absolute = join(root, rendered.path)
  if (existsSync(absolute)) {
    return { error: `${rendered.path} already exists; ingestion never overwrites a decision` }
  }
  try {
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, rendered.text, 'utf8')
    return { written: rendered.path }
  } catch (error) {
    return { error: `cannot write ${rendered.path}: ${String(error)}` }
  }
}

/**
 * Reads the ADR ids already on disk.
 *
 * @param root - Absolute project root.
 * @param decisionsDir - Manifest-declared decisions directory.
 * @returns Sorted ids, and the filenames they came from.
 */
export function existingAdrIds(root, decisionsDir = 'docs/adrs') {
  const directory = join(root, decisionsDir)
  if (!existsSync(directory)) return { ids: [], names: [] }
  const names = readdirSync(directory).filter((entry) => entry.endsWith('.adr.md'))
  const ids = names
    .map((name) => /^(\d{4})-/.exec(name)?.[1])
    .filter((id) => id !== undefined)
    .sort()
  return { ids, names }
}

/**
 * Finds an existing record whose slug matches a title.
 *
 * Re-ingesting the same reasoning would otherwise produce `0002-use-redis...` next
 * to `0001-use-redis...` — two records for one decision, which is a worse outcome
 * than a refusal because nothing reports it: the corpus compiles, both laws agree,
 * and the duplication is invisible until someone counts.
 *
 * Matching on the slug rather than the number is what makes this about the DECISION
 * rather than the file: a human who renames a record has still recorded that
 * decision, and ingesting its source again must say so rather than add a copy.
 *
 * @param root - Absolute project root.
 * @param title - The title the ingestion produced.
 * @param decisionsDir - Manifest-declared decisions directory.
 * @returns The matching filename, or `null`.
 */
export function findExistingBySlug(root, title, decisionsDir = 'docs/adrs') {
  const slug = slugFor(title)
  const { names } = existingAdrIds(root, decisionsDir)
  return names.find((name) => name === `${slug}.adr.md` || name.endsWith(`-${slug}.adr.md`)) ?? null
}

/** Re-exported so a caller needs one import for the whole ingestion path. */
export { PROBLEM_CODES }
