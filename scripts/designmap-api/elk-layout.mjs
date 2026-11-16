/**
 * API test: elkjs 0.12.1 layered layout of a graph with a grouped node and ported
 * edges, plus the determinism proof required by FR-3 / NFR-1 / INV-IDEMPOTENT.
 *
 * Two questions are answered by running the product, not by reading the docs:
 *   1. Does a grouped graph with ports come back with usable geometry?
 *   2. Is the geometry the same on a second run, and what exactly differs in the
 *      raw result (the answer decides what designmap-core may serialize)?
 *
 * Usage:
 *   node elk-layout.mjs [outFile]
 * Exit code 0 only when the projected (documented-fields-only) dump is identical.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import ELK from 'elkjs'
import { installedVersion } from './version.mjs'

const elk = new ELK()

/** A checkout group with two services and a database outside it; every edge uses ports. */
function input() {
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '32',
      'elk.spacing.edgeNode': '16',
      'elk.padding': '[top=8,left=8,bottom=8,right=8]',
    },
    children: [
      {
        id: 'grp.checkout',
        width: 0,
        height: 0,
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.padding': '[top=24,left=24,bottom=24,right=24]',
          'elk.spacing.nodeNode': '24',
        },
        children: [
          {
            id: 'svc.checkout.api',
            width: 160,
            height: 44,
            layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
            ports: [
              { id: 'svc.checkout.api.in', width: 8, height: 8, layoutOptions: { 'elk.port.side': 'WEST' } },
              { id: 'svc.checkout.api.out', width: 8, height: 8, layoutOptions: { 'elk.port.side': 'EAST' } },
            ],
          },
          {
            id: 'svc.checkout.worker',
            width: 160,
            height: 44,
            layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
            ports: [
              { id: 'svc.checkout.worker.in', width: 8, height: 8, layoutOptions: { 'elk.port.side': 'WEST' } },
            ],
          },
        ],
        edges: [
          { id: 'e.api.worker', sources: ['svc.checkout.api.out'], targets: ['svc.checkout.worker.in'] },
        ],
      },
      {
        id: 'db.orders',
        width: 160,
        height: 44,
        layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
        ports: [
          { id: 'db.orders.in', width: 8, height: 8, layoutOptions: { 'elk.port.side': 'WEST' } },
        ],
      },
    ],
    edges: [
      { id: 'e.api.db', sources: ['svc.checkout.api.out'], targets: ['db.orders.in'] },
    ],
  }
}

/** Only the fields designmap-core is allowed to copy into a scene. */
function project(result) {
  const nodes = []
  const groups = []
  const edges = []
  const walk = (node, parent) => {
    const record = {
      id: node.id,
      parent: parent ?? null,
      x: node.x,
      y: node.y,
      w: node.width,
      h: node.height,
      ports: (node.ports ?? []).map(port => ({ id: port.id, x: port.x, y: port.y, w: port.width, h: port.height })),
    }
    if (Array.isArray(node.children) && node.children.length > 0) groups.push(record)
    else nodes.push(record)
    for (const child of node.children ?? []) walk(child, node.id)
    for (const edge of node.edges ?? []) {
      edges.push({
        id: edge.id,
        parent: node.id,
        start: edge.sections?.[0]?.startPoint ?? null,
        end: edge.sections?.[0]?.endPoint ?? null,
        bends: edge.sections?.[0]?.bendPoints ?? [],
        fromPort: edge.sections?.[0]?.incomingShape ?? null,
        toPort: edge.sections?.[0]?.outgoingShape ?? null,
      })
    }
  }
  walk(result, null)
  return { canvas: { x: result.x, y: result.y, w: result.width, h: result.height }, nodes, groups, edges }
}

function canonical(value) {
  return JSON.stringify(value, (key, item) => {
    if (item === undefined) return null
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]]))
    }
    return typeof item === 'number' ? Math.round(item * 100) / 100 : item
  })
}
const sha256 = text => createHash('sha256').update(text).digest('hex')

const started = performance.now()
const first = await elk.layout(input())
const elapsedMs = performance.now() - started
const second = await elk.layout(input())
const rawSame = JSON.stringify(first) === JSON.stringify(second)

const a = project(first)
const b = project(second)
const hashA = sha256(canonical(a))
const hashB = sha256(canonical(b))

// Which top-level keys does elkjs add beyond the documented graph? `$H` is GWT's
// identity hash and is the one field that makes a raw dump differ run to run.
const internalKeys = [...new Set([...Object.keys(first), ...(first.children ?? []).flatMap(c => Object.keys(c))])]
  .filter(key => key.startsWith('$'))

const out = {
  elkjs: installedVersion('elkjs'),
  layoutMs: Math.round(elapsedMs * 100) / 100,
  rawJsonEqualAcrossRuns: rawSame,
  internalKeysInRawResult: internalKeys,
  projectedHashRun1: hashA,
  projectedHashRun2: hashB,
  projectedEqual: hashA === hashB,
  scene: a,
}
const file = process.argv[2]
if (file !== undefined) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`)
  // The scene projection alone, with no timing and no version envelope: the artifact
  // whose bytes the cross-process determinism check hashes.
  writeFileSync(file.replace(/\.json$/, '.scene.json'), `${JSON.stringify(a, null, 2)}\n`)
}

console.log(JSON.stringify({ ...out, scene: undefined, sceneOutline: outline(a) }, null, 2))
if (!out.projectedEqual) {
  console.error('FAIL: the documented-fields projection differs between two runs')
  process.exitCode = 1
}

function outline(scene) {
  return {
    canvas: scene.canvas,
    groups: scene.groups.map(g => ({ id: g.id, x: g.x, y: g.y, w: g.w, h: g.h })),
    nodes: scene.nodes.map(n => ({ id: n.id, parent: n.parent, x: n.x, y: n.y, w: n.w, h: n.h, ports: n.ports })),
    edges: scene.edges.map(e => ({ id: e.id, start: e.start, end: e.end, bends: e.bends, fromPort: e.fromPort, toPort: e.toPort })),
  }
}
