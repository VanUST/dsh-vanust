#!/usr/bin/env node
/**
 * PURPOSE
 *   Context budgets per preset (FR2, decision D13): for every role read the FIRST request of
 *   its latest session and compare four numbers with the preset's own budget —
 *   the tool count, the bytes of the tool schemas in the request header, the bytes of the
 *   system prompt and the bytes of the reminders (the harness-injected user messages).
 *
 * WHY BOTH NUMBERS
 *   A preset can pass a tool-count budget and still send a huge schema every step; it can also
 *   carry few tools and a large system prompt (PTC). The owner's answer to D13: count both, and
 *   for a PTC preset take the BYTE budget from the mode's own baseline (~53 KB), not from a
 *   native preset's 24-25 KB — otherwise the gate is either always green (1 tool) or always red.
 *
 * HOW THE VERDICT IS FORMED
 *   - native preset: more tools than `recommended` -> WARNING (exit 0);
 *     more tools than 1.5 x `tools` (the declared allowance) -> RED (exit 1);
 *     schema/prompt/reminder bytes above their budget -> WARNING only.
 *   - PTC preset observed in PTC mode (the header carries at most 2 tools): the `ptc` budget
 *     applies; byte overages are never a failure, a tool count above 1.5 x `ptc.tools` is.
 *
 * INPUTS
 *   --sessions <dir>    session store root (default $DSH_HOME/sessions or ~/.npm/dsh/sessions)
 *   --profile <file>    profile patch that holds the budgets (default profile/cordis.patch.yml)
 *   --budgets <file>    JSON file {preset: budget} replacing the profile's table (tests, control)
 *   --budget-tools <p>=<n>  override one preset's `tools` allowance (negative control)
 *   --json              print the machine-readable table instead of the markdown table
 *   --presets <a,b>     restrict to these presets
 *   --session <prefix>  restrict to session ids with this prefix
 *
 * OUTPUTS
 *   One line per preset, then a summary line; exit 0 when no preset is red, 1 when one is.
 *   `--json` prints `{ ok, presets: [...], red: [...] }` and nothing else.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import { decodeSession } from './session/session-log.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const KIT_PRESETS = ['orchestrator', 'architect', 'ux', 'presenter', 'backend', 'research', 'gatherer', 'reviewer', 'critic', 'docs']
const REMINDER_KINDS = new Set(['agent-instructions', 'runtime-context', 'skill-catalog', 'time-context'])
const RED_FACTOR = 1.5

const argv = process.argv.slice(2)
const value = (name) => {
  const at = argv.indexOf(name)
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : ''
}
const flag = (name) => argv.includes(name)

const sessionsRoot = value('--sessions') !== ''
  ? resolve(value('--sessions'))
  : (process.env.DSH_HOME !== undefined && existsSync(join(process.env.DSH_HOME, 'sessions'))
      ? join(process.env.DSH_HOME, 'sessions')
      : join(homedir(), '.npm', 'dsh', 'sessions'))
const profilePath = value('--profile') !== '' ? resolve(value('--profile')) : join(KIT, 'profile', 'cordis.patch.yml')
const budgetsFile = value('--budgets')
const onlyPresets = value('--presets') !== '' ? new Set(value('--presets').split(',').map((name) => name.trim())) : null
const sessionPrefix = value('--session')
const override = new Map()
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] !== '--budget-tools') continue
  const [preset, amount] = String(argv[index + 1] ?? '').split('=')
  if (preset !== undefined && preset !== '' && Number.isFinite(Number(amount))) override.set(preset, Number(amount))
}

const utf8 = (text) => Buffer.byteLength(text ?? '', 'utf8')
const contentOf = (event) => (Array.isArray(event?.data?.message?.content) ? event.data.message.content : Array.isArray(event?.data?.content) ? event.data.content : [])
const contentBytes = (content) => {
  let total = 0
  for (const block of content) if (block !== null && typeof block === 'object' && typeof block.text === 'string') total += utf8(block.text)
  return total
}

/** Parse the budget table out of the tool-families config block (the policy's owner). */
export function parseBudgetsFromProfile(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^\s+- id: tool-families\s*$/.test(line))
  if (start < 0) return {}
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*# ── /.test(lines[index]) || /^\s*- insert:/.test(lines[index])) { end = index; break }
  }
  const block = lines.slice(start, end)
  const at = block.findIndex((line) => /^\s+budgets:\s*$/.test(line))
  if (at < 0) return {}
  const base = block[at].match(/^\s*/)[0].length
  const budgets = {}
  let preset = null
  let section = null
  for (let index = at + 1; index < block.length; index += 1) {
    const line = block[index]
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const indent = line.match(/^\s*/)[0].length
    if (indent <= base) break
    const entry = /^\s*-?\s*([A-Za-z-]+):\s*(.*)$/.exec(line)
    if (entry === null) continue
    const [, key, rest] = entry
    if (indent === base + 2) {
      preset = key
      budgets[preset] = {}
      section = null
      continue
    }
    if (preset === null) continue
    if (indent === base + 4) {
      if (rest.trim() === '') { section = key; budgets[preset][section] = {}; continue }
      const numeric = /^(-?\d+(?:\.\d+)?)\s*$/.exec(rest.trim())
      if (numeric !== null) budgets[preset][key] = Number(numeric[1])
      continue
    }
    if (indent === base + 6 && section !== null) {
      const numeric = /^(-?\d+(?:\.\d+)?)\s*$/.exec(rest.trim())
      if (numeric !== null) budgets[preset][section][key] = Number(numeric[1])
    }
  }
  return budgets
}

/** Session files across every workspace directory. */
export function sessionFiles(root) {
  const files = []
  let workspaces = []
  try {
    workspaces = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name))
  } catch {
    return files
  }
  for (const workspace of workspaces) {
    let sessions = []
    try {
      sessions = readdirSync(workspace, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(workspace, entry.name))
    } catch {
      continue
    }
    for (const session of sessions) {
      const file = join(session, 'session.v4.jsonl.zstd')
      if (!existsSync(file)) continue
      files.push(file)
    }
  }
  return files
}

/** The session header: the first zstd frame only. */
function readSession(file) {
  try {
    const first = zstdDecompressSync(readFileSync(file)).toString('utf8').split('\n')[0]
    return JSON.parse(first)
  } catch {
    return null
  }
}

/** Decode the whole journal (all zstd frames), skipping a damaged line. */
function readEvents(file) {
  const events = []
  let text
  try {
    text = decodeSession(readFileSync(file))
  } catch {
    return events
  }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // one damaged record does not hide the session
    }
  }
  return events
}

/**
 * Measure the FIRST request of a session: header, system prompt and the reminders in force
 * before the first assistant message (the point where the prefix is fixed).
 */
export function measureFirstRequest(events) {
  const firstAssistant = events.find((event) => event.type === 'assistant/message')
  const before = firstAssistant === undefined ? events : events.filter((event) => event.seq === undefined || firstAssistant.seq === undefined || event.seq < firstAssistant.seq)
  const header = [...before].reverse().find((event) => event.type === 'request/header') ?? null
  const system = [...before].reverse().find((event) => event.type === 'system/message') ?? null
  const reminders = before.filter((event) => event.type === 'user/message' && REMINDER_KINDS.has(event.data?.source?.kind))
  const tools = header?.data?.header?.tools ?? []
  return {
    headerSeq: header?.seq ?? null,
    tools: tools.length,
    schemaBytes: utf8(JSON.stringify(tools)),
    systemBytes: system === null ? 0 : contentBytes(contentOf(system)),
    reminderBytes: reminders.reduce((total, event) => total + contentBytes(contentOf(event)), 0),
    reminderKinds: reminders.map((event) => event.data?.source?.kind).sort(),
  }
}

/** The preset in force: the last selection event wins over the creation header. */
function presetOf(events, headerEvent) {
  const selected = events.filter((event) => event.type === 'agent-preset/selected').at(-1)?.data?.agentPreset
  if (typeof selected === 'string' && selected !== '') return selected
  return headerEvent?.agentPreset ?? '(none)'
}

const budgetsFromProfile = budgetsFile !== ''
  ? JSON.parse(readFileSync(resolve(budgetsFile), 'utf8'))
  : parseBudgetsFromProfile(readFileSync(profilePath, 'utf8'))

const files = sessionFiles(sessionsRoot)
const latest = new Map()
for (const file of files) {
  const header = readSession(file)
  if (header === null) continue
  if (sessionPrefix !== '' && !String(header.id).startsWith(sessionPrefix)) continue
  const events = readEvents(file)
  const preset = presetOf(events, header)
  if (!KIT_PRESETS.includes(preset)) continue
  // A role's canonical surface is a chat STARTED on that preset (depth 0); a delegated child
  // inherits the same restriction but is measured through its root chat.
  if ((header.delegationDepth ?? 0) > 0) continue
  if (onlyPresets !== null && !onlyPresets.has(preset)) continue
  const measured = measureFirstRequest(events)
  if (measured.headerSeq === null) continue
  const row = { preset, session: header.id, depth: header.delegationDepth ?? 0, file, createdAt: header.createdAt ?? 0, ...measured }
  const current = latest.get(preset)
  if (current === undefined || row.createdAt > current.createdAt) latest.set(preset, row)
}

const rows = []
const red = []
const warnings = []
for (const preset of KIT_PRESETS) {
  const row = latest.get(preset)
  if (row === undefined) {
    rows.push({ preset, session: null, tools: null, verdict: 'no-session' })
    if (onlyPresets === null) warnings.push(`${preset}: no session found`)
    continue
  }
  const budget = budgetsFromProfile[preset] ?? {}
  const ptcSession = row.tools <= 2 && budget.ptc !== undefined
  const toolsBudget = override.has(preset) ? override.get(preset) : (ptcSession ? budget.ptc.tools : budget.tools)
  const recommended = budget.recommended ?? toolsBudget
  const verdicts = []
  if (typeof toolsBudget === 'number' && row.tools > toolsBudget * RED_FACTOR) {
    verdicts.push({ level: 'red', metric: 'tools', value: row.tools, budget: toolsBudget })
  } else if (typeof recommended === 'number' && row.tools > recommended) {
    verdicts.push({ level: 'warn', metric: 'tools', value: row.tools, budget: recommended })
  }
  const byteBudget = ptcSession ? budget.ptc.promptBytes : budget.promptBytes
  for (const [metric, value, limit] of [
    ['schemaBytes', row.schemaBytes, budget.schemaBytes],
    ['systemBytes', row.systemBytes, byteBudget],
    ['reminderBytes', row.reminderBytes, budget.reminderBytes],
  ]) {
    if (typeof limit !== 'number' || value <= limit) continue
    // A byte budget is a warning for a native preset; for a PTC session the mode's own baseline
    // is the reference and an overage is still only a warning (D13).
    verdicts.push({ level: 'warn', metric, value, budget: limit })
  }
  const worst = verdicts.some((entry) => entry.level === 'red') ? 'red' : verdicts.length > 0 ? 'warn' : 'ok'
  if (worst === 'red') red.push(preset)
  rows.push({ preset, session: row.session, depth: row.depth, mode: ptcSession ? 'ptc' : 'native', tools: row.tools, toolsBudget, recommended, schemaBytes: row.schemaBytes, systemBytes: row.systemBytes, reminderBytes: row.reminderBytes, verdict: worst, details: verdicts })
}

if (flag('--json')) {
  console.log(JSON.stringify({ ok: red.length === 0, presets: rows, red }, null, 1))
  process.exitCode = red.length === 0 ? 0 : 1
} else {
  const n = (value) => (value === null || value === undefined ? '—' : String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' '))
  console.log('| preset | tools | budget | recommended | schema B | system B | reminders B | verdict |')
  console.log('|---|---|---|---|---|---|---|---|')
  for (const row of rows) {
    if (row.session === null) {
      console.log(`| ${row.preset} | — | — | — | — | — | — | no session |`)
      continue
    }
    console.log(`| ${row.preset}${row.mode === 'ptc' ? ' (ptc)' : ''} | ${n(row.tools)} | ${n(row.toolsBudget)} | ${n(row.recommended)} | ${n(row.schemaBytes)} | ${n(row.systemBytes)} | ${n(row.reminderBytes)} | ${row.verdict.toUpperCase()} |`)
  }
  for (const row of rows) {
    for (const detail of row.details ?? []) {
      if (detail.level === 'warn') console.log(`  warning: ${row.preset} ${detail.metric}=${detail.value} > budget ${detail.budget}`)
    }
  }
  for (const warning of warnings) console.log(`  warning: ${warning}`)
  console.log(`\n${rows.filter((row) => row.verdict === 'ok').length}/${rows.length} presets within budget, ${red.length} red`)
  process.exitCode = red.length === 0 ? 0 : 1
}
