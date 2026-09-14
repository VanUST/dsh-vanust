/**
 * PURPOSE
 *   Prove the Ratchet's human ratification works end to end: a real project on
 *   disk, the ratchet's own question builder, the harness user-questions channel, a
 *   stub answerer standing in for the human, and the ratchet's own derivation and
 *   approval writer.
 *
 *   A probe that hand-wrote the questions would prove only that a waterfall can be
 *   dispatched. What is unproven until this runs is the SEAM: that a plugin tool
 *   body can reach `ctx.userQuestions.ask()` with the live root agent the service
 *   authenticates, that the questions arrive with the record's own text as their
 *   detail, that an answer whose label matches nothing mints nothing while the
 *   differently shaped re-ask does, and that the approval it finally writes puts the
 *   decision into force.
 *
 * INPUTS
 *   No configuration. Mounted only by `scripts/probe-dsh-api.mjs --ratchet-ratify`.
 *   The fixture project is written under `os.tmpdir()/ratchet-ratify-fixture` — a
 *   scratch location, never the session workspace, so running the probe cannot
 *   change the project being probed.
 *
 * OUTPUTS
 *   Registers `zzprobe_ratchet_ratify`, which returns the ratchet's own results plus
 *   a transcript of what the answerer was asked, so the evidence records what the
 *   production code produced rather than a paraphrase.
 *
 * KEYWORDS
 *   ratification, human consent, user questions, integration probe, end to end
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `userQuestions` service in the composition: `askHuman` is null and the
 *     probe reports the prepared quiz as unanswered rather than throwing, which is
 *     the same degraded outcome a real deployment without a question channel gets.
 *   - No parent agent on the call: the service authenticates the exact live root and
 *     would reject an agentless ask, so the probe reports the refusal as evidence
 *     instead of silently succeeding.
 *   - The fixture directory already exists: rebuilt from scratch, so a previous
 *     run's approval can never be this run's input.
 *   - A question the stub does not recognise (any id not beginning with `ratify`):
 *     passed on with `next()`, so the probe never answers for another plugin.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseAdr, hashSource } from '../../plugins/ratchet/ratchet-schema.mjs'
import { compileProject } from '../../plugins/ratchet/ratchet-compiler.mjs'
import { ratifyInteractively } from '../../plugins/ratchet/ratchet-ops.mjs'

/** Cordis function-plugin name; also the id a patch row targets. */
export const name = 'api-probe-ratchet-ratify'

/** The tool registry, and nothing else; the question channel is reached at call time. */
export const inject = ['tools']

/** The service name the human-question channel registers under. Camel-case, plural. */
const USER_QUESTIONS_SERVICE = 'userQuestions'

/** Where the fixture project is written. Scratch by construction. */
export const FIXTURE_PATH = join(tmpdir(), 'ratchet-ratify-fixture')

/** The raw reasoning each fixture decision cites, so the source hash verifies. */
const SOURCE_TEXT = [
  '# Grilling session: plugin ownership',
  '',
  'Two plugins wrote to one shared ledger and a failure in it could not be attributed',
  'to either. We agreed each plugin owns its own ledger and reports from it, because an',
  'unattributable failure is a failure nobody fixes.',
  '',
].join('\n')

/** The reasoning the second fixture decision cites. */
const SOURCE_TEXT_TWO = [
  '# Grilling session: job retries',
  '',
  'Retries were immediate and the queue now spans two workers, so an outage burned',
  'every attempt before the dependency recovered. We agreed on exponential backoff',
  'with a dead-letter queue, because a dropped job should be visible rather than lost.',
  '',
].join('\n')

/**
 * Writes the fixture project the ratification runs against.
 *
 * Two decisions, both agent-authored and proposed in zones that give agents
 * `proposeOnly`, because that is the state the mechanism exists for. Two rather than
 * one so a single run covers both answer shapes: one question answered in a label
 * that matches nothing, and one answered cleanly.
 *
 * @returns The absolute fixture root.
 */
function buildFixture() {
  rmSync(FIXTURE_PATH, { recursive: true, force: true })
  mkdirSync(join(FIXTURE_PATH, '.dsh'), { recursive: true })
  mkdirSync(join(FIXTURE_PATH, 'docs', 'adrs'), { recursive: true })
  mkdirSync(join(FIXTURE_PATH, 'docs', 'ratchet', 'sources'), { recursive: true })

  writeFileSync(
    join(FIXTURE_PATH, '.dsh', 'project.json'),
    `${JSON.stringify(
      {
        manifestVersion: 2,
        name: 'ratchet-ratify-fixture',
        languages: [{ id: 'javascript', extensions: ['.mjs'], roots: ['plugins'] }],
        rules: [],
        verification: [],
        scopes: [],
        ratchet: {
          enabled: true,
          decisionsDir: 'docs/adrs',
          sourcesDir: 'docs/ratchet/sources',
          specsDir: 'docs/specs',
          reportsDir: 'reports/ratchet',
          defaultAgentAuthority: 'proposeOnly',
          zones: [
            { id: 'plugins', paths: ['plugins/**'], agentAuthority: 'proposeOnly', requiresDecisionRecord: false },
            { id: 'jobs', paths: ['src/jobs/**'], agentAuthority: 'proposeOnly', requiresDecisionRecord: false },
          ],
        },
      },
      null,
      2,
    )}\n`,
  )

  writeFileSync(join(FIXTURE_PATH, 'docs', 'ratchet', 'sources', 'plugin-ownership.md'), SOURCE_TEXT)
  writeFileSync(join(FIXTURE_PATH, 'docs', 'ratchet', 'sources', 'job-retries.md'), SOURCE_TEXT_TWO)

  writeFileSync(
    join(FIXTURE_PATH, 'docs', 'adrs', '0001-own-the-ledger.adr.md'),
    [
      '---',
      'id: "0001"',
      'title: Each plugin owns its ledger',
      'type: adr',
      'status: proposed',
      'author:',
      '  authority: agent',
      '  name: ratchet-ingest',
      'created: "2026-09-14T00:00:00Z"',
      'source:',
      '  kind: file',
      '  path: docs/ratchet/sources/plugin-ownership.md',
      `  hash: ${hashSource(SOURCE_TEXT)}`,
      'zones:',
      '  - plugins',
      'supersedes: []',
      'approves: []',
      'laws:',
      '  - op: upsert',
      '    id: plugins.owns-its-ledger',
      '    statement: Each plugin writes its own ledger.',
      '    checks:',
      '      - type: required_file',
      '        path: plugins/ledger.mjs',
      '---',
      '',
      '## Context',
      '',
      'Two plugins wrote to one shared ledger and a failure in it could not be attributed.',
      '',
      '## Decision',
      '',
      'Each plugin writes its own ledger.',
      '',
      '## Reasoning',
      '',
      'An unattributable failure is a failure nobody fixes, and the shared ledger is what',
      'made attribution impossible.',
      '',
      '## Consequences',
      '',
      '- Every plugin carries its own audit trail.',
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(FIXTURE_PATH, 'docs', 'adrs', '0002-exponential-backoff.adr.md'),
    [
      '---',
      'id: "0002"',
      'title: Retry with exponential backoff',
      'type: adr',
      'status: proposed',
      'author:',
      '  authority: agent',
      '  name: ratchet-ingest',
      'created: "2026-09-14T00:00:00Z"',
      'source:',
      '  kind: file',
      '  path: docs/ratchet/sources/job-retries.md',
      `  hash: ${hashSource(SOURCE_TEXT_TWO)}`,
      'zones:',
      '  - jobs',
      'supersedes: []',
      'approves: []',
      'laws:',
      '  - op: upsert',
      '    id: jobs.retry.exponential-backoff',
      '    statement: Background job retries use exponential backoff.',
      '    checks: []',
      '---',
      '',
      '## Context',
      '',
      'Retries were immediate and the queue now spans two workers.',
      '',
      '## Decision',
      '',
      'Background job retries use exponential backoff.',
      '',
      '## Reasoning',
      '',
      'An outage burned every attempt before the dependency recovered, so the retries',
      'were spent exactly when they were needed.',
      '',
      '## Consequences',
      '',
      '- Retry timing is no longer uniform.',
      '',
    ].join('\n'),
  )
  return FIXTURE_PATH
}

/**
 * Registers the ratification probe: a stub answerer and the tool that drives it.
 *
 * @param ctx - Cordis context exposing `tools` and the event bus.
 * @returns Nothing; registrations are made inside effects.
 */
export function apply(ctx) {
  /** Every request the stub answerer was handed, in order. */
  const asked = []

  // The answerer stands in for the human. A real deployment composes the Web
  // client's answerer through Remote Events; a headless scratch profile has none, so
  // without this listener every ask would fail closed with NO_PROVIDER — which is
  // itself the correct behaviour, and not what this probe is measuring.
  //
  // Registered at the root scope, like the ACP machine channel answers
  // `approval/request`: a scoped dispatch runs the listener chain from the root
  // down, so a root listener receives an agent-scoped request.
  ctx.on('user-questions/request', (request, next) => {
    const questions = Array.isArray(request?.questions) ? request.questions : []
    const ours = questions.filter((question) => typeof question?.id === 'string' && question.id.startsWith('ratify'))
    if (ours.length === 0) return next()

    asked.push({
      questions: ours.map((question) => ({
        id: question.id,
        header: question.header ?? null,
        question: question.question,
        options: (question.options ?? []).map((option) => option.label),
        detailBytes: typeof question.detail === 'string' ? question.detail.length : 0,
        detailHead: typeof question.detail === 'string' ? question.detail.split('\n')[0] : null,
        detailHasFrontmatter: typeof question.detail === 'string' && question.detail.startsWith('---'),
      })),
      agentScoped: request?.agent !== undefined,
    })

    const answers = ours.map((question) => {
      const options = question.options ?? []
      const labels = options.map((option) => option.label)
      // The first attempt deliberately returns a label that was never offered, which
      // is what an unreadable answer looks like; the re-ask names the record in its
      // labels, and this time the stub selects the offered approve label.
      const approving = labels.find((label) => label === 'Approve' || label === `Approve ADR ${question.id.replace('ratify-again-', '')}`)
      const firstAttempt = question.id.startsWith('ratify-')
      return firstAttempt && question.id === 'ratify-0001'
        ? { id: question.id, selected: ['yes please'] }
        : { id: question.id, selected: [approving ?? labels[0]] }
    })
    return Promise.resolve({ answers })
  })

  ctx.effect(() => {
    const dispose = ctx.tools.register(
      defineTool({
        name: 'zzprobe_ratchet_ratify',
        description:
          'Probe: run the ratchet ratification end to end against a fixture project, putting the questions to a ' +
          'stub answerer through the harness user-questions channel and recording the approval it writes.',
        parameters: {},
        output: {
          schema: { type: 'json' },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(_args, exec) {
          const root = buildFixture()
          const service = ctx.get(USER_QUESTIONS_SERVICE)
          const agent = exec?.agent

          const askHuman =
            service === undefined || typeof service.ask !== 'function' || agent === undefined
              ? null
              : async (quiz) => {
                  try {
                    const answer = await service.ask({
                      agent,
                      questions: quiz.questions,
                      ...(exec?.signal === undefined ? {} : { signal: exec.signal }),
                    })
                    return { kind: 'ok', answer }
                  } catch (error) {
                    return { kind: 'unavailable', reason: String(error) }
                  }
                }

          // The PRODUCTION sequence: the same function the ratchet_ratify tool calls.
          const result = await ratifyInteractively({
            root,
            askedBy: 'session ratify-probe',
            at: '2026-09-14T00:00:00Z',
            askHuman,
          })

          // Read back through the same rules any record faces, and compile, so the
          // evidence says whether the consent took effect rather than whether a
          // function returned.
          const decisionFiles = readdirSync(join(root, 'docs', 'adrs')).filter((entry) => entry.endsWith('.adr.md')).sort()
          const approvalProblems = {}
          for (const filename of decisionFiles) {
            const parsed = parseAdr({
              filename,
              source: readFileSync(join(root, 'docs', 'adrs', filename), 'utf8'),
              root,
            })
            if (parsed.record?.type === 'approval') {
              approvalProblems[filename] = parsed.problems.map((entry) => entry.code)
            }
          }
          const compiled = compileProject(root)

          return {
            probe: 'ratchet-ratify',
            fixture: root,
            servicePresent: service !== undefined,
            channelAvailable: askHuman !== null,
            asked,
            result,
            decisionFiles,
            approvalProblems,
            lawsInForce: (compiled.bundle?.laws ?? []).map((law) => ({ id: law.id, approvedBy: law.approvedBy })),
            counts: compiled.report.counts,
            compileProblemCodes: compiled.problems.map((entry) => entry.code),
          }
        },
      }),
    )
    return () => dispose()
  })
}
