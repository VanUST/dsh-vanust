/**
 * PURPOSE
 *   Turn the stored DSH session logs — 1015 zstd-framed JSONL files that are too
 *   slow to re-read for every question — into one compact corpus file that the
 *   behavioural and harness analyses can be cut from repeatedly without touching
 *   the raw logs again. Answers "how did the owner actually drive the harness,
 *   and what did that cost", not "what does the harness code say".
 *
 * INPUTS
 *   --home <dir>   harness home holding `sessions/` (default: $DSH_HOME).
 *   --out <file>   corpus JSON destination (default: <cwd>/.cache/session-analysis/corpus.json).
 *   --limit <n>    only the newest n session files, for a fast smoke pass.
 *
 *   Paths are resolved against the WORKING DIRECTORY, so run this from the repository
 *   root (`make session-corpus` does). The default output is under `.cache/`, which is
 *   derived data: regenerate it rather than committing it.
 *
 * OUTPUTS
 *   Writes a JSON object `{ generatedAt, home, files, parseErrors, sessions: [...] }`.
 *   Each session entry carries identity (id, origin, cwd, depth, model, timestamps),
 *   per-turn records (wall time, prompt character length, tool calls, steps, and a
 *   160-character preview of the ask), per-tool-call records (name, error flag,
 *   result bytes, call-argument bytes), per-step usage (prompt/billed/cached/output/
 *   reasoning) and per-tool-name counts. On an unreadable file the session is
 *   skipped into `parseErrors` and the remaining files still contribute; an empty
 *   file set writes a corpus with zero sessions and exits 1 so an empty corpus is
 *   never mistaken for a clean one.
 *
 * KEYWORDS
 *   session corpus, extraction, behaviour signals, tool calls, token usage, cache
 *
 * BEHAVIOUR ON EDGE CASES
 *   - v3 stores session identity at the record top level, v4 under `data`; both are read.
 *   - An unparsable JSON line is counted and skipped, never fatal.
 *   - A session with no usage records keeps its identity and reports zero requests.
 *   - Tool results whose error text can only be inferred from prose are flagged
 *     `error: "text"` so a later pass can tell a real failure from ordinary output.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { resolveHome, readSession, sessionFiles, usageSeries } from './session-log.mjs'

const argv = process.argv.slice(2)
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const home = argOf('--home', resolveHome())
const out = resolve(argOf('--out', '.cache/session-analysis/corpus.json')) // relative to the working directory, which is the repository root for the Make targets
const limit = Number(argOf('--limit', '0')) || 0

let files = sessionFiles(home)
if (limit > 0) files = files.slice(0, limit)
if (files.length === 0) {
  process.stderr.write(`extract-corpus: no session files under ${home}\n`)
  process.exit(1)
}


const TEST_FILE_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.(js|ts|tsx|mjs|cjs|py|go|rs)$|(^|\/)test_[\w]+\.(py|gd)$/i
const WRITE_CMD_RE = /(^|\s)>{1,2}\s*\S|\btee\b|\bsed\s+-i\b|\bcat\s*>\s*/i

/** Pull the file path, test-file flag and shell command out of a tool call's JSON arguments. */
function parseArgs(args) {
  let o = null
  try { o = JSON.parse(args) } catch { o = null }
  const filePath = typeof o?.file_path === 'string' ? o.file_path : typeof o?.path === 'string' ? o.path : null
  const isTestFile = Boolean(filePath && TEST_FILE_RE.test(filePath))
  const command = typeof o?.command === 'string' ? o.command : null
  const wroteFile = name_writes(args, o, command)
  return { filePath, isTestFile, wroteFile, cmd: command ? command.slice(0, 400) : null }
}

function name_writes(args, o, command) {
  if (command && WRITE_CMD_RE.test(command)) return true
  if (typeof o?.content === 'string' && typeof o?.file_path === 'string') return true
  return false
}

const ERROR_TEXT = /\b(error|failed|failure|exception|traceback|denied|not found|no such file|timed out|timeout)\b/i
const PREVIEW = 240

/** Collapse a content array of text parts into one string, capped at `cap` characters. */
function contentText(content, cap = Infinity) {
  if (typeof content === 'string') return content.slice(0, cap)
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const part of content) {
    if (part && typeof part.text === 'string') text += (text ? '\n' : '') + part.text
    else if (part && part.type === 'tool-call') text += (text ? '\n' : '') + `[tool-call ${part.name}]`
    if (text.length >= cap) break
  }
  return text.slice(0, cap)
}

const sessions = []
const parseErrors = []

for (const file of files) {
  try {
    const text = readSession(file)
    const usage = usageSeries(text)

    let meta = null
    let sessionRecord = null
    let model = null
    let contextWindow = null
    let sandboxMode = null
    let approvalPolicy = null
    let firstRequestTools = null

    const turns = []
    const turnByKey = new Map()
    let pendingAsk = null
    const calls = []
    const callById = new Map()
    const callNameCounts = {}
    const callErrorCounts = {}
    const kindCounts = {}
    const retryCodes = {}
    const agentPresets = []
    const childSessions = []
    let records = 0
    let userMessages = 0
    let stepStarts = 0
    let assistantChars = 0
    let reasoningChars = 0
    let textChars = 0
    let todoWrites = 0
    let compactions = 0
    let broken = 0
    let lastStep = null

    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue
      let r
      try {
        r = JSON.parse(line)
      } catch {
        broken += 1
        continue
      }
      records += 1
      const type = r.type ?? '(none)'
      kindCounts[type] = (kindCounts[type] ?? 0) + 1
      const d = r.data ?? r

      if (type === 'session') {
        sessionRecord = d
        meta = {
          id: d.id ?? null,
          origin: d.origin ?? (d.parentSession ? 'subagent' : 'top'),
          isSubagent: Boolean(d.parentSession),
          parentSession: d.parentSession ?? null,
          depth: d.delegationDepth ?? 0,
          cwd: d.cwd ?? null,
          createdAt: d.createdAt ?? null,
          agentPreset: d.agentPreset ?? null,
          isSeeded: Boolean(d.isSeeded),
        }
        continue
      }
      if (type === 'user/message') {
        userMessages += 1
        const content = d.content ?? d.message?.content
        const full = contentText(content)
        pendingAsk = {
          time: r.time ?? null,
          chars: full.length,
          preview: contentText(content, PREVIEW).replace(/\s+/g, ' ').trim(),
        }
        continue
      }
      if (type === 'assistant/message') {
        const msg = d.message ?? {}
        for (const part of Array.isArray(msg.content) ? msg.content : []) {
          if (part?.type === 'text') textChars += (part.text ?? '').length
          if (part?.type === 'reasoning') reasoningChars += (part.text ?? '').length
          if (part?.type === 'tool-call') { /* counted via tool/call records */ }
        }
        assistantChars += 1
        continue
      }
      if (type === 'tool/call') {
        const name = d.name ?? '(unknown)'
        const args = typeof d.arguments === 'string' ? d.arguments : JSON.stringify(d.arguments ?? '')
        const parsed = parseArgs(args)
        const call = {
          seq: r.seq ?? null,
          turn: d.turn ?? null,
          step: d.step ?? null,
          name,
          argsBytes: args.length,
          error: null,
          resultBytes: 0,
          durationMs: null,
          filePath: parsed.filePath,
          isTestFile: parsed.isTestFile,
          wroteFile: parsed.wroteFile,
          cmd: parsed.cmd,
        }
        calls.push(call)
        callById.set(d.callId ?? `${calls.length}`, call)
        callNameCounts[name] = (callNameCounts[name] ?? 0) + 1
        const t = turnByKey.get(d.turn ?? null) ?? turns[turns.length - 1]
        if (t) t.calls += 1
        continue
      }
      if (type === 'tool/result') {
        const key = d.toolCallId ?? d.message?.source?.callId
        const call = callById.get(key)
        const t = contentText(d.message?.content ?? d.content)
        const failed = /^(error|failed)/i.test(t.trim())
        const flagged = ERROR_TEXT.test(t)
        if (call) {
          call.resultBytes = t.length
          call.error = failed ? 'status' : flagged ? 'text' : null
          if (call.error) callErrorCounts[call.name] = (callErrorCounts[call.name] ?? 0) + 1
        }
        continue
      }
      if (type === 'turn/start') {
        const key = d.turn ?? null
        const ask = pendingAsk
        pendingAsk = null
        turnByKey.set(key, {
          turn: key,
          time: ask ? ask.time : r.time ?? null,
          chars: ask ? ask.chars : 0,
          preview: ask ? ask.preview : '(no user message: queued, spliced or delegated input)',
          calls: 0,
          callFrom: calls.length,
          steps: 0,
          billed: 0,
          cached: 0,
          promptSum: 0,
          output: 0,
          reasoning: 0,
        })
        continue
      }
      if (type === 'step/start') {
        stepStarts += 1
        const t = turnByKey.get(d.turn ?? null) ?? turns[turns.length - 1]
        if (t) t.steps += 1
        continue
      }
      if (type === 'request/header') {
        if (firstRequestTools === null) {
          const tools = d.header?.tools
          firstRequestTools = Array.isArray(tools) ? tools.map((x) => x?.name).filter(Boolean) : []
          model = d.header?.config?.model ?? model
        }
        continue
      }
      if (type === 'request/context') {
        contextWindow = d.contextWindow ?? contextWindow
        model = d.model ?? model
        continue
      }
      if (type === 'sandbox/mode') { sandboxMode = d.mode ?? sandboxMode; continue }
      if (type === 'approval/policy') { approvalPolicy = d.policy ?? approvalPolicy; continue }
      if (type === 'agent-preset' || type === 'agent-preset/selected') { agentPresets.push(d.preset ?? d.name ?? null); continue }
      if (type === 'todo/write') { todoWrites += 1; continue }
      if (type === 'llm/retry' || type === 'llm/retry-started') {
        const code = d.failure?.code ?? d.failure?.message ?? '(unknown)'
        retryCodes[code] = (retryCodes[code] ?? 0) + 1
        continue
      }
      if (type.startsWith('compaction')) { compactions += 1; continue }
    }

    for (const t of [...turnByKey.values()].sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0))) turns.push(t)

    // usageSeries is keyed by (turn, step); a turn owns many steps, so aggregate
    // per turn through a map rather than by a turn-field match, which collides
    // when several steps report the same turn number.
    const byTurn = new Map()
    for (const u of usage) {
      const acc = byTurn.get(u.turn) ?? { billed: 0, cached: 0, prompt: 0, output: 0, reasoning: 0, steps: 0 }
      acc.billed += u.billed ?? 0
      acc.cached += u.cached ?? 0
      acc.prompt += u.prompt ?? 0
      acc.output += u.output ?? 0
      acc.reasoning += u.reasoning ?? 0
      acc.steps += 1
      byTurn.set(u.turn, acc)
    }
    // The authoritative turn number is `turn/start`'s, not the array position: a
    // queued owner message or a spliced inbox item starts a turn with no
    // user/message record, so the two indexes drift apart.
    for (const t of turns) {
      const acc = byTurn.get(t.turn)
      t.steps = acc ? acc.steps : 0
      t.billed = acc ? acc.billed : 0
      t.cached = acc ? acc.cached : 0
      t.promptSum = acc ? acc.prompt : 0
      t.output = acc ? acc.output : 0
      t.reasoning = acc ? acc.reasoning : 0
    }

    const promptSizes = usage.map((u) => u.prompt)
    sessions.push({
      file,
      ...(meta ?? { id: null, origin: 'unknown', isSubagent: false, parentSession: null, depth: 0, cwd: null, createdAt: null, agentPreset: null, isSeeded: false }),
      model,
      contextWindow,
      sandboxMode,
      approvalPolicy,
      agentPresets: agentPresets.filter(Boolean),
      toolListSize: firstRequestTools ? firstRequestTools.length : null,
      toolList: firstRequestTools,
      records,
      brokenLines: broken,
      userMessages,
      stepStarts,
      requests: usage.length,
      promptFirst: promptSizes[0] ?? 0,
      promptLast: promptSizes[promptSizes.length - 1] ?? 0,
      promptMax: promptSizes.length ? Math.max(...promptSizes) : 0,
      summed: usage.reduce((a, u) => a + u.prompt, 0),
      billed: usage.reduce((a, u) => a + u.billed, 0),
      cached: usage.reduce((a, u) => a + u.cached, 0),
      output: usage.reduce((a, u) => a + (u.output ?? 0), 0),
      outputMax: usage.length ? Math.max(...usage.map((u) => u.output ?? 0)) : 0,
      worstMiss: usage.reduce((a, u) => Math.max(a, u.billed), 0),
      cacheMissSteps: usage.filter((u) => u.billed > 10_000).length,
      lowCacheSteps: usage.filter((u) => u.prompt > 0 && u.cached / u.prompt < 0.5).length,
      retries: Object.values(retryCodes).reduce((a, b) => a + b, 0),
      retryCodes,
      todoWrites,
      compactions,
      textChars,
      reasoningChars,
      assistantMessages: kindCounts['assistant/message'] ?? 0,
      toolCalls: calls.length,
      toolErrors: calls.filter((c) => c.error).length,
      toolErrorByName: callErrorCounts,
      callNameCounts,
      kindCounts,
      usage: usage.map((u) => ({
        turn: u.turn, step: u.step, prompt: u.prompt, cached: u.cached,
        billed: u.billed, output: u.output ?? 0, reasoning: u.reasoning ?? 0,
      })),
      turns,
      calls,
    })
  } catch (error) {
    parseErrors.push({ file, error: String(error?.message ?? error) })
  }
}

if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true })
const corpus = {
  generatedAt: new Date().toISOString(),
  home,
  files: files.length,
  parseErrors,
  sessions,
}
writeFileSync(out, JSON.stringify(corpus))

const total = sessions.length
const subagents = sessions.filter((s) => s.isSubagent).length
process.stdout.write(
  `extract-corpus: ${total} sessions (${total - subagents} top-level, ${subagents} subagent), ` +
    `${parseErrors.length} unreadable, ${(JSON.stringify(corpus).length / 1e6).toFixed(1)} MB -> ${out}\n`,
)
