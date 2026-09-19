/**
 * PURPOSE
 *   Refuse a compiled law whose `command` check runs something that needs a live
 *   webserver, a port, a loopback socket or a nested process.
 *
 *   ADR 0043 decided that "a law's check must be hermetic. Probes that need a live
 *   webserver, a port or a nested process are release-gate evidence
 *   (`scripts/verify-upgrade.sh`), not law checks", and restated six laws that had
 *   been bound to two end-to-end probes. Nothing enforced the rule itself: the
 *   verifier's command runner starts a check in a context that differs from a
 *   shell, so a probe-bound law is a law whose colour depends on an environment
 *   the gate does not control, and the corpus state ("none remain") was held by
 *   inspection. This script is the command that fails when a new law binds itself
 *   to a probe.
 *
 *   It reads the corpus the way the gate does — `compileProject`, the same
 *   function `ratchet compile` and `ratchet verify` use — so it cannot disagree
 *   with the gate about which laws and which checks exist.
 *
 * INPUTS
 *   `--root <dir>` — the project to read. Defaults to the working directory.
 *   A project with no `.dsh/project.json`, or one whose ratchet section is not
 *   enabled, is reported and exits 2: "I could not look" is not "it is fine".
 *
 * OUTPUTS
 *   One `[ok ]`/`[BAD]` line per distinct check command, then `hermetic laws ok`
 *   and exit 0 when every command check is hermetic. On a finding: each offending
 *   law id, the check command, and the marker that caught it, then exit 1 with the
 *   code `NON_HERMETIC_LAW_CHECK`. Exit 2 for an unusable input. Never throws.
 *
 *   The residual is printed rather than implied: the check decides only the
 *   markers below, and a `run` string is opaque, so a probe spelled some other way
 *   is not caught by any static rule. That is stated in the output so a reader
 *   does not read a pass as a proof of hermeticity.
 *
 * KEYWORDS
 *   hermetic, law check, probe, release gate, live webserver, port, nested
 *   process, ADR 0043, enforcement point
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A law with no checks, or with only non-command checks, is skipped: there is
 *     no `run` string to judge and inventing one would report a law that is fine.
 *   - A check whose `run` is not a string is reported as unusable rather than
 *     passed, because the verifier reads it as a command it could not evaluate.
 *   - Duplicate `run` strings are judged once, but every offending law id is
 *     named, so removing one binding does not hide the others.
 *   - An unreadable or malformed manifest exits 2 without a partial claim.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const KIT = resolve(import.meta.dirname, '..')

/**
 * The decidable markers a non-hermetic check command carries.
 *
 * A `run` string is opaque — it can read any path, spawn any process and open any
 * socket — so a check over it can only decide the spellings it knows. These are
 * the ones the two probes ADR 0043 removed actually carried, plus the live-server
 * markers a probe-shaped command reaches for. Each is a regex over the whole
 * command, because a probe may be invoked with a relative or an absolute path.
 *
 * @type {ReadonlyArray<{ marker: RegExp, why: string }>}
 */
export const NON_HERMETIC_MARKERS = Object.freeze([
  { marker: /(^|[\s'"=/])probes\//, why: 'runs a probe from the probes directory' },
  { marker: /scripts\/probe-[A-Za-z0-9._-]+\.mjs/, why: 'runs a probe script' },
  { marker: /scripts\/verify-upgrade\.sh/, why: 'runs the release gate, which boots a throwaway instance' },
  { marker: /\bdsh\s+web\b/, why: 'boots a nested harness with a live webserver' },
  { marker: /--port\b/, why: 'names a port' },
  { marker: /\blocalhost\b/, why: 'reaches a loopback authority' },
  { marker: /127\.0\.0\.1/, why: 'reaches a loopback authority' },
  { marker: /0\.0\.0\.0/, why: 'binds a wildcard address' },
  { marker: /https?:\/\//, why: 'reaches the network' },
])

/**
 * Reports why one check command is not hermetic.
 *
 * @param run - The check's `run` string.
 * @returns The first matching marker's reason, or `null` when none matches. Never
 *   throws; a non-string is the caller's to report, not this function's to guess.
 */
export function nonHermeticReason(run) {
  if (typeof run !== 'string') return null
  for (const { marker, why } of NON_HERMETIC_MARKERS) if (marker.test(run)) return why
  return null
}

/**
 * Applies {@link nonHermeticReason} to every compiled law's command checks.
 *
 * @param laws - The compiled law bundle, each law with an optional `checks` array.
 * @returns `{ offenders, judged, malformed }`. `offenders` is one record per
 *   offending law `{ lawId, run, why }`; `judged` is a `Map` of every distinct
 *   `run` string to its verdict (a reason string, or `null` when hermetic);
 *   `malformed` names laws whose command check carries no `run` string. Every
 *   field is empty rather than absent when there is nothing to report.
 */
export function auditHermetic(laws) {
  const offenders = []
  const malformed = []
  const judged = new Map()
  for (const law of laws ?? []) {
    for (const check of law?.checks ?? []) {
      if (check?.type !== 'command') continue
      if (typeof check.run !== 'string') {
        malformed.push({ lawId: law.id, why: 'a command check carries no run string, so the verifier cannot evaluate it' })
        continue
      }
      if (!judged.has(check.run)) judged.set(check.run, nonHermeticReason(check.run))
      const reason = judged.get(check.run)
      if (reason !== null) offenders.push({ lawId: law.id, run: check.run, why: reason })
    }
  }
  return { offenders, judged, malformed }
}

/**
 * Reads `--root` from the command line.
 *
 * @param argv - `process.argv`.
 * @returns The absolute project root; the working directory when absent. A
 *   `--root` with no value is reported by the caller, not silently defaulted.
 */
function rootFrom(argv) {
  const index = argv.indexOf('--root')
  if (index === -1) return resolve(process.cwd())
  const value = argv[index + 1]
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
    process.stderr.write('check-hermetic-laws: --root needs a directory\n')
    process.exit(2)
  }
  return resolve(value)
}

// The module is importable so a test can drive `auditHermetic` directly; the
// command-line half runs only when this file is the entry point.
const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  const root = rootFrom(process.argv)
  let compileProject
  try {
    ;({ compileProject } = await import(pathToFileURL(join(KIT, 'plugins', 'ratchet', 'ratchet-compiler.mjs')).href))
  } catch (error) {
    process.stderr.write(`check-hermetic-laws: cannot load the ratchet compiler (${String(error)})\n`)
    process.exit(2)
  }

  let manifestPath
  try {
    manifestPath = join(root, '.dsh', 'project.json')
    JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    process.stderr.write(
      `check-hermetic-laws: no usable ${manifestPath} (${String(error)}); nothing was checked, which is not a pass\n`,
    )
    process.exit(2)
  }

  const compiled = compileProject(root)
  if (compiled.bundle === null) {
    process.stderr.write(
      'check-hermetic-laws: the corpus does not compile, so no law set was read; nothing was checked, which is not a pass\n',
    )
    process.exit(2)
  }

  const { offenders, judged, malformed } = auditHermetic(compiled.bundle.laws)
  for (const [run, reason] of [...judged.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    process.stdout.write(`  [${reason === null ? 'ok ' : 'BAD'}] ${run}${reason === null ? '' : ` — ${reason}`}\n`)
  }

  let failed = false
  if (malformed.length > 0) {
    failed = true
    for (const entry of malformed) process.stderr.write(`NON_HERMETIC_LAW_CHECK ${entry.lawId}: ${entry.why}\n`)
  }
  if (offenders.length > 0) {
    failed = true
    for (const entry of offenders) {
      process.stderr.write(`NON_HERMETIC_LAW_CHECK ${entry.lawId}: ${entry.why} — ${entry.run}\n`)
    }
  }

  if (failed) {
    process.stderr.write(
      '\nA law bound to a probe is a law whose colour depends on an environment the gate does not\n' +
        'control. Move the measurement into scripts/verify-upgrade.sh and bind the law to a hermetic\n' +
        'command, or state in the law why nothing can check it.\n',
    )
    process.exit(1)
  }

  process.stdout.write(
    `\nhermetic laws ok (${judged.size} distinct command check(s), all hermetic under ${NON_HERMETIC_MARKERS.length} marker(s))\n` +
      'residual: a run string is opaque, so a probe spelled another way is not caught by this check.\n',
  )
  process.exit(0)
}
