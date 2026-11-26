/**
 * PURPOSE
 *   Make the no-autotest ruling mechanical at the point a test file is written - and make the
 *   TESTER role's write surface mechanical too.
 *
 *   The rule is not "no tests ever"; it is "no pointless tests". The guard cannot judge quality,
 *   so it requires the writer to state the production behavior and the failure the test prevents
 *   in a `PROOF:` header. A trivial test can still fake the header; human review remains the real
 *   check. This is friction in the right place, not proof by itself.
 *
 *   ROLE SCOPES (P1). The independent acceptance tester must not be able to "fix" what it is
 *   testing: with no write scope it could edit the product and then find it green. A role listed
 *   in `roles` may write ONLY paths matching its `allow` patterns; anything else is refused with
 *   `WRITE_SCOPE` before the tool runs. A path that IS a test still needs its PROOF header, so the
 *   scope and the header are two gates, not one.
 *
 * INPUTS
 *   Config (all optional):
 *     mode          "deny" (default) or "warn".
 *     required      header markers. Default PROOF, Behavior, "Fails when".
 *     allowPaths    absolute or workspace-relative path prefixes to leave alone.
 *     testPattern   override the built-in test-path regular expression.
 *     roles         { <preset>: { allow: [<path prefix or glob>] } }: the write scope of a role.
 *
 * OUTPUTS
 *   One `tools/pre-execute` waterfall listener. It calls `next()` for every allowed call, so later
 *   listeners keep their say. A denied write returns the registry's `{ kind: 'deny', reason }`
 *   decision and never reaches the tool.
 *
 * KEYWORDS
 *   no autotests, proof, test guard, tools/pre-execute, write, edit, PROOF header, write scope,
 *   tester role
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Only `write` and `edit` are inspected. A shell command that creates a file is outside this
 *     seam (and the TESTER's shell is a documented caveat: the scope is a write/edit guard).
 *   - An edit to a test file that already carries the header is allowed, so legacy files are not
 *     trapped.
 *   - A path outside a session workspace is read only to check its existing header; a read failure
 *     is treated as "no header", never as a crash. For a scoped role a path outside the workspace
 *     is OUTSIDE the scope and is refused.
 *   - `mode: "warn"` logs and allows, so a team can trial the rule before it can block work.
 *   - A non-test path, or a call with no file path, passes through untouched for an unscoped role.
 */

import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

/** What a test path looks like across the ecosystems this deployment touches. */
export const DEFAULT_TEST_PATTERN = String.raw`(^|/)(__tests__|tests?|specs?)(/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|/)test_[^/]+\.py$|_test\.go$`

/** Default markers that turn a test file into a stated claim. */
export const DEFAULT_REQUIRED = ['PROOF', 'Behavior', 'Fails when']

/** Normalize one path for comparison: forward slashes, no leading `./`. */
function normalizePath(path) {
  return String(path).replaceAll('\\', '/').replace(/^\.\//, '')
}

/**
 * A path with every symlink resolved, or the path itself when no ancestor exists.
 *
 * WHY IT WALKS UP. The first version tried the target and then its immediate parent; a path whose
 * parent does not exist yet (a write that would CREATE directories) fell back to the lexical
 * string, so a junction at an existing ancestor (`docs/cases/jlink -> src`) was invisible and the
 * write landed in the product. The nearest EXISTING ancestor is realpath'd (which resolves the
 * junction) and the unresolved tail is appended: the result is where the bytes will actually go.
 */
function realPathOf(path) {
  let current = resolve(path)
  const tail = []
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const real = realpathSync(current)
      return tail.length === 0 ? real : resolve(real, ...tail.slice().reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return path
      tail.push(basename(current))
      current = parent
    }
  }
  return path
}

/**
 * Resolve a tool's file path into workspace-relative form, THROUGH `..` AND SYMLINKS.
 *
 * WHY IT IS NOT A STRING COMPARISON. The first version compared the raw argument with the scope
 * prefixes, so `docs/cases/../../src/app.mjs` started with `docs/cases/` and passed: the guard
 * allowed a write the scope exists to forbid. The path is now resolved against the session
 * workspace, normalised (`.`, `..`, mixed separators), realpath'd (a symlink out of the workspace
 * is a different file than its name suggests) and only then compared.
 *
 * @returns `{ relative, inside }`: `relative` is the workspace-relative path with `/` separators,
 *   and `inside` is false for anything that resolves outside the workspace.
 */
export function resolveWithin(cwd, path) {
  const base = realPathOf(resolve(typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()))
  // Mixed separators are normalised BEFORE the resolution, not only for display: on POSIX
  // `resolve()` treats `..\..\src` as one file name, so the documented "mixed separators" above
  // was true on Windows only and a Windows-style climb was allowed on Linux.
  const target = resolve(base, normalizePath(path))
  const real = realPathOf(target)
  const rel = relative(base, real)
  const inside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  return { relative: normalizePath(rel), inside, absolute: target }
}

/**
 * A scope entry as a regular expression.
 *
 * `**` spans directories, a single `*` stays inside one, and a leading double-star-and-slash also
 * matches a path in the workspace root: the spec glob has to cover `x.spec.mjs`, or the rule
 * quietly exempts the root from what it claims to cover.
 */
function scopeRegExp(entry) {
  let source = ''
  for (let index = 0; index < entry.length; index += 1) {
    const char = entry[index]
    if (char === '*') {
      if (entry[index + 1] === '*') {
        if (entry[index + 2] === '/') {
          source += '(?:.*/)?'
          index += 2
        } else {
          source += '.*'
          index += 1
        }
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+?${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

/**
 * Whether a normalized path matches a scope entry.
 *
 * A prefix (`docs/cases/`) covers everything under it; an entry with a wildcard matches anywhere.
 * Both are the forms a person writes in a policy file, so both are supported rather than inventing
 * a third convention.
 */
export function matchesScope(path, pattern) {
  const target = normalizePath(path)
  const entry = normalizePath(pattern)
  if (entry === '') return false
  if (!entry.includes('*')) {
    const prefix = entry.endsWith('/') ? entry : `${entry}/`
    return target === entry.replace(/\/$/, '') || target.startsWith(prefix)
  }
  return scopeRegExp(entry).test(target)
}

/**
 * Build the policy from raw config.
 *
 * @param config - Raw plugin config.
 * @returns A total policy.
 */
export function normalizeConfig(config = {}) {
  const mode = config.mode === 'warn' ? 'warn' : 'deny'
  const required = Array.isArray(config.required) && config.required.length > 0
    ? config.required.filter((marker) => typeof marker === 'string' && marker.trim() !== '')
    : DEFAULT_REQUIRED
  const roles = {}
  if (config.roles !== null && typeof config.roles === 'object') {
    for (const [preset, scope] of Object.entries(config.roles)) {
      const allow = Array.isArray(scope?.allow) ? scope.allow.filter((entry) => typeof entry === 'string' && entry.trim() !== '') : []
      if (allow.length > 0) roles[preset] = { allow }
    }
  }
  return {
    mode,
    required: required.length > 0 ? required : DEFAULT_REQUIRED,
    allowPaths: Array.isArray(config.allowPaths) ? config.allowPaths.filter((path) => typeof path === 'string' && path !== '') : [],
    testPattern: typeof config.testPattern === 'string' && config.testPattern !== '' ? config.testPattern : DEFAULT_TEST_PATTERN,
    roles,
  }
}

/**
 * Whether a path names a test file.
 *
 * @param path - File path as the tool received it.
 * @param policy - Normalized policy.
 * @returns Whether the guard should inspect the call.
 */
export function isTestPath(path, policy) {
  if (typeof path !== 'string' || path === '') return false
  return new RegExp(policy.testPattern).test(path.replaceAll('\\', '/'))
}

/**
 * Whether a text states every required marker.
 *
 * @param text - New content, or an existing file's content.
 * @param policy - Normalized policy.
 * @returns Whether the header is present.
 */
export function hasProof(text, policy) {
  if (typeof text !== 'string' || text === '') return false
  return policy.required.every((marker) => new RegExp(`${escapeRegExp(marker)}\\s*:`, 'i').test(text))
}

/** Escape a literal marker for use in a regular expression. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Read an existing file's content, or '' when it cannot be read.
 *
 * @param path - File path from the tool args.
 * @param cwd - Session working directory, when known.
 * @returns Existing content, or ''.
 */
function existingContent(path, cwd) {
  if (typeof path !== 'string' || path === '') return ''
  const target = isAbsolute(path) ? path : resolve(typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd(), path)
  try {
    return readFileSync(target, 'utf8')
  } catch {
    return ''
  }
}

/** The preset in force for an agent: the resolution when the host mounts it, else the header. */
function presetOf(ctx, agent) {
  try {
    const resolved = ctx.get?.('toolFamilies')?.presetFor?.(agent?.session)
    if (typeof resolved === 'string' && resolved.trim() !== '') return resolved.trim()
  } catch {
    // No policy owner in this composition: the creation header is the fallback.
  }
  const header = agent?.session?.header?.agentPreset
  return typeof header === 'string' && header !== '' ? header : ''
}

/** Default text shown when a write is denied. */
const DENY_HINT = 'This deployment does not write autotests. Prove behavior by running the product, or, if the human asked for a test, add a PROOF header naming `Behavior:`, `Fails when:` and `Production path:` - and make the test name real production behavior, not a restatement of the implementation.'

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'proof-guard'

/** The tool registry is required for the pre-execute waterfall. */
export const inject = ['tools']

/**
 * Register the guard.
 *
 * @param ctx - Cordis context.
 * @param config - Raw plugin config.
 */
/** The tools whose work happens outside the file tools: a shell can write anything. */
export const SHELL_TOOLS = ['bash', 'pwsh']

/** Where a violation is recorded, relative to the workspace. */
export const VIOLATION_FILE = join('.dsh', 'proof-guard-violations.json')

/** Roots the role already owns: a change under them is the role's work, not a product edit. */
const OWNED_ROOTS = ['docs/cases/', 'test/', 'tests/']

/**
 * Roots the runtime writes on its own while a shell runs: the project ledger (`state/`, whose
 * journal and view projections every task transition appends) and the session scratch directory
 * (`.dsh/`, where this guard records its own violations). They are tracked files, so without this
 * exclusion every ledger append during a scoped shell was recorded as a product edit by that
 * session and refused the row's close.
 *
 * The taskboard's close judgement mirrors this list (it reads the recorded file itself); keep the
 * two in step, and keep the exclusion to these two roots: `reports/` and `docs/` are deliverables
 * a role writes on purpose and stay in the product surface.
 */
export const RUNTIME_ROOTS = ['state/', '.dsh/']

/** Whether a path belongs to the runtime (the ledger or the session scratch directory). */
export function isRuntimePath(path) {
  const normalized = normalizePath(path)
  return RUNTIME_ROOTS.some((root) => normalized === root.replace(/\/$/, '') || normalized.startsWith(root))
}

/**
 * The product manifest of a workspace: tracked files outside the role's own roots and outside
 * the roots the runtime writes (the ledger, the session scratch directory), hashed.
 *
 * WHY GIT. The scope exists to protect the product, and 'the product' is what is under version
 * control; an untracked scratch file is not it. A workspace without git yields null, and the audit
 * then says nothing rather than guessing - a detector that cannot see must not answer 'clean'.
 */
export function productManifest(cwd) {
  let listed
  try {
    listed = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch {
    return null
  }
  const files = listed
    .split('\0')
    .filter((path) => path !== '')
    .filter((path) => !isRuntimePath(path))
    .filter((path) => !OWNED_ROOTS.some((root) => path.replaceAll('\\', '/').startsWith(root)))
  const manifest = {}
  for (const path of files.slice(0, 4000)) {
    try {
      manifest[path] = createHash('sha256').update(readFileSync(join(cwd, path))).digest('hex')
    } catch {
      manifest[path] = 'unreadable'
    }
  }
  return manifest
}

/** What changed between two manifests: paths added, removed or edited. */
export function manifestDiff(before, after) {
  if (before === null || after === null) return []
  const changed = []
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[path] !== after[path]) changed.push(path)
  }
  return changed.sort()
}

/** Record one violation, keeping the file a list so several sessions can be judged. */
export function recordViolation(cwd, entry) {
  const path = join(cwd, VIOLATION_FILE)
  let existing = []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (Array.isArray(parsed)) existing = parsed
  } catch {
    existing = []
  }
  existing.push(entry)
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(existing, null, 2) + '\n', 'utf8')
  } catch {
    return false
  }
  return true
}

/** The violations recorded for one session, or [] when the file is absent or unreadable. */
export function violationsFor(cwd, sessionId) {
  try {
    const parsed = JSON.parse(readFileSync(join(cwd, VIOLATION_FILE), 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry) => entry !== null && typeof entry === 'object' && (sessionId === undefined || entry.sessionId === sessionId))
  } catch {
    return []
  }
}

export function apply(ctx, config = {}) {
  const policy = normalizeConfig(config)
  const pattern = new RegExp(policy.testPattern)
  // SHELL AUDIT (a DETECTOR, not a sandbox): a scoped role's shell can write the product, and the
  // write/edit guard never sees it. The manifest is taken before the call and compared after; a
  // difference is recorded, and the taskboard refuses to close the row it belongs to. Nothing here
  // prevents the write - a detector that claimed to be a sandbox would be a lie.
  const shellEnabled = config === null || typeof config !== 'object' || config.shellAudit !== false
  const manifests = new Map()

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!shellEnabled || !SHELL_TOOLS.includes(exec?.name)) return next()
    const cwd = exec.agent?.session?.header?.cwd
    if (policy.roles[presetOf(ctx, exec.agent)] === undefined || typeof cwd !== 'string' || cwd === '') return next()
    const manifest = productManifest(cwd)
    if (manifest !== null) manifests.set(exec, { cwd, manifest })
    return next()
  })

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const before = manifests.get(exec)
    if (before === undefined) return next()
    manifests.delete(exec)
    const changed = manifestDiff(before.manifest, productManifest(before.cwd))
    if (changed.length === 0) return next()
    const sessionId = exec.agent?.session?.header?.id ?? exec.agent?.id ?? 'unknown'
    recordViolation(before.cwd, { at: new Date().toISOString(), sessionId, preset: presetOf(ctx, exec.agent), tool: exec.name, files: changed })
    ctx.logger.warn('proof-guard: the ' + presetOf(ctx, exec.agent) + ' shell changed ' + changed.length + ' product file(s): ' + changed.slice(0, 5).join(', ') + ' (recorded, not blocked)')
    return next()
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec?.name !== 'write' && exec?.name !== 'edit') return next()
    const args = exec.arguments
    const path = args?.file_path ?? args?.path ?? args?.filePath
    if (typeof path !== 'string' || path === '') return next()
    const cwd = exec.agent?.session?.header?.cwd
    // The path is resolved THROUGH `..` and symlinks before it is compared with a scope: the raw
    // string is what an allow-list would otherwise match by prefix.
    const resolved = resolveWithin(cwd, path)
    const normalized = resolved.relative === '' ? normalizePath(path) : resolved.relative

    // THE ROLE SCOPE COMES FIRST: a scoped role that writes outside its allowed roots is refused
    // before the content is even read. A path outside the workspace is outside every scope.
    const scope = policy.roles[presetOf(ctx, exec.agent)]
    if (scope !== undefined) {
      // B2: A HARD LINK IS THE SAME FILE UNDER ANOTHER NAME. A path under an allowed root whose
      // inode already has another name (`docs/cases/link.mjs` linked to the product) is the product,
      // and writing through it edits what the scope forbids. One link is a file that exists once.
      let hardLinked = false
      if (resolved.inside && scope.allow.some((entry) => matchesScope(normalized, entry))) {
        try {
          if (statSync(resolved.absolute).nlink > 1) hardLinked = true
        } catch {
          // The file is about to be created: a new name cannot be a second link to an existing one.
        }
      }
      const allowed = resolved.inside && !hardLinked && scope.allow.some((entry) => matchesScope(normalized, entry))
      if (!allowed) {
        const where = !resolved.inside
          ? `"${normalizePath(path)}" (outside the workspace)`
          : hardLinked
            ? `"${normalized}" (a hard link: the file already has another name)`
            : `"${normalized}"`
        const reason = `WRITE_SCOPE: the ${presetOf(ctx, exec.agent)} role writes only cases, drivers and tests (${scope.allow.join(', ')}); ${where} is outside that scope. Report the defect and let the owning role change the product.`
        if (policy.mode === 'warn') {
          ctx.logger.warn(`proof-guard: ${normalized} is outside the role scope (warn mode; allowing)`)
        } else {
          ctx.logger.warn(`proof-guard: denied ${exec.name} to ${normalized} (outside the role write scope)`)
          return { kind: 'deny', reason }
        }
      }
    }

    if (!pattern.test(normalized)) return next()
    if (policy.allowPaths.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) return next()

    const nextContent = exec.name === 'write' ? args?.content : args?.new_string
    const existing = existingContent(path, cwd)
    if (hasProof(typeof nextContent === 'string' ? nextContent : '', policy) || hasProof(existing, policy)) {
      return next()
    }

    const reason = `${DENY_HINT}\nFile: ${path}`
    if (policy.mode === 'warn') {
      ctx.logger.warn(`proof-guard: ${path} has no PROOF header (warn mode; allowing)`)
      return next()
    }
    ctx.logger.warn(`proof-guard: denied ${exec.name} to ${path} (no PROOF header)`)
    return { kind: 'deny', reason }
  })
}
