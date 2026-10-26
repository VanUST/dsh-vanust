/**
 * PURPOSE
 *   Compress oversized shell output at the only seam DSH leaves open. Upstream's
 *   Claude Code hook rewrites the COMMAND (`git status` -> `rtk git status`), but
 *   this harness's `tools/pre-execute` explicitly cannot rewrite arguments. What a
 *   post-execute policy CAN do is replace the model-facing projection, and
 *   `rtk pipe -f <filter>` reads stdin and prints filtered text, so the honest
 *   place for rtk is the output side. This plugin owns the command-to-filter map,
 *   the binary's location, and the banner that keeps elision visible.
 *
 * INPUTS
 *   Config (all optional):
 *     enabled     false disables both the section and the listener. Default true.
 *     bin         rtk executable. Default: resolve — PATH first, then the
 *                 per-user locations `~/.local/bin/rtk` and `~/.cargo/bin/rtk`.
 *                 No machine path is baked into the source, because the kit ships
 *                 to machines whose layout nobody knows at package time.
 *     shellTools  tool names whose `arguments.command` may be filtered.
 *                 Default ['bash', 'pwsh'].
 *     minChars    shortest model-facing text worth filtering, in characters.
 *                 Default 1500.
 *     timeoutMs   how long one `rtk pipe` may run before it is killed and the
 *                 result passes through. Default 15000.
 *
 * OUTPUTS
 *   One `systemPrompt` section named `rtk:output`, and one `tools/post-execute`
 *   listener. The listener awaits `next()` first (so every other policy still
 *   runs), then replaces the accepted text block in place with banner + filtered
 *   text and returns `{kind:'accept', content}`. Exports `classifyCommand` and
 *   `filterOutput` so the mapping and the byte behaviour can be exercised without
 *   a running harness.
 *
 * KEYWORDS
 *   rtk, output compression, tools/post-execute, rtk pipe, system prompt, shell,
 *   token savings, no argument rewrite
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Only a single simple command is classified. Any `|`, `&`, `;`, `<`, `>`,
 *     backtick, `$(`, parenthesis, newline, or a leading `VAR=value` returns null,
 *     as does anything whose first word is `rtk` (or ends in `/rtk`). A quoted
 *     argument containing one of those characters is also refused: a false
 *     pass-through costs bytes, a false rewrite costs correctness.
 *   - A result passes through untouched when the tool is not configured as a
 *     shell tool, the command maps to no filter, the abort signal fired, the
 *     content is missing or has no single text block, the text is below
 *     `minChars`, `rtk` cannot be spawned, it exits non-zero, it prints nothing,
 *     or the replacement would not be SMALLER than the original. The last rule is
 *     why `git status` is usually not replaced: its filter trims one byte and the
 *     banner would cost more than it saves.
 *   - An abort that lands while `next()` is in flight returns the decision `next()`
 *     produced, because the waterfall has already run and replacing content after
 *     cancellation is exactly what must not happen.
 *   - Elision is never silent: `rtk pipe` filters elide in place (`[+N lines
 *     omitted]`, `[more changes truncated]`). The banner names the filter and the
 *     `rtk recall <hash>` route. rtk 1.1.0's pipe filters do not print a hash for
 *     these cases, so the banner also says to re-run the command unfiltered; it
 *     never claims the full output was stored when no hash was printed.
 *   - The bash/pwsh tools append `[exit code: N]`, timeout, signal and sandbox
 *     markers after the command's own output. A filter that drops them would hide
 *     a failing run, so the trailing status markers are re-appended when the
 *     filtered text lost them.
 *   - A missing binary is reported in the prompt section and the listener no-ops;
 *     a later reload picks up a newly installed binary.
 *   - A stderr write from rtk does not fail the transform (some filters warn while
 *     still exiting 0); only the exit code and stdout are consumed.
 */

import { execFileSync, spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'rtk'

/** Both seams are required: the prompt section and the post-execute waterfall. */
export const inject = ['tools', 'systemPrompt']

/**
 * No machine path is baked in: this kit ships to other machines. The empty default
 * means "resolve", and `resolveRtk` searches PATH, then the per-user locations the
 * standalone `rtk` installer writes to. An earlier draft carried this machine's
 * absolute path as the default — the one value that works here and nowhere else.
 */
export const DEFAULT_RTK_BIN = ''

/** Per-user locations a standalone `rtk` install lands in, in search order. */
const RTK_HOME_CANDIDATES = [join('.local', 'bin', 'rtk'), join('.cargo', 'bin', 'rtk')]

/** Section order used when the prompt registry allocates no central position. */
const FALLBACK_ORDER = 10160

const DEFAULT_MIN_CHARS = 1500
const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_SHELL_TOOLS = ['bash', 'pwsh']

/** Refuse to buffer more than this much filtered output; pass the original through. */
const MAX_FILTER_BYTES = 8 * 1024 * 1024

/** Keep at most this much filter stderr for the (unused) failure report. */
const MAX_STDERR_BYTES = 64 * 1024

/**
 * Every `rtk pipe -f` name this plugin will pass. An unknown name exits 1 with
 * "Unknown filter", so the allow-list is a correctness boundary, not documentation.
 */
export const FILTER_NAMES = new Set([
  'cargo-test', 'pytest', 'go-test', 'go-build', 'ctest', 'tsc', 'vitest',
  'grep', 'rg', 'find', 'fd', 'git-log', 'git-diff', 'git-status', 'log',
  'mypy', 'ruff-check', 'ruff-format', 'sqlfluff-lint', 'prettier', 'phpunit',
  'pest', 'paratest', 'php-test', 'ecs', 'phpstan', 'pint',
])

/**
 * Command prefixes this plugin knows how to filter. A rule requires a whitespace
 * (or end) after the subcommand so `git statusfoo` cannot borrow `git status`.
 */
const FILTER_RULES = [
  { filter: 'git-status', pattern: /^git\s+status(?:\s|$)/ },
  { filter: 'git-diff', pattern: /^git\s+diff(?:\s|$)/ },
  { filter: 'git-log', pattern: /^git\s+log(?:\s|$)/ },
  { filter: 'pytest', pattern: /^pytest(?:\s|$)/ },
  { filter: 'cargo-test', pattern: /^cargo\s+test(?:\s|$)/ },
  { filter: 'go-test', pattern: /^go\s+test(?:\s|$)/ },
  { filter: 'tsc', pattern: /^(?:npx\s+(?:--yes\s+)?)?tsc(?:\s|$)/ },
  { filter: 'vitest', pattern: /^(?:npx\s+(?:--yes\s+)?)?vitest(?:\s|$)/ },
  { filter: 'grep', pattern: /^grep(?:\s|$)/ },
  { filter: 'rg', pattern: /^rg(?:\s|$)/ },
  { filter: 'find', pattern: /^find(?:\s|$)/ },
  { filter: 'fd', pattern: /^fd(?:\s|$)/ },
  { filter: 'mypy', pattern: /^mypy(?:\s|$)/ },
  { filter: 'ruff-check', pattern: /^ruff\s+check(?:\s|$)/ },
  { filter: 'ruff-format', pattern: /^ruff\s+format(?:\s|$)/ },
  { filter: 'prettier', pattern: /^prettier(?:\s|$)/ },
  { filter: 'phpunit', pattern: /^phpunit(?:\s|$)/ },
  { filter: 'sqlfluff-lint', pattern: /^sqlfluff\s+lint(?:\s|$)/ },
]

/** Command list reused by the prompt section; keeps it in one place. */
const FILTERED_COMMANDS = 'git status, git diff, git log, pytest, cargo test, go test, tsc, vitest, grep, rg, find, fd, mypy, ruff check, ruff format, prettier, phpunit, sqlfluff lint'

/**
 * Trailing lines the bash/pwsh renderers append after the command's own output.
 * The harness uses these to report a non-zero exit without turning the call into
 * an infrastructure error, so a filter must not be allowed to swallow them.
 */
const STATUS_MARKER = /^\[(?:exit code: \d+|timed out after \d+ms|stopped: .*|killed by signal: .*|sandbox: .*)\]$/

/**
 * Shell syntax that makes a command more than a single simple invocation.
 * Deliberately blunt: no quote-aware parsing, because a wrong `true` here means
 * the plugin filters a command whose output came from something else.
 */
const COMPOUND_SHELL = /[|&;<>`()\n\r]/

/** Parse config into a total policy. */
function normalizeConfig(config = {}) {
  const bin = typeof config.bin === 'string' && config.bin.trim() !== '' ? config.bin.trim() : DEFAULT_RTK_BIN
  const tools = Array.isArray(config.shellTools)
    ? config.shellTools.filter((tool) => typeof tool === 'string' && tool.trim() !== '')
    : DEFAULT_SHELL_TOOLS
  return {
    enabled: config.enabled !== false,
    bin,
    shellTools: new Set(tools.length > 0 ? tools : DEFAULT_SHELL_TOOLS),
    minChars: positiveInteger(config.minChars) ?? DEFAULT_MIN_CHARS,
    timeoutMs: positiveInteger(config.timeoutMs) ?? DEFAULT_TIMEOUT_MS,
  }
}

/** A positive integer, or null so the caller can apply its default. */
function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null
}

/** Whether `path` is an executable file. */
function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Resolve a bare command name against PATH; null when no entry is executable. */
function executableOnPath(command) {
  if (typeof command !== 'string' || command === '') return null
  const suffix = process.platform === 'win32' && !command.toLowerCase().endsWith('.exe') ? '.exe' : ''
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue
    const candidate = join(directory, `${command}${suffix}`)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

/**
 * Locate rtk: the configured path when one is given, otherwise PATH and then the
 * per-user install locations.
 *
 * The fallback order is the point: a GUI-launched harness does not necessarily
 * inherit a shell PATH that contains `~/.local/bin`, and `rtk`'s own installer
 * writes exactly there. A configured `bin` wins over all of it, so a machine that
 * keeps rtk somewhere unusual is one profile config away from working.
 *
 * @param config - Raw plugin config (only `bin` is read).
 * @returns `{ bin, version }`, or null when no executable was found. `version` is
 *   the trimmed `rtk --version` output, or null when the binary answered nothing.
 */
export function resolveRtk(config = {}) {
  const configured = typeof config.bin === 'string' ? config.bin.trim() : DEFAULT_RTK_BIN
  let bin = null
  if (configured !== '') {
    if (isAbsolute(configured)) {
      if (isExecutable(configured)) bin = configured
    } else {
      bin = executableOnPath(configured)
      if (bin === null && isExecutable(configured)) bin = resolve(configured)
    }
  }
  if (bin === null) bin = executableOnPath('rtk')
  if (bin === null) {
    for (const relative of RTK_HOME_CANDIDATES) {
      const candidate = join(homedir(), relative)
      if (isExecutable(candidate)) {
        bin = candidate
        break
      }
    }
  }
  if (bin === null) return null
  let version = null
  try {
    version = execFileSync(bin, ['--version'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    version = null
  }
  return { bin, version }
}

/**
 * Map one shell command to the `rtk pipe` filter that understands its output.
 *
 * @param command - The `command` argument of a shell tool call.
 * @returns A filter name from {@link FILTER_NAMES}, or null to pass through.
 */
export function classifyCommand(command) {
  if (typeof command !== 'string') return null
  const text = command.trim()
  if (text === '') return null
  if (COMPOUND_SHELL.test(text) || text.endsWith('\\')) return null
  const first = text.split(/\s+/, 1)[0]
  if (first.includes('=')) return null
  const basename = first.replaceAll('\\', '/').split('/').pop()
  if (basename === 'rtk') return null
  for (const rule of FILTER_RULES) {
    if (rule.pattern.test(text)) return rule.filter
  }
  return null
}

/**
 * Pipe `text` through `rtk pipe -f <filter>` and build the replacement projection.
 *
 * The returned `text` is the original unless `applied` is true. `afterBytes` is
 * always the byte size of the text a caller would show the model, so a caller can
 * print before/after without re-deriving the banner.
 *
 * @param command - The shell command that produced `text`.
 * @param text - The model-facing text of the tool result.
 * @param opts - `bin`, `filter` (skip classification), `minChars`, `timeoutMs`,
 *   `signal`. All optional; defaults mirror the plugin config.
 * @returns `{ applied, filter, text, beforeBytes, afterBytes, exitCode, reason }`
 *   where `reason` is a stable short tag (`filtered`, `not-smaller`,
 *   `rtk-exit`, `rtk-missing`, `aborted`, `empty`, `empty-filtered`,
 *   `below-min-chars`, `no-filter`, `unknown-filter`, `spawn-failed`,
 *   `timeout`).
 */
export async function filterOutput(command, text, opts = {}) {
  const source = typeof text === 'string' ? text : ''
  const beforeBytes = Buffer.byteLength(source, 'utf8')
  const outcome = {
    applied: false,
    filter: null,
    text: source,
    beforeBytes,
    afterBytes: beforeBytes,
    exitCode: null,
    reason: 'no-filter',
  }
  const filter = opts.filter ?? classifyCommand(command)
  outcome.filter = filter
  if (filter === null) return outcome
  if (!FILTER_NAMES.has(filter)) {
    outcome.reason = 'unknown-filter'
    return outcome
  }
  if (source === '') {
    outcome.reason = 'empty'
    return outcome
  }
  const minChars = positiveInteger(opts.minChars) ?? DEFAULT_MIN_CHARS
  if (source.length < minChars) {
    outcome.reason = 'below-min-chars'
    return outcome
  }
  if (opts.signal?.aborted) {
    outcome.reason = 'aborted'
    return outcome
  }
  const bin = typeof opts.bin === 'string' && opts.bin !== '' ? opts.bin : resolveRtk()?.bin
  if (typeof bin !== 'string' || bin === '') {
    outcome.reason = 'rtk-missing'
    return outcome
  }

  const piped = await runPipe(bin, filter, source, {
    timeoutMs: positiveInteger(opts.timeoutMs) ?? DEFAULT_TIMEOUT_MS,
    signal: opts.signal,
  })
  if (piped.error) {
    outcome.reason = piped.error.code === 'ENOENT'
      ? 'rtk-missing'
      : piped.error.name === 'AbortError' || opts.signal?.aborted
        ? 'aborted'
        : piped.error.code === 'ETIMEDOUT'
          ? 'timeout'
          : 'spawn-failed'
    return outcome
  }
  outcome.exitCode = piped.code
  if (piped.code !== 0) {
    outcome.reason = 'rtk-exit'
    return outcome
  }
  if (piped.stdout.trim() === '') {
    outcome.reason = 'empty-filtered'
    return outcome
  }
  if (opts.signal?.aborted) {
    outcome.reason = 'aborted'
    return outcome
  }

  const banner = replacementBanner(filter, beforeBytes)
  const filteredBody = piped.stdout.endsWith('\n') ? piped.stdout : `${piped.stdout}\n`
  // A filter can drop the harness's trailing status marker; re-append it so a
  // failing command cannot read as a passing one.
  const preserved = trailingStatusMarkers(source).filter((marker) => !filteredBody.includes(marker))
  const body = preserved.length === 0 ? filteredBody : `${filteredBody}${preserved.join('\n')}\n`
  const replacement = `${banner}\n${body}`
  const afterBytes = Buffer.byteLength(replacement, 'utf8')
  if (afterBytes >= beforeBytes) {
    // Filtering must buy bytes; a banner over a one-byte trim is a net loss.
    outcome.reason = 'not-smaller'
    return outcome
  }
  outcome.applied = true
  outcome.text = replacement
  outcome.afterBytes = afterBytes
  outcome.reason = 'filtered'
  return outcome
}

/** The banner that makes the replacement self-describing and the elision visible. */
function replacementBanner(filter, beforeBytes) {
  return `[rtk: the \`${filter}\` filter replaced ${beforeBytes} B of shell output with a compact projection; lines may have been elided. Re-run the command unfiltered for the full text, or use \`rtk recall <hash>\` when a recovery hash appears below.]`
}

/**
 * Run `rtk pipe -f <filter>` with `text` on stdin.
 *
 * On stdin EPIPE (rtk exits before consuming everything) the error is swallowed:
 * the exit code and stdout are the verdict, not the write failure. Output is
 * bounded; exceeding the cap kills the child and reports an error so the caller
 * passes the original through rather than buffering without limit.
 */
function runPipe(bin, filter, text, { timeoutMs, signal }) {
  return new Promise((done) => {
    let child
    try {
      child = spawn(bin, ['pipe', '-f', filter], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        ...(signal ? { signal } : {}),
      })
    } catch (error) {
      done({ error })
      return
    }
    const stdout = []
    const stderr = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let timer = null
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      done(value)
    }
    const fail = (error) => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone; the error is the report.
      }
      finish({ error })
    }
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_FILTER_BYTES) {
        fail(Object.assign(new Error('filtered output exceeded the cap'), { code: 'EOVERFLOW' }))
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return
      stderrBytes += chunk.length
      stderr.push(chunk)
    })
    child.on('error', (error) => finish({ error }))
    child.on('close', (code) => finish({
      code: code ?? -1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }))
    child.stdin.on('error', () => {
      // EPIPE from an early exit is not a transform failure.
    })
    timer = setTimeout(() => {
      fail(Object.assign(new Error(`rtk pipe exceeded ${timeoutMs}ms`), { code: 'ETIMEDOUT' }))
    }, timeoutMs)
    child.stdin.end(text)
  })
}

/** The index of the content's only text block, or -1 when it is not a single one. */
function singleTextIndex(content) {
  let found = -1
  for (let index = 0; index < content.length; index += 1) {
    if (content[index]?.type !== 'text') continue
    if (found !== -1) return -1
    found = index
  }
  return found
}

/**
 * The harness status markers at the end of `text`, in order.
 *
 * @param text - The unfiltered model-facing text.
 * @returns The consecutive marker lines at the tail; empty when there are none.
 */
function trailingStatusMarkers(text) {
  const lines = text.split('\n')
  const markers = []
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    // A single trailing newline is not a marker; skip blank lines only before
    // the marker run starts, so a blank line above a marker ends the run.
    if (line === '' && markers.length === 0) continue
    if (!STATUS_MARKER.test(line)) break
    markers.unshift(line)
  }
  return markers
}

/** The command argument of a shell tool call, or null. */
function shellCommand(exec) {
  const args = exec?.arguments
  if (args === null || typeof args !== 'object') return null
  const command = args.command
  return typeof command === 'string' ? command : null
}

/** The prompt section text: where rtk is and what it will do without being asked. */
function sectionText(rtk, policy) {
  if (rtk === null) {
    return [
      'RTK OUTPUT COMPRESSION: unavailable.',
      `  rtk was not found on PATH, in ~/.local/bin or in ~/.cargo/bin, so oversized shell output is not filtered.`,
    ].join('\n')
  }
  const version = rtk.version === null ? '' : ` ${rtk.version.replace(/^rtk\s+/i, '')}`
  return [
    `RTK${version} OUTPUT COMPRESSION`,
    `  rtk is installed at ${rtk.bin} (not necessarily on PATH).`,
    `  Shell results over ${policy.minChars} chars from these commands are filtered through`,
    `  \`rtk pipe\` and replaced by a compact projection with a banner: ${FILTERED_COMMANDS}.`,
    '  Commands are NOT rewritten automatically. For full control, prefix the command',
    '  with the absolute binary path:',
    `    ${rtk.bin} git status`,
    `    ${rtk.bin} read <file>`,
    '  If the banner reports elision, re-run the command unfiltered; when it prints a',
    '  recovery hash, `rtk recall <hash>` returns the stored output.',
  ].join('\n')
}

/**
 * Register the prompt section and the post-execute listener.
 *
 * @param ctx - Cordis context; must expose `tools` and `systemPrompt`.
 * @param config - See the file contract.
 */
export function apply(ctx, config = {}) {
  const policy = normalizeConfig(config)
  if (!policy.enabled) return
  const rtk = resolveRtk(policy)
  const order = ctx?.systemPrompt?.getSectionOrder?.('rtk:output') ?? FALLBACK_ORDER
  ctx.effect(() => {
    const dispose = ctx.systemPrompt.section({
      name: 'rtk:output',
      order,
      // A provider, not a string: the harness re-assembles the prompt every
      // request, so a reload that finds the binary is visible without a restart.
      text: () => {
        try {
          return sectionText(rtk, policy)
        } catch {
          // Never throw from an assembly: a missing section is a smaller failure
          // than an unbuildable prompt.
          return ''
        }
      },
    })
    return () => dispose()
  })

  ctx.on('tools/post-execute', async (exec, result, next) => {
    if (rtk === null || !policy.shellTools.has(exec?.name)) return next()
    if (exec.signal?.aborted) return next()
    const command = shellCommand(exec)
    const filter = classifyCommand(command)
    if (filter === null) return next()

    // Run the rest of the waterfall first: a block/replace already owned by
    // another policy is authoritative, and the accept decision describes the
    // projection the model would otherwise see.
    const decision = await next()
    if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value')) return decision
    if (exec.signal?.aborted) return decision
    const content = decision.content ?? result?.content
    if (!Array.isArray(content)) return decision
    const index = singleTextIndex(content)
    if (index === -1) return decision
    const original = content[index]?.text
    if (typeof original !== 'string' || original.length < policy.minChars) return decision

    const outcome = await filterOutput(command, original, {
      bin: rtk.bin,
      filter,
      minChars: policy.minChars,
      timeoutMs: policy.timeoutMs,
      signal: exec.signal,
    })
    if (!outcome.applied) return decision

    const replacement = content.slice()
    replacement[index] = { ...content[index], text: outcome.text }
    return {
      kind: 'accept',
      content: replacement,
      ...(decision.additionalContexts === undefined ? {} : { additionalContexts: decision.additionalContexts }),
    }
  })
}
