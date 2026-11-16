/**
 * The designmap panel. M1 draws; M2 adds an explicit edit mode for the human's visual
 * overlay layer.
 *
 * Input: `{ views: [{ view, scene, meta }], rootId, overlays: {rows, path} }`, where
 * `view` is navigation metadata, `scene` is CT-SCENE JSON and `meta` is the render
 * envelope. Everything drawn is copied from `scene`; the renderer never computes
 * geometry and never writes model fields.
 *
 * Edit mode (off by default):
 *   - dragging a node / picking a palette colour updates local state immediately and
 *     writes one overlay row delta after a 500 ms debounce;
 *   - `nodeMoved {nodeId,x,y}` / `colorChanged {nodeId,fill?,stroke?}` are emitted to
 *     the host; reset emits `nodeReset {nodeId}` / `viewReset {viewId}`;
 *   - the host command is the only writer (`/designmap {op:'overlay',…}`); the client
 *     refuses anything that is not x/y/fill/stroke with `model_fields_forbidden`;
 *   - reset and undo re-run the host renderer so the scene's layout position comes
 *     back, then reload the scenes and overlays.
 *
 * Read-only events (always): drillDown, viewChanged, openSource.
 */
import React from 'react'
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ViewportPortal,
  useNodes,
} from '@xyflow/react'
import {
  PALETTE,
  assertScene,
  edgeAriaLabel,
  edgeStyleFor,
  groupAriaLabel,
  isEmptyScene,
  legendEdgeKinds,
  legendNodeTypes,
  nodeAriaLabel,
  paletteFor,
  searchSceneNodes,
} from './scene.js'
import { ExcalidrawCanvas } from './canvas.jsx'
import { isDarkSurface } from './excalidraw.js'

const NODE_TYPES = { scene: SceneNode }
const EDGE_TYPES = { sceneEdge: SceneEdge }
const FOCUSABLE_SELECTOR = '.react-flow__node, .react-flow__edge, button, input, a'
const DEBOUNCE_MS = 500
const OVERLAY_FIELDS = ['x', 'y', 'fill', 'stroke']
const round2 = (value) => Math.round(value * 100) / 100

function SceneNode({ data }) {
  const node = data.node
  const base = paletteFor(node.type)
  const fill = data.fill ?? base.fill
  const stroke = data.stroke ?? base.stroke
  const shape = node.type === 'datastore' ? 'shape-ellipse' : node.type === 'external' ? 'shape-dashed' : ''
  return (
    <div className={`dmv-node ${shape}`} style={{ background: fill, borderColor: stroke }}>
      {/* React Flow only draws an edge when both endpoints have registered handles.
          The edge path itself comes from the scene's points, not these anchors. */}
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none' }} />
      <span className="dmv-node-label">{node.label}</span>
      {node.stale === true ? (
        <span className="dmv-stale" title="Source changed since this scene was rendered">stale</span>
      ) : null}
      {data.edited === true ? <span className="dmv-edited" title="This node has an overlay row">edited</span> : null}
      {node.source ? <span className="dmv-open-hint" aria-hidden="true">↗</span> : null}
    </div>
  )
}

/** An edge drawn exactly through core's `points`; its label sits at core's `labelAt`.
 *  While a node is dragged, its incident endpoints follow the live position so the
 *  edge does not detach; the polyline is offset, never re-routed. The label plate is
 *  core's `labelBox` rectangle (same contract as the Excalidraw renderer): the fallback
 *  must not re-measure or re-wrap, or a frame failure would quietly break the geometry
 *  the scene was validated against. */
function SceneEdge({ id, data, markerEnd, style }) {
  const nodes = useNodes()
  const live = (nodeId) => nodes.find((node) => node.id === nodeId)?.position
  const source = live(data.origin.from.id)
  const target = live(data.origin.to.id)
  const dx = source === undefined ? 0 : source.x - data.origin.from.x
  const dy = source === undefined ? 0 : source.y - data.origin.from.y
  const tx = target === undefined ? 0 : target.x - data.origin.to.x
  const ty = target === undefined ? 0 : target.y - data.origin.to.y
  const last = data.points.length - 1
  const points = data.points.map((point, index) => ({
    x: point.x + (index === 0 ? dx : 0) + (index === last ? tx : 0),
    y: point.y + (index === 0 ? dy : 0) + (index === last ? ty : 0),
  }))
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  return (
    <>
      <BaseEdge id={`${id}-path`} path={path} markerEnd={markerEnd} style={style} interactionWidth={12} />
      <EdgeLabelRenderer>
        <div
          className="dmv-edge-label"
          style={{
            transform: `translate(${data.labelBox.x}px, ${data.labelBox.y}px)`,
            width: `${data.labelBox.w}px`,
            height: `${data.labelBox.h}px`,
          }}
          title={data.label}
        >
          {data.labelLines.join('\n')}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

function Legend({ scene, editMode, zoom, onFit }) {
  const nodeTypes = legendNodeTypes(scene)
  const edgeKinds = legendEdgeKinds(scene)
  const nodeCounts = React.useMemo(() => {
    const counts = new Map()
    for (const node of scene.nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
    return counts
  }, [scene])
  const edgeCounts = React.useMemo(() => {
    const counts = new Map()
    for (const edge of scene.edges) counts.set(edge.kind, (counts.get(edge.kind) ?? 0) + 1)
    return counts
  }, [scene])
  return (
    <div className="dmv-legend-bar" role="group" aria-label="Legend">
      <span className="dmv-legend-title">Legend</span>
      <ul className="dmv-legend-group">
        {nodeTypes.map((type) => {
          const look = paletteFor(type)
          const shape = type === 'datastore' ? 'ellipse' : type === 'external' ? 'dashed' : type === 'decision' ? 'diamond' : ''
          return (
            <li key={type} className="dmv-legend-item">
              <span className={`dmv-glyph ${shape}`} style={{ background: look.fill, borderColor: look.stroke }} aria-hidden="true" />
              <span>{type}</span>
              <b>{nodeCounts.get(type) ?? 0}</b>
            </li>
          )
        })}
      </ul>
      <span className="dmv-legend-sep" aria-hidden="true" />
      <ul className="dmv-legend-group">
        {edgeKinds.map((kind) => {
          const look = edgeStyleFor(kind)
          const lineStyle = kind === 'async' ? 'dashed' : kind === 'data' ? 'dotted' : 'solid'
          return (
            <li key={kind} className="dmv-legend-item">
              <span className="dmv-wire" style={{ borderTopColor: look.stroke, borderTopStyle: lineStyle }} aria-hidden="true" />
              <span>{kind}</span>
              <b>{edgeCounts.get(kind) ?? 0}</b>
            </li>
          )
        })}
      </ul>
      <span className="dmv-spacer" />
      {editMode ? <span className="dmv-legend-hint">drag a node to move it</span> : null}
      {onFit === undefined ? null : (
        <button type="button" className="dmv-btn dmv-fit" onClick={onFit} title="Fit the whole map in the canvas">
          ⤢ Fit{Number.isFinite(zoom) ? ` · ${zoom.toFixed(2)}×` : ''}
        </button>
      )}
    </div>
  )
}

function NodeInspector({ node, colours, overlayRow, pending, onColour, onReset, onOpen }) {
  return (
    <section className="dmv-inspector" aria-label="Selected node">
      <h2>Selected node</h2>
      {node === null ? (
        <p className="dmv-inspector-hint">Select a node on the canvas to recolour or reset it.</p>
      ) : (
        <>
          <p className="dmv-inspector-name">
            {node.label} <code>{node.id}</code>
          </p>
          <p className="dmv-inspector-hint">
            {overlayRow ? 'Overlay row present' : 'No overlay row'} · {pending ? 'saving…' : 'saved'}
          </p>
          <p className="dmv-inspector-hint">Arrow keys nudge 8 px (Shift 1 px).</p>
          <div className="dmv-swatches" role="group" aria-label="Node colour">
            {Object.entries(PALETTE).map(([type, look]) => {
              const pressed = colours !== undefined && colours.fill === look.fill && colours.stroke === look.stroke
              return (
                <button
                  key={type}
                  type="button"
                  className="dmv-swatch-btn"
                  style={{ background: look.fill, borderColor: look.stroke }}
                  aria-label={`Use ${type} colours`}
                  aria-pressed={pressed}
                  title={`${type} colours`}
                  onClick={() => onColour(type)}
                >
                  <span className="dmv-visually-hidden">{type}</span>
                </button>
              )
            })}
          </div>
          <div className="dmv-inspector-actions">
            <button type="button" className="dmv-btn" onClick={onOpen} disabled={!node.source}>
              Open source
            </button>
            <button type="button" className="dmv-btn" onClick={onReset} disabled={!overlayRow}>
              Reset node
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function Breadcrumb({ history, onNavigate }) {
  return (
    <nav className="dmv-crumbs" aria-label="View breadcrumb">
      <ol className="dmv-crumb-list">
        {history.map((view, index) => {
          const current = index === history.length - 1
          return (
            <li key={`${view.viewId}-${index}`}>
              {current ? (
                <span className="dmv-crumb" aria-current="page">{view.title || view.viewId}</span>
              ) : (
                <button type="button" className="dmv-crumb" onClick={() => onNavigate(view)} title={`Go to ${view.title || view.viewId}`}>
                  {view.title || view.viewId}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

function formatTimestamp(value) {
  if (typeof value !== 'string' || value === '') return 'not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z')
}

function shortHash(value) {
  if (typeof value !== 'string' || value === '') return 'not recorded'
  const bare = value.startsWith('sha256:') ? value.slice(7) : value
  return `${value.startsWith('sha256:') ? 'sha256:' : ''}${bare.slice(0, 12)}…`
}

const shortCommit = (value) => (typeof value !== 'string' || value === '' ? 'not recorded' : value.slice(0, 7))

export function DesignMapView({ host, initial = null, title = 'Design map' }) {
  const [sceneSet, setSceneSet] = React.useState(initial)
  const [loading, setLoading] = React.useState(initial === null)
  const [loadError, setLoadError] = React.useState(null)
  const [missing, setMissing] = React.useState(false)
  const [current, setCurrent] = React.useState(
    initial === null ? null : initial.views.find((view) => view.view.viewId === initial.rootId) ?? initial.views[0] ?? null,
  )
  const [history, setHistory] = React.useState(initial === null ? [] : current === null ? [] : [current.view])
  const [query, setQuery] = React.useState('')
  const [status, setStatus] = React.useState(null)
  const [zoom, setZoom] = React.useState(1)
  const [zoomSource, setZoomSource] = React.useState('flow')
  const [fitSignal, setFitSignal] = React.useState(0)
  const [look, setLook] = React.useState(null)
  const [editMode, setEditMode] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState(null)
  const [positions, setPositions] = React.useState({})
  const [colours, setColours] = React.useState({})
  const [overlays, setOverlays] = React.useState({})
  // The Excalidraw canvas is the drawing surface; React Flow stays as the fallback when
  // the frame cannot load, so a frame failure degrades to a working read-only map.
  const [canvasFailed, setCanvasFailed] = React.useState(false)
  const rootRef = React.useRef(null)

  /** The canvas is a separate document: its colours come from the panel's live theme. */
  React.useEffect(() => {
    const read = () => {
      const element = rootRef.current
      if (element === null) return
      const styles = getComputedStyle(element)
      const pick = (name, fallback) => (styles.getPropertyValue(name) ?? '').trim() || fallback
      const next = {
        surface: pick('--dmv-surface', '#ffffff'),
        surface2: pick('--dmv-surface-2', '#f8fafc'),
        ink: pick('--dmv-ink', '#0f172a'),
        muted: pick('--dmv-muted', '#475569'),
        line: pick('--dmv-line', '#e2e8f0'),
      }
      // The host's brand colour is often a BRIGHT accent in a dark theme, so a primary
      // button painted with it cannot assume a white label: derive the on-accent ink
      // from the accent itself or the label disappears (a blank white box in the header).
      const accent = pick('--dmv-accent', '#2563eb')
      element.style.setProperty('--dmv-accent-ink', isDarkSurface(accent) ? '#ffffff' : '#0b0f14')
      setLook((previous) => (previous !== null
        && previous.surface === next.surface
        && previous.surface2 === next.surface2
        && previous.ink === next.ink
        && previous.muted === next.muted
        && previous.line === next.line
        ? previous
        : next))
    }
    read()
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener?.('change', read)
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(read)
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
    return () => {
      media?.removeEventListener?.('change', read)
      observer?.disconnect()
    }
  }, [])

  const onCanvasViewport = React.useCallback((viewport) => {
    if (!Number.isFinite(viewport?.zoom)) return
    setZoom(viewport.zoom)
    setZoomSource('canvas')
  }, [])
  const onCanvasDelta = React.useCallback(
    async (delta) => {
      for (const [nodeId, row] of Object.entries(delta)) {
        const result = await host.writeOverlay({ action: 'upsert', nodeId, ...row })
        if (result?.ok === true) {
          setOverlays((previous) => ({ ...previous, [nodeId]: { ...(previous[nodeId] ?? {}), ...row } }))
          setStatus({ kind: 'info', code: 'overlay.written', message: `Saved ${Object.keys(row).join('+')} for ${nodeId}.` })
        } else {
          setStatus({
            kind: 'error',
            code: result?.error?.code ?? 'overlay_write_failed',
            message: result?.error?.message ?? 'The host refused the overlay write.',
          })
        }
      }
    },
    [host],
  )
  const [undoStack, setUndoStack] = React.useState([])
  const [pendingCount, setPendingCount] = React.useState(0)

  const flowRef = React.useRef(null)
  const searchRef = React.useRef(null)
  const viewTitleRef = React.useRef(null)
  const previousViewId = React.useRef(null)
  const pendingRef = React.useRef(new Map())
  const currentRef = React.useRef(current)
  const historyRef = React.useRef(history)
  const overlaysRef = React.useRef(overlays)
  const positionsRef = React.useRef(positions)
  const coloursRef = React.useRef(colours)
  const editRef = React.useRef(editMode)
  const undoRef = React.useRef(undoStack)
  const lastWriteRef = React.useRef(null)
  currentRef.current = current
  historyRef.current = history
  overlaysRef.current = overlays
  positionsRef.current = positions
  coloursRef.current = colours
  editRef.current = editMode
  undoRef.current = undoStack

  const emit = React.useCallback(
    (event) => {
      try {
        host.onEvent?.(event)
      } catch {
        // Telemetry must never break the panel.
      }
    },
    [host],
  )

  const applyViewState = React.useCallback((entry, { preserveSelection = false } = {}) => {
    const rows = overlaysRef.current
    const nextPositions = {}
    const nextColours = {}
    for (const node of entry.scene.nodes) {
      const row = rows[node.id]
      // The overlay position is the human's visual state; until the host re-renders, the
      // scene still carries the layout position, so the panel displays the overlay row.
      nextPositions[node.id] = row?.x !== undefined && row?.y !== undefined ? { x: row.x, y: row.y } : { x: node.x, y: node.y }
      if (row !== undefined && (row.fill !== undefined || row.stroke !== undefined)) {
        const base = paletteFor(node.type)
        nextColours[node.id] = { fill: row.fill ?? base.fill, stroke: row.stroke ?? base.stroke }
      }
    }
    setPositions(nextPositions)
    setColours(nextColours)
    if (!preserveSelection) setSelectedId(null)
  }, [])

  const adoptLoaded = React.useCallback(
    (result, preferredViewId = null, { preserveSelection = false } = {}) => {
      const rows = result.value.overlays?.rows ?? {}
      overlaysRef.current = rows
      setOverlays(rows)
      const views = result.value.views
      const next =
        views.find((view) => view.view.viewId === preferredViewId) ??
        views.find((view) => view.view.viewId === result.value.rootId) ??
        views[0]
      setSceneSet(result.value)
      setCurrent(next)
      setMissing(false)
      const mappedHistory = historyRef.current
        .map((entry) => views.find((view) => view.view.viewId === entry.viewId)?.view)
        .filter((entry) => entry !== undefined)
      setHistory(mappedHistory.length > 0 ? mappedHistory : [next.view])
      applyViewState(next, { preserveSelection })
      return next
    },
    [applyViewState],
  )

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const result = await host.load()
    if (result?.ok !== true) {
      setLoadError(result?.error ?? { code: 'load_failed', message: 'The host did not return a scene set.' })
      setLoading(false)
      return
    }
    if (Array.isArray(result.value.views) && result.value.views.length === 0 && result.value.missing === true) {
      setSceneSet(result.value)
      setCurrent(null)
      setMissing(true)
      setQuery('')
      setStatus(null)
      setLoading(false)
      return
    }
    adoptLoaded(result)
    setQuery('')
    setStatus(null)
    setLoading(false)
  }, [host, adoptLoaded])

  React.useEffect(() => {
    if (initial !== null) return
    let alive = true
    ;(async () => {
      setLoading(true)
      const result = await host.load()
      if (!alive) return
      if (result?.ok !== true) {
        setLoadError(result?.error ?? { code: 'load_failed', message: 'The host did not return a scene set.' })
        setLoading(false)
        return
      }
      adoptLoaded(result)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [host, initial, adoptLoaded])

  const scene = current?.scene ?? null
  const meta = current?.meta ?? {}
  const canWrite = host.canWrite !== false
  const matches = React.useMemo(() => (scene === null ? [] : searchSceneNodes(scene.nodes, query)), [scene, query])
  const matchIds = React.useMemo(() => new Set(matches.map((node) => node.id)), [matches])

  const fit = React.useCallback(() => {
    // The canvas frames itself from the scene's canvas box; React Flow only exists as the
    // fallback, so the same control drives whichever surface is mounted.
    if (!canvasFailed) {
      setFitSignal((value) => value + 1)
      return
    }
    const instance = flowRef.current
    if (instance === null) return
    requestAnimationFrame(() => instance.fitView({ padding: 0.16, maxZoom: 1.5, duration: 0 }))
  }, [canvasFailed])

  React.useEffect(() => {
    fit()
    const viewId = current?.view.viewId ?? null
    if (previousViewId.current !== null && previousViewId.current !== viewId) {
      viewTitleRef.current?.focus?.()
    }
    previousViewId.current = viewId
  }, [current?.view.viewId, fit])

  const onInit = React.useCallback((instance) => {
    flowRef.current = instance
    requestAnimationFrame(() => instance.fitView({ padding: 0.16, maxZoom: 1.5, duration: 0 }))
  }, [])

  const revertNode = React.useCallback((nodeId, before) => {
    const node = currentRef.current?.scene.nodes.find((entry) => entry.id === nodeId)
    if (node === undefined) return
    setPositions((previous) => ({
      ...previous,
      [nodeId]:
        before?.x !== undefined && before?.y !== undefined ? { x: before.x, y: before.y } : { x: node.x, y: node.y },
    }))
    setColours((previous) => {
      const next = { ...previous }
      const base = paletteFor(node.type)
      if (before?.fill !== undefined || before?.stroke !== undefined) {
        next[nodeId] = { fill: before.fill ?? base.fill, stroke: before.stroke ?? base.stroke }
      } else {
        delete next[nodeId]
      }
      return next
    })
  }, [])

  const writeNow = React.useCallback(
    async (nodeId, payload, before) => {
      const result = await host.writeOverlay({ action: 'upsert', nodeId, ...payload })
      if (result?.ok !== true) {
        revertNode(nodeId, before)
        setStatus({
          kind: 'error',
          code: result?.error?.code ?? 'overlay_write_failed',
          message: result?.error?.message ?? 'The host refused the overlay write.',
        })
        return result
      }
      const after = { ...(before ?? {}), ...payload }
      setOverlays((previous) => {
        const next = { ...previous, [nodeId]: after }
        overlaysRef.current = next
        return next
      })
      setUndoStack((previous) => {
        const next = [...previous, { kind: 'upsert', nodeId, before, after }]
        undoRef.current = next
        return next
      })
      lastWriteRef.current = { at: Date.now(), nodeId, payload, result: result.value }
      setStatus({ kind: 'ok', code: 'overlay.write', message: `Saved ${OVERLAY_FIELDS.filter((key) => payload[key] !== undefined).join('/')} for ${nodeId}.` })
      return result
    },
    [host, revertNode],
  )

  const scheduleWrite = React.useCallback(
    (nodeId, patch) => {
      if (!editRef.current) return
      const existing = pendingRef.current.get(nodeId)
      if (existing?.timer !== undefined) clearTimeout(existing.timer)
      const before = existing?.before ?? overlaysRef.current[nodeId] ?? null
      const payload = { ...(existing?.payload ?? {}), ...patch }
      const timer = setTimeout(() => {
        pendingRef.current.delete(nodeId)
        setPendingCount(pendingRef.current.size)
        writeNow(nodeId, payload, before)
      }, DEBOUNCE_MS)
      pendingRef.current.set(nodeId, { timer, payload, before })
      setPendingCount(pendingRef.current.size)
    },
    [writeNow],
  )

  const flushPending = React.useCallback(async () => {
    const entries = [...pendingRef.current.entries()]
    for (const [nodeId, entry] of entries) {
      clearTimeout(entry.timer)
      pendingRef.current.delete(nodeId)
      await writeNow(nodeId, entry.payload, entry.before)
    }
    setPendingCount(0)
  }, [writeNow])

  const refreshInPlace = React.useCallback(
    async ({ render = true } = {}) => {
      if (render && typeof host.renderViews === 'function') {
        const rendered = await host.renderViews()
        if (rendered?.ok !== true) {
          setStatus({
            kind: 'error',
            code: rendered?.error?.code ?? 'render_failed',
            message: rendered?.error?.message ?? 'The host could not re-render the scene.',
          })
          return rendered
        }
      }
      const result = await host.load()
      if (result?.ok !== true) {
        setStatus({
          kind: 'error',
          code: result?.error?.code ?? 'reload_failed',
          message: result?.error?.message ?? 'The host could not reload the scene set.',
        })
        return result
      }
      adoptLoaded(result, currentRef.current?.view.viewId ?? null, { preserveSelection: true })
      return result
    },
    [host, adoptLoaded],
  )

  const openSource = React.useCallback(
    async (node) => {
      emit({ type: 'openSource', nodeId: node.id })
      if (typeof node.source !== 'string' || node.source === '') {
        setStatus({ kind: 'error', code: 'source_missing', message: `${node.label} has no source path in this scene.` })
        return
      }
      const result = await host.openSource(node)
      if (result?.ok === true) {
        setStatus({ kind: 'ok', code: 'opened', message: `Opened ${node.source}` })
      } else {
        setStatus({
          kind: 'error',
          code: result?.error?.code ?? 'open_failed',
          message: result?.error?.message ?? 'The host could not open this source.',
        })
      }
    },
    [host, emit],
  )

  const findChild = React.useCallback(
    (groupId) => {
      if (sceneSet === null || current === null) return null
      return (
        sceneSet.views.find(
          (view) => view.view.parentGroupId === groupId && view.view.viewId !== current.view.viewId && !history.some((entry) => entry.viewId === view.view.viewId),
        ) ?? null
      )
    },
    [sceneSet, current, history],
  )

  const drill = React.useCallback(
    async (group) => {
      if (sceneSet === null || current === null) return
      await flushPending()
      const child = findChild(group.id)
      if (child === null) {
        if (sceneSet.views.some((view) => view.view.parentGroupId === group.id)) return
        setStatus({
          kind: 'error',
          code: 'no_child_view',
          message: `No child view is registered for group "${group.label || group.id}".`,
        })
        return
      }
      emit({ type: 'drillDown', groupId: group.id })
      setHistory((previous) => [...previous, child.view])
      setCurrent(child)
      setQuery('')
      setStatus(null)
      applyViewState(child)
    },
    [sceneSet, current, findChild, flushPending, emit, applyViewState],
  )

  const navigate = React.useCallback(
    async (view) => {
      if (current === null || view.viewId === current.view.viewId) return
      await flushPending()
      emit({ type: 'viewChanged', viewId: view.viewId })
      const index = history.findIndex((entry) => entry.viewId === view.viewId)
      const target = sceneSet?.views.find((entry) => entry.view.viewId === view.viewId)
      if (target === undefined) {
        setStatus({ kind: 'error', code: 'unknown_view', message: `The host did not supply view "${view.viewId}".` })
        return
      }
      setHistory(index === -1 ? [target.view] : history.slice(0, index + 1))
      setCurrent(target)
      setQuery('')
      setStatus(null)
      applyViewState(target)
    },
    [current, history, sceneSet, flushPending, emit, applyViewState],
  )

  const toggleEdit = React.useCallback(async () => {
    if (editRef.current) {
      await flushPending()
      editRef.current = false
      setEditMode(false)
      setSelectedId(null)
      setStatus({ kind: 'info', code: 'read_only', message: 'Read-only mode. Click a node to open its source.' })
    } else {
      editRef.current = true
      setEditMode(true)
      setStatus({ kind: 'info', code: 'editing', message: 'Edit mode: drag a node or pick a colour; writes debounce 500 ms.' })
    }
  }, [flushPending])

  const changeColour = React.useCallback(
    (node, type) => {
      if (!editRef.current || node === null) return
      const look = paletteFor(type)
      emit({ type: 'colorChanged', nodeId: node.id, fill: look.fill, stroke: look.stroke })
      setColours((previous) => ({ ...previous, [node.id]: { fill: look.fill, stroke: look.stroke } }))
      scheduleWrite(node.id, { fill: look.fill, stroke: look.stroke })
      setStatus({ kind: 'info', code: 'colorChanged', message: `Queued ${type} colours for ${node.id} (500 ms debounce).` })
    },
    [scheduleWrite, emit],
  )

  const resetNode = React.useCallback(async () => {
    if (!editRef.current || selectedId === null || current === null) return
    await flushPending()
    const before = overlaysRef.current[selectedId] ?? null
    emit({ type: 'nodeReset', nodeId: selectedId })
    const result = await host.writeOverlay({ action: 'resetNode', nodeId: selectedId })
    if (result?.ok !== true) {
      setStatus({ kind: 'error', code: result?.error?.code ?? 'reset_failed', message: result?.error?.message ?? 'The host refused the reset.' })
      return
    }
    setOverlays((previous) => {
      const next = { ...previous }
      delete next[selectedId]
      overlaysRef.current = next
      return next
    })
    setUndoStack((previous) => {
      const next = [...previous, { kind: 'resetNode', nodeId: selectedId, before }]
      undoRef.current = next
      return next
    })
    await refreshInPlace()
    setStatus({ kind: 'ok', code: 'nodeReset', message: `Reset overlay for ${selectedId}; the layout position is back.` })
  }, [current, selectedId, flushPending, emit, host, refreshInPlace])

  const resetView = React.useCallback(async () => {
    if (!editRef.current || current === null) return
    await flushPending()
    const beforeRows = {}
    for (const node of current.scene.nodes) {
      if (overlaysRef.current[node.id] !== undefined) beforeRows[node.id] = overlaysRef.current[node.id]
    }
    if (Object.keys(beforeRows).length === 0) return
    emit({ type: 'viewReset', viewId: current.view.viewId })
    const result = await host.writeOverlay({ action: 'resetView', viewId: current.view.viewId })
    if (result?.ok !== true) {
      setStatus({ kind: 'error', code: result?.error?.code ?? 'reset_failed', message: result?.error?.message ?? 'The host refused the reset.' })
      return
    }
    setOverlays((previous) => {
      const next = { ...previous }
      for (const nodeId of Object.keys(beforeRows)) delete next[nodeId]
      overlaysRef.current = next
      return next
    })
    setUndoStack((previous) => {
      const next = [...previous, { kind: 'resetView', viewId: current.view.viewId, beforeRows }]
      undoRef.current = next
      return next
    })
    await refreshInPlace()
    setStatus({ kind: 'ok', code: 'viewReset', message: `Reset ${Object.keys(beforeRows).length} overlay row${Object.keys(beforeRows).length === 1 ? '' : 's'} on ${current.view.viewId}.` })
  }, [current, flushPending, emit, host, refreshInPlace])

  const undo = React.useCallback(async () => {
    const entry = undoRef.current[undoRef.current.length - 1]
    if (entry === undefined) return
    await flushPending()
    if (entry.kind === 'resetView') {
      for (const [nodeId, row] of Object.entries(entry.beforeRows)) {
        const result = await host.writeOverlay({ action: 'replace', nodeId, row })
        if (result?.ok !== true) {
          setStatus({ kind: 'error', code: result?.error?.code ?? 'undo_failed', message: result?.error?.message ?? 'Undo failed.' })
          return
        }
      }
    } else {
      const result =
        entry.before === null || entry.before === undefined
          ? await host.writeOverlay({ action: 'resetNode', nodeId: entry.nodeId })
          : await host.writeOverlay({ action: 'replace', nodeId: entry.nodeId, row: entry.before })
      if (result?.ok !== true) {
        setStatus({ kind: 'error', code: result?.error?.code ?? 'undo_failed', message: result?.error?.message ?? 'Undo failed.' })
        return
      }
    }
    setUndoStack((previous) => {
      const next = previous.slice(0, -1)
      undoRef.current = next
      return next
    })
    await refreshInPlace()
    setStatus({ kind: 'ok', code: 'undo', message: 'Undid the last overlay change.' })
  }, [flushPending, host, refreshInPlace])

  const onNodesChange = React.useCallback((changes) => {
    if (!editRef.current) return
    const moves = changes.filter((change) => change.type === 'position' && change.position !== undefined)
    if (moves.length === 0) return
    setPositions((previous) => {
      const next = { ...previous }
      for (const change of moves) next[change.id] = { x: round2(change.position.x), y: round2(change.position.y) }
      return next
    })
  }, [])

  const onNodeDragStart = React.useCallback((_event, node) => {
    if (!editRef.current) return
    setSelectedId(node.id)
  }, [])

  const onNodeDragStop = React.useCallback(
    (_event, node) => {
      if (!editRef.current) return
      emit({ type: 'nodeMoved', nodeId: node.id, x: round2(node.position.x), y: round2(node.position.y) })
      setPositions((previous) => ({ ...previous, [node.id]: { x: round2(node.position.x), y: round2(node.position.y) } }))
      scheduleWrite(node.id, { x: round2(node.position.x), y: round2(node.position.y) })
      setStatus({ kind: 'info', code: 'nodeMoved', message: `Queued position for ${node.id} (500 ms debounce).` })
    },
    [emit, scheduleWrite],
  )

  const nudgeSelected = React.useCallback(
    (dx, dy) => {
      if (!editRef.current || selectedId === null) return
      const node = currentRef.current?.scene.nodes.find((entry) => entry.id === selectedId)
      if (node === undefined) return
      const currentPosition = positionsRef.current[selectedId] ?? { x: node.x, y: node.y }
      const next = { x: round2(currentPosition.x + dx), y: round2(currentPosition.y + dy) }
      setPositions((previous) => ({ ...previous, [selectedId]: next }))
      emit({ type: 'nodeMoved', nodeId: selectedId, x: next.x, y: next.y })
      scheduleWrite(selectedId, next)
      setStatus({ kind: 'info', code: 'nodeMoved', message: `Nudged ${selectedId} to ${next.x}, ${next.y} (500 ms debounce).` })
    },
    [selectedId, emit, scheduleWrite],
  )

  const onNodeClick = React.useCallback(
    (_event, node) => {
      if (editRef.current) {
        setSelectedId(node.id)
        setStatus({ kind: 'info', code: 'selected', message: `Selected ${node.data.node.label}. Arrow keys nudge; pick a colour to recolour.` })
        return
      }
      openSource(node.data.node)
    },
    [openSource],
  )

  React.useEffect(() => {
    const onKeyDown = (event) => {
      const active = document.activeElement
      const tag = active?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable === true
      if (event.key === 'Enter' || event.key === ' ') {
        if (active === null || typeof active.classList?.contains !== 'function') return
        if (!active.classList.contains('react-flow__node')) return
        const id = active.getAttribute('data-id')
        const node = currentRef.current?.scene.nodes.find((entry) => entry.id === id)
        if (node === undefined) return
        event.preventDefault()
        if (editRef.current) {
          setSelectedId(id)
          setStatus({ kind: 'info', code: 'selected', message: `Selected ${node.label}. Arrow keys nudge; pick a colour to recolour.` })
        } else {
          openSource(node)
        }
        return
      }
      if (!editRef.current || selectedId === null || typing) return
      if (!event.key.startsWith('Arrow')) return
      // Arrow keys reach this branch only from the canvas, so they nudge the
      // selected node instead of panning; inputs, buttons and the rail keep their
      // normal key handling.
      if (active !== document.body && active?.closest?.('.dmv-stage') === null) return
      const step = event.shiftKey ? 1 : 8
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
      if (delta === undefined) return
      event.preventDefault()
      nudgeSelected(delta[0], delta[1])
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [openSource, selectedId, nudgeSelected])

  React.useEffect(() => {
    const onEscape = (event) => {
      if (event.key !== 'Escape' || query === '') return
      event.preventDefault()
      setQuery('')
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [query])

  const focusMatch = React.useCallback(
    (index = 0) => {
      const node = matches[index]
      if (node === undefined) {
        if (query.trim() !== '') setStatus({ kind: 'info', code: 'no_match', message: `No node matches "${query.trim()}".` })
        return
      }
      const instance = flowRef.current
      if (instance !== null) {
        instance.setCenter(node.x + node.w / 2, node.y + node.h / 2, { zoom: Math.max(instance.getZoom(), 0.9), duration: 200 })
      }
      setStatus({ kind: 'info', code: 'match', message: `Jumped to ${node.label} (${node.id}).` })
      window.setTimeout(() => {
        const element = [...document.querySelectorAll('.react-flow__node')].find((candidate) => candidate.getAttribute('data-id') === node.id)
        element?.focus?.()
      }, 240)
    },
    [matches, query],
  )

  const onSearchKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      focusMatch(0)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setQuery('')
      searchRef.current?.focus()
    }
  }

  React.useEffect(() => {
    window.__M2__ = {
      getState: () => ({
        editMode: editRef.current,
        selectedId,
        overlays: overlaysRef.current,
        positions: positionsRef.current,
        colours: coloursRef.current,
        undoDepth: undoRef.current.length,
        pending: pendingRef.current.size,
        lastWrite: lastWriteRef.current,
      }),
      select: (id) => setSelectedId(id),
      flush: () => flushPending(),
      regenerate: async () => {
        const rendered = await host.renderViews?.()
        if (rendered?.ok !== true) return rendered
        const reloaded = await refreshInPlace({ render: false })
        return reloaded?.ok === true ? { ok: true, value: rendered.value } : reloaded
      },
      attemptModelWrite: async () => {
        const nodeId = currentRef.current?.scene.nodes[0]?.id
        if (nodeId === undefined) return { ok: false, error: { code: 'no_node', message: 'No node on this view.' } }
        return host.writeOverlay({ action: 'upsert', nodeId, label: 'illegal model field' })
      },
    }
  }, [host, selectedId, flushPending, refreshInPlace])

  if (loading) {
    return (
      <div className="dmv">
        <div className="dmv-loading" role="status">
          <span className="pulse" aria-hidden="true" />
          Loading design map…
        </div>
      </div>
    )
  }

  if (missing && (current === null || scene === null)) {
    return (
      <div className="dmv">
        <div className="dmv-error" role="status" data-designmap-missing="true">
          <div>
            <h2>No design map in this workspace yet</h2>
            <p>
              A workspace gets a map when the agent creates the model with <code>designmap_apply</code> and renders it
              with <code>designmap_render</code> (files land under <code>designmap/</code>). Nothing is wrong with the
              panel.
            </p>
          </div>
          <button type="button" className="dmv-btn" onClick={load}>Retry</button>
        </div>
      </div>
    )
  }

  if (current === null || scene === null) {
    const message = loadError?.message ?? 'The host returned no scene for this workspace.'
    return (
      <div className="dmv">
        <div className="dmv-error" role="alert">
          <div>
            <h2>Design map could not load</h2>
            <p>{message}</p>
          </div>
          <button type="button" className="dmv-btn" onClick={load}>Retry</button>
        </div>
      </div>
    )
  }

  let sceneError = null
  try {
    assertScene(scene)
  } catch (error) {
    sceneError = error
  }
  if (sceneError !== null) {
    return (
      <div className="dmv">
        <div className="dmv-error" role="alert">Invalid scene: {sceneError.message}</div>
      </div>
    )
  }

  const staleNodes = scene.nodes.filter((node) => node.stale === true)
  const viewStale = meta.stale?.stale === true || staleNodes.length > 0
  const commitBehind = Number(meta.stale?.commitBehind ?? 0)
  const staleLabel = viewStale ? (commitBehind > 0 ? `stale · ${commitBehind} commit${commitBehind === 1 ? '' : 's'} behind` : 'stale · sources changed') : 'fresh'
  const empty = isEmptyScene(scene)
  const historyForBar = history.length === 0 ? [current.view] : history
  const rowsOnView = scene.nodes.filter((node) => overlays[node.id] !== undefined).length
  const selectedNode = selectedId === null ? null : scene.nodes.find((node) => node.id === selectedId) ?? null
  const selectedColours = selectedId === null ? undefined : colours[selectedId]
  const selectedRow = selectedId === null ? undefined : overlays[selectedId]
  const sceneById = new Map(scene.nodes.map((node) => [node.id, { x: node.x, y: node.y }]))

  const flowNodes = scene.nodes.map((node) => {
    const position = positions[node.id] ?? { x: node.x, y: node.y }
    const colour = colours[node.id]
    const matched = query.trim() !== '' && matchIds.has(node.id)
    return {
      id: node.id,
      type: 'scene',
      position,
      data: {
        node,
        fill: colour?.fill,
        stroke: colour?.stroke,
        edited: overlays[node.id] !== undefined,
      },
      ariaLabel: `${nodeAriaLabel(node)}${overlays[node.id] !== undefined ? ', edited' : ''}`,
      draggable: editMode,
      selectable: false,
      className: [query.trim() === '' ? '' : matched ? 'dmv-match' : 'dmv-dim', selectedId === node.id ? 'dmv-selected' : ''].filter(Boolean).join(' '),
      style: { width: node.w, height: node.h },
      width: node.w,
      height: node.h,
    }
  })

  const flowEdges = scene.edges.map((edge) => {
    const look = edgeStyleFor(edge.kind)
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: 'sceneEdge',
      data: {
        points: edge.points,
        label: edge.label,
        labelBox: edge.labelBox,
        labelLines: edge.labelLines,
        kind: edge.kind,
        origin: { from: sceneById.get(edge.from), to: sceneById.get(edge.to) },
      },
      ariaLabel: edgeAriaLabel(edge),
      markerEnd: { type: MarkerType.ArrowClosed, color: look.stroke, width: 16, height: 16 },
      style: { stroke: look.stroke, strokeWidth: look.strokeWidth, strokeDasharray: look.strokeDasharray },
    }
  })

  const groups = scene.groups.map((group) => {
    const hasChild = findChild(group.id) !== null
    return (
      <div
        key={group.id}
        className="dmv-group"
        data-group-id={group.id}
        style={{ left: group.x, top: group.y, width: group.w, height: group.h }}
      >
        {hasChild ? (
          <button
            type="button"
            className="dmv-group-title"
            aria-label={groupAriaLabel(group)}
            title={`Open ${group.label || group.id}`}
            onClick={(event) => {
              event.stopPropagation()
              drill(group)
            }}
          >
            {group.label || group.id} ↗
          </button>
        ) : (
          <span className="dmv-group-title">{group.label || group.id}</span>
        )}
      </div>
    )
  })

  const onStageDoubleClick = (event) => {
    if (event.target.closest(FOCUSABLE_SELECTOR) !== null) return
    const instance = flowRef.current
    if (instance === null) return
    const point = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const group = scene.groups.find(
      (candidate) =>
        point.x >= candidate.x &&
        point.x <= candidate.x + candidate.w &&
        point.y >= candidate.y &&
        point.y <= candidate.y + candidate.h,
    )
    if (group !== undefined && findChild(group.id) !== null) drill(group)
  }

  const canvasLabel = `${scene.title || current.view.title || scene.viewId}: ${scene.nodes.length} nodes, ${scene.edges.length} edges, ${staleNodes.length} stale. ${editMode ? 'Edit mode.' : 'Read-only design map.'}`
  const defaultStatus = editMode
    ? 'Editing: drag a node or choose a colour; writes debounce 500 ms. Reset node/view or undo from here.'
    : 'Read-only. Click a node to open its source; double-click a group to drill in.'

  return (
    <div className="dmv" data-edit-mode={editMode ? 'true' : 'false'} ref={rootRef}>
      <header className="dmv-top">
        <div className="dmv-ident">
          <h1 className="dmv-title">{title}</h1>
          <span className="dmv-view-title" title={scene.title} ref={viewTitleRef} tabIndex={-1}>
            {scene.title || current.view.title || scene.viewId}
          </span>
        </div>
        <div className="dmv-chips">
          <span className="dmv-chip level">{scene.level}</span>
          <span className={`dmv-chip${viewStale ? ' stale' : ''}`}>{staleLabel}</span>
          <span className={`dmv-chip${editMode ? ' editing' : ' readonly'}`}>{editMode ? 'edit mode' : 'read-only'}</span>
          {pendingCount > 0 ? <span className="dmv-chip pending" role="status">saving {pendingCount}…</span> : null}
        </div>
        <span className="dmv-spacer" />
        {sceneSet !== null && sceneSet.views.length > 1 ? (
          <label className="dmv-viewswitch">
            <span className="dmv-visually-hidden">View</span>
            <select
              value={scene.viewId}
              onChange={(event) => {
                const target = sceneSet.views.find((entry) => entry.view.viewId === event.target.value)
                if (target !== undefined) navigate(target.view)
              }}
            >
              {sceneSet.views.map((entry) => (
                <option key={entry.view.viewId} value={entry.view.viewId}>
                  {entry.view.title || entry.view.viewId}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="dmv-actions">
          {canWrite ? (
            <button type="button" className={`dmv-btn${editMode ? ' primary' : ''}`} aria-pressed={editMode} onClick={toggleEdit}>
              {editMode ? 'Done editing' : 'Edit overlays'}
            </button>
          ) : null}
          {editMode ? (
            <>
              <button type="button" className="dmv-btn" onClick={undo} disabled={undoStack.length === 0} title="Undo the last overlay change">
                ↶ Undo
              </button>
              <button type="button" className="dmv-btn" onClick={resetView} disabled={rowsOnView === 0} title="Remove every overlay row of this view">
                Reset view
              </button>
            </>
          ) : null}
        </div>
        <div className="dmv-search" role="search">
          <label className="dmv-visually-hidden" htmlFor="dmv-search">Search nodes by label or id</label>
          <input
            id="dmv-search"
            ref={searchRef}
            className="dmv-search-input"
            type="search"
            value={query}
            placeholder="Search label or id — Enter to jump"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            aria-describedby="dmv-search-count"
          />
          <span id="dmv-search-count" className="dmv-search-count" aria-live="polite">
            {query.trim() === '' ? '' : matches.length}
          </span>
        </div>
      </header>
      {/* One crumb is the view title the header already shows; the bar earns its row
          only when a drill-down path exists. */}
      {historyForBar.length > 1 ? <Breadcrumb history={historyForBar} onNavigate={navigate} /> : null}
      <h2 className="dmv-visually-hidden">{canvasLabel}</h2>
      <section className="dmv-stage" aria-label="Design map canvas">
        <div className="dmv-flow" onDoubleClick={onStageDoubleClick}>
          {empty ? (
            <div className="dmv-empty">
              <h2>{scene.title || current.view.title || 'Empty view'}</h2>
              <p>This view has no nodes. Render the model to populate it; this panel only draws what core produced.</p>
            </div>
          ) : !canvasFailed ? (
            <ExcalidrawCanvas
              scene={scene}
              overlays={overlays}
              editMode={editMode}
              look={look}
              fitSignal={fitSignal}
              onDelta={onCanvasDelta}
              onFallback={() => setCanvasFailed(true)}
              onViewport={onCanvasViewport}
            />
          ) : (
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onInit={onInit}
              onMove={(_event, viewport) => setZoom(viewport.zoom)}
              onNodeClick={onNodeClick}
              onNodeDragStart={onNodeDragStart}
              onNodeDragStop={onNodeDragStop}
              onNodesChange={onNodesChange}
              fitView
              fitViewOptions={{ padding: 0.1, maxZoom: 1.5, duration: 0 }}
              minZoom={0.2}
              maxZoom={2.5}
              nodesDraggable={editMode}
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag
              zoomOnScroll
              zoomOnDoubleClick={false}
              colorMode="light"
              proOptions={{ hideAttribution: false }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1.1} color="#cbd5e1" />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                nodeColor={(node) => colours[node.data?.node?.id]?.stroke ?? paletteFor(node.data?.node?.type).stroke}
                nodeStrokeWidth={3}
                maskColor="rgba(148, 163, 184, 0.18)"
                bgColor="var(--dmv-surface)"
                style={{ width: 150, height: 100 }}
                aria-label="Minimap"
              />
              <ViewportPortal>{groups}</ViewportPortal>
            </ReactFlow>
          )}
        </div>
        {editMode && !canvasFailed ? (
          <div className="dmv-inspector-pop">
            <NodeInspector
              node={selectedNode}
              colours={selectedColours}
              overlayRow={selectedRow}
              pending={pendingCount > 0}
              onColour={(type) => changeColour(selectedNode, type)}
              onReset={resetNode}
              onOpen={() => (selectedNode === null ? undefined : openSource(selectedNode))}
            />
          </div>
        ) : null}
      </section>
      <Legend
        scene={scene}
        editMode={editMode}
        zoom={zoom}
        onFit={fit}
      />
      <div className="dmv-status" data-kind={status?.kind ?? 'idle'} role={status?.kind === 'error' ? 'alert' : 'status'}>
        {status === null ? (
          <span>{defaultStatus}</span>
        ) : (
          <span>
            {status.code ? <code>{status.code}: </code> : null}
            {status.message}
          </span>
        )}
        <span className="dmv-spacer" />
        <span title={zoomSource === 'canvas' ? 'current Excalidraw canvas zoom' : 'current React Flow zoom'}>zoom {zoom.toFixed(2)}</span>
      </div>
      <footer className="dmv-foot">
        <dl>
          <div className="pair">
            <dt>Generated</dt>
            <dd>{formatTimestamp(meta.generatedAt)}</dd>
          </div>
          <div className="pair">
            <dt>Commit</dt>
            <dd title={meta.commit ?? ''}>{shortCommit(meta.commit)}</dd>
          </div>
          <div className="pair">
            <dt>Scene</dt>
            <dd title={meta.scenePath ?? ''}>{shortHash(meta.sceneHash)}</dd>
          </div>
          <div className="pair">
            <dt>View</dt>
            <dd>{`${scene.viewId} · ${plural(scene.nodes.length, 'node')} · ${plural(scene.edges.length, 'edge')}`}</dd>
          </div>
          <div className={`pair${viewStale ? ' warn' : ''}`}>
            <dt>Stale</dt>
            <dd>{viewStale ? `${plural(staleNodes.length, 'node')} stale` : 'none'}</dd>
          </div>
          <div className="pair">
            <dt>Overlays</dt>
            <dd>{`${plural(rowsOnView, 'node')} · ${pendingCount > 0 ? 'saving…' : 'saved'}`}</dd>
          </div>
        </dl>
      </footer>
    </div>
  )
}
