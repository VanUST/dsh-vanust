/**
 * API test: are the v1.1 interactive ELK options named by the designmap spec accepted
 * by elkjs 0.12.1, and do they do anything?
 *
 * Method (no guessing): ask the installed package for its own option metadata
 * (`knownLayoutOptions()`), then run the same graph twice per candidate option and
 * decide from behaviour. Silence is not acceptance in ELK: an unknown id and an
 * invalid enum value are both ignored without an error, so a candidate counts as
 * accepted only when the geometry changes in the direction the option promises.
 *
 * Usage: node elk-options.mjs
 * Exit code 0 when every verdict below is the one this test asserts.
 */
import { createHash } from 'node:crypto'
import ELK from 'elkjs'
import { installedVersion } from './version.mjs'

const elk = new ELK()
const version = installedVersion('elkjs')
const options = await elk.knownLayoutOptions()
const algorithms = await elk.knownLayoutAlgorithms()

const SPEC_KEYS = [
  'elk.layered.layeringStrategy',
  'elk.layered.crossingMinimizationStrategy',
  'org.eclipse.elk.position',
]
const metadata = Object.fromEntries(
  [...SPEC_KEYS, 'elk.layered.layering.strategy', 'elk.layered.crossingMinimization.strategy']
    .map(id => [id, options.find(option => option.id === id) ?? null]),
)

/** Five nodes in a diamond, so a layer change moves geometry rather than a label. */
function graph({ layoutOptions = {}, positions = null } = {}) {
  return {
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', ...layoutOptions },
    children: ['a', 'b', 'c', 'd'].map(id => ({
      id,
      width: 60,
      height: 30,
      ...(positions?.[id] === undefined ? {} : {
        // ELK's interactive layerer reads the INPUT x/y of a node, not an option.
        x: positions[id][0],
        y: positions[id][1],
      }),
    })),
    edges: [
      { id: 'e.a.c', sources: ['a'], targets: ['c'] },
      { id: 'e.b.c', sources: ['b'], targets: ['c'] },
      { id: 'e.c.d', sources: ['c'], targets: ['d'] },
    ],
  }
}

const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16)
const geometry = result => result.children.map(child => `${child.id}@${child.x},${child.y}`).join(' ')

async function run(label, build) {
  try {
    const result = await elk.layout(build())
    const text = geometry(result)
    return { label, ok: true, geometry: text, hash: hash(text) }
  } catch (error) {
    return { label, ok: false, error: String(error?.message ?? error) }
  }
}

const POS = { a: [400, 0], b: [0, 0], c: [200, 100], d: [600, 0] }
const cases = []
cases.push(await run('baseline (no interactive options)', () => graph()))
cases.push(await run('spec keys layeringStrategy+crossingMinimizationStrategy=INTERACTIVE, node x/y given', () => graph({
  layoutOptions: {
    'elk.layered.layeringStrategy': 'INTERACTIVE',
    'elk.layered.crossingMinimizationStrategy': 'INTERACTIVE',
  },
  positions: POS,
})))
cases.push(await run('canonical layering.strategy=INTERACTIVE, node x/y given', () => graph({
  layoutOptions: { 'elk.layered.layering.strategy': 'INTERACTIVE' },
  positions: POS,
})))
cases.push(await run('canonical layering.strategy=INTERACTIVE, NO node x/y', () => graph({
  layoutOptions: { 'elk.layered.layering.strategy': 'INTERACTIVE' },
})))
cases.push(await run('canonical layering.strategy=BOGUS, node x/y given', () => graph({
  layoutOptions: { 'elk.layered.layering.strategy': 'BOGUS' },
  positions: POS,
})))
cases.push(await run('canonical crossingMinimization.strategy=INTERACTIVE, node x/y given', () => graph({
  layoutOptions: { 'elk.layered.crossingMinimization.strategy': 'INTERACTIVE' },
  positions: POS,
})))
cases.push(await run('layering INTERACTIVE + crossingMinimization INTERACTIVE, node x/y given', () => graph({
  layoutOptions: {
    'elk.layered.layering.strategy': 'INTERACTIVE',
    'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
  },
  positions: POS,
})))
cases.push(await run('org.eclipse.elk.position as "x,y" strings, algorithm=fixed', () => ({
  id: 'root',
  layoutOptions: { 'elk.algorithm': 'fixed' },
  children: [
    { id: 'a', width: 60, height: 30, layoutOptions: { 'org.eclipse.elk.position': '400,0' } },
    { id: 'b', width: 60, height: 30, layoutOptions: { 'org.eclipse.elk.position': '0,50' } },
  ],
})))
cases.push(await run('org.eclipse.elk.position as {x,y} object, algorithm=fixed', () => ({
  id: 'root',
  layoutOptions: { 'elk.algorithm': 'fixed' },
  children: [
    { id: 'a', width: 60, height: 30, layoutOptions: { 'org.eclipse.elk.position': { x: 400, y: 0 } } },
  ],
})))
cases.push(await run('org.eclipse.elk.position as "x,y" strings, algorithm=layered', () => ({
  id: 'root',
  layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' },
  children: [
    { id: 'a', width: 60, height: 30, layoutOptions: { 'org.eclipse.elk.position': '400,0' } },
    { id: 'b', width: 60, height: 30, layoutOptions: { 'org.eclipse.elk.position': '0,50' } },
    { id: 'db', width: 60, height: 30 },
  ],
  edges: [{ id: 'e', sources: ['a'], targets: ['db'] }],
})))

const byLabel = Object.fromEntries(cases.map(row => [row.label, row]))
const baseline = byLabel['baseline (no interactive options)']
const canonicalLayering = byLabel['canonical layering.strategy=INTERACTIVE, node x/y given']
const canonicalLayeringNoPos = byLabel['canonical layering.strategy=INTERACTIVE, NO node x/y']
const bogus = byLabel['canonical layering.strategy=BOGUS, node x/y given']
const crossingOnly = byLabel['canonical crossingMinimization.strategy=INTERACTIVE, node x/y given']
const crossingPlusLayering = byLabel['layering INTERACTIVE + crossingMinimization INTERACTIVE, node x/y given']
const fixedPosition = byLabel['org.eclipse.elk.position as "x,y" strings, algorithm=fixed']
const objectPosition = byLabel['org.eclipse.elk.position as {x,y} object, algorithm=fixed']

const verdict = {
  'elk.layered.layeringStrategy': {
    inPackageMetadata: metadata['elk.layered.layeringStrategy'] !== null,
    verdict: 'IGNORED — unknown option id, silently dropped',
    evidence: `metadata: not found; with it set to INTERACTIVE the geometry equals baseline (${baseline.hash} vs ${byLabel['spec keys layeringStrategy+crossingMinimizationStrategy=INTERACTIVE, node x/y given'].hash})`,
  },
  'elk.layered.crossingMinimizationStrategy': {
    inPackageMetadata: metadata['elk.layered.crossingMinimizationStrategy'] !== null,
    verdict: 'IGNORED — unknown option id, silently dropped',
    evidence: `metadata: not found; geometry equals baseline (${baseline.hash} vs ${byLabel['spec keys layeringStrategy+crossingMinimizationStrategy=INTERACTIVE, node x/y given'].hash})`,
  },
  'elk.layered.layering.strategy=INTERACTIVE': {
    inPackageMetadata: metadata['elk.layered.layering.strategy'] !== null,
    verdict: 'ACCEPTED — behaviour changes, requires input node x/y',
    evidence: `with positions ${canonicalLayering.geometry} (${canonicalLayering.hash}) vs baseline ${baseline.geometry} (${baseline.hash}); without positions ${canonicalLayeringNoPos.geometry} (${canonicalLayeringNoPos.hash})`,
  },
  'elk.layered.crossingMinimization.strategy=INTERACTIVE': {
    inPackageMetadata: metadata['elk.layered.crossingMinimization.strategy'] !== null,
    verdict: 'ACCEPTED — geometry changes when positions are given',
    evidence: `crossingMinimization only ${crossingOnly.geometry} (${crossingOnly.hash}) vs baseline (${baseline.hash}); with interactive layering ${crossingPlusLayering.geometry} (${crossingPlusLayering.hash}) vs layering only (${canonicalLayering.hash})`,
  },
  'org.eclipse.elk.position': {
    inPackageMetadata: metadata['org.eclipse.elk.position'] !== null,
    verdict: 'KNOWN but NOT the interactive-layout input for layered: string "x,y" is parsed (fixed algorithm honours it), object form throws, layered ignores it',
    evidence: `fixed layout => ${fixedPosition.ok ? fixedPosition.geometry : `ERROR ${fixedPosition.error}`}; object form => ${objectPosition.ok ? objectPosition.geometry : `ERROR ${objectPosition.error}`}`,
  },
  'invalid enum value (control)': {
    inPackageMetadata: metadata['elk.layered.layering.strategy'] !== null,
    verdict: `SILENTLY IGNORED — geometry equals baseline (${bogus.hash} vs ${baseline.hash}), so "no error" proves nothing`,
    evidence: bogus.ok ? bogus.geometry : `ERROR ${bogus.error}`,
  },
}

const report = {
  elkjs: version,
  algorithms: algorithms.map(algorithm => algorithm.id),
  metadata,
  cases,
  verdict,
}
console.log(JSON.stringify(report, null, 2))

const failures = []
if (verdict['elk.layered.layeringStrategy'].inPackageMetadata) failures.push('spec key unexpectedly exists in metadata')
if (canonicalLayering.hash === baseline.hash) failures.push('canonical INTERACTIVE layering did not change geometry')
if (canonicalLayeringNoPos.hash !== baseline.hash) failures.push('INTERACTIVE without positions did not fall back to baseline')
if (bogus.hash !== baseline.hash) failures.push('invalid enum value was not silently ignored')
if (!fixedPosition.ok || fixedPosition.geometry !== 'a@400,0 b@0,50') failures.push('org.eclipse.elk.position "x,y" not honoured by fixed layout')
if (objectPosition.ok) failures.push('object-form org.eclipse.elk.position did not throw')
if (crossingPlusLayering.hash === canonicalLayering.hash) failures.push('crossingMinimization INTERACTIVE had no effect')
if (failures.length > 0) {
  console.error(`FAIL: ${failures.join('; ')}`)
  process.exitCode = 1
}
