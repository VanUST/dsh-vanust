/**
 * PURPOSE
 *   Turn a classified usage export into the figures a person actually decides
 *   from: what the peak window cost above the off-peak rate, how spend splits
 *   across cached input, uncached input and output, what an hour of a running
 *   agent costs and how that differs by use case, and what the month would have
 *   cost under a cheaper but equivalent behaviour.
 *
 *   Every figure here is derived from the export's own per-token prices matched
 *   against the published rate card, and every derivation is checked against the
 *   export's independent per-day cost ledger. A figure that cannot be checked is
 *   reported as unverified rather than presented as measured.
 *
 * INPUTS
 *   `buildAnalysis({amounts, costs, usdPerCny, agentHourData, retiredRates})` takes
 *   the typed rows `readExport` returns, the CNY-per-USD rate to convert with,
 *   optionally `{byDay, total}` agent-hour data from `agent-hours.mjs`, and
 *   optionally `retiredRates` — extra `(model, bucket, price)` → `{currency,
 *   window}` cells for rows whose prices are no longer on the published card, so an
 *   old export stays analyzable. `agentHourData.total.hours` is the denominator for
 *   the per-agent-hour figures.
 *
 * OUTPUTS
 *   An `analysis` object: `{window, reconciliation, money, buckets, models,
 *   useCases, requestsByKey, peaks, cache, daily, agentHours, insights, failures}`.
 *   Every money figure is `{USD, CNY, totalUsd}`, keeping the two native
 *   currencies apart so the conversion rate is never hidden inside a total.
 *   `insights` is an array of `{id, severity, title, detail, usd}` where
 *   `severity` is `info`, `warn` or `act`.
 *   `failures` names every amount row whose price matched no rate-card cell; a
 *   non-empty `failures` means the totals exclude those rows and the caller must
 *   say so.
 *   `evaluateGate(analysis, thresholds)` returns `{ok, checks, topPeakDays}` and
 *   `renderGate(gate)` renders it, so a spend threshold can be a failing command.
 *
 * KEYWORDS
 *   cost analytics, peak overhead, cache efficiency, agent hour, use case, usd
 *
 * BEHAVIOUR ON EDGE CASES
 *   - An empty export yields zeroed figures and an empty `failures`, never a
 *     throw, so a month with no usage reports as a month with no usage.
 *   - A row whose price is absent or unclassifiable is excluded from every total
 *     and named in `failures`; it is never valued at zero, which would understate
 *     the month while looking complete.
 *   - Agent-hour figures are `null` when no agent-hour data was supplied, and the
 *     per-hour figures are `null` with them; a missing denominator is never
 *     rendered as a zero cost per hour.
 *   - A division by a zero denominator yields `null` rather than `Infinity`, and
 *     `formatNumber`/`formatPercent` render that `null` as `n/a`.
 */

import { classifyPrice, pricePerToken, PEAK, OFF_PEAK, TOKEN_BUCKETS } from './price-grid.mjs'

/** CNY per USD, from the provider's own paired rate card for `deepseek-flash`. */
export const DEFAULT_USD_PER_CNY = 6.667

/**
 * The NAME of the use case the locally measured agent-hours belong to: the
 * harness's own key. Session logs exist only for the harness on this machine, so
 * only this key's spend may be divided by those hours.
 *
 * It is a name, not the opaque label {@link buildAnalysis} takes: the entry point
 * resolves it through the export's own label mapping, and a name the export does
 * not carry stays a literal that matches no row — the same outcome as before the
 * labels existed, and it keeps a name that never appeared in the export out of the
 * report's grouping.
 */
export const DEFAULT_AGENT_HOUR_KEY = 'dsh'

/** The reference model the cost figures are computed against; anything else is reported. */
export const POLICY_MODEL = 'deepseek-flash'

/** Model names the export bills but which the current card has superseded. */
export const LEGACY_MODELS = new Map([
  ['deepseek-v4-flash', POLICY_MODEL],
  ['deepseek-v4-flash-vision-exp', POLICY_MODEL],
])

/** Human labels for the three billed token buckets. */
export const BUCKET_LABELS = {
  input_cache_hit_tokens: 'cached input',
  input_cache_miss_tokens: 'uncached input',
  output_tokens: 'output',
}

/** The key a token bucket is billed under, in reporting order. */
export const CACHE_HIT = 'input_cache_hit_tokens'
export const CACHE_MISS = 'input_cache_miss_tokens'
export const OUTPUT = 'output_tokens'

/**
 * Convert one native amount to USD at the reporting rate.
 *
 * @param amount - An amount in `currency`.
 * @param currency - `USD` or `CNY`.
 * @param usdPerCny - CNY per USD.
 * @returns The USD value; 0 for an unknown currency, and 0 rather than
 *   `Infinity` when the rate is not positive.
 */
export function toUsd(amount, currency, usdPerCny) {
  if (currency === 'USD') return amount
  if (currency === 'CNY' && usdPerCny > 0) return amount / usdPerCny
  return 0
}

/**
 * Sum native-currency amounts, keeping the currencies apart and adding a USD total.
 *
 * @param entries - `{currency, amount}[]`.
 * @param usdPerCny - CNY per USD.
 * @returns `{USD, CNY, totalUsd}`; a currency with no entries sums to 0.
 */
export function money(entries, usdPerCny) {
  let usd = 0
  let cny = 0
  for (const entry of entries) {
    if (entry.currency === 'USD') usd += entry.amount
    else if (entry.currency === 'CNY') cny += entry.amount
  }
  return { USD: usd, CNY: cny, totalUsd: usd + (usdPerCny > 0 ? cny / usdPerCny : 0) }
}

/**
 * Divide two numbers, reporting an undefined ratio as `null`.
 *
 * @param numerator - The top of the fraction.
 * @param denominator - The bottom of the fraction.
 * @returns The quotient, or `null` when the denominator is zero or either value
 *   is not finite.
 */
export function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null
  return numerator / denominator
}

/**
 * Sum one property over a set of rows.
 *
 * @param rows - The rows to reduce.
 * @param select - Reads the numeric value from a row.
 * @returns The total; 0 for an empty set.
 */
function sum(rows, select) {
  let total = 0
  for (const row of rows) total += select(row)
  return total
}

/**
 * Classify every amount row against the rate card.
 *
 * Token rows gain `{day, currency, window, listPricePerToken, cost, usd}`;
 * `request_count` rows are kept separately because they carry no price and must
 * not be valued.
 *
 * A row whose price matches no card cell is retried against `retiredRates` before
 * it is called a failure. That fallback exists because the card is the CURRENT
 * published one and a retired model's cell is removed when the model is retired,
 * which would silently make an export from that period unanalyzable. A supplied
 * rate is still a fact about a past invoice, not a guess: an absent one leaves the
 * row in `failures`, which the caller must report.
 *
 * @param amounts - Rows from `readExport`.
 * @param usdPerCny - CNY per USD.
 * @param retiredRates - Optional `Map` from a `model|type|price` key to
 *   `{currency, window}`. Keys are built by `retiredRateKey`.
 * @returns `{tokenRows, requestRows, failures}`.
 */
export function classifyAmounts(amounts, usdPerCny, retiredRates = null) {
  const tokenRows = []
  const requestRows = []
  const failures = []
  for (const row of amounts) {
    const day = row.day ?? null
    if (row.type === 'request_count') {
      requestRows.push({ ...row, day, count: row.amount })
      continue
    }
    if (!TOKEN_BUCKETS.includes(row.type)) {
      failures.push({ row, reason: `unknown token bucket "${row.type}"` })
      continue
    }
    const classified = row.price === null ? null : classifyPrice(row.model, row.type, row.price)
    const supplied = classified ?? retiredRates?.get(retiredRateKey(row.model, row.type, row.price)) ?? null
    if (!supplied) {
      failures.push({
        row,
        reason:
          row.price === null
            ? 'a token row carries no price'
            : `price ${row.price} matches no ${row.model} ${row.type} rate-card cell and no supplied retired rate`,
      })
      continue
    }
    const cost = row.price * row.amount
    tokenRows.push({
      ...row,
      day,
      currency: supplied.currency,
      window: supplied.window,
      // A card match reports the card's own price, which may differ from the
      // export's by the matching tolerance; a supplied retired rate has no card
      // value, so the invoice's own price stands.
      listPricePerToken: supplied.listPricePerToken ?? row.price,
      cost,
      usd: toUsd(cost, supplied.currency, usdPerCny),
    })
  }
  return { tokenRows, requestRows, failures }
}

/**
 * Build the `model|type|price` key a retired-rate lookup uses.
 *
 * @param model - Model name as the export spells it.
 * @param type - Token bucket name.
 * @param price - The per-token price the export recorded, as a number.
 * @returns A string key, or `null` when the price is not a finite number.
 */
export function retiredRateKey(model, type, price) {
  if (typeof price !== 'number' || !Number.isFinite(price)) return null
  return `${model}|${type}|${price}`
}

/**
 * Group unclassified rows into the distinct prices that defeated the rate card.
 *
 * A month priced off a card this tool does not hold produces one failure per row,
 * which is unreadable and hides the shape of the gap. Reduced to distinct
 * `(model, bucket, price)` triples, the same failures name exactly the cells
 * missing from the card, and each row count says how much of the month they carry.
 *
 * @param failures - The `{row, reason}` list `classifyAmounts` returns.
 * @returns `{model, type, price, rows, tokens, reason}[]`, largest token count
 *   first, and empty when nothing failed.
 */
export function summarizeFailures(failures) {
  const groups = new Map()
  for (const failure of failures) {
    const { row } = failure
    const key = `${row.model}|${row.type}|${row.price}`
    if (!groups.has(key)) {
      groups.set(key, { model: row.model, type: row.type, price: row.price, rows: 0, tokens: 0, reason: failure.reason })
    }
    const group = groups.get(key)
    group.rows += 1
    group.tokens += row.amount
  }
  return [...groups.values()].sort((a, b) => b.tokens - a.tokens)
}

/**
 * Check the classified tokens against the export's own per-day cost ledger.
 *
 * The ledger is billed independently of the token breakdown, so agreement is real
 * evidence that the classification — currency and window included — is right, and
 * disagreement is the signal that it is not.
 *
 * @param tokenRows - Classified token rows.
 * @param costs - Cost rows from `readExport`.
 * @returns `{checked, mismatches, missingLedger, ok}`. A mismatch carries
 *   `{key, computed, billed, difference}`; an absent ledger row is listed in
 *   `missingLedger` rather than silently passing.
 */
export function reconcile(tokenRows, costs) {
  const computed = new Map()
  for (const row of tokenRows) {
    const key = `${row.day}|${row.model}|${row.currency}`
    computed.set(key, (computed.get(key) ?? 0) + row.cost)
  }
  const billed = new Map()
  for (const row of costs) {
    const day = row.day ?? null
    const key = `${day}|${row.model}|${row.currency}`
    billed.set(key, (billed.get(key) ?? 0) + row.cost)
  }
  const mismatches = []
  const missingLedger = []
  let checked = 0
  for (const [key, value] of computed) {
    if (!billed.has(key)) {
      missingLedger.push(key)
      continue
    }
    checked += 1
    const difference = value - billed.get(key)
    if (Math.abs(difference) > 1e-6) {
      mismatches.push({ key, computed: value, billed: billed.get(key), difference })
    }
  }
  for (const key of billed.keys()) {
    if (!computed.has(key)) missingLedger.push(key)
  }
  return { checked, mismatches, missingLedger, ok: mismatches.length === 0 && missingLedger.length === 0 }
}

/**
 * Split spend and tokens across the three billed buckets.
 *
 * @param tokenRows - Classified token rows.
 * @param usdPerCny - CNY per USD.
 * @returns One entry per bucket: `{bucket, label, tokens, money, usd, share}`.
 *   `share` is that bucket's fraction of total USD spend, or `null` when nothing
 *   was spent.
 */
export function bucketSplit(tokenRows, usdPerCny) {
  const totalUsd = sum(tokenRows, (row) => row.usd)
  return TOKEN_BUCKETS.map((bucket) => {
    const rows = tokenRows.filter((row) => row.type === bucket)
    const usd = sum(rows, (row) => row.usd)
    return {
      bucket,
      label: BUCKET_LABELS[bucket],
      tokens: sum(rows, (row) => row.amount),
      money: money(
        rows.map((row) => ({ currency: row.currency, amount: row.cost })),
        usdPerCny,
      ),
      usd,
      share: ratio(usd, totalUsd),
    }
  })
}

/**
 * Measure what caching saved against sending every input token uncached.
 *
 * The counterfactual is priced per row at that row's own model, currency and
 * window, so a cached token is compared with what the same token would have cost
 * uncached at the moment it was sent rather than at some blended average.
 *
 * @param tokenRows - Classified token rows.
 * @param usdPerCny - CNY per USD.
 * @returns `{hitTokens, missTokens, hitRate, actualInputUsd, allMissInputUsd,
 *   savedUsd, savedShare, effectiveInputPriceUsdPerMillion,
 *   blendedMissPriceUsdPerMillion}`. The price figures are `null` when there are
 *   no input tokens.
 */
export function cacheAnalysis(tokenRows, usdPerCny) {
  const input = tokenRows.filter((row) => row.type !== OUTPUT)
  const hitTokens = sum(
    input.filter((row) => row.type === CACHE_HIT),
    (row) => row.amount,
  )
  const missTokens = sum(
    input.filter((row) => row.type === CACHE_MISS),
    (row) => row.amount,
  )
  const inputTokens = hitTokens + missTokens
  const actualInputUsd = sum(input, (row) => row.usd)
  let allMissUsd = 0
  for (const row of input) {
    const missPrice = pricePerToken(row.model, row.currency, CACHE_MISS, row.window)
    if (missPrice === null) continue
    allMissUsd += toUsd(missPrice * row.amount, row.currency, usdPerCny)
  }
  const savedUsd = allMissUsd - actualInputUsd
  return {
    hitTokens,
    missTokens,
    hitRate: ratio(hitTokens, inputTokens),
    actualInputUsd,
    allMissInputUsd: allMissUsd,
    savedUsd,
    savedShare: ratio(savedUsd, allMissUsd),
    effectiveInputPriceUsdPerMillion: ratio(actualInputUsd * 1e6, inputTokens),
    blendedMissPriceUsdPerMillion: ratio(allMissUsd * 1e6, inputTokens),
  }
}

/**
 * Split the month into peak and off-peak, and price the peak premium.
 *
 * The premium is the difference between what the peak tokens cost and what the
 * same tokens cost at the off-peak rate — what a fully off-peak schedule would
 * have saved, assuming the work could move. Peak rows were billed at exactly
 * twice their off-peak rate, so the premium is half the peak spend.
 *
 * @param tokenRows - Classified token rows.
 * @param usdPerCny - CNY per USD.
 * @returns `{peakTokens, offPeakTokens, peakMoney, offPeakMoney, peakUsd,
 *   offPeakUsd, premiumUsd, counterfactualUsd, premiumShareOfPeak,
 *   peakSpendShare, peakTokenShare}`.
 */
export function peakAnalysis(tokenRows, usdPerCny) {
  const peakRows = tokenRows.filter((row) => row.window === PEAK)
  const offPeakRows = tokenRows.filter((row) => row.window === OFF_PEAK)
  const peakUsd = sum(peakRows, (row) => row.usd)
  const offPeakUsd = sum(offPeakRows, (row) => row.usd)
  const peakTokens = sum(peakRows, (row) => row.amount)
  const offPeakTokens = sum(offPeakRows, (row) => row.amount)
  return {
    peakTokens,
    offPeakTokens,
    peakMoney: money(
      peakRows.map((row) => ({ currency: row.currency, amount: row.cost })),
      usdPerCny,
    ),
    offPeakMoney: money(
      offPeakRows.map((row) => ({ currency: row.currency, amount: row.cost })),
      usdPerCny,
    ),
    peakUsd,
    offPeakUsd,
    premiumUsd: peakUsd / 2,
    counterfactualUsd: peakUsd / 2 + offPeakUsd,
    premiumShareOfPeak: 0.5,
    peakSpendShare: ratio(peakUsd, peakUsd + offPeakUsd),
    peakTokenShare: ratio(peakTokens, peakTokens + offPeakTokens),
  }
}

/**
 * Group rows by one key and summarise each group.
 *
 * @param rows - Classified token rows.
 * @param keyOf - Maps a row to its group key.
 * @param usdPerCny - CNY per USD.
 * @returns One `{key, tokens, inputTokens, outputTokens, usd, money, hitTokens,
 *   missTokens, hitRate, peakUsd, offPeakUsd, peakTokenShare}` per group, sorted
 *   by descending USD spend.
 */
export function groupSummary(rows, keyOf, usdPerCny) {
  const groups = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const summaries = []
  for (const [key, group] of groups) {
    const usd = sum(group, (row) => row.usd)
    const inputTokens = sum(
      group.filter((row) => row.type !== OUTPUT),
      (row) => row.amount,
    )
    const outputTokens = sum(
      group.filter((row) => row.type === OUTPUT),
      (row) => row.amount,
    )
    const hitTokens = sum(
      group.filter((row) => row.type === CACHE_HIT),
      (row) => row.amount,
    )
    const missTokens = sum(
      group.filter((row) => row.type === CACHE_MISS),
      (row) => row.amount,
    )
    const peakRows = group.filter((row) => row.window === PEAK)
    const peakUsd = sum(peakRows, (row) => row.usd)
    summaries.push({
      key,
      tokens: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      usd,
      money: money(
        group.map((row) => ({ currency: row.currency, amount: row.cost })),
        usdPerCny,
      ),
      hitTokens,
      missTokens,
      hitRate: ratio(hitTokens, hitTokens + missTokens),
      peakUsd,
      offPeakUsd: usd - peakUsd,
      peakTokenShare: ratio(sum(peakRows, (row) => row.amount), inputTokens + outputTokens),
    })
  }
  return summaries.sort((a, b) => b.usd - a.usd)
}

/**
 * Price the legacy-name premium: what the retired names cost above the current
 * card for the same served model.
 *
 * A legacy name is not a different model, it is an alias billed at the
 * superseded card, so the comparison is the same tokens repriced cell for cell
 * at the current model's rate for that currency and window.
 *
 * @param tokenRows - Classified token rows.
 * @param usdPerCny - CNY per USD.
 * @returns `{tokens, actualUsd, currentCardUsd, premiumUsd, share}`, all zeroed
 *   when the month billed no legacy name. `share` is the premium as a fraction of
 *   the legacy spend, or `null` when there was none.
 */
export function legacyPremium(tokenRows, usdPerCny) {
  const rows = tokenRows.filter((row) => LEGACY_MODELS.has(row.model))
  let actualUsd = 0
  let currentCardUsd = 0
  for (const row of rows) {
    actualUsd += row.usd
    const currentPrice = pricePerToken(LEGACY_MODELS.get(row.model), row.currency, row.type, row.window)
    if (currentPrice === null) continue
    currentCardUsd += toUsd(currentPrice * row.amount, row.currency, usdPerCny)
  }
  const premiumUsd = actualUsd - currentCardUsd
  return {
    tokens: sum(rows, (row) => row.amount),
    actualUsd,
    currentCardUsd,
    premiumUsd,
    share: ratio(premiumUsd, actualUsd),
  }
}

/**
 * Build the whole analysis from an export.
 *
 * @param input - `{amounts, costs, usdPerCny, agentHourData, agentHourKey,
 *   retiredRates}`.
 *   `agentHourKey` is the OPAQUE use-case label (`use-case-N`) the measured
 *   agent-hours belong to, already resolved from whatever name the caller was
 *   given: the local session logs are the harness's own, so its spend is the spend
 *   those hours produced and another use case's spend must not be divided by them.
 *   A label the export does not carry matches no row, which is the same outcome as
 *   naming a key the export never used.
 * @returns The `analysis` object described in this module's OUTPUTS.
 */
export function buildAnalysis({
  amounts,
  costs,
  usdPerCny = DEFAULT_USD_PER_CNY,
  agentHourData = null,
  agentHourKey = null,
  retiredRates = null,
}) {
  const { tokenRows, requestRows, failures } = classifyAmounts(amounts, usdPerCny, retiredRates)
  const reconciliation = reconcile(tokenRows, costs)
  const buckets = bucketSplit(tokenRows, usdPerCny)
  const peaks = peakAnalysis(tokenRows, usdPerCny)
  const cache = cacheAnalysis(tokenRows, usdPerCny)
  const models = groupSummary(tokenRows, (row) => row.model, usdPerCny)
  const useCases = groupSummary(tokenRows, (row) => row.useCase ?? '(unlabelled)', usdPerCny)

  const requestsByKey = new Map()
  for (const row of requestRows) {
    const key = row.useCase ?? '(unlabelled)'
    requestsByKey.set(key, (requestsByKey.get(key) ?? 0) + row.count)
  }

  const money_ = money(
    tokenRows.map((row) => ({ currency: row.currency, amount: row.cost })),
    usdPerCny,
  )
  const totalTokens = sum(tokenRows, (row) => row.amount)

  // The window is every day the export covers, not only the days that classified:
  // a month whose prices defeat the rate card still has a known span, and reporting
  // `?..?` for it would hide a parse failure behind a pricing one.
  const days = [...new Set([...tokenRows, ...requestRows].map((row) => row.day).filter(Boolean))].sort()
  const daily = days.map((day) => {
    const rows = tokenRows.filter((row) => row.day === day)
    const dayUsd = sum(rows, (row) => row.usd)
    const peakRows = rows.filter((row) => row.window === PEAK)
    const dayTokens = sum(rows, (row) => row.amount)
    const hours = agentHourData?.byDay?.get(day)?.hours ?? null
    return {
      day,
      usd: dayUsd,
      tokens: dayTokens,
      peakUsd: sum(peakRows, (row) => row.usd),
      peakTokenShare: ratio(sum(peakRows, (row) => row.amount), dayTokens),
      requests: sum(
        requestRows.filter((row) => row.day === day),
        (row) => row.count,
      ),
      agentHours: hours,
      usdPerAgentHour: hours !== null && hours > 0 ? dayUsd / hours : null,
    }
  })

  const totalAgentHours = agentHourData?.total?.hours ?? null
  const attributable = useCases.find((useCase) => useCase.key === agentHourKey) ?? null
  let agentHoursSummary = null
  if (totalAgentHours !== null) {
    // Hours are measured only where local session logs exist, so spend on a day with
    // no log has no denominator. Dividing the whole bill by these hours would charge
    // one machine's time for another machine's tokens, so the rate is computed over
    // the days the hours actually cover and the uncovered spend is reported
    // separately rather than folded into the rate.
    const coveredDays = new Set([...agentHourData.byDay.keys()].filter((key) => key !== '__total__'))
    const coveredRows = tokenRows.filter((row) => coveredDays.has(row.day))
    const keyCoveredRows = agentHourKey === null ? [] : coveredRows.filter((row) => row.useCase === agentHourKey)
    const uncoveredRows = tokenRows.filter((row) => !coveredDays.has(row.day))
    const perHour = (value, tokens) =>
      totalAgentHours > 0 ? { usd: value / totalAgentHours, tokens: tokens / totalAgentHours } : null
    agentHoursSummary = {
      hours: totalAgentHours,
      peakConcurrency: agentHourData.total.peakConcurrency,
      days: coveredDays.size,
      key: agentHourKey,
      coveredDays: [...coveredDays].sort(),
      uncoveredDays: [...new Set(uncoveredRows.map((row) => row.day).filter(Boolean))].sort(),
      uncoveredSpendUsd: sum(uncoveredRows, (row) => row.usd),
      uncoveredTokens: sum(uncoveredRows, (row) => row.amount),
      keyUsd: attributable?.usd ?? null,
      keyTokens: attributable?.tokens ?? null,
      keyUsdOnCoveredDays: sum(keyCoveredRows, (row) => row.usd),
      // The paired basis: the harness key's spend on the days the hours cover.
      perKeyAgentHour: perHour(sum(keyCoveredRows, (row) => row.usd), sum(keyCoveredRows, (row) => row.amount)),
      // The whole bill over the same covered days, for comparison.
      coveredSpendUsd: sum(coveredRows, (row) => row.usd),
      perAgentHourOnCoveredDays: perHour(sum(coveredRows, (row) => row.usd), sum(coveredRows, (row) => row.amount)),
      // Unpaired: the whole bill over locally measured hours. A bound, not a rate.
      perAgentHourWholeBill: perHour(money_.totalUsd, totalTokens),
    }
  }

  const window = {
    from: days[0] ?? null,
    to: days[days.length - 1] ?? null,
    activeDays: days.length,
    requests: sum(requestRows, (row) => row.count),
  }

  const analysis = {
    window,
    reconciliation,
    money: money_,
    tokens: totalTokens,
    buckets,
    models,
    useCases,
    requestsByKey: [...requestsByKey.entries()].map(([key, count]) => ({ key, count })),
    peaks,
    cache,
    legacy: legacyPremium(tokenRows, usdPerCny),
    daily,
    agentHours: agentHoursSummary,
    failures,
    failureSummary: summarizeFailures(failures),
  }
  analysis.insights = buildInsights(analysis)
  return analysis
}

/**
 * Derive the findings a reader should act on from the computed figures.
 *
 * @param analysis - The analysis without `insights`.
 * @returns `{id, severity, title, detail, usd}[]`, largest quantified amount
 *   first. `usd` is the amount at stake where one can be quantified and `null`
 *   otherwise.
 */
export function buildInsights(analysis) {
  const insights = []

  const offPolicy = analysis.models.filter(
    (model) => model.key !== POLICY_MODEL && !LEGACY_MODELS.has(model.key),
  )
  const offPolicySpend = sum(offPolicy, (model) => model.usd)
  if (offPolicySpend > 0) {
    insights.push({
      id: 'non-policy-model',
      severity: 'act',
      title: 'Spend on models outside the Flash class',
      detail:
        `${offPolicy.map((model) => `${model.key} $${model.usd.toFixed(4)}`).join(', ')}. ` +
        'These tokens were billed at a multiple of the Flash class rate.',
      usd: offPolicySpend,
    })
  }

  if (analysis.legacy.premiumUsd > 0) {
    insights.push({
      id: 'legacy-model-name',
      severity: 'warn',
      title: 'Retired model names were billed at the superseded card',
      detail:
        `${formatNumber(analysis.legacy.tokens, 0)} tokens billed under a retired name cost ` +
        `$${analysis.legacy.actualUsd.toFixed(4)} where the current ${POLICY_MODEL} card prices the same tokens at ` +
        `$${analysis.legacy.currentCardUsd.toFixed(4)}. The retired names are aliases for the same served model, so the ` +
        'difference is paid for the name rather than for the model.',
      usd: analysis.legacy.premiumUsd,
    })
  }

  if (analysis.peaks.premiumUsd > 0) {
    insights.push({
      id: 'peak-premium',
      severity: 'act',
      title: 'Peak-window premium',
      detail:
        `${formatPercent(analysis.peaks.peakTokenShare)} of tokens were billed in the peak window, at exactly ` +
        `twice the off-peak rate, and carried ${formatPercent(analysis.peaks.peakSpendShare)} of the spend. ` +
        'Moving that work into the off-peak window would remove the premium.',
      usd: analysis.peaks.premiumUsd,
    })
  }

  if (analysis.cache.hitRate !== null) {
    insights.push({
      id: 'cache-value',
      severity: analysis.cache.hitRate < 0.8 ? 'warn' : 'info',
      title: 'Cached input',
      detail:
        `${formatPercent(analysis.cache.hitRate)} of input tokens were cache hits, saving ` +
        `$${analysis.cache.savedUsd.toFixed(4)} against sending the same input uncached. ` +
        'A cache miss is the single most expensive thing an agent does per token.',
      usd: analysis.cache.savedUsd,
      // This figure is money already not spent, not money at risk: rendering it as
      // an amount at stake would read as a problem when it is the opposite.
      usdLabel: 'saved',
    })
  }

  if (analysis.agentHours) {
    const hours = analysis.agentHours
    insights.push({
      id: 'per-agent-hour',
      severity: 'info',
      title: 'Cost per running agent-hour',
      detail:
        `${hours.hours.toFixed(1)} agent-hours measured from local session logs over ${hours.days} days, across at ` +
        `most ${hours.peakConcurrency} concurrent agents. The \`${hours.key}\` key spent $${formatNumber(hours.perKeyAgentHour?.usd)} ` +
        `per agent-hour and moved ${formatNumber((hours.perKeyAgentHour?.tokens ?? 0) / 1e6, 1)} M tokens per agent-hour.`,
      usd: null,
    })
    if (hours.uncoveredSpendUsd > 0) {
      insights.push({
        id: 'agent-hour-coverage',
        severity: 'warn',
        title: 'Spend with no locally measured agent time',
        detail:
          `$${hours.uncoveredSpendUsd.toFixed(4)} across ${hours.uncoveredDays.length} day(s) has no session log on this ` +
          'machine, so it is excluded from the per-agent-hour rate. Those days were driven from another machine or ' +
          'another tool, and including them would charge this machine for their tokens.',
        usd: hours.uncoveredSpendUsd,
      })
    }
  } else {
    insights.push({
      id: 'per-agent-hour-missing',
      severity: 'warn',
      title: 'Cost per running agent-hour is unmeasured',
      detail:
        'No session logs were supplied, so the denominator is missing and no per-hour figure is reported.',
      usd: null,
    })
  }

  return insights
    .filter((insight) => insight.usd === null || insight.usd > 0)
    .map((insight) => ({ usdLabel: 'at stake', ...insight }))
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))
}

/**
 * Decide whether an analysis passes the spend checks a shell gate can enforce.
 *
 * Three checks, each with a threshold the caller sets, so "the peak premium is too
 * high" becomes a command that exits non-zero instead of a sentence in a report that
 * nobody reads. The checks are independent: passing one says nothing about another,
 * and a check whose threshold is absent is reported as `skipped` rather than as a
 * pass, because an untested condition is not a satisfied one.
 *
 * @param analysis - The object `buildAnalysis` returns.
 * @param thresholds - `{maxPeakShare, maxLegacyPremiumUsd}`, each optional. A
 *   `null` threshold skips that check.
 * @returns `{ok, checks, topPeakDays}`. `ok` is false when any check fails. Each
 *   check is `{id, title, threshold, actual, usd, status}` with `status` one of
 *   `pass`, `fail`, `skipped`. `actual` is null for `skipped`.
 *
 *   `topPeakDays` is the shift plan: up to ten days carrying a peak premium,
 *   largest first, each `{day, peakPremiumUsd, peakSpendUsd, peakTokenShare,
 *   premiumUsd}`. It is empty when no day was billed in the peak window.
 *
 *   A `skipped` reconciliation check fails only if reconciliation itself failed —
 *   the report's own verdict on its numbers is always enforced, regardless of
 *   what thresholds the caller supplied.
 */
export function evaluateGate(analysis, thresholds = {}) {
  const maxPeakShare = thresholds.maxPeakShare ?? null
  const maxLegacyPremiumUsd = thresholds.maxLegacyPremiumUsd ?? null
  const checks = []

  checks.push({
    id: 'reconciliation',
    title: 'Token breakdown reconciles with the cost ledger',
    threshold: maxPeakShare === null && maxLegacyPremiumUsd === null ? null : 'always',
    actual: analysis.reconciliation.ok,
    usd: null,
    status: analysis.reconciliation.ok ? 'pass' : 'fail',
  })

  if (maxPeakShare === null) {
    checks.push({
      id: 'peak-share',
      title: 'Peak-window share of spend',
      threshold: null,
      actual: analysis.peaks.peakSpendShare,
      usd: analysis.peaks.premiumUsd,
      status: 'skipped',
    })
  } else {
    const actual = analysis.peaks.peakSpendShare ?? 0
    checks.push({
      id: 'peak-share',
      title: 'Peak-window share of spend',
      threshold: maxPeakShare,
      actual,
      usd: analysis.peaks.premiumUsd,
      status: actual <= maxPeakShare ? 'pass' : 'fail',
    })
  }

  if (maxLegacyPremiumUsd === null) {
    checks.push({
      id: 'legacy-premium',
      title: 'Premium paid for retired model names',
      threshold: null,
      actual: analysis.legacy.premiumUsd,
      usd: analysis.legacy.premiumUsd,
      status: 'skipped',
    })
  } else {
    checks.push({
      id: 'legacy-premium',
      title: 'Premium paid for retired model names',
      threshold: maxLegacyPremiumUsd,
      actual: analysis.legacy.premiumUsd,
      usd: analysis.legacy.premiumUsd,
      status: analysis.legacy.premiumUsd <= maxLegacyPremiumUsd ? 'pass' : 'fail',
    })
  }

  // Half of peak spend is the premium: peak rows were billed at exactly twice the
  // off-peak rate, so the excess over the off-peak counterfactual is peakUsd / 2.
  const topPeakDays = (analysis.daily ?? [])
    .map((day) => ({
      day: day.day,
      peakPremiumUsd: day.peakUsd / 2,
      peakSpendUsd: day.peakUsd,
      peakTokenShare: day.peakTokenShare,
      premiumUsd: day.peakUsd / 2 + day.usd - day.peakUsd,
    }))
    .filter((day) => day.peakPremiumUsd > 0)
    .sort((a, b) => b.peakPremiumUsd - a.peakPremiumUsd)
    .slice(0, 10)

  return { ok: checks.every((check) => check.status !== 'fail'), checks, topPeakDays }
}

/**
 * Render a gate result as the lines a terminal or a CI log shows.
 *
 * @param gate - The object `evaluateGate` returns.
 * @returns A string ending in a newline, listing every check with its verdict and,
 *   after a failure, the days that carried the premium.
 */
export function renderGate(gate) {
  const lines = []
  for (const check of gate.checks) {
    const label = check.status === 'pass' ? 'PASS' : check.status === 'fail' ? 'FAIL' : 'SKIP'
    const wanted = check.threshold === null ? 'no threshold given' : `limit ${formatThreshold(check)}`
    const at = check.actual === null ? 'n/a' : formatActual(check)
    lines.push(`  [${label}] ${check.title}: ${at} (${wanted})`)
  }
  lines.push(gate.ok ? 'usage gate: PASS' : 'usage gate: FAIL')
  if (!gate.ok && gate.topPeakDays.length > 0) {
    lines.push('  days carrying the peak premium (move work off-peak, or accept the premium):')
    for (const day of gate.topPeakDays) {
      lines.push(
        `    ${day.day}  premium $${day.peakPremiumUsd.toFixed(4)}  ` +
          `peak share ${formatPercent(day.peakTokenShare)}  peak spend $${day.peakSpendUsd.toFixed(4)}`,
      )
    }
  }
  return lines.join('\n') + '\n'
}

/**
 * Format a check's threshold for display, choosing the unit from the check id.
 *
 * @param check - One entry of `evaluateGate(...).checks`.
 * @returns A short string.
 */
function formatThreshold(check) {
  if (typeof check.threshold !== 'number') return String(check.threshold)
  if (check.id === 'peak-share') return formatPercent(check.threshold)
  return `$${check.threshold.toFixed(4)}`
}

/**
 * Format a check's observed value for display, choosing the unit from the check id.
 *
 * @param check - One entry of `evaluateGate(...).checks`.
 * @returns A short string.
 */
function formatActual(check) {
  if (check.id === 'peak-share') return formatPercent(check.actual)
  if (check.id === 'reconciliation') return check.actual ? 'ok' : 'failed'
  return `$${Number(check.actual).toFixed(4)}`
}

/**
 * Format a fraction as a percentage.
 *
 * @param value - A fraction, or `null`.
 * @returns A percentage string, or `n/a` when the value is `null` or not finite.
 */
export function formatPercent(value) {
  if (value === null || !Number.isFinite(value)) return 'n/a'
  return `${(value * 100).toFixed(1)}%`
}

/**
 * Format a number for a report, tolerating `null`.
 *
 * @param value - A number, or `null`.
 * @param digits - Decimal places.
 * @returns The formatted number, or `n/a` when the value is `null` or not finite.
 */
export function formatNumber(value, digits = 2) {
  if (value === null || !Number.isFinite(value)) return 'n/a'
  return value.toFixed(digits)
}
