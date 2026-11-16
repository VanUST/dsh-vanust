/**
 * The one colour table core owns.
 *
 * SCENE-CONTRACT: "the renderer may choose colours … from a `type`/`kind` table" but
 * overlays carrying "colours outside the type palette" are reported and ignored. The
 * palette therefore has to exist in core, or the merge rule has nothing to check
 * against. M1's renderer reads the same values from the scene envelope (it may shadow
 * them, but must not move geometry).
 */
export const PALETTE = Object.freeze({
  frontend: { fill: '#dbeafe', stroke: '#2563eb' },
  service: { fill: '#e0e7ff', stroke: '#4338ca' },
  worker: { fill: '#dcfce7', stroke: '#16a34a' },
  datastore: { fill: '#fef3c7', stroke: '#d97706' },
  queue: { fill: '#fce7f3', stroke: '#db2777' },
  external: { fill: '#f1f5f9', stroke: '#64748b' },
})

/** Every colour a human is allowed to paint with, regardless of node type. */
export const PALETTE_COLOURS = Object.freeze(
  [...new Set(Object.values(PALETTE).flatMap(entry => [entry.fill, entry.stroke]))],
)

/** Whether a colour string is in the palette (case-insensitive hex). */
export function inPalette(colour) {
  if (typeof colour !== 'string') return false
  const normalised = colour.toLowerCase()
  return PALETTE_COLOURS.some(entry => entry.toLowerCase() === normalised)
}

/** Palette entry for a node type, falling back to `external`. */
export function paletteFor(type) {
  return PALETTE[type] ?? PALETTE.external
}
