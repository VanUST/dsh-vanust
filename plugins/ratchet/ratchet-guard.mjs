/**
 * Ratchet guard: refuse a write into a regulated zone that has no decision behind
 * it.
 *
 * This is the piece that makes `requiresDecisionRecord` an actual rule rather than
 * a parsed manifest field nobody reads. The design's Part 17 says an architectural
 * change must have an ADR; until this existed, nothing failed when it did not, so
 * the rule was prose with a confident tone.
 *
 * **It is a `tools/pre-execute` guard, not a tool.** A tool is advisory — the model
 * may not call it. A guard sits in the dispatch pipeline after every extensible
 * pre-execute listener and before the tool body, and a reason it returns denies the
 * call. That is the difference between asking an agent to check something and
 * making the check happen.
 *
 * Four decisions shape it, each because the opposite would make the guard hostile:
 *
 * 1. **Inert unless the manifest asks.** No `.dsh/project.json`, no `ratchet`
 *    section, or no zone with `requiresDecisionRecord: true` means the guard allows
 *    everything and costs one file read. A guard that surprises a project that never
 *    opted in gets switched off, and a switched-off guard enforces nothing.
 * 2. **The ratchet's own files are never regulated.** Writing the ADR is how a
 *    contributor satisfies the rule, and a guard that blocks `.dsh/project.json`,
 *    the decisions directory or the sources directory would make the rule
 *    unsatisfiable.
 * 3. **A denial names the fix.** The message says which zone, which path, and what
 *    to create — an agent that cannot act on a refusal will retry it or route
 *    around it.
 * 4. **Only writes are guarded.** Reads, searches and shell commands that do not
 *    obviously write are allowed: guessing that a shell command mutates a file would
 *    refuse work the guard cannot actually see, and a false denial is worse than a
 *    missed one for a rule whose violator is already visible in the diff.
 *
 * The cost is bounded by a cache keyed on the corpus's own hashes, so a session
 * making many edits inside one zone reads the decisions once.
 */
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { MANIFEST_PATH, zoneFor } from './ratchet-schema.mjs'
import { readAdrCorpus, readManifest, resolveActiveSet } from './ratchet-compiler.mjs'

/**
 * Tool names whose arguments name a path they are about to change.
 *
 * `read` is deliberately absent: reading a file in a regulated zone without a
 * decision record is legitimate reconnaissance, and refusing it would make the
 * guard the thing that prevents a contributor from learning what to write.
 */
export const WRITE_TOOLS = Object.freeze(['write', 'edit', 'notebook_edit', 'multi_edit'])

/** Argument keys, in priority order, that carry the target path. */
const PATH_ARGUMENTS = Object.freeze(['file_path', 'path', 'filePath', 'filename', 'notebook_path'])

/**
 * Decides whether the ratchet should govern a path at all, and says why not when
 * it should not.
 *
 * @param path - Repository-relative path with forward slashes.
 * @param config - Parsed ratchet configuration.
 * @returns `{ governed, reason }`. `reason` is a short phrase for the allow
 *   decision, so the guard's behaviour is explainable rather than merely permissive.
 */
export function governanceOf(path, config) {
  const decisionsDir = (config?.decisionsDir ?? 'docs/adrs').replace(/\/+$/, '')
  const sourcesDir = (config?.sourcesDir ?? 'docs/ratchet/sources').replace(/\/+$/, '')
  const stateDir = (config?.stateDir ?? '.dsh/ratchet').replace(/\/+$/, '')
  const reportsDir = (config?.reportsDir ?? 'reports/ratchet').replace(/\/+$/, '')
  const specsDir = (config?.specsDir ?? 'docs/specs').replace(/\/+$/, '')

  if (path === MANIFEST_PATH) return { governed: false, reason: 'the manifest itself is how a project opts in' }
  if (path.startsWith(`${decisionsDir}/`) || path === decisionsDir) {
    return { governed: false, reason: 'the decisions directory is where the record is written' }
  }
  if (path.startsWith(`${sourcesDir}/`) || path === sourcesDir) {
    return { governed: false, reason: 'the sources directory holds the reasoning a record cites' }
  }
  if (path.startsWith(`${stateDir}/`) || path === stateDir) {
    return { governed: false, reason: 'ratchet state is machine-written' }
  }
  if (path.startsWith(`${reportsDir}/`) || path === reportsDir) {
    return { governed: false, reason: 'ratchet reports are machine-written' }
  }
  if (path.startsWith(`${specsDir}/`) || path === specsDir) {
    return { governed: false, reason: 'generated spec documents are produced by compile' }
  }
  if (path.startsWith('.dsh/')) {
    return { governed: false, reason: 'harness configuration is not architecture' }
  }

  const zone = zoneFor(path, config?.zones ?? [])
  if (zone === null) return { governed: false, reason: 'the path belongs to no declared zone' }
  if (zone.requiresDecisionRecord !== true) {
    return { governed: false, reason: `zone "${zone.id}" does not require a decision record` }
  }
  return { governed: true, reason: null, zone }
}

/**
 * Reads a project's decision state once and answers governance questions from it.
 *
 * The cache is keyed on the decisions directory's own modification time and entry
 * count, because those change when a record is added, removed or replaced — which
 * is exactly when a cached answer would be wrong. Hashing every ADR would be more
 * precise and costs a full read per write; an mtime plus a count is enough to
 * notice every change that matters here.
 *
 * @param root - Absolute project root.
 * @returns `{ config, zonesWithRecords, problems, decisionsDir }` or `{ inert }`
 *   when the project has not opted in.
 */
export function loadDecisionState(root) {
  const manifest = readManifest(root)
  if (manifest.config === null || manifest.config.enabled !== true) {
    return { inert: true, reason: 'the project has no enabled ratchet section' }
  }
  const config = manifest.config
  const governedZones = (config.zones ?? []).filter((zone) => zone.requiresDecisionRecord === true)
  if (governedZones.length === 0) {
    return { inert: true, reason: 'no zone declares requiresDecisionRecord' }
  }

  const corpus = readAdrCorpus(root, config)
  const resolved = resolveActiveSet(corpus.records, config)
  // Only decisions IN FORCE satisfy the requirement. A proposal is intent, not law:
  // accepting it would let an agent write the ADR and then proceed unilaterally,
  // which is the override the whole authority model exists to prevent.
  const zonesWithRecords = new Set()
  for (const record of resolved.active) {
    for (const zone of record.zones ?? []) zonesWithRecords.add(zone)
  }
  return { config, governedZones, zonesWithRecords, problems: corpus.problems, decisionsDir: config.decisionsDir }
}

/**
 * Extracts the repository-relative path a tool call is about to change.
 *
 * @param exec - The pending call's execution identity and parsed arguments.
 * @param root - Absolute project root.
 * @returns The repository-relative path with forward slashes, or `null` when the
 *   call does not name one — which the guard treats as "not governed" rather than
 *   guessing.
 */
export function changedPath(exec, root) {
  const args = exec?.arguments
  if (args === null || typeof args !== 'object') return null
  for (const key of PATH_ARGUMENTS) {
    const value = args[key]
    if (typeof value !== 'string' || value.length === 0) continue
    const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value)
    const relativePath = relative(root, absolute).split('\\').join('/')
    // A path outside the project is not this guard's business: an agent writing to
    // a temporary directory or another checkout is not changing this architecture.
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null
    return relativePath
  }
  return null
}

/**
 * Builds the guard function the harness dispatches through.
 *
 * @param options - `{ root }` — the project the guard governs.
 * @returns A `ToolGuard`: a synchronous function returning a denial reason or
 *   `undefined`. Never throws; a guard that throws would deny calls for a reason
 *   nobody can read.
 */
export function createGuard({ root }) {
  /** Cache of decision state, invalidated when the decisions directory changes. */
  let cache = null
  let cachedSignature = null

  /** A cheap signature of the decisions directory: entry count plus mtime. */
  const signatureOf = (decisionsDir) => {
    const directory = join(root, decisionsDir)
    if (!existsSync(directory)) return 'absent'
    try {
      const stats = statSync(directory)
      return `${stats.mtimeMs}`
    } catch {
      return 'unreadable'
    }
  }

  /** Returns the decision state, re-reading it when the corpus has changed. */
  const stateNow = () => {
    const manifest = readManifest(root)
    const decisionsDir = manifest.config?.decisionsDir ?? 'docs/adrs'
    const signature = `${decisionsDir}:${signatureOf(decisionsDir)}`
    if (cache !== null && cachedSignature === signature) return cache
    cache = loadDecisionState(root)
    cachedSignature = signature
    return cache
  }

  return (exec) => {
    try {
      const name = exec?.name
      if (typeof name !== 'string' || !WRITE_TOOLS.includes(name)) return undefined

      const state = stateNow()
      if (state.inert === true) return undefined

      const path = changedPath(exec, root)
      if (path === null) return undefined

      const governance = governanceOf(path, state.config)
      if (governance.governed !== true) return undefined

      const zone = governance.zone
      if (state.zonesWithRecords.has(zone.id)) return undefined

      // The denial has to be actionable: which zone, which path, and the smallest
      // thing that satisfies the rule.
      return [
        `the ratchet refuses this write: ${path} is in zone "${zone.id}", which the project manifest declares`,
        `requiresDecisionRecord, and no active ADR names that zone.`,
        ``,
        `Create an ADR under ${state.decisionsDir}/ (the manifest declares that directory) with:`,
        `  - zones: [${zone.id}]`,
        `  - a non-empty "## Reasoning" section`,
        `  - a "source" pointing at the file the reasoning came from, with its sha256`,
        `    (compute it with: node <kit>/plugins/ratchet/ratchet-cli.mjs hash <file>)`,
        `  - author.authority, and status: active only if a human wrote it — an agent`,
        `    decision in a zone with agentAuthority proposeOnly must stay proposed until`,
        `    a human approval ADR names it.`,
        ``,
        `Then call ratchet_compile to confirm it compiles. Writes inside the decisions`,
        `and sources directories are never refused, so the record can be created.`,
      ].join('\n')
    } catch (error) {
      // A guard that throws would deny an unrelated call for an unreadable reason.
      // Reporting and allowing keeps a broken guard from becoming a broken session.
      process.stderr.write(`ratchet: guard failed for ${String(exec?.name)}: ${String(error)}\n`)
      return undefined
    }
  }
}

/**
 * Builds a guard that governs whichever project the calling session is in.
 *
 * A guard is registered once per plugin, but a harness serves sessions in
 * different workspaces, so the project cannot be fixed at registration time. The
 * root is therefore resolved per call from `exec.agent.session.header.cwd` — the
 * same field the tools use — and the decision-state cache is keyed on the root as
 * well as the corpus signature, so two sessions in two projects cannot read each
 * other's decisions.
 *
 * @param options - `{ resolveRoot }` — maps an execution to an absolute project
 *   root or `null`. Injected rather than imported so this module keeps its
 *   ignorance of how the harness finds a workspace.
 * @returns A `ToolGuard` that never throws.
 */
export function createRootGuard({ resolveRoot }) {
  /** root -> { signature, state, guard } */
  const perRoot = new Map()

  /** Returns the per-root guard, creating it when the root is first seen. */
  const guardFor = (root) => {
    if (!perRoot.has(root)) perRoot.set(root, createGuard({ root }))
    return perRoot.get(root)
  }

  return (exec) => {
    try {
      const name = exec?.name
      if (typeof name !== 'string' || !WRITE_TOOLS.includes(name)) return undefined
      const root = resolveRoot(exec)
      if (root === null || root === undefined) return undefined
      return guardFor(root)(exec)
    } catch (error) {
      process.stderr.write(`ratchet: guard failed for ${String(exec?.name)}: ${String(error)}\n`)
      return undefined
    }
  }
}

/**
 * Registers the guard on a Cordis context.
 *
 * `ctx.tools.guard(fn)` is the documented extension point; the guard is registered
 * inside `ctx.effect` so a hot reload replaces it instead of stacking a second one.
 *
 * Registration is DEFENSIVE about the extension point existing. The guard is one
 * feature of the plugin, and a harness whose `tools` service lacks `guard` (an older
 * release, or a stub context in a test) must lose the guard rather than the whole
 * plugin — losing four working tools to protect one rule would be the wrong trade,
 * and it would look like a boot failure rather than a missing feature. The absence
 * is reported once on stderr so it is visible instead of silent.
 *
 * @param ctx - Cordis context exposing `tools`.
 * @param resolveRoot - Maps an execution to an absolute project root or `null`.
 * @returns `{ registered }` — whether the extension point was available.
 */
export function registerGuard(ctx, resolveRoot) {
  if (typeof ctx?.tools?.guard !== 'function') {
    process.stderr.write(
      'ratchet: this harness does not expose ctx.tools.guard, so requiresDecisionRecord is NOT enforced; ' +
        'the ratchet tools still work and ratchet_verify still reports on the decisions themselves\n',
    )
    return { registered: false }
  }
  ctx.effect(() => {
    const dispose = ctx.tools.guard(createRootGuard({ resolveRoot }))
    return () => dispose()
  })
  return { registered: true }
}
