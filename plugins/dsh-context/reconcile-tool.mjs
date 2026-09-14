/**
 * The `ratchet_reconcile` tool: gather the decision records, ask the reader to reconcile them.
 *
 * Whether two decisions conflict is a question about meaning. No comparison of text decides it, so
 * this tool deliberately does not try: it collects the records deterministically, states the question
 * precisely, and hands both to the agent that asked. The agent is the judge; the tool is the clerk.
 *
 * Three properties follow from that split, and each is load-bearing:
 *
 * 1. **Advisory, never a gate.** The answer comes from a model, so it cannot define "done". A
 *    non-deterministic check that could fail a build is one people learn to re-run until it passes.
 * 2. **Facts, not the whole document.** Each record arrives with its decision and a bounded excerpt of
 *    its consequences. Sending four hundred lines of markdown per record makes the comparison noisier
 *    without making it better.
 * 3. **A named home.** Findings go to `reports/semantic-report.json`, so the recommendation is
 *    recorded and reviewable instead of scrolling away with the conversation.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { readDecisions } from './context-core.mjs';

/** Where a reconciler writes what it concluded. */
export const SEMANTIC_REPORT_PATH = 'reports/semantic-report.json';

/**
 * Builds the question the reader must answer.
 *
 * With a focus, one record is compared against the rest; without one, every active pair is. Fewer
 * than two records means there is nothing to compare, and saying so is better than asking a question
 * with no possible finding.
 *
 * @param count - Number of active records available.
 * @param focus - Decision id being changed, or `null` to compare all pairs.
 * @returns The question, as one sentence.
 */
export function reconcileQuestion(count, focus) {
  if (count < 2) {
    return 'Fewer than two active decisions exist, so there is nothing to reconcile yet.';
  }
  if (focus === null) {
    return (
      'Compare every pair of active decisions below and report the pairs whose Decision statements ' +
      'cannot both hold at the same time.'
    );
  }
  return (
    `Compare decision ${focus} against every other active decision below and report the ones it ` +
    'contradicts: which record, what it claims, and what the two claims are that cannot both hold.'
  );
}

/**
 * The exact shape a finding must have, and the instruction to write it.
 *
 * Spelled out rather than left to the reader: a free-form answer cannot be compared between runs or
 * accumulated, and the point of writing a report is that the next reader can tell what was checked.
 *
 * @returns Instruction text, including the JSON shape and the reporting rule.
 */
export function reconcileInstruction() {
  const shape = [
    '{',
    '  "generatedAt": "<ISO 8601 timestamp>",',
    '  "focus": "<decision id or null>",',
    '  "reviewed": <number of pairs considered>,',
    '  "findings": [',
    '    {',
    '      "records": ["<id>", "<id>"],',
    '      "claim": "<what the two decisions disagree about>",',
    '      "evidence": ["<phrase from one record>", "<phrase from the other>"],',
    '      "confidence": "high" | "medium" | "low"',
    '    }',
    '  ]',
    '}',
  ].join('\n');
  return (
    `Answer the question using only these records, then write ${SEMANTIC_REPORT_PATH} as:\n\n${shape}\n\n` +
    'Report no finding rather than a speculative one: a fabricated conflict costs a reader exactly as ' +
    'much as a missed one, and an empty findings list is a real result. This is advice for a human or ' +
    'agent to act on; it is never a gate, and nothing in the verification pipeline reads it to decide ' +
    'whether work is done.'
  );
}

/** Registers the reconciler tool. */
export function registerReconcileTool(ctx, rootFor, noManifest, readManifest) {
  ctx.tools.register(
    defineTool({
      name: 'ratchet_reconcile',
      description:
        'Gather every architecture decision record as structured facts, so a new or changed decision ' +
        'can be checked against the ones already made. Call this before writing or amending a record, ' +
        'and when a change might contradict a decision someone already took. It returns the decisions ' +
        'and the question to answer; it does not judge them, because whether two decisions conflict is ' +
        'a question about meaning that no mechanical comparison decides. Record the answer in ' +
        `${SEMANTIC_REPORT_PATH}. This is advice, never a gate.`,
      parameters: {
        focus: {
          type: 'string',
          description:
            'Optional decision id being changed, e.g. "0007". When given, the question asks for that record against every other one rather than all pairs.',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute(args, exec) {
        const root = rootFor(exec);
        if (root === null) {
          return Promise.resolve(noManifest(null));
        }
        const read = readManifest(root);
        if (read.error !== undefined) {
          return Promise.resolve({ ok: false, reason: read.error });
        }
        const result = readDecisions(root);
        const focus = typeof args.focus === 'string' && args.focus.length > 0 ? args.focus : null;
        const active = result.records.filter((record) => record.supersededBy === null);
        return Promise.resolve({
          ok: true,
          project: read.manifest.name,
          records: active,
          superseded: result.records
            .filter((record) => record.supersededBy !== null)
            .map((record) => ({ id: record.id, supersededBy: record.supersededBy })),
          problems: result.problems,
          question: reconcileQuestion(active.length, focus),
          instruction: reconcileInstruction(),
        });
      },
    }),
  );
}
