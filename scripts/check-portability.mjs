/**
 * PURPOSE
 *   Check the kit's shipped sources for the platform assumptions that would break
 *   on the Linux machines this kit is deployed to, and for the packaging mistakes
 *   that would make a plugin work from a checkout but fail once installed.
 *
 *   It also checks the plugin INVENTORY: `plugins/inventory.json` must agree with the
 *   tarballs on disk, each plugin's source directory and `SOURCE-NOTICE.md`, its
 *   packing entry point, its mounted profile row and its mention in `README.md`, and a
 *   snapshot's declared entry point must exist so the package is complete, not a shell.
 *   The count is what drifted — the kit described itself as shipping one plugin, then
 *   three, while four tarballs were installed and four rows mounted — and a prose
 *   count that nothing checks is how a document stays confidently wrong.
 *
 *   Finally it checks that each tarball still AGREES WITH ITS SOURCE. A repacked
 *   tarball keeps its filename, and a stale one installs the same old bytes into every
 *   profile while the checkout shows the new code — so an installed copy and the tree a
 *   reviewer reads can disagree with nothing failing. Every packed file must exist in
 *   the source directory and, except for `package.json`, be byte-identical to it.
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
 *   - A tarball that cannot be read or parsed is reported as its own finding, never as
 *     an empty comparison that passes.
 *   - A line is reported once even when several patterns match it, so the output
 *     stays readable as the codebase grows.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

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
    id: 'no-raw-path-in-dynamic-import',
    pattern: /\bimport\(\s*(?:[A-Za-z_$][\w$]*\s*\)|['"][A-Za-z]:[\\/]|['"]\/)/,
    why: 'a dynamic import takes a URL: a filesystem path is read as a scheme and rejected on Windows (ERR_UNSUPPORTED_ESM_URL_SCHEME), so wrap it in pathToFileURL(...).href',
    // Every shipped and tooling root, because the failure this caught lived in a
    // verification script: a dynamic import of a bare path variable holding a `C:\…` path
    // made the panel render check crash on Windows while passing on the platform it was
    // written on.
    paths: ['plugins', 'scripts', 'probes'],
    allow: [],
  },
  {
    id: 'no-url-pathname-as-path',
    // `.pathname` on a Windows file URL is `/C:/…`, which `path.join` cannot walk up from:
    // the derived root addresses nothing and every check over it passes over an empty tree.
    // The pattern requires the match to begin a non-comment line — a leading `//` or `*`
    // makes it a comment, and the three places that DOCUMENT this hazard are comments.
    pattern: /^(?:(?!\/\/|\*)[\s\S])*?\.pathname\b/,
    why: 'a filesystem path derived from a file URL\'s pathname property is `/C:/…` on Windows, so use fileURLToPath(new URL(...)); the kit has read an empty tree this way four times',
    paths: ['plugins', 'scripts', 'probes'],
    // The one legitimate use: this value is the `url` of a synthetic HTTP request, never a
    // filesystem path. Anything else that property is used for reaches `fileURLToPath`.
    allow: ['probes/api-probe/panel-consent-probe.mjs'],
    allowReason:
      'the pathname property here builds the url of a fake Node HTTP request (an HTTP path, not a filesystem path), which is the only thing that value is ever used for',
  },
  {
    id: 'no-hand-built-file-url',
    // A dynamic import takes a URL, and the kit used to build one by hand:
    // `file:///${PLUGIN.replace(/\\/g, '/')}/x.mjs` — three literal slashes plus an absolute
    // path, whose leading separator makes FOUR on POSIX. `new URL('file:////home/x/y.mjs')`
    // has the pathname `//home/x/y.mjs` (measured), which Linux tolerates rather than
    // intends, and the shape was only ever executed on Windows. `pathToFileURL(p).href` is
    // the API whose contract covers both platforms, so the hand-built form is banned.
    pattern: /file:\/\//,
    why: 'a hand-built file URL is a path idiom that has to hold on both platforms at once; use pathToFileURL(...).href, whose Windows and POSIX behaviour is the API contract rather than a reasoned guess',
    paths: ['plugins', 'scripts', 'probes'],
    // Two exemptions, each with its reason rather than a pattern that quietly stopped
    // matching: one is prose in a comment, the other is the check that OWNS this rule.
    allow: ['plugins/dsh-adr-panel/client.js', 'scripts/check-portability.mjs'],
    allowReason:
      'client.js mentions `file://` only inside a comment about the origin a browser reports for a bundle loaded that way; check-portability.mjs must be able to name and execute the platform-API round trip it requires of every other file',
  },
  {
    id: 'no-shell-dependent-spawns',
    // A spawn whose FIRST argument is a bare binary name. A prose mention of the
    // pattern inside a comment is not a defect, which is why this requires the
    // call to start at a statement and the string to be the first argument.
    pattern: /^\s*(?:const|let|var|[A-Za-z_$][\w$]*\s*=)?\s*[^/*]*execFileSync\(\s*['"](npm|pnpm|bash|sh|git)['"]/,
    why: 'a bare binary name is not resolvable by execFileSync; resolve the CLI entry instead',
    paths: ['plugins/ratchet', 'scripts'],
    // Exempt because these two spawns are deliberate: git is a prerequisite for having a checkout
    // at all, so it cannot be "unavailable on Linux" the way npm is unresolvable on Windows.
    allow: ['scripts/check-portability.mjs', 'scripts/check-zone-coverage.mjs'],
    allowReason:
      'git is required to have a checkout, and check-zone-coverage.mjs reads the tracked set from it; unlike npm it is on PATH everywhere the kit runs, and without it that command exits UNUSABLE rather than reporting a pass',
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

/**
 * PURPOSE
 *   Enumerate every shipped plugin's own source files, so a rule about what a
 *   shipped plugin may register is checked over the whole suite instead of over
 *   one path somebody remembered to edit.
 *
 * INPUTS
 *   None. The plugin roots are discovered by listing `plugins/` on disk; no
 *   plugin or module path is hard-coded.
 *
 * OUTPUTS
 *   Sorted kit-relative paths of every `.mjs`, `.js` and `.cjs` file under a
 *   `plugins/<name>/` directory, excluding `node_modules` and build/packed-output
 *   directories. Returns `null` when `plugins/` cannot be listed, so the caller
 *   reports "I could not look" rather than an empty list that passes.
 *
 * KEYWORDS
 *   plugins, discovery, shipped source, tool registration, build artefacts
 */
const BUILD_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'out', 'coverage'])
function shippedPluginSourceFiles() {
  const root = join(KIT, 'plugins')
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  const found = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (BUILD_DIRECTORIES.has(entry.name)) continue
      const full = join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && /\.(mjs|cjs|js)$/.test(entry.name)) {
        found.push(relative(KIT, full).replace(/\\/g, '/'))
      }
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (BUILD_DIRECTORIES.has(entry.name)) continue
    walk(join(root, entry.name))
  }
  return found.sort()
}

/**
 * Read the regular-file entries of a gzipped tar as a `name -> bytes` map.
 *
 * A tarball is read in pure Node rather than by spawning `tar`: this module is the
 * one that forbids a bare-binary spawn, and Windows ships `tar.exe` only from build
 * 17063 while the archive format here is a fixed ustar layout.
 *
 * The reader is deliberately partial. It returns null — never a partial map — when
 * the archive cannot be parsed, so a caller reports an unreadable tarball instead of
 * treating "no entries compared" as agreement. Directory entries, GNU long names
 * (type `L`) and PAX extended headers (type `x`) are skipped; their bodies are still
 * sized correctly, so a later entry is not misread. A PAX `path=` override is not
 * applied, which would surface as a packed file missing from the source tree — a
 * loud failure rather than a silent pass.
 *
 * @param archive - absolute path to a `.tgz`.
 * @returns `Map<string, Buffer>` keyed by the path inside the archive (`package/…`),
 *   or null when it cannot be read or parsed.
 */
function readTarball(archive) {
  let raw
  try {
    raw = gunzipSync(readFileSync(archive))
  } catch {
    return null
  }
  const entries = new Map()
  let offset = 0
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512)
    // A zero block ends the archive; trailing padding is otherwise all zeroes.
    if (header.every((byte) => byte === 0)) break
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0[\s\S]*$/, '')
    const name = field(0, 100)
    const prefix = field(345, 155)
    const size = parseInt(field(124, 12).trim(), 8)
    const type = String.fromCharCode(header[156])
    if (name === '' || !Number.isFinite(size) || size < 0) return null
    offset += 512
    if (type === '0' || type === '\0') {
      entries.set(prefix === '' ? name : `${prefix}/${name}`, raw.subarray(offset, offset + size))
    }
    offset += Math.ceil(size / 512) * 512
  }
  return entries.size > 0 ? entries : null
}

/** JSON with object keys in a fixed order, so two equal documents compare equal. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** The dependency maps a packer may rewrite while leaving every other field alone. */
const DEPENDENCY_MAPS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/**
 * A manifest in comparable form.
 *
 * `relaxDependencyVersions` drops each dependency map to its sorted key list. It is
 * set for a `snapshot` row, whose tarball is produced by a packer that resolves
 * `workspace:` protocol ranges to concrete versions and may reorder the map — the
 * dependency NAMES are still compared, so a dependency added on one side only is
 * still caught.
 */
function comparableManifest(manifest, relaxDependencyVersions) {
  const copy = JSON.parse(JSON.stringify(manifest))
  if (relaxDependencyVersions) {
    for (const key of DEPENDENCY_MAPS) {
      if (copy[key] !== null && typeof copy[key] === 'object') copy[key] = Object.keys(copy[key]).sort()
    }
  }
  return stableStringify(copy)
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

// ── every shipped tool must be built with defineTool, across ALL plugins ───
// The rule is a property of the shipped SUITE, not of one file. The earlier form read
// `plugins/ratchet/ratchet-tools.mjs` alone, so a raw registration added to any OTHER
// shipped plugin still printed `[PASS] tools:use-defineTool`. The check now discovers
// every plugin source under `plugins/*/` (excluding `node_modules` and build/packed
// output) and reports the offending file and line.
{
  const files = shippedPluginSourceFiles()
  if (files === null) {
    check('tools:use-defineTool', false, 'plugins/ could not be listed, so no plugin source was examined')
  } else {
    const offenders = []
    let defineToolUses = 0
    for (const file of files) {
      let text
      try {
        text = readFileSync(join(KIT, file), 'utf8')
      } catch (error) {
        offenders.push(`${file}: unreadable (${String(error)})`)
        continue
      }
      defineToolUses += (text.match(/defineTool\(/g) ?? []).length
      // A raw schema is a `parameters:` whose value is a JSON-Schema root, i.e. a `{`
      // immediately followed by `type:`. `defineTool`'s parameters is an author DSL map
      // whose first key is a parameter name, so its declarations never match.
      const bareParameters = /parameters:\s*\{\s*type:/g
      let match
      while ((match = bareParameters.exec(text)) !== null) {
        const line = text.slice(0, match.index).split('\n').length
        offenders.push(`${file}:${line}: ${match[0].replace(/\s+/g, ' ').slice(0, 80)}`)
      }
    }
    check(
      'tools:use-defineTool',
      offenders.length === 0 && defineToolUses > 0,
      offenders.length > 0
        ? `a raw (hand-written) tool parameters schema was registered in: ${offenders.slice(0, 6).join(' | ')}`
        : defineToolUses === 0
          ? `no defineTool declaration exists among the ${files.length} shipped plugin source(s), so this check proves nothing`
          : `${files.length} shipped plugin source(s) examined — ${defineToolUses} defineTool declaration(s), no raw parameters schema`,
    )
  }
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

// ── the Windows installer's prefix decision must be case- and boundary-aware ──
{
  // The pattern scan above skips `.ps1` (its extension filter is `.mjs|.js|.sh`), so the
  // installer needs its own block. What it pins, measured under Windows PowerShell 5.1:
  // `'C:\…\npm'.StartsWith('c:\…')` is FALSE (the single-argument overload is a
  // culture-sensitive, case-SENSITIVE compare) and `'C:\Users\1by\.npm'.StartsWith('C:\Users\1')`
  // is TRUE (no directory boundary). Either one alone silently changes which npm prefix the
  // installer keeps, so the check requires an explicit comparison mode and an explicit
  // separator rather than trusting a future edit to remember why.
  let installer = null
  let installerError = null
  try {
    installer = readFileSync(join(KIT, 'install.ps1'), 'utf8')
  } catch (error) {
    installerError = String(error)
  }
  if (installer === null) {
    check('install-ps1:prefix-compare', false, `install.ps1 must exist and be readable: ${installerError}`)
  } else {
    // Comment lines are excluded on purpose: the installer DOCUMENTS the two defective
    // forms by quoting them, and a rule that flagged the explanation would push the
    // explanation out of the file — the same trade the url-pathname rule makes.
    const codeLines = installer
      .split('\n')
      .map((line, index) => ({ line, number: index + 1 }))
      .filter((entry) => !/^\s*#/.test(entry.line))
    const bareStartsWith = codeLines.filter((entry) => /\.StartsWith\(\s*[^,()]+\)/.test(entry.line))
    const caseAware = installer.includes('[System.StringComparison]::OrdinalIgnoreCase')
    const boundaryAware = /\$userProfile\s*\+\s*['"]\\['"]/.test(installer)
    const pass = bareStartsWith.length === 0 && caseAware && boundaryAware
    check(
      'install-ps1:prefix-compare',
      pass,
      pass
        ? 'the npm prefix is compared with an explicit case-insensitive mode and a directory boundary'
        : `install.ps1 decides "is this prefix user-local" with a comparison that can change meaning: bareStartsWith=${bareStartsWith
            .map((entry) => `line ${entry.number}`)
            .join(',') || 'none'} (a one-argument StartsWith is case-sensitive and boundary-less) caseAware=${caseAware} boundaryAware=${boundaryAware}`,
    )
  }
}

// ── shipped PowerShell must be ASCII, because 5.1 decodes it with the ANSI codepage ──
{
  // Measured, not assumed. A `.ps1` with no byte-order mark is decoded by Windows
  // PowerShell 5.1 with the system ANSI codepage, so the UTF-8 bytes of an em dash
  // (E2 80 94) become three ANSI characters whose third byte, 0x94, is a SMART DOUBLE
  // QUOTE — which PowerShell's tokenizer accepts as a string terminator. The committed
  // install.ps1 had one inside a double-quoted Write-Error, and `powershell -File
  // install.ps1` failed with `TerminatorExpectedAtEndOfString` / `MissingEndCurlyBrace`
  // before executing a single line; the identical bytes with a UTF-8 BOM parsed with 0
  // errors. An ASCII-only file cannot have that failure mode on any codepage, so the rule
  // is "ASCII" rather than "add a BOM": a BOM changes what the repository stores and what
  // every `readFileSync(..., 'utf8')` sees at offset 0.
  const offenders = []
  let scripts = []
  try {
    scripts = readdirSync(KIT)
      .filter((name) => name.endsWith('.ps1'))
      .sort()
  } catch (error) {
    offenders.push(`the kit root could not be listed (${String(error)})`)
  }
  for (const name of scripts) {
    let text = null
    try {
      text = readFileSync(join(KIT, name), 'utf8')
    } catch (error) {
      offenders.push(`${name}: unreadable (${String(error)})`)
      continue
    }
    for (const [index, line] of text.split('\n').entries()) {
      const found = line.match(/[^\x00-\x7F]/u)
      if (found === null) continue
      offenders.push(`${name}:${index + 1}: ${JSON.stringify(found[0])} (U+${found[0].codePointAt(0).toString(16).toUpperCase()})`)
    }
  }
  check(
    'ps1:ascii-only',
    offenders.length === 0 && scripts.length > 0,
    offenders.length === 0
      ? scripts.length === 0
        ? 'no .ps1 at the kit root was examined, so this check proves nothing'
        : `${scripts.length} installer script(s) are ASCII-only, so no codepage can change what PowerShell 5.1 reads`
      : `${offenders.slice(0, 6).join(' | ')} — a non-ASCII character in a BOM-less .ps1 is decoded with the system ANSI codepage; keep the file ASCII`,
  )
}

// ── the platform file-URL API round-trips on BOTH platforms, and that is EXECUTED ──
{
  // The POSIX half of the dynamic-import URL idiom used to be reasoned, never run: this
  // machine is Windows-only. `pathToFileURL`/`fileURLToPath` accept a `windows` option, so
  // the POSIX shape IS executed here — a POSIX path in, the same POSIX path out — which is
  // what turns "it should work on Linux" into a measurement. For contrast, the hand-built
  // form this replaced produces the pathname `//home/kit/...` (three literal slashes plus
  // the path's own leading separator), which Linux tolerates rather than intends; the check
  // fails if the API form ever stops round-tripping exactly.
  const samples = [
    { label: 'posix', path: '/home/kit/plugins/ratchet/x.mjs', windows: false },
    { label: 'windows', path: 'C:\\dsh-kit\\plugins\\ratchet\\x.mjs', windows: true },
  ]
  const offenders = []
  for (const sample of samples) {
    let url = null
    let back = null
    try {
      url = pathToFileURL(sample.path, { windows: sample.windows })
      back = fileURLToPath(url, { windows: sample.windows })
    } catch (error) {
      offenders.push(`${sample.label}: ${String(error)}`)
      continue
    }
    // The round trip alone is the strong assertion, and it is the one that falsifies the
    // form this replaced: `file:////home/kit/x.mjs` comes back as `//home/kit/x.mjs`, not
    // as the path that went in. The href assertion pins the three-slash shape directly.
    if (back !== sample.path) offenders.push(`${sample.label}: round trip gave ${JSON.stringify(back)}`)
    if (!url.href.startsWith('file:///') || url.href.startsWith('file:////')) {
      offenders.push(`${sample.label}: href ${JSON.stringify(url.href)} is not the three-slash form`)
    }
  }
  check(
    'file-url:platform-api-round-trips',
    offenders.length === 0,
    offenders.length === 0
      ? 'pathToFileURL/fileURLToPath round-trip the Windows AND POSIX shapes (the POSIX one run here through the windows:false option), so no hand-built URL is needed'
      : offenders.join(' | '),
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
      // A snapshot must be a complete package, not a shell: its declared entry point
      // has to exist, or a reviewer cannot import what the tarball ships and the
      // directory is a source list that resolves to nothing.
      if (row.provenance === 'snapshot' && typeof row.source === 'string') {
        const manifestPath = join(KIT, row.source, 'package.json')
        if (existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
            const entry = typeof manifest.main === 'string' ? manifest.main : null
            if (entry === null || !existsSync(join(KIT, row.source, entry))) {
              problems.push(`${id}: snapshot declares main ${JSON.stringify(entry)} but it is not in ${row.source}`)
            }
          } catch (error) {
            problems.push(`${id}: snapshot package.json is unreadable: ${String(error)}`)
          }
        }
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

// ── each tarball must still agree with the source it was packed from ────────
// The packer is the only link between the two, and it leaves no evidence: a tarball
// that kept its filename while its source changed installs the old bytes into every
// profile, and the checkout a reviewer reads shows code that was never shipped. This
// is the check that makes "rebuild and repack" a rule with a failure behind it.
{
  /** Extensions whose bytes are compared as TEXT, with line endings normalised. */
  const TEXTUAL_FILE = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts|json|map|md|markdown|txt|ya?ml|css|html|sh|ps1|d\.ts)$/i
  const TEXTUAL_NAME = /^(license|notice|readme|changelog)$/i

  /**
   * Compares a packed file with its source, ignoring line-ending differences in text.
   *
   * @param sourceBytes - The file as it is on disk in this checkout.
   * @param packedBytes - The same file as the tarball carries it.
   * @param relativePath - Repository-relative name, used to decide text vs binary.
   * @returns `true` when the two are the same file for review purposes.
   */
  function fileBytesMatch(sourceBytes, packedBytes, relativePath) {
    if (sourceBytes.equals(packedBytes)) return true
    const base = relativePath.split('/').pop()
    const textual = TEXTUAL_FILE.test(base) || TEXTUAL_NAME.test(base) || !base.includes('.')
    if (!textual) return false
    const normalise = (buffer) => buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    return normalise(sourceBytes) === normalise(packedBytes)
  }

  const problems = []
  let inventory = null
  try {
    inventory = JSON.parse(readFileSync(join(KIT, 'plugins', 'inventory.json'), 'utf8'))
  } catch {
    // The inventory check above already reports the unreadable manifest.
  }
  const pluginDir = join(KIT, 'plugins')
  let compared = 0
  for (const row of inventory?.plugins ?? []) {
    if (typeof row.source !== 'string' || typeof row.tarballPrefix !== 'string') continue
    const versions = readdirSync(pluginDir).filter(
      (name) => name.startsWith(`${row.tarballPrefix}-`) && name.endsWith('.tgz'),
    )
    // Anything other than exactly one tarball is the inventory check's finding.
    if (versions.length !== 1) continue
    const entries = readTarball(join(pluginDir, versions[0]))
    if (entries === null) {
      problems.push(`${row.id}: ${versions[0]} is unreadable or not a parseable tar`)
      continue
    }
    for (const [name, bytes] of entries) {
      const rel = name.replace(/^package\//, '')
      const sourcePath = join(KIT, row.source, rel)
      if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
        problems.push(`${row.id}: ${rel} is packed but absent from ${row.source}`)
        continue
      }
      compared += 1
      const sourceBytes = readFileSync(sourcePath)
      if (rel !== 'package.json') {
        // Text is compared with line endings NORMALISED. The author packs on one platform
        // and every machine checks out on its own: `.gitattributes` pins `*.sh` and `*.mjs`
        // to LF and leaves `.md`, `LICENSE` and the rest to the platform, so a Windows
        // checkout holds CRLF in exactly those files while the tarball — packed from an LF
        // tree — holds LF. Comparing raw bytes made this check fail on an unchanged kit for
        // a reason that has nothing to do with what it is for, which is noticing that the
        // source moved on and the tarball did not.
        if (!fileBytesMatch(sourceBytes, bytes, rel)) {
          problems.push(`${row.id}: ${rel} differs between ${row.source} and ${versions[0]}`)
        }
        continue
      }
      // A manifest is compared as a document, not as bytes: the packer may reorder
      // keys, and for a snapshot it resolves `workspace:` ranges to real versions.
      try {
        const relax = row.provenance === 'snapshot'
        const sourceManifest = comparableManifest(JSON.parse(sourceBytes.toString('utf8')), relax)
        const packedManifest = comparableManifest(JSON.parse(bytes.toString('utf8')), relax)
        if (sourceManifest !== packedManifest) {
          problems.push(
            `${row.id}: package.json differs between ${row.source} and ${versions[0]}` +
              (relax ? ' beyond the dependency maps a packer resolves' : ''),
          )
        }
      } catch (error) {
        problems.push(`${row.id}: ${versions[0]} has an unparseable package.json: ${String(error)}`)
      }
    }
  }
  check(
    'tarball:matches-source',
    problems.length === 0,
    problems.length === 0
      ? `${compared} packed file(s) match the source tree byte for byte`
      : problems.slice(0, 6).join(' | '),
  )

  // ── a repack of an existing version must have changed the version ──────────
  // The rule's other clause: a tarball whose bytes move must carry a new version, because pnpm
  // resolves a `file:` dependency by path string and an unchanged filename is served from the
  // profile lockfile, so the new bytes never land. `tarball:matches-source` above cannot see this:
  // it compares the tarball with the SOURCE, and a hand `pnpm pack` at an unchanged version matches
  // it perfectly. This compares the tarball with the copy COMMITTED at HEAD, so it is a fact about
  // the change in flight rather than about the tree; with no git or no committed copy there is
  // nothing to compare, and the check reports a skip instead of a pass.
  const versionProblems = []
  let versionCompared = 0
  let versionSkipped = 0
  const packedVersion = (entries) => {
    const manifest = entries.get('package/package.json')
    if (manifest === undefined) return null
    try {
      const parsed = JSON.parse(manifest.toString('utf8'))
      return typeof parsed.version === 'string' ? parsed.version : null
    } catch {
      return null
    }
  }
  for (const row of inventory?.plugins ?? []) {
    if (typeof row.source !== 'string' || typeof row.tarballPrefix !== 'string') continue
    const versions = readdirSync(pluginDir).filter(
      (name) => name.startsWith(`${row.tarballPrefix}-`) && name.endsWith('.tgz'),
    )
    if (versions.length !== 1) continue
    const currentPath = join(pluginDir, versions[0])
    const currentEntries = readTarball(currentPath)
    if (currentEntries === null) continue
    const currentVersion = packedVersion(currentEntries)
    if (currentVersion === null) continue
    let headBytes = null
    try {
      headBytes = execFileSync('git', ['-C', KIT, 'show', `HEAD:plugins/${versions[0]}`], {
        encoding: 'buffer',
        maxBuffer: 64 * 1024 * 1024,
      })
    } catch {
      versionSkipped += 1
      continue
    }
    const scratch = join(tmpdir(), `dsh-kit-head-${versions[0]}`)
    let headVersion = null
    try {
      writeFileSync(scratch, headBytes)
      const headEntries = readTarball(scratch)
      headVersion = headEntries === null ? null : packedVersion(headEntries)
    } finally {
      rmSync(scratch, { force: true })
    }
    if (headVersion === null) {
      versionSkipped += 1
      continue
    }
    versionCompared += 1
    if (currentVersion === headVersion && !readFileSync(currentPath).equals(headBytes)) {
      versionProblems.push(
        `${row.id}: ${versions[0]} changed but its version stayed ${currentVersion}; a packer that does not bump the version leaves the new bytes uninstalled, because pnpm serves the old ones from the lockfile`,
      )
    }
  }
  check(
    'tarball:version-bumped',
    versionProblems.length === 0,
    versionProblems.length === 0
      ? `${versionCompared} repacked tarball(s) carry a new version${versionSkipped === 0 ? '' : `; ${versionSkipped} not committed at HEAD`}`
      : versionProblems.join(' | '),
  )
}

// ── report ─────────────────────────────────────────────────────────────────
const failed = results.filter((entry) => !entry.pass)
for (const entry of results) {
  process.stdout.write(`  [${entry.pass ? 'PASS' : 'FAIL'}] ${entry.id}\n`)
  if (!entry.pass) process.stdout.write(`         ${entry.note}\n`)
}
process.stdout.write(`\n  ${results.length - failed.length}/${results.length} portability and packaging checks passed\n`)
process.exit(failed.length === 0 ? 0 : 1)
