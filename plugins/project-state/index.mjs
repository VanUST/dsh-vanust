/**
 * PURPOSE
 *   Host row that publishes the project state core as the `ccProjectState` service. The row
 *   registers no model tools: the REQ/TASK operations are consumers built on this service
 *   (next tasks), and keeping the row tool-free is what lets it exist before them.
 *
 * SERVICE SHAPE
 *   Every method takes the workspace `cwd` first, because one host row serves every workspace
 *   the UI opens. `open(cwd)` returns the cached core for one workspace, the rest delegate:
 *     create(cwd, kind, input)      get(cwd, id)          list(cwd, kind?)
 *     update(cwd, id, patch)        link(cwd, from, to)   issueId(cwd, kind)
 *     claim(cwd, id, {owner})       release(cwd, id)      complete(cwd, id, patch)
 *     journal(cwd, event)           snapshot(cwd)         replay(cwd)           verify(cwd)
 *     regenerateViews(cwd)
 *   Each returns `{ ok: true, ... }` or `{ ok: false, code, message }`; nothing throws into a
 *   caller's turn.
 *
 * CONFIG
 *   `stateDir` — directory name under the workspace (default `state`), kept for a future
 *   migration; `lockTimeoutMs`/`lockStaleMs` are passed through to the core.
 */

import { createStateService } from './lib/core.mjs'

export const name = '@cc/dsh-project-state'
/** No `tools` injection: the row owns no tool and only needs `provide`/`effect`. */
export const inject = []

/**
 * Publish the service.
 *
 * @param ctx - host context.
 * @param {object} [config] - see CONFIG.
 */
export function apply(ctx, config = {}) {
  const dirName = typeof config.stateDir === 'string' && config.stateDir.trim() !== '' ? config.stateDir.trim() : 'state'
  const cores = new Map()
  const open = (cwd) => {
    const root = typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
    if (!cores.has(root)) {
      cores.set(root, createStateService({
        cwd: root,
        stateDir: dirName,
        lockTimeoutMs: config.lockTimeoutMs,
        lockStaleMs: config.lockStaleMs,
        logger: ctx.logger,
      }))
    }
    return cores.get(root)
  }
  const delegate = (method) => (cwd, ...args) => {
    try {
      return open(cwd)[method](...args)
    } catch (error) {
      return { ok: false, code: 'service_failed', message: error instanceof Error ? error.message : String(error) }
    }
  }
  const service = {
    open,
    create: delegate('create'),
    get: delegate('get'),
    list: delegate('list'),
    update: delegate('update'),
    link: delegate('link'),
    issueId: delegate('issueId'),
    claim: delegate('claim'),
    release: delegate('release'),
    complete: delegate('complete'),
    // A conversation-level consumer (the taskboard's owner-status override) records a waiver
    // event here; without the delegate the trail silently disappears.
    journal: delegate('journal'),
    snapshot: delegate('snapshot'),
    regenerateViews: delegate('regenerateViews'),
    replay: delegate('replay'),
    verify: delegate('verify'),
  }
  const provided = ctx.provide('ccProjectState', service)
  if (typeof provided === 'function') ctx.effect(() => provided)
  return service
}

export default { name, inject, apply }
