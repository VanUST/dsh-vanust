#!/usr/bin/env node
/**
 * PURPOSE
 *   Fail when a tracked path belongs to no declared zone and is not a declared
 *   exception, so a file added outside the zone table is a reported gap rather than a
 *   silent fall-through to the manifest's default authority. A zone answers "who may
 *   change this, and does it need a decision record"; a path nobody placed has no such
 *   answer, and the write guard resolves it from `defaultAgentAuthority` — a real
 *   authority, but one the author never chose for that path.
 *
 * INPUTS
 *   `--root <dir>` (default: the working directory). Reads `<root>/.dsh/project.json`;
 *   the zone paths come from `ratchet.zones[].paths` and the exceptions from
 *   `zoneCoverage.exceptions`. The tracked-path list comes from `git -C <root> ls-files -z`.
 *
 * OUTPUTS
 *   Exit 0 and the line `zone coverage ok (N tracked paths)` when every tracked path is
 *   zoned or excepted. Exit 1 with `ZONE_COVERAGE_GAP` and the uncovered paths (capped)
 *   when any is neither. Exit 2 with `ZONE_COVERAGE_UNUSABLE` when the manifest cannot be
 *   read or the tracked-path list cannot be produced (no git, or not a repository), so
 *   "nothing was checked" is never reported as "nothing is wrong". Never throws.
 *
 * KEYWORDS
 *   zone coverage, tracked paths, git ls-files, manifest zones, default authority,
 *   enforcement point, gate
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `.dsh/project.json`, or JSON that is not an object: exit 2, naming the path.
 *   - No `ratchet.zones`: every tracked path is uncovered unless excepted; the message
 *     says the manifest declares no zone.
 *   - No `zoneCoverage.exceptions`: the list is empty, never an implicit exemption.
 *   - A path that is both zoned and excepted is covered; the zone wins and the exception
 *     is redundant, not an error.
 *   - No git, or a directory that is not a work tree: exit 2. A file list from anything
 *     other than the version-control index would not be the project's tracked set.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zonePathCovers } from '../plugins/ratchet/ratchet-schema.mjs'

const MANIFEST = '.dsh/project.json'

/** Prints a terminal reason and exits with a code that is a verdict, not a crash. */
function fail(code, message, exitCode) {
  process.stderr.write(`${code}: ${message}\n`)
  process.exit(exitCode)
}

const argv = process.argv.slice(2)
let root = process.cwd()
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === '--root') {
    root = resolve(argv[index + 1] ?? root)
    index += 1
  } else if (argv[index] === '--help') {
    process.stdout.write('usage: check-zone-coverage.mjs [--root <dir>]\n')
    process.exit(0)
  } else {
    fail('ZONE_COVERAGE_UNUSABLE', `unknown argument ${JSON.stringify(argv[index])}`, 2)
  }
}

let manifest
try {
  manifest = JSON.parse(readFileSync(resolve(root, MANIFEST), 'utf8'))
} catch (error) {
  fail('ZONE_COVERAGE_UNUSABLE', `${MANIFEST} under ${root} could not be read as JSON: ${String(error)}`, 2)
}
if (manifest === null || typeof manifest !== 'object') {
  fail('ZONE_COVERAGE_UNUSABLE', `${MANIFEST} is not a JSON object`, 2)
}

const zones = Array.isArray(manifest.ratchet?.zones) ? manifest.ratchet.zones : []
const exceptions = Array.isArray(manifest.zoneCoverage?.exceptions) ? manifest.zoneCoverage.exceptions : []

let tracked
try {
  tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((entry) => entry.length > 0)
} catch (error) {
  fail(
    'ZONE_COVERAGE_UNUSABLE',
    `the tracked-path list could not be produced for ${root} (git ls-files failed: ${String(error)}); a coverage verdict over an unknown file set would be a guess`,
    2,
  )
}

const coveredBy = (globs, path) => (globs ?? []).some((glob) => typeof glob === 'string' && zonePathCovers(glob, path))
const zoneGlobs = zones.flatMap((zone) => (Array.isArray(zone?.paths) ? zone.paths : []))
const uncovered = tracked.filter((path) => !coveredBy(zoneGlobs, path) && !coveredBy(exceptions, path))

if (uncovered.length > 0) {
  const shown = uncovered.slice(0, 20)
  process.stderr.write(
    `ZONE_COVERAGE_GAP: ${uncovered.length} of ${tracked.length} tracked path(s) belong to no declared zone and no declared exception:\n`,
  )
  for (const path of shown) process.stderr.write(`  - ${path}\n`)
  if (uncovered.length > shown.length) process.stderr.write(`  … and ${uncovered.length - shown.length} more\n`)
  process.stderr.write(
    'Add the path to a zone in .dsh/project.json, or declare it under zoneCoverage.exceptions with a reason.\n',
  )
  process.exit(1)
}

process.stdout.write(`zone coverage ok (${tracked.length} tracked paths, ${zones.length} zone(s), ${exceptions.length} exception(s))\n`)
