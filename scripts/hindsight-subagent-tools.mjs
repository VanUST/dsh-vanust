#!/usr/bin/env node
/**
 * PURPOSE
 *   Make the installed Hindsight dsh plugin's `hindsight_*` TOOLS work inside a
 *   subagent session, while leaving its automatic recall / write-back ROOT-ONLY.
 *
 * WHY A PATCH AND NOT A CONFIG FLAG
 *   `@vectorize-io/hindsight-coding-agents` 0.8.7 (and upstream `main` as of
 *   2026-11-13) builds its lifecycle hooks over `workspaceForAgent`, which returns
 *   `undefined` for `session.header.origin === "subagent"` — deliberate: a child is
 *   part of a conversation the parent already stores, so a second recall plus a
 *   fragment retain would pay twice for the same turns. The TOOL bodies reuse the
 *   same resolver though, so a subagent that calls `hindsight_search_pages` gets
 *   "Hindsight memory is disabled for this workspace." even when the bank is live.
 *   There is no config key that separates the two paths, and no released version
 *   that fixes it.
 *
 *   The smallest honest change is therefore one line in the tool body: bind the
 *   caller's bank by its `cwd` (`workspaceFor(workspaceRoot(exec.agent))`) instead
 *   of through the subagent-excluding resolver. The hooks keep the root-only
 *   resolver, so no new automatic recall and no duplicate retain appear.
 *
 * INPUTS
 *   --check    exit 0 when patched, 3 when the file is unpatched, 1 on an error
 *   --apply    patch in place (idempotent; keeps one .pre-subagent-tools backup)
 *   --revert   restore the backup
 *   --probe    load the installed plugin exactly as the harness does and call one
 *              hindsight tool with a SUBAGENT caller; exit 0 when real memory comes
 *              back, 1 when it answers "disabled for this workspace"
 *   --cwd <p>  workspace root the probe claims (default: the kit directory)
 *   --json     one JSON object on stdout
 *   --dist <p> override the plugin path (default: $HINDSIGHT_PLUGIN_DIST or
 *              ~/.hindsight/coding-agents/dist/dsh.js)
 *
 * OUTPUTS
 *   Human mode: `key: value` lines. JSON mode: { ok, path, state, sha256, error }.
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Plugin not installed: reported as `absent`, exit 0 (a machine without
 *     Hindsight is not a broken machine), and --apply writes nothing.
 *   - File patched twice / already patched: --apply is a no-op, exit 0.
 *   - Neither the original nor the patched line found (a new upstream version
 *     reformatted it): exit 1 with `unrecognized`, because guessing would be the
 *     silent edit this script exists to avoid.
 *   - A hindsight reinstall overwrites the file: --check goes back to 3, and the
 *     next kit boot re-applies it.
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ORIGINAL = 'const workspace = exec?.agent ? workspaceForAgent(exec.agent) : template;'
const PATCHED = 'const workspace = exec?.agent ? workspaceFor(workspaceRoot(exec.agent)) : template;'
const BACKUP_SUFFIX = '.pre-subagent-tools'

/** Filesystem path of the installed plugin the loader row points at. */
function distPath(argv) {
  const flag = argv.indexOf('--dist')
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1]
  return process.env.HINDSIGHT_PLUGIN_DIST ?? join(homedir(), '.hindsight', 'coding-agents', 'dist', 'dsh.js')
}

/** sha256 of a file, for the record an operator can compare after a reinstall. */
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Count non-overlapping occurrences without a regex (the text carries regex punctuation). */
function count(haystack, needle) {
  let n = 0
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n += 1
  return n
}

export function inspect(path) {
  if (!existsSync(path)) return { state: 'absent', path }
  const source = readFileSync(path, 'utf8')
  const patched = count(source, PATCHED)
  const original = count(source, ORIGINAL)
  // The hook resolver MUST stay in place: the patch is only correct while the
  // subagent-excluding `workspaceForAgent` still exists above the tool body.
  const hooksRootOnly = count(source, 'if (agent.session.header.origin === "subagent") return void 0;')
  if (patched === 1 && original === 0) return { state: 'patched', path, hooksRootOnly }
  if (original === 1 && patched === 0) return { state: 'unpatched', path, hooksRootOnly }
  return { state: 'unrecognized', path, patched, original, hooksRootOnly }
}

function apply(path) {
  const before = inspect(path)
  if (before.state !== 'unpatched') return before
  if (before.hooksRootOnly !== 1) {
    throw new Error(`refusing to patch: expected 1 root-only hook guard, found ${before.hooksRootOnly}`)
  }
  const backup = path + BACKUP_SUFFIX
  if (!existsSync(backup)) copyFileSync(path, backup)
  const source = readFileSync(path, 'utf8')
  const next = source.split(ORIGINAL).join(PATCHED)
  if (count(next, PATCHED) !== 1) throw new Error('patch produced an unexpected result; file left untouched')
  writeFileSync(path, next)
  return inspect(path)
}

function revert(path) {
  const backup = path + BACKUP_SUFFIX
  if (!existsSync(backup)) throw new Error(`no backup at ${backup}`)
  copyFileSync(backup, path)
  return inspect(path)
}

/**
 * Exercise the installed plugin's own tool bodies the way the harness does.
 *
 * The harness contract is `ctx.inject(["tools"], cb)` -> `tools.register(definition)` ->
 * `definition.execute(args, exec)` with `exec.agent` being the CALLING agent. A subagent
 * session carries `session.header.origin === "subagent"`, and that one field used to be
 * enough for the tool body to answer "Hindsight memory is disabled for this workspace."
 * This probe therefore reproduces the caller's shape, not the network: the bank read is
 * whatever the installed plugin does with it.
 *
 * @param path - installed plugin file.
 * @param cwd - workspace root the probe claims.
 * @returns 0 when a tool returned content, 1 when it returned the disabled answer or threw.
 */
async function probe(path, cwd) {
  const registered = []
  const module = await import(pathToFileURL(path).href)
  module.apply({
    on() {},
    inject(_names, callback) {
      callback({ tools: { register: (definition) => registered.push(definition), schemas: () => registered.map((d) => ({ name: d.name })) } })
    },
  })
  const tool = registered.find((definition) => definition.name === 'hindsight_list_pages')
    ?? registered.find((definition) => typeof definition.name === 'string' && definition.name.startsWith('hindsight_'))
  console.log(`registered: ${registered.length} tool(s)`)
  if (tool === undefined) {
    console.log('probe: the plugin registered no hindsight tool, so memory is off for this process')
    return 1
  }
  const exec = { agent: { session: { header: { id: 'probe', origin: 'subagent', cwd } } } }
  let text
  try {
    text = String(await tool.execute({}, exec))
  } catch (error) {
    console.log(`probe: ${tool.name} threw — ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  console.log(`probe: ${tool.name} as a subagent returned ${text.length} char(s): ${text.slice(0, 160).replace(/\n/g, ' ')}`)
  if (text.includes('Hindsight memory is disabled for this workspace')) {
    console.log('probe: FAILED — a subagent still gets the disabled answer')
    return 1
  }
  console.log('probe: OK — the subagent read its own workspace bank')
  return 0
}

async function main(argv) {
  const json = argv.includes('--json')
  const path = distPath(argv)
  const report = (fields) => {
    if (json) process.stdout.write(`${JSON.stringify({ ok: true, ...fields })}\n`)
    else for (const [key, value] of Object.entries(fields)) if (value !== undefined) console.log(`${key}: ${value}`)
  }
  try {
    if (argv.includes('--revert')) {
      const state = revert(path)
      report({ ...state, sha256: sha256(path), action: 'revert' })
      return 0
    }
    if (argv.includes('--probe')) {
      const at = argv.indexOf('--cwd')
      const cwd = at !== -1 && argv[at + 1] ? argv[at + 1] : process.cwd()
      return await probe(path, cwd)
    }
    const state = argv.includes('--apply') ? apply(path) : inspect(path)
    const fields = {
      ...state,
      sha256: existsSync(path) ? sha256(path) : undefined,
      bytes: existsSync(path) ? statSync(path).size : undefined,
      action: argv.includes('--apply') ? 'apply' : 'check',
    }
    report(fields)
    if (state.state === 'absent') return 0
    if (state.state === 'patched') return 0
    if (state.state === 'unpatched') return 3
    return 1
  } catch (error) {
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, path, error: String(error?.message ?? error) })}\n`)
    else console.error(`hindsight-subagent-tools: ${error?.message ?? error}`)
    return 1
  }
}

// `pathToFileURL`, not a hand-built URL string: the kit's portability gate bans that literal
// form (its POSIX and Windows shapes differ, and only one of them was ever executed).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
