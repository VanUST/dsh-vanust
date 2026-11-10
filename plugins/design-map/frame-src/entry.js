/**
 * The Excalidraw frame: the only code that runs inside the panel's iframe.
 *
 * It mounts the MIT Excalidraw component, receives a scene from the panel over
 * postMessage, and sends back the elements the human actually edited. It never
 * touches the filesystem: persistence is the panel's job through the host
 * command, because a sandboxed frame cannot write the workspace.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

const PANEL = 'design-map-panel'
const FRAME = 'design-map-frame'

let api = null
let pendingScene = null
let suppressUntil = 0
let timer = null
let lastSerialized = ''
let loaded = false

/** Only these appState keys cross the bridge; the live object holds Maps and host state. */
const APP_KEYS = ['viewBackgroundColor', 'gridSize', 'theme', 'scrollX', 'scrollY', 'zoom']

function post(message) {
  parent.postMessage({ source: FRAME, ...message }, '*')
}

function pickAppState(appState) {
  const out = {}
  for (const key of APP_KEYS) if (appState && appState[key] !== undefined) out[key] = appState[key]
  return out
}

function applyScene(scene) {
  if (api === null) {
    pendingScene = scene
    return
  }
  const elements = Array.isArray(scene.elements) ? scene.elements : []
  const appState = scene.appState && typeof scene.appState === 'object' ? scene.appState : {}
  // A load is not a human edit. Without this guard the initial scene would be
  // written straight back as a save and bump the revision on every open.
  suppressUntil = Date.now() + 700
  lastSerialized = JSON.stringify([elements.filter((element) => element.isDeleted !== true), pickAppState(appState)])
  api.updateScene({
    elements,
    appState: { ...pickAppState(appState), collaborators: new Map() },
  })
  if (scene.files && typeof api.addFiles === 'function') api.addFiles(scene.files)
  loaded = true
  post({ type: 'loaded' })
}

function onChange(elements, appState) {
  // Before a scene has been loaded the canvas is empty, and the first marquee or
  // click would otherwise be reported as "the human deleted everything".
  if (!loaded || Date.now() < suppressUntil) return
  // Selection, panning and zoom also fire onChange. Only a change in the scene
  // bytes may cause a save; otherwise every click bumps the revision and makes a
  // stale check meaningless.
  const live = elements.filter((element) => element.isDeleted !== true)
  const serialized = JSON.stringify([live, pickAppState(appState)])
  if (serialized === lastSerialized) return
  lastSerialized = serialized
  clearTimeout(timer)
  timer = setTimeout(() => {
    post({ type: 'change', elements: live, appState: pickAppState(appState) })
  }, 450)
}

function App() {
  return React.createElement(Excalidraw, {
    excalidrawAPI: (instance) => {
      api = instance
      post({ type: 'ready', loaded })
      if (pendingScene !== null) {
        const scene = pendingScene
        pendingScene = null
        applyScene(scene)
      }
    },
    initialData: { elements: [], appState: { viewBackgroundColor: '#ffffff' } },
    onChange,
    langCode: 'en',
    UIOptions: {
      canvasActions: {
        loadScene: false,
        saveToActiveFile: false,
        export: false,
        saveAsImage: false,
        clearCanvas: true,
        toggleTheme: false,
      },
    },
  })
}

window.addEventListener('message', (event) => {
  const data = event.data
  if (data === null || typeof data !== 'object' || data.source !== PANEL) return
  if (data.type === 'load') applyScene(data.scene ?? {})
  if (data.type === 'saved') post({ type: 'saved', rev: data.rev, updatedAt: data.updatedAt })
})

createRoot(document.getElementById('root')).render(React.createElement(App))
