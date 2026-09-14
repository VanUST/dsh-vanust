/**
 * PURPOSE
 *   Check the kit's shipped sources for the platform assumptions that would break
 *   on the Linux machines this kit is deployed to, and for the packaging mistakes
 *   that would make a plugin work from a checkout but fail once installed.
 *
 *   It also checks the plugin INVENTORY: `plugins/inventory.json` must agree with the
 *   tarballs on disk, each plugin's source directory and `SOURCE-NOTICE.md`, its
 *   packing entry point, its mounted profile row and its mention in `README.md`. The
 *   count is what drifted — the kit described itself as shipping one plugin, then
 *   three, while four tarballs were installed and four rows mounted — and a prose
 *   count that nothing checks is how a document stays confidently wrong.
 *
 *   The kit runs on 2x Linux and 1x Windows, but everything in it is authored on
 *   the Windows machine. That asymmetry is exactly how a `C:/` prefix or a
 *   backslash-splitting regex survives review: it works everywhere the author
 *   looks. These checks are mechanical because review is not.
 *
 *   The packaging checks matter for a second reason. An installed plugin resolves
 *   its imports through the profile it lands in and only receives the files
 *   `package.json` `files` lists — so a module that exists in the checkout and is
 *   absent from that list produces a plugin that boots in development and fails in
 *   production, which is the worst possible ordering.
 *
 * INPUTS
 *   None. The kit root is derived from this script's location; every file it
 *   examines is committed source, not generated output.
 *
 * OUTPUTS
 *   One line per check on stdout (`PASS`/`FAIL` with the offending file and line),
 *   a count, and exit 0 when everything passes or 1 when any check fails. Nothing
 *   is written and no process is spawned.
 *
 * KEYWORDS
 *   portability, linux, windows, path separators, packaging, files list, cross-platform
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A source directory that does not exist is reported as a failure rather than
 *     skipped: a check with nothing to read is not a passing check.
 *   - A `package.json` that cannot be parsed is reported with its path.
 *   - A line is reported once even when several patterns match it, so the output
 *     stays readable as the codebase grows.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * One check: what it looks for, why it matters, and where it may look.
 *
 * `paths` are kit-relative. `allow` lists kit-relative files exempt from the
 * pattern, and each exemption carries its justification in `allowReason` — an
 * unexplained exemption is how a rule quietly stops applying.
 */
const CHECKS = [
  {
    id: 'no-absolute-windows-paths',
    pattern: /["'`][A-Za-z]:[\\/]/,
    why: 'an absolute Windows path in shipped source cannot resolve on Linux',
    paths: ['plugins/ratchet', 'plugins/dsh-context', 'scripts/probe-dsh-api.mjs', 'probes'],
    allow: [],
  },
  {
    id: 'no-backslash-path-splitting',
    pattern: /\.replace\(\/\\\\\/g,\s*['"]\/['"]\)/,
    why: 'splitting on a backslash is a no-op on Linux and hides a real separator assumption',
    paths: ['plugins/ratchet', 'scripts/probe-dsh-api.mjs', 'probes'],
    allow: [],
  },
  {
    id: 'no-windows-only-env-vars',
    pattern: /process\.env\.(APPDATA|USERPROFILE|LOCALAPPDATA|ProgramFiles)/,
    why: 'these are unset on Linux, so any use must be one candidate among several',
    paths: ['plugins/ratchet'],
    allow: [],
  },
  {
    id: 'no-shell-dependent-spawns',
    // A spawn whose FIRST argument is a bare binary name. A prose mention of the
    // pattern inside a comment is not a defect, which is why this requires the
    // call to start at a statement and the string to be the first argument.
    pattern: /^\s*(?:const|let|var|[A-Za-z_$][\w$]*\s*=)?\s*[^/*]*execFileSync\(\s*['"](npm|pnpm|bash|sh|git)['"]/,
    why: 'a bare binary name is not resolvable by execFileSync; resolve the CLI entry instead',
    paths: ['plugins/ratchet', 'scripts'],
    // Exempt because this checker's own `git check-attr` call is a deliberate
    // exception: git is a prerequisite for having a checkout at all, so it cannot
    // be "unavailable on Linux" the way npm is unresolvable on Windows.
    allow: ['scripts/check-portability.mjs'],
    allowReason: 'git is required to have a checkout; unlike npm it is on PATH everywhere the kit runs',
  },
  {
    id: 'no-crlf-in-sources',
    pattern: /\r/,
    why: 'a CRLF in a shipped .mjs or .sh breaks a POSIX shebang and dirties every diff',
    // `scripts` and `probes` are included because they are shipped source too: an
    // untracked file written by a Windows editing pass keeps its CRLF in the working
    // tree, and while it stayed out of this rule a 4,800-line CRLF test file passed
    // every check. The root shell entry points are here for the same reason — a CRLF
    // `install.sh` is a script that does not start on Linux, and the git-attribute check
    // below cannot see the working-tree bytes. `.tgz` and other binaries are skipped by
    // the extension filter, and the `.ps1` files are CRLF by policy.
    paths: ['plugins', 'scripts', 'probes', 'install.sh', 'start.sh'],
    allow: [],
    raw: true,
  },
]

/**
 * Additional `.sh` files, whose line endings matter most and whose working tree
 * differs by design depending on the platform the kit was checked out on.
 *
 * This kit is authored on Windows, where `core.autocrlf=true` leaves CRLF in the
 * working tree for files git normalises to LF in the repository. `git check-attr`
 * is what decides whether that is a defect: a file the repository stores with LF is
 * correct on disk at either setting, because git restores it on the way in. Only a
 * file with NO eol attribute is at the mercy of the checkout, and a `.sh` file in
 * that state is a shebang that fails on Linux — so the check asks git rather than
 * guessing from the bytes.
 */
const SHELL_SCRIPTS = ['scripts/verify-upgrade.sh', 'scripts/rebuild-plugins.sh', 'install.sh', 'start.sh']

/** Every file under a kit-relative path, recursively, excluding node_modules. */
function filesUnder(target) {
  const absolute = join(KIT, target)
  if (!existsSync(absolute)) return null
  const stats = statSync(absolute)
  if (stats.isFile()) return [target.replace(/\\/g, '/')]
  const found = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const full = join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) found.push(relative(KIT, full).replace(/\\/g, '/'))
    }
  }
  walk(absolute)
  return found
}

const results = []

/**
 * Records one check's outcome.
 *
 * @param id - Check identifier.
 * @param pass - Whether it passed.
 * @param note - Human-readable detail; must name the offender when it failed.
 */
function check(id, pass, note) {
  results.push({ id, pass, note })
}

// ── source scans ───────────────────────────────────────────────────────────
for (const spec of CHECKS) {
  const offenders = []
  let examined = 0
  for (const target of spec.paths) {
    const files = filesUnder(target)
    if (files === null) {
      offenders.push(`${target}: does not exist`)
      continue
    }
    for (const file of files) {
      if (!/\.(mjs|js|sh)$/.test(file)) continue
      if (spec.allow.includes(file)) continue
      examined += 1
      let text
      try {
        text = readFileSync(join(KIT, file), 'utf8')
      } catch (error) {
        offenders.push(`${file}: unreadable (${String(error)})`)
        continue
      }
      if (spec.raw === true) {
        if (text.includes('\r')) offenders.push(`${file}: contains CR`)
        continue
      }
      const lines = text.split('\n')
      const seen = new Set()
      for (const [index, line] of lines.entries()) {
        if (!spec.pattern.test(line)) continue
        if (seen.has(index)) continue
        seen.add(index)
        offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 100)}`)
      }
    }
  }
  check(
    spec.id,
    offenders.length === 0,
    offenders.length === 0 ? `${examined} file(s) examined — ${spec.why}` : offenders.slice(0, 6).join(' | '),
  )
}

// ── line endings: ask git, do not guess from the working tree ─────────────
{
  const offenders = []
  for (const script of SHELL_SCRIPTS) {
    if (!existsSync(join(KIT, script))) {
      offenders.push(`${script}: does not exist`)
      continue
    }
    let attributes = ''
    try {
      attributes = execFileSync('git', ['check-attr', 'eol', '--', script], {
        cwd: KIT,
        encoding: 'utf8',
      })
    } catch (error) {
      offenders.push(`${script}: git check-attr failed (${String(error).slice(0, 80)})`)
      continue
    }
    // `git check-attr` prints `<path>: eol: <value>`, where `unspecified` means the
    // repository stores whatever the working tree had — the state that lets a
    // Windows checkout hand a CRLF shebang to a Linux machine.
    if (!attributes.includes(': eol: lf')) {
      offenders.push(`${script}: eol is not pinned to lf (${attributes.trim()})`)
    }
  }
  check(
    'shell-scripts-pinned-to-lf',
    offenders.length === 0,
    offenders.length === 0
      ? `${SHELL_SCRIPTS.length} script(s) pinned to LF in the repository`
      : offenders.join(' | '),
  )
}

// ── packaging: every module a plugin ships must be in its files list ───────
for (const dir of ['plugins/ratchet', 'plugins/dsh-context']) {
  const manifestPath = join(KIT, dir, 'package.json')
  if (!existsSync(manifestPath)) {
    check(`files-list:${dir}`, false, `${manifestPath} does not exist`)
    continue
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    check(`files-list:${dir}`, false, `${manifestPath} is not valid JSON: ${String(error)}`)
    continue
  }
  const listed = new Set(manifest.files ?? [])
  const missing = []
  const entries = readdirSync(join(KIT, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(mjs|d\.mts)$/.test(name))
  for (const name of entries) if (!listed.has(name)) missing.push(name)

  // The entry point must be listed even if it matches no extension rule above.
  const entry = manifest.main
  if (typeof entry === 'string' && !listed.has(entry)) missing.push(`${entry} (main)`)

  check(
    `files-list:${dir}`,
    missing.length === 0,
    missing.length === 0
      ? `${entries.length} module(s) all listed`
      : `present but NOT in files (an installed copy would lack them): ${missing.join(', ')}`,
  )
}

// ── every .mjs a plugin contains must be listed in its files array ────────
for (const dir of ['plugins/ratchet', 'plugins/dsh-context', 'plugins/kit-rules']) {
  const manifestPath = join(KIT, dir, 'package.json')
  if (!existsSync(manifestPath)) continue
  let listed
  try {
    listed = new Set(JSON.parse(readFileSync(manifestPath, 'utf8')).files ?? [])
  } catch {
    continue
  }
  const unlisted = readdirSync(join(KIT, dir))
    .filter((name) => name.endsWith('.mjs'))
    .filter((name) => !listed.has(name))
  check(
    `files-complete:${dir}`,
    unlisted.length === 0,
    unlisted.length === 0
      ? 'every module is listed'
      : `module(s) present but not shipped: ${unlisted.join(', ')}`,
  )
}

// ── every tool parameter schema must be object-rooted for the provider ────
{
  const source = readFileSync(join(KIT, 'plugins/ratchet/ratchet-tools.mjs'), 'utf8')
  const bareParameters = /parameters:\s*\{\s*type:/.test(source)
  const defineToolUses = (source.match(/defineTool\(/g) ?? []).length
  const toolNames = (source.match(/name:\s*`?\$\{PREFIX\}|name:\s*'ratchet_/g) ?? []).length
  check(
    'tools:use-defineTool',
    !bareParameters && defineToolUses > 0,
    bareParameters
      ? 'a tool declares a raw parameters schema; the registry validates it as RAW JSON Schema and the provider rejects a root without `type`'
      : `${defineToolUses} defineTool declaration(s) among ${toolNames} tool name(s)`,
  )
}

// ── the CLI must be runnable as a file on both platforms ──────────────────
{
  const cli = join(KIT, 'plugins/ratchet/ratchet-cli.mjs')
  const source = readFileSync(cli, 'utf8')
  const usesFileUrl = source.includes('fileURLToPath(import.meta.url)')
  const suffixMatch = /endsWith\(\s*['"]\/[a-z-]+\.mjs['"]\s*\)/.test(source)
  check(
    'cli:platform-independent-entry-detection',
    usesFileUrl && !suffixMatch,
    usesFileUrl && !suffixMatch
      ? 'entry detection compares resolved paths, so it behaves the same on either separator'
      : 'entry detection relies on a string suffix; use fileURLToPath(import.meta.url) instead',
  )
}

// ── the plugin inventory: one row per shipped plugin, checked against disk ──
// The count is the point. Three documents once described this kit as shipping one
// plugin and another as shipping three, while four tarballs were installed and four
// rows mounted; every one of those sentences was true when written and none was
// checked. This is what makes the inventory a claim rather than a comment: a row, a
// tarball, a source directory, a packing entry point, a mounted profile row and a
// README mention must all agree.
{
  const inventoryPath = join(KIT, 'plugins', 'inventory.json')
  let inventory = null
  try {
    inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
  } catch (error) {
    check('inventory:readable', false, `${inventoryPath} is not readable JSON: ${String(error)}`)
  }
  if (inventory !== null) {
    const rows = Array.isArray(inventory.plugins) ? inventory.plugins : []
    const problems = []
    const claimed = new Set()
    const PROVENANCE = new Set(['in-repo', 'reconstruction', 'snapshot'])
    const pluginDir = join(KIT, 'plugins')
    const patch = readFileSync(join(KIT, 'profile', 'cordis.patch.yml'), 'utf8')
    const readme = readFileSync(join(KIT, 'README.md'), 'utf8')
    for (const row of rows) {
      const id = row.id ?? '(unnamed row)'
      if (typeof row.package !== 'string' || row.package.length === 0) problems.push(`${id}: declares no package name`)
      if (!PROVENANCE.has(row.provenance)) {
        problems.push(`${id}: provenance ${JSON.stringify(row.provenance)} is not one of ${[...PROVENANCE].join(', ')}`)
      }
      if (typeof row.source !== 'string' || !existsSync(join(KIT, row.source))) {
        problems.push(`${id}: source ${JSON.stringify(row.source)} does not exist`)
      } else if (!existsSync(join(KIT, row.source, 'package.json'))) {
        problems.push(`${id}: source ${row.source} has no package.json`)
      }
      // A reconstructed or snapshot source is not this repository's own tree, so it
      // must carry the notice that says where it came from.
      if ((row.provenance === 'reconstruction' || row.provenance === 'snapshot') &&
        (typeof row.notice !== 'string' || !existsSync(join(KIT, row.notice)))) {
        problems.push(`${id}: a ${row.provenance} source has no SOURCE-NOTICE.md`)
      }
      if (typeof row.pack !== 'string' || !existsSync(join(KIT, row.pack))) {
        problems.push(`${id}: packing entry point ${JSON.stringify(row.pack)} does not exist`)
      }
      const versions = readdirSync(pluginDir).filter(
        (name) => name.startsWith(`${row.tarballPrefix}-`) && name.endsWith('.tgz'),
      )
      if (versions.length !== 1) {
        problems.push(
          `${id}: expected exactly one plugins/${row.tarballPrefix}-*.tgz, found ${versions.length}` +
            (versions.length > 0 ? ` (${versions.join(', ')})` : ''),
        )
      }
      for (const version of versions) claimed.add(version)
      if (row.mounted === true && !patch.includes(`id: ${id}`)) {
        problems.push(`${id}: declared mounted but profile/cordis.patch.yml has no \`id: ${id}\` row`)
      }
      if (typeof row.package === 'string' && !readme.includes(row.package)) {
        problems.push(`${id}: ${row.package} is not named in README.md`)
      }
    }
    const unclaimed = readdirSync(pluginDir)
      .filter((name) => name.endsWith('.tgz'))
      .filter((name) => !claimed.has(name))
    if (unclaimed.length > 0) problems.push(`tarball(s) no inventory row claims: ${unclaimed.join(', ')}`)
    check(
      'inventory:matches-disk',
      problems.length === 0,
      problems.length === 0
        ? `${rows.length} plugin row(s) agree with the tarballs, sources, packing entry points, profile rows and README`
        : problems.join(' | '),
    )
  }
}

// ── report ─────────────────────────────────────────────────────────────────
const failed = results.filter((entry) => !entry.pass)
for (const entry of results) {
  process.stdout.write(`  [${entry.pass ? 'PASS' : 'FAIL'}] ${entry.id}\n`)
  if (!entry.pass) process.stdout.write(`         ${entry.note}\n`)
}
process.stdout.write(`\n  ${results.length - failed.length}/${results.length} portability and packaging checks passed\n`)
process.exit(failed.length === 0 ? 0 : 1)
