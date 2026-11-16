/**
 * The drawing surface: the vendored Excalidraw editor, fed with the scene.
 *
 * The panel owns nothing about geometry here. `sceneToElements` copies the scene (with
 * the overlay rows applied) into elements and keeps that list as the baseline; every
 * `change` the frame reports is diffed against it, and only the nodes the human touched
 * come back as overlay deltas. Edges, labels and group bands are locked, so the canvas
 * cannot change the structure or re-route an arrow.
 */
import React from 'react'
import { loadFrameText, frameDocument, FRAME_SOURCE, PANEL_SOURCE } from './frame.js'
import { sceneToElements, sceneToAppState, overlayDelta } from './excalidraw.js'

export function ExcalidrawCanvas({ scene, overlays, editMode, onDelta, onStatus, onFallback }) {
  const iframeRef = React.useRef(null)
  const baselineRef = React.useRef([])
  const readyRef = React.useRef(false)
  const loadedRef = React.useRef(false)
  const [srcDoc, setSrcDoc] = React.useState(null)
  const [failure, setFailure] = React.useState(null)

  const post = React.useCallback((message) => {
    iframeRef.current?.contentWindow?.postMessage({ source: PANEL_SOURCE, ...message }, '*')
  }, [])

  /**
   * Frame the scene in the visible canvas. Excalidraw opens at 0,0 with zoom 1, which
   * clipped a map wider than the panel; the app state carries the fit instead.
   */
  const framedAppState = React.useCallback(() => {
    const base = sceneToAppState()
    const frame = iframeRef.current
    const width = frame?.clientWidth ?? 0
    const height = frame?.clientHeight ?? 0
    const canvas = scene.canvas ?? { x: 0, y: 0, width: 0, height: 0 }
    if (width === 0 || height === 0 || canvas.width === 0 || canvas.height === 0) return base
    const margin = 24
    const zoom = Math.max(0.05, Math.min(1.5, Math.min((width - margin * 2) / canvas.width, (height - margin * 2) / canvas.height)))
    const centreX = canvas.x + canvas.width / 2
    const centreY = canvas.y + canvas.height / 2
    return { ...base, zoom: { value: zoom }, scrollX: width / 2 - centreX * zoom, scrollY: height / 2 - centreY * zoom }
  }, [scene])

  const elementsFor = React.useCallback(
    () => sceneToElements(scene, { overlays, editMode }),
    [scene, overlays, editMode],
  )

  // Load the frame once; a failure falls back to the React Flow stage.
  React.useEffect(() => {
    let alive = true
    loadFrameText()
      .then((text) => {
        if (!alive) return
        baselineRef.current = elementsFor()
        setSrcDoc(frameDocument(text))
      })
      .catch((error) => {
        if (!alive) return
        setFailure(error)
        onFallback?.(error)
      })
    return () => { alive = false }
  }, [elementsFor, onFallback])

  // Send the scene whenever it, the overlays or the mode change.
  React.useEffect(() => {
    if (srcDoc === null || !readyRef.current) return
    const elements = elementsFor()
    baselineRef.current = elements
    post({ type: 'load', scene: { elements, appState: framedAppState() } })
  }, [srcDoc, elementsFor, post])

  React.useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data
      if (data === null || typeof data !== 'object' || data.source !== FRAME_SOURCE) return
      if (data.type === 'ready') {
        readyRef.current = true
        const elements = elementsFor()
        baselineRef.current = elements
        post({ type: 'load', scene: { elements, appState: framedAppState() } })
        return
      }
      if (data.type === 'loaded') { loadedRef.current = true; return }
      if (data.type === 'change') {
        // Before the first load the frame reports its empty canvas; saving that would
        // erase every overlay row.
        if (!loadedRef.current) return
        const delta = overlayDelta(baselineRef.current, data.elements ?? [])
        if (Object.keys(delta).length > 0) onDelta?.(delta)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [elementsFor, onDelta, post])

  if (failure !== null) {
    return (
      <div className="dmv-error" role="alert">
        <div>
          <h2>Excalidraw canvas unavailable</h2>
          <p>{failure.message}</p>
        </div>
      </div>
    )
  }
  if (srcDoc === null) {
    return (
      <div className="dmv-loading" role="status">
        <span className="pulse" aria-hidden="true" />
        Loading the canvas…
      </div>
    )
  }
  return (
    <iframe
      ref={iframeRef}
      className="dmv-excalidraw"
      title="Design map canvas"
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      onLoad={() => onStatus?.({ kind: 'info', code: 'canvas_ready', message: 'Excalidraw canvas loaded.' })}
    />
  )
}
