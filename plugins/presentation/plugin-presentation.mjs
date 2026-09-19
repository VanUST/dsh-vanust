/**
 * PURPOSE: Define the `presentation` tool — one call turns a JSON deck spec into a
 *          standalone HTML file in the session workspace, which the harness's own
 *          Sidebar document preview then renders (`.html` is previewed in a
 *          script-enabled sandboxed frame, so the deck's player works as written).
 * INPUTS:  args.spec (string, JSON deck spec), args.out (string, optional file name).
 *          exec is the tool-exec context; the session working directory is read from
 *          exec.agent.session.header.cwd, falling back to process.cwd().
 * OUTPUTS: JSON { ok, degraded, path, bytes, theme, slides, errors, warnings } on
 *          success, and { ok: false, errors } when the spec cannot be parsed or
 *          renders nothing. `ok` means a file was written and nothing more:
 *          `errors` is where validity lives, and `degraded` is true exactly when
 *          `errors` is non-empty, so an ignored `errors` array cannot pass for a
 *          clean deck. Never throws: a bad spec is a reported result, not a crash.
 * KEYWORDS: presentation, slides, deck, tool, html, render, workspace.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { THEMES, renderDeck } from './render.mjs'

/** Default file name; a stable name keeps repeated renders at one path instead of littering. */
const DEFAULT_OUT = 'presentation.html'

/**
 * Resolves the workspace directory a deck is written into.
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

/**
 * Builds the tool definition.
 * @param defineTool - The harness's tool factory, injected by the caller.
 * @returns A tool definition ready for `ctx.tools.register`.
 */
export function presentationTool(defineTool) {
  return defineTool({
    name: 'presentation',
    description: 'Render a presentation deck spec into a standalone HTML file in the workspace. '
      + 'The file is self-contained (inline CSS and script) and is displayed by the Sidebar document preview. '
      + `Spec shape: {"theme":"${THEMES[0]}","title":"…","slides":[{"type":"cover|section|content",`
      + '"kicker":"…","title":"…","lede":"…","cards":[{"title":"…","text":"…","color":"info|ok|danger|violet","list":["…"]}],'
      + '"kpis":[{"value":"…","label":"…","note":"…"}],"table":{"header":["…"],"rows":[["…"]]},'
      + '"timeline":[{"title":"…","text":"…"}],"quote":{"text":"…","by":"…"},'
      + '"chips":{"label":"…","items":["…"]},"callout":"…","note":"…"}]}. '
      + 'Text accepts **bold** and ==highlight==. Themes: ' + THEMES.join(', ') + '. '
      + 'READ THE RESULT: `ok` only means a file was written; validity is in `errors`, and '
      + '`degraded: true` means `errors` is non-empty — a slide fell back to a generic layout or was '
      + 'skipped, so fix the spec and render again before presenting the deck.',
    parameters: {
      spec: {
        type: 'string',
        description: 'The deck spec as a JSON string (see the tool description for its shape).'
      },
      out: {
        type: 'string',
        description: `Optional output file name or absolute path. Defaults to ${DEFAULT_OUT} in the session workspace.`
      }
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
    /**
     * Parses the spec, renders it and writes the deck.
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
      const result = renderDeck(spec)
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
      // `..` is a PATH SEGMENT, not a string prefix: a file at `<cwd>/..config/deck.html`
      // is inside the workspace, and `rel.startsWith('..')` called it outside. The segment
      // test is `..` itself or `..` followed by a separator.
      const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
      return Promise.resolve(lossless({
        ok: true,
        degraded: result.errors.length > 0,
        path: target,
        bytes,
        theme: result.theme,
        slides: result.slides,
        errors: result.errors,
        warnings: result.warnings,
        outsideWorkspace: outside ? true : undefined,
        hint: 'Open the file in the Sidebar file preview to present it; ← → move, F is full screen, printing gives one slide per page.'
      }))
    }
  })
}
