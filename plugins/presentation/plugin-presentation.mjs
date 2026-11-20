/**
 * PURPOSE: Define the two presentation tools — `presentation` (a deck) and
 *          `dashboard` (a board) — each turning a JSON spec into one standalone
 *          HTML file in the session workspace, which the harness's Sidebar
 *          document preview already renders (`.html` is previewed in a
 *          script-enabled sandboxed frame).
 * INPUTS:  args.spec (string, JSON spec), args.out (string, optional file name);
 *          exec carries the session working directory.
 * OUTPUTS: JSON { ok, degraded, path, bytes, theme, …, errors, warnings } on
 *          success, and { ok: false, errors } when the spec cannot be parsed or
 *          nothing could be drawn. `ok` means a file was written and nothing
 *          more: validity lives in `errors`, and `degraded` is true exactly when
 *          `errors` is non-empty, so an ignored `errors` array cannot pass for a
 *          clean document.
 * KEYWORDS: presentation, deck, dashboard, slides, tool, html, standalone, theme.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { renderBoard } from './render-board.mjs'
import { renderDeck, THEMES } from './render-deck.mjs'

/** Default file names; a stable name keeps repeated renders at one path. */
const DEFAULT_DECK = 'presentation.html'
const DEFAULT_BOARD = 'dashboard.html'

/** The style sheet, read once: the document carries it inline, never as a file. */
const CSS = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')

/**
 * Resolves the workspace directory a document is written into.
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
 * @param fallback - Name used when the caller passed nothing.
 * @returns Absolute target path, or null when the name is unusable.
 */
function targetPath(out, cwd, fallback) {
  const name = typeof out === 'string' && out.trim().length > 0 ? out.trim() : fallback
  if (name.includes('\0')) return null
  return isAbsolute(name) ? resolve(name) : resolve(join(cwd, name))
}

/**
 * Drops keys whose value is `undefined`, recursively over the top level.
 * The harness serialises a tool result as lossless JSON and refuses a value that
 * carries `undefined`, so a payload must never contain one.
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

/**
 * Parses the JSON spec a tool call carries.
 * @param raw - The `spec` argument.
 * @returns `{ spec }` or `{ error }` with one message.
 */
function parseSpec(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { error: 'spec: expected a non-empty JSON string' }
  }
  try {
    return { spec: JSON.parse(raw) }
  } catch (error) {
    return { error: `spec: invalid JSON — ${error.message}` }
  }
}

/**
 * Writes one rendered document and builds the tool result.
 * @param args - Tool arguments.
 * @param exec - Tool exec context.
 * @param build - (spec) => render result with `html`.
 * @param fallback - Default file name.
 * @param describe - (result) => extra keys for the payload.
 * @returns The lossless result object.
 */
function writeDocument(args, exec, build, fallback, describe) {
  const parsed = parseSpec(args?.spec)
  if (parsed.error !== undefined) return lossless({ ok: false, errors: [parsed.error] })
  const result = build(parsed.spec)
  if (result.html === null) {
    return lossless({ ok: false, errors: result.errors, warnings: result.warnings })
  }
  const cwd = workingDir(exec)
  const target = targetPath(args?.out, cwd, fallback)
  if (target === null) {
    return lossless({ ok: false, errors: ['out: expected a usable file name'] })
  }
  const bytes = Buffer.byteLength(result.html)
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, result.html)
  } catch (error) {
    return lossless({ ok: false, errors: [`write ${target}: ${error.message}`], warnings: result.warnings })
  }
  const rel = relative(cwd, target)
  // `..` is a PATH SEGMENT, not a string prefix: `..config/x.html` is inside the
  // workspace and `rel.startsWith('..')` would call it outside.
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
  return lossless({
    ok: true,
    degraded: result.errors.length > 0,
    path: target,
    bytes,
    theme: result.theme,
    ...describe(result),
    errors: result.errors,
    warnings: result.warnings,
    outsideWorkspace: outside ? true : undefined,
    hint: 'Open the file in the Sidebar preview. A deck: arrows/space change slides, '
      + 'F full screen, O overview, N notes, printing gives one slide per page. '
      + 'A board prints on one page.',
  })
}

/**
 * Builds both tool definitions.
 * @param defineTool - The harness's tool factory, injected by the caller.
 * @returns An array of tool definitions ready for `ctx.tools.register`.
 */
export function presentationTools(defineTool) {
  const deck = defineTool({
    name: 'presentation',
    description: 'Render a deck spec into ONE standalone HTML file in the workspace — a story read slide by '
      + 'slide (no network, no sibling files; the Sidebar preview shows it and print gives a slide per page). '
      + `Spec: {"theme":"${THEMES[0]}","title":"…","slides":[{"type":"cover|section|content|compare|steps|chart|visual|raw",`
      + '"kicker":"…","title":"…","lede":"…","note":"speaker note","cards":[{"title","text","list","color"}],'
      + '"kpis":[{"value","label","note","color"}],"table":{"header","rows"},"timeline","quote","chips","callout",'
      + '"list","steps":[{"title","text"}],"compare":{"left","right"},"chart":{…kind bar|line|donut|sparkline},'
      + '"motion":{"svg"|"html","duration","autoplay","tracks":[{"target","at","dur","to"}],"captions"},'
      + '"visual":{"svg"|"html","caption"},"html":"raw markup"}]}. '
      + 'A `motion` block is a TIMED scene: the markup states each element\'s start (data-id, opacity), the tracks state the change, '
      + 'the player runs it on the compositor clock (P pauses, R replays); use it when the process itself is the point. '
      + 'Move the eye: one idea per slide, `frag:true` on a block (or any `steps`) to reveal it on advance, '
      + '`anim` fade|zoom|left, a warm-accent palette per theme. '
      + 'READ THE RESULT: `ok` only means the file was written; validity is in `errors` and `degraded` — fix and re-render.',
    parameters: {
      spec: { type: 'string', description: 'The deck spec as a JSON string (shape in the tool description).' },
      out: { type: 'string', description: `Optional output file name or absolute path. Defaults to ${DEFAULT_DECK} in the session workspace.` },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute(args, exec) {
      return Promise.resolve(writeDocument(args, exec, (spec) => renderDeck(spec, { css: CSS }), DEFAULT_DECK,
        (result) => ({ slides: result.slides })))
    },
  })

  const board = defineTool({
    name: 'dashboard',
    description: 'Render a board spec into ONE standalone HTML file in the workspace — a dense summary a person '
      + 'reads at a glance: KPI tiles, charts and status lists, printed on one page with no network. '
      + `Spec: {"theme":"graphite","kicker":"…","title":"…","subtitle":"…","meta":["…"],`
      + '"tiles":[{"value":"162","label":"задач закрыто","delta":"+6","tone":"ok|danger|info|warn","note":"…"}],'
      + '"charts":[{"kind":"bar|line|donut|sparkline","title":"…","unit":"…","data":[{"label","value"}],'
      + '"series":[{"name","points":[{"label","value"}]}],"foot":"…"}],'
      + '"lists":[{"title":"…","items":[{"label","value","tone"}]}],"foot":["…"]}. '
      + 'Numbers in a tile count up; bars grow and lines draw in. '
      + 'READ THE RESULT: `ok` only means the file was written; validity is in `errors` and `degraded`.',
    parameters: {
      spec: { type: 'string', description: 'The board spec as a JSON string (shape in the tool description).' },
      out: { type: 'string', description: `Optional output file name or absolute path. Defaults to ${DEFAULT_BOARD} in the session workspace.` },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute(args, exec) {
      return Promise.resolve(writeDocument(args, exec, (spec) => renderBoard(spec, { css: CSS }), DEFAULT_BOARD,
        (result) => ({ tiles: result.tiles, charts: result.charts })))
    },
  })

  return [deck, board]
}
