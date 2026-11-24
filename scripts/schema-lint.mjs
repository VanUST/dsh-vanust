#!/usr/bin/env node
/**
 * PURPOSE
 *   FR5: measure the BYTES each tool description costs, statically, before a session pays for
 *   them. The description is the free text the model reads on every request; a tool that grew a
 *   paragraph costs tokens in every preset that allows it.
 *
 *   Per tool: description bytes. Per plugin: total. Per preset: the sum of the descriptions the
 *   tool-families allow list mounts. WARN above the threshold, RED above twice it; RED exits 1,
 *   so `make verify` fails on a schema that has grown a second body.
 *
 * INPUTS
 *   plugins/**\/*.mjs, RECURSIVELY (tests, proofs and client bundles excluded), and
 *   profile/cordis.patch.yml (allow rows).
 *
 * REFUSALS
 *   Exit 1 with a named reason when there is nothing to measure: the description regex matched no
 *   tool at all, or the `families:` allow rows yielded no preset. Both used to print "0 red" with
 *   exit 0 — the same output a healthy kit prints. Every run also carries its NEGATIVE CONTROL:
 *   the refusal predicate is applied to an empty toolkit, an empty preset set and a healthy input,
 *   and the run fails if the empty ones are accepted or the healthy one is refused.
 *
 * USAGE
 *   node scripts/schema-lint.mjs [--json] [--warn 600] [--red 1200] [--preset-warn 45000] [--preset-red 90000]
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const KIT = process.cwd()
const argv = process.argv.slice(2)
const flag = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : fallback }
const WARN = flag('--warn', 600)
const RED = flag('--red', 1200)
const PRESET_WARN = flag('--preset-warn', 45000)
const PRESET_RED = flag('--preset-red', 90000)

const bytes = (text) => Buffer.byteLength(text ?? '', 'utf8')

const TOOL_PATTERN = /name:\s*'([a-z][a-z0-9_]*)'([\s\S]{0,800}?)description:\s*'((?:[^'\\]|\\.)*)'/g

// A plugin's own sources are not all at its root: `designmap/src/page-tools.mjs` declares the
// four page tools and a root-only walk measured none of them. Tests and proofs are excluded because they declare
// tools that are not shipped, and a proof's fake tool is not a cost any preset pays.
const SKIPPED_DIRS = new Set(['node_modules', 'test', 'proof', 'dist', '.git'])

/** Every shipped source file under one directory, recursively. */
async function sourceFiles(dir) {
  const files = []
  let entries = []
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return files }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      files.push(...(await sourceFiles(path)))
      continue
    }
    if (entry.name.endsWith('.mjs') && !entry.name.includes('.test.')) files.push(path)
  }
  return files
}

/** Tool name -> description text, from the plugin sources. */
async function collectTools() {
  const tools = []
  for (const entry of (await readdir(join(KIT, 'plugins'), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const dir = join(KIT, 'plugins', entry.name)
    for (const path of await sourceFiles(dir)) {
      const file = path.slice(dir.length + 1)
      const source = await readFile(path, 'utf8')
      for (const match of source.matchAll(TOOL_PATTERN)) {
        tools.push({ tool: match[1], plugin: entry.name, file, bytes: bytes(match[3].replace(/\\(.)/g, '$1')) })
      }
    }
  }
  return tools
}

/** preset id -> allowed tool names, from the tool-families `families:` allow rows. */
async function collectPresets() {
  let text = ''
  try { text = await readFile(join(KIT, 'profile', 'cordis.patch.yml'), 'utf8') } catch { return {} }
  const lines = text.split('\n')
  let inFamilies = false
  let current = null
  const presets = {}
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*families:\s*$/.test(line)) { inFamilies = true; continue }
    if (!inFamilies) continue
    const preset = line.match(/^ {10}([a-z][a-z0-9_-]*):\s*$/)
    if (preset) { current = preset[1]; presets[current] = []; continue }
    if (!/^ {12}allow:\s*$/.test(line) || current === null) continue
    let j = i + 1
    while (j < lines.length) {
      const item = lines[j].match(/^ {14}-\s*([A-Za-z0-9_*]+)\s*$/)
      if (item) { presets[current].push(item[1]); j += 1; continue }
      if (lines[j].trim() === '' || /^\s*#/.test(lines[j])) { j += 1; continue }
      break
    }
  }
  for (const key of Object.keys(presets)) if (presets[key].length === 0) delete presets[key]
  return presets
}

/**
 * Why this run cannot be a gate, or null when it can.
 *
 * Zero tools or zero presets is not a clean schema: it is a regex that stopped matching or an
 * allow-list the profile no longer has. Both printed `0 red` and exit 0, which is the same
 * output a healthy kit prints, so the measurement has to refuse instead.
 *
 * @param input - The counts the scan produced.
 * @returns A refusal code, or null when the scan measured something.
 */
export function refusalFor({ tools, presets }) {
  if (tools === 0) return 'no-tool-matched'
  if (presets === 0) return 'preset-set-empty'
  return null
}

/**
 * The NEGATIVE CONTROL for the refusal above: an empty toolkit and an empty preset set must both
 * be refused and a healthy input must be accepted. A predicate that refuses everything would be
 * as useless as one that refuses nothing, so the healthy direction is checked too.
 *
 * @returns What the control fed in and the inputs it accepted that it should have refused.
 */
export function negativeControlFailures() {
  const failures = []
  if (refusalFor({ tools: 0, presets: 3 }) === null) failures.push('an empty toolkit was accepted')
  if (refusalFor({ tools: 3, presets: 0 }) === null) failures.push('an empty preset set was accepted')
  if (refusalFor({ tools: 3, presets: 3 }) !== null) failures.push('a healthy input was refused')
  return { inputs: 2, failures }
}

const tools = await collectTools()
const presets = await collectPresets()
const refusal = refusalFor({ tools: tools.length, presets: Object.keys(presets).length })
const control = negativeControlFailures()
const pluginTotals = new Map()
for (const tool of tools) pluginTotals.set(tool.plugin, (pluginTotals.get(tool.plugin) ?? 0) + tool.bytes)
for (const tool of tools) tool.level = tool.bytes > RED ? 'RED' : tool.bytes > WARN ? 'WARN' : 'ok'

const presetRows = []
for (const [preset, patterns] of Object.entries(presets)) {
  const matched = tools.filter((tool) => patterns.some((pattern) => {
    if (pattern.endsWith('*')) return tool.tool.startsWith(pattern.slice(0, -1))
    return tool.tool === pattern
  }))
  const total = matched.reduce((sum, tool) => sum + tool.bytes, 0)
  presetRows.push({ preset, tools: matched.length, descBytes: total, level: total > PRESET_RED ? 'RED' : total > PRESET_WARN ? 'WARN' : 'ok' })
}

const reds = [...tools.filter((tool) => tool.level === 'RED'), ...presetRows.filter((row) => row.level === 'RED')]
const warns = [...tools.filter((tool) => tool.level === 'WARN'), ...presetRows.filter((row) => row.level === 'WARN')]
const refusalReason = refusal === null ? '' : refusal === 'no-tool-matched'
  ? `the description regex matched none of the plugin sources under ${join(KIT, 'plugins')}; it expects \`name: '<tool>'\` followed by \`description: '<text>'\`, so a reformatted tool table measures nothing`
  : `the \`families:\` allow rows in ${join(KIT, 'profile', 'cordis.patch.yml')} yielded no preset, so no preset total means anything`
const ok = refusal === null && control.failures.length === 0 && reds.length === 0
const controlLine = control.failures.length === 0
  ? `negative control: ${control.inputs} empty/broken input(s) refused, a healthy input accepted`
  : `negative control: FAILED — ${control.failures.join('; ')}`

const result = {
  ok,
  refused: refusal,
  refusalReason,
  negativeControl: control,
  thresholds: { warn: WARN, red: RED, presetWarn: PRESET_WARN, presetRed: PRESET_RED },
  totalDescriptionBytes: tools.reduce((sum, tool) => sum + tool.bytes, 0),
  toolCount: tools.length,
  reds,
  warns: warns.map((row) => ({ tool: row.tool, plugin: row.plugin, preset: row.preset, bytes: row.bytes, descBytes: row.descBytes, level: row.level })),
  heaviest: [...tools].sort((a, b) => b.bytes - a.bytes).slice(0, 10).map((tool) => ({ tool: tool.tool, plugin: tool.plugin, bytes: tool.bytes })),
  presets: presetRows,
  plugins: [...pluginTotals].sort((a, b) => b[1] - a[1]).map(([plugin, total]) => ({ plugin, descBytes: total })),
}

if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
else {
  for (const tool of [...tools].sort((a, b) => b.bytes - a.bytes)) console.log(`${tool.level.padEnd(4)} ${String(tool.bytes).padStart(5)} B  ${tool.plugin}/${tool.tool}`)
  console.log('')
  for (const row of presetRows) console.log(`${row.level.padEnd(4)} ${String(row.descBytes).padStart(6)} B  preset ${row.preset} (${row.tools} tools)`)
  console.log(`\ntotal ${result.totalDescriptionBytes} B across ${tools.length} tools; ${warns.length} warning(s), ${reds.length} red(s)`)
  console.log(controlLine)
  if (refusal !== null) console.log(`refused: ${refusalReason}`)
}

process.exit(ok ? 0 : 1)
