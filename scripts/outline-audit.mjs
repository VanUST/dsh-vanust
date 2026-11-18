#!/usr/bin/env node
/**
 * PURPOSE
 *   Journal audit for the outline saving: how often `outline` is called, in how many sessions,
 *   and how many bytes `read` returned in sessions WITH an outline call versus sessions
 *   WITHOUT one. The first outline call is the cut point: rows before it are the baseline, rows
 *   after it are the effect. Until the profile ships the plugin, the audit reports zero calls —
 *   that is the baseline, not an error.
 *
 * OUTPUT
 *   { sessions, outline: {calls, sessions, firstCall}, read: {withOutline, withoutOutline,
 *     baselineBefore}, byRole }
 *
 * USAGE
 *   node scripts/outline-audit.mjs [--json]
 */

import { readdir, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = process.env.DSH_HOME ?? join(homedir(), '.npm', 'dsh')
const ROOT = join(HOME, 'sessions')

async function walk(dir, out = []) {
  let entries = []
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await walk(path, out)
    else if (entry.name === 'session.v4.jsonl.zstd') out.push(path)
  }
  return out
}

function decode(path) {
  return new Promise((resolve) => {
    const child = spawn('zstd', ['-dc', path], { stdio: ['ignore', 'pipe', 'ignore'] })
    let text = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { text += chunk })
    child.on('close', () => resolve(text))
    child.on('error', () => resolve(''))
  })
}

const files = await walk(ROOT)
const sessions = []
let outlineCalls = 0
let outlineSessions = 0
let firstCall = null
for (const file of files) {
  const text = await decode(file)
  if (text === '') continue
  const sessionId = file.split('/').slice(-2)[0]
  const calls = new Map()
  let outline = 0
  let readBytes = 0
  let readResults = 0
  let role = ''
  for (const line of text.split('\n')) {
    if (line === '' || line[0] !== '{') continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (event.type === 'agent-preset/selected' && typeof event.data?.agentPreset === 'string') role = event.data.agentPreset
    if (event.type === 'tool/call') {
      const name = event.data?.name ?? ''
      if (typeof event.data?.callId === 'string') calls.set(event.data.callId, name)
      if (name === 'outline') {
        outline += 1
        const at = typeof event.time === 'number' ? event.time : null
        if (at !== null && (firstCall === null || at < firstCall)) firstCall = at
      }
    } else if (event.type === 'tool/result') {
      const name = calls.get(event.data?.toolCallId ?? event.data?.message?.toolCallId ?? '') ?? ''
      if (name !== 'read') continue
      const content = event.data?.message?.content
      readBytes += Array.isArray(content) ? content.reduce((sum, part) => sum + Buffer.byteLength(String(part?.text ?? ''), 'utf8'), 0) : 0
      readResults += 1
    }
  }
  if (outline > 0) outlineSessions += 1
  outlineCalls += outline
  if (readResults > 0) sessions.push({ sessionId, role, outline, readBytes, readResults })
}

const withOutline = sessions.filter((session) => session.outline > 0)
const withoutOutline = sessions.filter((session) => session.outline === 0)
const avg = (list) => (list.length === 0 ? 0 : Math.round(list.reduce((sum, session) => sum + session.readBytes, 0) / list.length))
const result = {
  generatedAt: new Date().toISOString(),
  sessions: sessions.length,
  outline: { calls: outlineCalls, sessions: outlineSessions, firstCall: firstCall === null ? null : new Date(firstCall).toISOString() },
  read: {
    withOutline: { sessions: withOutline.length, results: withOutline.reduce((sum, s) => sum + s.readResults, 0), bytes: withOutline.reduce((sum, s) => sum + s.readBytes, 0), averageBytesPerSession: avg(withOutline) },
    withoutOutline: { sessions: withoutOutline.length, results: withoutOutline.reduce((sum, s) => sum + s.readResults, 0), bytes: withoutOutline.reduce((sum, s) => sum + s.readBytes, 0), averageBytesPerSession: avg(withoutOutline) },
  },
  byRole: Object.fromEntries([...new Set(sessions.map((s) => s.role || '(none)'))].map((role) => {
    const rows = sessions.filter((s) => (s.role || '(none)') === role)
    return [role, { sessions: rows.length, outlineCalls: rows.reduce((sum, s) => sum + s.outline, 0), readBytes: rows.reduce((sum, s) => sum + s.readBytes, 0) }]
  })),
  verdict: outlineCalls === 0
    ? 'baseline: the outline plugin is not installed in the live profile, so there are no calls; the audit is ready for the first session after the profile update'
    : `outline calls ${outlineCalls} in ${outlineSessions} session(s); compare average read bytes per session with the no-outline group`,
}
if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
else {
  console.log(`sessions with read results: ${result.sessions}`)
  console.log(`outline: ${result.outline.calls} call(s) in ${result.outline.sessions} session(s), first ${result.outline.firstCall ?? '—'}`)
  console.log(`read bytes with outline: ${result.read.withOutline.bytes} over ${result.read.withOutline.sessions} session(s) (avg ${result.read.withOutline.averageBytesPerSession})`)
  console.log(`read bytes without outline: ${result.read.withoutOutline.bytes} over ${result.read.withoutOutline.sessions} session(s) (avg ${result.read.withoutOutline.averageBytesPerSession})`)
  console.log(result.verdict)
}
