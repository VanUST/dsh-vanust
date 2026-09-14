/**
 * Type surface for the harness plugin's pure core.
 *
 * The core is plain ESM because the harness loads `.mjs` directly, but this project is strictly
 * typed, so the shapes the tests rely on are declared here rather than reached through `any`.
 */

/** One inconsistency the core can decide about a specification set. */
export interface SpecProblem {
  readonly spec: string;
  readonly message: string;
}

/** A module's declared contract, read from its leading comments. */
export interface ModuleContract {
  readonly purpose: string | null;
  readonly links: readonly string[];
  readonly exports: readonly string[] | null;
}

/** Finds the project root by walking up from a directory, or `null` when none exists. */
export function findProjectRoot(start?: string): string | null;

/**
 * Reads the workspace directory out of a tool-execution context.
 *
 * Returns `undefined` when the context carries no session, so a caller falls back to the process
 * directory rather than searching from an invented one.
 */
export function sessionRoot(exec: unknown): string | undefined;

/** Reports whether a path is the root or lies beneath it, comparing whole segments. */
export function withinRoot(path: string, root: string): boolean;

/** Reports whether two scope paths overlap. */
export function scopesOverlap(left: string, right: string): boolean;

/** Derives a stable module identifier from a repository-relative path. */
export function moduleIdFor(path: string): string;

/** Reads a module's declared contract from its leading comment run. */
export function readModuleContract(absolutePath: string): ModuleContract;

/** Lists source files a manifest's languages declare, sorted. */
export function listSources(root: string, manifest: unknown): readonly string[];

/** Reads and parses the project manifest. */
export function readManifest(root: string): { manifest?: unknown; error?: string };

/** Builds the actionable answer used when no manifest exists. */
export function noManifest(root: string | null): Record<string, unknown>;

/** Reads every specification file in a project. */
export function readSpecs(root: string): {
  readonly specs: readonly { id: string }[];
  readonly problems: readonly SpecProblem[];
};

/** One architecture decision record, as the reconciler needs it. */
export interface DecisionRecord {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly status: string;
  readonly supersededBy: string | null;
  readonly decision: string | null;
  readonly consequences: string | null;
}

/**
 * Gathers the decision records as structured facts, for reconciliation.
 *
 * @param root - Absolute project root.
 * @returns One entry per record, sorted by identifier, plus any record that could not be read.
 */
export function readDecisions(root: string): {
  readonly records: readonly DecisionRecord[];
  readonly problems: readonly { readonly record: string; readonly message: string }[];
};

/** Validates a specification set against a manifest. */
/**
 * Validates specifications against a manifest, optionally against the filesystem.
 *
 * The `root` argument is what lets the agent-facing tool run the same existence checks as the
 * `specs` gate; omitting it falls back to the process directory, which is only correct for callers
 * that have no project root.
 */
export function validateSpecs(
  specs: readonly unknown[],
  manifest: unknown,
  root?: string,
): { readonly problems: readonly SpecProblem[]; readonly metrics: Record<string, number> };
