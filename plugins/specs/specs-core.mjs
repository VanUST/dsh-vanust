/**
 * PURPOSE
 *   Locate a project's human-authored spec documents and render them as the text a
 *   system prompt carries, so every agent working in that project - a root session and
 *   any subagent it starts - reads the same requirements.
 *
 *   Specs are advisory data owned by a human. Nothing in this module compiles them,
 *   checks code against them, or writes them: it READS `<root>/docs/specs` and renders
 *   it. There are no laws, no checks, no verdicts and no consent here.
 *
 * INPUTS
 *   `start` (string): a directory to search upward from, normally the session workspace
 *   (`session.header.cwd`). `specs` (array): the objects `readSpecs` returns.
 *   File convention: every `*.md` directly inside `<root>/docs/specs` is a spec, with
 *   optional leading frontmatter carrying `title` and `status`.
 *
 * OUTPUTS
 *   `findProjectRoot(start)` -> absolute path. The nearest ancestor of `start` holding
 *     `.dsh/project.json` or `.git`; `start` itself when no ancestor qualifies.
 *   `readSpecs(root)` -> array of `{ file, title, status, body }`, filename order. Empty
 *     when `docs/specs` is absent or holds no readable markdown. Never throws.
 *   `activeSpecs(specs)` -> the subset a prompt carries: `status` absent, or exactly
 *     `active`. `draft`, `done`, `inactive` and anything else are not injected.
 *   `renderSpecsPrompt(specs, root)` -> string; empty when nothing is active. Truncates
 *     on a documented character budget and names what it omitted.
 *
 * KEYWORDS
 *   specs, system prompt, project root, frontmatter, advisory, injection, read-only
 *
 * BEHAVIOUR ON EDGE CASES
 *   - `start` missing or not a directory: returned resolved, with no walk.
 *   - No `docs/specs` directory: empty array, not an error.
 *   - Unreadable file, or one that is not valid UTF-8: skipped, so one bad file cannot
 *     empty the whole section.
 *   - Empty or whitespace-only file: skipped.
 *   - Frontmatter absent or malformed: the entire file is the body, `title` falls back
 *     to the filename, `status` to null (which counts as active).
 *   - Byte-order mark: stripped before parsing.
 *   - Budget exceeded: specs are taken in filename order until the budget is reached and
 *     the rendered text names how many were omitted, so a silent truncation is impossible.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Largest number of characters one spec may contribute; the excess is trimmed. */
const MAX_SPEC_CHARS = 20000

/** Largest number of characters every spec together may contribute. */
const MAX_TOTAL_CHARS = 60000

/**
 * Find the directory a project is rooted at, searching upward from a session workspace.
 *
 * A marker is `.dsh/project.json` (this deployment's own manifest) or `.git` (any
 * repository), so a project that never adopted the manifest still gets its specs
 * injected. The first ancestor carrying either wins, which is what makes a session
 * opened in a subdirectory read the specs of the project rather than of the subdirectory.
 *
 * @param start - Directory to search from. A relative value is resolved against the
 *   process directory; a non-string or empty value falls back to the process directory.
 * @returns Absolute path of the nearest ancestor carrying a marker, else of `start`.
 */
export function findProjectRoot(start) {
  const base = typeof start === 'string' && start.length > 0 ? resolve(start) : process.cwd()
  let current = base
  for (;;) {
    try {
      if (existsSync(join(current, '.dsh', 'project.json'))) return current
      if (existsSync(join(current, '.git'))) return current
    } catch {
      // An unreadable ancestor answers nothing; keep walking rather than failing.
    }
    const parent = dirname(current)
    if (parent === current) return base
    current = parent
  }
}

/**
 * Split YAML-ish frontmatter from a spec file.
 *
 * Deliberately a minimal reader rather than a YAML dependency: a plugin installed into a
 * profile must resolve its imports through that profile, so a parser package that pnpm
 * does not hoist would fail at import time and take the whole prompt section with it.
 * Only top-level `key: value` lines are understood, which is all the spec format uses.
 *
 * @param text - File contents, already BOM-stripped.
 * @returns `{ meta, body }`. `meta` is a plain object of the frontmatter's scalar keys;
 *   it is empty and `body` is the whole text when there is no well-formed block.
 */
function splitFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (match === null) return { meta: {}, body: text }
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (pair === null) continue
    meta[pair[1]] = pair[2].trim().replace(/^["']|["']$/g, '')
  }
  return { meta, body: text.slice(match[0].length) }
}

/**
 * Parse one spec document.
 *
 * @param text - Raw file contents, with or without a byte-order mark.
 * @param file - Base filename, used as the title when the frontmatter has none.
 * @returns `{ title, status, body }`. `status` is null when the frontmatter declares
 *   none, which counts as active; `title` falls back to the filename without `.md`.
 */
export function parseSpec(text, file) {
  const clean = String(text).replace(/^\uFEFF/, '')
  const { meta, body } = splitFrontmatter(clean)
  const title = meta.title && meta.title.length > 0
    ? meta.title
    : file.replace(/\.md$/i, '')
  return {
    title,
    status: meta.status && meta.status.length > 0 ? meta.status.toLowerCase() : null,
    body: body.trim(),
  }
}

/**
 * Read every spec a project declares.
 *
 * @param root - Absolute project root, normally from {@link findProjectRoot}.
 * @returns Array of `{ file, title, status, body }` in filename order. Empty - never an
 *   error - when the directory is missing, is not a directory, or holds nothing readable.
 */
export function readSpecs(root) {
  const dir = join(root, 'docs', 'specs')
  let names
  try {
    if (!statSync(dir).isDirectory()) return []
    names = readdirSync(dir)
  } catch {
    return []
  }
  const specs = []
  for (const name of names.filter((entry) => entry.toLowerCase().endsWith('.md')).sort()) {
    let text
    try {
      text = readFileSync(join(dir, name), 'utf8')
    } catch {
      // Unreadable or not valid UTF-8: skip this file, keep the rest.
      continue
    }
    const parsed = parseSpec(text, name)
    if (parsed.body.length === 0) continue
    specs.push({ file: name, ...parsed })
  }
  return specs
}

/**
 * The specs a prompt carries.
 *
 * @param specs - Array from {@link readSpecs}.
 * @returns The subset whose status is absent or exactly `active`. A non-array input
 *   yields an empty array.
 */
export function activeSpecs(specs) {
  if (!Array.isArray(specs)) return []
  return specs.filter((spec) => spec.status === null || spec.status === 'active')
}

/**
 * Render the injected section.
 *
 * @param specs - Array of spec objects, normally already filtered by {@link activeSpecs}.
 * @param root - Absolute project root, used to print a workspace-relative source path.
 * @returns The section text, or an empty string when there is nothing to inject. A spec
 *   longer than the per-spec budget is trimmed with a named marker; specs beyond the
 *   total budget are omitted and counted.
 */
export function renderSpecsPrompt(specs, root) {
  if (!Array.isArray(specs) || specs.length === 0) return ''
  const header = [
    'ACTIVE PROJECT SPECS - requirements written by the human for this project.',
    'Follow them. Do not edit or delete them, and do not treat the task you were given as',
    'authority to override one: if a spec conflicts with what you were asked to do, say so',
    'instead of silently choosing.',
  ].join('\n')

  const blocks = []
  let used = header.length
  let omitted = 0
  for (const spec of specs) {
    let body = spec.body
    let trimmed = false
    if (body.length > MAX_SPEC_CHARS) {
      body = body.slice(0, MAX_SPEC_CHARS)
      trimmed = true
    }
    // A literal forward-slash path, not `join`: this string reaches a model, and a
    // platform-specific separator would make the same project render differently on
    // Windows and Linux for no reason.
    const label = `\n### ${spec.title}\nsource: docs/specs/${spec.file}`
    const block = `${label}\n${body}${trimmed ? '\n\n[trimmed: this spec exceeded the injection budget]' : ''}`
    if (used + block.length > MAX_TOTAL_CHARS) {
      omitted += 1
      continue
    }
    used += block.length
    blocks.push(block)
  }

  const tail = omitted > 0
    ? `\n\n[${omitted} further active spec(s) omitted: the project's specs exceed the injection budget]`
    : ''
  return `${header}${blocks.join('\n')}${tail}`
}
