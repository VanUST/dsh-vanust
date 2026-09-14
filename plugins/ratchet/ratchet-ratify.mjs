/**
 * Ratchet ratification: asking a human whether a proposed decision becomes law,
 * and turning their answer into the record that makes it so.
 *
 * The problem this module exists for is that a file cannot prove who wrote it. An
 * agent can write `authority: human` into an ADR, and no reader can tell that from
 * a decision a human typed — so "a human approved this" was an assertion the
 * ratchet printed and nobody could check. The answer is not a signature (a key an
 * agent can read is not a secret) but a *channel*: the decision is put to the human
 * as a question, the harness delivers it, and the answer comes back through a path
 * the agent does not author.
 *
 * Four properties make the quiz a consent rather than a formality:
 *
 * 1. **The answer is derived, never interpreted.** Each question offers exactly two
 *    options and the derivation is exact string equality on the selected label. An
 *    answer that matches neither is not "probably a yes": it is unreadable, and the
 *    caller asks again in a different shape. Nothing is minted on a guess.
 * 2. **Consent covers a text.** Every approved record is hashed as it stood when
 *    the question was asked, and the hash is written into the approval. The
 *    compiler honours the approval only while the file still hashes to that value,
 *    so an edit after the fact voids the consent instead of inheriting it.
 * 3. **The evidence is a file, not a claim.** The approval cites a transcript of
 *    the questions and the answers under the sources directory, and the existing
 *    source-hash machinery then detects tampering with it — the same rule every
 *    other decision already faces.
 * 4. **Nothing is written without an approval.** Rejections and unreadable answers
 *    produce no artifact at all, so the corpus cannot drift towards "it was
 *    probably approved".
 *
 * This module imports no harness. The question payload it builds is plain data, and
 * the adapter that owns the harness connection passes it to the user-questions seam
 * and hands the answer back — which is what keeps this logic testable with a
 * literal object instead of a live session.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MANIFEST_PATH, UNUSABLE_PROBLEM_CODES, hashSource, normaliseText, problem } from './ratchet-schema.mjs'
import { readAdrCorpus, readManifest, resolveActiveSet, zonesForRecord } from './ratchet-compiler.mjs'
import { existingAdrIds, nextAdrId, slugFor } from './ratchet-ingest.mjs'
import { writeArtifact, STATE_PATHS } from './ratchet-state.mjs'

/**
 * The channel every ratification this module mints records.
 *
 * One value, because one channel is implemented: the decision is put to the human
 * as a question through the harness user-questions seam. The value is written into
 * the approval so a future channel is a new value rather than a reinterpretation
 * of this one.
 */
export const RATIFY_CHANNEL = 'user-question'

/** The label that means "put it into force". Exact match, never a prefix. */
export const RATIFY_APPROVE = 'Approve'

/** The label that means "leave it proposed". Exact match, never a prefix. */
export const RATIFY_REJECT = 'Reject'

/** Where transcripts of ratification sessions are recorded. */
export const RATIFY_TRANSCRIPT_DIR = 'docs/ratchet/sources'

/**
 * Lists the decisions that are waiting for a human, and why the others cannot be.
 *
 * A decision is waiting when it is not in force: `proposed` (nobody has decided
 * yet) or excluded (it claims force that the zone does not grant an agent). A
 * decision is NOT offered when ratifying it could not work — an agent record in a
 * `humanOnly` zone, where consent does not transfer authorship — because putting an
 * impossible question to a human wastes the one act this whole mechanism depends
 * on.
 *
 * @param root - Absolute project root.
 * @returns `{ ok, config, pending, blocked, problems }`. `pending` entries carry
 *   the record's full text and its current content hash, so a caller can show a
 *   human exactly what a "yes" would cover. `blocked` entries carry the same
 *   fields plus `reason`. A project with no usable manifest returns `ok: false`
 *   with the manifest's own problems rather than an empty queue.
 */
export function ratificationQueue(root) {
  const manifest = readManifest(root)
  const config = manifest.config
  if (config === null) {
    return { ok: false, config: null, pending: [], blocked: [], problems: manifest.problems }
  }
  if (config.enabled !== true) {
    return {
      ok: false,
      config,
      pending: [],
      blocked: [],
      problems: [
        problem(
          'RATCHET_DISABLED',
          `${config.manifestHash === null ? 'the manifest' : 'the project manifest'} does not declare ratchet.enabled, so no decision is enforced here and there is nothing to ratify`,
        ),
      ],
    }
  }

  const corpus = readAdrCorpus(root, config)
  const resolved = resolveActiveSet(corpus.records, config)
  // A corpus the ratchet cannot read is not a queue with nothing in it. Reporting
  // `ok` for one made `ratchet pending` print OK and exit 0 on a tree whose decisions
  // directory does not exist, where every other command exits 2.
  const unusable = (corpus.problems ?? []).some((entry) => UNUSABLE_PROBLEM_CODES.includes(entry.code))
  const excluded = new Set(resolved.excluded)
  const pending = []
  const blocked = []

  for (const record of [...resolved.proposed, ...resolved.excluded]) {
    const zones = zonesForRecord(record, config)
    const humanOnly = zones.filter((zone) => zone.agentAuthority === 'humanOnly')
    let text = null
    let readError = null
    try {
      text = normaliseText(readFileSync(join(root, record.path), 'utf8'))
    } catch (error) {
      readError = String(error)
    }

    const entry = {
      id: record.id,
      title: record.title,
      path: record.path,
      status: record.status,
      authority: record.authority,
      zones: zones.map((zone) => zone.id),
      zonePolicies: zones.map((zone) => zone.agentAuthority),
      contentHash: record.contentHash,
      laws: (record.laws ?? []).map((law) => ({
        id: law.id,
        statement: typeof law.statement === 'string' ? law.statement : null,
        op: law.op ?? 'upsert',
        checks: Array.isArray(law.checks) ? law.checks.length : 0,
      })),
      excluded: excluded.has(record),
      text,
    }

    if (record.authority === 'agent' && humanOnly.length > 0) {
      blocked.push({
        ...entry,
        reason: `zone "${humanOnly[0].id}" declares agentAuthority humanOnly, and a ratified agent record is still agent-authored: this decision has to be replaced by a human-authored record rather than approved`,
      })
      continue
    }
    // A record naming a zone the manifest does not declare cannot become law however
    // the human answers: the law it declares would be reported LAW_ZONE_MISSING the
    // moment it entered force. Offering it as "waiting for you" produced a consent
    // that achieved nothing and a report that got worse, with nothing telling the
    // human why.
    const undeclared = zones.filter((zone) => zone.missing === true)
    if (undeclared.length > 0) {
      blocked.push({
        ...entry,
        reason: `the record names zone "${undeclared[0].id}", which ${MANIFEST_PATH} does not declare, so nothing it declares could enter force: fix the zone list in the record or add the zone to the manifest first`,
      })
      continue
    }
    if (text === null) {
      blocked.push({ ...entry, reason: `the record file could not be read: ${readError}` })
      continue
    }
    pending.push(entry)
  }

  return { ok: !unusable, config, pending, blocked, problems: corpus.problems }
}

/**
 * Builds the quiz for one set of decisions.
 *
 * Attempt 1 puts one question per decision, offering `Approve` and `Reject`. A
 * second attempt exists because an answer can arrive unreadable, and asking the
 * same question again is how a human and a machine talk past each other: the
 * repeated question carries the previous answer, and its labels name the decision
 * (`Approve ADR 0001`) so a label that does not belong to the question is visible
 * rather than silently mapped.
 *
 * @param entries - Queue entries to ask about; an empty list yields a quiz with no
 *   questions, which callers must treat as "nothing to ask".
 * @param options - `{ attempt }` (1 or 2) and, for attempt 2, `previous`: the
 *   unreadable results from attempt 1, whose `reason` and `raw` are shown.
 * @returns `{ attempt, questions, roles, frozen }`. `questions` is exactly the
 *   payload the harness user-questions seam accepts — plain data, no private
 *   fields, because anything else would have to survive the wire. `roles` maps each
 *   question id to `{ adrId, approveLabel, rejectLabel }`, which is what makes the
 *   derivation a lookup instead of a guess. `frozen` is the same records as they
 *   stood when the question was built: `{ id, path, contentHash }`, kept so a
 *   consent can be bound to the text the human was SHOWN rather than to whatever
 *   the file says when the answer arrives.
 */
export function buildQuiz(entries, { attempt = 1, previous = [] } = {}) {
  const questions = []
  const roles = {}
  const frozen = []
  for (const entry of entries ?? []) {
    const prior = previous.find((item) => item.id === entry.id) ?? null
    const approveLabel = attempt === 1 ? RATIFY_APPROVE : `${RATIFY_APPROVE} ADR ${entry.id}`
    const rejectLabel = attempt === 1 ? RATIFY_REJECT : `${RATIFY_REJECT} ADR ${entry.id}`
    const questionId = attempt === 1 ? `ratify-${entry.id}` : `ratify-again-${entry.id}`
    const lawCount = entry.laws.filter((law) => law.op !== 'remove').length
    questions.push({
      id: questionId,
      header: attempt === 1 ? `Ratify ADR ${entry.id}` : `Answer not readable — ADR ${entry.id}`,
      question:
        attempt === 1
          ? `Put "${entry.title ?? entry.id}" into force as law?`
          : `Your previous answer about ADR ${entry.id} could not be read as approval or rejection` +
            `${prior === null || prior.reason === undefined ? '' : ` (${prior.reason})`}. ` +
            `Put "${entry.title ?? entry.id}" into force as law? Pick one of the two options below.`,
      // The detail is the record's own file text: the human is shown exactly the
      // bytes the content hash covers. A summary would be kinder to read and would
      // make the hash cover something nobody saw.
      detail: entry.text,
      options: [
        {
          label: approveLabel,
          description:
            lawCount === 0
              ? 'This decision declares no law; approving it changes nothing the verifier checks.'
              : `Put ${lawCount} law${lawCount === 1 ? '' : 's'} into force: ${entry.laws
                  .filter((law) => law.op !== 'remove')
                  .map((law) => law.id)
                  .join(', ')}`,
        },
        {
          label: rejectLabel,
          description: 'Leave the decision proposed. Nothing is written and nothing enters force.',
        },
      ],
    })
    roles[questionId] = { adrId: entry.id, approveLabel, rejectLabel }
    frozen.push({ id: entry.id, path: entry.path ?? null, contentHash: entry.contentHash ?? null })
  }
  return { attempt, questions, roles, frozen }
}

/**
 * Finds what one question offered, as it stood when the question was built.
 *
 * @param quiz - Result of {@link buildQuiz}.
 * @param adrId - The record id the answer is about.
 * @returns `{ id, path, contentHash }`, or `null` when the quiz never offered it.
 */
export function offeredBy(quiz, adrId) {
  return (quiz?.frozen ?? []).find((entry) => entry.id === adrId) ?? null
}

/**
 * Derives one decision per question from a human's answer.
 *
 * The whole point is that nothing here is a judgement call. A selected label equal
 * to the question's approve label is an approval, equal to its reject label is a
 * rejection, and everything else — no answer, no selection, several selections, a
 * label from another question, free text with no choice — is unreadable, reported
 * with what actually arrived. A caller may re-ask; it may not infer.
 *
 * @param quiz - Result of {@link buildQuiz}.
 * @param answer - The harness answer: `{ answers: [{ id, selected, custom? }] }`,
 *   or `null`/`undefined` when the human closed the question without answering.
 * @returns `{ decisions, unreadable, approved, rejected }`. `decisions` holds one
 *   entry per question in quiz order: `{ adrId, questionId, decision, selected,
 *   custom }` with `decision` one of `approved` / `rejected` / `unreadable`.
 *   `unreadable` carries `{ id, questionId, reason, raw }` for the re-ask.
 */
export function deriveDecisions(quiz, answer) {
  const answers = Array.isArray(answer?.answers) ? answer.answers : []
  const decisions = []
  const unreadable = []

  for (const [questionId, role] of Object.entries(quiz?.roles ?? {})) {
    const item = answers.find((entry) => entry !== null && typeof entry === 'object' && entry.id === questionId)
    const selected = Array.isArray(item?.selected)
      ? item.selected.filter((label) => typeof label === 'string')
      : []
    const custom = typeof item?.custom === 'string' && item.custom.trim().length > 0 ? item.custom.trim() : null

    const record = (decision, reason) => {
      decisions.push({
        adrId: role.adrId,
        questionId,
        decision,
        selected,
        custom,
      })
      if (decision === 'unreadable') {
        unreadable.push({ id: role.adrId, questionId, reason, raw: { selected, custom } })
      }
    }

    if (item === undefined) {
      record('unreadable', 'no answer was recorded for this question')
      continue
    }
    if (selected.length === 0) {
      record(
        'unreadable',
        custom === null
          ? 'the answer selected none of the offered options'
          : `the answer was free text rather than one of the offered options: ${JSON.stringify(custom)}`,
      )
      continue
    }
    if (selected.length > 1) {
      record(
        'unreadable',
        `the answer selected ${selected.length} options (${selected.map((label) => JSON.stringify(label)).join(', ')}), so it names no single decision`,
      )
      continue
    }
    if (selected[0] === role.approveLabel) {
      record('approved', null)
      continue
    }
    if (selected[0] === role.rejectLabel) {
      record('rejected', null)
      continue
    }
    record(
      'unreadable',
      `the answer selected ${JSON.stringify(selected[0])}, which is neither of this question's options (${JSON.stringify(role.approveLabel)} / ${JSON.stringify(role.rejectLabel)})`,
    )
  }

  return {
    decisions,
    unreadable,
    approved: decisions.filter((entry) => entry.decision === 'approved').map((entry) => entry.adrId),
    rejected: decisions.filter((entry) => entry.decision === 'rejected').map((entry) => entry.adrId),
  }
}

/**
 * Renders the transcript of one ratification session.
 *
 * This is the raw source the approval ADR cites, so it holds the questions that
 * were asked, the options that were offered, and the answer that arrived, with no
 * interpretation added. Two reasons it is a file rather than a field: the existing
 * source-hash machinery then covers it like any other reasoning, and a reader can
 * check the derivation by hand — which is the only way "the machine read my answer
 * correctly" stops being a matter of trust.
 *
 * @param options - `{ project, at, askedBy, channel, quiz, answer, decisions,
 *   entries }`.
 * @returns Markdown text. Always non-empty, including when nothing was answered:
 *   a session that produced no consent is still a fact worth recording.
 */
export function renderTranscript({ project, at, askedBy, channel, quiz, answer, decisions, entries }) {
  const byId = new Map((entries ?? []).map((entry) => [entry.id, entry]))
  const lines = [
    `# Ratification transcript — ${project ?? '(unnamed project)'}`,
    '',
    `- at: ${at}`,
    `- asked by: ${askedBy}`,
    `- channel: ${channel}`,
    `- questions asked: ${quiz.questions.length}`,
    `- answered: ${(answer?.answers ?? []).length}`,
    '',
  ]

  for (const question of quiz.questions) {
    const role = quiz.roles[question.id]
    const decision = decisions.find((entry) => entry.questionId === question.id) ?? null
    const entry = byId.get(role.adrId) ?? null
    const answerItem = (answer?.answers ?? []).find((item) => item?.id === question.id) ?? null
    lines.push(
      `## ${question.header}`,
      '',
      question.question,
      '',
      `- record: ${entry?.path ?? '(unknown)'}`,
      `- content hash offered: ${entry?.contentHash ?? '(unknown)'}`,
      `- options: ${question.options.map((option) => option.label).join(' | ')}`,
      `- selected: ${answerItem === null || answerItem.selected === undefined ? '(nothing)' : JSON.stringify(answerItem.selected)}`,
      ...(typeof answerItem?.custom === 'string' && answerItem.custom.length > 0
        ? [`- free text: ${JSON.stringify(answerItem.custom)}`]
        : []),
      `- derived: ${decision === null ? '(no derivation)' : decision.decision}`,
      '',
    )
  }

  lines.push(
    'The derivation above is exact: a selected label equal to the question\'s approve',
    'label is an approval, equal to its reject label is a rejection, and anything else',
    'is unreadable and mints nothing.',
    '',
    'The record text itself is not copied here. It is the file named above, committed',
    'beside this transcript, and the recorded hash is what makes an edit after the fact',
    'visible — while the committed revision is where the exact text the human read can',
    'still be found.',
    '',
  )
  return `${lines.join('\n')}\n`
}

/**
 * Renders the approval ADR a ratification writes.
 *
 * The artifact is an ordinary ADR of `type: approval`, so it travels the same path
 * every other decision does: it compiles, it is reviewed in a diff, and it is the
 * thing the compiler reads to decide what is in force. What it adds is the
 * `ratification` block — the channel, the time, who asked, and one content hash per
 * approved record — which is what turns "an approval exists" into "an approval of
 * this text exists".
 *
 * @param options - `{ id, at, askedBy, channel, approved, transcriptPath,
 *   transcriptHash, project, decisionsDir }`. `approved` is the queue entries being
 *   put into force; an empty list is refused by the caller, not here.
 * @returns `{ filename, path, text, title }`.
 */
export function renderApprovalAdr({
  id,
  at,
  askedBy,
  channel = RATIFY_CHANNEL,
  approved,
  transcriptPath,
  transcriptHash,
  project = null,
  decisionsDir = 'docs/adrs',
}) {
  const ids = approved.map((entry) => entry.id)
  const title = `Ratify ${ids.length === 1 ? `ADR ${ids[0]}` : `ADRs ${ids.join(', ')}`}`
  const filename = `${id}-${slugFor(title)}.adr.md`
  const plural = ids.length === 1 ? false : true
  const lawLines = approved.flatMap((entry) =>
    entry.laws.filter((law) => law.op !== 'remove').map((law) => `- \`${law.id}\` — ${law.statement ?? '(no statement)'} (${entry.path})`),
  )
  // The context is generated from each record's own status and zone policies rather
  // than asserted about them: a decision can be waiting because the zone refuses an
  // agent's own activation, or simply because nobody has decided yet, and a record
  // that says the wrong one of those is a record a reader has to re-derive.
  const contextLines = approved.flatMap((entry) => [
    `- ADR ${entry.id} — ${entry.title ?? '(no title)'} (${entry.path})`,
    `  - status: ${entry.status}; author authority: ${entry.authority}`,
    `  - zones: ${entry.zones.length === 0 ? '(unzoned)' : entry.zones.map((zone, index) => `${zone} (${entry.zonePolicies[index] ?? 'unknown'})`).join(', ')}`,
  ])

  const text = [
    '---',
    `id: "${id}"`,
    `title: ${title}`,
    'type: approval',
    // Active, because an approval that is itself proposed would put nothing into
    // force. This is the one record type whose force does not come from being
    // approved by something else; it is the consent artifact.
    'status: active',
    'author:',
    '  authority: human',
    '  name: human',
    `created: ${at}`,
    'source:',
    '  kind: file',
    `  path: ${transcriptPath}`,
    `  hash: ${transcriptHash}`,
    'zones: []',
    'laws: []',
    'supersedes: []',
    'approves:',
    ...ids.map((entry) => `  - "${entry}"`),
    'ratification:',
    `  channel: ${channel}`,
    `  at: '${at}'`,
    `  askedBy: ${askedBy}`,
    '  targets:',
    ...approved.flatMap((entry) => [
      `    - id: "${entry.id}"`,
      `      contentHash: ${entry.contentHash}`,
    ]),
    '---',
    '',
    '## Context',
    '',
    ...contextLines,
    '',
    `${plural ? 'These records are' : 'This record is'} not in force. A decision record is not a decision until somebody with the`,
    'authority makes it one, and the ratchet will not infer that from a status field an',
    'agent can write: in a `proposeOnly` zone the author cannot activate its own',
    'decision, and in any zone an agent that declares itself active is making the claim',
    'the gate exists to check.',
    '',
    '## Decision',
    '',
    `A human was asked, through the harness user-questions channel, whether ${plural ? 'these records' : 'this record'} should enter force,`,
    `and selected **${RATIFY_APPROVE}** for ${plural ? 'each' : 'it'}. ${ids.map((entry) => `ADR ${entry}`).join(' and ')} ${plural ? 'are' : 'is'} ratified at the content hashes recorded in`,
    'the frontmatter above and now contributes law.',
    '',
    ...(lawLines.length === 0
      ? [`The ratified ${plural ? 'records declare' : 'record declares'} no law, so nothing the verifier checks changes.`, '']
      : [`The law${lawLines.length === 1 ? '' : 's'} brought into force:`, '', ...lawLines, '']),
    '## Reasoning',
    '',
    'Consent is recorded rather than asserted. The question showed the human the exact',
    'text of each record, the answer was taken as a selected option with no',
    'interpretation, and the transcript of both is the source cited above — so the',
    `derivation can be re-read at ${transcriptPath} instead of trusted.`,
    '',
    `Each approved record is bound to the hash it had when the question was asked, so this approval covers that text and`,
    'not a later revision of it. An approval that named only a title would keep',
    'approving whatever the file said next, which is how a decision gets substituted',
    'past the person who read it. The text itself is not copied here: it is the record,',
    'committed beside this approval, and the hash is what makes a substitution visible',
    'rather than silent.',
    '',
    ...(project === null ? [] : [`Project: ${project}`, '']),
    '## Consequences',
    '',
    '- Editing any ratified record voids this approval: the compiler reports `RATIFICATION_STALE` and the law leaves force until it is ratified again.',
    '- The law set changed, so the spec bundle must be recompiled and the code re-verified before anything is called checked.',
    '- This approval confers force only. The ratified records keep their own author authority, so a ratified agent record still cannot govern a zone reserved to humans.',
    '',
  ].join('\n')

  return { filename, path: `${String(decisionsDir).replace(/\/+$/, '')}/${filename}`, text, title }
}

/**
 * Writes a ratification's two artifacts, refusing to overwrite anything.
 *
 * The transcript is written first: the approval cites it and records its hash, so
 * writing the approval first would create a record whose evidence does not exist
 * yet. Both writes go through the shared atomic writer, because a half-written
 * approval is an approval of unknown text.
 *
 * @param root - Absolute project root.
 * @param artifacts - `{ transcriptPath, transcriptText, approvalPath,
 *   approvalText }`.
 * @returns `{ ok, written, problems }`; `ok` is false when either target already
 *   exists, because a ratification that silently kept an older file would leave the
 *   caller believing a consent was recorded that was not.
 */
export function writeRatification(root, { transcriptPath, transcriptText, approvalPath, approvalText }) {
  const targets = [transcriptPath, approvalPath]
  const existing = []
  for (const path of targets) {
    try {
      readFileSync(join(root, path))
      existing.push(path)
    } catch {
      // Absent is the expected case: a ratification never rewrites history.
    }
  }
  if (existing.length > 0) {
    return {
      ok: false,
      written: [],
      problems: [
        problem(
          'ADR_ID_DUPLICATE',
          `refusing to write a ratification over ${existing.join(', ')}; a ratification records a consent that already happened, and overwriting one would erase the evidence of it`,
          null,
          { existing },
        ),
      ],
    }
  }

  const written = []
  try {
    const transcript = writeArtifact(root, transcriptPath, transcriptText)
    const approval = writeArtifact(root, approvalPath, approvalText)
    written.push(transcript.path, approval.path)
  } catch (error) {
    return {
      ok: false,
      written,
      problems: [
        problem(
          'ADR_UNREADABLE',
          `the ratification could not be written: ${String(error)}; nothing is in force through it, and any file already written is named in "written" so the caller can remove it rather than guess`,
          null,
          { written },
        ),
      ],
    }
  }
  return { ok: true, written, problems: [] }
}

/**
 * Chooses the path for a ratification transcript.
 *
 * Dated because the same decision can legitimately be ratified more than once — an
 * approved record that is then edited loses its consent and has to be ratified
 * again — and a second ratification that reused the first transcript's path would be
 * refused by the write, turning a normal event into a hard failure. The counter
 * covers a second ratification of the same decisions on the same day, which is
 * exactly what re-ratifying an edited record looks like.
 *
 * @param root - Absolute project root.
 * @param options - `{ sourcesDir, at, ids }`.
 * @returns A repository-relative path with forward slashes and no existing file.
 */
export function transcriptPathFor(root, { sourcesDir, at, ids }) {
  const day = String(at).slice(0, 10).replace(/[^0-9-]/g, '') || 'undated'
  const directory = String(sourcesDir ?? RATIFY_TRANSCRIPT_DIR).replace(/\/+$/, '')
  const base = `${directory}/${day}-ratification-${ids.join('-')}`
  let path = `${base}.md`
  let counter = 2
  while (existsSync(join(root, path))) {
    path = `${base}-${counter}.md`
    counter += 1
  }
  return path
}

/**
 * Allocates the id for a new approval ADR.
 *
 * @param root - Absolute project root.
 * @param decisionsDir - Manifest-declared decisions directory.
 * @returns `{ id }`; the next free four-digit id, so an approval never collides
 *   with a decision that already exists.
 */
export function nextApprovalId(root, decisionsDir) {
  const existing = existingAdrIds(root, decisionsDir)
  return { id: nextAdrId(existing.ids), existing: existing.ids }
}

/** Re-exported so a caller needs one import for the ratification path. */
export { STATE_PATHS, hashSource }
