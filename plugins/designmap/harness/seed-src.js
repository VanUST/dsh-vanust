/**
 * Static-harness stand-in for the DSH shell's static module table. The real shell hands
 * client factories exactly these keys (measured in the served :3080 index bundle:
 * `function qJ(){return{react:rS,"react/jsx-runtime":aS,...}}`); the harness needs the
 * first four. React is 18.3.1 — the version the running shell serves.
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
