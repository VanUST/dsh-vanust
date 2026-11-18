#!/usr/bin/env node
/**
 * PURPOSE
 *   Run the impeccable UI detector over the kit's own UI sources and print ONE JSON document:
 *   the engine version, the rule catalog size, the scanned targets and the findings. It is a
 *   separate `make design-audit` target, NOT part of `make verify`: verify stays offline, while
 *   this target needs the provisioned engine (and may scan a URL later).
 *
 * WHAT IT SCANS
 *   Source files, not the generated bundles: `plugins/designmap/client/*.jsx` and `*.js` (the
 *   hand-written panel) plus `plugins/project-state-panel/client.js`. A generated bundle would
 *   report the same rule dozens of times on minified code, which is noise, not a finding.
 *
 * OUTPUT
 *   { ok, engine, rules, targets, findings: [...], counts: {bySeverity, byRule} }
 *
 * USAGE
 *   node scripts/design-audit.mjs [--engine <path>] [target ...]
 */

import { accessSync, constants, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

const KIT = process.cwd()

function enginePath() {
  const explicit = process.argv.indexOf('--engine')
  if (explicit >= 0 && process.argv[explicit + 1] !== undefined) return process.argv[explicit + 1]
  if (process.env.IMPECCABLE_BIN !== undefined && process.env.IMPECCABLE_BIN !== '') return process.env.IMPECCABLE_BIN
  const local = join(homedir(), '.impeccable', 'bin', 'impeccable')
  if (existsSync(local)) return local
  for (const dir of String(process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, process.platform === 'win32' ? 'impeccable.cmd' : 'impeccable')
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not here; keep walking PATH.
    }
  }
  return null
}

function defaultTargets() {
  const targets = []
  try {
    for (const name of readdirSync(join(KIT, 'plugins', 'designmap', 'client')).sort()) {
      if (name.endsWith('.jsx') || name.endsWith('.js')) targets.push(join('plugins', 'designmap', 'client', name))
    }
  } catch {
    // A workspace without the design-map client still audits what exists.
  }
  if (existsSync(join(KIT, 'plugins', 'project-state-panel', 'client.js'))) targets.push(join('plugins', 'project-state-panel', 'client.js'))
  return targets
}

const engine = enginePath()
const cliTargets = process.argv.slice(2).filter((arg, index, all) => !arg.startsWith('--') && all[index - 1] !== '--engine')
const targets = cliTargets.length > 0 ? cliTargets : defaultTargets()

if (engine === null || !existsSync(engine)) {
  console.log(JSON.stringify({ ok: false, code: 'engine_missing', message: 'impeccable engine not found; run `make provision-apply` (or set IMPECCABLE_BIN)' }, null, 2))
  process.exit(1)
}

const run = (args) => execFileSync(engine, args, { cwd: KIT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
let version = ''
try { version = run(['--version']).trim() } catch { version = '' }
let rules = 0
try { rules = run(['detect', '--list-rules', '--quiet']).trim().split('\n').filter((line) => line.trim() !== '').length } catch { rules = 0 }
let findings = []
let failed = null
try {
  const output = run(['detect', '--json', '--no-config', ...targets])
  findings = JSON.parse(output)
} catch (error) {
  failed = error instanceof Error ? error.message : String(error)
}

const bySeverity = {}
const byRule = {}
for (const finding of Array.isArray(findings) ? findings : []) {
  bySeverity[finding.severity ?? 'unknown'] = (bySeverity[finding.severity ?? 'unknown'] ?? 0) + 1
  byRule[finding.antipattern ?? 'unknown'] = (byRule[finding.antipattern ?? 'unknown'] ?? 0) + 1
}
console.log(JSON.stringify({
  ok: failed === null,
  engine: { path: engine, version },
  rules,
  targets,
  findings: Array.isArray(findings) ? findings : [],
  counts: { total: Array.isArray(findings) ? findings.length : 0, bySeverity, byRule },
  ...(failed === null ? {} : { error: failed }),
}, null, 2))
process.exit(failed === null ? 0 : 1)
