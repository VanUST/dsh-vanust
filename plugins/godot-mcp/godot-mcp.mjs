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
 *   Spec fields per server, beyond `id`/`serverName`/`transport`:
 *     runner         - `uvx` (default) or `npx`. Which launcher the row needs, declared
 *                      rather than inferred, so an npm server is never refused for a uvx it
 *                      does not use and vice versa.
 *     package        - the distribution to run: a Python requirement (`godot-ai==4.2.3`)
 *                      for uvx, or a pinned npm package (`@playwright/mcp@0.0.79`) for npx.
 *                      Pinned in both cases, because an unpinned server can change under a
 *                      running deployment.
 *     args           - extra arguments for the server itself. For an npx server the runner
 *                      supplies `-y <package>` ahead of these.
 *     telemetryFlag / domainsFlag - the flags THIS provider understands. `telemetry: false`
 *                      appends `telemetryFlag` only when the field is present, because a
 *                      flag a server does not know makes it refuse to start.
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
 *     resolveNpx({env})               -> the npx beside the running interpreter, or `npx`
 *     buildConfig({server, uvx, npx, projectDir}) -> the bridge's `config` object
 *     buildRow({...})                 -> { id, name, config }
 *     rowIdFor({id})                  -> `mcp-client-<id>`, the loader id a row carries
 *     legacyRowIdFor({id})            -> `<id>`, the spelling written before ROW_ID_PREFIX
 *     rowIdsFor({servers})            -> { current, accepted }, the ids a layer may carry
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
 *   - A generated row id that equals an AUTHORED entry id: reported by the gate that ships the
 *     kit, because one composition has one loader-id namespace and the harness fails the whole
 *     tree on a duplicate (`duplicate loader entry id`) - the boot failure that made every row
 *     id carry a prefix. `check-portability.mjs` fails when a patch spells one.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'

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

/**
 * Namespace in front of a server's id, for the loader id this deployment mints for it.
 *
 * WHY THE ROW ID IS NOT THE SERVER ID — measured on this deployment, 2026-09-28. A
 * composition has ONE loader-id namespace: the bundles, `profile/cordis.patch.yml` and
 * `$DSH_HOME/cordis.patch.yml` all insert entries into the same group, and the loader
 * refuses the whole tree when two entries share an id. This module used to derive a row's
 * id from the server's own id, so a server declared as `godot-mcp` minted a row with that
 * id — while the kit's plugin row, whose loader id is its function name (`godot-mcp`), was
 * mounted in the profile layer. `dsh web` stopped starting at all:
 * `duplicate loader entry id: godot-mcp`, thrown from the loader before any plugin loaded.
 *
 * The defect is a namespace crossing, not a typo: a row id derived from deployment DATA (a
 * server id, chosen in `mcp-servers.json`) and an entry id AUTHORED in a patch were allowed
 * to be the same string. The prefix makes them disjoint by construction — a generated id now
 * reads as generated — and `check-portability.mjs` is what fails when an authored patch id
 * ever spells one of the ids this module mints.
 */
export const ROW_ID_PREFIX = 'mcp-client-'

/**
 * The loader id this deployment mints for one server.
 *
 * @param server - A server from {@link readSpec}, whose `id` is required and non-empty.
 * @returns `mcp-client-<server id>`.
 */
export function rowIdFor(server) {
  return `${ROW_ID_PREFIX}${server?.id ?? ''}`
}

/**
 * The id this deployment wrote for one server BEFORE the prefix existed: the bare server id.
 *
 * Recognised, never written. `classifyPatch` in the sync decides whether the home patch layer
 * is this deployment's to rewrite by matching every row against a known id, and a layer written
 * by an earlier version of this module carries the unprefixed spelling. A rename that stopped
 * recognising it would refuse to touch the very file the rename exists to repair, on exactly the
 * machines whose boot is broken — and the file that collides is the old one. New writes always
 * use {@link rowIdFor}, so the legacy spelling is gone from a machine the first time it syncs.
 *
 * @param server - A server from {@link readSpec}.
 * @returns The legacy id, `<server id>`.
 */
export function legacyRowIdFor(server) {
  return `${server?.id ?? ''}`
}

/**
 * The ids a spec's rows carry now, and every spelling this deployment still recognises.
 *
 * @param spec - A result from {@link readSpec}.
 * @returns `{ current, accepted }`, both Sets: the ids a sync writes, and the ids a layer this
 *   deployment wrote may already carry (the current ids plus the pre-prefix spelling).
 */
export function rowIdsFor(spec = {}) {
  const servers = Array.isArray(spec?.servers) ? spec.servers : []
  const current = new Set(servers.map((server) => rowIdFor(server)))
  return {
    current,
    accepted: new Set([...current, ...servers.map((server) => legacyRowIdFor(server))]),
  }
}

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
    // The launcher, stated rather than inferred. `uvx` is the default so a spec written
    // before this field existed keeps working; `npx` runs an npm package instead. A runner
    // this plugin does not implement is REFUSED rather than guessed at: a row whose command
    // is wrong fails at boot in the loader, a worse place to find out.
    const runner = entry.runner === undefined ? 'uvx' : entry.runner
    if (runner !== 'uvx' && runner !== 'npx') {
      errors.push(`${at} (${entry.id}): \`runner\` must be "uvx" or "npx" (got ${JSON.stringify(entry.runner)})`)
      continue
    }
    if (typeof entry.package !== 'string' || entry.package.trim() === '') {
      errors.push(`${at} (${entry.id}): \`package\` must be a non-empty string`)
      continue
    }
    servers.push({ ...entry, runner, args: Array.isArray(entry.args) ? entry.args : [] })
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
 * Locate `npx` for a server launched from an npm package.
 *
 * Different from {@link resolveUvx} on purpose: `npx` ships with the Node the harness itself
 * runs on, so the first candidate is the one beside `process.execPath` rather than a set of
 * per-user install locations. An explicit `NPX_BIN` still wins, and when nothing is found on
 * disk the bare name `npx` is returned, because the operating system resolves it from PATH at
 * spawn time - the sync cannot verify that path, and refusing the row over it would break the
 * ordinary case of a Node installed by a package manager.
 *
 * @param options - { env? }. `NPX_BIN` overrides everything.
 * @returns An absolute path when one was found on disk, else `"npx"`.
 */
export function resolveNpx(options = {}) {
  const env = options.env ?? process.env
  const override = env?.NPX_BIN
  if (typeof override === 'string' && override.trim() !== '') return override
  // Deliberately NOT wrapped in a catch. The first version was, and it swallowed a
  // ReferenceError from a missing `dirname` import: the function returned the plausible
  // fallback "npx" while the code was broken, so nothing failed and nothing was logged.
  // Neither expression here can throw in a Node process, so there is nothing to tolerate.
  const beside = join(dirname(process.execPath), process.platform === 'win32' ? 'npx.cmd' : 'npx')
  if (existsSync(beside)) return beside
  return 'npx'
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
 * @param options - `{ server, uvx, npx, projectDir? }`. The launcher for the server's own
 *   `runner` is required; the other one is ignored.
 * @returns The config object. `cwd` is omitted when no project directory is known, rather
 *   than set to a guess, because a wrong working directory is worse than none.
 */
export function buildConfig(options = {}) {
  const { server, uvx, npx, projectDir } = options
  const runner = server?.runner ?? 'uvx'
  // Which launcher this row needs is the server's own declaration; requiring the other one
  // is how a correct npm server would be refused for a launcher it never uses.
  const launcher = runner === 'npx' ? npx : uvx
  if (typeof launcher !== 'string' || launcher.trim() === '') {
    // Callers must resolve the launcher first: a row whose `command` is undefined renders as
    // an absent field and the bridge would fail at load with a message about a missing
    // command rather than about the missing launcher, which is where the real fault is.
    throw new Error(`buildConfig: a resolved ${runner === 'npx' ? 'npx' : 'uvx'} path is required for server "${server?.id ?? '?'}"`)
  }
  const args = [...(server.args ?? [])]
  // The provider-specific flags are DECLARED in the spec, not inferred from a boolean:
  // `--disable-telemetry` is a Godot AI flag, and pushing it at an npm server that does not
  // know it makes that server refuse to start over an unknown option.
  if (server.telemetry === false && typeof server.telemetryFlag === 'string' && !args.includes(server.telemetryFlag)) {
    args.push(server.telemetryFlag)
  }
  const domains = Array.isArray(server.excludeDomains) ? server.excludeDomains.filter((d) => typeof d === 'string' && d !== '') : []
  if (domains.length > 0 && typeof server.domainsFlag === 'string' && !args.includes(server.domainsFlag)) {
    args.push(server.domainsFlag, domains.join(','))
  }
  const env = {}
  for (const [key, value] of Object.entries(server.env ?? {})) {
    if (typeof value === 'string') env[key] = value
  }
  if (typeof server.projectEnv === 'string' && server.projectEnv !== '' && projectDir) {
    env[server.projectEnv] = projectDir
  }
  // `npx -y <package>`: `-y` answers the install prompt that would otherwise wait for a
  // terminal this process does not have. The package is pinned in the spec, so the bytes
  // that run are the bytes that were reviewed.
  const config = {
    transport: 'stdio',
    serverName: server.serverName,
    command: launcher,
    args: runner === 'npx' ? ['-y', ...(typeof server.package === 'string' ? [server.package] : []), ...args] : args,
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
 * @returns `{ id, name, config }`, ready to be the single element of an `insert` list. The
 *   `id` is derived from the server's id under {@link ROW_ID_PREFIX}, so a re-sync replaces
 *   its own row and no other, and a server id can never spell an authored plugin's entry id.
 */
export function buildRow(options = {}) {
  return { id: rowIdFor(options.server), name: BRIDGE_PACKAGE, config: buildConfig(options) }
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
    lines.push('  fix: node <kit>/scripts/provision-godot.mjs --mode apply   # engine, uvx and addon')
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
