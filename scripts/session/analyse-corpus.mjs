/**
 * PURPOSE
 *   Cut the behavioural and harness numbers out of the session corpus in one
 *   deterministic pass, so every finding in the experiment report can be re-derived
 *   by a command rather than asserted. It measures how the owner frames asks, how
 *   the agent spends its steps, where cost events and recovery loops appear, and
 *   what the corpus structurally looks like — producing numbers, not conclusions.
 *
 * INPUTS
 *   --corpus <file>   corpus JSON from extract-corpus.mjs (default .cache/session-analysis/corpus.json).
 *   --json <file>     write the full result object there as well as printing a summary.
 *
 *   Paths are resolved against the WORKING DIRECTORY, so run this from the repository
 *   root (`make session-analysis` does). The corpus it reads is produced by
 *   `extract-corpus.mjs`; this tool never touches the raw session logs.
 *
 * OUTPUTS
 *   JSON on stdout (and at --json): `structure`, `framing`, `effort`, `recovery`,
 *   `delegation`, `cost`, `reliability`, `dominance` sections, each with raw counts
 *   and the derived rates, plus `notes` naming every measurement whose regex is a
 *   heuristic rather than a fact. A corpus with no top-level sessions yields zeroed
 *   sections and still exits 0; a missing corpus file exits 2 naming the path.
 *
 * KEYWORDS
 *   behaviour signals, task framing, verification, churn, delegation, cache miss,
 *   retry, denominator, corpus analysis
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Regex classification is a heuristic over a 240-character preview; every metric
 *     built on it is reported with its denominator so a weak rate cannot be read as
 *     a strong one.
 *   - A session with no user turns contributes to structure and cost, never to framing.
 *   - Rates with a zero denominator report `null`, never 0, so "no data" and "never
 *     happened" stay distinguishable.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const argv = process.argv.slice(2)
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const corpusPath = resolve(argOf('--corpus', '.cache/session-analysis/corpus.json'))
const jsonPath = argOf('--json', '')

let corpus
try {
  corpus = JSON.parse(readFileSync(corpusPath, 'utf8'))
} catch (error) {
  process.stderr.write(`analyse-corpus: cannot read corpus at ${corpusPath}: ${error?.message ?? error}\n`)
  process.exit(2)
}

const sessions = corpus.sessions ?? []
const top = sessions.filter((s) => !s.isSubagent)
const sub = sessions.filter((s) => s.isSubagent)
const rate = (n, d) => (d > 0 ? n / d : null)

// ---------------------------------------------------------------- structure
const cwdCounts = {}
for (const s of sessions) cwdCounts[s.cwd ?? '(none)'] = (cwdCounts[s.cwd ?? '(none)'] ?? 0) + 1

const allTurns = top.flatMap((s) => s.turns ?? [])
const spans = []
for (const s of top) {
  const t = (s.turns ?? []).map((x) => x.time).filter((x) => typeof x === 'number')
  if (t.length > 1) spans.push({ id: s.id, span: Math.max(...t) - Math.min(...t), turns: s.turns.length })
}

const structure = {
  files: corpus.files,
  sessions: sessions.length,
  topLevel: top.length,
  subagent: sub.length,
  unreadable: (corpus.parseErrors ?? []).length,
  cwdCounts: Object.fromEntries(Object.entries(cwdCounts).sort((a, b) => b[1] - a[1])),
  turnsTotal: allTurns.length,
  turnsPerTopSession: rate(allTurns.length, top.length),
  topSessionsWithOneTurn: top.filter((s) => (s.turns ?? []).length <= 1).length,
  models: Object.fromEntries(
    Object.entries(sessions.reduce((m, s) => ((m[s.model ?? '(none)'] = (m[s.model ?? '(none)'] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]),
  ),
  modelsOffFlashTier: sessions.filter((s) => s.model && s.model !== 'deepseek-flash').length,
  toolListSizes: Object.fromEntries(
    Object.entries(sessions.reduce((m, s) => ((m[s.toolListSize ?? 0] = (m[s.toolListSize ?? 0] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]),
  ),
  sandboxModes: Object.fromEntries(
    Object.entries(sessions.reduce((m, s) => ((m[s.sandboxMode ?? '(none)'] = (m[s.sandboxMode ?? '(none)'] ?? 0) + 1), m), {})),
  ),
  approvalPolicies: Object.fromEntries(
    Object.entries(sessions.reduce((m, s) => ((m[s.approvalPolicy ?? '(none)'] = (m[s.approvalPolicy ?? '(none)'] ?? 0) + 1), m), {})),
  ),
  agentPresets: Object.fromEntries(
    Object.entries(sessions.reduce((m, s) => ((m[s.agentPreset ?? '(none)'] = (m[s.agentPreset ?? '(none)'] ?? 0) + 1), m), {})),
  ),
}

// ---------------------------------------------------------------- framing
const LOOSE_OBJECTIVE = /\b(fix|change|make|update|write|move|rename|remove|delete|check|review|test|optimise|optimize|report|explain|tell|show|summarise|summarize|migrate|port|wire|hook|measure|verify|compare|audit)\b/i
const PLAN_REF = /\b(PLAN|plan\.md|SPEC|spec|report|CRITIQUE|WORKPLAN|README|§\s*\d|section\s+\d|design doc|adr)\b/
const RE = {
  continuation: /^(continue|go on|keep going|proceed|carry on|resume|next|дальше|продолжай|продолжи)\b[.!\s]*$/i,
  defect: /\b(fix|broken|bug|fails?|failing|does ?n[o']t work|regression|defect|error in)\b/i,
  pathLike: /(\/[\w.-]+){2,}|[\w-]+\.(ts|tsx|js|mjs|cjs|py|go|rs|json|md|gd|cs|ya?ml|toml|html|css|sh)\b/,
  commandLike: /(`[^`]+`|\b(?:node|npm|pnpm|yarn|python3?|pytest|cargo|go|make|git|docker|npx|deno|bun|tsc|ruff|eslint)\b[^\n]{0,60})/i,
  constraint: /\b(don'?t|do not|must not|must|only|without|keep|leave|preserve|never|avoid|instead of|constraint|не |только )/i,
  objective: /\b(goal|objective|i need|i want|we need|please|task|deliverable|implement|add|build|create|refactor|analyse|analyze|investigate|research|make)\b/i,
  planWords: /\b(plan|workflow|workflow|phase|step 1|first,|roadmap|design doc)\b/i,
  goalRound: /^<goal_round>/i,
  runtimeContext: /^(Current runtime context|Current DSH file policy)/i,
  jobNotice: /^(background job|subagent |agent session-|Agent session-|\[subagent)/i,
}

const asks = []
for (const s of top) {
  for (const t of s.turns ?? []) {
    if (!t.chars) continue
    asks.push({ session: s.id, cwd: s.cwd, turn: t.turn, chars: t.chars, preview: t.preview ?? '' })
  }
}

const classified = asks.map((a) => {
  const text = a.preview
  const isGoalRound = RE.goalRound.test(text)
  const continuation = RE.continuation.test(text.trim())
  const defect = RE.defect.test(text)
  const hasPath = RE.pathLike.test(text)
  const hasCommand = RE.commandLike.test(text)
  const hasConstraint = RE.constraint.test(text)
  const hasObjective = RE.objective.test(text)
  const mechanical = RE.runtimeContext.test(text) || RE.jobNotice.test(text) || isGoalRound
  return { ...a, isGoalRound, continuation, defect, hasPath, hasCommand, hasConstraint, hasObjective, mechanical }
})

const humanAsks = classified.filter((a) => !a.mechanical)
const defectAsks = humanAsks.filter((a) => a.defect)
const grillingRule = classified.filter((a) => a.continuation || (a.defect && !(a.hasPath && a.hasCommand)) || (a.chars < 120 && !a.isGoalRound))

const framing = {
  asksTotal: classified.length,
  mechanicalAsks: classified.filter((a) => a.mechanical).length,
  humanAsks: humanAsks.length,
  humanAskChars: {
    median: median(humanAsks.map((a) => a.chars)),
    mean: humanAsks.length ? humanAsks.reduce((x, a) => x + a.chars, 0) / humanAsks.length : null,
    under120: humanAsks.filter((a) => a.chars < 120).length,
    over2000: humanAsks.filter((a) => a.chars > 2000).length,
  },
  fourField: {
    objectiveWord: humanAsks.filter((a) => a.hasObjective).length,
    namesPathOrFile: humanAsks.filter((a) => a.hasPath).length,
    namesCheckableCommand: humanAsks.filter((a) => a.hasCommand).length,
    statesConstraint: humanAsks.filter((a) => a.hasConstraint).length,
    allFour: humanAsks.filter((a) => a.hasObjective && a.hasPath && a.hasCommand && a.hasConstraint).length,
  },
  grillingCandidates: grillingRule.length,
  grillingCandidatesRate: rate(grillingRule.length, classified.length),
  continuations: classified.filter((a) => a.continuation).length,
  defectAsks: defectAsks.length,
  defectAsksWithoutPathAndCommand: defectAsks.filter((a) => !(a.hasPath && a.hasCommand)).length,
  goalRoundAsks: classified.filter((a) => a.isGoalRound).length,
  longAskRate: rate(humanAsks.filter((a) => a.chars > 2000).length, humanAsks.length),
  loose: {
    objectiveVerb: humanAsks.filter((a) => LOOSE_OBJECTIVE.test(a.preview)).length,
    allFourLoose: humanAsks.filter((a) => LOOSE_OBJECTIVE.test(a.preview) && a.hasPath && a.hasCommand && a.hasConstraint).length,
  },
  references: {
    citesPlanOrSpec: humanAsks.filter((a) => PLAN_REF.test(a.preview)).length,
    citesPlanOrSpecShare: rate(humanAsks.filter((a) => PLAN_REF.test(a.preview)).length, humanAsks.length),
    usesAtPathRef: humanAsks.filter((a) => a.preview.includes('@')).length,
  },
}

// ---------------------------------------------------------------- effort
const MODIFY_TOOLS = new Set(['edit', 'write', 'patch', 'script_create', 'script_patch', 'notebook_edit'])
const READ_TOOLS = new Set(['read', 'grep', 'glob', 'filesystem_manage', 'resource_manage', 'read_image', 'script_manage', 'node_get_properties', 'scene_get_hierarchy', 'logs_read', 'context_rules', 'context_specs', 'context_module', 'api_manage'])
const DELEGATE_TOOLS = new Set(['subagent', 'subagent_fork', 'workflow'])
const JOB_SUBMIT_TOOLS = new Set(['bash', 'workflow', 'subagent', 'subagent_fork'])
const JOB_READ_TOOLS = new Set(['job_output', 'job_list'])
const VERIFY_RE = /(\b(?:npm|pnpm|yarn|node|npx|python3?|pytest|cargo|go|make|deno|bun|tsc)\b[\s\S]{0,80}\b(?:test|check|lint|build|verify|probe|run)\b)|(\bgit\s+(?:diff|status|log)\b)|(\b(?:test|check|lint|build|verify|probe)\.(?:sh|mjs|js|py)\b)/i

let callsTotal = 0
let modifyingCalls = 0
let readCalls = 0
let verifyCalls = 0
let bashCalls = 0
let bashWrites = 0
let agentEdits = 0
let testsAuthored = 0
let subAgentBadges = 0
const callNames = {}
const sessionVerify = []
const turnsWithoutVerifyAfterModify = []

for (const s of top) {
  const calls = s.calls ?? []
  callsTotal += calls.length
  let verifyBeforeFirstModify = 0
  let firstModifyIndex = -1
  const modifiedFiles = new Set()
  for (let i = 0; i < calls.length; i += 1) {
    const c = calls[i]
    callNames[c.name] = (callNames[c.name] ?? 0) + 1
    const args = c.argsBytes ?? 0
    if (MODIFY_TOOLS.has(c.name)) {
      if (firstModifyIndex < 0) firstModifyIndex = i
    } else if (READ_TOOLS.has(c.name) && firstModifyIndex < 0) {
      verifyBeforeFirstModify += 1
    }
    if (MODIFY_TOOLS.has(c.name)) modifyingCalls += 1
    if (READ_TOOLS.has(c.name)) readCalls += 1
    if (c.name === 'bash') bashCalls += 1
    if (DELEGATE_TOOLS.has(c.name)) subAgentBadges += 1
    if (c.wroteFile) bashWrites += 1
    if (c.isTestFile) testsAuthored += 1
  }
  // verification anywhere in the session, and before the first modification
  const firstVerifyIndex = calls.findIndex((c) => verifyShaped(c))
  if (firstModifyIndex >= 0 && firstVerifyIndex >= 0 && firstVerifyIndex < firstModifyIndex) verifyBeforeFirstModify = 1
  verifyCalls += calls.filter((c) => verifyShaped(c)).length
  sessionVerify.push({
    id: s.id,
    calls: calls.length,
    firstModifyIndex,
    firstVerifyIndex,
    verifyAfterModify: firstModifyIndex >= 0 && firstVerifyIndex > firstModifyIndex,
    verifyBeforeModify: firstModifyIndex >= 0 && firstVerifyIndex >= 0 && firstVerifyIndex < firstModifyIndex,
    modifiedFiles: modifiedFiles.size,
  })
}

const sessionsWithModify = sessionVerify.filter((s) => s.firstModifyIndex >= 0)
const effort = {
  callsTotal,
  callNames: Object.fromEntries(Object.entries(callNames).sort((a, b) => b[1] - a[1])),
  modifyingCalls,
  readCalls,
  readRatio: rate(readCalls, callsTotal),
  bashCalls,
  bashRatio: rate(bashCalls, callsTotal),
  verification: {
    sessionsWithModification: sessionsWithModify.length,
    verifyAfterFirstModify: sessionsWithModify.filter((s) => s.verifyAfterModify).length,
    verifyBeforeFirstModify: sessionsWithModify.filter((s) => s.verifyBeforeModify).length,
    neverVerifyAtAll: sessionsWithModify.filter((s) => s.firstVerifyIndex < 0).length,
  },
  toolCallsPerTopSession: rate(callsTotal, top.length),
  stepsPerTopSession: rate(top.reduce((a, s) => a + (s.stepStarts ?? 0), 0), top.length),
  turnLatency: turnLatency(top),
}

// ---------------------------------------------------------------- recovery
let textErrors = 0
let statusErrors = 0
let sessionsWithErrors = 0
let errorBearingSessions = 0
let totalResultBytes = 0
let bigResults = 0
let emptyResults = 0
let duplicatePrints = 0
const errorByName = {}
for (const s of sessions) {
  let any = false
  for (const c of s.calls ?? []) {
    totalResultBytes += c.resultBytes ?? 0
    if ((c.resultBytes ?? 0) > 50_000) bigResults += 1
    if ((c.resultBytes ?? 0) === 0) emptyResults += 1
    if (c.error === 'status') { statusErrors += 1; any = true; errorByName[c.name] = (errorByName[c.name] ?? 0) + 1 }
    else if (c.error === 'text') { textErrors += 1; any = true; errorByName[c.name] = (errorByName[c.name] ?? 0) + 1 }
  }
  if (any) sessionsWithErrors += 1
}
const recovery = {
  statusErrors,
  textFlaggedResults: textErrors,
  errorByName: Object.fromEntries(Object.entries(errorByName).sort((a, b) => b[1] - a[1])),
  sessionsWithAnyError: sessionsWithErrors,
  sessionsWithAnyErrorRate: rate(sessionsWithErrors, sessions.length),
  meanResultBytes: rate(totalResultBytes, callsTotal),
  resultsOver50KB: bigResults,
  resultsEmpty: emptyResults,
  resultsOver50KBRate: rate(bigResults, callsTotal),
  retries: sessions.reduce((a, s) => a + (s.retries ?? 0), 0),
  retryCodes: sessions.reduce((m, s) => {
    for (const [k, v] of Object.entries(s.retryCodes ?? {})) m[k] = (m[k] ?? 0) + v
    return m
  }, {}),
  sessionsWithRetries: sessions.filter((s) => (s.retries ?? 0) > 0).length,
  retriesPerRequest: rate(sessions.reduce((a, s) => a + (s.retries ?? 0), 0), sessions.reduce((a, s) => a + (s.requests ?? 0), 0)),
}

// ---------------------------------------------------------------- delegation
const byParent = new Map()
for (const s of sub) {
  const key = s.parentSession ?? '(none)'
  const list = byParent.get(key) ?? []
  list.push(s)
  byParent.set(key, list)
}
const parentGroups = [...byParent.values()]
const parallelGroups = parentGroups.filter((g) => g.length > 1)
const subByDepth = {}
for (const s of sub) subByDepth[s.depth ?? 0] = (subByDepth[s.depth ?? 0] ?? 0) + 1
const delegation = {
  subagentSessions: sub.length,
  subagentTokenShare: rate(sub.reduce((a, s) => a + (s.summed ?? 0), 0), sessions.reduce((a, s) => a + (s.summed ?? 0), 0)),
  parentsWithChildren: parentGroups.length,
  groupsOfTwoOrMore: parallelGroups.length,
  largestGroup: parentGroups.length ? Math.max(...parentGroups.map((g) => g.length)) : 0,
  meanGroupSize: rate(sub.length, parentGroups.length),
  byDepth: subByDepth,
  subagentPresets: Object.fromEntries(Object.entries(sub.reduce((m, s) => ((m[s.agentPreset ?? '(none)'] = (m[s.agentPreset ?? '(none)'] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1])),
  subagentRequestsMean: rate(sub.reduce((a, s) => a + (s.requests ?? 0), 0), sub.length),
  topRequestsMean: rate(top.reduce((a, s) => a + (s.requests ?? 0), 0), top.length),
}

// ---------------------------------------------------------------- cost
const totalSummed = sessions.reduce((a, s) => a + (s.summed ?? 0), 0)
const totalBilled = sessions.reduce((a, s) => a + (s.billed ?? 0), 0)
const totalCached = sessions.reduce((a, s) => a + (s.cached ?? 0), 0)
const totalOutput = sessions.reduce((a, s) => a + (s.output ?? 0), 0)
const totalRequests = sessions.reduce((a, s) => a + (s.requests ?? 0), 0)
const missEvents = sessions.flatMap((s) => (s.usage ?? []).filter((u) => (u.billed ?? 0) > 10_000).map((u) => ({ id: s.id, turn: u.turn, step: u.step, billed: u.billed, prompt: u.prompt, cached: u.cached })))
const over50k = missEvents.filter((e) => e.billed > 50_000)
const biggestContext = sessions.map((s) => ({ id: s.id, isSubagent: s.isSubagent, cwd: s.cwd, promptMax: s.promptMax ?? 0, requests: s.requests ?? 0 })).sort((a, b) => b.promptMax - a.promptMax).slice(0, 15)

const cost = {
  requests: totalRequests,
  summedPromptTokens: totalSummed,
  cachedTokens: totalCached,
  billedTokens: totalBilled,
  outputTokens: totalOutput,
  cachedShare: rate(totalCached, totalSummed),
  billedShare: rate(totalBilled, totalSummed),
  billedPerRequestMean: rate(totalBilled, totalRequests),
  cacheMissEventsOver10k: missEvents.length,
  cacheMissEventsOver50k: over50k.length,
  cacheMissEventsPerRequest: rate(missEvents.length, totalRequests),
  billedInMissEventsOver10k: missEvents.reduce((a, e) => a + e.billed, 0),
  shareOfBilledInMissEvents: rate(missEvents.reduce((a, e) => a + e.billed, 0), totalBilled),
  topMissEvents: missEvents.sort((a, b) => b.billed - a.billed).slice(0, 15),
  compactions: sessions.reduce((a, s) => a + (s.compactions ?? 0), 0),
  biggestContexts: biggestContext,
  outputPerBilled: rate(totalOutput, totalBilled),
  topSessionsByBilled: sessions.map((s) => ({ id: s.id, isSubagent: s.isSubagent, billed: s.billed ?? 0, requests: s.requests ?? 0, worstMiss: s.worstMiss ?? 0, missSteps: s.cacheMissSteps ?? 0, cwd: s.cwd })).sort((a, b) => b.billed - a.billed).slice(0, 15),
  missStepsPerSession: sessions.filter((s) => (s.cacheMissSteps ?? 0) > 0).length,
}

// ---------------------------------------------------------------- rework
// A "probe" turn changes nothing: every call reads, lists or runs. Those turns are
// where understanding is bought, and their share of output and requests is the
// honest measure of how much of the work was spent before/around any change.
const probeTurns = []
const changeTurns = []
for (const s of top) {
  const perTurnCalls = new Map()
  for (const c of s.calls ?? []) perTurnCalls.set(c.turn, (perTurnCalls.get(c.turn) ?? 0) + 1)
  for (const t of s.turns ?? []) {
    const n = perTurnCalls.get(t.turn) ?? 0
    if (n === 0) continue
    const row = { id: s.id, turn: t.turn, calls: n, steps: t.steps ?? 0, output: t.output ?? 0, requests: t.steps ?? 0, chars: t.chars ?? 0 }
    const hasModify = (s.calls ?? []).some((c) => c.turn === t.turn && MODIFY_TOOLS.has(c.name))
    if (hasModify) changeTurns.push(row)
    else probeTurns.push(row)
  }
}
const rework = {
  probeTurns: probeTurns.length,
  changeTurns: changeTurns.length,
  probeShareOfTurns: rate(probeTurns.length, probeTurns.length + changeTurns.length),
  probeShareOfOutput: rate(probeTurns.reduce((a, t) => a + t.output, 0), probeTurns.reduce((a, t) => a + t.output, 0) + changeTurns.reduce((a, t) => a + t.output, 0)),
  probeMedianSteps: median(probeTurns.map((t) => t.steps)),
  probeMedianCalls: median(probeTurns.map((t) => t.calls)),
  changeMedianSteps: median(changeTurns.map((t) => t.steps)),
  changeMedianCalls: median(changeTurns.map((t) => t.calls)),
  probeMedianAskChars: median(probeTurns.filter((t) => t.chars > 0).map((t) => t.chars)),
  changeMedianAskChars: median(changeTurns.filter((t) => t.chars > 0).map((t) => t.chars)),
  biggestProbeTurns: [...probeTurns].sort((a, b) => b.steps - a.steps).slice(0, 15),
  planReferenceEffect: (() => {
    const withRef = []
    const without = []
    for (const s of top) {
      const first = (s.turns ?? []).find((t) => t.chars > 0)
      if (!first) continue
      const hit = PLAN_REF.test(first.preview ?? '')
      const row = { steps: s.stepStarts ?? 0, output: s.output ?? 0, billed: s.billed ?? 0, requests: s.requests ?? 0 }
      if (hit) withRef.push(row)
      else without.push(row)
    }
    const mean = (rows, k) => (rows.length ? rows.reduce((a, r) => a + r[k], 0) / rows.length : null)
    return {
      sessionsCitingAPlan: withRef.length,
      sessionsNotCiting: without.length,
      meanStepsWithRef: mean(withRef, 'steps'),
      meanStepsWithout: mean(without, 'steps'),
      meanOutputWithRef: mean(withRef, 'output'),
      meanOutputWithout: mean(without, 'output'),
      meanBilledWithRef: mean(withRef, 'billed'),
      meanBilledWithout: mean(without, 'billed'),
    }
  })(),
}

// ---------------------------------------------------------------- dominance
const share = (list) => rate(list.reduce((a, s) => a + (s.summed ?? 0), 0), totalSummed)
const ranked = [...sessions].sort((a, b) => (b.summed ?? 0) - (a.summed ?? 0))
const cumulative = (n) => {
  const slice = ranked.slice(0, n)
  return { sessions: n, shareTokens: share(slice), shareBilled: rate(slice.reduce((a, s) => a + (s.billed ?? 0), 0), totalBilled), shareRequests: rate(slice.reduce((a, s) => a + (s.requests ?? 0), 0), totalRequests) }
}
const dominance = {
  top10: cumulative(10),
  top50: cumulative(50),
  top100: cumulative(100),
  topSessionsBySummed: ranked.slice(0, 20).map((s) => ({ id: s.id, isSubagent: s.isSubagent, depth: s.depth, cwd: s.cwd, summed: s.summed, billed: s.billed, requests: s.requests, promptMax: s.promptMax, createdAt: s.createdAt })),
  biggestByRequests: [...sessions].sort((a, b) => (b.requests ?? 0) - (a.requests ?? 0)).slice(0, 10).map((s) => ({ id: s.id, isSubagent: s.isSubagent, requests: s.requests, summed: s.summed, promptMax: s.promptMax, steps: s.stepStarts })),
}

const result = {
  generatedAt: new Date().toISOString(),
  corpus: { path: corpusPath, generatedAt: corpus.generatedAt, files: corpus.files },
  structure,
  framing,
  effort,
  recovery,
  rework,
  delegation,
  cost,
  dominance,
  notes: [
    'framing.* uses regex classifiers over a 240-character ask preview, so each field is a lower bound: a checkable command named later in a long ask is not seen.',
    'effort.verification uses bash/edit/write call arguments only (not tool results), so "verifyAfterFirstModify" means a verification-shaped command was ISSUED after a write, not that it succeeded.',
    recovery_note(),
  ],
}

if (jsonPath) {
  if (!existsSync(dirname(resolve(jsonPath)))) mkdirSync(dirname(resolve(jsonPath)), { recursive: true })
  writeFileSync(resolve(jsonPath), JSON.stringify(result, null, 2))
}
process.stdout.write(JSON.stringify(result, null, 2) + '\n')

function recovery_note() {
  return 'recovery.errorByName counts a tool result as an error when its text starts with error/failed (status) or merely mentions an error word (text); the text bucket over-counts.'
}

/** True when a call looks like a check that could fail: a test/lint/build/run or a git diff/status. */
function verifyShaped(c) {
  if (c.name === 'bash') return VERIFY_RE.test(c.cmd ?? '')
  return false
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function turnLatency(sessionsIn) {
  const gaps = []
  for (const s of sessionsIn) {
    const turns = s.turns ?? []
    for (let i = 1; i < turns.length; i += 1) {
      const a = turns[i - 1].time
      const b = turns[i].time
      if (typeof a === 'number' && typeof b === 'number' && b > a) gaps.push({ gap: b - a, chars: turns[i].chars ?? 0 })
    }
  }
  if (gaps.length === 0) return null
  return {
    samples: gaps.length,
    medianGapMs: median(gaps.map((g) => g.gap)),
    meanGapMs: Math.round(gaps.reduce((a, g) => a + g.gap, 0) / gaps.length),
    medianGapForShortAskMs: median(gaps.filter((g) => g.chars > 0 && g.chars < 120).map((g) => g.gap)),
    medianGapForLongAskMs: median(gaps.filter((g) => g.chars > 2000).map((g) => g.gap)),
    longAskSamples: gaps.filter((g) => g.chars > 2000).length,
    shortAskSamples: gaps.filter((g) => g.chars > 0 && g.chars < 120).length,
  }
}
