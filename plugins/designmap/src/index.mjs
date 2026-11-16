/**
 * designmap-core public surface (M0).
 *
 * A pure Node package: schema and YAML IO, canonical sorting, ELK layout, overlay
 * merge with GC, lint, scene JSON, and the semantic diff/apply engine. No client
 * bundle, no agent tool registration, no manifest/stale plumbing — those are M1/M2/M3.
 */
export {
  DesignmapRefusal,
  REFUSALS,
  EDGE_KINDS,
  DIRECTIONS,
  ID,
  NODE_TYPES,
  VIEW_LEVELS,
  edgeSchema,
  groupSchema,
  modelSchema,
  nodeSchema,
  opBatchSchema,
  opSchema,
  overlayRowSchema,
  parseModel,
  parseOps,
  parseViews,
  sceneSchema,
  viewSchema,
  viewsSchema,
} from './schema.mjs'

export {
  labelLength,
  nodeSize,
  sceneLabel,
  wrapLabel,
  MAX_LABEL_CHARS,
  MAX_LINES,
} from './text.mjs'

export { PALETTE, PALETTE_COLOURS, inPalette, paletteFor } from './palette.mjs'

export {
  canonicalModel,
  canonicalViews,
  clone,
  round2,
  sha256,
  sortById,
  toJson,
} from './canonical.mjs'

export {
  EMPTY_MODEL,
  EMPTY_VIEWS,
  YAML_OPTIONS,
  createWorkspace,
  modelYaml,
  normaliseModelDocument,
  normaliseViewsDocument,
  parseModelText,
  parseViewsText,
  viewsYaml,
} from './workspace.mjs'

export { buildElkGraph, layoutView } from './layout.mjs'

export { mergeOverlays, recomputeCanvas } from './overlays.mjs'

export {
  LINT_RULES,
  findByRule,
  lintModel,
  lintScene,
  severityOf,
  summariseLint,
} from './lint.mjs'

export { matchesPattern, renderView, selectView } from './render.mjs'

export { INDEX_FILE, INDEX_SCHEMA_VERSION, buildIndex, renderAll } from './index-file.mjs'

export { diffDocuments, diffSummary } from './diff.mjs'

export { applyOps, applyToWorkspace, assertReferences } from './apply.mjs'

export { EVENTS, createLogger, sanitize } from './log.mjs'
