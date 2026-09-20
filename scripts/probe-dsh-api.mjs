/**
 * PURPOSE
 *   Confirm the DSH harness and plugin APIs that the Ratchet v2 design depends
 *   on, by booting a real harness and having a probe plugin report what it
 *   observes. Reading `.d.ts` files cannot answer whether a service is actually
 *   mounted in this deployment, what the model-facing schema projection strips,
 *   or whether an output-schema violation is rejected. Those are the three
 *   questions the verifier and the dynamic-review path are built on, so they get
 *   measured rather than assumed.
 *
 * INPUTS
 *   --task <text>     Task for the scratch profile's one-shot run. Default: a
 *                     prompt that makes the model call every probe tool once.
 *   --profile <name>  Scratch profile name. Default `apiprobe`.
 *   --bundles <csv>   Bundle list for the scratch profile's `dsh.profile.bundles`.
 *                     Default `@deepseek-ai/dsh-base,@deepseek-ai/dsh-headless`.
 *                     Use this to measure whether a capability (the subagent
 *                     runtime, for instance) depends on which bundle is mounted.
 *   --out <path>      Write the evidence bundle to a file (for docs generation).
 *   --probe-judge     Also mount a row whose tool SPAWNS a child agent through
 *                     the `spawn` provider and reads its verdict back. Costs one
 *                     short child turn on the deployment's flash model.
 *   --ratchet         Also mount the kit's `@cc/dsh-ratchet` plugin, to prove the
 *                     real plugin loads and registers its tools in a live
 *                     profile. The task should then call one of them.
 *   --ratchet-review  Drive the ratchet's own dynamic review and ingestion against
 *                     a fixture project, spawning a real judge child agent. Costs
 *                     one child turn.
 *   --ratchet-ratify  Drive the ratchet's own human ratification against a fixture
 *                     project through the user-questions channel, with a stub
 *                     answerer standing in for the human. No model turn beyond the
 *                     one that calls the probe tool.
 *   --adr-panel-consent
 *                     Drive the ADR panel's consent route over real HTTP: mount the
 *                     panel's host half, the ratchet, `dsh-host-webserver` and
 *                     `dsh-client-connection`, then fetch the route on loopback as a
 *                     browser would and post the label the ratchet's own question
 *                     offered. Asserts the browser fence, the per-activation
 *                     capability, the refusals (no quiz, foreign quiz, human-only
 *                     zone, replayed quiz, stale text) and the approval it writes.
 *                     The same server's `/adr-panel/resolve` is driven too: the plan,
 *                     the recorded decline with its reason, and the `humanRequired`
 *                     refusal. What it deliberately does NOT drive is a resolver START —
 *                     its `resolve` case is the one that must refuse — so the
 *                     `spawned`/`steered` half of that route is still unmeasured
 *                     against a live subagent runtime.
 *                     No model turn beyond the one that calls the probe tool.
 *   --kit-rules       Boot no harness and make no model call. Construct the real
 *                     `systemPrompt` service over a scratch home, apply the
 *                     shipped `kit-rules` plugin, assemble and render the
 *                     system prompt, and assert the home rules file reached it.
 *                     This is the behavioural half of instruction routing: a
 *                     provider that stops contributing the rules is a failure
 *                     here, where a static read of the plugin source is not.
 *   Environment: DSH_BIN overrides the launcher; DSH_CREDENTIALS overrides the
 *   source credential file. The live profile is never read or written: the probe
 *   builds its own home under the system temp directory, copies in credentials
 *   only, and mounts the probe plugin through the home-level patch layer. Under
 *   `--kit-rules` no credentials are needed and none are read.
 *
 * OUTPUTS
 *   Exit 0 when every asserted fact holds, 1 otherwise (including a failed boot).
 *   Under `--kit-rules` the exit is 0 only when the assembled prompt carries the
 *   rules content, and prints `kit-rules prompt ok` as the marker a shell gate
 *   greps for. Prints a human report, or one JSON object with `--json`. Evidence
 *   is read from the session log the harness wrote, not from the model's prose: a
 *   model that summarises or truncates a tool result must not be able to change
 *   what the probe reports. Never prints credential material.
 *
 * KEYWORDS
 *   api discovery, fetch-api-first, probe, dsh headless, scratch profile,
 *   defineTool, exec context, output schema, subagent, llm service
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No credentials file: exits 1 naming the paths tried, before any boot. A
 *     probe that silently ran unauthenticated would report "no tool result
 *     observed" and be mistaken for an API defect.
 *   - Scratch home already present: removed and rebuilt, so a previous run's
 *     logs can never be read as this run's evidence.
 *   - Non-zero one-shot exit: stdout/stderr is echoed and the probe exits 1.
 *     A boot failure is a finding, not something to smooth over.
 *   - A probe tool the model never called: reported as an explicit failure rather
 *     than a pass, because "the model did not exercise it" is not evidence that
 *     the API works.
 *   - Session log unreadable or absent while the run exited 0: reported as a
 *     failure with the reason, never as "no violations found".
 *   - `--kit-rules` with no installed harness carrying `dsh-system-prompt` and
 *     `cordis`: exits 1 naming what it looked for, before any assembly. A probe
 *     that silently skipped would be mistaken for a pass.
 *   - `--kit-rules` when the rules content reaches the prompt only because it was
 *     already there: the negative control (a second home with a different file)
 *     fails if the first home's marker survives into the second assembly.
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { readSession, sessionFiles } from './session/session-log.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT = resolve(HERE, '..')
const PROBE_PLUGIN = join(KIT, 'probes', 'api-probe')

/**
 * Module specifier the loader row mounts.
 *
 * A `file:` URL naming the package DIRECTORY does not resolve through that
 * package's `exports` map: the loader answers `ERR_UNSUPPORTED_DIR_IMPORT`
 * (observed on 0.1.5-rc.1). Naming the entry file keeps the probe working and
 * records the constraint for any future kit plugin mounted by absolute URL.
 */
const PROBE_ENTRY = pathToFileURL(join(PROBE_PLUGIN, 'index.mjs')).href

/**
 * Second probe row: the callable-surface probe.
 *
 * It lives in its own module because the two probes answer different questions
 * and a failure in one must not hide the other. It also needs its own ENTRY
 * file: Cordis takes a loader row's default export (or its `apply` member) and
 * has no config selector for a different export — a row declaring
 * `config: { export: applyCallable }` failed the whole tree with "invalid
 * plugin, expect function or object with an \"apply\" method, received object"
 * (observed).
 */
const CALLABLE_ENTRY = pathToFileURL(join(PROBE_PLUGIN, 'callable-entry.mjs')).href

/**
 * Extra probe row, mounted only on request: spawn a real judge agent.
 *
 * The row declares `inject: ['tools', 'subagents']` and its tool starts a child
 * agent through the `spawn` provider, waits for the verdict, and reports it. This
 * is the capability the dynamic Ratchet is built on, and "the service resolves"
 * is not the same claim as "a judge can be spawned and read back".
 *
 * There is no second mode for merely declaring the injection: a row that
 * injects a service and registers nothing is a row the judge row already
 * exercises, and adding one re-registered the callable tool under a second entry
 * and failed the boot with a duplicate tool name.
 */
const JUDGE_ENTRY = pathToFileURL(join(PROBE_PLUGIN, 'judge.mjs')).href

/**
 * The kit's ratchet plugin, mounted only on request.
 *
 * This is the integration check the unit tests cannot perform: it proves the
 * shipped plugin loads under the real loader, that `defineTool` accepts every
 * declaration it makes, and that the tool names it registers reach the model.
 */
const RATCHET_ENTRY = pathToFileURL(join(KIT, 'plugins', 'ratchet', 'ratchet-tools.mjs')).href

/** The deployment rules plugin, mounted only by a rule drill so RED can strip a section. */
const KIT_RULES_ENTRY = pathToFileURL(join(KIT, 'plugins', 'kit-rules', 'kit-rules.mjs')).href

/** The journaling-actions plugin a rule drill mounts; the drill's instrument. */
const DRILL_ENTRY = pathToFileURL(join(PROBE_PLUGIN, 'drill.mjs')).href

/**
 * Integration row, mounted only on request: the ratchet's own dynamic review,
 * driven end to end against a fixture project with a real judge child agent.
 *
 * It imports the production modules rather than reimplementing them, so the
 * evidence is what `ratchet-ops.review` actually produced — prompt, spawn,
 * verdict and validation — instead of a probe's idea of them.
 */
const REVIEW_PROBE_ENTRY = pathToFileURL(join(PROBE_PLUGIN, 'review-probe.mjs')).href

/**
 * Entry of the ratification probe plugin.
 *
 * Same discipline as the review probe: it imports the production modules
 * (`ratifyInteractively`, the derivation, the approval writer) and drives them
 * against a fixture project, with a stub answerer standing in for the human because
 * a headless scratch profile composes no client to answer questions.
 */
const RATIFY_PROBE_ENTRY = pathToFileURL(join(PROBE_PLUGIN, 'ratify-probe.mjs')).href

/**
 * Entry of the ADR panel's consent-route probe.
 *
 * The route is a browser-facing HTTP handler, so driving it needs the real transport:
 * this mode also mounts `@deepseek-ai/dsh-host-webserver` and
 * `@deepseek-ai/dsh-client-connection` (both named by their installed absolute entries,
 * because the scratch profile installs no such package) beside the panel's host half and
 * the ratchet. The probe then fetches the route over `127.0.0.1`, which is what makes the
 * browser fence, the capability header and the write measurable rather than assumed.
 */
const PANEL_CONSENT_PROBE_ENTRY = pathToFileURL(join(PROBE_PLUGIN, 'panel-consent-probe.mjs')).href

/** The ADR panel's host half: the plugin whose route this mode drives. */
const PANEL_HOST_ENTRY = pathToFileURL(join(KIT, 'plugins', 'dsh-adr-panel', 'index.js')).href

/** Probe tool names whose invocation proves the corresponding API works. */
const PROBE_TOOLS = [
  'zzprobe_env',
  'zzprobe_schemas',
  'zzprobe_services',
  'zzprobe_callable',
  'zzprobe_output_ok',
  'zzprobe_output_bad',
]

/** Probe tool names mounted only under a flag.
 *
 * Kept out of `PROBE_TOOLS` because their assertions must not run — and must not
 * be reported as failures — when the row that registers them was not mounted.
 */
const OPTIONAL_PROBE_TOOLS = ['zzprobe_judge', 'zzprobe_ratchet_review', 'zzprobe_ratchet_ratify', 'zzprobe_adr_panel_consent']
/**
 * Task given to the scratch run when the judge probe is mounted.
 *
 * Written as a separate constant because the judge spawns a CHILD turn: the task
 * must ask for exactly one judge call so the probe's cost stays one parent step
 * plus one short child turn.
 */
const JUDGE_TASK = [
  'You are probing a harness API. Call the tool `zzprobe_judge` exactly once with no arguments,',
  'then reply with the single word DONE. Do not summarise the result.',
].join('\n')

/**
 * Task for the ratchet-review integration mode.
 *
 * One call, because the tool spawns a child agent itself: the cost is one parent
 * step plus one child turn, and a task that called it twice would pay twice for
 * the same evidence.
 */
const RATCHET_REVIEW_TASK = [
  'You are probing a harness API. Call the tool `zzprobe_ratchet_review` exactly once with no',
  'arguments, then reply with the single word DONE. Do not summarise the result.',
].join('\n')

/**
 * Task for the ratification integration mode.
 *
 * One call. The tool asks its questions through the user-questions channel and the
 * stub answerer replies in-process, so this mode costs one parent step and no model
 * turn beyond it.
 */
const RATCHET_RATIFY_TASK = [
  'You are probing a harness API. Call the tool `zzprobe_ratchet_ratify` exactly once with no',
  'arguments, then reply with the single word DONE. Do not summarise the result.',
].join('\n')

/**
 * Task for the ADR panel consent-route mode.
 *
 * One call, and no model turn beyond it: the "human" in this mode is the probe's own HTTP
 * client posting the label the ratchet's question offered, so nothing is asked of the model
 * except to invoke the tool once.
 */
const PANEL_CONSENT_TASK = [
  'You are probing a harness API. Call the tool `zzprobe_adr_panel_consent` exactly once with no',
  'arguments, then reply with the single word DONE. Do not summarise the result.',
].join('\n')

/** Default task: one call per probe tool, then a short acknowledgement. */
const DEFAULT_TASK = [
  'You are probing a harness API. Do exactly this and nothing else:',
  '',
  ...PROBE_TOOLS.map((tool, index) => `${index + 1}. Call the tool \`${tool}\` with no arguments.`),
  '',
  'Then reply with the single word DONE. Do not summarise the results.',
].join('\n')

/** Parse the probe's own flags; an unknown flag is a usage error. */
function parseArgs(argv) {
  const options = {
    task: DEFAULT_TASK,
    profile: 'apiprobe',
    keep: false,
    json: false,
    out: null,
    probeJudge: false,
    ratchet: false,
    ratchetReview: false,
    ratchetRatify: false,
    adrPanelConsent: false,
    drill: null,
    drillRules: null,
    drillJournal: null,
    kitRules: false,
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--keep') options.keep = true
    else if (flag === '--json') options.json = true
    else if (flag === '--probe-judge') options.probeJudge = true
    else if (flag === '--ratchet') options.ratchet = true
    else if (flag === '--ratchet-review') options.ratchetReview = true
    else if (flag === '--ratchet-ratify') options.ratchetRatify = true
    else if (flag === '--adr-panel-consent') options.adrPanelConsent = true
    else if (flag === '--drill') options.drill = argv[++index] ?? ''
    else if (flag === '--drill-rules') options.drillRules = argv[++index] ?? ''
    else if (flag === '--drill-journal') options.drillJournal = argv[++index] ?? ''
    else if (flag === '--kit-rules') options.kitRules = true
    else if (flag === '--task') options.task = argv[++index] ?? ''
    else if (flag === '--profile') options.profile = argv[++index] ?? ''
    else if (flag === '--out') options.out = argv[++index] ?? ''
    else if (flag === '--bundles') {
      options.bundles = (argv[++index] ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    } else {
      process.stderr.write(`probe-dsh-api: unknown argument ${JSON.stringify(flag)}\n`)
      process.exit(2)
    }
  }
  return options
}

/**
 * Locate the credential store the scratch home needs.
 *
 * Tries the same home resolution the kit's other components use: an explicit
 * `DSH_HOME`, then the harness's conventional `~/.dsh`, then the npm-local
 * `~/.npm/dsh` this deployment installs into. The last candidate matters because
 * the kit's installers default `DSH_HOME` to `~/.npm/dsh`, so a shell that has
 * not exported it would otherwise report "no credentials" against a machine that
 * has them.
 *
 * @returns The first existing candidate path, or `null` when none exists.
 */
function credentialsSource() {
  const candidates = [
    process.env.DSH_CREDENTIALS,
    join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '.credentials.yaml'),
    join(homedir(), '.dsh', '.credentials.yaml'),
    join(homedir(), '.npm', 'dsh', '.credentials.yaml'),
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * Build the scratch home: credentials, a minimal settings file, the home-level
 * patch that mounts the probe plugin, and a profile manifest.
 *
 * @param home - Absolute scratch home directory.
 * @param profile - Scratch profile name.
 * @param credentials - Absolute path of the credentials file to copy.
 * @param bundles - Bundle names the scratch profile composes.
 * @param probeJudge - Whether to mount the judge-spawning row.
 * @param ratchet - Whether to mount the kit's ratchet plugin.
 * @param adrPanelConsent - Whether to mount the ADR panel's consent route, its ratchet and
 *   the real HTTP transport (webserver + connection) the route is driven over.
 * @returns Absolute path of the scratch workspace the run is opened on.
 */
function buildHome(home, profile, credentials, bundles, probeJudge, ratchet, ratchetReview, ratchetRatify, adrPanelConsent, drill) {
  const workspace = join(home, 'workspace')
  mkdirSync(workspace, { recursive: true })
  copyFileSync(credentials, join(home, '.credentials.yaml'))
  writeFileSync(
    join(home, 'settings.yaml'),
    ['agent-default-model:', '  provider: deepseek-official', '  model: deepseek-flash', ''].join('\n'),
  )
  // The consent-route mode needs three harness packages by ABSOLUTE entry: the scratch
  // profile installs none of them, and a bare package name would resolve nowhere. They are
  // named by the harness root rather than by a hardcoded `lib/index.js`, so an upgrade that
  // moves an entry point is reported rather than silently unloadable.
  const harnessRoot = adrPanelConsent ? harnessPackageRoot() : null
  const transportRows = harnessRoot === null
    ? []
    : [
        '    - id: probe-webserver',
        `      name: ${JSON.stringify(packageEntry(harnessRoot, '@deepseek-ai/dsh-host-webserver'))}`,
        '      config:',
        "        host: '127.0.0.1'",
        '        port: 0',
        '    - id: probe-connection',
        `      name: ${JSON.stringify(packageEntry(harnessRoot, '@deepseek-ai/dsh-client-connection'))}`,
        '    - id: adr-panel',
        `      name: ${JSON.stringify(PANEL_HOST_ENTRY)}`,
      ]
  writeFileSync(
    join(home, 'cordis.patch.yml'),
    [
      '# Scratch probe home. Mounts the API-probe plugin over whatever profile boots.',
      '- insert:',
      '    - id: api-probe',
      `      name: ${JSON.stringify(PROBE_ENTRY)}`,
      '    - id: api-probe-callable',
      `      name: ${JSON.stringify(CALLABLE_ENTRY)}`,
      ...(probeJudge
        ? ['    - id: api-probe-judge', `      name: ${JSON.stringify(JUDGE_ENTRY)}`]
        : []),
      ...(drill
        ? [
            '    - id: kit-rules',
            `      name: ${JSON.stringify(KIT_RULES_ENTRY)}`,
            '    - id: api-probe-drill',
            `      name: ${JSON.stringify(DRILL_ENTRY)}`,
          ]
        : []),
      ...(ratchet || adrPanelConsent ? ['    - id: ratchet', `      name: ${JSON.stringify(RATCHET_ENTRY)}`] : []),
      ...(ratchetReview
        ? ['    - id: api-probe-ratchet-review', `      name: ${JSON.stringify(REVIEW_PROBE_ENTRY)}`]
        : []),
      ...(ratchetRatify
        ? ['    - id: api-probe-ratchet-ratify', `      name: ${JSON.stringify(RATIFY_PROBE_ENTRY)}`]
        : []),
      ...(adrPanelConsent ? [...transportRows, '    - id: api-probe-adr-panel-consent', `      name: ${JSON.stringify(PANEL_CONSENT_PROBE_ENTRY)}`] : []),
      '',
    ].join('\n'),
  )
  const profileDir = join(home, 'profiles', profile)
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(
    join(profileDir, 'package.json'),
    `${JSON.stringify(
      {
        name: `dsh-profile-${profile}`,
        private: true,
        dependencies: {},
        dsh: { profile: { bundles } },
      },
      null,
      2,
    )}\n`,
  )
  return workspace
}

/**
 * Resolve the launcher to an executable invocation.
 *
 * The `dsh` bin is a JavaScript file, so the process is spawned as
 * `node <bin>` with an argument vector rather than through a shell: the default
 * task spans several lines and contains backticks, which a shell on Windows
 * would re-parse.
 *
 * The three candidates cover the layouts a global install actually uses, and all
 * three are needed because the probe runs on both platforms this kit targets:
 * Windows puts globals under `%APPDATA%\npm`, npm installed beside its own
 * interpreter keeps them in a sibling `node_modules`, and a POSIX global install
 * keeps them under `<prefix>/lib/node_modules`. Checking only the first two
 * located the launcher on Windows and on a Windows-style prefix, and failed on a
 * Linux machine whose only harness was a POSIX global install.
 *
 * @returns `{ command, prefixArgs }` for `spawnSync`.
 */
function launcher() {
  if (process.env.DSH_BIN) return { command: process.env.DSH_BIN, prefixArgs: [] }
  const candidates = [
    join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(dirname(process.execPath), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ]
  const bin = candidates.find((candidate) => existsSync(candidate))
  if (bin === undefined) {
    process.stderr.write('probe-dsh-api: cannot locate the dsh launcher; set DSH_BIN.\n')
    process.exit(1)
  }
  return { command: process.execPath, prefixArgs: [bin] }
}

/**
 * Locate an installed harness package tree the kit-rules prompt probe imports from.
 *
 * The probe runs from `scripts/`, where a bare `@deepseek-ai/…` import does not
 * resolve: the harness packages live in the profile store or inside the global
 * `dsh` package, not beside this script. A dynamic import of an absolute file URL
 * is used instead, and the packages' own transitive imports resolve relative to
 * where they live. The probe junction `probes/api-probe/node_modules` is tried
 * first because `dev-link.mjs` maintains it for exactly this kind of tooling, then
 * the deployment's profile stores, then the global install layouts.
 *
 * @returns Absolute `node_modules` directory carrying both
 *   `@deepseek-ai/dsh-system-prompt` and `@deepseek-ai/cordis`, or `null` when
 *   none is installed. Never throws: an unreadable profiles directory is simply
 *   one candidate that does not match.
 */
function harnessPackageRoot() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const roots = [
    join(KIT, 'probes', 'api-probe', 'node_modules'),
    join(home, 'profiles', 'node_modules'),
    join(dirname(process.execPath), 'node_modules', '@deepseek-ai', 'dsh', 'node_modules'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules'),
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules',
    '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules',
  ]
  if (process.env.APPDATA !== undefined) {
    roots.push(join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules'))
  }
  // Every profile's own store, because a machine can install the harness into a
  // profile whose shared packages are not hoisted to the profiles root.
  try {
    for (const entry of readdirSync(join(home, 'profiles'), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        roots.push(join(home, 'profiles', entry.name, 'node_modules'))
      }
    }
  } catch {
    // No profiles directory: one candidate fewer, not a failure.
  }
  const carries = (root) =>
    existsSync(join(root, '@deepseek-ai', 'dsh-system-prompt', 'package.json')) &&
    existsSync(join(root, '@deepseek-ai', 'cordis', 'package.json'))
  return roots.find(carries) ?? null
}

/**
 * Resolve a package's entry module to a `file:` URL through its manifest.
 *
 * Reading `exports["."]`/`main` rather than hardcoding `lib/index.js` keeps the
 * probe working when a harness upgrade moves a package's entry point, which is
 * the kind of churn this kit is upgraded across.
 *
 * @param root - Absolute `node_modules` directory holding the package.
 * @param packageName - The package's name, e.g. `@deepseek-ai/cordis`.
 * @returns The entry module as a `file:` URL string.
 * @throws When the package directory or its manifest cannot be read, or the
 *   manifest names no entry. The caller is a probe whose whole point is to fail
 *   loudly when the harness layout is not what it expects.
 */
function packageEntry(root, packageName) {
  const directory = join(root, ...packageName.split('/'))
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const exported = manifest.exports?.['.'] ?? manifest.exports
  const entry =
    typeof exported === 'string'
      ? exported
      : (exported?.default ?? exported?.import ?? manifest.main ?? 'index.js')
  return pathToFileURL(join(directory, entry)).href
}

/**
 * Prove behaviourally that kit-rules contributes `$DSH_HOME/AGENTS.md` to an
 * assembled system prompt.
 *
 * A static read of the plugin source cannot tell a provider that contributes the
 * rules from one that returns `''`: the empty string is a valid contribution, it
 * passes every grep, and the assembled prompt silently carries no mandatory
 * rules at all. This probe constructs the harness's real `systemPrompt` service,
 * applies the plugin to it, assembles, and renders exactly as the agent loop
 * does, so the assertion is about the prompt the model would receive.
 *
 * It uses two scratch homes in one run. The first carries the kit's real
 * `rules/AGENTS.md` plus a per-run nonce, and must appear in the assembled
 * prompt together with the plugin's binding framing. The second carries a
 * different file, and must appear instead of the first: that negative control
 * fails the probe if the first marker survives, so a contribution that ignores
 * `DSH_HOME` or a prompt assembled from a stale cache cannot pass.
 *
 * @returns `0` when every assertion holds, `1` otherwise. Never throws: a
 *   missing harness install and an assembly failure are both reported as a
 *   failure with the reason, never as a pass.
 */
async function runKitRulesProbe() {
  const root = harnessPackageRoot()
  if (root === null) {
    process.stderr.write(
      'probe-dsh-api --kit-rules: no installed harness carrying ' +
        '@deepseek-ai/dsh-system-prompt and @deepseek-ai/cordis; ' +
        'looked under $DSH_HOME/profiles, the probe junction and the global installs. ' +
        'Run node scripts/dev-link.mjs once the harness is installed.\n',
    )
    return 1
  }
  const pluginPath = join(KIT, 'plugins', 'kit-rules', 'kit-rules.mjs')
  const rulesPath = join(KIT, 'rules', 'AGENTS.md')
  let Context
  let SystemPrompt
  let renderPrompt
  let plugin
  let rules
  try {
    ;({ Context } = await import(packageEntry(root, '@deepseek-ai/cordis')))
    ;({ SystemPrompt, renderPrompt } = await import(packageEntry(root, '@deepseek-ai/dsh-system-prompt')))
    plugin = await import(pathToFileURL(pluginPath).href)
    rules = readFileSync(rulesPath, 'utf8')
  } catch (error) {
    process.stderr.write(
      `probe-dsh-api --kit-rules: cannot load the harness or the plugin under test: ${String(error)}\n`,
    )
    return 1
  }

  const checks = []
  const check = (id, claim, pass, note) => {
    checks.push({ id, claim, pass: Boolean(pass), note })
    process.stdout.write(`  [${pass ? 'PASS' : 'FAIL'}] ${id}\n         ${note}\n`)
  }
  const nonceA = `ZZ_KITRULES_A_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const nonceB = `ZZ_KITRULES_B_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const deployedMarker = rules.split('\n')[0].trim()
  const homes = []
  const previousHome = process.env.DSH_HOME

  let promptA = ''
  let assembledA = null
  let promptB = ''
  let assembledB = null
  let assemblyProblem = null
  try {
    const homeA = mkdtempSync(join(tmpdir(), 'kitrules-a-'))
    const homeB = mkdtempSync(join(tmpdir(), 'kitrules-b-'))
    homes.push(homeA, homeB)
    writeFileSync(join(homeA, 'AGENTS.md'), `${rules}\n\n<!-- ${nonceA} -->\n`)
    writeFileSync(join(homeB, 'AGENTS.md'), `# Other rules\n${nonceB}\n`)

    process.env.DSH_HOME = homeA
    const ctxA = new Context()
    new SystemPrompt(ctxA, {})
    plugin.apply(ctxA)
    assembledA = await ctxA.systemPrompt.assemble()
    promptA = renderPrompt(assembledA)

    process.env.DSH_HOME = homeB
    const ctxB = new Context()
    new SystemPrompt(ctxB, {})
    plugin.apply(ctxB)
    assembledB = await ctxB.systemPrompt.assemble()
    promptB = renderPrompt(assembledB)
  } catch (error) {
    assemblyProblem = String(error?.stack ?? error)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    for (const home of homes) rmSync(home, { recursive: true, force: true })
  }

  if (assemblyProblem !== null) {
    check('kit_rules.prompt_assembles', 'the system prompt assembles without throwing', false, assemblyProblem.slice(-1200))
  } else {
    const sectionA = assembledA.sections.find((section) => section.name === 'kit:rules')
    const sectionB = assembledB.sections.find((section) => section.name === 'kit:rules')
    check(
      'kit_rules.section_is_registered',
      'kit-rules registers a kit:rules section on the assembled prompt',
      sectionA !== undefined,
      sectionA === undefined ? `sections: ${JSON.stringify(assembledA.sections.map((s) => s.name))}` : `kit:rules present (${sectionA.text.length} chars)`,
    )
    check(
      'kit_rules.provider_contributes_the_rules_file',
      'the rules file current at assembly time reaches the assembled prompt',
      promptA.includes(nonceA),
      promptA.includes(nonceA)
        ? 'the per-run marker from $DSH_HOME/AGENTS.md is in the rendered prompt'
        : `the marker is ABSENT from a ${promptA.length}-char prompt: the provider contributed nothing`,
    )
    check(
      'kit_rules.provider_renders_the_binding_framing',
      'the prompt frames the contribution as mandatory rules, not as guidance',
      promptA.includes('MANDATORY OPERATING RULES'),
      promptA.includes('MANDATORY OPERATING RULES') ? 'binding framing present' : 'the binding framing line is absent',
    )
    check(
      'kit_rules.provider_contributes_the_deployed_rules_content',
      "the kit's own rules/AGENTS.md content reaches the prompt",
      promptA.includes(deployedMarker),
      promptA.includes(deployedMarker) ? `deployed marker ${JSON.stringify(deployedMarker)} present` : `deployed marker ${JSON.stringify(deployedMarker)} absent`,
    )
    check(
      'kit_rules.provider_rereads_the_current_home',
      'a second assembly reads its own home, so the contribution is not a constant or a stale cache',
      promptB.includes(nonceB) &&
        !promptB.includes(nonceA) &&
        sectionB !== undefined &&
        !sectionB.text.includes(nonceA),
      `second home marker present=${String(promptB.includes(nonceB))} first home marker leaked=${String(promptB.includes(nonceA))}`,
    )
  }

  const passed = checks.filter((entry) => entry.pass)
  process.stdout.write(
    `\nprobe-dsh-api: kit-rules prompt assembly (behavioural) root=${root}\n` +
      `  ${passed.length}/${checks.length} facts confirmed by assembly\n`,
  )
  if (passed.length !== checks.length) {
    process.stderr.write('kit-rules prompt FAILED\n')
    return 1
  }
  process.stdout.write('kit-rules prompt ok\n')
  return 0
}

/**
 * Read every tool call and tool result out of a session log.
 *
 * The session log is the harness's own durable record, so it is the right
 * evidence: the model's final message is a paraphrase and may truncate exactly
 * the field under test.
 *
 * @param home - Scratch harness home.
 * @returns `{ calls, results, problems }`; `calls` maps call id to tool name,
 *   `results` maps tool name to `{ isError, text }` for the last call of that
 *   name, and `problems` names anything that could not be read.
 */
function readSessionEvidence(home) {
  const calls = new Map()
  const results = new Map()
  const problems = []
  const files = sessionFiles(home)
  if (files.length === 0) {
    problems.push(`no session log found under ${join(home, 'sessions')}`)
    return { calls, results, problems }
  }
  let text
  try {
    text = readSession(files[0])
  } catch (error) {
    problems.push(`cannot decode ${files[0]}: ${String(error)}`)
    return { calls, results, problems }
  }
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record.type === 'tool/call') {
      const id = record.data?.callId
      const name = record.data?.name
      if (typeof id === 'string' && typeof name === 'string') calls.set(id, name)
    }
    if (record.type === 'tool/result') {
      // The durable shape is `data.message.content[]`, one block per result
      // inside the batch, each carrying its own `toolCallId` and `isError`. A
      // `tool/result` record is NOT a flat `{callId, content, isError}`; reading
      // it that way yields zero results while every record is present.
      const blocks = record.data?.message?.content
      if (!Array.isArray(blocks)) continue
      for (const block of blocks) {
        const id = block?.toolCallId
        const name = calls.get(id)
        if (typeof name !== 'string') continue
        const parts = (Array.isArray(block.content) ? block.content : [])
          .filter((part) => part?.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text)
          .join('\n')
        results.set(name, { isError: block.isError === true, text: parts })
      }
    }
  }
  if (results.size === 0) problems.push('the session log carries no tool/result records')
  return { calls, results, problems }
}

/**
 * Pull the first balanced JSON object out of a tool result's text.
 *
 * @param text - Rendered tool result.
 * @returns The parsed object, or `null` when the text carries none.
 */
function firstJsonObject(text) {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/**
 * List session directories under a home, for reporting where evidence lives.
 *
 * @param home - Scratch harness home.
 * @returns Absolute session directory paths.
 */
function sessionDirs(home) {
  const root = join(home, 'sessions')
  if (!existsSync(root)) return []
  const found = []
  for (const bucket of readdirSync(root)) {
    const bucketPath = join(root, bucket)
    if (!statSync(bucketPath).isDirectory()) continue
    for (const entry of readdirSync(bucketPath)) {
      const sessionPath = join(bucketPath, entry)
      if (statSync(sessionPath).isDirectory()) found.push(sessionPath)
    }
  }
  return found
}

const options = parseArgs(process.argv.slice(2))

// The kit-rules prompt probe boots no harness and makes no model call, so it must
// run before the credential check that the booting probes need. It is a complete
// command in its own right: `node scripts/probe-dsh-api.mjs --kit-rules`.
if (options.kitRules) {
  process.exit(await runKitRulesProbe())
}

const credentials = credentialsSource()
if (credentials === null) {
  process.stderr.write(
    'probe-dsh-api: no credentials file found; tried $DSH_CREDENTIALS, ' +
      '$DSH_HOME/.credentials.yaml, ~/.dsh/.credentials.yaml and ~/.npm/dsh/.credentials.yaml. ' +
      'The probe needs an authenticated one-shot run to observe tool execution.\n',
  )
  process.exit(1)
}

const home = join(tmpdir(), `dsh-api-probe-${options.profile}`)
rmSync(home, { recursive: true, force: true })
const workspace = buildHome(
  home,
  options.profile,
  credentials,
  options.bundles,
  options.probeJudge,
  options.ratchet,
  options.ratchetReview,
  options.ratchetRatify,
  options.adrPanelConsent,
  options.drill !== null,
)

// A drill injects a chosen rules file into the scratch home; RED writes the real
// rules with one section removed here, and kit-rules reads it on every assembly.
if (options.drillRules !== null) {
  writeFileSync(join(home, 'AGENTS.md'), readFileSync(options.drillRules, 'utf8'))
}
const drillScenario = options.drill === null ? null : JSON.parse(readFileSync(options.drill, 'utf8'))

// Create the journal before the run: its PRESENCE then means the drill mode
// booted, and its emptiness means the drilled agent took no offered action. A
// missing journal after the run is a boot failure, which is a different defect
// from an agent that refused to act.
if (drillScenario !== null && options.drillJournal !== null && options.drillJournal !== '') {
  writeFileSync(options.drillJournal, '')
}

const { command, prefixArgs } = launcher()
const started = Date.now()
const task = drillScenario !== null
  ? drillScenario.prompt
  : options.probeJudge
  ? JUDGE_TASK
  : options.ratchetReview
    ? RATCHET_REVIEW_TASK
    : options.ratchetRatify
      ? RATCHET_RATIFY_TASK
      : options.adrPanelConsent
        ? PANEL_CONSENT_TASK
        : options.task
const run = spawnSync(command, [...prefixArgs, '--profile', options.profile, task], {
  cwd: workspace,
  env: {
    ...process.env,
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
    ...(drillScenario === null
      ? {}
      : {
          DRILL_JOURNAL: options.drillJournal ?? '',
          DRILL_TOOLS: (drillScenario.tools ?? []).join(','),
        }),
  },
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
const elapsedMs = Date.now() - started
const stderr = run.stderr ?? ''

const evidence = readSessionEvidence(home)
const observed = {}
for (const tool of [...PROBE_TOOLS, ...OPTIONAL_PROBE_TOOLS]) {
  const result = evidence.results.get(tool)
  observed[tool] =
    result === undefined
      ? null
      : { isError: result.isError, payload: firstJsonObject(result.text), raw: result.text.slice(0, 8000) }
}

/** One asserted API fact. */
const checks = []
const check = (id, claim, pass, note) => {
  checks.push({ id, claim, pass: Boolean(pass), note })
}

check(
  'boot.one_shot_run_exits_zero',
  'a scratch profile with the probe plugin boots and the run completes',
  run.status === 0,
  run.status === 0 ? `exit 0 in ${elapsedMs} ms` : `exit ${String(run.status)}: ${stderr.slice(-600)}`,
)
for (const problem of evidence.problems) check('session.readable', 'the session log can be read', false, problem)

// A drill has exactly one fact: the agent under test performed at least one of
// the actions the scenario offered. The verdict — which action, in what order,
// with what arguments — is the drill script's to decide, so this probe only
// proves the instrument recorded something.
if (drillScenario !== null) {
  const journalPath = options.drillJournal ?? ''
  const exists = journalPath !== '' && existsSync(journalPath)
  const entries = exists
    ? readFileSync(journalPath, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0).length
    : 0
  check(
    'drill.journal_written',
    'the drilled agent performed at least one journaled action',
    entries > 0,
    exists ? `${entries} action(s) recorded in ${journalPath}` : `no journal at ${journalPath}`,
  )
}

// The baseline tools are only asserted when the run used the default task. Under
// `--probe-judge` the task asks for ONE judge call instead, so the other rows are
// legitimately absent and must not be reported as failures.
if (options.probeJudge) {
  check(
    'judge.row_dispatched_under_judge_task',
    'the judge task ran and the probe rows stayed loaded',
    observed.zzprobe_judge !== null,
    observed.zzprobe_judge === null ? 'the judge tool was never dispatched' : 'judge tool dispatched',
  )
} else if (options.ratchetReview) {
  // The integration check: the ratchet's own dynamic review ran end to end. The
  // claim under test is the SEAM — production prompt, production spawn,
  // production validation — not that a child agent exists, which `--probe-judge`
  // already established.
  const payload = observed.zzprobe_ratchet_review?.payload ?? null
  const result = payload?.review ?? null
  check(
    'ratchet_review.tool_dispatched',
    'the integration probe was registered and reached',
    payload !== null,
    payload === null ? 'no tool/result record for zzprobe_ratchet_review' : 'dispatched',
  )
  check(
    'ratchet_review.judge_was_available',
    'a tool body can reach the subagents runtime and spawn the judge the ratchet asks for',
    payload?.judgeAvailable === true,
    `runtimePresent=${String(payload?.runtimePresent)} judgeAvailable=${String(payload?.judgeAvailable)}`,
  )
  check(
    'ratchet_review.production_review_ran',
    'ratchet-ops.review built a prompt, ran the judge, and returned a validated verdict',
    result !== null && result.degraded === false && result.stage === 'review',
    `stage=${String(result?.stage)} degraded=${String(result?.degraded)} verdictSource=${String(result?.verdictSource)} problems=${(result?.problems ?? []).length}`,
  )
  check(
    'ratchet_review.verdict_survives_reference_checking',
    'no finding was rejected: every citation resolves to a law that exists, and nothing was reported unusable',
    result !== null &&
      (result.problems ?? []).length === 0 &&
      (result.findings ?? []).length > 0 &&
      result.findings.every((finding) => finding.lawId === null || (result.lawIds ?? []).includes(finding.lawId)),
    // `result.ok` is deliberately NOT asserted here: it carries the JUDGE's verdict,
    // which is false whenever the judge found something — the expected outcome for a
    // change that plainly contradicts a law. Whether the judge was RIGHT is not a
    // thing a probe can decide; whether its citations resolve is.
    `findings=${JSON.stringify((result?.findings ?? []).map((finding) => ({ kind: finding.kind, lawId: finding.lawId })))} ` +
      `lawIds=${JSON.stringify(result?.lawIds)} problems=${JSON.stringify((result?.problems ?? []).map((entry) => entry.code))}`,
  )
  check(
    'ratchet_review.is_advisory',
    'the review reports itself as advisory and not a gate, whatever the judge decided',
    result?.advisory === true && result?.gate === false,
    `advisory=${String(result?.advisory)} gate=${String(result?.gate)} ok=${String(result?.ok)}`,
  )

  // Ingestion, on the same run. This closes the loop the subsystem is built around:
  // raw reasoning in, a compilable record out, with the reasoning's provenance
  // checked rather than asserted.
  const ingested = payload?.ingest ?? null
  check(
    'ratchet_ingest.produced_a_record',
    'a raw source was ingested into a proposed record through the production path',
    ingested !== null && ingested.ok === true && typeof ingested.text === 'string',
    ingested === null
      ? 'the ingestion leg did not run'
      : `ok=${String(ingested.ok)} code=${String(ingested.code)} status=${String(ingested.status)} problems=${(ingested.problems ?? []).length}`,
  )
  check(
    'ratchet_ingest.record_compiles',
    'the generated record satisfies the same rules a handwritten one must',
    ingested?.compiles === true,
    `compiles=${String(ingested?.compiles)} problems=${JSON.stringify((ingested?.compileProblems ?? []).map((entry) => entry.code))}`,
  )
  check(
    'ratchet_ingest.is_proposed_not_active',
    'ingestion never activates a decision: a generated record is always proposed and agent-authored',
    ingested?.status === 'proposed' &&
      typeof ingested?.text === 'string' &&
      ingested.text.includes('authority: agent'),
    `status=${String(ingested?.status)}`,
  )
  check(
    'ratchet_ingest.reasoning_is_grounded',
    'the reasoning the judge attributed to the source was found there, so no quote was fabricated',
    ingested !== null &&
      ingested.ok === true &&
      (ingested.problems ?? []).every((entry) => !entry.message.includes('not there')),
    `problems=${JSON.stringify((ingested?.problems ?? []).map((entry) => entry.code))}`,
  )

  // Cost, recorded rather than assumed. A review and an ingestion each spawn one
  // child agent, so these are the figures that say whether the dynamic layer is
  // affordable on a real corpus.
  check(
    'dynamic.cost_measured',
    'the dynamic layer reports how long each judge round trip took',
    typeof payload?.reviewElapsedMs === 'number' && typeof payload?.ingestElapsedMs === 'number',
    `review=${String(payload?.reviewElapsedMs)}ms ingest=${String(payload?.ingestElapsedMs)}ms ` +
      `ingestPromptBytes=${String(ingested?.promptBytes)}`,
  )
} else if (options.adrPanelConsent) {
  // The ADR panel's consent route, end to end over real HTTP. Every claim here is about the
  // ROUTE rather than about the operation behind it: that the capability reaches the page
  // through the harness's own index injection, that the browser fence and the capability are
  // both required, that the ratchet's question comes back to the caller, that the answer must
  // carry that question, and that the approval and transcript on disk are the ratchet's.
  const payload = observed.zzprobe_adr_panel_consent?.payload ?? null
  const cases = payload?.cases ?? {}
  const approved = cases.approved ?? {}
  const wrote = (name) => {
    const entry = cases[name]?.wrote ?? {}
    return `${String(entry.decisions)}d/${String(entry.sources)}s`
  }

  check(
    'adr_panel_consent.tool_dispatched',
    'the consent-route probe was registered and reached in a live profile',
    payload !== null,
    payload === null ? 'no tool/result record for zzprobe_adr_panel_consent' : 'dispatched',
  )
  check(
    'adr_panel_consent.capability_reaches_the_page',
    'the panel host half publishes the route and its per-activation capability through the harness index-injection table, and the probe obtained them the way the browser does',
    typeof payload?.route === 'string' && payload.route.startsWith('/') && payload?.capabilityBytes >= 32 && payload?.browserSessionMinted === true,
    `route=${String(payload?.route)} capabilityBytes=${String(payload?.capabilityBytes)} browserSessionMinted=${String(payload?.browserSessionMinted)}`,
  )
  check(
    'adr_panel_consent.session_resolves_the_project',
    'the route resolved the project root from the SESSION id, not from the server directory',
    typeof payload?.sessionResolved === 'string' && payload.sessionResolved === payload?.workspace,
    `sessionCwd=${String(payload?.sessionResolved)} workspace=${String(payload?.workspace)}`,
  )
  check(
    'adr_panel_consent.browser_fence_refuses_an_unauthenticated_caller',
    'a loopback request with no browser session is answered 401 and writes nothing',
    cases.unauthenticated_ask?.status === 401 && cases.unauthenticated_ask?.wrote?.decisions === 0 && cases.unauthenticated_ask?.wrote?.sources === 0,
    `status=${String(cases.unauthenticated_ask?.status)} wrote=${wrote('unauthenticated_ask')}`,
  )
  check(
    'adr_panel_consent.capability_is_required',
    'a caller with a browser session but no capability — or a tampered one — is refused before the ratchet is reached',
    cases.ask_without_capability?.status === 403 && cases.ask_with_wrong_capability?.status === 403,
    `without=${String(cases.ask_without_capability?.status)} tampered=${String(cases.ask_with_wrong_capability?.status)}`,
  )
  check(
    'adr_panel_consent.ask_returns_the_ratchets_own_question',
    'the route answers with the question the ratchet builds: the record\'s own text as the detail, and the two labels it offered',
    cases.ask?.status === 200 &&
      cases.ask?.needsAnswer === true &&
      cases.ask?.detailHasFrontmatter === true &&
      cases.ask?.detailBytes > 200 &&
      JSON.stringify(cases.ask?.labels) === JSON.stringify(['Approve', 'Reject']) &&
      cases.ask?.approveLabel === 'Approve' &&
      typeof cases.ask?.frozenHash === 'string',
    JSON.stringify(cases.ask),
  )
  check(
    'adr_panel_consent.composed_answer_mints_nothing',
    'a hand-composed payload — the approve label with no quiz behind it — is refused and writes no file',
    cases.composed_answer_without_quiz?.status === 200 &&
      cases.composed_answer_without_quiz?.result?.ok === false &&
      (cases.composed_answer_without_quiz?.result?.problems ?? []).some((entry) => entry.code === 'RATIFICATION_UNPROVEN') &&
      cases.composed_answer_without_quiz?.wrote?.decisions === 0 &&
      cases.composed_answer_without_quiz?.wrote?.sources === 0,
    JSON.stringify(cases.composed_answer_without_quiz),
  )
  check(
    'adr_panel_consent.foreign_quiz_mints_nothing',
    'a quiz the ratchet did not build is refused, and writes no file',
    cases.foreign_quiz?.result?.ok === false &&
      (cases.foreign_quiz?.result?.problems ?? []).some((entry) => entry.code === 'RATIFICATION_UNPROVEN') &&
      cases.foreign_quiz?.wrote?.decisions === 0 &&
      cases.foreign_quiz?.wrote?.sources === 0,
    JSON.stringify(cases.foreign_quiz),
  )
  check(
    'adr_panel_consent.human_only_zone_mints_nothing',
    'a record whose zone reserves its paths to a human cannot be recorded through the route',
    cases.blocked_zone?.result?.ok === false &&
      (cases.blocked_zone?.result?.ratified ?? []).length === 0 &&
      cases.blocked_zone?.wrote?.decisions === 0 &&
      cases.blocked_zone?.wrote?.sources === 0,
    JSON.stringify(cases.blocked_zone?.result),
  )
  check(
    'adr_panel_consent.stub_human_records_a_real_approval',
    'the label the ratchet offered, posted with the question it came from, writes the approval ADR and its transcript',
    approved.status === 200 &&
      JSON.stringify(approved.result?.ratified) === JSON.stringify(['0001']) &&
      approved.wrote?.decisions === 1 &&
      approved.wrote?.sources === 1 &&
      typeof approved.result?.approval?.path === 'string' &&
      typeof approved.result?.transcript?.path === 'string',
    JSON.stringify({ status: approved.status, result: approved.result, wrote: approved.wrote }),
  )
  check(
    'adr_panel_consent.the_consent_names_the_surface_that_carried_it',
    'the approval and its transcript record the panel channel, not the harness user-questions seam the answer did not travel',
    approved.approvalChannel === 'adr-panel' && approved.transcriptChannel === 'adr-panel',
    `approval=${JSON.stringify(approved.approvalChannel)} transcript=${JSON.stringify(approved.transcriptChannel)}`,
  )
  check(
    'adr_panel_consent.consent_takes_effect',
    'the ratified decision is law afterwards, its law naming the approval that put it there, and the corpus parses clean',
    (payload?.lawsInForce ?? []).some((law) => law.id === 'api.request-budget' && law.approvedBy === approved.result?.approval?.id) &&
      (payload?.compileProblemCodes ?? []).length === 0,
    `laws=${JSON.stringify(payload?.lawsInForce)} problems=${JSON.stringify(payload?.compileProblemCodes)}`,
  )
  check(
    'adr_panel_consent.replayed_quiz_mints_nothing',
    'the same answer sent twice writes nothing the second time, because the record is no longer waiting',
    cases.replayed?.result?.ok === false &&
      (cases.replayed?.result?.ratified ?? []).length === 0 &&
      cases.replayed?.wrote?.decisions === 0 &&
      cases.replayed?.wrote?.sources === 0,
    JSON.stringify(cases.replayed),
  )
  check(
    'adr_panel_consent.stale_text_mints_nothing',
    'an answer about a record edited while the question was open is refused with the stale code and writes nothing',
    cases.stale_text?.result?.ok === false &&
      (cases.stale_text?.result?.problems ?? []).some((entry) => entry.code === 'RATIFICATION_STALE') &&
      cases.stale_text?.wrote?.decisions === 0 &&
      cases.stale_text?.wrote?.sources === 0,
    JSON.stringify(cases.stale_text),
  )
  check(
    'adr_panel_consent.decline_writes_nothing',
    'the ratchet\'s own reject label is recorded as a decline and writes no file',
    (cases.declined?.result?.rejected ?? []).includes('0003') &&
      (cases.declined?.result?.ratified ?? []).length === 0 &&
      cases.declined?.wrote?.decisions === 0 &&
      cases.declined?.wrote?.sources === 0,
    JSON.stringify(cases.declined?.result),
  )
  // The RESOLVE route over the same live server. It is the one route in the kit that
  // could start work, so the claims are about the ratchet's plan, the required
  // capability, the recorded reason — and that a record needing a human starts NOTHING.
  check(
    'adr_panel_resolve.capability_reaches_the_page',
    'the panel host half publishes the resolve route and a capability through the same index-injection table',
    typeof payload?.resolveRoute === 'string' && payload.resolveRoute === '/adr-panel/resolve',
    `route=${String(payload?.resolveRoute)}`,
  )
  check(
    'adr_panel_resolve.plan_is_the_ratchets_own',
    'the resolve route answers with the ratchet\'s plan for a blocked record: a step needing a human, and no declined reasons yet',
    cases.resolve_plan?.status === 200 &&
      cases.resolve_plan?.ok === true &&
      cases.resolve_plan?.humanRequired === true &&
      (cases.resolve_plan?.stepOps ?? []).includes('human-authorship-required'),
    JSON.stringify(cases.resolve_plan),
  )
  check(
    'adr_panel_resolve.capability_is_required',
    'a caller with a browser session but no resolve capability is refused before the ratchet is reached',
    cases.resolve_without_capability?.status === 403,
    `without=${String(cases.resolve_without_capability?.status)}`,
  )
  check(
    'adr_panel_resolve.a_refusal_is_recorded_with_its_reason',
    'a decline of a proposed resolution is recorded with the human\'s own reason, and the next plan reads it back',
    cases.resolve_declined?.status === 200 &&
      cases.resolve_declined?.result?.recorded === true &&
      cases.resolve_declined?.result?.comment !== null &&
      (cases.resolve_plan_after_decline?.declined ?? []).length === 1 &&
      cases.resolve_ledger?.hasDeclineEvent === true &&
      cases.resolve_ledger?.hasReason === true,
    JSON.stringify({ declined: cases.resolve_declined, after: cases.resolve_plan_after_decline, ledger: cases.resolve_ledger }),
  )
  check(
    'adr_panel_resolve.a_human_required_record_starts_nothing',
    'a resolve request for a record with a step no agent may carry is refused with the step, not started',
    cases.resolve_human_required?.status === 200 &&
      cases.resolve_human_required?.result?.ok === false &&
      cases.resolve_human_required?.result?.humanRequired === true &&
      cases.resolve_human_required?.result?.spawned !== true,
    JSON.stringify(cases.resolve_human_required),
  )
} else if (options.ratchetRatify) {
  // The consent seam, end to end. The claims under test are the ones no unit test
  // can reach: that a plugin reaches the user-questions channel with the live root
  // agent the service authenticates, that the human is shown the record's own text,
  // that an answer matching no option mints nothing while the re-ask does, and that
  // the approval finally written puts the decision into force.
  const payload = observed.zzprobe_ratchet_ratify?.payload ?? null
  const result = payload?.result ?? null
  const askedRounds = payload?.asked ?? []
  const firstRound = askedRounds[0]?.questions ?? []
  const secondRound = askedRounds[1]?.questions ?? []

  check(
    'ratchet_ratify.tool_dispatched',
    'the ratification probe was registered and reached in a live profile',
    payload !== null,
    payload === null ? 'no tool/result record for zzprobe_ratchet_ratify' : 'dispatched',
  )
  check(
    'ratchet_ratify.channel_reached_with_a_live_root_agent',
    'a plugin tool body can put a question to the human through ctx.userQuestions with the live root agent',
    payload?.servicePresent === true && payload?.channelAvailable === true && firstRound.length > 0,
    `servicePresent=${String(payload?.servicePresent)} channelAvailable=${String(payload?.channelAvailable)} ` +
      `agentScoped=${String(askedRounds[0]?.agentScoped)} questions=${firstRound.length}`,
  )
  check(
    'ratchet_ratify.human_sees_the_record_itself',
    'each question carries the approved record\'s own text as its detail, which is what the content hash covers',
    firstRound.length > 0 && firstRound.every((question) => question.detailHasFrontmatter === true && question.detailBytes > 200),
    JSON.stringify(firstRound.map((question) => ({ id: question.id, options: question.options, detailBytes: question.detailBytes }))),
  )
  check(
    'ratchet_ratify.answers_are_derived_from_labels',
    'the record whose answer matched no option was not ratified in the first round; the clean answer was',
    Array.isArray(result?.ratified) &&
      result.ratified.includes('0001') &&
      // The re-ask is itself the proof: a question round two only happens for a
      // record the first round did NOT put into force, so an unreadable answer
      // cannot have been read as consent.
      secondRound.length === 1,
    `finalRatified=${JSON.stringify(result?.ratified)} rounds=${askedRounds.length}`,
  )
  check(
    'ratchet_ratify.clean_answer_minted_in_the_first_round',
    'the unambiguous answer produced its approval immediately, and the re-asked record got its own later one',
    (() => {
      const laws = payload?.lawsInForce ?? []
      const clean = laws.find((law) => law.id === 'jobs.retry.exponential-backoff')
      const reAsked = laws.find((law) => law.id === 'plugins.owns-its-ledger')
      return (
        typeof clean?.approvedBy === 'string' &&
        typeof reAsked?.approvedBy === 'string' &&
        clean.approvedBy !== reAsked.approvedBy &&
        clean.approvedBy < reAsked.approvedBy
      )
    })(),
    `laws=${JSON.stringify(payload?.lawsInForce)}`,
  )
  check(
    'ratchet_ratify.unreadable_answer_is_re_asked_differently',
    'the second round asks only the unreadable record, and its labels name that record',
    secondRound.length === 1 &&
      secondRound[0].id === 'ratify-again-0001' &&
      secondRound[0].options.includes('Approve ADR 0001'),
    JSON.stringify(secondRound.map((question) => ({ id: question.id, options: question.options }))),
  )
  check(
    'ratchet_ratify.consent_takes_effect',
    'both records are in force afterwards, each law naming the approval that put it there',
    (payload?.lawsInForce ?? []).length === 2 &&
      (payload?.lawsInForce ?? []).every((law) => typeof law.approvedBy === 'string' && law.approvedBy.length === 4) &&
      (payload?.compileProblemCodes ?? []).length === 0,
    `laws=${JSON.stringify(payload?.lawsInForce)} problems=${JSON.stringify(payload?.compileProblemCodes)}`,
  )
  check(
    'ratchet_ratify.approvals_are_clean_records',
    'every approval ADR the run wrote satisfies the rules any handwritten record must',
    Object.values(payload?.approvalProblems ?? {}).length > 0 &&
      Object.values(payload?.approvalProblems ?? {}).every((codes) => codes.length === 0),
    JSON.stringify(payload?.approvalProblems),
  )
  check(
    'ratchet_ratify.wrote_a_transcript_and_an_approval',
    'a ratification records its evidence: the transcript it cites and the approval that carries the hashes',
    (result?.wrote ?? []).length === 2 && (result?.wrote ?? []).some((path) => path.includes('ratification-')),
    JSON.stringify(result?.wrote),
  )
} else if (options.ratchet) {
  // The integration check: the shipped plugin registered its tools in a live
  // profile. Asserted from the model-facing schema projection rather than from a
  // dispatch, so a task that calls only one tool still proves all four exist.
  // `zzprobe_schemas` may not have been dispatched under a custom task, in which
  // case the check reports that rather than reading an undefined value.
  const schemaNames = observed.zzprobe_schemas?.payload?.names ?? []
  const expected = [
    'ratchet_bootstrap',
    'ratchet_compile',
    'ratchet_ingest_source',
    'ratchet_ratify',
    'ratchet_review',
    'ratchet_status',
    'ratchet_verify',
  ]
  const missing = expected.filter((tool) => !schemaNames.includes(tool))
  check(
    'ratchet.plugin_registers_all_tools',
    'the kit ratchet plugin loads under the real loader and registers every tool it declares',
    missing.length === 0,
    schemaNames.length === 0
      ? 'zzprobe_schemas was not dispatched, so the tool surface was not observed'
      : missing.length === 0
        ? `all ${expected.length} present among ${schemaNames.length} model-facing tools`
        : `missing ${JSON.stringify(missing)}; ratchet tools seen: ${JSON.stringify(schemaNames.filter((n) => n.startsWith('ratchet')))}`,
  )
} else {
  for (const tool of PROBE_TOOLS) {
    const result = observed[tool]
    check(
      `tool.${tool}.dispatched`,
      `${tool} was registered and reached the registry`,
      result !== null,
      result === null
        ? 'no tool/result record for this tool in the session log'
        : result.isError
          ? `dispatched and failed (expected for the two deliberate failures): ${result.raw.slice(0, 300)}`
          : 'dispatched and succeeded',
    )
  }
}

const envPayload = observed.zzprobe_env?.payload
if (envPayload !== null && envPayload !== undefined) {
  check(
    'env.workspace_is_session_cwd',
    'exec.agent.session.header.cwd is the session workspace',
    typeof envPayload.workspace?.preview === 'string' && envPayload.workspace.preview === workspace,
    `reported ${JSON.stringify(envPayload.workspace?.preview)} (expected ${workspace})`,
  )
  check(
    'env.signal_is_abortsignal',
    'exec.signal is an AbortSignal, so a tool can forward cancellation',
    envPayload.signal?.type === 'object' && typeof envPayload.signalAborted === 'boolean',
    `signal.type=${String(envPayload.signal?.type)} aborted=${String(envPayload.signalAborted)}`,
  )
  check(
    'env.defer_context_is_callable',
    'exec.deferContext is a function on ToolRunContext',
    envPayload.deferContext?.type === 'function',
    `type=${String(envPayload.deferContext?.type)}`,
  )
  check(
    'env.agent_identity_present',
    'exec.agent exposes an id and a live session',
    envPayload.agentId?.present === true && envPayload.sessionId?.present === true,
    `agent=${JSON.stringify(envPayload.agentId?.preview)} session=${JSON.stringify(envPayload.sessionId?.preview)}`,
  )
}

const schemaPayload = observed.zzprobe_schemas?.payload
if (schemaPayload !== null && schemaPayload !== undefined) {
  const keySets = Array.isArray(schemaPayload.keySets) ? schemaPayload.keySets : []
  check(
    'schemas.project_only_name_description_parameters',
    'the model-facing schema carries exactly name, description, parameters',
    keySets.length > 0 && keySets.every((keys) => String(keys) === 'description,name,parameters'),
    `keySets=${JSON.stringify(keySets)} across ${String(schemaPayload.count)} tools`,
  )
}

const servicesPayload = observed.zzprobe_services?.payload
if (servicesPayload !== null && servicesPayload !== undefined) {
  const route = (table, name) => table?.find?.((entry) => entry.name === name)
  const envRoutes = envPayload?.services
  check(
    'services.llm_mounted',
    'the llm service resolves from a tool body',
    route(envRoutes, 'llm')?.present === true,
    `viaGet=${String(route(envRoutes, 'llm')?.viaGet)} viaProperty=${String(route(envRoutes, 'llm')?.viaProperty)}`,
  )
  check(
    'services.tool_runtime_reachable',
    'the plugin context exposes the live tool registry to itself',
    Array.isArray(servicesPayload.toolServiceMethods) && servicesPayload.toolServiceMethods.includes('schemas'),
    `ToolRuntime methods=${JSON.stringify((servicesPayload.toolServiceMethods ?? []).slice(0, 16))}`,
  )
  const subagentRoute = route(servicesPayload.routes, 'subagents')
  const singularRoute = route(servicesPayload.routes, 'subagent')
  const agentsRoute = route(servicesPayload.routes, 'agents')
  // The durable fact is the SPELLING. `ctx.get(name)` resolves a mounted service
  // by exact name regardless of injection — this row declares only `tools` and
  // still resolves `subagents` — so asking for the singular returns `undefined`
  // and a row INJECTING the singular never activates. One wrong character
  // produced a false "the dynamic ratchet is impossible" finding, which is why
  // both spellings are asserted side by side.
  check(
    'services.runtime_name_is_plural',
    'the subagent runtime is registered as `subagents`; `subagent` names nothing',
    subagentRoute?.viaGet === true &&
      subagentRoute?.present === true &&
      singularRoute?.viaGet === false &&
      singularRoute?.present === false,
    `subagents: viaGet=${String(subagentRoute?.viaGet)} present=${String(subagentRoute?.present)} | ` +
      `subagent: viaGet=${String(singularRoute?.viaGet)} present=${String(singularRoute?.present)} | ` +
      `agents: present=${String(agentsRoute?.present)} kind=${String(agentsRoute?.kind)}`,
  )
  check(
    'services.get_route_needs_no_injection',
    "ctx.get resolves the mounted subagents runtime even though this row declares only inject: ['tools']",
    subagentRoute?.viaGet === true && subagentRoute?.present === true,
    `this row declares inject=${JSON.stringify(['tools'])}; ` +
      `subagents viaGet=${String(subagentRoute?.viaGet)} present=${String(subagentRoute?.present)} ` +
      `viaProperty=${String(subagentRoute?.viaProperty)} (the property route is not the injection gate: ` +
      'it reads Object.prototype for an un-injected name)',
  )
}

// The callable probe reports the capture error Cordis raises for an undeclared
// injection; that message is the evidence for the gate above, so it is asserted
// rather than tolerated.
const callablePayload = observed.zzprobe_callable?.payload
const subagentCallable = callablePayload?.services?.find?.((entry) => entry.service === 'subagent')
if (subagentCallable !== undefined) {
  check(
    'services.undeclared_injection_raises_named_error',
    'the property route for an undeclared injection fails with a message naming the missing inject',
    typeof subagentCallable.error === 'string' && subagentCallable.error.includes('without inject'),
    `error=${JSON.stringify(subagentCallable.error)}`,
  )
}

// The deliberate output-schema violation. The measurement is whether the wrong
// shape is REJECTED: if it reaches the model as a success, a declared output
// contract enforces nothing. Asserted only when the run used the default task,
// because the judge and ratchet modes issue their own tasks and never call these
// two tools — reporting them as failures would blame the probe for its own
// configuration.
const badResult = observed.zzprobe_output_bad
if (!options.probeJudge && !options.ratchet && !options.ratchetReview && !options.ratchetRatify && !options.adrPanelConsent && drillScenario === null) {
  check(
    'output_schema.violation_is_rejected',
    'a tool whose value violates its declared output schema fails instead of succeeding',
    badResult !== null && badResult.isError === true,
    badResult === null
      ? 'zzprobe_output_bad was never dispatched, so nothing was measured'
      : badResult.isError
        ? `rejected: ${badResult.raw.slice(0, 300)}`
        : `NOT rejected — the violating value was accepted: ${badResult.raw.slice(0, 300)}`,
  )
  check(
    'output_schema.conforming_value_succeeds',
    'a conforming value passes the same output schema',
    observed.zzprobe_output_ok?.isError === false,
    observed.zzprobe_output_ok === null
      ? 'zzprobe_output_ok was never dispatched'
      : observed.zzprobe_output_ok.raw.slice(0, 200),
  )
}

// The dynamic-review capability, measured in two legs. Asserted only when the
// judge row was mounted, because otherwise the tool legitimately does not exist
// and reporting a failure would blame the probe for its own configuration.
if (options.probeJudge) {
  const judge = observed.zzprobe_judge
  const payload = judge?.payload ?? null
  const plain = payload?.plain ?? null
  const structured = payload?.structuredLeg ?? null

  check(
    'judge.tool_dispatched',
    'the judge probe tool was registered and reached',
    judge !== null,
    judge === null ? 'no tool/result record for zzprobe_judge' : judge.raw.slice(0, 300),
  )
  check(
    'judge.providers_registered',
    'the runtime advertises its providers, so a spawn route is selectable',
    Array.isArray(payload?.providers) && payload.providers.includes('spawn'),
    `providers=${JSON.stringify(payload?.providers)}`,
  )

  // Leg one: the spawn/await/read path itself. No schema is requested, so
  // `stopReason` reflects the child's turn and nothing else.
  check(
    'judge.child_agent_runs_to_completion',
    'a plugin can spawn a child agent through the subagents runtime and read its output',
    plain?.stage === 'completed' && plain?.stopReason === 'completed' && typeof plain?.outputText === 'string' && plain.outputText.includes('RATCHET_JUDGE_OK'),
    `stage=${String(plain?.stage)} stopReason=${String(plain?.stopReason)} ` +
      `outputText=${JSON.stringify(plain?.outputText)} elapsedMs=${String(plain?.elapsedMs)} diagnostic=${JSON.stringify(plain?.diagnostic)}`,
  )

  // Leg two: whether a requested outputSchema is honoured. Asserted as the
  // DISJUNCTION the measured behaviour actually supports — a structured verdict,
  // or a readable text verdict — because the first version of this probe asserted
  // the structured branch unconditionally and passed while the field was silently
  // null. A child that answers correctly but fails capture reports
  // `stopReason: 'error'` with the right text in `output`, so a dynamic layer must
  // read the text and treat the structured form as an optimisation.
  check(
    'judge.verdict_is_readable_when_a_schema_is_requested',
    'a schema-requesting judge returns either a structured verdict or a readable text verdict',
    structured !== null &&
      (structured.structured !== null ||
        (typeof structured.outputText === 'string' && structured.outputText.length > 0)),
    `stopReason=${String(structured?.stopReason)} structured=${JSON.stringify(structured?.structured)} ` +
      `outputText=${JSON.stringify(structured?.outputText)} diagnostic=${JSON.stringify(structured?.diagnostic)}`,
  )
}

const bundle = {
  probe: 'dsh-api',
  generatedAt: new Date().toISOString(),
  harnessExitStatus: run.status,
  elapsedMs,
  profile: options.profile,
  bundles: options.bundles,
  scratchHome: home,
  workspace,
  sessionDirs: sessionDirs(home),
  checks,
  observed,
  stderrTail: stderr.slice(-4000),
}

if (options.out !== null && options.out !== '') {
  const target = resolve(options.out)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(bundle, null, 2)}\n`)
}

if (!options.keep) rmSync(home, { recursive: true, force: true })

if (options.json) {
  process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`)
} else {
  const passed = checks.filter((entry) => entry.pass)
  process.stdout.write(
    `probe-dsh-api: profile=${options.profile} exit=${String(run.status)} elapsed=${elapsedMs}ms\n` +
      `  home=${home}\n  workspace=${workspace}\n\n`,
  )
  for (const entry of checks) {
    process.stdout.write(`  [${entry.pass ? 'PASS' : 'FAIL'}] ${entry.id}\n         ${entry.note}\n`)
  }
  process.stdout.write(
    `\n  ${passed.length}/${checks.length} facts confirmed by execution\n` +
      (options.out ? `  evidence written to ${resolve(options.out)}\n` : ''),
  )
  // A mode-specific marker, printed only when EVERY check in the mode passed. A law's
  // `outputContains` can then assert this line, which a partially failing run never prints —
  // an assertion on a check id or on "N/N" would also match a line reporting a failure.
  if (options.adrPanelConsent && passed.length === checks.length) {
    process.stdout.write('  adr panel consent route ok\n')
  }
  if (passed.length !== checks.length) {
    process.stdout.write('\n--- stderr tail ---\n')
    process.stdout.write(bundle.stderrTail)
    process.stdout.write('\n')
  }
}

process.exit(checks.every((entry) => entry.pass) ? 0 : 1)
