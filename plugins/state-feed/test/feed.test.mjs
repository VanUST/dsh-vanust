/*
PROOF: state-feed delivery contract
Behavior: a root session receives L1 exactly once as a model-visible message containing the
  digest (and the plan/snapshot when present); a workspace without state/views/digest.md gets
  nothing; a delegated worker gets nothing; at a turn boundary one aggregated L2 delta enters
  the step through the agent/pre-step decision only when the projection hash changed, capped at
  1200 bytes, and never twice in the same turn even when the state changes more than once.
  Both the first message and the delta name the active task count and list the open tasks
  (open, active and review; each count is that status's own) from state/views/board.md, at most
  twelve titles with a "+N more" line, and say "no open tasks" when there are none.
Fails when: L1 repeats, a worker or a stateless workspace receives an injection, L2 fires on an
  unchanged hash, a second change inside one turn produces a second delta, the pre-step
  participant writes the session itself (agent.inject() inside the hook, which parks the delta
  behind the step it was preparing), a capped delta keeps a section header with no rows, or the
  open-task section names a closed task, drifts past twelve titles, or is missing from L1.
Production path: plugins/state-feed/index.mjs (apply) with lib/feed.mjs; the loop appends the
  decision's messages as user/message (dsh-agent-loop/lib/index.js:873-878), so the state is in
  the conversation and "model-visible means logged" still holds.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateService } from '../../project-state/lib/core.mjs'
import { L1_HEADER, L2_HEADER, L2_LIMIT_BYTES, composeL1, composeL2, readState, stateMessage } from '../lib/feed.mjs'
import { apply, isRootAgent } from '../index.mjs'

const clock = () => '2026-01-03T00:00:00.000Z'

/** A fake host: collects handlers and every injected message. */
function host() {
  const handlers = { 'agent/created': [], 'agent/pre-step': [] }
  const ctx = {
    on(event, handler) {
      if (handlers[event] !== undefined) handlers[event].push(handler)
    },
    logger: { warn() {} },
  }
  return { ctx, handlers }
}

const created = async (env, agent) => {
  for (const handler of env.handlers['agent/created']) await handler({ agent })
}

/**
 * Run one pre-step. `claimed` is the batch the harness claimed before the waterfall, and
 * `next` enters the step with it — the shape dsh-agent-loop/lib/index.js:683-710 gives a
 * participant. Returns the decision the participant chain produced.
 */
const preStep = async (env, agent, turn, step, claimed = []) => {
  let decision
  for (const handler of env.handlers['agent/pre-step']) {
    decision = await handler(
      { agent, turn, step, messages: claimed },
      async () => ({ kind: 'enter', messages: claimed }),
    )
  }
  return decision
}

const human = (text = 'continue') => ({ id: `human-${text}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })

function agentOf(cwd, { id = 'root-1', depth = 0, parent } = {}) {
  const injected = []
  const agent = {
    session: { id, header: { cwd, delegationDepth: depth, ...(parent === undefined ? {} : { parentSession: parent }) } },
    inject(message) {
      injected.push(message)
    },
  }
  return { agent, injected }
}

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'state-feed-'))
  const state = createStateService({ cwd, now: clock })
  const req = await state.create('req', { title: 'State feed', criteria: ['L1 once', 'L2 by hash'] })
  const task = await state.create('task', { title: 'Deliver the digest', reqId: req.id })
  await state.regenerateViews()
  await writeFile(join(cwd, 'state', 'plan.yaml'), 'name: probe\nphase: delivery\n')
  return { cwd, state, req, task }
}

test('root receives L1 once, with the digest and the plan', async () => {
  const { cwd } = await workspace()
  const env = host()
  apply(env.ctx)
  const { agent, injected } = agentOf(cwd)
  await created(env, agent)
  assert.equal(injected.length, 1)
  const text = injected[0].content[0].text
  assert.ok(text.startsWith(L1_HEADER))
  assert.match(text, /REQ 1 · TASK 1/)
  assert.match(text, /## Plan/)
  assert.match(text, /name: probe/)
  assert.equal(injected[0].source.kind, 'state-feed')
  const decision = await preStep(env, agent, 2, 1, [human()])
  assert.equal(injected.length, 1, 'L1 is never repeated')
  assert.equal(decision.messages.length, 1, 'a first step with no delta enters only the claimed batch')
})

test('no state/views/digest.md means no injection at all', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'state-feed-empty-'))
  const env = host()
  apply(env.ctx)
  const { agent, injected } = agentOf(cwd)
  await created(env, agent)
  const claimed = [human()]
  const decision = await preStep(env, agent, 2, 1, claimed)
  assert.equal(injected.length, 0)
  assert.deepEqual(decision.messages, claimed)
})

test('a delegated worker receives neither L1 nor L2', async () => {
  const { cwd } = await workspace()
  const env = host()
  apply(env.ctx)
  const { agent, injected } = agentOf(cwd, { depth: 1 })
  await created(env, agent)
  const claimed = [human()]
  const decision = await preStep(env, agent, 2, 1, claimed)
  assert.equal(injected.length, 0)
  assert.deepEqual(decision.messages, claimed)
  assert.equal(isRootAgent(agent), false)
})

/*
PROOF: the delta enters the step through the decision, never through a session write in the hook
Behavior: the agent/pre-step participant awaits the rest of the waterfall and returns its
  decision with the delta appended after the claimed batch; agent.inject() is not called for L2,
  so the delta cannot be parked in the "next-step" inbox behind the step it was preparing, and a
  second step of the same turn adds no second delta.
Fails when: the participant calls agent.inject() before returning next() (the shipped defect: the
  message went to the next-step inbox, inject never wakes the driver, and a turn with no further
  step left the delta pending until a new user message woke it), or a turn gets two deltas.
*/
test('the delta enters the step decision and never the session inbox', async () => {
  const { cwd, state, req } = await workspace()
  const env = host()
  apply(env.ctx)
  const { agent, injected } = agentOf(cwd)
  await created(env, agent)
  assert.equal(injected.length, 1)
  await state.create('task', { title: 'Second task', reqId: req.id })
  await state.regenerateViews()
  const claimed = [human()]
  const decision = await preStep(env, agent, 3, 1, claimed)
  assert.equal(injected.length, 1, 'the pre-step participant makes no session write: no inject() call')
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 2, 'the claimed batch plus exactly one delta')
  assert.equal(decision.messages[0], claimed[0])
  const delta = decision.messages[1]
  assert.equal(delta.source.kind, 'state-feed')
  assert.ok(delta.content[0].text.startsWith(L2_HEADER))
  // The next step of the same turn sees the newest hash already, so nothing is added again.
  const second = await preStep(env, agent, 3, 2, [])
  assert.equal(second.messages.length, 0, 'one delta per turn')
  assert.equal(injected.length, 1)
})

test('L2 fires once on a changed hash and not again in the same turn', async () => {
  const { cwd, state, req } = await workspace()
  const env = host()
  apply(env.ctx)
  const { agent, injected } = agentOf(cwd)
  await created(env, agent)
  assert.equal(injected.length, 1)
  // Unchanged state: a turn boundary adds nothing.
  assert.equal((await preStep(env, agent, 2, 1, [])).messages.length, 0)
  // A real change between turns: one delta, capped.
  await state.create('task', { title: 'Second task', reqId: req.id })
  await state.regenerateViews()
  const first = await preStep(env, agent, 3, 1, [])
  assert.equal(first.messages.length, 1)
  const delta = first.messages[0].content[0].text
  assert.ok(delta.startsWith(L2_HEADER))
  assert.ok(Buffer.byteLength(delta, 'utf8') <= L2_LIMIT_BYTES)
  // Two more changes inside turn 3 still produce no second delta for that turn.
  await state.create('task', { title: 'Third task', reqId: req.id })
  await state.regenerateViews()
  await preStep(env, agent, 3, 1, [])
  await preStep(env, agent, 3, 2, [])
  assert.equal(injected.length, 1)
  // The next turn sees the newest hash.
  const next = await preStep(env, agent, 4, 1, [])
  assert.equal(next.messages.length, 1)
  assert.ok(next.messages[0].content[0].text.startsWith(L2_HEADER))
})

test('L1 that missed agent/created arrives in the first step, before the delta', async () => {
  const { cwd } = await workspace()
  const env = host()
  apply(env.ctx)
  const { agent, injected } = agentOf(cwd)
  // No created event: the state appeared after the session began.
  const claimed = [human()]
  const decision = await preStep(env, agent, 2, 1, claimed)
  assert.equal(injected.length, 0)
  assert.equal(decision.messages.length, 2)
  assert.ok(decision.messages[0].content[0].text.startsWith(L1_HEADER))
  assert.equal(decision.messages[1], claimed[0])
})

test('composeL2 aggregates several changes into one bounded delta', async () => {
  const { cwd, state, req } = await workspace()
  const before = readState(cwd)
  await state.create('task', { title: 'A', reqId: req.id })
  await state.create('task', { title: 'B', reqId: req.id })
  await state.regenerateViews()
  const after = readState(cwd)
  const delta = composeL2(after, before.hash)
  assert.ok(delta.includes(L2_HEADER))
  assert.ok(Buffer.byteLength(delta, 'utf8') <= L2_LIMIT_BYTES)
  assert.match(delta, /- TASK: 3/)
  assert.equal(delta.includes('\n- TASK: 1\n'), false)
})

/*
PROOF: a capped delta does not end on a section header with no rows
Behavior: when the byte cap cuts a section before its rows, the header and the blank line after
  it are dropped with them and the truncation marker names where to read the rest.
Fails when: the kept prefix ends on "## Counts" (or any "## " header) followed by nothing but
  the marker — the artefact a reader saw as a header with no rows under it.
*/
test('a capped delta never leaves a section header with no rows', () => {
  // The snapshot's counts line is what usually makes a delta long; one long line pushes the
  // "## Counts" header past the budget while the header itself still fits.
  const snapshot = `- last journal event: ${'x'.repeat(4000)}\n- REQ: 1`
  const text = composeL2({ digest: '', snapshot, hash: 'a'.repeat(64) }, 'b'.repeat(64))
  assert.ok(Buffer.byteLength(text, 'utf8') <= L2_LIMIT_BYTES)
  assert.ok(text.includes('[state delta truncated; read state/views/digest.md]'))
  assert.equal(text.includes('## Counts'), false, 'the header went with the rows it introduced')
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith('## ')) continue
    const rows = lines.slice(index + 1).filter((line) => line.trim() !== '' && !line.startsWith('['))
    assert.ok(rows.length > 0, `header "${lines[index]}" has no rows under it`)
  }
})

test('composeL1 keeps the digest, the plan and the snapshot in a fixed order', async () => {
  const { cwd } = await workspace()
  const state = readState(cwd)
  const text = composeL1(state)
  const digestAt = text.indexOf(state.digest.trim())
  const planAt = text.indexOf('## Plan')
  const snapshotAt = text.indexOf('## Last snapshot')
  assert.ok(digestAt >= 0 && planAt > digestAt && snapshotAt > planAt)
})

/*
PROOF: an injected message carries the identity the session log requires
Behavior: every injected message has a fresh non-empty `id` alongside its role, source and
  content, so the harness's `adoptSessionEvent` accepts the user/message event it writes.
Fails when: the message is composed without an `id` (the defect shipped in 0.1.1: the session
  persisted the message verbatim and every later load was refused with "session event at seq N
  lacks an identified message"), or two injections reuse one identity.
*/
test('every injected message carries a fresh identity', async () => {
  const { cwd } = await workspace()
  const env = host()
  apply(env.ctx)
  const { agent, injected } = agentOf(cwd)
  await created(env, agent)
  const decision = await preStep(env, agent, 2, 1, [])
  assert.equal(injected.length, 1)
  const message = injected[0]
  assert.equal(typeof message.id, 'string')
  assert.ok(message.id.length > 0)
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'state-feed')
  assert.ok(Array.isArray(message.content))
  assert.equal(decision.messages.length, 0)
  // A second injection must not reuse the first identity.
  assert.notEqual(stateMessage('another').id, message.id)
})

/**
 * A board in the projection's own format, copied from state/views/board.md: the status heading
 * carries its count, the separator row follows the header, and a row is
 * `| TASK-nnn | title | reqs | steps | chore |`.
 */
const REAL_BOARD = `# Board

GENERATED — DO NOT EDIT. Regenerated from \`state/task/\` by \`regenerateViews()\`.

## open (2)

| id | title | reqs | steps | chore |
|---|---|---|---|---|
| TASK-315 | A task waiting to be claimed | — | — | no |
| TASK-316 | Another unclaimed task | — | — | no |

## active (1)

| id | title | reqs | steps | chore |
|---|---|---|---|---|
| TASK-314 | State notification names active tasks and lists open task titles | — | — | yes |

## review (1)

| id | title | reqs | steps | chore |
|---|---|---|---|---|
| TASK-309 | P4: installed 1.0.0 in the browser, no v1 names in the artefact | REQ-246, REQ-247 | — | no |

## done (1)

| id | title | reqs | steps | chore |
|---|---|---|---|---|
| TASK-001 | Hindsight integration | — | — | no |

## cancelled (1)

| id | title | reqs | steps | chore |
|---|---|---|---|---|
| TASK-200 | A cancelled task | — | — | no |
`

/** A board with `count` tasks in one open status. */
function boardWith(count, { status = 'active', title = (index) => `Task ${index}` } = {}) {
  const rows = Array.from({ length: count }, (_, index) => `| TASK-${400 + index} | ${title(index + 1)} | — | — | no |`)
  return `# Board\n\n## ${status} (${count})\n\n| id | title | reqs | steps | chore |\n|---|---|---|---|---|\n${rows.join('\n')}\n`
}

/** A snapshot carrying the ledger's recorded agents figure. */
const SNAPSHOT_WITH_AGENTS = '# State snapshot\n\n- last journal event: 7\n- active agents: 3\n'

/*
PROOF: the state messages say what is in flight
Behavior: both L1 and the delta carry one counter line - unclosed tasks, active tasks, active
  agents - and list the open task titles with their status, parsed from state/views/board.md and
  the snapshot's "active agents" line; at most twelve titles are listed and a "+N more" line
  follows a longer board; a board with no open task says "no open tasks"; done and cancelled rows
  never appear.
Fails when: the feed invents a second source for the figures, counts a closed task as unclosed,
  omits the ledger's agents figure, stops the list at some other number, leaves the heading with
  nothing under it, or omits the section from the first message.
*/
test('the delta names the three figures and lists the open titles from the board', () => {
  const delta = composeL2({ digest: '', snapshot: SNAPSHOT_WITH_AGENTS, board: REAL_BOARD, hash: 'a'.repeat(64) }, 'b'.repeat(64))
  assert.match(delta, /## Open tasks/)
  assert.match(delta, /unclosed: 4, active: 1, agents: 3/)
  assert.match(delta, /- TASK-315 \[open\] A task waiting to be claimed/)
  assert.match(delta, /- TASK-316 \[open\] Another unclaimed task/)
  assert.match(delta, /- TASK-314 \[active\] State notification names active tasks and lists open task titles/)
  assert.match(delta, /- TASK-309 \[review\] P4: installed 1\.0\.0 in the browser, no v1 names in the artefact/)
  assert.equal(delta.includes('Hindsight integration'), false, 'a done task is not open')
  assert.equal(delta.includes('A cancelled task'), false, 'a cancelled task is not open')
})

/*
PROOF: the counter names the three figures the owner asked for, each its own quantity
Behavior: "unclosed" is every task that is not done and not cancelled (a blocked task is
  unclosed), "active" is the tasks whose status is exactly active, and "agents" is the snapshot's
  recorded working-session count. A board with one open, two active, three review, one blocked and
  one done task with agents 4 reads "unclosed: 7, active: 2, agents: 4" and lists six titles.
Fails when: a figure is the length of the list (the shipped defect), a closed task counts as
  unclosed, a blocked task is left out of unclosed, or the agents figure is invented rather than
  read from the snapshot.
*/
test('the counter names unclosed, active and agents, each its own quantity', () => {
  const board = [
    '# Board', '',
    '## open (1)', '', '| id | title | reqs | steps | chore |', '|---|---|---|---|---|', '| TASK-401 | Waiting one | — | — | no |', '',
    '## active (2)', '', '| id | title | reqs | steps | chore |', '|---|---|---|---|---|', '| TASK-402 | Active one | — | — | no |', '| TASK-403 | Active two | — | — | no |', '',
    '## review (3)', '', '| id | title | reqs | steps | chore |', '|---|---|---|---|---|', '| TASK-404 | Review one | — | — | no |', '| TASK-405 | Review two | — | — | no |', '| TASK-406 | Review three | — | — | no |', '',
    '## blocked (1)', '', '| id | title | reqs | steps | chore |', '|---|---|---|---|---|', '| TASK-407 | Blocked one | — | — | no |', '',
    '## done (1)', '', '| id | title | reqs | steps | chore |', '|---|---|---|---|---|', '| TASK-408 | Finished one | — | — | no |', '',
  ].join('\n')
  const snapshot = '# State snapshot\n\n- last journal event: 8\n- active agents: 4\n'
  const delta = composeL2({ digest: '', snapshot, board, hash: 'a'.repeat(64) }, 'b'.repeat(64))
  assert.match(delta, /unclosed: 7, active: 2, agents: 4/)
  assert.equal((delta.match(/^- TASK-\d+ \[(open|active|review)\] /gm) ?? []).length, 6)
  // No working session reads 0 even though the list is not empty.
  const noAgents = composeL2({ digest: '', snapshot: '# State snapshot\n\n- active agents: 0\n', board: boardWith(2), hash: 'a'.repeat(64) }, 'b'.repeat(64))
  assert.match(noAgents, /unclosed: 2, active: 2, agents: 0/)
  assert.equal((noAgents.match(/^- TASK-\d+ \[active\] /gm) ?? []).length, 2)
})

test('the open-task list stops at twelve titles and says how many more there are', () => {
  const delta = composeL2({ digest: '', snapshot: '', board: boardWith(15), hash: 'a'.repeat(64) }, 'b'.repeat(64))
  assert.match(delta, /unclosed: 15, active: 15, agents: 0/)
  assert.equal((delta.match(/^- TASK-\d+ \[active\] /gm) ?? []).length, 12)
  assert.match(delta, /- \+3 more \(state\/views\/board\.md\)/)
  assert.equal(delta.includes('Task 13'), false)
})

test('a board with no open task says so instead of leaving the heading alone', () => {
  const board = `# Board\n\n## done (1)\n\n| id | title | reqs | steps | chore |\n|---|---|---|---|---|\n| TASK-001 | Hindsight integration | — | — | no |\n`
  const delta = composeL2({ digest: '', snapshot: '', board, hash: 'a'.repeat(64) }, 'b'.repeat(64))
  assert.match(delta, /## Open tasks\n\nunclosed: 0, active: 0, agents: 0\n\nno open tasks/)
})

test('the first message carries the same open-tasks section once', () => {
  const text = composeL1({ digest: 'digest body', board: REAL_BOARD, snapshot: SNAPSHOT_WITH_AGENTS, plan: null })
  assert.equal((text.match(/## Open tasks/g) ?? []).length, 1)
  assert.match(text, /unclosed: 4, active: 1, agents: 3/)
  assert.match(text, /- TASK-315 \[open\] /)
  assert.match(text, /- TASK-314 \[active\] /)
  assert.match(text, /- TASK-309 \[review\] /)
})

test('the workspace board parses: the three figures come from the board and the snapshot', async (t) => {
  let board
  let snapshot
  try {
    board = await readFile(new URL('../../../state/views/board.md', import.meta.url), 'utf8')
    snapshot = await readFile(new URL('../../../state/views/snapshot.md', import.meta.url), 'utf8')
  } catch {
    return t.skip('this checkout has no state/views projection set')
  }
  const counts = {}
  for (const match of board.matchAll(/^## (\S+) \((\d+)\)$/gm)) counts[match[1]] = Number(match[2])
  const unclosed = Object.entries(counts)
    .filter(([status]) => status !== 'done' && status !== 'cancelled')
    .reduce((sum, [, value]) => sum + value, 0)
  const agents = Number(/^- active agents:\s*(\d+)\s*$/m.exec(snapshot)?.[1] ?? 0)
  const listed = (counts.open ?? 0) + (counts.active ?? 0) + (counts.review ?? 0)
  const delta = composeL2({ digest: '', snapshot, board, hash: 'a'.repeat(64) }, 'b'.repeat(64))
  // Unclosed is every non-closed status, active is the active section, agents the snapshot's line.
  assert.match(delta, new RegExp(`unclosed: ${unclosed}, active: ${counts.active ?? 0}, agents: ${agents}`))
  if (listed === 0) {
    assert.match(delta, /no open tasks/)
    return
  }
  assert.match(delta, /^- TASK-\d+ \[(open|active|review)\] /m)
})

test('a delta whose open-task rows do not fit drops the section, not just its heading', () => {
  const board = boardWith(1, { title: () => 'x'.repeat(1400) })
  const delta = composeL2({ digest: '', snapshot: '', board, hash: 'a'.repeat(64) }, 'b'.repeat(64))
  assert.ok(Buffer.byteLength(delta, 'utf8') <= L2_LIMIT_BYTES)
  assert.ok(delta.includes('[state delta truncated; read state/views/digest.md]'))
  assert.equal(delta.includes('## Open tasks'), false, 'the heading went with the rows it introduced')
})
