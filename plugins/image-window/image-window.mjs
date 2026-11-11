/**
 * PURPOSE
 *   Keep the number of images in a session's request surface at or below a small
 *   window by offloading the image that falls out of it the moment a new one arrives.
 *
 * WHY. The harness offloads images REACTIVELY: an adapter rejects a request whose
 *   image bytes exceed the route budget with IMAGE_OFFLOAD_REQUIRED, and
 *   @deepseek-ai/dsh-compaction-image-offload then removes the OLDEST occurrences and
 *   retries. Removing an old message rewrites the request prefix at that position, and
 *   every provider that caches a prefix re-bills everything after it. Measured
 *   2026-11-10 (session-1cb0708d, kimi-coding, 532K-token context): six such offloads
 *   re-billed 1,783,829 of that session's 2,260,222 fresh input tokens, each collapse
 *   leaving only the first ~75K tokens cached.
 *
 *   The cost of a rewrite is the size of the suffix AFTER the changed position, so the
 *   fix is to change a position near the TAIL: a sliding window drops the image that
 *   just fell out (one or two messages back) instead of the first image of the session
 *   (hundreds of thousands of tokens back).
 *
 * INPUTS
 *   Config:
 *     keepImages - how many of the newest images stay in the request. Default 1: a
 *                  coding agent reads a screenshot to answer, and the previous one is
 *                  stale. Raise it for work that compares several images.
 *     enabled    - false turns the plugin off. Default true.
 *
 * OUTPUTS
 *   One image/offload session event per arrival that pushes an older image out of the
 *   window, using the projection @deepseek-ai/dsh-compaction-image-offload registers.
 *   No tool, no prompt section, no service.
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The projection is not registered (that harness plugin is disabled): append
 *     throws, the error is logged ONCE, and the session continues untouched.
 *   - An already-offloaded image is skipped; offloading it twice would throw.
 *   - A route that still rejects (one image larger than the whole byte budget) falls
 *     back to the harness's own offload, which stays mounted.
 *   - Only user/message and tool/result events can carry input images; assistant
 *     output is never touched.
 */
export const name = 'image-window'

/** Defaults, resolved once. */
const DEFAULTS = Object.freeze({ keepImages: 1, enabled: true })

/** Parse the config into a stable shape; a bad value falls back rather than throwing. */
function resolveConfig(config = {}) {
  const keepImages = Number.isInteger(config.keepImages) && config.keepImages >= 0 ? config.keepImages : DEFAULTS.keepImages
  return { keepImages, enabled: config.enabled !== false }
}

/**
 * Input images in request order, as offload targets: one entry per message that still
 * carries a non-offloaded occurrence, with that occurrence's depth-first image index.
 *
 * @param session - the session whose current surface is walked.
 * @returns One { seq, imageIndexes } entry per message, oldest first; empty when
 *   no image remains.
 */
export function inputImages(session) {
  const found = []
  const nodes = session?.surface?.nodes
  if (nodes === undefined) return found
  for (const seq of nodes) {
    const event = session.eventAt(seq)
    if (event?.type !== 'user/message' && event?.type !== 'tool/result') continue
    let message
    try {
      message = session.deriveEventMessage(event)
    } catch {
      continue
    }
    let imageIndex = 0
    const indexes = []
    for (const block of message?.content ?? []) {
      if (block?.type !== 'image') continue
      if (block.offloaded !== true) indexes.push(imageIndex)
      imageIndex += 1
    }
    if (indexes.length > 0) found.push({ seq, imageIndexes: indexes })
  }
  return found
}

/**
 * Offload the occurrences that push the window past keepImages, oldest first.
 *
 * @param session - session to rewrite.
 * @param keepImages - how many newest occurrences stay.
 * @param onError - called once with the append failure when the projection is missing.
 * @returns whether an offload decision was appended.
 */
export function trimImages(session, keepImages, onError) {
  const found = inputImages(session)
  const total = found.reduce((count, entry) => count + entry.imageIndexes.length, 0)
  if (total <= keepImages) return false
  let remaining = total - keepImages
  const targets = []
  for (const entry of found) {
    if (remaining <= 0) break
    const drop = entry.imageIndexes.slice(0, remaining)
    if (drop.length === 0) continue
    targets.push({ seq: entry.seq, imageIndexes: drop })
    remaining -= drop.length
  }
  if (targets.length === 0) return false
  try {
    session.append('image/offload', { targets })
    return true
  } catch (error) {
    onError?.(error)
    return false
  }
}

/** Whether an event can carry an input image block. */
function carriesInput(event) {
  return event?.type === 'user/message' || event?.type === 'tool/result'
}

/** Mount the per-agent session listener that keeps the window small. */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) {
    ctx.logger?.info?.('image-window: disabled by configuration')
    return
  }
  let reported = false
  ctx.on('agent/created', ({ agent }) => {
    agent?.ctx?.on('session/event', (session, event) => {
      if (session !== agent.session) return
      if (!carriesInput(event)) return
      trimImages(session, resolved.keepImages, (error) => {
        if (reported) return
        reported = true
        ctx.logger?.warn?.('image-window: the image/offload projection is not registered (' + String(error?.message ?? error) + '); images stay in the request')
      })
    })
  })
}
