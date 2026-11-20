/**
 * PURPOSE: Render a deck spec into one standalone HTML document — the artifact a
 *          person reads as a story: one idea per slide, a persistent anchor, and
 *          motion only where it shows a change. The page carries its own CSS, its
 *          own player and its own data, so it opens in the sidebar document
 *          preview, in a browser and in a PDF printer with no network and no
 *          sibling files.
 * INPUTS:  spec (object): { theme?, title?, lang?, foot?, slides: Slide[] }.
 *          A Slide is { type?, kicker?, title?, lede?, note?, flush?, anim?,
 *          layout?, cards?, kpis?, table?, timeline?, quote?, chips?, callout?,
 *          list?, steps?, compare?, chart?, motion?, visual?, code?, raw? }.
 *          A `motion` block is a timed scene: { svg|html, duration?, autoplay?,
 *          pace?, loop?, tracks: [{ target, at, dur, ease?, from?, to?, repeat? }],
 *          captions: [{ at, dur, text }], caption? }.
 *          Text fields accept `**bold**` and `==highlight==`; every other string
 *          is escaped. `type` is one of cover, section, content, compare, steps,
 *          chart, visual, raw.
 * OUTPUTS: renderDeck(spec) returns { html, theme, slides, errors, warnings }.
 *          A bad spec never throws: an unknown slide type or a missing title is
 *          reported in `errors` with its slide index, and every valid slide still
 *          renders. `null` html means nothing was written.
 * KEYWORDS: presentation, deck, slides, renderer, html, standalone, animation.
 */
import { chartSvg, legendItems } from './charts.mjs'
import { PLAYER_JS } from './player.mjs'
import { countParts, esc, fmt, inline, num, tone } from './text.mjs'

/** Theme ids the renderer accepts; the first one is the default. */
export const THEMES = ['ember', 'graphite', 'aurora', 'mono', 'paper']

/** Slide types the renderer knows; anything else is reported and drawn as content. */
export const SLIDE_TYPES = ['cover', 'section', 'content', 'compare', 'steps', 'chart', 'visual', 'raw']

/** The order blocks appear in, so a spec's key order never changes the layout. */
const BLOCK_ORDER = ['kpis', 'cards', 'table', 'timeline', 'quote', 'chips', 'callout', 'list', 'steps', 'compare', 'chart', 'motion', 'visual', 'code']

/** Escapes a value for a double-quoted attribute (notes, titles, labels). */
function attr(value) {
  return esc(value).replace(/\n/g, '&#10;')
}

/**
 * Wraps a block in a fragment when the spec asks for one, so a slide can reveal
 * its parts on advance instead of showing the result.
 */
function fragment(html, index, opts) {
  if (opts?.frag !== true) return html
  return `<div data-frag style="--i:${index}">${html}</div>`
}

/** Renders the KPI row; a value that starts with a number counts up. */
function blockKpis(list, ctx) {
  if (!Array.isArray(list) || list.length === 0) return ''
  const cells = list.filter((entry) => entry && typeof entry === 'object').map((entry) => {
    const parts = countParts(entry.value)
    const counted = parts === null
      ? inline(entry.value)
      : `<span class="count" data-count="${parts.to}" data-count-suffix="${attr(parts.suffix)}" data-count-digits="${Number.isInteger(parts.to) ? 0 : 1}">${inline(entry.value)}</span>`
    const color = entry.color === undefined ? '' : ` style="--c:var(--${tone(entry.color)})"`
    return `<div class="kpi"${color}>`
      + `<div class="kpi__value">${counted}</div>`
      + `<div class="kpi__label">${inline(entry.label)}</div>`
      + (entry.note ? `<div class="kpi__note">${inline(entry.note)}</div>` : '')
      + '</div>'
  }).join('')
  if (ctx !== undefined && list.length > 0 && cells === '') ctx.errors.push('kpis: every entry was empty')
  return cells ? `<div class="kpis">${cells}</div>` : ''
}

/** Renders the card grid; the column count follows the number of cards. */
function blockCards(list, ctx) {
  if (!Array.isArray(list) || list.length === 0) return ''
  const cards = list.filter((entry) => entry && typeof entry === 'object').map((entry) => {
    const color = entry.color === undefined ? '' : ` style="--c:var(--${tone(entry.color)})"`
    const icon = entry.icon ? `<div class="card__icon">${inline(entry.icon)}</div>` : ''
    const step = entry.step ? `<div class="card__step">${inline(entry.step)}</div>` : ''
    const items = Array.isArray(entry.list) && entry.list.length > 0
      ? `<div class="card__list">${entry.list.map((item) => `<span>${inline(item)}</span>`).join('')}</div>`
      : ''
    const classes = ['card']
    if (entry.ghost === true) classes.push('card--ghost')
    if (entry.big === true) classes.push('card--big')
    return `<div class="${classes.join(' ')}"${color}>${icon}${step}`
      + (entry.title ? `<div class="card__title">${inline(entry.title)}</div>` : '')
      + (entry.text ? `<div class="card__text">${inline(entry.text)}</div>` : '')
      + items
      + '</div>'
  }).join('')
  if (cards === '') ctx?.errors.push('cards: every entry was empty')
  const columns = Math.max(1, Math.min(5, num(list.filter((entry) => entry && typeof entry === 'object').length) ?? 1))
  return cards ? `<div class="cards cards--${columns}">${cards}</div>` : ''
}

/** Renders a table: `header` is a string array, `rows` an array of arrays. */
function blockTable(block) {
  if (block === null || typeof block !== 'object') return ''
  const header = Array.isArray(block.header) ? block.header : []
  const rows = Array.isArray(block.rows) ? block.rows : []
  if (header.length === 0 && rows.length === 0) return ''
  const head = header.length > 0 ? `<thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>` : ''
  const body = rows.length > 0
    ? `<tbody>${rows.map((row) => `<tr>${(Array.isArray(row) ? row : [row]).map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : ''
  const compact = block.compact === true ? ' table--compact' : ''
  return `<table class="table${compact}">${head}${body}</table>`
}

/** Renders a timeline: an item is { title, text }. */
function blockTimeline(list) {
  if (!Array.isArray(list) || list.length === 0) return ''
  const items = list.filter((entry) => entry && typeof entry === 'object').map((entry) => `<div class="timeline__item">`
    + `<div class="timeline__title">${inline(entry.title)}</div>`
    + (entry.text ? `<div class="timeline__text">${inline(entry.text)}</div>` : '')
    + '</div>').join('')
  return items ? `<div class="timeline">${items}</div>` : ''
}

/** Renders a pull quote; `by` names the speaker. */
function blockQuote(block) {
  if (block === null || typeof block !== 'object' || (block.text === undefined && block.title === undefined)) return ''
  const text = block.text ?? block.title
  const by = block.by ? `<span class="quote__by">${inline(block.by)}</span>` : ''
  return `<blockquote class="quote">${inline(text)}${by}</blockquote>`
}

/** Renders the chip row; `label` prints a small caption before the chips. */
function blockChips(block) {
  if (block === null || typeof block !== 'object') return ''
  const items = Array.isArray(block.items) ? block.items : []
  if (items.length === 0) return ''
  const label = block.label ? `<div class="chips__label">${inline(block.label)}</div>` : ''
  const chips = items.map((item) => {
    const text = item !== null && typeof item === 'object' ? item.text ?? item.label ?? '' : item
    const on = item !== null && typeof item === 'object' && item.on === true ? ' chip--on' : ''
    return `<span class="chip${on}">${inline(text)}</span>`
  }).join('')
  return `${label}<div class="chips">${chips}</div>`
}

/** Renders a callout: one sentence that must not be missed. */
function blockCallout(block) {
  const text = typeof block === 'string' ? block : block?.text
  if (text === undefined || text === '') return ''
  const level = typeof block === 'object' && block !== null ? tone(block.tone, 'accent') : 'accent'
  const modifier = level === 'accent' ? '' : ` callout--${level}`
  return `<div class="callout${modifier}"><div>${inline(text)}</div></div>`
}

/** Renders a bullet list; an item may be `{ title, text }` for a lead-in. */
function blockList(list) {
  if (!Array.isArray(list) || list.length === 0) return ''
  const items = list.filter((item) => item !== undefined && item !== null).map((item) => {
    if (item !== null && typeof item === 'object') {
      const title = item.title === undefined ? '' : `<b>${inline(item.title)}</b> `
      return `<div class="list__item"><span>${title}${inline(item.text)}</span></div>`
    }
    return `<div class="list__item"><span>${inline(item)}</span></div>`
  }).join('')
  return `<div class="list">${items}</div>`
}

/** Renders numbered steps; each step is a fragment, because the order is the point. */
function blockSteps(list, layout) {
  if (!Array.isArray(list) || list.length === 0) return ''
  const steps = list.filter((entry) => entry && typeof entry === 'object').map((entry, index) => {
    const number = entry.num ?? String(index + 1)
    return `<div class="step" data-frag>`
      + `<div class="step__num">${inline(number)}</div>`
      + `<div class="step__body">`
      + `<div class="step__title">${inline(entry.title)}</div>`
      + (entry.text ? `<div class="step__text">${inline(entry.text)}</div>` : '')
      + '</div></div>'
  }).join('')
  const row = layout === 'row' || layout === 'horizontal'
  return `<div class="steps${row ? ' steps--row' : ''}">${steps}</div>`
}

/** Renders two panels with an arrow between them: the before/after shape. */
function blockCompare(block) {
  if (block === null || typeof block !== 'object') return ''
  const side = (panel, name) => {
    if (panel === null || typeof panel !== 'object') return ''
    const head = `<div class="panel__head">${inline(panel.head ?? (name === 'left' ? 'было' : 'стало'))}</div>`
    const title = panel.title ? `<div class="panel__title">${inline(panel.title)}</div>` : ''
    const text = panel.text ? `<div class="panel__text">${inline(panel.text)}</div>` : ''
    const items = Array.isArray(panel.list)
      ? `<div class="card__list">${panel.list.map((item) => `<span>${inline(item)}</span>`).join('')}</div>`
      : ''
    return `<div class="panel panel--${name === 'left' ? 'before' : 'after'}">${head}${title}${text}${items}</div>`
  }
  const left = side(block.left, 'left')
  const right = side(block.right, 'right')
  if (left === '' && right === '') return ''
  const arrow = block.arrow === false ? '' : `<div class="panel__arrow" aria-hidden="true">→</div>`
  return `<div class="compare">${left}${arrow}${right}</div>`
}

/** Renders a chart block: the SVG plus its legend and caption. */
function blockChart(block, ctx) {
  if (block === null || typeof block !== 'object') return ''
  const chart = chartSvg({ ...block, width: block.width ?? 1240, height: block.height ?? 400 })
  if (chart.svg === '') {
    for (const error of chart.errors) ctx.errors.push(error)
    return ''
  }
  for (const warning of chart.warnings) ctx.warnings.push(warning)
  const legend = legendItems(block)
  const legendHtml = legend.length > 1
    ? `<div class="chart__legend">${legend.map((item) => `<span style="--c:var(--${item.tone})"><i></i>${inline(item.label)}</span>`).join('')}</div>`
    : ''
  const caption = block.caption ? `<div class="figure__caption">${inline(block.caption)}</div>` : ''
  return `<div class="chart"><div class="chart__body" data-anim="zoom">${chart.svg}</div>${legendHtml}${caption}</div>`
}

/**
 * Renders a timed scene: the scene markup (an SVG or HTML with `data-id` targets),
 * a JSON track list the player turns into Web Animations, synced captions, a
 * progress bar and play/replay controls. The scene markup states the START state;
 * a track states the CHANGE, so the spec reads as a shot list rather than a script.
 * An unknown target is an error named with its id: the player would silently skip
 * it, and a track that animates nothing is the defect this renderer must surface.
 */
function blockMotion(block, ctx) {
  if (block === null || typeof block !== 'object') return ''
  const scene = typeof block.svg === 'string' ? block.svg : typeof block.html === 'string' ? block.html : ''
  if (scene.trim() === '') {
    ctx.errors.push('motion: needs `svg` (inline SVG markup) or `html` as the scene')
    return ''
  }
  const tracks = Array.isArray(block.tracks) ? block.tracks.filter((track) => track && typeof track === 'object') : []
  if (tracks.length === 0) {
    ctx.errors.push('motion: needs at least one track [{ target, at, dur, to }]')
    return ''
  }
  const ids = new Set([...scene.matchAll(/data-id="([^"]+)"/g)].map((match) => match[1]))
  let longest = 0
  for (const track of tracks) {
    if (typeof track.target !== 'string' || track.target === '') {
      ctx.errors.push('motion: every track needs a `target` (the data-id of a scene element)')
      continue
    }
    if (!ids.has(track.target)) ctx.errors.push(`motion: track target "${track.target}" is not in the scene (known: ${[...ids].join(', ') || 'none'})`)
    const end = (num(track.at) ?? 0) + (num(track.dur) ?? 0)
    if (Number.isFinite(end)) longest = Math.max(longest, end)
  }
  const duration = num(block.duration) ?? longest
  if (!(duration > 0)) {
    ctx.errors.push('motion: `duration` must be a positive number of milliseconds (or leave it out and give tracks at/dur)')
    return ''
  }
  const captions = Array.isArray(block.captions) ? block.captions.filter((caption) => caption && typeof caption === 'object') : []
  const pace = num(block.pace) === null || num(block.pace) <= 0 ? 1 : num(block.pace)
  const spec = {
    tracks: tracks.map((track) => ({
      target: String(track.target ?? ''),
      at: num(track.at) ?? 0,
      dur: num(track.dur) ?? 300,
      ease: typeof track.ease === 'string' ? track.ease : 'ease-out',
      ...(track.from === undefined ? {} : { from: track.from }),
      to: track.to ?? {},
      ...(track.repeat === true ? { repeat: true } : {}),
      ...(track.pingPong === true ? { pingPong: true } : {}),
    })),
  }
  const json = JSON.stringify(spec).replace(/</g, '\\u003c')
  const captionHtml = captions.map((caption) => {
    const at = num(caption.at) ?? 0
    const dur = num(caption.dur) ?? 1400
    return `<div class="motion__caption" data-at="${at}" data-dur="${dur}">${inline(caption.text)}</div>`
  }).join('')
  const note = block.caption ? `<div class="figure__caption">${inline(block.caption)}</div>` : ''
  return `<div class="motion" data-duration="${duration}" data-autoplay="${block.autoplay === false ? '0' : '1'}" data-loop="${block.loop === true ? '1' : '0'}" data-pace="${pace}">`
    + `<div class="motion__stage"${block.flush === true ? ' data-flush="1"' : ''}>${scene}</div>`
    + `<template class="motion__spec">${json}</template>`
    + (captionHtml === '' ? '' : `<div class="motion__captions">${captionHtml}</div>`)
    + `<div class="motion__bar"><i class="motion__progress"></i></div>`
    + `<div class="motion__controls">`
    + `<button type="button" data-motion="toggle" aria-label="Пауза и продолжение">⏸</button>`
    + `<button type="button" data-motion="replay" aria-label="Повторить с начала">⟲</button>`
    + `<span class="motion__clock">0,0 с / ${(duration / 1000).toFixed(1).replace('.', ',')} с</span>`
    + '</div>'
    + note
    + '</div>'
}

/** Renders a figure: an inline SVG the spec supplies, or raw HTML. */
function blockVisual(block, ctx) {
  if (block === null || typeof block !== 'object') return ''
  const body = block.svg ?? block.html
  if (typeof body !== 'string' || body.trim() === '') {
    ctx.errors.push('visual: needs `svg` (inline SVG markup) or `html`')
    return ''
  }
  const flush = block.flush === true ? ' figure__canvas--flush' : ''
  const caption = block.caption ? `<div class="figure__caption">${inline(block.caption)}</div>` : ''
  return `<div class="figure"><div class="figure__canvas${flush}">${body}</div>${caption}</div>`
}

/** Renders a code block; `**…**` marks an accent token and `==…==` a value. */
function blockCode(block) {
  if (block === null || typeof block !== 'object') return ''
  const text = block.text ?? block.code
  if (typeof text !== 'string') return ''
  const label = block.title ? `<div class="figure__caption">${inline(block.title)}</div>` : ''
  return `${label}<pre class="code">${inline(text)}</pre>`
}

/** Renders the blocks of one slide in a fixed order, collecting spec problems. */
function renderBlocks(slide, ctx) {
  const parts = []
  for (const key of BLOCK_ORDER) {
    const block = slide[key]
    if (block === undefined || block === null) continue
    const frag = slide.frag === true || (block !== null && typeof block === 'object' && !Array.isArray(block) && block.frag === true)
    let html = ''
    if (key === 'kpis') html = blockKpis(block, ctx)
    else if (key === 'cards') html = blockCards(block, ctx)
    else if (key === 'table') html = blockTable(block)
    else if (key === 'timeline') html = blockTimeline(block)
    else if (key === 'quote') html = blockQuote(block)
    else if (key === 'chips') html = blockChips(block)
    else if (key === 'callout') html = blockCallout(block)
    else if (key === 'list') html = blockList(block)
    else if (key === 'steps') html = blockSteps(block, slide.layout)
    else if (key === 'compare') html = blockCompare(block)
    else if (key === 'chart') html = blockChart(block, ctx)
    else if (key === 'motion') html = blockMotion(block, ctx)
    else if (key === 'visual') html = blockVisual(block, ctx)
    else if (key === 'code') html = blockCode(block)
    if (html !== '') parts.push(fragment(html, parts.length, { frag }))
  }
  return parts.join('')
}

/**
 * The entrance attribute list for one element: the animation kind plus its
 * stagger index. `data-anim` must always be present — an element that only
 * carries `--i` sits at opacity 0 forever, because the reveal rule keys on the
 * attribute, not on the style.
 * @param index - The stagger position (delay = index × 70 ms).
 * @param kind - rise (default), fade, zoom, left, or none for no animation.
 */
function enter(index, kind) {
  return ` data-anim="${esc(kind ?? 'rise')}" style="--i:${index}"`
}

/** Builds the header of a content slide: kicker, title, lede. */
function header(slide, titleClass, startIndex) {
  let index = startIndex
  const kicker = slide.kicker ? `<div class="kicker"${enter(index++)}>${inline(slide.kicker)}</div>` : ''
  const title = slide.title ? `<h2 class="title${titleClass}"${enter(index++)}>${inline(slide.title)}</h2>` : ''
  const lede = slide.lede ? `<p class="lede"${enter(index++)}>${inline(slide.lede)}</p>` : ''
  return { html: kicker + title + lede, index }
}

/**
 * Renders one slide, or reports why it cannot be rendered.
 * @returns {{ html: string, title: string, count: number }}
 */
function slideHtml(slide, index, ctx) {
  const number = index + 1
  if (slide === null || typeof slide !== 'object' || Array.isArray(slide)) {
    ctx.errors.push(`slide ${number}: expected a JSON object`)
    return { html: '', title: '', count: 0 }
  }
  const requested = slide.type ?? (index === 0 ? 'cover' : 'content')
  let type = requested
  if (!SLIDE_TYPES.includes(type)) {
    ctx.errors.push(`slide ${number}: unknown type ${JSON.stringify(requested)} (${SLIDE_TYPES.join(', ')})`)
    type = 'content'
  }
  if (slide.title === undefined && type !== 'raw') ctx.errors.push(`slide ${number}: has no title`)
  const note = slide.note ? attr(typeof slide.note === 'string' ? slide.note : String(slide.note)) : ''
  const flush = slide.flush === true ? ' slide--flush' : ''
  const body = slide.body ? `<div class="lede"${enter(3)}>${inline(slide.body)}</div>` : ''
  const blocks = renderBlocks(slide, ctx)
  let inner = ''

  if (type === 'cover') {
    inner = '<div class="ornament"></div><div class="ornament ornament--line"></div><div class="wrap">'
      + (slide.kicker ? `<div class="kicker"${enter(0)}>${inline(slide.kicker)}</div>` : '')
      + (slide.title ? `<h1 class="title title--xl"${enter(1)}>${inline(slide.title)}</h1>` : '')
      + '<div class="rule"' + enter(2) + '></div>'
      + (slide.lede ? `<p class="lede"${enter(3)}>${inline(slide.lede)}</p>` : '')
      + (Array.isArray(slide.meta) && slide.meta.length > 0
        ? `<div class="cover-meta"${enter(4)}>${slide.meta.map((item) => `<span>${inline(item)}</span>`).join('')}</div>`
        : '')
      + body + blocks
      + '</div>'
  } else if (type === 'section') {
    inner = '<div class="ornament ornament--line"></div><div class="wrap">'
      + (slide.kicker ? `<div class="kicker"${enter(0)}>${inline(slide.kicker)}</div>` : '')
      + (slide.title ? `<h2 class="title"${enter(1)}>${inline(slide.title)}</h2>` : '')
      + '<div class="divider"' + enter(2) + '>' + esc(slide.session ?? ctx.foot ?? '') + '</div>'
      + (slide.lede ? `<p class="lede"${enter(3)}>${inline(slide.lede)}</p>` : '')
      + body + blocks
      + '</div>'
  } else if (type === 'raw') {
    const raw = typeof slide.html === 'string' ? slide.html : ''
    if (raw === '') ctx.errors.push(`slide ${number}: raw needs \`html\``)
    const css = typeof slide.css === 'string' ? `<style>${slide.css}</style>` : ''
    const js = typeof slide.js === 'string' ? `<script>${slide.js}</script>` : ''
    inner = `<div class="wrap">${raw}</div>${css}${js}`
  } else {
    const { html } = header(slide, '', 0)
    if (slide.anim !== undefined && !['rise', 'fade', 'zoom', 'left', 'none'].includes(slide.anim)) {
      ctx.warnings.push(`slide ${number}: unknown anim ${JSON.stringify(slide.anim)} (rise, fade, zoom, left, none)`)
    }
    inner = `<div class="wrap">${html}${body}${blocks}</div>`
  }

  const title = typeof slide.title === 'string' ? slide.title : ''
  const html = `<section class="slide slide--${type}${flush}" data-title="${attr(title)}" data-number="${number}"`
    + (note === '' ? '' : ` data-note="${note}"`)
    + ` aria-label="Слайд ${number}" aria-hidden="${index === 0 ? 'false' : 'true'}">${inner}</section>`
  return { html, title, count: blocks === '' && slide.lede === undefined && slide.html === undefined && type !== 'cover' && type !== 'section' ? 0 : 1 }
}

/** The document shell: charset, viewport, title, inline CSS, body. */
function document({ theme, title, lang, css, body, script, bodyClass }) {
  return `<!DOCTYPE html>
<html lang="${attr(lang ?? 'ru')}" data-theme="${esc(theme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title ?? 'Презентация')}</title>
<style>
${css}
</style>
</head>
<body class="${attr(bodyClass ?? '')}">
${body}
<script>
${script}
</script>
</body>
</html>
`
}

/**
 * Renders a whole deck.
 * @param spec - The deck spec (see the file contract).
 * @param options - `{ css }` — the theme CSS to inline (required; the tool reads it).
 * @returns `{ html, theme, slides, errors, warnings }`.
 */
export function renderDeck(spec, options = {}) {
  const errors = []
  const warnings = []
  const css = typeof options.css === 'string' && options.css !== '' ? options.css : ''
  if (css === '') errors.push('renderer: no style sheet was supplied, the document would be unstyled')
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return { html: null, theme: null, slides: 0, errors: [...errors, 'spec: expected a JSON object'], warnings }
  }
  let theme = spec.theme ?? 'ember'
  if (typeof theme !== 'string' || !THEMES.includes(theme)) {
    warnings.push(`theme: unknown ${JSON.stringify(spec.theme)} (${THEMES.join(', ')}), using ember`)
    theme = 'ember'
  }
  const slides = Array.isArray(spec.slides) ? spec.slides : null
  if (slides === null || slides.length === 0) {
    return { html: null, theme, slides: 0, errors: [...errors, 'spec: `slides` must be a non-empty array'], warnings }
  }
  const ctx = { errors, warnings, foot: spec.foot }
  const rendered = []
  slides.forEach((slide, index) => {
    const result = slideHtml(slide, index, ctx)
    if (result.html !== '') rendered.push(result)
    if (result.count === 0) warnings.push(`slide ${index + 1}: nothing to show`)
  })
  if (rendered.length === 0) {
    return { html: null, theme, slides: 0, errors: [...errors, 'spec: no slide could be rendered'], warnings }
  }
  const controls = '<div class="deck-controls">'
    + '<button type="button" data-deck-action="prev" aria-label="Предыдущий слайд">←</button>'
    + '<button type="button" data-deck-action="next" aria-label="Следующий слайд">→</button>'
    + '<button type="button" data-deck-action="overview" aria-label="Обзор слайдов">обзор</button>'
    + '<button type="button" data-deck-action="notes" aria-label="Заметки">заметки</button>'
    + '<button type="button" data-deck-action="fullscreen" aria-label="Полный экран">⛶</button>'
    + '</div>'
  const body = `<div class="sr-only"><h1>${esc(spec.title ?? 'Презентация')}</h1></div>
<div id="deck" tabindex="0"><div class="stage">
${rendered.map((slide) => slide.html).join('\n')}
</div></div>
<div class="deck-progress"><div class="deck-progress__bar"></div></div>
${controls}
<div class="deck-hint"><b>←</b> <b>→</b> слайды · <b>F</b> полный экран · <b>O</b> обзор · <b>N</b> заметки · печать даёт слайд на страницу</div>
<div class="deck-overview" role="dialog" aria-label="Обзор слайдов"></div>
<div class="deck-notes" role="note"></div>`
  return {
    html: document({ theme, title: spec.title, lang: spec.lang, css, body, script: PLAYER_JS, bodyClass: 'deck-body' }),
    theme,
    slides: rendered.length,
    errors,
    warnings,
  }
}

export { attr, document, fmt }
