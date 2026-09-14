/**
 * PURPOSE
 *   Normalise the line endings of shipped kit source to LF, and report what it
 *   changed.
 *
 *   A Windows editing pass (`Set-Content`, `[IO.File]::WriteAllText`) writes CRLF,
 *   which breaks a POSIX shebang and dirties every diff of a file the repository
 *   stores as LF. `check-portability.mjs` detects that; this repairs it, because a
 *   detector without a remedy leaves a contributor hand-editing bytes.
 *
 * INPUTS
 *   --check   report what would change and write nothing (default is to write).
 *   None; the file list is the shipped source under `plugins/`, `scripts/` and
 *   `probes/`, plus the repository's own shell entry points.
 *
 * OUTPUTS
 *   One line per changed file with its CRLF count, then a total. Exit 0 when the
 *   tree is already clean or was cleaned, 1 under `--check` when something would
 *   change, so it can be used as a gate.
 *
 * KEYWORDS
 *   line endings, crlf, lf, normalisation, repair, shebang
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A binary file is skipped: rewriting bytes that are not text would corrupt it.
 *   - A file with no CR is left untouched, so mtimes do not churn on every run.
 *   - A file that is not valid UTF-8 is reported and skipped rather than re-encoded.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK_ONLY = process.argv.includes('--check')

/**
 * Directories that hold shipped source, and the extensions worth examining.
 *
 * `scripts` and `probes` are here because they are shipped source too, and because
 * the detector's coverage must match this repair's: a check that cannot see a file
 * this tool would fix leaves the contributor hand-editing bytes.
 */
const ROOTS = ['plugins', 'scripts', 'probes']

/**
 * Root-level files that are shipped source as well.
 *
 * `install.sh` and `start.sh` are run by a POSIX shell, so a CRLF shebang is a script
 * that does not start — the one case where the working-tree bytes matter more than the
 * repository's. The `.ps1` files are excluded deliberately: `.gitattributes` gives them
 * `eol=crlf`, so CRLF is their correct form.
 */
const ROOT_FILES = ['install.sh', 'start.sh']
const TEXT = /\.(mjs|js|sh|json|md)$/
const SKIP_DIRECTORIES = new Set(['node_modules', '.git'])

/** Every candidate file under a root, excluding dependency directories. */
function candidates(root) {
  const found = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      const full = join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && TEXT.test(entry.name)) found.push(full)
    }
  }
  const absolute = join(KIT, root)
  if (statSync(absolute, { throwIfNoEntry: false })?.isDirectory()) walk(absolute)
  return found
}

const changed = []
const skipped = []
const targets = [
  ...ROOTS.flatMap((root) => candidates(root)),
  ...ROOT_FILES.map((name) => join(KIT, name)).filter((file) => statSync(file, { throwIfNoEntry: false })?.isFile()),
]
for (const file of targets) {
  const bytes = readFileSync(file)
  const text = bytes.toString('utf8')
  if (text.includes('\uFFFD')) {
    skipped.push(`${relative(KIT, file).replace(/\\/g, '/')} (not valid UTF-8)`)
    continue
  }
  const crlf = (text.match(/\r\n/g) ?? []).length
  const loneCr = (text.match(/\r(?!\n)/g) ?? []).length
  if (crlf === 0 && loneCr === 0) continue
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  changed.push({ file, crlf, loneCr })
  if (!CHECK_ONLY) writeFileSync(file, normalised, 'utf8')
}

for (const entry of changed) {
  process.stdout.write(
    `  ${CHECK_ONLY ? 'would normalise' : 'normalised'} ${relative(KIT, entry.file).replace(/\\/g, '/')} (${entry.crlf} CRLF, ${entry.loneCr} CR)\n`,
  )
}
for (const entry of skipped) process.stdout.write(`  skipped ${entry}\n`)

if (changed.length === 0) {
  process.stdout.write('  no CRLF in shipped source\n')
  process.exit(0)
}
process.stdout.write(`\n  ${changed.length} file(s) ${CHECK_ONLY ? 'need normalising' : 'normalised'}\n`)
process.exit(CHECK_ONLY ? 1 : 0)
