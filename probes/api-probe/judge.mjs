/**
 * PURPOSE
 *   Prove that the dynamic-review path is real: that a Ratchet plugin can spawn
 *   an independent judge agent from inside a tool body, wait for its verdict, and
 *   hand a structured answer back to the caller.
 *
 *   This is the load-bearing capability of Ratchet v2's dynamic layer. An earlier
 *   probe reported it as unreachable, but that finding was an artefact of two
 *   wrong names — `subagent` for a service registered as `subagents`, and a
 *   declaration whose satisfaction was never checked. Believing the correction
 *   without spawning a child would trade one unverified claim for another, so
 *   this probe actually starts a child agent and reads its answer.
 *
 * INPUTS
 *   No configuration. Mounted only by `scripts/probe-dsh-api.mjs --probe-judge`,
 *   over a scratch DSH_HOME. The prompt is fixed and trivial so the probe costs
 *   one short child turn on the deployment's flash model.
 *
 * OUTPUTS
 *   Registers `zzprobe_judge`, which returns the child's run id, stop reason, raw
 *   output text, and — when a structured schema was requested — the validated
 *   structured value. Every stage is timed so the cost of a judge round trip is
 *   visible rather than guessed. A failure is reported as data (`stopReason`,
 *   `diagnostic`, `stage`), never thrown, so the caller sees which stage broke.
 *
 * KEYWORDS
 *   dynamic ratchet, judge agent, subagents runtime, spawn provider, structured
 *   output, one-shot delegation, api probe
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `exec.agent`: the probe reports `stage: 'no-parent'` and does not call
 *     `start`, because the runtime raises a named error without a parent.
 *   - The child's turn never settles: bounded by `JUDGE_TIMEOUT_MS`; the probe
 *     reports `stage: 'timeout'` and still awaits `dispose()` so a cancelled run
 *     reaches quiescence instead of leaking.
 *   - A rejected `start` (no provider, unusable cwd, schema rejected): the
 *     message is captured with its stage, because "which call refused" is the
 *     diagnostic value here.
 *   - A stopped child (`stopReason` other than `completed`): returned as data
 *     with its `diagnostic`, so a broken judge is distinguishable from a broken
 *     plumbing layer.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis function-plugin name; also the id a patch row targets. */
export const name = 'api-probe-judge'

/**
 * Services required before `apply` runs.
 *
 * `subagents` is the runtime's REAL registration name — its constructor calls
 * `super(ctx, "subagents")`. Declaring the singular leaves the entry pending and
 * fails the whole boot, which is exactly the trap this probe exists to document.
 */
export const inject = ['tools', 'subagents']

/** Milliseconds to wait for the child's verdict before reporting a timeout. */
const JUDGE_TIMEOUT_MS = 120_000

/**
 * The judge's instruction.
 *
 * Deliberately trivial: the probe measures whether a child agent can be started,
 * asked, and read back at all. A substantive review prompt would confound "the
 * plumbing works" with "the model answered well".
 */
const JUDGE_PROMPT =
  'You are a probe. Reply with exactly the text RATCHET_JUDGE_OK and nothing else. ' +
  'Do not call any tool.'

/**
 * The instruction for the structured leg.
 *
 * It spells out the JSON shape AND forbids prose around it, because the capture
 * mechanism parses what the child says: a child that answers helpfully in a
 * sentence fails capture while being perfectly correct. This is the prompt-side
 * half of the lesson the first structured attempt taught.
 */
const JUDGE_SCHEMA_PROMPT =
  'You are a probe. Reply with ONLY this JSON object and nothing else — no prose, no code fence:\n' +
  '{"verdict":"ok","reason":"RATCHET_JUDGE_OK"}\n' +
  'Do not call any tool.'

/** The structured answer the judge is asked to produce. */
const JUDGE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['ok', 'not-ok'] },
    reason: { type: 'string' },
  },
  required: ['verdict', 'reason'],
}

/**
 * The instruction for a RATCHET review, used by the integration leg.
 *
 * It asks a question the ratchet's judge prompt asks, so the answer proves the
 * whole path end to end: the ratchet builds a real prompt from a real corpus,
 * a child agent answers it, and the verdict is validated against the laws that
 * actually exist. A made-up answer would be caught by the reference check, so a
 * returned verdict carrying a real law id is evidence the corpus reached the child.
 */
const RATCHET_REVIEW_PROMPT = [
  'You are reviewing a project that records architecture decisions as ADRs and enforces',
  'them as laws checked against the code.',
  '',
  'The laws in force are:',
  '- auth.session-storage.redis: "Session storage must use Redis."',
  '  checks: required_text(redis) under src/auth/**',
  '',
  'A proposed change makes session storage use signed cookies instead of Redis.',
  '',
  'Decide whether that change respects the decision above.',
  '',
  'Reply with ONLY this JSON object and nothing else:',
  '{"ok":<boolean>,"findings":[{"severity":"error","kind":"semantic_violation",',
  '"lawId":"auth.session-storage.redis","explanation":"<why>"}]}',
].join('\n')

/**
 * Concatenates the text blocks of a content array.
 *
 * @param content - Content blocks, or any value; non-text blocks are ignored.
 * @returns The joined text, or an empty string.
 */
function textOf(content) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/**
 * Registers the judge probe tool.
 *
 * @param ctx - Cordis context; `subagents` is available because `inject` names it.
 * @returns Nothing; the registration is made inside `ctx.effect`.
 */
export function apply(ctx) {
  ctx.effect(() => {
    const dispose = ctx.tools.register(
      defineTool({
        name: 'zzprobe_judge',
        description:
          'Probe: spawn an independent judge agent through the subagents runtime, wait for its ' +
          'verdict, and report the run id, stop reason, raw output and structured value with timings.',
        parameters: {},
        output: {
          schema: { type: 'json' },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(_args, exec) {
          const started = Date.now()
          const report = {
            probe: 'judge',
            stage: 'init',
            parentAgentId: exec?.agent?.id ?? null,
            signalPresent: exec?.signal !== undefined,
            providers: null,
            // Two legs, measured separately. The unstructured leg proves the
            // spawn/await/read path; the structured leg proves whether a requested
            // schema is honoured. Asserting one result for both conflates a
            // working judge with a working schema, and the first version of this
            // probe did exactly that — it passed while the structured field was
            // silently null.
            plain: null,
            structuredLeg: null,
            elapsedMs: null,
          }

          // The runtime refuses `start` without a parent Agent, so the absence is
          // reported rather than turned into a thrown error.
          if (exec?.agent === undefined) {
            report.stage = 'no-parent'
            report.elapsedMs = Date.now() - started
            return Promise.resolve(report)
          }

          try {
            report.providers = await ctx.subagents.list()
          } catch (error) {
            report.providers = `list threw: ${String(error)}`
          }

          /**
           * Runs one child to completion and reports what came back.
           *
           * Never throws: a failure is data, because "which call refused" is the
           * diagnostic value and a throw would collapse three stages into one.
           */
          const runOne = async (label, prompt, outputSchema) => {
            const leg = { label, runId: null, stage: 'start', stopReason: null, diagnostic: null, outputText: null, structured: null, elapsedMs: null }
            const legStarted = Date.now()
            let run
            try {
              run = await ctx.subagents.start('spawn', {
                label,
                prompt: [{ type: 'text', text: prompt }],
                parent: exec.agent,
                signal: exec.signal,
                ...(outputSchema === null ? {} : { outputSchema }),
              })
              leg.runId = run.id
            } catch (error) {
              leg.stage = 'start-failed'
              leg.diagnostic = String(error)
              leg.elapsedMs = Date.now() - legStarted
              return leg
            }
            try {
              leg.stage = 'await-result'
              const result = await Promise.race([
                run.result,
                new Promise((resolveTimeout) =>
                  setTimeout(() => resolveTimeout({ __timeout: true }), JUDGE_TIMEOUT_MS),
                ),
              ])
              if (result?.__timeout === true) {
                leg.stage = 'timeout'
              } else {
                leg.stage = 'completed'
                leg.stopReason = result?.stopReason ?? null
                leg.diagnostic = result?.diagnostic ?? null
                leg.outputText = textOf(result?.output)
                leg.structured = result?.structured ?? null
              }
            } catch (error) {
              leg.stage = 'result-rejected'
              leg.diagnostic = String(error)
            } finally {
              // The run contract requires disposal to reach quiescence; skipping
              // it on the timeout path would leak the very work being cancelled.
              try {
                await run.dispose()
              } catch (error) {
                leg.diagnostic = `${leg.diagnostic ?? ''} | dispose: ${String(error)}`.trim()
              }
            }
            leg.elapsedMs = Date.now() - legStarted
            return leg
          }

          report.plain = await runOne('ratchet-judge-plain', JUDGE_PROMPT, null)
          report.structuredLeg = await runOne('ratchet-judge-structured', JUDGE_SCHEMA_PROMPT, JUDGE_OUTPUT_SCHEMA)
          report.stage = report.plain.stage
          report.elapsedMs = Date.now() - started
          return report
        },
      }),
    )
    return () => dispose()
  })
}
