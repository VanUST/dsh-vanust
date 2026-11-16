/**
 * The drawing surface: the vendored Excalidraw editor, fed with the scene.
 *
 * The panel owns nothing about geometry here. `sceneToElements` copies the scene (with
 * the overlay rows applied) into elements and keeps that list as the baseline; every
 * `change` the frame reports is diffed against it, and only the nodes the human touched
 * come back as overlay deltas. Edges, labels and group bands are locked, so the canvas
 * cannot change the structure or re-route an arrow.
 *
 * Two things are the panel's, not the editor's: the viewport (a fit that centres the
 * scene using Excalidraw's own scroll formula, plus the human's pan/zoom that must
 * survive an overlay write) and the theme (the frame is a separate document, so every
 * colour arrives as a prop).
 */
import React from 'react'
import { loadFrameText, frameDocument, FRAME_SOURCE, PANEL_SOURCE } from './frame.js'
import { sceneToElements, sceneToAppState, overlayDelta, freeElements, DEFAULT_LOOK } from './excalidraw.js'

/** Excalidraw maps a scene point to the screen as `(point + scroll) * zoom`. */
export function fitViewport({ canvas, width, height, margin = 18 }) {
  if (width <= 0 || height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    return { zoom: 1, scrollX: 0, scrollY: 0 }
  }
  const usableWidth = Math.max(1, width - margin * 2)
  const usableHeight = Math.max(1, height - margin * 2)
  const zoom = Math.max(0.05, Math.min(1.5, Math.min(usableWidth / canvas.width, usableHeight / canvas.height)))
  const centreX = canvas.x + canvas.width / 2
  const centreY = canvas.y + canvas.height / 2
  return {
    zoom,
    scrollX: width / (2 * zoom) - centreX,
    scrollY: height / (2 * zoom) - centreY,
  }
}

export function ExcalidrawCanvas({
  scene,
  overlays,
  editMode,
  look,
  annotations = [],
  fitSignal = 0,
  onDelta,
  onAnnotate,
  onStatus,
  onFallback,
  onViewport,
}) {
  const theme = look ?? DEFAULT_LOOK
  const iframeRef = React.useRef(null)
  const baselineRef = React.useRef([])
  const readyRef = React.useRef(false)
  const loadedRef = React.useRef(false)
  const viewportRef = React.useRef(null)
  const appliedFitRef = React.useRef(null)
  const viewRef = React.useRef(null)
  const fitRef = React.useRef(fitSignal)
  const frameTextRef = React.useRef(null)
  const builtModeRef = React.useRef(null)
  const annotationsRef = React.useRef(annotations)
  annotationsRef.current = annotations
  const lookRef = React.useRef(theme)
  lookRef.current = theme
  const [srcDoc, setSrcDoc] = React.useState(null)
  const [failure, setFailure] = React.useState(null)

  const post = React.useCallback((message) => {
    iframeRef.current?.contentWindow?.postMessage({ source: PANEL_SOURCE, ...message }, '*')
  }, [])

  /** The appState that frames the whole scene in the visible canvas. */
  const fittedAppState = React.useCallback(() => {
    const frame = iframeRef.current
    const width = frame?.clientWidth ?? 0
    const height = frame?.clientHeight ?? 0
    const viewport = fitViewport({ canvas: scene.canvas ?? { x: 0, y: 0, width: 0, height: 0 }, width, height })
    viewportRef.current = viewport
    appliedFitRef.current = viewport
    // The frame's own change event is suppressed for the message that set the scene, so
    // the panel reports the fit it just applied or the status would show a stale zoom.
    onViewport?.({ zoom: viewport.zoom })
    return {
      ...sceneToAppState(lookRef.current),
      zoom: { value: viewport.zoom },
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
    }
  }, [scene, onViewport])

  /** The appState that keeps the human's current pan/zoom (an overlay write must not reset it). */
  const currentAppState = React.useCallback(() => {
    const base = sceneToAppState(lookRef.current)
    const viewport = viewportRef.current
    if (viewport === null) return base
    return { ...base, zoom: { value: viewport.zoom }, scrollX: viewport.scrollX, scrollY: viewport.scrollY }
  }, [])

  const elementsFor = React.useCallback(
    // Annotations are read from a ref on purpose: the human's own elements are already on
    // the canvas, so a write landing back as state must not trigger another full load
    // (that would reset the selection and can interrupt a stroke in progress).
    () => sceneToElements(scene, { overlays, editMode, look: theme, annotations: annotationsRef.current }),
    [scene, overlays, editMode, theme],
  )

  // Load the frame once; a failure falls back to the React Flow stage.
  React.useEffect(() => {
    let alive = true
    loadFrameText()
      .then((text) => {
        if (!alive) return
        frameTextRef.current = text
        builtModeRef.current = editMode
        baselineRef.current = elementsFor()
        setSrcDoc(frameDocument(text, lookRef.current, { editing: editMode }))
      })
      .catch((error) => {
        if (!alive) return
        setFailure(error)
        onFallback?.(error)
      })
    return () => { alive = false }
  }, [elementsFor, onFallback])

  // The chrome (toolbar/properties) is decided by the frame document, so switching modes
  // rebuilds the frame from the cached bundle. The ready handler re-sends the CURRENT
  // viewport, so the map does not jump when the human enters edit mode.
  React.useEffect(() => {
    if (frameTextRef.current === null || builtModeRef.current === editMode) return
    builtModeRef.current = editMode
    readyRef.current = false
    loadedRef.current = false
    setSrcDoc(frameDocument(frameTextRef.current, lookRef.current, { editing: editMode }))
  }, [editMode])

  // Send the scene whenever it, the overlays, the mode or the theme change. A new view
  // is framed; anything else keeps the viewport the human is looking through.
  React.useEffect(() => {
    if (srcDoc === null || !readyRef.current) return
    const elements = elementsFor()
    baselineRef.current = elements
    const viewChanged = viewRef.current !== scene.viewId
    viewRef.current = scene.viewId
    post({ type: 'load', scene: { elements, appState: viewChanged ? fittedAppState() : currentAppState() } })
  }, [srcDoc, elementsFor, post, scene.viewId, fittedAppState, currentAppState])

  // "Fit" from the panel chrome: re-frame the scene the editor already holds.
  React.useEffect(() => {
    if (srcDoc === null || !readyRef.current || fitRef.current === fitSignal) return
    fitRef.current = fitSignal
    post({ type: 'load', scene: { elements: baselineRef.current, appState: fittedAppState() } })
  }, [fitSignal, srcDoc, post, fittedAppState])

  // A resized panel must re-frame the map, or a map fitted at 1440 gets clipped at 1280.
  // Only an untouched viewport is re-fitted: once the human pans or zooms, a resize keeps
  // their view and leaves "Fit" as the explicit way back.
  React.useEffect(() => {
    const frame = iframeRef.current
    if (frame === null || typeof ResizeObserver === 'undefined') return undefined
    let timer = null
    const observer = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!readyRef.current) return
        const current = viewportRef.current
        const fit = appliedFitRef.current
        if (current === null || fit === null) return
        if (Math.abs(current.zoom - fit.zoom) > 0.01) return
        post({ type: 'load', scene: { elements: baselineRef.current, appState: fittedAppState() } })
      }, 120)
    })
    observer.observe(frame)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [srcDoc, post, fittedAppState])

  React.useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data
      if (data === null || typeof data !== 'object' || data.source !== FRAME_SOURCE) return
      if (data.type === 'ready') {
        readyRef.current = true
        const elements = elementsFor()
        baselineRef.current = elements
        viewRef.current = scene.viewId
        const appState = viewportRef.current === null ? fittedAppState() : currentAppState()
        post({ type: 'load', scene: { elements, appState } })
        return
      }
      if (data.type === 'loaded') { loadedRef.current = true; return }
      if (data.type === 'change') {
        const rawZoom = data.appState?.zoom
        const zoomValue = typeof rawZoom === 'number' ? rawZoom : rawZoom?.value
        if (Number.isFinite(zoomValue)) {
          viewportRef.current = { zoom: zoomValue, scrollX: data.appState.scrollX, scrollY: data.appState.scrollY }
          onViewport?.({ zoom: zoomValue })
        }
        // Before the first load the frame reports its empty canvas; saving that would
        // erase every overlay row.
        if (!loadedRef.current) return
        const delta = overlayDelta(baselineRef.current, data.elements ?? [])
        if (Object.keys(delta).length > 0) onDelta?.(delta)
        const human = freeElements(data.elements ?? [])
        if (JSON.stringify(human) !== JSON.stringify(annotationsRef.current)) onAnnotate?.(human)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [elementsFor, onDelta, post, fittedAppState, scene.viewId, onViewport])

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
      style={{ background: theme.surface }}
      onLoad={() => onStatus?.({ kind: 'info', code: 'canvas_ready', message: 'Excalidraw canvas loaded.' })}
    />
  )
}
