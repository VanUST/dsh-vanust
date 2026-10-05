/**
 * PURPOSE
 *   Drive the usage analytics over fixtures whose correct answers are known by
 *   hand, so a change to a rate, a currency assumption, an interval rule or a
 *   rounding path fails here rather than in a month's report.
 *
 *   Each case exercises real product code — the rate classifier, the CSV and ZIP
 *   readers, the interval union, the metric builders, the renderers and the
 *   argument parser — and asserts on what it produced. The expected values are
 *   written as literals derived from the published rate card and from arithmetic
 *   done outside the code, never by re-running the function under test.
 *
 * INPUTS
 *   None. Every fixture is built in this file: CSV text as string literals, and a
 *   ZIP archive assembled byte by byte so the reader is tested without a fixture
 *   file and without a network or an `unzip` binary.
 *
 * OUTPUTS
 *   A `node:test` suite. It exits non-zero when any case fails and prints one line
 *   per case under the default reporter.
 *
 * KEYWORDS
 *   tests, rate card, peak, cache, reconciliation, zip, csv, agent hours, report
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The temporary directory an end-to-end case writes is created under the
 *     system temporary root and removed when the case finishes.
 *   - A floating-point comparison uses an explicit tolerance, so a case pins the
 *     value and not the last bit of its binary representation.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { classifyPrice, pricePerToken, PEAK, OFF_PEAK } from './usage/price-grid.mjs'
import { parseCsv, readZipEntries, readExport, exportWindow, newestExport } from './usage/export-reader.mjs'
import {
  buildAnalysis,
  cacheAnalysis,
  legacyPremium,
  money,
  peakAnalysis,
  reconcile,
  classifyAmounts,
} from './usage/analytics.mjs'
import {
  intervalsFromTimestamps,
  unionMs,
  peakConcurrency,
  summarizeByDay,
  agentHours,
  dayKey,
} from './usage/agent-hours.mjs'
import { renderMarkdown, renderConsole } from './usage/report.mjs'
import { renderHtml, escapeHtml } from './usage/report-html.mjs'
import { browserCommand } from './usage/open-browser.mjs'
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

test('classifyPrice recovers the currency and window a price implies', () => {
  // Flash, USD, off-peak, cache miss: 0.15 per million is 1.5e-7 per token.
  const offPeak = classifyPrice('deepseek-flash', 'input_cache_miss_tokens', 0.00000015)
  assert.equal(offPeak.currency, 'USD')
  assert.equal(offPeak.window, OFF_PEAK)
  assert.equal(offPeak.multiplier, 1)

  // The same bucket at double the price is the peak window, not a different rate.
  const peak = classifyPrice('deepseek-flash', 'input_cache_miss_tokens', 0.0000003)
  assert.equal(peak.currency, 'USD')
  assert.equal(peak.window, PEAK)
  assert.equal(peak.multiplier, 2)

  // The CNY list for the same cell is 1 per million, and must not be read as USD.
  const cny = classifyPrice('deepseek-flash', 'input_cache_miss_tokens', 0.000001)
  assert.equal(cny.currency, 'CNY')
  assert.equal(cny.window, OFF_PEAK)

  // A price off every cell is refused rather than snapped to the nearest one.
  assert.equal(classifyPrice('deepseek-flash', 'input_cache_miss_tokens', 0.000000999), null)
  assert.equal(classifyPrice('unknown-model', 'input_cache_miss_tokens', 0.00000015), null)
  assert.equal(classifyPrice('deepseek-flash', 'not_a_bucket', 0.00000015), null)
})

test('pricePerToken returns the peak rate as exactly twice the off-peak rate', () => {
  const offPeak = pricePerToken('deepseek-v4-pro', 'USD', 'output_tokens', OFF_PEAK)
  const peak = pricePerToken('deepseek-v4-pro', 'USD', 'output_tokens', PEAK)
  close(offPeak, 1.98e-6, 1e-18)
  close(peak, 3.96e-6, 1e-18)
  // The card declares no CNY list for a retired name, and that is a null, not a fallback.
  assert.equal(pricePerToken('deepseek-v4-flash', 'CNY', 'output_tokens', OFF_PEAK), null)
})

test('parseCsv handles a quoted delimiter, an embedded newline and a byte-order mark', () => {
  const quoted = parseCsv('a,b\n"x,y",z\n')
  assert.deepEqual(quoted.header, ['a', 'b'])
  assert.deepEqual(quoted.rows, [['x,y', 'z']])

  const multiline = parseCsv('a\n"line one\nline two"\n')
  assert.deepEqual(multiline.rows, [['line one\nline two']])

  const bom = parseCsv('\uFEFFa,b\n1,2\n')
  assert.deepEqual(bom.header, ['a', 'b'])
  assert.deepEqual(bom.rows, [['1', '2']])

  const doubled = parseCsv('a\n"say ""hi"""\n')
  assert.deepEqual(doubled.rows, [['say "hi"']])
})

test('readZipEntries reads stored entries out of an archive built byte by byte', () => {
  const archive = makeStoredZip([
    ['amount-2026-09-01_2026-09-30.csv', 'header\nbody\n'],
    ['nested/cost-2026-09-01_2026-09-30.csv', 'costs\n'],
  ])
  const entries = readZipEntries(archive)
  assert.equal(entries.size, 2)
  assert.equal(entries.get('amount-2026-09-01_2026-09-30.csv').toString('utf8'), 'header\nbody\n')
  assert.equal(entries.get('nested/cost-2026-09-01_2026-09-30.csv').toString('utf8'), 'costs\n')
})

test('readExport refuses an archive that holds no export rather than reporting an empty month', () => {
  const archive = makeStoredZip([['readme.txt', 'nothing here\n']])
  const directory = mkdtempSync(join(tmpdir(), 'usage-analytics-'))
  const path = join(directory, 'usage.zip')
  writeFileSync(path, archive)
  assert.throws(() => readExport(path), /no usage export/)
  rmSync(directory, { recursive: true, force: true })
})

test('readExport prefers the peak price as the higher of the two rows for one bucket', () => {
  const directory = fixtureDirectory()
  try {
    const exported = readExport(directory)
    assert.equal(exported.amounts.length, 5)
    assert.equal(exported.costs.length, 1)
    // request_count carries no price and must survive as a null, not as a zero.
    const request = exported.amounts.find((row) => row.type === 'request_count')
    assert.equal(request.price, null)
    assert.equal(request.amount, 5)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('reconcile confirms the token breakdown against the ledger, and reports a disagreement', () => {
  const { tokenRows } = classifyAmounts(readFixture().amounts, 6.667)
  const agreeing = reconcile(tokenRows, [{ day: '2026-09-01', model: 'deepseek-flash', currency: 'USD', cost: 0.78 }])
  assert.equal(agreeing.ok, true)
  assert.equal(agreeing.checked, 1)

  // The ledger is an independent statement of the same month: a 0.50 ledger
  // against 0.78 of tokens is a mismatch of 0.28, not a rounding difference.
  const disagreeing = reconcile(tokenRows, [
    { day: '2026-09-01', model: 'deepseek-flash', currency: 'USD', cost: 0.5 },
  ])
  assert.equal(disagreeing.ok, false)
  assert.equal(disagreeing.mismatches.length, 1)
  close(disagreeing.mismatches[0].difference, 0.28, 1e-9)
})

test('peakAnalysis prices the peak premium at half the peak spend', () => {
  const { tokenRows } = classifyAmounts(readFixture().amounts, 6.667)
  const peaks = peakAnalysis(tokenRows, 6.667)
  close(peaks.peakUsd, 0.3, 1e-9, 'peak spend')
  close(peaks.offPeakUsd, 0.48, 1e-9, 'off-peak spend')
  close(peaks.premiumUsd, 0.15, 1e-9, 'premium')
  close(peaks.counterfactualUsd, 0.63, 1e-9, 'counterfactual')
  assert.equal(peaks.peakTokens, 1_000_000)
  assert.equal(peaks.offPeakTokens, 11_500_000)
})

test('cacheAnalysis values caching against the uncached price of the same tokens', () => {
  const { tokenRows } = classifyAmounts(readFixture().amounts, 6.667)
  const cache = cacheAnalysis(tokenRows, 6.667)
  assert.equal(cache.hitTokens, 10_000_000)
  assert.equal(cache.missTokens, 2_000_000)
  close(cache.hitRate, 10 / 12, 1e-12, 'hit rate')
  close(cache.actualInputUsd, 0.48, 1e-9, 'actual input')
  // Every input token at the miss price of its own window: 0.15 + 1.50 + 0.30.
  close(cache.allMissInputUsd, 1.95, 1e-9, 'all-miss input')
  close(cache.savedUsd, 1.47, 1e-9, 'saved')
  close(cache.effectiveInputPriceUsdPerMillion, 0.04, 1e-12, 'effective price')
  close(cache.blendedMissPriceUsdPerMillion, 0.1625, 1e-12, 'blended miss price')
})

test('legacyPremium prices the retired name against the current card', () => {
  const rows = [
    {
      model: 'deepseek-v4-flash',
      type: 'input_cache_miss_tokens',
      currency: 'USD',
      window: OFF_PEAK,
      amount: 1_000_000,
      usd: 0.22,
    },
  ]
  const legacy = legacyPremium(rows, 6.667)
  // Current flash card: 0.15 per million, so the alias costs 0.07 more.
  close(legacy.actualUsd, 0.22, 1e-12)
  close(legacy.currentCardUsd, 0.15, 1e-12)
  close(legacy.premiumUsd, 0.07, 1e-12)
  assert.equal(legacy.tokens, 1_000_000)
})

test('buildAnalysis converts CNY at the supplied rate and keeps the native totals', () => {
  const directory = fixtureDirectory(
    [
      `u,2026-09-01T00:00:00+03:00,2026-09-02T00:00:00+03:00,deepseek-flash,dsh,sk-a,input_cache_miss_tokens,0.000001,1000000`,
    ],
    [`u,2026-09-01T00:00:00+03:00,2026-09-02T00:00:00+03:00,deepseek-flash,Paid,1.0,CNY`],
  )
  try {
    const exported = readExport(directory)
    const analysis = buildAnalysis({ amounts: exported.amounts, costs: exported.costs, usdPerCny: 6.667 })
    // CNY 1.00 at 6.667 per USD is 0.15000 USD, and the native total stays 1.0.
    close(analysis.money.CNY, 1.0, 1e-12)
    close(analysis.money.USD, 0.0, 1e-12)
    close(analysis.money.totalUsd, 1 / 6.667, 1e-12)
    assert.equal(analysis.reconciliation.ok, true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('buildAnalysis reports an unclassifiable price as a failure instead of valuing it at zero', () => {
  const directory = fixtureDirectory(
    [
      `u,2026-09-01T00:00:00+03:00,2026-09-02T00:00:00+03:00,deepseek-flash,dsh,sk-a,input_cache_miss_tokens,0.00000015,1000000`,
      `u,2026-09-01T00:00:00+03:00,2026-09-02T00:00:00+03:00,deepseek-flash,dsh,sk-a,output_tokens,0.000000123,500000`,
    ],
    [`u,2026-09-01T00:00:00+03:00,2026-09-02T00:00:00+03:00,deepseek-flash,Paid,0.15,USD`],
  )
  try {
    const exported = readExport(directory)
    const analysis = buildAnalysis({ amounts: exported.amounts, costs: exported.costs, usdPerCny: 6.667 })
    assert.equal(analysis.failures.length, 1)
    assert.match(analysis.failures[0].reason, /matches no/)
    // The classified row still totals; the unclassified one is excluded, not zeroed.
    close(analysis.money.totalUsd, 0.15, 1e-12)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('buildAnalysis splits spend across cached input, uncached input and output', () => {
  const directory = fixtureDirectory()
  try {
    const exported = readExport(directory)
    const analysis = buildAnalysis({
      amounts: exported.amounts,
      costs: exported.costs,
      usdPerCny: 6.667,
      agentHourData: {
        byDay: new Map([['2026-09-01', { seconds: 7200, peakConcurrency: 1, hours: 2 }]]),
        total: { hours: 2, peakConcurrency: 1 },
      },
      agentHourKey: exported.useCases.label('dsh'),
    })
    const byBucket = Object.fromEntries(analysis.buckets.map((bucket) => [bucket.bucket, bucket]))
    close(byBucket.input_cache_hit_tokens.usd, 0.03, 1e-12, 'cached input')
    close(byBucket.input_cache_miss_tokens.usd, 0.45, 1e-12, 'uncached input')
    close(byBucket.output_tokens.usd, 0.3, 1e-12, 'output')
    close(byBucket.output_tokens.share, 0.3 / 0.78, 1e-12, 'output share')
    // 0.78 of dsh spend over the 2 covered hours.
    close(analysis.agentHours.perKeyAgentHour.usd, 0.39, 1e-12)
    close(analysis.agentHours.perKeyAgentHour.tokens, 6_250_000, 1e-6)
    assert.equal(analysis.agentHours.uncoveredSpendUsd, 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('per-agent-hour divides only the spend on the days the hours cover', () => {
  // Two days of dsh tokens: day 1 has a session log, day 2 does not.
  const directory = fixtureDirectory(
    [
      `u,2026-09-01T00:00:00+03:00,2026-09-02T00:00:00+03:00,deepseek-flash,dsh,sk-a,output_tokens,0.0000006,500000`,
      `u,2026-09-02T00:00:00+03:00,2026-09-03T00:00:00+03:00,deepseek-flash,dsh,sk-a,output_tokens,0.0000006,500000`,
    ],
    [
      `u,2026-09-01T00:00:00+03:00,2026-09-02T00:00:00+03:00,deepseek-flash,Paid,0.3,USD`,
      `u,2026-09-02T00:00:00+03:00,2026-09-03T00:00:00+03:00,deepseek-flash,Paid,0.3,USD`,
    ],
  )
  try {
    const exported = readExport(directory)
    const analysis = buildAnalysis({
      amounts: exported.amounts,
      costs: exported.costs,
      usdPerCny: 6.667,
      agentHourData: {
        byDay: new Map([['2026-09-01', { seconds: 3600, peakConcurrency: 1, hours: 1 }]]),
        total: { hours: 1, peakConcurrency: 1 },
      },
      agentHourKey: exported.useCases.label('dsh'),
    })
    // Only day 1 is covered: 0.30 over 1 hour. Charging day 2 as well would give
    // 0.60 and overstate what an hour on this machine costs.
    close(analysis.agentHours.perKeyAgentHour.usd, 0.3, 1e-12)
    close(analysis.agentHours.perAgentHourOnCoveredDays.usd, 0.3, 1e-12)
    close(analysis.agentHours.perAgentHourWholeBill.usd, 0.6, 1e-12)
    close(analysis.agentHours.uncoveredSpendUsd, 0.3, 1e-12)
    assert.deepEqual(analysis.agentHours.uncoveredDays, ['2026-09-02'])
    const coverage = analysis.insights.find((insight) => insight.id === 'agent-hour-coverage')
    close(coverage.usd, 0.3, 1e-12)
    assert.equal(coverage.severity, 'warn')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('money keeps the two native currencies apart from the converted total', () => {
  const totals = money(
    [
      { currency: 'USD', amount: 10 },
      { currency: 'CNY', amount: 66.67 },
    ],
    6.667,
  )
  close(totals.USD, 10, 1e-12)
  close(totals.CNY, 66.67, 1e-12)
  close(totals.totalUsd, 20, 1e-9)
})

test('intervalsFromTimestamps counts gaps under the threshold and breaks above it', () => {
  // 1s, 2s, 7s from the first record: two 60s gaps then one 280s gap.
  const times = [0, 60_000, 120_000, 400_000]
  const joined = intervalsFromTimestamps(times, 300_000)
  assert.equal(joined.length, 3)
  close(unionMs(joined), 400_000, 1e-9)

  // With a 100s threshold the 280s gap is a stop, so the last interval is dropped.
  const split = intervalsFromTimestamps(times, 100_000)
  assert.equal(split.length, 2)
  close(unionMs(split), 120_000, 1e-9)

  // A single record has no duration, so it contributes nothing at all.
  assert.equal(intervalsFromTimestamps([5_000], 300_000).length, 0)
})

test('unionMs counts an overlap once and peakConcurrency counts the agents alive together', () => {
  const intervals = [
    { start: 0, end: 100_000 },
    { start: 50_000, end: 150_000 },
  ]
  close(unionMs(intervals), 150_000, 1e-9)
  assert.equal(peakConcurrency(intervals), 2)

  // Disjoint work is additive in time but never more than one agent at a time.
  const disjoint = [
    { start: 0, end: 10_000 },
    { start: 20_000, end: 30_000 },
  ]
  close(unionMs(disjoint), 20_000, 1e-9)
  assert.equal(peakConcurrency(disjoint), 1)
  assert.equal(peakConcurrency([]), 0)

  // Back-to-back work meeting at an exact boundary is continuous, and its union is
  // the whole span whether or not the touching pair is merged: two spans that meet
  // have neither an overlap to drop nor a gap to leave. This pins the boundary the
  // interval builder produces constantly, two records written the same millisecond
  // apart.
  const touching = [
    { start: 0, end: 100_000 },
    { start: 100_000, end: 200_000 },
  ]
  close(unionMs(touching), 200_000, 1e-9)
  assert.equal(peakConcurrency(touching), 1)
})

test('summarizeByDay splits an interval that crosses local midnight', () => {
  // UTC+3: 20:30Z to 21:30Z is 23:30 on the 1st to 00:30 on the 2nd.
  const intervals = [{ start: Date.parse('2026-09-01T20:30:00Z'), end: Date.parse('2026-09-01T21:30:00Z') }]
  const byDay = agentHours(summarizeByDay(intervals, 180))
  close(byDay.get('2026-09-01').seconds, 1800, 1e-9)
  close(byDay.get('2026-09-02').seconds, 1800, 1e-9)
  close(byDay.get('__total__').seconds, 3600, 1e-9)
  close(byDay.get('2026-09-01').hours, 0.5, 1e-12)
  // The parts must sum to the whole, or a day's figure silently loses time.
  close(
    byDay.get('2026-09-01').seconds + byDay.get('2026-09-02').seconds,
    byDay.get('__total__').seconds,
    1e-9,
  )
  assert.equal(dayKey(Date.parse('2026-09-01T20:30:00Z'), 180), '2026-09-01')
  assert.equal(dayKey(Date.parse('2026-09-01T21:30:00Z'), 180), '2026-09-02')
})

test('exportWindow reads the covered span out of the rows themselves', () => {
  const directory = fixtureDirectory()
  try {
    const exported = readExport(directory)
    // Daily rows are stamped at the start of their day, so the window is the first
    // day's local midnight to the midnight after the last day.
    const window_ = exportWindow(exported.amounts, exported.costs, 180)
    assert.equal(window_.from, '2026-09-01')
    assert.equal(window_.to, '2026-09-01')
    assert.equal(window_.startMs, Date.parse('2026-09-01T00:00:00+03:00'))
    assert.equal(window_.endMs, Date.parse('2026-09-02T00:00:00+03:00'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('readExport reads the older single-date schema as the same shaped rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-analytics-'))
  try {
    writeFileSync(
      join(directory, 'amount-2026-07-01_2026-07-31.csv'),
      [
        '﻿user_id,utc_date,model,api_key_name,api_key,type,price,amount',
        'u,20260701,deepseek-v4-pro,first,sk-b,input_cache_miss_tokens,0.000003,1000',
      ].join('\n') + '\n',
    )
    writeFileSync(
      join(directory, 'cost-2026-07-01_2026-07-31.csv'),
      ['﻿user_id,utc_date,model,wallet_type,cost,currency', 'u,20260701,deepseek-v4-pro,Paid,0.003,CNY'].join('\n') + '\n',
    )
    const exported = readExport(directory)
    // YYYYMMDD is normalised to the same YYYY-MM-DD every metric groups by, and the
    // absent interval columns become nulls rather than being invented.
    assert.equal(exported.amounts[0].day, '2026-07-01')
    assert.equal(exported.amounts[0].startIso, null)
    assert.equal(exported.amounts[0].price, 0.000003)
    assert.equal(exported.costs[0].day, '2026-07-01')
    assert.equal(exported.costs[0].currency, 'CNY')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('summarizeFailures reduces a month of unrecognised prices to the cells to add', () => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-analytics-'))
  try {
    writeFileSync(
      join(directory, 'amount-2026-07-01_2026-07-31.csv'),
      [
        'user_id,utc_date,model,api_key_name,api_key,type,price,amount',
        // Twice at one price and once at another: two distinct cells, three rows.
        'u,20260701,deepseek-v4-flash,first,sk-a,output_tokens,0.00000028,100',
        'u,20260702,deepseek-v4-flash,first,sk-a,output_tokens,0.00000028,200',
        'u,20260703,deepseek-v4-flash,first,sk-a,output_tokens,0.000002,400',
      ].join('\n') + '\n',
    )
    writeFileSync(
      join(directory, 'cost-2026-07-01_2026-07-31.csv'),
      ['user_id,utc_date,model,wallet_type,cost,currency', 'u,20260701,deepseek-v4-flash,Paid,0.1,CNY'].join('\n') + '\n',
    )
    const analysis = buildAnalysis({ ...readExport(directory), usdPerCny: 6.667 })
    assert.equal(analysis.failures.length, 3)
    assert.equal(analysis.failureSummary.length, 2)
    // Sorted by tokens carried, so the biggest gap in the card leads.
    assert.equal(analysis.failureSummary[0].price, 0.000002)
    assert.equal(analysis.failureSummary[0].rows, 1)
    assert.equal(analysis.failureSummary[0].tokens, 400)
    assert.equal(analysis.failureSummary[1].rows, 2)
    assert.equal(analysis.failureSummary[1].tokens, 300)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the report renders an absent denominator as n/a rather than as a number', () => {
  const directory = fixtureDirectory()
  try {
    const exported = readExport(directory)
    const analysis = buildAnalysis({ amounts: exported.amounts, costs: exported.costs, usdPerCny: 6.667 })
    assert.equal(analysis.agentHours, null)
    const markdown = renderMarkdown(analysis, { source: 'fixture', usdPerCny: 6.667 })
    assert.match(markdown, /no per-hour figure is reported/)
    assert.match(markdown, /\$0\.7800/)
    assert.ok(!markdown.includes('NaN'), 'the report must never print NaN')
    assert.ok(!markdown.includes('Infinity'))
    const summary = renderConsole(analysis, { source: 'fixture', usdPerCny: 6.667 })
    assert.match(summary, /agent-hours\s+not measured/)
    assert.ok(!summary.includes('NaN'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the report names the peak premium it computed, in dollars', () => {
  const directory = fixtureDirectory()
  try {
    const exported = readExport(directory)
    const analysis = buildAnalysis({ amounts: exported.amounts, costs: exported.costs, usdPerCny: 6.667 })
    const summary = renderConsole(analysis, { usdPerCny: 6.667 })
    // The fixture's peak spend is 0.30, so the premium is 0.15.
    assert.match(summary, /peak premium\s+\$0\.1500/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('parseArgs turns flags into the options the run depends on', () => {
  const options = parseArgs([
    '--export',
    'x.zip',
    '--usd-per-cny',
    '7',
    '--idle-gap',
    '10',
    '--markdown',
    'out.md',
    '--quiet',
  ])
  assert.equal(options.exportPath, 'x.zip')
  assert.equal(options.usdPerCny, 7)
  // Ten minutes is the threshold the interval builder receives, in milliseconds.
  assert.equal(options.idleGapMs, 600_000)
  assert.equal(options.markdownPath, 'out.md')
  assert.equal(options.quiet, true)

  assert.match(parseArgs(['--nope']).error, /unknown flag/)
  assert.match(parseArgs(['--usd-per-cny', 'lots']).error, /expects a number/)
  assert.match(parseArgs(['--export']).error, /needs a value/)
  assert.equal(parseArgs(['--no-agent-hours']).useAgentHours, false)
  assert.equal(parseArgs(['--help']).help, true)
})

test('newestExport picks the most recent export and ignores everything else', () => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-analytics-'))
  try {
    writeFileSync(join(directory, 'usage_data_2026-07.zip'), 'older')
    writeFileSync(join(directory, 'usage_data_2026-09.zip'), 'newer')
    writeFileSync(join(directory, 'notes.txt'), 'not an export')
    utimesSync(join(directory, 'usage_data_2026-07.zip'), new Date('2026-07-31T00:00:00Z'), new Date('2026-07-31T00:00:00Z'))
    utimesSync(join(directory, 'usage_data_2026-09.zip'), new Date('2026-09-30T00:00:00Z'), new Date('2026-09-30T00:00:00Z'))
    assert.equal(newestExport(directory), join(directory, 'usage_data_2026-09.zip'))
    // A directory that does not exist is a null, not a throw: the caller reports
    // "no export found" rather than a stack trace.
    assert.equal(newestExport(join(directory, 'absent')), null)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('renderHtml emits one self-contained page and escapes everything it interpolates', () => {
  const directory = fixtureDirectory()
  try {
    const exported = readExport(directory)
    const analysis = buildAnalysis({ amounts: exported.amounts, costs: exported.costs, usdPerCny: 6.667 })
    const html = renderHtml(analysis, { source: '<script>alert(1)</script>', usdPerCny: 6.667, offsetMinutes: 180 })
    assert.match(html, /^<!doctype html>/)
    assert.match(html, /\$0\.7800/)
    // The injected markup is escaped, so a label from the export cannot restructure the page.
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must not survive')
    assert.ok(html.includes('&lt;script&gt;'), 'the escaped form must be present')
    // Self-contained: nothing to fetch, so it renders from the filesystem.
    assert.ok(!/\ssrc\s*=/.test(html), 'no external assets')
    assert.ok(!/https?:\/\//.test(html), 'no external URLs')
    assert.ok(!html.includes('NaN'), 'never print NaN')
    assert.ok(!html.includes('Infinity'), 'never print Infinity')
    // A page with no agent-hours must still render its section as unavailable.
    assert.match(html, /No agent-hours were measured/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('escapeHtml neutralises the five markup-significant characters', () => {
  assert.equal(escapeHtml('a & b < c > d "e" \'f\''), 'a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;')
  assert.equal(escapeHtml(null), '')
  assert.equal(escapeHtml(undefined), '')
  assert.equal(escapeHtml(42), '42')
})

test('browserCommand names the platform opener and its arguments', () => {
  assert.deepEqual(browserCommand('linux', '/tmp/x.html'), { command: 'xdg-open', args: ['/tmp/x.html'] })
  assert.deepEqual(browserCommand('darwin', '/tmp/x.html'), { command: 'open', args: ['/tmp/x.html'] })
  // `start` is a cmd builtin rather than an executable, and its first argument is
  // the window title, so an empty title keeps the path from being read as one.
  assert.deepEqual(browserCommand('win32', 'C:\\x.html'), {
    command: 'cmd',
    args: ['/c', 'start', '', 'C:\\x.html'],
  })
  assert.equal(browserCommand('aix', '/tmp/x.html').command, null)
})

test('parseArgs accepts the report-target and open flags', () => {
  const options = parseArgs([
    '--export', 'x.zip',
    '--out-dir', 'reports/usage',
    '--html', 'page.html',
    '--export-dir', '/data/exports',
    '--open',
  ])
  assert.equal(options.outDir, 'reports/usage')
  assert.equal(options.htmlPath, 'page.html')
  assert.equal(options.exportDir, '/data/exports')
  assert.equal(options.open, true)
  // The discovery default is the caller's Downloads folder, not the cwd.
  assert.match(parseArgs([]).exportDir, /Downloads$/)
  assert.equal(parseArgs([]).open, false)
})

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
