/**
 * PURPOSE
 *   Shared reading of stored session logs, so the session diagnostics in this
 *   directory measure the same bytes the harness wrote instead of each carrying
 *   its own version of the format. The format has two properties that make a
 *   naive reader wrong: the file is a concatenation of independent zstd frames
 *   (one per append, hundreds per session), and provider token accounting hangs
 *   off `assistant/message` records rather than the request header.
 *
 * INPUTS
 *   Sessions are located under `<home>/sessions/<workspace>/<session-id>/`, where
 *   `<home>` is `$DSH_HOME`, `~/.dsh`, or `~/.npm/dsh` in that order.
 *
 * OUTPUTS
 *   `resolveHome()` → absolute harness home.
 *   `sessionFiles(home)` → every `session.*.jsonl.zstd` path, newest first.
 *   `decodeSession(bytes)` → the log's text.
 *   `usageSeries(text)` → one entry per billed request: `{turn, step, billed,
 *   cached, prompt, output, reasoning}`.
 *   Exports only pure functions; no file is written and no process state is read
 *   beyond the home directory.
 *
 * KEYWORDS
 *   session log, zstd frames, token usage, cache read, diagnostics, shared reader
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A file that is not zstd (an older plain JSON Lines log) is returned as text.
 *   - A frame that fails to decompress is skipped, because a four-byte magic can
 *     occur inside compressed data; the surrounding frames still decode.
 *   - A line that is not valid JSON is skipped; one damaged record never hides a
 *     whole session.
 *   - A message without a `usage` object contributes no entry, so callers can
 *     distinguish "no usage data" from "zero tokens".
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** Zstd frame magic; the boundary between frames in a session file. */
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Resolve the harness home.
 *
 * @returns Absolute path: `$DSH_HOME`, else `~/.dsh` when it exists, else the
 *   legacy `~/.npm/dsh`. Never throws and never consults the working directory.
 */
export function resolveHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  const conventional = join(homedir(), '.dsh')
  if (existsSync(conventional)) return conventional
  return join(homedir(), '.npm', 'dsh')
}

/**
 * List every session log under a harness home.
 *
 * @param home - Absolute harness home.
 * @returns Absolute file paths, newest modification first. An absent `sessions`
 *   directory yields an empty array rather than throwing.
 */
export function sessionFiles(home) {
  const root = join(home, 'sessions')
  if (!existsSync(root)) return []
  const found = []
  for (const bucket of readdirSync(root)) {
    const bucketPath = join(root, bucket)
    if (!statSync(bucketPath).isDirectory()) continue
    for (const entry of readdirSync(bucketPath)) {
      const sessionPath = join(bucketPath, entry)
      if (!statSync(sessionPath).isDirectory()) continue
      for (const file of readdirSync(sessionPath)) {
        if (file.startsWith('session.') && file.endsWith('.zstd')) found.push(join(sessionPath, file))
      }
    }
  }
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
}

/**
 * Decode a session file.
 *
 * Walks frame boundaries by magic and decompresses each frame independently; a
 * one-shot decompression of the whole file would return only the first frame and
 * report no error, which is the failure this function exists to avoid.
 *
 * @param bytes - The file's bytes.
 * @returns The concatenated log text.
 */
export function decodeSession(bytes) {
  if (bytes.indexOf(MAGIC) !== 0) return bytes.toString('utf8')
  const chunks = []
  let cursor = bytes.indexOf(MAGIC, 0)
  while (cursor >= 0 && cursor < bytes.length) {
    try {
      chunks.push(zstdDecompressSync(bytes.subarray(cursor)))
    } catch {
      // A magic sequence inside compressed payload: skip it and keep scanning.
    }
    cursor = bytes.indexOf(MAGIC, cursor + MAGIC.length)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Extract the per-request usage series from a decoded session log.
 *
 * @param text - Decoded session text.
 * @returns One entry per `assistant/message` carrying usage:
 *   `{turn, step, billed, cached, prompt, output, reasoning}` where `billed` is
 *   provider-reported uncached input, `cached` is cache-read input, and `prompt`
 *   is their sum — the prompt size that request actually sent.
 */
export function usageSeries(text) {
  const series = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record.type !== 'assistant/message') continue
    const usage = record.data?.usage
    if (!usage) continue
    const billed = usage.inputTokens ?? 0
    const cached = usage.cacheReadTokens ?? 0
    series.push({
      turn: record.data?.turn,
      step: record.data?.step,
      billed,
      cached,
      prompt: billed + cached,
      output: usage.outputTokens ?? 0,
      reasoning: usage.reasoningTokens ?? 0,
    })
  }
  return series
}

/** Read and decode one session file path. Thin wrapper for callers with a path. */
export function readSession(path) {
  return decodeSession(readFileSync(path))
}
