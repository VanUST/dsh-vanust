/**
 * PURPOSE
 *   Make a declarative MCP-server list a property of the DEPLOYMENT rather than of one
 *   machine, and be the one module that knows how a server entry becomes a loaded row.
 *
 *   The harness already ships an MCP client bridge
 *   (`@deepseek-ai/dsh-mcp-client`), so nothing here speaks the MCP protocol. What the
 *   bridge does not do is any of the three things this plugin exists for. It does not
 *   know where `uvx` is on this machine, and the Godot AI bridge cannot be launched
 *   without it. It does not know where the Godot project is, which the bridge needs as a
 *   working directory. And it does not offer a canonical, versioned server list, so a
 *   machine configured through a UI is configured for that machine only and a second
 *   machine starts from nothing.
 *
 *   The division of labour is therefore: this module owns the SPEC and the ROW, and the
 *   shipped bridge owns the connection. The row is materialized into the harness HOME
 *   patch layer by `scripts/dsh-mcp-sync.mjs`, which imports the functions below so that
 *   the spec format and the row shape cannot drift between the reader and the writer.
 *
 *   WHY THE ROW IS WRITTEN AND REPARSED RATHER THAN MOUNTED HERE. Mounting the bridge
 *   from this plugin's `apply()` would make the harness's own loader asynchronous and
 *   give this module ownership of the bridge's connection lifecycle, disposal and
 *   hot-swap semantics - all of which the loader already implements correctly from a
 *   declarative row. Writing a row and letting the loader read it at boot keeps one
 *   implementation of that lifecycle, at the cost of needing a restart for a new server
 *   to appear.
 *
 * INPUTS
 *   Config (optional, all fields optional):
 *     specPath      - absolute path to the canonical server list. Default
 *                     `$DSH_HOME/mcp-servers.json`, where the kit projects the spec.
 *     showStatus    - whether to contribute a system-prompt section reporting the
 *                     configured MCP servers. Default true.
 *     workspacePath - absolute path used to expand `<workspace>` in the spec, for callers
 *                     that materialize a row. When absent the process working directory
 *                     is used, which is the session workspace for a normal session.
 *   Environment: `DSH_HOME` locates the harness home when set; otherwise the conventional
 *   `~/.dsh` when it exists, then the legacy `~/.npm/dsh`.
 *
 * OUTPUTS
 *   `apply(ctx)` registers at most one system-prompt section and returns no value. It
 *   never throws: a missing, empty or malformed spec contributes a section that says so,
 *   because a boot failure over an optional MCP server is a worse outcome than a
 *   deployment without one.
 *
 *   Exports, used by `scripts/dsh-mcp-sync.mjs` and by the deploy checks:
 *     readSpec({specPath})            -> { ok, specPath, version, servers, errors }
 *     resolveUvx({server, workspace}) -> absolute uvx path, or null
 *     buildConfig({server, uvx, workspace, projectDir}) -> the bridge's `config` object
 *     buildRow({...})                 -> { id, name, config }
 *     renderPatch({row})              -> textual YAML (JSON, which YAML accepts)
 *     serverNames({spec})             -> the `mcp__<serverName>__` namespaces declared
 *
 * KEYWORDS
 *   mcp, model context protocol, dsh-mcp-client, godot, godot-ai, uvx, deployment kit,
 *   transferable configuration, server spec, patch layer
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Spec absent or unreadable: `readSpec` returns ok:false with the path and reason;
 *     `apply` reports it in the prompt section and continues.
 *   - Spec valid JSON but not the expected shape (no `servers` array): ok:false, and the
 *     reason names the missing field rather than silently treating the list as empty.
 *   - A server with `enabled: false`: omitted from the row and from the status section,
 *     so disabling a server in the spec is a supported operation and not a deletion.
 *   - A server whose `serverName` does not match `[A-Za-z0-9_-]{1,32}`: rejected with the
 *     field named, because an invalid namespace would make the bridge fail at load with a
 *     less specific message.
 *   - Two servers sharing a `serverName`: rejected together, because the bridge would fail
 *     the second one at load and the spec should say why first.
 *   - `uvx` not found on this machine: `resolveUvx` returns null. This is a normal state
 *     and not an error - a machine without uv loses the Godot tools and keeps everything
 *     else, which is why `failOnStartupError` is false in the spec.
 *   - No Godot project directory: the row is still emitted with no `cwd`, because the
 *     project directory is a convenience for the bridge and not a launch prerequisite.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'godot-mcp'

/**
 * The prompt registry this plugin contributes status to. `systemPrompt` is the only
 * required service; anything else is reached opportunistically so that a composition
 * without it still gets the status section rather than failing to boot.
 */
export const inject = ['systemPrompt']

/** Section order used when the prompt registry allocates no central position. */
const FALLBACK_ORDER = 10150

/** Bridge package name; the row's `name` field must resolve to this. */
const BRIDGE_PACKAGE = '@deepseek-ai/dsh-mcp-client'

/** Row id the sync writes; stable so the writer can replace its own row and no other. */
export const ROW_ID = 'godot-mcp'

/** `serverName` grammar the bridge enforces; checked here so the spec fails first. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Resolve the deployment's harness home directory.
 *
 * Deliberately self-contained rather than importing a harness path helper: a plugin
 * installed into a profile must resolve its dependencies through that profile, and a peer
 * package that pnpm does not hoist would fail at import time.
 *
 * @returns Absolute path to the harness home.
 */
export function resolveHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  const conventional = join(homedir(), '.dsh')
  if (existsSync(conventional)) return conventional
  return join(homedir(), '.npm', 'dsh')
}

/**
 * Read and validate the canonical server list.
 *
 * @param options - { specPath?, home? }. `specPath` wins; otherwise `mcp-servers.json`
 *   inside the harness home.
 * @returns `{ ok, specPath, version, servers, errors }`. `servers` is always an array and
 *   is empty when `ok` is false. Never throws: an unreadable or malformed spec is a
 *   reported result, because the caller is a prompt assembly.
 */
export function readSpec(options = {}) {
  const home = options.home ?? resolveHome()
  const specPath = options.specPath ?? join(home, 'mcp-servers.json')
  const errors = []
  if (!existsSync(specPath)) {
    return { ok: false, specPath, version: null, servers: [], errors: [`spec not found: ${specPath}`] }
  }
  let raw
  try {
    raw = readFileSync(specPath, 'utf8').replace(/^\uFEFF/, '')
  } catch (error) {
    return { ok: false, specPath, version: null, servers: [], errors: [`spec unreadable: ${error.message}`] }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { ok: false, specPath, version: null, servers: [], errors: [`spec is not valid JSON: ${error.message}`] }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, specPath, version: null, servers: [], errors: ['spec must be a JSON object'] }
  }
  if (!Array.isArray(parsed.servers)) {
    return { ok: false, specPath, version: parsed.version ?? null, servers: [], errors: ['spec has no `servers` array'] }
  }
  const servers = []
  const seen = new Map()
  for (const [index, entry] of parsed.servers.entries()) {
    const at = `servers[${index}]`
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${at}: expected an object`)
      continue
    }
    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      errors.push(`${at}: \`id\` must be a non-empty string`)
      continue
    }
    if (typeof entry.serverName !== 'string' || !SERVER_NAME.test(entry.serverName)) {
      errors.push(`${at} (${entry.id}): \`serverName\` must match ${SERVER_NAME}`)
      continue
    }
    const previous = seen.get(entry.serverName)
    if (previous) {
      errors.push(`${at} (${entry.id}): \`serverName\` "${entry.serverName}" is already used by "${previous}"`)
      continue
    }
    seen.set(entry.serverName, entry.id)
    if (entry.enabled === false) continue
    if (entry.transport !== 'stdio') {
      // Only stdio is implemented because only stdio is in use. Refusing an unhandled
      // transport is honest; silently emitting a streamable-http row with command fields
      // would be rejected by the bridge with a message about the wrong field.
      errors.push(`${at} (${entry.id}): transport "${entry.transport}" is not supported by this plugin (only "stdio")`)
      continue
    }
    if (typeof entry.package !== 'string' || entry.package.trim() === '') {
      errors.push(`${at} (${entry.id}): \`package\` must be a non-empty string`)
      continue
    }
    servers.push({ ...entry, args: Array.isArray(entry.args) ? entry.args : [] })
  }
  return { ok: errors.length === 0, specPath, version: parsed.version ?? null, servers, errors }
}

/**
 * Locate `uvx` on this machine.
 *
 * Resolution order: the server's own environment override, the spec's candidate paths with
 * `<workspace>` expanded, the standard per-user install locations, then `PATH`. The order
 * matters in one specific way — an explicit override beats everything, so a machine that
 * keeps uv somewhere unusual can say so without editing the spec.
 *
 * The standard locations are searched because `<workspace>` is the PROJECT that happens to
 * be open, and a launcher provisioned once per user is not a property of any one project.
 * Measured: resolving only `<workspace>` made the launcher invisible whenever the sync ran
 * from anywhere but the project root, which is the normal case when the kit is what invokes
 * it.
 *
 * @param options - { server, workspace, env?, home? }. `workspace` expands `<workspace>`;
 *   absent, those candidates are skipped. `home` locates the per-user install directory and
 *   defaults to the real home.
 * @returns Absolute path to the uvx executable, or null when it is not installed. A null
 *   return is a normal state, not an error.
 */
export function resolveUvx(options = {}) {
  const server = options.server ?? {}
  const env = options.env ?? process.env
  const workspace = options.workspace ?? null
  const home = options.home ?? homedir()
  const override = typeof server.uvxEnv === 'string' ? env[server.uvxEnv] : null
  if (typeof override === 'string' && override.trim() !== '' && existsSync(override)) return override
  const exeNames = process.platform === 'win32' ? ['.exe', ''] : ['']
  const explicit = Array.isArray(server.uvxCandidates) ? server.uvxCandidates : []
  for (const candidate of explicit) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue
    const usesWorkspace = candidate.includes('<workspace>')
    if (usesWorkspace && !workspace) continue
    // `join`, not string concatenation: the spec writes candidates with forward slashes so
    // one spec serves every platform, and appending the executable suffix to a
    // slash-separated path would yield a MIXED-separator path (a drive-letter prefix
    // followed by forward slashes). Windows tolerates that form, and no other tool that
    // reads this path back can be relied on to — so it is not produced here.
    const expanded = usesWorkspace ? join(workspace, ...candidate.split('<workspace>').pop().split('/').filter(Boolean)) : candidate
    if (!isAbsolute(expanded)) continue
    for (const ext of exeNames) {
      const path = `${expanded}${ext}`
      if (existsSync(path)) return path
    }
  }
  // The per-user locations the standalone installer and `pip install uv` use, then PATH.
  const standardDirs = [join(home, '.local', 'bin'), join(home, '.cargo', 'bin')]
  const pathVar = env.PATH ?? env.Path ?? ''
  for (const dir of [...standardDirs, ...pathVar.split(delimiter)]) {
    if (typeof dir !== 'string' || dir.trim() === '') continue
    for (const ext of exeNames) {
      const path = join(dir, `uvx${ext}`)
      if (existsSync(path)) return path
    }
  }
  return null
}

/**
 * Build the bridge's `config` object for one server.
 *
 * The shape is the one the shipped bridge's own type declares - `transport`, `serverName`,
 * `command`, `args`, `cwd`, `env`, `toolCallTimeoutMs`, `failOnStartupError` - and the
 * spec contributes every value that varies. `command` is an absolute path because the
 * bridge passes it to a spawn without shell interpolation, so a bare `uvx` would depend on
 * the child's PATH rather than on the path this function just proved exists.
 *
 * @param options - { server, uvx, projectDir? }.
 * @returns The config object. `cwd` is omitted when no project directory is known, rather
 *   than set to a guess, because a wrong working directory is worse than none.
 */
export function buildConfig(options = {}) {
  const { server, uvx, projectDir } = options
  if (typeof uvx !== 'string' || uvx.trim() === '') {
    // Callers must resolve uvx first: a row whose `command` is undefined renders as an
    // absent field and the bridge would fail at load with a message about a missing
    // command rather than about the missing launcher, which is where the real fault is.
    throw new Error(`buildConfig: a resolved uvx path is required for server "${server?.id ?? '?'}"`)
  }
  const args = [...(server.args ?? [])]
  if (server.telemetry === false && !args.includes('--disable-telemetry')) {
    args.push('--disable-telemetry')
  }
  const domains = Array.isArray(server.excludeDomains) ? server.excludeDomains.filter((d) => typeof d === 'string' && d !== '') : []
  if (domains.length > 0 && !args.includes('--exclude-domains')) {
    args.push('--exclude-domains', domains.join(','))
  }
  const env = {}
  for (const [key, value] of Object.entries(server.env ?? {})) {
    if (typeof value === 'string') env[key] = value
  }
  if (typeof server.projectEnv === 'string' && server.projectEnv !== '' && projectDir) {
    env[server.projectEnv] = projectDir
  }
  const config = {
    transport: 'stdio',
    serverName: server.serverName,
    command: uvx,
    args,
  }
  if (projectDir) config.cwd = projectDir
  if (Object.keys(env).length > 0) config.env = env
  if (Number.isFinite(server.toolCallTimeoutMs)) config.toolCallTimeoutMs = server.toolCallTimeoutMs
  if (typeof server.failOnStartupError === 'boolean') config.failOnStartupError = server.failOnStartupError
  return config
}

/**
 * Build the patch-layer row that mounts the bridge for one server.
 *
 * @param options - as `buildConfig`.
 * @returns `{ id, name, config }`, ready to be the single element of an `insert` list.
 *   The `id` is stable per server id so a re-sync replaces its own row and no other.
 */
export function buildRow(options = {}) {
  const id = typeof options.server?.id === 'string' && options.server.id !== '' ? options.server.id : ROW_ID
  return { id, name: BRIDGE_PACKAGE, config: buildConfig(options) }
}

/**
 * Render a patch-layer document containing exactly the given rows.
 *
 * JSON is emitted rather than hand-written YAML because JSON is a subset of YAML 1.2 as
 * the loader's parser accepts it, and because a serializer cannot emit the indentation
 * mistakes a string-concatenating writer can. The result is a top-level array, which the
 * harness requires: its patch parser rejects a non-array file at boot.
 *
 * @param options - { rows }.
 * @returns The document text, newline-terminated.
 */
export function renderPatch(options = {}) {
  const rows = Array.isArray(options.rows) ? options.rows : []
  return `${JSON.stringify([{ insert: rows }], null, 2)}\n`
}

/**
 * The `mcp__<serverName>__` namespaces this spec declares.
 *
 * @param spec - a result from `readSpec`.
 * @returns Array of namespace strings, empty when the spec is unusable.
 */
export function serverNames(spec) {
  return (spec?.servers ?? []).map((server) => `mcp__${server.serverName}__`)
}

/**
 * Render the status section contributed to the system prompt.
 *
 * Kept to a few lines on purpose: the section is re-evaluated on every assembly, and a
 * long report about a toolchain would cost more context than the tools it describes.
 *
 * @param spec - a result from `readSpec`.
 * @param uvx - resolved uvx path or null.
 * @returns The section text; empty when the spec declares no enabled server and is valid.
 */
function statusText(spec, uvxByServer) {
  if (!spec.ok && spec.servers.length === 0) {
    const reason = spec.errors.length > 0 ? spec.errors[0] : 'unusable'
    return [
      'MCP SERVERS: the deployment server list could not be read, so no MCP tools are loaded.',
      `  spec: ${spec.specPath}`,
      `  reason: ${reason}`,
      '  fix: run `node <kit>/scripts/kit-update.mjs --apply`, then restart dsh.',
    ].join('\n')
  }
  if (spec.servers.length === 0) return ''
  const lines = ['MCP SERVERS declared by this deployment:']
  let anyMissing = false
  for (const server of spec.servers) {
    const uvx = uvxByServer.get(server.id) ?? null
    if (!uvx) anyMissing = true
    const state = uvx ? 'launcher found' : 'LAUNCHER MISSING'
    lines.push(`  - ${server.serverName} (tools appear as mcp__${server.serverName}__*) — ${server.description ?? ''} [${state}]`.trim())
  }
  if (anyMissing) {
    lines.push('  A missing launcher means those servers cannot start and their tools are absent;')
    lines.push('  the rest of the harness is unaffected because failOnStartupError is false.')
    lines.push('  fix: powershell -ExecutionPolicy Bypass -File tools/provision_godot.ps1 -Mode apply')
  }
  return lines.join('\n')
}

/**
 * Install the status section and return.
 *
 * @param ctx - Cordis context; must expose `systemPrompt`.
 * @param config - see the file contract.
 * @returns Nothing; the registration is made through `ctx.effect`, which Cordis disposes
 *   on unload so a reload replaces the section instead of colliding with it.
 */
export function apply(ctx, config = {}) {
  const specPath = config.specPath
  const workspace = config.workspacePath ?? process.cwd()
  const showStatus = config.showStatus !== false
  if (!showStatus) return
  const order = ctx?.systemPrompt?.getSectionOrder?.('godot:mcp') ?? FALLBACK_ORDER
  ctx.effect(() => {
    const dispose = ctx.systemPrompt.section({
      name: 'godot:mcp',
      order,
      // A provider, not a string: the spec is re-read on every assembly, so editing the
      // projected list is visible on the next request without a restart. The ROW is not
      // re-read that way - a new server still needs the restart the loader requires.
      text: () => {
        try {
          const spec = readSpec({ specPath })
          const uvxByServer = new Map()
          for (const server of spec.servers) {
            uvxByServer.set(server.id, resolveUvx({ server, workspace }))
          }
          const text = statusText(spec, uvxByServer)
          if (spec.errors.length > 0) {
            process.stderr.write(`godot-mcp: ${spec.errors.join('; ')}\n`)
          }
          return text
        } catch (error) {
          // Never throw from an assembly: a missing status section is a smaller failure
          // than an unbuildable prompt.
          process.stderr.write(`godot-mcp: status failed: ${error.message}\n`)
          return ''
        }
      },
    })
    return () => dispose()
  })
}
