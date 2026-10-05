/**
 * PURPOSE
 *   Render an analysis as one self-contained HTML page, so the month's figures
 *   can be read in a browser with no server, no network and no external asset.
 *
 *   A page opened from the filesystem cannot fetch anything: every style, every
 *   bar and every table must already be inside the file. That constraint decides
 *   the shape of this module — the styling is inline in a `<style>` element, the
 *   daily chart is drawn with percentage-height elements rather than a charting
 *   library, and nothing references a URL.
 *
 *   Every value interpolated into the markup is escaped. Model names, use-case
 *   labels and API-key names come from a file the provider wrote, and a page
 *   assembled by string concatenation is exactly where an unescaped `<` turns a
 *   label into markup.
 *
 * INPUTS
 *   `renderHtml(analysis, meta)` takes the object `buildAnalysis` returns and the
 *   same `meta` provenance the Markdown renderer takes.
 *
 * OUTPUTS
 *   A complete HTML document as one string, ending with a newline. No file is
 *   written and no network is touched.
 *
 * KEYWORDS
 *   html, report, self-contained, dashboard, escaping, chart
 *
 * BEHAVIOUR ON EDGE CASES
 *   - An analysis with no token rows renders the page with its sections present
 *     and its figures as `n/a`, rather than an empty document.
 *   - A `null` anywhere renders as `n/a`; `NaN` and `Infinity` are never printed.
 *   - A value that reads like markup is escaped, so a model name containing `&`
 *     or `<` cannot change the document's structure.
 *   - A daily series whose values are all zero draws no bars instead of dividing
 *     by zero.
 */

import { formatNumber, formatPercent, LEGACY_MODELS, POLICY_MODEL } from './analytics.mjs'
import { usd, count } from './report.mjs'

/**
 * Escape a value for interpolation into HTML text or an attribute.
 *
 * @param value - Any value; `null` and `undefined` become an empty string.
 * @returns The value as a string with the five markup-significant characters
 *   replaced by entities.
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Percent for a table cell, tolerating a null ratio. */
function pct(value) {
  return formatPercent(value)
}

/** A number or `n/a`, never `NaN`. */
function num(value, digits = 2) {
  return formatNumber(value, digits)
}

/** The stylesheet, kept in one place so the page is one string. */
const STYLES = `
:root{--bg:#f6f7f9;--panel:#fff;--ink:#12161c;--muted:#5b6673;--line:#e2e6ec;--accent:#2f6fed;--warn:#b45309;--act:#b42318;--ok:#067647;--good:#0b7a52;--bar:#9db8f0}
@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--panel:#161b22;--ink:#e6edf3;--muted:#98a3b1;--line:#283040;--accent:#6f9dff;--warn:#f0b34a;--act:#ff8b7e;--ok:#5fd39b;--good:#5fd39b;--bar:#3f5f9e}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:26px;margin:0 0 6px}
h2{font-size:17px;margin:34px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:14px;margin:0 0 6px}
a{color:var(--accent)}
.sub{color:var(--muted);font-size:13px;margin:0 0 18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin:12px 0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
.kpi .v{font-size:22px;font-weight:650;letter-spacing:-.01em}
.kpi .l{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
.kpi .n{color:var(--muted);font-size:12px;margin-top:6px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
tbody tr:hover{background:color-mix(in srgb,var(--accent) 6%,transparent)}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
.badge.ok{background:color-mix(in srgb,var(--ok) 14%,transparent);color:var(--ok)}
.badge.bad{background:color-mix(in srgb,var(--act) 14%,transparent);color:var(--act)}
.bars{display:flex;flex-direction:column;gap:8px}
.bar-row{display:grid;grid-template-columns:130px 1fr 110px;align-items:center;gap:10px;font-size:13px}
.track{background:color-mix(in srgb,var(--muted) 18%,transparent);border-radius:5px;height:16px;overflow:hidden}
.fill{height:100%;background:var(--bar);border-radius:5px}
.fill.peak{background:var(--act)}
.fill.off{background:var(--ok)}
.amount{text-align:right;font-variant-numeric:tabular-nums}
.chart{display:flex;align-items:flex-end;gap:3px;height:150px;margin:8px 0 4px;padding-top:8px}
.chart .day{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;position:relative}
.chart .b{background:var(--bar);border-radius:3px 3px 0 0;min-height:1px}
.chart .b.peak{background:var(--act)}
.chart-x{display:flex;gap:3px;font-size:10px;color:var(--muted)}
.chart-x span{flex:1;text-align:center;writing-mode:vertical-rl;height:38px}
.finding{border-left:3px solid var(--muted);padding:2px 0 2px 12px;margin:14px 0}
.finding.info{border-color:var(--accent)}
.finding.warn{border-color:var(--warn)}
.finding.act{border-color:var(--act)}
.finding p{margin:0;color:var(--muted);font-size:13.5px}
.finding .usd{font-weight:650;font-size:13.5px}
ul.limits{color:var(--muted);font-size:13px;padding-left:18px}
ul.limits li{margin:5px 0}
.meta{color:var(--muted);font-size:12.5px}
code{background:color-mix(in srgb,var(--muted) 15%,transparent);padding:1px 5px;border-radius:4px;font-size:12.5px}
`

/**
 * Render the self-contained HTML report.
 *
 * @param analysis - The object `buildAnalysis` returns.
 * @param meta - Provenance for the header: `{source, usdPerCny, agentHome,
 *   idleGapMs, offsetMinutes, generatedAt}`.
 * @returns The complete HTML document as one string.
 */
export function renderHtml(analysis, meta = {}) {
  const e = escapeHtml
  const window_ = `${analysis.window.from ?? '?'} .. ${analysis.window.to ?? '?'}`
  const hours = analysis.agentHours
  const actFindings = analysis.insights.filter((insight) => insight.usdLabel === 'at stake')
  const atStake = actFindings.reduce((total, insight) => total + (insight.usd ?? 0), 0)
  const saved = analysis.insights
    .filter((insight) => insight.usdLabel === 'saved')
    .reduce((total, insight) => total + (insight.usd ?? 0), 0)

  const kpi = (value, label, note) =>
    `<div class="kpi"><div class="v">${e(value)}</div><div class="l">${e(label)}</div>${
      note ? `<div class="n">${e(note)}</div>` : ''
    }</div>`

  const rows = (body) => (body.length === 0 ? '' : body.join('\n'))

  // A bar's width is a share of the widest row in that chart, so the largest bar
  // always fills the track and the rest read against it.
  const barRows = (entries) => {
    const widest = Math.max(1e-9, ...entries.map((entry) => entry.value))
    return entries
      .map(
        (entry) => `<div class="bar-row">
        <div>${e(entry.label)}</div>
        <div class="track"><div class="fill ${e(entry.tone ?? '')}" style="width:${((entry.value / widest) * 100).toFixed(2)}%"></div></div>
        <div class="amount">${e(entry.amount)}</div>
      </div>`,
      )
      .join('\n')
  }

  const peakMax = Math.max(analysis.peaks.peakUsd, analysis.peaks.offPeakUsd, 1e-9)
  const bucketMax = Math.max(...analysis.buckets.map((bucket) => bucket.usd), 1e-9)
  const dayMax = Math.max(...analysis.daily.map((day) => day.usd), 1e-9)

  const chart = analysis.daily
    .map((day) => {
      const height = day.usd <= 0 ? 0 : Math.max(2, (day.usd / dayMax) * 100)
      const share = day.peakTokenShare === null ? 'no peak share' : `${(day.peakTokenShare * 100).toFixed(0)}% peak`
      const title = `${day.day}: ${usd(day.usd)} — ${count(day.tokens)} tokens, ${share}`
      return `<div class="day" title="${e(title)}"><div class="b${day.peakTokenShare !== null && day.peakTokenShare > 0.5 ? ' peak' : ''}" style="height:${height.toFixed(2)}%"></div></div>`
    })
    .join('')
  const chartLabels = analysis.daily.map((day) => `<span>${e(day.day.slice(5))}</span>`).join('')

  const useCaseRows = analysis.useCases
    .map((useCase) => {
      const requests = analysis.requestsByKey.find((entry) => entry.key === useCase.key)?.count ?? null
      const perHour =
        hours && useCase.key === hours.key ? usd(hours.perKeyAgentHour?.usd) : 'n/a'
      return `<tr>
        <td>${e(useCase.key)}</td>
        <td class="n">${e(usd(useCase.usd))}</td>
        <td class="n">${e(count(useCase.tokens))}</td>
        <td class="n">${e(pct(useCase.hitRate))}</td>
        <td class="n">${e(pct(useCase.peakTokenShare))}</td>
        <td class="n">${e(count(requests))}</td>
        <td class="n">${e(usd(requests && requests > 0 ? useCase.usd / requests : null, 6))}</td>
        <td class="n">${e(perHour)}</td>
      </tr>`
    })
    .join('\n')

  const modelRows = analysis.models
    .map((model) => {
      const note = model.key === POLICY_MODEL ? '' : LEGACY_MODELS.has(model.key) ? ' (retired alias)' : ' (outside policy)'
      return `<tr>
        <td>${e(model.key)}${e(note)}</td>
        <td class="n">${e(usd(model.usd))}</td>
        <td class="n">${e(count(model.tokens))}</td>
        <td class="n">${e(pct(analysis.money.totalUsd > 0 ? model.usd / analysis.money.totalUsd : null))}</td>
        <td class="n">${e(pct(model.hitRate))}</td>
        <td class="n">${e(pct(model.peakTokenShare))}</td>
      </tr>`
    })
    .join('\n')

  const dailyRows = analysis.daily
    .map(
      (day) => `<tr>
        <td>${e(day.day)}</td>
        <td class="n">${e(usd(day.usd))}</td>
        <td class="n">${e(count(day.tokens))}</td>
        <td class="n">${e(pct(day.peakTokenShare))}</td>
        <td class="n">${e(count(day.requests))}</td>
        <td class="n">${e(day.agentHours === null ? 'n/a' : num(day.agentHours, 2))}</td>
        <td class="n">${e(usd(day.usdPerAgentHour))}</td>
      </tr>`,
    )
    .join('\n')

  const findings = analysis.insights
    .map(
      (insight) => `<div class="finding ${e(insight.severity)}">
      <h3>${e(insight.title)}</h3>
      <p>${e(insight.detail)}</p>
      ${insight.usd === null ? '' : `<p class="usd">Amount ${e(insight.usdLabel ?? 'at stake')}: ${e(usd(insight.usd))}</p>`}
    </div>`,
    )
    .join('\n')

  const reconciliation = analysis.reconciliation.ok
    ? `<p class="meta"><span class="badge ok">reconciled</span> The token breakdown reprices the independent cost ledger exactly across ${e(analysis.reconciliation.checked)} day/model/currency groups, so currency and peak/off-peak attribution are verified rather than inferred.</p>`
    : `<p class="meta"><span class="badge bad">not reconciled</span> The token breakdown disagrees with the billed ledger in ${e(analysis.reconciliation.mismatches.length)} group(s), and ${e(analysis.reconciliation.missingLedger.length)} group(s) appear on one side only. The figures below rest on a breakdown that does not agree with what was billed.</p>`

  const failureBlock =
    analysis.failures.length === 0
      ? ''
      : `<h2>Unmatched prices</h2>
    <p class="meta">${e(analysis.failures.length)} amount row(s) matched no rate-card cell and are excluded from every total. These are the cells the card is missing:</p>
    <table><thead><tr><th>Model</th><th>Bucket</th><th class="n">Price per token</th><th class="n">Rows</th><th class="n">Tokens</th></tr></thead><tbody>
    ${rows(
      analysis.failureSummary
        .slice(0, 30)
        .map(
          (failure) =>
            `<tr><td>${e(failure.model)}</td><td>${e(failure.type)}</td><td class="n">${e(failure.price ?? 'no price')}</td><td class="n">${e(failure.rows)}</td><td class="n">${e(count(failure.tokens))}</td></tr>`,
        ),
    )}
    </tbody></table>`

  const agentSection = !hours
    ? `<p class="meta">No agent-hours were measured, so no per-hour figure is reported. Re-run with <code>--agent-home</code> to supply the local session logs.</p>`
    : `<div class="kpis">
      ${kpi(num(hours.hours, 2), 'Agent-hours', `over ${hours.days} days`)}
      ${kpi(String(hours.peakConcurrency), 'Peak concurrent agents', 'at one instant')}
      ${kpi(usd(hours.perKeyAgentHour?.usd), `Per agent-hour (${hours.key})`, 'the key these hours belong to')}
      ${kpi(count(hours.perKeyAgentHour?.tokens), `Tokens per agent-hour (${hours.key})`, 'input and output')}
    </div>
    <p class="meta">Agent-hours are the union of the intervals in which a session was writing records, so two agents running at once are two agent-hours per clock hour. Raising the idle gap counts long thinking pauses as work; lowering it counts only dense activity.</p>
    ${
      hours.uncoveredSpendUsd > 0
        ? `<p class="meta"><strong>${e(usd(hours.uncoveredSpendUsd))}</strong> of spend sits on ${e(hours.uncoveredDays.length)} day(s) with no session log on this machine (${e(hours.uncoveredDays.join(', '))}) and is excluded from the rates above, because those tokens were produced where this machine's logs cannot see them.</p>`
        : `<p class="meta">Every day with spend also has a session log on this machine, so the hours and the spend cover the same days.</p>`
    }`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DeepSeek usage analytics — ${e(window_)}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
  <h1>DeepSeek API usage analytics</h1>
  <p class="sub">${e(window_)} · ${e(analysis.window.activeDays)} active days · ${e(count(analysis.window.requests))} requests</p>
  ${reconciliation}

  <div class="kpis">
    ${kpi(usd(analysis.money.totalUsd), 'Total spend', `$${analysis.money.USD.toFixed(4)} + ¥${analysis.money.CNY.toFixed(4)} @ ${meta.usdPerCny ?? '?'} CNY/USD`)}
    ${kpi(count(analysis.tokens), 'Tokens', 'input and output')}
    ${kpi(usd(analysis.window.requests > 0 ? analysis.money.totalUsd / analysis.window.requests : null, 6), 'Spend per request', 'average')}
    ${kpi(usd(analysis.peaks.premiumUsd), 'Peak premium', `${pct(analysis.peaks.peakSpendShare)} of spend`)}
    ${kpi(usd(analysis.cache.savedUsd), 'Saved by caching', `${pct(analysis.cache.hitRate)} cache hit rate`)}
    ${kpi(usd(atStake > 0 ? atStake : null), 'Costed findings', `${actFindings.length} worth acting on`)}
  </div>
  ${saved > 0 ? `<p class="meta">Caching is already saving ${e(usd(saved))} a month. The figures below separate that from what is still being lost.</p>` : ''}

  <h2>1 · Peak-window premium</h2>
  <p class="meta">The peak window is billed at exactly twice the off-peak rate. Peak rows are identified by their price, not by an assumption about the clock. Premium ${e(usd(analysis.peaks.premiumUsd))} — the difference between what the peak tokens cost and what the same tokens cost off-peak.</p>
  <div class="bars">
    ${barRows([
      { label: 'Peak', value: analysis.peaks.peakUsd, amount: usd(analysis.peaks.peakUsd), tone: 'peak' },
      { label: 'Off-peak', value: analysis.peaks.offPeakUsd, amount: usd(analysis.peaks.offPeakUsd), tone: 'off' },
    ])}
  </div>
  <p class="meta">Peak carried ${e(pct(analysis.peaks.peakTokenShare))} of tokens and ${e(pct(analysis.peaks.peakSpendShare))} of spend. A fully off-peak month would have cost ${e(usd(analysis.peaks.counterfactualUsd))} instead of ${e(usd(analysis.peaks.peakUsd + analysis.peaks.offPeakUsd))}.</p>

  <h2>2 · Cached input, uncached input, output</h2>
  <div class="bars">
    ${barRows(
      analysis.buckets.map((bucket) => ({
        label: bucket.label,
        value: bucket.usd,
        amount: usd(bucket.usd),
      })),
    )}
  </div>
  <table>
    <thead><tr><th>Bucket</th><th class="n">Tokens</th><th class="n">Spend</th><th class="n">Share</th><th class="n">Native</th></tr></thead>
    <tbody>
    ${rows(
      analysis.buckets.map(
        (bucket) =>
          `<tr><td>${e(bucket.label)}</td><td class="n">${e(count(bucket.tokens))}</td><td class="n">${e(usd(bucket.usd))}</td><td class="n">${e(pct(bucket.share))}</td><td class="n">$${bucket.money.USD.toFixed(4)} / ¥${bucket.money.CNY.toFixed(4)}</td></tr>`,
      ),
    )}
    </tbody>
  </table>
  <p class="meta">An input token costs ${e(usd(analysis.cache.effectiveInputPriceUsdPerMillion))} per million in practice against ${e(usd(analysis.cache.blendedMissPriceUsdPerMillion))} per million if nothing had been cached. A cache miss is the most expensive thing an agent does per token.</p>

  <h2>3 · Consumption of one running agent per hour</h2>
  ${agentSection}

  <h2>4 · By use case</h2>
  <p class="meta">The export labels each key by the use case it was issued for, which is the only use-case signal the bill carries.</p>
  <table>
    <thead><tr><th>Use case</th><th class="n">Spend</th><th class="n">Tokens</th><th class="n">Cache hit</th><th class="n">Peak tokens</th><th class="n">Requests</th><th class="n">Spend/request</th><th class="n">Spend/agent-hour</th></tr></thead>
    <tbody>
${useCaseRows}
    </tbody>
  </table>

  <h2>Models</h2>
  <table>
    <thead><tr><th>Model</th><th class="n">Spend</th><th class="n">Tokens</th><th class="n">Share</th><th class="n">Cache hit</th><th class="n">Peak tokens</th></tr></thead>
    <tbody>
${modelRows}
    </tbody>
  </table>
  ${
    analysis.legacy.tokens > 0
      ? `<p class="meta">Retired model names carried ${e(count(analysis.legacy.tokens))} tokens at ${e(usd(analysis.legacy.actualUsd))}; the current ${e(POLICY_MODEL)} card prices the same tokens at ${e(usd(analysis.legacy.currentCardUsd))}, a premium of ${e(usd(analysis.legacy.premiumUsd))} (${e(pct(analysis.legacy.share))} of that spend). The names are aliases for the same served model, so the premium buys nothing.</p>`
      : ''
  }

  <h2>Daily spend</h2>
  <div class="chart">${chart}</div>
  <div class="chart-x">${chartLabels}</div>
  <details>
    <summary class="meta">Daily table</summary>
    <table>
      <thead><tr><th>Day</th><th class="n">Spend</th><th class="n">Tokens</th><th class="n">Peak tokens</th><th class="n">Requests</th><th class="n">Agent-hours</th><th class="n">Spend/agent-hour</th></tr></thead>
      <tbody>
${dailyRows}
      </tbody>
    </table>
  </details>
${failureBlock}

  <h2>Findings</h2>
${findings}

  <h2>Method and limits</h2>
  <ul class="limits">
    <li>Spend is the export's own <code>price × amount</code>, summed. It is not an estimate.</li>
    <li>Currency and peak/off-peak are recovered from each row's per-token price against the provider's published rate card, then checked against the export's independent cost ledger.</li>
    <li>The rate card holds the current published list plus the retired names it supersedes. A month priced off a different card is reported as unmatched price cells rather than revalued.</li>
    <li>Agent-hours come from local session logs and cover this machine only; spend attributed to them is the matching use-case key's spend, not the whole bill.</li>
    <li>Those logs include the session that ran this tool, so re-running it adds that run's own minutes to the denominator.</li>
    <li>Daily granularity is a property of the export, so peak and off-peak are separable but hour-of-day is not.</li>
    <li>The export is a snapshot, so its last day is partial whenever it was downloaded before the day ended.</li>
  </ul>
  <p class="meta">
    Source: ${e(meta.source ?? 'unknown')}<br>
    Agent time: ${e(meta.agentHome ?? 'not measured')}${meta.idleGapMs ? ` (idle gap ${(meta.idleGapMs / 60000).toFixed(1)} min)` : ''}<br>
    Reporting day: UTC${meta.offsetMinutes >= 0 ? '+' : ''}${e((meta.offsetMinutes ?? 0) / 60)} · generated ${e(meta.generatedAt ?? 'unknown')}
  </p>
</main>
</body>
</html>
`
}
