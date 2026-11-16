/**
 * YAML/JSON document IO for one designmap workspace directory.
 *
 * Emission is pinned so `apply` can be byte-identical for identical content
 * (API-TESTS-CORE.md §3): `lineWidth: 0` stops the default 80-column folding, the
 * indent is 2, and strings stay plain unless they must be quoted. A `|` block scalar
 * keeps its trailing newline, so labels are normalised on read.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import YAML from 'yaml'
import { canonicalModel, canonicalViews, sha256 } from './canonical.mjs'
import { DesignmapRefusal, REFUSALS, parseModel, parseViews } from './schema.mjs'

export const YAML_OPTIONS = Object.freeze({
  lineWidth: 0,
  indent: 2,
  blockQuote: 'literal',
  defaultStringType: 'PLAIN',
  defaultKeyType: 'PLAIN',
})

export const EMPTY_MODEL = Object.freeze({ schemaVersion: 1, groups: [], nodes: [], edges: [] })
export const EMPTY_VIEWS = Object.freeze({ schemaVersion: 1, views: [] })

/** Strip the trailing newline a `|` block scalar leaves on a one-line label. */
function trimLabel(value) {
  return typeof value === 'string' ? value.replace(/\n+$/u, '') : value
}

/** Normalise the free-text fields of a model document before validation. */
export function normaliseModelDocument(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const document = { ...raw }
  if (Array.isArray(document.nodes)) {
    document.nodes = document.nodes.map(node => (node !== null && typeof node === 'object' ? { ...node, label: trimLabel(node.label) } : node))
  }
  if (Array.isArray(document.edges)) {
    document.edges = document.edges.map(edge => (edge !== null && typeof edge === 'object' ? { ...edge, label: trimLabel(edge.label) } : edge))
  }
  if (Array.isArray(document.groups)) {
    document.groups = document.groups.map(group => (group !== null && typeof group === 'object' ? { ...group, label: trimLabel(group.label) } : group))
  }
  return document
}

/** Normalise the free-text fields of a views document before validation. */
export function normaliseViewsDocument(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const document = { ...raw }
  if (Array.isArray(document.views)) {
    document.views = document.views.map(view => (view !== null && typeof view === 'object' ? { ...view, title: trimLabel(view.title) } : view))
  }
  return document
}

function parseYaml(text, file, code) {
  try {
    return YAML.parse(text, { uniqueKeys: true })
  } catch (error) {
    throw new DesignmapRefusal(code, `${file} is not valid YAML: ${error.message}`, { file, cause: error.message })
  }
}

/** Parse and validate model YAML text. */
export function parseModelText(text) {
  return parseModel(normaliseModelDocument(parseYaml(text, 'model.yaml', REFUSALS.invalidModel)))
}

/** Parse and validate views YAML text. */
export function parseViewsText(text) {
  return parseViews(normaliseViewsDocument(parseYaml(text, 'views.yaml', REFUSALS.invalidViews)))
}

/** Canonical YAML text for a model document. */
export function modelYaml(model) {
  return YAML.stringify(canonicalModel(model), YAML_OPTIONS)
}

/** Canonical YAML text for a views document. */
export function viewsYaml(views) {
  return YAML.stringify(canonicalViews(views), YAML_OPTIONS)
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, text, 'utf8')
  renameSync(temporary, path)
}

/**
 * A workspace directory: `designmap/model.yaml`, `views.yaml`, `overlays.json` and
 * `designmap/out/<viewId>.scene.json`. A missing model or views file is the empty
 * document, never an error (INV-EMPTY).
 */
export function createWorkspace(root) {
  const dir = resolve(root)
  const paths = {
    dir,
    model: join(dir, 'model.yaml'),
    views: join(dir, 'views.yaml'),
    overlays: join(dir, 'overlays.json'),
    out: join(dir, 'out'),
    index: join(dir, 'out', 'index.json'),
  }

  const readText = path => (existsSync(path) ? readFileSync(path, 'utf8') : null)

  return {
    paths,
    readModel() {
      const text = readText(paths.model)
      if (text === null) return { model: structuredClone(EMPTY_MODEL), text: null, hash: null, missing: true }
      return { model: parseModelText(text), text, hash: sha256(text), missing: false }
    },
    readViews() {
      const text = readText(paths.views)
      if (text === null) return { views: structuredClone(EMPTY_VIEWS), text: null, hash: null, missing: true }
      return { views: parseViewsText(text), text, hash: sha256(text), missing: false }
    },
    readOverlays() {
      const text = readText(paths.overlays)
      if (text === null) return { overlays: {}, text: null, hash: null, missing: true }
      let overlays
      try {
        overlays = JSON.parse(text)
      } catch (error) {
        // A malformed overlays file is a human edit gone wrong: ignore it with a
        // warning-shaped value rather than failing the render (FR-4).
        return { overlays: {}, text, hash: sha256(text), missing: false, malformed: error.message }
      }
      return { overlays, text, hash: sha256(text), missing: false }
    },
    writeModel(model) {
      const text = modelYaml(model)
      writeAtomic(paths.model, text)
      return { text, hash: sha256(text) }
    },
    writeViews(views) {
      const text = viewsYaml(views)
      writeAtomic(paths.views, text)
      return { text, hash: sha256(text) }
    },
    scenePath(viewId) {
      return join(paths.out, `${viewId}.scene.json`)
    },
    writeScene(viewId, sceneJson) {
      const path = this.scenePath(viewId)
      writeAtomic(path, sceneJson)
      return { path, hash: sha256(sceneJson) }
    },
    readIndex() {
      const text = readText(paths.index)
      if (text === null) return { index: null, text: null, hash: null, missing: true }
      try {
        return { index: JSON.parse(text), text, hash: sha256(text), missing: false }
      } catch (error) {
        return { index: null, text, hash: sha256(text), missing: false, malformed: error.message }
      }
    },
    writeIndex(indexJson) {
      writeAtomic(paths.index, indexJson)
      return { path: paths.index, hash: sha256(indexJson) }
    },
    /** Write overlays.json in a stable form: `$version` first, node ids sorted. */
    writeOverlays(overlays) {
      const document = { $version: 1 }
      for (const id of Object.keys(overlays).filter(key => key !== '$version').sort()) document[id] = overlays[id]
      const text = `${JSON.stringify(document, null, 2)}\n`
      writeAtomic(paths.overlays, text)
      return { path: paths.overlays, text, hash: sha256(text) }
    },
    hashOf(kind) {
      const path = paths[kind]
      const text = readText(path)
      return text === null ? null : sha256(text)
    },
  }
}
