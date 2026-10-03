/**
 * PURPOSE
 *   Turn a DeepSeek platform usage export into an aggregate cost/token report, and REFUSE to
 *   emit any row-level identity field while doing it.
 *
 *   The export files carry a `user_id`, a partially masked `api_key` and an `api_key_name` per
 *   row. Those are not aggregate data: the account id is stable, the masked key is key-derived
 *   material, and the key names are an inventory of where the account is used. A report about
 *   model cost does not need any of them, and this repository is public — so the tool drops
 *   those columns before it aggregates and then re-reads its own output to prove it.
 *
 *   That last step is the point. "The report is redacted" is a claim; `--check` is the command
 *   that fails when it is false, so the claim is enforced rather than asserted.
 *
 * INPUTS
 *   `--dir <path>`      Directory holding the two export CSVs (`cost-*.csv`, `amount-*.csv`).
 *                       A zip must be extracted first: this tool carries no archive support, so
 *                       it has no dependency and behaves the same on Linux and Windows.
 *   `--cost <file>`     Explicit cost CSV, instead of discovering it in `--dir`.
 *   `--amount <file>`   Explicit amount CSV, instead of discovering it in `--dir`.
 *   `--out <file>`      Write the report to a file instead of stdout.
 *   `--check`           Do not print the report; exit 0 only when the report contains no
 *                       identity material, and 1 with the offending evidence when it does.
 *   `--json`            Emit the aggregates as JSON instead of markdown.
 *
 * OUTPUTS
 *   Markdown (default) or JSON on stdout, or written to `--out`. Exit 0 on success, 1 when
 *   `--check` finds identity material or a required input is missing, 2 on a usage error.
 *   `--check` prints `usage analysis ok` on success — the marker a shell gate greps for.
 *
 * KEYWORDS
 *   usage, cost, tokens, model policy, redaction, deepseek platform, export, analysis
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `--dir` and no explicit file, or a directory with no matching CSV: exit 2 naming what
 *     was looked for, rather than printing an empty report that reads like "no usage".
 *   - A row whose numeric field is blank or unparseable: counted as 0, never as NaN, so one
 *     malformed row cannot turn a whole total into `NaN`.
 *   - `request_count` rows carry no price; they are counted as requests and excluded from cost.
 *   - An export with no `cost` rows: the cost table is reported as absent, not as zero spend.
 *   - A single model, a single day, or a single API key: every table still renders, with one row.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

/**
 * Columns that must never appear in a report, whatever the export contains.
 *
 * Matched case-insensitively against the CSV header, so an export that renames `user_id` to
 * `User ID` is still dropped rather than silently copied through.
 */
const IDENTITY_COLUMNS = ['user_id', 'userid', 'user id', 'api_key', 'api key', 'apikey', 'api_key_name', 'api key name', 'key_name']

/**
 * Shapes that count as leaked identity material in the RENDERED report.
 *
 * The key pattern is deliberately loose: a DeepSeek key is `sk-` followed by a long run, and a
 * masked key keeps the prefix, so `sk-` plus six alphanumerics catches both the masked and the
 * unmasked spelling without needing to know the platform's exact format.
 */
const LEAK_PATTERNS = [
  { id: 'api-key-material', pattern: /sk-[A-Za-z0-9]{6,}/, why: 'an API key or a truncated API key reached the report' },
  { id: 'uuid', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, why: 'an account or record identifier reached the report' },
  { id: 'authorization-header', pattern: /(bearer|authorization)\s+[A-Za-z0-9._-]{8,}/i, why: 'a credential-shaped header reached the report' },
]

const USAGE = [
  'Usage: node scripts/analyze-usage.mjs --dir <extracted-export> [--out <file>] [--check] [--json]',
  '',
  '  --dir <path>     directory holding cost-*.csv and amount-*.csv',
  '  --cost <file>    explicit cost CSV',
  '  --amount <file>  explicit amount CSV',
  '  --out <file>     write the report here instead of stdout',
  '  --check          exit 0 only when the report carries no identity material',
  '  --json           emit aggregates as JSON instead of markdown',
].join('\n')

/**
 * Parse argv.
 *
 * @param argv - Arguments after the script name.
 * @returns The resolved options.
 * @throws On an unknown flag or a flag without a value.
 */
function parseArgs(argv) {
  const options = { dir: null, cost: null, amount: null, out: null, check: false, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      i += 1
      return value
    }
    switch (arg) {
      case '--dir': options.dir = next(); break
      case '--cost': options.cost = next(); break
      case '--amount': options.amount = next(); break
      case '--out': options.out = next(); break
      case '--check': options.check = true; break
      case '--json': options.json = true; break
      case '--help': options.help = true; break
      default: throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

/**
 * Read one export CSV into objects, dropping every identity column.
 *
 * The drop happens HERE, at the parse boundary, so no later stage can reintroduce a field it
 * never received. A value is returned only for the columns this analysis uses.
 *
 * @param path - Absolute path to the CSV.
 * @returns `{ rows, columns, dropped }`: parsed rows, the retained header names, and the
 *   identity columns that were present and removed.
 */
function readExport(path) {
  const lines = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  const header = lines[0].split(',').map((cell) => cell.trim())
  const dropped = header.filter((name) => IDENTITY_COLUMNS.includes(name.toLowerCase()))
  const keep = header.filter((name) => !IDENTITY_COLUMNS.includes(name.toLowerCase()))
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',')
    const row = {}
    keep.forEach((name) => {
      row[name] = cells[header.indexOf(name)]
    })
    return row
  })
  // HOW MANY credentials the account used is a safe aggregate; WHICH ones is not. The values
  // exist only here, before the column is dropped, so the count is taken here — and only the
  // count leaves. Reading it back off a parsed row would always yield 0, because the column is
  // already gone by then.
  const nameIndex = header.findIndex((name) => ['api_key_name', 'api key name', 'key_name'].includes(name.toLowerCase()))
  let distinctKeys = 0
  if (nameIndex !== -1) {
    const names = new Set()
    for (const line of lines.slice(1)) {
      const value = line.split(',')[nameIndex]
      if (value !== undefined && value !== '') names.add(value)
    }
    distinctKeys = names.size
  }
  return { rows, columns: keep, dropped, distinctKeys }
}

/**
 * Parse a numeric cell, tolerating blanks and junk.
 *
 * @param value - The raw cell.
 * @returns A finite number; 0 for anything unparseable, so one malformed row cannot poison a
 *   whole total with `NaN`.
 */
function number(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Aggregate both exports.
 *
 * @param costRows - Rows from the cost export.
 * @param amountRows - Rows from the amount export.
 * @returns `{ models, totalCost, byModel, totals, period, keyCount, dropped }`.
 */
function aggregate(costRows, amountRows, keyCount) {
  const byModel = new Map()
  const ensure = (model) => {
    if (!byModel.has(model)) byModel.set(model, { model, cost: 0, requests: 0, cacheHit: 0, cacheMiss: 0, output: 0 })
    return byModel.get(model)
  }
  for (const row of costRows) ensure(row.model).cost += number(row.cost)
  for (const row of amountRows) {
    const entry = ensure(row.model)
    const amount = number(row.amount)
    if (row.type === 'request_count') entry.requests += amount
    else if (row.type === 'input_cache_hit_tokens') entry.cacheHit += amount
    else if (row.type === 'input_cache_miss_tokens') entry.cacheMiss += amount
    else if (row.type === 'output_tokens') entry.output += amount
  }
  const models = [...byModel.values()].map((entry) => ({
    ...entry,
    billable: entry.cacheMiss + entry.output,
    tokens: entry.cacheHit + entry.cacheMiss + entry.output,
  }))
  models.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
  const totalCost = models.reduce((sum, entry) => sum + entry.cost, 0)
  const totals = models.reduce(
    (acc, entry) => ({
      requests: acc.requests + entry.requests,
      cacheHit: acc.cacheHit + entry.cacheHit,
      cacheMiss: acc.cacheMiss + entry.cacheMiss,
      output: acc.output + entry.output,
      billable: acc.billable + entry.billable,
      tokens: acc.tokens + entry.tokens,
    }),
    { requests: 0, cacheHit: 0, cacheMiss: 0, output: 0, billable: 0, tokens: 0 },
  )
  const starts = [...costRows, ...amountRows].map((row) => row.start_time_iso).filter(Boolean).sort()
  const ends = [...costRows, ...amountRows].map((row) => row.end_time_iso).filter(Boolean).sort()
  return {
    models,
    totalCost,
    totals,
    period: { from: starts[0] ?? null, to: ends[ends.length - 1] ?? null },
    keyCount,
  }
}

/**
 * Render the aggregates as markdown.
 *
 * @param summary - The result of {@link aggregate}.
 * @param sources - `{ cost, amount }` base filenames, for the provenance line.
 * @returns The report text. Contains no identity material by construction, which `--check`
 *   verifies rather than assumes.
 */
function renderMarkdown(summary, sources) {
  const money = (n) => `$${n.toFixed(4)}`
  const num = (n) => n.toLocaleString('en-US')
  const lines = []
  lines.push(`# Usage analysis — ${summary.period.from ?? 'unknown'} → ${summary.period.to ?? 'unknown'}`)
  lines.push('')
  lines.push('Aggregated from a DeepSeek platform usage export. **The export files are not in this')
  lines.push('repository**: they carry an account id, partially masked API key strings and the key')
  lines.push('names in use, none of which a cost report needs. Reproduce this file with')
  lines.push('`node scripts/analyze-usage.mjs --dir <extracted-export>`, which drops those columns at')
  lines.push('the parse boundary and re-reads its own output before printing it.')
  lines.push('')
  lines.push(`Sources: \`${sources.cost}\`, \`${sources.amount}\`.`)
  lines.push('')
  lines.push('## Cost by model')
  lines.push('')
  if (summary.models.every((m) => m.cost === 0)) {
    lines.push('_The export carried no cost rows, so no spend can be attributed._')
  } else {
    lines.push('| model | cost (USD) | share of spend |')
    lines.push('|---|---:|---:|')
    for (const m of summary.models) {
      const share = summary.totalCost > 0 ? ((m.cost / summary.totalCost) * 100).toFixed(1) : '0.0'
      lines.push(`| \`${m.model}\` | ${money(m.cost)} | ${share}% |`)
    }
    lines.push(`| **total** | **${money(summary.totalCost)}** | 100% |`)
  }
  lines.push('')
  lines.push('## Tokens and requests by model')
  lines.push('')
  lines.push('| model | requests | input cache-hit | input cache-miss | output | billable |')
  lines.push('|---|---:|---:|---:|---:|---:|')
  for (const m of summary.models) {
    lines.push(`| \`${m.model}\` | ${num(m.requests)} | ${num(m.cacheHit)} | ${num(m.cacheMiss)} | ${num(m.output)} | ${num(m.billable)} |`)
  }
  lines.push(`| **total** | **${num(summary.totals.requests)}** | **${num(summary.totals.cacheHit)}** | **${num(summary.totals.cacheMiss)}** | **${num(summary.totals.output)}** | **${num(summary.totals.billable)}** |`)
  lines.push('')
  lines.push('## What the data says')
  lines.push('')
  const hitShare = summary.totals.tokens > 0 ? (summary.totals.cacheHit / summary.totals.tokens) * 100 : 0
  lines.push(`- **${hitShare.toFixed(1)}% of all tokens were cache hits.** ${num(summary.totals.cacheHit)} of ${num(summary.totals.tokens)}.`)
  lines.push(`  The cost lever is therefore cache behaviour, not raw token volume: only ${num(summary.totals.billable)} tokens were billed at the full rate.`)
  const pro = summary.models.find((m) => /pro/.test(m.model))
  if (pro !== undefined) {
    const share = summary.totalCost > 0 ? ((pro.cost / summary.totalCost) * 100).toFixed(1) : '0.0'
    lines.push(`- **The non-Flash tier accounted for ${share}% of spend (${money(pro.cost)}).**`)
    lines.push('  The Flash-only policy is a predictability and blast-radius control on this data, not a large saving: the tier it forbids was already a rounding error by spend.')
  }
  const nonFlash = summary.models.filter((m) => !/flash|pro/.test(m.model))
  if (nonFlash.length > 0) lines.push(`- Models outside the Flash and pro classes: ${nonFlash.map((m) => `\`${m.model}\``).join(', ')}.`)
  lines.push(`- The export referenced ${summary.keyCount} distinct API key name(s). This report deliberately does not say which.`)
  lines.push('')
  return lines.join('\n')
}

/**
 * Find identity material in rendered text.
 *
 * @param text - The report about to be emitted.
 * @returns The findings, each `{ id, why, sample }` with the sample truncated so the check
 *   itself does not republish what it caught.
 */
function findLeaks(text) {
  const findings = []
  for (const { id, pattern, why } of LEAK_PATTERNS) {
    const match = pattern.exec(text)
    if (match !== null) findings.push({ id, why, sample: `${match[0].slice(0, 4)}… (${match[0].length} chars)` })
  }
  return findings
}

/**
 * Entry point.
 *
 * @returns The process exit code.
 */
function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`)
    return 2
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }

  let costPath = options.cost
  let amountPath = options.amount
  if (options.dir !== null) {
    const dir = resolve(options.dir)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      process.stderr.write(`analyze-usage: --dir ${dir} is not a directory\n`)
      return 2
    }
    const files = readdirSync(dir)
    // `join(dir, '')` is the DIRECTORY itself, and `existsSync` accepts a directory — so a name
    // that was not found must stay null rather than become a path that passes the existence
    // check and then fails as EISDIR.
    const found = (pattern) => {
      const name = files.find((entry) => pattern.test(entry))
      return name === undefined ? null : join(dir, name)
    }
    if (costPath === null) costPath = found(/^cost-.*\.csv$/i)
    if (amountPath === null) amountPath = found(/^amount-.*\.csv$/i)
  }
  const isFile = (path) => path !== null && existsSync(path) && statSync(path).isFile()
  if (!isFile(costPath) || !isFile(amountPath)) {
    process.stderr.write(
      `analyze-usage: need both exports. Looked for cost-*.csv and amount-*.csv` +
        `${options.dir === null ? '' : ` in ${resolve(options.dir)}`}.\n` +
        'Extract the platform zip first; this tool carries no archive support.\n',
    )
    return 2
  }

  const cost = readExport(costPath)
  const amount = readExport(amountPath)
  const summary = aggregate(cost.rows, amount.rows, amount.distinctKeys)
  const sources = { cost: basename(costPath), amount: basename(amountPath) }
  const text = options.json ? `${JSON.stringify(summary, null, 2)}\n` : renderMarkdown(summary, sources)

  const leaks = findLeaks(text)
  if (options.check) {
    if (leaks.length > 0) {
      process.stderr.write(`usage analysis FAILED: identity material in the report\n  ${leaks.map((f) => `${f.id} — ${f.why} [${f.sample}]`).join('\n  ')}\n`)
      return 1
    }
    process.stdout.write(
      `usage analysis ok\n  ${summary.models.length} model(s), ${summary.totals.requests.toLocaleString('en-US')} request(s), ` +
        `${cost.dropped.length + amount.dropped.length} identity column(s) dropped at parse\n`,
    )
    return 0
  }
  if (leaks.length > 0) {
    process.stderr.write(`analyze-usage: refusing to emit a report carrying identity material: ${leaks.map((f) => f.id).join(', ')}\n`)
    return 1
  }

  if (options.out !== null) {
    writeFileSync(options.out, text, 'utf8')
    process.stdout.write(`analyze-usage: wrote ${resolve(options.out)}\n`)
  } else {
    process.stdout.write(text)
  }
  return 0
}

process.exit(main())
