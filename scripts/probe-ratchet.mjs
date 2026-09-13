/**
 * PURPOSE
 *   Reproduce the ratchet's record-reading behaviour against synthetic decision
 *   directories, so a claim about what `ratchet_reconcile` hands the judging
 *   agent is a measurement rather than a reading of its source. The supervisor
 *   brief quotes this script's output; keeping it runnable is what keeps those
 *   quotes honest after the plugin changes.
 *
 * INPUTS
 *   --plugin <dir>  installed `@cc/dsh-context` directory. Default: the web
 *                   profile under $DSH_HOME (or %USERPROFILE%\.dsh), which is
 *                   where the kit installs it.
 *   No other arguments; the trees are built under the system temp directory and
 *   removed before exit.
 *
 * OUTPUTS
 *   One block per scenario on stdout: the `problems` array, then one line per
 *   record with the fields the reconciler consumes (`id`, `supersededBy`,
 *   `decision`), then the question the tool would ask. Exit 0 always unless the
 *   plugin cannot be imported, which exits 1 — a probe that cannot run must not
 *   look like a probe that found nothing.
 *
 * KEYWORDS
 *   ratchet, decision records, readDecisions, reproduction, probe, supervisor
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A scenario directory is recreated on every run, so a previous run's files
 *     can never be mistaken for this run's input.
 *   - A decision file whose `## Decision` section is a table is included
 *     deliberately: the reader drops table rows, and the probe reports the
 *     resulting null rather than hiding it.
 *   - All temp trees are removed on exit, including when a scenario throws.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Where the installed plugin lives unless the operator overrides it. */
const DEFAULT_PLUGIN = join(
  process.env.DSH_HOME ?? join(homedir(), '.dsh'),
  'profiles', 'web', 'node_modules', '@cc', 'dsh-context',
)

/** Resolve the plugin directory from argv, falling back to the profile copy. */
function pluginDir(argv) {
  const index = argv.indexOf('--plugin')
  return index >= 0 && argv[index + 1] ? argv[index + 1] : DEFAULT_PLUGIN
}

const base = join(tmpdir(), 'ratchet-probe')
const plugin = pluginDir(process.argv.slice(2))

/** Build one project tree, optionally with decision files, and return its root. */
function project(name, files) {
  const root = join(base, name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, '.dsh'), { recursive: true })
  writeFileSync(join(root, '.dsh', 'project.json'), JSON.stringify({ manifestVersion: 1, languages: [], rules: [] }))
  if (files) {
    mkdirSync(join(root, 'docs', 'decisions'), { recursive: true })
    for (const [file, body] of Object.entries(files)) writeFileSync(join(root, 'docs', 'decisions', file), body)
  }
  return root
}

/** Record one header plus every decision file, so a quote names its input. */
function files(files) {
  return files ? Object.keys(files).sort().join(', ') : '(no docs/decisions directory)'
}

const scenarios = [
  {
    name: 'A. standard records, one real and one bogus supersession',
    files: {
      '0001-first.md': '# 0001 — Use polling\n\n## Status\n\nAccepted\n\n## Decision\n\nPoll the API every minute.\n\n## Consequences\n\nSimple, but wasteful.\n',
      '0002-second.md': '# 0002 — Use webhooks\n\n## Status\n\nSuperseded by 0001\n\n## Decision\n\nPush updates over webhooks.\n',
      '0003-third.md': '# 0003 — Drop webhooks\n\n## Status\n\nSuperseded by 9999\n\n## Decision\n\nRemove the webhook endpoint.\n',
    },
  },
  {
    name: 'B. non-record filenames alongside one real record',
    files: {
      'decisions.md': '# Architecture decisions\n\n## Decision\n\nEverything at once.\n',
      'README.md': '# How to write a record\n\n## Decision\n\nUse the template.\n',
      '0007-real.md': '# 0007 — Real\n\n## Status\n\nAccepted\n\n## Decision\n\nBe real.\n',
    },
  },
  { name: 'C. no docs/decisions directory at all', files: null },
  {
    name: 'D. supersession spelled differently',
    files: {
      '0001-a.md': '# 0001 — A\n\n## Status\n\nAccepted (superseded by 0002)\n\n## Decision\n\nA.\n',
      '0002-b.md': '# 0002 — B\n\n## Status\n\nSuperseded by 3\n\n## Decision\n\nB.\n',
      '0003-c.md': '# 0003 — C\n\n## Status\n\nsuperseded by 0004\n\n## Decision\n\nC.\n',
    },
  },
  {
    name: 'E. a Decision expressed as a table',
    files: {
      '0001-table.md': '# 0001 — Tabular\n\n## Status\n\nAccepted\n\n## Decision\n\n| option | verdict |\n| a | no |\n| b | yes |\n',
    },
  },
]

let core
let tool
try {
  core = await import(pathToFileURL(join(plugin, 'context-core.mjs')).href)
  tool = await import(pathToFileURL(join(plugin, 'reconcile-tool.mjs')).href)
} catch (error) {
  process.stderr.write(`probe-ratchet: cannot import the plugin from ${plugin}: ${error.message}\n`)
  process.exit(1)
}

console.log(`plugin: ${plugin}`)
try {
  for (const scenario of scenarios) {
    const root = project(scenario.name.slice(0, 1), scenario.files)
    const { records, problems } = core.readDecisions(root)
    const active = records.filter((record) => record.supersededBy === null)
    console.log(`\n== ${scenario.name}`)
    console.log(`   files: ${files(scenario.files)}`)
    console.log(`   problems: ${JSON.stringify(problems)}`)
    for (const record of records) {
      console.log(
        `   record id=${JSON.stringify(record.id)} supersededBy=${JSON.stringify(record.supersededBy)} ` +
        `decision=${JSON.stringify(record.decision)}`,
      )
    }
    console.log(`   active: ${active.length} of ${records.length}`)
    console.log(`   question: ${JSON.stringify(tool.reconcileQuestion(active.length, null))}`)
  }
} finally {
  rmSync(base, { recursive: true, force: true })
}
