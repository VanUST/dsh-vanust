/**
 * PURPOSE
 *   Prove, in one run, the four context-bound changes of the codex-context-bounds initiative:
 *   an oversized tool result from a tool the profile lists arrives as a banner plus a readable
 *   full-text file; the workspace board is paged instead of dumped; the orchestrator allow row
 *   decides what per-agent kit plugins may register; and the compaction threshold is the
 *   per-window budget for the general presets (about 500K at a 1M window, at most 218K at
 *   272K, never the old flat 136K), with ONE declared exception: preset-architect keeps half
 *   of its 272K window (136K) because that route is the expensive one. The exception is
 *   pinned by NAME and VALUE, so a second quiet exception, or a changed value, breaks the
 *   run instead of passing as a general block.
 *
 * INPUTS
 *   profile/cordis.patch.yml (read-only): the real allow row, the run-code-projection tool
 *   list and every preset's compaction-basic block. The real plugins
 *   (plugins/run-code-projection, plugins/taskboard) applied to fake contexts, a temporary
 *   workspace holding a seeded .dsh/taskboard.json of 60 tasks, and scripts/tool-surface-proof.mjs
 *   spawned for the kit registrations. No live server, no session, no write outside the
 *   temporary workspace.
 *
 * OUTPUTS
 *   One row per check, then 'context-bounds proof: PASS|FAIL (n checks)'. Exit 0 only when every
 *   row passed. When CASE_SUMMARY names a path, the JSON metrics/hashes case_run judges are
 *   written there.
 *
 *   CASE_NEGATIVE_CONTROL=pre-change re-runs the SAME assertions against the pre-change values:
 *   the one-tool projection list (run_code only), the old allow row, a flat 0.5 compaction with
 *   no model policy in EVERY block (including the general ones), and a whole-board task_list
 *   request. It must exit 1; that is the control proving the checks reject the regression they
 *   exist for.
 *
 * KEYWORDS
 *   context bounds, projection, spill file, task_list paging, allow row, tool registration,
 *   compaction threshold, negative control, proof
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply as applyProjection, BANNER_PREFIX, parseBanner } from '../plugins/run-code-projection/run-code-projection.mjs'
import { apply as applyTaskboard } from '../plugins/taskboard/taskboard.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PROFILE = join(ROOT, 'profile', 'cordis.patch.yml')
const WINDOW_1M = 1_048_576
const WINDOW_272K = 272_000
const CONTRACT_TOOLS = ['task_get', 'task_update', 'task_close', 'analysis_read', 'analysis_upsert', 'skill', 'delegation_brief', 'delegation_return']
const OLD_ROW = ['designmap_apply', 'designmap_export', 'designmap_lint', 'designmap_open', 'designmap_render', 'designmap_scan', 'designmap_status', 'hindsight_reflect', 'task_link', 'task_pause', 'task_remove', 'task_resume']
const INTAKE = ['case_drift', 'case_get', 'case_list', 'case_record', 'delegation_brief']

const control = process.env.CASE_NEGATIVE_CONTROL ?? ''
if (control !== '' && control !== 'pre-change') {
  console.error(`context-bounds proof: unknown negative control "${control}" (the only control is "pre-change")`)
  process.exit(1)
}
const preChange = control === 'pre-change'

const rows = []
let failed = false
function check(scenario, ok, detail) {
  rows.push({ scenario, ok, detail: String(detail) })
  if (!ok) failed = true
}

/** The '- name' entries under families.<preset>.allow in the real profile. */
function parseAllowRow(lines, preset) {
  const trimmed = lines.map((line) => line.trim())
  const familiesAt = trimmed.indexOf('families:')
  if (familiesAt === -1) throw new Error('profile has no families block')
  const presetAt = trimmed.findIndex((line, index) => index > familiesAt && line === preset + ':')
  if (presetAt === -1) throw new Error('profile has no row for ' + preset)
  const allowAt = trimmed.findIndex((line, index) => index > presetAt && line === 'allow:')
  if (allowAt === -1) throw new Error('row ' + preset + ' has no allow list')
  const names = []
  for (let index = allowAt + 1; index < trimmed.length; index += 1) {
    const line = trimmed[index]
    if (!line.startsWith('- ')) break
    names.push(line.slice(2).trim())
  }
  return names
}

/** The tool names under the run-code-projection row's config.tools, or null when unset. */
function parseProjectionTools(lines) {
  const rowAt = lines.findIndex((line) => line.trim() === '- id: run-code-projection')
  if (rowAt === -1) throw new Error('profile has no run-code-projection row')
  const toolsAt = lines.findIndex((line, index) => index > rowAt && line.trim() === 'tools:')
  if (toolsAt === -1) return null
  const names = []
  for (let index = toolsAt + 1; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line.startsWith('- ')) break
    names.push(line.slice(2).trim())
  }
  return names
}

/**
 * Every compaction-basic block: its default ratio, its per-model policies and the preset it
 * belongs to. The preset is what separates the general budget from the one declared exception
 * (preset-architect), so ownership is read from the nearest preceding `- id: preset-*` row
 * rather than assumed from the block's position in the file.
 */
function parseCompactionBlocks(lines) {
  const blocks = []
  let preset = null
  for (let index = 0; index < lines.length; index += 1) {
    const presetHead = /^\s*- id: (preset-[a-z0-9-]+)\s*$/.exec(lines[index])
    if (presetHead !== null) preset = presetHead[1]
    const head = /^(\s*)- id: compaction-basic\s*$/.exec(lines[index])
    if (head === null) continue
    const indent = head[1].length
    const body = []
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      if (line.trim() === '') continue
      const lead = /^\s*/.exec(line)[0].length
      if (lead < indent + 2) break
      body.push(line)
    }
    const ratios = body.map((line) => /^(\s*)thresholdRatio:\s*([0-9.]+)\s*$/.exec(line)).filter((match) => match !== null)
    if (ratios.length === 0) throw new Error('a compaction-basic block has no thresholdRatio')
    const baseIndent = Math.min(...ratios.map((match) => match[1].length))
    const defaults = ratios.filter((match) => match[1].length === baseIndent)
    const policies = []
    let current = null
    for (const line of body) {
      const provider = /^\s*-\s+provider:\s*(\S+)\s*$/.exec(line)
      if (provider !== null) {
        current = { provider: provider[1], model: null, ratio: null }
        policies.push(current)
        continue
      }
      const model = /^\s*model:\s*(\S+)\s*$/.exec(line)
      if (model !== null && current !== null) current.model = model[1]
      const ratio = /^(\s*)thresholdRatio:\s*([0-9.]+)\s*$/.exec(line)
      if (ratio !== null && current !== null && ratio[1].length > baseIndent) current.ratio = Number(ratio[2])
    }
    blocks.push({ preset, defaultRatio: Number(defaults[0][2]), policies })
  }
  return blocks
}

/** A fake Cordis context that captures the tools/post-execute waterfall. */
function projectionListener(tools) {
  const handlers = new Map()
  applyProjection(
    {
      logger: { warn() {} },
      on(event, handler) {
        handlers.set(event, handler)
        return () => handlers.delete(event)
      },
    },
    { tools },
  )
  return handlers.get('tools/post-execute')
}

/** Run the listener once and return the model-facing content it produced. */
async function projectResult(listener, { name, text, cwd, isError = false }) {
  const exec = { name, callId: 'call_00_PROOF000000000000000', arguments: { description: 'proof' }, signal: { aborted: false }, agent: { session: { header: { cwd } } } }
  const result = isError
    ? { isError: true, error: { message: 'program failed' }, content: [{ type: 'text', text }] }
    : { isError: false, value: { logs: [], result: null }, content: [{ type: 'text', text }] }
  const decision = await listener(exec, result, () => Promise.resolve({ kind: 'accept' }))
  return Array.isArray(decision?.content) ? decision.content : result.content
}

/** The single text block of a content array, or null. */
function textOf(content) {
  return Array.isArray(content) && content.length === 1 && content[0]?.type === 'text' && typeof content[0].text === 'string' ? content[0].text : null
}

const STATUSES = ['open', 'active', 'review', 'done']
const TASKS = Array.from({ length: 60 }, (_, index) => ({
  id: 'task-' + index,
  title: 'Task ' + index,
  status: STATUSES[index % STATUSES.length],
  chatId: 'chat-root',
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
}))

/** Register the real taskboard plugin on a fake context and return its task_list tool. */
function taskListTool(boardDir) {
  mkdirSync(join(boardDir, '.dsh'), { recursive: true })
  writeFileSync(join(boardDir, '.dsh', 'taskboard.json'), JSON.stringify({ version: 1, revision: 1, agents: [], tasks: TASKS }))
  const registered = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    get() {
      return undefined
    },
    on() {
      return () => {}
    },
    effect(fn) {
      return fn()
    },
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
    provide(name, value) {
      return value
    },
    systemPrompt: { section: () => () => {} },
    commands: { register() {} },
  }
  applyTaskboard(ctx, {})
  return registered.find((tool) => tool.name === 'task_list')
}

const workspace = mkdtempSync(join(tmpdir(), 'context-bounds-'))
const metrics = {}
let profileTools = null
let allowNames = null
let blocks = null

try {
  const lines = readFileSync(PROFILE, 'utf8').split('\n')

  // ── projection: the profile's tool list, the banner and the spill file ─────
  profileTools = parseProjectionTools(lines)
  if (preChange) profileTools = ['run_code']
  check(
    'projection config names the bulk tools (read, bash, web_fetch, hindsight_read_page, task_list)',
    Array.isArray(profileTools) && ['read', 'bash', 'web_fetch', 'hindsight_read_page', 'task_list'].every((name) => profileTools.includes(name)),
    Array.isArray(profileTools) ? profileTools.join(',') : 'no config.tools (the plugin defaults apply)',
  )
  check(
    'projection config keeps the contract tools whole',
    Array.isArray(profileTools) && CONTRACT_TOOLS.every((name) => !profileTools.includes(name)),
    Array.isArray(profileTools) ? CONTRACT_TOOLS.filter((name) => profileTools.includes(name)).join(',') || 'none listed' : 'no list',
  )

  const listener = projectionListener(Array.isArray(profileTools) ? profileTools : [])
  const spillDir = join(workspace, '.dsh', 'spill')
  const taskListText = JSON.stringify({ scope: 'workspace', tasks: Array.from({ length: 250 }, (_, index) => ({ id: 'task-' + index, title: 'Task ' + index, status: 'open' })) })
  const taskListContent = await projectResult(listener, { name: 'task_list', text: taskListText, cwd: workspace })
  const taskListProjected = textOf(taskListContent)
  const bannerPath = taskListProjected === null ? null : parseBanner(taskListProjected)
  const spillRead = bannerPath !== null && bannerPath.startsWith(spillDir) && existsSync(bannerPath) ? readFileSync(bannerPath, 'utf8') : null
  const middle = taskListText.slice(4000, 4200)
  check(
    'a task_list result above the threshold arrives as a banner naming the full text',
    taskListProjected !== null && taskListProjected.startsWith(BANNER_PREFIX) && bannerPath !== null && bannerPath.startsWith(spillDir),
    bannerPath ?? 'not projected',
  )
  check(
    'the full text reads back identical from the banner path',
    spillRead === taskListText,
    spillRead === null ? 'no readable spill file' : spillRead === taskListText ? 'read back identical' : 'DIFFERS',
  )
  check(
    'the projection keeps the head and the tail and drops the middle',
    taskListProjected !== null && taskListProjected.includes(taskListText.slice(0, 1000)) && taskListProjected.includes(taskListText.slice(-1000)) && !taskListProjected.includes(middle),
    taskListProjected === null ? 'not projected' : taskListProjected.length + ' chars',
  )

  // `read` carries its own floor of 64 KiB (TOOL_MIN_BYTES in the projection plugin): a
  // document under it is what the model asked to see whole. The fixture is a file above it.
  const readText = Array.from({ length: 3400 }, (_, index) => 'line ' + index + ' of the file').join('\n')
  const readContent = await projectResult(listener, { name: 'read', text: readText, cwd: workspace })
  check('a read above the 64 KiB read floor is projected too', parseBanner(textOf(readContent)) !== null, 'read bounded, ' + readText.length + ' chars')

  const getText = JSON.stringify({ task: { id: 'task-1', revision: 7 }, notes: 'x'.repeat(9000) })
  const getContent = await projectResult(listener, { name: 'task_get', text: getText, cwd: workspace })
  check('task_get keeps its revision and its whole text', textOf(getContent) === getText, 'untouched')

  const skillText = 'Follow these instructions: ' + 's'.repeat(12000)
  const skillContent = await projectResult(listener, { name: 'skill', text: skillText, cwd: workspace })
  check('skill keeps its instructions whole', textOf(skillContent) === skillText, 'untouched')

  const errorContent = await projectResult(listener, { name: 'task_list', text: taskListText, cwd: workspace, isError: true })
  check('a failed result is never projected', textOf(errorContent) === taskListText, 'error untouched')

  const again = await projectResult(listener, { name: 'task_list', text: taskListProjected ?? taskListText, cwd: workspace })
  check('a second pass creates no second projection', textOf(again) === taskListProjected, taskListProjected === null ? 'nothing projected once' : 'same banner')

  metrics.projectionTools = Array.isArray(profileTools) ? profileTools.length : 0
  metrics.projectionBefore = taskListText.length
  metrics.projectionAfter = taskListProjected === null ? taskListText.length : taskListProjected.length
  metrics.projectionSavedPct = metrics.projectionBefore > 0 ? Math.round(1000 * (1 - metrics.projectionAfter / metrics.projectionBefore)) / 10 : 0
  metrics.projectionSpillReadable = spillRead === taskListText ? 1 : 0

  // ── task_list: the workspace board is paged, not dumped ────────────────────
  const boardDir = join(workspace, 'board')
  const tool = taskListTool(boardDir)
  check('task_list is registered', tool !== undefined, tool === undefined ? 'no task_list tool' : 'task_list found')
  if (tool === undefined) throw new Error('cannot continue without the task_list tool')
  const exec = { agent: { id: 'chat-root', session: { header: { cwd: boardDir } } } }

  const pageOne = await tool.execute(preChange ? { scope: 'workspace', limit: 200 } : { scope: 'workspace' }, exec)
  const pageOneChars = JSON.stringify(pageOne).length
  check('page one is 25 rows of 60, with counts and a next cursor', pageOne.tasks.length === 25 && pageOne.total === 60 && pageOne.counts?.open === 15 && pageOne.counts?.review === 15 && pageOne.next?.offset === 25 && typeof pageOne.hint === 'string', 'rows=' + pageOne.tasks.length + ' total=' + pageOne.total + ' next=' + JSON.stringify(pageOne.next))
  check('page one stays far below the old whole-board dump', pageOneChars < 12000, pageOneChars + ' chars')

  const offsetPage = await tool.execute({ scope: 'workspace', limit: 10, offset: 50 }, exec)
  check('limit and offset read the requested page', offsetPage.tasks.length === 10 && offsetPage.next === undefined && offsetPage.total === 60, 'rows=' + offsetPage.tasks.length)

  const review = await tool.execute({ scope: 'workspace', status: 'review' }, exec)
  check('a status filter narrows the page', review.total === 15 && review.tasks.every((task) => task.status === 'review'), 'total=' + review.total)

  const chat = await tool.execute({}, exec)
  check('chat scope keeps its own 50-row default', chat.tasks.length === 50 && chat.next?.offset === 50, 'rows=' + chat.tasks.length)

  metrics.taskListRows = pageOne.tasks.length
  metrics.taskListChars = pageOneChars
  metrics.taskListTotal = pageOne.total

  // ── the allow row acts on per-agent kit registrations ──────────────────────
  allowNames = parseAllowRow(lines, 'orchestrator')
  if (preChange) allowNames = [...allowNames.filter((name) => !INTAKE.includes(name)), ...OLD_ROW]
  check('the allow row names the case intake and delegation_brief', INTAKE.every((name) => allowNames.includes(name)), INTAKE.filter((name) => allowNames.includes(name)).join(',') || 'none')
  check('the allow row drops the zero-use tools', OLD_ROW.every((name) => !allowNames.includes(name)) && !allowNames.includes('diagram') && !allowNames.includes('case_run') && !allowNames.includes('case_gate'), OLD_ROW.filter((name) => allowNames.includes(name)).join(',') || 'none')
  check('the row stays within the 45-tool budget', allowNames.length <= 45, allowNames.length + ' entries')

  const surface = spawnSync(process.execPath, [join(ROOT, 'scripts', 'tool-surface-proof.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 60000 })
  const surfaceOut = (surface.stdout ?? '') + (surface.stderr ?? '')
  const surfaceMatch = /tool-surface proof: (PASS|FAIL) \((\d+) checks\)/.exec(surfaceOut)
  const surfaceChecks = surfaceMatch === null ? 0 : Number(surfaceMatch[2])
  check('the kit plugins register through the row (tool-surface proof against the profile on disk)', surface.status === 0 && surfaceMatch?.[1] === 'PASS', surface.status === 0 ? surfaceChecks + ' registration checks' : 'exit ' + surface.status)

  metrics.allowRowEntries = allowNames.length
  metrics.allowRowChecks = surface.status === 0 ? surfaceChecks : 0

  // ── compaction: one budget for the general presets, one declared exception ──
  // The profile isolates a compaction group per preset, so "isolated" cannot mean the YAML
  // shape. The exception is the PRESET that owns a block with its own budget: preset-architect
  // keeps half of its 272K window (136K) because that route is the expensive one. Everything
  // else is general and must follow the per-window budget. A new preset that quietly deviates
  // lands in the general set and fails its checks; a value change inside the exception fails
  // the pinned 136K check and the isolatedBlocks count.
  const EXCEPTION_PRESET = 'preset-architect'
  blocks = parseCompactionBlocks(lines)
  if (preChange) blocks = blocks.map((block) => ({ ...block, defaultRatio: 0.5, policies: [] }))
  check('every preset carries a compaction block', blocks.length >= 8, blocks.length + ' blocks')

  const general = blocks.filter((block) => block.preset !== EXCEPTION_PRESET)
  const isolated = blocks.filter((block) => block.preset === EXCEPTION_PRESET)
  check('exactly one isolated compaction exception exists (preset-architect)', isolated.length === 1, isolated.map((block) => block.preset).join(',') || 'none')

  check('no general block compacts later than 80% of the window', general.every((block) => block.defaultRatio <= 0.8), 'max ratio ' + Math.max(...general.map((block) => block.defaultRatio)))
  check('every general block compacts a 272K window at 0.8, above 136K', general.every((block) => block.defaultRatio === 0.8), 'min ratio ' + Math.min(...general.map((block) => block.defaultRatio)))

  const flashRatioOf = (block) => {
    const policy = block.policies.find((entry) => entry.provider === 'deepseek-official' && entry.model === 'deepseek-flash')
    return policy === undefined || policy.ratio === null ? null : policy.ratio
  }
  const generalFlash = general.map(flashRatioOf)
  check('every general block overrides deepseek-flash to 0.5', generalFlash.every((ratio) => ratio === 0.5), JSON.stringify(generalFlash))

  const allGeneralFlash = generalFlash.every((ratio) => ratio !== null)
  metrics.compactionBlocks = blocks.length
  metrics.compactionGeneralBlocks = general.length
  metrics.isolatedBlocks = isolated.length
  metrics.compactionGeneralRatio = allGeneralFlash ? Math.min(...generalFlash) : 0
  metrics.compactionGeneralDefaultRatio = Math.max(...general.map((block) => block.defaultRatio))
  metrics.compactionGeneral1M = Math.round((allGeneralFlash ? Math.min(...generalFlash) : 0) * WINDOW_1M)
  metrics.compactionGeneral272K = Math.round(Math.max(...general.map((block) => block.defaultRatio)) * WINDOW_272K)
  metrics.compactionIsolated272K = isolated.length === 1 ? Math.round(isolated[0].defaultRatio * WINDOW_272K) : 0
  metrics.compactionIsolatedRatio = isolated.length === 1 ? isolated[0].defaultRatio : 0

  check(
    'the general blocks compact a 1M window at half of it (524 288 tokens)',
    metrics.compactionGeneral1M === Math.round(0.5 * WINDOW_1M),
    metrics.compactionGeneral1M + ' tokens',
  )
  check(
    'the general blocks compact a 272K window at 0.8 (217 600 tokens, above 136K)',
    metrics.compactionGeneral272K > 136000 && metrics.compactionGeneral272K <= 218000,
    metrics.compactionGeneral272K + ' tokens',
  )
  check(
    'the declared architect exception compacts a 272K window at exactly 136 000 tokens (0.5)',
    isolated.length === 1 && isolated[0].defaultRatio === 0.5 && metrics.compactionIsolated272K === 136000,
    metrics.compactionIsolated272K + ' tokens',
  )
  check(
    'the architect exception has no 1M flash policy (its route is the 272K one)',
    isolated.length === 1 && flashRatioOf(isolated[0]) === null,
    'flashRatio=' + String(isolated.length === 1 ? flashRatioOf(isolated[0]) : 'none'),
  )
} catch (error) {
  check('the four settings parse and run', false, error instanceof Error ? error.message : String(error))
} finally {
  rmSync(workspace, { recursive: true, force: true })
}

metrics.checks = rows.length
metrics.failures = rows.filter((row) => !row.ok).length
metrics.negativeControl = preChange ? 1 : 0

const hashes = {
  profile: createHash('sha256').update(readFileSync(PROFILE)).digest('hex'),
  projection: createHash('sha256').update(readFileSync(join(ROOT, 'plugins', 'run-code-projection', 'run-code-projection.mjs'))).digest('hex'),
  taskboard: createHash('sha256').update(readFileSync(join(ROOT, 'plugins', 'taskboard', 'taskboard.mjs'))).digest('hex'),
  toolFamilies: createHash('sha256').update(readFileSync(join(ROOT, 'plugins', 'tool-families', 'tool-families.mjs'))).digest('hex'),
}
const summaryPath = process.env.CASE_SUMMARY
if (typeof summaryPath === 'string' && summaryPath !== '') {
  writeFileSync(summaryPath, JSON.stringify({ metrics, hashes, artifacts: [], notes: rows.map((row) => (row.ok ? 'PASS ' : 'FAIL ') + row.scenario).slice(-6).join('\n').slice(0, 2000) }, null, 2))
}

const width = rows.reduce((max, row) => Math.max(max, row.scenario.length), 'scenario'.length)
console.log('context-bounds proof' + (preChange ? ' (negative control: pre-change values)' : '') + '\n')
for (const row of rows) console.log(row.scenario.padEnd(width) + '  ' + (row.ok ? 'PASS' : 'FAIL') + ' ' + row.detail)
console.log('')
console.log(failed ? 'context-bounds proof: FAIL (' + rows.length + ' checks)' : 'context-bounds proof: PASS (' + rows.length + ' checks)')
process.exitCode = failed ? 1 : 0
