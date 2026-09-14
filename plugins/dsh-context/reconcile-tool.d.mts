/**
 * Type surface for the reconciler tool module.
 *
 * The module is plain ESM because the harness loads `.mjs` directly, but this project is strictly
 * typed, so the two pure helpers the tests exercise are declared here rather than reached through
 * `any`. `registerReconcileTool` is a side-effecting registration and is not part of the type surface
 * a test needs.
 */

/** Where a reconciler writes what it concluded. */
export const SEMANTIC_REPORT_PATH: string;

/**
 * Builds the question the reader must answer.
 *
 * @param count - Number of active records available.
 * @param focus - Decision id being changed, or `null` to compare all pairs.
 * @returns The question, as one sentence.
 */
export function reconcileQuestion(count: number, focus: string | null): string;

/**
 * The exact shape a finding must have, and the instruction to write it.
 *
 * @returns Instruction text, including the JSON shape and the reporting rule.
 */
export function reconcileInstruction(): string;
