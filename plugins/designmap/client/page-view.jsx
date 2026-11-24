/**
 * The page editor: the panel is an editor over designmap/pages/<slug>.excalidraw.
 *
 * WHAT CHANGED FROM v1. The old panel rendered a server-computed scene and sent back overlay
 * deltas and annotations. This one opens ONE page file, hands its elements to the vendored
 * Excalidraw frame, and writes the frame's elements back to that same file. The file is the
 * only store: nothing is cached across a reload except what the frame holds in this tab.
 *
 * READ MODE is the frame with its editing chrome hidden and every save suppressed, so a
 * read-only panel cannot change the file. EDIT MODE rebuilds the frame document (the chrome
 * comes from the document) and every change is debounced and saved: the host re-reads the
 * file before writing it, so a human edit and an agent edit inside one debounce window end in
 * last-writer-wins rather than a silent truncation.
 */
import React from 'react'
import { loadFrameText, frameDocument, FRAME_SOURCE, PANEL_SOURCE } from './frame.js'

const SAVE_DEBOUNCE_MS = 500
const LOOK = { surface: '#ffffff' }

function blankScene(page) {
  return { type: 'excalidraw', version: 2, elements: [], appState: { gridSize: null, viewBackgroundColor: '#ffffff' }, files: {}, page }
}

export function PageEditor({ host }) {
  const [pages, setPages] = React.useState([])
  const [slug, setSlug] = React.useState(null)
  const [scene, setScene] = React.useState(null)
  const [mode, setMode] = React.useState('read')
  const [revision, setRevision] = React.useState(0)
  const [status, setStatus] = React.useState({ kind: 'info', message: 'Loading the pages…' })
  const [saving, setSaving] = React.useState(false)
  const [srcDoc, setSrcDoc] = React.useState(null)

  const iframeRef = React.useRef(null)
  const frameTextRef = React.useRef(null)
  const builtModeRef = React.useRef(null)
  const readyRef = React.useRef(false)
  const loadedRef = React.useRef(false)
  const pendingRef = React.useRef(null)
  const timerRef = React.useRef(null)
  const modeRef = React.useRef(mode)
  const slugRef = React.useRef(slug)
  const sceneRef = React.useRef(scene)
  modeRef.current = mode
  slugRef.current = slug
  sceneRef.current = scene

  const say = (kind, message) => setStatus({ kind, message })

  const loadPages = React.useCallback(async () => {
    const result = await host.pages()
    if (result?.ok !== true) {
      say('error', result?.error?.message ?? 'The page list could not be read.')
      return []
    }
    const list = Array.isArray(result.value?.pages) ? result.value.pages : []
    setPages(list)
    return list
  }, [host])

  const openPage = React.useCallback(async name => {
    if (typeof name !== 'string' || name === '') return
    const result = await host.page(name)
    if (result?.ok !== true) {
      say('error', result?.error?.message ?? `Page "${name}" could not be read.`)
      return
    }
    setSlug(name)
    setScene(result.value?.scene ?? blankScene(name))
    setRevision(value => value + 1)
    say('info', `designmap/pages/${name}.excalidraw`)
  }, [host])

  React.useEffect(() => {
    let alive = true
    loadPages().then(list => {
      if (!alive || list.length === 0) {
        if (alive && list.length === 0) say('info', 'No pages yet: designmap/pages is empty.')
        return
      }
      openPage(list[0].page)
    })
    return () => { alive = false }
  }, [loadPages, openPage])

  // The frame bundle is fetched once; the DOCUMENT is rebuilt whenever the mode changes,
  // because the editing chrome is fixed in the document itself.
  React.useEffect(() => {
    let alive = true
    loadFrameText()
      .then(text => {
        if (!alive) return
        frameTextRef.current = text
        builtModeRef.current = modeRef.current
        setSrcDoc(frameDocument(text, LOOK, { editing: modeRef.current === 'edit' }))
      })
      .catch(error => { if (alive) say('error', `The Excalidraw frame did not load: ${error?.message ?? error}`) })
    return () => { alive = false }
  }, [])

  React.useEffect(() => {
    if (frameTextRef.current === null || builtModeRef.current === mode) return
    builtModeRef.current = mode
    readyRef.current = false
    loadedRef.current = false
    setSrcDoc(frameDocument(frameTextRef.current, LOOK, { editing: mode === 'edit' }))
    say('info', mode === 'edit' ? 'Edit mode: changes are saved to the page file.' : 'Read mode: the page file cannot change.')
  }, [mode])

  /**
   * Post the page into the frame.
   *
   * READ MODE LOCKS EVERY ELEMENT it sends. The vendored frame draws the editor with no
   * `viewModeEnabled` switch and hides only its chrome, so an unlocked element is draggable
   * even when the panel would refuse to save it - a read-only canvas that lets the human move
   * a box and then throws the move away is worse than one that refuses the drag. `locked` is a
   * property of the COPY in the frame: nothing writes it back, and edit mode sends the file's
   * own elements.
   */
  const postLoad = React.useCallback(() => {
    const current = sceneRef.current
    if (current === null) return
    const appState = { gridSize: null, viewBackgroundColor: '#ffffff', ...(current.appState ?? {}) }
    const readOnly = modeRef.current !== 'edit'
    const elements = (Array.isArray(current.elements) ? current.elements : []).map(element => (
      readOnly ? { ...element, locked: true } : element
    ))
    iframeRef.current?.contentWindow?.postMessage({
      source: PANEL_SOURCE,
      type: 'load',
      scene: { elements, appState },
    }, '*')
  }, [])

  // A page switch, a tidy or a reload replaces the scene: re-frame it once the frame is ready.
  React.useEffect(() => {
    if (srcDoc === null || !readyRef.current) return
    loadedRef.current = false
    postLoad()
  }, [srcDoc, revision, postLoad])

  const flush = React.useCallback(async () => {
    const name = slugRef.current
    const pending = pendingRef.current
    if (name === null || pending === null || modeRef.current !== 'edit') return
    pendingRef.current = null
    setSaving(true)
    const base = sceneRef.current ?? blankScene(name)
    // The host re-reads the file before writing it (op 'save'): the elements are the human's,
    // the envelope and any field this payload does not carry survive.
    const result = await host.savePage(name, {
      elements: pending.elements,
      appState: pending.appState ?? base.appState,
      files: base.files ?? {},
    })
    setSaving(false)
    if (result?.ok !== true) {
      say('error', result?.error?.message ?? 'The page could not be saved.')
      return
    }
    setScene(current => (current === null ? current : { ...current, elements: pending.elements, appState: pending.appState ?? current.appState }))
    say('ok', `Saved ${result.value?.elements ?? pending.elements.length} element(s) to designmap/pages/${name}.excalidraw.`)
  }, [host])

  const schedule = React.useCallback((elements, appState) => {
    pendingRef.current = { elements, appState }
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { timerRef.current = null; flush() }, SAVE_DEBOUNCE_MS)
  }, [flush])

  React.useEffect(() => () => { if (timerRef.current !== null) clearTimeout(timerRef.current) }, [])

  React.useEffect(() => {
    const onMessage = event => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data
      if (data === null || typeof data !== 'object' || data.source !== FRAME_SOURCE) return
      if (data.type === 'ready') {
        readyRef.current = true
        loadedRef.current = false
        postLoad()
        return
      }
      if (data.type === 'loaded') {
        loadedRef.current = true
        // THE FRAME MUST OWN THE FOCUS BEFORE A DRAG. Measured with the panel harness: without a
        // click inside the frame first, Excalidraw selects the element on pointerdown and then
        // never moves it (the change it emits carries the unmoved element); one click inside the
        // frame makes the same drag move it (x 90 -> 190). Nothing in the panel ever focused the
        // frame, so edit mode focuses it as soon as the page is in - the human's first drag then
        // works instead of their second.
        if (modeRef.current === 'edit') iframeRef.current?.focus()
        return
      }
      if (data.type !== 'change') return
      // Read mode cannot write, and a change that lands before the page is loaded describes
      // the empty canvas rather than a human edit.
      if (modeRef.current !== 'edit' || !loadedRef.current) return
      schedule(Array.isArray(data.elements) ? data.elements : [], data.appState ?? {})
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [postLoad, schedule])

  const tidy = async () => {
    if (slug === null) return
    const result = await host.tidyPage(slug)
    if (result?.ok !== true) {
      say('error', result?.error?.message ?? 'Tidy failed.')
      return
    }
    const notes = Array.isArray(result.value?.notes) ? result.value.notes.join('; ') : 'tidied'
    const reloaded = await host.page(slug)
    if (reloaded?.ok === true) {
      setScene(reloaded.value?.scene ?? null)
      setRevision(value => value + 1)
    }
    say('ok', `Tidy: ${notes}`)
  }

  const render = async () => {
    if (slug === null) return
    const result = await host.renderPage(slug)
    if (result?.ok !== true) {
      say('error', result?.error?.message ?? 'The SVG render failed.')
      return
    }
    // One renderer: Excalidraw's own export in a headless browser, the same call map_render
    // makes. The PNG is always reported; the SVG is Excalidraw's export or its named reason.
    const png = result.value?.png
    const svg = result.value?.svg
    say('ok', `Rendered ${png?.width}x${png?.height} PNG (${png?.bytes} bytes)${svg?.path ? ` + SVG (${svg.bytes} bytes)` : `; SVG: ${svg?.reason ?? 'not produced'}`}`)
  }

  return (
    <div className="dmv">
      <header className="dmv-header">
        <h1 className="dmv-title">Design map</h1>
        <label className="dmv-field">
          <span>Page</span>
          <select
            value={slug ?? ''}
            onChange={event => { openPage(event.target.value) }}
            disabled={pages.length === 0}
          >
            {pages.length === 0 ? <option value="">no pages</option> : null}
            {pages.map(entry => (
              <option key={entry.page} value={entry.page}>
                {entry.page} — {entry.nodes} node(s), {entry.edges} edge(s)
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="dmv-button" onClick={() => {
          loadPages().then(list => { if (slug !== null && !list.some(entry => entry.page === slug)) openPage(list[0]?.page) })
        }}>Reload pages</button>
        <button
          type="button"
          className="dmv-button"
          aria-pressed={mode === 'edit'}
          onClick={() => setMode(current => (current === 'edit' ? 'read' : 'edit'))}
        >
          {mode === 'edit' ? 'Edit mode: on' : 'Edit mode: off'}
        </button>
        <button type="button" className="dmv-button" onClick={tidy} disabled={slug === null || mode !== 'edit'}>Tidy</button>
        <button type="button" className="dmv-button" onClick={render} disabled={slug === null}>Render PNG</button>
        <span className="dmv-status" role="status" data-kind={status.kind}>{saving ? 'Saving…' : status.message}</span>
      </header>
      <div className="dmv-stage">
        {srcDoc === null
          ? <div className="dmv-loading" role="status"><span className="pulse" aria-hidden="true" />Loading the canvas…</div>
          : (
            <iframe
              ref={iframeRef}
              className="dmv-excalidraw"
              title="Design map page"
              srcDoc={srcDoc}
              sandbox="allow-scripts"
              style={{ background: LOOK.surface }}
            />
          )}
      </div>
    </div>
  )
}

/** The P2 name, kept for the static harness and for anything that still imports it. */
export const DesignMapPageView = PageEditor
