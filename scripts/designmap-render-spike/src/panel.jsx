/**
 * designmap renderer spike — the whole factory body.
 *
 * Built by build.mjs into a CJS blob and wrapped as
 *   window.__ModuleLoader__.load({ id: PKG, factory(require) { …body… } })
 * so the module runs under the REAL @deepseek-ai/dsh-client-modules loader
 * (served from vendor/), with react / react-dom / react-dom/client /
 * react/jsx-runtime resolved through the loader's seed table, and
 * @xyflow/react bundled into this script (it is not a seed word and not a
 * DSH client package, so it can never be a dsh.client.external row).
 *
 * What it proves, in a real browser:
 *  - controlled renderer: nodes/edges are built from a scene JSON;
 *  - initial fit: every node lands inside the pane;
 *  - drag one node: onNodesChange emits a position delta for that id only;
 *  - the delta converts to the overlays.json patch shape { id, x, y };
 *  - wheel zoom and drag pan change the viewport;
 *  - MiniMap / Controls / Background / Panel legend are core components.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MiniMap,
  Panel,
  MarkerType,
  applyNodeChanges,
  useNodes,
} from '@xyflow/react'
import flowCss from '@xyflow/react/dist/style.css'
import scene from './scene.json'

const PKG = '@spike/designmap-render'
const round2 = (value) => Math.round(value * 100) / 100

/** The type→appearance table. Core owns geometry; the renderer owns this table (scene contract). */
const KIND = {
  frontend: { fill: '#e0f2fe', stroke: '#0284c7', ink: '#075985', shape: 'r' },
  service: { fill: '#dbeafe', stroke: '#2563eb', ink: '#1e3a8a', shape: 'r' },
  worker: { fill: '#ede9fe', stroke: '#7c3aed', ink: '#4c1d95', shape: 'r' },
  datastore: { fill: '#dcfce7', stroke: '#15803d', ink: '#14532d', shape: 'pill' },
  queue: { fill: '#fef3c7', stroke: '#b45309', ink: '#78350f', shape: 'r' },
  external: { fill: '#f1f5f9', stroke: '#64748b', ink: '#334155', shape: 'dash' },
}

const EDGE_STYLE = {
  sync: { stroke: '#475569', strokeWidth: 1.6, strokeDasharray: undefined },
  async: { stroke: '#7c3aed', strokeWidth: 1.6, strokeDasharray: '6 4' },
  data: { stroke: '#15803d', strokeWidth: 1.8, strokeDasharray: '2 3' },
}

const STYLE = `
.spike{height:100%;min-height:0;display:flex;flex-direction:column;background:#f8fafc;color:#0f172a;font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.spike *{box-sizing:border-box}
.spike-top{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid #e2e8f0;background:#fff;flex:none;flex-wrap:wrap}
.spike-title{font-size:15px;font-weight:750;letter-spacing:-.01em;margin:0}
.spike-sub{color:#64748b;font-size:11.5px}
.spike-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid #e2e8f0;border-radius:999px;padding:1px 8px;font-size:10.5px;color:#475569;background:#f8fafc;white-space:nowrap;font-variant-numeric:tabular-nums}
.spike-chip.ok{color:#15803d;border-color:#bbf7d0;background:#f0fdf4}
.spike-spacer{flex:1}
.spike-canvas{flex:1;min-height:0;position:relative;background:#fff;border-bottom:1px solid #e2e8f0}
.spike-canvas .react-flow{background:linear-gradient(180deg,#ffffff 0%,#fbfdff 100%)}
.spike-status{flex:none;display:flex;gap:16px;padding:9px 16px;background:#fff;font-size:11.5px;color:#475569;flex-wrap:wrap;align-items:flex-start}
.spike-status b{color:#0f172a;font-weight:650}
.spike-status code{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#0f172a;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px;padding:1px 5px;overflow-wrap:anywhere}
.spike-block{display:flex;flex-direction:column;gap:2px;min-width:220px;max-width:min(560px,60vw)}
.spike-block span{color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;font-weight:650}
.spike-legend{background:rgba(255,255,255,.96);border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;box-shadow:0 4px 14px rgba(15,23,42,.06);font-size:10.8px;color:#334155;min-width:132px}
.spike-legend h2{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:0 0 5px;font-weight:700}
.spike-legend ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
.spike-legend li{display:flex;align-items:center;gap:6px}
.spike-swatch{width:10px;height:10px;border-radius:3px;border:1.5px solid;flex:none}
.spike-line{width:16px;height:0;border-top:2px solid #475569;flex:none}
.spike-node{font-size:12.5px;font-weight:650;line-height:1.25;white-space:pre-line;text-align:center;padding:0 8px}
.spike-canvas .react-flow__handle{opacity:0;pointer-events:none}
.spike-edge-label{position:absolute;transform-origin:top left;background:rgba(255,255,255,.96);border:1px solid #e2e8f0;border-radius:4px;padding:1px 4px;font-size:10px;font-weight:650;color:#1e293b;white-space:nowrap;pointer-events:none}
.spike-node.stale{outline:2px dashed #dc2626;outline-offset:2px}
.spike-badge{display:inline-block;margin-left:6px;color:#b91c1c;font-size:9.5px;font-weight:700;vertical-align:middle}
`

function toFlowNodes(sourceScene) {
  return sourceScene.nodes.map((node) => {
    const look = KIND[node.type] ?? KIND.service
    return {
      id: node.id,
      position: { x: node.x, y: node.y },
      data: { label: node.label, kind: node.type, stale: node.stale, source: node.source },
      ariaLabel: `${node.label} (${node.type}${node.stale ? ', stale' : ''})`,
      draggable: true,
      selectable: true,
      style: {
        width: node.w,
        height: node.h,
        background: look.fill,
        border: `1.5px solid ${look.stroke}`,
        borderStyle: look.shape === 'dash' ? 'dashed' : 'solid',
        borderRadius: look.shape === 'pill' ? 999 : 8,
        color: look.ink,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
    }
  })
}

function toFlowEdges(sourceScene) {
  return sourceScene.edges.map((edge) => {
    const look = EDGE_STYLE[edge.kind] ?? EDGE_STYLE.sync
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: 'scene',
      label: edge.label,
      markerEnd: { type: MarkerType.ArrowClosed, color: look.stroke, width: 16, height: 16 },
      style: look,
      data: {
        points: edge.points,
        label: edge.label,
        labelAt: edge.labelAt,
        kind: edge.kind,
        origin: {
          source: scene.nodes.find((node) => node.id === edge.from),
          target: scene.nodes.find((node) => node.id === edge.to),
        },
      },
      ariaLabel: `${edge.label} (${edge.kind} edge from ${edge.from} to ${edge.to})`,
    }
  })
}

const FLOW_EDGES = toFlowEdges(scene)

/**
 * The scene contract says the renderer must not re-route an edge: core ships
 * `points` + `labelAt`. React Flow's built-in edges route between handles, so
 * this custom edge draws the scene polyline verbatim and anchors the label at
 * core's top-left `labelAt`. (M1 needs this shape for e.g. straight LR runs and
 * recorded bend points.)
 */
function SceneEdge({ id, data, markerEnd, style }) {
  // Renderer-internal preview only: the scene is the source of truth, but while
  // the human drags a node its incident edges must stay attached. Offset the
  // endpoint(s) that belong to a moved node; never re-route the polyline.
  const nodes = useNodes()
  const live = (id) => nodes.find((node) => node.id === id)?.position
  const source = live(data.origin.source?.id)
  const target = live(data.origin.target?.id)
  const dx = source === undefined ? 0 : source.x - data.origin.source.x
  const dy = source === undefined ? 0 : source.y - data.origin.source.y
  const tx = target === undefined ? 0 : target.x - data.origin.target.x
  const ty = target === undefined ? 0 : target.y - data.origin.target.y
  const last = data.points.length - 1
  const points = data.points.map((point, index) => ({
    x: point.x + (index === 0 ? dx : 0) + (index === last ? tx : 0),
    y: point.y + (index === 0 ? dy : 0) + (index === last ? ty : 0),
  }))
  // The label stays at core's anchor: the renderer never invents label geometry.
  const labelAt = data.labelAt
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(BaseEdge, { id: `${id}-path`, path, markerEnd, style, interactionWidth: 18 }),
    React.createElement(
      EdgeLabelRenderer,
      null,
      React.createElement(
        'div',
        {
          className: 'spike-edge-label',
          style: { transform: `translate(${labelAt.x}px, ${labelAt.y}px)` },
        },
        data.label,
      ),
    ),
  )
}

const EDGE_TYPES = { scene: SceneEdge }

function App() {
  const [nodes, setNodes] = React.useState(() => toFlowNodes(scene))
  const [viewport, setViewport] = React.useState({ x: 0, y: 0, zoom: 1 })
  const [lastDelta, setLastDelta] = React.useState(null)
  const [lastPatch, setLastPatch] = React.useState(null)
  const [deltaCount, setDeltaCount] = React.useState(0)
  const [fit, setFit] = React.useState(null)

  const instanceRef = React.useRef(null)
  const nodesRef = React.useRef(nodes)
  const viewportRef = React.useRef(viewport)
  const deltasRef = React.useRef([])
  const patchesRef = React.useRef([])
  const fitRef = React.useRef(null)
  nodesRef.current = nodes

  /** Screen-space evidence that fitView put every node inside the pane. */
  const recordFit = React.useCallback(() => {
    const pane = document.querySelector('.spike-canvas .react-flow')
    if (pane === null) return
    const bounds = pane.getBoundingClientRect()
    const rects = [...pane.querySelectorAll('.react-flow__node')].map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        id: element.getAttribute('data-id'),
        left: round2(rect.left - bounds.left),
        top: round2(rect.top - bounds.top),
        right: round2(rect.right - bounds.left),
        bottom: round2(rect.bottom - bounds.top),
      }
    })
    const inside = rects.every(
      (rect) => rect.left >= -0.5 && rect.top >= -0.5 && rect.right <= bounds.width + 0.5 && rect.bottom <= bounds.height + 0.5,
    )
    const next = {
      viewport: instanceRef.current?.getViewport() ?? viewportRef.current,
      pane: { width: round2(bounds.width), height: round2(bounds.height) },
      nodeRects: rects,
      allInside: inside && rects.length === scene.nodes.length,
    }
    fitRef.current = next
    setFit(next)
  }, [])

  /** onNodesChange → the renderer's only write path: a position delta per moved id. */
  const onNodesChange = React.useCallback((changes) => {
    const moves = changes.filter((change) => change.type === 'position' && change.position !== undefined)
    for (const change of moves) {
      const delta = {
        id: change.id,
        position: { x: round2(change.position.x), y: round2(change.position.y) },
      }
      deltasRef.current.push({ ...delta, dragging: change.dragging === true })
      setLastDelta({ ...delta, dragging: change.dragging === true })
    }
    // A finished drag is the moment the host should persist overlays.json[id].x/y.
    const finished = moves.filter((change) => change.dragging === false)
    if (finished.length > 0) {
      const patches = finished.map((change) => ({
        id: change.id,
        x: round2(change.position.x),
        y: round2(change.position.y),
      }))
      patchesRef.current.push(...patches)
      setLastPatch(patches[patches.length - 1])
    }
    if (moves.length > 0) setDeltaCount((count) => count + moves.length)
    setNodes((current) => applyNodeChanges(changes, current))
  }, [])

  const onMove = React.useCallback((_event, next) => {
    viewportRef.current = next
    setViewport(next)
  }, [])

  const onInit = React.useCallback(
    (instance) => {
      instanceRef.current = instance
      // fitView is also a prop; repeat it after the first paint so the recorded
      // numbers describe the settled initial view, not a pre-measure frame.
      requestAnimationFrame(() => {
        instance.fitView({ padding: 0.25, maxZoom: 1.5, duration: 0 })
        requestAnimationFrame(recordFit)
      })
    },
    [recordFit],
  )

  React.useEffect(() => {
    window.__SPIKE_TEST__ = {
      scene,
      reactVersion: React.version,
      getNodes: () =>
        nodesRef.current.map((node) => ({
          id: node.id,
          x: round2(node.position.x),
          y: round2(node.position.y),
          w: node.style.width,
          h: node.style.height,
          selected: node.selected === true,
        })),
      getEdges: () =>
        FLOW_EDGES.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          type: edge.type,
        })),
      getDeltas: () => deltasRef.current.slice(),
      getPatches: () => patchesRef.current.slice(),
      getViewport: () => instanceRef.current?.getViewport() ?? viewportRef.current,
      getFit: () => fitRef.current,
      fitView: () => {
        instanceRef.current?.fitView({ padding: 0.25, maxZoom: 1.5, duration: 0 })
        recordFit()
      },
      getNodeRects: () => {
        const pane = document.querySelector('.spike-canvas .react-flow')
        const bounds = pane.getBoundingClientRect()
        return [...pane.querySelectorAll('.react-flow__node')].map((element) => {
          const rect = element.getBoundingClientRect()
          return {
            id: element.getAttribute('data-id'),
            cx: round2(rect.left - bounds.left + rect.width / 2),
            cy: round2(rect.top - bounds.top + rect.height / 2),
          }
        })
      },
      getPaneRect: () => {
        const pane = document.querySelector('.spike-canvas .react-flow')
        const rect = pane.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      },
    }
  }, [])

  const deltas = deltaCount
  const fitLabel = fit === null ? 'measuring…' : fit.allInside ? `fitted · zoom ${fit.viewport.zoom.toFixed(2)} · all ${fit.nodeRects.length} nodes inside` : 'NOT FITTED'

  return React.createElement(
    'div',
    { className: 'spike' },
    React.createElement('style', null, `${flowCss}\n${STYLE}`),
    React.createElement(
      'header',
      { className: 'spike-top' },
      React.createElement('h1', { className: 'spike-title' }, 'Design map · renderer API spike'),
      React.createElement('span', { className: 'spike-sub' }, 'controlled renderer from scene.json · react external · no CDN'),
      React.createElement('span', { className: 'spike-spacer' }),
      React.createElement('span', { className: 'spike-chip' }, '@xyflow/react 12.12.1'),
      React.createElement('span', { className: 'spike-chip' }, `react ${React.version}`),
      React.createElement('span', { className: 'spike-chip ok' }, `${scene.nodes.length} nodes · ${scene.edges.length} labelled edges`),
    ),
    React.createElement(
      'div',
      { className: 'spike-canvas' },
      React.createElement(
        ReactFlow,
        {
          nodes,
          edges: FLOW_EDGES,
          onNodesChange,
          onMove,
          onInit,
          fitView: true,
          fitViewOptions: { padding: 0.25, maxZoom: 1.5, duration: 0 },
          edgeTypes: EDGE_TYPES,
          minZoom: 0.2,
          maxZoom: 2.5,
          nodesConnectable: false,
          elementsSelectable: true,
          panOnDrag: true,
          zoomOnScroll: true,
          selectionOnDrag: false,
          colorMode: 'light',
          proOptions: { hideAttribution: false },
        },
        React.createElement(Background, { variant: BackgroundVariant.Dots, gap: 18, size: 1.2, color: '#cbd5e1' }),
        React.createElement(Controls, { showInteractive: false, position: 'bottom-left' }),
        React.createElement(MiniMap, {
          position: 'bottom-right',
          pannable: true,
          zoomable: true,
          nodeColor: (node) => KIND[node.data?.kind]?.stroke ?? '#94a3b8',
          nodeStrokeWidth: 3,
        }),
        React.createElement(
          Panel,
          { position: 'top-right', className: 'spike-legend' },
          React.createElement('h2', null, 'Legend'),
          React.createElement(
            'ul',
            null,
            Object.entries(KIND).map(([kind, look]) =>
              React.createElement(
                'li',
                { key: kind },
                React.createElement('span', { className: 'spike-swatch', style: { background: look.fill, borderColor: look.stroke } }),
                kind,
              ),
            ),
            React.createElement('li', { key: 'sync' }, React.createElement('span', { className: 'spike-line', style: { borderTopStyle: 'solid' } }), 'sync'),
            React.createElement('li', { key: 'async' }, React.createElement('span', { className: 'spike-line', style: { borderTopStyle: 'dashed' } }), 'async'),
            React.createElement('li', { key: 'data' }, React.createElement('span', { className: 'spike-line', style: { borderTopStyle: 'dotted' } }), 'data'),
          ),
        ),
      ),
    ),
    React.createElement(
      'footer',
      { className: 'spike-status' },
      React.createElement(
        'div',
        { className: 'spike-block' },
        React.createElement('span', null, 'initial fit'),
        React.createElement('code', { id: 'fit-out' }, fitLabel),
      ),
      React.createElement(
        'div',
        { className: 'spike-block' },
        React.createElement('span', null, 'onNodesChange delta'),
        React.createElement('code', { id: 'delta-out' }, lastDelta === null ? 'drag a node' : JSON.stringify({ id: lastDelta.id, position: lastDelta.position })),
        React.createElement('span', null, `${deltas} position change${deltas === 1 ? '' : 's'} observed`),
      ),
      React.createElement(
        'div',
        { className: 'spike-block' },
        React.createElement('span', null, 'overlays.json patch (drag end)'),
        React.createElement('code', { id: 'patch-out' }, lastPatch === null ? 'none yet' : JSON.stringify(lastPatch)),
      ),
      React.createElement(
        'div',
        { className: 'spike-block' },
        React.createElement('span', null, 'viewport'),
        React.createElement('code', { id: 'viewport-out' }, `x ${round2(viewport.x)} · y ${round2(viewport.y)} · zoom ${round2(viewport.zoom)}`),
      ),
    ),
  )
}

const host = document.getElementById('root')
if (host === null) throw new Error('spike: #root is missing')
createRoot(host).render(React.createElement(App))

// Proof that this code ran from the loader's factory, with the loader's own require.
window.__SPIKE_FACTORY_PROBE__ = {
  id: PKG,
  reactVersion: React.version,
  hasReactDefault: typeof React.createElement === 'function',
  xyflowBundled: typeof ReactFlow !== 'undefined' && typeof applyNodeChanges === 'function',
  sceneNodes: scene.nodes.length,
}
