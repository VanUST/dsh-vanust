/**
 * PURPOSE: Draw the four charts a deck or a board needs — bar, line, donut and
 *          sparkline — as inline SVG with no dependency, so a rendered document
 *          stays one file and opens with no network. Coordinates are computed
 *          here; the renderer never hand-places a bar.
 * INPUTS:  a chart spec: { kind, title?, unit?, data, series?, max?, width?,
 *          height? }. `data` is [{ label, value, tone? }] for bar/line/donut and
 *          a number array for sparkline; `series` is [{ name, tone?, points }]
 *          where points is the same [{ label, value }] shape.
 * OUTPUTS: `chartSvg(spec)` returns { svg, errors, warnings } and never throws:
 *          an empty or non-numeric series is an error with the chart skipped.
 *          `legendItems(spec)` returns the swatches a caller prints under it.
 * KEYWORDS: presentation, dashboard, chart, svg, bar, line, donut, sparkline.
 */
import { esc, fmt, num, tone } from './text.mjs'

/** Palette order for a multi-series chart: one accent, then the semantic tones. */
const SERIES_TONES = ['accent', 'info', 'violet', 'ok', 'danger', 'cyan']

const DEFAULTS = { width: 1200, height: 460, padLeft: 62, padRight: 26, padTop: 30, padBottom: 46 }

/** Reads a positive size from the spec, keeping the drawing inside sane bounds. */
function size(value, fallback, min, max) {
  const parsed = num(value)
  if (parsed === null) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

/**
 * Rounds a maximum up to a readable axis top: 1, 2, 2.5 or 5 times a power of ten.
 * A chart whose top is 93 reads as an accident; one whose top is 100 reads as a scale.
 * @param value - The data maximum.
 * @returns A tick value at or above it.
 */
export function niceMax(value) {
  if (!(value > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const scaled = value / power
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10
  return step * power
}

/** Every plotted value of a bar or line chart, so the axis is scaled once. */
function plotValues(spec) {
  const rows = Array.isArray(spec.data) ? spec.data : []
  const extra = Array.isArray(spec.series)
    ? spec.series.flatMap((series) => (Array.isArray(series?.points) ? series.points : []))
    : []
  return [...rows, ...extra].map((row) => num(row?.value)).filter((value) => value !== null)
}

/** Grid lines and their labels: four bands over the plot area. */
function grid({ left, right, top, bottom }, max, unit) {
  const rows = []
  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4
    const y = bottom - ratio * (bottom - top)
    const value = max * ratio
    rows.push(`<line x1="${left}" y1="${y.toFixed(1)}" x2="${right}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1" />`)
    rows.push(`<text x="${left - 12}" y="${(y + 4).toFixed(1)}" text-anchor="end" style="fill:var(--muted);font-family:var(--font-mono);font-size:13px">${esc(fmt(value, 0))}${esc(unit)}</text>`)
  }
  return rows.join('')
}

/** Truncates a tick label so a dense axis stays readable. */
function tick(label, limit = 14) {
  const text = String(label ?? '')
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

/** Renders the bar chart: vertical bars, value on top, label underneath. */
function bar(spec, box) {
  const data = Array.isArray(spec.data) ? spec.data.filter((row) => row && num(row.value) !== null) : []
  if (data.length === 0) return { svg: '', errors: ['chart bar: data must hold at least one {label, value} row'] }
  const { left, right, top, bottom } = box
  const innerW = right - left
  const innerH = bottom - top
  const max = box.max ?? niceMax(Math.max(...data.map((row) => Math.abs(num(row.value)))))
  const band = innerW / data.length
  const barW = Math.max(10, Math.min(band * 0.58, 150))
  const parts = [grid(box, max, spec.unit ? ` ${spec.unit}` : '')]
  data.forEach((row, index) => {
    const value = num(row.value)
    const height = Math.max(2, (Math.abs(value) / max) * innerH)
    const x = left + band * index + (band - barW) / 2
    const y = bottom - height
    const fill = `var(--${tone(row.tone, 'accent')})`
    parts.push(`<rect class="bar-grow" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${height.toFixed(1)}" rx="4" fill="${fill}" opacity="0.92" style="transform-box:fill-box;transform-origin:bottom;animation-delay:${index * 70}ms" />`)
    parts.push(`<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 10).toFixed(1)}" text-anchor="middle" style="fill:var(--ink);font-family:var(--font-mono);font-size:14px">${esc(fmt(value, 1))}</text>`)
    parts.push(`<text x="${(x + barW / 2).toFixed(1)}" y="${bottom + 26}" text-anchor="middle" style="fill:var(--ink-2);font-family:var(--font-sans);font-size:14px">${esc(tick(row.label, 16))}</text>`)
  })
  parts.push(`<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="var(--line-2)" stroke-width="1.5" />`)
  return { svg: parts.join(''), errors: [] }
}

/** A smooth-ish path through points: straight segments read as data, curves as decoration. */
function pathFrom(points) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
}

/** Renders a line chart with one or more series; the first series gets an area fill. */
function line(spec, box) {
  const primary = Array.isArray(spec.data) ? spec.data.filter((row) => row && num(row.value) !== null) : []
  const extra = Array.isArray(spec.series)
    ? spec.series
      .filter((series) => series && Array.isArray(series.points))
      .map((series, index) => ({
        name: series.name ?? `series ${index + 2}`,
        tone: tone(series.tone, SERIES_TONES[(index + 1) % SERIES_TONES.length]),
        points: series.points.filter((point) => point && num(point.value) !== null),
      }))
      .filter((series) => series.points.length > 0)
    : []
  if (primary.length === 0 && extra.length === 0) return { svg: '', errors: ['chart line: data must hold at least one {label, value} row'] }
  const { left, right, top, bottom } = box
  const innerW = right - left
  const innerH = bottom - top
  const max = box.max ?? niceMax(Math.max(...[...primary, ...extra.flatMap((series) => series.points)].map((row) => Math.abs(num(row.value)))))
  const labels = primary.length > 0 ? primary : extra[0].points
  const count = Math.max(labels.length, 2)
  const xAt = (index) => left + (count === 1 ? innerW / 2 : (index / (count - 1)) * innerW)
  const yAt = (value) => bottom - (Math.abs(num(value)) / max) * innerH
  const parts = [grid(box, max, spec.unit ? ` ${spec.unit}` : '')]

  const drawSeries = (points, toneName, index, withArea) => {
    const coords = points.map((point, at) => ({ x: xAt(at), y: yAt(point.value) }))
    if (withArea) {
      const area = `${pathFrom(coords)} L${xAt(points.length - 1).toFixed(1)} ${bottom} L${xAt(0).toFixed(1)} ${bottom} Z`
      parts.push(`<path d="${area}" fill="var(${`--${toneName}`})" opacity="0.10" />`)
    }
    const dash = `pathLength="1000" style="--len:1000;animation-delay:${index * 120}ms"`
    parts.push(`<path class="line-draw" d="${pathFrom(coords)}" fill="none" stroke="var(--${toneName})" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" ${dash} />`)
    coords.forEach((point) => {
      parts.push(`<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5" fill="var(--bg)" stroke="var(--${toneName})" stroke-width="2.5" />`)
    })
  }

  if (primary.length > 0) drawSeries(primary, 'accent', 0, true)
  extra.forEach((series, index) => drawSeries(series.points, series.tone, index + 1, false))

  const every = Math.ceil(labels.length / 8)
  labels.forEach((row, index) => {
    if (index % every !== 0 && index !== labels.length - 1) return
    parts.push(`<text x="${xAt(index).toFixed(1)}" y="${bottom + 26}" text-anchor="middle" style="fill:var(--ink-2);font-family:var(--font-sans);font-size:14px">${esc(tick(row.label, 16))}</text>`)
  })
  parts.push(`<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="var(--line-2)" stroke-width="1.5" />`)
  return { svg: parts.join(''), errors: [] }
}

/** Renders a donut: one sweep per slice, a hole, and the total in the middle. */
function donut(spec, box) {
  const data = Array.isArray(spec.data) ? spec.data.filter((row) => row && num(row.value) !== null && num(row.value) > 0) : []
  if (data.length === 0) return { svg: '', errors: ['chart donut: data must hold at least one positive {label, value} row'] }
  const width = box.right + box.padRight
  const height = box.bottom + box.padBottom
  const cx = width / 2
  const cy = height / 2 - 6
  const radius = Math.max(40, Math.min(width, height) / 2 - 44)
  const stroke = Math.max(16, radius * 0.34)
  const inner = radius - stroke / 2
  const total = data.reduce((sum, row) => sum + num(row.value), 0)
  const gap = data.length > 1 ? 2.4 : 0
  const parts = [`<circle cx="${cx}" cy="${cy}" r="${inner}" fill="none" stroke="var(--line)" stroke-width="${stroke}" />`]
  let angle = -90
  data.forEach((row, index) => {
    const sweep = (num(row.value) / total) * 360 - gap
    const r = (radius)
    const start = (angle * Math.PI) / 180
    const end = ((angle + Math.max(0.5, sweep)) * Math.PI) / 180
    const x1 = cx + r * Math.cos(start)
    const y1 = cy + r * Math.sin(start)
    const x2 = cx + r * Math.cos(end)
    const y2 = cy + r * Math.sin(end)
    const large = sweep > 180 ? 1 : 0
    const d = `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`
    parts.push(`<path class="donut-sweep" d="${d}" fill="none" stroke="var(--${tone(row.tone, SERIES_TONES[index % SERIES_TONES.length])})" stroke-width="${stroke}" stroke-linecap="round" pathLength="1000" style="--len:1000;animation-delay:${index * 90}ms" />`)
    angle += sweep + gap
  })
  const center = spec.center ?? { value: spec.centerValue ?? fmt(total, 0), label: spec.centerLabel ?? 'всего' }
  if (center && (center.value !== undefined || center.label !== undefined)) {
    parts.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" style="fill:var(--ink);font-family:var(--font-display);font-size:${Math.round(radius / 3.1)}px;font-weight:700">${esc(center.value ?? '')}</text>`)
    parts.push(`<text x="${cx}" y="${cy + Math.round(radius / 3.1) + 8}" text-anchor="middle" style="fill:var(--muted);font-family:var(--font-sans);font-size:14px">${esc(center.label ?? '')}</text>`)
  }
  return { svg: parts.join(''), errors: [] }
}

/** Renders a sparkline: a quiet trend line with the last point marked. */
function sparkline(spec, box) {
  const values = Array.isArray(spec.data) ? spec.data.map((value) => num(value)).filter((value) => value !== null) : []
  if (values.length < 2) return { svg: '', errors: ['chart sparkline: data must hold at least two numbers'] }
  const { left, right, top, bottom } = box
  const innerW = right - left
  const innerH = bottom - top
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values.map((value, index) => ({
    x: left + (index / (values.length - 1)) * innerW,
    y: bottom - ((value - min) / span) * innerH,
  }))
  const last = points[points.length - 1]
  const parts = [
    `<path d="${pathFrom(points)} L${right} ${bottom} L${left} ${bottom} Z" fill="var(--accent)" opacity="0.10" />`,
    `<path class="line-draw" d="${pathFrom(points)}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" pathLength="1000" style="--len:1000" />`,
    `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4" fill="var(--accent)" />`,
  ]
  return { svg: parts.join(''), errors: [] }
}

/**
 * Renders one chart spec.
 * @param spec - The chart spec (see the file contract).
 * @returns `{ svg, errors, warnings, kind }`; `svg` is the inner SVG markup.
 */
export function chartSvg(spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return { svg: '', errors: ['chart: expected a JSON object'], warnings: [], kind: null }
  }
  const kind = spec.kind ?? 'bar'
  const draw = { bar, line, donut, sparkline }[kind]
  if (draw === undefined) {
    return { svg: '', errors: [`chart: unknown kind ${JSON.stringify(kind)} (bar, line, donut, sparkline)`], warnings: [], kind: null }
  }
  const width = size(spec.width, DEFAULTS.width, 220, 2000)
  const height = size(spec.height, DEFAULTS.height, 120, 1200)
  // The axis gutter must fit the WIDEST tick label, not a guessed 62 px: a deck
  // that plots `2 000 мс` clipped the leading digits to `000 мс` on 2026-11-20.
  const values = kind === 'bar' || kind === 'line' ? plotValues(spec) : []
  const max = values.length > 0 ? niceMax(Math.max(...values.map((value) => Math.abs(value)))) : null
  const unitText = spec.unit ? ` ${spec.unit}` : ''
  const tickChars = max === null ? 0 : fmt(max, 0).length + unitText.length
  const gutter = Math.max(size(spec.padLeft, DEFAULTS.padLeft, 0, width / 3), 22 + Math.round(tickChars * 8))
  const box = {
    left: gutter,
    max,
    right: width - size(spec.padRight, DEFAULTS.padRight, 0, width / 3),
    top: size(spec.padTop, DEFAULTS.padTop, 0, height / 3),
    bottom: height - size(spec.padBottom, DEFAULTS.padBottom, 0, height / 3),
    padRight: size(spec.padRight, DEFAULTS.padRight, 0, width / 3),
    padBottom: size(spec.padBottom, DEFAULTS.padBottom, 0, height / 3),
  }
  const result = draw(spec, box)
  if (result.svg === '') return { svg: '', errors: result.errors, warnings: [], kind }
  const label = spec.title ? `role="img" aria-label="${esc(spec.title)}"` : 'role="img"'
  return {
    svg: `<svg viewBox="0 0 ${width} ${height}" ${label} preserveAspectRatio="xMidYMid meet" style="max-width:100%;height:auto">${result.svg}</svg>`,
    errors: [],
    warnings: [],
    kind,
  }
}

/**
 * The swatches to print under a chart: the primary series plus any extras, or one
 * swatch per slice of a donut.
 * @param spec - The chart spec.
 * @returns [{ label, tone }] — empty for charts that label themselves in place.
 */
export function legendItems(spec) {
  if (spec === null || typeof spec !== 'object') return []
  if (spec.kind === 'donut' && Array.isArray(spec.data)) {
    return spec.data.slice(0, 6).map((row, index) => ({
      label: row?.label ?? '',
      tone: tone(row?.tone, SERIES_TONES[index % SERIES_TONES.length]),
    }))
  }
  const items = []
  if (Array.isArray(spec.data) && spec.data.length > 0) items.push({ label: spec.primaryLabel ?? spec.title ?? 'всего', tone: 'accent' })
  if (Array.isArray(spec.series)) {
    spec.series.forEach((series, index) => {
      if (series === null || typeof series !== 'object') return
      items.push({ label: series.name ?? `series ${index + 2}`, tone: tone(series.tone, SERIES_TONES[(index + 1) % SERIES_TONES.length]) })
    })
  }
  return items
}

export { SERIES_TONES }
