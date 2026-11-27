/*
PROOF: the independent design-map drivers read the public tool surface, not the source internals.
Behavior: every acceptance driver resolves the tree under test from the working directory (or
  DM_ROOT), calls the plugin's registered map tools through createPageTools, and calls the same
  /designmap command handler the panel uses; a rendered PNG is decoded with the kit's pngjs
  (`PNG.sync.read(buffer)` -> { width, height, data }, four RGBA bytes per pixel).
Fails when: a driver reaches into an internal helper instead of the registered tool, or hard-codes
  the tree it is verifying, so the same driver cannot be run against the previous version.
Production path: plugins/designmap/src/page-tools.mjs, src/command.mjs (public surface).
*/
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const ROOT = process.env.DM_ROOT ?? process.cwd()

export async function load(rel) {
  return import(pathToFileURL(join(ROOT, rel)).href)
}

/** The five map tools, with the plugin's own host resolver replaced by a fixed page dir. */
export async function toolSurface(designmapDir) {
  const { createPageTools } = await load('plugins/designmap/src/page-tools.mjs')
  const tools = createPageTools({ defineTool: (def) => def, pageHostFor: () => ({ designmapDir }) })
  return {
    names: tools.map((tool) => tool.name),
    async call(name, args) {
      const tool = tools.find((entry) => entry.name === name)
      if (tool === undefined) throw new Error(`tool ${name} is not registered (registered: ${tools.map((entry) => entry.name).join(', ')})`)
      return tool.execute(args, {})
    },
  }
}

export async function commandHandler(designmapDir) {
  const { createCommandHandler } = await load('plugins/designmap/src/command.mjs')
  return async (op) => createCommandHandler({ hostFor: () => ({ designmapDir }) })({ rawInput: JSON.stringify(op), agent: {} })
}

export function tempDesignmap() {
  const base = mkdtempSync(join(tmpdir(), 'dm-accept-'))
  return { base, dir: join(base, 'designmap') }
}

/** Read the one page file through the filesystem, as a reload would. */
export function pageFile(dir, slug) {
  return JSON.parse(readFileSync(join(dir, 'pages', `${slug}.excalidraw`), 'utf8'))
}

export function shapesOf(scene) {
  return (scene.elements ?? []).filter((entry) => ['rectangle', 'ellipse', 'diamond'].includes(entry?.type) && entry.isDeleted !== true)
}

export function boxesOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

export function contentBounds(shapes) {
  if (shapes.length === 0) return { width: 0, height: 0, x: 0, y: 0 }
  const left = Math.min(...shapes.map((shape) => shape.x))
  const top = Math.min(...shapes.map((shape) => shape.y))
  const right = Math.max(...shapes.map((shape) => shape.x + shape.width))
  const bottom = Math.max(...shapes.map((shape) => shape.y + shape.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** PNG pixels, decoded with the kit's own pngjs copy (test tooling, not product code). */
export async function readPng(path) {
  const { PNG } = await import(pathToFileURL(join(ROOT, '.tools', 'node_modules', 'pngjs', 'lib', 'png.js')).href)
  const png = PNG.sync.read(readFileSync(path))
  const colours = new Map()
  for (let index = 0; index < png.data.length; index += 4) {
    const key = `${png.data[index]},${png.data[index + 1]},${png.data[index + 2]},${png.data[index + 3]}`
    colours.set(key, (colours.get(key) ?? 0) + 1)
  }
  return { width: png.width, height: png.height, colours }
}

export function filesUnder(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) filesUnder(full, base, out)
    else out.push(full.slice(base.length + 1))
  }
  return out
}

/** Write the machine-readable summary the case runner reads (CASE_SUMMARY is a file path). */
export function writeSummary(value) {
  if (typeof process.env.CASE_SUMMARY === 'string' && process.env.CASE_SUMMARY !== '') {
    writeFileSync(process.env.CASE_SUMMARY, JSON.stringify(value, null, 2))
  }
}

/** Run one named case; a failure exits non-zero and names what it saw. */
export function runCase(name, body) {
  const failures = []
  const log = (...parts) => console.log(`[${name}]`, ...parts)
  return Promise.resolve(body({
    log,
    check(condition, message) {
      if (condition) { log('ok  -', message); return }
      failures.push(message)
      log('FAIL-', message)
    },
    equal(actual, expected, message) {
      if (actual === expected) { log('ok  -', message, '=', actual); return }
      failures.push(`${message}: expected ${expected}, got ${actual}`)
      log('FAIL-', message, 'expected', expected, 'got', actual)
    },
  })).then(() => {
    console.log(`CASE_SUMMARY ${JSON.stringify({ case: name, failures: failures.length, checks: failures.length === 0 ? 'pass' : 'fail' })}`)
    writeSummary({ metrics: { failures: failures.length }, notes: `${name}: ${failures.length} failed check(s)`, artifacts: [] })
    if (failures.length > 0) {
      console.error(`\n${name} FAILED (${failures.length}):\n- ${failures.join('\n- ')}`)
      process.exit(1)
    }
  }).catch((error) => {
    console.error(`CASE_SUMMARY ${JSON.stringify({ case: name, failures: 1, checks: 'fail' })}`)
    writeSummary({ metrics: { failures: 1 }, notes: `${name}: exception: ${String(error?.message ?? error).slice(0, 300)}`, artifacts: [] })
    console.error(`\n${name} FAILED with an exception: ${error?.stack ?? error}`)
    process.exit(1)
  })
}

export function argCase() {
  const index = process.argv.indexOf('--case')
  return index >= 0 ? process.argv[index + 1] : process.argv[2]
}
