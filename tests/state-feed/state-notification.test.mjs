/*
PROOF: the state notification names the in-flight work
Behavior: the first state message (L1) and the delta (L2) each carry one "## Open tasks"
  block built from state/views/board.md: a counts line whose numbers are each status's own
  count (active, open, review), the titles of open tasks with their status, at most twelve
  titles plus a "+N more" line, and "no open tasks" when the board has none open. The delta
  stays within the 1200-byte cap, and the pre-step participant adds the delta to the step
  decision instead of writing it into the session inbox.
Fails when: a message omits the open-tasks block or carries it twice; a count is the length
  of the listed titles instead of that status's own count; a task in status open or active is
  not listed; more than twelve titles are printed or the "+N more" line is missing; an empty
  board leaves the heading without the "no open tasks" line; the delta exceeds the cap; the
  pre-step hook calls agent.inject() instead of returning the message in its decision.
Production path: plugins/state-feed/lib/feed.mjs (readState, composeL1, composeL2) and
  plugins/state-feed/index.mjs (apply), driven through the harness-shaped agent/created and
  agent/pre-step seams. The oracle is the owner's requirement and the task brief, not the
  plugin's own test suite.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = process.env.STATE_FEED_ROOT
  ? resolve(process.env.STATE_FEED_ROOT)
  : resolve(HERE, '..', '..', 'plugins', 'state-feed')

const feed = await import(pathToFileURL(join(PLUGIN_ROOT, 'lib', 'feed.mjs')).href)
const plugin = await import(pathToFileURL(join(PLUGIN_ROOT, 'index.mjs')).href)

const { L2_LIMIT_BYTES, composeL1, composeL2, readState } = feed
const { apply } = plugin

const utf8 = (text) => Buffer.byteLength(text, 'utf8')
const occurrences = (text, needle) => text.split(needle).length - 1

const DIGEST = `# Digest

GENERATED — do not edit.

## Open work

- [active] TASK-902 a first active task
- [review] TASK-904 a first review task

## Gaps

none
`

const SNAPSHOT = `# Snapshot

- REQ: 2 open
- TASK: 6 open
- last journal event: TASK-906
`

/** A board in the projection's own format: "## <status> (<count>)" then table rows. */
function boardOf(sections) {
  const lines = ['# Board', '']
  for (const [status, rows] of Object.entries(sections)) {
    lines.push(`## ${status} (${rows.length})`, '')
    lines.push('| id | title | reqs | steps | chore |', '|---|---|---|---|---|')
    for (const [id, title] of rows) lines.push(`| ${id} | ${title} | — | — | no |`)
    lines.push('')
  }
  return lines.join('\n')
}

const MIXED_BOARD = boardOf({
  open: [['TASK-901', 'an open task']],
  active: [['TASK-902', 'a first active task'], ['TASK-903', 'a second active task']],
  review: [['TASK-904', 'a first review task'], ['TASK-905', 'a second review task'], ['TASK-906', 'a third review task']],
  done: [['TASK-001', 'a finished task'], ['TASK-002', 'another finished task']],
  cancelled: [['TASK-003', 'a cancelled task']],
})

/** Write a state/ projection set and return its root. */
async function workspace({ board = MIXED_BOARD, digest = DIGEST, snapshot = SNAPSHOT } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'state-feed-acceptance-'))
  await mkdir(join(cwd, 'state', 'views'), { recursive: true })
  await writeFile(join(cwd, 'state', 'views', 'board.md'), board, 'utf8')
  await writeFile(join(cwd, 'state', 'views', 'digest.md'), digest, 'utf8')
  await writeFile(join(cwd, 'state', 'views', 'snapshot.md'), snapshot, 'utf8')
  return cwd
}

/** The lines under "## Open tasks", stopping at the next level-two heading. */
function openBlock(text) {
  const lines = String(text).split('\n')
  const start = lines.findIndex((line) => line.trim() === '## Open tasks')
  assert.notEqual(start, -1, 'the message has no "## Open tasks" heading')
  const block = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break
    block.push(line)
  }
  return block
}

function countsLine(text) {
  const matches = [...String(text).matchAll(/^active:\s*(\d+),\s*open:\s*(\d+),\s*review:\s*(\d+)\s*$/gm)]
  assert.equal(matches.length, 1, 'the message must carry exactly one counts line')
  return { active: Number(matches[0][1]), open: Number(matches[0][2]), review: Number(matches[0][3]) }
}

/** A fake host context: records the hooks the plugin registers. */
function host() {
  const handlers = new Map()
  const ctx = {
    on(event, handler, options) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push({ handler, options })
    },
  }
  return { ctx, handlers }
}

function rootAgent(cwd, { id = 'root-acceptance' } = {}) {
  const injected = []
  const agent = {
    session: { id, header: { cwd, delegationDepth: 0 } },
    inject(message) {
      injected.push(message)
    },
  }
  return { agent, injected }
}

async function startSession(cwd) {
  const { ctx, handlers } = host()
  apply(ctx, {})
  const { agent, injected } = rootAgent(cwd)
  for (const { handler } of handlers.get('agent/created') ?? []) await handler({ agent })
  return { agent, injected, handlers }
}

async function preStep(handlers, agent, { turn, step, messages }) {
  let decision
  for (const { handler } of handlers.get('agent/pre-step') ?? []) {
    decision = await handler({ agent, turn, step, messages }, () => ({ kind: 'enter', messages }))
  }
  return decision
}

test('the first message carries the open-tasks block exactly once and reaches the root session', async () => {
  const cwd = await workspace()
  const state = readState(cwd)
  assert.equal(state.ok, true, 'the fixture must be readable state')

  const composed = composeL1(state)
  assert.equal(occurrences(composed, '## Open tasks'), 1, 'L1 must carry the open-tasks heading exactly once')

  const { injected } = await startSession(cwd)
  assert.equal(injected.length, 1, 'a root session gets the first message once')
  const text = injected[0].content[0].text
  assert.equal(occurrences(text, '## Open tasks'), 1, 'the delivered first message must carry the block exactly once')
  assert.equal(text, composed, 'the delivered first message is the composed one')
})

test('the delta carries the open-tasks block exactly once', async () => {
  const cwd = await workspace()
  const state = readState(cwd)
  assert.equal(state.ok, true)

  const delta = composeL2(state, '0'.repeat(64))
  assert.equal(occurrences(delta, '## Open tasks'), 1, 'L2 must carry the open-tasks heading exactly once')
  assert.match(delta, /^STATE \(L2, delta\)/m, 'the second message is the delta')
})

test('each number in the counts line is that status\'s own count, not the length of the list', async () => {
  const cwd = await workspace()
  const state = readState(cwd)
  const l1 = composeL1(state)
  const l2 = composeL2(state, '1'.repeat(64))

  // The fixture holds six open tasks in total: one open, two active, three review. A counts
  // line that prints the list length would say 6 for every status; the board says otherwise.
  assert.equal(countsLine(l1).active, 2, 'active must be the two tasks in the board\'s active section')
  assert.equal(countsLine(l1).open, 1, 'open must be the one task in the board\'s open section, not the number of listed titles (the fixture holds six open tasks in total)')
  assert.equal(countsLine(l1).review, 3, 'review must be the three tasks in the board\'s review section')
  assert.deepEqual(countsLine(l2), { active: 2, open: 1, review: 3 }, 'the delta counts each status from its own section too')
})

test('a task in status open and a task in status active are listed with their status', async () => {
  const cwd = await workspace()
  const state = readState(cwd)
  const l1 = composeL1(state)
  const l2 = composeL2(state, '2'.repeat(64))

  for (const [message, name] of [[l1, 'L1'], [l2, 'L2']]) {
    assert.match(message, /^- TASK-901 \[open\] an open task$/m, `${name} must list the task whose board section is open`)
    assert.match(message, /^- TASK-902 \[active\] a first active task$/m, `${name} must list a task whose board section is active`)
    assert.match(message, /^- TASK-904 \[review\] a first review task$/m, `${name} must list a task whose board section is review`)
    assert.doesNotMatch(message, /TASK-001 \[done\]/, `${name} must not list a closed task`)
  }
})

function manyOpenBoard(count) {
  const rows = []
  for (let i = 1; i <= count; i += 1) rows.push([`TASK-${900 + i}`, `open task number ${i}`])
  return boardOf({ open: rows, done: [['TASK-001', 'a finished task']] })
}

test('more than twelve open titles collapse to twelve plus a "+N more" line', async () => {
  const cwd = await workspace({ board: manyOpenBoard(14) })
  const state = readState(cwd)
  const l1 = composeL1(state)
  const l2 = composeL2(state, '3'.repeat(64))

  for (const [message, name] of [[l1, 'L1'], [l2, 'L2']]) {
    const block = openBlock(message)
    const titles = block.filter((line) => line.startsWith('- TASK-'))
    assert.equal(titles.length, 12, `${name} must list at most twelve titles`)
    assert.ok(block.some((line) => /^-\s*\+2 more\b/.test(line)), `${name} must say how many titles were left out ("+2 more")`)
    assert.equal(countsLine(message).open, 14, `${name} still counts all fourteen open tasks`)
  }
})

test('a board with nothing open says "no open tasks"', async () => {
  const closedBoard = boardOf({ done: [['TASK-001', 'a finished task']], cancelled: [['TASK-002', 'a cancelled task']] })
  const cwd = await workspace({ board: closedBoard })
  const state = readState(cwd)

  for (const [message, name] of [[composeL1(state), 'L1'], [composeL2(state, '4'.repeat(64)), 'L2']]) {
    assert.deepEqual(countsLine(message), { active: 0, open: 0, review: 0 }, `${name} counts zero for every open status`)
    assert.ok(openBlock(message).includes('no open tasks'), `${name} must say "no open tasks" instead of leaving the heading alone`)
  }
})

test('the delta never exceeds its byte cap', async () => {
  const bigBoard = manyOpenBoard(40)
  const bigDigest = `# Digest\n\n## Open work\n\n${Array.from({ length: 40 }, (_, i) => `- [open] TASK-${901 + i} a long open task title that takes room in the delta`).join('\n')}\n`
  const bigSnapshot = `# Snapshot\n\n${Array.from({ length: 20 }, (_, i) => `- REQ: requirement ${i} is open and this line is long enough to matter`).join('\n')}\n`
  const cwd = await workspace({ board: bigBoard, digest: bigDigest, snapshot: bigSnapshot })
  const state = readState(cwd)

  for (let i = 0; i < 5; i += 1) {
    const delta = composeL2(state, String(i).repeat(64))
    assert.match(delta, /^STATE \(L2, delta\)/m, 'a delta is still composed for a large state')
    assert.ok(utf8(delta) <= L2_LIMIT_BYTES, `the delta is ${utf8(delta)} bytes, over the ${L2_LIMIT_BYTES}-byte cap`)
  }
})

test('the pre-step participant delivers the delta through the step decision, never into the session inbox', async () => {
  const cwd = await workspace()
  const { agent, injected, handlers } = await startSession(cwd)
  assert.equal(injected.length, 1, 'the first message went through agent/created once')
  assert.match(injected[0].content[0].text, /^STATE \(L1,/, 'the first delivered message is L1')

  // A real change between turns: the board gains an active task and the digest changes.
  await writeFile(join(cwd, 'state', 'views', 'board.md'), boardOf({
    open: [['TASK-901', 'an open task']],
    active: [['TASK-902', 'a first active task'], ['TASK-907', 'the task that just became active']],
    review: [['TASK-904', 'a first review task']],
    done: [['TASK-001', 'a finished task']],
  }), 'utf8')
  await writeFile(join(cwd, 'state', 'views', 'digest.md'), `${DIGEST}\nchanged\n`, 'utf8')

  const human = { id: 'human-1', role: 'user', content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }
  const decision = await preStep(handlers, agent, { turn: 2, step: 1, messages: [human] })

  assert.equal(decision?.kind, 'enter', 'the participant must let the step enter')
  assert.equal(decision.messages.length, 2, 'the decision carries the claimed message plus one state delta')
  assert.equal(decision.messages[0], human, 'the claimed batch stays first')
  const added = decision.messages[1]
  assert.equal(added.source?.kind, 'state-feed', 'the added message is the state feed')
  assert.match(added.content[0].text, /^STATE \(L2,/, 'the added message is the delta')
  assert.equal(occurrences(added.content[0].text, '## Open tasks'), 1, 'the delta entering the step carries the open-tasks block once')
  assert.match(added.content[0].text, /^- TASK-907 \[active\] the task that just became active$/m, 'the delta lists the newly active task')

  assert.equal(injected.length, 1, 'the pre-step participant must not write the session inbox: no agent.inject() call')
})

/** The open rows of a board, parsed from the format the projection is defined by. */
function boardOpenRows(board) {
  const rows = []
  let status = null
  for (const line of String(board).split('\n')) {
    const section = /^##\s+(\S+)\s+\((\d+)\)\s*$/.exec(line.trim())
    if (section !== null) {
      status = section[1]
      continue
    }
    if (!['open', 'active', 'review'].includes(status)) continue
    const row = /^\|\s*(TASK-\d+)\s*\|\s*(.*?)\s*\|/.exec(line)
    if (row !== null) rows.push({ id: row[1], title: row[2], status })
  }
  return rows
}

test('the block is built from the workspace\'s own state/views/board.md', async () => {
  const workspaceRoot = resolve(HERE, '..', '..')
  const state = readState(workspaceRoot)
  assert.equal(state.ok, true, 'the workspace has the state/views projection set')
  const open = boardOpenRows(state.board)
  const expected = { active: open.filter((task) => task.status === 'active').length, open: open.filter((task) => task.status === 'open').length, review: open.filter((task) => task.status === 'review').length }

  for (const [message, name] of [[composeL1(state), 'L1'], [composeL2(state, '5'.repeat(64)), 'L2']]) {
    assert.equal(occurrences(message, '## Open tasks'), 1, `${name} carries the real board's open-tasks block once`)
    assert.deepEqual(countsLine(message), expected, `${name} counts the real board's open rows by status`)
    if (open.length === 0) {
      assert.ok(openBlock(message).includes('no open tasks'), `${name} says "no open tasks" for the real empty board`)
    } else {
      const listed = openBlock(message).filter((line) => line.startsWith('- TASK-'))
      const expectedLines = open.slice(0, 12).map((task) => `- ${task.id} [${task.status}] ${task.title}`)
      assert.deepEqual(listed, expectedLines, `${name} lists the real board's open titles in board order`)
    }
  }
})

