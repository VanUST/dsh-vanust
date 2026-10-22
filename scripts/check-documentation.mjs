/**
 * PURPOSE
 *   Enforce what the kit's documents CLAIM about the deployment, because a document that
 *   instructs is true when written and unchecked afterwards: the harness pin, the scripts
 *   the procedure tells an agent to run, and the plugin set the profile mounts.
 *
 *   The pin claims exist because `kit-update.mjs` converges a machine on the pin it reads
 *   from `install.ps1`/`install.sh`, so those two are the source of truth here and every
 *   other place the version is written is compared to them. The plugin claims exist
 *   because a table that describes a smaller deployment than the one installed is drift an
 *   agent cannot detect: it has nothing to compare against.
 *
 * INPUTS
 *   None. Reads the canonical profile patch, the plugin inventory, the procedure and user
 *   documents, and the installer, updater and start scripts, all relative to this script's
 *   own location.
 *
 * OUTPUTS
 *   One line per claim, then `documentation ok` and exit 0 when every claim holds; the
 *   failing claims on stderr and exit 1 otherwise. A caller that greps for the marker
 *   cannot mistake a partial run for a pass.
 *
 *   WHAT THE PIN CLAIMS CANNOT DECIDE: they compare the versions the repository WRITES.
 *   Nothing here can see the version a machine actually has installed, so "no machine runs
 *   an unpinned dsh" is enforced only as far as the kit's own instructions and scripts go:
 *   `kit-update.mjs --check` reports the installed harness against this pin on a real
 *   machine, and that is a convergence report rather than this gate.
 *
 * KEYWORDS
 *   harness pin, version pin, installers, source of truth, plugin inventory, documentation
 *   agreement, procedure
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A missing file is a FAILURE, not a skip: every claim here is about a file that must
 *     exist, and "I could not look" is not "it is fine".
 *   - A pin site that writes no version at all fails for the sites that must name one, and
 *     is reported as "prints no harness install command" for the one that need not; a
 *     placeholder in angle brackets is judged as a procedure, never as a pin.
 *   - A `@deepseek-ai/dsh-<subpackage>` range is not a harness pin and is not compared: the
 *     reader requires the package name immediately before the `@`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const claim = (name, ok, detail) => {
  process.stdout.write(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ` — ${detail}`}\n`)
  if (!ok) failures.push(`${name}: ${detail ?? 'no detail'}`)
}

/** Reads a kit file, or reports it as missing. */
function read(relative) {
  const path = join(KIT, relative)
  if (!existsSync(path)) return { missing: true, path }
  return { text: readFileSync(path, 'utf8'), path }
}

/**
 * Every concrete harness version a document writes next to the `@deepseek-ai/dsh` package.
 *
 * The package name is required immediately before the `@`, so the ubiquitous
 * `@deepseek-ai/dsh-*` subpackage ranges (a plugin's `devDependencies`, the `dsh-tools`
 * peer) cannot be mistaken for a harness pin — they version on their own line and a false
 * positive there would send a reader to "fix" a correct dependency.
 *
 * @param text - the document's contents.
 * @returns the version strings in the order they appear, with duplicates kept so a caller
 *   can report how many sites it judged. An empty match yields an empty iterable; a
 *   placeholder such as `<candidate>` is returned as written, because whether it counts as
 *   a concrete pin is the caller's decision, not this reader's.
 */
function* problemPins(text) {
  // `\\` is excluded so a JavaScript string literal's own escape (`@…@0.1.5-rc.1\n`) yields
  // the version rather than the escape that follows it.
  for (const match of text.matchAll(/@deepseek-ai\/dsh@([^\s"'`),;\\]+)/g)) yield match[1]
}

// 1. Where the pin is DECLARED. The installers are the source of truth, and they must agree.
/** Reads an installer's `DSH_VERSION`, falling back to its inline `@deepseek-ai/dsh@x`. */
const installerPin = (relative) => {
  const entry = read(relative)
  if (entry.missing === true) return { relative, pin: null, reason: 'missing' }
  const pin =
    /DSH_VERSION\s*=\s*['"]?([0-9][^'"\s]*)/.exec(entry.text)?.[1] ??
    /@deepseek-ai\/dsh@([0-9][^"'\s]*)/.exec(entry.text)?.[1] ??
    null
  return { relative, pin, reason: pin === null ? 'no DSH_VERSION declaration and no inline pin' : 'DSH_VERSION' }
}
const installers = [installerPin('install.sh'), installerPin('install.ps1')]
const agree = installers.every((entry) => entry.pin !== null) && installers.every((entry) => entry.pin === installers[0].pin)
claim(
  'both installers declare the harness pin',
  agree,
  agree
    ? `${installers[0].pin} in ${installers.map((entry) => entry.relative).join(' and ')}`
    : installers.map((entry) => `${entry.relative}: ${entry.pin ?? 'none'} (${entry.reason})`).join(', '),
)
const sourcePin = agree ? installers[0].pin : null
// Distinguishes "the installers disagree with each other" from "no installer declares a pin
// at all": both leave sourcePin null, and reporting the second for the first sends a reader
// to add a declaration that is already there.
const sourcePinNote =
  sourcePin ?? (installers.every((entry) => entry.pin === null) ? 'no usable installer pin' : `installers disagree (${installers.map((entry) => `${entry.relative} ${entry.pin ?? 'none'}`).join(', ')})`)

// 2. The procedure: the pin it states, every command example it writes, the scripts it
//    names, and the plugins it describes.
const procedure = read('rules/DEPLOYMENT.md')
if (procedure.missing === true) {
  claim('the deployment procedure exists', false, procedure.path)
} else {
  // The PROSE statement, matched on its own wording: the earlier first-version-in-the-file
  // rule matched whatever version-looking string came first, so a version mentioned in
  // passing above the statement could stand in for it.
  const stated = /Pinned harness version:\s*\*\*`([^`]+)`\*\*/.exec(procedure.text)?.[1] ?? null
  const statementHolds = sourcePin !== null && stated === sourcePin
  claim(
    'the procedure states the pin the installers declare',
    statementHolds,
    statementHolds ? stated : `procedure states ${stated ?? 'no "Pinned harness version" line'}, installers declare ${sourcePin ?? 'nothing usable'}`,
  )
  // And every concrete pin the procedure WRITES must be that same one: a command example
  // elsewhere in the file is what an agent actually runs.
  const procedurePins = [...problemPins(procedure.text)].filter((value) => !value.includes('<'))
  const procedureStray = procedurePins.filter((value) => value !== sourcePin)
  claim(
    'every harness version the procedure writes is the installer pin',
    procedureStray.length === 0 && (sourcePin === null ? procedurePins.length === 0 : procedurePins.length > 0),
    procedureStray.length === 0
      ? `${procedurePins.length} concrete pin(s), all ${sourcePin ?? 'absent'}`
      : `writes ${procedureStray.join(', ')} but ${sourcePinNote}`,
  )

  // The name class admits upper case: the scripts this kit ships are upper-case-free, but
  // the claim is about every script the procedure NAMES, and a mixed-case name was invisible
  // to a `[a-z0-9-]` class — `scripts/Check-Missing.mjs` passed this claim without existing.
  const named = [...procedure.text.matchAll(/scripts\/([A-Za-z0-9-]+\.mjs)/g)].map((match) => match[1])
  const missing = [...new Set(named)].filter((name) => !existsSync(join(KIT, 'scripts', name)))
  claim(
    'every script the procedure names exists',
    named.length > 0 && missing.length === 0,
    missing.length === 0 ? `${new Set(named).size} script(s) named, all present` : `missing: ${missing.join(', ')}`,
  )

  // Every plugin the profile MOUNTS must be named in the procedure.
  const patchText = read('profile/cordis.patch.yml')
  const mounted =
    patchText.missing === true ? [] : [...patchText.text.matchAll(/name:\s*'(@[^']+)'/g)].map((match) => match[1])
  const unnamed = mounted.filter((name) => !procedure.text.includes(name))
  claim(
    'every mounted plugin is named in the procedure',
    mounted.length > 0 && unnamed.length === 0,
    unnamed.length === 0 ? `${mounted.length} mounted plugin(s), all documented` : `undocumented: ${unnamed.join(', ')}`,
  )
}

// 3. The README a human reads and the user guide that walks them through install: both tell
//    a person which version to install, so both must agree with the installers. They are
//    required to NAME the pin — a version-less install instruction is exactly the unpinned
//    machine the pin forbids.
const readme = read('README.md')
for (const [relative, document] of [
  ['README.md', readme],
  ['USERGUIDE.md', read('USERGUIDE.md')],
]) {
  if (document.missing === true) {
    claim(`${relative} states the harness pin the installers declare`, false, 'missing')
    continue
  }
  const found = [...problemPins(document.text)].filter((value) => !value.includes('<'))
  if (found.length === 0) {
    claim(`${relative} states the harness pin the installers declare`, false, 'it writes no concrete harness version, so a reader is sent to install an unpinned dsh')
    continue
  }
  const stray = found.filter((value) => value !== sourcePin)
  claim(
    `${relative} states the harness pin the installers declare`,
    stray.length === 0 && sourcePin !== null,
    stray.length === 0 ? `${[...new Set(found)].join(', ')}` : `writes ${[...new Set(stray)].join(', ')}, ${sourcePinNote}`,
  )
}

// 4. No shipped SCRIPT may install the harness without a version. Bounded to the files that
//    RUN rather than instruct: a document is allowed to show `@<candidate>` as the upgrade
//    procedure, and a `--help` line may show a placeholder, but a script that executes
//    `npm i -g @deepseek-ai/dsh` — with no version, or with a package name it never pinned —
//    installs whatever npm resolves and defeats the pin for that machine.
{
  const runnable = ['install.sh', 'install.ps1', 'scripts/kit-update.mjs', 'start.sh', 'start.ps1']
  const unpinned = []
  for (const relative of runnable) {
    const file = read(relative)
    if (file.missing === true) continue
    for (const line of file.text.split('\n')) {
      if (/^\s*(?:#|\/\/)/.test(line)) continue
      const command = /(?:\bnpm\s+(?:install|i)\b|\bpnpm\s+(?:add|install)\b)[^\n]*@deepseek-ai\/dsh(?![\w.-])/.test(line)
      const pinned = /@deepseek-ai\/dsh@\$\{?[A-Za-z_]/.test(line) || /@deepseek-ai\/dsh@[0-9]/.test(line)
      if (command && !pinned) unpinned.push(`${relative}: ${line.trim().slice(0, 90)}`)
    }
  }
  claim(
    'no shipped script installs the harness without a version',
    unpinned.length === 0,
    unpinned.length === 0 ? `${runnable.length} script(s) scanned, every install command carries a pin` : unpinned.join(' | '),
  )
}

if (procedure.missing !== true) {
  const procedureUrl = /https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.git/.exec(procedure.text)?.[0] ?? null
  const readmeUrl = readme.missing === true ? null : (/https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.git/.exec(readme.text)?.[0] ?? null)
  claim(
    'the clone URL agrees with README.md',
    procedureUrl !== null && procedureUrl === readmeUrl,
    procedureUrl === readmeUrl ? procedureUrl : `procedure: ${procedureUrl}, README: ${readmeUrl}`,
  )
}

// 5. Every document that describes the shipped plugin set must agree with the inventory.
//    A user guide that denies the existence of a shipped plugin is the same class of lie as
//    a rule with no enforcement point: it reads as authoritative and nothing contradicted it.
const inventory = read('plugins/inventory.json')
if (inventory.missing === true) {
  claim('the plugin inventory is readable', false, 'missing')
} else {
  let rows = []
  try {
    rows = JSON.parse(inventory.text).plugins ?? []
  } catch (error) {
    claim('the plugin inventory is readable', false, String(error))
  }
  for (const relative of ['README.md', 'USERGUIDE.md']) {
    const document = read(relative)
    if (document.missing === true) {
      claim(`${relative} names every shipped plugin`, false, 'missing')
      continue
    }
    const unnamed = rows.map((row) => row.package).filter((name) => !document.text.includes(name))
    claim(
      `${relative} names every shipped plugin`,
      rows.length > 0 && unnamed.length === 0,
      unnamed.length === 0 ? `${rows.length} plugin(s), all named` : `not named: ${unnamed.join(', ')}`,
    )
  }
}

if (failures.length > 0) {
  process.stderr.write(`documentation claims FAILED\n${failures.map((entry) => `  - ${entry}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('documentation ok\n')
