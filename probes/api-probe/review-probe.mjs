/**
 * PURPOSE
 *   Prove the Ratchet's dynamic review works end to end: a real project on disk,
 *   the ratchet's own prompt builder, a child agent spawned as the judge, and the
 *   ratchet's own verdict validator.
 *
 *   A probe that hand-wrote a judge prompt would prove only that a child agent can
 *   be spawned — which the judge probe already establishes. What is unproven until
 *   this runs is the SEAM: that `ratchet-ops.review` builds a usable prompt from a
 *   real corpus, that the subagents runtime accepts an `outputSchema` asked for by
 *   production code rather than by a probe, and that a verdict coming back through
 *   the validator survives its reference check against laws that actually exist.
 *
 * INPUTS
 *   No configuration. Mounted only by `scripts/probe-dsh-api.mjs --ratchet-review`.
 *   The fixture project is written under `os.tmpdir()/ratchet-review-fixture` — a
 *   scratch location, never the session workspace, so running the probe cannot
 *   change the project being probed.
 *
 * OUTPUTS
 *   Registers `zzprobe_ratchet_review`, which returns the ratchet's review result
 *   verbatim plus the fixture path, so the evidence records what the real code
 *   produced rather than a paraphrase.
 *
 * KEYWORDS
 *   dynamic ratchet, integration probe, judge spawn, verdict validation, end to end
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The fixture directory already exists: rebuilt from scratch, so a previous
 *     run's ADR can never be this run's input.
 *   - The ratchet plugin is not mounted: the tool is not registered, so the probe
 *     script reports a missing tool rather than a failed review.
 *   - No parent agent on the call, or no subagents runtime: `spawnJudge` is null and
 *     the review degrades, which the probe reports as `degraded: true` instead of
 *     treating as a failure of the code under test.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { hashSource } from '../../plugins/ratchet/ratchet-schema.mjs'
import { ingest, review } from '../../plugins/ratchet/ratchet-ops.mjs'

/** Cordis function-plugin name; also the id a patch row targets. */
export const name = 'api-probe-ratchet-review'

/**
 * The tool registry, and nothing else.
 *
 * `subagents` is deliberately NOT declared: it is reached through `ctx.get` at call
 * time so the probe can report its absence as a degraded review rather than
 * failing the whole boot. Declaring a service the composition does not mount leaves
 * the entry pending and fails the tree, which is a much worse way to learn that a
 * capability is missing.
 */
export const inject = ['tools']

/**
 * The service name the subagent runtime registers under.
 *
 * Plural, and the spelling is load-bearing: the row id is `subagent` while the
 * constructor calls `super(ctx, "subagents")`. Asking for the singular produced a
 * completely false "the runtime is unreachable" finding during API discovery.
 */
const SUBAGENTS_SERVICE = 'subagents'

/** Where the fixture project is written. Scratch by construction. */
export const FIXTURE_PATH = join(tmpdir(), 'ratchet-review-fixture')

/** The raw source the fixture decision claims to come from. */
const SOURCE_TEXT = [
  '# Grilling session: session storage',
  '',
  'Sessions currently live in local files. Under two instances that breaks, so we',
  'agreed to move them to Redis, which the deployment already runs.',
  '',
].join('\n')

/**
 * Writes the fixture project the review runs against.
 *
 * It is a minimal but COMPLETE ratchet project — manifest, source, ADR with a
 * verified source hash, and a law with a real check — because a review of an
 * incomplete project would exercise the error paths instead of the happy one.
 *
 * @returns The absolute fixture root.
 */
function buildFixture() {
  rmSync(FIXTURE_PATH, { recursive: true, force: true })
  mkdirSync(join(FIXTURE_PATH, '.dsh'), { recursive: true })
  mkdirSync(join(FIXTURE_PATH, 'docs', 'adrs'), { recursive: true })
  mkdirSync(join(FIXTURE_PATH, 'docs', 'ratchet', 'sources'), { recursive: true })
  mkdirSync(join(FIXTURE_PATH, 'src', 'auth'), { recursive: true })

  writeFileSync(
    join(FIXTURE_PATH, '.dsh', 'project.json'),
    `${JSON.stringify(
      {
        manifestVersion: 2,
        name: 'ratchet-review-fixture',
        languages: [{ id: 'typescript', extensions: ['.ts'], roots: ['src'] }],
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
            { id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly', requiresDecisionRecord: true },
            // A second zone so an ingestion judge has somewhere honest to put a
            // decision that has nothing to do with session storage. A fixture with
            // one narrow zone forces every ingested record into it or into failure,
            // and the failure would look like a tool defect rather than a thin
            // fixture — which is exactly what happened on the first run.
            { id: 'jobs', paths: ['src/jobs/**'], agentAuthority: 'proposeOnly', requiresDecisionRecord: false },
          ],
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(join(FIXTURE_PATH, 'docs', 'ratchet', 'sources', 'session-storage.md'), SOURCE_TEXT)
  writeFileSync(join(FIXTURE_PATH, 'src', 'auth', 'session.ts'), "import { createClient } from 'redis'\nexport const client = createClient()\n")
  writeFileSync(
    join(FIXTURE_PATH, 'docs', 'adrs', '0001-use-redis.adr.md'),
    [
      '---',
      'id: "0001"',
      'title: Use Redis for session storage',
      'type: adr',
      'status: active',
      'author:',
      '  authority: human',
      '  name: probe',
      'created: "2026-09-13T00:00:00Z"',
      'source:',
      '  kind: file',
      '  path: docs/ratchet/sources/session-storage.md',
      `  hash: ${hashSource(SOURCE_TEXT)}`,
      'zones:',
      '  - auth',
      'supersedes: []',
      'approves: []',
      'laws:',
      '  - op: upsert',
      '    id: auth.session-storage.redis',
      '    statement: Session storage must use Redis.',
      '    checks:',
      '      - type: required_text',
      '        paths:',
      '          - src/auth/**',
      '        pattern: redis',
      '---',
      '',
      '## Context',
      '',
      'Sessions are stored in local files, which breaks under two instances.',
      '',
      '## Decision',
      '',
      'Session storage must use Redis.',
      '',
      '## Reasoning',
      '',
      'Redis is already deployed and provides TTL, so no new dependency is introduced',
      'and multi-instance deployments share session state.',
      '',
      '## Consequences',
      '',
      '- Local file session adapters are prohibited.',
      '',
    ].join('\n'),
  )
  return FIXTURE_PATH
}

/**
 * Concatenates the text blocks of a subagent result's output.
 *
 * A child asked for a schema answers through `structured` and may return empty
 * text; a child that ignored the schema answers in text. Both are read, so neither
 * shape is mistaken for an empty verdict.
 *
 * @param content - Content blocks, or any value.
 * @returns The joined text, or an empty string.
 */
function textOf(content) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/** The change the judge is asked about. It plainly contradicts the Redis decision. */
const PROPOSED_CHANGE = [
  'diff --git a/src/auth/session.ts b/src/auth/session.ts',
  '--- a/src/auth/session.ts',
  '+++ b/src/auth/session.ts',
  '@@ -1,2 +1,2 @@',
  "-import { createClient } from 'redis'",
  "-export const client = createClient()",
  "+import { FileStore } from 'session-file-store'",
  '+export const store = new FileStore({ path: "/tmp/sessions" })',
].join('\n')

/**
 * The source the ingestion leg reads.
 *
 * It states a decision AND the reasoning behind it, because that is the only kind of
 * source ingestion will record. A source with the reasoning stripped out produces
 * `INSUFFICIENT_REASONING` instead, which is the other half of the behaviour and is
 * covered by the unit tests — this leg exists to prove the happy path reaches a
 * judge and comes back as a compilable record.
 */
const INGEST_SOURCE = [
  '# Grilling session: background job retries',
  '',
  'Background jobs currently retry three times immediately and then drop the work.',
  'That was fine while everything ran in one process, but the queue now spans two',
  'workers and a dropped job is invisible until somebody notices the data is stale.',
  'We agreed to move to exponential backoff with a dead-letter queue, because retrying',
  'immediately during an outage burns the attempts before the dependency recovers, and',
  'a dead-letter queue makes the failure visible instead of losing it.',
  '',
].join('\n')

/**
 * Registers the integration probe tool.
 *
 * @param ctx - Cordis context exposing `tools`.
 * @returns Nothing; the registration is made inside `ctx.effect`.
 */
export function apply(ctx) {
  ctx.effect(() => {
    const dispose = ctx.tools.register(
      defineTool({
        name: 'zzprobe_ratchet_review',
        description:
          'Probe: run the ratchet dynamic review end to end against a fixture project, spawning a real ' +
          'judge child agent through the subagents runtime and validating its verdict.',
        parameters: {},
        output: {
          schema: { type: 'json' },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(_args, exec) {
          const root = buildFixture()
          const runtime = ctx.get(SUBAGENTS_SERVICE)
          const agent = exec?.agent

          const spawnJudge =
            runtime === undefined || agent === undefined
              ? null
              : async (prompt, outputSchema) => {
                  const run = await runtime.start('spawn', {
                    label: 'ratchet-review-probe',
                    prompt: [{ type: 'text', text: prompt }],
                    parent: agent,
                    signal: exec.signal,
                    outputSchema,
                  })
                  try {
                    const result = await run.result
                    return {
                      structured: result.structured ?? null,
                      output: textOf(result.output),
                      stopReason: result.stopReason,
                      diagnostic: result.diagnostic ?? null,
                    }
                  } finally {
                    await run.dispose()
                  }
                }

          // Timed here rather than read from the result: the figure that matters is
          // the round trip the caller waits for, judge spawn included, and measuring
          // it at the call site is what makes the two jobs comparable.
          const reviewStarted = Date.now()
          const reviewResult = await review({
            root,
            job: 'review_change',
            change: PROPOSED_CHANGE,
            spawnJudge,
            record: false,
          })
          const reviewElapsedMs = Date.now() - reviewStarted

          // Ingestion, measured on the same run so its cost is comparable to the
          // review's. The source is a second document written for this leg: the
          // fixture's own ADR already exists, and ingestion refuses to duplicate a
          // recorded decision.
          const ingestedSourcePath = 'docs/ratchet/sources/background-jobs.md'
          writeFileSync(
            join(root, ingestedSourcePath),
            INGEST_SOURCE,
          )
          const ingestStarted = Date.now()
          const ingestResult = await ingest({
            root,
            sourcePath: ingestedSourcePath,
            spawnJudge,
            write: false,
            now: '2026-09-13T00:00:00Z',
          })
          const ingestElapsedMs = Date.now() - ingestStarted

          return {
            probe: 'ratchet-review',
            fixture: root,
            judgeAvailable: spawnJudge !== null,
            runtimePresent: runtime !== undefined,
            // The whole point: return what the production code produced.
            review: reviewResult,
            reviewElapsedMs,
            ingest: {
              ...ingestResult,
              // The prompt is large; the evidence records its size rather than its
              // text, so a report stays readable while the figure is still checkable.
              promptBytes: typeof ingestResult.prompt === 'string' ? ingestResult.prompt.length : null,
              elapsedMs: ingestElapsedMs,
            },
            ingestElapsedMs,
          }
        },
      }),
    )
    return () => dispose()
  })
}
