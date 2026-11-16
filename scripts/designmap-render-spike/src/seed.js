/**
 * Spike-side stand-in for the DSH shell's static module table.
 *
 * The real shell (dsh-web-frontend) builds `staticModules` from its own bundle
 * and hands these exact keys to ClientModuleSystem:
 *   react, react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis,
 *   zod, @tanstack/react-virtual, @deepseek-ai/dsh-client-store,
 *   @deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives,
 *   @deepseek-ai/dsh-client-ui-dockkit
 * (measured in the served index bundle: `staticModules:qJ()` and
 * `function qJ(){return{react:rS,"react/jsx-runtime":aS,...}}`).
 *
 * A client panel needs the first four; this bundle supplies those four from the
 * SAME React version the :3080 shell bundles (18.3.1, measured), so the spike
 * tests the loader contract rather than a different runtime.
 */
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as JSXRuntime from 'react/jsx-runtime'

window.__SPIKE_SEED__ = {
  react: React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'react/jsx-runtime': JSXRuntime,
}

window.__SPIKE_SEED_REACT_VERSION__ = React.version
