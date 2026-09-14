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
 * INPUTS
 *   None. Reads the canonical profile patch, the kit-rules source, and the installer
 *   and updater scripts, all relative to this script's own location.
 *
 * OUTPUTS
 *   One line per claim, then `instruction routing ok` and exit 0 when every claim
 *   holds; the failing claims on stderr and exit 1 otherwise. A caller that greps for
 *   the marker cannot mistake a partial run for a pass.
 *
 * KEYWORDS
 *   instruction routing, kit-rules, workspace instructions, precedence, hard rule 7
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A missing file is a FAILURE, not a skip: every claim here is about a file that
 *     must exist, and "I could not look" is not "it is fine".
 *   - Comments are stripped before the negative check on kit-rules, so prose that
 *     merely mentions a directory walk cannot fail the gate.
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
  const emptied =
    /^-\s*id:\s*agent-instructions\s*$[\s\S]{0,300}?instructionFileCandidates:\s*\[\s*\][\s\S]{0,120}?localInstructionFileCandidates:\s*\[\s*\]/m.test(
      patch.text,
    )
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
  const named = [...procedure.text.matchAll(/scripts\/([a-z0-9-]+\.mjs)/g)].map((match) => match[1])
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
  // The pin it quotes must be the pin the installers enforce, or the procedure sends an
  // agent to install a version the kit does not ship. Both installers hold it in
  // `DSH_VERSION`, so the variable is read before the inline spelling is tried.
  const quoted = /`(\d+\.\d+\.\d+(?:-[a-z0-9.]+)?)`/.exec(procedure.text)
  const installerPins = ['install.sh', 'install.ps1']
    .map((relative) => read(relative))
    .filter((entry) => entry.missing !== true)
    .map(
      (entry) =>
        /DSH_VERSION\s*=\s*['"]?([0-9][^'"\s]*)/.exec(entry.text)?.[1] ??
        /@deepseek-ai\/dsh@([0-9][^"'\s]*)/.exec(entry.text)?.[1] ??
        null,
    )
  const samePin = quoted !== null && installerPins.length === 2 && installerPins.every((pin) => pin === quoted[1])
  claim(
    'the harness version the procedure quotes is the installers pin',
    samePin,
    samePin ? quoted[1] : `procedure: ${quoted?.[1] ?? 'none'}, installers: ${installerPins.join(', ')}`,
  )
  // And the clone URL matches the one the README gives a human, so the two documents
  // cannot send an agent and a person to different repositories.
  const readme = read('README.md')
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
