/**
 * PURPOSE
 *   Measure how much wall-clock time the agents on this machine were actually
 *   running, so provider spend can be divided by agent-hours rather than by
 *   calendar hours.
 *
 *   The usage export carries no duration of any kind: its rows are whole days, so
 *   it can say a month cost a given amount but never how many agents were alive
 *   while they cost it. The harness's own session logs do carry a millisecond
 *   timestamp on every record, and that is the only wall-clock evidence on the
 *   machine. This module turns those timestamps into busy intervals, unions them
 *   so that agents running in parallel are counted once each rather than once per
 *   pair, and reports the integral — agent-hours — alongside the peak number of
 *   agents alive at the same moment.
 *
 * INPUTS
 *   `collectIntervals(home, options)` takes a harness home directory, an idle gap
 *   in milliseconds, and an optional window of epoch milliseconds to keep.
 *   `options.idleGapMs` is the largest silence between two consecutive records of
 *   one session that still counts as the agent working; a longer silence ends the
 *   interval and the agent is treated as stopped.
 *   `options.windowStartMs` / `options.windowEndMs` bound the records considered.
 *   `summarizeByDay(intervals, offsetMinutes)` takes merged-free intervals and the
 *   UTC offset that defines a reporting day.
 *
 * OUTPUTS
 *   `collectIntervals(...)` → `{intervals, sessions, considered, unreadable}`.
 *   Each interval is `{start, end}` in epoch milliseconds, `end > start`.
 *   `sessions` counts the log files read; `considered` the files inside the
 *   window; `unreadable` lists `{path, reason}` for files that could not be read.
 *   `summarizeByDay(...)` → `Map<day, {seconds, peakConcurrency}>` keyed by
 *   `YYYY-MM-DD`, plus a `total` entry under the key `__total__` holding
 *   `{seconds, peakConcurrency}` for the whole window.
 *   `agentHours(byDay)` → the same map with `seconds` converted to hours.
 *
 * KEYWORDS
 *   agent hours, busy time, concurrency, session log, wall clock, interval union
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A session file that cannot be read or decoded is named in `unreadable` and
 *     the remaining files still contribute; one damaged log never zeroes the
 *     denominator silently.
 *   - A session whose log holds fewer than two timestamped records contributes no
 *     interval, because a single instant has no duration and inventing one would
 *     inflate the total.
 *   - Records outside the window are dropped before pairing, so a session that
 *     began in the previous month contributes only its in-window time.
 *   - An interval that crosses a reporting day is split at the boundary, so a
 *     day's figure is that day's time rather than the whole interval's.
 *   - A non-positive or absent idle gap falls back to the documented default
 *     rather than merging the entire month into one interval.
 */

import { readFileSync, statSync } from 'node:fs'
import { resolveHome, sessionFiles, decodeSession, recordTimeline } from '../session/session-log.mjs'

/** The largest silence inside one session that still counts as working. */
export const DEFAULT_IDLE_GAP_MS = 5 * 60 * 1000

/** The UTC offset, in minutes, that defines a reporting day for this deployment. */
export const DEFAULT_OFFSET_MINUTES = 180

const MS_PER_HOUR = 3_600_000
const SECONDS_PER_HOUR = MS_PER_HOUR / 1000

/**
 * Merge consecutive records of one session into the intervals it was working.
 *
 * A gap longer than the idle threshold is a stop, not work, so it is excluded
 * rather than charged to the agent.
 *
 * @param times - Record timestamps in epoch milliseconds, in file order.
 * @param idleGapMs - The largest gap still counted as working.
 * @returns `{start, end}[]` with `end > start`, in ascending order.
 */
export function intervalsFromTimestamps(times, idleGapMs) {
  const sorted = times.filter((time) => Number.isFinite(time)).sort((a, b) => a - b)
  const intervals = []
  for (let index = 1; index < sorted.length; index += 1) {
    const start = sorted[index - 1]
    const end = sorted[index]
    if (end - start <= idleGapMs && end > start) intervals.push({ start, end })
  }
  return intervals
}

/**
 * Read every session log under a harness home and reduce it to busy intervals.
 *
 * @param home - Absolute harness home; `resolveHome()` supplies the default.
 * @param options - `{idleGapMs, windowStartMs, windowEndMs, sinceMs}`. The window
 *   bounds are optional and inclusive. `sinceMs` skips whole files whose last
 *   modification precedes it: a session log is appended in time order, so a file
 *   untouched since before the window cannot hold a record inside it.
 * @returns `{intervals, sessions, considered, unreadable}` as described above.
 *   `intervals` is empty, never null, when nothing was read.
 */
export function collectIntervals(home = resolveHome(), options = {}) {
  const idleGapMs =
    Number.isFinite(options.idleGapMs) && options.idleGapMs > 0 ? options.idleGapMs : DEFAULT_IDLE_GAP_MS
  const hasStart = Number.isFinite(options.windowStartMs)
  const hasEnd = Number.isFinite(options.windowEndMs)
  const files = sessionFiles(home)
  const intervals = []
  const unreadable = []
  let sessions = 0
  let considered = 0

  for (const path of files) {
    if (Number.isFinite(options.sinceMs)) {
      let modified = Number.NaN
      try {
        modified = statSync(path).mtimeMs
      } catch {
        modified = Number.NaN
      }
      // An unreadable mtime is not evidence of an old file, so the file is read
      // rather than skipped; the record filter still bounds what it contributes.
      if (Number.isFinite(modified) && modified < options.sinceMs) continue
    }
    let text
    try {
      text = decodeSession(readFileSync(path))
    } catch (error) {
      unreadable.push({ path, reason: String(error?.message ?? error) })
      continue
    }
    sessions += 1
    const timeline = recordTimeline(text)
    const times = timeline
      .map((entry) => entry.time)
      .filter((time) => (!hasStart || time >= options.windowStartMs) && (!hasEnd || time <= options.windowEndMs))
    if (times.length < 2) continue
    considered += 1
    intervals.push(...intervalsFromTimestamps(times, idleGapMs))
  }

  return { intervals, sessions, considered, unreadable }
}

/**
 * Shift an epoch instant into the reporting day it belongs to.
 *
 * @param epochMs - Epoch milliseconds.
 * @param offsetMinutes - The reporting day's UTC offset in minutes.
 * @returns `YYYY-MM-DD`.
 */
export function dayKey(epochMs, offsetMinutes) {
  return new Date(epochMs + offsetMinutes * 60_000).toISOString().slice(0, 10)
}

/**
 * Split one interval at the reporting-day boundaries it crosses.
 *
 * @param interval - `{start, end}` in epoch milliseconds.
 * @param offsetMinutes - The reporting day's UTC offset in minutes.
 * @returns `{day, start, end}[]` covering the interval with no overlap and no gap.
 */
function splitByDay(interval, offsetMinutes) {
  const pieces = []
  let cursor = interval.start
  while (cursor < interval.end) {
    const day = dayKey(cursor, offsetMinutes)
    const dayStartMs = Date.parse(`${day}T00:00:00.000Z`) - offsetMinutes * 60_000
    const nextDayStartMs = dayStartMs + 24 * 3_600_000
    const end = Math.min(interval.end, nextDayStartMs)
    pieces.push({ day, start: cursor, end })
    cursor = end
  }
  return pieces
}

/**
 * Sum a set of intervals with overlaps counted once.
 *
 * @param intervals - `{start, end}[]`.
 * @returns Total covered milliseconds, never negative.
 */
export function unionMs(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  let total = 0
  let currentStart = null
  let currentEnd = null
  for (const interval of sorted) {
    if (currentStart === null) {
      currentStart = interval.start
      currentEnd = interval.end
      continue
    }
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end)
      continue
    }
    total += currentEnd - currentStart
    currentStart = interval.start
    currentEnd = interval.end
  }
  if (currentStart !== null) total += currentEnd - currentStart
  return total
}

/**
 * Find the largest number of intervals covering one instant.
 *
 * @param intervals - `{start, end}[]`.
 * @returns The peak overlap; 0 for an empty set. A zero-length interval never
 *   contributes, so an instant is never counted as an agent that ran.
 */
export function peakConcurrency(intervals) {
  const edges = []
  for (const interval of intervals) {
    if (interval.end <= interval.start) continue
    edges.push({ at: interval.start, delta: 1 })
    edges.push({ at: interval.end, delta: -1 })
  }
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta)
  let live = 0
  let peak = 0
  for (const edge of edges) {
    live += edge.delta
    if (live > peak) peak = live
  }
  return peak
}

/**
 * Aggregate busy intervals into per-day agent time and peak concurrency.
 *
 * @param intervals - `{start, end}[]` from `collectIntervals`.
 * @param offsetMinutes - The reporting day's UTC offset in minutes.
 * @returns `Map<day, {seconds, peakConcurrency}>`, plus `__total__` for the whole
 *   window. An empty input yields a map holding only `__total__` at zero.
 */
export function summarizeByDay(intervals, offsetMinutes = DEFAULT_OFFSET_MINUTES) {
  const byDay = new Map()
  for (const interval of intervals) {
    for (const piece of splitByDay(interval, offsetMinutes)) {
      if (!byDay.has(piece.day)) byDay.set(piece.day, [])
      byDay.get(piece.day).push({ start: piece.start, end: piece.end })
    }
  }
  const result = new Map()
  for (const [day, pieces] of byDay) {
    result.set(day, {
      seconds: unionMs(pieces) / 1000,
      peakConcurrency: peakConcurrency(pieces),
    })
  }
  result.set('__total__', {
    seconds: unionMs(intervals) / 1000,
    peakConcurrency: peakConcurrency(intervals),
  })
  return result
}

/**
 * Convert a per-day seconds summary into agent-hours.
 *
 * @param byDay - The map `summarizeByDay` returns.
 * @returns A new map of the same shape with `hours` added beside `seconds`.
 */
export function agentHours(byDay) {
  const converted = new Map()
  for (const [day, value] of byDay) {
    converted.set(day, { ...value, hours: value.seconds / SECONDS_PER_HOUR })
  }
  return converted
}
