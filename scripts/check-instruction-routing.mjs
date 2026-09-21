/**
 * PURPOSE
 *   Enforce the deployment's instruction routing: the rules that reach a model come
 *   from `$DSH_HOME/AGENTS.md` through the kit's own `kit-rules` plugin, and the
 *   harness's workspace-instruction loader — which would let any repository's
 *   AGENTS.md dilute them — is composed OFF.
 *
 *   It exists because the rule was presented as enforced while nothing tested it:
 *   `kit-rules-are-the-only-rules` cited `check-portability.mjs`, which never reads
 *   the profile or instruction routing at all. Deleting the 44 bytes that disable the
 *   loader left every declared check green, so the guarantee held only by habit.
 *
 *   It also enforces the harness PIN, because the routing claims and the pin share a
 *   failure mode: a document that instructs, or a script that runs, is true when written
 *   and unchecked afterwards. `kit-update.mjs` converges a machine on the pin it reads
 *   from `install.ps1`/`install.sh`, so those two are the source of truth here, and every
 *   other place the version is written — the procedure's statement and command examples,
 *   the README, the user guide, and the install line `dev-link.mjs` PRINTS when the link
 *   is missing — is compared to them. Bounded deliberately: only a file that RUNS is
 *   required to pin its install command, so a document may still show the upgrade
 *   procedure's `@<candidate>` placeholder.
 *
 * INPUTS
 *   None. Reads the canonical profile patch, the kit-rules source, the rule and user
 *   documents, and the installer, updater and start scripts, all relative to this
 *   script's own location.
 *
 * OUTPUTS
 *   One line per claim, then `instruction routing ok` and exit 0 when every claim
 *   holds; the failing claims on stderr and exit 1 otherwise. A caller that greps for
 *   the marker cannot mistake a partial run for a pass.
 *
 *   WHAT THE PIN CLAIMS CANNOT DECIDE: they compare the versions the repository WRITES.
 *   Nothing here can see the version a machine actually has installed, so "no machine
 *   runs an unpinned dsh" is enforced only as far as the kit's own instructions and
 *   scripts go: `kit-update.mjs --check` reports the installed harness against this pin
 *   on a real machine, and that is a convergence report rather than this gate.
 *
 * KEYWORDS
 *   instruction routing, kit-rules, workspace instructions, precedence, hard rule 7,
 *   harness pin, version pin, installers, source of truth
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A missing file is a FAILURE, not a skip: every claim here is about a file that
 *     must exist, and "I could not look" is not "it is fine".
 *   - Comments are stripped before the negative check on kit-rules, so prose that
 *     merely mentions a directory walk cannot fail the gate.
 *   - A pin site that writes no version at all fails for the sites that must name one,
 *     and is reported as "prints no harness install command" for the one that need not;
 *     a placeholder in angle brackets is judged as a procedure, never as a pin.
 *   - A `@deepseek-ai/dsh-<subpackage>` range is not a harness pin and is not compared:
 *     the reader requires the package name immediately before the `@`.
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
 * peer) cannot be mistaken for a harness pin — they version on their own line and a
 * false positive there would send a reader to "fix" a correct dependency.
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

// 1. The loader that would inject repository instruction files is composed OFF, by
//    row id, with `disabled: true`. This is the 44 bytes whose removal broke the rule
//    without any declared check noticing.
const patch = read('profile/cordis.patch.yml')
if (patch.missing === true) {
  claim('the canonical profile patch exists', false, patch.path)
} else {
  // The row must EMPTY the loader's discovery. It used to require `disabled: true`
  // instead, which the live web profile was measured to ignore: fresh sessions there
  // received a repository's AGENTS.md with the row shown as `disabled: true`, on a server
  // booted after the file was written. `--dump-config` also shows that patch `config`
  // merges for an enabled row and not for a disabled one, so the flag was blocking the
  // fix that works. Empty candidate lists leave the loader nothing to find regardless.
  //
  // The row's LIVE lines are isolated here and each key is anchored to the start of its
  // own line. The first version scanned the raw YAML with an unanchored regex: a row whose
  // real lists were non-empty (`instructionFileCandidates: [AGENTS.md]`) but which merely
  // MENTIONED the empty form in a comment passed as emptied, so the claim held while the
  // loader still discovered repository instruction files. Full-line comments are dropped
  // and trailing comments are stripped, so a commented-out `[]` cannot stand in for the
  // real list.
  const agentRow = (() => {
    const lines = patch.text.split('\n')
    const start = lines.findIndex((line) => /^-\s*id:\s*agent-instructions\s*$/.test(line))
    if (start === -1) return []
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((line) => /^- /.test(line))
    return (end === -1 ? rest : rest.slice(0, end))
      .map((line) => line.replace(/\s+#.*$/, ''))
      .filter((line) => !/^\s*#/.test(line))
  })()
  const liveEmptyList = (key) => new RegExp(`^[ \\t]*${key}:\\s*\\[\\s*\\]\\s*$`, 'm').test(agentRow.join('\n'))
  const emptied =
    agentRow.length > 0 && liveEmptyList('instructionFileCandidates') && liveEmptyList('localInstructionFileCandidates')
  claim(
    'the loader row empties its instruction-file discovery',
    emptied,
    emptied ? 'both candidate lists empty' : 'instructionFileCandidates/localInstructionFileCandidates are not both empty',
  )
  // And it must not ALSO be disabled, because a disabled row's config is not merged —
  // the two lines together would silently restore the old, ineffective state.
  const alsoDisabled = /^-\s*id:\s*agent-instructions\s*$[\s\S]{0,300}?^\s*disabled:\s*true\s*$/m.test(patch.text)
  claim(
    'and is not disabled, which would discard that config',
    !alsoDisabled,
    alsoDisabled ? 'the row is both disabled and configured; the config will not merge' : 'not disabled',
  )

  // 2a. And the work-mode plugin is mounted, because the cap and the mode are the two
  //     policies this deployment states, and a profile row is what puts one into force.
  //     A plugin the deployment describes and does not mount is the same class of lie as
  //     a rule with no enforcement point.
  const mountsWorkModes = /name:\s*'@cc\/dsh-work-modes'/.test(patch.text)
  claim('the patch mounts @cc/dsh-work-modes', mountsWorkModes, mountsWorkModes ? 'row present' : 'no work-modes row')

  // 2. And the kit's own rules plugin is what is mounted in its place.
  const mountsKitRules = /name:\s*'@cc\/dsh-kit-rules'/.test(patch.text)
  claim('the patch mounts @cc/dsh-kit-rules', mountsKitRules, mountsKitRules ? 'row present' : 'no kit-rules row')
}

// 3. kit-rules reads ONE file, at the harness home. A directory walk or a cwd lookup
//    would be a second route into the prompt, which is the thing the rule forbids.
const kitRules = read('plugins/kit-rules/kit-rules.mjs')
if (kitRules.missing === true) {
  claim('the kit-rules source exists', false, kitRules.path)
} else {
  const code = kitRules.text
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n')
  const walks = ['readdirSync', 'process.cwd(', 'globSync', 'opendirSync'].filter((token) => code.includes(token))
  claim(
    'kit-rules reads no directory and no working directory',
    walks.length === 0,
    walks.length === 0 ? 'no walk or cwd lookup in code' : `found ${walks.join(', ')}`,
  )
  const homeOnly = /DSH_HOME/.test(code) && /RULES_FILE\s*=\s*'AGENTS\.md'/.test(code)
  claim('and it reads the rules file inside the harness home', homeOnly, homeOnly ? "RULES_FILE = 'AGENTS.md' + DSH_HOME" : 'the home-relative read is not recognisable')
}

// 4. The rules the deployment installs are the kit's own copy, so the file a model
//    reads is the file this repository reviews.
for (const relative of ['rules/AGENTS.md', 'rules/DEPLOYMENT.md']) {
  const rules = read(relative)
  claim(`${relative} exists`, rules.missing !== true, rules.missing === true ? 'missing' : `${rules.text.length} bytes`)
}
for (const relative of ['install.sh', 'install.ps1', 'scripts/kit-update.mjs']) {
  const script = read(relative)
  // Either spelling counts: a literal `rules/AGENTS.md`, or the path assembled from
  // its parts (`join(kit, 'rules', 'AGENTS.md')`). The first version of this check
  // knew only the literal form and reported the updater as not installing the rules
  // at all — a false negative that would have sent a reader to fix working code.
  const installs =
    script.missing !== true &&
    /AGENTS\.md/.test(script.text) &&
    (/rules[/\\]AGENTS\.md/.test(script.text) || /['"]rules['"]/.test(script.text))
  claim(`${relative} installs rules/AGENTS.md`, installs, script.missing === true ? 'missing' : installs ? 'referenced' : 'no reference to rules/AGENTS.md')
  // And DEPLOYMENT.md travels with it, because AGENTS.md points at it: a machine that
  // installs the pointer without the file sends every agent to read nothing.
  const installsProcedure =
    script.missing !== true && /DEPLOYMENT\.md/.test(script.text)
  claim(
    `${relative} installs rules/DEPLOYMENT.md`,
    installsProcedure,
    script.missing === true ? 'missing' : installsProcedure ? 'referenced' : 'no reference to DEPLOYMENT.md',
  )
}

// 5. The pointer and the procedure agree: the rules file names DEPLOYMENT.md, the
//    procedure names the commands it tells an agent to run, and every kit file it
//    names exists. This is what keeps an agent-facing document from drifting into
//    fiction — prose is not a gate, but the files it tells an agent to run are.
const agents = read('rules/AGENTS.md')
if (agents.missing === true) {
  claim('rules/AGENTS.md names the deployment procedure', false, 'missing')
} else {
  const points = /DEPLOYMENT\.md/.test(agents.text) && /\$DSH_HOME/.test(agents.text)
  claim(
    'rules/AGENTS.md names $DSH_HOME/DEPLOYMENT.md as the operating procedure',
    points,
    points ? 'pointer present' : 'no pointer to the procedure',
  )
}
const procedure = read('rules/DEPLOYMENT.md')
if (procedure.missing === true) {
  claim('the deployment procedure names runnable kit files', false, 'missing')
} else {
  // The name class admits upper case: the scripts this kit ships are lower-case, but the
  // claim is about every script the procedure NAMES, and a mixed-case name was invisible to
  // a `[a-z0-9-]` class — `scripts/Check-Missing.mjs` passed this claim without existing.
  // The same regular expression is used by the test that derives this list from the
  // procedure, so the two must stay identical.
  const named = [...procedure.text.matchAll(/scripts\/([A-Za-z0-9-]+\.mjs)/g)].map((match) => match[1])
  const missing = [...new Set(named)].filter((name) => !existsSync(join(KIT, 'scripts', name)))
  claim(
    'every script the procedure names exists',
    named.length > 0 && missing.length === 0,
    missing.length === 0 ? `${new Set(named).size} script(s) named, all present` : `missing: ${missing.join(', ')}`,
  )
  // Every plugin the profile MOUNTS must be named in the procedure: a table that
  // describes a smaller deployment than the one installed is the kind of drift an agent
  // cannot detect, because it has nothing to compare against.
  const patchText = read('profile/cordis.patch.yml')
  const mounted =
    patchText.missing === true ? [] : [...patchText.text.matchAll(/name:\s*'(@[^']+)'/g)].map((match) => match[1])
  const unnamed = mounted.filter((name) => !procedure.text.includes(name))
  claim(
    'every mounted plugin is named in the procedure',
    mounted.length > 0 && unnamed.length === 0,
    unnamed.length === 0 ? `${mounted.length} mounted plugin(s), all documented` : `undocumented: ${unnamed.join(', ')}`,
  )
  // ── the harness pin: every place it is written, compared to the installers ──
  // The installers are the source of truth because `kit-update.mjs` reads the pin from
  // `install.ps1`/`install.sh` (`DSH_VERSION`) at converge time — so a document quoting a
  // different version, or a second installer disagreeing, sends an agent to install a
  // build the kit does not ship. What was missing was not the comparison of the procedure
  // against the installers (that is below, unchanged) but the REST of the places the
  // version is written: the README a human reads, the user guide, and the `npm i -g` line
  // a failing `dev-link.mjs` prints. Each was true when written and none was checked.
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
  // Distinguishes "the installers disagree with each other" from "no installer declares a
  // pin at all": both leave sourcePin null, and reporting the second for the first sends a
  // reader to add a declaration that is already there.
  const sourcePinNote =
    sourcePin ?? (installers.every((entry) => entry.pin === null) ? 'no usable installer pin' : `installers disagree (${installers.map((entry) => `${entry.relative} ${entry.pin ?? 'none'}`).join(', ')})`)

  // The procedure's PROSE statement of the pin, matched on its own wording: the earlier
  // first-version-in-the-file rule matched whatever version-looking string came first, so
  // a version mentioned in passing above the statement could stand in for it.
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

  // The README a human reads and the user guide that walks them through install: both tell
  // a person which version to install, so both must agree with the installers. They are
  // required to NAME the pin, unlike the optional sites below — a version-less install
  // instruction is exactly the unpinned machine this rule forbids.
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

  // `dev-link.mjs` prints the install command to run when the link is missing. It is not a
  // document, but the line it prints IS an instruction, and a stale one sends a reader to a
  // version the kit no longer ships. It may legitimately print no command at all — the
  // claim is that what it prints agrees, not that it must print one.
  const link = read('scripts/dev-link.mjs')
  if (link.missing === true) {
    claim('the install command dev-link.mjs prints carries the installer pin', false, 'missing')
  } else {
    const printed = [...problemPins(link.text)]
    const stray = printed.filter((value) => value !== sourcePin)
    claim(
      'the install command dev-link.mjs prints carries the installer pin',
      stray.length === 0,
      stray.length === 0
        ? printed.length === 0
          ? 'it prints no harness install command'
          : `${printed.length} printed command(s), all ${sourcePin}`
        : `prints ${[...new Set(stray)].join(', ')}, ${sourcePinNote}`,
    )
  }

  // And no shipped SCRIPT may install the harness without a version. Bounded to the files
  // that RUN rather than instruct: a document is allowed to show `@<candidate>` as the
  // upgrade procedure, and a `--help` line may show a placeholder, but a script that
  // executes `npm i -g @deepseek-ai/dsh` — with no version, or with a package name it
  // never pinned — installs whatever npm resolves and defeats the pin for that machine.
  const runnable = ['install.sh', 'install.ps1', 'scripts/kit-update.mjs', 'start.sh', 'start.ps1', 'scripts/verify-upgrade.sh']
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

  const procedureUrl = /https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.git/.exec(procedure.text)?.[0] ?? null
  const readmeUrl = readme.missing === true ? null : (/https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.git/.exec(readme.text)?.[0] ?? null)
  claim(
    'the clone URL agrees with README.md',
    procedureUrl !== null && procedureUrl === readmeUrl,
    procedureUrl === readmeUrl ? procedureUrl : `procedure: ${procedureUrl}, README: ${readmeUrl}`,
  )
}

// 6. No document may offer a `--profile headless` run as proof that the rules reached a
//    model. Measured: the kit installs its patch layer for the `web` profile, so a
//    headless run has neither the loader disable nor the `kit-rules` row and answers
//    ABSENT on a healthy machine — a check that fails for a reason unrelated to what it
//    claims to test, which is worse than no check. Mentioning that trap is fine (both
//    documents now warn about it); printing such a command as the verification is not.
//    The prompt-content proof is asking the agent in the session you are already in.
for (const relative of ['rules/DEPLOYMENT.md', 'USERGUIDE.md']) {
  const document = read(relative)
  if (document.missing === true) {
    claim(`${relative} never offers a headless routing probe`, false, 'missing')
    continue
  }
  // Only a headless line that is a COMMAND counts (`dsh --profile headless …` at the
  // start of a line, as it appears in a fenced block); prose that warns about the trap
  // is the opposite of the defect and must not be flagged.
  const lines = document.text.split('\n')
  const probeLines = lines
    .map((line, index) => ({ line, index }))
    .filter((entry) => /^\s*(?:\$ )?dsh\s+--profile\s+headless/.test(entry.line))
    .filter((entry) => {
      const block = lines.slice(entry.index, entry.index + 3).join('\n')
      return /PRESENT or ABSENT|MANDATORY OPERATING RULES|Instructions from:/.test(block)
    })
    .map((entry) => entry.line.trim())
  claim(
    `${relative} never offers a headless routing probe`,
    probeLines.length === 0,
    probeLines.length === 0 ? 'no headless probe command' : `probe offered: ${probeLines[0].slice(0, 80)}`,
  )
}

// 7. Every document that describes the shipped plugin set must agree with the inventory.
//    A user guide that denies the existence of a shipped plugin is the same class of lie as
//    a rule with no enforcement point: it reads as authoritative and nothing contradicted
//    it. USERGUIDE.md said "This kit no longer ships client plugins" while
//    `@cc/dsh-adr-panel` — a browser-half client plugin — was mounted in the profile, and
//    this check passed because it only looked at DEPLOYMENT.md's list.
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
  const userGuide = read('USERGUIDE.md')
  const denies = userGuide.missing === true ? false : /no longer ships client plugins/i.test(userGuide.text)
  claim('USERGUIDE.md does not deny the client plugin it ships', !denies, denies ? 'the sentence is back' : 'no denial')
}

if (failures.length > 0) {
  process.stderr.write(`instruction routing FAILED\n${failures.map((entry) => `  - ${entry}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('instruction routing ok\n')
