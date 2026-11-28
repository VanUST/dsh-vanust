#!/usr/bin/env node
/**
 * PURPOSE
 *   Make the outline saving MEASURABLE and repeatable on the kit's own sources. For every
 *   file it reports three numbers the prompt claims:
 *     1. `outline` alone (symbols with line ranges, no bodies);
 *     2. `outline + the MEDIAN symbol body` (the cheap follow-up a model actually needs);
 *     3. `outline + the LARGEST symbol body` (the worst-case follow-up).
 *   A generated bundle — one symbol spanning the file — is marked `no-gain`, because there the
 *   outline is the file.
 *
 * WHAT IT DOES NOT DO
 *   It does not register the tool, change the prompt or write state. It runs the pinned
 *   `code-skeleton-mcp` binary the outline plugin uses, so the numbers are the bytes a model
 *   would receive.
 *
 * USAGE
 *   node scripts/outline-bench.mjs [--json] [--bin <path>] [file ...]
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const KIT = process.cwd()
const argv = process.argv.slice(2)
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const bin = flag('--bin') ?? process.env.OUTLINE_BIN ?? 'code-skeleton-mcp'

const DEFAULT_FILES = [
  'plugins/taskboard/taskboard.mjs',
  'plugins/test-cases/test-cases.mjs',
  'plugins/project-state/lib/core.mjs',
  'plugins/orchestrator/orchestrator.mjs',
  'plugins/analysis/analysis.mjs',
  'plugins/designmap/src/pages.mjs',
  'plugins/tool-families/tool-families.mjs',
  'plugins/outline/outline.mjs',
  'scripts/provision-tools.mjs',
  'plugins/designmap/client.js',
  'plugins/project-state-panel/client.js',
]
const explicit = argv.filter((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--bin')
const files = explicit.length > 0 ? explicit : DEFAULT_FILES

const bytes = (text) => Buffer.byteLength(text ?? '', 'utf8')
const median = (list) => { const sorted = [...list].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0 }

function outlineOf(file) {
  const result = spawnSync(bin, ['outline', join(KIT, file), '--depth', '1'], { encoding: 'utf8', timeout: 30_000 })
  if (result.status !== 0 || typeof result.stdout !== 'string' || result.stdout.trim() === '') return null
  try { return JSON.parse(result.stdout) } catch { return null }
}

const linesOf = (text) => text.split('\n')
const rows = []
for (const file of files) {
  let text = ''
  try { text = readFileSync(join(KIT, file), 'utf8') } catch { continue }
  const full = bytes(text)
  const lines = linesOf(text)
  const outline = outlineOf(file)
  if (outline === null) {
    rows.push({ file, full, outline: null, medianPair: null, largestPair: null, symbols: 0, noGain: true, note: 'outline failed (unsupported or binary missing)' })
    continue
  }
  const outlineBytes = bytes(JSON.stringify(outline))
  const symbols = Array.isArray(outline.symbols) ? outline.symbols : []
  const spans = symbols.map((symbol) => Math.max(1, Number(symbol.endLine ?? symbol.line ?? 1) - Number(symbol.line ?? 1) + 1))
  const bodyBytesAt = (span) => {
    if (symbols.length === 0) return 0
    // The body is the symbol's own line range, not the whole file: the pair a model reads after
    // the outline. Measured on the file's bytes-per-line, which is stable enough for a budget.
    return Math.round((full / Math.max(1, lines.length)) * span)
  }
  const medianSpan = median(spans)
  const largestSpan = spans.length > 0 ? Math.max(...spans) : 0
  const generated = symbols.length <= 1 || /(^|\/)(client|dist|vendor)[^/]*\.js$/.test(file)
  rows.push({
    file,
    full,
    outline: outlineBytes,
    symbols: symbols.length,
    medianSpan,
    largestSpan,
    medianPair: outlineBytes + bodyBytesAt(medianSpan),
    largestPair: outlineBytes + bodyBytesAt(largestSpan),
    savingOutline: full === 0 ? 0 : 1 - outlineBytes / full,
    savingMedian: full === 0 ? 0 : 1 - (outlineBytes + bodyBytesAt(medianSpan)) / full,
    savingLargest: full === 0 ? 0 : 1 - (outlineBytes + bodyBytesAt(largestSpan)) / full,
    noGain: generated,
    note: generated ? 'generated bundle: one symbol spans the file, no outline gain' : '',
  })
}

function runNegativeControl(file, wanted) {
  const text = readFileSync(join(KIT, file), 'utf8')
  const lines = text.split('\n')
  const outline = outlineOf(file)
  if (outline === null) { console.log(JSON.stringify({ ok: false, code: 'outline_failed', file })); return }
  const symbols = Array.isArray(outline.symbols) ? outline.symbols : []
  const hit = symbols.find((symbol) => String(symbol.name ?? '').toLowerCase().includes(wanted.toLowerCase()))
  const outlineBytes = bytes(JSON.stringify(outline))
  const full = bytes(text)
  const body = hit === undefined ? 0 : bytes(lines.slice(Math.max(0, Number(hit.line) - 1), Number(hit.endLine)).join('\n'))
  const withOutline = outlineBytes + body
  console.log(JSON.stringify({
    task: `find ${wanted} in ${file}`,
    fullReadBytes: full,
    outlineBytes,
    symbol: hit === undefined ? null : { name: hit.name, kind: hit.kind, line: hit.line, endLine: hit.endLine, bodyBytes: body },
    withOutlineBytes: withOutline,
    withoutOutlineBytes: full,
    saving: full === 0 ? 0 : 1 - withOutline / full,
    tokensApprox: { withOutline: Math.ceil(withOutline / 4), withoutOutline: Math.ceil(full / 4) },
  }, null, 2))
}

const findIndex = argv.indexOf('--find')
const findFile = findIndex >= 0 ? argv[findIndex + 1] : undefined
const findSymbol = findIndex >= 0 ? argv[findIndex + 2] : undefined
if (findFile !== undefined && findSymbol !== undefined) { runNegativeControl(findFile, findSymbol); process.exit(0) }

const fmt = (value) => (value === null ? '—' : String(value))
const totals = rows.filter((row) => row.outline !== null && !row.noGain).reduce((sum, row) => ({
  full: sum.full + row.full,
  outline: sum.outline + row.outline,
  medianPair: sum.medianPair + row.medianPair,
  largestPair: sum.largestPair + row.largestPair,
}), { full: 0, outline: 0, medianPair: 0, largestPair: 0 })

if (argv.includes('--json')) {
  console.log(JSON.stringify({ bin, rows, totals: { ...totals, savingOutline: totals.full === 0 ? 0 : 1 - totals.outline / totals.full, savingMedian: 1 - totals.medianPair / totals.full, savingLargest: 1 - totals.largestPair / totals.full } }, null, 2))
} else {
  console.log(`outline bench — binary ${bin}; bytes are UTF-8; saving = 1 - outline_pair/full\n`)
  console.log('file'.padEnd(44), 'full'.padStart(8), 'outline'.padStart(8), 'medPair'.padStart(9), 'maxPair'.padStart(9), 'cut%'.padStart(6), 'note')
  for (const row of rows) {
    const cut = row.full === 0 || row.outline === null ? null : (row.noGain ? 0 : Math.round((1 - row.outline / row.full) * 100))
    console.log(row.file.padEnd(44), fmt(row.full).padStart(8), fmt(row.outline).padStart(8), fmt(row.medianPair).padStart(9), fmt(row.largestPair).padStart(9), `${cut === null ? '—' : `${cut}%${row.noGain ? ' no-gain' : ''}`}`.padStart(14), row.note)
  }
  console.log('')
  console.log(`TOTAL (non-generated): full ${totals.full} B, outline ${totals.outline} B (${Math.round((1 - totals.outline / totals.full) * 100)}% cut), outline+median ${totals.medianPair} B (${Math.round((1 - totals.medianPair / totals.full) * 100)}%), outline+largest ${totals.largestPair} B (${Math.round((1 - totals.largestPair / totals.full) * 100)}%)`)
}
process.exit(0)
