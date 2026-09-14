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
 *   possible and proves nothing. Every mutation is restored in a `finally`, the run
 *   snapshots and restores the persisted verification state, and a case whose check
 *   cannot fail is reported as `missed` — the finding that matters.
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
 *
 * OUTPUTS
 *   A promise for
 *   `{ ok, root, cases, counts }` where each case is
 *   `{ id, claim, scope, status, expectedCode, observedCodes, target, detail }` and
 *   `status` is one of `detected`, `missed`, `skipped`, `out-of-scope`, `error`.
 *   `ok` is true iff no case is `missed` or `error`. When the project cannot be used
 *   at all the result is `{ ok: false, unusable: true, cases: [], counts }`, which the
 *   CLI reports as exit 2.
 *
 * KEYWORDS
 *   falsification, breaker, adversarial, ratchet, gate, project-agnostic, mutation
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `.dsh/project.json`, an unreadable manifest, the ratchet disabled, or a
 *     corpus that does not compile: reported unusable, no case runs, nothing is
 *     written.
 *   - A root that is the filesystem root or the user's home directory is refused
 *     outright: a breaker must be scoped to one project.
 *   - A target that is outside the declared writable set, or under `.git`,
 *     `node_modules`, `sessions`, `storages`, `.credentials.yaml` or `settings.yaml`,
 *     is `out-of-scope` and is never written.
 *   - A check type no law uses yields `skipped` with the reason, never a failure.
 *   - A law whose target is already in the violating state yields `skipped`: the gate
 *     already fails, so the failure cannot be attributed to this mutation.
 *   - `SIGINT` and `SIGTERM` are caught for the duration of a run when the caller passes
 *     `handleSignals: true` (the CLI does): the in-flight mutation and the persisted
 *     state are restored, then the process exits 130 or 143. A `finally` block alone does
 *     NOT cover these — Node terminates on an unhandled signal without unwinding — which
 *     is exactly why the handlers exist. A caller that does not own the process leaves
 *     them off and keeps the `finally` restore. `SIGKILL` cannot be caught by any
 *     process, so a `kill -9` mid-run may leave one mutation in place: give a
 *     falsification run time to finish rather than killing it hard.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse, resolve, sep } from 'node:path'
import { MANIFEST_PATH, problem } from './ratchet-schema.mjs'
import { compileProject } from './ratchet-compiler.mjs'
import { globToRegExp, listFiles, matchFiles } from './ratchet-verifier.mjs'
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
 * Decides whether one repository-relative path may be written.
 *
 * Four independent refusals, because each catches a different mistake: a path that
 * escapes the root, a path under a directory the breaker must never touch, a
 * machine-local file, and a path outside the project's declared writable set.
 *
 * @param root - Absolute project root.
 * @param relativePath - Repository-relative path, in either separator style.
 * @param globs - The writable globs.
 * @returns `{ ok: true }`, or `{ ok: false, reason }` naming the refusal.
 */
function assertWritable(root, relativePath, globs) {
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
    return { ok: false, reason: `the target is under a forbidden directory (${segments.find((segment) => FORBIDDEN_SEGMENTS.has(segment))})` }
  }
  if (FORBIDDEN_FILES.has(segments[segments.length - 1])) {
    return { ok: false, reason: 'the target is a machine-local file' }
  }
  if (!globs.some((glob) => globToRegExp(glob).test(posix))) {
    return { ok: false, reason: 'the target is outside the writable scope this project declares' }
  }
  return { ok: true }
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
 * Writes bytes, creating the parent directory.
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
 * Snapshots the persisted verification artifacts so a run leaves no trace.
 *
 * `verify` writes a report, a state file and a ledger append; a falsification run
 * must not leave the project looking as though it had been verified against laws it
 * no longer has.
 *
 * @param root - Absolute project root.
 * @returns An array of `{ absolute, bytes }` where `bytes` is null when the file was
 *   absent, so restoration can remove a file the run created.
 */
function snapshotState(root) {
  return [STATE_PATHS.state, STATE_PATHS.ledger, STATE_PATHS.verifyReport].map((relativePath) => {
    const absolute = join(root, relativePath)
    return { absolute, bytes: existsSync(absolute) ? readBytes(absolute) : null }
  })
}

/**
 * Restores every artifact {@link snapshotState} captured.
 *
 * @param snapshots - The snapshot array.
 * @returns Nothing; a failure to restore one file does not stop the others.
 */
function restoreState(snapshots) {
  for (const snapshot of snapshots) {
    try {
      if (snapshot.bytes === null) safeUnlink(snapshot.absolute)
      else writeBytes(snapshot.absolute, snapshot.bytes)
    } catch {
      // Best effort: one unrestorable file must not abort the remaining restores.
    }
  }
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
 * Verifies the project can be falsified at all, before any case runs.
 *
 * @param root - Absolute project root.
 * @returns `null` when usable, else a problem record the CLI renders as exit 2.
 */
function unusableProblem(root) {
  if (!existsSync(root)) return problem('MANIFEST_MISSING', `${root} does not exist`)
  let stats
  try {
    stats = statSync(root)
  } catch (error) {
    return problem('MANIFEST_MISSING', `${root} could not be inspected: ${String(error)}`)
  }
  if (!stats.isDirectory()) return problem('DIR_NOT_A_DIRECTORY', `${root} is not a directory`)
  if (root === parse(root).root || root === resolve(homedir())) {
    return problem(
      'MANIFEST_INVALID',
      `refusing to falsify ${root}: it is the filesystem root or a home directory, and a breaker must be scoped to one project`,
    )
  }
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

  // Publish the in-flight restore BEFORE the first write, so a signal that arrives
  // while `mutate()` is mid-way still finds something to undo. Every case's restore is
  // idempotent — it writes captured bytes back or unlinks a file it created — so the
  // signal handler and the normal `finally` may both call it, and either order is safe.
  const restoreMutation = typeof plan.restore === 'function' ? plan.restore : null
  if (pendingRestore !== undefined) pendingRestore.current = restoreMutation

  try {
    plan.mutate()
  } catch (error) {
    try {
      restoreMutation?.()
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
      restoreMutation?.()
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
 * Cases 1 and 2 always run on a compilable corpus. Cases 3–6 are conditional: when no
 * law uses the check type they are `skipped` with the reason, because a project is
 * allowed not to use every check kind.
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
        mutate: () => writeBytes(join(context.root, relative), text),
        restore: () => safeUnlink(join(context.root, relative)),
      }
    },
  },
  {
    id: 'law-with-no-check',
    claim: 'a law in force with no check and no stated reason is reported as unchecked',
    expectedCode: 'LAW_UNCHECKED',
    scope: (context) => `${context.dirs.decisionsDir}/**`,
    plan(context) {
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
        mutate: () => writeBytes(join(context.root, relative), text),
        restore: () => safeUnlink(join(context.root, relative)),
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
      const absolute = join(context.root, relative)
      let bytes = null
      return {
        status: 'ready',
        target: relative,
        detail: `removed ${relative}, required by law "${candidate.law.id}"`,
        mutate: () => {
          bytes = readBytes(absolute)
          if (bytes === null) throw new Error(`${relative} could not be read`)
          unlinkSync(absolute)
        },
        restore: () => {
          if (bytes !== null) writeBytes(absolute, bytes)
        },
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
      const absolute = join(context.root, relative)
      return {
        status: 'ready',
        target: relative,
        detail: `created ${relative}, forbidden by law "${candidate.law.id}"`,
        mutate: () => writeBytes(absolute, 'ratchet-falsify: this file must not exist\n'),
        restore: () => safeUnlink(absolute),
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
        const scopeFiles = [...new Set((check.paths ?? []).flatMap((pattern) => matchFiles(context.files, pattern)))].sort()
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
        const absolute = join(context.root, target)
        let bytes = null
        return {
          status: 'ready',
          target,
          detail: `appended ${JSON.stringify(witness)} to ${target}, forbidden by law "${law.id}"`,
          mutate: () => {
            bytes = readBytes(absolute)
            if (bytes === null) throw new Error(`${target} could not be read`)
            const text = bytes.toString('utf8')
            const next = `${text}${text.endsWith('\n') ? '' : '\n'}${witness}\n`
            if (Buffer.byteLength(next) > MAX_WRITE_BYTES + bytes.length) throw new Error('the mutation would exceed the write cap')
            writeBytes(absolute, next)
          },
          restore: () => {
            if (bytes !== null) writeBytes(absolute, bytes)
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
        const scopeFiles = [...new Set((check.paths ?? []).flatMap((entry) => matchFiles(context.files, entry)))].sort()
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
        const originals = new Map()
        const global = new RegExp(pattern, `${cleanFlags}g`)
        return {
          status: 'ready',
          target: matching[0],
          detail: `removed ${JSON.stringify(pattern)} from ${matching.length} file(s) required by law "${law.id}"`,
          mutate: () => {
            for (const file of matching) {
              const absolute = join(context.root, file)
              const bytes = readBytes(absolute)
              if (bytes === null) throw new Error(`${file} could not be read`)
              originals.set(absolute, bytes)
              writeBytes(absolute, bytes.toString('utf8').replace(global, ''))
            }
          },
          restore: () => {
            for (const [absolute, bytes] of originals) writeBytes(absolute, bytes)
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
  const context = { root: absoluteRoot, globs, files, laws, recordIds, dirs, freeId, runCommand, verifyImpl }

  const snapshots = snapshotState(absoluteRoot)
  const cases = []
  // Per-invocation, not module-global: two concurrent runs must not be able to restore
  // each other's mutation, and a signal must find exactly the mutation in flight.
  const pendingRestore = { current: null }
  // A `finally` does not run when Node terminates on an unhandled signal, so the
  // restore path is armed as a handler for the duration of the run. `process.exit`
  // after a synchronous restore means the mutation and the persisted verdict are both
  // undone before the process leaves; 130/143 are the conventional signal exit codes.
  const onSignal = (code) => () => {
    try {
      pendingRestore.current?.()
    } catch {
      // A restore failure must not stop the state restore or the exit.
    }
    try {
      restoreState(snapshots)
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
    restoreState(snapshots)
  }

  const counts = { total: cases.length, detected: 0, missed: 0, skipped: 0, 'out-of-scope': 0, error: 0 }
  for (const entry of cases) counts[entry.status] = (counts[entry.status] ?? 0) + 1
  return { ok: counts.missed === 0 && counts.error === 0, root: absoluteRoot, cases, counts }
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
