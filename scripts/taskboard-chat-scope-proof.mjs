#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove that a role's specialist child is scoped to the CHAT that created it, against the
 *   REAL taskboard service and the REAL `delegate_task` tool body - not a restatement of the
 *   implementation. One run drives three chat ids over a disposable board and answers: does
 *   chat B message chat A's sleeping child, does chat A still reuse its own child after B
 *   delegated, does a different preset in a new chat collide with A's row, does the policy
 *   catalog offer a foreign session for reuse, and does the answer survive a restart of the
 *   plugin (a fresh service instance over the same ledger).
 *
 * WHY IT EXISTS. Measured 2026-11-13: `delegate_task` resolved the role with the
 * workspace-global `taskboard.findAgent` before `chatId` existed, so a new chat treated a
 * sleeping child of another chat as a reuse candidate and called `sendMessage` on it; the
 * runtime refused (a session is a direct child of the chat that started it) and the refusal
 * was reported as if the role had died. The same global row refused a different preset and a
 * similar name that belonged to somebody else's history.
 *
 * INPUTS
 *   --taskboard <path>     taskboard module to test (default plugins/taskboard/taskboard.mjs)
 *   --orchestrator <path>  orchestrator module to test (default plugins/orchestrator/orchestrator.mjs)
 *   --dir <path>           scratch directory for the disposable board (default: a temp dir)
 *   No real child is started: `startActivation` is a recorder, so this proof costs no model
 *   call and creates no session. The fake `sendMessage` enforces the runtime's real rule -
 *   delivery only to a DIRECT child of the calling chat - which is what makes the red run red.
 *
 * OUTPUTS
 *   One PASS/FAIL line per check, then `n/m checks passed`; exit 0 when every check passed,
 *   1 otherwise. The scratch directory is removed on the way out.
 *
 * KEYWORDS
 *   chat scope, subagent reuse, delegate_task, role catalog, preset conflict, restart,
 *   sleeping child, regression proof
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The module paths are imported through `pathToFileURL` (a stable `node:url` API), so the
 *     same script proves the working tree and a copy of an older revision.
 *   - A failure is recorded, never thrown, so one defect does not hide the others.
 *   - Cleanup is in a `finally`: a failing run leaves no disposable board behind.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const value = (name) => {
  const at = argv.indexOf(name)
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : ''
}
const taskboardModule = value('--taskboard') !== '' ? resolve(value('--taskboard')) : join(KIT, 'plugins', 'taskboard', 'taskboard.mjs')
const orchestratorModule = value('--orchestrator') !== '' ? resolve(value('--orchestrator')) : join(KIT, 'plugins', 'orchestrator', 'orchestrator.mjs')
const dir = value('--dir') !== '' ? resolve(value('--dir')) : mkdtempSync(join(tmpdir(), 'taskboard-chat-scope-proof-'))
mkdirSync(dir, { recursive: true })

const { createService } = await import(pathToFileURL(taskboardModule).href)
const { apply, renderRoleCatalog } = await import(pathToFileURL(orchestratorModule).href)

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`)
}

const CHAT_A = 'session-chat-a'
const CHAT_B = 'session-chat-b'
const CHAT_D = 'session-chat-d'
const CHILD_A = 'child-chat-a-backend'

const boardPath = join(dir, 'taskboard.json')
const reset = (agents = [], tasks = []) => writeFileSync(boardPath, `${JSON.stringify({ version: 1, revision: 1, tasks, agents }, null, 2)}\n`)

/**
 * One fake harness for `apply()` and the `delegate_task` body.
 *
 * `sendMessage` reproduces the subagent runtime's delivery rule (direct child only) and
 * `startActivation` records instead of spawning, so "did it message chat A's child" and
 * "was a new child created" are both observable facts, not inferences.
 */
let globalSeq = 0
function harness(carriedOwners) {
  const service = createService({ file: boardPath, linksFile: join(dir, 'links.json') }, { warn() {} }, {})
  const calls = { sendMessage: [], startActivation: [], interrupt: [] }
  // A restart keeps the runtime's identity map: the children it started are still its direct
  // children, only the plugin state is new. Ids never repeat across harnesses.
  const owners = carriedOwners ?? new Map()
  const provider = { capabilities: { agentPreset: true, agentOptions: true } }
  const subagents = {
    getProvider: () => provider,
    async sendMessage(parent, childId) {
      calls.sendMessage.push({ from: parent.id, to: childId })
      if (owners.get(childId) !== parent.id) throw new Error(`session "${childId}" is not a child of "${parent.id}"`)
    },
    async startActivation(spec) {
      const parentId = spec?.request?.parent?.id ?? spec?.parent?.id
      const childId = `child-${++globalSeq}`
      owners.set(childId, parentId)
      calls.startActivation.push({ childId, parentId, preset: spec?.request?.agentPreset ?? spec?.agentPreset })
      return { childId }
    },
    interrupt: (childId) => calls.interrupt.push(childId),
  }
  // A child created before this run (chat A's sleeping specialist) belongs to A.
  owners.set(CHILD_A, CHAT_A)
  const sections = []
  const tool = { definition: undefined }
  const created = []
  const ctx = {
    taskboard: service,
    get(name) { return name === 'taskboard' ? service : undefined },
    on(event, handler) { if (event === 'agent/created') created.push(handler) },
    logger: { warn() {} },
    systemPrompt: { getSectionOrder: () => undefined, section: () => {} },
    tools: { register: () => {}, guard: () => {} },
    subagents,
  }
  apply(ctx, {})
  /** Register the tool for one root chat agent, the way `agent/created` does. */
  const toolFor = (chatId) => {
    const agent = {
      id: chatId,
      session: { header: { id: chatId, cwd: dir } },
      ctx: {
        on: () => {},
        systemPrompt: { getSectionOrder: () => undefined, section: (entry) => sections.push(entry) },
        tools: { guard: () => {}, register: (definition) => { tool.definition = definition } },
      },
    }
    for (const handler of created) handler({ agent })
    return { agent, definition: tool.definition }
  }
  return { service, calls, toolFor, owners }
}

const delegate = async (definition, agent, args) => {
  try {
    return await definition.execute(args, { agent, signal: new AbortController().signal })
  } catch (error) {
    // A refusal that throws is the caller's answer too: record it so one hard refusal cannot
    // hide the remaining checks (the pre-fix preset conflict is exactly that).
    return { ok: false, code: 'threw', message: error instanceof Error ? error.message : String(error) }
  }
}
/** The specialist finished its task and is asleep: the state a later delegation may reuse. */
const settle = (service, childId) => service.childEnded(childId, { stopReason: 'stop' })

const sleepingRow = (role, preset, sessionId, chatSessionId, extra = {}) => ({
  role,
  label: role,
  preset,
  sessionId,
  status: 'sleeping',
  taskCount: 3,
  generation: 2,
  history: [],
  chatSessionId,
  lastTaskId: null,
  createdAt: '2026-11-12T00:00:00.000Z',
  updatedAt: '2026-11-12T00:00:00.000Z',
  ...extra,
})

const baseBoard = () => reset([
  sleepingRow('BACKEND', 'backend', CHILD_A, CHAT_A),
  // A legacy row from before role presets: history, never a reuse target.
  { role: 'RTK-OUTPUT', label: 'RTK-OUTPUT', sessionId: 'child-legacy', status: 'sleeping', taskCount: 9, history: [], lastTaskId: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' },
])

try {
  // ── 1. Chat B does not aim at chat A's sleeping child ───────────────────────
  baseBoard()
  const a = harness()
  const { agent: agentA, definition: toolA } = a.toolFor(CHAT_A)
  const { agent: agentB, definition: toolB } = a.toolFor(CHAT_B)
  const fromB = await delegate(toolB, agentB, { title: 'B first task', role: 'BACKEND', objective: 'do B work', cwd: dir })
  const toChildA = a.calls.sendMessage.filter((call) => call.to === CHILD_A)
  check('chat B never messages chat A\'s child', toChildA.length === 0, toChildA)
  check('chat B creates its own child', fromB?.ok !== false && fromB?.childId !== undefined && fromB.childId !== CHILD_A, { childId: fromB?.childId, reused: fromB?.reused })
  check('chat B starts exactly one child on its own preset', a.calls.startActivation.length === 1 && a.calls.startActivation[0].parentId === CHAT_B && a.calls.startActivation[0].preset === 'backend', a.calls.startActivation)
  check('the result does not report a dead role', fromB?.roleRecreated !== true, { roleRecreated: fromB?.roleRecreated, roleNote: fromB?.roleNote })
  const rowB = a.service.findAgent(dir, 'BACKEND', CHAT_B)
  const rowA = a.service.findAgent(dir, 'BACKEND', CHAT_A)
  check('the ledger keeps one row per (role, chat)', rowA?.sessionId === CHILD_A && rowB?.sessionId === fromB?.childId && rowA.sessionId !== rowB.sessionId, { a: rowA?.sessionId, b: rowB?.sessionId })

  // ── 2. A second delegation in B reuses B's child, not A's ───────────────────
  settle(a.service, fromB.childId)
  const startsBeforeB2 = a.calls.startActivation.length
  const fromB2 = await delegate(toolB, agentB, { title: 'B second task', role: 'BACKEND', objective: 'more B work', cwd: dir })
  check('a repeat delegation in B reuses B\'s child', fromB2?.reused === true && a.calls.sendMessage.some((call) => call.from === CHAT_B && call.to === fromB.childId), { reused: fromB2?.reused, to: fromB.childId })
  check('B\'s second delegation starts no child', a.calls.startActivation.length === startsBeforeB2, { started: a.calls.startActivation.length - startsBeforeB2 })

  // ── 3. Chat A still reuses its own child AFTER B registered ─────────────────
  settle(a.service, fromB2.childId)
  const startsBeforeA = a.calls.startActivation.length
  const fromA = await delegate(toolA, agentA, { title: 'A task', role: 'BACKEND', objective: 'A work', cwd: dir })
  check('chat A reuses chat A\'s child after B delegated', fromA?.reused === true && fromA?.childId === CHILD_A, { childId: fromA?.childId, reused: fromA?.reused })
  check('chat A\'s reuse delivers to its own session', a.calls.sendMessage.some((call) => call.from === CHAT_A && call.to === CHILD_A))
  check('A\'s reuse starts no child', a.calls.startActivation.length === startsBeforeA, { started: a.calls.startActivation.length - startsBeforeA })
  check('A\'s row still records A\'s session and preset', a.service.findAgent(dir, 'BACKEND', CHAT_A)?.sessionId === CHILD_A && a.service.findAgent(dir, 'BACKEND', CHAT_A)?.preset === 'backend')

  // ── 4. A DIFFERENT preset in a new chat does not collide with A's row ───────
  const { agent: agentD, definition: toolD } = a.toolFor(CHAT_D)
  const fromD = await delegate(toolD, agentD, { title: 'D review', role: 'BACKEND', preset: 'reviewer', objective: 'review A', cwd: dir })
  settle(a.service, fromD.childId)
  check('a new chat may use the same role with another preset', fromD?.ok !== false && fromD?.preset === 'reviewer', { ok: fromD?.ok, code: fromD?.code, message: fromD?.message })
  check('the old chat\'s role history is preserved', a.service.findAgent(dir, 'BACKEND', CHAT_A)?.sessionId === CHILD_A && a.service.findAgent(dir, 'BACKEND', CHAT_A)?.preset === 'backend')
  const rowD = a.service.findAgent(dir, 'BACKEND', CHAT_D)
  check('the new preset is recorded as its own row', rowD?.preset === 'reviewer' && rowD?.sessionId === fromD?.childId && rowD?.sessionId !== CHILD_A, { sessionId: rowD?.sessionId, preset: rowD?.preset })
  check('two chats on one role are not a name collision', rowA?.conflict !== true && rowB?.conflict !== true && rowD?.conflict !== true, { a: rowA?.conflict, b: rowB?.conflict, d: rowD?.conflict })

  // ── 5. The policy catalog offers a foreign session as HISTORY, not reuse ────
  const agents = a.service.agents(dir)
  const policyB = renderRoleCatalog(agents, { chatId: CHAT_B })
  const policyA = renderRoleCatalog(agents, { chatId: CHAT_A })
  const earlier = policyB.split('## Roles from earlier chats')[1] ?? ''
  const inThisChatB = policyB.split('## Roles from earlier chats')[0] ?? ''
  check('chat B\'s catalog lists chat A\'s role under earlier chats', earlier.includes('- BACKEND [backend]') && earlier.includes(', another chat'), { earlier: earlier.split('\n').slice(0, 6) })
  check('chat B\'s catalog says a foreign session is not reusable', earlier.includes('cannot be continued from this chat') && earlier.includes('FRESH child'))
  const mineLinesB = inThisChatB.split('\n').filter((line) => line.startsWith('- BACKEND'))
  check('chat B\'s reusable section holds only its own session', mineLinesB.length > 0 && mineLinesB.every((line) => !line.includes('another chat')), { mineLinesB, inThisChatB })
  const mineLinesA = (policyA.split('## Roles from earlier chats')[0] ?? '').split('\n').filter((line) => line.startsWith('- BACKEND'))
  check('chat A\'s catalog lists its own role as reusable', mineLinesA.length > 0 && mineLinesA.every((line) => !line.includes('another chat')), { mineLinesA })
  check('chat A\'s catalog keeps B\'s and D\'s roles as history', (policyA.split('## Roles from earlier chats')[1] ?? '').includes(', another chat'))
  check('a legacy row is history in every chat', policyB.includes('Legacy roles (history only - do not reuse)') && !inThisChatB.includes('- RTK-OUTPUT'))
  check('the unscoped roster still exposes workspace history to the panel', agents.filter((agent) => agent.role === 'BACKEND').length === 3, agents.filter((agent) => agent.role === 'BACKEND').map((agent) => agent.chatSessionId))

  // ── 6. Sleeping / restart: a fresh process state answers from the ledger ────
  settle(a.service, fromA.childId)
  settle(a.service, fromD.childId)
  const beforeRestart = JSON.parse(readFileSync(boardPath, 'utf8'))
  const restarted = harness(a.owners)
  const { agent: agentA2, definition: toolA2 } = restarted.toolFor(CHAT_A)
  const { agent: agentB2, definition: toolB2 } = restarted.toolFor(CHAT_B)
  const afterRestartA = await delegate(toolA2, agentA2, { title: 'A after restart', role: 'BACKEND', objective: 'A again', cwd: dir })
  check('after a restart chat A still reuses its sleeping child', afterRestartA?.reused === true && afterRestartA?.childId === CHILD_A, { childId: afterRestartA?.childId, reused: afterRestartA?.reused })
  const afterRestartB = await delegate(toolB2, agentB2, { title: 'B after restart', role: 'BACKEND', objective: 'B again', cwd: dir })
  check('after a restart chat B still reuses its own child', afterRestartB?.reused === true && afterRestartB?.childId === fromB.childId, { childId: afterRestartB?.childId, reused: afterRestartB?.reused })
  check('a restart starts no extra child', restarted.calls.startActivation.length === 0)
  check('the restart read the ledger instead of rewriting identities', JSON.parse(readFileSync(boardPath, 'utf8')).agents.filter((agent) => agent.role === 'BACKEND').map((agent) => agent.sessionId).sort().join(',') === beforeRestart.agents.filter((agent) => agent.role === 'BACKEND').map((agent) => agent.sessionId).sort().join(','))
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const failed = results.filter((entry) => !entry.ok)
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`)
process.exitCode = failed.length === 0 ? 0 : 1
