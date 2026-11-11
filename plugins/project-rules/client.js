/**
 * Rules panel: the human editor for `.dsh/rules.md`.
 *
 * Typing is local React state. Nothing reaches the host until Save, and Save calls the
 * `/project-rules` command, which only writes the file. The prompt section re-reads the
 * file at the next turn's boundary and keeps the previous string when the bytes are
 * unchanged, so this panel is cache-safe by construction: an open editor, a dirty draft
 * and even a save cannot touch the prompt of a turn already in flight.
 */
window.__ModuleLoader__.load({
  id: '@cc/dsh-project-rules',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React

    const PANEL_ID = 'project-rules'
    const FILE = '.dsh/rules.md'
    const MAX_BYTES = 32 * 1024

    const CSS = `
.pr-root{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.pr-root *{box-sizing:border-box}
.pr-top{display:flex;align-items:center;gap:9px;padding:9px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;min-height:46px;flex-wrap:wrap}
.pr-title{font-size:15px;font-weight:700;margin:0;letter-spacing:-.01em}
.pr-file{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 8px}
.pr-chip{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 7px;font-size:10px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 6%,transparent);white-space:nowrap;font-variant-numeric:tabular-nums}
.pr-chip.warn{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent)}
.pr-chip.ok{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 9%,transparent)}
.pr-spacer{flex:1}
.pr-btn{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:7px;padding:5px 9px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
.pr-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.pr-btn.primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted,#fff)}
.pr-btn:disabled{opacity:.55;cursor:not-allowed}
.pr-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.pr-body{flex:1;min-height:0;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.pr-area{flex:1;min-height:0;width:100%;resize:none;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:12px 14px;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:2}
.pr-area:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:0;border-color:transparent}
.pr-hint{font-size:10.5px;color:var(--dsw-alias-label-secondary);display:flex;gap:10px;flex-wrap:wrap;min-height:15px}
.pr-error{color:var(--dsw-alias-state-error-primary);font-weight:600;overflow-wrap:anywhere}
.pr-note{color:var(--dsw-alias-label-secondary)}
.pr-trigger{display:inline-flex;align-items:center;gap:4px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary);border-radius:7px;padding:3px 7px;font:inherit;font-size:11.5px;font-weight:600;cursor:pointer;height:26px}
.pr-trigger:hover{background:var(--dsw-alias-bg-layer-1)}
.pr-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.pr-trigger-label{white-space:nowrap}
.pr-back{display:inline-flex;align-items:center;justify-content:center;padding:4px 6px}
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

    /**
     * Read the rules file BYTE-EXACTLY through the command's `raw` op.
     *
     * WHY NOT `workspaceFiles.read`. That API is line-based: it splits on "\n" and joins
     * with "\n", so the final newline of a newline-terminated file belongs to no line and
     * never arrives. A panel that loaded 103 bytes of a 104-byte file and saved its draft
     * wrote 103 bytes back - a silent one-byte change on every untouched save. `raw` returns
     * the host's bytes in base64; the byte count is the host's count.
     *
     * @returns `{ text, bytes }`, `{ text: null }` for a missing file, or `{ error }`.
     */
    async function readRulesRaw(remote, sessionId, signal) {
      const result = await runOp(remote, sessionId, { op: 'raw' })
      if (!result.ok) return { error: result.error }
      let payload
      try { payload = JSON.parse(result.text) } catch { return { error: 'the raw read returned no bytes' } }
      if (payload === null || typeof payload !== 'object' || typeof payload.base64 !== 'string') return { error: 'the raw read returned no bytes' }
      try {
        const bytes = Uint8Array.from(atob(payload.base64), (character) => character.charCodeAt(0))
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bytes: Number.isSafeInteger(payload.bytes) ? payload.bytes : bytes.length }
      } catch (error) {
        return { error: `the rules file is not valid UTF-8: ${error instanceof Error ? error.message : String(error)}` }
      }
    }

    /** Read the rules text; a missing file is an empty document, not an error. */
    async function readRules(remote, sessionId, signal) {
      if (typeof sessionId !== 'string' || sessionId === '') return { text: null }
      const raw = await readRulesRaw(remote, sessionId, signal).catch((error) => ({ error: error?.message ?? 'raw read failed' }))
      // An older host has no `raw` op; the line-based read is wrong by one byte on a
      // newline-terminated file, but it is better than showing nothing.
      if (raw.error === undefined) return raw
      try { console.warn(`project-rules: the byte-exact read failed (${raw.error}); falling back to the line-based read, which drops a trailing newline`) } catch { /* a logger that cannot log must not break the panel */ }
      let offset = 1
      let text = ''
      for (let page = 0; page < 60; page += 1) {
        const result = await remote.workspaceFiles.read(sessionId, FILE, { offset, limit: 2000 }, signal)
        if (!result.ok) {
          const message = `${result.error?.code ?? ''} ${result.error?.message ?? ''}`.toLowerCase()
          if (message.includes('enoent') || message.includes('no such file') || message.includes('not found') || message.includes('no entry')) return { text: null }
          return { error: result.error?.message ?? result.error?.code ?? 'read failed' }
        }
        if (result.value === null || result.value === undefined) return { error: 'read returned no value' }
        text += result.value.text
        if (result.value.eof) return { text }
        if (result.value.lines === 0) return { error: 'rules file is too large to read' }
        offset = result.value.offset + result.value.lines
        text += '\n'
      }
      return { error: 'rules file is too large to read' }
    }

    async function runOp(remote, sessionId, op) {
      if (remote?.commands === undefined || typeof remote.commands.execute !== 'function') return { ok: false, error: 'The project-rules command is unavailable in this view.' }
      const result = await remote.commands.execute(sessionId, `/project-rules ${JSON.stringify(op)}`, [])
      if (result === null || result === undefined || !result.ok) return { ok: false, error: result?.error?.message ?? result?.error?.code ?? 'command failed' }
      const outcome = result.value?.result
      if (outcome?.kind === 'error') return { ok: false, error: outcome.text ?? 'command failed' }
      if (outcome?.kind !== 'success') return { ok: false, error: 'The project-rules command returned an unexpected result.' }
      return { ok: true, text: outcome.text ?? '' }
    }

    function byteLength(text) {
      return new TextEncoder().encode(text).length
    }

    function Icon({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M7 4.5h7l4 4v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        h('path', { d: 'M13.5 4.8V9h4.2M9 12.5h6M9 15.5h6', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
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
        h('button', { type: 'button', className: 'pr-trigger', onClick: open, title: 'Project rules', 'aria-label': 'Open the project rules editor' },
          h(Icon, { size: 14 }),
          h('span', { className: 'pr-trigger-label' }, 'Rules'),
        ),
      )
    }

    function RulesPage({ remote, store, layout, useWorkspaces, useSessions }) {
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      const workspacesRaw = useWorkspaces((snapshot) => snapshot.items)
      const workspaces = Array.isArray(workspacesRaw) ? workspacesRaw : []
      const sessionsRaw = useSessions((snapshot) => snapshot.byId)
      const sessionsById = sessionsRaw !== null && typeof sessionsRaw === 'object' ? sessionsRaw : {}
      const sessionId = state.sessionId ?? firstSession(workspaces, sessionsById)?.sessionId ?? null
      const hasSession = typeof sessionId === 'string' && sessionId !== ''
      const canEdit = isLiveSession(sessionsById, sessionId)

      const [draft, setDraft] = useState('')
      // The size the HOST reported for the loaded file; `draft` differs from it only when the
      // human typed, so a one-byte difference is visible instead of silent.
      const [loadedBytes, setLoadedBytes] = useState(null)
      const [loaded, setLoaded] = useState(null)
      const [error, setError] = useState('')
      const [status, setStatus] = useState('')
      const [saving, setSaving] = useState(false)
      const [loading, setLoading] = useState(false)
      const controller = useRef(null)

      const dirty = loaded !== null && draft !== loaded
      const bytes = byteLength(draft)
      const fileBytes = Number.isSafeInteger(loadedBytes) ? loadedBytes : null
      const overLimit = bytes > MAX_BYTES

      const reload = useCallback(async () => {
        if (!hasSession) return
        controller.current?.abort()
        const next = new AbortController()
        controller.current = next
        setLoading(true)
        try {
          const result = await readRules(remote, sessionId, next.signal)
          if (next.signal.aborted) return
          if (result.error) { setError(result.error); return }
          setError('')
          if (result.text === null) { setDraft(''); setLoaded(''); setStatus('No rules yet — the section is empty until you save this file.') }
          else {
            setDraft(result.text)
            setLoaded(result.text)
            // The counter is the HOST's byte count, not a re-encoding of the textarea.
            const size = Number.isSafeInteger(result.bytes) ? result.bytes : byteLength(result.text)
            setStatus(`Loaded ${size} bytes.`)
            setLoadedBytes(size)
          }
        } catch (failure) {
          if (!next.signal.aborted) setError(failure?.message ?? 'read failed')
        } finally {
          if (!next.signal.aborted) setLoading(false)
        }
      }, [remote, sessionId, hasSession])

      useEffect(() => { reload().catch((failure) => setError(failure?.message ?? 'read failed')) }, [reload])

      const save = useCallback(async () => {
        if (!hasSession || !canEdit || overLimit) return
        setSaving(true)
        try {
          const result = await runOp(remote, sessionId, { op: 'save', text: draft })
          if (!result.ok) { setError(result.error); return }
          let payload = null
          try { payload = JSON.parse(result.text) } catch { /* the re-read is the truth */ }
          setLoaded(draft)
          setError('')
          if (payload !== null && Number.isSafeInteger(payload.bytes)) {
            setStatus(`Saved ${payload.bytes} bytes exactly as typed. The next turn picks them up.`)
            setLoadedBytes(payload.bytes)
          }
          else setStatus('Saved. The next turn picks up the new rules.')
        } catch (failure) {
          setError(failure?.message ?? 'save failed')
        } finally {
          setSaving(false)
        }
      }, [remote, sessionId, hasSession, canEdit, draft, overLimit])

      const hint = !hasSession
        ? 'Open a conversation to load the rules file.'
        : !canEdit
          ? 'Read-only: open a live conversation to edit the rules.'
          : overLimit
            ? `Too large: ${bytes} / ${MAX_BYTES} bytes.`
            : dirty
              ? `Unsaved changes — ${bytes} bytes on screen. Nothing reaches the model until Save.`
              : status || 'Saved file is unchanged.'
      const saveLabel = saving ? 'Saving…' : overLimit ? 'Too large' : dirty ? 'Save changes' : 'Saved'
      return h('div', { className: 'pr-root' },
        h('style', null, CSS),
        h('div', { className: 'pr-top' },
          h('button', { type: 'button', className: 'pr-btn pr-back', onClick: () => layout.selectPanel(null), title: 'Back to chat', 'aria-label': 'Back to chat' }, h(BackIcon, { size: 16 })),
          h('h1', { className: 'pr-title' }, 'Project rules'),
          h('span', { className: 'pr-file' }, FILE),
          h('span', { className: `pr-chip ${dirty ? 'warn' : 'ok'}` }, dirty ? 'dirty' : 'saved'),
          h('span', { className: 'pr-chip', title: fileBytes === null ? 'bytes in the editor' : `${fileBytes} bytes in the file` }, fileBytes !== null && fileBytes !== bytes ? `${bytes} bytes · file ${fileBytes}` : `${bytes} bytes`),
          h('span', { className: 'pr-spacer' }),
          h('button', { type: 'button', className: 'pr-btn', onClick: () => { reload().catch(() => {}) }, disabled: loading || dirty, title: dirty ? 'Save or discard the draft before reloading' : 'Re-read .dsh/rules.md' }, loading ? 'Loading…' : 'Reload'),
          h('button', { type: 'button', className: 'pr-btn primary', onClick: () => { save().catch(() => {}) }, disabled: !dirty || saving || !canEdit || overLimit, title: canEdit ? 'Write exactly this text to .dsh/rules.md' : 'Open a live conversation to save' }, saveLabel),
        ),
        h('div', { className: 'pr-body' },
          h('textarea', {
            className: 'pr-area',
            value: draft,
            onChange: (event) => setDraft(event.target.value),
            spellCheck: false,
            readOnly: !canEdit,
            'aria-label': 'Workspace rules',
            placeholder: 'Workspace rules for every agent and subagent. Markdown is fine. The section is applied at the next turn boundary.',
            'aria-describedby': 'pr-hint',
          }),
          h('div', { className: 'pr-hint', id: 'pr-hint' },
            error !== '' ? h('span', { className: 'pr-error' }, error) : h('span', { className: 'pr-note' }, hint),
            h('span', { className: 'pr-spacer' }),
            h('span', { className: 'pr-note' }, canEdit ? (hasSession ? `Chat ${sessionId.slice(0, 12)}…` : '') : 'Read-only'),
          ),
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
        }, RulesPage))
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: PANEL_ID,
          order: 30,
          inject: () => ({ layout: ctx.layout, store }),
        }, HeaderTrigger))
      },
    }
  },
})
