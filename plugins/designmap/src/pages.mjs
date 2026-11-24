/**
 * The page store: designmap/pages/<slug>.excalidraw, one Excalidraw scene file per page.
 *
 * There is no model, index or manifest: the DIRECTORY is the page list and the file is the
 * only content. An empty page is a valid page, so a missing element list reads as an empty
 * canvas rather than as an error; the two refusals this module has are `unknown_page` (a
 * page the caller named that does not exist) and `invalid_page` (a slug that could escape
 * the pages directory).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The refusal a caller can name: only an unknown page is worth stopping for. */
export class MapRefusal extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MapRefusal'
    this.code = code
  }
}

export const PAGE_SUFFIX = '.excalidraw'
const SCENE_SOURCE = 'https://github.com/iustimov/dsh-kit/tree/main/plugins/designmap'
export const SLUG = /^[a-z0-9][a-z0-9-]*$/

export function pagesDir(designmapDir) {
  return join(designmapDir, 'pages')
}

/** The empty scene: valid Excalidraw, and what a page created by map_edit starts as. */
export function emptyScene() {
  return {
    type: 'excalidraw',
    version: 2,
    source: SCENE_SOURCE,
    elements: [],
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    files: {},
  }
}

/** A slug that is safe as a file name inside the pages directory. */
export function assertSlug(slug) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    throw new MapRefusal('invalid_page', `${JSON.stringify(slug)} is not a page name: use lowercase letters, digits and '-'`)
  }
  return slug
}

export function pagePath(designmapDir, slug) {
  return join(pagesDir(designmapDir), `${assertSlug(slug)}${PAGE_SUFFIX}`)
}

/** Every page on disk, newest first, with the counts map_list reports. */
export function listPages(designmapDir) {
  const dir = pagesDir(designmapDir)
  if (!existsSync(dir)) return []
  const rows = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(PAGE_SUFFIX)) continue
    const page = file.slice(0, -PAGE_SUFFIX.length)
    if (!SLUG.test(page)) continue
    let scene
    try {
      scene = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    } catch {
      // An unreadable old file is a page with unknown content, not a broken list.
      rows.push({ page, nodes: 0, edges: 0, modified: statSync(join(dir, file)).mtime.toISOString(), unreadable: true })
      continue
    }
    const elements = Array.isArray(scene?.elements) ? scene.elements : []
    const shapes = elements.filter((entry) => SHAPES.has(entry?.type)).length
    const arrows = elements.filter((entry) => entry?.type === 'arrow').length
    rows.push({ page, nodes: shapes, edges: arrows, modified: statSync(join(dir, file)).mtime.toISOString() })
  }
  return rows.sort((left, right) => (left.modified < right.modified ? 1 : left.modified > right.modified ? -1 : 0))
}

export const SHAPES = new Set(['rectangle', 'ellipse', 'diamond'])

/** Read one page; an unknown page is refused by name, an empty page is not. */
export function readPage(designmapDir, slug) {
  const path = pagePath(designmapDir, slug)
  if (!existsSync(path)) {
    throw new MapRefusal('unknown_page', `no page "${slug}" in ${pagesDir(designmapDir)}`)
  }
  let scene
  try {
    scene = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new MapRefusal('unreadable_page', `${path}: ${error.message}`)
  }
  if (scene === null || typeof scene !== 'object' || !Array.isArray(scene.elements)) {
    // Tolerant by design: a file without an element list is an empty page, not a refusal.
    return { ...emptyScene(), ...(scene !== null && typeof scene === 'object' ? scene : {}), elements: [] }
  }
  return scene
}

/** Write one page atomically: a reader never sees half a scene. */
export function writePage(designmapDir, slug, scene) {
  const path = pagePath(designmapDir, slug)
  mkdirSync(pagesDir(designmapDir), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(scene, null, 2)}
`, 'utf8')
  renameSync(temp, path)
  return path
}

export function createPage(designmapDir, slug) {
  const path = pagePath(designmapDir, slug)
  if (existsSync(path)) throw new MapRefusal('page_exists', `page "${slug}" already exists`)
  return writePage(designmapDir, slug, emptyScene())
}

export function renamePage(designmapDir, from, to) {
  const source = pagePath(designmapDir, from)
  if (!existsSync(source)) throw new MapRefusal('unknown_page', `no page "${from}"`)
  const target = pagePath(designmapDir, to)
  if (existsSync(target)) throw new MapRefusal('page_exists', `page "${to}" already exists`)
  mkdirSync(pagesDir(designmapDir), { recursive: true })
  renameSync(source, target)
  return target
}

export function deletePage(designmapDir, slug) {
  const path = pagePath(designmapDir, slug)
  if (!existsSync(path)) throw new MapRefusal('unknown_page', `no page "${slug}"`)
  rmSync(path)
  return path
}
