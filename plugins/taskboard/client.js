window.__ModuleLoader__.load({
  id: '@cc/dsh-taskboard',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React

    const PANEL_ID = 'tasks'
    const FILE = '.dsh/taskboard.json'
    const STATUSES = ['proposed', 'ready', 'active', 'paused', 'review', 'done', 'blocked', 'cancelled']
    const COLUMNS = [
      { id: 'proposed', label: 'Proposed' },
      { id: 'ready', label: 'Ready' },
      { id: 'active', label: 'Active' },
      { id: 'paused', label: 'Paused' },
      { id: 'review', label: 'Review' },
      { id: 'done', label: 'Done' },
      { id: 'blocked', label: 'Blocked' },
      { id: 'cancelled', label: 'Cancelled' },
    ]

    const CSS = `
.tb-root{--tb-primary-fill:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));--tb-primary-label:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-label-primary-inverted));height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13.5px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;container-type:inline-size}
.tb-root *{box-sizing:border-box}
.tb-top{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;min-height:48px;flex-wrap:wrap}
.tb-title{font-size:16px;font-weight:700;letter-spacing:-.01em;margin:0}
.tb-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--tb-primary-fill);color:var(--tb-primary-label);font-size:10.5px;font-weight:700}
.tb-spacer{flex:1}
.tb-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:7px;padding:5px 9px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
.tb-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.tb-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.tb-btn.primary{background:var(--tb-primary-fill);border-color:var(--tb-primary-fill);color:var(--tb-primary-label)}
.tb-btn.primary:hover{background:var(--dsw-alias-button-primary-hover,var(--tb-primary-fill));border-color:var(--dsw-alias-button-primary-hover,var(--tb-primary-fill))}
.tb-btn:disabled{opacity:.55;cursor:not-allowed}
.tb-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,var(--dsw-alias-border-l1))}
.tb-select{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:7px;padding:5px 24px 5px 8px;font:inherit;font-size:12px;max-width:190px;background-image:linear-gradient(45deg,transparent 50%,var(--dsw-alias-label-secondary) 50%),linear-gradient(135deg,var(--dsw-alias-label-secondary) 50%,transparent 50%);background-position:calc(100% - 13px) 50%,calc(100% - 9px) 50%;background-size:4px 4px,4px 4px;background-repeat:no-repeat;cursor:pointer}
.tb-body{display:grid;grid-template-columns:minmax(0,1fr) 400px;flex:1;min-height:0}
.tb-body.solo{grid-template-columns:minmax(0,1fr)}
.tb-board{display:flex;gap:9px;padding:11px;overflow:auto;min-width:0;align-items:flex-start;scrollbar-width:thin}
.tb-col{min-width:184px;flex:1 0 184px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px;min-height:120px}
.tb-col h3{display:flex;align-items:center;gap:6px;margin:0 0 7px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);font-weight:700}
.tb-col h3 .n{margin-left:auto;color:var(--dsw-alias-label-secondary);font-weight:500;letter-spacing:0}
.tb-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px;margin-bottom:7px;cursor:pointer;box-shadow:0 1px 0 rgba(0,0,0,.03)}
.tb-card:hover{background:var(--dsw-alias-bg-layer-2)}
.tb-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.tb-card.sel{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent)}
.tb-card .t{font-size:12.4px;font-weight:650;line-height:1.3;margin-bottom:4px;overflow-wrap:anywhere}
.tb-card .s{font-size:10.8px;color:var(--dsw-alias-label-secondary);margin-bottom:6px;overflow-wrap:anywhere}
.tb-chips{display:flex;flex-wrap:wrap;gap:3px}
.tb-chip{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 6px;font-size:10px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 7%,transparent);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-chip.ok{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 30%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 9%,transparent)}
.tb-chip.warn{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent)}
.tb-chip.bad{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent)}
.tb-card .f{display:flex;align-items:center;gap:5px;margin-top:6px;padding-top:5px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:10px;min-width:0}
.tb-card .f .o{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-avatar{width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);color:var(--dsw-alias-brand-primary);font-size:8.5px;font-weight:800;flex:none}
.tb-detail{border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);overflow:auto;min-height:0;min-width:0;padding:12px 14px 24px;scrollbar-width:thin}
.tb-kicker{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin-bottom:4px}
.tb-detail h2{font-size:15px;line-height:1.25;margin:0 0 7px;overflow-wrap:anywhere}
.tb-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.tb-sec{margin:0 0 11px}
.tb-sec h4{margin:0 0 3px;font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.tb-sec p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}
.tb-input,.tb-area{width:100%;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;padding:5px 7px;font:inherit;font-size:12px}
.tb-input:focus,.tb-area:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:0;border-color:transparent}
.tb-area{min-height:96px;resize:vertical;line-height:1.4}
.tb-area.small{min-height:84px}
.tb-label{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin:6px 0 2px}
.tb-timeline{list-style:none;margin:0;padding:0;position:relative}
.tb-timeline:before{content:"";position:absolute;left:6px;top:4px;bottom:4px;width:1px;background:var(--dsw-alias-border-l1)}
.tb-ev{position:relative;padding:0 0 9px 19px}
.tb-ev:last-child{padding-bottom:0}
.tb-ev .b{position:absolute;left:1px;top:3px;width:9px;height:9px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);border:2px solid var(--dsw-alias-brand-primary)}
.tb-ev.ok .b{border-color:var(--dsw-alias-state-success-primary)}
.tb-ev.warn .b{border-color:var(--dsw-alias-state-warn-primary)}
.tb-ev.bad .b{border-color:var(--dsw-alias-state-error-primary)}
.tb-ev .who{font-size:11.2px;font-weight:650}
.tb-ev .what{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.tb-ev .when{font-size:9.8px;color:var(--dsw-alias-label-secondary);opacity:.8;margin-top:1px}
.tb-empty{padding:26px 18px;color:var(--dsw-alias-label-secondary);font-size:12.5px;text-align:center}
.tb-banner{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary);border-radius:7px;padding:6px 8px;margin:0 0 9px;font-size:11.5px;overflow-wrap:anywhere}
.tb-note{display:flex;gap:5px;margin-top:5px}
.tb-savehint{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin:-3px 0 9px;min-height:14px}
.tb-detail-head{display:flex;align-items:flex-start;gap:8px;margin-bottom:4px}
.tb-detail-head .tb-kicker{flex:1;margin-bottom:0}
.tb-hide{flex:none;padding:2px 8px;font-size:11px;line-height:1.3}
.tb-readonly{flex:none;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 38%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent);color:var(--dsw-alias-state-warn-primary);border-radius:7px;padding:6px 10px;margin:8px 14px 0;font-size:11.5px;font-weight:600}
.tb-global-error{flex:none;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 38%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent);color:var(--dsw-alias-state-error-primary);border-radius:7px;padding:6px 10px;margin:8px 14px 0;font-size:11.5px;font-weight:600;overflow-wrap:anywhere}
.tb-conflict{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 38%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent);color:var(--dsw-alias-state-warn-primary);border-radius:7px;padding:6px 8px;margin:0 0 9px;font-size:11.5px}
.tb-conflict .tb-btn{margin-left:auto;border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 38%,var(--dsw-alias-border-l1));color:var(--dsw-alias-label-primary)}
.tb-roster{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);min-height:30px}
.tb-roster .tb-rlabel{font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:var(--dsw-alias-label-secondary)}
.tb-roster .tb-rstat{white-space:nowrap}
.tb-roster .tb-rstat b{color:var(--dsw-alias-label-primary);font-weight:700;font-variant-numeric:tabular-nums}
.tb-roster .tb-rsep{opacity:.5}
.tb-roster .tb-rroles{display:flex;align-items:center;gap:4px;flex-wrap:wrap;min-width:0}
.tb-roster .tb-rrole{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:999px;padding:0 6px;font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.tb-roster .tb-rrole b{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.tb-roster .tb-rnone{font-style:italic}
.tb-subsummary{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin:0 0 5px}
.tb-subs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.tb-sub{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 6px;font-size:11px;background:var(--dsw-alias-bg-base);min-width:0}
.tb-sub .role{flex:none;font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-primary)}
.tb-sub .who{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.tb-sub .label,.tb-sub .id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-sub .id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9px;color:var(--dsw-alias-label-secondary)}
.tb-sub .state{flex:none;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 5px;font-size:9.5px;font-weight:700;text-transform:capitalize;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.tb-sub .state.active{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 9%,transparent)}
.tb-sub .state.paused{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 32%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent)}
.tb-sub .tb-btn{margin-left:auto;padding:2px 6px;font-size:10px;flex:none}
.tb-chip.sub{color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 24%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent);white-space:normal;overflow:visible;text-overflow:clip;line-height:1.3}
.tb-note .tb-input{flex:1}
.tb-children{display:flex;flex-direction:column;gap:4px}
.tb-child{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:5px 7px;font-size:11px;background:var(--dsw-alias-bg-base);min-width:0}
.tb-child .id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-child .tb-btn{margin-left:auto;padding:2px 6px;font-size:10px}
.tb-trigger{display:inline-flex;align-items:center;gap:4px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary);border-radius:7px;padding:3px 7px;font:inherit;font-size:11.5px;font-weight:600;cursor:pointer;height:26px}
.tb-trigger:hover{background:var(--dsw-alias-bg-layer-1)}
.tb-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.tb-trigger-label{white-space:nowrap}
.tb-trigger .n{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:17px;padding:0 5px;margin-left:4px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
.tb-icon{display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;color:inherit;border-radius:7px;padding:5px;cursor:pointer}
.tb-icon:hover{background:transparent;color:inherit}
.tb-icon:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.tb-icon.active{background:transparent;color:inherit}
@container (max-width:920px){.tb-body{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) auto}.tb-detail{border-left:0;border-top:1px solid var(--dsw-alias-border-l1);max-height:55vh}}
@media (max-width:960px){.tb-body{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) auto}.tb-detail{border-left:0;border-top:1px solid var(--dsw-alias-border-l1);max-height:55vh}}
`

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        set(patch) {
          state = { ...state, ...patch }
          for (const listener of listeners) listener()
        },
      }
    }

    function firstSession(workspaces, sessionsById) {
      const candidates = (Array.isArray(workspaces) ? workspaces : [])
        .filter((workspace) => sessionIdsOf(workspace).length > 0)
        .slice()
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
      const workspace = candidates.find((entry) => sessionIdsOf(entry).some((id) => isLiveSession(sessionsById, id))) ?? candidates[0]
      if (workspace === undefined) return null
      return { sessionId: pickWorkspaceSession(workspace, sessionsById, null), workspace }
    }

    function isMissing(error) {
      const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
      return text.includes('enoent') || text.includes('no such file') || text.includes('no entry at') || text.includes('not found')
    }

    async function readBoard(remote, sessionId, signal) {
      if (typeof sessionId !== 'string' || sessionId === '') return { board: null }
      let offset = 1
      let text = ''
      let complete = false
      // A maximal board is about 75 pages; 200 leaves room and never parses a truncated ledger.
      for (let page = 0; page < 200; page += 1) {
        const result = await remote.workspaceFiles.read(sessionId, FILE, { offset, limit: 2000 }, signal)
        if (!result.ok) {
          if (isMissing(result.error)) return { board: null }
          return { error: result.error.message ?? result.error.code ?? 'read failed' }
        }
        if (result.value === null || result.value === undefined) return { error: 'read returned no value' }
        text += result.value.text
        if (result.value.eof) {
          complete = true
          break
        }
        if (result.value.lines === 0) return { error: 'ledger is too large to read: the read did not reach EOF within 200 pages.' }
        offset = result.value.offset + result.value.lines
        text += '\n'
      }
      if (!complete) return { error: 'ledger is too large to read: the ledger did not reach EOF within 200 pages.' }
      if (text.trim() === '') return { board: null }
      try {
        const board = JSON.parse(text)
        return { board: board !== null && typeof board === 'object' && Array.isArray(board.tasks) ? board : { version: 1, revision: 0, tasks: [] } }
      } catch (error) {
        return { error: `ledger is not valid JSON: ${error.message}` }
      }
    }

    async function runOp(remote, sessionId, op) {
      if (remote === null || remote === undefined || remote.commands === undefined || typeof remote.commands.execute !== 'function') {
        return { ok: false, error: 'The taskboard command is unavailable in this view.' }
      }
      const result = await remote.commands.execute(sessionId, `/taskboard ${JSON.stringify(op)}`, [])
      if (result === null || result === undefined) return { ok: false, error: 'The taskboard command returned no result.' }
      if (!result.ok) return { ok: false, error: result.error?.message ?? result.error?.code ?? 'command failed' }
      if (result.value === null || result.value === undefined) return { ok: false, error: 'The taskboard command returned no result.' }
      const outcome = result.value.result
      if (outcome === null || outcome === undefined) return { ok: false, error: 'The taskboard command returned no result.' }
      if (outcome.kind === 'error') return { ok: false, error: outcome.text ?? 'command failed' }
      if (outcome.kind !== 'success') return { ok: false, error: `The taskboard command returned an unexpected result (${String(outcome.kind ?? 'none')}).` }
      return { ok: true, text: outcome.text ?? '' }
    }

    function statusTone(status) {
      if (status === 'done') return 'ok'
      if (status === 'active' || status === 'review' || status === 'paused') return 'warn'
      if (status === 'blocked') return 'bad'
      return ''
    }

    const CHILD_STATES = ['active', 'sleeping', 'paused']

    function sessionIdsOf(workspace) {
      if (workspace === null || workspace === undefined || !Array.isArray(workspace.sessionIds)) return []
      return workspace.sessionIds.filter((id) => typeof id === 'string' && id !== '')
    }

    function isLiveSession(sessionsById, sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return false
      return ((sessionsById?.[sessionId]?.retainedBy?.mainView ?? 0) > 0)
    }

    function pickWorkspaceSession(workspace, sessionsById, preferredId) {
      const ids = sessionIdsOf(workspace)
      if (ids.length === 0) return null
      if (typeof preferredId === 'string' && ids.includes(preferredId) && isLiveSession(sessionsById, preferredId)) return preferredId
      const live = ids.find((id) => isLiveSession(sessionsById, id))
      if (live !== undefined) return live
      if (typeof preferredId === 'string' && ids.includes(preferredId)) return preferredId
      return ids[0]
    }

    /**
     * One child row per linked session. The Host's `children[]` is authoritative;
     * older tasks that only have `childSessionIds[]` fall back to id + "child".
     */
    function normalizeChildren(task) {
      const rows = []
      const seen = new Set()
      const timeline = Array.isArray(task?.timeline) ? task.timeline : []
      const owner = task?.owner !== null && typeof task?.owner === 'object' ? task.owner : null
      const fallbackStatus = task?.status === 'active' ? 'active' : task?.status === 'paused' ? 'paused' : ['review', 'done', 'cancelled'].includes(task?.status) ? 'sleeping' : 'linked'
      const fallback = (sessionId) => {
        const started = timeline.find((entry) => entry?.kind === 'child_started' && entry?.sessionId === sessionId)
        const match = typeof started?.text === 'string' ? /^Delegated to (.+)$/.exec(started.text) : null
        const label = owner?.sessionId === sessionId && typeof owner.label === 'string' ? owner.label : match?.[1] ?? ''
        return { label, role: label, status: fallbackStatus }
      }
      const add = (sessionId, label, role, status) => {
        if (typeof sessionId !== 'string' || sessionId === '' || seen.has(sessionId)) return
        seen.add(sessionId)
        const derived = fallback(sessionId)
        const resolvedRole = typeof role === 'string' && role !== '' && role !== 'child' ? role : (derived.role || task?.title || 'child')
        const resolvedLabel = typeof label === 'string' && label !== '' ? label : derived.label
        const resolvedStatus = CHILD_STATES.includes(status) && status !== 'linked' ? status : derived.status
        rows.push({
          sessionId,
          label: resolvedLabel !== '' ? resolvedLabel : sessionId,
          role: resolvedRole !== '' ? resolvedRole : 'child',
          status: resolvedStatus,
        })
      }
      if (Array.isArray(task?.children)) {
        for (const child of task.children) {
          if (child !== null && typeof child === 'object') add(child.sessionId, child.label, child.role, child.status)
        }
      }
      if (Array.isArray(task?.childSessionIds)) {
        for (const sessionId of task.childSessionIds) add(sessionId, '', 'child', 'linked')
      }
      return rows
    }

    function childCounts(rows) {
      return {
        total: rows.length,
        active: rows.filter((row) => row.status === 'active').length,
        sleeping: rows.filter((row) => row.status === 'sleeping').length,
        paused: rows.filter((row) => row.status === 'paused').length,
        linked: rows.filter((row) => row.status === 'linked').length,
      }
    }

    function subagentWord(count) {
      return count === 1 ? 'subagent' : 'subagents'
    }

    function subagentSummary(rows) {
      const counts = childCounts(rows)
      const parts = [`${counts.total} ${subagentWord(counts.total)}`, `${counts.active} active`, `${counts.sleeping} sleeping`]
      if (counts.paused > 0) parts.push(`${counts.paused} paused`)
      if (counts.linked > 0) parts.push(`${counts.linked} linked`)
      return parts.join(' · ')
    }

    function cardSubagentSummary(rows) {
      if (rows.length === 0) return ''
      const counts = childCounts(rows)
      const head = rows.length > 1 ? `${rows[0].role} +${rows.length - 1}` : rows[0].role
      const parts = [head]
      if (counts.active > 0) parts.push(`${counts.active} active`)
      if (counts.sleeping > 0) parts.push(`${counts.sleeping} sleeping`)
      if (counts.paused > 0) parts.push(`${counts.paused} paused`)
      if (counts.linked > 0) parts.push(`${counts.linked} linked`)
      return parts.join(' · ')
    }

    function subagentRoster(tasks) {
      const seen = new Map()
      for (const task of tasks) {
        for (const row of normalizeChildren(task)) {
          if (!seen.has(row.sessionId)) seen.set(row.sessionId, row)
        }
      }
      return Array.from(seen.values())
    }

    function roleCounts(rows) {
      const counts = new Map()
      for (const row of rows) counts.set(row.role, (counts.get(row.role) ?? 0) + 1)
      return Array.from(counts, ([role, count]) => ({ role, count }))
    }

    function parseResultPayload(text) {
      if (typeof text !== 'string' || text.trim() === '') return null
      try {
        const parsed = JSON.parse(text)
        return parsed !== null && typeof parsed === 'object' ? parsed : null
      } catch {
        // A result that is not JSON means the next poll is the source of truth.
        return null
      }
    }

    function taskOfPayload(payload) {
      if (payload === null || payload === undefined || typeof payload !== 'object') return null
      if (payload.task !== null && payload.task !== undefined && typeof payload.task === 'object') return payload.task
      if (typeof payload.id === 'string') return payload
      return null
    }

    function resultMessages(payload) {
      const messages = []
      if (payload === null || typeof payload !== 'object') return messages
      for (const key of ['errors', 'warnings']) {
        const value = payload[key]
        if (Array.isArray(value)) {
          for (const entry of value) {
            if (typeof entry === 'string' && entry.trim() !== '') messages.push(entry.trim())
            else if (entry !== null && typeof entry === 'object' && typeof entry.message === 'string' && entry.message.trim() !== '') messages.push(entry.message.trim())
          }
        } else if (typeof value === 'string' && value.trim() !== '') {
          messages.push(value.trim())
        }
      }
      for (const key of ['error', 'warning']) {
        if (typeof payload[key] === 'string' && payload[key].trim() !== '') messages.push(payload[key].trim())
      }
      return messages
    }

    /** Keep acceptance `{text, done}` flags when the text itself is unchanged. */
    function mergeAcceptance(existing, texts) {
      const previous = new Map()
      for (const entry of Array.isArray(existing) ? existing : []) {
        const text = typeof entry === 'string' ? entry : entry?.text
        if (typeof text !== 'string' || text === '') continue
        const done = entry !== null && typeof entry === 'object' && entry.done === true
        if (!previous.has(text)) previous.set(text, [])
        previous.get(text).push(done)
      }
      return texts.map((text) => {
        const queue = previous.get(text)
        return { text, done: Array.isArray(queue) && queue.length > 0 ? queue.shift() === true : false }
      })
    }

    function shortTime(value) {
      if (typeof value !== 'string' || value === '') return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      const minutes = Math.round((Date.now() - date.getTime()) / 60000)
      if (minutes < 1) return 'now'
      if (minutes < 60) return `${minutes}m`
      if (minutes < 1440) return `${Math.round(minutes / 60)}h`
      return `${Math.round(minutes / 1440)}d`
    }

    function Icon({ size = 18, active = false }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M7 9.5h4M7 13h7M7 16.5h5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { d: 'M15.5 15.5l1.6 1.6 3-3.2', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function TasksTrigger({ remote, store, layout, sessionId }) {
      const [count, setCount] = useState(0)
      useEffect(() => {
        let cancelled = false
        const controller = new AbortController()
        const tick = async () => {
          const result = await readBoard(remote, sessionId, controller.signal)
          if (!cancelled && result.board) setCount(result.board.tasks.length)
        }
        tick().catch(() => {})
        const timer = setInterval(() => { tick().catch(() => {}) }, 5000)
        return () => { cancelled = true; controller.abort(); clearInterval(timer) }
      }, [remote, sessionId])
      const open = () => {
        store.set({ sessionId })
        layout.selectPanel(PANEL_ID)
      }
      return h(React.Fragment, null,
        h('style', null, CSS),
        h('button', { type: 'button', className: 'tb-trigger', onClick: open, title: 'Open the task board', 'aria-label': `Open tasks${count > 0 ? `, ${count} total` : ''}` },
          h(Icon, { size: 14 }),
          h('span', { className: 'tb-trigger-label' }, 'Tasks '),
          count > 0 ? h('span', { className: 'n' }, String(count)) : null,
        ),
      )
    }

    function PanelIcon({ size = 18, active = false, layout }) {
      return h(React.Fragment, null,
        h('style', null, CSS),
        h('button', { type: 'button', className: `tb-icon${active ? ' active' : ''}`, onClick: () => layout.selectPanel(PANEL_ID), title: 'Tasks', 'aria-label': 'Open the task board', style: { width: size + 12, height: size + 12 } },
          h(Icon, { size, active }),
        ),
      )
    }

    function TaskCard({ task, selected, onSelect }) {
      const children = normalizeChildren(task)
      const scope = Array.isArray(task.scope) ? task.scope : []
      return h('div', {
        className: `tb-card${selected ? ' sel' : ''}`,
        role: 'button',
        tabIndex: 0,
        onClick: () => onSelect(task.id),
        onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(task.id) } },
        'aria-pressed': selected,
      },
        h('div', { className: 't' }, task.title),
        task.objective ? h('div', { className: 's' }, task.objective.length > 90 ? `${task.objective.slice(0, 90)}…` : task.objective) : null,
        h('div', { className: 'tb-chips' },
          h('span', { className: `tb-chip ${statusTone(task.status)}` }, task.status),
          children.length > 0 ? h('span', { className: 'tb-chip sub' }, cardSubagentSummary(children)) : null,
          scope.slice(0, 2).map((entry, index) => h('span', { className: 'tb-chip', key: `s${index}` }, entry)),
          scope.length > 2 ? h('span', { className: 'tb-chip' }, `+${scope.length - 2}`) : null,
        ),
        h('div', { className: 'f' },
          h('span', { className: 'tb-avatar' }, (task.owner?.label ?? '?').slice(0, 1).toUpperCase()),
          h('span', { className: 'o' }, task.owner?.label ?? 'unowned'),
          h('span', { style: { marginLeft: 'auto' } }, shortTime(task.updatedAt)),
        ),
      )
    }

    function TaskDetail({ task, busy, error, canEdit, onHide, onSave, onNote, onOpenSession, onAction, onRefresh }) {
      const [draft, setDraft] = useState(() => draftOf(task))
      const baseRef = useRef(task)
      const [conflict, setConflict] = useState(false)
      useEffect(() => {
        const base = baseRef.current
        if (task.id !== base.id) {
          baseRef.current = task
          setDraft(draftOf(task))
          setConflict(false)
          return
        }
        if (task.revision === base.revision) return
        // Our own successful save echoes the draft back; accept it as the new base.
        const draftJson = draftKey(draft)
        if (draftJson !== taskKey(base)) {
          if (draftJson === taskKey(task)) {
            baseRef.current = task
            setDraft(draftOf(task))
            setConflict(false)
            return
          }
          // A background poll must not discard a dirty draft; offer Refresh instead.
          setConflict(true)
          return
        }
        baseRef.current = task
        setDraft(draftOf(task))
        setConflict(false)
      }, [task.id, task.revision])
      const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
      const refreshDraft = () => {
        baseRef.current = task
        setDraft(draftOf(task))
        setConflict(false)
        if (typeof onRefresh === 'function') onRefresh()
      }
      const save = () => {
        const title = draft.title.trim()
        if (title === '' || !canEdit) return
        const base = baseRef.current
        const patch = {
          title,
          objective: draft.objective,
          scope: lines(draft.scope),
          nonScope: lines(draft.nonScope),
          acceptance: mergeAcceptance(base.acceptance, lines(draft.acceptance)),
          result: {
            ...(base.result !== null && typeof base.result === 'object' ? base.result : {}),
            summary: draft.resultSummary,
            evidence: lines(draft.resultEvidence),
          },
        }
        // Paused and done are lifecycle actions, not ordinary field edits.
        if (draft.status !== base.status && draft.status !== 'paused' && draft.status !== 'done') patch.status = draft.status
        onSave(task.id, base.revision, patch)
      }
      const timeline = Array.isArray(task.timeline) ? task.timeline.slice().reverse() : []
      const children = normalizeChildren(task)
      const artifacts = Array.isArray(task.result?.artifacts) ? task.result.artifacts : []
      const closed = task.status === 'done' || task.status === 'cancelled'
      const paused = task.status === 'paused'
      const titleEmpty = draft.title.trim() === ''
      const dirty = draftKey(draft) !== taskKey(baseRef.current)
      const hintId = `tb-save-hint-${task.id}`
      const saveLabel = busy ? 'Saving…' : !canEdit ? 'Save changes' : titleEmpty ? 'Title required' : dirty ? 'Save changes' : 'Saved'
      const hint = !canEdit
        ? 'Read-only — open a live conversation to edit this board.'
        : titleEmpty
          ? 'A task needs a non-empty title. Add one before saving.'
          : conflict
            ? `This task changed in the ledger (now rev ${task.revision}). Your draft is kept; Refresh loads the latest revision.`
            : busy
              ? 'Writing the task ledger…'
              : dirty
                ? 'Unsaved changes — Save writes the title, status and every field below to the workspace ledger.'
                : 'All fields are saved in the workspace ledger. Pause, Close and Remove act immediately.'
      return h('div', null,
        h('div', { className: 'tb-detail-head' },
          h('div', { className: 'tb-kicker' }, `Task ${task.id} · rev ${task.revision}`),
          h('button', { type: 'button', className: 'tb-btn tb-hide', onClick: onHide, title: 'Hide the task detail pane', 'aria-controls': 'tb-detail-pane' }, 'Hide'),
        ),
        h('h2', null, task.title),
        h('div', { className: 'tb-row' },
          h('select', { className: 'tb-select', value: draft.status, onChange: (event) => set('status', event.target.value), 'aria-label': 'Task status', 'aria-describedby': hintId, title: 'Paused and done change through Resume and Close, not Save', disabled: busy || !canEdit },
            STATUSES.map((status) => h('option', { value: status, key: status, disabled: status === 'paused' || status === 'done' }, status)),
          ),
          h('span', { className: `tb-chip ${statusTone(task.status)}` }, task.status),
          h('button', { type: 'button', className: 'tb-btn primary', onClick: save, disabled: busy || !dirty || !canEdit || titleEmpty, title: !canEdit ? 'Open a live conversation to edit this board' : titleEmpty ? 'A task needs a non-empty title' : dirty ? 'Save every edited field to the task ledger' : 'No unsaved edits', 'aria-describedby': hintId }, saveLabel),
        ),
        h('div', { className: 'tb-savehint', id: hintId, 'aria-live': 'polite' }, hint),
        conflict ? h('div', { className: 'tb-conflict', role: 'status', 'aria-live': 'polite' },
          h('span', null, `The ledger now has rev ${task.revision}. Your draft was not replaced.`),
          h('button', { type: 'button', className: 'tb-btn', onClick: refreshDraft, title: 'Load the latest task revision into the form' }, 'Refresh'),
        ) : null,
        h('div', { className: 'tb-row' },
          h('button', { type: 'button', className: 'tb-btn', onClick: () => onAction(paused ? 'resume' : 'pause', task.id), disabled: busy || closed || !canEdit }, paused ? 'Resume' : 'Pause'),
          h('button', { type: 'button', className: 'tb-btn', onClick: () => onAction('close', task.id), disabled: busy || closed || !canEdit }, 'Close'),
          h('button', { type: 'button', className: 'tb-btn danger', onClick: () => onAction('remove', task.id), disabled: busy || !canEdit }, 'Remove'),
        ),
        error ? h('div', { className: 'tb-banner' }, error) : null,
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-title-${task.id}` }, 'Title'),
          h('input', { id: `tb-title-${task.id}`, className: 'tb-input', value: draft.title, onChange: (event) => set('title', event.target.value), readOnly: !canEdit, 'aria-invalid': titleEmpty ? 'true' : undefined, 'aria-describedby': hintId }),
        ),
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-obj-${task.id}` }, 'Objective'),
          h('textarea', { id: `tb-obj-${task.id}`, className: 'tb-area', value: draft.objective, onChange: (event) => set('objective', event.target.value), readOnly: !canEdit }),
        ),
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-scope-${task.id}` }, 'Scope — one per line'),
          h('textarea', { id: `tb-scope-${task.id}`, className: 'tb-area small', value: draft.scope, onChange: (event) => set('scope', event.target.value), readOnly: !canEdit }),
        ),
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-non-${task.id}` }, 'Non-scope — one per line'),
          h('textarea', { id: `tb-non-${task.id}`, className: 'tb-area small', value: draft.nonScope, onChange: (event) => set('nonScope', event.target.value), readOnly: !canEdit }),
        ),
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-acc-${task.id}` }, 'Acceptance — one per line'),
          h('textarea', { id: `tb-acc-${task.id}`, className: 'tb-area small', value: draft.acceptance, onChange: (event) => set('acceptance', event.target.value), readOnly: !canEdit }),
        ),
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-res-${task.id}` }, 'Result summary'),
          h('textarea', { id: `tb-res-${task.id}`, className: 'tb-area', value: draft.resultSummary, onChange: (event) => set('resultSummary', event.target.value), readOnly: !canEdit }),
        ),
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-evi-${task.id}` }, 'Evidence — one per line'),
          h('textarea', { id: `tb-evi-${task.id}`, className: 'tb-area small', value: draft.resultEvidence, onChange: (event) => set('resultEvidence', event.target.value), readOnly: !canEdit }),
        ),
        h('div', { className: 'tb-sec' },
          h('h4', null, 'Timeline'),
          timeline.length === 0 ? h('p', null, 'No events yet.') : h('ul', { className: 'tb-timeline' },
            timeline.map((entry, index) => h('li', { className: `tb-ev ${entry.kind === 'child_finished' ? 'ok' : entry.kind === 'edited' ? '' : entry.kind === 'blocked' ? 'bad' : ''}`, key: `${entry.at}-${index}` },
              h('span', { className: 'b' }),
              h('div', { className: 'who' }, entry.actor ?? 'system'),
              h('div', { className: 'what' }, entry.text ?? entry.kind),
              h('div', { className: 'when' }, shortTime(entry.at)),
            )),
          ),
        ),
        h('div', { className: 'tb-sec' },
          h('h4', null, 'Add a note'),
          h('div', { className: 'tb-note' },
            h('input', { className: 'tb-input', placeholder: 'A decision, a blocker, a handoff link…', readOnly: !canEdit, onKeyDown: (event) => { if (event.key === 'Enter' && event.currentTarget.value.trim() !== '') { onNote(task.id, event.currentTarget.value.trim()); event.currentTarget.value = '' } } }),
            h('button', { type: 'button', className: 'tb-btn', onClick: (event) => { const input = event.currentTarget.previousSibling; if (input.value.trim() !== '') { onNote(task.id, input.value.trim()); input.value = '' } }, disabled: busy || !canEdit }, 'Add'),
          ),
        ),
        children.length > 0 ? h('div', { className: 'tb-sec' },
          h('h4', null, 'Subagents'),
          h('div', { className: 'tb-subsummary' }, subagentSummary(children)),
          h('ul', { className: 'tb-subs' },
            children.map((child) => h('li', { className: 'tb-sub', key: child.sessionId },
              h('span', { className: 'role' }, child.role),
              h('span', { className: 'who' },
                h('span', { className: 'label', title: child.label }, child.label),
                child.label !== child.sessionId ? h('span', { className: 'id', title: child.sessionId }, child.sessionId) : null,
              ),
              h('span', { className: `state ${child.status}` }, child.status),
              h('button', { type: 'button', className: 'tb-btn', onClick: () => onOpenSession(child.sessionId), title: `Open subagent ${child.label}`, 'aria-label': `Open ${child.role} ${child.label}` }, 'Open'),
            )),
          ),
        ) : null,
        artifacts.length > 0 ? h('div', { className: 'tb-sec' },
          h('h4', null, 'Artifacts'),
          h('div', { className: 'tb-children' }, artifacts.map((artifact) => h('div', { className: 'tb-child', key: artifact }, h('span', { className: 'id' }, artifact)))),
        ) : null,
      )
    }

    function lines(value) {
      return String(value ?? '').split('\n').map((line) => line.trim()).filter((line) => line !== '')
    }

    function draftKey(draft) {
      return JSON.stringify({
        // The Host trims these two; compare the normalized values so our own
        // save echo is not mistaken for an external edit.
        title: String(draft.title ?? '').trim(),
        status: draft.status,
        objective: draft.objective,
        scope: lines(draft.scope),
        nonScope: lines(draft.nonScope),
        acceptance: lines(draft.acceptance),
        result: { summary: String(draft.resultSummary ?? '').trim(), evidence: lines(draft.resultEvidence) },
      })
    }

    function taskKey(task) {
      return JSON.stringify({
        title: task.title ?? '',
        status: task.status ?? '',
        objective: task.objective ?? '',
        scope: Array.isArray(task.scope) ? task.scope : [],
        nonScope: Array.isArray(task.nonScope) ? task.nonScope : [],
        acceptance: Array.isArray(task.acceptance) ? task.acceptance.map((entry) => (typeof entry === 'string' ? entry : entry.text)) : [],
        result: { summary: task.result?.summary ?? '', evidence: Array.isArray(task.result?.evidence) ? task.result.evidence : [] },
      })
    }

    function draftOf(task) {
      return {
        title: task.title ?? '',
        status: task.status ?? 'proposed',
        objective: task.objective ?? '',
        scope: Array.isArray(task.scope) ? task.scope.join('\n') : '',
        nonScope: Array.isArray(task.nonScope) ? task.nonScope.join('\n') : '',
        acceptance: Array.isArray(task.acceptance) ? task.acceptance.map((entry) => (typeof entry === 'string' ? entry : entry.text)).join('\n') : '',
        resultSummary: task.result?.summary ?? '',
        resultEvidence: Array.isArray(task.result?.evidence) ? task.result.evidence.join('\n') : '',
      }
    }

    function TasksPage({ remote, store, uiWorkspace, useWorkspaces, useSessions }) {
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      const workspacesRaw = useWorkspaces((snapshot) => snapshot.items)
      const workspaces = Array.isArray(workspacesRaw) ? workspacesRaw : []
      const sessionsRaw = useSessions((snapshot) => snapshot.byId)
      const sessionsById = sessionsRaw !== null && sessionsRaw !== undefined && typeof sessionsRaw === 'object' ? sessionsRaw : {}
      const [board, setBoard] = useState(null)
      const [selectedId, setSelectedId] = useState(null)
      const [readError, setReadError] = useState('')
      const [writeError, setWriteError] = useState('')
      const [busy, setBusy] = useState(false)
      const [detailOpen, setDetailOpen] = useState(true)
      const controllerRef = useRef(null)
      const boardRef = useRef(null)

      const sessionId = state.sessionId ?? firstSession(workspaces, sessionsById)?.sessionId ?? null
      const hasSession = typeof sessionId === 'string' && sessionId !== ''
      const canEdit = isLiveSession(sessionsById, sessionId)
      const error = writeError || readError

      useEffect(() => {
        const current = state.sessionId
        if (typeof current === 'string' && current !== '' && isLiveSession(sessionsById, current)) {
          const owner = workspaces.find((entry) => sessionIdsOf(entry).includes(current))
          if (owner !== undefined && state.workspaceTitle !== (owner.title ?? null)) store.set({ workspaceTitle: owner.title ?? null })
          return
        }
        const owner = typeof current === 'string' && current !== '' ? workspaces.find((entry) => sessionIdsOf(entry).includes(current)) : undefined
        const fallback = owner === undefined ? firstSession(workspaces, sessionsById) : null
        const workspace = owner ?? fallback?.workspace ?? null
        if (workspace === null) {
          if (current !== null && current !== undefined) store.set({ sessionId: null, workspaceTitle: null })
          return
        }
        const next = pickWorkspaceSession(workspace, sessionsById, current)
        if (next !== current || state.workspaceTitle !== (workspace.title ?? null)) {
          store.set({ sessionId: next, workspaceTitle: workspace.title ?? null })
        }
      }, [state.sessionId, state.workspaceTitle, workspaces, sessionsById, store])

      useEffect(() => {
        setBoard(null)
        setSelectedId(null)
        setReadError('')
        setWriteError('')
      }, [sessionId])

      const load = useCallback(async () => {
        if (!hasSession) return
        if (controllerRef.current) controllerRef.current.abort()
        const controller = new AbortController()
        controllerRef.current = controller
        let result
        try {
          result = await readBoard(remote, sessionId, controller.signal)
        } catch (failure) {
          if (!controller.signal.aborted) setReadError(failure?.message ?? 'read failed')
          return
        }
        if (controller.signal.aborted) return
        if (result.error) {
          // A read failure keeps the last good board and any write error.
          setReadError(result.error)
          return
        }
        setReadError('')
        setBoard(result.board ?? { version: 1, revision: 0, tasks: [] })
      }, [remote, sessionId, hasSession])

      useEffect(() => {
        load().catch((failure) => setReadError(failure?.message ?? 'read failed'))
        const timer = setInterval(() => { load().catch(() => {}) }, 2500)
        return () => { clearInterval(timer); if (controllerRef.current) controllerRef.current.abort() }
      }, [load])

      useEffect(() => {
        const board = boardRef.current
        if (board === null) return undefined
        const onWheel = (event) => {
          if (event.defaultPrevented || event.ctrlKey) return
          // A horizontal trackpad gesture keeps the browser's native handling.
          if (event.deltaX !== 0) return
          if (event.deltaY === 0) return
          const max = board.scrollWidth - board.clientWidth
          if (max <= 0) return
          const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? board.clientWidth : 1
          const delta = event.deltaY * unit
          const atStart = board.scrollLeft <= 0.5
          const atEnd = board.scrollLeft >= max - 0.5
          if (delta > 0 && atEnd) return
          if (delta < 0 && atStart) return
          const before = board.scrollLeft
          board.scrollLeft = Math.max(0, Math.min(max, before + delta))
          if (board.scrollLeft !== before) event.preventDefault()
        }
        board.addEventListener('wheel', onWheel, { passive: false })
        return () => board.removeEventListener('wheel', onWheel)
      }, [])

      const tasks = Array.isArray(board?.tasks) ? board.tasks : []
      const selected = tasks.find((task) => task.id === selectedId) ?? null
      useEffect(() => {
        if (selectedId === null && tasks.length > 0) {
          const active = tasks.find((task) => task.status === 'active' || task.status === 'review')
          setSelectedId((active ?? tasks[0]).id)
        }
      }, [tasks, selectedId])

      const reload = () => {
        load().catch((failure) => setReadError(failure?.message ?? 'read failed'))
      }

      const run = async (op, options = {}) => {
        if (!hasSession || !canEdit) {
          const message = 'Open a live conversation to edit this board.'
          setWriteError(message)
          return { ok: false, error: message }
        }
        setBusy(true)
        try {
          let result
          try {
            result = await runOp(remote, sessionId, op)
          } catch (failure) {
            const message = failure?.message ?? 'The taskboard command failed.'
            setWriteError(message)
            return { ok: false, error: message }
          }
          if (!result.ok) {
            // Keep the current board and selection; a later poll must not hide this.
            setWriteError(result.error)
            return result
          }
          const payload = parseResultPayload(result.text)
          const messages = resultMessages(payload)
          if (messages.length > 0) {
            const message = messages.join(' ')
            setWriteError(message)
            return { ok: false, error: message, warnings: messages }
          }
          setWriteError('')
          const task = taskOfPayload(payload)
          if (task !== null && typeof task.id === 'string') {
            setBoard((current) => current === null ? current : { ...current, tasks: current.tasks.map((entry) => entry.id === task.id ? task : entry) })
          }
          if (options.reload !== false) reload()
          return result
        } finally {
          setBusy(false)
        }
      }

      const save = (id, revision, patch) => {
        run({ op: 'update', id, expectedRevision: revision, patch }, { reload: false })
          .catch((failure) => setWriteError(failure?.message ?? 'Save failed.'))
      }
      const note = (id, text) => {
        run({ op: 'note', id, text }, { reload: false })
          .catch((failure) => setWriteError(failure?.message ?? 'The note was not saved.'))
      }
      const action = async (kind, id) => {
        if (kind === 'remove' && !window.confirm('Remove this task from the board? Its child sessions keep running; pause or close first if they should stop.')) return
        if (kind === 'close' && !window.confirm('Close this task as done and interrupt its linked child agents?')) return
        const result = await run({ op: kind, id })
        if (result.ok && kind === 'remove') {
          setSelectedId(null)
          setDetailOpen(true)
        }
      }
      const create = async () => {
        const result = await run({ op: 'create', task: { title: 'New task', objective: '', status: 'proposed' } })
        if (result.ok) {
          const task = taskOfPayload(parseResultPayload(result.text))
          if (task !== null && typeof task.id === 'string') setSelectedId(task.id)
        }
      }
      const chooseWorkspace = (value) => {
        const workspace = workspaces.find((entry) => String(entry.workspaceId) === value)
        if (workspace !== undefined) {
          store.set({ sessionId: pickWorkspaceSession(workspace, sessionsById, null), workspaceTitle: workspace.title })
          setSelectedId(null)
        }
      }
      const selectTask = (id) => {
        setSelectedId(id)
        setDetailOpen(true)
      }
      const workspaceId = workspaces.find((entry) => entry.sessionIds?.includes(sessionId))?.workspaceId
      const roster = subagentRoster(tasks)
      const rosterCounts = childCounts(roster)
      const roles = roleCounts(roster)
      return h('div', { className: 'tb-root' },
        h('style', null, CSS),
        h('div', { className: 'tb-top' },
          h('h1', { className: 'tb-title' }, 'Tasks'),
          h('span', { className: 'tb-count', title: `${tasks.length} tasks` }, String(tasks.length)),
          h('select', { className: 'tb-select', value: workspaceId === undefined ? '' : String(workspaceId), onChange: (event) => chooseWorkspace(event.target.value), 'aria-label': 'Workspace' },
            workspaceId === undefined ? h('option', { value: '' }, 'Select workspace') : null,
            workspaces.map((workspace) => h('option', { value: String(workspace.workspaceId), key: String(workspace.workspaceId) }, workspace.title || workspace.path)),
          ),
          h('span', { className: 'tb-spacer' }),
          h('button', { type: 'button', className: 'tb-btn', onClick: reload, title: 'Reload the ledger' }, 'Reload'),
          h('button', { type: 'button', className: 'tb-btn primary', onClick: () => { create().catch(() => {}) }, disabled: busy || !canEdit, title: canEdit ? 'Create a task' : 'Open a live conversation to create a task' }, '+ New task'),
        ),
        !canEdit ? h('div', { className: 'tb-readonly', role: 'status', 'aria-live': 'polite' }, hasSession ? 'Read-only — open a live conversation to edit this board.' : 'Open a live conversation to edit this board.') : null,
        !detailOpen && error ? h('div', { className: 'tb-global-error', role: 'alert' }, error) : null,
        h('div', { className: 'tb-roster', role: 'group', 'aria-label': 'Subagents in this workspace' },
          h('span', { className: 'tb-rlabel' }, 'Subagents'),
          h('span', { className: 'tb-rstat' }, h('b', null, String(rosterCounts.total))),
          h('span', { className: 'tb-rsep', 'aria-hidden': true }, '·'),
          h('span', { className: 'tb-rstat' }, h('b', null, String(rosterCounts.active)), ' active'),
          h('span', { className: 'tb-rsep', 'aria-hidden': true }, '·'),
          h('span', { className: 'tb-rstat' }, h('b', null, String(rosterCounts.sleeping)), ' sleeping'),
          rosterCounts.paused > 0 || rosterCounts.linked > 0 ? h('span', { className: 'tb-rsep', 'aria-hidden': true }, '·') : null,
          rosterCounts.paused > 0 ? h('span', { className: 'tb-rstat' }, h('b', null, String(rosterCounts.paused)), ' paused') : null,
          rosterCounts.linked > 0 ? h('span', { className: 'tb-rstat' }, h('b', null, String(rosterCounts.linked)), ' linked') : null,
          h('span', { className: 'tb-rsep', 'aria-hidden': true }, '·'),
          h('span', { className: 'tb-rlabel' }, 'Roles'),
          roles.length === 0
            ? h('span', { className: 'tb-rnone' }, 'none linked')
            : h('div', { className: 'tb-rroles' }, roles.map(({ role, count }) => h('span', { className: 'tb-rrole', key: role }, role, ' ', h('b', null, String(count))))),
        ),
        h('div', { className: `tb-body${detailOpen ? '' : ' solo'}` },
          h('div', { className: 'tb-board', ref: boardRef, role: 'region', 'aria-label': 'Task board' },
            COLUMNS.map((column) => {
              const items = tasks.filter((task) => task.status === column.id)
              return h('div', { className: 'tb-col', key: column.id },
                h('h3', null, column.label, h('span', { className: 'n' }, String(items.length))),
                items.length === 0 ? h('div', { className: 'tb-empty', style: { padding: '8px 4px', fontSize: '11px' } }, '—') : items.map((task) => h(TaskCard, { key: task.id, task, selected: task.id === selectedId, onSelect: selectTask })),
              )
            }),
          ),
          detailOpen ? h('aside', { className: 'tb-detail', id: 'tb-detail-pane' },
            selected === null
              ? h('div', null,
                error ? h('div', { className: 'tb-banner' }, error) : null,
                h('div', { className: 'tb-empty' },
                  hasSession ? tasks.length === 0 ? 'No tasks yet. The orchestrator creates them with task_create or delegate_task; you can start one here.' : 'Select a task to see its scope, results and timeline.' : 'Open a live conversation to load and edit this board.',
                ),
              )
              : h(TaskDetail, { key: selected.id, task: selected, busy, error, canEdit, onHide: () => setDetailOpen(false), onSave: save, onNote: note, onOpenSession: (id) => uiWorkspace.openSession(id), onAction: action, onRefresh: reload }),
          ) : null,
        ),
      )
    }

    return {
      inject: ['slots', 'remote', 'remote.workspaceFiles', 'remote.commands', 'uiWorkspace', 'layout'],
      apply(ctx) {
        const store = createStore({ sessionId: null, workspaceTitle: null })
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          inject: () => ({ remote: ctx.remote, store, uiWorkspace: ctx.uiWorkspace }),
        }, TasksPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => 'Tasks',
          inject: () => ({ layout: ctx.layout }),
        }, PanelIcon))
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'subagent-catalog',
          order: 10,
          inject: (sessionId) => ({ remote: ctx.remote, store, layout: ctx.layout, sessionId }),
        }, TasksTrigger))
      },
    }
  },
})
