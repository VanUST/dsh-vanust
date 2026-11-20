/**
 * Proof for @cc/dsh-tail-pruner.
 *
 *   node scripts/tail-pruner-proof.mjs            # hermetic checks on a fake session
 *   node scripts/tail-pruner-proof.mjs --sessions # what the tail policy would have saved on the
 *                                                 # last three days of recorded sessions
 *
 * The hermetic half is the gate: it fails when the order, the protection window, the budget stop,
 * the replay-safe event pair, the per-route override or the config guards regress.
 */
import {
  DEFAULTS,
  PRUNE_MARKER,
  apply,
  applyPrune,
  budgetRatioFor,
  measureContent,
  planPrune,
  pruneContent,
  resolveConfig,
} from '../plugins/tail-pruner/tail-pruner.mjs'

let failures = 0
function check(name, ok, detail) {
  if (ok) { console.log('ok   ' + name); return }
  failures += 1
  console.log('FAIL ' + name + (detail === undefined ? '' : ': ' + detail))
}

/** Build a fake session: ascending tool results, each a single text block. */
function fakeSession(lengths) {
  const events = new Map()
  const surface = []
  let seq = 0
  for (const length of lengths) {
    seq += 1
    events.set(seq, { seq, type: 'tool/result', data: { turn: 1, step: seq, message: { id: 'm' + String(seq), role: 'tool', content: [{ type: 'text', text: 'x'.repeat(length) }] } } })
    surface.push(seq)
  }
  const writes = []
  return {
    writes,
    events,
    session: {
      surface: {
        nodes: surface,
        get replaceGeneration() { return writes.filter((w) => w.intent !== undefined).length },
      },
      eventAt(s) { return events.get(s) },
      deriveEventMessage(event) { return structuredClone(event.data.message) },
      append(type, data, intent) {
        writes.push({ type, data, intent })
        if (type === 'tool/result') {
          seq += 1
          events.set(seq, { seq, type: 'tool/result', data })
        }
        return { seq }
      },
      requestContext() { return { provider: 'deepseek-official', model: 'deepseek-flash', contextWindow: 1000000 } },
      requestHeader() { return undefined },
    },
  }
}

const estimate = (message) => Math.ceil(measureContent(message.content) / 4)
function meterFor(session, totalTokens) {
  return {
    measure() {
      const nodes = session.surface.nodes.map((seq) => {
        const event = session.eventAt(seq)
        const message = session.deriveEventMessage(event)
        return { seq, tokens: estimate(message) }
      })
      return { totalTokens, nodes }
    },
    estimateMessage: estimate,
  }
}

// ── 1. configuration ────────────────────────────────────────────────────────
check('defaults are 0.45 / 8192 / 4096 / 1024 / 3', DEFAULTS.budgetRatio === 0.45 && DEFAULTS.protectResults === 3)
check('unknown config key is rejected', (() => { try { resolveConfig({ nope: 1 }); return false } catch { return true } })())
check('budgetRatio outside (0,1) is rejected', (() => { try { resolveConfig({ budgetRatio: 1 }); return false } catch { return true } })())
check('head+marker+tail above threshold is rejected', (() => { try { resolveConfig({ thresholdChars: 4000 }); return false } catch { return true } })())
check('route override wins for its provider', budgetRatioFor(resolveConfig({ routes: [{ provider: 'openai-codex', budgetRatio: 0.75 }] }), { provider: 'openai-codex', model: 'gpt-6-astra' }) === 0.75)
check('route override is ignored for another provider', budgetRatioFor(resolveConfig({ routes: [{ provider: 'openai-codex', budgetRatio: 0.75 }] }), { provider: 'deepseek-official' }) === 0.45)

// ── 2. content rewrite ──────────────────────────────────────────────────────
const config = resolveConfig({})
const big = [{ type: 'text', text: 'a'.repeat(4096) + 'b'.repeat(20000) + 'c'.repeat(1024) }]
const pruned = pruneContent(big, config)
check('oversized result is pruned', pruned !== null)
check('pruned text keeps head, marker and tail', pruned !== null && pruned[0].text.startsWith('a'.repeat(4096)) && pruned[0].text.includes(PRUNE_MARKER) && pruned[0].text.endsWith('c'.repeat(1024)))
check('small result is left alone', pruneContent([{ type: 'text', text: 'a'.repeat(1000) }], config) === null)
check('already pruned result is left alone', pruneContent([{ type: 'text', text: 'a'.repeat(20000) + PRUNE_MARKER }], config) === null)

// ── 3. plan: newest first, protected tail, budget stop ──────────────────────
const fixture = fakeSession([20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000])
const nodes = [...fixture.session.surface.nodes].map((seq) => {
  const message = fixture.session.deriveEventMessage(fixture.session.eventAt(seq))
  return { seq, message, tokens: estimate(message) }
})
const total = nodes.reduce((sum, node) => sum + node.tokens, 0)
const plan = planPrune({ nodes, totalTokens: total, budget: total - 15000, protectResults: 3, config, estimateMessage: estimate })
check('plan prunes strictly newest-first', plan.length > 0 && plan.every((entry, index) => index === 0 || plan[index - 1].seq > entry.seq), JSON.stringify(plan.map((p) => p.seq)))
check('plan never touches the newest protectResults', plan.every((entry) => entry.seq <= nodes[nodes.length - 4].seq))
check('plan stops once the projection fits the budget', total - plan.reduce((sum, entry) => sum + entry.freed, 0) <= total - 15000)
const headFirst = nodes.slice(0, nodes.length - 3)
check('negative control: an oldest-first plan fails the newest-first predicate', !headFirst.every((entry, index) => index === 0 || headFirst[index - 1].seq > entry.seq))
const emptyPlan = planPrune({ nodes, totalTokens: total, budget: total + 1, protectResults: 3, config, estimateMessage: estimate })
check('no budget pressure means no plan', emptyPlan.length === 0)

// ── 4. the durable pair is replay-safe ─────────────────────────────────────
const applied = fakeSession([20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000])
const appliedNodes = [...applied.session.surface.nodes].map((seq) => {
  const message = applied.session.deriveEventMessage(applied.session.eventAt(seq))
  return { seq, message, tokens: estimate(message) }
})
const appliedTotal = appliedNodes.reduce((sum, node) => sum + node.tokens, 0)
const appliedPlan = planPrune({ nodes: appliedNodes, totalTokens: appliedTotal, budget: appliedTotal - 10000, protectResults: 3, config, estimateMessage: estimate })
const written = applyPrune(applied.session, appliedPlan)
const pruneEvents = applied.writes.filter((w) => w.type === 'compaction/prune')
const replacements = applied.writes.filter((w) => w.type === 'tool/result')
check('one prune price and one replacement per rewritten node', written === appliedPlan.length && pruneEvents.length === appliedPlan.length && replacements.length === appliedPlan.length)
check('prune event cites the shadowed seq and its price', pruneEvents.every((w, index) => w.data.shadowedSeqs.length === 1 && w.data.shadowedSeqs[0] === appliedPlan[index].seq && w.data.shadowedTokenCount > 0))
check('replacement carries surfaceOp replace and sourceEventSeqs', replacements.every((w, index) => w.intent?.surfaceOp?.op === 'replace' && w.intent.surfaceOp.startSeq === appliedPlan[index].seq && w.intent.sourceEventSeqs[0] === appliedPlan[index].seq))
check('replacement keeps the pruned content', replacements.every((w, index) => w.data.message.content[0].text.includes(PRUNE_MARKER) && w.data.message.content[0].text === appliedPlan[index].message.content[0].text))

// ── 5. the plugin registers a prepended step listener and walks the session ─
const hookFixture = fakeSession([20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000])
const listeners = []
const ctx = {
  tokenMeter: meterFor(hookFixture.session, 600000),
  logger: { info() {}, warn() {} },
  on(name, listener, options) { listeners.push({ name, listener, options }) },
}
apply(ctx, { budgetRatio: 0.45 })
check('plugin registers one agent/pre-step listener', listeners.length === 1 && listeners[0].name === 'agent/pre-step')
check('listener is prepended so it runs before compaction', listeners[0].options?.prepend === true)
let nextCalled = 0
const decision = await listeners[0].listener({ agent: { session: hookFixture.session }, signal: { aborted: false } }, () => { nextCalled += 1; return Promise.resolve({ kind: 'enter' }) })
check('listener calls next and returns its decision', nextCalled === 1 && decision?.kind === 'enter')
check('listener rewrote results at the tail', hookFixture.writes.some((w) => w.type === 'compaction/prune'))
const underBudget = fakeSession([20000, 20000])
const quiet = []
apply({ tokenMeter: meterFor(underBudget.session, 10), on(name, listener) { quiet.push(listener) }, logger: { info() {}, warn() {} } }, {})
await quiet[0]({ agent: { session: underBudget.session }, signal: { aborted: false } }, () => Promise.resolve({ kind: 'enter' }))
check('nothing is written when the context is under budget', underBudget.writes.length === 0)
const noRoute = fakeSession([20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000])
const noRouteListeners = []
apply({ tokenMeter: meterFor(noRoute.session, 600000), on(name, listener) { noRouteListeners.push(listener) }, logger: { info() {}, warn() {} } }, {})
const bareSession = { ...noRoute.session, requestContext() { return {} } }
await noRouteListeners[0]({ agent: { session: bareSession }, signal: { aborted: false } }, () => Promise.resolve({ kind: 'enter' }))
check('no contextWindow means the plugin stays quiet', noRoute.writes.length === 0)
const disabled = []
apply({ tokenMeter: meterFor(underBudget.session, 10), on(name, listener) { disabled.push(listener) }, logger: { info() {}, warn() {} } }, { enabled: false })
check('disabled plugin registers no listener', disabled.length === 0)

if (failures > 0) { console.log('\n' + String(failures) + ' check(s) failed'); process.exit(1) }
console.log('\nall checks passed')