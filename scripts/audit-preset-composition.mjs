#!/usr/bin/env node
/**
 * PURPOSE
 *   One command that measures the eleven kit presets on composition: what each role's stated
 *   tasks need, what its profile row grants, what its first request costs in bytes, and how
 *   often the system+tool prefix changed underneath a running session (which re-bills the
 *   provider cache). The report it feeds is docs/audits/preset-composition-2026-11-24.md.
 *
 * INPUTS (all read-only)
 *   --profile <file>   profile patch (default profile/cordis.patch.yml)
 *   --sessions <dir>   harness home holding sessions/ (default resolveHome())
 *   --json             machine-readable output instead of the markdown tables
 *   --personas         dump each preset's persona prefix to stdout and stop
 *   --limit <n>        decode at most n session logs (smoke run)
 *
 * WHAT IT DOES NOT DO
 *   It never writes to the repository, the profile or the session store. It never restarts
 *   anything. A number it cannot measure is printed as "unmeasured" with the reason.
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeSession, sessionFiles, resolveHome, usageSeries } from './session/session-log.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const value = (name) => { const at = argv.indexOf(name); return at >= 0 && at + 1 < argv.length ? argv[at + 1] : '' }
const flag = (name) => argv.includes(name)
const profilePath = value('--profile') !== '' ? resolve(value('--profile')) : join(KIT, 'profile', 'cordis.patch.yml')
const home = value('--sessions') !== '' ? resolve(value('--sessions')) : resolveHome()
const limit = value('--limit') !== '' ? Number(value('--limit')) : 0

const PRESETS = ['orchestrator', 'architect', 'ux', 'presenter', 'backend', 'research', 'gatherer', 'reviewer', 'critic', 'tester', 'docs']
const utf8 = (text) => Buffer.byteLength(text ?? '', 'utf8')
const sha1 = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12)

// The profile text is parsed by indentation because the kit deliberately keeps no YAML
// dependency; scripts/context-budget.mjs reads the same tables the same way.
const profileText = readFileSync(profilePath, 'utf8')
const profileLines = profileText.split('\n')

/** The line span of each "- id: preset-<name>" block, and its "prefix: |-" literal. */
function personaPrefixes() {
  const out = {}
  for (let index = 0; index < profileLines.length; index += 1) {
    const head = /^\s+- id: preset-([a-z]+)\s*$/.exec(profileLines[index])
    if (head === null) continue
    const name = head[1]
    let end = profileLines.length
    for (let scan = index + 1; scan < profileLines.length; scan += 1) {
      if (/^\s+- id: preset-[a-z]+\s*$/.test(profileLines[scan]) || /^\s*- insert:/.test(profileLines[scan])) { end = scan; break }
    }
    for (let scan = index; scan < end; scan += 1) {
      const lit = /^(\s+)prefix: \|-?\s*$/.exec(profileLines[scan])
      if (lit === null) continue
      const base = lit[1].length
      const body = []
      for (let at = scan + 1; at < end; at += 1) {
        const line = profileLines[at]
        if (line.trim() !== '' && line.match(/^\s*/)[0].length <= base) break
        body.push(line.slice(base + 2))
      }
      out[name] = { text: body.join('\n'), line: scan + 1, bytes: utf8(body.join('\n')) }
      break
    }
  }
  return out
}


/** The tool-families block: the budgets table and the per-preset allow list (one owner). */
function policyBlock() {
  const start = profileLines.findIndex((line) => /^\s+- id: tool-families\s*$/.test(line))
  if (start < 0) return []
  let end = profileLines.length
  for (let index = start + 1; index < profileLines.length; index += 1) {
    if (/^\s*# /.test(profileLines[index]) && /^# -- /.test(profileLines[index].trim())) { end = index; break }
    if (/^\s*- insert:/.test(profileLines[index])) { end = index; break }
  }
  return profileLines.slice(start, end)
}

/** budgets.<preset> including the nested ptc block, same shape the gate reads. */
function budgetsFrom(lines) {
  const at = lines.findIndex((line) => /^\s+budgets:\s*$/.test(line))
  if (at < 0) return {}
  const base = lines[at].match(/^\s*/)[0].length
  const budgets = {}
  let preset = null
  let section = null
  for (let index = at + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const indent = line.match(/^\s*/)[0].length
    if (indent <= base) break
    const entry = /^\s*-?\s*([A-Za-z][A-Za-z_-]*):\s*(.*)$/.exec(line)
    if (entry === null) continue
    const key = entry[1]
    const rest = entry[2]
    if (indent === base + 2) { preset = key; budgets[preset] = {}; section = null; continue }
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

/** families.<preset>.allow / .deny / .projectDeny, each entry with its profile line. */
function familyRows(lines) {
  const at = lines.findIndex((line) => /^\s*families:\s*$/.test(line))
  if (at < 0) return {}
  const base = lines[at].match(/^\s*/)[0].length
  const rows = {}
  let preset = null
  let list = null
  for (let index = at + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const indent = line.match(/^\s*/)[0].length
    if (indent <= base) break
    const head = /^\s*([a-z]+):\s*$/.exec(line)
    if (indent === base + 2 && head !== null) {
      preset = head[1]
      rows[preset] = { line: index + 1, allow: [], deny: [], projectDeny: [] }
      list = null
      continue
    }
    if (preset === null) continue
    const listHead = /^\s*(allow|deny|projectDeny):\s*$/.exec(line)
    if (indent === base + 4 && listHead !== null) { list = listHead[1]; continue }
    const item = /^\s*-\s+(\S+)\s*$/.exec(line)
    if (item !== null && list !== null) rows[preset][list].push({ name: item[1], line: index + 1 })
  }
  return rows
}

/** The plugins rows a preset declares: its own tool plugins, each with its profile line. */
function presetPlugins() {
  const out = {}
  for (let index = 0; index < profileLines.length; index += 1) {
    const head = /^\s+- id: preset-([a-z]+)\s*$/.exec(profileLines[index])
    if (head === null) continue
    const name = head[1]
    let end = profileLines.length
    for (let scan = index + 1; scan < profileLines.length; scan += 1) {
      if (/^\s+- id: preset-[a-z]+\s*$/.test(profileLines[scan]) || /^\s*- insert:/.test(profileLines[scan])) { end = scan; break }
    }
    const rows = []
    for (let scan = index; scan < end; scan += 1) {
      const plugin = /^\s+- id: ([a-z0-9-]+)\s*$/.exec(profileLines[scan])
      if (plugin === null) continue
      for (let at = scan + 1; at < Math.min(scan + 5, end); at += 1) {
        const pkg = /^\s+name: '([^']+)'\s*$/.exec(profileLines[at])
        if (pkg !== null) { rows.push({ id: plugin[1], pkg: pkg[1], line: scan + 1 }); break }
      }
    }
    out[name] = rows
  }
  return out
}

const personas = personaPrefixes()
const policy = policyBlock()
const budgets = budgetsFrom(policy)
const families = familyRows(policy)
const pluginRows = presetPlugins()

if (flag('--personas')) {
  for (const preset of PRESETS) {
    const persona = personas[preset]
    console.log('===== ' + preset + ' ' + (persona === undefined ? 'MISSING' : persona.bytes + ' B, profile line ' + persona.line) + ' =====')
    console.log(persona === undefined ? '' : persona.text)
    console.log('')
  }
  process.exit(0)
}



// ── session store: one decode pass, no writes ────────────────────────────────
const REMINDER_KINDS = new Set(['agent-instructions', 'runtime-context', 'skill-catalog', 'time-context'])

const contentOf = (event) => (Array.isArray(event?.data?.message?.content) ? event.data.message.content
  : Array.isArray(event?.data?.content) ? event.data.content : [])
const textOf = (content) => {
  const parts = []
  for (const block of content) if (block !== null && typeof block === 'object' && typeof block.text === 'string') parts.push(block.text)
  return parts.join('')
}
const contentBytes = (content) => utf8(textOf(content))

/**
 * One session: its preset, its first request, its request-by-request prefix and its usage.
 *
 * A request is an assistant/message carrying usage. Its prefix is everything the provider
 * sees ahead of the new turn: every system/message appended so far, plus the tool list of the
 * most recent request/header. Two consecutive requests with a different prefix are one
 * invalidation. Where the change landed decides whether the provider cache could have been
 * reused: before the turn's first step/start it is a turn boundary, after it, mid-turn.
 */
function analyseSession(text, file) {
  const events = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try { events.push(JSON.parse(line)) } catch { /* one damaged record hides no session */ }
  }
  const header = events.find((event) => event.type === 'session')
  if (header === undefined) return null

  let selected = null
  const firstStepOfTurn = new Map()
  const headers = []
  const requests = []
  const calls = {}
  const splicedTargets = {}
  const reminders = []
  const systems = []
  let steps = 0
  let sawAssistant = false
  let systemAcc = ''
  let toolAcc = ''
  let lastSystemSeq = -1
  let lastHeaderSeq = -1
  let lastSystemChange = { kind: null, source: null, seq: -1 }
  let lastHeaderChange = { kind: null, source: null, seq: -1 }

  for (const event of events) {
    const seq = event.seq ?? 0
    if (event.type === 'agent-preset/selected' && typeof event.data?.agentPreset === 'string' && event.data.agentPreset !== '') selected = event.data.agentPreset
    if (event.type === 'step/start') {
      steps += 1
      const turn = event.data?.turn
      if (turn !== undefined && event.data?.step === 1 && !firstStepOfTurn.has(turn)) firstStepOfTurn.set(turn, seq)
      if (turn !== undefined && !firstStepOfTurn.has(turn)) firstStepOfTurn.set(turn, seq)
    }
    if (event.type === 'system/message') {
      const body = textOf(contentOf(event))
      systems.push({ seq, bytes: utf8(body), source: event.data?.source?.kind ?? null, createdAt: event.time ?? null })
      systemAcc += '\u0000' + body
      lastSystemSeq = seq
      lastSystemChange = { kind: 'system/message', source: event.data?.source?.kind ?? 'unattributed', seq }
    }
    if (event.type === 'request/header') {
      const tools = Array.isArray(event.data?.header?.tools) ? event.data.header.tools : []
      const names = tools.map((tool) => tool?.name ?? '?')
      headers.push({ seq, reason: event.data?.reason ?? null, names, bytes: utf8(JSON.stringify(tools)), config: event.data?.header?.config ?? null })
      toolAcc = names.join(',')
      lastHeaderSeq = seq
      lastHeaderChange = { kind: 'request/header', source: event.data?.reason ?? 'unstated', seq }
    }
    if (event.type === 'agent/inbox/spliced') {
      const target = event.data?.target ?? '?'
      splicedTargets[target] = (splicedTargets[target] ?? 0) + 1
    }
    if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch') {
      const name = event.data?.name ?? '?'
      calls[name] = (calls[name] ?? 0) + 1
    }
    if (event.type === 'assistant/message') {
      sawAssistant = true
      const usage = event.data?.usage
      if (usage) {
        requests.push({
          seq,
          turn: event.data?.turn,
          step: event.data?.step,
          billed: usage.inputTokens ?? 0,
          cached: usage.cacheReadTokens ?? 0,
          signature: sha1(systemAcc + '\u0001' + toolAcc),
          toolsSig: sha1(toolAcc),
          systemSig: sha1(systemAcc),
          changeSeq: Math.max(lastSystemSeq, lastHeaderSeq),
          changeKind: lastHeaderChange.kind,
          changeSource: lastHeaderChange.source,
          systemKind: lastSystemChange.kind,
          systemSource: lastSystemChange.source,
        })
      }
    }
    if (event.type === 'user/message' && REMINDER_KINDS.has(event.data?.source?.kind) && !sawAssistant) {
      reminders.push({ seq, kind: event.data.source.kind, bytes: contentBytes(contentOf(event)) })
    }
  }

  const firstRequestSeq = requests.length > 0 ? requests[0].seq : Infinity
  const firstHeaders = headers.filter((row) => row.seq < firstRequestSeq)
  const firstHeader = firstHeaders.length > 0 ? firstHeaders[firstHeaders.length - 1] : (headers[0] ?? null)
  const firstSystems = systems.filter((row) => row.seq < firstRequestSeq)
  const first = {
    tools: firstHeader === null ? 0 : firstHeader.names.length,
    schemaBytes: firstHeader === null ? 0 : firstHeader.bytes,
    systemBytes: firstSystems.reduce((total, row) => total + row.bytes, 0),
    reminderBytes: reminders.reduce((total, row) => total + row.bytes, 0),
    reminderKinds: reminders.map((row) => row.kind),
    remindersByKind: reminders.reduce((total, row) => { total[row.kind] = (total[row.kind] ?? 0) + row.bytes; return total }, {}),
    systemParts: firstSystems.length,
    systemParts: firstSystems.length,
    model: firstHeader === null ? null : (firstHeader.config?.model ?? null),
    names: firstHeader === null ? [] : firstHeader.names,
    reason: firstHeader === null ? null : firstHeader.reason,
  }

  const distinct = new Set(requests.map((row) => row.signature))
  let invalidations = 0
  let toolsChanges = 0
  let systemChanges = 0
  let midTurn = 0
  let boundary = 0
  const mechanisms = []
  const afterTools = { cached: 0, billed: 0 }
  const afterSystem = { cached: 0, billed: 0 }
  const unchanged = { cached: 0, billed: 0 }
  let previous = null
  for (const row of requests) {
    if (previous !== null) {
      const toolsMoved = row.toolsSig !== previous.toolsSig
      const systemMoved = row.systemSig !== previous.systemSig
      if (toolsMoved || systemMoved) {
        invalidations += 1
        if (toolsMoved) toolsChanges += 1
        else systemChanges += 1
        const bucket = toolsMoved ? afterTools : afterSystem
        const insideTurn = row.turn === previous.turn
        if (insideTurn) midTurn += 1
        else boundary += 1
        if (toolsMoved || insideTurn) mechanisms.push({ session: header.id, turn: row.turn, step: row.step, kind: toolsMoved ? row.changeKind : row.systemKind, source: toolsMoved ? row.changeSource : row.systemSource, at: row.changeSeq, request: row.seq, toolsMoved, systemMoved, midTurn: insideTurn })
        bucket.cached += row.cached
        bucket.billed += row.billed
      } else {
        unchanged.cached += row.cached
        unchanged.billed += row.billed
      }
    }
    previous = row
  }

  const cached = requests.reduce((total, row) => total + row.cached, 0)
  const billed = requests.reduce((total, row) => total + row.billed, 0)
  return {
    file,
    id: header.id,
    preset: selected ?? header.agentPreset ?? '(none)',
    headerPreset: header.agentPreset ?? '(none)',
    depth: header.delegationDepth ?? 0,
    cwd: header.cwd ?? null,
    createdAt: header.createdAt ?? 0,
    bytes: statSync(file).size,
    turns: firstStepOfTurn.size,
    steps,
    requests: requests.length,
    headerEvents: headers.length,
    systems: systems.length,
    systemSeq: systems.map((row) => row.createdAt),
    distinctPrefixes: distinct.size,
    invalidations,
    toolsChanges,
    systemChanges,
    midTurn,
    boundary,
    mechanisms: mechanisms.slice(0, 12),
    midTurnMechanisms: mechanisms.reduce((total, row) => { const key = row.kind + ':' + row.source; total[key] = (total[key] ?? 0) + 1; return total }, {}),
    spliced: splicedTargets,
    first,
    cached,
    billed,
    afterTools,
    afterSystem,
    unchanged,
    calls,
  }
}


// ── the scan ─────────────────────────────────────────────────────────────────
const allFiles = sessionFiles(home)
const files = limit > 0 ? allFiles.slice(0, limit) : allFiles
const sessions = []
const unreadable = []
for (const file of files) {
  let text
  try { text = decodeSession(readFileSync(file)) } catch { unreadable.push({ file, reason: 'decode failed' }); continue }
  let row = null
  try { row = analyseSession(text, file) } catch (error) { unreadable.push({ file, reason: String(error && error.message) }); continue }
  if (row === null) { unreadable.push({ file, reason: 'no session record' }); continue }
  sessions.push(row)
}

/** Median of a numeric list; null for an empty list (never 0, which would read as a measurement). */
function median(values) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (clean.length === 0) return null
  const mid = Math.floor(clean.length / 2)
  return clean.length % 2 === 1 ? clean[mid] : Math.round((clean[mid - 1] + clean[mid]) / 2)
}
const share = (part, total) => (total > 0 ? part / total : null)
const pct = (value) => (value === null || value === undefined ? 'unmeasured' : (value * 100).toFixed(1) + '%')
const num = (value) => (value === null || value === undefined ? 'unmeasured' : String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' '))

const perPreset = {}
for (const preset of PRESETS) {
  const rows = sessions.filter((row) => row.preset === preset)
  const withHeader = rows.filter((row) => row.first.tools > 0)
  const native = withHeader.filter((row) => row.first.tools > 2)
  const ptc = withHeader.filter((row) => row.first.tools <= 2)
  const latest = native.slice().sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  const latestPtc = ptc.slice().sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  const measured = rows.filter((row) => row.requests > 0)
  const transitions = rows.filter((row) => row.requests > 1)
  const calls = {}
  for (const row of rows) for (const [name, count] of Object.entries(row.calls)) calls[name] = (calls[name] ?? 0) + count
  const cached = rows.reduce((total, row) => total + row.cached, 0)
  const billed = rows.reduce((total, row) => total + row.billed, 0)
  const afterTools = rows.reduce((total, row) => ({ cached: total.cached + row.afterTools.cached, billed: total.billed + row.afterTools.billed }), { cached: 0, billed: 0 })
  const afterSystem = rows.reduce((total, row) => ({ cached: total.cached + row.afterSystem.cached, billed: total.billed + row.afterSystem.billed }), { cached: 0, billed: 0 })
  const same = rows.reduce((total, row) => ({ cached: total.cached + row.unchanged.cached, billed: total.billed + row.unchanged.billed }), { cached: 0, billed: 0 })
  perPreset[preset] = {
    sessions: rows.length,
    withHeader: withHeader.length,
    measured: measured.length,
    transitions: transitions.length,
    bytes: rows.reduce((total, row) => total + row.bytes, 0),
    latest: latest === null ? null : {
      id: latest.id, depth: latest.depth, createdAt: latest.createdAt, file: latest.file,
      tools: latest.first.tools, schemaBytes: latest.first.schemaBytes, systemBytes: latest.first.systemBytes,
      reminderBytes: latest.first.reminderBytes, reminderKinds: latest.first.reminderKinds, model: latest.first.model,
      headerEvents: latest.headerEvents, toolNames: latest.first.names, headerReason: latest.first.reason,
      systems: latest.systems, steps: latest.steps, requests: latest.requests, remindersByKind: latest.first.remindersByKind, systemParts: latest.first.systemParts,
    },
    ptcSessions: ptc.length,
    latestPtc: latestPtc === null ? null : { id: latestPtc.id, tools: latestPtc.first.tools, schemaBytes: latestPtc.first.schemaBytes, systemBytes: latestPtc.first.systemBytes, reminderBytes: latestPtc.first.reminderBytes },
    median: {
      tools: median(withHeader.map((row) => row.first.tools)),
      schemaBytes: median(withHeader.map((row) => row.first.schemaBytes)),
      systemBytes: median(withHeader.map((row) => row.first.systemBytes)),
      reminderBytes: median(withHeader.map((row) => row.first.reminderBytes)),
      steps: median(rows.map((row) => row.steps)),
    },
    cache: { cached, billed, share: share(cached, cached + billed) },
    changedTools: { cached: afterTools.cached, billed: afterTools.billed, share: share(afterTools.cached, afterTools.cached + afterTools.billed) },
    changedSystem: { cached: afterSystem.cached, billed: afterSystem.billed, share: share(afterSystem.cached, afterSystem.cached + afterSystem.billed) },
    unchanged: { cached: same.cached, billed: same.billed, share: share(same.cached, same.cached + same.billed) },
    prefixes: {
      median: median(transitions.map((row) => row.distinctPrefixes)),
      perSession: transitions.map((row) => ({ id: row.id, depth: row.depth, requests: row.requests, distinct: row.distinctPrefixes, invalidations: row.invalidations, midTurn: row.midTurn, boundary: row.boundary, headerEvents: row.headerEvents, systems: row.systems })),
      invalidations: rows.reduce((total, row) => total + row.invalidations, 0),
      toolsChanges: rows.reduce((total, row) => total + row.toolsChanges, 0),
      systemChanges: rows.reduce((total, row) => total + row.systemChanges, 0),
      midTurn: rows.reduce((total, row) => total + row.midTurn, 0),
      boundary: rows.reduce((total, row) => total + row.boundary, 0),
      requests: rows.reduce((total, row) => total + Math.max(0, row.requests - 1), 0),
    },
    mechanisms: rows.flatMap((row) => row.mechanisms),
    calls,
  }
}


// ── capability matrix: every task cites the sentence that implies it ─────────
// "playbook" is docs/PRESET-PLAYBOOKS.md section 3.1 (the usual-taskload column);
// "persona" is a fragment of the preset's prefix in profile/cordis.patch.yml.
const MATRIX = {
  orchestrator: [
    { task: 'open, update and close a task', playbook: 'shapes the task, delegates, judges, closes', persona: 'Work flows through the taskboard: open the task', needs: ['task_create', 'task_update', 'task_close', 'task_get', 'task_list'] },
    { task: 'delegate with a self-contained brief', playbook: 'delegates', persona: 'delegate with a self-contained brief', needs: ['delegate_task', 'delegation_brief'] },
    { task: 'judge the evidence a child returned', playbook: 'judges', persona: 'then judge the result', needs: ['case_get', 'case_list', 'read'] },
    { task: 'keep the design map current', playbook: 'decides what should exist', persona: 'Keep the system-design map current whenever the design changes', needs: ['map_edit', 'map_read'] },
    { task: 'edit a file itself', playbook: 'shapes the task', persona: 'you can create and edit files yourself', needs: ['write', 'edit', 'read', 'glob', 'grep'] },
    { task: 'web research for a decision', playbook: 'decides what should exist', persona: 'web research and the design-map tool', needs: ['web_search', 'web_fetch'] },
    { task: 'record and check the analysis record', playbook: 'the state register carries the reqIds', persona: 'Keep the system-design map current', needs: ['analysis_upsert', 'analysis_check'] },
  ],
  architect: [
    { task: 'read only the named file or subsystem', playbook: 'decides what should exist, from given context', persona: 'read, grep, glob, outline on named files or a named subsystem', needs: ['read', 'grep', 'glob', 'outline'] },
    { task: 'delegate one gatherer instead of surveying', playbook: 'reading the repository on the expensive route instead of delegating one read', persona: 'delegate ONE GATHERER with delegate_task', needs: ['delegate_task'] },
    { task: 'record a design change in the design map', playbook: 'decides what should exist', persona: 'Record a design change in the design map with map_edit', needs: ['map_edit', 'map_read', 'map_render'] },
    { task: 'leave the decision on its task', playbook: 'decides what should exist', persona: 'answer in one text: the decision, why it is the right one', needs: ['task_note'] },
  ],
  ux: [
    { task: 'render, snapshot and screenshot a page in a real browser', playbook: 'designs and proves an interface', persona: 'Build and prove in a real browser with Playwright', needs: ['mcp__playwright__*'] },
    { task: 'run the accessibility and screenshot-diff drivers with node', playbook: 'no keyboard, console, axe or narrow layout', persona: 'pinned .tools libraries for accessibility audits (axe-core with playwright-core) and screenshot diffs (pixelmatch), run with node', needs: ['bash'] },
    { task: 'author the interface', playbook: 'designs and proves an interface', persona: 'designs and proves an interface', needs: ['write', 'edit'] },
    { task: 'read the code it is designing against', playbook: 'designs and proves an interface', persona: 'designs and proves an interface', needs: ['read', 'grep', 'glob', 'outline'] },
    { task: 'file the case library entry', playbook: 'the state matrix in a browser', persona: 'the state matrix in a browser', needs: ['case_record', 'case_list'] },
  ],
  presenter: [
    { task: 'author and render the deck or dashboard', playbook: 'makes an idea land for a non-specialist', persona: 'the kit presentation/dashboard/diagram tools', needs: ['presentation', 'dashboard', 'diagram', 'write', 'edit'] },
    { task: 'verify slide by slide in a browser', playbook: 'a deck that renders while one slide is blank, clipped', persona: 'Then verify in the browser: open the file, screenshot every slide, read the console, check the print view', needs: ['mcp__playwright__*', 'read_image'] },
    { task: 'run the renderer and a local server', playbook: 'makes an idea land', persona: 'Your tools: bash, the file tools', needs: ['bash', 'job_output'] },
    { task: 'collect references', playbook: 'makes an idea land', persona: 'web research for references', needs: ['web_search', 'web_fetch'] },
  ],
  backend: [
    { task: 'edit the implementation', playbook: 'implements the change', persona: 'implements the change', needs: ['write', 'edit'] },
    { task: 'run the build, the test and the pinned analysers', playbook: 'a green test on code nothing calls', persona: 'Your tools: bash plus the pinned depcruise, semgrep and oasdiff', needs: ['bash'] },
    { task: 'measure the case on the product', playbook: 'case_run on the product', persona: 'Run the product once at the boundary of the change and quote command, output and exit code', needs: ['case_run', 'case_record', 'case_get'] },
    { task: 'read the code around the change', playbook: 'implements the change', persona: 'implements the change', needs: ['read', 'grep', 'glob', 'outline'] },
    { task: 'report on its own task', playbook: 'implements the change', persona: 'implements the change', needs: ['task_get', 'task_note'] },
  ],
  research: [
    { task: 'search and fetch the web', playbook: 'finds what exists outside the repo', persona: 'Your tools: web_search/web_fetch', needs: ['web_search', 'web_fetch'] },
    { task: 'search the papers tools', playbook: 'finds what exists outside the repo', persona: 'the papers tools', needs: ['papers_search', 'papers_trending', 'papers_download'] },
    { task: 'read the repository and the source', playbook: 'finds what exists outside the repo', persona: 'read-only repository search', needs: ['read', 'grep', 'glob', 'outline'] },
    { task: 'write the ranked answer', playbook: 'finds what exists outside the repo', persona: 'Deliver a short ranked answer with URLs', needs: ['write'] },
  ],
  gatherer: [
    { task: 'run read-only commands', playbook: 'reads the current system and reports', persona: 'Run read-only commands only (git log, rg, wc, ls)', needs: ['bash'] },
    { task: 'read and search the code', playbook: 'reads the current system and reports', persona: 'the mechanism and call path', needs: ['read', 'grep', 'glob', 'outline'] },
    { task: 'return a cited report', playbook: 'file:line on every claim', persona: 'Return one compact report, not a transcript of your reading', needs: ['task_note'] },
  ],
  reviewer: [
    { task: 'run the change and the pinned diff/secrets/dependency tools', playbook: 'judges the change', persona: 'Your tools: bash plus the pinned difft, betterleaks and osv-scanner', needs: ['bash'] },
    { task: 'judge the case provenance', playbook: 'case_gate provenance; verdict per task', persona: 'the diff + a run', needs: ['case_gate', 'case_get', 'case_run'] },
    { task: 'read the diff and the code', playbook: 'judges the change', persona: 'Do not edit code; the orchestrator routes fixes', needs: ['read', 'grep', 'glob', 'outline'] },
    { task: 'report the verdict on the task', playbook: 'verdict per task', persona: 'the diff + a run', needs: ['task_get', 'task_note'] },
  ],
  critic: [
    { task: 'run the product and quote command, output and exit code', playbook: 'attacks a running behaviour', persona: 'the exact command, the fixture, the observed output or exit code', needs: ['bash'] },
    { task: 'read the code under attack', playbook: 'attacks a running behaviour', persona: 'find realistic, non-trivial inputs', needs: ['read', 'grep', 'glob', 'outline'] },
    { task: 'read and run the case library', playbook: 'attacks a running behaviour', persona: 'a finding without the exact command, fixture and smallest input', needs: ['case_get', 'case_list', 'case_run'] },
    { task: 'read a long negative run', playbook: 'attacks a running behaviour', persona: 'Track every background job id you start', needs: ['job_output'] },
    { task: 'report to the orchestrator', playbook: 'reports with severity, reproduction and the smallest failing case', persona: 'Report to the orchestrator with severity, reproduction', needs: ['task_note'] },
  ],
  tester: [
    { task: 'write the case and its driver', playbook: 'writes and measures acceptance cases', persona: 'Write the case and its driver under docs/cases/ or a test root', needs: ['write', 'edit', 'case_record'] },
    { task: 'measure a red against the wrong product and a green against the change', playbook: 'the red came from the driver own break, not from the wrong product', persona: 'Measure TWO runs, not one: the RED against the previous version', needs: ['case_run', 'bash'] },
    { task: 'gate the case on provenance', playbook: 'case_gate provenance and staleness', persona: 'the two runs', needs: ['case_gate', 'case_get'] },
    { task: 'read the product under test', playbook: 'writes and measures acceptance cases', persona: 'you never fix what you test', needs: ['read', 'grep', 'glob', 'outline'] },
    { task: 'list the cases so a new one is not a duplicate', playbook: 'writes and measures acceptance cases', persona: 'the case library', needs: ['case_list', 'case_get'] },
  ],
  docs: [
    { task: 'edit the documents', playbook: 'keeps documentation true', persona: 'delete or rewrite stale pages instead of adding another', needs: ['write', 'edit'] },
    { task: 'check links and run the doc gate', playbook: 'a command in the doc nobody ran', persona: 'Your tools: bash and the pinned lychee link/anchor checker; the kit own doc gate is make verify', needs: ['bash'] },
    { task: 'verify a cited link over the web', playbook: 'keeps documentation true', persona: 'refuse to produce documents nobody will read', needs: ['web_fetch', 'web_search'] },
    { task: 'read the code a page describes', playbook: 'a restatement of code', persona: 'prefer inline comments and the code itself', needs: ['read', 'grep', 'glob', 'outline'] },
    { task: 'file the intake case', playbook: 'keeps documentation true', persona: 'keeps documentation true', needs: ['case_record'] },
  ],
}

const FAMILY = { 'mcp__playwright__*': 24, 'mcp__godot__*': 30 }
const expands = (pattern, name) => (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name)

function capabilityOf(preset) {
  const allow = (families[preset]?.allow ?? []).map((entry) => entry.name)
  const rows = MATRIX[preset] ?? []
  const granted = (need) => allow.some((entry) => expands(entry, need))
  const tasks = rows.map((row) => {
    const missing = row.needs.filter((need) => !granted(need))
    return { ...row, missing, ok: missing.length === 0 }
  })
  const covered = tasks.filter((row) => row.ok).length
  const calls = perPreset[preset]?.calls ?? {}
  const dead = []
  for (const entry of allow) {
    if (entry.endsWith('*')) {
      const used = Object.entries(calls).filter(([name]) => name.startsWith(entry.slice(0, -1))).reduce((total, pair) => total + pair[1], 0)
      dead.push({ name: entry, family: FAMILY[entry] ?? null, calls: used })
      continue
    }
    dead.push({ name: entry, family: 1, calls: calls[entry] ?? 0 })
  }
  const never = dead.filter((row) => row.calls === 0)
  return {
    tasks,
    coverage: tasks.length === 0 ? null : covered / tasks.length,
    gaps: tasks.flatMap((row) => row.missing.map((need) => ({ task: row.task, need, persona: row.persona }))),
    granted: allow.length,
    grantedNames: allow,
    dead,
    never,
    neverNamed: never.filter((row) => row.family === 1).map((row) => row.name),
    neverFamilyTools: never.filter((row) => (row.family ?? 1) > 1).reduce((total, row) => total + (row.family ?? 0), 0),
    used: dead.filter((row) => row.calls > 0).map((row) => row.name + ' x' + row.calls),
  }
}

const capability = Object.fromEntries(PRESETS.map((preset) => [preset, capabilityOf(preset)]))
const out = {
  measuredAt: new Date().toISOString(),
  home,
  profile: profilePath,
  files: allFiles.length,
  decoded: sessions.length,
  unreadable: unreadable.length,
  unreadableSamples: unreadable.slice(0, 5),
  presets: perPreset,
  capability,
  personas: Object.fromEntries(PRESETS.map((preset) => [preset, { bytes: personas[preset]?.bytes ?? null, line: personas[preset]?.line ?? null }])),
  budgets: Object.fromEntries(PRESETS.map((preset) => [preset, budgets[preset] ?? null])),
  allow: Object.fromEntries(PRESETS.map((preset) => [preset, (families[preset]?.allow ?? []).map((entry) => ({ name: entry.name, line: entry.line }))])),
}
if (flag('--json')) {
  console.log(JSON.stringify(out))
  process.exit(0)
}

console.log('## M1 capability fit')
console.log('| preset | tasks | coverage | gaps (tool missing for the task) | granted | never invoked: named tools | never invoked: family tools |')
console.log('|---|---|---|---|---|---|---|')
for (const preset of PRESETS) {
  const row = capability[preset]
  const gaps = row.gaps.length === 0 ? 'none' : row.gaps.map((gap) => gap.need + ' (' + gap.task + ')').join('; ')
  console.log('| ' + preset + ' | ' + row.tasks.length + ' | ' + pct(row.coverage) + ' | ' + gaps + ' | ' + row.granted + ' | ' + row.neverNamed.length + ' | ' + row.neverFamilyTools + ' |')
}

console.log('')
console.log('## M2 context overhead (first request of the latest measured session)')
console.log('| preset | session | persona B | tools | schema B | system B | reminders B | system share of promptBytes | schema+system+reminders share |')
console.log('|---|---|---|---|---|---|---|---|---|')
for (const preset of PRESETS) {
  const row = perPreset[preset]
  const budget = budgets[preset] ?? {}
  if (row.latest === null) { console.log('| ' + preset + ' | unmeasured: no session | ' + num(personas[preset]?.bytes) + ' | - | - | - | - | - | - |'); continue }
  const systemShare = budget.promptBytes === undefined ? null : row.latest.systemBytes / budget.promptBytes
  const total = row.latest.systemBytes + row.latest.reminderBytes + row.latest.schemaBytes
  const totalShare = budget.promptBytes === undefined ? null : total / budget.promptBytes
  console.log('| ' + preset + ' | ' + String(row.latest.id).slice(0, 8) + ' d' + row.latest.depth + ' | ' + num(personas[preset]?.bytes) + ' | ' + num(row.latest.tools) + ' | ' + num(row.latest.schemaBytes) + ' | ' + num(row.latest.systemBytes) + ' | ' + num(row.latest.reminderBytes) + ' | ' + pct(systemShare) + ' | ' + pct(totalShare) + ' |')
}

console.log('')
console.log('## M2 contributors (reminder bytes by kind, and the system-prompt parts)')
console.log('| preset | system parts | reminders by kind (bytes) |')
console.log('|---|---|---|')
for (const preset of PRESETS) {
  const row = perPreset[preset]
  if (row.latest === null) { console.log('| ' + preset + ' | unmeasured | unmeasured |'); continue }
  const kinds = Object.entries(row.latest.remindersByKind ?? {}).sort((a, b) => b[1] - a[1]).map((pair) => pair[0] + ' ' + num(pair[1])).join(', ')
  console.log('| ' + preset + ' | ' + num(row.latest.systemParts) + ' | ' + (kinds === '' ? 'none' : kinds) + ' |')
}
console.log('')
console.log('## M3 prefix cache (every decoded session of the preset)')
console.log('| preset | sessions | >1 request | median distinct prefixes | tool-list changes | system appends | mid-turn | turn boundary | cache-read share | after a tool change | after a system append | unchanged prefix |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const preset of PRESETS) {
  const row = perPreset[preset]
  if (row.measured === 0) { console.log('| ' + preset + ' | unmeasured: no session with usage | - | - | - | - | - | - | - | - |'); continue }
  console.log('| ' + preset + ' | ' + row.sessions + ' | ' + row.transitions + ' | ' + num(row.prefixes.median) + ' | ' + row.prefixes.toolsChanges + ' | ' + row.prefixes.systemChanges + ' | ' + row.prefixes.midTurn + ' | ' + row.prefixes.boundary + ' | ' + pct(row.cache.share) + ' | ' + pct(row.changedTools.share) + ' | ' + pct(row.changedSystem.share) + ' | ' + pct(row.unchanged.share) + ' |')
}
console.log('')
console.log('## M3 mechanism: every destructive (tool-list) change and every mid-turn change')
console.log('| preset | session | turn | step | mid-turn | changed | source |')
console.log('|---|---|---|---|---|---|---|')
for (const preset of PRESETS) {
  for (const row of perPreset[preset].mechanisms) {
    console.log('| ' + preset + ' | ' + String(row.session).slice(0, 8) + ' | ' + num(row.turn) + ' | ' + num(row.step) + ' | ' + (row.midTurn ? 'yes' : 'no') + ' | ' + (row.toolsMoved ? 'tool list' : 'system text') + ' | ' + (row.kind ?? '?') + ':' + (row.source ?? '?') + ' |')
  }
}
console.log('')
console.log('files ' + allFiles.length + '  decoded ' + sessions.length + '  unreadable ' + unreadable.length)

