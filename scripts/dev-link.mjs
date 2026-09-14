/**
 * PURPOSE
 *   Link the harness packages a development checkout resolves against, so the kit's own
 *   tests and probes run from a fresh `git clone`.
 *
 *   `plugins/ratchet/ratchet-tools.mjs` imports `@deepseek-ai/dsh-tools`, and the probe
 *   plugin imports it too. Those packages belong to the harness, not to this repository
 *   — a clone has no `node_modules` beside them, and the suite that the kit's gate runs
 *   died with a raw `ERR_MODULE_NOT_FOUND` from a directory git deliberately ignores.
 *   The deployment does not need this link (an installed plugin resolves its peers
 *   through the profile it is installed into); the kit's OWN gate does, because it runs
 *   the suite from the checkout.
 *
 * INPUTS
 *   `--check`  report only, write nothing (exit 1 when a link is missing).
 *   `--quiet`  print nothing but the failures and the final line.
 *   None otherwise. The harness install is located from `$DSH_HOME/profiles/*` first and
 *   the global `dsh` package second, both derived from the environment rather than
 *   configured.
 *
 * OUTPUTS
 *   One line per link, then `dev links ok` and exit 0; the failures and the command that
 *   fixes them on stderr, exit 1, otherwise. A caller that greps for the marker cannot
 *   mistake a partial run for a pass.
 *
 * KEYWORDS
 *   development setup, node_modules link, junction, symlink, peer packages, clone, gate
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Nothing is ever deleted or overwritten: a real directory in the link's place is
 *     reported and left alone, because it may be a deliberate install.
 *   - A missing harness is reported as the install step it is (`install.sh`, or the
 *     pinned `npm i -g`), never as a link failure — the reader cannot fix the second
 *     without doing the first.
 *   - Re-running is a no-op: an existing link that already resolves is left untouched, so
 *     mtimes do not churn and the command is safe in a setup script.
 *   - Creating a symlink on Windows needs no elevation for a junction, which is the type
 *     used there; a POSIX directory symlink is used everywhere else.
 */
import { existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK_ONLY = process.argv.includes('--check')
const QUIET = process.argv.includes('--quiet')

/** Development directories whose modules resolve harness packages by bare name. */
const LINK_SITES = ['plugins/ratchet', 'probes/api-probe']

/** Packages a link must make resolvable for the site that needs it. */
const REQUIRED = ['dsh-tools']

const say = (line) => {
  if (!QUIET) process.stdout.write(`${line}\n`)
}

/** Reports whether a directory holds the packages this script links. */
function hasPackages(root) {
  return (
    typeof root === 'string' &&
    root.length > 0 &&
    existsSync(join(root, '@deepseek-ai', 'dsh-tools', 'package.json'))
  )
}

/**
 * Candidate `node_modules` directories that may hold the harness packages.
 *
 * Ordered by how close they are to what a deployment actually installs: the profile's
 * own store first (the harness is installed there), then the global `dsh` package
 * (where the harness carries its dependencies), then the platform's global root.
 *
 * @returns Absolute candidate paths, possibly non-existent. Never throws.
 */
function candidateRoots() {
  const roots = []
  const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
  const profiles = join(home, 'profiles')
  try {
    for (const entry of readdirSync(profiles, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(join(profiles, entry.name, 'node_modules'))
    }
  } catch {
    // No profiles directory: the harness has not been installed yet, which the caller
    // reports as the install step rather than as a link failure.
  }
  const globalRoots = [
    process.env.APPDATA === undefined ? null : join(process.env.APPDATA, 'npm', 'node_modules'),
    join(dirname(process.execPath), 'node_modules'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules'),
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
  ].filter((entry) => typeof entry === 'string')
  for (const root of globalRoots) {
    roots.push(join(root, '@deepseek-ai', 'dsh', 'node_modules'))
    roots.push(root)
  }
  return roots
}

const source = candidateRoots().find((root) => hasPackages(root)) ?? null

if (source === null) {
  process.stderr.write(
    'dev links FAILED: no installed harness carries @deepseek-ai/dsh-tools.\n' +
      '  Install it first — ./install.sh (or install.ps1), or the pinned global install:\n' +
      '    npm i -g @deepseek-ai/dsh@0.1.5-rc.1\n',
  )
  process.exit(1)
}

say(`  source: ${source}`)
const failures = []
for (const site of LINK_SITES) {
  const link = join(KIT, site, 'node_modules')
  const linkPath = `${site}/node_modules`
  if (hasPackages(link)) {
    say(`  [PRESENT] ${linkPath}`)
    continue
  }
  if (existsSync(link)) {
    // A real directory that does not carry the packages. Removing it could destroy a
    // deliberate local install, so it is reported and the reader decides.
    failures.push(`${linkPath} exists but does not provide ${REQUIRED.join(', ')}`)
    continue
  }
  if (CHECK_ONLY) {
    failures.push(`${linkPath} is missing (run: node scripts/dev-link.mjs)`)
    continue
  }
  try {
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(source, link, process.platform === 'win32' ? 'junction' : 'dir')
    say(`  [LINKED]  ${linkPath} -> ${source}`)
  } catch (error) {
    failures.push(`${linkPath} could not be linked: ${String(error)}`)
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `dev links FAILED\n${failures.map((entry) => `  - ${entry}`).join('\n')}\n`,
  )
  process.exit(1)
}
process.stdout.write('dev links ok\n')
