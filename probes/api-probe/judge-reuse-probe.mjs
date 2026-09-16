/**
 * PURPOSE
 *   Measure, rather than assume, the durable-child API the ratchet judge pool rests on,
 *   and prove the pool's own contract — create-once / send-twice, static context delivered
 *   once, serialized turns, one recreation for a dead judge, and turn-scoped cancellation —
 *   against a stub runtime. Runnable with no harness boot, no credentials and no model:
 *   `node probes/api-probe/judge-reuse-probe.mjs`.
 *
 * WHY A SEPARATE PROBE
 *   The pool replaces a one-shot `subagents.start('spawn', …)` + `dispose()` per judge job
 *   with one `startContinuable` child per calling parent, driven by `sendMessage`. Whether
 *   the harness actually exposes that durable shape is a fact about the INSTALLED harness,
 *   so this probe reads the installed package declarations and asserts the exact members,
 *   then drives the real pool module over a stub so the wiring is exercised too.
 *
 * MEASURED FACTS (asserted here; each names the declaration it was read from)
 *   1. `SubagentRuntime.startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>`
 *      — `@deepseek-ai/dsh-subagent` `lib/types/index.d.ts`.
 *   2. `SubagentRuntime.sendMessage(sender, targetId, content, options): Promise<MessageId>`
 *      — same file. It steers an existing direct continuable child and starts (or cold-resumes)
 *      its turn; it returns an inbox id, never a result.
 *   3. `ContinuableStartSpec.request` is
 *      `Omit<SubagentStartRequest, 'label' | 'signal' | 'outputSchema'>`
 *      — `lib/types/types.d.ts`. A continuable child therefore CANNOT carry an output schema,
 *      and `sendMessage` has no schema parameter: per-call STRUCTURED output to an existing
 *      child is impossible on this seam. The pool reads the child's final assistant message
 *      instead and the ratchet parses JSON out of it (`ratchet-dynamic.parseVerdict`).
 *   4. `Agent.whenIdle(): Promise<void>` — `@deepseek-ai/dsh-agent`
 *      `lib/types/runtime-types.d.ts`. This is how a turn on an existing child is awaited.
 *   5. `Session.snapshotEvents(fromSeq?)` — `@deepseek-ai/dsh-session`
 *      `lib/types/index.d.ts`. This is how one turn's output is read.
 *   6. `SubagentRuntime.interrupt(targetSessionId, authority): void` and
 *      `SubagentRuntime.drainContinuableChildren(parent, childIds): Promise<void>` — same
 *      runtime declaration. Interrupt stops a turn without releasing the Activation (a
 *      cancelled tool call keeps the shared judge); drain releases a replaced child.
 *
 * INPUTS
 *   None. The probe locates the installed harness under `probes/api-probe/node_modules`
 *   (maintained by `scripts/dev-link.mjs`) and falls back to the checkout beside the kit.
 *   `--json` prints the checks as one JSON object instead of the human report.
 *
 * OUTPUTS
 *   Exit 0 when every fact and every pool behaviour holds; exit 1 otherwise. Prints one
 *   `[PASS]`/`[FAIL]` line per check, the measured declaration lines, and a final count.
 *
 * KEYWORDS
 *   api probe, subagent, continuable, startContinuable, sendMessage, whenIdle,
 *   snapshotEvents, judge reuse, fetch-api-first
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT = resolve(HERE, '..', '..')

/** Where the installed harness packages live, in preference order (node_modules roots). */
const HARNESS_ROOTS = [
  join(HERE, 'node_modules'),
  join(KIT, 'probes', 'api-probe', 'node_modules'),
  join(process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh'), 'profiles', 'node_modules'),
]

/** The checks, in report order. */
const checks = []

/** Records one check and prints it. */
function check(id, claim, pass, note) {
  checks.push({ id, claim, pass: Boolean(pass), note })
  process.stdout.write(`  [${pass ? 'PASS' : 'FAIL'}] ${id}\n         ${note}\n`)
}

/**
 * Locates and reads one installed package declaration file under the harness roots.
 *
 * @param packageName - e.g. `@deepseek-ai/dsh-subagent`.
 * @param segments - path segments inside the package, e.g. `lib`, `types`, `index.d.ts`.
 * @returns The file text, or `null` when no candidate exists.
 */
function packageFile(packageName, ...segments) {
  for (const root of HARNESS_ROOTS) {
    // Two layouts: `<root>/@deepseek-ai/<pkg>/...` and a bare package dir.
    for (const base of [root, join(root, 'node_modules', '@deepseek-ai')]) {
      const candidate = join(base, ...packageName.split('/'), ...segments)
      if (existsSync(candidate)) return readFileSync(candidate, 'utf8')
    }
  }
  return null
}

/** Measures the installed harness declarations. */
function measureApi() {
  const subagentIndex = packageFile('@deepseek-ai/dsh-subagent', 'lib', 'types', 'index.d.ts')
  const subagentTypes = packageFile('@deepseek-ai/dsh-subagent', 'lib', 'types', 'types.d.ts')
  const agentRuntime = packageFile('@deepseek-ai/dsh-agent', 'lib', 'types', 'runtime-types.d.ts')
  const sessionIndex = packageFile('@deepseek-ai/dsh-session', 'lib', 'types', 'index.d.ts')

  const startLine = subagentIndex?.match(/startContinuable\([^)]*\):[^;]*;/)?.[0] ?? null
  const sendLine = subagentIndex?.match(/sendMessage\([^)]*\):[^;]*;/)?.[0] ?? null
  const interruptLine = subagentIndex?.match(/interrupt\([^)]*\):[^;]*;/)?.[0] ?? null
  const drainLine = subagentIndex?.match(/drainContinuableChildren\([^)]*\):[^;]*;/)?.[0] ?? null
  const omitLine = subagentTypes?.match(/request:\s*Omit<SubagentStartRequest,[^>]*>;/)?.[0] ?? null
  const whenIdleLine = agentRuntime?.match(/whenIdle\(\):[^;]*;/)?.[0] ?? null
  const snapshotLine = sessionIndex?.match(/snapshotEvents\([^)]*\):[^;]*;/)?.[0] ?? null

  check(
    'api.start_continuable_is_declared',
    'the runtime establishes a durable continuable child and returns its durable id',
    startLine !== null && /ContinuableStart/.test(startLine),
    `measured: ${String(startLine)}`,
  )
  check(
    'api.send_message_is_declared',
    'the runtime steers a message to an existing child and resolves with an inbox id',
    sendLine !== null && /MessageId/.test(sendLine),
    `measured: ${String(sendLine)}`,
  )
  check(
    'api.continuable_has_no_output_schema',
    'a continuable child carries no output schema, so per-call structured output is impossible',
    omitLine !== null && /outputSchema/.test(omitLine),
    `measured: ${String(omitLine)}`,
  )
  check(
    'api.interrupt_is_declared',
    'one turn of a live child can be interrupted without releasing it',
    interruptLine !== null && /interrupt\(/.test(interruptLine),
    `measured: ${String(interruptLine)}`,
  )
  check(
    'api.drain_children_is_declared',
    'a replaced child can be released without touching its siblings',
    drainLine !== null && /drainContinuableChildren/.test(drainLine),
    `measured: ${String(drainLine)}`,
  )
  check(
    'api.when_idle_is_declared',
    'a turn on an existing child is awaitable to quiescence',
    whenIdleLine !== null,
    `measured: ${String(whenIdleLine)}`,
  )
  check(
    'api.snapshot_events_is_declared',
    "one turn's output is readable from the child's session log",
    snapshotLine !== null,
    `measured: ${String(snapshotLine)}`,
  )
  return subagentIndex !== null && subagentTypes !== null && agentRuntime !== null && sessionIndex !== null
}

/** A stub of the durable-child seam that records every operation. */
function stubHarness({ verdict = { ok: true, findings: [] }, failFirstSend = false } = {}) {
  const spawned = []
  const sent = []
  const interrupted = []
  const released = []
  const children = new Map()
  const control = { gate: null }
  let nextId = 1
  let sendAttempts = 0
  let active = 0
  let maxActive = 0

  const subagents = {
    async startContinuable(spec) {
      const childId = `judge-${nextId}`
      nextId += 1
      spawned.push({ provider: spec.provider, options: spec.request })
      const events = []
      const session = {
        seq: 0,
        snapshotEvents(from = 0) { return events.slice(from) },
      }
      children.set(childId, {
        id: childId,
        session,
        async whenIdle() {
          active -= 1
          if (control.gate !== null) await control.gate
          events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: JSON.stringify(verdict) }] } } })
          events.push({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
          session.seq = events.length
        },
      })
      active += 1
      maxActive = Math.max(maxActive, active)
      return { childId, messageId: `${childId}-m0` }
    },
    async sendMessage(_parent, childId, content) {
      sendAttempts += 1
      if (failFirstSend && sendAttempts === 1) throw new Error('probe stub: send failed once')
      const child = children.get(childId)
      if (child === undefined) throw new Error(`probe stub: no child ${String(childId)}`)
      sent.push({ childId, text: content[0].text })
      active += 1
      maxActive = Math.max(maxActive, active)
      return `${childId}-m${sent.length}`
    },
    interrupt(childId, authority) { interrupted.push({ childId, authority }) },
    async drainContinuableChildren(_parent, ids) { released.push(...ids) },
  }
  const agents = { roots: () => [], get: (id) => children.get(id) }
  return { subagents, agents, spawned, sent, interrupted, released, control, get maxActive() { return maxActive } }
}

/** Drives the real pool module over the stub and checks its contract. */
async function measurePool() {
  const judgeModule = await import(pathToFileURL(join(KIT, 'plugins', 'ratchet', 'ratchet-judge.mjs')).href)
  const staticText = '# Project\n\nName: probe\n'
  const prompt = (material) => `${staticText}\n# Question\n\n${material}`
  const signal = () => new AbortController().signal

  // create-once / send-twice
  const h = stubHarness()
  const pool = judgeModule.createJudgePool({ runtimeOf: () => h.subagents, agentsOf: () => h.agents })
  const parent = { id: 'probe-parent' }
  const first = await pool.judge({ parent, signal: signal(), prompt: prompt('first'), staticPrompt: staticText })
  const second = await pool.judge({ parent, signal: signal(), prompt: prompt('second'), staticPrompt: staticText })
  check(
    'pool.create_once_send_twice',
    'two sequential judge calls create one child and deliver the second as a follow-up',
    h.spawned.length === 1 && first.created === true && second.reused === true && h.sent.length === 1,
    `children=${h.spawned.length} first.created=${String(first.created)} second.reused=${String(second.reused)} followups=${h.sent.length}`,
  )
  check(
    'pool.static_context_delivered_once',
    'the first task carries the static prefix; later calls send only the material after it',
    /first/.test(h.spawned[0].options.prompt[0].text) && /second/.test(h.sent[0].text) && !h.sent[0].text.includes('# Project'),
    `creation carries "first"; follow-up is ${JSON.stringify(h.sent[0].text.slice(0, 60))}`,
  )
  check(
    'pool.no_dispose_per_call',
    'a finished call does not release the shared child',
    h.released.length === 0,
    `released=${JSON.stringify(h.released)}`,
  )

  // serialization
  const hs = stubHarness()
  const serialPool = judgeModule.createJudgePool({ runtimeOf: () => hs.subagents, agentsOf: () => hs.agents })
  const gate = Promise.withResolvers()
  hs.control.gate = gate.promise
  const serialParent = { id: 'p-serial' }
  const a = serialPool.judge({ parent: serialParent, signal: signal(), prompt: prompt('A'), staticPrompt: staticText })
  const b = serialPool.judge({ parent: serialParent, signal: signal(), prompt: prompt('B'), staticPrompt: staticText })
  await new Promise((resolveTick) => setTimeout(resolveTick, 0))
  const notInterleaved = hs.maxActive === 1
  gate.resolve()
  const [ra, rb] = await Promise.all([a, b])
  check(
    'pool.concurrent_calls_are_serialized',
    'two concurrent calls run one after the other on the one child',
    hs.spawned.length === 1 && notInterleaved && hs.maxActive === 1 && ra.created === true && rb.reused === true,
    `children=${hs.spawned.length} maxConcurrentTurns=${hs.maxActive}`,
  )

  // recreate on a dead judge
  const hd = stubHarness({ failFirstSend: true })
  const deadPool = judgeModule.createJudgePool({ runtimeOf: () => hd.subagents, agentsOf: () => hd.agents })
  const parentDead = { id: 'p-dead' }
  await deadPool.judge({ parent: parentDead, signal: signal(), prompt: prompt('warm'), staticPrompt: staticText })
  const recovered = await deadPool.judge({ parent: parentDead, signal: signal(), prompt: prompt('recover'), staticPrompt: staticText })
  check(
    'pool.dead_judge_recreated_once',
    'a failed follow-up releases the dead child and creates exactly one replacement',
    hd.spawned.length === 2 && recovered.created === true && hd.released.includes('judge-1'),
    `children=${hd.spawned.length} released=${JSON.stringify(hd.released)}`,
  )

  // cancellation keeps the shared judge
  const hc = stubHarness()
  const cancelPool = judgeModule.createJudgePool({ runtimeOf: () => hc.subagents, agentsOf: () => hc.agents })
  const parentCancel = { id: 'p-cancel' }
  await cancelPool.judge({ parent: parentCancel, signal: signal(), prompt: prompt('warm'), staticPrompt: staticText })
  const cancelGate = Promise.withResolvers()
  hc.control.gate = cancelGate.promise
  const controller = new AbortController()
  const pending = cancelPool.judge({ parent: parentCancel, signal: controller.signal, prompt: prompt('stop me'), staticPrompt: staticText })
  await new Promise((resolveTick) => setTimeout(resolveTick, 0))
  controller.abort()
  cancelGate.resolve()
  let cancelled = false
  try {
    await pending
  } catch (error) {
    cancelled = /cancelled/.test(String(error))
  }
  hc.control.gate = null
  const later = await cancelPool.judge({ parent: parentCancel, signal: signal(), prompt: prompt('later'), staticPrompt: staticText })
  check(
    'pool.cancelled_turn_keeps_the_shared_judge',
    'a cancelled call interrupts only its own turn and the next call reuses the same child',
    cancelled === true && hc.interrupted.length === 1 && hc.interrupted[0].childId === 'judge-1' && hc.released.length === 0 && hc.spawned.length === 1 && later.reused === true,
    `cancelled=${String(cancelled)} interrupted=${hc.interrupted.length} released=${hc.released.length} children=${hc.spawned.length}`,
  )

  return { judgeModule }
}

const apiOk = measureApi()
const poolResult = await measurePool()
const failed = checks.filter((entry) => !entry.pass)
const passed = checks.length - failed.length

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ checks, passed, total: checks.length, apiOk, poolResult: Object.keys(poolResult) }, null, 2)}\n`)
} else {
  process.stdout.write(
    `\nprobe: judge reuse (durable continuable child)\n` +
      `  ${passed}/${checks.length} facts confirmed\n` +
      `  probe: judged against the installed @deepseek-ai/dsh-subagent declarations\n`,
  )
}
if (failed.length > 0) {
  process.stderr.write('judge reuse probe FAILED\n')
  process.exit(1)
}
process.stdout.write('judge reuse probe ok\n')
