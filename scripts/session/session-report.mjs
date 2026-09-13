/**
 * PURPOSE
 *   Report what a stored session actually contains and what it cost, so a
 *   question about context growth, compaction and session size is answered from
 *   the session's own records instead of from a reading of the plugins. Prints,
 *   per session: the record mix, the request count, the prompt-size curve
 *   reconstructed from provider usage, the cache-hit share, and whether the curve
 *   ever steps down — which is what compaction would look like in the log.
 *
 * INPUTS
 *   --home <dir>     harness home (default: $DSH_HOME, else ~/.dsh).
 *   --session <file> one session file instead of every session.
 *   --verbose        list every request rather than the first, last and largest.
 *
 * OUTPUTS
 *   Human-readable lines on stdout. For each session: record kinds, request
 *   count, prompt min/max/last, growth factor, number of downward steps,
 *   summed/billed/cached prompt tokens with the cached share, and the largest
 *   single-step billed input (the cost event a broken cache prefix causes).
 *   Exits 1 when no session file is found, so an empty result is never mistaken
 *   for a healthy one.
 *
 * KEYWORDS
 *   session size, context growth, compaction detection, prompt cache, cost
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A session with no usage records is reported as such, not silently skipped.
 *   - A record that is not JSON is counted and skipped.
 *   - A session whose file cannot be decoded is reported and the rest continue.
 */

import { resolveHome, readSession, sessionFiles, usageSeries } from './session-log.mjs'

const argv = process.argv.slice(2)
const homeArg = argv.indexOf('--home')
const home = homeArg >= 0 ? argv[homeArg + 1] : resolveHome()
const sessionArg = argv.indexOf('--session')
const verbose = argv.includes('--verbose')
const targets = sessionArg >= 0 ? [argv[sessionArg + 1]] : sessionFiles(home)

if (targets.length === 0) {
  process.stderr.write(`session-report: no session files under ${home}\n`)
  process.exit(1)
}

/** Count the record kinds in a decoded log, ignoring unparsable lines. */
function recordKinds(text) {
  const kinds = new Map()
  let unparsable = 0
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      const record = JSON.parse(line)
      const kind = record.type ?? '(none)'
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
    } catch {
      unparsable += 1
    }
  }
  return { kinds, unparsable }
}

let machinePrompt = 0
let machineCached = 0
let machineBilled = 0
let machineRequests = 0

for (const path of targets) {
  const name = path.split(/[\\/]/).slice(-2)[0]
  console.log(`\n== ${name}`)
  let text
  try {
    text = readSession(path)
  } catch (error) {
    console.log(`   undecodable: ${error.message.split('\n')[0]}`)
    continue
  }

  const { kinds, unparsable } = recordKinds(text)
  const top = [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`   records: ${[...kinds.values()].reduce((a, b) => a + b, 0).toLocaleString('en-US')} (unparsable ${unparsable})`)
  console.log(`   kinds: ${top.map(([kind, count]) => `${kind}=${count}`).join(' ')}`)
  console.log(`   compaction events: ${(kinds.get('compaction/summary') ?? 0) + (kinds.get('compaction/started') ?? 0)}`)

  const series = usageSeries(text)
  if (series.length === 0) {
    console.log('   usage: none recorded')
    continue
  }
  const prompts = series.map((entry) => entry.prompt)
  const billed = series.reduce((total, entry) => total + entry.billed, 0)
  const cached = series.reduce((total, entry) => total + entry.cached, 0)
  const drops = prompts.filter((size, index) => index > 0 && size < prompts[index - 1]).length
  let largestBilled = 0
  for (const entry of series) largestBilled = Math.max(largestBilled, entry.billed)

  machinePrompt += billed + cached
  machineCached += cached
  machineBilled += billed
  machineRequests += series.length

  console.log(`   requests: ${series.length}`)
  console.log(`   prompt tokens: first=${prompts[0].toLocaleString('en-US')} last=${prompts[prompts.length - 1].toLocaleString('en-US')} max=${Math.max(...prompts).toLocaleString('en-US')} growth=${(prompts[prompts.length - 1] / prompts[0]).toFixed(1)}x`)
  console.log(`   downward steps (compaction would show here): ${drops}`)
  console.log(`   summed prompt tokens: ${(billed + cached).toLocaleString('en-US')}  cached=${cached.toLocaleString('en-US')} (${(((cached / (billed + cached)) * 100) || 0).toFixed(1)}%)  billed=${billed.toLocaleString('en-US')}`)
  console.log(`   largest single-step billed input: ${largestBilled.toLocaleString('en-US')}`)

  if (verbose) {
    for (const [index, entry] of series.entries()) {
      console.log(`     #${index + 1} turn=${entry.turn}.${entry.step} prompt=${entry.prompt} billed=${entry.billed} cached=${entry.cached} out=${entry.output}`)
    }
  }
}

if (targets.length > 1) {
  console.log('\n== machine total')
  console.log(`   sessions=${targets.length} requests=${machineRequests.toLocaleString('en-US')}`)
  console.log(`   prompt tokens=${machinePrompt.toLocaleString('en-US')} cached=${machineCached.toLocaleString('en-US')} (${((machineCached / machinePrompt) * 100).toFixed(1)}%) billedInput=${machineBilled.toLocaleString('en-US')}`)
}
