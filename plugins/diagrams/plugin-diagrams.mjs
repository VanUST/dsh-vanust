/**
 * PURPOSE: Define the `diagram` tool — one call turns a JSON diagram spec into a
 *          standalone HTML file in the session workspace, which the harness's own
 *          Sidebar document preview then renders (`.html` is previewed in a
 *          script-enabled sandboxed frame, so the viewer works as written).
 * INPUTS:  args.spec (string, JSON diagram spec), args.out (string, optional file name).
 *          exec is the tool-exec context; the session working directory is read from
 *          exec.agent.session.header.cwd, falling back to process.cwd().
 * OUTPUTS: JSON { ok, degraded, path, bytes, kind, theme, nodes, edges, errors, warnings }
 *          on success, and { ok: false, errors } when the spec cannot be parsed or
 *          nothing drawable remains. `ok` means a file was written and nothing more:
 *          `errors` is where validity lives, and `degraded` is true exactly when
 *          `errors` is non-empty, so an ignored `errors` array cannot pass for a clean
 *          diagram. Never throws: a bad spec is a reported result, not a crash.
 * KEYWORDS: diagram, scheme, flowchart, architecture, sequence, tool, svg, html, render.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { KINDS, THEMES, renderDiagram } from './render.mjs'

/** Default file name; a stable name keeps repeated renders at one path instead of littering. */
const DEFAULT_OUT = 'diagram.html'

/**
 * Resolves the workspace directory a diagram is written into.
 * @param exec - Tool-exec context, possibly undefined.
 * @returns Absolute path of the session working directory, or of the process cwd.
 */
function workingDir(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
}

/**
 * Resolves the output path, refusing a name that is not a usable string.
 * @param out - Requested file name or absolute path.
 * @param cwd - Workspace directory used for relative names.
 * @returns Absolute target path, or null when the name is unusable.
 */
function targetPath(out, cwd) {
  const name = typeof out === 'string' && out.trim().length > 0 ? out.trim() : DEFAULT_OUT
  if (name.includes('\0')) return null
  return isAbsolute(name) ? resolve(name) : resolve(join(cwd, name))
}

/**
 * Drops keys whose value is `undefined`, recursively over the top level.
 * The harness serialises a tool result as lossless JSON and refuses a value that
 * carries `undefined`, so a payload must never contain one: an absent property and
 * a property set to `undefined` are not the same thing to that encoder.
 * @param value - The payload to sanitise.
 * @returns A shallow copy without `undefined` values; non-objects pass through.
 */
function lossless(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out
}

/** Mermaid shape brackets by the kit's node shapes. */
const MERMAID_SHAPES = {
  rect: ['[', ']'], round: ['(', ')'], pill: ['([', '])'], diamond: ['{', '}'],
  hexagon: ['{{', '}}'], circle: ['((', '))'], note: ['[', ']'], start: ['([', '])'],
  end: ['([', '])'], database: ['[(', ')]'], cylinder: ['[(', ')]'], parallelogram: ['[/', '/]'],
  decision: ['{', '}'],
}

/** One line of text, safe inside a quoted diagram label. */
function flat(value) {
  return String(value ?? '').replaceAll('"', "'").replace(/\s+/g, ' ').trim()
}

/** `id` usable as a Mermaid/D2 identifier. */
function ident(value, fallback) {
  const text = String(value ?? '').replace(/[^A-Za-z0-9_]/g, '_')
  return text === '' ? fallback : /^[0-9]/.test(text) ? `n_${text}` : text
}

/**
 * Render a diagram spec as Mermaid source.
 *
 * WHY: Mermaid is rendered natively by GitHub, GitLab and most wikis, so a diagram
 * emitted as source becomes reviewable in a pull request — the SVG file cannot.
 * Emission is offline and dependency-free; rendering is the caller's (`mmdc`, or the
 * viewer that already understands the fence).
 *
 * @param spec - The same diagram spec the SVG renderer accepts.
 * @returns `{ source, errors, kind }`; `source` is null when the kind is unknown.
 */
export function renderMermaid(spec) {
  const errors = []
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return { source: null, errors: ['spec: expected a JSON object'], kind: null }
  }
  const kind = spec.kind
  const nodes = Array.isArray(spec.nodes) ? spec.nodes.filter((n) => n !== null && typeof n === 'object') : []
  const edges = Array.isArray(spec.edges) ? spec.edges.filter((e) => e !== null && typeof e === 'object') : []
  const label = (node, index) => `${ident(node.id, `n${index}`)}`
  const text = (node) => flat(node.label ?? node.id)

  if (kind === 'flow' || kind === 'state') {
    const lines = kind === 'state' ? ['stateDiagram-v2'] : ['flowchart TD']
    for (const [index, node] of nodes.entries()) {
      const id = label(node, index)
      if (kind === 'state') {
        // A start/end marker is not a declaration in Mermaid; it only appears as
        // `[*]` inside a transition. Emitting it as a statement produced
        // `stateDiagram-v2` followed by bare `[*]` lines, which does not parse.
        if (node.shape === 'start' || node.shape === 'end') continue
        lines.push(`    ${id} : ${text(node)}`)
        continue
      }
      const [open, close] = MERMAID_SHAPES[node.shape] ?? MERMAID_SHAPES.rect
      lines.push(`    ${id}${open}"${text(node)}"${close}`)
    }
    for (const edge of edges) {
      const fromNode = nodes.find((n) => n.id === edge.from)
      const toNode = nodes.find((n) => n.id === edge.to)
      if (fromNode === undefined || toNode === undefined) { errors.push(`edge: unknown node ${edge.from} -> ${edge.to}`); continue }
      const from = kind === 'state' && (fromNode.shape === 'start') ? '[*]' : ident(fromNode.id, 'n')
      const to = kind === 'state' && (toNode.shape === 'end') ? '[*]' : ident(toNode.id, 'n')
      const labelText = typeof edge.label === 'string' && edge.label !== '' ? flat(edge.label) : ''
      if (kind === 'state') {
        // Mermaid state labels come AFTER the target: `a --> b : done`.
        lines.push(`    ${from} --> ${to}${labelText === '' ? '' : ` : ${labelText}`}`)
        continue
      }
      const arrow = edge.style === 'dashed' || edge.style === 'dotted' ? '-.->' : '-->'
      lines.push(`    ${from} ${arrow}${labelText === '' ? '' : `|${labelText}|`} ${to}`)
    }
    return { source: lines.join('\n'), errors, kind }
  }

  if (kind === 'arch') {
    const lines = ['flowchart TB']
    const layers = Array.isArray(spec.layers) ? spec.layers.filter((l) => l !== null && typeof l === 'object') : []
    for (const [layerIndex, layer] of layers.entries()) {
      const layerId = ident(layer.label, `layer${layerIndex}`)
      lines.push(`    subgraph ${layerId}["${flat(layer.label ?? layerId)}"]`)
      for (const [itemIndex, item] of (Array.isArray(layer.items) ? layer.items : []).entries()) {
        if (item === null || typeof item !== 'object') continue
        lines.push(`        ${ident(item.id, `i${itemIndex}`)}["${flat(item.label ?? item.id)}"]`)
      }
      lines.push('    end')
    }
    for (const link of Array.isArray(spec.links) ? spec.links : []) {
      if (link === null || typeof link !== 'object') continue
      const arrow = link.style === 'dashed' ? '-.->' : '-->'
      const tail = typeof link.label === 'string' && link.label !== '' ? `|${flat(link.label)}|` : ''
      lines.push(`    ${ident(link.from, 'x')} ${arrow}${tail} ${ident(link.to, 'y')}`)
    }
    return { source: lines.join('\n'), errors, kind }
  }

  if (kind === 'sequence') {
    const actors = Array.isArray(spec.actors) ? spec.actors.filter((a) => a !== null && typeof a === 'object') : []
    const lines = ['sequenceDiagram']
    for (const [index, actor] of actors.entries()) {
      lines.push(`    participant ${ident(actor.id, `a${index}`)} as ${flat(actor.label ?? actor.id)}`)
    }
    for (const message of Array.isArray(spec.messages) ? spec.messages : []) {
      if (message === null || typeof message !== 'object') continue
      const arrow = message.style === 'return' ? '-->>' : '->>'
      lines.push(`    ${ident(message.from, 'x')}${arrow}${ident(message.to, 'y')}: ${flat(message.label ?? '')}`)
    }
    return { source: lines.join('\n'), errors, kind }
  }

  return { source: null, errors: [`kind: unknown kind ${JSON.stringify(kind)}`], kind: kind ?? null }
}

/**
 * Render a diagram spec as D2 source.
 *
 * WHY: D2 gives stronger automatic layout than a hand-rolled engine for dense graphs
 * and exports SVG/PNG/PDF from one text file. Emitted offline; rendering needs the
 * `d2` binary, which the plugin does not vendor.
 *
 * @param spec - The same diagram spec.
 * @returns `{ source, errors, kind }`.
 */
export function renderD2(spec) {
  const errors = []
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return { source: null, errors: ['spec: expected a JSON object'], kind: null }
  }
  const kind = spec.kind
  const nodes = Array.isArray(spec.nodes) ? spec.nodes.filter((n) => n !== null && typeof n === 'object') : []
  const lines = []
  if (kind === 'sequence') {
    lines.push('shape: sequence_diagram')
    for (const [index, actor] of (Array.isArray(spec.actors) ? spec.actors : []).entries()) {
      if (actor !== null && typeof actor === 'object') lines.push(`${ident(actor.id, `a${index}`)}: ${flat(actor.label ?? actor.id)}`)
    }
    for (const message of Array.isArray(spec.messages) ? spec.messages : []) {
      if (message !== null && typeof message === 'object') lines.push(`${ident(message.from, 'x')} -> ${ident(message.to, 'y')}: ${flat(message.label ?? '')}`)
    }
    return { source: lines.join('\n'), errors, kind }
  }
  if (kind === 'arch') {
    for (const [layerIndex, layer] of (Array.isArray(spec.layers) ? spec.layers : []).entries()) {
      if (layer === null || typeof layer !== 'object') continue
      const layerId = ident(layer.label, `layer${layerIndex}`)
      lines.push(`${layerId}: "${flat(layer.label ?? layerId)}" {`)
      for (const [itemIndex, item] of (Array.isArray(layer.items) ? layer.items : []).entries()) {
        if (item !== null && typeof item === 'object') lines.push(`  ${ident(item.id, `i${itemIndex}`)}: "${flat(item.label ?? item.id)}"`)
      }
      lines.push('}')
    }
    for (const link of Array.isArray(spec.links) ? spec.links : []) {
      if (link !== null && typeof link === 'object') lines.push(`${ident(link.from, 'x')} -> ${ident(link.to, 'y')}${typeof link.label === 'string' && link.label !== '' ? `: ${flat(link.label)}` : ''}`)
    }
    return { source: lines.join('\n'), errors, kind }
  }
  if (kind === 'flow' || kind === 'state') {
    for (const [index, node] of nodes.entries()) lines.push(`${ident(node.id, `n${index}`)}: "${flat(node.label ?? node.id)}"`)
    for (const edge of Array.isArray(spec.edges) ? spec.edges : []) {
      if (edge === null || typeof edge !== 'object') continue
      const tail = typeof edge.label === 'string' && edge.label !== '' ? `: ${flat(edge.label)}` : ''
      lines.push(`${ident(edge.from, 'x')} -> ${ident(edge.to, 'y')}${tail}`)
    }
    return { source: lines.join('\n'), errors, kind }
  }
  return { source: null, errors: [`kind: unknown kind ${JSON.stringify(kind)}`], kind: kind ?? null }
}

/** Where a source export lands when the caller named an HTML path. */
export function exportTarget(out, extension) {
  const name = typeof out === 'string' && out.trim() !== '' ? out.trim() : DEFAULT_OUT
  return name.replace(/\.html?$/i, `.${extension}`)
}

/**
 * Builds the tool definition.
 * @param defineTool - The harness's tool factory, injected by the caller.
 * @returns A tool definition ready for `ctx.tools.register`.
 */
export function diagramTool(defineTool) {
  return defineTool({
    name: 'diagram',
    description: 'Render a diagram spec into a standalone HTML file (inline SVG) in the workspace. '
      + 'The file is self-contained and is displayed by the Sidebar document preview; it prints whole. '
      + 'The layout is computed for you — give relationships, not coordinates. '
      + `Spec shape: {"kind":"${KINDS[0]}","theme":"${THEMES[0]}","title":"…","subtitle":"…","direction":"down|right",` + '...}. '
      + 'kind "flow" (algorithm, process): nodes:[{id,label,shape?,note?,color?,rank?}], '
      + 'edges:[{from,to,label?,style?,color?,fromSide?,toSide?}], groups:[{id,label?,color?,nodes:[ids]}]. '
      + 'kind "state" (state machine): the same nodes/edges, rounded by default; shape "start"/"end" for the markers. '
      + 'kind "arch" (system design): layers:[{label,color?,items:[{id,label,shape?,note?}]}], links:[{from,to,label?,style?}] over those item ids. '
      + 'kind "sequence": actors:[{id,label?}], messages:[{from,to,label?,style?:"call"|"return",note?}], numbering?:true, '
      + 'blocks:[{type?:"alt"|"opt"|"loop"|"par",label,from,to}] framing the messages from..to by their 1-based number. '
      + 'Optional legend:[{label,shape?,color?}] below the diagram — or legend:true for a colour key — with legendTitle. '
      + 'shapes: rect, round, pill, diamond, decision, cylinder, database, parallelogram, hexagon, note, circle, start, end. '
      + `colors: ${['accent', 'info', 'ok', 'warn', 'danger', 'violet', 'cyan', 'muted'].join(', ')}. `
      + 'edge styles: solid, dashed, dotted, thick. '
      + `themes: ${THEMES.join(', ')}. `
      + 'READ THE RESULT: `ok` only means a file was written; validity is in `errors`, and '
      + '`degraded: true` means `errors` is non-empty — an unknown kind, a colour, or an edge naming a '
      + 'node that does not exist — so fix the spec and render again before showing the diagram.',
    parameters: {
      spec: {
        type: 'string',
        description: 'The diagram spec as a JSON string (see the tool description for its shape).'
      },
      out: {
        type: 'string',
        description: `Optional output file name or absolute path. Defaults to ${DEFAULT_OUT} in the session workspace.`
      },
      format: {
        type: 'string',
        description: '"svg" (default) renders the built-in SVG/HTML. "mermaid" or "d2" writes SOURCE instead — Mermaid renders natively on GitHub/GitLab so the diagram becomes reviewable, and D2 lays out dense graphs better; render them with `mmdc` or the `d2` binary (neither is vendored).'
      }
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
    /**
     * Parses the spec, lays it out and writes the document.
     * @param args - { spec, out } as declared above.
     * @param exec - Tool-exec context used to locate the session workspace.
     * @returns The result object described in the file contract.
     */
    execute(args, exec) {
      const raw = args?.spec
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        return Promise.resolve(lossless({ ok: false, errors: ['spec: expected a non-empty JSON string'] }))
      }
      let spec
      try {
        spec = JSON.parse(raw)
      } catch (error) {
        return Promise.resolve(lossless({ ok: false, errors: [`spec: invalid JSON — ${error.message}`] }))
      }
      // Source export: a Mermaid fence is rendered natively by GitHub/GitLab, so a
      // diagram becomes reviewable in a pull request; D2 lays out dense graphs
      // better than the built-in engine. Neither renderer is vendored — the file is
      // the deliverable and the conversion is the caller's.
      const format = typeof args?.format === 'string' ? args.format : 'svg'
      if (format === 'mermaid' || format === 'd2') {
        const exported = format === 'mermaid' ? renderMermaid(spec) : renderD2(spec)
        if (exported.source === null) {
          return Promise.resolve(lossless({ ok: false, errors: exported.errors }))
        }
        const cwdExport = workingDir(exec)
        const exportPath = targetPath(exportTarget(args?.out, format === 'mermaid' ? 'mmd' : 'd2'), cwdExport)
        if (exportPath === null) {
          return Promise.resolve(lossless({ ok: false, errors: ['out: expected a usable file name'] }))
        }
        try {
          mkdirSync(dirname(exportPath), { recursive: true })
          writeFileSync(exportPath, exported.source)
        } catch (error) {
          return Promise.resolve(lossless({ ok: false, errors: [`write ${exportPath}: ${error.message}`] }))
        }
        return Promise.resolve(lossless({
          ok: true,
          format,
          path: exportPath,
          bytes: Buffer.byteLength(exported.source),
          kind: exported.kind,
          errors: exported.errors,
          warnings: [],
          hint: format === 'mermaid'
            ? 'Paste it into a ```mermaid fence (GitHub/GitLab render it), or render it with `npx @mermaid-js/mermaid-cli -i <file> -o out.svg`.'
            : 'Render it with the `d2` binary: `d2 <file> out.svg`.',
        }))
      }
      const result = renderDiagram(spec)
      if (result.html === null) {
        return Promise.resolve(lossless({ ok: false, errors: result.errors, warnings: result.warnings }))
      }
      const cwd = workingDir(exec)
      const target = targetPath(args?.out, cwd)
      if (target === null) {
        return Promise.resolve(lossless({ ok: false, errors: ['out: expected a usable file name'] }))
      }
      const bytes = Buffer.byteLength(result.html)
      try {
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, result.html)
      } catch (error) {
        return Promise.resolve(lossless({
          ok: false,
          errors: [`write ${target}: ${error.message}`],
          warnings: result.warnings
        }))
      }
      const rel = relative(cwd, target)
      // `..` is a PATH SEGMENT, not a string prefix: a file at `<cwd>/..config/diagram.html`
      // is inside the workspace, and `rel.startsWith('..')` called it outside. The segment
      // test is `..` itself or `..` followed by a separator.
      const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
      return Promise.resolve(lossless({
        ok: true,
        degraded: result.errors.length > 0,
        path: target,
        bytes,
        kind: result.kind,
        theme: result.theme,
        nodes: result.nodes,
        edges: result.edges,
        legend: result.legend,
        errors: result.errors,
        warnings: result.warnings,
        outsideWorkspace: outside ? true : undefined,
        hint: 'Open the file in the Sidebar file preview; drag to pan, wheel to zoom, '
          + 'F fits, T switches theme, and printing gives the whole diagram on one page.'
      }))
    }
  })
}
