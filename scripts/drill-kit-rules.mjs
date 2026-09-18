#!/usr/bin/env node
/**
 * PURPOSE
 *   Test a prompt rule the way a check is tested: run a pressure scenario and
 *   watch what the agent actually does. A rule the kit injects as prose — model
 *   policy, remote-change permission, completion claims, test order — has no
 *   shell command that fails when it is broken, so nothing currently shows
 *   whether it changes a decision at all. This command is that evidence.
 *
 *   It is differential by construction. Every scenario runs twice over the SAME
 *   prompt: RED, where the injected `$DSH_HOME/AGENTS.md` is the real rules file
 *   with the section under test removed, and GREEN, where it is the file
 *   unchanged. Run RED first: if the agent does not violate the rule without it,
 *   the scenario does not tempt the agent and proves nothing about the rule, so
 *   the verdict is `missed` — the same shape `ratchet falsify` uses for a check
 *   that cannot fail.
 *
 * INPUTS
 *   `--root <dir>`     kit root (default: the current directory).
 *   `--scenario <id>`  run one scenario by id; default is every file in
 *                      `rules/drills/*.json`.
 *   `--plan`           print the RED/GREEN plan and the section each scenario
 *                      strips; touch no model and write nothing. This is the
 *                      default, so a bare invocation is free.
 *   `--from-journal <id> <red.json> <green.json>`
 *                      evaluate two recorded journals; no model, no profile. This
 *                      is what makes the verdict logic testable, and what replays
 *                      a run that was captured elsewhere.
 *   `--live`           run RED and GREEN for each scenario through
 *                      `scripts/probe-dsh-api.mjs --drill`, which needs
 *                      credentials and the pinned harness. Non-hermetic, so it
 *                      belongs in `verify-upgrade.sh` and never in a law's
 *                      `checks` entry.
 *
 * OUTPUTS
 *   `--plan` prints one line per scenario naming its rule section and prompt.
 *   An evaluation prints `<id>: <verdict> <detail>` per scenario. Exit 0 when
 *   every run held (or `--plan` ran), 1 when any scenario was violated, missed
 *   or errored, 2 when the scenarios or the root cannot be read — so "nothing
 *   was checked" is never reported as "nothing is wrong".
 *
 * KEYWORDS
 *   rule drill, behavioural test, pressure scenario, red green, rule
 *   enforcement, model policy, prompt rule, falsification
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No scenarios: exit 2, because a drill over an empty set proves nothing.
 *   - A section heading the rules file does not contain: RED equals GREEN and
 *     the drill reports `missed` for that scenario rather than pretending to
 *     have stripped anything.
 *   - A journal that cannot be read: the scenario errors; it is never counted as
 *     a pass.
 *   - `--live` without credentials: the probe exits non-zero and the drill
 *     reports the run as errored with the probe's own message.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/**
 * Load every drill scenario under a directory.
 *
 * @param dir - Absolute path of the scenarios directory.
 * @returns Scenarios sorted by id; empty when the directory is absent.
 */
export function loadScenarios(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
}

/**
 * Remove one rule section from the injected rules text.
 *
 * A section runs from its `## <heading>` line to the next `## ` line. The
 * heading match is a prefix, so a scenario can name `## 8. Model & Cost Policy`
 * without repeating the em-dash suffix in the file. The removed text is returned
 * so the caller can report what RED actually lost.
 *
 * @param rulesText - The full rules file text.
 * @param heading - The heading to remove, without its trailing newline.
 * @returns `{ text, removed, found }` — the stripped text (unchanged when the
 *   heading is absent), the removed block, and whether the heading was found.
 */
export function stripSection(rulesText, heading) {
  const lines = rulesText.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith(heading))
  if (start === -1) return { text: rulesText, removed: '', found: false }
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) {
      end = index
      break
    }
  }
  const removed = lines.slice(start, end).join('\n')
  const text = [...lines.slice(0, start), ...lines.slice(end)].join('\n')
  return { text, removed, found: true }
}

/**
 * Decide whether one journal entry matches one expectation.
 *
 * @param entry - `{ tool, args }` as written by the drill probe.
 * @param expected - `{ tool, field?, matches? }`.
 * @returns True on a match.
 */
export function entryMatches(entry, expected) {
  if (entry.tool !== expected.tool) return false
  if (expected.field === undefined) return true
  const value = String(entry.args?.[expected.field] ?? '')
  return expected.matches === undefined || new RegExp(expected.matches, 'i').test(value)
}

/** @returns The index of the first entry matching an expectation, or -1. */
function firstIndex(journal, expected) {
  return journal.findIndex((entry) => entryMatches(entry, expected))
}

/**
 * How many journal entries match an expectation.
 *
 * A rule can constrain the SHAPE of an action rather than its arguments: "delegate by
 * context block" is violated by calling the same tool once per task, which presence alone
 * cannot express — both the correct run and the violating one call it. Counting is what
 * makes that rule drillable.
 *
 * @param journal - The recorded journal entries.
 * @param expected - An expectation (`{ tool, field?, matches? }`).
 * @returns The number of matching entries.
 */
function countCalls(journal, expected) {
  return journal.filter((entry) => entryMatches(entry, expected)).length
}

/**
 * Evaluate one scenario's GREEN run against its expectations.
 *
 * @param scenario - A loaded scenario.
 * @param journal - The recorded journal entries.
 * @returns Findings as `{ code, detail }`, empty when the run held.
 */
export function evaluateGreen(scenario, journal) {
  const findings = []
  const green = scenario.green ?? {}
  for (const expected of green.forbid ?? []) {
    const index = firstIndex(journal, expected)
    if (index !== -1) findings.push({ code: 'FORBIDDEN_ACTION', detail: `${expected.tool} at entry ${index}` })
  }
  // A bounded number of calls, not a forbidden argument: one delegation per context block
  // means at most `max` delegations, however the tasks were named.
  for (const bounded of green.maxCalls ?? []) {
    const count = countCalls(journal, bounded)
    if (typeof bounded.max === 'number' && count > bounded.max) {
      findings.push({ code: 'TOO_MANY_CALLS', detail: `${bounded.tool} called ${count} time(s), at most ${bounded.max}` })
    }
  }
  for (const required of green.require ?? []) {
    if (firstIndex(journal, { tool: required }) === -1) {
      findings.push({ code: 'REQUIRED_ACTION_MISSING', detail: required })
    }
  }
  for (const [before, after] of green.order ?? []) {
    const beforeIndex = firstIndex(journal, { tool: before })
    const afterIndex = firstIndex(journal, { tool: after })
    if (beforeIndex !== -1 && afterIndex !== -1 && beforeIndex > afterIndex) {
      findings.push({ code: 'ORDER_VIOLATION', detail: `${before} came after ${after}` })
    }
  }
  return findings
}

/**
 * Decide whether a RED run actually elicited the violation the scenario targets.
 *
 * @param scenario - A loaded scenario.
 * @param journal - The RED journal.
 * @returns True when the forbidden action appeared without the rule.
 */
export function redElicitedViolation(scenario, journal) {
  const expects = scenario.red?.expect ?? []
  if (expects.some((expected) => firstIndex(journal, expected) !== -1)) return true
  // A violation that is a COUNT — one delegation per task instead of one per block — is
  // elicited when the unruled run did it more often than the rule allows.
  const tooMany = scenario.red?.expectCalls ?? []
  if (tooMany.some((bounded) => typeof bounded.min === 'number' && countCalls(journal, bounded) >= bounded.min)) return true
  // A scenario whose violation is an ORDER (product code before its test, a
  // claim before its check) cannot be expressed by presence alone: both actions
  // appear in the correct run too.
  return (scenario.red?.order ?? []).some(([before, after]) => {
    const beforeIndex = firstIndex(journal, { tool: before })
    const afterIndex = firstIndex(journal, { tool: after })
    return beforeIndex !== -1 && afterIndex !== -1 && beforeIndex > afterIndex
  })
}

/**
 * Evaluate a RED/GREEN pair for one scenario.
 *
 * @param scenario - A loaded scenario.
 * @param redJournal - The journal from the run without the rule.
 * @param greenJournal - The journal from the run with the rule.
 * @returns `{ ok, verdict, findings }` where verdict is `pass`, `violation` or
 *   `missed`.
 */
export function evaluatePair(scenario, redJournal, greenJournal) {
  const findings = []
  if (!redElicitedViolation(scenario, redJournal)) {
    return {
      ok: false,
      verdict: 'missed',
      findings: [{ code: 'NOT_ELICITED', detail: 'the scenario did not produce the violation without the rule' }],
    }
  }
  findings.push(...evaluateGreen(scenario, greenJournal))
  return { ok: findings.length === 0, verdict: findings.length === 0 ? 'pass' : 'violation', findings }
}

/**
 * Read a recorded journal.
 *
 * @param path - Absolute path of the journal file.
 * @returns The entries, or throws when the file is missing or not JSON lines.
 */
export function readJournal(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
}

/**
 * Run one scenario live through the probe, once per rule variant.
 *
 * Never throws: the probe's own stderr becomes the reported detail, because
 * "which stage refused" is the diagnostic value.
 *
 * @param root - Kit root.
 * @param scenario - A loaded scenario.
 * @param variant - `red` or `green`.
 * @param rulesText - The rules file text to inject.
 * @returns `{ journal, detail, ok }` — `ok` false when the probe failed.
 */
export function runLiveVariant(root, scenario, variant, rulesText) {
  const workDir = join(root, 'reports', 'ratchet', 'drills')
  mkdirSync(workDir, { recursive: true })
  const rulesPath = join(workDir, `${scenario.id}.${variant}.AGENTS.md`)
  const journalPath = join(workDir, `${scenario.id}.${variant}.journal.jsonl`)
  writeFileSync(rulesPath, rulesText)
  const probe = spawnSync(
    process.execPath,
    [join(root, 'scripts', 'probe-dsh-api.mjs'), '--drill', join(root, 'rules', 'drills', `${scenario.id}.json`), '--drill-rules', rulesPath, '--drill-journal', journalPath],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  // The probe exits non-zero when the journal is empty, which is a legitimate
  // drill outcome (the agent took no offered action), not an instrument failure.
  // Only a journal that is ABSENT is an error: it means the run never booted.
  if (!existsSync(journalPath)) {
    return {
      journal: [],
      ok: false,
      detail: `probe exit ${String(probe.status)} with no journal: ${(probe.stderr ?? '').slice(-400)}`,
    }
  }
  try {
    return { journal: readJournal(journalPath), ok: true, detail: '' }
  } catch (error) {
    return { journal: [], ok: false, detail: `unreadable journal: ${String(error)}` }
  }
}

/**
 * The command entry point.
 *
 * @param argv - Process argument vector (without interpreter and script).
 * @returns The process exit code.
 */
export function main(argv) {
  const rootIndex = argv.indexOf('--root')
  const root = resolve(rootIndex === -1 ? process.cwd() : argv[rootIndex + 1])
  const only = argv.includes('--scenario') ? argv[argv.indexOf('--scenario') + 1] : null
  const rulesPath = join(root, 'rules', 'AGENTS.md')

  let scenarios
  try {
    scenarios = loadScenarios(join(root, 'rules', 'drills'))
  } catch (error) {
    process.stderr.write(`drill-kit-rules: cannot read scenarios: ${String(error)}\n`)
    return 2
  }
  if (scenarios.length === 0) {
    process.stderr.write(`drill-kit-rules: no scenarios under ${join(root, 'rules', 'drills')}\n`)
    return 2
  }
  if (only !== null) scenarios = scenarios.filter((scenario) => scenario.id === only)
  if (scenarios.length === 0) {
    process.stderr.write(`drill-kit-rules: no scenario named ${only}\n`)
    return 2
  }

  if (argv.includes('--from-journal')) {
    const [, id, redPath, greenPath] = argv.slice(argv.indexOf('--from-journal'))
    const scenario = scenarios.find((candidate) => candidate.id === id)
    if (scenario === undefined) {
      process.stderr.write(`drill-kit-rules: no scenario named ${id}\n`)
      return 2
    }
    let result
    try {
      result = evaluatePair(scenario, readJournal(redPath), readJournal(greenPath))
    } catch (error) {
      process.stderr.write(`drill-kit-rules: cannot read a journal: ${String(error)}\n`)
      return 2
    }
    process.stdout.write(`${id}: ${result.verdict}${result.findings.length === 0 ? '' : ` ${JSON.stringify(result.findings)}`}\n`)
    return result.ok ? 0 : 1
  }

  if (!argv.includes('--live')) {
    let rulesText
    try {
      rulesText = readFileSync(rulesPath, 'utf8')
    } catch (error) {
      process.stderr.write(`drill-kit-rules: cannot read ${rulesPath}: ${String(error)}\n`)
      return 2
    }
    let allFound = true
    for (const scenario of scenarios) {
      const stripped = stripSection(rulesText, scenario.ruleSection)
      if (!stripped.found) allFound = false
      process.stdout.write(
        `${scenario.id}: strips "${scenario.ruleSection}" (${stripped.found ? `${stripped.removed.split('\n').length} lines` : 'NOT FOUND — RED would equal GREEN'})\n`,
      )
    }
    // A marker printed only when every scenario strips something, so a law's
    // `outputContains` cannot be satisfied by a partial plan.
    if (allFound) process.stdout.write(`drill plan ok (${scenarios.length} scenario(s))\n`)
    return allFound ? 0 : 1
  }

  let rulesText
  try {
    rulesText = readFileSync(rulesPath, 'utf8')
  } catch (error) {
    process.stderr.write(`drill-kit-rules: cannot read ${rulesPath}: ${String(error)}\n`)
    return 2
  }

  let exit = 0
  for (const scenario of scenarios) {
    const stripped = stripSection(rulesText, scenario.ruleSection)
    if (!stripped.found) {
      process.stdout.write(`${scenario.id}: missed the section ${scenario.ruleSection} was not found\n`)
      exit = 1
      continue
    }
    const red = runLiveVariant(root, scenario, 'red', stripped.text)
    const green = runLiveVariant(root, scenario, 'green', rulesText)
    if (!red.ok || !green.ok) {
      process.stdout.write(`${scenario.id}: error ${red.detail || green.detail}\n`)
      exit = 1
      continue
    }
    const result = evaluatePair(scenario, red.journal, green.journal)
    process.stdout.write(`${scenario.id}: ${result.verdict}${result.findings.length === 0 ? '' : ` ${JSON.stringify(result.findings)}`}\n`)
    if (!result.ok) exit = 1
  }
  return exit
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2))
}
