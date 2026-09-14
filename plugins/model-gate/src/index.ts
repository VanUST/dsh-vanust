/**
 * Deployment model-cost gate for the official DeepSeek route.
 *
 * Every model dispatch — root turns, subagents, compaction, session titles —
 * passes the `llm/stream` waterfall. This plugin watches that chokepoint and
 * vetoes a request whose model matches no allowed exact id and no allowed
 * pattern, throwing before the waterfall's base `next()` runs so the adapter is
 * never invoked and nothing is dispatched or billed.
 *
 * The policy is expressed by model CLASS rather than by release version. The
 * shipped default admits every DeepSeek Flash id (current and future, for
 * example `deepseek-flash`, `deepseek-v4-flash`, `deepseek-v5.1-flash-vision`)
 * so a new Flash release needs no policy edit, while non-Flash tiers such as
 * the pro line match nothing and stay blocked. The gate is opt-in
 * (`enabled: true`) because a deployment, not the package, owns its cost
 * policy; the dsh-kit profile enables it.
 *
 * @module @deepseek-ai/dsh-model-gate
 */

import type { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'

/** Cordis function-plugin name. */
export const name = 'model-gate'

/** The gate reads the dispatch chokepoint the llm service emits. */
export const inject = ['llm']

/**
 * Default allowlist pattern: any DeepSeek Flash-class model id with an optional
 * version segment, so `deepseek-flash`, `deepseek-v4-flash`,
 * `deepseek-v4-flash-vision-exp` and a future `deepseek-v5.1-flash` all pass.
 * Ids naming a non-Flash tier (`deepseek-v4-pro`) deliberately do not match.
 */
export const FLASH_CLASS_DEFAULT_PATTERN = '^deepseek-(v[0-9.]+-)?flash(-[a-z0-9-]+)*$'

/** Patterns applied when the deployment configures no matcher of its own. */
export const DEFAULT_ALLOWED_MODEL_PATTERNS: readonly string[] = [FLASH_CLASS_DEFAULT_PATTERN]

/** Stable failure code carried by every vetoed request. */
export const MODEL_NOT_ALLOWED_CODE = 'MODEL_NOT_ALLOWED'

/** Plugin configuration. */
export interface Config {
  /** Whether the gate is active. @default false */
  enabled?: boolean
  /** Exact model ids allowed to reach the adapter. @default [] */
  allowedModels?: string[]
  /**
   * Model-id patterns (regular expressions matched against the whole id)
   * allowed to reach the adapter. @default DEFAULT_ALLOWED_MODEL_PATTERNS
   */
  allowedModelPatterns?: string[]
}

/** Schema served to the profile composer for the row's config. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  allowedModels: z.array(z.string()).default([]),
  allowedModelPatterns: z.array(z.string()).default([...DEFAULT_ALLOWED_MODEL_PATTERNS]),
})

/**
 * Compile the configured matchers, rejecting a configuration that would gate
 * every request or that carries an unusable pattern.
 * @param config - resolved plugin configuration.
 * @returns the compiled policy and a human-readable description for errors.
 * @throws when no matcher is configured or a pattern does not compile.
 */
function compilePolicy(config: Config): { models: string[]; patterns: RegExp[]; describe: string } {
  const models = (config.allowedModels ?? []).filter(model => model.length > 0)
  const sources = (config.allowedModelPatterns ?? DEFAULT_ALLOWED_MODEL_PATTERNS)
    .filter(source => source.length > 0)
  if (models.length === 0 && sources.length === 0) {
    throw new Error('model-gate: an enabled gate requires at least one allowed model or pattern')
  }
  const patterns = sources.map((source) => {
    try {
      return new RegExp(source)
    } catch {
      throw new Error(`model-gate: allowed model pattern ${JSON.stringify(source)} is not a valid regular expression`)
    }
  })
  return { models, patterns, describe: [...models, ...sources].join(', ') }
}

/**
 * Install the gate on one context.
 * @param ctx - Cordis context whose `llm/stream` dispatches are gated.
 * @param config - resolved plugin configuration.
 * @returns nothing; the listener's registration is owned by the plugin fiber.
 * @throws when enabled with no usable matcher (misconfiguration fails loud).
 */
export function apply(ctx: Context, config: Config): void {
  if (config.enabled !== true) return
  const policy = compilePolicy(config)
  const allowed = (model: string): boolean =>
    policy.models.includes(model) || policy.patterns.some(pattern => pattern.test(model))
  ctx.on('llm/stream', (options, next) => {
    const model = options.model
    if (typeof model !== 'string' || model.length === 0) {
      throw new LlmError('model-gate: request carries no model', MODEL_NOT_ALLOWED_CODE)
    }
    if (!allowed(model)) {
      throw new LlmError(
        `model-gate: model "${model}" is not allowed (allowed: ${policy.describe})`,
        MODEL_NOT_ALLOWED_CODE,
      )
    }
    return next()
  }, { global: true, prepend: true })
}
