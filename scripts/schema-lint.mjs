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
 *   plugins/**\/*.mjs (tests and client bundles excluded), profile/cordis.patch.yml (allow rows).
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

/** Tool name -> description text, from the plugin sources. */
async function collectTools() {
  const tools = []
  for (const entry of (await readdir(join(KIT, 'plugins'), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const dir = join(KIT, 'plugins', entry.name)
    let files = []
    try { files = (await readdir(dir)).filter((name) => name.endsWith('.mjs') && !name.includes('.test.')) } catch { continue }
    for (const file of files.sort()) {
      const source = await readFile(join(dir, file), 'utf8')
      const pattern = /name:\s*'([a-z][a-z0-9_]*)'([\s\S]{0,800}?)description:\s*'((?:[^'\\]|\\.)*)'/g
      for (const match of source.matchAll(pattern)) {
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

const tools = await collectTools()
const presets = await collectPresets()
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
const result = {
  ok: reds.length === 0,
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
}

process.exit(result.ok ? 0 : 1)
