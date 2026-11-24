/**
 * `@cc/dsh-designmap` client half.
 *
 * Built by `build-client.mjs` into `plugins/designmap/client.js`:
 *   window.__ModuleLoader__.load({ id: '@cc/dsh-designmap', factory(require) { … } })
 * React, ReactDOM and the jsx runtime come from the DSH shell's seed table; the vendored
 * Excalidraw frame is loaded from `client.frame.js` at runtime.
 *
 * The module exports the page editor and its host adapter. It registers NO slot: the panel
 * lives in Project state -> Map, which requires `PageEditor` and mounts it.
 */
import React from 'react'
import { PageEditor } from './page-view.jsx'
import { createRemoteHost } from './host.js'
import { CSS } from './styles.js'

export { PageEditor, createRemoteHost }

function injectStyleOnce(key, css) {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-designmap-style="${key}"]`) !== null) return
  const element = document.createElement('style')
  element.setAttribute('data-designmap-style', key)
  element.textContent = css
  document.head.append(element)
}

injectStyleOnce('designmap', CSS)

/**
 * The module entry `apply`.
 *
 * WHY IT EXISTS. The shell activates every entry it loads: a module that exports no `apply`
 * is reported as "import failed" at boot and the package's exports are not offered to the
 * siblings that require them — which is exactly how the state panel lost PageEditor in the
 * first P2 build (reports/p2-proof/proof.out, console). This entry registers NO slot: the
 * panel lives in Project state -> Map. The function is deliberately empty; what it must do
 * is exist.
 */
export function apply() {}
