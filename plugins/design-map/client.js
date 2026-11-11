/**
 * Design map panel: the human's side of `design.excalidraw`.
 *
 * The editor itself is a real Excalidraw bundle vendored as a package-local chunk and
 * placed in an iframe srcdoc. The frame cannot touch the filesystem, so this panel is
 * the bridge: it reads the scene through `workspaceFiles`, forwards every human edit to
 * the host's `/design-map` command, and pushes an externally changed scene back into the
 * frame. Nothing here is generated except the iframe document shell; the scene bytes on
 * disk are exactly what Excalidraw sent.
 */
window.__ModuleLoader__.load({
  id: '@cc/dsh-design-map',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React

    const PANEL_ID = 'design-map'
    const PKG = '@cc/dsh-design-map'
    const FILE = 'design.excalidraw'
    const MAX_BYTES = 4 * 1024 * 1024

    const CSS = `
.dm-root{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.dm-root *{box-sizing:border-box}
.dm-top{display:flex;align-items:center;gap:9px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;min-height:44px;flex-wrap:wrap}
.dm-title{font-size:15px;font-weight:700;margin:0;letter-spacing:-.01em}
.dm-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dm-chip{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 7px;font-size:10px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 6%,transparent);white-space:nowrap}
.dm-chip.warn{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent)}
.dm-chip.ok{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 9%,transparent)}
.dm-spacer{flex:1}
.dm-btn{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:7px;padding:5px 9px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
.dm-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.dm-btn.primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted,#fff)}
.dm-btn:disabled{opacity:.55;cursor:not-allowed}
.dm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dm-body{flex:1;min-height:0;position:relative;background:#fff}
.dm-frame{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:#fff}
.dm-status{display:flex;align-items:center;gap:8px;padding:5px 12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:10.5px;color:var(--dsw-alias-label-secondary);flex:none;flex-wrap:wrap;min-height:28px}
.dm-status .dm-spacer{flex:1}
.dm-error{color:var(--dsw-alias-state-error-primary);font-weight:600;overflow-wrap:anywhere}
.dm-note{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dm-empty{padding:28px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px}
.dm-trigger{display:inline-flex;align-items:center;gap:4px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary);border-radius:7px;padding:3px 7px;font:inherit;font-size:11.5px;font-weight:600;cursor:pointer;height:26px}
.dm-trigger:hover{background:var(--dsw-alias-bg-layer-1)}
.dm-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dm-trigger-label{white-space:nowrap}
.dm-back{display:inline-flex;align-items:center;justify-content:center;padding:4px 6px}
`

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
        set(patch) { state = { ...state, ...patch }; for (const listener of listeners) listener() },
      }
    }

    function sessionIdsOf(workspace) {
      return Array.isArray(workspace?.sessionIds) ? workspace.sessionIds.filter((id) => typeof id === 'string' && id !== '') : []
    }

    function isLiveSession(sessionsById, id) {
      return typeof id === 'string' && id !== '' && (sessionsById?.[id]?.retainedBy?.mainView ?? 0) > 0
    }

    function pickWorkspaceSession(workspace, sessionsById, preferred) {
      const ids = sessionIdsOf(workspace)
      if (ids.length === 0) return null
      if (typeof preferred === 'string' && ids.includes(preferred) && isLiveSession(sessionsById, preferred)) return preferred
      const live = ids.find((id) => isLiveSession(sessionsById, id))
      if (live !== undefined) return live
      if (typeof preferred === 'string' && ids.includes(preferred)) return preferred
      return ids[0]
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

    /** Read the scene text; a missing file is an empty map, not an error. */
    async function readSceneText(remote, sessionId, signal) {
      if (typeof sessionId !== 'string' || sessionId === '') return { text: null }
      let offset = 1
      let text = ''
      for (let page = 0; page < 200; page += 1) {
        const result = await remote.workspaceFiles.read(sessionId, FILE, { offset, limit: 2000 }, signal)
        if (!result.ok) {
          const message = `${result.error?.code ?? ''} ${result.error?.message ?? ''}`.toLowerCase()
          if (message.includes('enoent') || message.includes('no such file') || message.includes('not found') || message.includes('no entry')) return { text: null }
          return { error: result.error?.message ?? result.error?.code ?? 'read failed' }
        }
        if (result.value === null || result.value === undefined) return { error: 'read returned no value' }
        text += result.value.text
        if (text.length > MAX_BYTES) return { error: `map is larger than ${MAX_BYTES} bytes` }
        if (result.value.eof) return { text }
        if (result.value.lines === 0) return { error: 'map is too large to read' }
        offset = result.value.offset + result.value.lines
        text += '\n'
      }
      return { error: 'map is too large to read' }
    }

    async function runOp(remote, sessionId, op) {
      if (remote?.commands === undefined || typeof remote.commands.execute !== 'function') return { ok: false, error: 'The design-map command is unavailable in this view.' }
      const result = await remote.commands.execute(sessionId, `/design-map ${JSON.stringify(op)}`, [])
      if (result === null || result === undefined || !result.ok) return { ok: false, error: result?.error?.message ?? result?.error?.code ?? 'command failed' }
      const outcome = result.value?.result
      if (outcome?.kind === 'error') return { ok: false, error: outcome.text ?? 'command failed' }
      if (outcome?.kind !== 'success') return { ok: false, error: 'The design-map command returned an unexpected result.' }
      return { ok: true, text: outcome.text ?? '' }
    }

    /** The vendored frame, addressed through the module system's own revisioned URL. */
    async function loadFrameSource() {
      const entry = (globalThis.__DSH_BOOT__?.entries ?? []).find((row) => row?.id === PKG)
      if (entry === undefined || typeof entry.url !== 'string') throw new Error('the design-map client entry is not in the boot graph')
      const rev = new URL(entry.url, location.href).searchParams.get('rev')
      if (rev === null) throw new Error('the design-map client entry has no revision')
      // A RELATIVE `plugins/...` resolves against the DOCUMENT, so a page served below the
      // root (or under a path prefix) asked for the wrong file and the panel showed "frame
      // bundle HTTP 404". The module route is app-absolute.
      const response = await fetch(`/plugins/${PKG}/client.frame.js?rev=${encodeURIComponent(rev)}`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`frame bundle HTTP ${response.status}`)
      return response.text()
    }

    function frameDocument(script) {
      // A bundle that contains "</script" would close the inline script early; the escape
      // is inert JavaScript and keeps the HTML parser inside the element.
      const safe = script.replaceAll('</script', '<\\/script')
      return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0;overflow:hidden}body{font-family:system-ui,sans-serif}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
    }

    function shortAge(value) {
      if (typeof value !== 'string' || value === '') return 'never'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value
      const minutes = Math.round((Date.now() - date.getTime()) / 60000)
      if (minutes < 1) return 'just now'
      if (minutes < 60) return `${minutes}m ago`
      if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`
      return `${Math.round(minutes / 1440)}d ago`
    }

    function Icon({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 3.5, y: 4.5, width: 7, height: 6, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('rect', { x: 13.5, y: 13.5, width: 7, height: 6, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M10.5 7.5h3a3 3 0 0 1 3 3v3', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      )
    }

    function BackIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M14.5 5.5 8 12l6.5 6.5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function HeaderTrigger({ layout, store, useSessions }) {
      const sessionsRaw = useSessions((snapshot) => snapshot.byId)
      const sessionsById = sessionsRaw !== null && typeof sessionsRaw === 'object' ? sessionsRaw : {}
      const open = () => {
        const main = Object.values(sessionsById).find((session) => (session?.retainedBy?.mainView ?? 0) > 0)
        store.set(typeof main?.id === 'string' ? { sessionId: main.id } : {})
        layout.selectPanel(PANEL_ID)
      }
      return h(React.Fragment, null,
        h('style', null, CSS),
        h('button', { type: 'button', className: 'dm-trigger', onClick: open, title: 'Design map', 'aria-label': 'Open the design map' },
          h(Icon, { size: 14 }),
          h('span', { className: 'dm-trigger-label' }, 'Design map'),
        ),
      )
    }

    function DesignMapPage({ remote, store, layout, useWorkspaces, useSessions }) {
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      const workspacesRaw = useWorkspaces((snapshot) => snapshot.items)
      const workspaces = Array.isArray(workspacesRaw) ? workspacesRaw : []
      const sessionsRaw = useSessions((snapshot) => snapshot.byId)
      const sessionsById = sessionsRaw !== null && typeof sessionsRaw === 'object' ? sessionsRaw : {}
      const sessionId = state.sessionId ?? firstSession(workspaces, sessionsById)?.sessionId ?? null
      const hasSession = typeof sessionId === 'string' && sessionId !== ''
      const canEdit = isLiveSession(sessionsById, sessionId)

      const [scene, setScene] = useState(null)
      const [meta, setMeta] = useState(null)
      const [frameReady, setFrameReady] = useState(false)
      const frameReadyRef = useRef(false)
      const frameLoadedRef = useRef(false)
      const [frameDoc, setFrameDoc] = useState(null)
      const [frameError, setFrameError] = useState('')
      const [error, setError] = useState('')
      const [saving, setSaving] = useState(false)
      const [dirty, setDirty] = useState(false)
      const [bytes, setBytes] = useState(0)
      const iframeRef = useRef(null)
      const sceneRef = useRef(null)
      const metaRef = useRef(null)
      const saveTimer = useRef(null)
      const readController = useRef(null)

      const post = useCallback((message) => {
        const win = iframeRef.current?.contentWindow
        if (!win) return
        win.postMessage({ source: 'design-map-panel', ...message }, '*')
      }, [])

      const applyMeta = useCallback((next) => {
        metaRef.current = next
        setMeta(next)
      }, [])

      /** Load the file into React state and, when the frame is alive, into the canvas. */
      const reload = useCallback(async () => {
        if (!hasSession) return
        readController.current?.abort()
        const controller = new AbortController()
        readController.current = controller
        try {
          const result = await readSceneText(remote, sessionId, controller.signal)
          if (controller.signal.aborted) return
          if (result.error) { setError(result.error); return }
          setError('')
          if (result.text === null) { sceneRef.current = null; setScene(null); setMeta(null); setBytes(0); return }
          let parsed
          try {
            parsed = JSON.parse(result.text)
          } catch (failure) {
            setError(`design.excalidraw is not valid JSON: ${failure.message}`)
            return
          }
          const nextScene = {
            elements: Array.isArray(parsed.elements) ? parsed.elements : [],
            appState: parsed.appState !== null && typeof parsed.appState === 'object' ? parsed.appState : {},
            files: parsed.files !== null && typeof parsed.files === 'object' ? parsed.files : {},
          }
          const nextMeta = parsed.designMap !== null && typeof parsed.designMap === 'object' ? parsed.designMap : { rev: 0, updatedAt: null, updatedBy: null }
          sceneRef.current = nextScene
          setScene(nextScene)
          applyMeta(nextMeta)
          setBytes(new TextEncoder().encode(result.text).length)
          if (frameReadyRef.current) post({ type: 'load', scene: nextScene })
        } catch (failure) {
          if (!controller.signal.aborted) setError(failure?.message ?? 'read failed')
        }
      }, [remote, sessionId, hasSession, frameReady, post, applyMeta])

      // The frame bundle is fetched once per page: it is a 3.4 MB package-local chunk.
      useEffect(() => {
        let cancelled = false
        loadFrameSource()
          .then((script) => { if (!cancelled) setFrameDoc(frameDocument(script)) })
          .catch((failure) => { if (!cancelled) setFrameError(failure?.message ?? 'frame failed to load') })
        return () => { cancelled = true }
      }, [])

      useEffect(() => { reload().catch((failure) => setError(failure?.message ?? 'read failed')) }, [reload])

      // An agent write must appear without a manual reload. The frame is only replaced
      // when the panel has no unsaved change, so an external update never eats a drag.
      useEffect(() => {
        if (!hasSession) return undefined
        const timer = setInterval(() => {
          if (saving || dirty) return
          readSceneText(remote, sessionId)
            .then((result) => {
              if (result.error || result.text === null) return
              try {
                const parsed = JSON.parse(result.text)
                const next = parsed.designMap ?? {}
                const current = metaRef.current
                if (current !== null && next.rev === current.rev) return
                sceneRef.current = { elements: parsed.elements ?? [], appState: parsed.appState ?? {}, files: parsed.files ?? {} }
                setScene(sceneRef.current)
                applyMeta(next)
                setBytes(new TextEncoder().encode(result.text).length)
                if (frameReady) post({ type: 'load', scene: sceneRef.current })
              } catch { /* a broken file is reported by the explicit reload */ }
            })
            .catch(() => {})
        }, 3500)
        return () => clearInterval(timer)
      }, [remote, sessionId, hasSession, saving, dirty, frameReady, post, applyMeta])

      const saveNow = useCallback(async (payload) => {
        const pending = payload ?? sceneRef.current
        if (pending === null || !hasSession || !canEdit) return
        setSaving(true)
        try {
          // The host refuses a whole-scene save over a non-empty map without the rev it read
          // (needs_rev / stale), so an outdated panel cannot overwrite a newer map.
          const result = await runOp(remote, sessionId, {
            op: 'save',
            rev: Number.isSafeInteger(metaRef.current?.rev) ? metaRef.current.rev : 0,
            elements: pending.elements ?? [],
            appState: pending.appState ?? {},
            files: pending.files ?? {},
          })
          if (!result.ok) { setError(result.error); return }
          let summary = null
          try { summary = JSON.parse(result.text) } catch { /* the next read is the truth */ }
          if (summary !== null) {
            applyMeta({ rev: summary.rev, updatedAt: summary.updatedAt, updatedBy: summary.updatedBy, title: summary.title })
            setBytes(new TextEncoder().encode(JSON.stringify(pending)).length)
            setDirty(false)
            setError('')
            post({ type: 'saved', rev: summary.rev, updatedAt: summary.updatedAt })
          }
        } catch (failure) {
          setError(failure?.message ?? 'save failed')
        } finally {
          setSaving(false)
        }
      }, [remote, sessionId, hasSession, canEdit, post, applyMeta])

      // Bridge: the frame reports a human edit; the panel debounces a host save.
      useEffect(() => {
        const onMessage = (event) => {
          if (event.source !== iframeRef.current?.contentWindow) return
          const data = event.data
          if (data === null || typeof data !== 'object' || data.source !== 'design-map-frame') return
          if (data.type === 'ready') {
            frameReadyRef.current = true
            setFrameReady(true)
            const current = sceneRef.current
            if (current !== null) post({ type: 'load', scene: current })
          }
          if (data.type === 'loaded') frameLoadedRef.current = true
          if (data.type === 'change') {
            // A change that arrives before a scene was loaded is the empty canvas
            // reporting itself; saving it would delete the file.
            if (!frameLoadedRef.current) return
            sceneRef.current = { elements: data.elements ?? [], appState: data.appState ?? {}, files: {} }
            setScene(sceneRef.current)
            setDirty(true)
            clearTimeout(saveTimer.current)
            saveTimer.current = setTimeout(() => { saveNow(sceneRef.current).catch(() => {}) }, 350)
          }
        }
        window.addEventListener('message', onMessage)
        return () => { window.removeEventListener('message', onMessage); clearTimeout(saveTimer.current) }
      }, [post, saveNow])

      const rev = meta?.rev ?? 0
      const stale = meta?.updatedAt === null || meta?.updatedAt === undefined ? null : Date.now() - Date.parse(meta.updatedAt) > 24 * 60 * 60 * 1000
      const saveLabel = saving ? 'Saving…' : dirty ? 'Save now' : 'Saved'
      return h('div', { className: 'dm-root' },
        h('style', null, CSS),
        h('div', { className: 'dm-top' },
          h('button', { type: 'button', className: 'dm-btn dm-back', onClick: () => layout.selectPanel(null), title: 'Back to chat', 'aria-label': 'Back to chat' }, h(BackIcon, { size: 16 })),
          h('h1', { className: 'dm-title' }, 'Design map'),
          h('span', { className: 'dm-chip', title: 'Excalidraw scene at the project root' }, FILE),
          h('span', { className: 'dm-meta' },
            h('span', { className: 'dm-chip' }, `rev ${rev}`),
            h('span', { className: 'dm-chip' }, meta?.updatedBy === 'human' ? 'edited by human' : meta?.updatedBy === 'agent' ? 'edited by agent' : 'not written yet'),
            meta?.updatedAt ? h('span', { className: 'dm-chip', title: meta.updatedAt }, shortAge(meta.updatedAt)) : null,
            stale === true ? h('span', { className: 'dm-chip warn' }, 'stale — ask the agent to refresh') : null,
          ),
          h('span', { className: 'dm-spacer' }),
          h('button', { type: 'button', className: 'dm-btn', onClick: () => { reload().catch(() => {}) }, title: 'Re-read design.excalidraw and replace the canvas' }, 'Reload'),
          h('button', { type: 'button', className: 'dm-btn primary', onClick: () => { saveNow().catch(() => {}) }, disabled: !dirty || saving || !canEdit, title: canEdit ? 'Write the current canvas to design.excalidraw' : 'Open a live conversation to save' }, saveLabel),
        ),
        h('div', { className: 'dm-body' },
          frameDoc === null
            ? h('div', { className: 'dm-empty' }, frameError !== '' ? h('span', { className: 'dm-error' }, `The editor frame could not load: ${frameError}`) : 'Loading the Excalidraw editor…')
            : h('iframe', {
              ref: iframeRef,
              className: 'dm-frame',
              title: 'Design map editor',
              sandbox: 'allow-scripts',
              srcDoc: frameDoc,
              onLoad: () => { frameReadyRef.current = false; frameLoadedRef.current = false; setFrameReady(false) },
            }),
        ),
        h('div', { className: 'dm-status' },
          h('span', null, hasSession ? (canEdit ? `Chat ${sessionId.slice(0, 12)}…` : 'Read-only: open a live conversation to edit') : 'Open a conversation to load the map'),
          h('span', { className: 'dm-spacer' }),
          error !== '' ? h('span', { className: 'dm-error' }, error) : h('span', { className: 'dm-note' }, dirty ? 'Unsaved canvas changes — saving…' : `Saved scene · ${bytes} bytes · ${scene?.elements?.length ?? 0} elements`),
        ),
      )
    }

    return {
      inject: ['slots', 'remote', 'remote.workspaceFiles', 'remote.commands', 'layout'],
      apply(ctx) {
        const store = createStore({ sessionId: null })
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          inject: () => ({ remote: ctx.remote, store, layout: ctx.layout }),
        }, DesignMapPage))
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: PANEL_ID,
          order: 20,
          inject: () => ({ layout: ctx.layout, store }),
        }, HeaderTrigger))
      },
    }
  },
})
