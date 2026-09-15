/**
 * PURPOSE
 *   Falsify THIS project's ratchet gate: break one generic invariant at a time, run
 *   the real verifier, and require the expected problem code to appear. A gate that
 *   passes proves nothing on its own — whoever wrote the check already believed it —
 *   so the only way to learn whether a guarantee is knowledge rather than belief is
 *   to try to make it pass wrongly.
 *
 *   Unlike `scripts/falsify-kit-gate.mjs`, which hardcodes the kit's own files and
 *   laws, this module is project-agnostic: it reads the project manifest, derives the
 *   set of paths that project declares as writable, and constructs each mutation from
 *   the laws the project actually has. Any project with a ratchet corpus can therefore
 *   falsify its own gate.
 *
 *   The breaker role's rules are constraints, not ceremony. A case falsifies ONE named
 *   claim inside ONE declared scope; a target outside that scope is reported and
 *   skipped, never written, because breaking something out of context is always
 *   possible and proves nothing. Every mutation is journaled before it is written and
 *   restored in a `finally`, every write is atomic, the persisted verification state is
 *   part of the journal, and a case whose check cannot fail is reported as `missed` —
 *   the finding that matters.
 *
 * INPUTS
 *   `falsify({ root, runCommand, verifyImpl, handleSignals })`
 *     root          absolute project root (required).
 *     runCommand    optional command runner passed through to the verifier, exactly as
 *                   `verify` takes it. The CLI supplies one; a test may omit it.
 *     verifyImpl    the verifier to drive, defaulting to `verify`. Injected so a test can
 *                   prove the `missed` path (a verifier that reports nothing) without a
 *                   broken gate on disk.
 *     handleSignals when `true`, `SIGINT`/`SIGTERM` are caught for the duration of the
 *                   run and restore the in-flight mutation before the process exits
 *                   130/143. Default `false`, because only a caller that owns the
 *                   process (the CLI) may decide to terminate it; the CLI passes `true`.
 *                   POSIX only: Windows has no catchable SIGTERM — the process is
 *                   terminated without running the handler — so there the journal plus
 *                   `falsify --recover` (or the next run) is what repairs the tree. That
 *                   path is tested on every platform.
 *   `recover({ root })` repairs a stale journal without running any case; the CLI's
 *   `falsify --recover` calls it.
 *
 * OUTPUTS
 *   A promise for
 *   `{ ok, root, cases, counts, recovered, warnings }` where each case is
 *   `{ id, claim, scope, status, expectedCode, observedCodes, target, detail }` and
 *   `status` is one of `detected`, `missed`, `skipped`, `out-of-scope`, `error`.
 *   `ok` is true iff no case is `missed` or `error`. `recovered` names the paths a stale
 *   journal from an earlier killed run repaired before this run started. When the project
 *   cannot be used at all the result is `{ ok: false, unusable: true, cases: [], counts }`,
 *   which the CLI reports as exit 2.
 *
 * KEYWORDS
 *   falsification, breaker, adversarial, ratchet, gate, project-agnostic, mutation,
 *   journal, atomic write, recovery, symlink containment
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `.dsh/project.json`, an unreadable manifest, the ratchet disabled, or a
 *     corpus that does not compile: reported unusable, no case runs, nothing is
 *     written.
 *   - A root that is the filesystem root or the user's home directory is refused
 *     outright, compared by REAL path so a symlink cannot defeat the refusal: a breaker
 *     must be scoped to one project.
 *   - A target that is outside the declared writable set, or under `.git`,
 *     `node_modules`, `sessions`, `storages`, `.credentials.yaml` or `settings.yaml`,
 *     is `out-of-scope` and is never written. A target whose deepest existing ancestor
 *     resolves through a symlink to outside the real project root is refused the same
 *     way, because `resolve()` alone does not follow symlinks.
 *   - A check type no law uses yields `skipped` with the reason, never a failure.
 *   - A law whose target is already in the violating state yields `skipped`: the gate
 *     already fails, so the failure cannot be attributed to this mutation. Every case
 *     proves that baseline structurally in its `plan` — from the compiled bundle for
 *     the unchecked-law case, from the target's on-disk state for the file/text ones.
 *     A corpus that already reports the expected code at compile time makes the whole
 *     run `unusable`, so no case runs against it at all.
 *   - `SIGINT` and `SIGTERM` are caught for the duration of a run when the caller passes
 *     `handleSignals: true` (the CLI does): the in-flight mutation, the journal and the
 *     persisted state are restored, then the process exits 130 or 143. A `finally` block
 *     alone does NOT cover these — Node terminates on an unhandled signal without
 *     unwinding — which is exactly why the handlers exist. **This is a POSIX guarantee.**
 *     Windows has no catchable `SIGTERM`: `process.kill(pid, 'SIGTERM')` terminates the
 *     process through the OS, the handler never runs, and the mutation stays on disk until
 *     the next run — or `falsify --recover` — repairs it from the journal. The journal and
 *     recovery path are therefore the cross-platform answer, and the handler is the
 *     POSIX fast path.
 *   - `SIGKILL` cannot be caught by any process, so a `kill -9` mid-run is unrecoverable
 *     IN THE INSTANT and may leave one mutation and the journal on disk. It is not
 *     lasting damage: every write is atomic (temp sibling + rename), so a kill cannot
 *     truncate a file, and the next `falsify` run — or `falsify --recover` — restores
 *     everything the journal records and deletes it.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse, resolve, sep } from 'node:path'
import { MANIFEST_PATH, problem } from './ratchet-schema.mjs'
import { compileProject } from './ratchet-compiler.mjs'
import { globToRegExp, listFiles, matchFiles, selectFiles } from './ratchet-verifier.mjs'
import { STATE_PATHS } from './ratchet-state.mjs'
import { verify } from './ratchet-ops.mjs'

/** Written content is capped so a mutation is never a payload. */
const MAX_WRITE_BYTES = 4096

/** Path segments a breaker must never touch, whatever the manifest declares. */
const FORBIDDEN_SEGMENTS = new Set(['.git', 'node_modules', 'sessions', 'storages'])

/** Machine-local files a breaker must never touch, whatever the manifest declares. */
const FORBIDDEN_FILES = new Set(['.credentials.yaml', 'settings.yaml'])

/** Default record directories when the manifest does not override them. */
const DEFAULT_DECISIONS_DIR = 'docs/adrs'
const DEFAULT_SOURCES_DIR = 'docs/ratchet/sources'
const DEFAULT_STATE_DIR = '.dsh/ratchet'

/** The recovery journal and its backup directory, inside the ratchet state directory. */
const JOURNAL_FILE = 'falsify-journal.json'
const BACKUP_DIR = 'falsify-backups'

/**
 * Suffix of the temporary sibling every atomic write goes through. Deterministic so a
 * recovery can remove the residue of a write that a hard kill interrupted.
 */
const TEMP_SUFFIX = '.falsify-tmp'

/**
 * Resolves the directories a project's ratchet configuration uses.
 *
 * @param manifest - Parsed `.dsh/project.json`, or null.
 * @returns `{ decisionsDir, sourcesDir, stateDir }` with the manifest's values or the
 *   documented defaults. Never throws on a malformed ratchet section.
 */
function recordDirs(manifest) {
  const ratchet = manifest !== null && typeof manifest === 'object' ? manifest.ratchet : null
  const section = ratchet !== null && typeof ratchet === 'object' ? ratchet : {}
  const pick = (value, fallback) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback)
  return {
    decisionsDir: pick(section.decisionsDir, DEFAULT_DECISIONS_DIR).replace(/\/+$/, ''),
    sourcesDir: pick(section.sourcesDir, DEFAULT_SOURCES_DIR).replace(/\/+$/, ''),
    stateDir: pick(section.stateDir, DEFAULT_STATE_DIR).replace(/\/+$/, ''),
  }
}

/**
 * The state directory the journal may live in, contained by the project.
 *
 * The journal and its backups are written from the manifest's `stateDir`, so a manifest
 * that points that value outside the project would otherwise move the breaker's own
 * writes out of the root before any case runs. An escaping value falls back to the
 * documented default rather than refusing the whole run: the journal location is not the
 * project's decision to weaponise, and a breaker that will not run at all is worse than
 * one that writes its journal somewhere safe.
 *
 * @param root - Absolute project root.
 * @param stateDir - The manifest's `stateDir`.
 * @returns A repository-relative state directory inside the root.
 */
function safeStateDir(root, stateDir) {
  return containment(root, stateDir).ok ? stateDir : DEFAULT_STATE_DIR
}

/**
 * The set of project-relative globs a breaker may write.
 *
 * The union of the manifest's `scopes` (path resolvers), the ratchet zones' `paths`,
 * and the ratchet's own record directories plus the manifest itself. Anything not
 * covered here is out of scope by definition: the point of the scoping model is that
 * a mutation must be one the project already agreed the ratchet works on.
 *
 * @param manifest - Parsed `.dsh/project.json`, or null.
 * @returns An array of globs. Empty for a manifest with no scopes and no zones.
 */
function writableGlobs(manifest) {
  const globs = new Set()
  const object = manifest !== null && typeof manifest === 'object' ? manifest : {}
  for (const scope of Array.isArray(object.scopes) ? object.scopes : []) {
    if (scope === null || typeof scope !== 'object') continue
    if (scope.resolver !== 'path' || typeof scope.root !== 'string' || scope.root.trim().length === 0) continue
    const base = scope.root.trim().replace(/\/+$/, '')
    globs.add(base)
    globs.add(`${base}/**`)
  }
  const ratchet = object.ratchet !== null && typeof object.ratchet === 'object' ? object.ratchet : {}
  for (const zone of Array.isArray(ratchet.zones) ? ratchet.zones : []) {
    if (zone === null || typeof zone !== 'object') continue
    for (const path of Array.isArray(zone.paths) ? zone.paths : []) {
      if (typeof path === 'string' && path.length > 0) globs.add(path)
    }
  }
  const dirs = recordDirs(object)
  globs.add(MANIFEST_PATH)
  globs.add(`${dirs.decisionsDir}/**`)
  globs.add(`${dirs.sourcesDir}/**`)
  globs.add(`${dirs.stateDir}/**`)
  return [...globs]
}

/**
 * The real path of a path, or its resolved path when it cannot be resolved.
 *
 * `realpathSync` follows symlinks, which is the point: the lexical checks cannot see
 * that a directory inside a declared scope points somewhere else on disk. When the call
 * fails — a platform without symlink support, an unreadable path — the resolved path is
 * returned so the caller still has a containment answer rather than an exception.
 *
 * @param path - Absolute or relative path.
 * @returns An absolute path.
 */
function realPathOf(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Decides whether one repository-relative path is contained by the project.
 *
 * Three independent refusals, because each catches a different mistake: a path that
 * escapes the root lexically, a path under a directory the breaker must never touch, and
 * a path whose deepest EXISTING ancestor resolves — through a symlink — outside the real
 * project root. The third is why `resolve()` alone is not enough: a symlinked directory
 * inside a declared scope would otherwise let a write land anywhere on the machine.
 *
 * @param root - Absolute project root.
 * @param relativePath - Repository-relative path, in either separator style.
 * @returns `{ ok: true, absolute }`, or `{ ok: false, reason }` naming the refusal.
 */
function containment(root, relativePath) {
  const posix = String(relativePath ?? '').split('\\').join('/')
  if (posix.length === 0) return { ok: false, reason: 'the target is empty' }
  if (posix.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(posix)) {
    return { ok: false, reason: 'the target escapes the project root' }
  }
  const rootAbsolute = resolve(root)
  const absolute = resolve(root, posix)
  if (absolute !== rootAbsolute && !absolute.startsWith(`${rootAbsolute}${sep}`)) {
    return { ok: false, reason: 'the target resolves outside the project root' }
  }
  const segments = posix.split('/')
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    return {
      ok: false,
      reason: `the target is under a forbidden directory (${segments.find((segment) => FORBIDDEN_SEGMENTS.has(segment))})`,
    }
  }
  if (FORBIDDEN_FILES.has(segments[segments.length - 1])) {
    return { ok: false, reason: 'the target is a machine-local file' }
  }
  // The deepest EXISTING ancestor is resolved, because the target itself may not exist
  // yet: `src/auth/new-file` must be judged by where its directory really is.
  const realRoot = realPathOf(rootAbsolute)
  let ancestor = absolute
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) {
      return { ok: false, reason: 'the target has no existing ancestor inside the project root' }
    }
    ancestor = parent
  }
  const realAncestor = realPathOf(ancestor)
  if (realAncestor !== realRoot && !realAncestor.startsWith(`${realRoot}${sep}`)) {
    return { ok: false, reason: 'the target resolves outside the project root through a symlink' }
  }
  return { ok: true, absolute }
}

/**
 * Decides whether one repository-relative path may be written.
 *
 * Containment plus the project's declared writable scopes: a path the project did not
 * declare the ratchet works on is out of scope by definition, because breaking it would
 * prove nothing.
 *
 * @param root - Absolute project root.
 * @param relativePath - Repository-relative path, in either separator style.
 * @param globs - The writable globs.
 * @returns `{ ok: true, absolute }`, or `{ ok: false, reason }` naming the refusal.
 */
function assertWritable(root, relativePath, globs) {
  const contained = containment(root, relativePath)
  if (!contained.ok) return contained
  const posix = String(relativePath ?? '').split('\\').join('/')
  if (!globs.some((glob) => globToRegExp(glob).test(posix))) {
    return { ok: false, reason: 'the target is outside the writable scope this project declares' }
  }
  return contained
}

/**
 * Reads a file's bytes, or null when it cannot be read.
 *
 * @param path - Absolute path.
 * @returns A Buffer, or null.
 */
function readBytes(path) {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

/**
 * Removes a file if it exists, ignoring an already-absent one.
 *
 * @param path - Absolute path.
 * @returns Nothing.
 */
function safeUnlink(path) {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // Restoration must not mask the case result with a cleanup failure.
  }
}

/**
 * Writes bytes, creating the parent directory. Used for journal and backup material,
 * where a non-atomic write of a file the journal can regenerate is acceptable.
 *
 * @param path - Absolute path.
 * @param bytes - Buffer or string to write.
 * @returns Nothing.
 */
function writeBytes(path, bytes) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
}

/**
 * The temporary sibling an atomic write goes through.
 *
 * @param absolute - Absolute target path.
 * @returns The temporary path.
 */
function tempSibling(absolute) {
  return `${absolute}${TEMP_SUFFIX}`
}

/**
 * Writes bytes to a file atomically.
 *
 * The bytes go to a temporary sibling and are then renamed over the target, so a kill can
 * never leave a truncated file at the target: the rename either happened or it did not.
 *
 * @param path - Absolute path.
 * @param bytes - Buffer or string to write.
 * @returns Nothing.
 */
function writeAtomic(path, bytes) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = tempSibling(path)
  writeFileSync(temporary, bytes)
  renameSync(temporary, path)
}

/**
 * A per-run mutation journal: the durable record that lets a hard-killed run be repaired.
 *
 * A signal handler can restore the mutation in flight, but SIGKILL cannot be caught at
 * all. So every mutated path is recorded here BEFORE it is written — with a sibling
 * backup of its original bytes, or the fact that it did not exist — and the journal is
 * persisted after each record. The next `falsify` run, or `ratchet falsify --recover`,
 * restores everything the journal names and deletes it.
 *
 * @param options - `{ root, stateDir }`.
 * @returns A journal with `path`, `record`, `restore`, `restoreAll` and `clear`.
 */
function createJournal({ root, stateDir }) {
  const journalPath = join(root, stateDir, JOURNAL_FILE)
  const backupRoot = join(root, stateDir, BACKUP_DIR)
  const entries = new Map()
  let sequence = 0

  const persist = () => {
    writeAtomic(journalPath, `${JSON.stringify({ version: 1, root, files: [...entries.values()] }, null, 2)}\n`)
  }

  return {
    path: journalPath,
    entries,
    /**
     * Records a path's original state before it is first mutated.
     *
     * The backup reaches disk before the journal names it, so a crash between the two
     * leaves an unreferenced backup rather than a journal entry with nothing to restore.
     * Recording an already-recorded path is a no-op, because the FIRST original is the
     * one that must come back.
     */
    record(relativePath) {
      if (entries.has(relativePath)) return
      const bytes = readBytes(join(root, relativePath))
      let backup = null
      if (bytes !== null) {
        sequence += 1
        backup = `${BACKUP_DIR}/${sequence}.bin`
        writeBytes(join(root, stateDir, `${BACKUP_DIR}/${sequence}.bin`), bytes)
      }
      entries.set(relativePath, { path: relativePath, existed: bytes !== null, backup })
      persist()
    },
    /** Restores one recorded path, then removes any temporary sibling left behind. */
    restore(relativePath) {
      const entry = entries.get(relativePath)
      if (entry === undefined) return
      const absolute = join(root, relativePath)
      try {
        if (entry.existed === true && typeof entry.backup === 'string') {
          // The backup path comes from the journal, which is a file an attacker (or a
          // corrupted write) can influence, so it is contained exactly like the entry
          // path: a `backup: "../../outside/secret"` used to copy bytes from OUTSIDE the
          // project into it. The journal lives under the state directory, so a legitimate
          // backup is always a path inside it.
          const backupAbsolute = resolve(root, stateDir, entry.backup)
          const backupsRoot = resolve(root, stateDir)
          const contained = backupAbsolute === backupsRoot || backupAbsolute.startsWith(`${backupsRoot}${sep}`)
          if (!contained) {
            process.stderr.write(
              `ratchet: refused to restore ${relativePath}: its journal backup ${JSON.stringify(entry.backup)} is outside ${stateDir}\n`,
            )
            return
          }
          const bytes = readBytes(backupAbsolute)
          if (bytes !== null) writeAtomic(absolute, bytes)
        } else {
          safeUnlink(absolute)
        }
      } finally {
        safeUnlink(tempSibling(absolute))
      }
    },
    restoreAll() {
      for (const relativePath of [...entries.keys()]) this.restore(relativePath)
    },
    /** Deletes the journal and its backups. Idempotent. */
    clear() {
      safeUnlink(journalPath)
      safeUnlink(tempSibling(journalPath))
      try {
        rmSync(backupRoot, { recursive: true, force: true })
      } catch {
        // A leftover backup directory is inert once the journal that named it is gone.
      }
    },
  }
}

/**
 * Repairs the damage a previous run left behind, from its journal.
 *
 * Restores every recorded path (recreating files that existed, removing files that did
 * not), removes the deterministic temporary sibling of each, and deletes the journal. It
 * never writes outside the project root: an entry that no longer passes containment is
 * reported and skipped rather than followed.
 *
 * @param options - `{ root, stateDir }`.
 * @returns `{ recovered, warnings }`.
 */
function recoverJournal({ root, stateDir }) {
  const journalPath = join(root, stateDir, JOURNAL_FILE)
  if (!existsSync(journalPath)) return { recovered: [], warnings: [] }
  const warnings = []
  const recovered = []
  let journal = null
  let unreadable = false
  try {
    journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  } catch (error) {
    unreadable = true
    warnings.push(
      `the journal at ${JOURNAL_FILE} could not be read (${String(error)}); the journal and its backups were left in place for inspection`,
    )
  }
  // A journal that cannot be parsed names no paths, so there is nothing to restore, and
  // deleting the backups would destroy the only copy of the originals. Leave both.
  if (unreadable) return { recovered, warnings }
  for (const entry of Array.isArray(journal?.files) ? journal.files : []) {
    const relativePath = typeof entry?.path === 'string' ? entry.path : null
    if (relativePath === null) continue
    const contained = containment(root, relativePath)
    if (!contained.ok) {
      warnings.push(`recovery skipped ${relativePath}: ${contained.reason}`)
      continue
    }
    try {
      if (entry.existed === true && typeof entry.backup === 'string') {
        // The backup path is journal DATA, so it is contained like the entry path: a
        // `backup: "../../outside/secret"` copied bytes from outside the project into it.
        // A legitimate backup always lives under the state directory the journal does.
        const backupsRoot = resolve(root, stateDir)
        const backupAbsolute = resolve(backupsRoot, entry.backup)
        const backupContained = backupAbsolute === backupsRoot || backupAbsolute.startsWith(`${backupsRoot}${sep}`)
        if (!backupContained) {
          warnings.push(`recovery refused ${relativePath}: its journal backup ${JSON.stringify(entry.backup)} is outside ${stateDir}`)
          continue
        }
        const bytes = readBytes(backupAbsolute)
        if (bytes === null) {
          warnings.push(`recovery could not find the backup for ${relativePath}`)
        } else {
          writeAtomic(contained.absolute, bytes)
          recovered.push(relativePath)
        }
      } else {
        safeUnlink(contained.absolute)
        recovered.push(relativePath)
      }
    } finally {
      safeUnlink(tempSibling(contained.absolute))
    }
  }
  try {
    rmSync(join(root, stateDir, BACKUP_DIR), { recursive: true, force: true })
  } catch {
    // Leftover backups are inert once the journal is gone.
  }
  safeUnlink(journalPath)
  safeUnlink(tempSibling(journalPath))
  return { recovered, warnings }
}

/**
 * Every `(law, check)` pair in the bundle whose check has the given type.
 *
 * @param laws - Compiled laws.
 * @param type - A check type, e.g. `required_file`.
 * @returns An array of `{ law, check }`.
 */
function checksOfType(laws, type) {
  const found = []
  for (const law of laws) {
    for (const check of Array.isArray(law.checks) ? law.checks : []) {
      if (check !== null && typeof check === 'object' && check.type === type) found.push({ law, check })
    }
  }
  return found
}

/**
 * Synthesises a short string a regular expression matches.
 *
 * A forbidden-text mutation has to make a file contain what the law forbids, and the
 * forbidden thing is a regex, so the literal pattern is not always a match (the
 * kit's own `@deepseek-ai/(dsh-tools|cordis)` is the proof: the pattern text does not
 * match itself). Candidates are derived by stripping grouping and quantifier syntax
 * and by splitting alternations, then the first one the real expression accepts is
 * used.
 *
 * @param pattern - The law's regular expression source.
 * @param flags - The law's flags, if any.
 * @returns A matching string, or null when none of the candidates match.
 */
function regexWitness(pattern, flags) {
  const cleanFlags = String(flags ?? '').replace(/[gy]/g, '')
  const candidates = new Set()
  const add = (value) => {
    if (typeof value === 'string' && value.length > 0 && value.length <= MAX_WRITE_BYTES) candidates.add(value)
  }
  add(pattern)
  for (const branch of String(pattern).split('|')) {
    add(branch)
    add(branch.replace(/[()]/g, ''))
    add(branch.replace(/\\(.)/g, '$1'))
    add(branch.replace(/[()]/g, '').replace(/\\(.)/g, '$1'))
    add(branch.replace(/[?*+]/g, '').replace(/\{\d+(,\d*)?\}/g, ''))
    add(branch.replace(/\[[^\]]*\]/g, ''))
    add(branch.replace(/\[([^\]]*)\]/g, '$1').replace(/[^A-Za-z0-9 _@/.-]/g, ''))
  }
  for (const candidate of candidates) {
    try {
      if (new RegExp(pattern, cleanFlags).test(candidate)) return candidate
    } catch {
      return null
    }
  }
  return null
}

/**
 * Renders one minimal ADR the falsifier can write.
 *
 * The records are constructed rather than copied so the module stays project-agnostic:
 * it emits only the mandatory frontmatter and sections the parser requires, points its
 * `source` at the manifest (which exists by the time a case runs), and declares the laws
 * or approval the case needs.
 *
 * @param options - `{ id, title, type, authority, status, approves, laws }`.
 * @returns The complete file text.
 */
function falsifyAdr({ id, title, type, authority, status, approves = [], laws = [] }) {
  const lines = [
    '---',
    `id: "${id}"`,
    `title: ${JSON.stringify(title)}`,
    `type: ${type}`,
    `status: ${status}`,
    'author:',
    `  authority: ${authority}`,
    '  name: ratchet-falsify',
    `created: "${new Date().toISOString()}"`,
    'source:',
    '  kind: file',
    `  path: ${MANIFEST_PATH}`,
    'zones: []',
    'supersedes: []',
  ]
  if (approves.length === 0) lines.push('approves: []')
  else {
    lines.push('approves:')
    for (const target of approves) lines.push(`  - "${target}"`)
  }
  if (laws.length === 0) lines.push('laws: []')
  else {
    lines.push('laws:')
    for (const law of laws) {
      lines.push(`  - op: ${law.op ?? 'upsert'}`)
      lines.push(`    id: ${law.id}`)
      lines.push(`    statement: ${JSON.stringify(law.statement)}`)
      if (law.unenforced !== undefined) lines.push(`    unenforced: ${JSON.stringify(law.unenforced)}`)
      if (law.checks !== undefined) {
        if (law.checks.length === 0) lines.push('    checks: []')
        else {
          lines.push('    checks:')
          for (const check of law.checks) lines.push(`      - type: ${check.type}`)
        }
      }
    }
  }
  lines.push(
    '---',
    '',
    '## Context',
    '',
    'Written by the ratchet falsifier to test one claim about the gate.',
    '',
    '## Decision',
    '',
    'A deliberately broken record, scoped to the claim under test.',
    '',
    '## Reasoning',
    '',
    'A gate is only as strong as a case that tries to make it pass wrongly.',
    '',
    '## Consequences',
    '',
    'None: this file is removed before the run finishes.',
    '',
  )
  return lines.join('\n')
}

/**
 * Refuses a root a breaker must never operate on, whatever the manifest says.
 *
 * Separate from {@link unusableProblem} so RECOVERY can use it without requiring a
 * readable manifest: a project whose manifest is missing or broken may still have a
 * journal that must be replayed, and refusing to do so would strand the damage.
 *
 * @param root - Absolute project root.
 * @returns `null` when the root is a usable directory, else a problem record.
 */
function rootProblem(root) {
  if (!existsSync(root)) return problem('MANIFEST_MISSING', `${root} does not exist`)
  let stats
  try {
    stats = statSync(root)
  } catch (error) {
    return problem('MANIFEST_MISSING', `${root} could not be inspected: ${String(error)}`)
  }
  if (!stats.isDirectory()) return problem('DIR_NOT_A_DIRECTORY', `${root} is not a directory`)
  // Compared against the REAL path, so a symlink to `/` or to a home directory cannot
  // defeat the refusal by arriving under a different spelling.
  const realRoot = realPathOf(root)
  if (realRoot === parse(realRoot).root || realRoot === realPathOf(homedir())) {
    return problem(
      'MANIFEST_INVALID',
      `refusing to operate on ${root}: it is the filesystem root or a home directory, and a breaker must be scoped to one project`,
    )
  }
  return null
}

/**
 * Verifies the project can be falsified at all, before any case runs.
 *
 * @param root - Absolute project root.
 * @returns `null` when usable, else a problem record the CLI renders as exit 2.
 */
function unusableProblem(root) {
  const base = rootProblem(root)
  if (base !== null) return base
  const manifestPath = join(root, MANIFEST_PATH)
  if (!existsSync(manifestPath)) {
    return problem(
      'MANIFEST_MISSING',
      `no ${MANIFEST_PATH} in ${root}; the ratchet reads its configuration from that file, so there is no scope to break`,
    )
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return problem('MANIFEST_INVALID', `${MANIFEST_PATH} is not valid JSON: ${String(error)}`)
  }
  if (manifest === null || typeof manifest !== 'object' || manifest.ratchet?.enabled !== true) {
    return problem(
      'RATCHET_DISABLED',
      `${MANIFEST_PATH} does not declare ratchet.enabled: true, so this project has no gate to falsify`,
    )
  }
  return null
}

/**
 * Runs one case and records its verdict.
 *
 * @param spec - A case definition: `{ id, claim, expectedCode, scope, plan }`.
 * @param context - `{ root, globs, files, laws, recordIds, freeId, runCommand, verifyImpl }`.
 * @returns The case result.
 */
async function runCase(spec, context, pendingRestore) {
  const result = {
    id: spec.id,
    claim: spec.claim,
    scope: typeof spec.scope === 'function' ? spec.scope(context) : spec.scope,
    status: 'skipped',
    expectedCode: spec.expectedCode,
    observedCodes: [],
    target: null,
    detail: null,
  }

  let plan
  try {
    plan = spec.plan(context)
  } catch (error) {
    result.status = 'error'
    result.detail = `could not plan the mutation: ${String(error)}`
    return result
  }
  if (plan === null || plan.status !== 'ready') {
    result.status = plan?.status ?? 'skipped'
    result.detail = plan?.detail ?? 'the case could not be applied'
    result.target = plan?.target ?? null
    if (plan?.expectedCode !== undefined) result.expectedCode = plan.expectedCode
    return result
  }

  const expectedCode = plan.expectedCode ?? spec.expectedCode
  result.expectedCode = expectedCode
  result.target = plan.target ?? null
  if (plan.detail !== undefined) result.detail = plan.detail

  // Each case records what it mutated through the context helpers; the journal can
  // restore that even after a hard kill. The in-flight restore is published BEFORE the
  // first write, so a signal that arrives mid-`mutate()` still finds what to undo. Both
  // paths are idempotent, so the handler and the normal `finally` may run in either order.
  context.resetTouched()
  const restoreMutation = () => context.restoreTouched()
  if (pendingRestore !== undefined) pendingRestore.current = restoreMutation

  try {
    plan.mutate()
  } catch (error) {
    try {
      restoreMutation()
    } catch {
      // The mutation failed, so there is likely nothing to restore; report the cause.
    }
    if (pendingRestore !== undefined) pendingRestore.current = null
    result.status = 'error'
    result.detail = `could not apply the mutation: ${String(error)}`
    return result
  }

  try {
    const outcome = await context.verifyImpl({ root: context.root, runCommand: context.runCommand })
    const observed = [...new Set((outcome?.problems ?? []).map((entry) => entry.code))]
    result.observedCodes = observed
    result.status = observed.includes(expectedCode) ? 'detected' : 'missed'
    if (result.status === 'missed') {
      result.detail = `the gate did not report ${expectedCode} after the mutation${result.detail === null ? '' : ` (${result.detail})`}`
    }
  } catch (error) {
    result.status = 'error'
    result.detail = `the verifier threw: ${String(error)}`
  } finally {
    try {
      restoreMutation()
    } catch (error) {
      result.status = 'error'
      result.detail = `the mutation could not be restored: ${String(error)}`
    } finally {
      if (pendingRestore !== undefined) pendingRestore.current = null
    }
  }
  return result
}

/**
 * The generic cases. Each names one claim, the scope it touches, and how to break it.
 *
 * Cases 1 and 2 always run on a compilable corpus; case 2 skips when the corpus already
 * declares an unchecked law, because then the expected problem is not the mutation's.
 * Cases 3–6 are conditional: when no law uses the check type they are `skipped` with the
 * reason, because a project is allowed not to use every check kind.
 */
const CASES = [
  {
    id: 'hand-written-approval',
    claim: 'an approval ADR with no well-formed ratification block puts no decision into force',
    expectedCode: 'RATIFICATION_UNPROVEN',
    scope: (context) => `${context.dirs.decisionsDir}/**`,
    plan(context) {
      const targetId = context.recordIds[0]
      if (targetId === undefined) return { status: 'skipped', detail: 'the corpus declares no decision to approve' }
      const id = context.freeId()
      const relative = `${context.dirs.decisionsDir}/${id}-falsify-approval.adr.md`
      const writable = assertWritable(context.root, relative, context.globs)
      if (!writable.ok) return { status: 'out-of-scope', target: relative, detail: writable.reason }
      const text = falsifyAdr({
        id,
        title: 'Falsify: an approval with no recorded consent',
        type: 'approval',
        authority: 'human',
        status: 'active',
        approves: [targetId],
      })
      return {
        status: 'ready',
        target: relative,
        detail: `an approval ADR naming decision ${targetId} while recording no channel, time or consent hash`,
        mutate: () => context.mutateFile(relative, text),
      }
    },
  },
  {
    id: 'law-with-no-check',
    claim: 'a law in force with no check and no stated reason is reported as unchecked',
    expectedCode: 'LAW_UNCHECKED',
    scope: (context) => `${context.dirs.decisionsDir}/**`,
    plan(context) {
      // A `detected` verdict asserts the MUTATION caused the problem, so a corpus that
      // already has an unchecked law would report `detected` for a case that proved
      // nothing. The compiled bundle says whether one exists, so the baseline is read
      // from it rather than paid for with a second verification — a verification here
      // would also run any `command` check the project declares a second time, which on
      // a slow gate doubled the run and outlived the caller's own timeout.
      if (context.laws.some((entry) => (entry.checks ?? []).length === 0 && !entry.unenforced)) {
        return {
          status: 'skipped',
          detail: 'the corpus already declares a law with no check and no stated reason, so LAW_UNCHECKED would not be attributable to this case',
        }
      }
      const id = context.freeId()
      const relative = `${context.dirs.decisionsDir}/${id}-falsify-unchecked.adr.md`
      const writable = assertWritable(context.root, relative, context.globs)
      if (!writable.ok) return { status: 'out-of-scope', target: relative, detail: writable.reason }
      const text = falsifyAdr({
        id,
        title: 'Falsify: a law with no check',
        type: 'adr',
        authority: 'human',
        status: 'active',
        laws: [
          {
            id: 'falsify.unchecked-law',
            statement: 'A law the falsifier declares with no machine check and no reason it cannot be checked.',
            checks: [],
          },
        ],
      })
      return {
        status: 'ready',
        target: relative,
        detail: 'an active human-authored law with an empty check list and no unenforced reason',
        mutate: () => context.mutateFile(relative, text),
      }
    },
  },
  {
    id: 'required-file-missing',
    claim: 'a required_file check fails when its file is removed',
    expectedCode: 'CODE_REQUIRED_FILE_MISSING',
    scope: 'the paths named by the corpus required_file checks',
    plan(context) {
      const entries = checksOfType(context.laws, 'required_file')
      if (entries.length === 0) return { status: 'skipped', detail: 'no law declares a required_file check' }
      const present = entries.filter(({ check }) => context.files.includes(check.path))
      if (present.length === 0) {
        return { status: 'skipped', detail: 'every required_file target is already absent, so the gate already fails' }
      }
      const candidate = present.find(({ check }) => assertWritable(context.root, check.path, context.globs).ok)
      if (candidate === undefined) {
        return {
          status: 'out-of-scope',
          target: present[0].check.path,
          detail: assertWritable(context.root, present[0].check.path, context.globs).reason,
        }
      }
      const relative = candidate.check.path
      return {
        status: 'ready',
        target: relative,
        detail: `removed ${relative}, required by law "${candidate.law.id}"`,
        mutate: () => context.deleteFile(relative),
      }
    },
  },
  {
    id: 'forbidden-file-present',
    claim: 'a forbidden_file check fails when its file is created',
    expectedCode: 'CODE_FORBIDDEN_FILE_PRESENT',
    scope: 'the paths named by the corpus forbidden_file checks',
    plan(context) {
      const entries = checksOfType(context.laws, 'forbidden_file')
      if (entries.length === 0) return { status: 'skipped', detail: 'no law declares a forbidden_file check' }
      const usable = entries.filter(
        ({ check }) =>
          !context.files.includes(check.path) && existsSync(join(context.root, dirname(check.path))),
      )
      if (usable.length === 0) {
        return {
          status: 'skipped',
          detail: 'every forbidden_file law either already fails or names a path whose directory does not exist',
        }
      }
      const candidate = usable.find(({ check }) => assertWritable(context.root, check.path, context.globs).ok)
      if (candidate === undefined) {
        return {
          status: 'out-of-scope',
          target: usable[0].check.path,
          detail: assertWritable(context.root, usable[0].check.path, context.globs).reason,
        }
      }
      const relative = candidate.check.path
      return {
        status: 'ready',
        target: relative,
        detail: `created ${relative}, forbidden by law "${candidate.law.id}"`,
        mutate: () => context.mutateFile(relative, 'ratchet-falsify: this file must not exist\n'),
      }
    },
  },
  {
    id: 'forbidden-text-present',
    claim: 'a forbidden_text check fails when text it forbids appears in a file it scopes',
    expectedCode: 'CODE_TEXT_FORBIDDEN_PRESENT',
    scope: 'the paths named by the corpus forbidden_text checks',
    plan(context) {
      const entries = checksOfType(context.laws, 'forbidden_text')
      if (entries.length === 0) return { status: 'skipped', detail: 'no law declares a forbidden_text check' }
      let outOfScope = null
      let unsynthesizable = null
      for (const { law, check } of entries) {
        // The SAME selector the verifier uses. This line kept the old one — one `matchFiles`
        // per pattern, where `!src/aaa/**` is the literal glob `^!src/aaa/.*$` — so the
        // breaker mutated a file the decision excludes, the gate correctly stayed green,
        // and `falsify` reported `missed`: a release-gate command failing for a reason
        // that is not a defect.
        const scopeFiles = selectFiles(context.files, check.paths)
        if (scopeFiles.length === 0) continue // The verifier already fails an empty scope.
        const witness = regexWitness(check.pattern, check.flags)
        if (witness === null) {
          unsynthesizable = { pattern: check.pattern, lawId: law.id }
          continue
        }
        const expression = new RegExp(check.pattern, String(check.flags ?? '').replace(/[gy]/g, ''))
        const target = scopeFiles.find((file) => {
          const bytes = readBytes(join(context.root, file))
          return bytes !== null && !expression.test(bytes.toString('utf8'))
        })
        if (target === undefined) continue // Every scoped file already matches, so the gate already fails.
        const writable = assertWritable(context.root, target, context.globs)
        if (!writable.ok) {
          outOfScope = { target, reason: writable.reason }
          continue
        }
        return {
          status: 'ready',
          target,
          detail: `appended ${JSON.stringify(witness)} to ${target}, forbidden by law "${law.id}"`,
          mutate: () => {
            const bytes = readBytes(join(context.root, target))
            if (bytes === null) throw new Error(`${target} could not be read`)
            const text = bytes.toString('utf8')
            const next = `${text}${text.endsWith('\n') ? '' : '\n'}${witness}\n`
            if (Buffer.byteLength(next) > MAX_WRITE_BYTES + bytes.length) throw new Error('the mutation would exceed the write cap')
            context.mutateFile(target, next)
          },
        }
      }
      if (outOfScope !== null) return { status: 'out-of-scope', target: outOfScope.target, detail: outOfScope.reason }
      if (unsynthesizable !== null) {
        return {
          status: 'error',
          detail: `could not synthesise a witness for forbidden_text pattern ${JSON.stringify(unsynthesizable.pattern)} (law "${unsynthesizable.lawId}")`,
        }
      }
      return { status: 'skipped', detail: 'every forbidden_text law already fails, or scopes no file' }
    },
  },
  {
    id: 'required-text-missing',
    claim: 'a required_text check fails when the text it requires is removed from every file it scopes',
    expectedCode: 'CODE_REQUIRED_TEXT_MISSING',
    scope: 'the paths named by the corpus required_text checks',
    plan(context) {
      const entries = checksOfType(context.laws, 'required_text')
      if (entries.length === 0) return { status: 'skipped', detail: 'no law declares a required_text check' }
      let outOfScope = null
      for (const { law, check } of entries) {
        const pattern = String(check.pattern ?? '')
        const cleanFlags = String(check.flags ?? '').replace(/[gy]/g, '')
        let expression
        try {
          expression = new RegExp(pattern, cleanFlags)
        } catch {
          continue
        }
        // A pattern that matches the empty string cannot be removed.
        if (expression.test('')) continue
        // The same selector as the verifier — see the comment on the first scope above.
        const scopeFiles = selectFiles(context.files, check.paths)
        if (scopeFiles.length === 0) continue // The verifier already fails an empty scope.
        const matching = scopeFiles.filter((file) => {
          const bytes = readBytes(join(context.root, file))
          return bytes !== null && expression.test(bytes.toString('utf8'))
        })
        if (matching.length === 0) continue // Already missing, so the gate already fails.
        const unwritable = matching.find((file) => !assertWritable(context.root, file, context.globs).ok)
        if (unwritable !== undefined) {
          outOfScope = { target: unwritable, reason: assertWritable(context.root, unwritable, context.globs).reason }
          continue
        }
        const global = new RegExp(pattern, `${cleanFlags}g`)
        return {
          status: 'ready',
          target: matching[0],
          detail: `removed ${JSON.stringify(pattern)} from ${matching.length} file(s) required by law "${law.id}"`,
          mutate: () => {
            for (const file of matching) {
              const bytes = readBytes(join(context.root, file))
              if (bytes === null) throw new Error(`${file} could not be read`)
              context.mutateFile(file, bytes.toString('utf8').replace(global, ''))
            }
          },
        }
      }
      if (outOfScope !== null) return { status: 'out-of-scope', target: outOfScope.target, detail: outOfScope.reason }
      return { status: 'skipped', detail: 'every required_text law already fails, or scopes no file' }
    },
  },
]

/**
 * Falsifies the project's ratchet gate.
 *
 * @param options - `{ root, runCommand, verifyImpl }`; see the module header.
 * @returns A promise for the canonical falsify result.
 */
export async function falsify({ root, runCommand = null, verifyImpl = verify, handleSignals = false } = {}) {
  const absoluteRoot = resolve(root)
  const unusable = unusableProblem(absoluteRoot)
  if (unusable !== null) {
    return {
      ok: false,
      root: absoluteRoot,
      unusable: true,
      cases: [],
      counts: { total: 0, detected: 0, missed: 0, skipped: 0, 'out-of-scope': 0, error: 0 },
      problems: [unusable],
    }
  }

  const manifest = JSON.parse(readFileSync(join(absoluteRoot, MANIFEST_PATH), 'utf8'))
  const dirs = recordDirs(manifest)
  const globs = writableGlobs(manifest)
  const stateDir = safeStateDir(absoluteRoot, dirs.stateDir)
  // Repair anything a previous hard-killed run left behind BEFORE compiling, so the
  // corpus this run judges is the project's own rather than a mutation's.
  const recovery = recoverJournal({ root: absoluteRoot, stateDir })
  const files = listFiles(absoluteRoot)
  const compiled = compileProject(absoluteRoot)
  if (!compiled.ok) {
    return {
      ok: false,
      root: absoluteRoot,
      unusable: true,
      cases: [],
      counts: { total: 0, detected: 0, missed: 0, skipped: 0, 'out-of-scope': 0, error: 0 },
      problems: compiled.problems,
      recovered: recovery.recovered,
      warnings: recovery.warnings,
    }
  }
  const laws = compiled.bundle?.laws ?? []
  const recordIds = readRecordIds(absoluteRoot, dirs.decisionsDir)
  const usedIds = new Set(recordIds)
  const freeId = () => {
    for (let candidate = 9001; candidate < 10000; candidate += 1) {
      const id = String(candidate)
      if (!usedIds.has(id)) {
        usedIds.add(id)
        return id
      }
    }
    throw new Error('no free four-digit id remains for a falsification record')
  }
  const journal = createJournal({ root: absoluteRoot, stateDir })
  // The persisted verdict is recorded up front: `verify` writes it during the run, and a
  // hard kill would otherwise leave a project that looks verified against laws it no
  // longer has.
  for (const stateArtifact of [STATE_PATHS.state, STATE_PATHS.ledger, STATE_PATHS.verifyReport]) {
    journal.record(stateArtifact)
  }

  let touched = new Set()
  const context = {
    root: absoluteRoot,
    globs,
    files,
    laws,
    recordIds,
    dirs,
    freeId,
    runCommand,
    verifyImpl,
    /** Journals a path, then writes it atomically. Refuses anything out of scope. */
    mutateFile(relativePath, bytes) {
      const writable = assertWritable(absoluteRoot, relativePath, globs)
      if (!writable.ok) throw new Error(`refusing to mutate ${relativePath}: ${writable.reason}`)
      journal.record(relativePath)
      touched.add(relativePath)
      writeAtomic(join(absoluteRoot, relativePath), bytes)
    },
    /** Journals a path, then removes it. Refuses anything out of scope. */
    deleteFile(relativePath) {
      const writable = assertWritable(absoluteRoot, relativePath, globs)
      if (!writable.ok) throw new Error(`refusing to mutate ${relativePath}: ${writable.reason}`)
      journal.record(relativePath)
      touched.add(relativePath)
      safeUnlink(join(absoluteRoot, relativePath))
    },
    resetTouched() {
      touched = new Set()
    },
    restoreTouched() {
      for (const relativePath of [...touched]) journal.restore(relativePath)
    },
  }

  const cases = []
  // Per-invocation, not module-global: two concurrent runs must not be able to restore
  // each other's mutation, and a signal must find exactly the mutation in flight.
  const pendingRestore = { current: null }
  // A `finally` does not run when Node terminates on an unhandled signal, so the restore
  // path is armed as a handler for the duration of the run. The journal covers what the
  // in-flight restore misses — every path ever recorded — which is what makes a hard
  // SIGKILL repairable by the next run. `process.exit` after synchronous restores means
  // the mutation and the persisted verdict are both undone; 130/143 are the conventional
  // signal exit codes.
  const onSignal = (code) => () => {
    try {
      pendingRestore.current?.()
    } catch {
      // A restore failure must not stop the journal restore or the exit.
    }
    try {
      journal.restoreAll()
    } catch {
      // Best effort: the process is already leaving.
    }
    try {
      journal.clear()
    } catch {
      // Best effort: the process is already leaving.
    }
    process.exit(code)
  }
  const onSigint = handleSignals ? onSignal(130) : null
  const onSigterm = handleSignals ? onSignal(143) : null
  // Armed only for a caller that owns the process (`handleSignals: true`, which the CLI
  // sets). Installing a handler that calls `process.exit` as a side effect of a library
  // call would let an in-process caller — a tool, a test runner — terminate its host on
  // a signal, which is not this function's decision to make.
  if (onSigint !== null) process.once('SIGINT', onSigint)
  if (onSigterm !== null) process.once('SIGTERM', onSigterm)
  try {
    for (const spec of CASES) cases.push(await runCase(spec, context, pendingRestore))
  } finally {
    if (onSigint !== null) process.removeListener('SIGINT', onSigint)
    if (onSigterm !== null) process.removeListener('SIGTERM', onSigterm)
    journal.restoreAll()
    journal.clear()
  }

  const counts = { total: cases.length, detected: 0, missed: 0, skipped: 0, 'out-of-scope': 0, error: 0 }
  for (const entry of cases) counts[entry.status] = (counts[entry.status] ?? 0) + 1
  return {
    ok: counts.missed === 0 && counts.error === 0,
    root: absoluteRoot,
    cases,
    counts,
    recovered: recovery.recovered,
    warnings: recovery.warnings,
  }
}

/**
 * Repairs the project from a stale falsification journal, without running any case.
 *
 * The companion to a hard-killed run: SIGKILL cannot be caught, so the repair happens on
 * the next invocation instead. Recreating files that existed, removing files that did
 * not, deleting the journal, and reporting what it touched.
 *
 * @param options - `{ root }`.
 * @returns `{ ok, root, recovered, warnings }`, or `{ unusable: true, problems }` when the
 *   project cannot be read at all.
 */
export function recover({ root } = {}) {
  const absoluteRoot = resolve(root)
  // Only the root-level refusal applies here. The manifest is NOT required: recovery
  // exists to repair a project a hard-killed run left broken, and a manifest that is
  // itself missing or unreadable must not strand the damage. No case mutates the
  // manifest, so falling back to the default journal location is safe.
  const base = rootProblem(absoluteRoot)
  if (base !== null) {
    return { ok: false, root: absoluteRoot, unusable: true, recovered: [], warnings: [], problems: [base] }
  }
  let stateDir = DEFAULT_STATE_DIR
  try {
    const manifest = JSON.parse(readFileSync(join(absoluteRoot, MANIFEST_PATH), 'utf8'))
    stateDir = recordDirs(manifest).stateDir
  } catch {
    // No readable manifest: the journal still lives at the documented default.
  }
  const result = recoverJournal({ root: absoluteRoot, stateDir: safeStateDir(absoluteRoot, stateDir) })
  return { ok: true, root: absoluteRoot, recovered: result.recovered, warnings: result.warnings }
}

/**
 * Lists the four-digit ids the decision directory declares.
 *
 * Read from filenames rather than parsed records: the corpus has already compiled, and
 * the filename prefix is the id the parser requires to match.
 *
 * @param root - Absolute project root.
 * @param decisionsDir - Repository-relative decisions directory.
 * @returns A sorted array of id strings.
 */
function readRecordIds(root, decisionsDir) {
  try {
    return readdirSync(join(root, decisionsDir))
      .map((name) => /^(\d{4})-[a-z0-9-]+\.adr\.md$/.exec(name)?.[1])
      .filter((id) => typeof id === 'string')
      .sort()
  } catch {
    return []
  }
}
