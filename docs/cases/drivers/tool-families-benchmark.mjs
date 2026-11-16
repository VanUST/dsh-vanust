#!/usr/bin/env node
/**
 * PROOF DRIVER: a benchmark run whose metric is the check.
 *
 * Runs the tool-families proof, measures its wall time, and writes a CASE_SUMMARY with the
 * duration and the proof's own pass counts. The case's declared checks decide whether the run is
 * acceptable (`durationMs <= 60000`, `failures == 0`); a slow-but-green run therefore still fails.
 *
 * Negative control: with CASE_NEGATIVE_CONTROL=break-budget it reports an over-budget duration
 * and exits 1, proving the metric check can fail.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

const root = process.cwd()
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''
const summaryPath = process.env.CASE_SUMMARY
const started = Date.now()
const result = spawnSync(process.execPath, [join(root, 'scripts', 'tool-families-proof.mjs')], {
  cwd: root,
  encoding: 'utf8',
  timeout: 120_000,
})
const durationMs = Date.now() - started
const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
const matched = /(\d+)\/(\d+) checks passed/.exec(output)
const checks = matched === null ? 0 : Number(matched[1])
const total = matched === null ? 0 : Number(matched[2])
const failures = matched === null ? 1 : total - checks
const summary = {
  metrics: { durationMs: control === 'break-budget' ? 999_999 : durationMs, checks, total, failures },
  hashes: {},
  artifacts: [],
  notes: output.trim().split('\n').slice(-4).join('\n').slice(0, 2000),
}
if (summaryPath) writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
if (control === 'break-budget') {
  console.error(`benchmark: control reports ${summary.metrics.durationMs} ms against a 60000 ms budget`)
  process.exit(1)
}
if (matched === null || result.status !== 0) {
  console.error(output.split('\n').slice(-12).join('\n'))
  process.exit(result.status === 0 ? 1 : (result.status ?? 1))
}
process.exit(0)
