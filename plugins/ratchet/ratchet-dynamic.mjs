/**
 * Ratchet dynamic layer: the agentic half, kept structurally separate from the
 * deterministic one.
 *
 * The static modules decide what is provable. This module handles the questions
 * that are not: whether a decision follows from its reasoning, whether a change
 * respects the intent of a law rather than its letter, whether two checks are
 * compatible when no textual comparison can say. It is the only ratchet module
 * that composes anything a model will read.
 *
 * Five rules govern it, and each exists because the opposite is a real failure:
 *
 * 1. **Advisory, never a gate.** The static layer is the gate. An answer that comes
 *    from a model cannot define "done", because a non-deterministic check that can
 *    fail a build is one people learn to re-run until it passes. Nothing here can
 *    change an exit code.
 * 2. **The tool decides nothing.** Whether two decisions conflict is a question
 *    about meaning; this module collects facts, states the question precisely, and
 *    hands both to the judge. It never judges.
 * 3. **A judge's output is untrusted input.** `validateVerdict` re-checks every
 *    claim against the bundle: a judge that cites a law id which does not exist has
 *    produced a fabricated finding, and a fabricated finding costs a reader exactly
 *    as much as a missed one. Reference-checking is cheap; trusting is not.
 * 4. **Never invent reasoning.** An ADR's reasoning is quoted from its source, never
 *    composed here. When a source does not contain enough to justify a decision the
 *    answer is `INSUFFICIENT_REASONING`, which is a result, not a failure.
 * 5. **A stable prefix, a volatile suffix.** Everything about the corpus goes in one
 *    block that changes only when the corpus changes; the question goes in another.
 *    Keeping them separate is what makes prefix caching work, and it is also what
 *    stops a caller interleaving them by accident.
 *
 * The module never imports the harness. Spawning the judge is the caller's job,
 * which is what keeps this file testable without a running deployment and keeps the
 * subagent dependency in exactly one place.
 */
import { PROBLEM_CODES, problem } from './ratchet-schema.mjs'
import { bundleHash } from './ratchet-compiler.mjs'

/** Report title embedded in every dynamic review report. */
export const DYNAMIC_REPORT_KIND = 'ratchet/dynamic-review'

/** Prompt contract version. Bumped when the prompt shape changes incompatibly. */
export const PROMPT_VERSION = 1

/**
 * The six jobs the dynamic layer exists for, with the question each one asks.
 *
 * Naming the jobs is not decoration: the prompt, the output schema and the
 * validation all branch on the job, so an unnamed job would silently inherit
 * whichever question happened to be written last.
 */
export const REVIEW_JOBS = Object.freeze({
  /** A raw source was ingested; does the proposed ADR follow from it, and does it fight a law in force? */
  review_proposal: {
    id: 'review_proposal',
    asks:
      'Does the proposed decision follow from the reasoning in its source, and is the law payload consistent with the prose? And does it CONTRADICT a law already in force in the stable material — a removal of one, the same law id under a different statement, or a check that cannot hold alongside one? Name each law it contradicts: an agent may work ahead of a ratification, but not against what a human already ratified, and only a reader can see the contradictions the guard cannot.',
    needs: ['source', 'proposal'],
  },
  /** A code change was made; does it respect the laws and their intent? */
  review_change: {
    id: 'review_change',
    asks:
      'Does this change obey the laws in force, and does it violate the intent of an active decision even where no check catches it?',
    needs: ['change'],
  },
  /** Two active decisions constrain one law differently; are they compatible? */
  review_conflict: {
    id: 'review_conflict',
    asks:
      'Can these two check sets both hold, or do they contradict each other in intent?',
    needs: ['conflict'],
  },
  /** A static check failed; why does it matter? */
  explain_violation: {
    id: 'explain_violation',
    asks:
      'Explain what this violation means for the decision it breaks, in terms a reader who did not write the law can act on.',
    needs: ['violation'],
  },
  /** A grilling session is wanted because an agent must change a human decision. */
  grill_preparation: {
    id: 'grill_preparation',
    asks:
      'What must a human decide before this change can proceed, and what does each answer imply?',
    needs: ['intent'],
  },
  /** The corpus itself may be incoherent in a way no structural check decides. */
  review_corpus: {
    id: 'review_corpus',
    asks:
      'Do any active decisions contradict each other in meaning, even where their laws do not collide textually?',
    needs: [],
  },
  /**
   * The corpus may hold the same decision twice in different words.
   *
   * This is the ADVISORY half of duplicate detection and deliberately not a gate: the
   * deterministic subset — one statement text under two law ids, one source cited twice by
   * records that share a law — is decided by `scripts/check-duplicate-decisions.mjs`, which
   * runs no model and whose exit code is the gate. Meaning is not decidable, so it is asked
   * here and reported, and `kind: semantic_duplicate` is a reporting kind rather than a
   * blocking one: a model verdict must not be able to fail a build.
   */
  review_duplicates: {
    id: 'review_duplicates',
    asks:
      'Do two decisions on record state the same constraint in different words — the same decision recorded twice, where no text comparison can see it? Name each decision you believe is a restatement of another and say what makes them one decision rather than two. A pair that merely touches the same subject is not a duplicate.',
    needs: [],
  },
})

/**
 * The verdict shape a judge must return, as a JSON Schema.
 *
 * Object-rooted with `additionalProperties: false` and an explicit `required`
 * array: this is a RAW schema handed to the subagent runtime, not a `defineTool`
 * DSL node, so it must be valid JSON Schema on its own.
 */
export const VERDICT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['error', 'warning', 'note'] },
          kind: { type: 'string' },
          lawId: { type: 'string' },
          sourceAdr: { type: 'string' },
          /**
           * The in-force statement of the law this finding judges, quoted verbatim, or its
           * spec hash. Required whenever `lawId` is present.
           *
           * A law id is a pointer a model can misread; a quotation is a claim that can be
           * checked. Without one, a finding that names a law is about whatever statement the
           * judge believed the id carried — which is how a false positive over a SUPERSEDED
           * statement froze every write in a zone, with the law actually in force saying the
           * opposite. The verdict validator compares this against the compiled law and refuses
           * the finding when it does not match, so a judge error cannot stop work.
           */
          lawQuote: { type: 'string' },
          explanation: { type: 'string' },
          suggestedAction: { type: 'string' },
        },
        required: ['severity', 'kind', 'explanation'],
      },
    },
    insufficientReasoning: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
  required: ['ok', 'findings'],
})

/** The judgement vocabulary a finding's `kind` must come from. */
export const FINDING_KINDS = Object.freeze([
  'semantic_violation',
  'intent_violation',
  'insufficient_reasoning',
  'incompatible_checks',
  'incoherent_corpus',
  'prose_law_mismatch',
  // The advisory duplicate: two records that state one constraint in different words. It is
  // deliberately NOT in `BLOCKING_FINDING_KINDS` — a duplicate is a question for a human to
  // settle with a resolution, not a change that contradicts law in force — so a judge's
  // duplicate finding is reported and never gates.
  'semantic_duplicate',
])

/**
 * The shape of a grilling agenda: what a human must decide, and why.
 *
 * `grill_preparation` is the one job whose answer is not a verdict. A verdict says
 * "here is what is wrong"; an agenda says "here is what only you can settle, and
 * here is what each answer implies". That difference is structural, so it gets its
 * own schema rather than being crammed into `findings` as prose — a reader must be
 * able to see at a glance how many decisions are waiting on them.
 *
 * `conflictingLaws` entries are validated against the laws that exist, exactly as a
 * verdict's `lawId` is: an agenda that names a law nobody wrote sends the human to
 * look for a decision that is not there.
 */
export const AGENDA_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    /** One short line naming what is being asked. */
    request: { type: 'string' },
    /** The laws, decisions or zones the change would contradict. */
    conflictingLaws: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lawId: { type: 'string' },
          sourceAdr: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['lawId', 'why'],
      },
    },
    /** What the agent wants to do instead. */
    proposedOverride: { type: 'string' },
    /** What could go wrong if the human says yes. */
    risks: { type: 'array', items: { type: 'string' } },
    /** The questions, in the order they must be answered. */
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: { type: 'string' },
          why: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
          implications: { type: 'string' },
        },
        required: ['question'],
      },
    },
    /** True when the request cannot be decided from the material given. */
    insufficientReasoning: { type: 'boolean' },
  },
  required: ['request', 'questions'],
})

/**
 * The system instruction, stated once so the prompt and its tests cannot drift.
 *
 * It carries the rules in the order that matters: the judge's scope first (it
 * judges, it does not gate), then the honesty requirement, because a model asked
 * to find problems will find some.
 */
export const JUDGE_SYSTEM = [
  'You are the reviewing judge for a project that records its architecture',
  'decisions as ADRs and enforces them as laws checked against the code.',
  '',
  'You are ADVISORY. A deterministic verifier is the gate; your verdict never',
  'blocks anything. Say what you actually believe.',
  '',
  'Report a finding only when you can point at the decision and the text that',
  'supports it. A fabricated finding costs a reader exactly as much as a missed',
  'one, so an empty findings list is a real and useful result.',
  '',
  'Never invent reasoning. If a decision does not carry enough reasoning to',
  'justify itself, say so with insufficientReasoning: true rather than supplying',
  'the reasoning yourself.',
  '',
  'Cite only law ids and ADR ids that appear in the material below. If you cannot',
  'cite one, describe the problem without a citation rather than inventing an id.',
  '',
  'When a finding names a lawId it MUST also carry `lawQuote`: the statement that law',
  'has IN THE MATERIAL BELOW, copied verbatim, or the spec hash printed at the top of',
  'it. Quote it from the material, never from memory and never from another record',
  'that talks about the law — a finding whose quote does not match the law as it is in',
  'force is discarded, and a finding that names a law without quoting it is discarded',
  'with it. A finding about a decision\'s PROSE alone names no lawId.',
].join('\n')

/**
 * Renders the stable prefix: everything about the project that changes only when
 * the corpus changes.
 *
 * This is the half that prefix caching pays for, so it deliberately contains no
 * question, no timestamp, and nothing derived from the volatile half. A change
 * here invalidates the cache, which is why it holds only the corpus.
 *
 * @param options - `{ project, config, bundle, activeRecords, proposedRecords,
 *   reviewRequired }`.
 * @returns The stable text.
 */
export function renderStableContext({
  project = null,
  config = null,
  bundle = null,
  activeRecords = [],
  proposedRecords = [],
  reviewRequired = [],
} = {}) {
  const zones = config?.zones ?? []
  const laws = bundle?.laws ?? []
  const authority = (record) => `${record.id} (${record.authority}${record.approvedBy === null || record.approvedBy === undefined ? '' : `, approved by ${record.approvedBy}`})`

  return [
    '# Project',
    '',
    `Name: ${project ?? '(unnamed)'}`,
    `Laws in force: ${laws.length}`,
    `Spec hash: ${bundle === null ? '(none)' : bundleHash(bundle)}`,
    '',
    '# Zones and who may decide in them',
    '',
    zones.length === 0
      ? 'No zones are declared, so every decision falls under the manifest default.'
      : zones
          .map(
            (zone) =>
              `- ${zone.id}: ${zone.paths.join(', ')} — agentAuthority ${zone.agentAuthority}${zone.requiresDecisionRecord ? ', requires a decision record' : ''}`,
          )
          .join('\n'),
    `Default agent authority: ${config?.defaultAgentAuthority ?? 'proposeOnly'}`,
    '',
    'Authority rule: a human decision outranks an agent decision. An agent may',
    'propose anywhere, may act alone only where the zone says activeIfNoConflict,',
    'and may never silently override a human decision.',
    '',
    '# Laws in force',
    '',
    laws.length === 0
      ? 'No laws are in force.'
      : laws
          .map((law) => {
            const checks =
              law.checks.length === 0
                ? 'no automated checks'
                : law.checks
                    .map((check) => {
                      const target =
                        check.path ?? check.pattern ?? (check.patterns ?? []).join(', ') ?? (check.paths ?? []).join(', ')
                      return `${check.type}(${target ?? '—'})`
                    })
                    .join(', ')
            return [
              `## ${law.id}`,
              law.statement,
              `- decided in ADR ${law.sourceAdr}, authority ${law.authority}${law.approvedBy === null ? '' : `, approved by ${law.approvedBy}`}`,
              `- zones: ${law.zones.length === 0 ? '(unzoned)' : law.zones.join(', ')}`,
              `- checks: ${checks}`,
            ].join('\n')
          })
          .join('\n\n'),
    '',
    '# Decisions on record',
    '',
    activeRecords.length === 0
      ? 'No active decisions.'
      : activeRecords
          .map((record) =>
            [
              `- ${authority(record)}: ${record.title ?? '(untitled)'}`,
              `  decision: ${record.sections?.Decision ?? '(no Decision section)'}`,
              `  reasoning: ${record.sections?.Reasoning ?? '(no Reasoning section)'}`,
            ].join('\n'),
          )
          .join('\n'),
    proposedRecords.length === 0
      ? ''
      : ['', '# Proposed, not in force', '', ...proposedRecords.map((record) => `- ${authority(record)}: ${record.title ?? '(untitled)'}`)].join('\n'),
    reviewRequired.length === 0
      ? ''
      : [
          '',
          '# Already flagged for review by the compiler',
          '',
          ...reviewRequired.map((entry) => `- law ${entry.lawId}: ${entry.reason}`),
        ].join('\n'),
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/**
 * Builds the context bundle: the stable prefix and the volatile suffix as
 * SEPARATE strings.
 *
 * They are returned separately rather than concatenated because the cache only
 * helps if the stable half is byte-identical between calls — a caller that joins
 * them and then edits the result has silently given up the benefit. Keeping them
 * apart also makes the boundary testable: a test can assert that changing the
 * question does not change the prefix.
 *
 * @param options - `{ stable, job, change, proposal, source, conflict, violation, question }`.
 * @returns `{ stable, volatile, job }`.
 */
export function buildContextBundle({ stable, job, change = null, proposal = null, source = null, conflict = null, violation = null, question = null } = {}) {
  const jobSpec = REVIEW_JOBS[job]
  if (jobSpec === undefined) {
    throw new Error(
      `unknown review job ${JSON.stringify(job)}; expected one of ${Object.keys(REVIEW_JOBS).join(', ')}`,
    )
  }
  const parts = []
  if (source !== null) parts.push('# Raw source\n', source, '')
  if (proposal !== null) parts.push('# Proposed decision\n', proposal, '')
  if (change !== null) parts.push('# Proposed change\n', change, '')
  if (conflict !== null) parts.push('# The conflict the compiler could not decide\n', conflict, '')
  if (violation !== null) parts.push('# The static violation to explain\n', violation, '')
  if (question !== null) parts.push('# Additional question\n', question, '')

  const missing = (jobSpec.needs ?? []).filter((need) => {
    if (need === 'source') return source === null
    if (need === 'proposal') return proposal === null
    if (need === 'change') return change === null
    if (need === 'conflict') return conflict === null
    if (need === 'violation') return violation === null
    if (need === 'intent') return change === null && proposal === null
    return false
  })

  return {
    job: jobSpec.id,
    stable,
    volatile: parts.join('\n').trim(),
    missing,
  }
}

/**
 * Renders the full prompt a judge receives.
 *
 * @param options - A context bundle from {@link buildContextBundle}.
 * @returns The prompt text.
 */
export function renderReviewPrompt(bundle) {
  const jobSpec = REVIEW_JOBS[bundle.job]
  return [
    JUDGE_SYSTEM,
    '',
    '# Material',
    '',
    bundle.stable,
    '',
    '# Question',
    '',
    jobSpec.asks,
    '',
    bundle.volatile,
    '',
    '# Answer format',
    '',
    // The format is the JOB's, not a shared default. Sending the verdict contract
    // to a grilling preparation would get findings where questions were wanted —
    // the format instruction is what the judge actually answers.
    ...(jobProducesAgenda(bundle.job) ? [AGENDA_FORMAT] : [VERDICT_FORMAT]),
  ].join('\n')
}

/** The output contract for a verdict job. */
const VERDICT_FORMAT = [
  'Reply with ONLY this JSON object and nothing else — no prose, no code fence:',
  '',
  '{',
  '  "ok": <boolean: true when nothing needs a human>',
  '  "findings": [',
  '    {',
  '      "severity": "error" | "warning" | "note",',
  `      "kind": ${FINDING_KINDS.map((kind) => `"${kind}"`).join(' | ')},`,
  '      "lawId": "<a law id from the material, or omit>",',
  '      "sourceAdr": "<an ADR id from the material, or omit>",',
  '      "explanation": "<what is wrong, and which text shows it>",',
  '      "suggestedAction": "<what a reader should do, or omit>"',
  '    }',
  '  ],',
  '  "insufficientReasoning": <boolean, optional>,',
  '  "reasoning": "<one short paragraph, optional>"',
  '}',
  '',
  'An empty findings list with "ok": true is a valid and useful answer.',
].join('\n')

/**
 * The output contract for a grilling agenda.
 *
 * It asks for a different thing on purpose: not "what is wrong" but "what only the
 * human can settle, and what each answer implies". One decision per question is the
 * instruction that makes a session usable — an agenda listing ten intertwined
 * questions gets a vague answer to all ten.
 */
const AGENDA_FORMAT = [
  'Reply with ONLY this JSON object and nothing else — no prose, no code fence:',
  '',
  '{',
  '  "request": "<one line: what the human is being asked to decide>",',
  '  "conflictingLaws": [',
  '    {',
  '      "lawId": "<a law id from the material>",',
  '      "sourceAdr": "<the ADR that decided it, or omit>",',
  '      "why": "<what this change would contradict>"',
  '    }',
  '  ],',
  '  "proposedOverride": "<what the agent wants to do instead>",',
  '  "risks": ["<what could go wrong if the human agrees>"],',
  '  "questions": [',
  '    {',
  '      "question": "<one decision, phrased so a yes or no answers it>",',
  '      "why": "<why this must be decided by a human>",',
  '      "options": ["<the answers available>"],',
  '      "recommendation": "<the option you would choose, and why>",',
  '      "implications": "<what follows from each answer>"',
  '    }',
  '  ],',
  '  "insufficientReasoning": <boolean, optional>',
  '}',
  '',
  'Ask about ONE decision per question, and order them so that answering an earlier',
  'one does not invalidate a later one. If the material does not carry enough',
  'reasoning to justify any decision, return an empty questions array with',
  '"insufficientReasoning": true rather than inventing the reasoning yourself.',
].join('\n')

/**
 * Reports whether a job answers with an agenda rather than a verdict.
 *
 * The two have different schemas, different validators and different shapes, so the
 * question is asked in one place rather than by comparing job strings at each call
 * site — where a missed comparison would silently validate an agenda as a verdict.
 *
 * @param job - A {@link REVIEW_JOBS} id.
 * @returns `true` for `grill_preparation`.
 */
export function jobProducesAgenda(job) {
  return job === 'grill_preparation'
}

/**
 * The output schema a job's judge must satisfy.
 *
 * @param job - A {@link REVIEW_JOBS} id.
 * @returns {@link AGENDA_SCHEMA} or {@link VERDICT_SCHEMA}.
 */
export function schemaForJob(job) {
  return jobProducesAgenda(job) ? AGENDA_SCHEMA : VERDICT_SCHEMA
}

/**
 * Validates a grilling agenda against the laws it was given.
 *
 * The same distrust a verdict gets, applied to the shape that matters more: an
 * agenda is read by a human who will act on it, so a question with no content or a
 * citation that resolves to nothing spends the one resource the exchange exists to
 * use.
 *
 * @param agenda - The parsed agenda, or `null`.
 * @param options - `{ lawIds, adrIds }` — the ids the judge was shown.
 * @returns `{ ok, request, questions, conflictingLaws, risks, proposedOverride,
 *   insufficientReasoning, problems }`.
 */
export function validateAgenda(agenda, { lawIds = [], adrIds = [] } = {}) {
  const problems = []
  if (agenda === null || typeof agenda !== 'object' || Array.isArray(agenda)) {
    return {
      ok: false,
      request: null,
      questions: [],
      conflictingLaws: [],
      risks: [],
      proposedOverride: null,
      insufficientReasoning: false,
      problems: [
        problem(
          'DYNAMIC_REVIEW_REQUIRED',
          'the judge returned no usable agenda, so no human question could be derived; this is reported rather than treated as "nothing to ask"',
        ),
      ],
    }
  }

  const knownLaws = new Set(lawIds)
  const knownAdrs = new Set(adrIds)
  const conflictingLaws = []
  for (const raw of Array.isArray(agenda.conflictingLaws) ? agenda.conflictingLaws : []) {
    if (raw === null || typeof raw !== 'object') continue
    const errors = []
    if (typeof raw.lawId !== 'string' || !knownLaws.has(raw.lawId)) {
      errors.push(`lawId ${JSON.stringify(raw.lawId)} is not a law in this project`)
    }
    if (raw.sourceAdr !== undefined && !knownAdrs.has(raw.sourceAdr)) {
      errors.push(`sourceAdr ${JSON.stringify(raw.sourceAdr)} is not an ADR in this project`)
    }
    if (typeof raw.why !== 'string' || raw.why.trim().length === 0) {
      errors.push('no reason given for the conflict')
    }
    if (errors.length > 0) {
      problems.push(
        problem(
          'DYNAMIC_REVIEW_REQUIRED',
          `the agenda cites something that does not resolve (${errors.join('; ')}), so the human would be sent to look for a decision that is not there`,
          raw.lawId ?? null,
          { raw },
        ),
      )
      continue
    }
    conflictingLaws.push({ lawId: raw.lawId, sourceAdr: raw.sourceAdr ?? null, why: raw.why })
  }

  const questions = []
  for (const [index, raw] of (Array.isArray(agenda.questions) ? agenda.questions : []).entries()) {
    if (raw === null || typeof raw !== 'object' || typeof raw.question !== 'string' || raw.question.trim().length === 0) {
      problems.push(
        problem('DYNAMIC_REVIEW_REQUIRED', `agenda question ${index} carries no question text`, null, { index }),
      )
      continue
    }
    questions.push({
      question: raw.question,
      why: typeof raw.why === 'string' ? raw.why : null,
      options: Array.isArray(raw.options) ? raw.options.filter((option) => typeof option === 'string') : [],
      recommendation: typeof raw.recommendation === 'string' ? raw.recommendation : null,
      implications: typeof raw.implications === 'string' ? raw.implications : null,
    })
  }

  // An agenda with no questions is the failure this job exists to prevent: it looks
  // like completed preparation while asking the human nothing.
  if (questions.length === 0) {
    problems.push(
      problem(
        'DYNAMIC_REVIEW_REQUIRED',
        agenda.insufficientReasoning === true
          ? 'the judge reported insufficient reasoning and asked nothing, so the source must be extended before a decision can be taken'
          : 'the agenda carries no questions, so there is nothing for a human to answer',
      ),
    )
  }

  return {
    ok: problems.length === 0 && questions.length > 0,
    request: typeof agenda.request === 'string' ? agenda.request : null,
    questions,
    conflictingLaws,
    risks: Array.isArray(agenda.risks) ? agenda.risks.filter((risk) => typeof risk === 'string') : [],
    proposedOverride: typeof agenda.proposedOverride === 'string' ? agenda.proposedOverride : null,
    insufficientReasoning: agenda.insufficientReasoning === true,
    problems,
  }
}

/**
 * Extracts a verdict object from whatever a judge returned.
 *
 * A judge is asked for bare JSON, and mostly complies — but "mostly" is why this
 * exists. A child that answers correctly inside a sentence, or inside a fenced
 * block, has produced a usable verdict that a strict `JSON.parse` would throw
 * away. The extraction is ordered from strictest to most forgiving, and it never
 * invents content: a string with no JSON object in it yields `null` rather than an
 * empty verdict, because an empty verdict and a missing one lead to opposite
 * conclusions.
 *
 * @param structured - The `structured` value a run returned, if any.
 * @param text - The `output` text a run returned.
 * @returns `{ verdict, source, problem }` where `source` is `'structured'`,
 *   `'text'`, `'fenced'`, `'embedded'`, or `null` when nothing parsed.
 */
export function parseVerdict(structured, text) {
  if (structured !== null && structured !== undefined && typeof structured === 'object') {
    return { verdict: structured, source: 'structured', problem: null }
  }
  const raw = typeof text === 'string' ? text.trim() : ''
  if (raw.length === 0) {
    return { verdict: null, source: null, problem: 'the judge returned no output' }
  }
  try {
    return { verdict: JSON.parse(raw), source: 'text', problem: null }
  } catch {
    /* fall through to the forgiving passes */
  }
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(raw)
  if (fenced !== null) {
    try {
      return { verdict: JSON.parse(fenced[1]), source: 'fenced', problem: null }
    } catch {
      /* fall through */
    }
  }
  const embedded = firstJsonObject(raw)
  if (embedded !== null) {
    return { verdict: embedded, source: 'embedded', problem: null }
  }
  return {
    verdict: null,
    source: null,
    problem: `the judge returned text with no JSON object in it: ${JSON.stringify(raw.slice(0, 300))}`,
  }
}

/**
 * Finds the first balanced JSON object in a string.
 *
 * @param text - Candidate text.
 * @returns The parsed object, or `null`. Brace counting is string-aware, so a
 *   brace inside a quoted explanation does not end the scan early.
 */
function firstJsonObject(text) {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/**
 * Validates a judge's verdict against the facts it was given.
 *
 * This is the module's most important function, and its job is to distrust. A
 * model asked to review will sometimes cite a law that does not exist, invent an
 * ADR id, or return a `kind` outside the vocabulary — and each of those is a
 * finding a reader cannot act on. Re-checking references is cheap and mechanical;
 * accepting them is how a review becomes confident noise.
 *
 * A finding that fails a reference check is NOT dropped silently. It is reported
 * as a `judge_reference_error` problem naming what could not be checked, because a
 * discarded hallucination and a missed real finding look identical to the reader
 * otherwise.
 *
 * @param verdict - The parsed verdict, or `null`.
 * @param options - `{ lawIds, adrIds }` — the ids the judge was shown.
 * @returns `{ ok, findings, problems, insufficientReasoning }`. `ok` is the
 *   judge's own verdict AND the absence of reference errors; a verdict that cannot
 *   be trusted is never reported as `ok`.
 */
export function validateVerdict(verdict, { lawIds = [], adrIds = [], laws = null, lawHashes = null } = {}) {
  const problems = []
  if (verdict === null || typeof verdict !== 'object' || Array.isArray(verdict)) {
    return {
      ok: false,
      findings: [],
      insufficientReasoning: false,
      problems: [
        problem(
          'DYNAMIC_REVIEW_REQUIRED',
          'the judge returned no usable verdict object, so nothing could be checked; this is reported rather than treated as a clean review',
        ),
      ],
    }
  }

  const knownLaws = new Set(lawIds)
  const knownAdrs = new Set(adrIds)
  // What each law in force actually SAYS, so a finding can be required to quote it. The two
  // maps are optional so an older caller that has only the ids still works — a finding that
  // cannot be checked against a statement is reported as unusable rather than trusted, which
  // is the conservative direction.
  const statements = laws === null || laws === undefined ? null : new Map(Object.entries(laws))
  const hashes = lawHashes === null || lawHashes === undefined ? null : new Map(Object.entries(lawHashes))
  const findings = []
  const rawFindings = Array.isArray(verdict.findings) ? verdict.findings : []
  if (!Array.isArray(verdict.findings)) {
    problems.push(
      problem(
        'DYNAMIC_REVIEW_REQUIRED',
        `the judge verdict carries no findings array (got ${JSON.stringify(typeof verdict.findings)}); an absent list and an empty one mean different things`,
      ),
    )
  }

  for (const [index, raw] of rawFindings.entries()) {
    if (raw === null || typeof raw !== 'object') {
      problems.push(
        problem('DYNAMIC_REVIEW_REQUIRED', `finding ${index} is not an object`, null, { index }),
      )
      continue
    }
    const referenceErrors = []
    if (raw.lawId !== undefined && !knownLaws.has(raw.lawId)) {
      referenceErrors.push(`lawId ${JSON.stringify(raw.lawId)} is not a law in this project`)
    }
    if (raw.sourceAdr !== undefined && !knownAdrs.has(raw.sourceAdr)) {
      referenceErrors.push(`sourceAdr ${JSON.stringify(raw.sourceAdr)} is not an ADR in this project`)
    }
    if (raw.kind !== undefined && !FINDING_KINDS.includes(raw.kind)) {
      referenceErrors.push(
        `kind ${JSON.stringify(raw.kind)} is outside the vocabulary (${FINDING_KINDS.join(', ')})`,
      )
    }
    if (typeof raw.explanation !== 'string' || raw.explanation.trim().length === 0) {
      referenceErrors.push('the finding carries no explanation')
    }
    // A finding bound to a law must QUOTE it. The quote is the whole difference between a
    // judgement about the corpus and a judgement about what the judge believed the id meant:
    // the failure this closes is a finding raised against a law's SUPERSEDED statement, which
    // named a law in force and read a statement that no longer existed. A finding that names
    // no law is unaffected — a judge may report an incoherent corpus without binding it to one.
    if (typeof raw.lawId === 'string' && raw.lawId.length > 0 && knownLaws.has(raw.lawId)) {
      const quote = typeof raw.lawQuote === 'string' ? raw.lawQuote.trim() : ''
      if (quote.length === 0) {
        referenceErrors.push(
          'the finding names a law but quotes neither its statement nor its hash, so there is nothing to check it against',
        )
      } else if (statements !== null) {
        const statement = statements.get(raw.lawId) ?? null
        const hash = hashes === null ? null : hashes.get(raw.lawId) ?? null
        const collapsed = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
        const matchesStatement = statement !== null && collapsed(statement) === collapsed(quote)
        const matchesHash = hash !== null && quote.includes(hash)
        if (!matchesStatement && !matchesHash) {
          referenceErrors.push(
            `the quote does not match law ${JSON.stringify(raw.lawId)} as it is in force; the finding is about a text that is not the compiled law, so it cannot block anything`,
          )
        }
      }
    }

    if (referenceErrors.length > 0) {
      problems.push(
        problem(
          'DYNAMIC_REVIEW_REQUIRED',
          `the judge cited something that does not exist or cannot be checked (${referenceErrors.join('; ')}); the finding is reported as unusable rather than passed on, because a reader cannot act on a reference that resolves to nothing and a finding about a superseded statement would freeze work the law permits`,
          raw.lawId ?? null,
          { index, referenceErrors, raw },
        ),
      )
      continue
    }

    findings.push({
      severity: ['error', 'warning', 'note'].includes(raw.severity) ? raw.severity : 'warning',
      kind: raw.kind,
      lawId: raw.lawId ?? null,
      sourceAdr: raw.sourceAdr ?? null,
      lawQuote: typeof raw.lawQuote === 'string' ? raw.lawQuote : null,
      explanation: raw.explanation,
      suggestedAction: raw.suggestedAction ?? null,
    })
  }

  const untrustworthy = problems.length > 0
  return {
    ok: verdict.ok === true && !untrustworthy,
    findings,
    insufficientReasoning: verdict.insufficientReasoning === true,
    reasoning: typeof verdict.reasoning === 'string' ? verdict.reasoning : null,
    problems,
  }
}

/**
 * Builds the structured prompt for the degraded path.
 *
 * A caller with no judge spawner — the `ratchet` CLI, or a tool call from an
 * agent that is not a live root — still needs the material. This returns the same
 * material and the same question, addressed to whoever is running: the calling
 * agent reads it, answers, and submits the verdict back. The ratchet becomes less
 * capable, and says so, rather than failing.
 *
 * @param options - A context bundle from {@link buildContextBundle}.
 * @returns `{ prompt, note }`.
 */
export function degradeToSelfReview(bundle) {
  return {
    prompt: renderReviewPrompt(bundle),
    note:
      'The ratchet did not spawn a judge for this call: a shell has no agent to parent one with, and a ' +
      'session reaches the runtime only when the composition mounts it. The material and the question are ' +
      'below; answer them yourself and submit the verdict through ratchet_review with `verdict`, so the ' +
      'record shows it was a self-review rather than an independent one.',
    degraded: true,
  }
}

/**
 * Assembles the report a dynamic review leaves behind.
 *
 * @param options - `{ job, promptVersion, stable, volatile, verdict, validation,
 *   judge, lawIds, adrIds }`.
 * @returns A JSON-safe report. Always well formed, including when the verdict was
 *   unusable, because a report that exists only on success cannot record a failure.
 */
export function buildReviewReport({
  job,
  promptVersion = PROMPT_VERSION,
  judge = null,
  verdict = null,
  validation = null,
  lawIds = [],
  adrIds = [],
  at = null,
} = {}) {
  return {
    kind: DYNAMIC_REPORT_KIND,
    job,
    promptVersion,
    generatedAt: at ?? new Date().toISOString(),
    judge: judge ?? { kind: 'none', reason: 'no judge was run' },
    advisory: true,
    gate: false,
    lawsConsidered: lawIds.length,
    adrsConsidered: adrIds.length,
    verdictOk: validation?.ok ?? false,
    findings: validation?.findings ?? [],
    insufficientReasoning: validation?.insufficientReasoning ?? false,
    reasoning: validation?.reasoning ?? null,
    problems: validation?.problems ?? [],
  }
}

/**
 * Confirms a submission through the degraded path is shaped as a verdict.
 *
 * A self-review arrives as data a caller typed, so it deserves the same reference
 * checking a spawned judge gets — the argument for validating a model's output
 * applies at least as strongly to output a model wrote by hand.
 *
 * @param candidate - The verdict a caller submitted.
 * @param options - `{ lawIds, adrIds }`.
 * @returns The result of {@link validateVerdict}.
 */
export function acceptSelfReview(candidate, options = {}) {
  return validateVerdict(candidate, options)
}

/** Re-exported so a caller needs one import for the whole dynamic path. */
export { PROBLEM_CODES }
