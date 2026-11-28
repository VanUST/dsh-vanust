/*
PROOF: an npm shim on Windows is found through PATHEXT and started through cmd.exe, so the
  `outline` tool answers instead of reporting `outline unavailable`
Behavior: executableOnPath() completes a bare name with PATHEXT and returns the .cmd path;
  resolveOutlineBin() probes that shim through cmd.exe and returns it; buildOutlineResult()
  delivers `outline <path> --depth N` to the shim with the path still one argument (spaces,
  `&`, parentheses); a search path without the shim yields null and a call without a resolver
  yields NO_BIN.
Fails when: resolution still looks only for .exe and misses the npm shim, the .cmd is spawned
  without a shell (EINVAL) or through `shell: true` (DEP0190: the arguments are concatenated,
  not escaped, so the shim path and the path split at the space and at `&`), an argument
  reaches the command line unquoted, or a missing shim is reported as a working one.
Production path: plugins/outline/outline.mjs - executableOnPath, spawnPlan, escapeCmdArgument,
  probeOutlineBin, runOutline, resolveOutlineBin, buildOutlineResult.
Control: CASE_NEGATIVE_CONTROL=expect-pre-fix makes the pre-fix resolution the expectation,
  which the fixed resolver fails - the check can go red.
*/

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as plugin from '../outline.mjs'

const { OutlineError, buildOutlineResult, executableOnPath, resolveOutlineBin } = plugin
/** The plan builder; read off the namespace so a missing export fails one test, not the load. */
const spawnPlan = plugin.spawnPlan

const control = process.env.CASE_NEGATIVE_CONTROL ?? ''
const NAME = 'code-skeleton-mcp'
const onWindows = process.platform === 'win32'
const scratch = mkdtempSync(join(tmpdir(), 'outline-shim-'))

after(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/**
 * A directory holding a fake npm shim: `code-skeleton-mcp.cmd` that forwards its arguments
 * to node with a stub, exactly as npm's generated shim forwards with `%*`. The stub records
 * the argument vector it received and prints an outline, so the test sees both what arrived
 * and whether the call produced a usable answer.
 */
function shimDir(name = 'shim') {
  const dir = join(scratch, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'stub.mjs'),
    [
      "import { writeFileSync } from 'node:fs'",
      "import { dirname, join } from 'node:path'",
      "import { fileURLToPath } from 'node:url'",
      'const argv = process.argv.slice(2)',
      "writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'argv.json'), JSON.stringify(argv))",
      "process.stdout.write(JSON.stringify({ path: argv[1] ?? '', language: 'javascript', symbols: [] }) + '\\n')",
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(dir, `${NAME}.cmd`),
    ['@ECHO off', `"${process.execPath}" "%~dp0stub.mjs" %*`, 'EXIT /b %ERRORLEVEL%', ''].join('\r\n'),
  )
  return dir
}

/** The argument vector the stub last received. */
function received(dir) {
  return JSON.parse(readFileSync(join(dir, 'argv.json'), 'utf8'))
}

test('negative control: the pre-fix resolver misses the .cmd shim', () => {
  if (control !== 'expect-pre-fix') return
  const dir = shimDir('control')
  assert.equal(executableOnPath(NAME, dir), null)
})

test('the control value is the one this driver knows', () => {
  if (control === '') return
  assert.equal(control, 'expect-pre-fix')
})

test('PATHEXT completes a bare name to the .cmd shim', { skip: !onWindows }, () => {
  const dir = shimDir('pathext')
  assert.equal(executableOnPath(NAME, dir), join(dir, `${NAME}.cmd`))
})

test('an .exe is started directly, a .cmd through cmd.exe', { skip: !onWindows }, () => {
  assert.equal(typeof spawnPlan, 'function', 'spawnPlan is exported')
  const exe = spawnPlan('C:\\tools\\code-skeleton-mcp.exe', ['outline', 'a.mjs'])
  assert.equal(exe.command, 'C:\\tools\\code-skeleton-mcp.exe')
  assert.deepEqual(exe.argv, ['outline', 'a.mjs'])
  assert.deepEqual(exe.options, {})

  const batch = spawnPlan('C:\\tools\\code-skeleton-mcp.cmd', ['outline', 'a.mjs'])
  assert.match(batch.command, /cmd\.exe$/i)
  assert.equal(batch.options.windowsVerbatimArguments, true)
  assert.equal(batch.argv[0], '/d')
  assert.equal(batch.argv[1], '/s')
  assert.equal(batch.argv[2], '/c')
  assert.match(batch.argv[3], /"C:\\tools\\code-skeleton-mcp\.cmd" "outline" "a\.mjs"/)
})

test('the resolved shim is probed and the call delivers the path as one argument', { skip: !onWindows }, async () => {
  const dir = shimDir('resolve')
  const installed = resolveOutlineBin({ bin: NAME, path: dir })
  assert.notEqual(installed, null)
  assert.equal(installed.bin, join(dir, `${NAME}.cmd`))

  mkdirSync(join(scratch, 'a b & c (d)'), { recursive: true })
  const target = join(scratch, 'a b & c (d)', 'edge.mjs')
  writeFileSync(target, 'export const edge = 1\n')
  const outline = await buildOutlineResult({ path: target, depth: 2 }, { bin: installed.bin })
  assert.deepEqual(outline.symbols, [])
  assert.equal(outline.path, target)
  assert.deepEqual(received(dir), ['outline', target, '--depth', '2'])
})

test('a search path without the shim is a named refusal, not a working tool', { skip: !onWindows }, () => {
  const empty = join(scratch, 'empty')
  mkdirSync(empty, { recursive: true })
  assert.equal(executableOnPath(NAME, empty), null)
  assert.equal(resolveOutlineBin({ bin: NAME, path: empty }), null)

  const saved = process.env.PATH
  try {
    process.env.PATH = empty
    assert.equal(resolveOutlineBin({ bin: '' }), null)
  } finally {
    process.env.PATH = saved
  }
})

test('the default bin comes from PATH and a call without a binary says NO_BIN', { skip: !onWindows }, async () => {
  const dir = shimDir('defaultpath')
  const saved = process.env.PATH
  try {
    process.env.PATH = dir
    const installed = resolveOutlineBin({ bin: '' })
    assert.equal(installed?.bin, join(dir, `${NAME}.cmd`))
  } finally {
    process.env.PATH = saved
  }
  await assert.rejects(
    () => buildOutlineResult({ path: 'x.mjs' }, { bin: '' }),
    (error) => error instanceof OutlineError && error.code === 'NO_BIN',
  )
})
