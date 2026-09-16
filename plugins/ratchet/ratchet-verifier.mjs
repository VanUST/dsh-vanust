/**
 * Ratchet verifier: decide, from files alone, whether the code obeys the compiled
 * laws.
 *
 * Everything here is deterministic. No model is consulted, no heuristic is
 * applied, and no check is "best effort": a check either finds what it was told
 * to find or it reports the violation. That property is the whole reason the
 * static layer can be a gate — a non-deterministic check that can fail a build is
 * one people learn to re-run until it passes.
 *
 * Two rules were written to be hard to get wrong, because the failure mode of a
 * verifier is silence:
 *
 * 1. **A check that cannot be evaluated is a problem, not a pass.** An unknown
 *    check type, a glob that matches nothing under `required_glob`, an
 *    unreadable file — each produces a problem. Reporting `ok` for something
 *    that was never examined is how a gate stops being one.
 * 2. **Every result names what it looked at.** A violation carries the law, the
 *    file and the evidence, so the reader can confirm the finding without
 *    re-running the ratchet.
 *
 * Language-agnostic by construction: files, globs, text and declared dependency
 * manifests. Nothing here parses a program, so a Python, C++, Unity or TypeScript
 * repository is checked by the same code and the same laws.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { CODE_HASH_SMALL_FILE_BYTES, PROBLEM_CODES, WORK_LIMITS, budgetProblem, globToRegExp, problem, recordBudgetStop, regexUnsafeReason, workBudgetRead, zoneFor } from './ratchet-schema.mjs'

// The glob matcher lives in `ratchet-schema.mjs`, the lowest module, because zone placement
// and file selection must agree and the compiler and the guard cannot import this file. It
// is re-exported here so the callers that already reach it through the verifier keep working.
export { globToRegExp }
import { bundleHash, normaliseGlobPath } from './ratchet-compiler.mjs'

/** Report title embedded in every verification report. */
export const VERIFY_REPORT_KIND = 'ratchet/verify-report'

/**
 * Default budget for a `command` check, in milliseconds.
 *
 * Five minutes is long enough for a test suite and short enough that a hung command
 * cannot make verification hang forever. A law may lower it; nothing may remove it.
 */
export const DEFAULT_COMMAND_TIMEOUT_MS = 300_000

/**
 * Directories never walked by any check.
 *
 * A dependency check that reads `node_modules` would report the ecosystem's
 * choices as the project's, and a text check that reads build output would
 * report a stale artifact. The list is deliberately small and universal: it names
 * things that are never a project's own source in any language. It is a WALK
 * economy, never a licence to skip an explicit existence claim: the
 * `required_file`, `forbidden_file` and `required_file_in_list` checks resolve the path they
 * name with `pathOnDisk`, which asks the filesystem and ignores this set, so a file inside
 * one of these directories is still seen by the law that names it. The `*_glob` kinds match
 * against the walk, so a glob does not see inside these directories; a law that must see
 * such a path names it explicitly.
 */
const NEVER_WALK = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'bin',
  'obj',
  'Library',
  'Temp',
  '.dsh',
  'reports',
])

/**
 * Lists every file under a root, skipping {@link NEVER_WALK} directories.
 *
 * The walk carries the work budget: on the in-process path a tree that names more files than
 * the budget allows stops being walked, the stop is recorded on the tracker, and the caller's
 * result says so rather than reading a partial list as the whole tree. The CLI passes no
 * budget and walks everything.
 *
 * @param root - Absolute project root.
 * @param start - Repository-relative directory to start from (default: the root).
 * @param budget - A work-budget tracker (see `createWorkBudget`), or `null`/`undefined` for an
 *   unbounded walk. A budget whose `maxFiles` is Infinity is effectively unbounded.
 * @returns Sorted repository-relative paths with forward slashes. Unreadable
 *   directories are skipped silently here and reported by the check that asked,
 *   because this walker cannot know which check cared.
 */
export function listFiles(root, start = '', budget = null) {
  const found = []
  const maxFiles = budget?.limits?.maxFiles ?? Infinity
  let stopped = false
  const walk = (absolute, prefix) => {
    if (stopped) return
    let entries
    try {
      entries = readdirSync(absolute, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (stopped) return
      if (NEVER_WALK.has(entry.name)) continue
      const full = join(absolute, entry.name)
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(full, relativePath)
      else if (entry.isFile()) {
        if (found.length >= maxFiles) {
          // The walk itself is a syscall per directory and per entry, so a budget that only
          // bounded file READS left the loop blocking on the enumeration. Stopping here makes
          // the file list incomplete, and an incomplete list is not a verdict: the tracker
          // records the stop and the caller fails closed.
          stopped = true
          recordBudgetStop(budget, { path: relativePath, kind: 'walk' })
          return
        }
        found.push(relativePath)
      }
    }
  }
  const base = start.length === 0 ? root : join(root, start)
  if (existsSync(base)) walk(base, start)
  return found.sort()
}

/**
 * Matches repository-relative paths against a glob.
 *
 * @param files - Candidate paths.
 * @param glob - Glob pattern.
 * @returns Matching paths, sorted.
 */
export function matchFiles(files, glob) {
  const expression = globToRegExp(glob)
  return files.filter((file) => expression.test(file))
}

/**
 * Extracts the leading segments of a glob that contain no wildcard.
 *
 * A glob can only match paths that begin with these segments literally; the first
 * wildcard segment ends the prefix, because everything after it is free. An empty
 * result means the glob may match anywhere in the tree.
 *
 * @param glob - Repository-relative glob.
 * @returns Literal leading segments. Empty when the first segment is a wildcard, or
 *   when the glob is empty, contains `..`, or starts at the filesystem root — cases
 *   where no prefix can be assumed.
 */
export function literalGlobPrefix(glob) {
  const segments = String(glob ?? '').split('/')
  const literal = []
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..' || /[*?[\]]/.test(segment)) break
    literal.push(segment)
  }
  return literal
}

/**
 * Decides whether two globs provably cannot match the same path.
 *
 * The answer is `true` only when it can be PROVEN from the globs alone: both must
 * have a non-empty literal prefix and those prefixes must diverge at some segment.
 * Everything else — including a glob that starts with `**`, which may match anywhere
 * — is reported as overlapping, because guessing "cannot overlap" from a textual
 * comparison is how a deny that does match gets reported as enforcing nothing.
 *
 * @param left - Repository-relative glob.
 * @param right - Repository-relative glob.
 * @returns `true` when no path can match both. Never throws.
 */
export function globsProvablyDisjoint(left, right) {
  const a = literalGlobPrefix(left)
  const b = literalGlobPrefix(right)
  if (a.length === 0 || b.length === 0) return false
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return true
  }
  // One prefix contains the other, so every path under the shorter one is a
  // candidate for the longer de-nied pattern as well.
  return false
}

/**
 * How many files the code hash will stat and read before it stops reading content.
 *
 * The file COUNT is a syscall bound, not a byte bound. A project with 50,000 empty files
 * cost about 7.5 seconds even though none of them held a byte, because each was stat'ed and
 * read; a byte cap cannot bound that. Past this many files each remaining file contributes
 * its path and an `unscanned` marker, so the hash is still deterministic — a rename, an add
 * or a removal moves it — while the syscall count is bounded. The value is
 * {@link WORK_LIMITS}.maxFiles so the in-process tool path and the hash agree on one number.
 */
export const CODE_HASH_MAX_FILES = WORK_LIMITS.maxFiles

/**
 * The largest file the code hash reads in full, in bytes. A file above this contributes its
 * path and size instead of its content.
 *
 * The bound exists because the hash runs on whichever thread called it, and `ratchet_verify`
 * and `ratchet_status` run **in the harness process, on its single event loop**. Hashing every
 * file in full froze the whole session: a 43 GiB tree with a CUDA toolkit and a model cache in
 * it took about 70 seconds of synchronous reads in which no other request was served, and two
 * GUI windows died together. Source files are far below this; model weights, datasets and
 * package caches are far above it, and none of them is the code a verdict is about. The value
 * is {@link WORK_LIMITS}.maxFileBytes so there is one per-file cap in the system.
 */
export const CODE_HASH_MAX_FILE_BYTES = WORK_LIMITS.maxFileBytes

/**
 * The most content one code hash reads in total, in bytes.
 *
 * A project's own source is normally a few MiB; a repository that exceeds 64 MiB of it is
 * either generated or not source at all. The value is {@link WORK_LIMITS}.maxTotalBytes, one
 * total-byte limit shared with the check-read path.
 *
 * This cap must never make a SMALL file content-blind. The first version charged the budget
 * in path order and then contributed `path+size` for every later file, so once 64 MiB had
 * been read a 29-byte file's edit stopped moving the hash — a bound meant for caches silently
 * answering "unchanged" about source. A file at or below
 * {@link CODE_HASH_SMALL_FILE_BYTES} is therefore always read from its content; only a file
 * above that threshold is allowed to become content-free once the total is spent.
 */
export const CODE_HASH_MAX_TOTAL_BYTES = WORK_LIMITS.maxTotalBytes

/**
 * Hashes the walked tree into the code identity a verdict is bound to.
 *
 * Three bounds, all deterministic for a given tree:
 *   - a file above `maxFileBytes` contributes `path` plus its size;
 *   - past `maxFiles` files each remaining file contributes `path` plus an `unscanned`
 *     marker, so the syscall count is bounded;
 *   - once `maxTotalBytes` of content has been read, a file ABOVE
 *     {@link CODE_HASH_SMALL_FILE_BYTES} contributes `path` plus its size, while a file at or
 *     below it is still read — a small file's content always moves the hash.
 * A path whose size cannot be read contributes its error text, as before. What the bounds
 * give up is noticing a content change in a large file that keeps its size, which is the
 * right trade for a file that large and is stated here rather than discovered as a freeze.
 *
 * @param root - Absolute project root.
 * @param files - Repository-relative paths to hash (the walked list).
 * @param options - `{ maxFiles, maxFileBytes, maxTotalBytes }` override the three bounds. A
 *   field that is not a finite number falls back to its `CODE_HASH_MAX_*` default.
 * @returns A `sha256:<hex>` string.
 */
export function codeHashFor(root, files, options = {}) {
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : CODE_HASH_MAX_FILES
  const maxFileBytes = Number.isFinite(options.maxFileBytes) ? options.maxFileBytes : CODE_HASH_MAX_FILE_BYTES
  const maxTotalBytes = Number.isFinite(options.maxTotalBytes) ? options.maxTotalBytes : CODE_HASH_MAX_TOTAL_BYTES
  const hash = createHash('sha256')
  let total = 0
  let scanned = 0
  for (const path of [...files].sort()) {
    hash.update(path)
    hash.update('\u0000')
    // The syscall bound: past the count the file is named but never opened. This is the only
    // branch that does not stat, so the cost of a huge tree is bounded by maxFiles syscalls.
    if (scanned >= maxFiles) {
      hash.update('\u0000unscanned')
      hash.update('\u0000')
      continue
    }
    scanned += 1
    let size = null
    try {
      const stats = statSync(join(root, path))
      if (stats.isFile()) size = stats.size
    } catch {
      size = null
    }
    const contentBlind =
      size !== null &&
      (size > maxFileBytes || (total + size > maxTotalBytes && size > CODE_HASH_SMALL_FILE_BYTES))
    if (contentBlind) {
      // Content-free but deterministic: the path is already in the hash, and the size moves
      // when the file is replaced. The alternative — reading it — is the freeze this bound
      // exists to prevent.
      hash.update(`\u0000large:${size}`)
    } else {
      const read = readProjectFile(root, path)
      hash.update(read.error === undefined ? read.text : `\u0000unreadable:${read.error}`)
      if (size !== null) total += size
    }
    hash.update('\u0000')
  }
  return `sha256:${hash.digest('hex')}`
}

/**
 * Hashes the authority table a verification was judged under.
 *
 * The third leg of a verdict's identity, beside the laws it judged and the tree it read.
 * The manifest decides which zones exist and which of them an agent may activate at all,
 * and `.dsh/` is excluded from the walk — so relaxing `agentAuthority` from `humanOnly`
 * to `activeIfNoConflict` left `status` reporting a verified, current project while the
 * gate was red, because neither the law hash nor the code hash had moved. ADR 0012 says
 * the zone table cannot be relaxed without the gate saying so; this is how `status` says
 * it. Only the fields that grant or withhold authority are hashed — a project name or a
 * directory spelling must not invalidate a verdict.
 *
 * @param config - Parsed ratchet configuration, or `null`.
 * @returns `sha256:<hex>` over the canonical authority identity. `null` when there is no
 *   configuration to hash, which the state layer treats as "cannot say".
 */
export function configHashFor(config) {
  if (config === null || config === undefined) return null
  const identity = {
    defaultAgentAuthority: config.defaultAgentAuthority ?? null,
    zones: (config.zones ?? [])
      .map((zone) => ({
        id: zone.id,
        paths: [...(zone.paths ?? [])].sort(),
        agentAuthority: zone.agentAuthority ?? null,
        requiresDecisionRecord: zone.requiresDecisionRecord === true,
      }))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    decisionsDir: config.decisionsDir ?? null,
    sourcesDir: config.sourcesDir ?? null,
    specsDir: config.specsDir ?? null,
    specsRequired: config.specsRequired === true,
  }
  return `sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`
}

/**
 * Reads a file, normalising line endings, under a work budget.
 *
 * @param root - Absolute project root.
 * @param path - Repository-relative path.
 * @param budget - A work-budget tracker (see `createWorkBudget`), or `null`/`undefined` for an
 *   unbounded read (the CLI path), in which case the whole file is read exactly as before.
 * @returns `{ text }` | `{ error }` | `{ over }`; never throws, because a check that cannot
 *   read a file must report that rather than abort the whole verification. `over` is a work
 *   budget refusal and the caller must REPORT it, never treat it as a pass.
 */
export function readProjectFile(root, path, budget = null) {
  return workBudgetRead(budget, root, path)
}

/**
 * Derives a line number for a match offset.
 *
 * @param text - Full text the offset indexes into.
 * @param offset - Character offset of the match.
 * @returns 1-based line number.
 */
export function lineAt(text, offset) {
  let line = 1
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === '\n') line += 1
  }
  return line
}

/**
 * Reads the declared dependency names from a project's manifests.
 *
 * The reader is driven by the manifest's `languages` declarations, so a project
 * that declares Python and TypeScript has both `package.json` and Python
 * requirement files consulted, and a project that declares neither is checked
 * against whatever manifests exist rather than being reported as clean. That
 * last case matters: a dependency law that silently finds no manifest would pass
 * while enforcing nothing.
 *
 * @param root - Absolute project root.
 * @param files - Repository-relative file list.
 * @param manifest - Parsed project manifest, or `null`.
 * @param budget - A work-budget tracker, or `null`/`undefined` for an unbounded read. A
 *   manifest above the per-file cap is REPORTED (`CODE_FILE_TOO_LARGE`), never read, so a
 *   dependency law over a 300 MB `package.json` fails closed instead of blocking the loop.
 * @returns `{ names, manifests, problems }`; `names` is a lowercase set of
 *   dependency names found anywhere, `manifests` lists the files consulted.
 */
export function readDeclaredDependencies(root, files, manifest, budget = null) {
  const names = new Set()
  const manifests = []
  const problems = []

  const addPackageJson = (path) => {
    const read = readProjectFile(root, path, budget)
    if (read.over !== undefined) {
      problems.push(
        problem(
          read.over.code,
          `${path} was not read because ${read.over.code === 'CODE_FILE_TOO_LARGE' ? `it is ${read.over.size} bytes, above the ${read.over.limit}-byte in-process read bound` : 'the operation exhausted its in-process work budget'}, so the dependencies it declares were NOT examined: too large to check in-process, run the CLI`,
          path,
          { path, ...read.over },
        ),
      )
      return
    }
    if (read.error !== undefined) {
      problems.push(
        problem('CODE_REQUIRED_DEPENDENCY_MISSING', `${path} could not be read: ${read.error}`, path),
      )
      return
    }
    manifests.push(path)
    let parsed
    try {
      parsed = JSON.parse(read.text)
    } catch (error) {
      problems.push(
        problem('MANIFEST_INVALID', `${path} is not valid JSON: ${String(error)}`, path),
      )
      return
    }
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const name of Object.keys(parsed?.[field] ?? {})) names.add(name.toLowerCase())
    }
  }

  for (const path of files.filter((file) => file.endsWith('package.json'))) addPackageJson(path)

  const pythonManifestPatterns = [
    /^requirements[^/]*\.txt$/,
    /^pyproject\.toml$/,
    /^Pipfile$/,
    /^environment\.ya?ml$/,
  ]
  for (const path of files) {
    if (!pythonManifestPatterns.some((pattern) => pattern.test(path))) continue
    const read = readProjectFile(root, path, budget)
    if (read.over !== undefined) {
      problems.push(
        problem(
          read.over.code,
          `${path} was not read because ${read.over.code === 'CODE_FILE_TOO_LARGE' ? `it is ${read.over.size} bytes, above the ${read.over.limit}-byte in-process read bound` : 'the operation exhausted its in-process work budget'}, so the dependencies it declares were NOT examined: too large to check in-process, run the CLI`,
          path,
          { path, ...read.over },
        ),
      )
      continue
    }
    if (read.error !== undefined) continue
    manifests.push(path)
    for (const line of read.text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0 || trimmed.startsWith('#')) continue
      // Both `name==1.0` (requirements.txt) and `name = "^1"` (pyproject) reduce
      // to the leading identifier, which is the only part a law can match on.
      const match = /^"?([A-Za-z0-9_.-]+)"?\s*(?:[<>=!~^]|$)/.exec(trimmed)
      if (match !== null) names.add(match[1].toLowerCase())
    }
  }

  return { names, manifests, problems }
}

/**
 * Suggests the correction for a path list that selected no file.
 *
 * The first thing anyone writes is the directory name — `paths: [src]` — and a glob
 * engine matches it against whole paths, so it selects nothing and the check reports
 * itself unevaluated. That is a safe failure, but the reader is left to guess why, and
 * the guess is not obvious: the spelling that looks right is the one that does nothing.
 * The hint only fires when the pattern really does name a file or a directory in the
 * tree, so it never invents a correction for a stale glob.
 *
 * @param root - Absolute project root.
 * @param paths - The `paths` array the check declared.
 * @param files - The walked file list.
 * @returns A sentence naming the first entry that resolves to a path, or `''` when none
 *   does. Never throws.
 */
function scopeHint(root, paths, files) {
  for (const pattern of paths ?? []) {
    if (typeof pattern !== 'string' || pattern.length === 0 || pattern.startsWith('!')) continue
    const bare = pattern.replace(/\/+$/, '')
    const namesSomething =
      (files ?? []).some((file) => file === bare || file.startsWith(`${bare}/`)) ||
      (() => {
        try {
          return statSync(join(root, bare)).isDirectory()
        } catch {
          return false
        }
      })()
    if (namesSomething) {
      return `"${pattern}" names a path rather than a glob; a directory needs its glob — write "${bare}/**" to select the files under it`
    }
  }
  return ''
}

/**
 * Selects the files a glob set addresses, honouring exclusion patterns.
 *
 * A path beginning with `!` removes matches. Exclusions apply in the order written,
 * so `['plugins/ratchet/**', '!plugins/ratchet/node_modules/**']` reads as
 * "everything under the plugin except its dependency links" — which is the shape a
 * boundary law needs, and the reason a bare path list was inadequate: it names what
 * exists today and silently misses what is added tomorrow.
 *
 * @param files - Candidate repository-relative paths.
 * @param patterns - Include globs, and `!`-prefixed exclusions.
 * @returns Sorted matching paths.
 */
export function selectFiles(files, patterns) {
  // A Set, not `selected.includes`: membership in an array is a linear scan, so adding N
  // matches to a growing list cost O(N^2). It was the bulk of a 147-second verify over 80,000
  // files (20k files 2.6 s, 40k 21 s, 80k 102 s — a clean quadratic). The insertion order is
  // kept by the array and the set answers "already selected" in constant time.
  const selected = []
  const chosen = new Set()
  for (const pattern of patterns ?? []) {
    if (typeof pattern !== 'string' || pattern.length === 0) continue
    if (pattern.startsWith('!')) {
      const excluded = new Set(matchFiles(selected, pattern.slice(1)))
      if (excluded.size === 0) continue
      const kept = selected.filter((file) => !excluded.has(file))
      selected.length = 0
      selected.push(...kept)
      chosen.clear()
      for (const file of kept) chosen.add(file)
      continue
    }
    for (const file of matchFiles(files, pattern)) {
      if (chosen.has(file)) continue
      chosen.add(file)
      selected.push(file)
    }
  }
  return selected.sort()
}

/**
 * Reads a JSON file and looks for a value in an array addressed by a key path.
 *
 * @param root - Absolute project root.
 * @param path - Repository-relative path of the JSON file.
 * @param keys - Key path into the document, e.g. `['files']` or `['ratchet','zones']`.
 * @param budget - A work-budget tracker, or `null`/`undefined` for an unbounded read. A file
 *   the budget refuses returns `{ list: null, error }` naming the refusal, so the caller's
 *   `required_file_in_list` check reports it rather than reading the file anyway.
 * @returns `{ list, error }`; `list` is `null` when the path does not resolve to an
 *   array, and `error` says why.
 */
export function readListAt(root, path, keys, budget = null) {
  const read = readProjectFile(root, path, budget)
  if (read.over !== undefined) {
    return {
      list: null,
      error: `${path} was not read because ${read.over.code === 'CODE_FILE_TOO_LARGE' ? `it is ${read.over.size} bytes, above the ${read.over.limit}-byte in-process read bound` : 'the operation exhausted its in-process work budget'}`,
      over: read.over,
    }
  }
  if (read.error !== undefined) return { list: null, error: `${path} could not be read: ${read.error}` }
  let value
  try {
    value = JSON.parse(read.text)
  } catch (error) {
    return { list: null, error: `${path} is not valid JSON: ${String(error)}` }
  }
  for (const key of keys) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { list: null, error: `${path} has no ${keys.join('.')}: ${key} is not an object` }
    }
    value = value[key]
  }
  if (!Array.isArray(value)) {
    return { list: null, error: `${path} has no array at ${keys.join('.')}` }
  }
  return { list: value, error: null }
}

/**
 * PURPOSE
 *   Resolve one LITERAL file path the project declares, by asking the filesystem rather than
 *   the walk, so a directory the walk skips cannot make a file check green or red wrongly.
 *
 * INPUTS
 *   root - the absolute project root (string).
 *   relativePath - a repository-relative path (string). A non-string or empty value is
 *     reported as a missing path rather than throwing.
 *
 * OUTPUTS
 *   `{ exists, kind }` where `kind` is `file`, `directory`, `other` or `missing`. A path that
 *   cannot be stated (ENOENT, ENOTDIR, EACCES, ELOOP) is `missing`: the check's own failure
 *   message is the report, and a check kind that throws is a check that never ran. Never
 *   throws.
 *
 * KEYWORDS
 *   file check, existence, stat, never walk, walk independence, false green
 */
function pathOnDisk(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) return { exists: false, kind: 'missing' }
  try {
    const stat = statSync(join(root, relativePath))
    return { exists: true, kind: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other' }
  } catch {
    return { exists: false, kind: 'missing' }
  }
}

/**
 * Evaluates one law against the project.
 *
 * @param options - `{ root, law, files, dependencies, config, runCommand, budget }`.
 *   `runCommand` is an injected `(run, options) => Promise<{ code, stdout, stderr }>`
 *   or `null`. A `command` check with no runner reports that it was NOT evaluated
 *   instead of passing, because a check nobody ran is not a check. `budget` is a
 *   work-budget tracker (see `createWorkBudget`); without one every read is unbounded,
 *   which is the CLI path.
 * @returns `{ problems, checked, pending }` where `checked` counts the checks that
 *   were actually evaluated and `pending` counts those that could not be.
 */
export async function verifyLaw({ root, law, files, dependencies, config, runCommand = null, budget = null }) {
  const problems = []
  const pending = []
  let checked = 0
  const fail = (code, message, extra = {}) => {
    problems.push(problem(code, message, law.id, { lawId: law.id, ...extra }))
  }

  // How many over-budget files one law reports individually before the rest are folded into a
  // count. A tree of thousands of oversized files must not build a problem list the size of the
  // tree, but the first ones must be named so a reader can see WHICH files the budget stopped.
  const OVER_BUDGET_REPORT_LIMIT = 20
  let overBudgetReported = 0
  /**
   * Reports a budget refusal as a problem instead of reading the file.
   *
   * A refused read is never a pass: `CODE_FILE_TOO_LARGE` says one file was not read, and
   * `WORK_BUDGET_EXCEEDED` says the operation's total was spent. Both make the verification
   * not ok, which is the fail-closed direction, and both tell the reader to run the CLI.
   */
  const reportOverBudget = (over) => {
    if (overBudgetReported >= OVER_BUDGET_REPORT_LIMIT) return
    overBudgetReported += 1
    if (over.code === 'CODE_FILE_TOO_LARGE') {
      fail(
        'CODE_FILE_TOO_LARGE',
        `law "${law.id}" could not read ${over.path} because it is ${over.size} bytes, above the ${over.limit}-byte in-process read bound, so this check was NOT evaluated over that file: too large to check in-process, run the CLI (decided in ${law.sourceAdr})`,
        { path: over.path, size: over.size, limit: over.limit },
      )
    } else {
      fail(
        'WORK_BUDGET_EXCEEDED',
        `law "${law.id}" exhausted the in-process work budget at ${over.path} (${over.filesRead ?? '?'} file(s), ${over.bytesRead ?? '?'} byte(s) read), so this check was NOT evaluated over the remaining files: too large to check in-process, run the CLI (decided in ${law.sourceAdr})`,
        { path: over.path },
      )
    }
  }
  /** Runs a check pattern, refusing one that can backtrack catastrophically. */
  const compileCheckPattern = (pattern, flags) => {
    const unsafe = regexUnsafeReason(pattern)
    if (unsafe !== null) {
      fail(
        'REGEX_UNSAFE',
        `law "${law.id}" declares the pattern ${JSON.stringify(pattern)}, which ${unsafe}; it was NOT executed because it would run synchronously on the harness event loop and hang every session in the process (decided in ${law.sourceAdr})`,
        { pattern },
      )
      return null
    }
    try {
      return new RegExp(pattern, flags ?? '')
    } catch (error) {
      fail(
        'REGEX_INVALID',
        `law "${law.id}" declares the pattern ${JSON.stringify(pattern)}, which is not a usable regular expression: ${String(error)} (decided in ${law.sourceAdr})`,
        { pattern },
      )
      return null
    }
  }

  // A check target written `./src/auth/**` or `src/../src/auth/**` names the same path as the
  // control spelling, and the COMPILER already normalises it (`pathIsGoverned` strips `./` and
  // resolves `..`). This matcher compared the RAW string against walked paths, which never contain
  // `./` or `..`, so a `forbidden_*` law over a tree holding the forbidden file reported SATISFIED —
  // a false green — and a `required_*` law reported a file that exists as missing. Normalised once,
  // for the kinds whose target is a PATH: a `pattern` on a text check is text, and normalising it
  // would corrupt a regex that happens to contain a slash or a dot.
  for (const raw of law.checks) {
    const check = { ...raw }
    if (typeof check.path === 'string') check.path = normaliseGlobPath(check.path).path
    if (typeof check.pattern === 'string' && (check.type === 'required_glob' || check.type === 'forbidden_glob')) {
      check.pattern = normaliseGlobPath(check.pattern).path
    }
    switch (check.type) {
      case 'required_file': {
        checked += 1
        // Asked of the FILESYSTEM, not of the walked list: the walk skips directories that are
        // never a project's source (`node_modules`, `bin`, `weights`, …), and reading membership
        // from it made a required file inside one report CODE_REQUIRED_FILE_MISSING even though
        // it exists — and a forbidden one report green. The explicit path kinds promise an
        // existence claim, so existence is what they ask about.
        if (!pathOnDisk(root, check.path).exists) {
          fail(
            'CODE_REQUIRED_FILE_MISSING',
            `law "${law.id}" requires the file ${check.path}, which does not exist (decided in ${law.sourceAdr})`,
            { path: check.path },
          )
        }
        break
      }
      case 'forbidden_file': {
        checked += 1
        if (pathOnDisk(root, check.path).exists) {
          fail(
            'CODE_FORBIDDEN_FILE_PRESENT',
            `law "${law.id}" forbids the file ${check.path}, which exists (decided in ${law.sourceAdr})`,
            { path: check.path },
          )
        }
        break
      }
      case 'required_glob': {
        checked += 1
        const matched = matchFiles(files, check.pattern)
        if (matched.length === 0) {
          fail(
            'CODE_REQUIRED_GLOB_MISSING',
            `law "${law.id}" requires at least one file matching ${check.pattern}, and nothing matches (decided in ${law.sourceAdr})`,
            { pattern: check.pattern },
          )
        }
        break
      }
      case 'forbidden_glob': {
        checked += 1
        const matched = matchFiles(files, check.pattern)
        if (matched.length > 0) {
          fail(
            'CODE_FORBIDDEN_GLOB_PRESENT',
            `law "${law.id}" forbids files matching ${check.pattern}; ${matched.length} matched, first ${matched[0]} (decided in ${law.sourceAdr})`,
            { pattern: check.pattern, matches: matched.slice(0, 20) },
          )
        }
        break
      }
      case 'required_text': {
        checked += 1
        // `selectFiles`, not one `matchFiles` per pattern: `paths` may carry
        // `!`-prefixed EXCLUSIONS for this spelling too — the compiler's `checkTargets`
        // has always read them that way, so the two disagreeing was a defect, not a
        // shorthand. Reading `!src/legacy/**` as a literal glob made a forbidden-text law
        // accuse the file its own decision excluded (a false failure) and let a
        // required-text law whose exclusion cancels its inclusion report itself
        // satisfied with nothing examined. The glob spellings use this same selector, so
        // the same declaration now gets the same answer whichever way it is written.
        const scope = selectFiles(files, check.paths)
        if (scope.length === 0) {
          fail(
            'CODE_TEXT_SCOPE_EMPTY',
            `law "${law.id}" requires the text ${JSON.stringify(check.pattern)} under ${(check.paths ?? []).join(', ')}, but no file matches those paths, so nothing was searched and this check was NOT evaluated (decided in ${law.sourceAdr}). ${scopeHint(root, check.paths, files)}`,
            { paths: check.paths, pattern: check.pattern },
          )
          break
        }
        const expression = compileCheckPattern(check.pattern, check.flags)
        if (expression === null) break
        const hits = []
        for (const path of scope) {
          const read = readProjectFile(root, path, budget)
          if (read.over !== undefined) {
            reportOverBudget(read.over)
            continue
          }
          if (read.error !== undefined) continue
          if (expression.test(read.text)) hits.push(path)
        }
        if (hits.length === 0) {
          fail(
            'CODE_REQUIRED_TEXT_MISSING',
            `law "${law.id}" requires the text ${JSON.stringify(check.pattern)} in ${(check.paths ?? []).join(', ')}; ${scope.length} file(s) were searched and none matched (decided in ${law.sourceAdr})`,
            { paths: check.paths, pattern: check.pattern, searched: scope.slice(0, 20) },
          )
        }
        break
      }
      case 'forbidden_text': {
        checked += 1
        // The same selector as `required_text` and the glob spellings, for the same
        // reason: see the comment there. The empty-scope guard below is the mirror of the
        // required-text case, and the reason it is here: a forbidden-text check with
        // nothing to search found no offenders and reported the law satisfied. "No file
        // was examined" is not evidence.
        const scope = selectFiles(files, check.paths)
        if (scope.length === 0) {
          fail(
            'CODE_TEXT_SCOPE_EMPTY',
            `law "${law.id}" forbids ${JSON.stringify(check.pattern)} under ${(check.paths ?? []).join(', ')} or wherever those paths point, but no file matches them, so nothing was searched and this check was NOT evaluated (decided in ${law.sourceAdr}). ${scopeHint(root, check.paths, files)}`,
            { paths: check.paths, pattern: check.pattern },
          )
          break
        }
        const expression = compileCheckPattern(check.pattern, check.flags)
        if (expression === null) break
        const hits = []
        for (const path of scope) {
          const read = readProjectFile(root, path, budget)
          if (read.over !== undefined) {
            reportOverBudget(read.over)
            continue
          }
          if (read.error !== undefined) continue
          const match = expression.exec(read.text)
          if (match !== null) {
            hits.push({ path, line: lineAt(read.text, match.index), text: match[0].slice(0, 200) })
          }
        }
        if (hits.length > 0) {
          fail(
            'CODE_TEXT_FORBIDDEN_PRESENT',
            `law "${law.id}" forbids ${JSON.stringify(check.pattern)} under ${(check.paths ?? []).join(', ')}; ${hits.length} file(s) match, first ${hits[0].path}:${hits[0].line} (decided in ${law.sourceAdr})`,
            { paths: check.paths, pattern: check.pattern, matches: hits.slice(0, 20) },
          )
        }
        break
      }
      case 'required_dependency':
      case 'forbidden_dependency': {
        checked += 1
        if (dependencies.manifests.length === 0) {
          fail(
            'CODE_REQUIRED_DEPENDENCY_MISSING',
            `law "${law.id}" asks about dependencies, but this project declares none: no package.json, requirements*.txt, pyproject.toml, Pipfile or environment.yml was found, so nothing was searched (decided in ${law.sourceAdr})`,
            { patterns: check.patterns },
          )
          break
        }
        const wanted = (check.patterns ?? []).map((entry) => String(entry).toLowerCase())
        // A dependency check with nothing to look for found nothing and reported the
        // law satisfied. The compiler refuses this shape, and the verifier is also
        // callable with a bundle it did not compile — so the empty case is a
        // violation here too rather than a vacuous pass.
        if (wanted.length === 0) {
          fail(
            check.type === 'required_dependency' ? 'CODE_REQUIRED_DEPENDENCY_MISSING' : 'CODE_FORBIDDEN_DEPENDENCY_PRESENT',
            `law "${law.id}" declares a ${check.type} check with no "patterns", so it names no dependency: a check that looks for nothing proves nothing (decided in ${law.sourceAdr})`,
            { checkType: check.type },
          )
          break
        }
        const found = wanted.filter((name) => dependencies.names.has(name))
        if (check.type === 'required_dependency') {
          const missing = wanted.filter((name) => !dependencies.names.has(name))
          if (missing.length > 0) {
            fail(
              'CODE_REQUIRED_DEPENDENCY_MISSING',
              `law "${law.id}" requires the dependency ${missing.map((name) => JSON.stringify(name)).join(', ')}; declared dependencies are in ${dependencies.manifests.join(', ')} and none of those names appear (decided in ${law.sourceAdr})`,
              { patterns: check.patterns, missing, manifests: dependencies.manifests },
            )
          }
        } else if (found.length > 0) {
          fail(
            'CODE_FORBIDDEN_DEPENDENCY_PRESENT',
            `law "${law.id}" forbids the dependency ${found.map((name) => JSON.stringify(name)).join(', ')}, which ${dependencies.manifests.join(', ')} declares (decided in ${law.sourceAdr})`,
            { patterns: check.patterns, found, manifests: dependencies.manifests },
          )
        }
        break
      }
      case 'path_boundary': {
        checked += 1
        const zone = (config?.zones ?? []).find((entry) => entry.id === check.zone)
        if (zone === undefined) {
          fail(
            'LAW_ZONE_MISSING',
            `law "${law.id}" declares a path_boundary for zone ${JSON.stringify(check.zone)}, which the manifest does not declare (decided in ${law.sourceAdr})`,
            { zone: check.zone },
          )
          break
        }
        const offenders = []
        for (const file of files) {
          if (zoneFor(file, [zone]) === null) continue
          for (const deny of check.deny ?? []) {
            if (matchFiles([file], deny).length > 0) offenders.push({ path: file, deny })
          }
        }
        if (offenders.length > 0) {
          fail(
            'CODE_FORBIDDEN_GLOB_PRESENT',
            `law "${law.id}" denies zone "${check.zone}" the paths ${(check.deny ?? []).join(', ')}; ${offenders.length} file(s) violate it, first ${offenders[0].path} (decided in ${law.sourceAdr})`,
            { zone: check.zone, deny: check.deny, offenders: offenders.slice(0, 20) },
          )
          break
        }
        // A deny glob is repository-relative, and matching it against files the
        // ZONE owns means a deny that cannot overlap the zone's own paths can
        // never fire. Reporting that is the difference between a law that holds
        // and a law that only looks like it does: the design brief's own example
        // (`zone: auth`, `deny: src/legacy/**`) can never match a file under
        // `src/auth/**`, so it enforces nothing while reading as a restriction.
        //
        // The test is a PROOF, not a guess. Comparing the two globs as path strings
        // declared any leading-`**` deny non-overlapping — `**/legacy/**` was
        // reported as enforcing nothing while `matchFiles` proved it matched a file
        // the zone owned. Now only a divergence between two non-empty literal
        // prefixes counts, and a deny that starts with a wildcard is always treated
        // as overlapping.
        for (const deny of check.deny ?? []) {
          const cannotOverlap = zone.paths.every((managed) => globsProvablyDisjoint(deny, managed))
          if (cannotOverlap) {
            fail(
              'DYNAMIC_REVIEW_REQUIRED',
              `law "${law.id}" denies zone "${check.zone}" the path ${JSON.stringify(deny)}, but that zone manages ${zone.paths.join(', ')}, and the two share no literal leading path, so the deny cannot match a file the zone owns and the check enforces nothing (decided in ${law.sourceAdr})`,
              { zone: check.zone, deny },
            )
          }
        }
        break
      }
      case 'required_text_glob':
      case 'forbidden_text_glob': {
        checked += 1
        const scope = selectFiles(files, check.paths)
        // Both halves of the family need this guard, not only the positive one. A
        // `forbidden_text_glob` whose globs select nothing found no offender and
        // reported the law satisfied — over a tree that did contain the forbidden
        // text, since nothing was read. "Nothing was searched" is not evidence, and
        // an exclude pattern (`!src/**`) or a stale glob is an ordinary way to get
        // there.
        if (scope.length === 0) {
          fail(
            'CODE_TEXT_SCOPE_EMPTY',
            check.type === 'required_text_glob'
              ? `law "${law.id}" requires the text ${JSON.stringify(check.pattern)} under ${(check.paths ?? []).join(', ')}, but the globs select no file, so nothing was searched and this check was NOT evaluated (decided in ${law.sourceAdr}). ${scopeHint(root, check.paths, files)}`
              : `law "${law.id}" forbids ${JSON.stringify(check.pattern)} under ${(check.paths ?? []).join(', ')}, but the globs select no file, so nothing was searched and this check was NOT evaluated (decided in ${law.sourceAdr}). ${scopeHint(root, check.paths, files)}`,
            { paths: check.paths, pattern: check.pattern },
          )
          break
        }
        const expression = compileCheckPattern(check.pattern, check.flags)
        if (expression === null) break
        const hits = []
        for (const path of scope) {
          const read = readProjectFile(root, path, budget)
          if (read.over !== undefined) {
            reportOverBudget(read.over)
            continue
          }
          if (read.error !== undefined) continue
          const match = expression.exec(read.text)
          if (match !== null) {
            hits.push({ path, line: lineAt(read.text, match.index), text: match[0].slice(0, 200) })
          }
        }
        if (check.type === 'required_text_glob') {
          // `anyOf` decides between "every selected file must match" and "at least
          // one must". A boundary law's positive half usually wants the latter.
          const satisfied = check.anyOf === true ? hits.length > 0 : hits.length === scope.length
          if (!satisfied) {
            fail(
              'CODE_REQUIRED_TEXT_MISSING',
              `law "${law.id}" requires the text ${JSON.stringify(check.pattern)} ${check.anyOf === true ? 'in at least one of' : 'in every file selected by'} ${(check.paths ?? []).join(', ')}; ${scope.length} file(s) were searched and ${hits.length} matched (decided in ${law.sourceAdr})`,
              { paths: check.paths, pattern: check.pattern, searched: scope.slice(0, 20), matched: hits.length },
            )
          }
        } else if (hits.length > 0) {
          // Every match is reported, not just the first: a boundary that three files
          // cross is three edits, and naming one sends the reader back for the rest.
          for (const hit of hits.slice(0, 20)) {
            fail(
              'CODE_TEXT_FORBIDDEN_PRESENT',
              `law "${law.id}" forbids ${JSON.stringify(check.pattern)} under ${(check.paths ?? []).join(', ')}; ${hit.path}:${hit.line} matches (decided in ${law.sourceAdr})`,
              { path: hit.path, line: hit.line, pattern: check.pattern, text: hit.text },
            )
          }
          if (hits.length > 20) {
            fail(
              'CODE_TEXT_FORBIDDEN_PRESENT',
              `law "${law.id}" forbids ${JSON.stringify(check.pattern)} under ${(check.paths ?? []).join(', ')}; ${hits.length - 20} further match(es) were not listed (decided in ${law.sourceAdr})`,
              { pattern: check.pattern, remaining: hits.length - 20 },
            )
          }
        }
        break
      }
      case 'required_file_in_list': {
        checked += 1
        // The claim has two halves: the file ships, AND the installer copies it. Only
        // the second was ever read, so a law saying "plugins/demo/b.mjs ships" was
        // satisfied by a package manifest naming a file that did not exist — while
        // the check's own failure message asserted that it did. Membership in a list
        // is not existence, so existence is checked first.
        if (!pathOnDisk(root, check.path).exists) {
          fail(
            'CODE_REQUIRED_FILE_MISSING',
            `law "${law.id}" holds that ${check.contains} ships, but ${check.path} does not exist in the repository (decided in ${law.sourceAdr})`,
            { path: check.path, contains: check.contains },
          )
          break
        }
        const keys = Array.isArray(check.keys) ? check.keys : []
        const { list, error, over } = readListAt(root, check.list, keys, budget)
        if (list === null) {
          if (over !== undefined) {
            reportOverBudget(over)
            break
          }
          fail(
            'CODE_REQUIRED_FILE_MISSING',
            `law "${law.id}" wants to confirm ${check.contains} ships, but ${error} (decided in ${law.sourceAdr})`,
            { list: check.list, contains: check.contains, error },
          )
          break
        }
        const base = check.containsIs === 'basename' ? check.contains.replace(/^.*\//, '') : check.contains
        if (!list.includes(base)) {
          fail(
            'CODE_REQUIRED_FILE_MISSING',
            `${check.contains} exists in the repository but is not listed in ${check.list}${keys.length === 0 ? '' : `.${keys.join('.')}`}, so an installed copy would be missing it (decided in ${law.sourceAdr})`,
            { list: check.list, contains: check.contains, listed: list.length },
          )
        }
        break
      }
      case 'command': {
        if (runCommand === null) {
          // Reported as pending rather than passed. A command check is the one that
          // can prove an invariant no pattern decides, and pretending it held
          // because nobody ran it is the exact failure this subsystem removes.
          pending.push({ check: check.type, run: check.run, reason: 'no command runner was supplied' })
          break
        }
        checked += 1
        let outcome
        try {
          outcome = await runCommand(check.run, {
            timeoutMs: typeof check.timeoutMs === 'number' ? check.timeoutMs : DEFAULT_COMMAND_TIMEOUT_MS,
            cwd: root,
          })
        } catch (error) {
          fail(
            'CODE_COMMAND_FAILED',
            `law "${law.id}" runs ${JSON.stringify(check.run)} to check its invariant, and the command could not be run: ${String(error)} (decided in ${law.sourceAdr})`,
            { run: check.run },
          )
          break
        }
        if (outcome.code !== 0) {
          // `stderr` is usually where a failure explains itself, but `node --test`
          // writes its whole report to STDOUT and leaves stderr empty — and an
          // empty-but-present stderr made this message read "(no output)" while the
          // reason sat one field away. The first stream with content wins, and the
          // other is the fallback rather than being dropped.
          const detail =
            String(outcome.stderr ?? '').trim() || String(outcome.stdout ?? '').trim() || '(no output on either stream)'
          fail(
            'CODE_COMMAND_FAILED',
            `law "${law.id}" holds that ${check.expects ?? 'this command succeeds'}, but ${JSON.stringify(check.run)} exited ${outcome.code}${outcome.signal === null || outcome.signal === undefined ? '' : ` on ${outcome.signal}`}: ${detail.slice(0, 600)} (decided in ${law.sourceAdr})`,
            {
              run: check.run,
              // `exitCode`, NOT `code`: a problem record's own `code` is the stable
              // vocabulary value, and merging the process status into it produced
              // problems whose code was the number 7 — a value a caller branching on
              // the code cannot do anything with.
              exitCode: outcome.code,
              signal: outcome.signal ?? null,
              stdout: String(outcome.stdout ?? '').slice(0, 2000),
            },
          )
          break
        }

        // A zero exit is not the whole claim once a law asserts on OUTPUT. The
        // failure this closes: a law that says "the report names the law it judged"
        // was satisfied by a command that printed nothing at all, because exiting
        // zero was the only thing checked.
        //
        // Assertions are evaluated PER STREAM, never over a join. `stdout + "\n" +
        // stderr` looked convenient and was wrong in both directions: a pattern could
        // match across the boundary between two streams (a newline no single stream
        // contains), and a `$`-anchored pattern that exactly matched stdout failed by
        // default because the joined string continued into stderr. `both` therefore
        // means "either stream, each exactly as the process wrote it": a positive
        // assertion must hold in at least one stream, and a negative assertion must
        // hold in both, because "the command must not print X" is not satisfied by
        // printing it on the other stream.
        const stream = check.stream ?? 'both'
        const stdout = String(outcome.stdout ?? '')
        const stderr = String(outcome.stderr ?? '')
        const streams =
          stream === 'stdout'
            ? [['stdout', stdout]]
            : stream === 'stderr'
              ? [['stderr', stderr]]
              : [
                  ['stdout', stdout],
                  ['stderr', stderr],
                ]
        const nameOf = (entry) => entry[0]
        const mismatches = []
        if (typeof check.outputContains === 'string' && !streams.some(([, text]) => text.includes(check.outputContains))) {
          mismatches.push(
            `its ${stream === 'both' ? 'stdout or stderr does' : `${stream} does`} not contain ${JSON.stringify(check.outputContains)}`,
          )
        }
        if (typeof check.outputNotContains === 'string') {
          const offenders = streams.filter(([, text]) => text.includes(check.outputNotContains))
          if (offenders.length > 0) {
            mismatches.push(
              `its ${offenders.map(nameOf).join(' and ')} contains ${JSON.stringify(check.outputNotContains)}, which the law forbids`,
            )
          }
        }
        if (typeof check.outputMatches === 'string') {
          const unsafe = regexUnsafeReason(check.outputMatches)
          let pattern = null
          try {
            pattern = unsafe === null ? new RegExp(check.outputMatches) : null
          } catch {
            pattern = null
          }
          // A pattern that cannot be compiled is NOT a pass. The compiler reports it
          // as a malformed check, and a verifier that skipped it here would let a
          // project that never compiles its corpus verify clean. An unsafe pattern is
          // refused for the same reason and with the same outcome — a mismatch, which
          // fails the law rather than hanging the event loop.
          if (unsafe !== null) mismatches.push(`the declared pattern ${JSON.stringify(check.outputMatches)} can backtrack catastrophically (${unsafe}), so it was not executed`)
          else if (pattern === null) mismatches.push(`the declared pattern ${JSON.stringify(check.outputMatches)} is not a usable regular expression`)
          else if (!streams.some(([, text]) => pattern.test(text))) {
            mismatches.push(
              `its ${stream === 'both' ? 'stdout and stderr do' : `${stream} does`} not match /${check.outputMatches}/`,
            )
          }
        }
        const observed = streams
          .map(([name, text]) => `${name}: ${text}`)
          .join('\n')
        if (mismatches.length > 0) {
          fail(
            'CODE_COMMAND_OUTPUT_MISMATCH',
            `law "${law.id}" holds that ${check.expects ?? 'this command succeeds'} and asserts on what it prints, but ${JSON.stringify(check.run)} exited 0 and ${mismatches.join('; ')}; read from ${stream}: ${observed.trim().slice(0, 600) || '(no output)'} (decided in ${law.sourceAdr})`,
            {
              run: check.run,
              stream,
              outputContains: check.outputContains ?? null,
              outputMatches: check.outputMatches ?? null,
              outputNotContains: check.outputNotContains ?? null,
              stdout: stdout.slice(0, 2000),
              stderr: stderr.slice(0, 2000),
            },
          )
        }
        break
      }
      default: {
        // An unknown type cannot be evaluated, and pretending it passed is the
        // one failure a gate must never have.
        fail(
          'DYNAMIC_REVIEW_REQUIRED',
          `law "${law.id}" declares the check type ${JSON.stringify(check.type)}, which this verifier does not implement, so the check was NOT evaluated`,
          { checkType: check.type },
        )
      }
    }
  }

  return { problems, checked, pending }
}

/**
 * Wraps a command runner so each distinct command runs once per verification.
 *
 * A corpus routinely names the same command from several laws — this kit declares one
 * test suite fourteen times — and executing it once per law costs fourteen times the wall
 * clock for one answer. Within a single verification the tree and the working directory
 * do not change, so an identical command has an identical result and re-running it proves
 * nothing new. The key is the command plus the options that change its meaning (`cwd`,
 * `timeoutMs`); the promise is cached so concurrent identical calls share one run.
 *
 * **Command checks are therefore assumed to be read-only with respect to the project.**
 * A command that mutated a file a later identical command reads would now observe the
 * first run's result instead of its own. A check whose job is to change the tree is not a
 * check: verification must not depend on the order in which laws are evaluated.
 *
 * @param runCommand - The caller's `(run, options) => Promise<outcome>`.
 * @returns A runner with the same signature that executes each distinct call once.
 */
function memoizeCommandRunner(runCommand) {
  const cache = new Map()
  return (run, options = {}) => {
    const key = `${options.cwd ?? ''}\u0000${options.timeoutMs ?? ''}\u0000${run}`
    let outcome = cache.get(key)
    if (outcome === undefined) {
      outcome = runCommand(run, options)
      cache.set(key, outcome)
    }
    return outcome
  }
}

/**
 * Runs the full static verification of a project against its compiled laws.
 *
 * @param options - `{ root, bundle, config, manifest, files, runCommand, budget }`. `files`
 *   may be supplied to avoid re-walking in a caller that already did; otherwise the
 *   project is walked once. `runCommand` is optional: without it, `command` checks
 *   are reported as pending rather than passed, so the verifier stays a pure
 *   filesystem reader unless a caller deliberately opts into running something. A
 *   supplied runner is memoised per distinct command for the duration of this call —
 *   see `memoizeCommandRunner` for why, and for the read-only assumption it rests on.
 *   `budget` is a work-budget tracker (see `createWorkBudget`); without one every read and
 *   the walk are unbounded, which is the CLI path. When one is supplied and it is exceeded,
 *   a `WORK_BUDGET_EXCEEDED` summary problem is added and no clean verdict is possible.
 * @returns `{ ok, report, problems }` where `report.counts` records how many laws
 *   and checks were actually evaluated. A report whose `checksEvaluated` is zero
 *   with `ok: true` is a contradiction, and the gates in this kit assert that it
 *   never happens. `report.pending` names every check that could not be evaluated.
 */
export async function verifyProject({ root, bundle, config, manifest = null, files = null, runCommand = null, budget = null }) {
  const started = Date.now()
  const problems = []
  const fileList = files ?? listFiles(root, '', budget)
  const dependencies = readDeclaredDependencies(root, fileList, manifest, budget)
  problems.push(...dependencies.problems)

  // One process per distinct command, not one per law that names it.
  const runOnce = runCommand === null ? null : memoizeCommandRunner(runCommand)

  let checksEvaluated = 0
  const pending = []
  const lawResults = []
  for (const law of bundle?.laws ?? []) {
    const result = await verifyLaw({ root, law, files: fileList, dependencies, config, runCommand: runOnce, budget })
    checksEvaluated += result.checked
    pending.push(...result.pending.map((entry) => ({ lawId: law.id, ...entry })))
    problems.push(...result.problems)
    const checks = Array.isArray(law.checks) ? law.checks : []
    // A law nobody checks is not a law this verification enforced, and silence about
    // it is the failure mode the whole subsystem exists to remove. Saying WHY it
    // cannot be checked is an answer a reader can weigh; saying nothing is the
    // exemption that no longer passes. The reason must be REAL text: an empty or
    // whitespace string is silence wearing the field's name.
    const reason = typeof law.unenforced === 'string' ? law.unenforced.trim() : ''
    if (checks.length === 0 && reason.length === 0) {
      problems.push(
        problem(
          'LAW_UNCHECKED',
          `law "${law.id}" (${law.sourceAdr}) declares no check, so nothing about the code can fail because of it: add a check, or declare "unenforced" with the reason it cannot be machine-checked`,
          law.id,
          { lawId: law.id, sourceAdr: law.sourceAdr },
        ),
      )
    }
    lawResults.push({
      lawId: law.id,
      sourceAdr: law.sourceAdr,
      checks: checks.length,
      unenforced: reason.length === 0 ? null : reason,
      evaluated: result.checked,
      pending: result.pending.length,
      violations: result.problems.length,
    })
  }

  if ((bundle?.laws ?? []).length > 0 && pending.length > 0) {
    // "A check that could not run is not a pass" is this subsymbol's own rule, and it
    // has to hold for SOME as well as for NONE. The tool surface deliberately supplies
    // no command runner, so a session verification evaluated the filesystem checks and
    // left every `command` check pending — and then reported `ok: true` to the agent
    // that was told this is the gate, while the CLI on the same tree evaluated all of
    // them and could be red. Two answers to one question, and the optimistic one went
    // to the agent.
    const declared = (bundle?.laws ?? []).reduce(
      (total, law) => total + (Array.isArray(law.checks) ? law.checks.length : 0),
      0,
    )
    problems.push(
      checksEvaluated === 0
        ? problem(
            'VERIFY_NOTHING_EVALUATED',
            `this verification evaluated no check at all: ${pending.length} check(s) could not be evaluated, so nothing about the code was tested. A law may declare a "command" check, which runs only when the caller supplies a command runner (the CLI does, the tool surface deliberately does not), and that is the usual cause`,
            null,
            { pending: pending.length, laws: (bundle?.laws ?? []).length },
          )
        : problem(
            'VERIFY_INCOMPLETE',
            `this verification evaluated ${checksEvaluated} of the ${declared} check(s) these laws declare and left ${pending.length} unevaluated, so it is not a pass: an unevaluated check is not a check that held. A "command" check runs only when the caller supplies a command runner — the CLI supplies one, the tool surface deliberately does not, so run the gate from a shell before calling anything verified`,
            null,
            { evaluated: checksEvaluated, declared, pending: pending.length },
          ),
    )
  }

  if ((bundle?.laws ?? []).length > 0 && pending.length === 0 && checksEvaluated === 0) {
    // The other half of "nothing was evaluated": a corpus whose laws declare no check
    // at all — each one either lists none, or states in `unenforced` why nothing can
    // check it. Nothing pending, so the block above never fired, and the run reported
    // `ok: true` with `checksEvaluated: 0` — the contradiction the report's own
    // contract forbids, and the exact state `ratchet_state` already refuses to call
    // verified. Two subsystems, one question, opposite answers; the pessimistic one is
    // the correct one, so the gate now agrees with the state layer.
    //
    // Scoped to `declared === 0` on purpose. A law whose check is of a type this
    // verifier does not implement also evaluates nothing, and it is already reported
    // `DYNAMIC_REVIEW_REQUIRED` — a second problem saying "nothing ran" would describe
    // the symptom of a defect the reader has already been told about, once per law.
    const declared = lawResults.reduce((total, entry) => total + entry.checks, 0)
    if (declared === 0) {
      const unenforcedCount = lawResults.filter((entry) => entry.unenforced !== null).length
      problems.push(
        problem(
          'VERIFY_NOTHING_EVALUATED',
          `this verification evaluated no check at all: the ${lawResults.length} law(s) in force declare none that can be evaluated${unenforcedCount === 0 ? '' : ` (${unenforcedCount} state in "unenforced" why nothing can check them)`}, so a clean verdict would prove nothing about the code. Declare a check, or treat this project as unverified`,
          null,
          { laws: lawResults.length, unenforced: unenforcedCount, declared: 0 },
        ),
      )
    }
  }

  if ((bundle?.laws ?? []).length === 0) {
    // Deliberately NOT the same code as a decisions directory with no ADRs. This
    // is a project whose corpus parsed but which has no law IN FORCE — every record
    // is proposed, rejected or withdrawn. That is a legitimate state, and reporting
    // it as an empty corpus would send a reader hunting for a problem that is
    // actually an unapproved proposal.
    problems.push(
      problem(
        'LAWS_NONE',
        'no law is in force, so this verification examined nothing and proves nothing; either all decisions are still proposed, or the corpus declares none',
      ),
    )
  }

  // The operation's own budget summary, added once, after every check has had its chance to
  // report the specific file it could not read. A run that exhausted the budget evaluated only
  // part of the tree, so this makes `ok` false regardless of what the partial reads found.
  const budgetSummary = budgetProblem(budget)
  if (budgetSummary !== null) problems.push(budgetSummary)

  const report = {
    kind: VERIFY_REPORT_KIND,
    project: config?.project ?? null,
    root,
    specHash: bundle === null ? null : bundleHash(bundle),
    // The tree this verdict applies to. Without it the record answers only "which
    // laws did you judge", and `status` kept calling an edited tree verified.
    codeHash: codeHashFor(root, fileList, budget === null || budget === undefined ? {} : budget.limits),
    // And the authority table it was judged under — see `configHashFor`.
    configHash: configHashFor(config),
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    counts: {
      filesWalked: fileList.length,
      laws: (bundle?.laws ?? []).length,
      checksDeclared: (bundle?.laws ?? []).reduce(
        (total, law) => total + (Array.isArray(law.checks) ? law.checks.length : 0),
        0,
      ),
      checksEvaluated,
      errors: problems.length,
      warnings: 0,
      checksPending: pending.length,
    },
    dependencyManifests: dependencies.manifests,
    pending,
    laws: lawResults,
    problems,
  }

  return { ok: problems.length === 0, report, problems }
}

/** Re-exported so a caller needs one import for the whole verify path. */
export { PROBLEM_CODES }
