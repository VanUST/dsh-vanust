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
  frontend: { fill: '#bfdbfe', stroke: '#1d4ed8' },
  service: { fill: '#c7d2fe', stroke: '#4338ca' },
  worker: { fill: '#bbf7d0', stroke: '#15803d' },
  datastore: { fill: '#fde68a', stroke: '#b45309' },
  queue: { fill: '#fbcfe8', stroke: '#be185d' },
  external: { fill: '#e2e8f0', stroke: '#475569' },
})

/** Every colour a human is allowed to paint with, regardless of node type. */
export const PALETTE_COLOURS = Object.freeze(
  [...new Set(Object.values(PALETTE).flatMap(entry => [entry.fill, entry.stroke]))],
)

/** Whether a colour string is a plain hex colour the canvas can draw. */
export function isHexColour(colour) {
  return typeof colour === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(colour.trim())
}

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
