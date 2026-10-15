/**
 * PURPOSE: Render a diagram spec into one standalone HTML document, so the agent
 *          produces a scheme the harness can already display (the Sidebar document
 *          preview renders `.html` in a script-enabled sandboxed frame) and the user can
 *          print or keep as a single file.
 * INPUTS:  spec (object): { kind?, theme?, title?, subtitle?, direction?, legend?,
 *          legendTitle?, ... }. `kind` is 'flow' | 'arch' | 'sequence' | 'state' and
 *          selects the layout: flow and state read `nodes`/`edges`/`groups`, arch reads
 *          `layers`/`links`, sequence reads `actors`/`messages`/`blocks`. layout.mjs owns
 *          the geometry; this file owns the document around it and the legend, which is
 *          HTML rather than SVG so it stays put while the diagram is panned.
 * OUTPUTS: renderDiagram(spec) returns
 *          { html, theme, kind, nodes, edges, legend, errors, warnings } — never throws
 *          for a bad spec: an unknown kind, an unknown shape or colour, or an edge naming
 *          a missing node is reported in `errors` with the names involved and everything
 *          else still renders.
 *          `html` is null only when nothing drawable remains (a non-object spec, or a
 *          kind with no nodes/actors), because there is then no document to describe.
 * KEYWORDS: diagrams, scheme, renderer, html, svg, standalone, viewer, theme.
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A non-object spec, or `null`, yields html: null with the reason in `errors`.
 *   - An unknown `theme` falls back to the default and adds a `warnings` entry.
 *   - An unknown `kind` draws a flowchart and adds an `errors` entry, so a caller that
 *     ignores `errors` sees a diagram that is not the one it asked for.
 *   - A spec whose nodes all fail validation yields html: null, never an empty `<svg>`.
 */
import { readFileSync } from 'node:fs'
import { KINDS, buildScene } from './layout.mjs'
import { COLORS, SHAPE_NAMES, isShapeName, normalizeColor, renderSceneSvg, swatchMarkup } from './svg.mjs'

/** Theme ids the renderer accepts; the first one is the default. */
export const THEMES = ['ember', 'graphite', 'aurora', 'mono', 'paper']

/** The token and component layer, inlined into every document so the file is standalone. */
const CSS = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')

/**
 * Escapes text that lands in the document's markup.
 * @param value - Text to escape; null and undefined become the empty string.
 * @returns The escaped text.
 */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The viewer: fit, zoom, pan, theme cycling and printing.
 * Inline and classic on purpose — the preview frame is an opaque origin, so the file may
 * not load a module, reach storage or call out, and this is the whole interactive layer.
 */
const VIEWER = `(function(){
  var themes=${JSON.stringify(THEMES)};
  var stage=document.getElementById('dg-stage');
  var svg=document.getElementById('dg-svg');
  var level=document.getElementById('dg-level');
  var box=svg.viewBox.baseVal;
  var k=1,tx=0,ty=0;
  function apply(){
    svg.style.transform='translate('+tx+'px,'+ty+'px) scale('+k+')';
    if(level)level.textContent=Math.round(k*100)+'%';
  }
  function fit(){
    var w=stage.clientWidth-48,h=stage.clientHeight-48;
    k=Math.min(w/box.width,h/box.height);
    if(k>1.6)k=1.6;
    tx=(stage.clientWidth-box.width*k)/2;
    ty=(stage.clientHeight-box.height*k)/2;
    apply();
  }
  function zoomAt(factor,x,y){
    var next=Math.max(0.12,Math.min(6,k*factor));
    var ratio=next/k;
    tx=x-(x-tx)*ratio; ty=y-(y-ty)*ratio; k=next; apply();
  }
  document.getElementById('dg-fit').addEventListener('click',fit);
  document.getElementById('dg-in').addEventListener('click',function(){zoomAt(1.2,stage.clientWidth/2,stage.clientHeight/2)});
  document.getElementById('dg-out').addEventListener('click',function(){zoomAt(1/1.2,stage.clientWidth/2,stage.clientHeight/2)});
  document.getElementById('dg-one').addEventListener('click',function(){k=1;tx=(stage.clientWidth-box.width)/2;ty=(stage.clientHeight-box.height)/2;apply()});
  document.getElementById('dg-theme').addEventListener('click',function(){
    var at=themes.indexOf(document.documentElement.dataset.theme);
    document.documentElement.dataset.theme=themes[(at+1)%themes.length];
  });
  stage.addEventListener('wheel',function(event){
    event.preventDefault();
    var rect=stage.getBoundingClientRect();
    zoomAt(event.deltaY<0?1.1:1/1.1,event.clientX-rect.left,event.clientY-rect.top);
  },{passive:false});
  var dragging=false,lastX=0,lastY=0;
  stage.addEventListener('pointerdown',function(event){
    if(event.target.closest('.dg-node'))return;
    dragging=true;lastX=event.clientX;lastY=event.clientY;
    stage.classList.add('dg-grabbing');stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove',function(event){
    if(!dragging)return;
    tx+=event.clientX-lastX;ty+=event.clientY-lastY;
    lastX=event.clientX;lastY=event.clientY;apply();
  });
  stage.addEventListener('pointerup',function(event){
    dragging=false;stage.classList.remove('dg-grabbing');
    try{stage.releasePointerCapture(event.pointerId)}catch(error){}
  });
  addEventListener('keydown',function(event){
    if(event.key==='f'||event.key==='F')fit();
    else if(event.key==='t'||event.key==='T')document.getElementById('dg-theme').click();
    else if(event.key==='+'||event.key==='=')zoomAt(1.2,stage.clientWidth/2,stage.clientHeight/2);
    else if(event.key==='-')zoomAt(1/1.2,stage.clientWidth/2,stage.clientHeight/2);
  });
  addEventListener('resize',fit);
  fit();
})();`

/**
 * Builds the legend a spec asked for.
 * `legend: true` is a rough colour key derived from the colours the nodes actually use,
 * which is honest about what it is: a key to the palette, not to the author's meaning.
 * @param spec - The diagram spec.
 * @param scene - The laid-out scene, read for the automatic colour key.
 * @param errors - Error sink.
 * @returns An array of { label, color, shape }; empty when no legend was asked for.
 */
function legendEntries(spec, scene, errors) {
  const raw = spec.legend
  if (raw === undefined || raw === null || raw === false) return []
  if (raw === true) {
    const used = []
    for (const node of scene.nodes) {
      const color = node.color ?? 'muted'
      if (!used.includes(color)) used.push(color)
    }
    return used.map((color) => ({ label: color, color, shape: 'rect' }))
  }
  if (!Array.isArray(raw)) {
    errors.push('legend: expected an array of { label, color?, shape? }, or true for a colour key')
    return []
  }
  const out = []
  raw.forEach((entry, index) => {
    if (typeof entry === 'string') {
      out.push({ label: entry, color: 'muted', shape: 'rect' })
      return
    }
    if (entry === null || typeof entry !== 'object') {
      errors.push(`legend ${index + 1}: expected a label string or an object { label, color?, shape? }`)
      return
    }
    if (typeof entry.label !== 'string' || entry.label.length === 0) {
      errors.push(`legend ${index + 1}: no "label"`)
      return
    }
    const color = normalizeColor(entry.color)
    if (entry.color !== undefined && color === null) {
      errors.push(`legend ${index + 1}: colour "${entry.color}" is unknown; used "muted" (allowed: ${COLORS.join(', ')})`)
    }
    if (entry.shape !== undefined && !isShapeName(entry.shape)) {
      errors.push(`legend ${index + 1}: shape "${entry.shape}" is unknown; drew "rect" (allowed: ${SHAPE_NAMES.join(', ')})`)
    }
    out.push({ label: entry.label, color: color ?? 'muted', shape: entry.shape ?? 'rect' })
  })
  return out
}

/**
 * Wraps a rendered scene in the standalone document.
 * @param scene - The laid-out scene.
 * @param svg - The `<svg>` markup for the scene.
 * @param theme - The resolved theme id.
 * @param spec - The original spec, read for the title and subtitle.
 * @param legend - Legend entries, or an empty array.
 * @returns The complete HTML document.
 */
function page(scene, svg, theme, spec, legend) {
  const title = typeof spec.title === 'string' && spec.title.length > 0 ? spec.title : 'Diagram'
  const subtitle = typeof spec.subtitle === 'string' && spec.subtitle.length > 0
    ? spec.subtitle
    : (typeof spec.description === 'string' ? spec.description : '')
  const count = scene.kind === 'sequence'
    ? `${scene.nodes.filter((node) => node.shape !== 'note').length} actors · ${scene.edges.length} messages`
    : `${scene.nodes.length} nodes · ${scene.edges.length} edges`
  const legendBlock = legend.length === 0 ? '' : `<section class="dg-legend">`
    + `<span class="dg-legend__title">${esc(spec.legendTitle ?? 'Legend')}</span>`
    + `<ul class="dg-legend__items">`
    + legend.map((entry) => `<li class="dg-legend__item">${swatchMarkup(entry.shape, entry.color)}`
      + `<span>${esc(entry.label)}</span></li>`).join('')
    + '</ul></section>'
  return `<!doctype html>
<html lang="en" data-theme="${esc(theme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
${CSS}
</style>
</head>
<body class="dg">
<header class="dg-bar">
  <div class="dg-heading">
    <div class="dg-title">${esc(title)}</div>
    ${subtitle ? `<div class="dg-subtitle">${esc(subtitle)}</div>` : ''}
  </div>
  <span class="dg-chip">${esc(scene.kind)}</span>
  <span class="dg-chip dg-chip--dim">${esc(count)}</span>
  <span class="dg-grow"></span>
  <button class="dg-btn" id="dg-fit" type="button" title="Fit to window (F)">&#10530;</button>
  <button class="dg-btn" id="dg-out" type="button" title="Zoom out (−)">&#8722;</button>
  <button class="dg-btn" id="dg-in" type="button" title="Zoom in (+)">+</button>
  <button class="dg-btn" id="dg-one" type="button" title="Actual size">1:1</button>
  <button class="dg-btn" id="dg-theme" type="button" title="Switch theme (T)">&#9681;</button>
</header>
<main class="dg-stage" id="dg-stage">
${svg}
</main>
${legendBlock}
<footer class="dg-foot">
  <span id="dg-level">100%</span>
  <span class="dg-hint">drag to pan · wheel to zoom · F fit · T theme · printing gives the whole diagram</span>
</footer>
<script>
${VIEWER}
</script>
</body>
</html>
`
}

/**
 * Renders a whole diagram.
 * @param spec - The diagram spec (see the file contract).
 * @returns { html, theme, kind, nodes, edges, errors, warnings }; `html` is null when
 *   nothing drawable remains, and `errors` always explains why.
 */
export function renderDiagram(spec) {
  const errors = []
  const warnings = []
  const empty = (theme, kind) => ({ html: null, theme, kind, nodes: 0, edges: 0, errors, warnings })
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    errors.push('spec: expected an object { kind, nodes/actors/layers, ... }')
    return empty(null, null)
  }
  const theme = THEMES.includes(spec.theme) ? spec.theme : THEMES[0]
  if (spec.theme !== undefined && !THEMES.includes(spec.theme)) {
    warnings.push(`theme "${spec.theme}" is unknown; used "${theme}" (allowed: ${THEMES.join(', ')})`)
  }
  if (typeof spec.title !== 'string' || spec.title.length === 0) {
    warnings.push('title: none given — the document header will read "Diagram"')
  }
  const scene = buildScene(spec, { errors, warnings })
  if (scene.nodes.length === 0) {
    return empty(theme, scene.kind)
  }
  const legend = legendEntries(spec, scene, errors)
  const svg = renderSceneSvg(scene)
  return {
    html: page(scene, svg, theme, spec, legend),
    theme,
    kind: scene.kind,
    nodes: scene.nodes.length,
    edges: scene.edges.length,
    legend: legend.length,
    errors,
    warnings,
  }
}

export { CSS as THEME_CSS, KINDS }
