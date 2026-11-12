/**
 * PURPOSE
 *   Keep one `run_code` result from owning the step's context. A program that prints a
 *   report, a JSON page, or a whole file hands the model tens of kilobytes in one
 *   `tool/result`, and every later step re-sends it. Measured on this workspace's session
 *   logs: run_code calls are a small minority of calls and the bulk of the tool bytes, and
 *   the calls above 8 KB dominate them.
 *
 *   The fix is a PROJECTION that keeps the evidence and moves the bulk: a banner naming
 *   the exact full-text file, the first `headBytes` and the last `tailBytes` of the output,
 *   and an explicit count of the elided middle. The full text is written INSIDE the
 *   session's workspace, so the model can read it back with the ordinary file tools when it
 *   really needs the middle. Nothing is lost; only the default view is bounded.
 *
 *   The seam is `tools/post-execute`, the waterfall that may replace a successful tool
 *   result's model-facing `content` (registered in `@deepseek-ai/dsh-tools/lib/index.js:3600`,
 *   dispatch contract in `dsh-tools/lib/types/index.d.ts:70`). `run_code`'s own render
 *   produces exactly one text block (`dsh-tools/lib/index.js:1244`), which is what this
 *   policy replaces.
 *
 * INPUTS
 *   Config (all optional):
 *     enabled          false disables the listener. Default true.
 *     minBytes         shortest result worth projecting, in bytes. Default 8192.
 *     headBytes        retained prefix, UTF-8 boundary safe. Default 3072.
 *     tailBytes        retained suffix, UTF-8 boundary safe. Default 1536.
 *     minSavingRatio   skip unless the projection saves at least this fraction of the
 *                      original bytes. Default 0.25, so a barely-oversized result is left
 *                      alone rather than replaced by a banner of nearly the same size.
 *     maxSpillBytes    results above this are left untouched (a banner without a readable
 *                      file would be worse than the full text). Default 8 MiB.
 *     spillDir         directory under the session workspace for the full text.
 *                      Default `.dsh/spill`.
 *
 * OUTPUTS
 *   One `tools/post-execute` listener. When it projects, it returns the accepted decision
 *   with `content` replaced by one text block; otherwise it returns the decision it
 *   received, unchanged. `planProjection` and `parseBanner` are exported so the behaviour
 *   can be exercised without a running harness.
 *
 * KEYWORDS
 *   run_code, output projection, spill file, tools/post-execute, context budget, head,
 *   tail, banner, deterministic
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Only `run_code` is touched. Any other tool name, a failed result (`isError`), a
 *     blocked decision, a decision that replaced `value`, a multi-block or image result,
 *     an aborted signal, and a result below `minBytes` pass through untouched.
 *   - Already projected content is recognised by its banner prefix and left alone, so
 *     running post-execute twice (or re-reading a projected result) creates no second file.
 *   - The spill file is written BEFORE the banner is returned; a write or mkdir failure
 *     leaves the result untouched and logs once, because a banner naming a file that does
 *     not exist is worse than a long result.
 *   - The workspace is the session header's `cwd`. A call with no cwd is not projected
 *     (there is nowhere legitimate to put the full text).
 *   - Head and tail are cut by `@deepseek-ai/dsh-output-retention`'s `TextRetainer`, which
 *     trims a partial UTF-8 codepoint at each cut, so a projection can never introduce a
 *     replacement character or a lone surrogate.
 *   - The listener never throws into the turn: its own work is wrapped, logged once per
 *     failure kind, and the decision from `next()` (or the untouched result) is returned.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { TextRetainer } from '@deepseek-ai/dsh-output-retention'

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'run-code-projection'

/** No service is injected: the plugin only observes a waterfall. */
export const inject = []

/** The tool whose successful result may be projected. */
export const RUN_CODE = 'run_code'

/**
 * First line of every projection. It doubles as the idempotency mark: content that already
 * starts with it has been projected and is never projected again.
 */
export const BANNER_PREFIX = '[run-code-projection]'

/** The line naming the full-text file; `parseBanner` reads it. */
export const SPILL_LINE = 'Full text: '

const DEFAULTS = Object.freeze({
  minBytes: 8192,
  headBytes: 3072,
  tailBytes: 1536,
  minSavingRatio: 0.25,
  maxSpillBytes: 8 * 1024 * 1024,
  spillDir: '.dsh/spill',
})

/** A non-negative safe integer, or null. */
function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/**
 * Resolve config into a total policy. Unusable values fall back to the default: a typo must
 * not silently disable a context-budget measure.
 *
 * @param config - raw plugin config.
 * @returns the resolved policy.
 */
export function resolveConfig(config = {}) {
  const minSavingRatio = typeof config.minSavingRatio === 'number' && Number.isFinite(config.minSavingRatio) && config.minSavingRatio >= 0 && config.minSavingRatio <= 1
    ? config.minSavingRatio
    : DEFAULTS.minSavingRatio
  return {
    enabled: config.enabled !== false,
    minBytes: nonNegativeInteger(config.minBytes) ?? DEFAULTS.minBytes,
    headBytes: nonNegativeInteger(config.headBytes) ?? DEFAULTS.headBytes,
    tailBytes: nonNegativeInteger(config.tailBytes) ?? DEFAULTS.tailBytes,
    minSavingRatio,
    maxSpillBytes: nonNegativeInteger(config.maxSpillBytes) ?? DEFAULTS.maxSpillBytes,
    spillDir: typeof config.spillDir === 'string' && config.spillDir !== '' ? config.spillDir : DEFAULTS.spillDir,
  }
}

/** The session workspace a result's spill file belongs in, or null when the session names none. */
function sessionCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : null
}

/**
 * The one text block of a result, or null. `run_code` renders exactly one text block; any
 * other shape (an image, several blocks, a non-text block) is not this policy's business.
 *
 * @param content - a result's `content` blocks.
 * @returns the text, or null.
 */
function singleText(content) {
  if (!Array.isArray(content) || content.length !== 1) return null
  const block = content[0]
  if (block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') return null
  return block.text
}

/** Whether text already carries this plugin's banner. */
export function isProjected(text) {
  return typeof text === 'string' && text.startsWith(BANNER_PREFIX)
}

/**
 * Read the full-text path out of a projected banner, or null.
 *
 * @param text - projected content.
 * @returns the absolute path as written in the banner, or null.
 */
export function parseBanner(text) {
  if (!isProjected(text)) return null
  const line = text.split('\n', 3).find((candidate) => candidate.startsWith(SPILL_LINE))
  if (line === undefined) return null
  const path = line.slice(SPILL_LINE.length).trim()
  return path === '' ? null : path
}

/** A filename-safe short identity for a call id. */
function safeCallId(callId) {
  const raw = typeof callId === 'string' && callId !== '' ? callId : 'call'
  const safe = raw.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 64)
  return safe === '' ? 'call' : safe
}

/**
 * Plan one projection without touching the filesystem.
 *
 * The spill path is part of the plan (and of the banner), so a caller can decide whether the
 * projection is worth it BEFORE writing a file nobody will be told about.
 *
 * @param text - the result text.
 * @param options - `{ minBytes, headBytes, tailBytes, minSavingRatio, cwd, spillDir, callId }`.
 * @returns `{ text, spillPath, beforeBytes, afterBytes, elidedBytes, head, tail }` or null
 *   when the result must pass through untouched.
 */
export function planProjection(text, options) {
  if (typeof text !== 'string' || text.length === 0) return null
  if (isProjected(text)) return null
  const beforeBytes = Buffer.byteLength(text, 'utf8')
  if (beforeBytes < options.minBytes) return null
  if (beforeBytes > options.maxSpillBytes) return null
  if (typeof options.cwd !== 'string' || options.cwd === '') return null
  const headRetainer = new TextRetainer({ kind: 'head', maxBytes: options.headBytes })
  headRetainer.push(text)
  const head = headRetainer.finish().text
  const tailRetainer = new TextRetainer({ kind: 'tail', maxBytes: options.tailBytes })
  tailRetainer.push(text)
  const tail = tailRetainer.finish().text
  if (head.length === 0 || tail.length === 0) return null
  const elidedBytes = beforeBytes - Buffer.byteLength(head, 'utf8') - Buffer.byteLength(tail, 'utf8')
  if (elidedBytes <= 0) return null
  const spillPath = resolve(options.cwd, options.spillDir, `run_code-${safeCallId(options.callId)}-${Date.now()}.txt`)
  const projected = [
    `${BANNER_PREFIX} ${beforeBytes} bytes; showing the first ${head.length} chars and the last ${tail.length} chars, ${elidedBytes} bytes elided from the middle.`,
    `${SPILL_LINE}${spillPath}`,
    '',
    head,
    '',
    `[... ${elidedBytes} bytes elided from the middle; the full text is the file named above ...]`,
    '',
    tail,
  ].join('\n')
  const afterBytes = Buffer.byteLength(projected, 'utf8')
  if (afterBytes >= beforeBytes) return null
  if (1 - afterBytes / beforeBytes < options.minSavingRatio) return null
  return { text: projected, spillPath, beforeBytes, afterBytes, elidedBytes, head, tail }
}

/** Write the full text, returning its path; throws so the caller can leave the result alone. */
function writeSpill(spillPath, text) {
  mkdirSync(dirname(spillPath), { recursive: true })
  writeFileSync(spillPath, text, 'utf8')
  return spillPath
}

/**
 * Apply the policy to one post-execute decision. Pure except for the spill write; throws
 * only from filesystem operations, which the listener catches.
 */
function project(exec, result, decision, config, warnOnce) {
  if (exec?.name !== RUN_CODE) return decision
  if (exec.signal?.aborted === true) return decision
  if (result?.isError === true) return decision
  if (decision?.kind !== 'accept' || Object.hasOwn(decision, 'value')) return decision
  const content = decision.content ?? result?.content
  const text = singleText(content)
  if (text === null) return decision
  if (isProjected(text)) return decision
  const cwd = sessionCwd(exec)
  if (cwd === null) {
    warnOnce('no-cwd', 'the session names no workspace; leaving the result untouched')
    return decision
  }
  const plan = planProjection(text, {
    minBytes: config.minBytes,
    headBytes: config.headBytes,
    tailBytes: config.tailBytes,
    minSavingRatio: config.minSavingRatio,
    maxSpillBytes: config.maxSpillBytes,
    cwd,
    spillDir: config.spillDir,
    callId: exec.callId,
  })
  if (plan === null) return decision
  try {
    writeSpill(plan.spillPath, text)
  } catch (error) {
    warnOnce('spill', `could not write ${plan.spillPath}: ${error instanceof Error ? error.message : String(error)}`)
    return decision
  }
  return { ...decision, content: [{ type: 'text', text: plan.text }] }
}

/**
 * Install the post-execute listener.
 *
 * @param ctx - Cordis context.
 * @param config - raw plugin config; see the module header.
 * @returns Nothing.
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) return
  const warned = new Set()
  const warnOnce = (key, message) => {
    if (warned.has(key)) return
    warned.add(key)
    try {
      ctx.logger?.warn?.(`run-code-projection: ${message}`)
    } catch {
      // A logger that throws must not turn a warning into a turn failure.
    }
  }
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    try {
      return project(exec, result, decision, resolved, warnOnce)
    } catch (error) {
      warnOnce(`project:${error instanceof Error ? error.name : 'unknown'}`, `projection failed: ${error instanceof Error ? error.message : String(error)}`)
      return decision
    }
  })
}
