/**
 * PURPOSE
 *   Hold the provider's per-million-token rate card in one place, so every rate
 *   the analytics divides by is a published rate rather than a number inferred
 *   from the very data being checked.
 *
 *   This matters because the usage export does not label two facts the analysis
 *   needs. A row carries a per-token `price`, a token bucket and a model, but
 *   never says which currency that price is denominated in, nor whether the
 *   tokens were billed in the peak or the off-peak window — the account switched
 *   currency mid-month, and the two windows differ by exactly a factor of two.
 *   Both facts are recovered here by matching the observed price against the rate
 *   card, and an observed price that matches no cell is reported as an error
 *   rather than assigned to the nearest one.
 *
 * INPUTS
 *   `PRICE_LISTS` is keyed by the model name exactly as the export spells it, then
 *   by the currency the row was billed in, then by token bucket; each leaf is a
 *   rate in currency units per one million tokens.
 *   `classifyPrice(model, bucket, price)` takes the export's per-token `price`.
 *
 * OUTPUTS
 *   `classifyPrice(...)` → `{currency, window, multiplier, listPricePerMillion,
 *   listPricePerToken}` when exactly one grid cell matches the observed price;
 *   `null` when no cell matches, when the model or bucket is unknown, or when the
 *   price is not a positive finite number.
 *   `pricePerMillion(model, currency, bucket, window)` → the rate, or `null` when
 *   that cell is not on the card.
 *   `knownModels()` → the model names the card covers.
 *
 * KEYWORDS
 *   rate card, price list, peak, off-peak, cache hit, cache miss, output, currency
 *
 * BEHAVIOUR ON EDGE CASES
 *   - An ambiguous match throws rather than resolving by iteration order: if two
 *     cells ever coincide, the grid is wrong and a silent pick would be a wrong
 *     number that looks like a right one.
 *   - An unknown model or an unknown bucket yields `null` from `classifyPrice`
 *     and `null` from `pricePerMillion`; neither throws and neither falls back to
 *     a similar model, because a close rate is a wrong rate.
 *   - A missing currency for a known model yields `null`; the card never converts
 *     between currencies on the caller's behalf.
 *   - Matching is relative (a tolerance of 1e-6), because the export rounds its
 *     prices to roughly two significant figures while the card is exact.
 */

/**
 * Peak is exactly twice the off-peak rate, for every model, bucket and currency.
 * The window is not a separate column of the card: it is this multiplier applied
 * to the single off-peak rate.
 */
export const PEAK = 'peak'
export const OFF_PEAK = 'off-peak'

/** The multiplier the peak window applies to the off-peak rate. */
export const PEAK_MULTIPLIER = 2

/** The token buckets the export bills, in reporting order. */
export const TOKEN_BUCKETS = ['input_cache_hit_tokens', 'input_cache_miss_tokens', 'output_tokens']

/**
 * The rate card, in currency units per one million tokens.
 *
 * The `deepseek-flash` and `deepseek-v4-pro` rows are the current published card.
 * The `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` rows are retained
 * because the export bills those legacy model names, and it billed them at the
 * superseded card: a legacy request costs more per token than the same request
 * under the current `deepseek-flash` name, and the analytics must report what was
 * charged rather than reprice history.
 */
export const PRICE_LISTS = {
  'deepseek-flash': {
    USD: { input_cache_hit_tokens: 0.003, input_cache_miss_tokens: 0.15, output_tokens: 0.6 },
    CNY: { input_cache_hit_tokens: 0.02, input_cache_miss_tokens: 1, output_tokens: 4 },
  },
  'deepseek-v4-pro': {
    USD: { input_cache_hit_tokens: 0.022, input_cache_miss_tokens: 0.66, output_tokens: 1.98 },
    CNY: { input_cache_hit_tokens: 0.15, input_cache_miss_tokens: 4.5, output_tokens: 13.5 },
  },
  'deepseek-v4-flash': {
    USD: { input_cache_hit_tokens: 0.007, input_cache_miss_tokens: 0.22, output_tokens: 0.66 },
  },
  'deepseek-v4-flash-vision-exp': {
    USD: { input_cache_hit_tokens: 0.007, input_cache_miss_tokens: 0.22, output_tokens: 0.66 },
  },
}

/** Relative tolerance for matching an observed price against the card. */
const RELATIVE_TOLERANCE = 1e-6

/**
 * Compare two rates relatively, so a rounded observed price still matches.
 *
 * @param observed - The per-token price read from the export.
 * @param listed - The per-token rate from the card.
 * @returns True when the two are equal within the relative tolerance.
 */
function withinTolerance(observed, listed) {
  if (!Number.isFinite(observed) || !Number.isFinite(listed)) return false
  if (observed <= 0 || listed <= 0) return false
  return Math.abs(observed - listed) / listed <= RELATIVE_TOLERANCE
}

/**
 * Read one cell of the rate card as a per-million-token rate.
 *
 * @param model - Export model name.
 * @param currency - `USD` or `CNY`.
 * @param bucket - One of `TOKEN_BUCKETS`.
 * @param window - `PEAK` or `OFF_PEAK`.
 * @returns The rate per million tokens, or `null` when the cell is not on the
 *   card or the window is unrecognised.
 */
export function pricePerMillion(model, currency, bucket, window) {
  const base = PRICE_LISTS[model]?.[currency]?.[bucket]
  if (!Number.isFinite(base)) return null
  if (window === OFF_PEAK) return base
  if (window === PEAK) return base * PEAK_MULTIPLIER
  return null
}

/**
 * Read one cell of the rate card as a per-token rate.
 *
 * @returns The rate per token, or `null` under the same conditions as
 *   `pricePerMillion`.
 */
export function pricePerToken(model, currency, bucket, window) {
  const perMillion = pricePerMillion(model, currency, bucket, window)
  return perMillion === null ? null : perMillion / 1e6
}

/**
 * Recover the currency and the billing window an observed price implies.
 *
 * Offers every cell of the model's card that the observed price matches; exactly
 * one must match. The export's own price column is the only evidence of currency
 * and window it carries, so this match is what makes the month's tokens
 * separable into peak and off-peak at all.
 *
 * @param model - Export model name.
 * @param bucket - One of `TOKEN_BUCKETS`.
 * @param price - The export's per-token price.
 * @returns `{currency, window, multiplier, listPricePerMillion,
 *   listPricePerToken}`, or `null` when nothing matches.
 * @throws When more than one cell matches, naming the model, bucket and price.
 */
export function classifyPrice(model, bucket, price) {
  const currencies = PRICE_LISTS[model]
  if (!currencies || !TOKEN_BUCKETS.includes(bucket)) return null
  const matches = []
  for (const currency of Object.keys(currencies)) {
    for (const window of [OFF_PEAK, PEAK]) {
      const perToken = pricePerToken(model, currency, bucket, window)
      if (perToken !== null && withinTolerance(price, perToken)) {
        matches.push({ currency, window, perToken })
      }
    }
  }
  if (matches.length === 0) return null
  if (matches.length > 1) {
    const described = matches.map((m) => `${m.currency}/${m.window}`).join(', ')
    throw new Error(
      `ambiguous price: ${model} ${bucket} at ${price} per token matches ${described}; ` +
        'the rate card must decide each observed price exactly once',
    )
  }
  const [only] = matches
  return {
    currency: only.currency,
    window: only.window,
    multiplier: only.window === PEAK ? PEAK_MULTIPLIER : 1,
    listPricePerMillion: pricePerMillion(model, only.currency, bucket, only.window),
    listPricePerToken: only.perToken,
  }
}

/**
 * List the model names the rate card covers.
 *
 * @returns Model names, in the order the card declares them.
 */
export function knownModels() {
  return Object.keys(PRICE_LISTS)
}

/**
 * List the currencies the card declares for a model.
 *
 * @returns Currency codes, or an empty array for an unknown model.
 */
export function currenciesFor(model) {
  return Object.keys(PRICE_LISTS[model] ?? {})
}
