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

const SCENE_SUFFIX = '.scene.json'
const OVERLAY_ACTIONS = new Set(['upsert', 'replace', 'resetNode', 'resetView'])
const OVERLAY_KEYS = new Set(['action', 'nodeId', 'viewId', 'row', 'x', 'y', 'fill', 'stroke'])
const ROW_KEYS = new Set(['x', 'y', 'fill', 'stroke'])

function remoteFailure(code, message) {
  return { ok: false, error: { code, message } }
}

async function readWholeText(remote, sessionId, path) {
  let offset = 1
  let text = ''
  for (let page = 0; page < 50; page += 1) {
    const result = await remote.workspaceFiles.read(sessionId, path, { offset, limit: 2000 })
    if (result?.ok !== true) return result ?? remoteFailure('read_failed', `No result for ${path}`)
    const value = result.value
    if (value === null || value === undefined) return remoteFailure('read_failed', `Empty result for ${path}`)
    text += value.text
    if (value.eof === true) return { ok: true, value: text }
    if (!(value.lines > 0)) return remoteFailure('read_failed', `${path} does not advance`)
    offset = value.offset + value.lines
    text += '\n'
  }
  return remoteFailure('read_failed', `${path} is too large to read`)
}

async function sceneHash(text) {
  try {
    const bytes = new TextEncoder().encode(text)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    return `sha256:${hex}`
  } catch {
    return null
  }
}

function mergeMeta(base, override) {
  if (override === null || typeof override !== 'object') return base
  return {
    ...base,
    ...override,
    stale: { ...base.stale, ...(override.stale ?? {}) },
  }
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
 * @param {string} [options.sceneDir] - directory core writes scenes/index to.
 * @param {object} [options.viewIndex] - fallback navigation metadata for a workspace
 *   without out/index.json: `{rootId?, views?: [{viewId, parentGroupId?, title?, level?, meta?}]}`.
 */
export function createRemoteHost({ remote, sessionId, sceneDir = 'designmap/out', viewIndex = null }) {
  if (remote === undefined || remote === null) throw new Error('designmap: the host remote service is unavailable')
  if (typeof sessionId !== 'string' || sessionId === '') {
    return {
      load: async () => remoteFailure('no_session', 'Open a conversation to load the design map.'),
      openSource: async () => remoteFailure('no_session', 'Open a conversation to open source files.'),
      writeOverlay: async () => remoteFailure('no_session', 'Open a conversation to edit the design map.'),
      renderViews: async () => remoteFailure('no_session', 'Open a conversation to render the design map.'),
    }
  }

  const fallbackEntries = Array.isArray(viewIndex?.views) ? viewIndex.views : []

  return {
    async load() {
      const listing = await remote.workspaceFiles.list(sessionId, sceneDir)
      if (listing?.ok !== true) return listing ?? remoteFailure('list_failed', `Could not list ${sceneDir}`)
      const entries = Array.isArray(listing.value?.entries) ? listing.value.entries : []
      const files = entries
        .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
        .filter((name) => typeof name === 'string' && name.endsWith(SCENE_SUFFIX))
        .sort()

      let manifest = null
      const manifestRead = await readWholeText(remote, sessionId, 'designmap/manifest.json')
      if (manifestRead.ok === true) {
        try {
          manifest = JSON.parse(manifestRead.value)
        } catch {
          manifest = null
        }
      }

      let index = null
      const indexPath = `${sceneDir}/index.json`
      const indexRead = await readWholeText(remote, sessionId, indexPath)
      if (indexRead.ok === true) {
        try {
          const parsed = JSON.parse(indexRead.value)
          if (parsed?.schemaVersion === 1 && Array.isArray(parsed.views)) index = parsed
        } catch {
          index = null
        }
      }

      let overlays = {}
      const overlaysRead = await readWholeText(remote, sessionId, 'designmap/overlays.json')
      if (overlaysRead.ok === true) {
        try {
          const parsed = JSON.parse(overlaysRead.value)
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [key, row] of Object.entries(parsed)) {
              if (key === '$version') continue
              if (row !== null && typeof row === 'object' && !Array.isArray(row)) overlays[key] = row
            }
          }
        } catch {
          overlays = {}
        }
      }

      const views = []
      for (const name of files) {
        const path = `${sceneDir}/${name}`
        const read = await readWholeText(remote, sessionId, path)
        if (read.ok !== true) continue
        let scene
        try {
          scene = JSON.parse(read.value)
        } catch {
          continue
        }
        if (scene?.schemaVersion !== 1) continue
        const viewId = typeof scene.viewId === 'string' && scene.viewId !== '' ? scene.viewId : name.slice(0, -SCENE_SUFFIX.length)
        const indexed =
          index?.views.find((entry) => entry?.viewId === viewId) ??
          fallbackEntries.find((entry) => entry?.viewId === viewId) ??
          null
        const fallback = fallbackEntries.find((entry) => entry?.viewId === viewId) ?? null
        const staleNodes = Array.isArray(scene.nodes) ? scene.nodes.filter((node) => node?.stale === true).map((node) => node.id) : []
        const baseMeta = {
          generatedAt: typeof manifest?.generatedAt === 'string' ? manifest.generatedAt : null,
          commit: typeof manifest?.commit === 'string' ? manifest.commit : null,
          sceneHash: typeof indexed?.sceneHash === 'string' ? indexed.sceneHash : await sceneHash(read.value),
          scenePath: path,
          stale: { stale: staleNodes.length > 0, commitBehind: 0, staleNodes },
          lint: null,
        }
        views.push({
          view: {
            viewId,
            title: typeof scene.title === 'string' ? scene.title : viewId,
            level: typeof scene.level === 'string' ? scene.level : 'context',
            parentGroupId:
              typeof indexed?.parent === 'string'
                ? indexed.parent
                : typeof indexed?.parentGroupId === 'string'
                  ? indexed.parentGroupId
                  : typeof fallback?.parentGroupId === 'string'
                    ? fallback.parentGroupId
                    : null,
          },
          scene,
          meta: mergeMeta(baseMeta, fallback?.meta ?? null),
        })
      }

      if (views.length === 0) {
        return remoteFailure('no_scenes', `No ${SCENE_SUFFIX} files under ${sceneDir}. Render the model first.`)
      }
      const requested = typeof viewIndex?.rootId === 'string' ? viewIndex.rootId : null
      const roots = index?.views ?? []
      const rootRow = roots.find((row) => row.parent === null && row.level === 'context') ?? roots.find((row) => row.parent === null) ?? null
      const root =
        views.find((entry) => entry.view.viewId === requested) ??
        views.find((entry) => entry.view.viewId === rootRow?.viewId) ??
        views.find((entry) => entry.view.level === 'context') ??
        views.find((entry) => entry.view.viewId === 'v.context') ??
        views[0]
      return {
        ok: true,
        value: {
          views,
          rootId: root.view.viewId,
          overlays: { rows: overlays, path: 'designmap/overlays.json' },
        },
      }
    },

    validateOverlayPayload,

    async writeOverlay(payload) {
      const valid = validateOverlayPayload(payload)
      if (valid.ok !== true) return valid
      return executeCommand(remote, sessionId, { op: 'overlay', ...payload })
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
