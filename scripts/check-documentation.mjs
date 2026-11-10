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
import { execFileSync } from 'node:child_process'
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

  // Every plugin the profile MOUNTS must be named in the procedure. A role preset's
  // `plugins` list is a COMPOSITION, not a mount: those rows sit inside the declaration
  // (deeper indentation) and name the harness's own tool packages, which the procedure
  // documents once through the harness, not once per role. Counting them would demand
  // twenty lines of package names that say nothing about this kit. The preset itself is
  // documented as a unit by the claim below, so a new role cannot slip in unmentioned.
  const patchText = read('profile/cordis.patch.yml')
  const nameRows = patchText.missing === true ? [] : [...patchText.text.matchAll(/^( *)(?:- )?name:\s*'(@[^']+)'/gm)]
  const mounted = [...new Set(nameRows.filter((match) => match[1].length <= 8).map((match) => match[2]))]
  const unnamed = mounted.filter((name) => !procedure.text.includes(name))
  claim(
    'every mounted plugin is named in the procedure',
    mounted.length > 0 && unnamed.length === 0,
    unnamed.length === 0 ? `${mounted.length} mounted plugin(s), all documented` : `undocumented: ${unnamed.join(', ')}`,
  )
  // The role roster is the other half of the profile: a preset that exists and is not in
  // the procedure is a tool set nobody can choose knowingly.
  const presetIds = [...new Set(
    (patchText.missing === true ? [] : [...patchText.text.matchAll(/^ *- id: (preset-[a-z0-9-]+)$/gm)]).map((match) => match[1]),
  )]
  const presetUnnamed = presetIds.filter((id) => !procedure.text.includes(id))
  claim(
    'every role preset is named in the procedure',
    presetIds.length > 0 && presetUnnamed.length === 0,
    presetUnnamed.length === 0 ? `${presetIds.length} preset(s), all documented` : `undocumented: ${presetUnnamed.join(', ')}`,
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

/**
 * How many plugins the COMMITTED kit ships: the inventory rows whose source directory has
 * at least one file tracked by git.
 *
 * WHY IT IS NOT `rows.length`. The working tree can hold a plugin another chat is still
 * writing (measured 2026-11-10: plugins/image-window was on disk, in the inventory and in
 * nobody's commit). That plugin is not part of the kit a reader can check out, so counting
 * it would make every document state a number that is only true on one uncommitted tree -
 * and the gate would fail on the commit that describes it. A source directory with no
 * tracked file is skipped; outside a git checkout every row counts.
 *
 * @param rows - Inventory plugin rows.
 * @returns The number of committed plugins.
 */
function countTrackedPlugins(rows) {
  let tracked = 0
  for (const row of rows) {
    const source = typeof row.source === 'string' ? row.source : ''
    if (source === '') continue
    try {
      const files = execFileSync('git', ['-C', KIT, 'ls-files', '--', source], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      if (files.trim() !== '') tracked += 1
    } catch {
      // Not a git checkout: nothing says the row is uncommitted, so it counts.
      tracked += 1
    }
  }
  return tracked
}

/** Number words a document may spell a plugin count with. */
const PLUGIN_COUNT_WORDS = {
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
}

/**
 * Every stated plugin count in one document, as `{ value, phrase }`.
 *
 * The claims a reader acts on are of the form "fifteen plugins", "12 plugin tarballs",
 * "twelve in-repo plugins" and "plugin tarballs: fifteen packages". A numeral is taken as
 * written; a word must be one of PLUGIN_COUNT_WORDS, so "one plugin" or a sentence such as
 * "the plugins" is not a count and is skipped.
 *
 * @param text - Document contents.
 * @returns The counts in the order they appear.
 */
function statedPluginCounts(text) {
  const counts = []
  // Markdown emphasis sits INSIDE the claim a reader sees: "the **twelve** plugins" is a
  // count of twelve. Strip the markers before matching, or the gate misses the bolded ones.
  const plain = text.replaceAll('*', '').replaceAll('_', '').replaceAll('`', '')
  for (const match of plain.matchAll(/\b([A-Za-z]+|\d+)\s+(?:in-repo\s+|plugin\s+)?(plugins?|packages?)\b/gi)) {
    const raw = match[1].toLowerCase()
    const value = /^\d+$/.test(raw) ? Number(raw) : PLUGIN_COUNT_WORDS[raw]
    if (Number.isInteger(value)) counts.push({ value, phrase: match[0] })
  }
  return counts
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
  // 6. THE COUNT IS A CLAIM TOO. "Names every plugin" passes a document that says "the
  //    fifteen plugins" while shipping seventeen: a reader who trusts the number plans for
  //    two plugins that do not exist. Only rows whose SOURCE IS COMMITTED count, so an
  //    uncommitted plugin from another checkout does not move the number the documents
  //    describe (the reviewed kit is the committed one).
  const tracked = countTrackedPlugins(rows)
  const mismatches = []
  for (const relative of ['README.md', 'USERGUIDE.md', 'rules/DEPLOYMENT.md']) {
    const document = read(relative)
    if (document.missing === true) { mismatches.push(`${relative}: missing`); continue }
    const stated = statedPluginCounts(document.text)
    if (stated.length === 0) { mismatches.push(`${relative}: states no plugin count`); continue }
    for (const entry of stated) {
      if (entry.value !== tracked) mismatches.push(`${relative}: "${entry.phrase}" (${entry.value}) but the inventory has ${tracked} committed plugin(s)`)
    }
  }
  claim(
    'every stated plugin count is the committed inventory count',
    rows.length > 0 && mismatches.length === 0,
    mismatches.length === 0 ? `${tracked} committed plugin(s), every count agrees` : mismatches.join(' | '),
  )
}


if (failures.length > 0) {
  process.stderr.write(`documentation claims FAILED\n${failures.map((entry) => `  - ${entry}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('documentation ok\n')
