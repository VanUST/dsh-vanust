/**
 * What the tail policy would have saved on the recorded sessions.
 *
 *   node scripts/tail-pruner-savings.mjs [days]
 *
 * The harness pruner appears in the log as a batch of compaction/prune events, each
 * carrying the price of the tool result it shadowed (shadowedTokenCount). The call
 * that follows pays the re-bill, and its own usage says how much: the fresh tokens
 * (inputTokens) are the observable cost of the break.
 *
 * Under the tail policy the break sits at the NEWEST rewritten result instead of the
 * oldest, so the re-billed suffix is the retained part of the rewritten results plus
 * the protected tail - never the whole context. The estimate below is an upper bound:
 * every rewritten result keeps 1280 tokens (4096 head + marker + 1024 tail) and the
 * three protected results add at most TAIL_TOKENS.
 *
 * A batch whose context was already under the budget would not have run at all, so its
 * whole re-bill is avoided. Budget = contextWindow x 0.45 (1M window -> 450K).
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const days = Number(process.argv[2] ?? '3')
const root = join(process.env.HOME, '.npm/dsh/sessions')
const since = Date.now() - days * 24 * 3600 * 1000
const BUDGET = Math.floor(0.45 * 1048576)
const RETAINED_TOKENS = 1280
const TAIL_TOKENS = 5000

let sessions = 0
let batches = 0
let overBudget = 0
let oldTokens = 0
let newTokens = 0
let observedFresh = 0
const rows = []

for (const workspace of readdirSync(root)) {
  const workspacePath = join(root, workspace)
  let workspaceStat
  try { workspaceStat = statSync(workspacePath) } catch { continue }
  if (!workspaceStat.isDirectory()) continue
  for (const sessionId of readdirSync(workspacePath)) {
    const file = join(workspacePath, sessionId, 'session.v4.jsonl.zstd')
    let fileStat
    try { fileStat = statSync(file) } catch { continue }
    if (fileStat.mtimeMs < since) continue
    const decompressed = spawnSync('zstd', ['-dc', file], { maxBuffer: 1024 * 1024 * 1024 })
    if (decompressed.status !== 0 || !decompressed.stdout) continue
    sessions += 1
    let count = 0
    let price = 0
    let sessionOld = 0
    let sessionNew = 0
    let sessionBatches = 0
    for (const line of decompressed.stdout.toString('utf8').split('\n')) {
      if (!line) continue
      let event
      try { event = JSON.parse(line) } catch { continue }
      if (event.type === 'compaction/prune') {
        count += 1
        price += event.data?.shadowedTokenCount ?? 0
        continue
      }
      if (event.type !== 'assistant/message' || count === 0) continue
      const usage = event.data.usage ?? {}
      const prompt = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0)
      const fresh = usage.inputTokens ?? 0
      if (prompt > 20000) {
        const avoidable = prompt <= BUDGET
        const newCost = avoidable ? 0 : Math.min(fresh, count * RETAINED_TOKENS + TAIL_TOKENS)
        sessionOld += fresh
        sessionNew += newCost
        sessionBatches += 1
        observedFresh += fresh
        if (!avoidable) overBudget += 1
      }
      count = 0
      price = 0
    }
    if (sessionBatches > 0) {
      batches += sessionBatches
      oldTokens += sessionOld
      newTokens += sessionNew
      rows.push({ session: sessionId.slice(0, 24), batches: sessionBatches, old: sessionOld, new: sessionNew })
    }
  }
}

const wide = (value) => String(value).padStart(12)
console.log('sessions read: ' + String(sessions) + ', prune batches: ' + String(batches) + ' (' + String(overBudget) + ' above the budget)')
console.log('re-billed now (observed fresh at those calls): ' + wide(observedFresh))
console.log('re-billed now, modelled at the oldest shadowed node: ' + wide(oldTokens))
console.log('re-billed under the tail policy (upper bound):       ' + wide(newTokens))
if (oldTokens > 0) console.log('tail policy keeps ' + (100 * newTokens / oldTokens).toFixed(1) + '% of the re-bill')
for (const row of rows.sort((a, b) => b.old - a.old).slice(0, 6)) {
  console.log('  ' + row.session.padEnd(26) + ' batches ' + String(row.batches).padStart(3) + ' old ' + wide(row.old) + ' new ' + wide(row.new))
}
