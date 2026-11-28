#!/usr/bin/env node
/**
 * PURPOSE
 *   Resolve a conflicted `state/` merge between two machines, from git, with an explicit report.
 *   The project ledger is one ledger: when `git pull` stops on `state/`, an agent runs this
 *   command and the machine's rows and the remote rows both survive — numbered apart where two
 *   rows claimed one number, merged where one row was known under two numbers, with the journal
 *   unioned and `seq` reassigned.
 *
 * INPUTS
 *   --cwd <dir>      workspace (default: the current directory)
 *   --ours <ref>     ours side (default HEAD during a merge)
 *   --theirs <ref>   theirs side (default MERGE_HEAD during a merge)
 *   --base <ref>     base side (default: merge-base of the two)
 *   --check          compute and print the report; write nothing; exit 1 when state/ is conflicted
 *   --json           print one JSON object instead of the summary
 *   --report <path>  write the JSON report there (default .dsh/state-merge-report.json)
 *   --no-report      do not write the report file
 *   --no-stage       write the files but do not `git add` them
 *   --commit         finish the merge when nothing outside state/ is unmerged
 *   --message <text> the commit message used with --commit
 *
 * OUTPUTS
 *   The report lists every collision it resolved: rows renumbered because two records shared a
 *   number, rows merged because one record had two numbers, rows edited on both sides with the
 *   side that was kept. Exit 0 when the state is coherent, 1 when something still needs the
 *   human (a conflict outside state/, or replay refusing the result), 2 on a hard error.
 *
 * WHAT IT DOES NOT DO
 *   It never resolves a conflict outside `state/` and never picks a side for a row's MEANING:
 *   two different edits to one row keep the later `updatedAt` and are reported, not merged.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ENTITY_PATH_RE, JOURNAL_PATH, mergeStates } from '../plugins/project-state/lib/merge.mjs'
import { createStateService } from '../plugins/project-state/lib/core.mjs'

const args = process.argv.slice(2)
const has = (name) => args.includes(name)
const arg = (name) => {
  const index = args.indexOf(name)
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined
}
const cwd = resolve(arg('--cwd') ?? process.cwd())
const checkOnly = has('--check')
const json = has('--json')

const git = (argv, options = {}) => spawnSync('git', ['-C', cwd, ...argv], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...options })
const fail = (message, code = 2) => {
  console.error(`state-merge: ${message}`)
  process.exit(code)
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** The state files of one ref, as a Map path -> text; the blobs are read in one `cat-file` batch. */
function readRef(ref) {
  const listed = git(['ls-tree', '-r', '-z', '--full-tree', ref, '--', 'state'])
  if (listed.status !== 0) fail(`git ls-tree ${ref} failed: ${String(listed.stderr).trim()}`)
  const blobs = []
  for (const entry of String(listed.stdout).split('\0')) {
    if (entry === '') continue
    const tab = entry.indexOf('\t')
    const meta = entry.slice(0, tab).split(' ')
    const path = entry.slice(tab + 1)
    if (meta[1] !== 'blob') continue
    if (path !== JOURNAL_PATH && ENTITY_PATH_RE.exec(path) === null) continue
    blobs.push({ oid: meta[2], path })
  }
  const files = new Map()
  if (blobs.length === 0) return files
  const batch = spawnSync('git', ['-C', cwd, 'cat-file', '--batch'], { input: `${blobs.map((blob) => blob.oid).join('\n')}\n`, maxBuffer: 512 * 1024 * 1024 })
  if (batch.status !== 0) fail(`git cat-file --batch failed: ${String(batch.stderr).trim()}`)
  const buffer = batch.stdout
  let at = 0
  for (const blob of blobs) {
    const newline = buffer.indexOf(10, at)
    if (newline < 0) fail(`git cat-file --batch: truncated header for ${blob.path}`)
    const [, type, size] = buffer.slice(at, newline).toString('utf8').split(' ')
    if (type !== 'blob') fail(`git cat-file --batch: ${blob.path} is a ${type}, not a blob`)
    const start = newline + 1
    files.set(blob.path, buffer.slice(start, start + Number(size)).toString('utf8'))
    at = start + Number(size) + 1
  }
  return files
}

/** The lock the state core itself takes, so a live session cannot write mid-resolution. */
async function withStateLock(fn) {
  const root = join(cwd, 'state')
  mkdirSync(root, { recursive: true })
  const lock = join(root, '.lock')
  const started = Date.now()
  for (;;) {
    try {
      mkdirSync(lock)
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let stale = false
      try {
        stale = Date.now() - statSync(lock).mtimeMs > 10000
      } catch {
        continue
      }
      if (stale) {
        rmSync(lock, { recursive: true, force: true })
        continue
      }
      if (Date.now() - started > 10000) fail(`state lock busy: ${lock}; a session is writing state right now, retry`)
      sleep(20)
    }
  }
  try {
    return await fn()
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}

/** Unmerged paths, optionally limited to state/. */
function unmerged(scope) {
  const result = git(['diff', '--name-only', '--diff-filter=U', ...(scope === undefined ? [] : ['--', scope])])
  if (result.status !== 0) return []
  return String(result.stdout).split('\n').filter((line) => line.trim() !== '')
}

const explicitOurs = arg('--ours')
const explicitTheirs = arg('--theirs')
const inMerge = git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']).status === 0
if (explicitOurs === undefined && explicitTheirs === undefined && !inMerge) {
  console.log('state-merge: no merge in progress; pass --ours <ref> --theirs <ref> to merge two refs')
  process.exit(0)
}
if ((explicitOurs === undefined) !== (explicitTheirs === undefined)) fail('--ours and --theirs are given together')
const oursRef = explicitOurs ?? 'HEAD'
const theirsRef = explicitTheirs ?? 'MERGE_HEAD'
let baseRef = arg('--base')
if (baseRef === undefined) {
  const base = git(['merge-base', oursRef, theirsRef])
  baseRef = base.status === 0 ? String(base.stdout).trim() : ''
}

const merged = mergeStates({ base: baseRef === '' ? new Map() : readRef(baseRef), ours: readRef(oursRef), theirs: readRef(theirsRef) })
if (merged.ok === false) fail(`${merged.code}: ${merged.message}`)
const { report, entities, events } = merged

function printReport() {
  console.log(`state-merge: ${oursRef} <- ${theirsRef}${baseRef === '' ? ' (no base)' : ` (base ${baseRef.slice(0, 7)})`}`)
  console.log(`  rows: ${entities.length}; events: ours ${report.events.ours}, theirs ${report.events.theirs}, duplicates dropped ${report.events.duplicates}, synthetic ${report.events.synthetic}, total ${report.events.total}`)
  if (report.renamed.length > 0) {
    console.log('  renumbered (two records claimed one number):')
    for (const entry of report.renamed) console.log(`    ${entry.from} -> ${entry.to}  ${entry.kind} "${entry.title}"  (the number stays with "${entry.keptBy}")`)
  }
  if (report.aliased.length > 0) {
    console.log('  merged by identity (one record under two numbers):')
    for (const entry of report.aliased) console.log(`    ${entry.from} -> ${entry.to}  ${entry.kind} "${entry.title}"  (${entry.identity})`)
  }
  if (report.editedBothSides.length > 0) {
    console.log('  edited on both sides (later updatedAt kept):')
    for (const entry of report.editedBothSides) console.log(`    ${entry.id}  ${entry.kind} "${entry.title}"  kept ${entry.kept} rev ${entry.keptRevision} at ${entry.keptAt}; dropped rev ${entry.droppedRevision} at ${entry.droppedAt}`)
  }
  if (report.keptDeleted.length > 0) {
    console.log('  deleted on one side, kept in the ledger:')
    for (const entry of report.keptDeleted) console.log(`    ${entry.id}  ${entry.kind} "${entry.title}"  (missing from ${entry.missingFrom})`)
  }
  console.log(`  link hashes recomputed: ${report.linksRehashed}`)
  if (report.clean) console.log('  no collisions')
}

/** Write the merged state and regenerate the projections; called under the state lock. */
async function applyState() {
  const stateDir = join(cwd, 'state')
  mkdirSync(stateDir, { recursive: true })
  const wanted = new Set()
  for (const entity of entities) {
    const rel = `state/${entity.kind}/${entity.id}.md`
    wanted.add(rel)
    const target = join(cwd, rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entity.text, 'utf8')
  }
  for (const dir of ['req', 'task', 'test', 'decision']) {
    let names = []
    try {
      names = readdirSync(join(stateDir, dir))
    } catch {
      names = []
    }
    for (const name of names) {
      if (!name.endsWith('.md')) continue
      const rel = `state/${dir}/${name}`
      if (!wanted.has(rel)) rmSync(join(cwd, rel), { force: true })
    }
  }
  const lines = events.map((event) => (event?.malformed === undefined ? JSON.stringify(event) : String(event.malformed)))
  writeFileSync(join(cwd, JOURNAL_PATH), lines.length === 0 ? '' : `${lines.join('\n')}\n`, 'utf8')
  const service = createStateService({ cwd })
  const views = await service.regenerateViews()
  if (views?.ok === false) fail(`views: ${views.code}: ${views.message}`)
  return service
}

if (checkOnly) {
  printReport()
  const conflicted = unmerged('state')
  console.log(conflicted.length === 0 ? 'state-merge: state/ is not conflicted' : `state-merge: ${conflicted.length} unmerged path(s) under state/ need this command`)
  process.exit(conflicted.length === 0 ? 0 : 1)
}

const service = await withStateLock(() => applyState())
const verify = await service.verify()
const replay = await service.replay()
const findings = Array.isArray(verify?.findings) ? verify.findings : []
const codes = {}
for (const finding of findings) codes[finding.code] = (codes[finding.code] ?? 0) + 1

if (!has('--no-stage')) {
  const staged = git(['add', '-A', '--', 'state'])
  if (staged.status !== 0) fail(`git add state/ failed: ${String(staged.stderr).trim()}`)
}
if (!has('--no-report')) {
  const reportPath = resolve(cwd, arg('--report') ?? join('.dsh', 'state-merge-report.json'))
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify({ ...report, verify: { ok: verify?.ok ?? null, findings: codes }, replay: { ok: replay?.ok ?? null, mismatches: replay?.mismatches?.length ?? null } }, null, 2)}\n`, 'utf8')
}
const result = { ok: replay?.ok === true, report, verify: { ok: verify?.ok ?? null, findings: codes }, replay: { ok: replay?.ok ?? null, mismatches: replay?.mismatches ?? [] }, committed: false, unmerged: [] }
if (!json) {
  printReport()
  console.log(`  verify: ${verify?.ok === true ? 'ok' : `${findings.length} finding(s) ${JSON.stringify(codes)}`}; replay: ${replay?.ok === true ? 'ok' : 'FAILED'}`)
}
if (replay?.ok !== true) {
  result.unmerged = unmerged()
  if (json) console.log(JSON.stringify(result))
  fail(`replay does not match the merged files: ${JSON.stringify(replay?.mismatches?.slice(0, 3) ?? [])}`, 1)
}

let left = unmerged()
if (has('--commit')) {
  if (left.length > 0) {
    if (json) console.log(JSON.stringify({ ...result, unmerged: left }))
    else console.error(`state-merge: state/ is resolved, but ${left.length} path(s) outside state/ still conflict: ${left.slice(0, 5).join(', ')}; resolve them, then git commit`)
    process.exit(1)
  }
  const message = arg('--message') ?? `Resolve the project state: ${report.renamed.length} renumbered, ${report.aliased.length} merged by identity, ${report.editedBothSides.length} edited on both sides`
  const commit = git(['commit', '-m', message])
  if (commit.status !== 0) fail(`git commit failed: ${String(commit.stderr).trim() || String(commit.stdout).trim()}`)
  result.committed = true
  left = unmerged()
}
result.unmerged = left
if (json) console.log(JSON.stringify(result))
else console.log(left.length === 0 ? 'state-merge: resolved and staged; finish the merge with git commit' : `state-merge: state/ is resolved and staged; ${left.length} path(s) outside state/ still conflict`)
process.exit(left.length === 0 ? 0 : 1)
