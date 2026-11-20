/**
 * PURPOSE: Render a board spec into one standalone HTML document — the artifact a
 *          person reads as a summary: what the numbers are, how they moved and
 *          what is open. A board is not a deck: it holds no narrative, it is dense,
 *          it is read at whatever width the sidebar gives it, and it prints on one
 *          page.
 * INPUTS:  spec (object): { theme?, kicker?, title?, subtitle?, meta?, tiles?,
 *          charts?, lists?, foot? }. A tile is { value, label, delta?, tone?,
 *          note? }; a chart is the chart spec charts.mjs accepts plus { title?,
 *          unit?, foot? }; a list is { title, items: [{ label, value, tone? }] }.
 * OUTPUTS: renderBoard(spec) returns { html, theme, tiles, charts, errors,
 *          warnings }. A bad spec never throws: a chart that cannot be drawn is
 *          reported in `errors` and the rest of the board still renders.
 * KEYWORDS: dashboard, board, kpi, chart, standalone, html, renderer.
 */
import { chartSvg, legendItems } from './charts.mjs'
import { BOARD_JS } from './player.mjs'
import { countParts, esc, inline, num, tone } from './text.mjs'
import { attr, document, THEMES } from './render-deck.mjs'

/** Renders one KPI tile; a numeric value counts up in the browser. */
function tile(entry) {
  const parts = countParts(entry.value)
  const value = parts === null
    ? inline(entry.value)
    : `<span class="count" data-count="${parts.to}" data-count-suffix="${attr(parts.suffix)}" data-count-digits="${Number.isInteger(parts.to) ? 0 : 1}">${inline(entry.value)}</span>`
  const color = entry.tone === undefined ? '' : ` style="--c:var(--${tone(entry.tone)})"`
  const delta = entry.delta === undefined ? '' : `<div class="tile__delta" data-tone="${esc(tone(entry.deltaTone, 'muted'))}">${inline(entry.delta)}</div>`
  return `<div class="tile"${color}>${delta}`
    + `<div class="tile__value">${value}</div>`
    + `<div class="tile__label">${inline(entry.label)}</div>`
    + (entry.note ? `<div class="tile__note">${inline(entry.note)}</div>` : '')
    + '</div>'
}

/** Renders one chart card: title, unit, the SVG, its legend and a footnote. */
function chartCard(spec, ctx, index) {
  const chart = chartSvg({ width: spec.width ?? 620, height: spec.height ?? 250, ...spec })
  if (chart.svg === '') {
    for (const error of chart.errors) ctx.errors.push(`charts[${index}]: ${error}`)
    return ''
  }
  for (const warning of chart.warnings) ctx.warnings.push(`charts[${index}]: ${warning}`)
  const legend = legendItems(spec)
  const legendHtml = legend.length > 1
    ? `<div class="chart__legend">${legend.map((item) => `<span style="--c:var(--${item.tone})"><i></i>${inline(item.label)}</span>`).join('')}</div>`
    : ''
  const foot = spec.foot ? `<div class="chart-card__foot">${inline(spec.foot)}</div>` : ''
  return `<section class="chart-card">`
    + `<div class="chart-card__head">`
    + (spec.title ? `<h3 class="chart-card__title">${inline(spec.title)}</h3>` : '')
    + (spec.unit ? `<span class="chart-card__unit">${inline(spec.unit)}</span>` : '')
    + '</div>'
    + `<div class="chart-card__body">${chart.svg}</div>`
    + legendHtml
    + foot
    + '</section>'
}

/** Renders one list card: label on the left, a value or status on the right. */
function listCard(block, index, ctx) {
  if (block === null || typeof block !== 'object' || !Array.isArray(block.items)) {
    ctx.errors.push(`lists[${index}]: expected { title, items: [{ label, value }] }`)
    return ''
  }
  const rows = block.items.filter((item) => item && typeof item === 'object').map((item) => {
    const status = tone(item.tone, 'ink')
    return `<div class="list-card__row" data-tone="${esc(status)}">`
      + `<span class="list-card__label">${inline(item.label)}</span>`
      + `<span class="list-card__value">${inline(item.value ?? '')}</span>`
      + '</div>'
  }).join('')
  const title = block.title ? `<div class="list-card__title">${inline(block.title)}</div>` : ''
  return `<section class="list-card">${title}${rows}</section>`
}

/**
 * Renders a whole board.
 * @param spec - The board spec (see the file contract).
 * @param options - `{ css }` — the theme CSS to inline (required).
 * @returns `{ html, theme, tiles, charts, errors, warnings }`.
 */
export function renderBoard(spec, options = {}) {
  const errors = []
  const warnings = []
  const css = typeof options.css === 'string' && options.css !== '' ? options.css : ''
  if (css === '') errors.push('renderer: no style sheet was supplied, the document would be unstyled')
  const empty = (theme) => ({ html: null, theme, tiles: 0, charts: 0, errors, warnings })
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    errors.push('spec: expected a JSON object')
    return empty(null)
  }
  let theme = spec.theme ?? 'graphite'
  if (typeof theme !== 'string' || !THEMES.includes(theme)) {
    warnings.push(`theme: unknown ${JSON.stringify(spec.theme)} (${THEMES.join(', ')})`)
    theme = 'graphite'
  }
  const tiles = Array.isArray(spec.tiles) ? spec.tiles.filter((entry) => entry && typeof entry === 'object') : []
  const charts = Array.isArray(spec.charts) ? spec.charts : []
  const lists = Array.isArray(spec.lists) ? spec.lists : []
  if (tiles.length === 0 && charts.length === 0 && lists.length === 0) {
    errors.push('spec: a board needs at least one of `tiles`, `charts` or `lists`')
    return empty(theme)
  }
  const ctx = { errors, warnings }
  const head = `<header class="board__head"><div class="board__titles">`
    + (spec.kicker ? `<div class="board__kicker">${inline(spec.kicker)}</div>` : '')
    + `<h1 class="board__title">${inline(spec.title ?? 'Сводка')}</h1>`
    + (spec.subtitle ? `<p class="board__sub">${inline(spec.subtitle)}</p>` : '')
    + '</div>'
    + (Array.isArray(spec.meta) && spec.meta.length > 0
      ? `<div class="board__meta">${spec.meta.map((item) => `<span>${inline(item)}</span>`).join('')}</div>`
      : '')
    + '</header>'
  const tilesHtml = tiles.length > 0 ? `<div class="tiles">${tiles.map((entry) => tile(entry)).join('')}</div>` : ''
  const chartsHtml = charts.length > 0
    ? `<div class="charts">${charts.map((entry, index) => chartCard(entry, ctx, index)).join('')}</div>`
    : ''
  const listsHtml = lists.length > 0
    ? `<div class="lists">${lists.map((entry, index) => listCard(entry, index, ctx)).join('')}</div>`
    : ''
  const footParts = Array.isArray(spec.foot) ? spec.foot.map((item) => `<span>${inline(item)}</span>`).join('') : ''
  const foot = footParts !== '' ? `<footer class="board__foot">${footParts}</footer>` : ''
  const body = `<main class="board">${head}${tilesHtml}${chartsHtml}${listsHtml}${foot}<div class="board__foot" data-board-tip aria-live="polite"></div></main>`
  return {
    html: document({ theme, title: spec.title ?? 'Сводка', lang: spec.lang, css, body, script: BOARD_JS, bodyClass: 'board-body' }),
    theme,
    tiles: tiles.length,
    charts: charts.length,
    errors,
    warnings,
  }
}

export { num }
