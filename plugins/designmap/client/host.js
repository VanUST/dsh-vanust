/**
 * The live DSH host adapter for the designmap panel.
 *
 * Reads (scenes, index, overlays, manifest) go through `remote.workspaceFiles`, the only
 * read-only file API a client plugin has. Writes go through `remote.commands.execute`
 * and the host's `/designmap` command, because the client cannot write the workspace:
 *   {op:'overlay', action:'upsert'|'replace'|'resetNode'|'resetView', …}
 *   {op:'render'}   re-run the generator after a reset/undo so the scene shows the
 *                   layout position again (this op writes out/, unlike the overlay write)
 *
 * The overlay payload builder refuses anything that is not x/y/fill/stroke with the
 * named `model_fields_forbidden` error before a command leaves the page. The host
 * repeats that refusal (src/host.mjs), so a crafted payload is refused twice.
 */

const OVERLAY_ACTIONS = new Set(['upsert', 'replace', 'resetNode', 'resetView'])
const OVERLAY_KEYS = new Set(['action', 'nodeId', 'viewId', 'row', 'x', 'y', 'fill', 'stroke'])
const ROW_KEYS = new Set(['x', 'y', 'fill', 'stroke'])

function remoteFailure(code, message) {
  return { ok: false, error: { code, message } }
}

function parseCommandFailure(outcome) {
  const text = typeof outcome?.text === 'string' ? outcome.text : String(outcome?.text ?? '')
  const match = /^designmap:\s*([A-Za-z0-9_]+):\s*([\s\S]*)$/u.exec(text)
  if (match !== null) return { code: match[1], message: match[2] }
  return { code: 'command_failed', message: text || 'The designmap command failed.' }
}

async function executeCommand(remote, sessionId, op) {
  if (remote?.commands === undefined || typeof remote.commands.execute !== 'function') {
    return remoteFailure('command_unavailable', 'This build has no designmap command; overlay writes are unavailable.')
  }
  let result
  try {
    result = await remote.commands.execute(sessionId, `/designmap ${JSON.stringify(op)}`, [])
  } catch (error) {
    return remoteFailure('command_failed', String(error?.message ?? error))
  }
  if (result?.ok !== true) return { ok: false, error: result?.error ?? { code: 'command_failed', message: 'The command transport failed.' } }
  const outcome = result.value?.result
  if (outcome?.kind === 'error') return { ok: false, error: parseCommandFailure(outcome) }
  if (outcome?.kind !== 'success') {
    return remoteFailure('command_failed', 'The designmap command returned an unexpected result.')
  }
  try {
    return { ok: true, value: JSON.parse(outcome.text) }
  } catch {
    return remoteFailure('command_result_invalid', 'The designmap command returned non-JSON text.')
  }
}

/** The panel's write surface: visual fields only, named refusal otherwise. */
export function validateOverlayPayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return remoteFailure('invalid_overlay', 'The overlay payload must be an object.')
  }
  const fields = Object.keys(payload).filter((key) => !OVERLAY_KEYS.has(key))
  if (fields.length > 0) {
    return remoteFailure('model_fields_forbidden', `The panel can only write overlays (x/y/fill/stroke); ${fields.join(', ')} belongs to the model.`)
  }
  if (!OVERLAY_ACTIONS.has(payload.action)) {
    return remoteFailure('invalid_overlay', `Unknown overlay action "${String(payload.action)}".`)
  }
  if (payload.row !== undefined && payload.row !== null) {
    if (typeof payload.row !== 'object' || Array.isArray(payload.row)) {
      return remoteFailure('invalid_overlay', 'The overlay row must be an object or null.')
    }
    const rowFields = Object.keys(payload.row).filter((key) => !ROW_KEYS.has(key))
    if (rowFields.length > 0) {
      return remoteFailure('model_fields_forbidden', `The overlay row can only hold x/y/fill/stroke; ${rowFields.join(', ')} belongs to the model.`)
    }
  }
  return { ok: true }
}

/**
 * @param {object} options
 * @param {object} options.remote - the client remote service (`ctx.remote`).
 * @param {string} options.sessionId - session whose workspace root anchors relative paths.
 */
export function createRemoteHost({ remote, sessionId }) {
  if (remote === undefined || remote === null) throw new Error('designmap: the host remote service is unavailable')
  if (typeof sessionId !== 'string' || sessionId === '') {
    return {
      load: async () => remoteFailure('no_session', 'Open a conversation to load the design map.'),
      refreshView: async () => remoteFailure('no_session', 'Open a conversation to edit the design map.'),
      openSource: async () => remoteFailure('no_session', 'Open a conversation to open source files.'),
      writeOverlay: async () => remoteFailure('no_session', 'Open a conversation to edit the design map.'),
      writeLabel: async () => remoteFailure('no_session', 'Open a conversation to edit the design map.'),
      writeAnnotations: async () => remoteFailure('no_session', 'Open a conversation to save annotations.'),
      renderViews: async () => remoteFailure('no_session', 'Open a conversation to render the design map.'),
    }
  }

  return {
    /**
     * The panel's read path: the host renders every view WITH the stored visual layer
     * (`op:'views'`, renderView write:false) and this adapter hands that payload to the
     * view untouched. The panel used to list `out/*.scene.json` and merge overlays in the
     * browser, which gave the map two geometry owners: a moved node kept its old arrows
     * and label plates. Nothing here computes geometry.
     */
    async load({ viewId } = {}) {
      const result = await executeCommand(remote, sessionId, { op: 'views', ...(viewId === undefined ? {} : { viewId }) })
      if (result?.ok !== true) return result
      const payload = result.value
      if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.views)) {
        return remoteFailure('command_result_invalid', 'The designmap command returned no views.')
      }
      if (payload.views.length === 0) {
        return {
          ok: true,
          value: {
            views: [],
            rootId: null,
            missing: true,
            overlays: { rows: payload.overlays?.rows ?? {}, path: 'designmap/overlays.json' },
            annotations: Array.isArray(payload.annotations) ? payload.annotations : [],
          },
        }
      }
      return { ok: true, value: payload }
    },

    /** Re-render one view after a human edit. Same command, one view, still no writes. */
    async refreshView(viewId) {
      return this.load({ viewId })
    },

    /**
     * A label is a model field, so the human's edit goes through the host's `label` op
     * (apply + manifest), never through overlays.json.
     */
    async writeLabel({ kind, id, label } = {}) {
      if (kind !== 'node' && kind !== 'edge') {
        return remoteFailure('invalid_label_target', 'The label target must be a node or an edge.')
      }
      if (typeof id !== 'string' || id === '') return remoteFailure('invalid_label_target', 'The label target needs an id.')
      if (typeof label !== 'string' || label.trim() === '') {
        // An empty edge label would make every render refuse (the lint treats it as an
        // error), so the panel refuses it by the same code before it leaves the page.
        return kind === 'edge'
          ? remoteFailure('missing_edge_label', 'An edge must keep a label; the model refuses an empty one.')
          : remoteFailure('invalid_label', 'A node label must not be empty.')
      }
      return executeCommand(remote, sessionId, { op: 'label', kind, id, label })
    },

    validateOverlayPayload,

    async writeOverlay(payload) {
      const valid = validateOverlayPayload(payload)
      if (valid.ok !== true) return valid
      return executeCommand(remote, sessionId, { op: 'overlay', ...payload })
    },

    async writeAnnotations(elements) {
      if (!Array.isArray(elements)) return remoteFailure('invalid_annotation', 'Annotations are an array of elements.')
      return executeCommand(remote, sessionId, { op: 'annotate', elements })
    },

    async renderViews(payload = {}) {
      return executeCommand(remote, sessionId, { op: 'render', ...payload })
    },

    async openSource(node) {
      if (typeof node?.source !== 'string' || node.source === '') {
        return remoteFailure('source_missing', `${node?.label ?? node?.id ?? 'This node'} has no source path in this scene.`)
      }
      const stat = await remote.workspaceFiles.stat(sessionId, node.source)
      if (stat?.ok !== true) {
        return {
          ok: false,
          error: stat?.error ?? { code: 'stat_failed', message: `Could not stat ${node.source}` },
        }
      }
      const absolutePath = stat.value?.absolutePath
      if (typeof absolutePath !== 'string' || absolutePath === '') {
        return remoteFailure('stat_failed', `The host returned no absolute path for ${node.source}.`)
      }
      if (remote.session === undefined || typeof remote.session.openWorkspacePath !== 'function') {
        return remoteFailure('open_unavailable', 'This build has no desktop opener; the source path is verified but cannot be opened.')
      }
      const opened = await remote.session.openWorkspacePath({ path: absolutePath })
      if (opened?.ok !== true) {
        return { ok: false, error: opened?.error ?? { code: 'open_failed', message: `Could not open ${node.source}.` } }
      }
      return { ok: true, value: { opened: true } }
    },
    canWrite: typeof remote?.commands?.execute === 'function',
  }
}
