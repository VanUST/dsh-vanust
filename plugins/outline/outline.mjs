/**
 * PURPOSE
 *   A cheap table of contents for a source file: its symbols with their line ranges,
 *   signatures and first-line docstrings, WITHOUT the bodies. Reading a 2 000-line file
 *   to find one function pays the whole file on every later step; the outline pays a
 *   fraction once and names the exact range to `read`. The parsing itself is
 *   code-skeleton-mcp (tree-sitter WASM grammars, pinned by provisioning); this plugin
 *   owns the tool, the prompt section, and the degradation when that binary is absent.
 *
 * INPUTS
 *   Config (all optional):
 *     bin        code-skeleton-mcp executable, absolute or a name to look up on PATH.
 *                Default: the first `code-skeleton-mcp` on this process's PATH, which
 *                is where provisioning installs it (the npm global bin directory).
 *     timeoutMs  how long one outline call may run before it is killed. Default 10000.
 *     maxBytes   largest stdout accepted from one call, default 262144 (256 KiB). A
 *                bigger answer is the whole file read the outline was meant to avoid.
 *   Tool arguments:
 *     path       file to outline, relative to the session workspace or absolute
 *                (required).
 *     depth      nesting depth, integer 1-3, default 1.
 *     docstrings include first-line docstrings/JSDoc, default true.
 *
 * OUTPUTS
 *   One `systemPrompt` section named `outline:index`, and one tool named `outline`
 *   registered on every agent of this host - the root and all seven presets, because a
 *   file outline is not a role's speciality. The tool result is the JSON the binary
 *   printed: `{path, language, symbols:[{kind, name, line, endLine, signature,
 *   docstring}]}`. A failed call returns `{ok:false, code, message}` instead, so an
 *   empty answer can never read as a complete one. Exports `resolveOutlineBin`,
 *   `parseOutlineOutput`, `outlineArgv` and `buildOutlineResult` so the contract can be
 *   exercised without a running harness.
 *
 * KEYWORDS
 *   outline, code skeleton, symbols, line ranges, read tool, code-skeleton-mcp,
 *   tools/register, system prompt, degradation, tree-sitter
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No usable binary: no tool is registered and the section says `outline unavailable`
 *     and where the plugin looked (PATH and a configured `bin`). A reload re-resolves.
 *   - A binary that is on PATH but cannot outline a JavaScript file is treated as absent:
 *     `resolveOutlineBin` probes it once with a real outline call. This CLI cannot be
 *     probed with `--version` (it implements none; an unknown first argument starts its
 *     stdio MCP server), so only a real call proves the parser works.
 *   - The CLI reports a failure on stderr and exits non-zero (`File not found`,
 *     `Unsupported file type`); the plugin reports that as `EXIT` with the reason quoted.
 *     A zero exit with empty or non-JSON stdout is still a named failure (`EMPTY_OUTPUT`,
 *     `NON_JSON`), because a broken shim's silent success must not read as an empty file.
 *   - A non-code file (markdown, YAML, JSON) has no symbols: the CLI answers
 *     "Unsupported file type" and the tool reports that, naming `read` as the alternative.
 *   - `depth` outside 1-3 is clamped, a non-numeric depth falls back to 1, and
 *     `docstrings:false` adds `--no-docstrings`.
 *   - stdout above `maxBytes` kills the child and fails the call; nothing is truncated
 *     silently, because a partial outline reads as a complete one.
 *   - A relative `path` resolves against the session workspace
 *     (`agent.session.header.cwd`), then the process directory - the same base the
 *     harness's own file tools use.
 */

import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = '@cc/dsh-outline'

/** The prompt registry's section and the host's tool registry are both used. */
export const inject = ['tools', 'systemPrompt']

/** This file, used as the fixture for the readiness probe. */
const SELF = fileURLToPath(import.meta.url)

/** Section order used when the prompt registry allocates no central position. */
const FALLBACK_ORDER = 10155

/** Default binary: PATH resolution, because provisioning installs onto the harness PATH. */
const DEFAULT_BIN = ''

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_MAX_BYTES = 256 * 1024

/** A probe that cannot answer within this long is not a usable parser. */
const PROBE_TIMEOUT_MS = 5000
const PROBE_MAX_BYTES = 4 * 1024 * 1024

/** The binary's own name; also the one word the section tells a human to install. */
const BINARY = 'code-skeleton-mcp'

/** A failure with a stable code, so a caller can report it without parsing prose. */
export class OutlineError extends Error {
  /**
   * @param message - One sentence a model or a human can act on.
   * @param code - Stable uppercase code, e.g. `NO_PATH`, `EOVERFLOW`, `NON_JSON`.
   */
  constructor(message, code) {
    super(message)
    this.name = 'OutlineError'
    this.code = code
  }
}

/** True when `file` is a regular executable file (not a directory, not a dangling link). */
export function isExecutable(file) {
  try {
    accessSync(file, constants.X_OK)
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * The first executable named `command` on `searchPath`, or null.
 *
 * @param command - Binary name without a platform suffix.
 * @param searchPath - `PATH`-shaped list; defaults to this process's PATH.
 * @returns Absolute path, or null when nothing executable matched.
 */
export function executableOnPath(command, searchPath = process.env.PATH ?? '') {
  const suffix = process.platform === 'win32' && !command.toLowerCase().endsWith('.exe') ? '.exe' : ''
  for (const directory of String(searchPath).split(delimiter)) {
    if (directory === '') continue
    const candidate = join(directory, `${command}${suffix}`)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

/**
 * The installed version of the package that owns `bin`, or null.
 *
 * The CLI has no `--version`, so the truthful version comes from the package the shim
 * points at. Walking up from the resolved symlink also survives the npm global layout
 * (`bin/<name>` -> `lib/node_modules/<pkg>/dist/index.js`).
 *
 * @param bin - Absolute path of the executable or its shim.
 * @returns The `version` field of the owning `code-skeleton-mcp` package, or null.
 */
function packageVersion(bin) {
  try {
    let dir = dirname(realpathSync(bin))
    for (let depth = 0; depth < 8; depth += 1) {
      const manifest = join(dir, 'package.json')
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
        if (pkg?.name === BINARY && typeof pkg.version === 'string') return pkg.version
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {
    // An unreadable shim still runs; the version is a display detail, not a gate.
  }
  return null
}

/**
 * Prove the binary speaks this CLI, by outlining this plugin's own file once.
 *
 * WHY NOT `--version`: `code-skeleton-mcp` routes only its documented subcommands
 * (`outline`, `function`, `class`, `imports`, `setup`); any other first argument starts
 * the stdio MCP server, which blocks while stdin is open. And its exit status is not a
 * contract either: an outlined path that does not exist exits 0 after printing the reason
 * to stderr. A real outline call is the only probe that distinguishes a working parser
 * from a shim that runs and does nothing useful.
 *
 * @param bin - Candidate executable.
 * @returns True when it printed a parseable outline with a `symbols` array.
 */
function probeOutlineBin(bin) {
  const run = spawnSync(bin, ['outline', SELF, '--depth', '1'], {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: PROBE_MAX_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (run.error !== undefined || run.status !== 0) return false
  try {
    const parsed = JSON.parse(String(run.stdout ?? ''))
    return parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.symbols)
  } catch {
    return false
  }
}

/**
 * Locate a usable `code-skeleton-mcp`.
 *
 * A configured `bin` wins (absolute path, name on PATH, or a path relative to the
 * process directory); otherwise the first one on PATH is used. The candidate is probed
 * once, and a candidate that cannot outline a JavaScript file yields null rather than a
 * tool that fails at call time.
 *
 * @param config - Raw plugin config; only `bin` and `path` are read.
 * @returns `{ bin, version }`, or null when nothing usable was found.
 */
export function resolveOutlineBin(config = {}) {
  const configured = typeof config.bin === 'string' ? config.bin.trim() : DEFAULT_BIN
  const searchPath = typeof config.path === 'string' ? config.path : (process.env.PATH ?? '')
  let bin = null
  if (configured !== '') {
    if (isAbsolute(configured)) {
      if (isExecutable(configured)) bin = configured
    } else {
      bin = executableOnPath(configured, searchPath)
      if (bin === null && isExecutable(configured)) bin = resolve(configured)
    }
  } else {
    bin = executableOnPath(BINARY, searchPath)
  }
  if (bin === null) return null
  if (!probeOutlineBin(bin)) return null
  return { bin, version: packageVersion(bin) }
}

/**
 * The argv for one outline call.
 *
 * @param target - Absolute file path.
 * @param depth - Clamped nesting depth.
 * @param docstrings - Whether to include docstrings.
 * @returns Argument vector for the binary.
 */
export function outlineArgv(target, depth, docstrings) {
  const argv = ['outline', target, '--depth', String(depth)]
  if (docstrings === false) argv.push('--no-docstrings')
  return argv
}

/** Clamp a requested depth into 1..3; anything unusable becomes the default 1. */
export function normalizeDepth(value) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 1
  return Math.min(3, Math.max(1, Math.round(number)))
}

/**
 * Parse the JSON the binary prints. Exported so a selftest can prove the failure path.
 *
 * @param stdout - Raw stdout of one outline call.
 * @returns The parsed outline object.
 * @throws {OutlineError} `EMPTY_OUTPUT` when nothing was printed; `NON_JSON` when the text
 *   does not parse; `BAD_SHAPE` when it parses but is not an outline with `symbols`.
 */
export function parseOutlineOutput(stdout) {
  const text = typeof stdout === 'string' ? stdout.trim() : ''
  if (text === '') {
    throw new OutlineError(`${BINARY} printed no JSON (it prints its reason to stderr and still exits 0)`, 'EMPTY_OUTPUT')
  }
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new OutlineError(`${BINARY} printed text that is not JSON: ${text.slice(0, 200)}`, 'NON_JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OutlineError(`${BINARY} printed JSON that is not an object`, 'BAD_SHAPE')
  }
  if (!Array.isArray(value.symbols)) {
    throw new OutlineError(`${BINARY} printed JSON without a symbols array`, 'BAD_SHAPE')
  }
  return value
}

/**
 * Run one outline call with the plugin's two limits.
 *
 * @param bin - Executable to run.
 * @param argv - Argument vector from {@link outlineArgv}.
 * @param limits - `{ timeoutMs, maxBytes }`.
 * @returns `{ code, stdout, stderr }`.
 * @throws {OutlineError} `ETIMEDOUT`, `EOVERFLOW`, or `ESPAWN` when the child cannot run.
 */
function runOutline(bin, argv, limits) {
  return new Promise((settle, reject) => {
    let child
    try {
      child = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(new OutlineError(`${BINARY} could not start: ${String(error)}`, 'ESPAWN'))
      return
    }
    const stdout = []
    const stderr = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGKILL')
      reject(error)
    }
    const timer = setTimeout(() => {
      fail(new OutlineError(`${BINARY} exceeded ${limits.timeoutMs} ms`, 'ETIMEDOUT'))
    }, limits.timeoutMs)
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > limits.maxBytes) {
        fail(new OutlineError(`outline output exceeded ${limits.maxBytes} B; outline a smaller file or lower the depth`, 'EOVERFLOW'))
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      // The reason lives here when the CLI "fails" with exit 0; keep it bounded.
      if (stderrBytes >= 64 * 1024) return
      stderrBytes += chunk.length
      stderr.push(chunk)
    })
    child.on('error', (error) => {
      fail(new OutlineError(`${BINARY} could not start: ${String(error)}`, 'ESPAWN'))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      settle({
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
  })
}

/**
 * Outline one file: resolve the path, run the binary, parse its answer.
 *
 * @param args - Tool arguments `{ path, depth, docstrings }`.
 * @param options - `{ bin, timeoutMs, maxBytes, cwd }`; `bin` is required here because
 *   registration already resolved it.
 * @returns The parsed outline.
 * @throws {OutlineError} `NO_PATH`, `NO_BIN`, or any failure from the run/parse.
 */
export async function buildOutlineResult(args, options = {}) {
  const raw = typeof args?.path === 'string' ? args.path.trim() : ''
  if (raw === '') throw new OutlineError('outline requires a non-empty `path`', 'NO_PATH')
  const bin = typeof options.bin === 'string' ? options.bin : ''
  if (bin === '') throw new OutlineError(`${BINARY} is not available`, 'NO_BIN')
  const cwd = typeof options.cwd === 'string' && options.cwd !== '' ? options.cwd : process.cwd()
  const target = isAbsolute(raw) ? raw : resolve(cwd, raw)
  const depth = normalizeDepth(args?.depth)
  const docstrings = args?.docstrings !== false
  const limits = {
    timeoutMs: positiveInteger(options.timeoutMs) ?? DEFAULT_TIMEOUT_MS,
    maxBytes: positiveInteger(options.maxBytes) ?? DEFAULT_MAX_BYTES,
  }
  const run = await runOutline(bin, outlineArgv(target, depth, docstrings), limits)
  const reason = run.stderr.trim()
  if (run.code !== 0) {
    throw new OutlineError(`${BINARY} exited ${run.code}${reason === '' ? '' : `: ${reason}`}`, 'EXIT')
  }
  try {
    return parseOutlineOutput(run.stdout)
  } catch (error) {
    if (error instanceof OutlineError && reason !== '') {
      throw new OutlineError(`${error.message}: ${reason}`, error.code)
    }
    throw error
  }
}

/** A positive integer from config, or null when the value is not one. */
function positiveInteger(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

/**
 * The workspace a tool call reads from: the session's cwd, then this process's.
 *
 * @param agent - The executing agent, when the harness provides one.
 * @returns Absolute directory.
 */
function workingDir(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
}

/**
 * The prompt section: what the outline is for, how to pair it with `read`, and the
 * measured saving. When the binary is absent the section says so and where it looked.
 *
 * @param installed - `{ bin, version }` from {@link resolveOutlineBin}, or null.
 */
export function sectionText(installed) {
  if (installed === null) {
    return [
      'OUTLINE: unavailable.',
      `  The \`outline\` tool is not registered: no usable \`${BINARY}\` was found on this`,
      '  harness\'s PATH, and a configured `bin` did not answer. A binary that cannot',
      '  outline a JavaScript file counts as absent.',
      `  To enable it: \`npm install -g ${BINARY}@0.1.3\`; the tool and this notice`,
      '  change on the next reload.',
    ].join('\n')
  }
  const version = installed.version === null ? '' : ` ${installed.version}`
  return [
    'OUTLINE: a table of contents for a source file, without the body.',
    `  Parser: ${BINARY}${version} at ${installed.bin}.`,
    '  The `outline` tool returns the file\'s symbols - kind, name, line, endLine,',
    '  signature, first-line docstring - so a file you have not read can be',
    '  understood for a fraction of its size: plugins/orchestrator/orchestrator.mjs',
    '  is 83 148 B, its depth-1 outline 4 791 B (-94.2%, ~0.4 s), and the same',
    '  call twice returns the same bytes.',
    '  Languages: JavaScript, TypeScript, TSX, Python (Go gives types only, not',
    '  functions). Use it FIRST on an unfamiliar source file, then `read` only the',
    '  range of the symbol you picked (`offset`/`limit`). The bodies are never in the',
    '  outline: reading is still how you see code, and a non-code file (markdown, YAML,',
    '  JSON) - or any other language - has no symbols here, so use `read` for it.',
    '  `path` is required; `depth` is 1-3 (default 1; depth 2 on a 100 991 B file',
    '  returned 57 490 B, so go deeper only when depth 1 is too coarse);',
    '  `docstrings: false` drops the docstrings.',
  ].join('\n')
}

/**
 * Whether this agent's preset admits one tool name.
 *
 * The policy owner (`toolFamilies`) answers; a composition without that row admits everything,
 * exactly like `tools.restrict` does. A missing service must never remove a tool silently.
 *
 * @param ctx - Cordis context.
 * @param agent - The agent the section is for.
 * @param name - Tool name.
 * @returns false only when the policy positively excludes the name.
 */
function surfaceAllows(ctx, agent, name) {
  try {
    return ctx.get?.('toolFamilies')?.allows?.(agent, name) !== false
  } catch {
    return true
  }
}

/**
 * The preset in force for one agent, through the policy owner first.
 *
 * @param ctx - Cordis context.
 * @param agent - The agent being synced.
 * @returns The preset id, or undefined in a composition without a preset.
 */
function presetOf(ctx, agent) {
  try {
    const resolved = ctx.get?.('toolFamilies')?.presetFor?.(agent?.session)
    if (typeof resolved === 'string' && resolved !== '') return resolved
  } catch {
    // No policy owner: fall through to the creation header.
  }
  const header = agent?.session?.header?.agentPreset
  return typeof header === 'string' && header !== '' ? header : undefined
}

/**
 * Register the section and the tool.
 *
 * @param ctx - Cordis context; must expose `tools` and `systemPrompt`.
 * @param config - See the file contract.
 */
export function apply(ctx, config = {}) {
  const policy = {
    enabled: config.enabled !== false,
    bin: typeof config.bin === 'string' ? config.bin.trim() : DEFAULT_BIN,
    timeoutMs: positiveInteger(config.timeoutMs) ?? DEFAULT_TIMEOUT_MS,
    maxBytes: positiveInteger(config.maxBytes) ?? DEFAULT_MAX_BYTES,
  }
  if (!policy.enabled) return
  const installed = resolveOutlineBin({ bin: policy.bin })

  // THE SECTION IS FOR A ROLE THAT HAS THE TOOL. It explains how to use `outline` before
  // reading a file, so a role whose allow row excludes the tool paid ~1 KB of prompt for
  // advice it could not follow. An agent-scoped section can be gated; a host one cannot.
  // A SEAT PICKED ON A BLANK SESSION ARRIVES AFTER THE AGENT EXISTS, so the section follows the
  // seat: re-synced on `agent-preset/selected` and again at pre-step, the last point before the
  // first request header is derived.
  const sections = new WeakMap()
  const syncSection = (agent, presetOverride) => {
    if (agent === null || agent === undefined) return
    const preset = (typeof presetOverride === 'string' && presetOverride !== '' ? presetOverride :  presetOf(ctx, agent) ) ?? '(none)'
    const current = sections.get(agent)
    if (current !== undefined && current.preset === preset) return
    if (current !== undefined) {
      try {
        current.dispose?.()
      } catch {
        // A failing disposer must not take the session down.
      }
      sections.delete(agent)
    }
    if (!surfaceAllows(ctx, agent, 'outline')) return
    try {
      const order = agent.ctx?.systemPrompt?.getSectionOrder?.('outline:index') ?? FALLBACK_ORDER
      const dispose = agent.ctx.systemPrompt.section({
        name: 'outline:index',
        order,
        // A provider, not a string: the prompt is re-assembled every request, so a reload
        // that finds the binary is visible without re-registering the plugin.
        text: () => {
          try {
            return sectionText(installed)
          } catch {
            return ''
          }
        },
      })
      sections.set(agent, { preset, dispose })
    } catch {
      // A prompt registry that refuses the section must not break the session.
    }
  }
  ctx.on('agent/created', ({ agent }) => syncSection(agent))
  ctx.on('agent/pre-step', (payload, next) => {
    syncSection(payload?.agent)
    return next()
  }, { prepend: true })
  try {
    ctx.root?.on?.('session/event', (session, event) => {
      if (event?.type !== 'agent-preset/selected') return
      let live
      try {
        live = ctx.get?.('agents')?.get?.(session?.id)
      } catch {
        live = undefined
      }
      syncSection(live, event?.data?.agentPreset)
    })
  } catch {
    // A root without the session feed still re-syncs at pre-step.
  }

  if (installed === null) return

  const tool = defineTool({
    name: 'outline',
    description:
      `Cheap table of contents of a source file: symbols (kind, name, line range, signature, first-line docstring) without the bodies, parsed by ${BINARY} ${installed.version ?? ''}. JavaScript, TypeScript, TSX and Python; Go yields types only, without functions. Use it on a file you have not read, then read only the lines of the symbol you picked. A non-code file (or any other language) has no symbols - use read for it. Returns the JSON the parser printed.`,
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'File to outline, relative to the workspace or absolute. A directory is not expanded by this tool.',
      },
      depth: {
        type: 'integer',
        description: 'Nesting depth 1-3 (default 1). Depth 2 on a 100 991 B file returned 57 490 B where depth 1 returned 8 924 B.',
      },
      docstrings: {
        type: 'boolean',
        description: 'Include first-line docstrings/JSDoc (default true). false omits them.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      try {
        return await buildOutlineResult(args, {
          bin: installed.bin,
          timeoutMs: policy.timeoutMs,
          maxBytes: policy.maxBytes,
          cwd: workingDir(exec?.agent),
        })
      } catch (error) {
        if (error instanceof OutlineError) return { ok: false, code: error.code, message: error.message }
        throw error
      }
    },
  })

  // Every agent whose allow row admits it gets the tool: a file outline is not a role's
  // speciality, and a child that cannot outline a file spends its context reading whole files
  // instead. The row is still the owner — a role that excludes `outline` gets neither the tool
  // nor the section above — and it is re-synced on the seat, because a preset picked after the
  // agent exists must still decide the surface.
  const toolSeats = new WeakMap()
  const syncTool = (agent, presetOverride) => {
    if (agent === null || agent === undefined) return
    const preset = (typeof presetOverride === 'string' && presetOverride !== '' ? presetOverride :  presetOf(ctx, agent) ) ?? '(none)'
    const current = toolSeats.get(agent)
    if (current !== undefined && current.preset === preset) return
    if (current !== undefined) {
      try {
        current.dispose?.()
      } catch {
        // A failing disposer must not take the session down.
      }
      toolSeats.delete(agent)
    }
    if (!surfaceAllows(ctx, agent, 'outline')) return
    try {
      const dispose = agent.ctx.tools.register(tool)
      toolSeats.set(agent, { preset, dispose })
    } catch {
      // A duplicate registration would throw; leaving the tool out is the safe failure.
    }
  }
  ctx.on('agent/created', ({ agent }) => syncTool(agent))
  ctx.on('agent/pre-step', (payload, next) => {
    syncTool(payload?.agent)
    return next()
  }, { prepend: true })
  try {
    ctx.root?.on?.('session/event', (session, event) => {
      if (event?.type !== 'agent-preset/selected') return
      let live
      try {
        live = ctx.get?.('agents')?.get?.(session?.id)
      } catch {
        live = undefined
      }
      syncTool(live, event?.data?.agentPreset)
    })
  } catch {
    // A root without the session feed still re-syncs at pre-step.
  }
}
