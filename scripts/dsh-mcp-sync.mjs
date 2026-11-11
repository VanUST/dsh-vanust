/**
 * PURPOSE
 *   Materialize the deployment's declarative MCP server list into the harness HOME patch
 *   layer, which is where a mounted server actually comes from. This is the writer half of
 *   the pair whose reader is `plugins/godot-mcp/godot-mcp.mjs`; the two share that module's
 *   `buildRow`/`renderPatch` so the spec format and the row shape cannot drift apart.
 *
 *   WHY THE HOME LAYER AND NOT THE PROFILE LAYER. The harness applies
 *   `$DSH_HOME/cordis.patch.yml` over every profile, including the `web` profile this
 *   deployment runs, so one row serves every profile. The kit's own
 *   `profile/cordis.patch.yml` is projected per profile and would have to be repeated for
 *   each one.
 *
 * INPUTS
 *   --spec <path>      canonical server list. Default: `<kit>/profile/mcp-servers.json`.
 *   --home <path>      harness home. Default: `$DSH_HOME`, else `~/.dsh`, else `~/.npm/dsh`.
 *   --workspace <path> expands `<workspace>` in the spec's launcher candidates. Default:
 *                      `--project`, else the process working directory.
 *   --project <path>   Godot project directory, placed on the row as `cwd` and exported to
 *                      the bridge. Required only to make the bridge start in the project;
 *                      the row is still correct without it.
 *   --check            report what would be written and write nothing (the default).
 *   --apply            write the patch layer. Refuses, without writing, when the target
 *                      holds content this script did not generate - see below.
 *   --json             emit one JSON object on stdout instead of human text.
 *
 * OUTPUTS
 *   Exit 0 when the requested mode succeeded, 1 when `--apply` could not write, 2 on a
 *   usage error. Prints a JSON object with fields: ok, mode, spec, home, patchPath,
 *   rows[], uvx, project, present, matches, changed, errors[], next[].
 *
 *   The refusal rule, stated because it is the one thing that can lose data: if the target
 *   patch file exists and parses as a top-level array whose every element carries one of our
 *   row ids, it is ours and is rewritten. If it exists in any other shape - another tool's
 *   entries, a mapping instead of a list, unparseable text - the script writes NOTHING and
 *   reports `patchPath` with the reason. Merging a foreign YAML document would require a
 *   YAML parser this script deliberately does not carry, and a hand-rolled merge that gets
 *   indentation wrong destroys the operator's other client configuration.
 *
 *   THE HINDSIGHT EXCEPTION. The Hindsight installer appends a marked YAML block after
 *   this script's JSON array, which makes the home patch invalid. The classifier lifts
 *   that block, recognises its `hindsight` row as a known third-party row, and the writer
 *   appends it back as a JSON object. This is a targeted repair for that installer's
 *   footer, not a general YAML merge; a foreign document without the markers is refused.
 *
 *   OUR ROW IDS ARE TWO SPELLINGS ON PURPOSE. The id a row carries is
 *   `mcp-client-<server id>`; an earlier version wrote the bare `<server id>`, and that
 *   spelling collided with the kit's own plugin row — the loader refuses a composition in
 *   which two entries share an id, so `dsh web` stopped starting entirely. This script
 *   therefore recognises the older spelling as ours, which is what lets the next sync REWRITE
 *   a machine that already has the colliding row instead of refusing it as a foreign file and
 *   leaving the machine unable to boot. Nothing else is accepted, so the refusal above still
 *   protects another writer's entries.
 *
 * KEYWORDS
 *   mcp, patch layer, cordis, dsh-mcp-client, godot-ai, uvx, projection, fail closed
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Spec invalid: reported from `readSpec` with every error, nothing written, exit 1.
 *   - No enabled servers: the patch file is written as an empty array, which is a valid
 *     patch layer, rather than being deleted. Deleting is a separate intent.
 *   - uvx not found: reported, `rows` still built only for servers whose launcher resolved;
 *     a server whose launcher is missing is named in `errors` and skipped, because a row
 *     with an undefined command would fail at boot in the loader rather than here.
 *   - No project directory: `cwd` is omitted rather than guessed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildRow,
  expandPathTokens,
  readSpec,
  renderPatch,
  resolveBinary,
  resolveHome,
  resolveNpx,
  resolveUvx,
  rowIdsFor,
  serverNames,
} from '../plugins/godot-mcp/godot-mcp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT = resolve(HERE, '..')

/** Parses argv. An unknown flag or a missing value is a usage error. */
function parseArgs(argv) {
  const options = { mode: 'check', spec: null, home: null, workspace: null, project: null, out: null, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      i += 1
      return value
    }
    switch (arg) {
      case '--spec': options.spec = next(); break
      case '--home': options.home = next(); break
      case '--workspace': options.workspace = next(); break
      case '--project': options.project = next(); break
      case '--out': options.out = next(); break
      case '--check': options.mode = 'check'; break
      case '--apply': options.mode = 'apply'; break
      case '--json': options.json = true; break
      case '--help': options.help = true; break
      default: throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

const USAGE = [
  'Usage: node scripts/dsh-mcp-sync.mjs [--check|--apply] [options]',
  '',
  '  --spec <path>       canonical server list (default <kit>/profile/mcp-servers.json)',
  '  --home <path>       harness home (default $DSH_HOME)',
  '  --workspace <path>  expands <workspace> in launcher candidates',
  '  --project <path>    project directory, placed on the row as cwd',
  '  --out <path>        write the pack to this patch file instead of the harness home;',
  '                      use with a workspace-scoped spec so no machine-wide row is written',
  '  --check             report only (default)',
  '  --apply             write the patch layer',
  '  --json              machine-readable output',
].join('\n')

/**
 * Decide whether an existing patch file is ours to overwrite.
 *
 * @param path - Absolute patch file path.
 * @param acceptedIds - Every row id this deployment may have written: the ids a sync writes
 *   now, plus the pre-prefix spelling an earlier version wrote (see `rowIdsFor`). Recognising
 *   the older spelling is what lets a machine whose row was written before the rename be
 *   repaired by the next sync instead of being refused as a foreign file — and the older
 *   spelling is exactly the one that collided with the kit's own plugin row at boot.
 * @returns `{ ours, reason, text }`. `ours` is true when the file is absent or when every
 *   top-level element carries one of our row ids; `reason` names the refusal otherwise.
 */
const HINDSIGHT_START = '# HINDSIGHT_CODING_AGENTS_DSH_START'
const HINDSIGHT_END = '# HINDSIGHT_CODING_AGENTS_DSH_END'

/**
 * The Hindsight installer appends a YAML block after the JSON array this script writes,
 * which makes the home patch invalid. Recognise that exact marked block, lift its row out,
 * and leave the rest of the file parseable. This is a repair, not a general YAML parser: a
 * foreign document without those markers is still refused.
 *
 * @param text - Raw patch file text.
 * @returns `{ text, hindsight }`, where `hindsight` is a row element or null.
 */
function liftHindsightBlock(text) {
  const start = text.indexOf(HINDSIGHT_START)
  const end = text.indexOf(HINDSIGHT_END)
  if (start === -1 || end === -1 || end < start) return { text, hindsight: null }
  const block = text.slice(start, end)
  const name = /name:\s*["']([^"']+)["']/.exec(block)?.[1]
  if (typeof name !== 'string' || name === '') return { text, hindsight: null }
  return {
    text: `${text.slice(0, start)}${text.slice(end + HINDSIGHT_END.length)}`,
    hindsight: { insert: [{ id: 'hindsight', name }] },
  }
}

/**
 * Decide whether an existing patch file is ours to overwrite.
 *
 * @param path - Absolute patch file path.
 * @param acceptedIds - Every row id this deployment may have written: the ids a sync writes
 *   now, plus the pre-prefix spelling an earlier version wrote (see `rowIdsFor`). Recognising
 *   the older spelling is what lets a machine whose row was written before the rename be
 *   repaired by the next sync instead of being refused as a foreign file — and the older
 *   spelling is exactly the one that collided with the kit's own plugin row at boot.
 *   A `hindsight` row is preserved as a known third-party row.
 * @returns `{ ours, reason, text, hindsight }`. `ours` is true when the file is absent or when
 *   every top-level element carries one of our row ids or is the Hindsight row; `reason` names
 *   the refusal otherwise.
 */
function classifyPatch(path, acceptedIds) {
  if (!existsSync(path)) return { ours: true, reason: 'absent', text: null, hindsight: null }
  let text
  try {
    text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  } catch (error) {
    return { ours: false, reason: `unreadable: ${error.message}`, text: null, hindsight: null }
  }
  if (text.trim() === '') return { ours: true, reason: 'empty', text, hindsight: null }
  const lifted = liftHindsightBlock(text)
  let parsed
  try {
    parsed = JSON.parse(lifted.text)
  } catch {
    return { ours: false, reason: 'not JSON — treating it as another tool\'s YAML and leaving it untouched', text, hindsight: null }
  }
  if (!Array.isArray(parsed)) {
    return { ours: false, reason: 'a JSON document that is not a top-level array', text, hindsight: null }
  }
  const existingHindsight = parsed.find((element) => Array.isArray(element?.insert) && element.insert.some((row) => row?.id === 'hindsight')) ?? null
  const hindsight = existingHindsight ?? lifted.hindsight
  const foreign = parsed.filter((element) => {
    const rows = element?.insert
    if (!Array.isArray(rows)) return true
    return rows.some((row) => !acceptedIds.has(row?.id) && row?.id !== 'hindsight')
  })
  if (foreign.length > 0) {
    return { ours: false, reason: `${foreign.length} top-level element(s) are not this deployment's rows`, text, hindsight }
  }
  return { ours: true, reason: 'ours', text, hindsight }
}

/**
 * Append a preserved Hindsight row to the rendered MCP rows.
 *
 * @param rendered - JSON array text from `renderPatch`.
 * @param hindsight - Preserved row element, or null.
 * @returns Patch text.
 */
function withHindsight(rendered, hindsight) {
  if (hindsight === null) return rendered
  const parsed = JSON.parse(rendered)
  parsed.push(hindsight)
  return `${JSON.stringify(parsed, null, 2)}\n`
}

/**
 * Read the pack-level rows a spec declares beside its servers.
 *
 * A workspace pack is more than MCP rows: the code-search pack also mounts one static
 * prompt-routing plugin, and that row belongs to the same opt-in artifact as the servers.
 * The rows are declared in the spec (so one file describes the whole pack) and written here,
 * because this script is the only writer of a pack. A row must carry an id and a name; a
 * malformed one is refused rather than emitted, for the same reason a malformed server is.
 *
 * @param specPath - Absolute path to the spec.
 * @returns `{ rows, errors }`, where `rows` are `{ id, name }` objects with `<kit>` and
 *   `<project>` already refused (they are expanded by the caller, which knows both paths).
 */
function readPackRows(specPath) {
  const errors = []
  let parsed
  try {
    parsed = JSON.parse(readFileSync(specPath, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    return { rows: [], errors: [`pack rows unreadable: ${error.message}`] }
  }
  const declared = parsed?.packRows
  if (declared === undefined) return { rows: [], errors }
  if (!Array.isArray(declared)) return { rows: [], errors: ['`packRows` must be an array'] }
  const rows = []
  for (const [index, row] of declared.entries()) {
    if (row === null || typeof row !== 'object' || typeof row.id !== 'string' || typeof row.name !== 'string') {
      errors.push(`packRows[${index}]: expected { id, name }`)
      continue
    }
    rows.push(row)
  }
  return { rows, errors }
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`)
    process.exit(2)
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`)
    process.exit(0)
  }

  const home = options.home ?? resolveHome()
  const specPath = options.spec ?? join(KIT, 'profile', 'mcp-servers.json')
  // A workspace pack is an OVERLAY the operator applies (`dsh ... --patch <out>`), not a
  // machine-wide row. `--out` is what makes that possible without a second writer: the same
  // row builder renders the same shape, and the harness home is never opened for writing.
  const outPath = options.out === null ? null : resolve(options.out)
  const workspace = options.workspace ?? options.project ?? process.cwd()
  // Default the project directory by looking for the marker rather than by adopting the
  // working directory. A `cwd` the bridge is started in is load-bearing — it is where the
  // editor addon is discovered — so a guessed directory is worse than none, and the row is
  // still valid without it.
  const projectDir = options.project
    ? resolve(options.project)
    : (existsSync(join(workspace, 'project.godot')) ? resolve(workspace) : null)
  const patchPath = outPath ?? join(home, 'cordis.patch.yml')

  const result = {
    ok: true,
    mode: options.mode,
    spec: specPath,
    home,
    patchPath,
    pack: outPath !== null,
    rows: [],
    routes: [],
    namespaces: [],
    uvx: null,
    npx: null,
    binary: {},
    project: projectDir,
    present: false,
    matches: null,
    changed: false,
    errors: [],
    next: [],
  }

  const spec = readSpec({ specPath, home })
  if (!spec.ok) {
    result.ok = false
    result.errors.push(...spec.errors)
  }
  for (const server of spec.servers) {
    // Only the launcher the server DECLARES is resolved, and only that one is required. An
    // npm server has no business needing uvx on the machine, and a uvx server has no business
    // needing npx; demanding both would refuse a correct row over a tool it never runs.
    const runner = server.runner ?? 'uvx'
    const uvx = runner === 'uvx' ? resolveUvx({ server, workspace }) : null
    if (runner === 'uvx' && !uvx) {
      result.errors.push(`${server.id}: no uvx launcher found (checked $${server.uvxEnv ?? 'UVX_BIN'}, the spec candidates, and PATH)`)
      continue
    }
    const npx = runner === 'npx' ? resolveNpx({}) : null
    const binary = runner === 'binary' ? resolveBinary({ server }) : null
    if (runner === 'binary' && !binary) {
      result.errors.push(`${server.id}: no "${server.binary}" executable found (checked $${server.binaryEnv ?? 'PATH'}, the spec candidates, and PATH); run node ${join(KIT, 'scripts', 'provision-tools.mjs')} --apply`)
      continue
    }
    if (uvx) result.uvx = result.uvx ?? uvx
    if (npx) result.npx = result.npx ?? npx
    if (binary) result.binary[server.id] = binary
    try {
      result.rows.push(buildRow({
        server,
        uvx: uvx ?? undefined,
        npx: npx ?? undefined,
        binary: binary ?? undefined,
        projectDir: projectDir ?? undefined,
        kitDir: KIT,
      }))
    } catch (error) {
      result.errors.push(`${server.id}: ${error.message}`)
    }
  }
  result.namespaces = serverNames(spec)
  if (spec.servers.length > 0 && result.rows.length === 0) {
    result.ok = false
    result.errors.push('no server could be materialized; refusing to write a patch layer that would mount nothing')
  }

  // Pack-level rows (a static routing section, in the code-search pack) travel with the same
  // opt-in artifact. Their ids join the accepted set so a regenerated pack is recognized as
  // ours, and a foreign file at the same path is still refused.
  const pack = readPackRows(specPath)
  result.errors.push(...pack.errors)
  if (pack.errors.length > 0) result.ok = false
  const expandValue = (value) => {
    if (typeof value === 'string') return expandPathTokens(value, { kitDir: KIT, projectDir })
    if (Array.isArray(value)) return value.map(expandValue)
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, expandValue(inner)]))
    return value
  }
  const packRows = pack.rows.map((row) => expandValue(row))
  result.routes = packRows.map((row) => row.id)
  const acceptedIds = rowIdsFor(spec).accepted
  for (const row of packRows) acceptedIds.add(row.id)

  // The ids this deployment may already have written for the declared servers: the prefixed
  // ones a sync writes now, plus the bare server ids written before the rename. A layer holding
  // only those is ours to replace; anything else is another writer's and is left alone.
  const classification = classifyPatch(patchPath, acceptedIds)
  const rendered = withHindsight(renderPatch({ rows: [...result.rows, ...packRows] }), classification.hindsight)
  result.present = existsSync(patchPath)
  result.matches = classification.ours && classification.text !== null && classification.text === rendered

  if (!classification.ours) {
    result.ok = false
    result.errors.push(`${patchPath} was not written: ${classification.reason}`)
    result.next.push(`Review ${patchPath} — it holds configuration this script did not generate.`)
    result.next.push('Move the foreign entries into their own layer, or delete the file, then re-run with --apply.')
  } else if (options.mode === 'apply' && result.ok) {
    if (result.matches) {
      // Byte-identical: writing would only churn the mtime and make a converged machine
      // look changed.
    } else {
      try {
        mkdirSync(dirname(patchPath), { recursive: true })
        writeFileSync(patchPath, rendered)
        result.changed = true
      } catch (error) {
        result.ok = false
        result.errors.push(`write ${patchPath}: ${error.message}`)
      }
    }
  }

  if (result.changed) {
    result.next.push(result.pack
      ? `Apply the pack per project: dsh <profile> --patch ${patchPath} (or dsh headless --patch …). It is inert until an operator passes it.`
      : 'Restart dsh: the patch layer is read at boot, so the new server row is not live yet.')
  }
  if (!result.pack && !existsSync(join(home, 'mcp-servers.json'))) {
    result.next.push(`Project the canonical spec first: node ${join(KIT, 'scripts', 'kit-update.mjs')} --apply`)
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    const say = (line) => process.stdout.write(`${line}\n`)
    say(`mode      ${result.mode}${result.pack ? ' (workspace pack)' : ' (harness home)'}`)
    say(`spec      ${result.spec}`)
    say(`patch     ${result.patchPath}${result.present ? ' (exists)' : ' (absent)'}`)
    if (result.uvx !== null) say(`uvx       ${result.uvx}`)
    if (result.npx !== null) say(`npx       ${result.npx}`)
    for (const [id, path] of Object.entries(result.binary)) say(`binary    ${id}: ${path}`)
    say(`project   ${result.project ?? '(none — cwd omitted)'}`)
    say(`rows      ${result.rows.length} ${result.namespaces.join(' ')}`.trim())
    if (result.routes.length > 0) say(`pack      ${result.routes.join(' ')}`)
    for (const error of result.errors) say(`ERROR: ${error}`)
    for (const line of result.next) say(`next: ${line}`)
  }
  process.exit(result.ok ? 0 : 1)
}

await main()
