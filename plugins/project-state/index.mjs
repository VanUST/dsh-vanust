/**
 * PURPOSE
 *   Host row that publishes the project state core as the `ccProjectState` service, and the one
 *   command the owner's own editing goes through. The row registers no MODEL tools: the
 *   REQ/TASK operations are consumers built on this service, and keeping the row tool-free is
 *   what lets it exist before them.
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
 * THE `/state` COMMAND
 *   The Project state panel has an Edit mode, and a panel may not write files: it runs
 *   `/state {"op":"edit", "id":"REQ-001", "expectedRevision":3, "patch":{...}, "release":[...]}`
 *   through the command Remote, exactly the way the Tasks panel reaches `/taskboard`. This row
 *   turns that into `ccProjectState.update` with `origin: "human"`, regenerates the projections
 *   and answers with the same `{kind, text}` shape: a refusal is `state: CODE; message` and
 *   `revision_conflict` carries the revision the file actually holds.
 *
 * CONFIG
 *   `stateDir` — directory name under the workspace (default `state`), kept for a future
 *   migration; `lockTimeoutMs`/`lockStaleMs` are passed through to the core.
 */

import { createStateService } from './lib/core.mjs'

export const name = '@cc/dsh-project-state'
/** The row owns no MODEL tool; it needs the command Remote for the panel's one write. */
export const inject = ['commands']

/** The workspace of the invoking session, or the host process directory. */
function workingDir(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
}

/**
 * Publish the service and the command.
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
  // THE PANEL'S ONE WRITE. `recordInput: false` keeps the entity text out of the command log:
  // the payload carries a requirement's wording or a test case's description, and the command
  // Remote's input record is not the place for it (the state journal already keeps the change).
  if (typeof ctx.commands?.register === 'function') {
    ctx.commands.register({
      name: 'state',
      description: 'Edit one state entity by hand (used by the Project state panel): {"op":"edit","id":"REQ-001","expectedRevision":3,"patch":{...},"release":[...]}. The core writes it, the journal records origin human, and the projections are regenerated.',
      recordInput: false,
      handler: async (invocation) => {
        let op
        try {
          op = JSON.parse(invocation.rawInput)
        } catch {
          return { kind: 'error', text: 'state: expected a JSON operation' }
        }
        const cwd = workingDir(invocation.agent)
        try {
          if (op?.op !== 'edit') return { kind: 'error', text: `state: unknown op "${op?.op ?? ''}"; the panel sends "edit"` }
          const id = typeof op.id === 'string' ? op.id.trim() : ''
          if (id === '') return { kind: 'error', text: 'state: edit needs id' }
          // THE REVISION IS REQUIRED, never defaulted: a panel that lost track of the file must
          // re-read it instead of overwriting a change an agent made meanwhile.
          if (!Number.isInteger(op.expectedRevision)) {
            return { kind: 'error', text: 'state: REVISION_REQUIRED; re-read the entity and retry' }
          }
          const patch = {
            ...(op.patch !== null && typeof op.patch === 'object' && !Array.isArray(op.patch) ? op.patch : {}),
            expectedRevision: op.expectedRevision,
            origin: 'human',
          }
          if (typeof op.body === 'string') patch.body = op.body
          if (Array.isArray(op.release)) patch.release = op.release
          const result = await service.update(cwd, id, patch)
          if (result?.ok === false) {
            const details = [result.code]
            if (typeof result.message === 'string' && result.message !== '') details.push(result.message)
            if (Number.isInteger(result.revision)) details.push(`current rev ${result.revision}`)
            return { kind: 'error', text: `state: ${details.join('; ')}` }
          }
          // The edit is ON DISK; the projection is a convenience for the next paint, so a
          // projection failure is reported in the answer but does not undo the write.
          let viewsError = null
          try {
            const views = await service.regenerateViews(cwd)
            if (views?.ok === false) viewsError = views.message ?? views.code ?? 'views_failed'
          } catch (error) {
            viewsError = error instanceof Error ? error.message : String(error)
          }
          return { kind: 'success', text: JSON.stringify(viewsError === null ? result : { ...result, viewsError }) }
        } catch (error) {
          return { kind: 'error', text: `state: ${error instanceof Error ? error.message : String(error)}` }
        }
      },
    })
  }
  const provided = ctx.provide('ccProjectState', service)
  if (typeof provided === 'function') ctx.effect(() => provided)
  return service
}

export default { name, inject, apply }
