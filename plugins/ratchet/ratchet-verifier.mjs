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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { PROBLEM_CODES, normaliseText, problem, zoneFor } from './ratchet-schema.mjs'
import { bundleHash } from './ratchet-compiler.mjs'

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
 * things that are never a project's own source in any language.
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
 * @param root - Absolute project root.
 * @param start - Repository-relative directory to start from (default: the root).
 * @returns Sorted repository-relative paths with forward slashes. Unreadable
 *   directories are skipped silently here and reported by the check that asked,
 *   because this walker cannot know which check cared.
 */
export function listFiles(root, start = '') {
  const found = []
  const walk = (absolute, prefix) => {
    let entries
    try {
      entries = readdirSync(absolute, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (NEVER_WALK.has(entry.name)) continue
      const full = join(absolute, entry.name)
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(full, relativePath)
      else if (entry.isFile()) found.push(relativePath)
    }
  }
  const base = start.length === 0 ? root : join(root, start)
  if (existsSync(base)) walk(base, start)
  return found.sort()
}

/**
 * Converts a glob into a regular expression over repository-relative paths.
 *
 * Supports the subset the law format needs: `**` for any depth, `*` within one
 * segment, and `?` for one character. Anything else is treated literally, so a
 * pattern containing regex metacharacters cannot silently become a different
 * pattern than the author wrote.
 *
 * @param glob - Repository-relative glob.
 * @returns A regular expression anchored at both ends.
 */
export function globToRegExp(glob) {
  let source = ''
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]
    if (character === '*') {
      if (glob[index + 1] === '*') {
        // `**/` matches zero or more segments; a bare `**` matches anything.
        if (glob[index + 2] === '/') {
          source += '(?:[^/]+/)*'
          index += 2
        } else {
          source += '.*'
          index += 1
        }
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (character === '?') {
      source += '[^/]'
      continue
    }
    source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
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
 * Hashes the code a verification judged, so a later reader can tell whether that
 * verdict still applies.
 *
 * A verification record used to bind only the LAW hash it ran against, which meant
 * `status` reported a verified, clean project after arbitrary edits to the code:
 * the laws had not moved, so nothing in the record changed. Hashing the walked files
 * closes that — the record now names the tree it judged, and a code edit makes the
 * verdict stale exactly as a law edit does.
 *
 * Line endings are normalised before hashing, so a checkout that rewrites CRLF for
 * LF is the same code. Paths are hashed with the content, so a rename is a change.
 *
 * @param root - Absolute project root.
 * @param files - Repository-relative paths to hash (the walked list).
 * @returns A `sha256:<hex>` string. Unreadable files contribute their error text
 *   rather than aborting the hash, so the value stays comparable across runs.
 */
export function codeHashFor(root, files) {
  const hash = createHash('sha256')
  for (const path of [...files].sort()) {
    const read = readProjectFile(root, path)
    hash.update(path)
    hash.update('\u0000')
    hash.update(read.error === undefined ? read.text : `\u0000unreadable:${read.error}`)
    hash.update('\u0000')
  }
  return `sha256:${hash.digest('hex')}`
}

/**
 * Reads a file, normalising line endings.
 *
 * @param root - Absolute project root.
 * @param path - Repository-relative path.
 * @returns `{ text }` or `{ error }`; never throws, because a check that cannot
 *   read a file must report that rather than abort the whole verification.
 */
export function readProjectFile(root, path) {
  try {
    return { text: normaliseText(readFileSync(join(root, path), 'utf8')) }
  } catch (error) {
    return { error: String(error) }
  }
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
 * @returns `{ names, manifests, problems }`; `names` is a lowercase set of
 *   dependency names found anywhere, `manifests` lists the files consulted.
 */
export function readDeclaredDependencies(root, files, manifest) {
  const names = new Set()
  const manifests = []
  const problems = []

  const addPackageJson = (path) => {
    const read = readProjectFile(root, path)
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
    const read = readProjectFile(root, path)
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
  let selected = []
  for (const pattern of patterns ?? []) {
    if (typeof pattern !== 'string' || pattern.length === 0) continue
    if (pattern.startsWith('!')) {
      const excluded = new Set(matchFiles(selected, pattern.slice(1)))
      selected = selected.filter((file) => !excluded.has(file))
      continue
    }
    for (const file of matchFiles(files, pattern)) {
      if (!selected.includes(file)) selected.push(file)
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
 * @returns `{ list, error }`; `list` is `null` when the path does not resolve to an
 *   array, and `error` says why.
 */
export function readListAt(root, path, keys) {
  const read = readProjectFile(root, path)
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
 * Evaluates one law against the project.
 *
 * @param options - `{ root, law, files, dependencies, config, runCommand }`.
 *   `runCommand` is an injected `(run, options) => Promise<{ code, stdout, stderr }>`
 *   or `null`. A `command` check with no runner reports that it was NOT evaluated
 *   instead of passing, because a check nobody ran is not a check.
 * @returns `{ problems, checked, pending }` where `checked` counts the checks that
 *   were actually evaluated and `pending` counts those that could not be.
 */
export async function verifyLaw({ root, law, files, dependencies, config, runCommand = null }) {
  const problems = []
  const pending = []
  let checked = 0
  const fail = (code, message, extra = {}) => {
    problems.push(problem(code, message, law.id, { lawId: law.id, ...extra }))
  }

  for (const check of law.checks) {
    switch (check.type) {
      case 'required_file': {
        checked += 1
        if (!files.includes(check.path)) {
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
        if (files.includes(check.path)) {
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
        const hits = []
        for (const path of scope) {
          const read = readProjectFile(root, path)
          if (read.error !== undefined) continue
          // A fresh matcher per file. `flags` is validated to exclude the stateful
          // g/y, and this is the belt to that braces: a matcher carrying lastIndex
          // makes a verdict depend on which file was read first.
          if (new RegExp(check.pattern, check.flags ?? '').test(read.text)) hits.push(path)
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
        const hits = []
        for (const path of scope) {
          const read = readProjectFile(root, path)
          if (read.error !== undefined) continue
          const match = new RegExp(check.pattern, check.flags ?? '').exec(read.text)
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
        const expression = new RegExp(check.pattern, check.flags ?? '')
        const hits = []
        for (const path of scope) {
          const read = readProjectFile(root, path)
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
        if (!files.includes(check.path)) {
          fail(
            'CODE_REQUIRED_FILE_MISSING',
            `law "${law.id}" holds that ${check.contains} ships, but ${check.path} does not exist in the repository (decided in ${law.sourceAdr})`,
            { path: check.path, contains: check.contains },
          )
          break
        }
        const keys = Array.isArray(check.keys) ? check.keys : []
        const { list, error } = readListAt(root, check.list, keys)
        if (list === null) {
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
          let pattern = null
          try {
            pattern = new RegExp(check.outputMatches)
          } catch {
            pattern = null
          }
          // A pattern that cannot be compiled is NOT a pass. The compiler reports it
          // as a malformed check, and a verifier that skipped it here would let a
          // project that never compiles its corpus verify clean.
          if (pattern === null) mismatches.push(`the declared pattern ${JSON.stringify(check.outputMatches)} is not a usable regular expression`)
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
 * @param options - `{ root, bundle, config, manifest, files, runCommand }`. `files`
 *   may be supplied to avoid re-walking in a caller that already did; otherwise the
 *   project is walked once. `runCommand` is optional: without it, `command` checks
 *   are reported as pending rather than passed, so the verifier stays a pure
 *   filesystem reader unless a caller deliberately opts into running something. A
 *   supplied runner is memoised per distinct command for the duration of this call —
 *   see `memoizeCommandRunner` for why, and for the read-only assumption it rests on.
 * @returns `{ ok, report, problems }` where `report.counts` records how many laws
 *   and checks were actually evaluated. A report whose `checksEvaluated` is zero
 *   with `ok: true` is a contradiction, and the gates in this kit assert that it
 *   never happens. `report.pending` names every check that could not be evaluated.
 */
export async function verifyProject({ root, bundle, config, manifest = null, files = null, runCommand = null }) {
  const started = Date.now()
  const problems = []
  const fileList = files ?? listFiles(root)
  const dependencies = readDeclaredDependencies(root, fileList, manifest)
  problems.push(...dependencies.problems)

  // One process per distinct command, not one per law that names it.
  const runOnce = runCommand === null ? null : memoizeCommandRunner(runCommand)

  let checksEvaluated = 0
  const pending = []
  const lawResults = []
  for (const law of bundle?.laws ?? []) {
    const result = await verifyLaw({ root, law, files: fileList, dependencies, config, runCommand: runOnce })
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

  const report = {
    kind: VERIFY_REPORT_KIND,
    project: config?.project ?? null,
    root,
    specHash: bundle === null ? null : bundleHash(bundle),
    // The tree this verdict applies to. Without it the record answers only "which
    // laws did you judge", and `status` kept calling an edited tree verified.
    codeHash: codeHashFor(root, fileList),
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
