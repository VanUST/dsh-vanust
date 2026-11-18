/**
 * `@cc/dsh-designmap` client half.
 *
 * Built by `build-client.mjs` into `plugins/designmap/client.js`:
 *   window.__ModuleLoader__.load({ id: '@cc/dsh-designmap', factory(require) { … } })
 * React, ReactDOM and the jsx runtime come from the DSH shell's seed table; React
 * Flow is bundled here (it is not a seed word — see docs/designmap/API-TESTS-RENDER.md).
 *
 * The module exports the view and adapter so the static harness can mount the real
 * component against the real loader; `apply` registers the panel in the shell.
 */
import React from 'react'
import flowCss from '@xyflow/react/dist/style.css'
import { DesignMapView, SceneCanvas } from './view.jsx'
import { createRemoteHost } from './host.js'
import { CSS } from './styles.js'

export { DesignMapView, SceneCanvas, createRemoteHost }

function injectStyleOnce(key, css) {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-designmap-style="${key}"]`) !== null) return
  const element = document.createElement('style')
  element.setAttribute('data-designmap-style', key)
  element.textContent = css
  document.head.append(element)
}

injectStyleOnce('xyflow', flowCss)
injectStyleOnce('designmap', CSS)

function sessionIdsOf(workspace) {
  return Array.isArray(workspace?.sessionIds) ? workspace.sessionIds.filter((id) => typeof id === 'string' && id !== '') : []
}

function firstSession(workspaces, sessionsById) {
  const candidates = (Array.isArray(workspaces) ? workspaces : [])
    .filter((workspace) => sessionIdsOf(workspace).length > 0)
    .slice()
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  for (const workspace of candidates) {
    const ids = sessionIdsOf(workspace)
    const live = ids.find((id) => (sessionsById?.[id]?.retainedBy?.mainView ?? 0) > 0)
    if (live !== undefined) return live
  }
  return candidates[0] === undefined ? null : sessionIdsOf(candidates[0])[0] ?? null
}

/**
 * The panel must never fail silently. A thrown render used to leave the shell with a
 * blank area and no message anywhere, which is indistinguishable from "no panel".
 * This boundary shows the error in place and logs it, so a broken scene or a host
 * mismatch is diagnosable from the page itself.
 */
class PanelBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[designmap] panel render failed:', error, info?.componentStack ?? '')
  }

  render() {
    if (this.state.error === null) return this.props.children
    const message = String(this.state.error?.message ?? this.state.error)
    return React.createElement(
      'div',
      { className: 'dmv', role: 'alert', 'data-designmap-error': 'true', style: { padding: 16, gap: 8 } },
      React.createElement('h1', { className: 'dmv-title' }, 'Design map panel failed'),
      React.createElement('p', null, 'The scene could not be drawn. The error is below and in the browser console.'),
      React.createElement('pre', { style: { margin: 0, whiteSpace: 'pre-wrap', overflow: 'auto', font: '12px/1.5 ui-monospace, monospace' } }, message),
    )
  }
}

/** The panel mounted by the `main` slot: resolves the current session, then adapts remote. */
function LivePanel({ remote, useSessions, useWorkspaces }) {
  const sessionsById = useSessions === undefined ? {} : useSessions((snapshot) => snapshot.byId)
  const workspaces = useWorkspaces === undefined ? [] : useWorkspaces((snapshot) => snapshot.items)
  const sessionId = React.useMemo(
    () => firstSession(workspaces, sessionsById !== null && typeof sessionsById === 'object' ? sessionsById : {}),
    [workspaces, sessionsById],
  )
  const host = React.useMemo(() => createRemoteHost({ remote, sessionId }), [remote, sessionId])
  return React.createElement(PanelBoundary, null, React.createElement(DesignMapView, { host }))
}

export const inject = ['slots', 'remote', 'remote.workspaceFiles', 'remote.commands', 'remote.session', 'layout']

export function apply(ctx) {
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: 'designmap',
        inject: () => ({ remote: ctx.remote, layout: ctx.layout }),
      },
      LivePanel,
    ),
  )
}
