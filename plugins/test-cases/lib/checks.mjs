/**
 * PURPOSE
 *   Turn a driver's measurements into a verdict, and normalise the checks a case declares.
 *   A case is the DURABLE side of a check: it names the requirement and the threshold. The
 *   driver is the EXECUTABLE side: it walks the page or runs the benchmark and writes a JSON
 *   summary of what it measured. The plugin is the JUDGE: it compares the numbers, so a claim in
 *   the driver's prose cannot override a measurement.
 *
 *   One summary contract keeps the plugin framework-agnostic:
 *     { "metrics": { "p95": 212, "axeViolations": 0 }, "hashes": { "golden": "sha256:…" },
 *       "artifacts": ["home-1440.png"], "notes": "optional" }
 *   A declared check names the metric it consumes, so a renamed metric fails loudly
 *   (`metric_missing`) instead of silently passing.
 *
 * INPUTS / OUTPUTS
 *   normalizeChecks(input) -> the stored check list, or a Refusal for an unusable spec.
 *   parseSummary(path) -> { metrics, hashes, artifacts, notes, error } (never throws).
 *   evaluateChecks(checks, summary, { exitCode, baseline }) -> { results, passed }.
 *   median(values) / p95(values) -> one number (null for an empty series).
 *   aggregateMetrics(series) -> { metric: { values, median, p95 } } for repeated runs.
 *
 * KEYWORDS
 *   typed checks, metric threshold, baseline ratchet, driver summary, CASE_SUMMARY,
 *   median, p95, metric_missing
 */

import { existsSync, readFileSync } from 'node:fs'
import { Refusal } from './store.mjs'

/** Comparators a numeric or string check may use. */
export const CHECK_OPS = ['<=', '>=', '<', '>', '==', '!=']

/** A band is a fraction of the baseline, never a negative or huge value. */
function bandOf(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.1
}

/**
 * Normalise the check list a case declares.
 *
 * A check needs a MEASUREMENT to read: either a numeric `threshold`, a string `expected`, or
 * `baseline: true` (the ratchet: the threshold comes from the recorded baseline). A check with
 * none of those is refused — it would compare a number with nothing.
 */
export function normalizeChecks(input) {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw new Refusal('INVALID_CHECKS', '`checks` must be an array')
  if (input.length > 20) throw new Refusal('INVALID_CHECKS', 'at most 20 checks per case')
  const out = []
  for (const [index, raw] of input.entries()) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Refusal('INVALID_CHECKS', `check ${index + 1} is not an object`)
    const metric = typeof raw.metric === 'string' && raw.metric.trim() !== '' ? raw.metric.trim() : ''
    if (metric === '') throw new Refusal('INVALID_CHECKS', `check ${index + 1} needs a non-empty \`metric\` (the summary key it reads)`)
    const op = raw.op === undefined ? (typeof raw.expected === 'string' ? '==' : '<=') : raw.op
    if (!CHECK_OPS.includes(op)) throw new Refusal('INVALID_CHECKS', `check ${index + 1}: op must be one of ${CHECK_OPS.join(' ')}`)
    const hasThreshold = Number.isFinite(raw.threshold)
    const hasExpected = typeof raw.expected === 'string' && raw.expected !== ''
    const hasBaseline = raw.baseline === true
    if ([hasThreshold, hasExpected, hasBaseline].filter(Boolean).length === 0) {
      throw new Refusal('INVALID_CHECKS', `check ${index + 1} ("${metric}") needs a numeric \`threshold\`, a string \`expected\`, or \`baseline: true\``)
    }
    if (hasThreshold && hasExpected) throw new Refusal('INVALID_CHECKS', `check ${index + 1} ("${metric}") cannot carry both threshold and expected`)
    const threshold = hasThreshold ? raw.threshold : undefined
    out.push({
      name: typeof raw.name === 'string' && raw.name !== '' ? raw.name.slice(0, 120) : metric,
      metric,
      op,
      ...(threshold === undefined ? {} : { threshold }),
      ...(hasExpected ? { expected: raw.expected } : {}),
      ...(hasBaseline ? { baseline: true, band: bandOf(raw.band) } : {}),
      ...(typeof raw.unit === 'string' && raw.unit !== '' ? { unit: raw.unit.slice(0, 20) } : {}),
    })
  }
  return out
}

/** Read a driver summary; a missing or invalid summary is a recorded reason, never a throw. */
export function parseSummary(path) {
  const empty = { metrics: {}, hashes: {}, artifacts: [], notes: '', error: null }
  if (!existsSync(path)) return { ...empty, error: 'no summary written (CASE_SUMMARY was not used)' }
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return { ...empty, error: `summary is not valid JSON: ${error.message}` }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ...empty, error: 'summary is not an object' }
  const metrics = {}
  for (const [key, measurement] of Object.entries(value.metrics ?? {})) {
    if (Number.isFinite(measurement)) metrics[key] = measurement
  }
  const hashes = {}
  for (const [key, digest] of Object.entries(value.hashes ?? {})) {
    if (typeof digest === 'string' && digest !== '') hashes[key] = digest
  }
  const artifacts = Array.isArray(value.artifacts) ? value.artifacts.filter((entry) => typeof entry === 'string' && entry !== '').slice(0, 50) : []
  return { metrics, hashes, artifacts, notes: typeof value.notes === 'string' ? value.notes.slice(0, 2000) : '', error: null }
}

/** Compare two values with one of the check operators; non-numeric comparisons are equality only. */
function compare(measured, op, threshold) {
  if (typeof measured === 'string' || typeof threshold === 'string') {
    if (op === '==') return measured === threshold
    if (op === '!=') return measured !== threshold
    return false
  }
  if (!Number.isFinite(measured) || !Number.isFinite(threshold)) return false
  if (op === '<=') return measured <= threshold
  if (op === '>=') return measured >= threshold
  if (op === '<') return measured < threshold
  if (op === '>') return measured > threshold
  if (op === '==') return measured === threshold
  if (op === '!=') return measured !== threshold
  return false
}

/** The effective threshold of a baseline check: a `<=` ratchet tightens up, a `>=` one relaxes down. */
function baselineThreshold(check, baseline) {
  const base = baseline?.metrics?.[check.metric]
  if (!Number.isFinite(base)) return null
  const band = bandOf(check.band)
  if (check.op === '<=' || check.op === '<') return base * (1 + band)
  if (check.op === '>=' || check.op === '>') return base * (1 - band)
  return base
}

/**
 * Evaluate the implicit exit-code check and every declared check.
 *
 * @param checks - Normalised checks from the case.
 * @param summary - `{ metrics, hashes, error }` from {@link parseSummary}.
 * @param options - `{ exitCode, baseline }`.
 * @returns `{ results, passed }`; `passed` is true only when every result passed.
 */
export function evaluateChecks(checks, summary, options = {}) {
  const exitCode = Number.isInteger(options.exitCode) ? options.exitCode : null
  const results = [{
    name: 'exit code',
    metric: 'exitCode',
    op: '==',
    threshold: 0,
    measured: exitCode,
    pass: exitCode === 0,
    ...(exitCode === 0 ? {} : { reason: 'the command exited non-zero' }),
  }]
  const missingReason = (check) => `metric_missing: the summary has no ${check.expected === undefined && check.baseline !== true ? 'numeric metric' : 'hash'} "${check.metric}"${summary?.error === null || summary?.error === undefined ? '' : ` (${summary.error})`}`
  for (const check of checks) {
    const base = { name: check.name, metric: check.metric, op: check.op, ...(check.unit === undefined ? {} : { unit: check.unit }) }
    // 1. A HASH check compares the digest the driver reported.
    if (typeof check.expected === 'string') {
      const measured = summary?.hashes?.[check.metric]
      if (typeof measured !== 'string') {
        results.push({ ...base, measured: null, expected: check.expected, pass: false, reason: missingReason(check) })
        continue
      }
      const pass = compare(measured, check.op, check.expected)
      results.push({ ...base, measured, expected: check.expected, pass, ...(pass ? {} : { reason: `expected ${check.op} ${check.expected}` }) })
      continue
    }
    // 2. A RATCHET reads its threshold from the recorded baseline.
    let threshold
    if (check.baseline === true) {
      threshold = baselineThreshold(check, options.baseline)
      if (threshold === null) {
        results.push({ ...base, measured: null, pass: false, reason: `baseline_missing: no recorded baseline metric "${check.metric}"` })
        continue
      }
    } else {
      threshold = check.threshold
    }
    // 3. A METRIC check compares the number the driver reported with the threshold.
    const measured = summary?.metrics?.[check.metric]
    if (!Number.isFinite(measured)) {
      results.push({ ...base, measured: null, threshold, pass: false, reason: missingReason(check) })
      continue
    }
    const pass = compare(measured, check.op, threshold)
    results.push({ ...base, measured, threshold, pass, ...(pass ? {} : { reason: `${measured} is not ${check.op} ${threshold}` }) })
  }
  return { results, passed: results.every((result) => result.pass === true) }
}

/** Median of a numeric series (null for an empty one). */
export function median(values) {
  return percentile(values, 0.5)
}

/** Nearest-rank p95 of a numeric series (null for an empty one). */
export function p95(values) {
  return percentile(values, 0.95)
}

function percentile(values, fraction) {
  const clean = Array.isArray(values) ? values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b) : []
  if (clean.length === 0) return null
  const rank = Math.max(1, Math.ceil(fraction * clean.length))
  return clean[rank - 1]
}

/** Aggregate the same metric across repeated runs: the series, its median and its p95. */
export function aggregateMetrics(seriesList) {
  const names = new Set()
  for (const series of seriesList) for (const name of Object.keys(series ?? {})) names.add(name)
  const out = {}
  for (const name of names) {
    const values = seriesList.map((series) => series?.[name]).filter((value) => Number.isFinite(value))
    out[name] = { values, median: median(values), p95: p95(values) }
  }
  return out
}
