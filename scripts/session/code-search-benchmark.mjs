#!/usr/bin/env node
/**
 * Run and measure the read-only code-search benchmark.
 *
 * Measurement deliberately shells out to `zstd -dc`: session.v4 logs are
 * concatenated zstd frames and a one-frame decoder silently drops later usage.
 * No token, latency, correctness, or offered-tool value is estimated. Tool
 * schema size is reported in bytes because per-schema provider tokens are not
 * present in the log; first-request prompt tokens are reported separately.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DEFAULT_ROOT = join(KIT, 'reports/code-search')
const ENHANCED_PATTERN = /serena|octocode/i
const DEFAULT_ENHANCED_TOOLS = [
  'mcp__serena__find_symbol',
  'mcp__serena__find_referencing_symbols',
  'mcp__serena__get_symbols_overview',
  'mcp__serena__initial_instructions',
  'mcp__octocode__semantic_search',
  'mcp__octocode__structural_search',
  'mcp__octocode__view_signatures',
  'mcp__octocode__graphrag',
]

function usage() {
  return `Usage:
  node scripts/session/code-search-benchmark.mjs run --arm baseline [options]
  node scripts/session/code-search-benchmark.mjs run --arm enhanced --proof-log <session.zstd> [--require-tool <extra-exact-name> ...] [options]
  node scripts/session/code-search-benchmark.mjs measure --manifest <run-manifest.json> [--scores <scores.json>]
  node scripts/session/code-search-benchmark.mjs proof --log <session.zstd> [--require-tool <exact-name> ...]
  node scripts/session/code-search-benchmark.mjs compare --baseline <baseline/measurements.json> --enhanced <enhanced/measurements.json>

Run options:
  --home <dir>          isolated DSH_HOME (default reports/code-search/dsh-home)
  --repository <dir>    fixed source snapshot (default reports/code-search/repository)
  --tasks <file>        task definitions (default reports/code-search/tasks.json)
  --overlay <file>      repeatable Cordis overlay; common first, enhanced second
  --out <dir>           new arm output directory (default reports/code-search/<arm>)
  --task <id>           repeatable subset; default every task in file order
  --timeout-ms <n>      per-task process limit (default 600000)

A run directory must not already contain a manifest. Enhanced runs are refused
unless a separate proof log's request/header contains the built-in exact 4+4
Serena/Octocode surface plus any explicit extra required tools. The enhanced
arm's own headers are checked again after every task. Only root \`.serena/\` and
\`.dsh/serena-hooks/\` generated state are excluded from source+Git hashing.`
}

function take(argv, name, fallback = undefined) {
  const values = argv.filter((arg) => arg.startsWith(`${name}=`)).map((arg) => arg.slice(name.length + 1))
  for (let i = 0; i < argv.length; i++) if (argv[i] === name) values.push(argv[i + 1])
  return values.length === 0 ? fallback : values
}

function one(argv, name, fallback = undefined) {
  const values = take(argv, name)
  if (values === undefined) return fallback
  if (values.length !== 1 || values[0] === undefined || values[0].startsWith('--')) throw new Error(`${name} requires exactly one value`)
  return values[0]
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function decode(path) {
  // Do not replace this with zstdDecompressSync(readFileSync(path)): Node's
  // convenience decoder may return only the first frame of an appended log.
  return execFileSync('zstd', ['-dc', path], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

function records(path) {
  const text = decode(path)
  const result = []
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue
    try {
      result.push(JSON.parse(line))
    } catch (error) {
      throw new Error(`${path}: decoded line ${index + 1} is not JSON: ${error.message}`)
    }
  }
  if (result.length === 0) throw new Error(`${path}: no decoded records`)
  return result
}

function textParts(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n')
}

function headerTools(events) {
  const headers = events.filter((event) => event.type === 'request/header')
  if (headers.length === 0) throw new Error('session has no request/header; offered tools are unproven')
  const first = headers[0].data?.header?.tools
  if (!Array.isArray(first)) throw new Error('request/header data.header.tools is absent')
  for (const header of headers.slice(1)) {
    if (sha256(JSON.stringify(header.data?.header?.tools)) !== sha256(JSON.stringify(first))) {
      throw new Error('offered tool schemas changed between request/header records')
    }
  }
  return first
}

function measureLog(path) {
  const events = records(path)
  const tools = headerTools(events)
  const usage = events.filter((event) => event.type === 'assistant/message' && event.data?.usage).map((event) => {
    const value = event.data.usage
    const fresh = Number(value.inputTokens ?? 0)
    const cached = Number(value.cacheReadTokens ?? 0)
    return {
      time: event.time,
      turn: event.data.turn,
      step: event.data.step,
      freshInputTokens: fresh,
      cacheReadTokens: cached,
      promptTokens: fresh + cached,
      outputTokens: Number(value.outputTokens ?? 0),
      reportedTotalTokens: Number(value.totalTokens ?? 0),
    }
  })
  if (usage.length === 0) throw new Error(`${path}: no assistant/message data.usage records`)
  for (const entry of usage) {
    for (const key of ['freshInputTokens', 'cacheReadTokens', 'promptTokens', 'outputTokens']) {
      if (!Number.isSafeInteger(entry[key]) || entry[key] < 0) throw new Error(`${path}: invalid usage ${key}`)
    }
  }
  const calls = events.filter((event) => event.type === 'tool/call')
  const toolCallsByName = {}
  for (const call of calls) {
    const name = String(call.data?.name ?? '(missing)')
    toolCallsByName[name] = (toolCallsByName[name] ?? 0) + 1
  }
  const contexts = events.filter((event) => event.type === 'request/context').map((event) => ({
    provider: event.data?.provider,
    model: event.data?.model,
    contextWindow: event.data?.contextWindow,
  }))
  const requestConfig = events.find((event) => event.type === 'request/header')?.data?.header?.config ?? null
  const turnStart = events.find((event) => event.type === 'turn/start' && Number.isFinite(event.time))?.time
  const firstUser = events.find((event) => event.type === 'user/message' && Number.isFinite(event.time))?.time
  const assistants = events.filter((event) => event.type === 'assistant/message' && Number.isFinite(event.time))
  const startedAt = turnStart ?? firstUser ?? usage[0].time
  const endedAt = assistants.at(-1)?.time ?? usage.at(-1).time
  const finalAnswer = [...assistants].reverse().map((event) => textParts(event.data?.message)).find((text) => text.trim() !== '') ?? ''
  const sum = (key) => usage.reduce((total, entry) => total + entry[key], 0)
  const firstPrompt = usage[0]
  return {
    log: resolve(path),
    decoder: `zstd -dc ${resolve(path)}`,
    sessionRecordCount: events.length,
    route: contexts[0] ?? null,
    routeCount: contexts.length,
    requestConfig,
    offeredTools: tools.map((tool) => tool.name),
    offeredToolCount: tools.length,
    toolSchemaBytes: Buffer.byteLength(JSON.stringify(tools)),
    perToolSchema: tools.map((tool) => ({
      name: tool.name,
      schemaBytes: Buffer.byteLength(JSON.stringify(tool)),
      descriptionBytes: Buffer.byteLength(String(tool.description ?? '')),
      parametersBytes: Buffer.byteLength(JSON.stringify(tool.parameters ?? {})),
    })),
    requestCount: usage.length,
    freshInputTokens: sum('freshInputTokens'),
    cacheReadTokens: sum('cacheReadTokens'),
    promptTokens: sum('promptTokens'),
    outputTokens: sum('outputTokens'),
    reportedTotalTokens: sum('reportedTotalTokens'),
    firstRequest: {
      freshInputTokens: firstPrompt.freshInputTokens,
      cacheReadTokens: firstPrompt.cacheReadTokens,
      promptTokens: firstPrompt.promptTokens,
      outputTokens: firstPrompt.outputTokens,
    },
    usage,
    toolCalls: calls.length,
    toolCallsByName,
    logStartedAt: new Date(startedAt).toISOString(),
    logEndedAt: new Date(endedAt).toISOString(),
    logWallMs: endedAt - startedAt,
    finalAnswer,
  }
}

function sessionLogs(home) {
  const root = join(home, 'sessions')
  if (!existsSync(root)) return []
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/^session(?:\.v\d+)?\.jsonl\.zstd$/.test(entry.name)) found.push(path)
    }
  }
  walk(root)
  return found.sort()
}

function repositoryState(root) {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const rel = relative(root, path)
      // Serena writes language-server caches below .serena as tools are adopted
      // (for example .serena/cache/typescript/*.pkl). The adoption hooks write
      // SessionStart/counters below .dsh/serena-hooks. These two exact paths are
      // generated tool state, not repository source or Git metadata. Everything
      // else, including .git and any other .dsh content, remains hashed.
      if ((rel === '.serena' || rel === '.dsh/serena-hooks') && entry.isDirectory()) continue
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        const bytes = readFileSync(path)
        files.push({ path: rel, bytes: bytes.length, sha256: sha256(bytes) })
      } else throw new Error(`repository snapshot contains non-regular entry: ${path}`)
    }
  }
  walk(root)
  files.sort((a, b) => a.path.localeCompare(b.path))
  const manifest = JSON.stringify(files)
  return { fileCount: files.length, aggregateSha256: sha256(manifest), excludedGeneratedState: ['.serena/', '.dsh/serena-hooks/'], files }
}

function assertEnhancedProof(proofLog, requiredTools) {
  if (!proofLog) throw new Error('enhanced arm refused: --proof-log is required before any enhanced task starts')
  if (requiredTools.length < 2 || !requiredTools.some((name) => /serena/i.test(name)) || !requiredTools.some((name) => /octocode/i.test(name))) {
    throw new Error('enhanced arm refused: repeat --require-tool with exact Serena and Octocode tool names')
  }
  const measured = measureLog(proofLog)
  const missing = requiredTools.filter((name) => !measured.offeredTools.includes(name))
  if (missing.length > 0) throw new Error(`enhanced arm refused: proof request/header lacks ${missing.join(', ')}`)
  return {
    proofLog: resolve(proofLog),
    requiredTools,
    offeredTools: measured.offeredTools,
    route: measured.route,
  }
}

function run(argv) {
  const arm = one(argv, '--arm')
  if (arm !== 'baseline' && arm !== 'enhanced') throw new Error('--arm must be baseline or enhanced')
  const home = resolve(one(argv, '--home', join(DEFAULT_ROOT, 'dsh-home')))
  const repository = resolve(one(argv, '--repository', join(DEFAULT_ROOT, 'repository')))
  const tasksPath = resolve(one(argv, '--tasks', join(DEFAULT_ROOT, 'tasks.json')))
  const out = resolve(one(argv, '--out', join(DEFAULT_ROOT, arm)))
  const overlays = (take(argv, '--overlay', []) ?? []).map((path) => resolve(path))
  const explicitRequiredTools = take(argv, '--require-tool', []) ?? []
  const requiredTools = arm === 'enhanced' ? [...new Set([...DEFAULT_ENHANCED_TOOLS, ...explicitRequiredTools])] : explicitRequiredTools
  const proofLog = one(argv, '--proof-log')
  const timeoutMs = Number(one(argv, '--timeout-ms', '600000'))
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000) throw new Error('--timeout-ms must be an integer >= 1000')
  if (overlays.length === 0) throw new Error('at least one shared --overlay is required')
  for (const path of [home, repository, tasksPath, ...overlays]) if (!existsSync(path)) throw new Error(`not found: ${path}`)
  if (existsSync(join(out, 'run-manifest.json'))) throw new Error(`refusing to overwrite ${join(out, 'run-manifest.json')}`)
  const proof = arm === 'enhanced' ? assertEnhancedProof(proofLog ? resolve(proofLog) : undefined, requiredTools) : null
  const definitions = JSON.parse(readFileSync(tasksPath, 'utf8'))
  const selected = take(argv, '--task', []) ?? []
  const tasks = definitions.tasks.filter((task) => selected.length === 0 || selected.includes(task.id))
  if (tasks.length === 0 || (selected.length > 0 && tasks.length !== selected.length)) throw new Error('task selection did not match every requested id')
  const repoBefore = repositoryState(repository)
  mkdirSync(out, { recursive: true })
  writeJson(join(out, 'repository-before.json'), repoBefore)
  const manifest = {
    schemaVersion: 1,
    arm,
    createdAt: new Date().toISOString(),
    home,
    repository,
    tasksPath,
    repositoryRevision: definitions.repositoryRevision,
    repositoryAggregateSha256: repoBefore.aggregateSha256,
    overlays,
    modelRequest: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' },
    decoder: 'zstd -dc',
    enhancedProof: proof,
    tasks: [],
  }
  const save = () => writeJson(join(out, 'run-manifest.json'), manifest)
  save()
  const node = process.env.DSH_BENCH_NODE ?? '/home/iustimov/.npm/node/bin/node'
  const entry = process.env.DSH_BENCH_ENTRY ?? '/home/iustimov/.npm/node/bin/dsh'
  for (const task of tasks) {
    const prompt = `${definitions.commonInstructions}\n\n${task.question}\n`
    const beforeLogs = new Set(sessionLogs(home))
    const args = [entry, 'headless', ...overlays.flatMap((path) => ['--patch', path]), '-']
    const displayCommand = [node, ...args].map((part) => JSON.stringify(part)).join(' ')
    const startedAt = Date.now()
    const child = spawnSync(node, args, {
      cwd: repository,
      env: { ...process.env, DSH_HOME: home, DSH_KIT_BOOT: '0' },
      input: prompt,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    })
    const endedAt = Date.now()
    const newLogs = sessionLogs(home).filter((path) => !beforeLogs.has(path))
    const taskDir = join(out, 'tasks', task.id)
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(join(taskDir, 'prompt.txt'), prompt)
    writeFileSync(join(taskDir, 'stdout.txt'), child.stdout ?? '')
    writeFileSync(join(taskDir, 'stderr.txt'), child.stderr ?? '')
    const record = {
      id: task.id,
      category: task.category,
      promptSha256: sha256(prompt),
      command: displayCommand,
      stdin: join(taskDir, 'prompt.txt'),
      stdout: join(taskDir, 'stdout.txt'),
      stderr: join(taskDir, 'stderr.txt'),
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      processWallMs: endedAt - startedAt,
      exitCode: child.status,
      signal: child.signal,
      spawnError: child.error?.message ?? null,
      originalLog: newLogs.length === 1 ? newLogs[0] : null,
      log: null,
      headerGate: null,
    }
    if (newLogs.length === 1) {
      const copied = join(taskDir, 'session.v4.jsonl.zstd')
      copyFileSync(newLogs[0], copied)
      record.log = copied
      try {
        const measured = measureLog(copied)
        const enhancedOffered = measured.offeredTools.filter((name) => ENHANCED_PATTERN.test(name))
        const missing = arm === 'enhanced' ? requiredTools.filter((name) => !measured.offeredTools.includes(name)) : []
        record.headerGate = {
          offeredToolCount: measured.offeredToolCount,
          enhancedOffered,
          missingRequired: missing,
          route: measured.route,
          ok: (arm === 'baseline' ? enhancedOffered.length === 0 : missing.length === 0) && measured.route?.provider === 'deepseek-official' && measured.route?.model === 'deepseek-flash',
        }
      } catch (error) {
        record.headerGate = { ok: false, error: error.message }
      }
    } else {
      record.headerGate = { ok: false, error: `expected exactly one new session log, found ${newLogs.length}` }
    }
    const repoAfterTask = repositoryState(repository)
    record.repositoryUnchanged = repoAfterTask.aggregateSha256 === repoBefore.aggregateSha256
    manifest.tasks.push(record)
    save()
  }
  const repoAfter = repositoryState(repository)
  writeJson(join(out, 'repository-after.json'), repoAfter)
  manifest.repositoryUnchanged = repoAfter.aggregateSha256 === repoBefore.aggregateSha256
  manifest.completedAt = new Date().toISOString()
  manifest.ok = manifest.repositoryUnchanged && manifest.tasks.every((task) => task.exitCode === 0 && task.headerGate?.ok === true)
  save()
  console.log(JSON.stringify({ ok: manifest.ok, manifest: join(out, 'run-manifest.json'), tasks: manifest.tasks.map((task) => ({ id: task.id, exitCode: task.exitCode, log: task.log, headerGate: task.headerGate })) }, null, 2))
  if (!manifest.ok) process.exitCode = 1
}

function measure(argv) {
  const manifestPath = resolve(one(argv, '--manifest'))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const scoresPath = one(argv, '--scores')
  const scores = scoresPath ? JSON.parse(readFileSync(resolve(scoresPath), 'utf8')) : null
  const measurements = manifest.tasks.map((task) => {
    if (!task.log) throw new Error(`${task.id}: no session log`)
    const value = { id: task.id, category: task.category, promptSha256: task.promptSha256, processWallMs: task.processWallMs, exitCode: task.exitCode, ...measureLog(task.log) }
    value.finalAnswerSha256 = sha256(value.finalAnswer)
    value.finalAnswerMatchesStdout = value.finalAnswer.trim() === readFileSync(task.stdout, 'utf8').trim()
    const score = scores?.tasks?.find((entry) => entry.id === task.id)
    if (score) value.correctness = { score: score.score, facts: score.facts, rationale: score.rationale }
    return value
  })
  const sum = (key) => measurements.reduce((total, task) => total + task[key], 0)
  const first = measurements[0]
  const result = {
    schemaVersion: 1,
    arm: manifest.arm,
    manifest: manifestPath,
    repositoryRevision: manifest.repositoryRevision,
    repositoryAggregateSha256: manifest.repositoryAggregateSha256,
    repositoryUnchanged: manifest.repositoryUnchanged,
    modelRequest: manifest.modelRequest,
    overlays: manifest.overlays,
    staticSetup: {
      note: 'Schema bytes are exact JSON bytes, not estimated tokens. First-request prompt totals include system prompt, tool schemas, task and runtime context; they are not a pure schema token count.',
      offeredToolCount: first.offeredToolCount,
      toolSchemaBytes: first.toolSchemaBytes,
      perToolSchema: first.perToolSchema,
      summedFirstRequestPromptTokens: measurements.reduce((total, task) => total + task.firstRequest.promptTokens, 0),
      summedFirstRequestFreshInputTokens: measurements.reduce((total, task) => total + task.firstRequest.freshInputTokens, 0),
      summedFirstRequestCacheReadTokens: measurements.reduce((total, task) => total + task.firstRequest.cacheReadTokens, 0),
    },
    totals: {
      tasks: measurements.length,
      requestCount: sum('requestCount'),
      freshInputTokens: sum('freshInputTokens'),
      cacheReadTokens: sum('cacheReadTokens'),
      promptTokens: sum('promptTokens'),
      outputTokens: sum('outputTokens'),
      toolCalls: sum('toolCalls'),
      logWallMs: sum('logWallMs'),
      processWallMs: sum('processWallMs'),
    },
    tasks: measurements,
  }
  if (scores) result.correctness = {
    mean: measurements.reduce((total, task) => total + Number(task.correctness?.score ?? 0), 0) / measurements.length,
    scoresFile: resolve(scoresPath),
  }
  const out = resolve(one(argv, '--out', join(dirname(manifestPath), 'measurements.json')))
  writeJson(out, result)
  console.log(JSON.stringify({ out, totals: result.totals, staticSetup: result.staticSetup, correctness: result.correctness ?? null }, null, 2))
}

function proof(argv) {
  const path = resolve(one(argv, '--log'))
  const explicit = take(argv, '--require-tool', []) ?? []
  const required = explicit.length === 0 ? DEFAULT_ENHANCED_TOOLS : explicit
  const measured = measureLog(path)
  const missing = required.filter((name) => !measured.offeredTools.includes(name))
  const result = { log: path, route: measured.route, offeredTools: measured.offeredTools, requiredTools: required, missingRequired: missing, ok: missing.length === 0 }
  console.log(JSON.stringify(result, null, 2))
  if (missing.length > 0) process.exitCode = 1
}

function compare(argv) {
  const baselinePath = resolve(one(argv, '--baseline'))
  const enhancedPath = resolve(one(argv, '--enhanced'))
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const enhanced = JSON.parse(readFileSync(enhancedPath, 'utf8'))
  if (baseline.repositoryAggregateSha256 !== enhanced.repositoryAggregateSha256) throw new Error('repository bytes differ between arms')
  const sameModelRoute = baseline.tasks.every((task, index) => {
    const other = enhanced.tasks[index]
    if (!other || task.id !== other.id) return false
    for (const key of ['provider', 'model', 'reasoningEffort', 'maxTokens']) {
      if (task.requestConfig?.[key] !== other.requestConfig?.[key]) return false
    }
    return task.route?.provider === other.route?.provider && task.route?.model === other.route?.model
  })
  if (!sameModelRoute) throw new Error('actual model route or request config differs between arms')
  const ids = baseline.tasks.map((task) => task.id)
  if (JSON.stringify(ids) !== JSON.stringify(enhanced.tasks.map((task) => task.id))) throw new Error('task order differs between arms')
  for (let i = 0; i < ids.length; i++) if (baseline.tasks[i].promptSha256 !== enhanced.tasks[i].promptSha256) throw new Error(`prompt differs for ${ids[i]}`)
  const baselineTools = new Set(baseline.staticSetup.perToolSchema.map((tool) => tool.name))
  const enhancedTools = new Set(enhanced.staticSetup.perToolSchema.map((tool) => tool.name))
  const delta = (key) => enhanced.totals[key] - baseline.totals[key]
  const result = {
    baseline: baselinePath,
    enhanced: enhancedPath,
    sameRepositoryBytes: true,
    sameOrderedPrompts: true,
    sameModelRoute,
    enhancedOnlyTools: [...enhancedTools].filter((name) => !baselineTools.has(name)).sort(),
    removedBaselineTools: [...baselineTools].filter((name) => !enhancedTools.has(name)).sort(),
    toolSchemaBytesDelta: enhanced.staticSetup.toolSchemaBytes - baseline.staticSetup.toolSchemaBytes,
    totalsDelta: Object.fromEntries(['requestCount', 'freshInputTokens', 'cacheReadTokens', 'promptTokens', 'outputTokens', 'toolCalls', 'logWallMs', 'processWallMs'].map((key) => [key, delta(key)])),
    perTask: baseline.tasks.map((task, index) => {
      const other = enhanced.tasks[index]
      return {
        id: task.id,
        baselineCorrectness: task.correctness?.score ?? null,
        enhancedCorrectness: other.correctness?.score ?? null,
        ...Object.fromEntries(['freshInputTokens', 'cacheReadTokens', 'promptTokens', 'outputTokens', 'toolCalls', 'logWallMs'].map((key) => [`${key}Delta`, other[key] - task[key]])),
      }
    }),
    limitation: 'One run per task per arm is a small, ordered sample. Provider cache state, model nondeterminism and task order can dominate deltas; this is descriptive evidence, not statistical significance.',
  }
  const out = resolve(one(argv, '--out', join(DEFAULT_ROOT, 'comparison.json')))
  writeJson(out, result)
  console.log(JSON.stringify({ out, ...result }, null, 2))
}

try {
  const [command, ...argv] = process.argv.slice(2)
  if (command === 'run') run(argv)
  else if (command === 'measure') measure(argv)
  else if (command === 'proof') proof(argv)
  else if (command === 'compare') compare(argv)
  else {
    console.log(usage())
    if (command !== '--help' && command !== '-h' && command !== undefined) process.exitCode = 2
  }
} catch (error) {
  console.error(`code-search-benchmark: ${error.message}`)
  process.exitCode = 2
}
