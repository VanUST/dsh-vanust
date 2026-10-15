/**
 * PURPOSE
 *   The command line entry point for the usage analytics: read a provider usage
 *   export, measure how long the agents on this machine actually ran, and print
 *   and optionally save a report that answers what the month cost, what the peak
 *   window cost above the off-peak rate, how the spend splits across cached
 *   input, uncached input and output, and what an hour of a running agent costs
 *   by use case.
 *
 *   It is the wiring only: reading the export, measuring agent time, computing
 *   and rendering each live in their own module, so the figures can be tested
 *   without a terminal and the report can be rendered without recomputing them.
 *
 * INPUTS
 *   `--export <path>`      the usage `.zip`, or a directory holding its CSVs; when
 *                          omitted, the newest `usage_data_*.zip` is chosen.
 *   `--export-dir <dir>`   directory that search reads (default `~/Downloads`).
 *   `--agent-home <dir>`   harness home whose session logs define agent-hours;
 *                          defaults to the resolved harness home when it has a
 *                          `sessions` directory.
 *   `--no-agent-hours`     skip the session logs entirely.
 *   `--agent-key <name>`   the use case the measured hours belong to (default `dsh`).
 *   `--usd-per-cny <n>`    conversion rate (default 6.667, the provider's own
 *                          Flash-class parity between its two price lists).
 *   `--idle-gap <minutes>` silence that ends an agent interval (default 5).
 *   `--offset <minutes>`   UTC offset that defines a reporting day (default 180).
 *   `--markdown <path>`    also write the Markdown report.
 *   `--json <path>`        also write the analysis as JSON.
 *   `--html <path>`        also write the self-contained HTML report.
 *   `--out-dir <dir>`      write all three there, named `<from>_<to>.<ext>`.
 *   `--open`               open the HTML report in the default browser.
 *   `--check`              write nothing; exit 1 when the report would carry identity
 *                          material.
 *   `--gate`               exit 1 when a spend threshold is exceeded. Implies
 *                          `--max-peak-share` at the deployment default when no
 *                          threshold flag is given.
 *   `--max-peak-share <f>` peak-window share of spend (fraction, 0..1) that fails the
 *                          gate.
 *   `--max-legacy-premium <usd>`  retired-name premium that fails the gate.
 *   `--retired-rate <spec>` an extra `(model, bucket, price)` rate for rows the current
 *                          card cannot price, as `<model>=<bucket>:<price>[@<currency>]`,
 *                          repeatable; lets an export from before a model was retired
 *                          stay analyzable.
 *   `--quiet`              write no console summary.
 *
 * OUTPUTS
 *   The console summary on stdout, the requested files on disk, and exit code 0
 *   when the analysis reconciled and every requested gate check passed, 1 when it
 *   did not, so a red month cannot be piped into a green one. A usage error exits 2
 *   with the help text. The returned object also carries `paths`, `opened` and
 *   `gate`, so a caller can act on what was written and on which threshold failed
 *   without re-deriving either.
 *
 * KEYWORDS
 *   cli, usage analytics, export, agent hours, report, json, html, browser, spend
 *   gate, peak premium, retired rate
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A missing or unreadable export exits 2 naming the path, rather than
 *     reporting a zero-cost month.
 *   - An export whose token breakdown does not reconcile with its own cost ledger
 *     still renders, says so first, and exits 1.
 *   - A harness home with no `sessions` directory is reported as an absent
 *     denominator; the run continues and the per-hour figures print as `n/a`.
 *   - An unreadable session log is named on stderr and the remaining logs still
 *     contribute.
 *   - `--open` without an HTML target writes nothing to open and says so on
 *     stderr, rather than reporting success for a page that does not exist.
 *   - An opener that cannot be started is a warning, not a failure: the report on
 *     disk is complete and the run's exit code reflects reconciliation alone.
 *   - An unknown flag exits 2 rather than being ignored, so a typo cannot silently
 *     change a figure.
 *   - A `--max-peak-share` outside 0..1, a negative `--max-legacy-premium` and a
 *     malformed `--retired-rate` each exit 2 rather than producing a gate whose
 *     verdict means nothing.
 *   - A check whose threshold was not given reports as `skipped` and cannot fail; an
 *     unrequested gate never changes a run's exit code, so every command that used
 *     to succeed still does.
 *   - `--check` does not evaluate the spend gate: it answers only whether the report
 *     is safe to write.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readExport, exportWindow, newestExport } from './usage/export-reader.mjs'
import {
  buildAnalysis,
  DEFAULT_USD_PER_CNY,
  DEFAULT_AGENT_HOUR_KEY,
  evaluateGate,
  renderGate,
  retiredRateKey,
} from './usage/analytics.mjs'
import { renderMarkdown, renderConsole } from './usage/report.mjs'
import { renderHtml } from './usage/report-html.mjs'
import { openInBrowser } from './usage/open-browser.mjs'
import { findLeaks } from './usage/redaction.mjs'
import { OFF_PEAK, TOKEN_BUCKETS } from './usage/price-grid.mjs'
import {
  agentHours,
  collectIntervals,
  DEFAULT_IDLE_GAP_MS,
  DEFAULT_OFFSET_MINUTES,
  summarizeByDay,
} from './usage/agent-hours.mjs'
import { resolveHome as resolveSessionHome } from './session/session-log.mjs'

/** Where a downloaded usage export is looked for when no path is given. */
const DEFAULT_EXPORT_DIR = join(homedir(), 'Downloads')

/**
 * The peak-window share `--gate` fails at when no `--max-peak-share` is given.
 * A quarter of spend is the point at which the peak premium is large enough to be
 * worth moving work for, and is the threshold this kit's own September export
 * exceeds (41.6% of spend on 23.2% of tokens).
 */
export const DEFAULT_MAX_PEAK_SHARE = 0.25

const HELP = `Usage: node scripts/usage-analytics.mjs [--export <usage.zip|dir>] [options]

  --export <path>        usage export (.zip) or a directory holding its CSVs;
                         omitted, the newest usage_data_*.zip is used
  --export-dir <dir>     where that search looks (default ~/Downloads)
  --agent-home <dir>     harness home whose session logs define agent-hours
  --no-agent-hours       do not read session logs
  --agent-key <name>     use case the measured hours belong to (default ${DEFAULT_AGENT_HOUR_KEY})
  --usd-per-cny <n>      conversion rate (default ${DEFAULT_USD_PER_CNY})
  --idle-gap <minutes>   silence that ends an agent interval (default ${DEFAULT_IDLE_GAP_MS / 60000})
  --offset <minutes>     UTC offset defining a reporting day (default ${DEFAULT_OFFSET_MINUTES})
  --markdown <path>      also write the Markdown report
  --json <path>          also write the analysis as JSON
  --html <path>          also write the self-contained HTML report
  --out-dir <dir>        write .html, .md and .json there, named by the export window
  --open                 open the HTML report in the default browser
  --check                write nothing; exit 1 when the report would carry identity material
  --gate                 exit 1 when a spend threshold is exceeded (implies --max-peak-share ${DEFAULT_MAX_PEAK_SHARE})
  --max-peak-share <f>   peak-window share of spend that fails the gate (fraction, 0..1)
  --max-legacy-premium <usd>  retired-name premium that fails the gate
  --retired-rate <spec>  extra rate for a row the current card cannot price, as
                         <model>=<bucket>:<price>[@<currency>] (default currency USD)
  --quiet                write no console summary
  --help                 print this text
`

/**
 * Parse the command line into options.
 *
 * @param argv - Arguments after the script path.
 * @returns `{exportPath, exportDir, agentHome, useAgentHours, agentKey, usdPerCny, idleGapMs,
 *   offsetMinutes, markdownPath, jsonPath, htmlPath, outDir, open, quiet, help}`;
 *   `error` is set instead
 *   when a flag is unknown or a value is missing or not numeric.
 */
export function parseArgs(argv) {
  const options = {
    exportPath: null,
    exportDir: DEFAULT_EXPORT_DIR,
    agentHome: null,
    useAgentHours: true,
    agentKey: DEFAULT_AGENT_HOUR_KEY,
    usdPerCny: DEFAULT_USD_PER_CNY,
    idleGapMs: DEFAULT_IDLE_GAP_MS,
    offsetMinutes: DEFAULT_OFFSET_MINUTES,
    markdownPath: null,
    jsonPath: null,
    htmlPath: null,
    outDir: null,
    open: false,
    check: false,
    gate: false,
    maxPeakShare: null,
    maxLegacyPremiumUsd: null,
    retiredRateSpecs: [],
    retiredRates: null,
    quiet: false,
    help: false,
    error: null,
  }
  const numeric = new Set(['--usd-per-cny', '--idle-gap', '--offset', '--max-peak-share', '--max-legacy-premium'])
  const multiple = new Set(['--retired-rate'])
  const valued = new Set([
    '--export',
    '--export-dir',
    '--agent-home',
    '--agent-key',
    '--markdown',
    '--json',
    '--html',
    '--out-dir',
    ...numeric,
    ...multiple,
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--help' || flag === '-h') {
      options.help = true
      continue
    }
    if (flag === '--quiet') {
      options.quiet = true
      continue
    }
    if (flag === '--no-agent-hours') {
      options.useAgentHours = false
      continue
    }
    if (flag === '--open') {
      options.open = true
      continue
    }
    if (flag === '--check') {
      options.check = true
      continue
    }
    if (flag === '--gate') {
      options.gate = true
      continue
    }
    if (!flag.startsWith('--')) {
      if (options.exportPath === null) {
        options.exportPath = flag
        continue
      }
      options.error = `unexpected argument "${flag}"`
      return options
    }
    if (!valued.has(flag)) {
      options.error = `unknown flag "${flag}"`
      return options
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      options.error = `flag ${flag} needs a value`
      return options
    }
    index += 1
    if (numeric.has(flag)) {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) {
        options.error = `flag ${flag} expects a number, got "${value}"`
        return options
      }
      if (flag === '--usd-per-cny') options.usdPerCny = parsed
      if (flag === '--idle-gap') options.idleGapMs = parsed * 60_000
      if (flag === '--offset') options.offsetMinutes = parsed
      if (flag === '--max-peak-share') options.maxPeakShare = parsed
      if (flag === '--max-legacy-premium') options.maxLegacyPremiumUsd = parsed
      continue
    }
    if (multiple.has(flag)) {
      options.retiredRateSpecs.push(value)
      continue
    }
    if (flag === '--export') options.exportPath = value
    if (flag === '--export-dir') options.exportDir = value
    if (flag === '--agent-home') options.agentHome = value
    if (flag === '--agent-key') options.agentKey = value
    if (flag === '--markdown') options.markdownPath = value
    if (flag === '--json') options.jsonPath = value
    if (flag === '--html') options.htmlPath = value
    if (flag === '--out-dir') options.outDir = value
  }
  // A share is a fraction of spend: 1.5 would silently pass every possible export,
  // and a negative premium cap would silently fail every one. Both are rejected here
  // rather than producing a gate whose verdict means nothing.
  if (options.maxPeakShare !== null && (options.maxPeakShare < 0 || options.maxPeakShare > 1)) {
    options.error = `flag --max-peak-share expects a fraction between 0 and 1, got "${options.maxPeakShare}"`
    return options
  }
  if (options.maxLegacyPremiumUsd !== null && options.maxLegacyPremiumUsd < 0) {
    options.error = `flag --max-legacy-premium expects a non-negative amount, got "${options.maxLegacyPremiumUsd}"`
    return options
  }
  // Any threshold OR a bare --gate turns the gate on. Without either, the run behaves
  // exactly as before, so nothing that used to print a report now exits non-zero.
  if (options.gate || options.maxPeakShare !== null || options.maxLegacyPremiumUsd !== null) {
    options.gate = true
    if (options.maxPeakShare === null && options.maxLegacyPremiumUsd === null) {
      options.maxPeakShare = DEFAULT_MAX_PEAK_SHARE
    }
  }
  // Retired rates are parsed here so a malformed spec fails with the help text rather
  // than being dropped, which would silently leave rows unclassified.
  if (options.retiredRateSpecs.length > 0) {
    options.retiredRates = new Map()
    for (const spec of options.retiredRateSpecs) {
      try {
        const parsed = parseRetiredRate(spec)
        options.retiredRates.set(retiredRateKey(parsed.model, parsed.type, parsed.price), {
          currency: parsed.currency,
          window: parsed.window,
        })
      } catch (error) {
        options.error = String(error?.message ?? error)
        return options
      }
    }
  }
  return options
}

/**
 * Parse one `--retired-rate` spec.
 *
 * Format: `<model>=<bucket>:<price>[@<currency>]`, currency defaulting to USD.
 * The window is off-peak, because a retired card is being reconstructed to keep an
 * old export readable and the peak window is represented as the off-peak rate times
 * the peak multiplier; a retiree's peak rows are expressed by doubling the price in
 * a second spec rather than by a window suffix.
 *
 * @param spec - The raw flag value.
 * @returns `{model, type, price, currency, window}`.
 * @throws With a message naming the expected format when the spec does not parse.
 */
export function parseRetiredRate(spec) {
  const shape = 'expected <model>=<bucket>:<price>[@<currency>]'
  const eq = typeof spec === 'string' ? spec.indexOf('=') : -1
  if (eq <= 0) throw new Error(`--retired-rate "${spec}": ${shape}`)
  const model = spec.slice(0, eq).trim()
  const rest = spec.slice(eq + 1)
  const colon = rest.indexOf(':')
  if (colon <= 0) throw new Error(`--retired-rate "${spec}": ${shape}`)
  const type = rest.slice(0, colon).trim()
  const priceAndCurrency = rest.slice(colon + 1)
  const at = priceAndCurrency.indexOf('@')
  const priceText = (at >= 0 ? priceAndCurrency.slice(0, at) : priceAndCurrency).trim()
  const currency = (at >= 0 ? priceAndCurrency.slice(at + 1) : 'USD').trim().toUpperCase()
  const price = Number(priceText)
  if (model.length === 0) throw new Error(`--retired-rate "${spec}": empty model name`)
  if (!TOKEN_BUCKETS.includes(type)) {
    throw new Error(`--retired-rate "${spec}": bucket must be one of ${TOKEN_BUCKETS.join(', ')}`)
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`--retired-rate "${spec}": price must be a positive number, got "${priceText}"`)
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`--retired-rate "${spec}": currency must be a three-letter code, got "${currency}"`)
  }
  return { model, type, price, currency, window: OFF_PEAK }
}

/**
 * Resolve which harness home supplies the agent-hours, or none.
 *
 * @param options - Parsed options.
 * @returns `{home, reason}`; `home` is `null` when agent-hours are disabled or no
 *   home holds a `sessions` directory, and `reason` says which.
 */
export function resolveAgentHome(options) {
  if (!options.useAgentHours) return { home: null, reason: 'disabled with --no-agent-hours' }
  const home = options.agentHome === null ? resolveSessionHome() : resolve(options.agentHome)
  if (!existsSync(resolve(home, 'sessions'))) {
    return { home: null, reason: `no sessions directory under ${home}` }
  }
  return { home, reason: null }
}

/**
 * Write text to a path, creating the parent directory when it is missing.
 *
 * @param path - Destination path.
 * @param text - Content to write.
 * @returns The resolved absolute path written.
 */
function writeOutput(path, text) {
  const target = resolve(path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text, 'utf8')
  return target
}

/**
 * Run the analytics end to end.
 *
 * @param options - Parsed options from `parseArgs`.
 * @returns `{exitCode, summary, analysis}`; `exitCode` is 1 when the export did
 *   not reconcile.
 * @throws When the export path is absent or unreadable.
 */
export function run(options) {
  const exportPath = resolve(options.exportPath)
  const exported = readExport(exportPath)

  const { home, reason } = resolveAgentHome(options)
  // The denominator must cover the same window as the numerator, so the export's
  // own row intervals bound the records considered rather than the calendar.
  const exportBounds = exportWindow(exported.amounts, exported.costs, options.offsetMinutes)
  let agentHourData = null
  const warnings = []
  if (home === null) {
    warnings.push(`agent-hours not measured: ${reason}`)
  } else {
    const collected = collectIntervals(home, {
      idleGapMs: options.idleGapMs,
      windowStartMs: exportBounds.startMs,
      windowEndMs: exportBounds.endMs,
      sinceMs: exportBounds.startMs,
    })
    for (const failure of collected.unreadable) {
      warnings.push(`unreadable session log ${failure.path}: ${failure.reason}`)
    }
    const byDay = agentHours(summarizeByDay(collected.intervals, options.offsetMinutes))
    agentHourData = {
      byDay,
      total: byDay.get('__total__'),
      sessions: collected.sessions,
      considered: collected.considered,
    }
  }

  const analysis = buildAnalysis({
    amounts: exported.amounts,
    costs: exported.costs,
    usdPerCny: options.usdPerCny,
    agentHourData,
    // The caller names a USE CASE; the rows carry an opaque label. Resolving here keeps
    // the name out of every artifact: a name the export does not carry stays a literal
    // that matches no row, which is what naming an unused key has always meant.
    agentHourKey: exported.useCases.label(options.agentKey),
    retiredRates: options.retiredRates ?? null,
  })

  const meta = {
    source: exportPath,
    usdPerCny: options.usdPerCny,
    agentHome: home,
    idleGapMs: home === null ? null : options.idleGapMs,
    offsetMinutes: options.offsetMinutes,
    generatedAt: new Date().toISOString(),
  }

  const markdown = renderMarkdown(analysis, meta)
  const summary = renderConsole(analysis, meta)

  // The spend gate answers a different question from the redaction gate below: not
  // "is this report safe to write" but "is this month's bill acceptable". It is
  // evaluated before anything is written so a failing gate cannot leave a report
  // behind that a caller mistakes for an accepted run. `--gate` only turns the check
  // on; it never changes a figure.
  const gate = options.gate
    ? evaluateGate(analysis, {
        maxPeakShare: options.maxPeakShare,
        maxLegacyPremiumUsd: options.maxLegacyPremiumUsd,
      })
    : null

  // THE GATE. The reader drops the identity columns, but a report can still carry
  // identity material through a value that was never one of those columns — a key-shaped
  // model name, an account id echoed from a filename. So the FINISHED report is scanned,
  // every format, and a leaking report is refused rather than written. `--check` is the
  // same scan without producing anything, which is what makes "the report is redacted" a
  // command a shell gate can run instead of a claim about the templates.
  const html = renderHtml(analysis, meta)
  const json = JSON.stringify({ meta, analysis, agentHourSessions: agentHourData?.sessions ?? null }, null, 2) + '\n'
  const leaks = [
    ...findLeaks(markdown).map((finding) => ({ ...finding, format: 'markdown' })),
    ...findLeaks(html).map((finding) => ({ ...finding, format: 'html' })),
    ...findLeaks(json).map((finding) => ({ ...finding, format: 'json' })),
  ]

  if (options.check) {
    if (leaks.length > 0) {
      process.stderr.write(
        `usage analysis FAILED: identity material in the report\n  ${leaks.map((f) => `${f.format}/${f.id} — ${f.why} [${f.sample}]`).join('\n  ')}\n`,
      )
      return { exitCode: 1, summary, analysis, leaks, paths: { markdownPath: null, jsonPath: null, htmlPath: null }, opened: null }
    }
    process.stdout.write(
      `usage analysis ok\n  ${analysis.models.length} model(s), ${String(exported.useCases.size)} use case(s), ` +
        `${exported.dropped.length} identity column(s) dropped at parse\n`,
    )
    return { exitCode: 0, summary, analysis, leaks: [], paths: { markdownPath: null, jsonPath: null, htmlPath: null }, opened: null }
  }
  if (leaks.length > 0) {
    process.stderr.write(
      `usage-analytics: refusing to write a report carrying identity material: ${leaks.map((f) => `${f.format}/${f.id}`).join(', ')}\n`,
    )
    return { exitCode: 1, summary, analysis, leaks, paths: { markdownPath: null, jsonPath: null, htmlPath: null }, opened: null }
  }

  if (!options.quiet) process.stdout.write(summary)
  for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`)
  if (gate) process.stdout.write(renderGate(gate))

  // `--out-dir` names the three artifacts after the window the export covers, so a
  // month's reports sit side by side under one name rather than under whatever the
  // caller remembered to type. An explicit path still wins for that one format.
  const stem = `${analysis.window.from ?? 'unknown'}_${analysis.window.to ?? 'unknown'}`
  const namedPath = (format, explicit) =>
    explicit ?? (options.outDir === null ? null : join(options.outDir, `${stem}.${format}`))

  const markdownPath = namedPath('md', options.markdownPath)
  const jsonPath = namedPath('json', options.jsonPath)
  const htmlPath = namedPath('html', options.htmlPath)

  if (markdownPath) {
    const written = writeOutput(markdownPath, markdown)
    if (!options.quiet) process.stdout.write(`\nmarkdown report: ${written}\n`)
  }
  if (jsonPath) {
    const written = writeOutput(jsonPath, json)
    if (!options.quiet) process.stdout.write(`json: ${written}\n`)
  }

  let opened = null
  if (htmlPath) {
    const written = writeOutput(htmlPath, html)
    if (!options.quiet) process.stdout.write(`html report: ${written}\n`)
    if (options.open) {
      opened = openInBrowser(written)
      if (!options.quiet) {
        process.stdout.write(
          opened.opened ? `opened in browser: ${written}\n` : `warning: ${opened.guidance}\n`,
        )
      }
    }
  } else if (options.open) {
    // Opening nothing would look like it worked; a report must exist to open one.
    process.stderr.write('warning: --open needs an HTML report; pass --html <path> or --out-dir <dir>\n')
  }

  return {
    exitCode: analysis.reconciliation.ok && (gate === null || gate.ok) ? 0 : 1,
    summary,
    analysis,
    gate,
    paths: { markdownPath, jsonPath, htmlPath },
    opened,
  }
}

/**
 * Command line entry point.
 *
 * @param argv - Arguments after the script path.
 * @returns The process exit code.
 */
export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write(HELP)
    return 0
  }
  if (options.error) {
    process.stderr.write(`${options.error}\n\n${HELP}`)
    return 2
  }
  if (options.exportPath === null) {
    const found = newestExport(options.exportDir)
    if (found === null) {
      process.stderr.write(
        `no usage_data_*.zip found in ${options.exportDir}\n` +
          'Download an export, or pass --export <path>.\n\n' +
          HELP,
      )
      return 2
    }
    options.exportPath = found
  }
  try {
    return run(options).exitCode
  } catch (error) {
    process.stderr.write(`usage analytics failed: ${String(error?.message ?? error)}\n`)
    return 2
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(main())
