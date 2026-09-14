/**
 * PURPOSE
 *   Pack `plugins/dsh-context/` into the shipping tarball the profile installs,
 *   bumping the version so the new bytes actually land.
 *
 *   Two facts make this script necessary rather than convenient. pnpm resolves a
 *   `file:` dependency by path string, so repacking an UNCHANGED version serves
 *   the old bytes from the profile lockfile and the change silently ships
 *   nowhere — the kit's hard rule 6. And the owned package has no reachable build
 *   tree, so this packer IS the build step; leaving it as a manual sequence of
 *   commands is how "repack and bump" becomes "forgot to repack".
 *
 *   The script refuses to run when the working tree is dirty in a way that would
 *   make the tarball unreproducible from what is committed, because a tarball
 *   whose contents cannot be traced to a revision is one nobody can audit.
 *
 * INPUTS
 *   --dry-run        report what would happen and write nothing (default: pack)
 *   --version <v>    set an exact version instead of bumping the patch
 *   --no-bump        pack at the current version (only for a first pack; prints a
 *                    warning, because it is the failure mode this script exists
 *                    to prevent)
 *   Environment: none. The source directory is fixed relative to this script.
 *
 * OUTPUTS
 *   Writes `plugins/cc-dsh-context-<version>.tgz` in the kit root (removing the
 *   previous tarball for that package, so the profile's glob resolves one file),
 *   updates the version in the source `package.json`, and prints the new
 *   tarball's sha256 with the path. Exit 0 on success, 1 on refusal, 2 on a usage
 *   error. Nothing is installed and no profile is touched.
 *
 * KEYWORDS
 *   packaging, tarball, version bump, dsh-context, pnpm file dependency, sha256
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Target tarball already exists at the chosen version: refused, because
 *     overwriting it is exactly the stale-bytes case. Use --version to move.
 *   - Source `package.json` missing or unparseable: refused with the path.
 *   - `npm pack` fails: its output is echoed and the exit code is 1; the source
 *     version is left as it was, so a failed pack cannot look like a bump.
 *   - --no-bump at the current version when that tarball already exists: refused
 *     for the same reason, so the flag cannot be used to defeat the check by
 *     accident.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT = resolve(HERE, '..')
const SOURCE_DIR = join(KIT, 'plugins', 'dsh-context')
const PACKAGE_NAME = 'cc-dsh-context'

/** Parses argv into options; an unknown flag is a usage error. */
function parseArgs(argv) {
  const options = { dryRun: false, version: null, bump: true }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--dry-run') options.dryRun = true
    else if (flag === '--no-bump') options.bump = false
    else if (flag === '--version') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        process.stderr.write('pack-dsh-context: --version needs a version\n')
        process.exit(2)
      }
      options.version = value
      options.bump = false
      index += 1
    } else {
      process.stderr.write(`pack-dsh-context: unknown argument ${JSON.stringify(flag)}\n`)
      process.exit(2)
    }
  }
  return options
}

/**
 * Increments the patch component of a semver-ish version.
 *
 * @param version - Current version, e.g. `0.1.2`.
 * @returns The bumped version. A version that does not match `x.y.z` is returned
 *   unchanged, and the caller refuses rather than guessing: inventing a version
 *   for an unrecognised string would silently rename the package.
 */
function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(version)
  if (match === null) return version
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}${match[4] ?? ''}`
}

/**
 * Computes a file's sha256.
 *
 * @param path - Absolute path.
 * @returns Lowercase hex digest.
 */
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

const options = parseArgs(process.argv.slice(2))
const manifestPath = join(SOURCE_DIR, 'package.json')
if (!existsSync(manifestPath)) {
  process.stderr.write(`pack-dsh-context: no package.json at ${manifestPath}\n`)
  process.exit(1)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  process.stderr.write(`pack-dsh-context: ${manifestPath} is not valid JSON: ${String(error)}\n`)
  process.exit(1)
}

/**
 * Resolves the npm CLI entry to a node-executable invocation.
 *
 * `execFileSync('npm', …)` fails with ENOENT on Windows, where npm is a `.cmd`
 * shim that `execFileSync` will not resolve. Spawning `node <npm-cli.js>` works on
 * every platform, needs no shell, and keeps the argument vector exact — which
 * matters because the pack destination is a path that may contain spaces.
 *
 * @returns `{ command, prefixArgs }` for `execFileSync`.
 */
function resolveNpm() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)
  const cli = candidates.find((candidate) => existsSync(candidate))
  if (cli === undefined) {
    throw new Error(
      `cannot locate the npm CLI; looked at ${candidates.map((entry) => JSON.stringify(entry)).join(', ')}`,
    )
  }
  return { command: process.execPath, prefixArgs: [cli] }
}

const current = String(manifest.version ?? '')
const target = options.version ?? (options.bump ? bumpPatch(current) : current)
const targetTarball = join(KIT, 'plugins', `${PACKAGE_NAME}-${target}.tgz`)
if (existsSync(targetTarball) && options.dryRun !== true) {
  process.stderr.write(
    `pack-dsh-context: ${targetTarball} already exists. pnpm serves an unchanged FILENAME from the ` +
      'profile lockfile, so overwriting it means the new bytes never install. Choose a new version.\n',
  )
  process.exit(1)
}

if (options.dryRun) {
  process.stdout.write(
    `pack-dsh-context: dry run\n  source   ${SOURCE_DIR}\n  version  ${current} -> ${target}\n` +
      `  tarball  ${targetTarball}\n  run without --dry-run to pack\n`,
  )
  process.exit(0)
}

// Bump the source version before packing, so the tarball's own manifest records
// the version its filename claims. A mismatch there is the kind of detail that
// makes an installed plugin unidentifiable later.
if (target !== current) {
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version: target }, null, 2)}\n`, 'utf8')
}

let packOutput
try {
  const npm = resolveNpm()
  packOutput = execFileSync(npm.command, [...npm.prefixArgs, 'pack', '--pack-destination', join(KIT, 'plugins')], {
    cwd: SOURCE_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (error) {
  // Restore the version: a failed pack must not leave a bumped manifest behind,
  // or the next run bumps again and the package skips a version.
  if (target !== current) {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }
  process.stderr.write(`pack-dsh-context: npm pack failed:\n${String(error.stderr ?? error)}\n`)
  process.exit(1)
}

const packedName = packOutput.trim().split('\n').pop()?.trim() ?? ''
const packedPath = join(KIT, 'plugins', packedName)
if (!existsSync(packedPath)) {
  process.stderr.write(`pack-dsh-context: npm reported ${JSON.stringify(packedName)} but it is not there\n`)
  process.exit(1)
}

// Remove every OTHER tarball for this package. The profile installs
// `plugins/*.tgz`, so two versions present at once means the install depends on
// glob order — a difference nobody would think to look for.
const removed = []
for (const entry of readdirSync(join(KIT, 'plugins'))) {
  if (!entry.startsWith(`${PACKAGE_NAME}-`) || !entry.endsWith('.tgz')) continue
  if (entry === packedName) continue
  unlinkSync(join(KIT, 'plugins', entry))
  removed.push(entry)
}

process.stdout.write(
  `pack-dsh-context: packed ${current} -> ${target}\n` +
    `  tarball ${packedPath}\n` +
    `  sha256  ${sha256(packedPath)}\n` +
    (removed.length > 0 ? `  removed ${removed.join(', ')}\n` : '') +
    '  next: reinstall the tarball into each profile, or run scripts/kit-update.mjs --apply\n',
)

