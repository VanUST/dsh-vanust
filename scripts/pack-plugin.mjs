/**
 * PURPOSE
 *   Pack any in-repo plugin directory into the shipping tarball the profile
 *   installs, bumping the version so the new bytes actually land.
 *
 *   Two facts make this a script rather than a manual sequence. pnpm resolves a
 *   `file:` dependency by path string, so repacking an UNCHANGED version serves the
 *   old bytes from the profile lockfile and the change silently ships nowhere — the
 *   kit's hard rule 6. And a tarball whose version was not bumped, or whose
 *   superseded sibling was left in `plugins/`, installs correctly only by accident of
 *   glob order. Both mistakes are mechanical, so both belong in a command.
 *
 * INPUTS
 *   --dir <path>     plugin directory relative to the kit root (required), e.g.
 *                    `plugins/ratchet`. Must contain a `package.json`.
 *   --dry-run        report what would happen and write nothing (default: pack)
 *   --version <v>    set an exact version instead of bumping the patch
 *   --no-bump        pack at the current version (only for a first pack; prints a
 *                    warning, because it is the failure mode this script exists to
 *                    prevent)
 *   Environment: `npm_execpath` when the caller is npm itself; otherwise the npm CLI
 *   is located from the running interpreter. Nothing else.
 *
 * OUTPUTS
 *   Writes `plugins/<tarball-prefix>-<version>.tgz` in the kit root, removing every
 *   other tarball for the same package so the profile's `plugins/*.tgz` glob resolves
 *   one file; updates the version in the source `package.json`; prints the new
 *   tarball's sha256 with the path. Exit 0 on success, 1 on refusal or a failed pack,
 *   2 on a usage error. Nothing is installed and no profile is touched.
 *
 * KEYWORDS
 *   packaging, tarball, version bump, pnpm file dependency, sha256, plugin
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Target tarball already exists at the chosen version: refused, because
 *     overwriting it is exactly the stale-bytes case. Use --version to move.
 *   - Source `package.json` missing or unparseable: refused with the path.
 *   - `npm pack` fails: its output is echoed and the exit code is 1; the source
 *     version is left as it was, so a failed pack cannot look like a bump.
 *   - --no-bump at the current version when that tarball already exists: refused for
 *     the same reason, so the flag cannot be used to defeat the check by accident.
 *   - The version-control state is NOT consulted. The pack runs over the source as it
 *     stands, so a tarball built from uncommitted edits is reproducible from whatever
 *     revision is committed afterwards and from nothing else. Refusing a dirty tree would
 *     block the ordinary flow this command exists for — edit, pack, then commit — so the
 *     absence of a VCS check is the design, not a gap.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT = resolve(HERE, '..')

/** Parses argv into options; an unknown flag or a missing --dir is a usage error. */
function parseArgs(argv) {
  const options = { dryRun: false, version: null, bump: true, dir: null }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--dry-run') options.dryRun = true
    else if (flag === '--no-bump') options.bump = false
    else if (flag === '--dir') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        process.stderr.write('pack-plugin: --dir needs a plugin directory\n')
        process.exit(2)
      }
      options.dir = value
      index += 1
    } else if (flag === '--version') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        process.stderr.write('pack-plugin: --version needs a version\n')
        process.exit(2)
      }
      options.version = value
      options.bump = false
      index += 1
    } else {
      process.stderr.write(`pack-plugin: unknown argument ${JSON.stringify(flag)}\n`)
      process.exit(2)
    }
  }
  if (options.dir === null) {
    process.stderr.write(
      'pack-plugin: --dir is required, e.g. `node scripts/pack-plugin.mjs --dir plugins/ratchet`\n',
    )
    process.exit(2)
  }
  return options
}

/**
 * Increments the patch component of a semver-ish version.
 *
 * @param version - Current version, e.g. `0.2.5`.
 * @returns The bumped version. A version that does not match `x.y.z` is returned
 *   unchanged, and the caller refuses rather than guessing: inventing a version for an
 *   unrecognised string would silently rename the package.
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

/**
 * The tarball filename prefix npm would give a package.
 *
 * npm names a packed scoped package by dropping the `@` and joining the scope and the
 * name with `-`: `@cc/dsh-ratchet` becomes `cc-dsh-ratchet`, which is why the prefix
 * cannot be read from the package name by a naive split on the last path segment.
 *
 * @param packageName - The manifest's `name` field.
 * @returns The filename prefix, without a version or extension.
 */
function tarballPrefix(packageName) {
  return packageName.replace(/^@/, '').replace(/\//g, '-')
}

/**
 * Resolves the npm CLI entry to a node-executable invocation.
 *
 * `execFileSync('npm', …)` fails with ENOENT on Windows, where npm is a `.cmd` shim
 * that `execFileSync` will not resolve. Spawning `node <npm-cli.js>` works on every
 * platform, needs no shell, and keeps the argument vector exact — which matters
 * because the pack destination is a path that may contain spaces.
 *
 * Both global layouts are checked: npm installed beside its interpreter sits in a
 * sibling `node_modules`, while a POSIX global install keeps it under
 * `<prefix>/lib/node_modules`.
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

const options = parseArgs(process.argv.slice(2))
const sourceDir = resolve(KIT, options.dir)
if (!sourceDir.startsWith(KIT)) {
  process.stderr.write(`pack-plugin: --dir must be inside the kit (${KIT})\n`)
  process.exit(2)
}
const manifestPath = join(sourceDir, 'package.json')
if (!existsSync(manifestPath)) {
  process.stderr.write(`pack-plugin: no package.json at ${manifestPath}\n`)
  process.exit(1)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  process.stderr.write(`pack-plugin: ${manifestPath} is not valid JSON: ${String(error)}\n`)
  process.exit(1)
}
if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
  process.stderr.write(`pack-plugin: ${manifestPath} declares no package name\n`)
  process.exit(1)
}

const prefix = tarballPrefix(manifest.name)
const current = String(manifest.version ?? '')
const target = options.version ?? (options.bump ? bumpPatch(current) : current)
const targetTarball = join(KIT, 'plugins', `${prefix}-${target}.tgz`)
if (existsSync(targetTarball) && options.dryRun !== true) {
  process.stderr.write(
    `pack-plugin: ${targetTarball} already exists. pnpm serves an unchanged FILENAME from the ` +
      'profile lockfile, so overwriting it means the new bytes never install. Choose a new version.\n',
  )
  process.exit(1)
}

if (options.dryRun) {
  process.stdout.write(
    `pack-plugin: dry run\n  source   ${sourceDir}\n  package  ${manifest.name}\n` +
      `  version  ${current} -> ${target}\n  tarball  ${targetTarball}\n  run without --dry-run to pack\n`,
  )
  process.exit(0)
}

// Bump the source version before packing, so the tarball's own manifest records the
// version its filename claims. A mismatch there is the kind of detail that makes an
// installed plugin unidentifiable later.
let bundleBackup = null
const clientBundlePath = join(sourceDir, 'client.js')
if (target !== current) {
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version: target }, null, 2)}\n`, 'utf8')
  // A hand-written browser bundle cannot read its own package.json, so it declares its
  // version in a constant. That is a second copy of the version and it drifts the moment
  // the packer bumps one and not the other — `test-adr-panel.mjs` exists because it did.
  // Rewriting the constant here keeps the copy equal to the manifest.
  if (existsSync(clientBundlePath)) {
    bundleBackup = readFileSync(clientBundlePath, 'utf8')
    const rewritten = bundleBackup.replace(/(\bPANEL_VERSION\s*=\s*")[^"]*(")/u, `$1${target}$2`)
    if (rewritten !== bundleBackup) writeFileSync(clientBundlePath, rewritten, 'utf8')
  }
}

let packOutput
try {
  const npm = resolveNpm()
  packOutput = execFileSync(npm.command, [...npm.prefixArgs, 'pack', '--pack-destination', join(KIT, 'plugins')], {
    cwd: sourceDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (error) {
  // Restore the version: a failed pack must not leave a bumped manifest behind, or the
  // next run bumps again and the package skips a version. The bundle constant is restored
  // with it, because a half-applied bump is worse than none.
  if (target !== current) {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    if (bundleBackup !== null) writeFileSync(clientBundlePath, bundleBackup, 'utf8')
  }
  process.stderr.write(`pack-plugin: npm pack failed:\n${String(error.stderr ?? error)}\n`)
  process.exit(1)
}

const packedName = packOutput.trim().split('\n').pop()?.trim() ?? ''
const packedPath = join(KIT, 'plugins', packedName)
if (!existsSync(packedPath)) {
  process.stderr.write(`pack-plugin: npm reported ${JSON.stringify(packedName)} but it is not there\n`)
  process.exit(1)
}

// Remove every OTHER tarball for this package. The profile installs `plugins/*.tgz`,
// so two versions present at once means the install depends on glob order — a
// difference nobody would think to look for. The prefix is taken from the packed
// filename so it always matches the name npm actually produced.
const packedPrefix = packedName.slice(0, -`-${target}.tgz`.length)
const removed = []
for (const entry of readdirSync(join(KIT, 'plugins'))) {
  if (!entry.startsWith(`${packedPrefix}-`) || !entry.endsWith('.tgz')) continue
  if (entry === packedName) continue
  unlinkSync(join(KIT, 'plugins', entry))
  removed.push(entry)
}

process.stdout.write(
  `pack-plugin: packed ${relative(KIT, sourceDir)} ${current} -> ${target}\n` +
    `  tarball ${packedPath}\n` +
    `  sha256  ${sha256(packedPath)}\n` +
    (removed.length > 0 ? `  removed ${removed.join(', ')}\n` : '') +
    '  next: reinstall the tarball into each profile, or run scripts/kit-update.mjs --apply\n',
)
