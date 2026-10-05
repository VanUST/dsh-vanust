/**
 * PURPOSE
 *   Confirm the DSH harness and plugin APIs this kit depends on, by booting a
 *   real harness and having a probe plugin report what it observes. Reading
 *   `.d.ts` files cannot answer whether a service is actually mounted in this
 *   deployment, what the model-facing schema projection strips, or whether an
 *   output-schema violation is rejected: those facts get measured rather than
 *   assumed.
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
 * (observed on 0.2.0-rc.2). Naming the entry file keeps the probe working and
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

/** The deployment rules plugin, mounted only by a rule drill so RED can strip a section. */
const KIT_RULES_ENTRY = pathToFileURL(join(KIT, 'plugins', 'kit-rules', 'kit-rules.mjs')).href

/** The journaling-actions plugin a rule drill mounts; the drill's instrument. */
const DRILL_ENTRY = pathToFileURL(join(PROBE_PLUGIN, 'drill.mjs')).href

/** Probe tool names whose invocation proves the corresponding API works. */
const PROBE_TOOLS = [
  'zzprobe_env',
  'zzprobe_schemas',
  'zzprobe_services',
  'zzprobe_callable',
  'zzprobe_output_ok',
  'zzprobe_output_bad',
]

/** Default task: one call per probe tool, then a short acknowledgement. */
const DEFAULT_TASK = [
  'You are probing a harness API. Do exactly this and nothing else:',
  '',
  ...PROBE_TOOLS.map((tool, index) => `${index + 1}. Call the tool \`${tool}\` with no arguments.`),
  '',
  'Then reply with the single word DONE. Do not summarise the results.',
].join('\n')

/** Parse the probe's own flags; an unknown flag is a usage error. */
/**
 * The exit code a probe run reports, from the checks it recorded.
 *
 * PURPOSE
 *   Turn the probe's recorded facts into the process exit code a law's `outputContains`
 *   and a release gate both read, so "the probe exits non-zero when a fact is not
 *   confirmed" is one executable rule rather than a line a reader has to trust.
 * INPUTS
 *   checks — the array of `{ pass, id, note }` the run recorded. Anything else, including
 *   an empty array, is read as "no fact was confirmed".
 * OUTPUTS
 *   `0` only when every recorded check has `pass === true` AND at least one check was
 *   recorded; `1` otherwise. An empty run is a failure, not a pass: a probe that recorded
 *   nothing must not exit 0, which is what `[].every(...)` used to do.
 * KEYWORDS
 *   probe, exit code, facts confirmed, churn detector, selftest
 */
export function probeExitCode(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return 1
  return checks.every((entry) => entry !== null && typeof entry === 'object' && entry.pass === true) ? 0 : 1
}

function parseArgs(argv) {
  const options = {
    task: DEFAULT_TASK,
    profile: 'apiprobe',
    keep: false,
    json: false,
    out: null,
    drill: null,
    drillRules: null,
    drillJournal: null,
    globalSpecs: false,
    localSpecs: false,
    selftestExit: false,
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--keep') options.keep = true
    else if (flag === '--json') options.json = true
    else if (flag === '--drill') options.drill = argv[++index] ?? ''
    else if (flag === '--drill-rules') options.drillRules = argv[++index] ?? ''
    else if (flag === '--drill-journal') options.drillJournal = argv[++index] ?? ''
    else if (flag === '--global-specs' || flag === '--kit-rules') options.globalSpecs = true
    else if (flag === '--local-specs' || flag === '--specs-prompt') options.localSpecs = true
    else if (flag === '--selftest-exit') options.selftestExit = true
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
 * @param drill - Whether to mount the rule-drill rows (the deployment rules plugin
 *   and the journaling-actions instrument the drill scenario drives).
 * @returns Absolute path of the scratch workspace the run is opened on.
 */
function buildHome(home, profile, credentials, bundles, drill) {
  const workspace = join(home, 'workspace')
  mkdirSync(workspace, { recursive: true })
  copyFileSync(credentials, join(home, '.credentials.yaml'))
  writeFileSync(
    join(home, 'settings.yaml'),
    ['agent-default-model:', '  provider: deepseek-official', '  model: deepseek-flash', ''].join('\n'),
  )
  writeFileSync(
    join(home, 'cordis.patch.yml'),
    [
      '# Scratch probe home. Mounts the API-probe plugin over whatever profile boots.',
      '- insert:',
      '    - id: api-probe',
      `      name: ${JSON.stringify(PROBE_ENTRY)}`,
      '    - id: api-probe-callable',
      `      name: ${JSON.stringify(CALLABLE_ENTRY)}`,
      ...(drill
        ? [
            '    - id: kit-rules',
            `      name: ${JSON.stringify(KIT_RULES_ENTRY)}`,
            '    - id: api-probe-drill',
            `      name: ${JSON.stringify(DRILL_ENTRY)}`,
          ]
        : []),
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
 * Prove behaviourally that the GLOBAL scope reaches an assembled prompt, that it follows
 * `$DSH_HOME` rather than a constant, and that a project cannot write into it.
 *
 * The claim under test is the boundary this design rests on: specs under
 * `$DSH_HOME/specs` reach every agent, and a spec under a project's `docs/specs` may NOT
 * fill a global-only slot. A static read cannot tell a provider that contributes those
 * items from one that returns `''` - the empty string is a valid contribution, it passes
 * every grep, and the prompt quietly carries no mandatory rules at all. So this probe
 * builds a scratch home from the kit's real seeds, assembles the prompt exactly as the
 * agent loop does, and asserts on the text the model would receive.
 *
 * It uses two scratch homes in one run. The first carries the kit's real seeds plus a
 * per-run nonce item, and must appear in the assembled prompt under the plugin's binding
 * framing. The second carries a different seed, which must appear INSTEAD of the first: a
 * contribution that ignored `DSH_HOME`, or a prompt assembled from a stale cache, fails
 * that control.
 *
 * @returns `0` when every assertion holds, `1` otherwise. Never throws: a missing harness
 *   install and an assembly failure are both reported as a failure with the reason.
 */
async function runGlobalSpecsProbe() {
  const root = harnessPackageRoot()
  if (root === null) {
    process.stderr.write(
      'probe-dsh-api --global-specs: no installed harness carrying ' +
        '@deepseek-ai/dsh-system-prompt and @deepseek-ai/cordis; ' +
        'looked under $DSH_HOME/profiles, the probe junction and the global installs. ' +
        'Run node scripts/dev-link.mjs once the harness is installed.\n',
    )
    return 1
  }
  const seedsDir = join(KIT, 'rules', 'specs')
  let Context
  let SystemPrompt
  let renderPrompt
  let plugin
  let seeds
  try {
    ;({ Context } = await import(packageEntry(root, '@deepseek-ai/cordis')))
    ;({ SystemPrompt, renderPrompt } = await import(packageEntry(root, '@deepseek-ai/dsh-system-prompt')))
    plugin = await import(pathToFileURL(join(KIT, 'plugins', 'specs', 'plugin-specs.mjs')).href)
    seeds = readdirSync(seedsDir).filter((name) => name.endsWith('.md')).sort()
    if (seeds.length === 0) throw new Error(`no seeds under ${seedsDir}`)
  } catch (error) {
    process.stderr.write(
      `probe-dsh-api --global-specs: cannot load the harness or the sources under test: ${String(error)}\n`,
    )
    return 1
  }

  const checks = []
  const check = (id, claim, pass, note) => {
    checks.push({ id, claim, pass: Boolean(pass), note })
    process.stdout.write(`  [${pass ? 'PASS' : 'FAIL'}] ${id}\n         ${note}\n`)
  }
  const nonceA = `ZZ_GLOBALSPECS_A_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const nonceB = `ZZ_GLOBALSPECS_B_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const nonceEvil = `ZZ_LOCALRULES_${Date.now()}_${Math.random().toString(36).slice(2)}`
  // A line from the rules themselves, taken from the seed the kit ships: the check is that
  // the text in this repository is the text the model reads.
  const intro = readFileSync(join(seedsDir, '10-intro.md'), 'utf8')
  const introBody = intro.slice(intro.indexOf('\n---', 4) + 4)
  const deployedMarker = introBody.split('\n').find((line) => line.trim().length > 0)?.trim() ?? ''
  const homes = []
  const previousHome = process.env.DSH_HOME
  const projectFile = join(KIT, 'docs', 'specs', `probe-${nonceEvil}.md`)

  let promptA = ''
  let assembledA = null
  let promptB = ''
  let assemblyProblem = null
  try {
    const homeA = mkdtempSync(join(tmpdir(), 'globalspecs-a-'))
    const homeB = mkdtempSync(join(tmpdir(), 'globalspecs-b-'))
    homes.push(homeA, homeB)
    mkdirSync(join(homeA, 'specs'), { recursive: true })
    for (const seed of seeds) copyFileSync(join(seedsDir, seed), join(homeA, 'specs', seed))
    writeFileSync(join(homeA, 'MACHINE.md'), '# This machine\n\n- Platform: probe\n')
    writeFileSync(
      join(homeA, 'specs', '99-nonce.md'),
      `---\ntitle: Nonce\nslot: rules\norder: 9999\nstatus: active\n---\n${nonceA}\n`,
    )
    mkdirSync(join(homeB, 'specs'), { recursive: true })
    writeFileSync(join(homeB, 'specs', '10-only.md'), `---\nslot: rules\n---\n${nonceB}\n`)

    // A LOCAL spec naming a GLOBAL-ONLY slot. The probe runs from the kit checkout, which
    // is a project root, so this file is in scope for the assembly - and it must reach no
    // section at all.
    mkdirSync(dirname(projectFile), { recursive: true })
    writeFileSync(projectFile, `---\ntitle: Project override\nslot: rules\n---\n${nonceEvil}\n`)

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
    promptB = renderPrompt(await ctxB.systemPrompt.assemble())
  } catch (error) {
    assemblyProblem = String(error?.stack ?? error)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    for (const home of homes) rmSync(home, { recursive: true, force: true })
    rmSync(projectFile, { force: true })
  }

  if (assemblyProblem !== null) {
    check('global_specs.prompt_assembles', 'the system prompt assembles without throwing', false, assemblyProblem.slice(-1200))
  } else {
    const section = assembledA.sections.find((entry) => entry.name === 'specs:rules')
    check(
      'global_specs.rules_section_is_registered',
      'the specs plugin registers a specs:rules section carrying the global items',
      section !== undefined && String(section.text).length > 0,
      section === undefined
        ? `sections: ${JSON.stringify(assembledA.sections.map((s) => s.name))}`
        : `specs:rules present (${String(section.text).length} chars)`,
    )
    check(
      'global_specs.provider_renders_the_binding_framing',
      'the prompt frames the contribution as mandatory rules, not as guidance',
      promptA.includes('MANDATORY OPERATING RULES'),
      promptA.includes('MANDATORY OPERATING RULES') ? 'binding framing present' : 'the binding framing line is absent',
    )
    check(
      'global_specs.provider_contributes_the_deployed_rules_content',
      'the rules the kit ships in rules/specs reach the prompt',
      deployedMarker.length > 0 && promptA.includes(deployedMarker),
      promptA.includes(deployedMarker)
        ? `deployed marker ${JSON.stringify(deployedMarker)} present`
        : `deployed marker ${JSON.stringify(deployedMarker)} absent`,
    )
    check(
      'global_specs.a_global_item_reaches_the_prompt',
      'a global item added to $DSH_HOME/specs reaches the prompt without a restart',
      promptA.includes(nonceA),
      promptA.includes(nonceA) ? 'the per-run global item is in the rendered prompt' : 'the global item is ABSENT from the prompt',
    )
    check(
      'global_specs.provider_rereads_the_current_home',
      'a second assembly reads its own home, so the contribution is not a constant or a stale cache',
      promptB.includes(nonceB) && !promptB.includes(nonceA),
      `second home marker present=${String(promptB.includes(nonceB))} first home marker leaked=${String(promptB.includes(nonceA))}`,
    )
    check(
      'global_specs.a_local_spec_cannot_fill_a_global_slot',
      'a project spec naming the rules slot reaches no section, so a project cannot dilute the mandatory rules',
      !promptA.includes(nonceEvil),
      promptA.includes(nonceEvil)
        ? 'a local spec entered the rules slot: the scope boundary is not enforced'
        : 'the local override was refused and named in the catalogue problems',
    )
  }

  const passed = checks.filter((entry) => entry.pass)
  process.stdout.write(
    `\nprobe-dsh-api: global specs prompt assembly (behavioural) root=${root}\n` +
      `  ${passed.length}/${checks.length} facts confirmed by assembly\n`,
  )
  if (passed.length !== checks.length) {
    process.stderr.write('global specs prompt FAILED\n')
    return 1
  }
  process.stdout.write('global specs prompt ok\n')
  return 0
}

/**
 * Prove behaviourally that the LOCAL scope is additive: a project's own specs arrive in
 * ADDITION TO the global items, never instead of them.
 *
 * A static read cannot tell an additive section from one that rewrites the prompt, so this
 * probe assembles twice over the SAME scratch home: once with no project spec, once with
 * an active one, and compares. The differential is the proof - the first assembly must
 * carry the global framing and not the spec body, the second must carry both, and the
 * second must be strictly larger.
 *
 * @returns `0` when every assertion holds, `1` otherwise. Never throws.
 */
async function runLocalSpecsProbe() {
  const root = harnessPackageRoot()
  if (root === null) {
    process.stderr.write(
      'probe-dsh-api --local-specs: no installed harness carrying ' +
        '@deepseek-ai/dsh-system-prompt and @deepseek-ai/cordis; ' +
        'looked under $DSH_HOME/profiles, the probe junction and the global installs. ' +
        'Run node scripts/dev-link.mjs once the harness is installed.\n',
    )
    return 1
  }
  const seedsDir = join(KIT, 'rules', 'specs')
  let Context
  let SystemPrompt
  let renderPrompt
  let plugin
  let seeds
  try {
    ;({ Context } = await import(packageEntry(root, '@deepseek-ai/cordis')))
    ;({ SystemPrompt, renderPrompt } = await import(packageEntry(root, '@deepseek-ai/dsh-system-prompt')))
    plugin = await import(pathToFileURL(join(KIT, 'plugins', 'specs', 'plugin-specs.mjs')).href)
    seeds = readdirSync(seedsDir).filter((name) => name.endsWith('.md')).sort()
  } catch (error) {
    process.stderr.write(
      `probe-dsh-api --local-specs: cannot load the harness or the sources under test: ${String(error)}\n`,
    )
    return 1
  }

  const checks = []
  const check = (id, claim, pass, note) => {
    checks.push({ id, claim, pass: Boolean(pass), note })
    process.stdout.write(`  [${pass ? 'PASS' : 'FAIL'}] ${id}\n         ${note}\n`)
  }

  const nonce = `ZZ_LOCALSPECS_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const specsDir = join(KIT, 'docs', 'specs')
  const specFile = join(specsDir, `probe-${nonce}.md`)
  const homes = []
  const previousHome = process.env.DSH_HOME

  let withoutSpec = ''
  let withSpec = ''
  let sections = []
  let problem = null
  try {
    const home = mkdtempSync(join(tmpdir(), 'localspecs-'))
    homes.push(home)
    mkdirSync(join(home, 'specs'), { recursive: true })
    for (const seed of seeds) copyFileSync(join(seedsDir, seed), join(home, 'specs', seed))
    writeFileSync(join(home, 'MACHINE.md'), '# This machine\n\n- Platform: probe\n')
    process.env.DSH_HOME = home

    const assemble = async () => {
      const ctx = new Context()
      new SystemPrompt(ctx, {})
      plugin.apply(ctx)
      const assembled = await ctx.systemPrompt.assemble()
      return { prompt: renderPrompt(assembled), sections: assembled.sections.map((entry) => entry.name) }
    }
    withoutSpec = (await assemble()).prompt
    mkdirSync(specsDir, { recursive: true })
    writeFileSync(specFile, `---\ntitle: Additivity probe\nstatus: active\n---\n${nonce}\n`)
    const second = await assemble()
    withSpec = second.prompt
    sections = second.sections
  } catch (error) {
    problem = String(error?.stack ?? error)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    for (const home of homes) rmSync(home, { recursive: true, force: true })
    rmSync(specFile, { force: true })
  }

  if (problem !== null) {
    check('local_specs.prompt_assembles', 'the system prompt assembles with a project spec present', false, problem.slice(-1200))
  } else {
    check(
      'local_specs.items_section_is_registered',
      'the specs plugin registers the advisory items section beside the rules section',
      sections.includes('specs:rules') && sections.includes('specs:items'),
      `sections: ${JSON.stringify(sections)}`,
    )
    check(
      'local_specs.spec_body_reaches_the_prompt',
      'the active project spec body is in the rendered prompt',
      withSpec.includes(nonce),
      withSpec.includes(nonce) ? `spec nonce present in a ${withSpec.length}-char prompt` : 'the spec body is ABSENT from the rendered prompt',
    )
    check(
      'local_specs.absent_without_the_project_spec',
      'the same home without the spec file carries no spec body, so the file is what put it there',
      !withoutSpec.includes(nonce),
      withoutSpec.includes(nonce) ? 'the body is present without the file, so this probe proves nothing' : 'the positive control holds: the nonce is absent until the file exists',
    )
    check(
      'local_specs.injection_is_additive_not_replacing',
      'the global rules survive in the SAME prompt as the project spec, so a project adds a section rather than rewriting the prompt',
      withSpec.includes('MANDATORY OPERATING RULES') && withSpec.includes(nonce),
      withSpec.includes('MANDATORY OPERATING RULES')
        ? 'the binding framing and the spec body are both present in one prompt'
        : 'the rules framing is ABSENT beside the project spec',
    )
    check(
      'local_specs.prompt_is_larger_with_the_spec',
      'the prompt with the project spec is strictly larger than the same prompt without it',
      withSpec.length > withoutSpec.length,
      `without=${withoutSpec.length} chars, with=${withSpec.length} chars`,
    )
  }

  const passed = checks.filter((entry) => entry.pass)
  process.stdout.write(
    `\nprobe-dsh-api: local specs prompt assembly (behavioural) root=${root}\n` +
      `  ${passed.length}/${checks.length} facts confirmed by assembly\n`,
  )
  if (passed.length !== checks.length) {
    process.stderr.write('local specs prompt FAILED\n')
    return 1
  }
  process.stdout.write('local specs prompt ok\n')
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

// The exit-rule selftest runs before anything that needs credentials or a harness, and it
// EXECUTES the rule rather than describing it: three fixtures whose correct answers are known
// by hand — all pass, one fails, none recorded — are pushed through `probeExitCode`. Its own
// exit is non-zero when any of the three is mapped wrongly, so a mutation of the rule makes
// `node scripts/probe-dsh-api.mjs --selftest-exit` fail.
if (options.selftestExit) {
  const allPass = [{ pass: true }, { pass: true }]
  const oneFails = [{ pass: true }, { pass: false }]
  const noneRecorded = []
  const codes = [probeExitCode(allPass), probeExitCode(oneFails), probeExitCode(noneRecorded)]
  process.stdout.write(
    `probe-dsh-api: exit-rule selftest all-pass=${codes[0]} one-fails=${codes[1]} none-recorded=${codes[2]}\n`,
  )
  process.exit(codes[0] === 0 && codes[1] === 1 && codes[2] === 1 ? 0 : 1)
}

// The kit-rules prompt probe boots no harness and makes no model call, so it must
// run before the credential check that the booting probes need. It is a complete
// command in its own right: `node scripts/probe-dsh-api.mjs --kit-rules`.
if (options.globalSpecs) {
  process.exit(await runGlobalSpecsProbe())
}
if (options.localSpecs) {
  process.exit(await runLocalSpecsProbe())
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
const task = drillScenario !== null ? drillScenario.prompt : options.task
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
for (const tool of PROBE_TOOLS) {
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

// Every baseline probe tool must have been dispatched: the default task calls
// each one, and a drill scenario's own fact is asserted separately above. There
// is no optional probe row any more, so a missing baseline tool is always a
// finding rather than a mode's configuration.
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
  // produced a false "the dynamic layer is impossible" finding, which is why
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
// because a drill scenario issues its own prompt and may never call these two
// tools — reporting them as failures would blame the probe for its own
// configuration.
const badResult = observed.zzprobe_output_bad
if (drillScenario === null) {
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
  if (passed.length !== checks.length) {
    process.stdout.write('\n--- stderr tail ---\n')
    process.stdout.write(bundle.stderrTail)
    process.stdout.write('\n')
  }
}

process.exit(probeExitCode(checks))
