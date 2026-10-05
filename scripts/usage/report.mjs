/**
 * PURPOSE
 *   Render an analysis as a report a person reads, in the two shapes the tool
 *   needs: a Markdown document to keep beside the month's export, and a compact
 *   console summary for the terminal.
 *
 *   The report is written to answer the questions a person asks of a bill — what
 *   the peak window cost above the off-peak rate, how the spend splits across
 *   cached input, uncached input and output, what an hour of a running agent
 *   costs and how that differs by use case — and to state plainly which figures
 *   are measured and which are not. A figure whose denominator is missing is
 *   printed as `n/a` rather than dropped, so the absence is visible.
 *
 * INPUTS
 *   `renderMarkdown(analysis, meta)` and `renderConsole(analysis, meta)` take the
 *   object `buildAnalysis` returns, plus `meta`: `{source, usdPerCny, agentHome,
 *   idleGapMs, offsetMinutes, generatedAt}`. An absent `meta` field is rendered as
 *   `unknown` rather than omitted.
 *
 * OUTPUTS
 *   Both return a single string, newline-terminated, containing no trailing
 *   whitespace on any line. Neither writes a file and neither reads one.
 *
 * KEYWORDS
 *   report, markdown, console, cost, peak, cache, agent hour, use case
 *
 * BEHAVIOUR ON EDGE CASES
 *   - An analysis with no token rows renders a report that says the month holds
 *     no billable usage, with the empty tables still present rather than absent.
 *   - A `null` here and there — a missing hit rate, a missing per-hour figure, a
 *     missing reconciliation — renders as `n/a`; it never throws and never prints
 *     `NaN`, `null` or `Infinity`.
 *   - A failed reconciliation is printed above the figures it invalidates, not
 *     below them.
 */

import {
  formatNumber,
  formatPercent,
  LEGACY_MODELS,
  POLICY_MODEL,
} from './analytics.mjs'

/**
 * Format a USD amount for a report.
 *
 * @param value - A USD amount, or `null`.
 * @param digits - Decimal places.
 * @returns A dollar string, or `n/a` when the value is `null` or not finite.
 */
export function usd(value, digits = 4) {
  if (value === null || !Number.isFinite(value)) return 'n/a'
  return `$${value.toFixed(digits)}`
}

/**
 * Format a token count with thousands separators.
 *
 * @param value - A count, or `null`.
 * @returns The grouped count, or `n/a` when the value is `null` or not finite.
 */
export function count(value) {
  if (value === null || !Number.isFinite(value)) return 'n/a'
  return Math.round(value).toLocaleString('en-US')
}

/**
 * Render a ratio as a percentage for a table cell.
 *
 * @param value - A fraction, or `null`.
 * @returns The percentage, or `n/a`.
 */
function pct(value) {
  return formatPercent(value)
}

/**
 * Render the markdown report.
 *
 * @param analysis - The object `buildAnalysis` returns.
 * @param meta - Provenance for the report's header.
 * @returns The Markdown document as one string.
 */
export function renderMarkdown(analysis, meta = {}) {
  const lines = []
  const push = (...values) => lines.push(...values)

  push('# DeepSeek API usage analytics')
  push('')
  push(`- Window: ${analysis.window.from ?? 'unknown'} to ${analysis.window.to ?? 'unknown'} (${analysis.window.activeDays} active days)`)
  push(`- Source: ${meta.source ?? 'unknown'}`)
  push(`- Agent time: ${meta.agentHome ? `local session logs under ${meta.agentHome}` : 'not measured (no session logs supplied)'}`)
  if (meta.idleGapMs) push(`- Idle gap that ends an agent interval: ${(meta.idleGapMs / 60000).toFixed(1)} minutes`)
  if (meta.offsetMinutes !== undefined) push(`- Reporting day offset: UTC${meta.offsetMinutes >= 0 ? '+' : ''}${(meta.offsetMinutes / 60).toFixed(1)}`)
  push(`- CNY converted to USD at ${meta.usdPerCny ?? 'unknown'} CNY/USD`)
  if (meta.generatedAt) push(`- Generated: ${meta.generatedAt}`)
  push('')

  push('## Reconciliation')
  push('')
  if (analysis.reconciliation.ok) {
    push(`The token breakdown reprices the independent cost ledger exactly across ${analysis.reconciliation.checked} day/model/currency groups. Currency and peak/off-peak attribution are therefore verified, not inferred.`)
  } else {
    push(`**The token breakdown does not reconcile with the cost ledger.**`)
    push('')
    for (const mismatch of analysis.reconciliation.mismatches) {
      push(`- ${mismatch.key}: computed ${mismatch.computed.toFixed(8)}, billed ${mismatch.billed.toFixed(8)} (difference ${mismatch.difference.toFixed(8)})`)
    }
    for (const key of analysis.reconciliation.missingLedger) {
      push(`- ${key}: present on one side only`)
    }
    push('')
    push('Figures below rest on a breakdown that disagrees with the billed ledger.')
  }
  if (analysis.failures.length > 0) {
    push('')
    push(`**${analysis.failures.length} amount row(s) matched no rate-card cell and are excluded from every total.** The distinct prices below are the cells the card is missing, largest first:`)
    push('')
    push('| Model | Bucket | Price per token | Rows | Tokens |')
    push('| --- | --- | ---: | ---: | ---: |')
    for (const failure of analysis.failureSummary.slice(0, 30)) {
      push(
        `| ${failure.model} | ${failure.type} | ${failure.price === null ? 'no price' : failure.price} | ${failure.rows} | ${count(failure.tokens)} |`,
      )
    }
    push('')
    push(`A month priced off a card this tool does not hold is reported this way rather than valued at zero, so the totals above exclude ${count(analysis.failures.reduce((sum, failure) => sum + (failure.row.amount ?? 0), 0))} tokens.`)
  }
  push('')

  push('## Headline')
  push('')
  push('| Figure | Value |')
  push('| --- | ---: |')
  push(`| Total spend | ${usd(analysis.money.totalUsd)} |`)
  push(`| Billed natively | $${analysis.money.USD.toFixed(4)} USD + ¥${analysis.money.CNY.toFixed(4)} CNY |`)
  push(`| Tokens | ${count(analysis.tokens)} |`)
  push(`| Requests | ${count(analysis.window.requests)} |`)
  push(`| Spend per request | ${usd(analysis.window.requests > 0 ? analysis.money.totalUsd / analysis.window.requests : null, 6)} |`)
  push(`| Agent-hours measured | ${analysis.agentHours ? formatNumber(analysis.agentHours.hours, 2) : 'n/a'} |`)
  push('')

  push('## 1. What the peak window costs above the off-peak rate')
  push('')
  push('The provider bills the peak window at exactly twice the off-peak rate. Peak tokens are identified per row by their price, not by an assumption about the clock.')
  push('')
  push('| | Peak | Off-peak |')
  push('| --- | ---: | ---: |')
  push(`| Spend | ${usd(analysis.peaks.peakUsd)} | ${usd(analysis.peaks.offPeakUsd)} |`)
  push(`| Tokens | ${count(analysis.peaks.peakTokens)} | ${count(analysis.peaks.offPeakTokens)} |`)
  push(`| Share of spend | ${pct(analysis.peaks.peakSpendShare)} | ${pct(analysis.peaks.peakSpendShare === null ? null : 1 - analysis.peaks.peakSpendShare)} |`)
  push(`| Share of tokens | ${pct(analysis.peaks.peakTokenShare)} | ${pct(analysis.peaks.peakTokenShare === null ? null : 1 - analysis.peaks.peakTokenShare)} |`)
  push('')
  push(`**Premium paid for peak: ${usd(analysis.peaks.premiumUsd)}** — the difference between what the peak tokens cost and what the same tokens cost off-peak. Filling the same work entirely off-peak would have brought the month to ${usd(analysis.peaks.counterfactualUsd)} instead of ${usd(analysis.peaks.peakUsd + analysis.peaks.offPeakUsd)}.`)
  push('')

  push('## 2. Where the money goes: cached input, uncached input, output')
  push('')
  push('| Bucket | Tokens | Spend | Share | Native |')
  push('| --- | ---: | ---: | ---: | ---: |')
  for (const bucket of analysis.buckets) {
    push(`| ${bucket.label} | ${count(bucket.tokens)} | ${usd(bucket.usd)} | ${pct(bucket.share)} | $${bucket.money.USD.toFixed(4)} / ¥${bucket.money.CNY.toFixed(4)} |`)
  }
  push('')
  push(`Cache hit rate over input tokens: **${pct(analysis.cache.hitRate)}**.`)
  push('')
  push(`An input token costs ${usd(analysis.cache.effectiveInputPriceUsdPerMillion)} per million in practice against ${usd(analysis.cache.blendedMissPriceUsdPerMillion)} per million if nothing had been cached — caching is worth ${usd(analysis.cache.savedUsd)} this month.`)
  push('')

  push('## 3. Consumption of one running agent per hour')
  push('')
  if (!analysis.agentHours) {
    push('No agent-hours were measured, so no per-hour figure is reported. Re-run with `--agent-home` to supply the local session logs.')
  } else {
    push(`Measured from this machine's session logs: **${formatNumber(analysis.agentHours.hours, 2)} agent-hours** over ${analysis.agentHours.days} days, with at most ${analysis.agentHours.peakConcurrency} agents alive at once.`)
    push('')
    push(`- Use case \`${analysis.agentHours.key}\`, the key these hours belong to: **${usd(analysis.agentHours.perKeyAgentHour?.usd)} per agent-hour**, ${count(analysis.agentHours.perKeyAgentHour?.tokens)} tokens per agent-hour`)
    push(`- Every use case on the days the hours cover: ${usd(analysis.agentHours.perAgentHourOnCoveredDays?.usd)} per agent-hour, ${count(analysis.agentHours.perAgentHourOnCoveredDays?.tokens)} tokens per agent-hour`)
    push(`- The whole month over these hours, which pairs unlike quantities: ${usd(analysis.agentHours.perAgentHourWholeBill?.usd)} per agent-hour`)
    push('')
    if (analysis.agentHours.uncoveredSpendUsd > 0) {
      push(`${usd(analysis.agentHours.uncoveredSpendUsd)} of spend sits on ${analysis.agentHours.uncoveredDays.length} day(s) with no session log on this machine (`)
      push(`${analysis.agentHours.uncoveredDays.join(', ')}), and is deliberately excluded from the rates above. Those tokens were produced somewhere this machine's logs cannot see, so charging them to these hours would overstate what an hour here costs.`)
    } else {
      push('Every day with spend also has a session log on this machine, so the hours and the spend cover the same days.')
    }
    push('')
    push('Agent-hours are the union of intervals in which a session was writing records, so two agents running at once are two agent-hours per clock hour and not one. The idle gap that ends an interval is a parameter: raise it to count long thinking pauses as work, lower it to count only dense activity.')
  }
  push('')
  push('### By use case')
  push('')
  push('The export labels each key by the use case it was issued for, which is the only use-case signal the bill carries.')
  push('')
  push('| Use case | Tokens | Spend | Share | Cache hit | Peak tokens | Requests | Spend/request | Spend/agent-hour |')
  push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
  const hourKey = analysis.agentHours?.key ?? null
  for (const useCase of analysis.useCases) {
    const requests = analysis.requestsByKey.find((entry) => entry.key === useCase.key)?.count ?? null
    const perHour =
      analysis.agentHours && useCase.key === hourKey
        ? usd(analysis.agentHours.perKeyAgentHour?.usd)
        : 'n/a'
    push(
      `| ${useCase.key} | ${count(useCase.tokens)} | ${usd(useCase.usd)} | ${pct(
        analysis.money.totalUsd > 0 ? useCase.usd / analysis.money.totalUsd : null,
      )} | ${pct(useCase.hitRate)} | ${pct(useCase.peakTokenShare)} | ${count(requests)} | ${usd(
        requests && requests > 0 ? useCase.usd / requests : null,
        6,
      )} | ${perHour} |`,
    )
  }
  push('')
  push('Only one use case has a measured hour denominator, because only the harness writes session logs on this machine; the others report `n/a` rather than a figure divided by hours they did not consume.')
  push('')

  push('## 4. Currency')
  push('')
  push(`The account was billed in USD until it switched to CNY, and the export carries no currency column: the currency of each row is recovered from its per-token price against the provider's paired rate card. This month that is $${analysis.money.USD.toFixed(4)} USD and ¥${analysis.money.CNY.toFixed(4)} CNY, reported as ${usd(analysis.money.totalUsd)} at ${meta.usdPerCny ?? 'unknown'} CNY/USD.`)
  push('')
  push('The rate is a parameter. The provider\'s own two price lists imply 6.667 CNY/USD for the Flash class and 6.818 for the pro class, so a different funding rate changes the converted total while leaving every native figure and every share untouched.')
  push('')

  push('## Models')
  push('')
  push('| Model | Tokens | Spend | Share | Cache hit | Peak tokens |')
  push('| --- | ---: | ---: | ---: | ---: | ---: |')
  for (const model of analysis.models) {
    const note = model.key === POLICY_MODEL ? '' : LEGACY_MODELS.has(model.key) ? ' (retired alias)' : ' (outside policy)'
    push(
      `| ${model.key}${note} | ${count(model.tokens)} | ${usd(model.usd)} | ${pct(
        analysis.money.totalUsd > 0 ? model.usd / analysis.money.totalUsd : null,
      )} | ${pct(model.hitRate)} | ${pct(model.peakTokenShare)} |`,
    )
  }
  if (analysis.legacy.tokens > 0) {
    push('')
    push(
      `Retired model names carried ${count(analysis.legacy.tokens)} tokens at ${usd(analysis.legacy.actualUsd)}; ` +
        `the current ${POLICY_MODEL} card prices the same tokens at ${usd(analysis.legacy.currentCardUsd)}, a premium of ` +
        `${usd(analysis.legacy.premiumUsd)} (${pct(analysis.legacy.share)} of that spend). The names are aliases for the ` +
        'same served model, so the premium buys nothing.',
    )
  }
  push('')

  push('## Daily')
  push('')
  push('| Day | Spend | Tokens | Peak tokens | Requests | Agent-hours | Spend/agent-hour |')
  push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const day of analysis.daily) {
    push(
      `| ${day.day} | ${usd(day.usd)} | ${count(day.tokens)} | ${pct(day.peakTokenShare)} | ${count(day.requests)} | ${
        day.agentHours === null ? 'n/a' : formatNumber(day.agentHours, 2)
      } | ${usd(day.usdPerAgentHour)} |`,
    )
  }
  push('')

  push('## Findings')
  push('')
  for (const insight of analysis.insights) {
    push(`### ${insight.title} (${insight.severity})`)
    push('')
    push(insight.detail)
    if (insight.usd !== null) push('')
    if (insight.usd !== null) push(`Amount ${insight.usdLabel ?? 'at stake'}: ${usd(insight.usd)}`)
    push('')
  }

  push('## Method and limits')
  push('')
  push('- Spend is the export\'s own `price × amount`, summed. It is not an estimate.')
  push('- Currency and peak/off-peak are recovered from each row\'s per-token price against the provider\'s published rate card, and the result is checked against the export\'s independent cost ledger.')
  push('- The rate card holds the current published list plus the retired names it supersedes. A month priced off a different card is reported as unmatched price cells, with the cells listed above, rather than revalued: the tool never invents a rate to make a month add up.')
  push('- Agent-hours come from local session logs and cover this machine only. Spend attributed to them is the spend of the matching use-case key, not the whole bill.')
  push('- Those logs include the session that ran this tool, so re-running it adds that run\'s own minutes to the denominator and agent-hours move slightly between runs.')
  push('- Daily granularity is a property of the export, so peak and off-peak are separable but hour-of-day is not.')
  push('- The export is a snapshot. A day is only as complete as the moment the export was taken, so the last day is partial whenever it was downloaded before the day ended.')
  push('')
  return lines.map((line) => line.replace(/\s+$/, '')).join('\n') + '\n'
}

/**
 * Render the compact console summary.
 *
 * @param analysis - The object `buildAnalysis` returns.
 * @param meta - Provenance, as for `renderMarkdown`.
 * @returns The summary as one string.
 */
export function renderConsole(analysis, meta = {}) {
  const lines = []
  const push = (line = '') => lines.push(line)

  push(`DeepSeek usage ${analysis.window.from ?? '?'}..${analysis.window.to ?? '?'}  (${analysis.window.activeDays} active days)`)
  if (meta.source) push(`source: ${meta.source}`)
  push(
    analysis.reconciliation.ok
      ? `reconciliation: ok (${analysis.reconciliation.checked} day/model/currency groups)`
      : `reconciliation: FAILED (${analysis.reconciliation.mismatches.length} mismatch(es), ${analysis.reconciliation.missingLedger.length} missing)`,
  )
  if (analysis.failures.length > 0) push(`unclassified rows: ${analysis.failures.length} (excluded from totals)`)
  push()
  push(`total spend      ${usd(analysis.money.totalUsd)}   ($${analysis.money.USD.toFixed(4)} + ¥${analysis.money.CNY.toFixed(4)} @ ${meta.usdPerCny} CNY/USD)`)
  push(`tokens           ${count(analysis.tokens)} across ${count(analysis.window.requests)} requests`)
  push(`peak premium     ${usd(analysis.peaks.premiumUsd)}   (${pct(analysis.peaks.peakSpendShare)} of spend on ${pct(analysis.peaks.peakTokenShare)} of tokens)`)
  push(`cache hit rate   ${pct(analysis.cache.hitRate)}   saved ${usd(analysis.cache.savedUsd)}`)
  if (analysis.legacy.tokens > 0) {
    push(`legacy names     ${usd(analysis.legacy.premiumUsd)} premium over the current card for the same served model`)
  }
  push(
    analysis.agentHours
      ? `agent-hours      ${formatNumber(analysis.agentHours.hours, 2)} (peak ${analysis.agentHours.peakConcurrency} concurrent) -> ${usd(analysis.agentHours.perKeyAgentHour?.usd)}/agent-hour on the ${analysis.agentHours.key} key`
      : 'agent-hours      not measured (pass --agent-home)',
  )
  push()
  push('buckets:')
  for (const bucket of analysis.buckets) {
    push(`  ${bucket.label.padEnd(15)} ${count(bucket.tokens).padStart(16)}  ${usd(bucket.usd).padStart(11)}  ${pct(bucket.share)}`)
  }
  push()
  push('use cases:')
  for (const useCase of analysis.useCases) {
    push(`  ${useCase.key.padEnd(12)} ${usd(useCase.usd).padStart(11)}  ${count(useCase.tokens).padStart(16)} tokens  cache ${pct(useCase.hitRate)}`)
  }
  push()
  push('findings:')
  for (const insight of analysis.insights) {
    push(`  [${insight.severity}] ${insight.title}${insight.usd === null ? '' : ` — ${usd(insight.usd)}`}`)
  }
  return lines.map((line) => line.replace(/\s+$/, '')).join('\n') + '\n'
}
