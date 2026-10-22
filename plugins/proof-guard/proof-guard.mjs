/**
 * PURPOSE
 *   Make the no-autotest ruling mechanical at the point a test file is written.
 *   The rule is not "no tests ever"; it is "no pointless tests". The guard cannot
 *   judge quality, so it requires the writer to state the production behavior and
 *   the failure the test prevents in a `PROOF:` header. A trivial test can still
 *   fake the header; the human review and the handoff evidence remain the real
 *   check. This is friction in the right place, not proof by itself.
 *
 * INPUTS
 *   Config (all optional):
 *     mode          "deny" (default) or "warn".
 *     required      header markers. Default PROOF, Behavior, "Fails when".
 *     allowPaths    absolute or workspace-relative path prefixes to leave alone.
 *     testPattern   override the built-in test-path regular expression.
 *
 * OUTPUTS
 *   One `tools/pre-execute` waterfall listener. It calls `next()` for every
 *   allowed call, so later listeners keep their say. A denied write returns the
 *   registry's `{ kind: 'deny', reason }` decision and never reaches the tool.
 *
 * KEYWORDS
 *   no autotests, proof, test guard, tools/pre-execute, write, edit, PROOF header
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Only `write` and `edit` are inspected. A shell command that creates a test
 *     file is outside this seam; the skill and the review still apply.
 *   - An edit to a test file that already carries the header is allowed, so
 *     legacy files are not trapped.
 *   - A path outside a session workspace is read only to check its existing
 *     header; a read failure is treated as "no header", never as a crash.
 *   - `mode: "warn"` logs and allows, so a team can trial the rule before it can
 *     block work.
 *   - A non-test path, or a call with no file path, is passed through untouched.
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/** What a test path looks like across the ecosystems this deployment touches. */
export const DEFAULT_TEST_PATTERN = String.raw`(^|/)(__tests__|tests?|specs?)(/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|/)test_[^/]+\.py$|_test\.go$`

/** Default markers that turn a test file into a stated claim. */
export const DEFAULT_REQUIRED = ['PROOF', 'Behavior', 'Fails when']

/**
 * Build the policy from raw config.
 *
 * @param config - Raw plugin config.
 * @returns A total policy.
 */
export function normalizeConfig(config = {}) {
  const mode = config.mode === 'warn' ? 'warn' : 'deny'
  const required = Array.isArray(config.required) && config.required.length > 0
    ? config.required.filter((marker) => typeof marker === 'string' && marker.trim() !== '')
    : DEFAULT_REQUIRED
  return {
    mode,
    required: required.length > 0 ? required : DEFAULT_REQUIRED,
    allowPaths: Array.isArray(config.allowPaths) ? config.allowPaths.filter((path) => typeof path === 'string' && path !== '') : [],
    testPattern: typeof config.testPattern === 'string' && config.testPattern !== '' ? config.testPattern : DEFAULT_TEST_PATTERN,
  }
}

/**
 * Whether a path names a test file.
 *
 * @param path - File path as the tool received it.
 * @param policy - Normalized policy.
 * @returns Whether the guard should inspect the call.
 */
export function isTestPath(path, policy) {
  if (typeof path !== 'string' || path === '') return false
  return new RegExp(policy.testPattern).test(path.replaceAll('\\', '/'))
}

/**
 * Whether a text states every required marker.
 *
 * @param text - New content, or an existing file's content.
 * @param policy - Normalized policy.
 * @returns Whether the header is present.
 */
export function hasProof(text, policy) {
  if (typeof text !== 'string' || text === '') return false
  return policy.required.every((marker) => new RegExp(`${escapeRegExp(marker)}\\s*:`, 'i').test(text))
}

/** Escape a literal marker for use in a regular expression. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Read an existing file's content, or '' when it cannot be read.
 *
 * @param path - File path from the tool args.
 * @param cwd - Session working directory, when known.
 * @returns Existing content, or ''.
 */
function existingContent(path, cwd) {
  if (typeof path !== 'string' || path === '') return ''
  const target = isAbsolute(path) ? path : resolve(typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd(), path)
  try {
    return readFileSync(target, 'utf8')
  } catch {
    return ''
  }
}

/** Default text shown when a write is denied. */
const DENY_HINT = 'This deployment does not write autotests. Prove behavior by running the product, or, if the human asked for a test, add a PROOF header naming `Behavior:`, `Fails when:` and `Production path:` — and make the test name real production behavior, not a restatement of the implementation.'

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'proof-guard'

/** The tool registry is required for the pre-execute waterfall. */
export const inject = ['tools']

/**
 * Register the guard.
 *
 * @param ctx - Cordis context.
 * @param config - Raw plugin config.
 */
export function apply(ctx, config = {}) {
  const policy = normalizeConfig(config)
  const pattern = new RegExp(policy.testPattern)

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec?.name !== 'write' && exec?.name !== 'edit') return next()
    const args = exec.arguments
    const path = args?.file_path ?? args?.path ?? args?.filePath
    if (typeof path !== 'string' || path === '') return next()
    if (!pattern.test(path.replaceAll('\\', '/'))) return next()
    const cwd = exec.agent?.session?.header?.cwd
    if (policy.allowPaths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return next()

    const nextContent = exec.name === 'write' ? args?.content : args?.new_string
    const existing = existingContent(path, cwd)
    if (hasProof(typeof nextContent === 'string' ? nextContent : '', policy) || hasProof(existing, policy)) {
      return next()
    }

    const reason = `${DENY_HINT}\nFile: ${path}`
    if (policy.mode === 'warn') {
      ctx.logger.warn(`proof-guard: ${path} has no PROOF header (warn mode; allowing)`)
      return next()
    }
    ctx.logger.warn(`proof-guard: denied ${exec.name} to ${path} (no PROOF header)`)
    return { kind: 'deny', reason }
  })
}
