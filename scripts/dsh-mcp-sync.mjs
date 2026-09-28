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
  readSpec,
  renderPatch,
  resolveHome,
  resolveUvx,
  rowIdsFor,
  serverNames,
} from '../plugins/godot-mcp/godot-mcp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT = resolve(HERE, '..')

/** Parses argv. An unknown flag or a missing value is a usage error. */
function parseArgs(argv) {
  const options = { mode: 'check', spec: null, home: null, workspace: null, project: null, json: false }
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
  '  --project <path>    Godot project directory, placed on the row as cwd',
  '  --check             report only (default)',
  '  --apply             write $DSH_HOME/cordis.patch.yml',
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
function classifyPatch(path, acceptedIds) {
  if (!existsSync(path)) return { ours: true, reason: 'absent', text: null }
  let text
  try {
    text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  } catch (error) {
    return { ours: false, reason: `unreadable: ${error.message}`, text: null }
  }
  if (text.trim() === '') return { ours: true, reason: 'empty', text }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ours: false, reason: 'not JSON — treating it as another tool\'s YAML and leaving it untouched', text }
  }
  if (!Array.isArray(parsed)) {
    return { ours: false, reason: 'a JSON document that is not a top-level array', text }
  }
  const foreign = parsed.filter((element) => {
    const rows = element?.insert
    if (!Array.isArray(rows)) return true
    return rows.some((row) => !acceptedIds.has(row?.id))
  })
  if (foreign.length > 0) {
    return { ours: false, reason: `${foreign.length} top-level element(s) are not this deployment's rows`, text }
  }
  return { ours: true, reason: 'ours', text }
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
  const workspace = options.workspace ?? options.project ?? process.cwd()
  // Default the project directory by looking for the marker rather than by adopting the
  // working directory. A `cwd` the bridge is started in is load-bearing — it is where the
  // editor addon is discovered — so a guessed directory is worse than none, and the row is
  // still valid without it.
  const projectDir = options.project
    ? resolve(options.project)
    : (existsSync(join(workspace, 'project.godot')) ? resolve(workspace) : null)
  const patchPath = join(home, 'cordis.patch.yml')

  const result = {
    ok: true,
    mode: options.mode,
    spec: specPath,
    home,
    patchPath,
    rows: [],
    namespaces: [],
    uvx: null,
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
    const uvx = resolveUvx({ server, workspace })
    if (!uvx) {
      result.errors.push(`${server.id}: no uvx launcher found (checked $${server.uvxEnv ?? 'UVX_BIN'}, the spec candidates, and PATH)`)
      continue
    }
    result.uvx = result.uvx ?? uvx
    try {
      result.rows.push(buildRow({ server, uvx, projectDir: projectDir ?? undefined }))
    } catch (error) {
      result.errors.push(`${server.id}: ${error.message}`)
    }
  }
  result.namespaces = serverNames(spec)
  if (spec.servers.length > 0 && result.rows.length === 0) {
    result.ok = false
    result.errors.push('no server could be materialized; refusing to write a patch layer that would mount nothing')
  }

  const rendered = renderPatch({ rows: result.rows })
  // The ids this deployment may already have written for the declared servers: the prefixed
  // ones a sync writes now, plus the bare server ids written before the rename. A layer holding
  // only those is ours to replace; anything else is another writer's and is left alone.
  const classification = classifyPatch(patchPath, rowIdsFor(spec).accepted)
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
    result.next.push('Restart dsh: the patch layer is read at boot, so the new server row is not live yet.')
  }
  if (!existsSync(join(home, 'mcp-servers.json'))) {
    result.next.push(`Project the canonical spec first: node ${join(KIT, 'scripts', 'kit-update.mjs')} --apply`)
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    const say = (line) => process.stdout.write(`${line}\n`)
    say(`mode      ${result.mode}`)
    say(`spec      ${result.spec}`)
    say(`patch     ${result.patchPath}${result.present ? ' (exists)' : ' (absent)'}`)
    say(`uvx       ${result.uvx ?? 'NOT FOUND'}`)
    say(`project   ${result.project ?? '(none — cwd omitted)'}`)
    say(`rows      ${result.rows.length} ${result.namespaces.join(' ')}`.trim())
    for (const error of result.errors) say(`ERROR: ${error}`)
    for (const line of result.next) say(`next: ${line}`)
  }
  process.exit(result.ok ? 0 : 1)
}

await main()
