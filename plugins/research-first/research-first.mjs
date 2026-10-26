/**
 * PURPOSE
 *   Make "look it up before you build it" mechanical. An agent's memory of a
 *   library is a snapshot of its training data: the API was renamed, the pattern
 *   was superseded, and the code it writes from recall is a year behind while
 *   still compiling. Prompt rules do not fix that — they lose to confidence.
 *
 *   So this plugin does the smallest enforcing thing that works. It observes the
 *   session's tool results; when an agent tries to CREATE a new file without
 *   having read anything online first, the write is refused with a message that
 *   names both the way forward (fetch the docs) and the escape hatch (waive, with
 *   a reason). Editing an existing file is never blocked: the code you already
 *   have in front of you is the source of truth for itself.
 *
 *   WHY A GUARD AND NOT A PROMPT SECTION ALONE. The section states the rule; the
 *   guard is what makes the statement true. Friction is placed at the cheapest
 *   point — one fetch a few hundred tokens long unlocks the whole session — not
 *   at every edit.
 *
 * INPUTS
 *   Config (all optional):
 *     mode             "deny" (default) refuses the call; "warn" logs and allows,
 *                      for a trial period on a machine that wants the signal first.
 *     requireFor       tools that create artifacts. Default ["write"].
 *     researchTools    tools that count as research. Default ["web_fetch",
 *                      "web_search"]; add a documentation MCP's tool names here.
 *     allowPaths       path prefixes that are never blocked, e.g. [".dsh/", "docs/"].
 *     newFilesOnly     default true: only a file that does not exist yet is gated.
 *     allowWaiver      default true: the research_waive tool exists.
 *
 * OUTPUTS
 *   One `tools/pre-execute` decision, one `tools/result` observer, one
 *   `research_waive` tool and one system-prompt section. The section is re-read
 *   on every assembly; the observed state is per session and dies with it.
 *
 * KEYWORDS
 *   research, current docs, version drift, pre-execute, guard, waiver, prompt section
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No session identity on the call: the state falls back to a process-wide
 *     bucket, so a machine cannot evade the rule by calling from an odd context.
 *   - A failed research call (network error, 4xx) does NOT count. Looking and
 *     failing is not looking; the reason is in the denial message.
 *   - A write to an existing file, or under `allowPaths`, passes untouched.
 *   - A denied call never mutates the target and never throws.
 *   - `mode: "warn"` still records research normally, so a trial run produces the
 *     same signal as the enforced one.
 */

import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'research-first'

/** The tool registry is required; the prompt section is optional. */
export const inject = ['tools']

const DEFAULT_REQUIRE_FOR = ['write']
const DEFAULT_RESEARCH_TOOLS = ['web_fetch', 'web_search']
const FALLBACK_ORDER = 10070
const MIN_WAIVER_REASON = 12

/** Normalize raw config into a total policy. */
export function normalizeConfig(config = {}) {
  const list = (value, fallback) => {
    const items = Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim() !== '') : []
    return items.length > 0 ? items : fallback
  }
  return {
    mode: config.mode === 'warn' ? 'warn' : 'deny',
    requireFor: new Set(list(config.requireFor, DEFAULT_REQUIRE_FOR)),
    researchTools: new Set(list(config.researchTools, DEFAULT_RESEARCH_TOOLS)),
    allowPaths: list(config.allowPaths, []),
    newFilesOnly: config.newFilesOnly !== false,
    allowWaiver: config.allowWaiver !== false,
  }
}

/** The session identity a call belongs to, with a process-wide fallback. */
export function sessionKeyOf(exec) {
  const agent = exec?.agent
  const id = agent?.id ?? agent?.session?.id ?? agent?.session?.header?.sessionId
  return typeof id === 'string' && id !== '' ? id : 'process'
}

/** The file path a write/edit call targets, resolved against the session cwd. */
export function targetPathOf(exec) {
  const args = exec?.arguments ?? {}
  const path = args.file_path ?? args.path ?? args.filePath
  if (typeof path !== 'string' || path === '') return null
  const cwd = exec?.agent?.session?.header?.cwd
  return isAbsolute(path) ? path : resolve(typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd(), path)
}

/** Whether a path is exempt from the gate. */
export function isAllowedPath(target, policy, cwd) {
  if (target === null) return true
  const normalized = target.replaceAll('\\', '/')
  for (const prefix of policy.allowPaths) {
    const absolutePrefix = isAbsolute(prefix) ? prefix.replaceAll('\\', '/') : relative(cwd, resolve(cwd, prefix)).replaceAll('\\', '/')
    if (normalized === absolutePrefix || normalized.startsWith(`${absolutePrefix}/`) || normalized.includes(`/${absolutePrefix}/`)) return true
  }
  return false
}

/** The one sentence the refusing tool returns. */
export function denialReason(target) {
  const where = target === null ? 'this file' : target
  return [
    `research-first: no current source has been read in this session, so ${where} will not be created from memory.`,
    'Do this first, then retry the same call:',
    '  1. web_fetch the official documentation page for the specific version you are on (check package.json / --version first), or web_search "<library> <version> <topic> best practice".',
    '  2. If a documentation MCP is mounted (Context7 style), use it: it returns version-matched snippets.',
    '  3. Name the version and the one fact that changed your plan in your next message.',
    'If there is no way to look anything up (offline, auth wall), call research_waive with the reason and state the assumption in your result.',
  ].join('\n')
}

/** The short section text; the full procedure is the research-first skill. */
export function sectionText(policy) {
  return [
    'LOOK IT UP BEFORE YOU BUILD IT.',
    'Your memory of a library is a snapshot: the API may be renamed and the pattern superseded.',
    'Before creating a new file, read the current source: the installed version, and the official docs or changelog for THAT version.',
    `This deployment ${policy.mode === 'deny' ? 'refuses' : 'flags'} a new-file write with no research recorded in the session. One lookup unlocks the session.`,
    'The `research-first` skill has the procedure and the checklist.',
  ].join(' ')
}

/** Register the guard, the observer, the waiver and the section. */
export function apply(ctx, config = {}) {
  const policy = normalizeConfig(config)
  /** Sessions that have looked something up, and sessions that were waived. */
  const researched = new Set()
  const waived = new Set()

  ctx.on('tools/result', (exec, result) => {
    if (!policy.researchTools.has(exec?.name)) return
    if (result?.isError === true) return
    researched.add(sessionKeyOf(exec))
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!policy.requireFor.has(exec?.name)) return next()
    const key = sessionKeyOf(exec)
    if (researched.has(key) || waived.has(key)) return next()

    const target = targetPathOf(exec)
    if (target === null) return next()
    const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
    if (isAllowedPath(target, policy, cwd)) return next()
    if (policy.newFilesOnly && existsSync(target)) return next()

    if (policy.mode === 'warn') {
      ctx.logger.warn(`research-first: ${target} would be refused in deny mode (no research in session ${key})`)
      return next()
    }
    ctx.logger.warn(`research-first: denied ${exec.name} to ${target} (no research in session ${key})`)
    return { kind: 'deny', reason: denialReason(target) }
  })

  if (policy.allowWaiver) {
    ctx.tools.register({
      name: 'research_waive',
      description:
        'Record that current documentation could not be consulted in this session (offline, auth wall, nothing published), so the research-first gate lets new files be written. Requires a real reason; state the same assumption in your result.',
      parameters: {
        reason: { type: 'string', required: true, description: 'Why no current source could be read, e.g. "no network; using the API surface already pinned in package.json 3.2.1".' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args, exec) {
        const reason = typeof args?.reason === 'string' ? args.reason.trim() : ''
        if (reason.length < MIN_WAIVER_REASON) {
          return { ok: false, code: 'reason_too_short', minimum: MIN_WAIVER_REASON }
        }
        const key = sessionKeyOf(exec)
        waived.add(key)
        ctx.logger.warn(`research-first: waiver for session ${key}: ${reason}`)
        return { ok: true, session: key, reason, note: 'new-file writes are unlocked for this session; state this assumption in the result' }
      },
    })
  }

  ctx.inject(['systemPrompt'], (scope) => {
    const order = scope.systemPrompt.getSectionOrder?.('research:first') ?? FALLBACK_ORDER
    const dispose = scope.systemPrompt.section({
      name: 'research:first',
      order,
      text: () => {
        try {
          return sectionText(policy)
        } catch {
          return ''
        }
      },
    })
    scope.on('dispose', () => dispose?.())
  })
}
