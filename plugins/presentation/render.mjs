/**
 * PURPOSE: Render a presentation spec into one standalone HTML document, so the
 *          agent produces a deck the harness can already display (the Sidebar
 *          document preview renders `.html` in a script-enabled sandboxed frame).
 * INPUTS:  spec (object): { theme?, title?, slides: Slide[] }. A Slide is
 *          { type?, kicker?, title, lede?, cards?, kpis?, table?, timeline?,
 *            quote?, chips?, callout?, note? }. `type` is 'cover' | 'section' |
 *            'content' and only changes the header treatment.
 *          Text fields accept `**bold**` and `==highlight==` inline markup.
 * OUTPUTS: renderDeck(spec) returns
 *          { html, theme, slides, errors, warnings } — never throws for a bad
 *          spec: an unknown slide type or a missing title is reported in `errors`
 *          with its slide index, and every valid slide still renders.
 *          Null/undefined spec or a non-array `slides` yields html: null,
 *          errors: [...], warnings: [].
 * KEYWORDS: presentation, slides, renderer, html, deck, standalone, theme.
 */
import { readFileSync } from 'node:fs'

/** Theme ids the renderer accepts; the first one is the default. */
export const THEMES = ['ember', 'graphite', 'aurora', 'mono', 'paper']

/** Slide types the renderer accepts, with the header shape each one uses. */
export const SLIDE_TYPES = ['cover', 'section', 'content']

const CSS = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')

const FONT_LINK = '<link href="https://fonts.googleapis.com/css2?family=PT+Sans:wght@400;700&family=PT+Mono&display=swap" rel="stylesheet">'

/**
 * Escapes the five HTML-significant characters, then applies the two inline
 * markers the spec allows.
 * @param value - Text to convert; non-strings are stringified first.
 * @returns HTML-safe text with `**bold**` and `==highlight==` applied.
 */
function inline(value) {
  const text = value === undefined || value === null ? '' : String(value)
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/==([^=]+)==/g, '<span class="hl">$1</span>')
}

/** Renders one card block. A card with no title is skipped rather than guessed at. */
function card(entry) {
  if (entry === null || typeof entry !== 'object') return ''
  const color = typeof entry.color === 'string' && /^[a-z0-9-]+$/i.test(entry.color) ? ` style="--c:var(--${entry.color})"` : ''
  const list = Array.isArray(entry.list) && entry.list.length > 0
    ? `<div class="card__list">${entry.list.map((item) => `<span>${inline(item)}</span>`).join('')}</div>`
    : ''
  return `<div class="card"${color}>`
    + (entry.title ? `<div class="card__title">${inline(entry.title)}</div>` : '')
    + (entry.text ? `<div class="card__text">${inline(entry.text)}</div>` : '')
    + list
    + '</div>'
}

/** Renders the KPI row; an empty or absent list renders nothing. */
function kpis(list) {
  if (!Array.isArray(list) || list.length === 0) return ''
  const cells = list.filter((k) => k && typeof k === 'object').map((k) => {
    const color = typeof k.color === 'string' && /^[a-z0-9-]+$/i.test(k.color) ? ` style="--c:var(--${k.color})"` : ''
    return `<div class="kpi"${color}>`
      + `<div class="kpi__value">${inline(k.value)}</div>`
      + `<div class="kpi__label">${inline(k.label)}</div>`
      + (k.note ? `<div class="kpi__note">${inline(k.note)}</div>` : '')
      + '</div>'
  }).join('')
  return cells ? `<div class="kpis">${cells}</div>` : ''
}

/** Renders a table block: `header` is a string array, `rows` an array of arrays. */
function table(block) {
  if (!block || typeof block !== 'object') return ''
  const header = Array.isArray(block.header) ? block.header : []
  const rows = Array.isArray(block.rows) ? block.rows : []
  if (header.length === 0 && rows.length === 0) return ''
  const head = header.length > 0
    ? `<thead><tr>${header.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>`
    : ''
  const body = rows.map((row) => {
    const cells = Array.isArray(row) ? row : [row]
    return `<tr>${cells.map((cell, i) => (i === 0
      ? `<td class="key">${inline(cell)}</td>`
      : `<td>${inline(cell)}</td>`)).join('')}</tr>`
  }).join('')
  return `<table class="table">${head}<tbody>${body}</tbody></table>`
}

/** Renders the timeline block; each step needs a title. */
function timeline(list) {
  if (!Array.isArray(list) || list.length === 0) return ''
  const steps = list.filter((s) => s && typeof s === 'object' && s.title).map((s) =>
    `<div class="tl-step"><div class="tl-title">${inline(s.title)}</div>`
    + (s.text ? `<div class="tl-text">${inline(s.text)}</div>` : '')
    + '</div>').join('')
  return steps ? `<div class="timeline">${steps}</div>` : ''
}

/** Renders the chips row with an optional label. */
function chips(block) {
  if (!block) return ''
  const items = Array.isArray(block) ? block : block.items
  if (!Array.isArray(items) || items.length === 0) return ''
  const label = !Array.isArray(block) && block.label
    ? `<span class="chips__label">${inline(block.label)}</span>`
    : ''
  return `<div class="chips">${label}${items.map((c) => `<span class="chip">${inline(c)}</span>`).join('')}</div>`
}

/** Renders the quote block. */
function quote(block) {
  if (!block || typeof block !== 'object' || !block.text) return ''
  return `<div class="quote"><div class="quote__text">${inline(block.text)}</div>`
    + (block.by ? `<div class="quote__by">${inline(block.by)}</div>` : '')
    + '</div>'
}

/** Renders every block a slide declares, in a fixed reading order. */
function blocksOf(slide) {
  return [
    Array.isArray(slide.cards) && slide.cards.length > 0
      ? `<div class="cards cards--${Math.min(slide.cards.length, 4)}">${slide.cards.map(card).join('')}</div>`
      : '',
    kpis(slide.kpis),
    table(slide.table),
    timeline(slide.timeline),
    quote(slide.quote),
    chips(slide.chips),
    slide.callout ? `<div class="callout">${inline(slide.callout)}</div>` : '',
    slide.note ? `<p class="hint">${inline(slide.note)}</p>` : ''
  ].filter(Boolean).join('')
}

/**
 * Builds the header of one slide.
 * @param slide - The slide object.
 * @param type - One of SLIDE_TYPES.
 * @returns The header HTML; a slide without a title contributes only its kicker.
 */
function headerOf(slide, type) {
  const size = type === 'cover' ? ' title--xl' : type === 'section' ? ' title--md' : ''
  return (slide.kicker ? `<div class="kicker">${inline(slide.kicker)}</div>` : '')
    + (slide.title ? `<h1 class="title${size}">${inline(slide.title)}</h1>` : '')
    + (type === 'cover' ? '' : '<div class="rule"></div>')
    + (slide.lede ? `<p class="lede">${inline(slide.lede)}</p>` : '')
}

/**
 * Renders one slide section.
 * @param slide - The slide object.
 * @param index - Zero-based slide position, used for the page number.
 * @param total - Total number of rendered slides.
 * @returns The `<section class="slide">` element.
 */
function slideOf(slide, index, total) {
  const type = SLIDE_TYPES.includes(slide.type) ? slide.type : 'content'
  const cls = type === 'cover' ? 'slide slide--cover' : type === 'section' ? 'slide slide--section' : 'slide'
  return `<section class="${cls}">\n  <div class="wrap">`
    + headerOf(slide, type)
    + blocksOf(slide)
    + `</div>\n  <div class="pagenum">${index + 1}<span>/${total}</span></div>\n</section>`
}

/** The player: dots, progress, keyboard and hash deep links. Inline and classic on purpose. */
const PLAYER = `(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide'));
  var dots=document.getElementById('dots'), progress=document.getElementById('progress');
  var cur=document.getElementById('cur'), stage=document.querySelector('.stage'), i=0;
  function fit(){
    if(!stage) return;
    var s=Math.min(innerWidth/1600,innerHeight/900);
    stage.style.transform='scale('+s+')';
  }
  slides.forEach(function(_,n){var d=document.createElement('i');d.title='Слайд '+(n+1);
    d.addEventListener('click',function(){go(n)});dots.appendChild(d)});
  function go(n,silent){
    i=Math.max(0,Math.min(slides.length-1,n));
    slides.forEach(function(s,k){s.classList.toggle('on',k===i)});
    [].forEach.call(dots.children,function(d,k){d.classList.toggle('on',k===i)});
    if(cur)cur.textContent=i+1;
    if(progress)progress.style.width=((i+1)/slides.length*100)+'%';
    if(!silent){ try{ history.replaceState(null,'','#'+(i+1)); }catch(e){} }
  }
  addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown'){e.preventDefault();go(i+1)}
    else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();go(i-1)}
    else if(e.key==='Home'){go(0)}else if(e.key==='End'){go(slides.length-1)}
    else if(e.key==='f'||e.key==='F'){
      try{
        if(document.fullscreenElement)document.exitFullscreen();
        else if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen();
      }catch(e){}
    }
    else if(/^[1-9]$/.test(e.key)){go(parseInt(e.key,10)-1)}
  });
  addEventListener('resize',fit);
  var start=parseInt((location.hash||'').replace('#',''),10);
  go(isFinite(start)&&start>0?start-1:0,true);
  fit();
})();`

/** Chrome for the standalone deck: one slide at a time, print = one page per slide. */
const DECK_CSS = `
  :root{--deck-bar:64px}
  body{display:block;overflow:hidden;background:var(--bg)}
  .deck{position:fixed;inset:0;display:grid;place-items:center}
  .stage{position:relative;width:var(--stage-w);height:var(--stage-h);flex:none;
    transform-origin:center}
  .slide{display:none;position:absolute;inset:0}
  .slide.on{display:block}
  .progress{position:fixed;top:0;left:0;height:3px;background:var(--accent);width:0;z-index:20;
    transition:width .35s ease}
  .dots{position:fixed;left:50%;transform:translateX(-50%);bottom:22px;display:flex;gap:9px;z-index:20}
  .dots i{width:10px;height:10px;border-radius:50%;cursor:pointer;
    background:color-mix(in srgb,var(--ink) 20%,transparent);transition:background .15s,transform .15s}
  .dots i:hover{background:color-mix(in srgb,var(--ink) 45%,transparent)}
  .dots i.on{background:var(--accent);transform:scale(1.25)}
  .hintbar{position:fixed;right:18px;bottom:20px;z-index:20;font-size:11.5px;color:var(--muted);
    font-family:var(--font-mono)}
  .navbtn{position:fixed;bottom:14px;z-index:20;width:40px;height:40px;border-radius:var(--r-md);
    display:grid;place-items:center;cursor:pointer;color:var(--ink);
    border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);
    background:color-mix(in srgb,var(--accent) 8%,transparent)}
  .navbtn:hover{background:color-mix(in srgb,var(--accent) 18%,transparent)}
  .navbtn.prev{left:16px}.navbtn.next{left:64px}
  .counter{position:fixed;right:18px;top:14px;z-index:20;font-size:12px;font-weight:700;color:var(--muted)}
  .counter b{color:var(--ink)}
  @media print{
    @page{size:1600px 900px;margin:0}
    body{background:#fff}
    .deck,.stage{position:static;display:block;transform:none !important}
    .slide{display:block !important;break-after:page;page-break-after:always;
      width:var(--stage-w);height:var(--stage-h)}
    .progress,.dots,.hintbar,.navbtn,.counter{display:none !important}
  }
  .layout-2{display:flex;gap:var(--sp-9);flex:1;min-height:0}
  .col{display:flex;flex-direction:column;min-width:0}
  .col--wide{flex:1.16}.col--narrow{flex:.84}
  .hint{font-size:12.5px;color:var(--muted);margin-top:14px}
  .hint b{color:var(--ink-2)}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--sp-4);margin-top:var(--sp-6)}
  .cards--1{grid-template-columns:1fr}
`

/**
 * Renders a whole deck.
 * @param spec - The deck spec (see the file contract).
 * @returns { html, theme, slides, errors, warnings } — html is null when the spec
 *   is not an object or `slides` is not an array; errors always explains why.
 */
export function renderDeck(spec) {
  const errors = []
  const warnings = []
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return { html: null, theme: null, slides: 0, errors: ['spec: expected an object { theme?, title?, slides[] }'], warnings }
  }
  const theme = THEMES.includes(spec.theme) ? spec.theme : 'ember'
  if (spec.theme !== undefined && !THEMES.includes(spec.theme)) {
    warnings.push(`theme "${spec.theme}" is unknown; used "${theme}" (allowed: ${THEMES.join(', ')})`)
  }
  if (!Array.isArray(spec.slides)) {
    return { html: null, theme, slides: 0, errors: ['slides: expected an array'], warnings }
  }
  const rendered = []
  spec.slides.forEach((slide, index) => {
    if (slide === null || typeof slide !== 'object' || Array.isArray(slide)) {
      errors.push(`slide ${index + 1}: expected an object`)
      return
    }
    if (slide.type !== undefined && !SLIDE_TYPES.includes(slide.type)) {
      errors.push(`slide ${index + 1}: unknown type "${slide.type}" (allowed: ${SLIDE_TYPES.join(', ')})`)
    }
    if (!slide.title) warnings.push(`slide ${index + 1}: no title — the header will be empty`)
    rendered.push(slide)
  })
  if (rendered.length === 0) {
    return { html: null, theme, slides: 0, errors: [...errors, 'no renderable slides'], warnings }
  }
  const total = rendered.length
  const body = rendered.map((slide, index) => slideOf(slide, index, total)).join('\n')
  const first = rendered[0]
  const title = typeof spec.title === 'string' && spec.title.length > 0
    ? spec.title
    : String(first.title || 'Презентация').replace(/[*=]/g, '')
  const html = `<!doctype html>
<html lang="ru" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${inline(title)}</title>
${FONT_LINK}
<style>
${CSS}
${DECK_CSS}
</style>
</head>
<body>
<div class="progress" id="progress"></div>
<div class="counter"><b id="cur">1</b> / ${total}</div>
<div class="deck">
<div class="stage">
${body}
</div>
</div>
<div class="dots" id="dots"></div>
<div class="navbtn prev" id="prev" title="Назад" aria-label="Назад">&#8592;</div>
<div class="navbtn next" id="next" title="Вперёд" aria-label="Вперёд">&#8594;</div>
<div class="hintbar">← → · F · 1…9 · Esc</div>
<script>
${PLAYER}
document.getElementById('prev').addEventListener('click',function(){var e=new KeyboardEvent('keydown',{key:'ArrowLeft'});dispatchEvent(e)});
document.getElementById('next').addEventListener('click',function(){var e=new KeyboardEvent('keydown',{key:'ArrowRight'});dispatchEvent(e)});
</script>
</body>
</html>
`
  return { html, theme, slides: total, errors, warnings }
}

export { CSS as THEME_CSS }
