/**
 * Test cases panel: the human's view of docs/cases/.
 *
 * The panel is a lens, not a second writer. Every read and write goes through the
 * host `/test-cases` command, which executes the same tools (and the same CAS
 * writer) the model uses. Nothing here touches the filesystem.
 */
window.__ModuleLoader__.load({
  id: '@cc/dsh-test-cases',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    const PANEL_ID = 'test-cases'
    const PKG = '@cc/dsh-test-cases'
    const STATUSES = ['unverified', 'verified', 'failing', 'stale', 'superseded', 'deprecated']
    const KINDS = ['regression', 'scenario']

    const CSS = `
.tc-root{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.tc-root *{box-sizing:border-box}
.tc-top{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;min-height:44px;flex-wrap:wrap}
.tc-title{font-size:15px;font-weight:700;margin:0;letter-spacing:-.01em}
.tc-tabs{display:inline-flex;align-items:center;gap:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:2px;background:var(--dsw-alias-bg-layer-1)}
.tc-tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:3px 9px;font:inherit;font-size:11.5px;font-weight:650;cursor:pointer;white-space:nowrap}
.tc-tab.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.tc-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.tc-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.tc-spacer{flex:1}
.tc-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:7px;padding:5px 9px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
.tc-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.tc-btn.primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted,#fff)}
.tc-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,var(--dsw-alias-border-l1))}
.tc-btn:disabled{opacity:.55;cursor:not-allowed}
.tc-btn:focus-visible,.tc-input:focus-visible,.tc-select:focus-visible,.tc-textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.tc-body{flex:1;min-height:0;display:flex;overflow:hidden}
.tc-list{width:390px;min-width:280px;border-right:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;min-height:0;transition:width .15s ease}
.tc-body.hide-detail .tc-list{width:100%;min-width:0;border-right:0}
.tc-filters{padding:10px 12px;display:grid;grid-template-columns:1fr 1fr;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.tc-filters .wide{grid-column:1/-1}
.tc-input,.tc-select,.tc-textarea{border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:5px 7px;min-width:0}
.tc-textarea{width:100%;resize:vertical;min-height:74px;line-height:1.45}
.tc-hint{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.tc-rows{flex:1;min-height:0;overflow:auto}
.tc-rowwrap{display:block;border-bottom:1px solid var(--dsw-alias-border-l1)}
.tc-row{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;font:inherit;padding:9px 12px;cursor:pointer}
.tc-row:hover{background:var(--dsw-alias-bg-layer-1)}
.tc-row[aria-current="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.tc-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.tc-rowtitle{font-size:12.5px;font-weight:650;line-height:1.3;margin-bottom:3px;overflow-wrap:anywhere}
.tc-rowmeta{font-size:10.5px;color:var(--dsw-alias-label-secondary);display:flex;gap:5px;flex-wrap:wrap}
.tc-badge{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 7px;font-size:10px;font-weight:600;white-space:nowrap}
.tc-badge.stale{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent)}
.tc-badge.verified{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,var(--dsw-alias-border-l1))}
.tc-badge.failing{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,var(--dsw-alias-border-l1))}
.tc-badge.muted{color:var(--dsw-alias-label-secondary)}
.tc-statuskey{font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin-right:4px}
.tc-statusrow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:4px 0 8px}
.tc-statustext{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.tc-confirm{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent);border-radius:8px;padding:12px;max-width:640px}
.tc-confirm h3{margin:0 0 6px;font-size:13px}
.tc-detail{flex:1;min-width:0;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;padding:14px 16px 28px}
.tc-empty{padding:24px 14px;color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center}
.tc-error{color:var(--dsw-alias-state-error-primary);font-weight:600;overflow-wrap:anywhere}
.tc-banner{border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 42%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent);color:var(--dsw-alias-state-warn-primary);border-radius:7px;padding:8px 10px;margin-bottom:12px;font-size:12px}
.tc-h2{font-size:16px;font-weight:750;margin:0 0 6px;line-height:1.25;overflow-wrap:anywhere}
.tc-h3{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-secondary);margin:16px 0 5px}
.tc-p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12.5px;color:var(--dsw-alias-label-primary)}
.tc-clamp{position:relative;max-height:170px;overflow:hidden}
.tc-clamp:after{content:"";position:absolute;left:0;right:0;bottom:0;height:44px;background:linear-gradient(transparent,var(--dsw-alias-bg-base))}
.tc-steps{margin:0;padding-left:20px;font-size:12.5px}
.tc-steps li{margin:2px 0;overflow-wrap:anywhere}
.tc-code{font:11.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 8px;overflow-wrap:anywhere;white-space:pre-wrap}
.tc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.tc-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.tc-card h4{margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--dsw-alias-label-secondary)}
.tc-scroll{max-height:220px;overflow:auto}
.tc-history{margin:0;padding:0;list-style:none;font-size:11.5px}
.tc-history li{padding:5px 0;border-bottom:1px solid var(--dsw-alias-border-l1);display:flex;gap:8px;flex-wrap:wrap}
.tc-form{display:grid;gap:9px;max-width:760px}
.tc-label{display:grid;gap:4px;font-size:11px;font-weight:650;color:var(--dsw-alias-label-secondary)}
.tc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.tc-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}
.tc-trigger{display:inline-flex;align-items:center;gap:4px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary);border-radius:7px;padding:3px 7px;font:inherit;font-size:11.5px;font-weight:600;cursor:pointer;height:26px}
.tc-trigger:hover{background:var(--dsw-alias-bg-layer-1)}
.tc-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.tc-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (max-width:760px){.tc-body{flex-direction:column}.tc-list{width:100%;min-width:0;max-height:46%;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.tc-body.hide-detail .tc-list{max-height:none;flex:1}.tc-detail{padding:12px;min-height:0}.tc-filters{grid-template-columns:1fr 1fr}.tc-top{gap:6px}}
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
    function pickSession(workspace, sessionsById) {
      const ids = sessionIdsOf(workspace)
      return ids.find((id) => isLiveSession(sessionsById, id)) ?? ids[0] ?? null
    }
    function firstSession(workspaces, sessionsById) {
      const candidates = (Array.isArray(workspaces) ? workspaces : [])
        .filter((workspace) => sessionIdsOf(workspace).length > 0)
        .slice()
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
      const workspace = candidates.find((entry) => sessionIdsOf(entry).some((id) => isLiveSession(sessionsById, id))) ?? candidates[0]
      return workspace === undefined ? null : { sessionId: pickSession(workspace, sessionsById), workspace }
    }
    async function runOp(remote, sessionId, op) {
      if (remote?.commands === undefined || typeof remote.commands.execute !== 'function') return { ok: false, error: 'The test-cases command is unavailable in this view.' }
      const result = await remote.commands.execute(sessionId, `/test-cases ${JSON.stringify(op)}`, [])
      if (result === null || result === undefined || !result.ok) return { ok: false, error: result?.error?.message ?? result?.error?.code ?? 'command failed' }
      const outcome = result.value?.result
      if (outcome?.kind === 'error') return { ok: false, error: outcome.text ?? 'command failed' }
      if (outcome?.kind !== 'success') return { ok: false, error: 'The test-cases command returned an unexpected result.' }
      try { return { ok: true, value: JSON.parse(outcome.text) } } catch { return { ok: false, error: 'The test-cases command returned invalid JSON.' } }
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
    const REMOVABLE = new Set(['deprecated', 'superseded'])
    const STATUS_MEANING = {
      unverified: 'Unverified — recorded but not yet proven.',
      verified: 'Verified — a run or observation is recorded.',
      failing: 'Failing — the last recorded run did not pass.',
      stale: 'Stale — a surface file or test changed; re-verify. The requirement still stands.',
      superseded: 'Superseded — replaced by a newer case.',
      deprecated: 'Deprecated — retired; it can be removed permanently.',
    }
    function statusClass(status) {
      if (status === 'verified') return 'verified'
      if (status === 'stale') return 'stale'
      if (status === 'failing') return 'failing'
      return 'muted'
    }
    function splitList(value) {
      return String(value ?? '').split(/[\n,]/).map((entry) => entry.trim()).filter((entry) => entry !== '')
    }
    function Icon({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 4, y: 3.5, width: 16, height: 17, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'm8 9 1.6 1.6L12 8M8 15l1.6 1.6L12 14', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M14 9h3M14 15h3', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      )
    }

    function StatusBadge({ status, detailed = false }) {
      const meaning = STATUS_MEANING[status] ?? status
      return h('span', { className: detailed ? 'tc-statusrow' : 'tc-rowmeta', 'data-status': status },
        h('span', { className: 'tc-statuskey' }, 'Status'),
        h('span', { className: `tc-badge ${statusClass(status)}`, title: meaning }, status),
        detailed ? h('span', { className: 'tc-statustext' }, meaning) : null,
      )
    }

    function Badges({ item, omitStatus = false }) {
      return h('span', { className: 'tc-rowmeta' },
        omitStatus ? null : h(StatusBadge, { status: item.status }),
        h('span', { className: 'tc-badge' }, item.kind),
        h('span', { className: 'tc-badge' }, item.source),
        h('span', { className: 'tc-badge' }, item.automated ? 'automated' : 'documented'),
        h('span', { title: item.lastVerified?.at ?? 'never verified' }, item.lastVerified ? `verified ${shortAge(item.lastVerified.at)}` : 'never verified'),
      )
    }

    function LongText({ text, label }) {
      const [expanded, setExpanded] = useState(false)
      if (typeof text !== 'string' || text === '') return h('p', { className: 'tc-hint' }, 'Not recorded.')
      return h('div', null,
        h('p', { className: `tc-p ${expanded ? '' : 'tc-clamp'}`, id: `tc-long-${label}` }, text),
        text.length > 260 ? h('button', { type: 'button', className: 'tc-btn', style: { marginTop: 6 }, 'aria-expanded': expanded, 'aria-controls': `tc-long-${label}`, onClick: () => setExpanded(!expanded) }, expanded ? 'Show less' : 'Show more') : null,
      )
    }

    function EvidenceCard({ title, value, tone }) {
      const evidence = value !== null && typeof value === 'object' ? value : null
      return h('div', { className: 'tc-card' },
        h('h4', null, title),
        evidence === null ? h('p', { className: 'tc-hint' }, 'Not recorded.') : h(React.Fragment, null,
          h('p', { className: 'tc-p' }, evidence.command ?? '—'),
          h('p', { className: 'tc-hint' }, `exit ${evidence.exitCode ?? '—'} · ${evidence.at ? shortAge(evidence.at) : 'time not recorded'}`),
          evidence.output ? h('pre', { className: 'tc-code', style: { maxHeight: 150, overflow: 'auto', marginTop: 6 }, tabIndex: 0 }, evidence.output) : null,
        ),
        tone ? null : null,
      )
    }

    function TestCasePage({ remote, store, layout, useWorkspaces, useSessions }) {
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      const workspacesRaw = useWorkspaces((snapshot) => snapshot.items)
      const workspaces = Array.isArray(workspacesRaw) ? workspacesRaw : []
      const sessionsRaw = useSessions((snapshot) => snapshot.byId)
      const sessionsById = sessionsRaw !== null && typeof sessionsRaw === 'object' ? sessionsRaw : {}
      const handoff = (() => { try { return sessionStorage.getItem('dsh:test-cases:session') } catch { return null } })()
      const sessionId = state.sessionId ?? (typeof handoff === 'string' && handoff !== '' ? handoff : firstSession(workspaces, sessionsById)?.sessionId) ?? null
      const hasSession = typeof sessionId === 'string' && sessionId !== ''
      // The host command is the authority. A session handed over from the Tasks tab can
      // execute host commands even when this global panel does not own a main-view handle.
      const canWrite = hasSession
      const [cases, setCases] = useState([])
      const [total, setTotal] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [selected, setSelected] = useState(null)
      const [detail, setDetail] = useState(null)
      const [view, setView] = useState('list')
      const [conflict, setConflict] = useState('')
      const [busy, setBusy] = useState(false)
      const [filters, setFilters] = useState({ status: '', kind: '', source: '', automated: '', tag: '', search: '' })
      const [form, setForm] = useState(null)
      const [verifyForm, setVerifyForm] = useState(null)
      const [deprecateReason, setDeprecateReason] = useState('')
      const [detailOpen, setDetailOpen] = useState(true)
      const [removeConfirmed, setRemoveConfirmed] = useState(false)
      const detailHeading = useRef(null)
      const detailPane = useRef(null)
      const selectedRef = useRef(null)
      selectedRef.current = selected

      const loadList = useCallback(async (activeFilters) => {
        if (!hasSession) { setLoading(false); return }
        setLoading(true); setError('')
        const op = { op: 'list' }
        if (activeFilters.status) op.status = activeFilters.status
        if (activeFilters.kind) op.kind = activeFilters.kind
        if (activeFilters.source) op.source = activeFilters.source
        if (activeFilters.automated !== '') op.automated = activeFilters.automated === 'true'
        if (activeFilters.tag) op.tag = activeFilters.tag
        const result = await runOp(remote, sessionId, op)
        if (!result.ok) { setError(result.error); setLoading(false); return }
        setCases(Array.isArray(result.value?.cases) ? result.value.cases : [])
        setTotal(result.value?.total ?? null)
        setLoading(false)
      }, [remote, sessionId, hasSession])

      useEffect(() => { loadList(filters).catch((failure) => { setError(failure?.message ?? 'load failed'); setLoading(false) }) }, [loadList, filters.status, filters.kind, filters.source, filters.automated, filters.tag])

      const loadDetail = useCallback(async (id) => {
        setError(''); setNotice('')
        const result = await runOp(remote, sessionId, { op: 'detail', id })
        if (!result.ok) { setError(result.error); return null }
        const record = result.value?.case ?? null
        setDetail(record); setSelected(id); setView('detail'); setConflict(''); setDetailOpen(true)
        return record
      }, [remote, sessionId])

      useEffect(() => {
        if (view === 'detail' && detailHeading.current) detailHeading.current.focus()
      }, [view])

      const visible = useMemo(() => {
        const search = filters.search.trim().toLowerCase()
        if (search === '') return cases
        return cases.filter((item) => `${item.id} ${item.title} ${(item.tags ?? []).join(' ')}`.toLowerCase().includes(search))
      }, [cases, filters.search])

      const beginEdit = () => {
        if (detail === null) return
        setForm({
          title: detail.title ?? '', requirement: detail.requirement ?? '', expected: detail.expected ?? '',
          steps: Array.isArray(detail.steps) ? detail.steps.join('\n') : '',
          tags: (detail.tags ?? []).join(', '), surfaceFiles: (detail.surfaceFiles ?? []).map((entry) => entry.path).join('\n'),
          automated: detail.automated === true, testPath: detail.testPath ?? '', runCommand: detail.runCommand ?? '', reason: detail.reason ?? '',
        })
        setConflict(''); setNotice(''); setView('edit')
      }
      const beginVerify = () => {
        if (detail === null) return
        setVerifyForm({ passed: true, command: detail.runCommand ?? '', output: '', exitCode: '0', redCommand: detail.runCommand ?? '', redOutput: '', redExitCode: '1', notes: '', commit: '' })
        setConflict(''); setNotice(''); setView('verify')
      }
      const saveEdit = async () => {
        if (form === null || detail === null) return
        setBusy(true); setError(''); setConflict('')
        const op = {
          op: 'update', id: detail.id, expectedRevision: detail.revision,
          title: form.title, requirement: form.requirement, expected: form.expected,
          steps: form.steps.split('\n').map((step) => step.trim()).filter((step) => step !== ''),
          tags: splitList(form.tags), surfaceFiles: splitList(form.surfaceFiles),
          automated: form.automated, testPath: form.testPath, runCommand: form.runCommand, reason: form.reason,
        }
        const result = await runOp(remote, sessionId, op)
        setBusy(false)
        if (!result.ok) {
          if (/REVISION_CONFLICT/.test(result.error)) setConflict(result.error)
          else setError(result.error)
          return
        }
        await loadDetail(detail.id); await loadList(filters)
        setNotice('Saved.')
      }
      const saveVerify = async () => {
        if (verifyForm === null || detail === null) return
        setBusy(true); setError(''); setConflict('')
        const evidence = { command: verifyForm.command, output: verifyForm.output, exitCode: Number(verifyForm.exitCode), at: new Date().toISOString() }
        const op = { op: 'verify', id: detail.id, expectedRevision: detail.revision, passed: verifyForm.passed, evidence, notes: verifyForm.notes || undefined }
        if (verifyForm.commit) op.commit = verifyForm.commit
        if (detail.automated === true) op.redFirst = { command: verifyForm.redCommand, output: verifyForm.redOutput, exitCode: Number(verifyForm.redExitCode), at: new Date().toISOString() }
        const result = await runOp(remote, sessionId, op)
        setBusy(false)
        if (!result.ok) {
          if (/REVISION_CONFLICT/.test(result.error)) setConflict(result.error)
          else setError(result.error)
          return
        }
        await loadDetail(detail.id); await loadList(filters)
        setNotice(verifyForm.passed ? 'Verification recorded.' : 'Failure recorded.')
      }
      const saveDeprecate = async () => {
        if (detail === null) return
        if (deprecateReason.trim() === '') { setError('A reason is required to deprecate a case.'); return }
        setBusy(true); setError(''); setConflict('')
        const result = await runOp(remote, sessionId, { op: 'deprecate', id: detail.id, expectedRevision: detail.revision, reason: deprecateReason.trim() })
        setBusy(false)
        if (!result.ok) {
          if (/REVISION_CONFLICT/.test(result.error)) setConflict(result.error)
          else setError(result.error)
          return
        }
        setDeprecateReason(''); await loadDetail(detail.id); await loadList(filters)
        setNotice('Case deprecated; its requirement is kept.')
      }
      const saveRemove = async () => {
        if (detail === null || !removeConfirmed) return
        setBusy(true); setError(''); setConflict('')
        const result = await runOp(remote, sessionId, { op: 'remove', id: detail.id, expectedRevision: detail.revision })
        setBusy(false)
        if (!result.ok) {
          if (/REVISION_CONFLICT/.test(result.error)) setConflict(result.error)
          else setError(result.error)
          return
        }
        const removed = result.value?.removed ?? { id: detail.id, status: detail.status }
        setDetail(null); setSelected(null); setView('list'); setRemoveConfirmed(false)
        await loadList(filters)
        setNotice(`Removed ${removed.id} (${removed.status}) — permanently deleted, audit line written.`)
      }
      const checkDrift = async () => {
        if (detail === null) return
        setBusy(true); setError(''); setNotice('')
        const result = await runOp(remote, sessionId, { op: 'drift', id: detail.id })
        setBusy(false)
        if (!result.ok) { setError(result.error); return }
        const findings = Array.isArray(result.value?.findings) ? result.value.findings : []
        setNotice(findings.length === 0 ? 'No surface drift: hashes and test path are current.' : `Drift found: ${findings.map((entry) => entry.reason ?? entry.status).join('; ')}`)
        await loadDetail(detail.id); await loadList(filters)
      }

      const change = (key) => (event) => setForm({ ...form, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })
      const vchange = (key) => (event) => setVerifyForm({ ...verifyForm, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })
      const filterChange = (key) => (event) => setFilters({ ...filters, [key]: event.target.value })

      const listPane = h('div', { className: 'tc-list' },
        h('div', { className: 'tc-filters' },
          h('label', { className: 'tc-label' }, 'Status',
            h('select', { className: 'tc-select', value: filters.status, onChange: filterChange('status'), 'aria-label': 'Filter by status' },
              h('option', { value: '' }, 'All statuses'), STATUSES.map((status) => h('option', { key: status, value: status }, status)))),
          h('label', { className: 'tc-label' }, 'Kind',
            h('select', { className: 'tc-select', value: filters.kind, onChange: filterChange('kind'), 'aria-label': 'Filter by kind' },
              h('option', { value: '' }, 'All kinds'), KINDS.map((kind) => h('option', { key: kind, value: kind }, kind)))),
          h('label', { className: 'tc-label' }, 'Source',
            h('select', { className: 'tc-select', value: filters.source, onChange: filterChange('source'), 'aria-label': 'Filter by source' },
              h('option', { value: '' }, 'Any source'), h('option', { value: 'human' }, 'human'), h('option', { value: 'agent' }, 'agent'))),
          h('label', { className: 'tc-label' }, 'Automation',
            h('select', { className: 'tc-select', value: filters.automated, onChange: filterChange('automated'), 'aria-label': 'Filter by automation' },
              h('option', { value: '' }, 'Any'), h('option', { value: 'true' }, 'automated'), h('option', { value: 'false' }, 'documented'))),
          h('label', { className: 'tc-label wide' }, 'Tag',
            h('input', { className: 'tc-input', value: filters.tag, onChange: filterChange('tag'), placeholder: 'exact tag, e.g. drift', 'aria-label': 'Filter by exact tag' })),
          h('label', { className: 'tc-label wide' }, 'Search',
            h('input', { className: 'tc-input', type: 'search', value: filters.search, onChange: filterChange('search'), placeholder: 'title, id or tag', 'aria-label': 'Search cases by title, id or tag' })),
        ),
        h('div', { className: 'tc-rows', role: 'list', 'aria-busy': loading },
          loading ? h('div', { className: 'tc-empty', role: 'status' }, 'Loading cases…')
            : error !== '' && cases.length === 0 ? h('div', { className: 'tc-empty' }, h('span', { className: 'tc-error' }, error), h('div', null, h('button', { type: 'button', className: 'tc-btn', onClick: () => loadList(filters).catch(() => {}) }, 'Retry')))
              : visible.length === 0 ? h('div', { className: 'tc-empty' }, total === 0 ? 'No cases in docs/cases yet. A human requirement recorded by the agent appears here.' : 'No cases match these filters.')
                : visible.map((item) => h('div', { key: item.id, role: 'listitem', className: 'tc-rowwrap' },
                  h('button', {
                    type: 'button', className: 'tc-row', 'aria-current': selected === item.id ? 'true' : 'false',
                    onClick: () => loadDetail(item.id).catch(() => {}),
                  },
                  h('span', { className: 'tc-rowtitle' }, item.title),
                  h(Badges, { item })))),
        ),
        h('div', { className: 'tc-hint', style: { padding: '6px 12px', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
          `${visible.length} of ${total ?? cases.length} · stale means a surface file or test changed; the requirement still stands`),
      )

      const detailActions = detail === null ? null : h('div', { className: 'tc-actions' },
        h('button', { type: 'button', className: 'tc-btn primary', onClick: beginEdit, disabled: !canWrite || detail.status === 'deprecated' || detail.status === 'superseded' }, 'Edit'),
        h('button', { type: 'button', className: 'tc-btn', onClick: beginVerify, disabled: !canWrite || detail.status === 'deprecated' || detail.status === 'superseded' }, 'Verify / record run'),
        h('button', { type: 'button', className: 'tc-btn', onClick: checkDrift, disabled: busy }, busy ? 'Checking…' : 'Check drift'),
        h('button', { type: 'button', className: 'tc-btn danger', onClick: () => { setDeprecateReason(''); setView('deprecate'); setError(''); setNotice('') }, disabled: !canWrite || detail.status === 'deprecated' || detail.status === 'superseded' }, 'Deprecate'),
        h('button', { type: 'button', className: 'tc-btn danger', onClick: () => { setRemoveConfirmed(false); setView('remove'); setError(''); setNotice('') }, disabled: !canWrite, title: REMOVABLE.has(detail.status) ? 'Permanently remove this terminal case' : 'Only deprecated or superseded cases can be removed' }, 'Remove…'),
      )

      const conflictBanner = conflict === '' ? null : h('div', { className: 'tc-banner', role: 'alert' },
        h('strong', null, 'Revision conflict. '), `${conflict} `,
        h('button', { type: 'button', className: 'tc-btn', onClick: () => loadDetail(detail?.id).catch(() => {}) }, 'Reload this case'))

      let pane = null
      if (view === 'edit' && form !== null && detail !== null) {
        pane = h(React.Fragment, null,
          conflictBanner,
          h('button', { type: 'button', className: 'tc-btn', onClick: () => setView('detail') }, '← Back to detail'),
          h('h2', { className: 'tc-h2', style: { marginTop: 10 } }, `Edit: ${detail.title}`),
          h('p', { className: 'tc-hint' }, `Editing revision ${detail.revision} with compare-and-set. A newer revision is never overwritten.`),
          h('div', { className: 'tc-form' },
            h('label', { className: 'tc-label' }, 'Title', h('input', { className: 'tc-input', value: form.title, onChange: change('title'), 'aria-label': 'Title' })),
            h('label', { className: 'tc-label' }, 'Requirement', h('textarea', { className: 'tc-textarea', rows: 4, value: form.requirement, onChange: change('requirement'), 'aria-label': 'Requirement' })),
            h('label', { className: 'tc-label' }, 'Steps (one per line)', h('textarea', { className: 'tc-textarea', rows: 5, value: form.steps, onChange: change('steps'), 'aria-label': 'Steps' })),
            h('label', { className: 'tc-label' }, 'Expected', h('textarea', { className: 'tc-textarea', rows: 3, value: form.expected, onChange: change('expected'), 'aria-label': 'Expected' })),
            h('label', { className: 'tc-label' }, 'Tags (comma separated)', h('input', { className: 'tc-input', value: form.tags, onChange: change('tags'), 'aria-label': 'Tags' })),
            h('label', { className: 'tc-label' }, 'Surface files (one per line)', h('textarea', { className: 'tc-textarea', rows: 3, value: form.surfaceFiles, onChange: change('surfaceFiles'), 'aria-label': 'Surface files' })),
            h('label', { className: 'tc-label', style: { display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' } }, h('input', { type: 'checkbox', checked: form.automated, onChange: change('automated'), 'aria-label': 'Automated case' }), 'Automated case'),
            form.automated ? h('label', { className: 'tc-label' }, 'Test path', h('input', { className: 'tc-input', value: form.testPath, onChange: change('testPath'), 'aria-label': 'Test path' })) : null,
            form.automated ? h('label', { className: 'tc-label' }, 'Run command', h('input', { className: 'tc-input', value: form.runCommand, onChange: change('runCommand'), 'aria-label': 'Run command' })) : null,
            form.automated ? null : h('label', { className: 'tc-label' }, 'Why not automated', h('textarea', { className: 'tc-textarea', rows: 2, value: form.reason, onChange: change('reason'), 'aria-label': 'Why not automated' })),
          ),
          h('div', { className: 'tc-actions' }, h('button', { type: 'button', className: 'tc-btn primary', onClick: saveEdit, disabled: busy }, busy ? 'Saving…' : 'Save edit'), h('button', { type: 'button', className: 'tc-btn', onClick: () => setView('detail') }, 'Cancel')),
        )
      } else if (view === 'verify' && verifyForm !== null && detail !== null) {
        pane = h(React.Fragment, null,
          conflictBanner,
          h('button', { type: 'button', className: 'tc-btn', onClick: () => setView('detail') }, '← Back to detail'),
          h('h2', { className: 'tc-h2', style: { marginTop: 10 } }, `Verify: ${detail.title}`),
          h('p', { className: 'tc-hint' }, 'The host records exactly what you ran. Automated cases also need the observed failing run (non-zero exit) before the green one.'),
          h('div', { className: 'tc-form' },
            h('label', { className: 'tc-label', style: { display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' } }, h('input', { type: 'checkbox', checked: verifyForm.passed, onChange: vchange('passed') }), 'Passed (expected outcome observed)'),
            h('label', { className: 'tc-label' }, 'Command', h('input', { className: 'tc-input', value: verifyForm.command, onChange: vchange('command'), 'aria-label': 'Command' })),
            h('label', { className: 'tc-label' }, 'Output', h('textarea', { className: 'tc-textarea', rows: 4, value: verifyForm.output, onChange: vchange('output'), 'aria-label': 'Output' })),
            h('label', { className: 'tc-label' }, 'Exit code', h('input', { className: 'tc-input', type: 'number', value: verifyForm.exitCode, onChange: vchange('exitCode'), 'aria-label': 'Exit code' })),
            detail.automated === true ? h(React.Fragment, null,
              h('h3', { className: 'tc-h3' }, 'Red-first run'),
              h('label', { className: 'tc-label' }, 'Failing command', h('input', { className: 'tc-input', value: verifyForm.redCommand, onChange: vchange('redCommand') })),
              h('label', { className: 'tc-label' }, 'Failing output', h('textarea', { className: 'tc-textarea', rows: 3, value: verifyForm.redOutput, onChange: vchange('redOutput') })),
              h('label', { className: 'tc-label' }, 'Failing exit code (non-zero)', h('input', { className: 'tc-input', type: 'number', value: verifyForm.redExitCode, onChange: vchange('redExitCode') })),
            ) : null,
            h('label', { className: 'tc-label' }, 'Commit (optional)', h('input', { className: 'tc-input', value: verifyForm.commit, onChange: vchange('commit') })),
            h('label', { className: 'tc-label' }, 'Notes', h('textarea', { className: 'tc-textarea', rows: 2, value: verifyForm.notes, onChange: vchange('notes') })),
          ),
          h('div', { className: 'tc-actions' }, h('button', { type: 'button', className: 'tc-btn primary', onClick: saveVerify, disabled: busy }, busy ? 'Recording…' : 'Record verification'), h('button', { type: 'button', className: 'tc-btn', onClick: () => setView('detail') }, 'Cancel')),
        )
      } else if (view === 'deprecate' && detail !== null) {
        pane = h(React.Fragment, null,
          conflictBanner,
          h('button', { type: 'button', className: 'tc-btn', onClick: () => setView('detail') }, '← Back to detail'),
          h('h2', { className: 'tc-h2', style: { marginTop: 10 } }, `Deprecate: ${detail.title}`),
          h('p', { className: 'tc-hint' }, 'The record and its requirement stay; status becomes deprecated and edits/verifications are refused.'),
          h('label', { className: 'tc-label' }, 'Reason (required)', h('textarea', { className: 'tc-textarea', rows: 4, value: deprecateReason, onChange: (event) => setDeprecateReason(event.target.value), 'aria-label': 'Reason (required)' })),
          h('div', { className: 'tc-actions' }, h('button', { type: 'button', className: 'tc-btn danger', onClick: saveDeprecate, disabled: busy || deprecateReason.trim() === '' }, busy ? 'Saving…' : 'Deprecate case'), h('button', { type: 'button', className: 'tc-btn', onClick: () => setView('detail') }, 'Cancel')),
        )
      } else if (view === 'remove' && detail !== null) {
        const removable = REMOVABLE.has(detail.status)
        pane = h(React.Fragment, null,
          conflictBanner,
          h('button', { type: 'button', className: 'tc-btn', onClick: () => setView('detail') }, '← Back to detail'),
          h('h2', { className: 'tc-h2', style: { marginTop: 10 } }, `Remove: ${detail.title}`),
          h('div', { className: 'tc-confirm' },
            h('h3', null, 'This permanently deletes the case file'),
            h('p', { className: 'tc-p' }, removable
              ? `The case is ${detail.status}. Removing it also removes its requirement, steps, evidence and history from docs/cases/. An audit line is written to docs/cases/.removed.jsonl.`
              : `The case is ${detail.status}. Only deprecated or superseded cases can be removed. Deprecate it first and then remove it.`),
            removable ? h('label', { className: 'tc-label', style: { display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 10 } },
              h('input', { type: 'checkbox', checked: removeConfirmed, onChange: (event) => setRemoveConfirmed(event.target.checked), 'aria-label': 'I understand this permanently removes the case' }),
              'I understand this permanent removal cannot be undone',
            ) : null,
            h('div', { className: 'tc-actions' },
              h('button', { type: 'button', className: 'tc-btn danger', onClick: saveRemove, disabled: busy || !removable || !removeConfirmed }, busy ? 'Removing…' : 'Remove permanently'),
              h('button', { type: 'button', className: 'tc-btn', onClick: () => setView('detail') }, 'Cancel'),
            ),
          ),
        )
      } else if (view === 'detail' && detail !== null) {
        const drift = detail.needsReverification
        pane = h(React.Fragment, null,
          conflictBanner,
          h('button', { type: 'button', className: 'tc-btn', onClick: () => { setView('list'); setDetail(null) } }, '← All cases'),
          h('h2', { className: 'tc-h2', style: { marginTop: 10 }, tabIndex: -1, ref: detailHeading }, detail.title),
          h(StatusBadge, { status: detail.status, detailed: true }),
          h(Badges, { item: detail, omitStatus: true }),
          detail.status === 'stale' ? h('div', { className: 'tc-banner', style: { marginTop: 10 } }, 'Stale: a recorded surface file or the automated test changed after the last verification. The requirement still stands; re-verify or run drift.') : null,
          detail.deprecateReason ? h('div', { className: 'tc-banner' }, `Deprecated: ${detail.deprecateReason}`) : null,
          detail.supersededBy ? h('div', { className: 'tc-banner' }, `Superseded by ${detail.supersededBy}.`) : null,
          detailActions,
          h('h3', { className: 'tc-h3' }, 'Requirement'), h(LongText, { text: detail.requirement, label: 'requirement' }),
          h('h3', { className: 'tc-h3' }, 'Steps'),
          Array.isArray(detail.steps) && detail.steps.length > 0
            ? h('div', { className: 'tc-scroll', tabIndex: 0, 'aria-label': 'Steps' }, h('ol', { className: 'tc-steps' }, detail.steps.map((step, index) => h('li', { key: index }, step))))
            : h('p', { className: 'tc-hint' }, 'No steps recorded.'),
          h('h3', { className: 'tc-h3' }, 'Expected'), h(LongText, { text: detail.expected, label: 'expected' }),
          h('h3', { className: 'tc-h3' }, 'Automation'),
          h('div', { className: 'tc-grid' },
            h('div', { className: 'tc-card' }, h('h4', null, detail.automated ? 'Automated test' : 'Documented only'),
              detail.automated
                ? h(React.Fragment, null, h('p', { className: 'tc-p' }, detail.testPath ?? '—'), h('pre', { className: 'tc-code', tabIndex: 0 }, detail.runCommand ?? '—'))
                : h(React.Fragment, null, h('p', { className: 'tc-hint' }, 'Cannot be a test because:'), h(LongText, { text: detail.reason ?? '', label: 'reason' }))),
            h('div', { className: 'tc-card' }, h('h4', null, 'Last verified'),
              detail.lastVerified ? h(React.Fragment, null, h('p', { className: 'tc-p' }, shortAge(detail.lastVerified.at)), h('pre', { className: 'tc-code', tabIndex: 0 }, `${detail.lastVerified.command ?? ''}\nexit ${detail.lastVerified.exitCode ?? '—'}`)) : h('p', { className: 'tc-hint' }, 'Never verified.')),
          ),
          h('h3', { className: 'tc-h3' }, 'Evidence'),
          h('div', { className: 'tc-grid' },
            h(EvidenceCard, { title: 'Green / observation', value: detail.evidence?.green ?? detail.evidence?.observation }),
            h(EvidenceCard, { title: 'Red-first', value: detail.evidence?.redFirst }),
          ),
          h('h3', { className: 'tc-h3' }, 'Surface drift'),
          h('div', { className: 'tc-card' },
            (detail.surfaceFiles ?? []).length === 0 ? h('p', { className: 'tc-hint' }, 'No surface files recorded.') :
              h('ul', { className: 'tc-steps', style: { paddingLeft: 16 } }, detail.surfaceFiles.map((entry) => h('li', { key: entry.path }, h('code', null, entry.path), h('span', { className: 'tc-hint' }, ` · ${entry.sha256 ? entry.sha256.slice(0, 10) : 'missing hash'}`)))),
            drift ? h('p', { className: 'tc-error', style: { marginTop: 6 } }, `${drift.reason ?? 'Changed'} · ${(drift.changedFiles ?? []).join(', ')}`) : null),
          h('h3', { className: 'tc-h3' }, 'History'),
          Array.isArray(detail.history) && detail.history.length > 0
            ? h('ul', { className: 'tc-history' }, detail.history.map((entry, index) => h('li', { key: index },
              h('span', { className: 'tc-badge muted' }, `rev ${entry.revision}`), h('strong', null, entry.action ?? 'edit'), h('span', null, entry.editedBy ?? '—'), h('span', { className: 'tc-hint' }, shortAge(entry.at)), entry.notes ? h('span', { className: 'tc-p', style: { width: '100%' } }, entry.notes) : null)))
            : h('p', { className: 'tc-hint' }, 'No edits yet.'),
          h('h3', { className: 'tc-h3' }, 'Record'),
          h('p', { className: 'tc-hint' }, `${detail.id} · revision ${detail.revision} · ${detail.source} source · updated ${shortAge(detail.updatedAt)} · linked task ${detail.linkedTaskId ?? 'none'}`),
          detail.tags?.length ? h('div', { className: 'tc-tags' }, detail.tags.map((tag) => h('span', { key: tag, className: 'tc-badge' }, tag))) : null,
        )
      } else {
        pane = h('div', { className: 'tc-empty' }, h(Icon, { size: 26 }), h('p', null, hasSession ? 'Select a case to read its requirement, steps and evidence.' : 'Open a conversation to read this workspace library.'))
      }

      return h('div', { className: 'tc-root' },
        h('style', null, CSS),
        h('div', { className: 'tc-top' },
          h('button', { type: 'button', className: 'tc-btn', onClick: () => layout.selectPanel(null), title: 'Back to chat', 'aria-label': 'Back to chat' }, '←'),
          h('h1', { className: 'tc-title' }, 'Test cases'),
          h('div', { className: 'tc-tabs', role: 'tablist', 'aria-label': 'Board sections' },
            h('button', { type: 'button', className: 'tc-tab', role: 'tab', 'aria-selected': 'false', title: 'Back to the task board', onClick: () => layout.selectPanel('tasks') }, 'Tasks'),
            h('span', { className: 'tc-tab on', role: 'tab', 'aria-selected': 'true' }, 'Test cases'),
          ),
          h('span', { className: 'tc-meta' }, h('span', { className: 'tc-badge' }, 'docs/cases'), total !== null ? h('span', { className: 'tc-badge' }, `${total} cases`) : null, hasSession ? h('span', { className: 'tc-badge' }, canWrite ? 'live chat' : 'read-only') : null),
          h('span', { className: 'tc-spacer' }),
          h('button', { type: 'button', className: 'tc-btn', onClick: () => setDetailOpen(!detailOpen), 'aria-pressed': !detailOpen, disabled: detail === null, title: detail === null ? 'Select a case first' : (detailOpen ? 'Hide the detail pane and let the list use the full width' : 'Show the selected case detail again') }, detailOpen ? 'Hide detail' : 'Show detail'),
          h('button', { type: 'button', className: 'tc-btn', onClick: () => loadList(filters).catch(() => {}) }, 'Reload'),
        ),
        h('div', { className: `tc-body${detailOpen ? '' : ' hide-detail'}` }, listPane, detailOpen ? h('div', { className: 'tc-detail', ref: detailPane },
          h('div', { className: 'tc-sr', role: 'status', 'aria-live': 'polite' }, loading ? 'Loading cases' : error !== '' ? `Error: ${error}` : notice),
          error !== '' ? h('div', { className: 'tc-banner', role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)' } }, h('span', { className: 'tc-error' }, error), ' ', h('button', { type: 'button', className: 'tc-btn', onClick: () => loadList(filters).catch(() => {}) }, 'Retry')) : null,
          notice !== '' ? h('div', { className: 'tc-banner', role: 'status', style: { color: 'var(--dsw-alias-state-success-primary)', borderColor: 'color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,var(--dsw-alias-border-l1))' } }, notice) : null,
          pane,
        ) : null),
      )
    }

    return {
      inject: ['slots', 'remote', 'remote.commands', 'layout'],
      apply(ctx) {
        const store = createStore({ sessionId: null })
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID,
          inject: () => ({ remote: ctx.remote, store, layout: ctx.layout }),
        }, TestCasePage))
      },
    }
  },
})
