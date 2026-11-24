/**
 * The `/designmap <json-op>` human command, page document only.
 *
 * The panel cannot write the workspace (its file API is read-only), so every page operation
 * the editor needs goes through this command: list the pages, open one page, save a scene
 * back, tidy it and render it with the same code the agent tools use. The page file is the
 * only store — no view, overlay, annotation or manifest document sits behind it.
 *
 * Result shape matches the command registry: `{kind:'success', text}` is a JSON document;
 * `{kind:'error', text}` carries a stable `designmap: <code>: <detail>` prefix the panel
 * can quote.
 */
import { MapRefusal, listPages, readPage, writePage } from './pages.mjs'
import { applyOp, renderPage } from './ops.mjs'

const OPS = ['pages', 'page', 'save', 'tidy-page', 'render-page']

export function createCommandHandler({ hostFor }) {
  return async function handler(invocation) {
    const { designmapDir } = hostFor({ agent: invocation.agent })
    let op
    try {
      op = JSON.parse(invocation.rawInput)
    } catch {
      return { kind: 'error', text: 'designmap: expected a JSON operation' }
    }
    if (op === null || typeof op !== 'object' || !OPS.includes(op.op)) {
      return { kind: 'error', text: `designmap: unknown op (${OPS.join(' | ')})` }
    }
    try {
      let value
      switch (op.op) {
        case 'pages': value = { ok: true, pages: listPages(designmapDir) }; break
        case 'page': value = { ok: true, page: op.page, scene: readPage(designmapDir, op.page) }; break
        case 'save': {
          if (op.scene === null || typeof op.scene !== 'object' || !Array.isArray(op.scene.elements)) {
            return { kind: 'error', text: 'designmap: invalid_scene: save needs a scene with an elements array' }
          }
          // RE-READ BEFORE WRITING. The human's canvas is the truth, but the write is merged
          // onto the file as it stands, so a field the panel does not send survives and the
          // response can report what was replaced. Last writer wins; nothing is truncated
          // silently.
          const previous = readPage(designmapDir, op.page)
          const next = {
            ...previous,
            ...op.scene,
            type: 'excalidraw',
            version: previous.version ?? op.scene.version ?? 2,
            source: previous.source ?? op.scene.source,
            appState: op.scene.appState ?? previous.appState ?? {},
            files: op.scene.files ?? previous.files ?? {},
            elements: op.scene.elements,
          }
          writePage(designmapDir, op.page, next)
          value = { ok: true, page: op.page, elements: next.elements.length, previousElements: previous.elements.length, savedAt: new Date().toISOString() }
          break
        }
        case 'tidy-page': value = applyOp(designmapDir, { op: 'tidy', page: op.page }); break
        case 'render-page': value = await renderPage(designmapDir, op.page); break
        default: return { kind: 'error', text: `designmap: unknown op (${OPS.join(' | ')})` }
      }
      return { kind: 'success', text: JSON.stringify(value) }
    } catch (error) {
      if (error instanceof MapRefusal || typeof error?.code === 'string') {
        return { kind: 'error', text: `designmap: ${error.code}: ${error.message}` }
      }
      return { kind: 'error', text: `designmap: internal_error: ${String(error?.message ?? error)}` }
    }
  }
}
