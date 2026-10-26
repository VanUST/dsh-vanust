/**
 * PURPOSE
 *   Let this deployment's skills GROW. SkillClaw's argument is that a skill
 *   library rots: duplicates pile up, stale skills survive, and the good ones
 *   never get written down. Its answer is a proxy plus an evolution server that
 *   rewrites SKILL.md files from session evidence.
 *
 *   The harness already has the half that matters for compatibility: its
 *   `dsh-skill-filesystem` provider discovers `<root>/<name>/SKILL.md` under
 *   `$DSH_HOME/skills` and re-reads each body on every load. So this plugin
 *   implements the missing half — the discipline around writing those files —
 *   and needs no proxy, no Python, and no second process.
 *
 *   The division of labour is deliberate: THE MODEL PROPOSES, THE PLUGIN
 *   ENFORCES. A model is good at noticing "this procedure was worth keeping"
 *   and bad at refusing its own duplicate. So the tools take the content the
 *   agent already has, and the plugin owns what a model should not: name grammar,
 *   size bounds, collision policy, versioning, archiving, and duplicate
 *   detection. Nothing here calls a model, so nothing here can hallucinate a
 *   skill into existence.
 *
 * INPUTS
 *   Config (all optional):
 *     dir            skill library root. Default $DSH_HOME/skills, which is the
 *                    `user-dsh` root the harness's filesystem provider scans.
 *     maxBodyChars   body cap. Default 12000.
 *     minBodyChars   floor that rejects a stub. Default 80.
 *     maxSkills      refuse to grow past this many skills. Default 200.
 *     promptSection  whether to contribute the guidance section. Default true.
 *
 * OUTPUTS
 *   Four tools: `skill_evolve` (create or update one skill, versioning the
 *   previous body), `skill_inventory` (what is there, hand-authored or evolved),
 *   `skill_grow` (duplicate clusters, and the archive action that resolves
 *   them), `skill_forget` (archive one skill). Plus at most one system-prompt
 *   section that states the policy.
 *
 * KEYWORDS
 *   skills, skill evolution, SKILL.md, dedupe, versioning, archive, SkillClaw
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A skill that already exists WITHOUT `metadata.evolvedFrom` is treated as
 *     hand-authored and is NOT overwritten unless the caller passes
 *     `replace: true`. The library's human-written half must not be collateral.
 *   - Every overwrite first copies the previous file into `.history/<name>/`, so
 *     a bad evolution is recoverable without git.
 *   - Archived skills move to `.archive/<name>/`; both hidden directories are
 *     nested one level deeper than the provider's scan, and the provider
 *     deliberately does not discover `**\/SKILL.md`, so archived skills vanish
 *     from the catalog while staying on disk.
 *   - A frontmatter/metadata write failure is a failed call, not a silent
 *     partial file: the new body is written to a temporary path and renamed.
 *   - Two skills whose descriptions or bodies overlap are reported, never merged
 *     automatically; `skill_grow` with `apply: true` archives the losers and
 *     leaves the keeper, which is the reversible half of a merge.
 *   - The tools work with no `systemPrompt` service mounted; the guidance
 *     section is simply absent.
 */

import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DEFAULT_MAX_BODY = 12000
const DEFAULT_MIN_BODY = 80
const DEFAULT_MAX_SKILLS = 200
const MAX_DESCRIPTION = 500
const MIN_DESCRIPTION = 8
const HISTORY_DIR = '.history'
const ARCHIVE_DIR = '.archive'

/** Strip `undefined` fields so the harness's lossless-JSON tool check accepts the value. */
export function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value))
}

/** Resolve the library root without assuming a home layout beyond DSH_HOME. */
export function defaultDir(env = process.env) {
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.npm', 'dsh')
  return join(home, 'skills')
}

/** Normalize raw plugin config into a total policy. */
export function normalizeConfig(config = {}) {
  const dir = typeof config.dir === 'string' && config.dir !== '' ? config.dir : defaultDir()
  const positive = (value, fallback) => (Number.isSafeInteger(value) && value > 0 ? value : fallback)
  return {
    dir,
    maxBodyChars: positive(config.maxBodyChars, DEFAULT_MAX_BODY),
    minBodyChars: positive(config.minBodyChars, DEFAULT_MIN_BODY),
    maxSkills: positive(config.maxSkills, DEFAULT_MAX_SKILLS),
    promptSection: config.promptSection !== false,
  }
}

/** Split a SKILL.md into its frontmatter fields and body, tolerating no frontmatter. */
export function parseSkill(text) {
  const raw = String(text).replaceAll('\r\n', '\n')
  if (!raw.startsWith('---\n')) return { fields: {}, body: raw }
  const end = raw.indexOf('\n---', 4)
  if (end < 0) return { fields: {}, body: raw }
  const header = raw.slice(4, end)
  const body = raw.slice(end + 4).replace(/^\n/, '')
  const fields = {}
  let parent
  for (const line of header.split('\n')) {
    // A nested key belongs to the block that opened it; `metadata` is the only
    // block this plugin writes, and `evolvedFrom` lives inside it, so failing to
    // read one level of indentation made an evolved skill look hand-authored and
    // every update of it refused. That bug was found by this plugin's own test.
    const nested = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (nested !== null && parent !== undefined) {
      if (typeof fields[parent] !== 'object' || fields[parent] === null) fields[parent] = {}
      fields[parent][nested[1]] = nested[2].replace(/^["']|["']$/g, '')
      continue
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (match === null) continue
    const [, key, value] = match
    if (value === '') {
      parent = key
      fields[key] = {}
      continue
    }
    parent = undefined
    fields[key] = value.replace(/^["']|["']$/g, '')
  }
  return { fields, body }
}

/** Whether a parsed skill was produced by this plugin rather than written by a human. */
export function isEvolved(parsed) {
  const metadata = parsed?.fields?.metadata
  if (metadata === null || typeof metadata !== 'object') return false
  return typeof metadata.evolvedFrom === 'string' && metadata.evolvedFrom !== ''
}

/** Render the file the provider will discover. */
export function renderSkill({ name, description, whenToUse, evolvedFrom, evolvedAt, body }) {
  const lines = ['---', `name: ${name}`, `description: ${oneLine(description)}`]
  if (typeof whenToUse === 'string' && whenToUse !== '') lines.push(`whenToUse: ${oneLine(whenToUse)}`)
  if (typeof evolvedFrom === 'string' && evolvedFrom !== '') {
    lines.push('metadata:')
    lines.push(`  evolvedFrom: ${oneLine(evolvedFrom)}`)
    lines.push(`  evolvedAt: ${oneLine(evolvedAt ?? new Date().toISOString())}`)
  }
  lines.push('---', '')
  return `${lines.join('\n')}\n${String(body).trim()}\n`
}

/** Frontmatter values are single-line: a newline would corrupt the YAML block. */
function oneLine(value) {
  return String(value).replace(/\s+/g, ' ').trim()
}

/** Reject anything that would produce an undiscoverable or unsafe skill. */
export function validate(input, policy) {
  const problems = []
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  const description = typeof input?.description === 'string' ? input.description.trim() : ''
  const body = typeof input?.body === 'string' ? input.body.trim() : ''
  if (!KEBAB.test(name)) problems.push('name must be kebab-case: lowercase letters, digits and single hyphens')
  if (description.length < MIN_DESCRIPTION) problems.push(`description must be at least ${MIN_DESCRIPTION} characters`)
  if (description.length > MAX_DESCRIPTION) problems.push(`description must be at most ${MAX_DESCRIPTION} characters`)
  if (body.length < policy.minBodyChars) problems.push(`body must be at least ${policy.minBodyChars} characters — a procedure, not a title`)
  if (body.length > policy.maxBodyChars) problems.push(`body must be at most ${policy.maxBodyChars} characters`)
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(`${description}${body}`)) problems.push('content contains control characters')
  return { ok: problems.length === 0, problems, name, description, body }
}

/**
 * Every skill the provider would discover, read from disk rather than from a cache.
 *
 * Two shapes count, because the harness's own provider accepts both: a directory
 * bundle `<name>/SKILL.md` and a flat `<name>.md` at the root. `stat` follows
 * symlinks on purpose — the provider discovers a symlinked skill, so an inventory
 * that skipped one would report a library the catalog does not have, and `evolve`
 * would then create a SECOND skill under a name that already exists.
 *
 * @param dir - the skill library root.
 * @returns One entry per discovered skill, sorted by directory name.
 */
export async function listSkills(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const skills = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    let file
    let kind
    if (entry.name.endsWith('.md') && !entry.isDirectory()) {
      file = join(dir, entry.name)
      kind = 'file'
    } else {
      file = join(dir, entry.name, 'SKILL.md')
      kind = 'directory'
    }
    // `stat`, not the dirent: a symlink to a skill directory is a skill.
    try {
      const info = await stat(file)
      if (!info.isFile()) continue
      const parsed = parseSkill(await readFile(file, 'utf8'))
      skills.push({
        name: parsed.fields.name ?? (kind === 'file' ? entry.name.replace(/\.md$/, '') : entry.name),
        directory: kind === 'file' ? entry.name.replace(/\.md$/, '') : entry.name,
        kind,
        description: parsed.fields.description ?? '',
        evolved: isEvolved(parsed),
        chars: parsed.body.length,
        path: file,
        updatedAt: info.mtime.toISOString(),
      })
    } catch {
      // A vanished or unreadable entry is not a skill; the next assembly sees the truth.
    }
  }
  return skills.sort((left, right) => left.directory.localeCompare(right.directory))
}

/** Word set used for duplicate detection; deliberately dumb and deterministic. */
export function tokenSet(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2),
  )
}

/** Jaccard similarity of two token sets, 0..1. */
export function similarity(left, right) {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return shared / (left.size + right.size - shared)
}

/** Pair every skill with every other and report the pairs above the threshold. */
export function duplicatePairs(skills, threshold = 0.55) {
  const pairs = []
  for (let left = 0; left < skills.length; left += 1) {
    for (let right = left + 1; right < skills.length; right += 1) {
      const first = skills[left]
      const second = skills[right]
      const score = Math.max(
        similarity(tokenSet(first.description), tokenSet(second.description)),
        similarity(tokenSet(first.description), tokenSet(second.name.replaceAll('-', ' '))),
      )
      if (score >= threshold) pairs.push({ a: first.name, b: second.name, score: Number(score.toFixed(3)) })
    }
  }
  return pairs.sort((left, right) => right.score - left.score)
}

/** Copy the current bytes into `.history/<name>/<stamp>.md` before they are replaced. */
async function archiveVersion(dir, skill) {
  if (skill === undefined) return undefined
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '')
  const target = join(dir, HISTORY_DIR, skill.directory, `${stamp}.md`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, await readFile(skill.path, 'utf8'))
  return target
}

/** Move a skill out of the catalog into `.archive/`, keeping its bytes. */
async function archiveSkill(dir, skill) {
  if (skill === undefined) return undefined
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '')
  await mkdir(join(dir, ARCHIVE_DIR), { recursive: true })
  // A directory bundle moves its whole directory (SKILL.md's parent); a flat skill
  // moves the file itself. Renaming SKILL.md alone would leave an empty bundle in
  // the catalog, which the provider would still list.
  const container = skill.kind === 'file' ? skill.path : dirname(skill.path)
  const target = join(dir, ARCHIVE_DIR, `${skill.directory}-${stamp}${skill.kind === 'file' ? '.md' : ''}`)
  await rename(container, target)
  return target
}

/** Create or update one skill, enforcing every rule in this file's header. */
export async function evolveSkill(policy, input) {
  const checked = validate(input, policy)
  if (!checked.ok) return { ok: false, code: 'invalid', problems: checked.problems }
  const { name, description, body } = checked
  await mkdir(policy.dir, { recursive: true })

  const existing = await listSkills(policy.dir)
  const current = existing.find((skill) => skill.directory === name)
  if (current === undefined && existing.length >= policy.maxSkills) {
    return { ok: false, code: 'library_full', limit: policy.maxSkills, next: ['archive a skill with skill_forget before adding another'] }
  }
  if (current !== undefined && !current.evolved && input?.replace !== true) {
    return {
      ok: false,
      code: 'hand_authored',
      path: current.path,
      next: ['this skill was not written by skill_evolve; pass replace: true only if the human asked for it to be rewritten'],
    }
  }

  const archived = await archiveVersion(policy.dir, current)
  // A flat skill is updated in place. Writing a bundle beside it would leave two
  // skills with one name, and the registry would pick one of them silently.
  const target = current?.kind === 'file' ? current.path : join(policy.dir, name, 'SKILL.md')
  await mkdir(dirname(target), { recursive: true })
  const body_text = renderSkill({
    name,
    description,
    whenToUse: input?.whenToUse,
    evolvedFrom: input?.evidence ?? 'agent-session',
    evolvedAt: new Date().toISOString(),
    body,
  })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, body_text)
  await rename(temporary, target)

  return jsonSafe({
    ok: true,
    action: current === undefined ? 'created' : 'updated',
    name,
    path: target,
    chars: body.length,
    archivedVersion: archived ?? null,
    note: current === undefined ? 'the next catalog assembly discovers this skill' : 'the previous body is kept under .history/',
  })
}

/** Archive one skill so the catalog stops offering it. */
export async function forgetSkill(policy, input) {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!KEBAB.test(name)) return { ok: false, code: 'invalid_name' }
  const skill = (await listSkills(policy.dir)).find((entry) => entry.directory === name || entry.name === name)
  if (skill === undefined) return { ok: false, code: 'not_found', name }
  const path = await archiveSkill(policy.dir, skill)
  if (path === undefined) return { ok: false, code: 'not_found', name }
  return jsonSafe({ ok: true, action: 'archived', name, archivedTo: path })
}

/** Report the library, and optionally resolve duplicate clusters by archiving. */
export async function growSkills(policy, input) {
  const skills = await listSkills(policy.dir)
  const pairs = duplicatePairs(skills, typeof input?.threshold === 'number' ? input.threshold : 0.55)
  const report = {
    ok: true,
    library: policy.dir,
    total: skills.length,
    evolved: skills.filter((skill) => skill.evolved).length,
    handAuthored: skills.filter((skill) => !skill.evolved).length,
    pairs,
  }
  if (input?.apply !== true || pairs.length === 0) return jsonSafe(report)

  // Keep the evolved member, then the larger body; archive the rest. Never touch
  // a hand-authored skill: a merge is the one action that can lose human words.
  const archived = []
  const seen = new Set()
  for (const pair of pairs) {
    const members = [pair.a, pair.b]
      .map((name) => skills.find((skill) => skill.name === name))
      .filter((skill) => skill !== undefined)
    const evolved = members.filter((skill) => skill.evolved)
    if (evolved.length < 2) continue
    const keeper = evolved.sort((left, right) => right.chars - left.chars)[0]
    for (const member of evolved) {
      if (member.name === keeper.name || seen.has(member.name)) continue
      seen.add(member.name)
      const path = await archiveSkill(policy.dir, member)
      if (path !== undefined) archived.push({ name: member.name, kept: keeper.name, archivedTo: path })
    }
  }
  return jsonSafe({ ...report, applied: true, archived })
}

/** List what is in the library without applying anything. */
export async function inventorySkills(policy) {
  const skills = await listSkills(policy.dir)
  let historyEntries = 0
  try {
    for (const name of await readdir(join(policy.dir, HISTORY_DIR))) {
      historyEntries += (await readdir(join(policy.dir, HISTORY_DIR, name))).length
    }
  } catch {
    historyEntries = 0
  }
  let archivedEntries = 0
  try {
    archivedEntries = (await readdir(join(policy.dir, ARCHIVE_DIR))).length
  } catch {
    archivedEntries = 0
  }
  return jsonSafe({
    ok: true,
    library: policy.dir,
    total: skills.length,
    evolved: skills.filter((skill) => skill.evolved).length,
    handAuthored: skills.filter((skill) => !skill.evolved).length,
    historyEntries,
    archivedEntries,
    skills: skills.map(({ path, ...rest }) => ({ ...rest, file: path })),
  })
}

/** The guidance section. Kept short: it is re-evaluated on every assembly. */
export function sectionText(policy) {
  return [
    'SKILLS CAN GROW.',
    `The deployment keeps reusable procedures as SKILL.md files under ${policy.dir}, and every agent on this machine discovers them.`,
    'After a task where a procedure actually worked — a build incantation, a trap, an order of operations that saved a retry — call skill_evolve with the exact steps, a one-line description of when to use it, and the session evidence. Call skill_inventory first: if an existing skill already covers it, leave it alone.',
    'Never record trivia, one-off facts, or a secret. Never rewrite a skill you did not write unless the human asked. Call skill_grow when the library starts to repeat itself, and skill_forget for a procedure that no longer works.',
  ].join(' ')
}

/** The four tools, exported separately so they are exercisable without a Context. */
export function skillTools(define, policy) {
  const output = {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
  const evolve = define({
    name: 'skill_evolve',
    description:
      'Create or update one reusable skill as a SKILL.md file the whole machine discovers. Pass the procedure itself, not a summary of it. Refuses a hand-authored skill unless replace is true; every overwrite keeps the previous body under .history/. Check skill_inventory first so the library does not gain a duplicate.',
    parameters: {
      name: { type: 'string', required: true, description: 'Kebab-case skill name, e.g. "recover-a-stuck-pnpm-store".' },
      description: { type: 'string', required: true, description: 'One line naming WHEN to use it; it is the only routing signal the catalog shows.' },
      body: { type: 'string', required: true, description: 'The procedure in Markdown: ordered steps, the exact commands, and the failure it prevents.' },
      whenToUse: { type: 'string', description: 'Optional extra routing guidance.' },
      evidence: { type: 'string', description: 'What this came from, e.g. a session id or a task title. Stored in frontmatter so a bad skill is traceable.' },
      replace: { type: 'boolean', description: 'Set true ONLY to rewrite a skill a human wrote. Evolved skills update without it.' },
    },
    output,
    async execute(args) {
      return evolveSkill(policy, args ?? {})
    },
  })

  const inventory = define({
    name: 'skill_inventory',
    description:
      'List the skills this deployment holds, with which were evolved by an agent and which a human authored, plus body sizes, history versions and archived count. Read it before adding a skill.',
    parameters: {},
    output,
    async execute() {
      return inventorySkills(policy)
    },
  })

  const grow = define({
    name: 'skill_grow',
    description:
      'Find skills that repeat each other and, with apply: true, archive the losing evolved duplicates and keep the keeper. A dry run is the default. Hand-authored skills are never archived.',
    parameters: {
      apply: { type: 'boolean', description: 'Archive the losing evolved duplicates. Default false: report only.' },
      threshold: { type: 'number', description: 'Similarity 0..1 above which two descriptions count as duplicates. Default 0.55.' },
    },
    output,
    async execute(args) {
      return growSkills(policy, args ?? {})
    },
  })

  const forget = define({
    name: 'skill_forget',
    description:
      'Archive one skill so the catalog stops offering it. The bytes are kept under .archive/, so a mistaken forget is recoverable by moving the directory back.',
    parameters: {
      name: { type: 'string', required: true, description: 'The kebab-case skill name to archive.' },
    },
    output,
    async execute(args) {
      return forgetSkill(policy, args ?? {})
    },
  })

  return { evolve, inventory, grow, forget }
}

export const name = '@cc/dsh-skill-evolve'
/** The tool registry is the only hard dependency; the prompt section is optional. */
export const inject = ['tools']

/** Register the tools, then the guidance section when the prompt registry exists. */
export function apply(ctx, config = {}) {
  const policy = normalizeConfig(config)
  const tools = skillTools(defineTool, policy)
  ctx.tools.register(tools.evolve)
  ctx.tools.register(tools.inventory)
  ctx.tools.register(tools.grow)
  ctx.tools.register(tools.forget)

  if (!policy.promptSection) return
  ctx.inject(['systemPrompt'], (scope) => {
    const order = scope.systemPrompt.getSectionOrder?.('skills:evolve') ?? 10060
    const dispose = scope.systemPrompt.section({
      name: 'skills:evolve',
      order,
      text: () => {
        try {
          return sectionText(policy)
        } catch {
          return ''
        }
      },
    })
    scope.on('dispose', () => dispose?.())
  })
}
