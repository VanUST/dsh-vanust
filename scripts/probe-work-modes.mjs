/**
 * PURPOSE
 *   Run the work-mode and delegation API measurements from a terminal, with no
 *   scratch DSH_HOME, no credentials and no model turn.
 *
 *   It is the thin half of `probes/api-probe/work-modes-probe.mjs`: it locates the
 *   installed harness, resolves the classes the probe measures through their own
 *   package entries, and reports one line per fact. The measurement itself lives in
 *   the probe module so the same code is reachable both from here and from the
 *   loader row a scratch profile mounts.
 *
 * INPUTS
 *   None. The harness install is located the way `scripts/probe-dsh-api.mjs`
 *   locates it: the probe junction first, then the profile stores, then the global
 *   `dsh` package — all derived from the environment, never configured.
 *
 * OUTPUTS
 *   One `[PASS]`/`[FAIL]` line per fact, a count, and `work modes probe ok` followed
 *   by exit 0 only when every fact held; the failures on stderr and exit 1
 *   otherwise. Exit 2 when no harness carrying the classes can be found, because "I
 *   could not look" is not "it is fine".
 *
 * KEYWORDS
 *   api facts, subagent lifecycle, tools guard, session mode, prompt section, probe
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No harness install: exit 2 naming the candidates searched.
 *   - A package whose entry cannot be resolved: reported as a failed fact with the
 *     loader's message, never as a pass.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Candidate `node_modules` directories holding the harness packages.
 *
 * @returns Absolute candidate paths, possibly non-existent.
 */
function candidateRoots() {
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
  try {
    for (const entry of readdirSync(join(home, 'profiles'), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules') roots.push(join(home, 'profiles', entry.name, 'node_modules'))
    }
  } catch {
    // No profiles directory: one candidate fewer, not a failure.
  }
  return roots
}

/**
 * Resolve a package's entry module through its own manifest.
 *
 * @param root - Absolute `node_modules` directory holding the package.
 * @param packageName - The package's name, e.g. `@deepseek-ai/cordis`.
 * @returns The entry module as a `file:` URL string.
 * @throws When the manifest cannot be read or names no entry.
 */
function packageEntry(root, packageName) {
  const directory = join(root, ...packageName.split('/'))
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const exported = manifest.exports?.['.'] ?? manifest.exports
  const entry = typeof exported === 'string' ? exported : (exported?.default ?? exported?.import ?? manifest.main ?? 'index.js')
  return pathToFileURL(join(directory, entry)).href
}

const CLASS_PACKAGES = [
  'cordis',
  'dsh-system-prompt',
  'dsh-scope',
  'dsh-subagent',
  'dsh-tools',
]

const carries = (root) =>
  CLASS_PACKAGES.every((name) => existsSync(join(root, '@deepseek-ai', name, 'package.json')))

const root = candidateRoots().find(carries) ?? null
if (root === null) {
  process.stderr.write(
    'probe-work-modes: no installed harness carries ' +
      `${CLASS_PACKAGES.map((name) => `@deepseek-ai/${name}`).join(', ')}.\n` +
      '  Run node scripts/dev-link.mjs once the harness is installed.\n',
  )
  process.exit(2)
}

let deps = null
let loadError = null
try {
  const [{ Context }, systemPrompt, scope, subagent, tools] = await Promise.all([
    import(packageEntry(root, '@deepseek-ai/cordis')),
    import(packageEntry(root, '@deepseek-ai/dsh-system-prompt')),
    import(packageEntry(root, '@deepseek-ai/dsh-scope')),
    import(packageEntry(root, '@deepseek-ai/dsh-subagent')),
    import(packageEntry(root, '@deepseek-ai/dsh-tools')),
  ])
  deps = {
    Context,
    SystemPrompt: systemPrompt.SystemPrompt,
    renderPrompt: systemPrompt.renderPrompt,
    createScope: scope.createScope,
    SubagentRuntime: subagent.SubagentRuntime,
    ToolRuntime: tools.ToolRuntime,
    tools,
  }
} catch (error) {
  loadError = String(error?.stack ?? error)
}

const probe = await import(pathToFileURL(join(KIT, 'probes', 'api-probe', 'work-modes-probe.mjs')).href)

if (loadError !== null) {
  process.stderr.write(`probe-work-modes: cannot load the harness classes: ${loadError}\n`)
  process.exit(1)
}

const { checks } = await probe.run(deps)
for (const entry of checks) {
  process.stdout.write(`  [${entry.pass ? 'PASS' : 'FAIL'}] ${entry.id}\n         ${entry.note}\n`)
}
const passed = checks.filter((entry) => entry.pass).length
process.stdout.write(`\nprobe-work-modes: ${passed}/${checks.length} facts confirmed by execution (harness root ${root})\n`)
if (passed !== checks.length || checks.length === 0) {
  process.stderr.write('work modes probe FAILED\n')
  process.exit(1)
}
process.stdout.write('work modes probe ok\n')
