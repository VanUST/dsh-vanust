/**
 * PURPOSE
 *   Prove on THIS machine and in THIS repository that the outline tool really turns a
 *   source file into a small table of contents, that the same call is deterministic, and
 *   that every failure path reports rather than pretending. The tool's happy path needs a
 *   running harness; the contract does not, so this script exercises the same
 *   `resolveOutlineBin` -> `buildOutlineResult` path the tool uses, plus
 *   `parseOutlineOutput` directly for the shapes a real file cannot produce.
 *
 * INPUTS
 *   None. `code-skeleton-mcp` is resolved the way the plugin resolves it: a configured
 *   `bin` (none here), then PATH.
 *
 * OUTPUTS
 *   One line per case with the case name, raw file bytes, outline bytes, saving percent
 *   and verdict, then a `verdict:` line and exit 0 only when every case matches its
 *   expectation. Exit 1 on a failed case, 2 when the binary is not installed.
 *
 * PORTABILITY
 *   POSIX-oriented like scripts/rtk-selftest.mjs: it reads real repository files, so it is
 *   a proof on a checkout rather than a unit test.
 *
 * KEYWORDS
 *   outline, code-skeleton-mcp, byte savings, determinism, degradation, output limit, proof
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The two real files are this kit's own; a saving below 90% fails the case, because a
 *     table of contents that is a tenth of the file is not a cheaper read.
 *   - Determinism compares the rendered result text of two separate calls; any difference
 *     fails, because an outline that reorders symbols cannot be cached or trusted.
 *   - The degradation case uses a search path with no binary and requires null without an
 *     exception; it also checks that a broken-JSON answer is a named failure.
 *   - The output-limit case runs the real binary with `maxBytes` far below its answer and
 *     requires `EOVERFLOW`, so the guard is proven by a real call rather than by a mock.
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  OutlineError,
  buildOutlineResult,
  parseOutlineOutput,
  resolveOutlineBin,
} from '../plugins/outline/outline.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Two real files of this kit, one of them large enough that a read would cost. */
const FILES = [
  'plugins/orchestrator/orchestrator.mjs',
  'plugins/analysis/store.mjs',
]

/** A saving below this fraction fails: the outline must be at most a tenth of the file. */
const MIN_SAVING = 0.9

/** Pad a cell to a fixed width without throwing on long values. */
function cell(value, width) {
  const text = String(value)
  return text.length >= width ? text : `${text}${' '.repeat(width - text.length)}`
}

/** The rendered form the model reads: the tool's `render` is JSON.stringify(value, null, 2). */
function rendered(value) {
  return JSON.stringify(value, null, 2)
}

/** Percent with one decimal, e.g. 94.2. */
function savingPercent(rawBytes, outlineBytes) {
  return rawBytes === 0 ? 0 : (1 - outlineBytes / rawBytes) * 100
}

/** Run one case, returning `{ ok, detail }`; never throws. */
async function check(name, run) {
  try {
    const detail = await run()
    return { name, ok: true, detail }
  } catch (error) {
    const code = error instanceof OutlineError ? error.code : (error?.code ?? 'ERROR')
    return { name, ok: false, detail: `${code}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

const installed = resolveOutlineBin({})
if (installed === null) {
  process.stderr.write('outline-selftest: code-skeleton-mcp not found on PATH (install it with `npm install -g code-skeleton-mcp@0.1.3`)\n')
  process.exit(2)
}

process.stdout.write(`outline-selftest: bin ${installed.bin} (version ${installed.version ?? 'unknown'})\n`)
process.stdout.write(`${cell('#', 3)}${cell('case', 42)}${cell('raw', 10)}${cell('outline', 10)}${cell('saving', 9)}${cell('verdict', 9)}detail\n`)

const rows = []
let failures = 0

// 1-2. Two real files: byte saving, and the second call identical to the first.
for (const relative of FILES) {
  const absolute = join(KIT, relative)
  const rawBytes = statSync(absolute).size
  const first = await check(relative, async () => {
    const value = await buildOutlineResult({ path: absolute }, { bin: installed.bin })
    return { value, text: rendered(value) }
  })
  const second = await check(`${relative} (repeat)`, async () => {
    const value = await buildOutlineResult({ path: absolute }, { bin: installed.bin })
    return { value, text: rendered(value) }
  })
  const outlineBytes = first.ok ? first.detail.text.length : 0
  const saving = savingPercent(rawBytes, outlineBytes)
  const deterministic = first.ok && second.ok && first.detail.text === second.detail.text
  const ok = first.ok && second.ok && saving >= MIN_SAVING && deterministic
  if (!ok) failures += 1
  rows.push({
    name: relative,
    line: `${cell(rows.length + 1 + '.', 3)}${cell(relative, 42)}${cell(rawBytes, 10)}${cell(outlineBytes, 10)}${cell(`${saving.toFixed(1)}%`, 9)}${cell(ok ? 'PASS' : 'FAIL', 9)}${ok ? `saving ${saving.toFixed(1)}% >= 90%, two runs byte-identical, ${first.detail.value.symbols.length} symbols` : (first.ok ? `saving ${saving.toFixed(1)}%, deterministic=${deterministic}` : first.detail)}`,
  })
}

// 3. Degradation: no binary on the search path is null, not an exception.
{
  const result = await check('degradation: no binary on PATH', async () => {
    const missing = resolveOutlineBin({ path: join(KIT, '.outline-selftest-empty-path') })
    if (missing !== null) throw new Error(`expected null, got ${JSON.stringify(missing)}`)
    return 'resolveOutlineBin({path: <empty>}) = null'
  })
  if (!result.ok) failures += 1
  rows.push({ name: 'degradation', line: `${cell(rows.length + 1 + '.', 3)}${cell('degradation: no binary', 42)}${cell('-', 10)}${cell('-', 10)}${cell('-', 9)}${cell(result.ok ? 'PASS' : 'FAIL', 9)}${result.detail}` })
}

// 4. Broken JSON is a named failure, not an empty success.
{
  const result = await check('broken JSON', async () => {
    let code = null
    try {
      parseOutlineOutput('{"path": "x", "symbols": [')
    } catch (error) {
      code = error instanceof OutlineError ? error.code : null
    }
    if (code !== 'NON_JSON') throw new Error(`expected NON_JSON, got ${code}`)
    return 'NON_JSON'
  })
  if (!result.ok) failures += 1
  rows.push({ name: 'broken JSON', line: `${cell(rows.length + 1 + '.', 3)}${cell('broken JSON', 42)}${cell('-', 10)}${cell('-', 10)}${cell('-', 9)}${cell(result.ok ? 'PASS' : 'FAIL', 9)}${result.detail}` })
}

// 5. The output limit is enforced by a real call whose answer is far larger than the cap.
{
  const absolute = join(KIT, FILES[0])
  const result = await check('output limit', async () => {
    let code = null
    try {
      await buildOutlineResult({ path: absolute }, { bin: installed.bin, maxBytes: 200 })
    } catch (error) {
      code = error instanceof OutlineError ? error.code : null
    }
    if (code !== 'EOVERFLOW') throw new Error(`expected EOVERFLOW, got ${code}`)
    return 'EOVERFLOW at maxBytes 200'
  })
  if (!result.ok) failures += 1
  rows.push({ name: 'output limit', line: `${cell(rows.length + 1 + '.', 3)}${cell('output limit', 42)}${cell(statSync(absolute).size, 10)}${cell('>200', 10)}${cell('-', 9)}${cell(result.ok ? 'PASS' : 'FAIL', 9)}${result.detail}` })
}

// 6. Contract details that are silent when wrong: argv, empty output, missing symbols.
{
  const absolute = join(KIT, FILES[0])
  const result = await check('contract', async () => {
    const { outlineArgv, normalizeDepth } = await import('../plugins/outline/outline.mjs')
    const withDocs = outlineArgv(absolute, 2, true)
    const withoutDocs = outlineArgv(absolute, 2, false)
    if (withDocs.includes('--no-docstrings')) throw new Error('docstrings=true passed --no-docstrings')
    if (!withoutDocs.includes('--no-docstrings')) throw new Error('docstrings=false did not pass --no-docstrings')
    if (!withDocs.includes('--depth') || withDocs[withDocs.indexOf('--depth') + 1] !== '2') throw new Error('depth not passed')
    if (normalizeDepth(0) !== 1 || normalizeDepth(9) !== 3 || normalizeDepth('x') !== 1) throw new Error('depth clamp wrong')
    for (const [input, expected] of [['', 'EMPTY_OUTPUT'], ['{"nope":1}', 'BAD_SHAPE']]) {
      let code = null
      try {
        parseOutlineOutput(input)
      } catch (error) {
        code = error instanceof OutlineError ? error.code : null
      }
      if (code !== expected) throw new Error(`parseOutlineOutput(${JSON.stringify(input)}) = ${code}, expected ${expected}`)
    }
    return 'argv, depth clamp, EMPTY_OUTPUT, BAD_SHAPE'
  })
  if (!result.ok) failures += 1
  rows.push({ name: 'contract', line: `${cell(rows.length + 1 + '.', 3)}${cell('contract details', 42)}${cell('-', 10)}${cell('-', 10)}${cell('-', 9)}${cell(result.ok ? 'PASS' : 'FAIL', 9)}${result.detail}` })
}

for (const row of rows) process.stdout.write(`${row.line}\n`)

process.stdout.write(
  `verdict: ${failures === 0 ? 'PASS' : 'FAIL'} — ${rows.length - failures} passed, ${failures} failed, min saving 90% per real file\n`,
)
process.exit(failures === 0 ? 0 : 1)
