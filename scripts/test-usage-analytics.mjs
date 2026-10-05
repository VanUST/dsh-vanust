/**
 * PURPOSE
 *   Prove the behaviour of the usage analytics that could silently harm: the report
 *   must never carry key-shaped or identity material, and the `--check` gate must
 *   refuse one instead of writing it. The three cases drive the run the CLI performs
 *   over a fixture export and assert its result — the marker on a clean export with
 *   nothing written, the failure on a leaking one, and a key NAME appearing only as an
 *   opaque use-case label in the report the run produced.
 *
 *   The metric-level cases (a rate classifier, the CSV and ZIP readers, an interval
 *   union, each builder and each renderer) were removed under the
 *   small-behavioural-suite ruling: they pinned per-function values rather than the
 *   product's output, and what they covered is observable through the report the gate
 *   inspects. The expected values here are written as literals, never by re-running
 *   the code under test.
 *
 * INPUTS
 *   None. Every fixture is built in this file: CSV text as string literals, and a ZIP
 *   archive assembled byte by byte so the reader needs no fixture file, no network and
 *   no `unzip` binary.
 *
 * OUTPUTS
 *   A `node:test` suite. It exits non-zero when any case fails and prints one line
 *   per case under the default reporter.
 *
 * KEYWORDS
 *   tests, redaction gate, key-shaped material, opaque label, export, behaviour test
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The temporary directory an end-to-end case writes is created under the
 *     system temporary root and removed when the case finishes.
 *   - A floating-point comparison uses an explicit tolerance, so a case pins the
 *     value and not the last bit of its binary representation.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readExport } from './usage/export-reader.mjs'
import { buildAnalysis } from './usage/analytics.mjs'
import { renderMarkdown } from './usage/report.mjs'
import { parseArgs, run } from './usage-analytics.mjs'
import { findLeaks } from './usage/redaction.mjs'

/** Assert two floats agree within an explicit tolerance. */
function close(actual, expected, tolerance = 1e-9, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message} expected ${expected} within ${tolerance}, got ${actual}`,
  )
}

/**
 * Assemble a ZIP archive of stored (uncompressed) entries.
 *
 * Written out field by field rather than depending on a fixture file, so the
 * reader is exercised against bytes this test controls. CRC fields are zero: the
 * reader is a directory walker and does not verify them.
 */
function makeStoredZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const data = Buffer.from(content, 'utf8')
    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    nameBytes.copy(local, 30)
    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)
    locals.push(local, data)
    centrals.push(central)
    offset += local.length + data.length
  }
  const centralDirectory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDirectory, eocd])
}

const AMOUNT_HEADER = 'user_id,start_time_iso,end_time_iso,model,api_key_name,api_key,type,price,amount'
const COST_HEADER = 'user_id,start_time_iso,end_time_iso,model,wallet_type,cost,currency'

/**
 * The fixture month used by the metric cases, all one day, all USD.
 *
 * Hand-derived, per row: cost = price x amount.
 *   miss  off-peak 1,000,000 x 1.5e-7 = 0.15
 *   out   off-peak   500,000 x 6.0e-7 = 0.30
 *   hit   off-peak 10,000,000 x 3.0e-9 = 0.03
 *   miss  peak     1,000,000 x 3.0e-7 = 0.30
 * Total spend 0.78, of which peak 0.30. Input tokens 12,000,000; total 12,500,000.
 */
const AMOUNT_ROWS = [
  `u,2026-09-01T00:00:00+03:00,2026-09-02T00:00:00+03:00,deepseek-flash,dsh,sk-a,input_cache_miss_tokens,0.00000015,1000000`,
  `u,2026-09-01T00:00:00+03:00,2026-09-02T00:00:00+03:00,deepseek-flash,dsh,sk-a,output_tokens,0.0000006,500000`,
  `u,2026-09-01T00:00:00+03:00,2026-09-02T00:00:00+03:00,deepseek-flash,dsh,sk-a,input_cache_hit_tokens,0.000000003,10000000`,
  `u,2026-09-01T00:00:00+03:00,2026-09-02T00:00:00+03:00,deepseek-flash,dsh,sk-a,input_cache_miss_tokens,0.0000003,1000000`,
  `u,2026-09-01T00:00:00+03:00,2026-09-02T00:00:00+03:00,deepseek-flash,dsh,sk-a,request_count,,5`,
]
const COST_ROWS = [`u,2026-09-01T00:00:00+03:00,2026-09-02T00:00:00+03:00,deepseek-flash,Paid,0.78,USD`]

/** Build the fixture export in a fresh temporary directory. */
function fixtureDirectory(amountRows = AMOUNT_ROWS, costRows = COST_ROWS) {
  const directory = mkdtempSync(join(tmpdir(), 'usage-analytics-'))
  writeFileSync(join(directory, 'amount-2026-09-01_2026-09-30.csv'), [AMOUNT_HEADER, ...amountRows].join('\n') + '\n')
  writeFileSync(join(directory, 'cost-2026-09-01_2026-09-30.csv'), [COST_HEADER, ...costRows].join('\n') + '\n')
  return directory
}

/** Read the fixture export and remove its temporary directory. */
function readFixture() {
  const directory = fixtureDirectory()
  try {
    return readExport(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/**
 * Run the whole pipeline over a fixture export, with the machine's own session logs
 * deliberately left out of it so the result does not depend on this session.
 *
 * @param argv - Extra flags after the export path and `--no-agent-hours`.
 * @param amountRows - `amount-*.csv` rows; the fixture month by default.
 * @param costRows - `cost-*.csv` rows.
 * @returns The `{value, text}` of `run`, plus everything `run` wrote to stdout.
 */
function runFixture(argv = [], amountRows = AMOUNT_ROWS, costRows = COST_ROWS) {
  const directory = fixtureDirectory(amountRows, costRows)
  try {
    const options = parseArgs(['--export', directory, '--no-agent-hours', ...argv])
    assert.equal(options.error, null, `flags parsed: ${String(options.error)}`)
    const original = process.stdout.write
    let text = ''
    process.stdout.write = (chunk) => {
      text += String(chunk)
      return true
    }
    try {
      return { result: run(options), text }
    } finally {
      process.stdout.write = original
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('a key name never reaches the report; the export groups by an opaque label', () => {
  // Which keys exist is identity material, how spend splits between them is analysis. The
  // name used here is itself key-SHAPED, so a report that printed it would fail the leak
  // gate too: this test asserts the drop, and the gate test below asserts the gate.
  const keyName = 'sk-teamalpha'
  const rows = AMOUNT_ROWS.map((row) => row.replace(',dsh,sk-a,', `,${keyName},sk-a,`))
  const directory = fixtureDirectory(rows, COST_ROWS)
  try {
    const exported = readExport(directory)
    assert.deepEqual(exported.dropped, ['api_key', 'api_key_name', 'user_id'], 'the identity columns are named, not guessed')
    assert.equal(exported.useCases.size, 1)
    assert.equal(exported.useCases.label(keyName), 'use-case-1')
    assert.ok(
      exported.amounts.every((row) => row.apiKeyName === undefined && row.apiKey === undefined && row.userId === undefined),
      'no parsed row carries an identity field',
    )
    const analysis = buildAnalysis({ amounts: exported.amounts, costs: exported.costs, usdPerCny: 6.667 })
    const markdown = renderMarkdown(analysis, {
      source: directory,
      usdPerCny: 6.667,
      agentHome: null,
      idleGapMs: null,
      offsetMinutes: 0,
      generatedAt: '2026-10-01T00:00:00.000Z',
    })
    assert.ok(!markdown.includes(keyName), 'the key name is absent from the report')
    assert.ok(markdown.includes('use-case-1'), 'and the opaque label is what the report groups by')
    assert.deepEqual(findLeaks(markdown), [], 'the report the drop produces is clean')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('--check passes on a clean export, writes nothing, and prints the marker a gate greps', () => {
  const { result, text } = runFixture(['--check', '--out-dir', join(tmpdir(), 'usage-check-should-write-nothing')])
  assert.equal(result.exitCode, 0, `clean export: ${JSON.stringify(result.leaks ?? [])}`)
  assert.equal(result.paths.markdownPath, null, '--check writes no markdown')
  assert.equal(result.paths.htmlPath, null, '--check writes no HTML')
  assert.match(text, /usage analysis ok/)
  assert.match(text, /identity column\(s\) dropped at parse/)
})

test('the gate FAILS when the report would carry key-shaped material', () => {
  // The case that proves the gate can fail: the MODEL name is rendered in the report, so a
  // key-shaped one reaches it however carefully the columns were dropped. Without this test
  // a gate that always returned "ok" would look identical to one that works.
  const keyShapedModel = 'sk-modelkey123'
  const rows = AMOUNT_ROWS.map((row) => row.replace(',deepseek-flash,', `,${keyShapedModel},`))
  const costs = COST_ROWS.map((row) => row.replace(',deepseek-flash,', `,${keyShapedModel},`))

  const checked = runFixture(['--check'], rows, costs)
  assert.equal(checked.result.exitCode, 1, '--check exits 1 on a leaking report')
  assert.ok(
    checked.result.leaks.some((finding) => finding.id === 'api-key-material'),
    `the finding names the leak: ${JSON.stringify(checked.result.leaks)}`,
  )
  assert.ok(!/usage analysis ok/.test(checked.text), 'the ok marker is not printed')

  // And the same report is refused, not written, when --check was not asked for: a caller
  // who forgot the flag must not get a file with a key in it.
  const wrote = runFixture(['--out-dir', join(tmpdir(), 'usage-leak-should-write-nothing')], rows, costs)
  assert.equal(wrote.result.exitCode, 1, 'the leak refuses the write too')
  assert.equal(wrote.result.paths.markdownPath, null, 'nothing was written')
})
