/**
 * The page editor: the panel is an editor over designmap/pages/<slug>.excalidraw.
 *
 * THE PAGE IS ALWAYS EDITABLE. There is no read mode and no toggle: the frame is built in edit
 * mode once, a drag or a typed label is saved after the debounce, and the human can draw the
 * moment the page is in. The page file is the only store: nothing is cached across a reload
 * except what the frame holds in this tab.
 *
 * THE FIRST DRAG NEEDS THE FRAME TO OWN FOCUS. An iframe document that was never focused lets
 * Excalidraw select an injected element and never move it - the pointerdown selects, the move is
 * ignored, and no `change` is emitted. Measured by bisect in the previous build: a bare document
 * without our CSS fails the same way, and one click inside the frame flips the outcome. Edit mode
 * therefore focuses the frame as soon as the page is loaded, so a human's first drag is saved.
 *
 * THE VIEWPORT IS NOT CONTENT. Excalidraw emits a change for scroll and zoom too; saving those
 * would write the file on every pan. The save is scheduled only when the ELEMENTS differ from
 * the last loaded or saved ones, so the file changes when the drawing changes.
 *
 * THE READABILITY PANEL IS THE HUMAN HALF OF map_lint. "Check" asks the host for the same report
 * the agent gets; every finding that carries a ready repair can be applied from here, through
 * the same `/designmap` command the canvas saves through.
 */
import React from 'react'
import { loadFrameText, frameDocument, FRAME_SOURCE, PANEL_SOURCE } from './frame.js'

const SAVE_DEBOUNCE_MS = 500
/**
 * How long after a page is posted into the frame a change is treated as the frame's own load
 * echo, not as a human edit.
 *
 * MEASURED: the vendored frame emits `change` shortly after `loaded` even for a scene nobody
 * touched (Excalidraw normalizes the elements while loading them, so its own JSON comparison
 * fails), and the panel saved that echo. Harmless while it writes the same geometry - and
 * destructive when a Fix or Tidy command has just written a repaired file: the queued echo
 * save lands afterwards and puts the old scene back (measured 2026-11-27: n2 280 -> 60 -> 280
 * after one Fix click). The frame suppresses its own changes for 700 ms; this window also
 * covers the 450 ms change debounce.
 */
const LOAD_SETTLE_MS = 1500
const LOOK = { surface: '#ffffff' }
const MAX_SHOWN_FINDINGS = 30

function blankScene(page) {
  return { type: 'excalidraw', version: 2, elements: [], appState: { gridSize: null, viewBackgroundColor: '#ffffff' }, files: {}, page }
}

function repairIsReady(repair) {
  if (repair === null || typeof repair !== 'object' || typeof repair.op !== 'string') return false
  return !Object.values(repair).some((value) => typeof value === 'string' && value.includes('<'))
}

export function PageEditor({ host }) {
  const [pages, setPages] = React.useState([])
  const [slug, setSlug] = React.useState(null)
  const [scene, setScene] = React.useState(null)
  const [revision, setRevision] = React.useState(0)
  const [status, setStatus] = React.useState({ kind: 'info', message: 'Loading the pages…' })
  const [saving, setSaving] = React.useState(false)
  const [srcDoc, setSrcDoc] = React.useState(null)
  const [lint, setLint] = React.useState(null)
  const [showLint, setShowLint] = React.useState(true)
  const [expanded, setExpanded] = React.useState(false)

  const rootRef = React.useRef(null)
  const iframeRef = React.useRef(null)
  const frameTextRef = React.useRef(null)
  const readyRef = React.useRef(false)
  const loadedRef = React.useRef(false)
  const loadedAtRef = React.useRef(0)
  const pendingRef = React.useRef(null)
  const timerRef = React.useRef(null)
  const slugRef = React.useRef(slug)
  const sceneRef = React.useRef(scene)
  const signatureRef = React.useRef('')
  slugRef.current = slug
  sceneRef.current = scene

  const say = (kind, message) => setStatus({ kind, message })

  /**
   * Hand the keyboard/pointer to the canvas.
   *
   * AN IFRAME THAT DOES NOT OWN FOCUS DRAWS NOTHING. Measured: Excalidraw selects an injected
   * element on pointerdown and never moves it until the frame document itself has focus. The
   * page load focuses the frame, but a toolbar button (Full screen, Check, Tidy, Render) moves
   * the focus to that button, and the next drag then fails - measured 2026-11-27: after
   * entering full screen the first drag moved nothing. Every action that returns the human to
   * the canvas gives the focus back.
   */
  const focusFrame = React.useCallback(() => {
    try { iframeRef.current?.focus() } catch { /* a frame that is not mounted cannot take focus */ }
  }, [])

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

  const checkPage = React.useCallback(async name => {
    if (typeof host.lintPage !== 'function') return null
    const target = typeof name === 'string' && name !== '' ? name : slugRef.current
    if (target === null || target === '') return null
    const result = await host.lintPage(target)
    if (result?.ok !== true) {
      say('error', result?.error?.message ?? 'The readability check failed.')
      return null
    }
    setLint({ ...result.value, page: target })
    focusFrame()
    return result.value
  }, [host])

  const flush = React.useCallback(async () => {
    const name = slugRef.current
    const pending = pendingRef.current
    if (name === null || pending === null) return
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
    signatureRef.current = JSON.stringify(pending.elements)
    setScene(current => (current === null ? current : { ...current, elements: pending.elements, appState: pending.appState ?? current.appState }))
    const report = await checkPage(name)
    say('ok', `Saved ${result.value?.elements ?? pending.elements.length} element(s)${report === null ? '' : ` · readability ${report.score}/100 ${report.verdict}`}`)
  }, [host, checkPage])

  const openPage = React.useCallback(async name => {
    if (typeof name !== 'string' || name === '') return
    // Flush the page being left BEFORE the slug moves: a pending edit belongs to the page it
    // was drawn on, and writing it after the switch would send it to the new file.
    if (pendingRef.current !== null) await flush()
    const result = await host.page(name)
    if (result?.ok !== true) {
      say('error', result?.error?.message ?? `Page "${name}" could not be read.`)
      return
    }
    const loaded = result.value?.scene ?? blankScene(name)
    setSlug(name)
    setScene(loaded)
    setRevision(value => value + 1)
    setLint(null)
    say('info', `designmap/pages/${name}.excalidraw`)
    if (typeof host.lintPage === 'function') {
      const report = await host.lintPage(name)
      if (report?.ok === true) setLint({ ...report.value, page: name })
    }
  }, [host, flush])

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

  // The frame bundle is fetched once; the DOCUMENT is built once, in edit mode, because the page
  // is always editable.
  React.useEffect(() => {
    let alive = true
    loadFrameText()
      .then(text => {
        if (!alive) return
        frameTextRef.current = text
        setSrcDoc(frameDocument(text, LOOK))
      })
      .catch(error => { if (alive) say('error', `The Excalidraw frame did not load: ${error?.message ?? error}`) })
    return () => { alive = false }
  }, [])

  /**
   * Post the page into the frame.
   *
   * Every element of the file is sent unlocked: the canvas is an editor. A frame that refuses a
   * write (no command) reports it as a status; it does not make the canvas read-only behind the
   * human's back.
   */
  const postLoad = React.useCallback(() => {
    // A queued save belongs to the scene being replaced: drop it before posting the new one.
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
    pendingRef.current = null
    const current = sceneRef.current
    if (current === null) return
    const appState = { gridSize: null, viewBackgroundColor: '#ffffff', ...(current.appState ?? {}) }
    const elements = Array.isArray(current.elements) ? current.elements : []
    signatureRef.current = JSON.stringify(elements)
    iframeRef.current?.contentWindow?.postMessage({
      source: PANEL_SOURCE,
      type: 'load',
      scene: { elements, appState },
    }, '*')
  }, [])

  // A page switch, a fix or a reload replaces the scene: re-frame it once the frame is ready.
  React.useEffect(() => {
    if (srcDoc === null || !readyRef.current) return
    loadedRef.current = false
    postLoad()
  }, [srcDoc, revision, postLoad])

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
        loadedAtRef.current = Date.now()
        focusFrame()
        return
      }
      if (data.type !== 'change') return
      // A change that lands before the page is loaded describes the empty canvas rather than a
      // human edit; one that lands inside the settle window is the frame's own load echo.
      if (!loadedRef.current) return
      if (Date.now() - loadedAtRef.current < LOAD_SETTLE_MS) return
      const elements = Array.isArray(data.elements) ? data.elements : []
      // Scroll and zoom emit a change too. They are not content: only a different ELEMENT LIST
      // is worth a write.
      const signature = JSON.stringify(elements)
      if (signature === signatureRef.current) return
      schedule(elements, data.appState ?? {})
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [postLoad, schedule])

  React.useEffect(() => {
    const onFullscreen = () => {
      setExpanded(document.fullscreenElement === rootRef.current)
      // Entering or leaving full screen moves the layout under the pointer; give the canvas
      // the focus back once the new size has been laid out.
      window.setTimeout(focusFrame, 50)
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [focusFrame])

  const toggleExpand = async () => {
    try {
      if (document.fullscreenElement === rootRef.current) {
        await document.exitFullscreen()
      } else if (typeof rootRef.current?.requestFullscreen === 'function') {
        await rootRef.current.requestFullscreen()
      } else {
        say('error', 'This browser does not support full screen.')
      }
    } catch (error) {
      say('error', `Full screen failed: ${error?.message ?? error}`)
    }
    window.setTimeout(focusFrame, 60)
  }

  /** Re-read the page after a write made through the command (tidy, fix). */
  const reloadScene = async name => {
    const reloaded = await host.page(name)
    if (reloaded?.ok !== true) {
      say('error', reloaded?.error?.message ?? 'The page could not be reloaded.')
      return
    }
    setScene(reloaded.value?.scene ?? null)
    setRevision(value => value + 1)
  }

  const tidy = async () => {
    if (slug === null) return
    pendingRef.current = null
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
    const result = await host.tidyPage(slug)
    if (result?.ok !== true) {
      say('error', result?.error?.message ?? 'Tidy failed.')
      return
    }
    const notes = Array.isArray(result.value?.notes) ? result.value.notes.join('; ') : 'tidied'
    await reloadScene(slug)
    const report = await checkPage(slug)
    say('ok', `Tidy: ${notes}${report === null ? '' : ` · readability ${report.score}/100 ${report.verdict}`}`)
  }

  const render = async () => {
    if (slug === null) return
    const result = await host.renderPage(slug)
    if (result?.ok !== true) {
      say('error', result?.error?.message ?? 'The SVG render failed.')
      return
    }
    const png = result.value?.png
    const svg = result.value?.svg
    say('ok', `Rendered ${png?.width}x${png?.height} PNG (${png?.bytes} bytes)${svg?.path ? ` + SVG (${svg.bytes} bytes)` : `; SVG: ${svg?.reason ?? 'not produced'}`}`)
    focusFrame()
  }

  const applyFix = async finding => {
    if (slug === null) return
    if (!repairIsReady(finding?.repair) || typeof host.edit !== 'function') {
      say('info', 'This finding has no ready repair; use Tidy or move the box on the canvas.')
      return
    }
    // The repair is about to replace the scene; a queued save of the scene it replaces would
    // undo it the moment its timer fires.
    pendingRef.current = null
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
    const result = await host.edit({ ...finding.repair, page: slug })
    if (result?.ok !== true) {
      say('error', result?.error?.message ?? 'The repair could not be applied.')
      return
    }
    await reloadScene(slug)
    const report = await checkPage(slug)
    const notes = Array.isArray(result.value?.notes) ? result.value.notes.join('; ') : ''
    say('ok', `Fixed ${finding.code}${notes === '' ? '' : ` (${notes})`}${report === null ? '' : ` · readability ${report.score}/100 ${report.verdict}`}`)
  }

  const findings = Array.isArray(lint?.findings) ? lint.findings : []
  const visible = findings.slice(0, MAX_SHOWN_FINDINGS)

  return (
    <div className="dmv" ref={rootRef} data-expanded={expanded ? 'true' : 'false'}>
      <header className="dmv-toolbar">
        <h1 className="dmv-title">Design map</h1>
        <label className="dmv-page">
          <span className="dmv-label">Page</span>
          <select
            className="dmv-select"
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
        <button type="button" className="dmv-btn" onClick={() => {
          loadPages().then(list => { if (slug !== null && !list.some(entry => entry.page === slug)) openPage(list[0]?.page) })
        }}>Reload</button>
        <button type="button" className="dmv-btn" onClick={() => checkPage()} disabled={slug === null || typeof host.lintPage !== 'function'}>Check</button>
        <button type="button" className="dmv-btn" onClick={tidy} disabled={slug === null}>Tidy</button>
        <button type="button" className="dmv-btn" onClick={render} disabled={slug === null}>Render</button>
        {lint === null ? null : (
          <button
            type="button"
            className={`dmv-chip ${findings.length === 0 ? 'ok' : lint.score >= 85 ? 'warn' : 'bad'}`}
            onClick={() => setShowLint(value => !value)}
            aria-expanded={showLint && findings.length > 0}
            title={findings.length === 0 ? 'The readability check found nothing' : 'Show or hide the readability findings'}
          >
            {lint.score}/100 {lint.verdict}
          </button>
        )}
        <span className="dmv-spacer" />
        <button type="button" className="dmv-btn" onClick={toggleExpand} aria-pressed={expanded}>
          {expanded ? 'Exit full screen' : 'Full screen'}
        </button>
        <span className="dmv-status" role="status" data-kind={status.kind}>{saving ? 'Saving…' : status.message}</span>
      </header>
      <div className="dmv-stage">
        {srcDoc === null
          ? <div className="dmv-loading" role="status"><span className="pulse" aria-hidden="true" />Loading the canvas…</div>
          : (
            <iframe
              ref={iframeRef}
              className="dmv-frame"
              title="Design map page"
              srcDoc={srcDoc}
              sandbox="allow-scripts"
              style={{ background: LOOK.surface }}
            />
          )}
      </div>
      {showLint && findings.length > 0 ? (
        <section className="dmv-lint" aria-label="Readability findings">
          <div className="dmv-lint-head">
            <h2>Readability {lint.score}/100 · {lint.verdict}</h2>
            <span>{lint.counts?.high ?? 0} high · {lint.counts?.medium ?? 0} medium · {lint.counts?.low ?? 0} low</span>
            <span className="dmv-spacer" />
            <button type="button" className="dmv-btn small" onClick={() => setShowLint(false)}>Hide</button>
          </div>
          <ul>
            {visible.map((finding, index) => (
              <li key={`${finding.code}-${index}`} className={`dmv-finding ${finding.severity}`}>
                <div className="dmv-finding-head">
                  <code>{finding.code}</code>
                  <span className="dmv-finding-elements">{Array.isArray(finding.elements) ? finding.elements.join(', ') : ''}</span>
                  {repairIsReady(finding.repair) && typeof host.edit === 'function'
                    ? <button type="button" className="dmv-btn small" onClick={() => applyFix(finding)}>Fix</button>
                    : null}
                </div>
                <p>{finding.message}</p>
              </li>
            ))}
          </ul>
          {findings.length > MAX_SHOWN_FINDINGS ? <p className="dmv-more">… {findings.length - MAX_SHOWN_FINDINGS} more; the host's map_lint lists them all.</p> : null}
        </section>
      ) : null}
    </div>
  )
}

/** The P2 name, kept for the static harness and for anything that still imports it. */
export const DesignMapPageView = PageEditor
