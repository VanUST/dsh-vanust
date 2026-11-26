#!/usr/bin/env node
/**
 * PURPOSE
 *   FR6: one entry to the checks that RUN the kit instead of reading it. `make verify` reads the
 *   tree (paths, packaging, documentation, schema bytes, session headers); nothing ran the 51
 *   plugin test files or the proof scripts, so "the checks pass" never meant "the behaviour
 *   works". This runs both groups, in a fixed order, and stops at the first failure.
 *
 * WHAT IT RUNS
 *   every .test.mjs file in a plugin's test directory, through `node --test`, one file per process
 *   every .test.mjs file in scripts/test, the same way
 *   every .test.mjs file under tests/, recursively, the same way: the acceptance tests written by
 *   the seat that did not implement the change, kept in their own group so the summary names them
 *   apart from the plugin tests
 *   every -proof.mjs script in scripts, through `node`, one script per process
 *
 *   Node's own runner takes an explicit path as its final argument and runs exactly that file
 *   (nodejs.org/docs/latest-v24.x/api/test.html, "Running tests from the command line"); the
 *   default discovery across every test directory is deliberately not used, because such a
 *   directory also holds helpers that are not tests. A plugin test is a node:test file whose PROOF header names
 *   the behaviour it protects; a proof script is a standalone program printing its own
 *   PASS/FAIL lines. Both signal success with the process exit code, the only signal read here.
 *
 * ORDER AND STOPPING
 *   Plugin tests, then scripts/test, then the acceptance tests, then the proofs, each group in
 *   path order. The first non-zero exit stops the run and this script exits 1 with the file, its
 *   exit code and how many steps never ran: continuing after a failure would print a green tail
 *   over a red head. A missing or empty tests/ directory is refused, not skipped: the acceptance
 *   group is part of the gate, and a group that silently disappears stops protecting anything.
 *
 * INPUTS
 *   --only <substring>   run only the files whose kit-relative path contains <substring>
 *   --list               print what would run and run nothing
 *   --timeout <ms>       per-file budget (default 600000); a timed-out file counts as a failure
 *
 * OUTPUTS
 *   One line per file (`ok`/`FAIL` with milliseconds), the file's own output passed through, a
 *   summary line naming the plugin test files, the acceptance test files and the proof scripts
 *   separately, exit 0 when every selected file passed and 1 on the first failure. An empty
 *   selection — no file discovered, or --only matching nothing — is refused with its reason and
 *   exit 1: a runner that reports success over zero files is the defect this file replaces.
 */

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const value = (name) => {
  const at = argv.indexOf(name)
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : ''
}
const only = value('--only')
const timeoutArg = Number(value('--timeout') || 600000)
const timeoutMs = Number.isFinite(timeoutArg) && timeoutArg > 0 ? timeoutArg : 600000

/** Plugin test files, kit-relative, in path order. */
export function testFiles() {
  const files = []
  let plugins = []
  try {
    plugins = readdirSync(join(KIT, 'plugins'), { withFileTypes: true }).filter((entry) => entry.isDirectory())
  } catch {
    return files
  }
  for (const entry of plugins.sort((a, b) => a.name.localeCompare(b.name))) {
    let names = []
    try {
      names = readdirSync(join(KIT, 'plugins', entry.name, 'test')).filter((name) => name.endsWith('.test.mjs'))
    } catch {
      continue
    }
    for (const name of names.sort()) files.push(join('plugins', entry.name, 'test', name))
  }
  return files
}

/**
 * Test files under scripts/test, kit-relative, in path order.
 *
 * They are included although the reviewer's brief named only the plugin tests and the proofs: a
 * test file that no target runs is the gap this target exists to close, and `scripts/test` holds a
 * committed node:test file the plugin glob never reaches.
 */
export function scriptTestFiles() {
  try {
    return readdirSync(join(KIT, 'scripts', 'test'))
      .filter((name) => name.endsWith('.test.mjs'))
      .sort()
      .map((name) => join('scripts', 'test', name))
  } catch {
    return []
  }
}

/**
 * Acceptance test files under tests/, kit-relative, in path order.
 *
 * Recursive: an acceptance seat names its own subdirectory (tests/<area>/<behaviour>.test.mjs).
 * A missing or empty directory is not swallowed here - {@link steps} computes the group and the
 * caller refuses an empty one, because a group that quietly disappears is the defect this runner
 * exists to catch.
 */
export function acceptanceTestFiles() {
  const found = []
  const walk = (relative) => {
    let entries = []
    try {
      entries = readdirSync(join(KIT, relative), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(relative, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) found.push(child)
    }
  }
  walk('tests')
  return found.sort()
}

/** Proof scripts, kit-relative, in path order. */
export function proofFiles() {
  try {
    return readdirSync(join(KIT, 'scripts'))
      .filter((name) => name.endsWith('-proof.mjs'))
      .sort()
      .map((name) => join('scripts', name))
  } catch {
    return []
  }
}

/** Every step in run order, with the arguments the child node process receives. */
export function steps() {
  return [
    ...testFiles().map((file) => ({ kind: 'test', file, args: ['--test', file] })),
    ...scriptTestFiles().map((file) => ({ kind: 'test', file, args: ['--test', file] })),
    ...acceptanceTestFiles().map((file) => ({ kind: 'acceptance', file, args: ['--test', file] })),
    ...proofFiles().map((file) => ({ kind: 'proof', file, args: [file] })),
  ]
}

const all = steps()
const acceptance = all.filter((step) => step.kind === 'acceptance')
// A group that disappears must fail the gate, not shrink it: an empty tests/ means the seat that
// writes acceptance tests has no seat in the gate any more.
if (acceptance.length === 0) {
  console.log(`refused: no tests/**/*.test.mjs under ${KIT}: the acceptance group is part of the gate, and a missing or empty tests/ directory is a failure, not a skip`)
  process.exit(1)
}
const selected = only === '' ? all : all.filter((step) => step.file.includes(only))

if (argv.includes('--list')) {
  for (const step of selected) console.log(`${step.kind.padEnd(5)} ${step.file}`)
  console.log(`\n${selected.length} of ${all.length} step(s) selected`)
  process.exit(0)
}

if (selected.length === 0) {
  const reason = only === ''
    ? `no plugins/*/test/*.test.mjs, no scripts/*-proof.mjs and no tests/**/*.test.mjs under ${KIT}: there is nothing to run, and "0 failed" over zero files is not a pass`
    : `no test file or proof script matches --only "${only}" among ${all.length} step(s); the filter selected nothing, so nothing was verified`
  console.log(`refused: ${reason}`)
  process.exit(1)
}

const started = Date.now()
let passed = 0
for (const [index, step] of selected.entries()) {
  process.stdout.write(`\n[${index + 1}/${selected.length}] ${step.kind}: ${step.file}\n`)
  const at = Date.now()
  const result = spawnSync(process.execPath, step.args, { cwd: KIT, stdio: ['ignore', 'inherit', 'inherit'], timeout: timeoutMs })
  const ms = Date.now() - at
  const failure = result.error !== undefined && result.error !== null
    ? (result.error.code === 'ETIMEDOUT' ? `timed out after ${timeoutMs} ms` : String(result.error))
    : (result.status === 0 ? '' : `exit ${result.status ?? result.signal}`)
  if (failure !== '') {
    console.log(`\nFAIL ${step.file} (${failure}, ${ms} ms); stopped after ${index + 1} of ${selected.length} step(s), ${selected.length - index - 1} never ran`)
    process.exit(1)
  }
  console.log(`ok ${step.file} (${ms} ms)`)
  passed += 1
}

const countOf = (kind) => selected.filter((step) => step.kind === kind).length
console.log(`\n${passed}/${selected.length} passed (${countOf('test')} plugin test file(s), ${countOf('acceptance')} acceptance test file(s), ${countOf('proof')} proof script(s)) in ${Date.now() - started} ms`)
process.exit(0)
