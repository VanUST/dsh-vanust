/**
 * Structured JSONL logging for designmap (FR-9).
 *
 * The acceptance of every milestone reads these lines instead of "it compiled", so the
 * logger is deliberately boring: one object per line, a fixed event vocabulary, and a
 * sanitizer that turns `undefined`, `NaN` and cycles into JSON-safe values. A log call
 * must never throw — a logging failure is not allowed to fail a render.
 */

const MAX_STRING = 4000
const EVENTS = Object.freeze([
  'tool.enter',
  'tool.exit',
  'model.diff',
  'layout.done',
  'merge.applied',
  'merge.gc',
  'lint.result',
  'render.done',
  'overlay.write',
])

/** Make any value JSON-safe without throwing (null-safe serialization, FR-9). */
export function sanitize(value, seen = new WeakSet(), depth = 0) {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return null
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value
  if (typeof value !== 'object') return value
  if (depth > 8) return '[depth]'
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map(item => sanitize(item, seen, depth + 1))
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code ?? null }
  const out = {}
  for (const [key, item] of Object.entries(value)) out[key] = sanitize(item, seen, depth + 1)
  return out
}

/**
 * Create a logger.
 * @param write - Optional `(line: string) => void` JSONL sink (a file append, a test array).
 * @returns `{log, events, lines}`; `events` holds the sanitized rows for assertions.
 */
export function createLogger(write) {
  const events = []
  const log = (event, fields = {}) => {
    const row = { event, ...sanitize(fields) }
    events.push(row)
    if (write !== undefined) {
      try {
        write(`${JSON.stringify(row)}\n`)
      } catch {
        // Logging must never fail the operation.
      }
    }
    return row
  }
  return {
    log,
    events,
    lines: () => events.map(row => JSON.stringify(row)),
    has: event => events.some(row => row.event === event),
    find: event => events.find(row => row.event === event),
  }
}

/** The event vocabulary, exported so tests fail when an event is renamed silently. */
export { EVENTS }
