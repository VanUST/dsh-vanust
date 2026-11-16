/**
 * API test: does elkjs 0.12.1 need a Web Worker, and what does that mean when layout
 * stays server-side in the DSH host?
 *
 * The answer is read out of the installed package (its own source), then executed:
 * the API-only entry is constructed without a worker (it must throw), the Node entry is
 * constructed the same way (it must work), and a timer is used to show whether layout
 * runs synchronously on the calling thread.
 *
 * Usage: node elk-browser.mjs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ELK from 'elkjs'
import { installedVersion, packageDir } from './version.mjs'
import ELKApi from 'elkjs/lib/elk-api.js'

const elkDir = packageDir('elkjs')
const read = relative => readFileSync(join(elkDir, relative), 'utf8')
const elkApiSource = read('lib/elk-api.js')
const mainSource = read('lib/main.js')

function lines(source, pattern, before = 0, after = 3) {
  const all = source.split('\n')
  const hits = []
  all.forEach((line, index) => {
    if (!pattern.test(line)) return
    hits.push(all.slice(Math.max(0, index - before), index + after + 1)
      .map((text, offset) => `${String(Math.max(1, index - before) + offset).padStart(6)}  ${text.trim().slice(0, 300)}`)
      .join('\n'))
  })
  return hits
}

const sourceProof = {
  'elk-api.js: worker is mandatory for the API-only entry': lines(elkApiSource, /Cannot construct an ELK without both/),
  'elk-api.js: workerUrl builds a browser Worker': lines(elkApiSource, /return new Worker\(url\)/),
  'main.js: Node entry installs an in-process fake worker': lines(mainSource, /elk-worker\.min\.js/, 1, 2),
  'main.js: web-worker package is optional, with a fallback': lines(mainSource, /Falling back to non-web worker/),
}

let apiWithoutWorker
try {
  new ELKApi()
  apiWithoutWorker = 'did NOT throw (unexpected)'
} catch (error) {
  apiWithoutWorker = `threw: ${error.message}`
}

const nodeEntryWithoutWorker = (() => {
  try {
    new ELK()
    return 'constructed without workerUrl/workerFactory'
  } catch (error) {
    return `threw: ${error.message}`
  }
})()

// A graph big enough that a synchronous layout is measurable in milliseconds.
function graph(nodes) {
  const children = Array.from({ length: nodes }, (_, index) => ({ id: `n${index}`, width: 120, height: 40 }))
  // ELK layered accepts only simple edges (one source, one target); a second target
  // makes it throw "Passed edge is not 'simple'".
  const edges = [
    ...children.slice(1).map((child, index) => ({ id: `e${index}`, sources: [`n${index}`], targets: [child.id] })),
    ...children.slice(4).map((child, index) => ({ id: `s${index}`, sources: ['n0'], targets: [child.id] })),
  ]
  return { id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' }, children, edges }
}

const elk = new ELK()
// Sample the event loop WHILE layout is running: the longest gap between 10 ms ticks
// is the time the layout held the thread. A synchronous layout shows one gap equal to
// the whole layout duration.
const ticks = []
let sampling = true
const sampler = (async () => {
  while (sampling) {
    const at = performance.now()
    await new Promise(resolve => setTimeout(resolve, 10))
    ticks.push(performance.now() - at)
  }
})()
const started = performance.now()
const result = await elk.layout(graph(120))
const layoutMs = performance.now() - started
sampling = false
await sampler
const longestTickGapMs = Math.max(...ticks)

// NFR-3's budget is 1500 ms for a 25-node view; measure what layout alone costs here.
const smallRuns = []
for (let index = 0; index < 3; index += 1) {
  const at = performance.now()
  await elk.layout(graph(25))
  smallRuns.push(performance.now() - at)
}
smallRuns.sort((a, b) => a - b)

console.log(JSON.stringify({
  elkjs: installedVersion('elkjs'),
  browserConstraint: {
    apiOnlyEntry: apiWithoutWorker,
    nodeEntry: nodeEntryWithoutWorker,
    bundledEntryHasFakeWorker: /elk-worker\.min\.js|_Worker/.test(read('lib/elk.bundled.js')),
  },
  sourceProof,
  eventLoop: {
    layoutMs: Math.round(layoutMs * 100) / 100,
    nodes: result.children.length,
    longestTickGapMs: Math.round(longestTickGapMs * 100) / 100,
    blockedTheThread: longestTickGapMs >= layoutMs * 0.8,
    layoutMs25NodesMedian: Math.round(smallRuns[1] * 100) / 100,
    layoutMs25NodesAll: smallRuns.map(ms => Math.round(ms * 100) / 100),
  },
}, null, 2))
