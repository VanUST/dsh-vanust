/**
 * The live DSH host adapter for the page editor.
 *
 * A client plugin's file API is read-only, so every page operation goes through
 * `remote.commands.execute` and the host's `/designmap` command: list designmap/pages,
 * open ONE page file, save that same file back, tidy it and render it. There is no view,
 * overlay, annotation or manifest document behind a page.
 */

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
    return remoteFailure('command_unavailable', 'This build has no designmap command; page edits are unavailable.')
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

/** The panel's page surface: one page file per call, saved through the host command. */
export function createRemoteHost({ remote, sessionId }) {
  return {
    /**
     * The page document. The panel lists designmap/pages, opens ONE page file and writes
     * that same file back; there is no view, overlay or annotation document behind it.
     * `savePage` is debounced by the caller and the host re-reads the file before writing.
     */
    async pages() {
      return executeCommand(remote, sessionId, { op: 'pages' })
    },

    async page(page) {
      if (typeof page !== 'string' || page === '') return remoteFailure('invalid_page', 'A page name is required.')
      return executeCommand(remote, sessionId, { op: 'page', page })
    },

    async savePage(page, scene) {
      if (typeof page !== 'string' || page === '') return remoteFailure('invalid_page', 'A page name is required.')
      if (scene === null || typeof scene !== 'object' || !Array.isArray(scene.elements)) {
        return remoteFailure('invalid_scene', 'A save needs the scene the editor is showing.')
      }
      return executeCommand(remote, sessionId, { op: 'save', page, scene })
    },

    /** The same code the agent's tidy op runs. */
    async tidyPage(page) {
      return executeCommand(remote, sessionId, { op: 'tidy-page', page })
    },

    /** The same readability report map_lint returns: the panel's Check button. */
    async lintPage(page) {
      if (typeof page !== 'string' || page === '') return remoteFailure('invalid_page', 'A page name is required.')
      return executeCommand(remote, sessionId, { op: 'lint', page })
    },

    /** One map_edit operation from the panel's finding list: a ready repair, applied. */
    async edit(operation) {
      if (operation === null || typeof operation !== 'object' || typeof operation.op !== 'string') {
        return remoteFailure('invalid_operation', 'An edit needs one map operation.')
      }
      return executeCommand(remote, sessionId, { op: 'edit', operation })
    },

    /** The same code map_render runs. */
    async renderPage(page) {
      return executeCommand(remote, sessionId, { op: 'render-page', page })
    },

    canWrite: typeof remote?.commands?.execute === 'function',
  }
}
