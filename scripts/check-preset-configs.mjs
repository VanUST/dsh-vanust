#!/usr/bin/env node
/**
 * PURPOSE
 *   Refuse a profile whose preset plugin row cannot MOUNT because a required config field is
 *   missing. The harness validates a plugin's config at mount with the module's own zod schema;
 *   a row that omits a required field fails the WHOLE preset mount silently - the preset simply
 *   never appears in the composer roster, and nothing is logged (measured 2026-11-27: a devops
 *   preset with a bare tool-todo row mounted nothing; the roster lacked it and the log was empty).
 *
 *   This reader runs the same schemas WITHOUT booting a server: it parses the profile, resolves
 *   every plugin module from the installed harness (or the kit's inventory for @cc packages),
 *   and validates each row's `config` against the module's exported `Config` when it has one.
 *   A module with no schema export is reported as unverifiable rather than failed - the check
 *   fails only on a schema that refuses its row.
 *
 * INPUTS
 *   --profile <file>    profile patch (default profile/cordis.patch.yml)
 *   --install <dir>     installed harness root (default $DSH_INSTALL_DIR, the global npm root,
 *                       or the interpreter's ../lib/node_modules/@deepseek-ai/dsh)
 *   --json              machine-readable report instead of the table
 *
 * OUTPUTS
 *   One line per preset, then a summary; exit 0 when every row with a schema parses, 1 when a
 *   row is refused or nothing could be checked, 2 on a usage error.
 *
 * KEYWORDS
 *   preset mount, required config, zod schema, profile validation, silent mount failure
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A row with no `config` passes `{}` to the schema: a schema with a required field refuses it
 *     (the defect this check exists for), a schema with defaults accepts it.
 *   - An unresolvable module is reported, not failed: the kit may compose a plugin that only the
 *     installed profile has, and a false refusal would block every profile.
 *   - `cordis:group` is not a package and is skipped; `!!js` values are opaque to this reader, so
 *     only `config` is validated.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const value = (name) => {
  const at = argv.indexOf(name)
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : ''
}

function installRoot() {
  const explicit = value('--install') || process.env.DSH_INSTALL_DIR || ''
  if (explicit !== '') return resolve(explicit)
  const candidates = []
  // The same layout rule the identity guard uses: ask npm where its global root is, and fall back
  // to the conventional Windows directory when the .cmd shim cannot be spawned. spawnSync is used
  // instead of execFileSync because the portability check refuses a bare binary as execFileSync's
  // first argument (it is not resolvable on every platform).
  const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8' })
  const npmRoot = String(npm.stdout ?? '').trim()
  if (npm.status === 0 && npmRoot !== '') candidates.push(join(npmRoot, '@deepseek-ai', 'dsh'))
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    candidates.push(join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh'))
  }
  candidates.push(join(dirname(process.execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh'))
  return candidates.find((candidate) => existsSync(join(candidate, 'package.json'))) ?? ''
}

/** Every plugin row of every preset declaration in the parsed profile. */
function presetRows(node, out = []) {
  if (Array.isArray(node)) {
    for (const entry of node) presetRows(entry, out)
  } else if (node !== null && typeof node === 'object') {
    if (typeof node.id === 'string' && node.id.startsWith('preset-') && node.config !== null && typeof node.config === 'object') {
      out.push({ presetId: node.config.id ?? node.id.slice('preset-'.length), label: node.id, plugins: Array.isArray(node.config.plugins) ? node.config.plugins : [] })
    }
    for (const entry of Object.values(node)) presetRows(entry, out)
  }
  return out
}

const profilePath = value('--profile') !== '' ? resolve(value('--profile')) : join(KIT, 'profile', 'cordis.patch.yml')
const root = installRoot()
if (root === '') {
  process.stderr.write('preset-configs: no installed harness root: pass --install <dir> or set DSH_INSTALL_DIR\n')
  process.exit(2)
}
const require = createRequire(join(root, 'package.json'))
let YAML
try {
  YAML = require('yaml')
} catch {
  process.stderr.write('preset-configs: the installed harness has no yaml package at ' + root + '\n')
  process.exit(2)
}

const inventory = (() => {
  try {
    return JSON.parse(readFileSync(join(KIT, 'plugins', 'inventory.json'), 'utf8')).plugins ?? []
  } catch {
    return []
  }
})()
const kitSource = new Map(inventory.map((row) => [row.package, row.source]))

/** The module file a plugin row names, or null when it cannot be resolved here. */
function moduleFile(name) {
  if (name === 'cordis:group') return null
  if (typeof name !== 'string' || name === '') return null
  if (kitSource.has(name)) {
    try {
      const pkg = JSON.parse(readFileSync(join(KIT, kitSource.get(name), 'package.json'), 'utf8'))
      const main = pkg.main ?? pkg.exports?.['.'] ?? 'index.mjs'
      const file = typeof main === 'string' ? main : (main.import ?? main.default ?? '')
      return join(KIT, kitSource.get(name), file)
    } catch {
      return null
    }
  }
  try {
    return require.resolve(name, { paths: [join(root, 'node_modules')] })
  } catch {
    return null
  }
}

let document
try {
  document = YAML.parse(readFileSync(profilePath, 'utf8'), { logLevel: 'silent' })
} catch (error) {
  process.stderr.write('preset-configs: cannot parse ' + profilePath + ': ' + String(error.message ?? error) + '\n')
  process.exit(1)
}
const presets = presetRows(document)
if (presets.length === 0) {
  process.stderr.write('preset-configs: no preset declaration in ' + profilePath + '\n')
  process.exit(1)
}

const report = []
let failures = 0
let validated = 0
let unverifiable = 0
const cache = new Map()
for (const preset of presets.sort((a, b) => a.presetId.localeCompare(b.presetId))) {
  const rows = []
  for (const row of preset.plugins) {
    if (row === null || typeof row !== 'object' || typeof row.name !== 'string') continue
    if (row.name === 'cordis:group') continue
    const file = moduleFile(row.name)
    if (file === null || !existsSync(file)) {
      rows.push({ plugin: row.id ?? row.name, module: row.name, verdict: 'unresolved' })
      unverifiable += 1
      continue
    }
    if (!cache.has(file)) {
      cache.set(file, await import(pathToFileURL(file).href).catch(() => null))
    }
    const loaded = cache.get(file)
    const schema = loaded?.Config
    // The harness plugins export their config as a SCHEMASTERY schema class: `new Config(value)`
    // validates and fills defaults, and throws on a missing required field. A module with no such
    // export (or an import that failed) is unverifiable, not a failure.
    if (typeof schema !== 'function') {
      rows.push({ plugin: row.id ?? row.name, module: row.name, verdict: 'no-schema' })
      unverifiable += 1
      continue
    }
    validated += 1
    try {
      new schema(row.config ?? {})
      rows.push({ plugin: row.id ?? row.name, module: row.name, verdict: 'ok' })
    } catch (error) {
      failures += 1
      rows.push({ plugin: row.id ?? row.name, module: row.name, verdict: 'REFUSED', issues: [String(error?.message ?? error)] })
    }
  }
  report.push({ preset: preset.presetId, rows })
}

if (argv.includes('--json')) {
  process.stdout.write(JSON.stringify({ ok: failures === 0 && validated > 0, validated, unverifiable, failures, presets: report }, null, 2) + '\n')
} else {
  for (const preset of report) {
    const refused = preset.rows.filter((row) => row.verdict === 'REFUSED')
    const unknown = preset.rows.filter((row) => row.verdict === 'unresolved' || row.verdict === 'no-schema')
    process.stdout.write('  ' + (refused.length === 0 ? 'ok  ' : 'FAIL') + '  preset ' + preset.preset + ' — ' + preset.rows.length + ' row(s)')
    if (refused.length > 0) process.stdout.write('; refused: ' + refused.map((row) => row.plugin + ' (' + row.issues.join('; ') + ')').join(', '))
    if (unknown.length > 0) process.stdout.write('; unverifiable: ' + unknown.map((row) => row.plugin).join(', '))
    process.stdout.write('\n')
  }
}
if (validated === 0) {
  process.stderr.write('preset-configs: no row carried a config schema, so this check measured nothing\n')
  process.exit(1)
}
if (failures > 0) {
  process.stderr.write('preset-configs FAILED: ' + failures + ' row(s) would not mount\n')
  process.exit(1)
}
process.stdout.write(validated + ' row(s) validated, ' + unverifiable + ' unverifiable, 0 refused\n')
