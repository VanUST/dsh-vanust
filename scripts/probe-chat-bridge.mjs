/**
 * PURPOSE
 *   Measure, by booting a real harness and driving it from an in-process
 *   plugin, the five facts a phone-facing chat bridge would be built on and
 *   that no reading of a `.d.ts` can settle: the exact shape of a real
 *   `ask_user_question` request and of the answerer waterfall's terminal; the
 *   exact shape of a real sandbox-escalation approval request and what an
 *   unanswered waterfall actually produces; whether `session/follow` can be
 *   iterated from a plugin with no browser carrier and exactly which frames it
 *   emits; whether a user turn can be injected in-process through
 *   `ctx.sessionController.prompt` (queue and steer) and whether the model
 *   really answers; and what `ctx.typertGateway.hasLiveClient()` reports with
 *   no client attached versus a real WebSocket client on the mux.
 *
 *   The scaffold is the cheapest deployment that still mounts the services
 *   under test: a scratch home under the system temp directory carrying only a
 *   copied credential file, a scratch profile composing `@deepseek-ai/dsh-base`
 *   plus `@deepseek-ai/dsh-web-app` (the web bundle is what mounts
 *   `ctx.sessionController` and the forwarded-event carrier), and one probe row
 *   inserted through the home-level patch layer. The probe module is mounted as
 *   the plugin directly — this one file is both the launcher and the in-process
 *   plugin, selected by an environment variable the launcher sets on its child.
 *   The child is a scratch `web` server on an OS-assigned port; the live
 *   harness home, profile and `dsh web` process are never read or written.
 *
 * INPUTS
 *   --profile <name>   Scratch profile name. Default `chatbridgeprobe`.
 *   --bundles <csv>    Bundle list for the scratch profile. Default
 *                      `@deepseek-ai/dsh-base,@deepseek-ai/dsh-web-app`.
 *   --timeout <ms>     Wall-clock ceiling for the whole child run. Default
 *                      600000; a timeout is reported as a failure naming the
 *                      step that was still open.
 *   --attempts <n>     Model-compliance attempts per tool-call measurement.
 *                      Default 2.
 *   --out <path>       Write the evidence bundle to this file. Default: a
 *                      uniquely named file under the system temp directory.
 *   --keep             Leave the scratch home on disk and print its path.
 *   --json             Print one JSON object instead of the human report.
 *   Environment: DSH_BIN overrides the launcher; DSH_CREDENTIALS overrides the
 *   credential source. The child is always spawned with DSH_PERMISSION_MODE
 *   forced to `workspace-write` so the approval policy under measurement is
 *   `ask`, and with DSH_TOOLS_MODE removed so the model sees native tool
 *   schemas.
 *
 * OUTPUTS
 *   One JSON evidence object (stdout with `--json`, always written to `--out`
 *   or a temp file) with `.p1` … `.p5`, `.gaps`, `.checks` and `.passed`. Exit 0
 *   only when every recorded check passed and the evidence file exists; 1
 *   otherwise, naming the plugin phase that stalled. The facts are read from
 *   the request events the harness dispatched, from the durable session events
 *   the harness appended, and from the gateway's own state — never from the
 *   model's prose. A model that paraphrases a tool result cannot change what
 *   the probe reports. Credential material is never printed or copied anywhere
 *   but the scratch home.
 *
 * KEYWORDS
 *   chat bridge, user-questions, ask_user_question, approval, unavailable,
 *   session/follow, assistant-stream, sessionController.prompt, steer,
 *   hasLiveClient, typert gateway, remote mux, probe, scratch profile
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No credentials file: exits 1 naming every path tried, before any spawn.
 *   - Child exits before the plugin reports: the exit code and the last stderr
 *     lines are reported with the last recorded phase, because a boot failure
 *     is a finding.
 *   - No terminal answerer: recorded as a gap rather than smoothed over. When
 *     `@deepseek-ai/dsh-api-remotes` is mounted (it is, in the web bundle) an
 *     Agent-scoped waterfall is forwarded to the Remote event stream and, with
 *     no client attached, never settles: the probe measures that parking
 *     explicitly instead of pretending the built-in terminal was reached. The
 *     terminal itself is measured by a direct unscoped dispatch, where the
 *     Remote forwarder declines and the real built-in callback runs.
 *   - Model never calls the projected tool: retried up to `--attempts`, then
 *     reported as an explicit failure rather than a pass, because "the model
 *     did not exercise it" is not evidence that the API works.
 *   - Timed-out child: killed, the open phase is named, and the exit is 1.
 *   - `--keep` on a failing run: the home is preserved so the session log can
 *     be read after the fact.
 */

import { spawn } from 'node:child_process'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Provider route the probe initializes. The Flash-only policy is a hard rule. */
const PROVIDER = 'deepseek-official'
/** Model the probe initializes. Flash-class by policy; a pro id must never appear here. */
const MODEL = 'deepseek-flash'
/** Session the plugin creates and drives. A fresh scratch home keeps it unique. */
const SESSION_ID = 'chat-bridge-probe'
/** Env flag the launcher sets on its child to make this module behave as a plugin. */
const PLUGIN_FLAG = 'DSH_CHAT_BRIDGE_PLUGIN'

/** Marker the model must echo for the in-process prompt measurement. */
const P4_MARKER = 'BRIDGE-P4-OK'
/** Marker the model must echo for the steered supplementary instruction. */
const STEER_MARKER = 'BRIDGE-STEER-OK'

/**
 * The four model turns that must call a projected tool, written as literal
 * instructions so compliance is a measurement of the API and not of the
 * model's imagination.
 */
const PROMPTS = {
  p1Parked: [
    'Call the tool `ask_user_question` exactly once with exactly these arguments:',
    '{"questions":[{"id":"colour","header":"Colour","question":"Which colour should the probe session use?","options":[{"label":"Red","description":"Use red."},{"label":"Blue","description":"Use blue."}]}]}',
    'Do not call any other tool. After the tool call finishes, reply with the single word DONE.',
  ].join('\n'),
  p1Claim: [
    'You must call the tool `ask_user_question` now, exactly once, with exactly these arguments:',
    '{"questions":[{"id":"size","header":"Size","question":"Which size should the probe session use?","options":[{"label":"Small","description":"Use the small size."},{"label":"Large","description":"Use the large size."}]}]}',
    'Do not call any other tool. After the tool call finishes, reply with the single word DONE.',
  ].join('\n'),
  p2Parked: [
    'Call the tool `bash` exactly once with exactly these arguments and no others:',
    '{"command":"echo approval-probe","sandbox_permissions":"danger-full-access","justification":"the chat bridge probe measures the approval channel"}',
    'Do not call any other tool. After the tool call finishes, reply with the single word DONE.',
  ].join('\n'),
  p2Rejected: [
    'You must call the tool `bash` now, exactly once, with exactly these arguments and no others:',
    '{"command":"echo approval-probe-2","sandbox_permissions":"danger-full-access","justification":"the chat bridge probe measures the approval channel again"}',
    'Do not call any other tool. After the tool call finishes, reply with the single word DONE.',
  ].join('\n'),
  p4: `Reply with exactly ${P4_MARKER} and nothing else.`,
  p4Steer: 'Also append the line BRIDGE-STEER-OK.',
}

/* ------------------------------------------------------------------ *
 * Plugin half. Exports are read by the Cordis loader in the child.   *
 * ------------------------------------------------------------------ */

/** Cordis plugin name; also the row id the scratch home targets. */
export const name = 'chat-bridge-probe'

/**
 * Services requested before `apply` runs.
 *
 * `tools` only. Every other service the probe needs is resolved lazily with
 * `ctx.get` after a bounded wait, so a composition that lacks
 * `sessionController` or `typertGateway` still boots the probe and records the
 * absence as a gap instead of failing the whole plugin tree.
 */
export const inject = ['tools']

/** Milliseconds to wait for an optional service to activate before calling it absent. */
const SERVICE_WAIT_MS = 60000

/** Sleep for a fixed interval. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Describe a value as lossless JSON without following live objects.
 *
 * The request events carry a live `Agent` and an `AbortSignal`; a plain
 * `JSON.stringify` throws on the first cycle. This projection keeps every
 * primitive field, names live objects by identity, and truncates depth so the
 * dump is stable evidence rather than a serialization of the whole runtime.
 *
 * @param value - Any value seen on a dispatched request.
 * @param depth - Current recursion depth (internal).
 * @returns A JSON-safe projection. Never throws.
 */
function jsonSafe(value, depth = 0) {
  if (value === null) return null
  const kind = typeof value
  if (kind === 'string' || kind === 'number' || kind === 'boolean') return value
  if (kind === 'undefined') return { __undefined: true }
  if (kind === 'bigint') return { __bigint: String(value) }
  if (kind === 'function') return { __function: value.name === '' ? '(anonymous)' : value.name }
  if (kind === 'symbol') return { __symbol: String(value) }
  if (depth >= 4) return { __truncated: Object.prototype.toString.call(value) }
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => jsonSafe(entry, depth + 1))
  if (value instanceof AbortSignal) return { __abortSignal: { aborted: value.aborted } }
  if (value instanceof Error) {
    return {
      __error: {
        name: value.name,
        message: value.message,
        code: typeof value.code === 'string' ? value.code : null,
      },
    }
  }
  if (value instanceof Map) return { __map: [...value.entries()].slice(0, 20).map(([k, v]) => [jsonSafe(k, depth + 1), jsonSafe(v, depth + 1)]) }
  if (value instanceof Set) return { __set: [...value].slice(0, 20).map((entry) => jsonSafe(entry, depth + 1)) }
  if (typeof value.id === 'string' && value.session !== undefined) {
    return { __agent: { id: value.id, status: typeof value.status === 'string' ? value.status : null } }
  }
  const out = {}
  let count = 0
  for (const key of Object.keys(value)) {
    if (count >= 40) {
      out.__moreKeys = true
      break
    }
    count += 1
    out[key] = jsonSafe(value[key], depth + 1)
  }
  if (count === 0) out.__type = Object.prototype.toString.call(value)
  return out
}

/** Describe one property by type only, so the field list stays readable. */
function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (value instanceof AbortSignal) return 'AbortSignal'
  return typeof value
}

/**
 * Dump a dispatched event as evidence: the exact own key list, each key's
 * runtime type, and a JSON-safe projection of every field.
 *
 * @param request - The event object a waterfall delivered.
 * @returns `{ ownKeys, types, json }`.
 */
function dumpEvent(request) {
  const keys = Reflect.ownKeys(request).filter((key) => typeof key === 'string').sort()
  const types = {}
  for (const key of keys) types[key] = typeOf(request[key])
  return { ownKeys: keys, types, json: jsonSafe(request) }
}

/** Record one throwable as a comparable shape. */
function dumpError(error) {
  return {
    name: typeof error?.name === 'string' ? error.name : typeof error,
    message: typeof error?.message === 'string' ? error.message : String(error),
    code: typeof error?.code === 'string' ? error.code : null,
  }
}

/** Concatenate the text blocks of one message, skipping non-text blocks. */
function messageText(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  return content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('')
}

/** Index tool calls by id and pair them with their results. */
function toolResultsOf(events) {
  const calls = new Map()
  const results = []
  for (const event of events) {
    if (event?.type === 'tool/call' && typeof event.data?.callId === 'string') calls.set(event.data.callId, event.data.name)
    if (event?.type === 'tool/result') {
      for (const block of event.data?.message?.content ?? []) {
        results.push({
          name: calls.get(block?.toolCallId) ?? null,
          callId: block?.toolCallId ?? null,
          isError: block?.isError === true,
          text: Array.isArray(block?.content)
            ? block.content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
            : '',
        })
      }
    }
  }
  return results
}

/** Assistant text blocks, in order, with the durable seq they committed at. */
function assistantTextsOf(events) {
  return events
    .filter((event) => event?.type === 'assistant/message')
    .map((event) => ({ seq: event.seq, text: messageText(event.data?.message) }))
}

/** The durable events appended after a recorded watermark. */
function eventsSince(ctx, sessionId, watermark) {
  const session = ctx.get('sessions')?.get(sessionId)
  if (session === undefined) return []
  return session.snapshotEvents().filter((event) => event.seq > watermark)
}

/** The session's current durable seq, or 0 while the session is unknown. */
function sessionSeq(ctx, sessionId) {
  return ctx.get('sessions')?.get(sessionId)?.seq ?? 0
}

/**
 * Poll a predicate until it yields a truthy value or the deadline passes.
 *
 * @returns The predicate's value.
 * @throws When the deadline passes; the message names the caller's label.
 */
async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(100)
  }
  throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms${lastError === null ? '' : `: ${String(lastError)}`}`)
}

/** Bound a promise with a wall-clock race, reporting `pending` instead of hanging. */
async function raceWithTimeout(promise, timeoutMs) {
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'pending', elapsedMs: timeoutMs }), timeoutMs)
  })
  const settled = promise.then(
    (value) => ({ kind: 'resolved', value: jsonSafe(value) }),
    (error) => ({ kind: 'rejected', error: dumpError(error) }),
  )
  try {
    return await Promise.race([settled, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The plugin body: run the five measurements and write the evidence file.
 *
 * Every phase appends one NDJSON progress record before and after its work, so
 * the launcher can name the phase that stalled without depending on stdout,
 * which the web app owns for its URL line.
 *
 * @param ctx - Root plugin context.
 */
export function apply(ctx) {
  const progressFile = process.env.DSH_CHAT_BRIDGE_PROGRESS ?? ''
  const evidenceFile = process.env.DSH_CHAT_BRIDGE_EVIDENCE ?? ''
  const turnTimeoutMs = Number(process.env.DSH_CHAT_BRIDGE_TURN_TIMEOUT ?? '120000')
  const attempts = Math.max(1, Number(process.env.DSH_CHAT_BRIDGE_ATTEMPTS ?? '2'))
  const parkObserveMs = Number(process.env.DSH_CHAT_BRIDGE_PARK_OBSERVE_MS ?? '5000')

  const evidence = {
    probe: 'chat-bridge',
    mode: 'plugin',
    provider: PROVIDER,
    model: MODEL,
    sessionId: SESSION_ID,
    workspace: process.cwd(),
    startedAt: new Date().toISOString(),
    harnessVersion: process.env.DSH_CHAT_BRIDGE_VERSION ?? null,
    p1: { requests: [], terminals: [], parked: null, directTerminal: null, claim: null },
    p2: { requests: [], parked: null, policy: null, claim: null },
    p3: {},
    p4: {},
    p5: { transitions: [], baseline: null, inProcess: null },
    checks: {},
    gaps: [],
    phases: [],
  }
  const check = (id, claim, pass, note) => {
    evidence.checks[id] = { claim, pass: Boolean(pass), note: String(note) }
  }
  const gap = (id, detail) => evidence.gaps.push({ id, detail: String(detail) })
  const progress = (phase, status, detail = '') => {
    evidence.phases.push({ at: Date.now(), phase, status, detail: String(detail) })
    if (progressFile !== '') {
      try {
        appendFileSync(progressFile, `${JSON.stringify({ t: Date.now(), phase, status, detail: String(detail) })}\n`)
      } catch {
        // A progress write must never take the measurement down.
      }
    }
  }

  const listener = { mode: 'idle', answerReturned: null }

  // The question answerer. Registered prepended so the probe observes every
  // request before any other answerer and decides whether to claim it.
  ctx.on(
    'user-questions/request',
    async (request, next) => {
      const record = { at: Date.now(), mode: listener.mode, ...dumpEvent(request) }
      evidence.p1.requests.push(record)
      if (listener.mode === 'claim') {
        const question = Array.isArray(request?.questions) ? request.questions[0] : undefined
        const answer = {
          answers: [
            {
              id: question?.id ?? 'unknown',
              ...(Array.isArray(question?.options) && question.options.length > 0
                ? { selected: [question.options[0].label] }
                : { selected: [], custom: 'probe-answer' }),
            },
          ],
        }
        listener.answerReturned = { answer, requestAt: record.at }
        return answer
      }
      if (listener.mode === 'observe-parked') {
        const outcome = await raceWithTimeout(next(), parkObserveMs)
        evidence.p1.parked = { requestAt: record.at, outcome }
        throw new Error(
          outcome.kind === 'pending'
            ? `probe: no answerer claimed the question within ${parkObserveMs}ms (the downstream chain never settled)`
            : 'probe: downstream claimed the question',
        )
      }
      if (listener.mode === 'decline') {
        return next()
      }
      return next()
    },
    { prepend: true },
  )

  // The approval answerer, same shape.
  ctx.on(
    'approval/request',
    async (request, next) => {
      const record = { at: Date.now(), mode: listener.mode, ...dumpEvent(request) }
      evidence.p2.requests.push(record)
      if (listener.mode === 'claim-rejected') {
        listener.answerReturned = { outcome: 'rejected', requestAt: record.at }
        return 'rejected'
      }
      if (listener.mode === 'observe-parked') {
        const outcome = await raceWithTimeout(next(), parkObserveMs)
        evidence.p2.parked = { requestAt: record.at, outcome }
        throw new Error(
          outcome.kind === 'pending'
            ? `probe: no answerer claimed the approval within ${parkObserveMs}ms (the downstream chain never settled)`
            : 'probe: downstream claimed the approval',
        )
      }
      return next()
    },
    { prepend: true },
  )

  void runProbe(ctx).catch((error) => {
    progress('fatal', 'fail', String(error?.stack ?? error))
    evidence.fatal = String(error?.stack ?? error)
    evidence.finishedAt = new Date().toISOString()
    try {
      if (evidenceFile !== '') writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`)
    } catch {
      // Nothing left to report with.
    }
    process.exit(3)
  })

  /**
   * Drive the measurements to completion, then write evidence and exit.
   *
   * @param root - Root plugin context.
   */
  async function runProbe(root) {
    const sessionController = await waitFor(() => root.get('sessionController'), SERVICE_WAIT_MS, 'sessionController').catch(
      () => undefined,
    )
    const typertGateway = await waitFor(() => root.get('typertGateway'), 10000, 'typertGateway').catch(() => undefined)
    const approval = await waitFor(() => root.get('approval'), 10000, 'approval').catch(() => undefined)
    const userQuestions = await waitFor(() => root.get('userQuestions'), 10000, 'userQuestions').catch(() => undefined)
    evidence.services = {
      sessionController: sessionController !== undefined,
      typertGateway: typertGateway !== undefined,
      approval: approval !== undefined,
      userQuestions: userQuestions !== undefined,
      sessionQuery: root.get('sessionQuery') !== undefined,
    }

    // The Session Remote methods take a caller cancellation signal as their
    // second argument and touch it synchronously; an in-process caller must
    // supply one, exactly as the wire carrier does.
    const callSignal = new AbortController().signal

    /* ---------------- P5: baseline and live-client transitions ---------------- */
    progress('p5-baseline', 'start')
    if (typertGateway === undefined) {
      gap('p5.typert_gateway', 'ctx.typertGateway did not activate within 10s; hasLiveClient() is unmeasurable')
      check('p5.baseline_false_without_client', 'hasLiveClient() reports false with no client attached', false, 'typertGateway absent')
    } else {
      evidence.p5.baseline = typertGateway.hasLiveClient()
      check(
        'p5.baseline_false_without_client',
        'hasLiveClient() reports false on a freshly booted harness with no client attached',
        evidence.p5.baseline === false,
        `hasLiveClient()=${String(evidence.p5.baseline)}`,
      )
    }
    const p5Start = Date.now()
    let p5Last = evidence.p5.baseline
    const p5Timer = setInterval(() => {
      if (typertGateway === undefined) return
      const value = typertGateway.hasLiveClient()
      if (value !== p5Last) {
        p5Last = value
        evidence.p5.transitions.push({ t: Date.now(), value, sinceStartMs: Date.now() - p5Start })
      }
    }, 120)
    progress('p5-baseline', 'ok', `hasLiveClient=${String(evidence.p5.baseline)}`)

    /* ---------------- P3 + P4: session, follow, in-process prompt ---------------- */
    if (sessionController === undefined) {
      gap('p3.session_controller', 'ctx.sessionController did not activate within 60s; in-process follow and prompt are unmeasurable')
      gap('p4.session_controller', 'ctx.sessionController did not activate within 60s; in-process prompt is unmeasurable')
    } else {
      progress('p4-create', 'start')
      let created = null
      try {
        created = await sessionController.create({ sessionId: SESSION_ID, cwd: process.cwd() })
        evidence.p4.create = { call: 'ctx.sessionController.create({sessionId, cwd})', result: jsonSafe(created) }
        check('p4.session_created', 'sessionController.create opens a session in-process with no carrier', created?.sessionId === SESSION_ID, `result=${JSON.stringify(jsonSafe(created))}`)
      } catch (error) {
        evidence.p4.create = { call: 'ctx.sessionController.create({sessionId, cwd})', error: dumpError(error) }
        check('p4.session_created', 'sessionController.create opens a session in-process with no carrier', false, `threw ${JSON.stringify(dumpError(error))}`)
      }
      progress('p4-create', created === null ? 'fail' : 'ok')

      if (created !== null) {
        progress('p3-follow-open', 'start')
        const followAbort = new AbortController()
        const followRequest = { address: { kind: 'session', sessionId: SESSION_ID }, assistantStream: true }
        const follow = {
          call: 'ctx.sessionController.follow(request, signal)',
          frames: [],
          eventTypes: {},
          assistantStreamFrames: { start: 0, chunk: 0, end: 0 },
          firstFrameType: null,
          snapshot: null,
          openedAt: null,
          firstFrameAt: null,
          completedPromptsWhileOpen: 0,
        }
        follow.request = { address: followRequest.address, assistantStream: true }
        try {
          const iterator = sessionController.follow(followRequest, followAbort.signal)
          follow.openedAt = Date.now()
          void (async () => {
            try {
              for await (const frame of iterator) {
                if (follow.firstFrameAt === null) follow.firstFrameAt = Date.now()
                if (follow.firstFrameType === null) follow.firstFrameType = frame?.type ?? null
                const kind = frame?.type === 'assistant-stream' ? 'assistant-stream' : frame?.type === 'snapshot' ? 'snapshot' : 'event'
                follow.frames.push(kind)
                if (kind === 'snapshot') {
                  follow.snapshot = {
                    headerKeys: frame.header === undefined ? [] : Object.keys(frame.header).sort(),
                    cursor: frame.cursor,
                    recordCount: Array.isArray(frame.records) ? frame.records.length : null,
                    hasMore: frame.hasMore,
                    projectionKeys: frame.projections === undefined ? [] : Object.keys(frame.projections),
                    assistantStreamBaseline: jsonSafe(frame.assistantStream),
                  }
                } else if (kind === 'assistant-stream') {
                  const sub = frame.frame?.type
                  if (sub === 'start' || sub === 'chunk' || sub === 'end') follow.assistantStreamFrames[sub] += 1
                  if (follow.assistantStreamSample === undefined && sub === 'start') follow.assistantStreamSample = jsonSafe(frame.frame)
                } else {
                  follow.eventTypes[frame.type] = (follow.eventTypes[frame.type] ?? 0) + 1
                }
              }
              follow.endedAt = Date.now()
            } catch (error) {
              follow.consumerError = dumpError(error)
            }
          })()
          check(
            'p3.follow_opened_in_process',
            'sessionController.follow opens and yields frames from a plugin with no browser carrier',
            await waitFor(() => follow.firstFrameType !== null, 30000, 'first follow frame').then(() => true).catch(() => false),
            `firstFrameType=${JSON.stringify(follow.firstFrameType)}`,
          )
          await sleep(200)
          check(
            'p3.snapshot_arrives_first',
            'the follow stream opens with a snapshot frame before any live frame',
            follow.firstFrameType === 'snapshot',
            `firstFrameType=${JSON.stringify(follow.firstFrameType)}, frameCounts=${JSON.stringify(countFrames(follow.frames))}`,
          )
        } catch (error) {
          follow.openError = dumpError(error)
          check('p3.follow_opened_in_process', 'sessionController.follow opens and yields frames from a plugin', false, `threw ${JSON.stringify(dumpError(error))}`)
          check('p3.snapshot_arrives_first', 'the follow stream opens with a snapshot frame', false, 'the stream never opened')
        }
        evidence.p3 = follow
        progress('p3-follow-open', follow.openError === undefined ? 'ok' : 'fail')

        /* P4: prompt in-process and confirm the model answers. */
        progress('p4-prompt', 'start')
        const p4Before = sessionSeq(root, SESSION_ID)
        let p4Prompt = null
        try {
          const requestId = `probe-queue-${Date.now()}`
          const receipt = await sessionController.prompt(
            {
              requestId,
              sessionId: SESSION_ID,
              mode: 'queue',
              content: [{ type: 'text', text: PROMPTS.p4 }],
            },
            callSignal,
          )
          p4Prompt = { call: 'ctx.sessionController.prompt({requestId, sessionId, mode:"queue", content:[{type:"text",text}]})', requestId, receipt: jsonSafe(receipt) }
          check('p4.prompt_accepted', 'sessionController.prompt accepts a queued user turn in-process', receipt?.accepted === true, `receipt=${JSON.stringify(jsonSafe(receipt))}`)
        } catch (error) {
          p4Prompt = { call: 'ctx.sessionController.prompt(...)', error: dumpError(error) }
          check('p4.prompt_accepted', 'sessionController.prompt accepts a queued user turn in-process', false, `threw ${JSON.stringify(dumpError(error))}`)
        }
        evidence.p4.prompt = p4Prompt
        if (p4Prompt?.receipt !== undefined) {
          const turn = await waitForTurn(root, SESSION_ID, p4Before, turnTimeoutMs).catch((error) => ({ error: String(error) }))
          const texts = assistantTextsOf(turn.events ?? [])
          const matched = texts.find((entry) => entry.text.includes(P4_MARKER)) ?? null
          evidence.p4.turn = { timedOut: turn.error !== undefined, assistantTexts: texts, eventTypes: countFrames((turn.events ?? []).map((event) => event.type)) }
          if (follow.openedAt !== null && turn.events !== undefined) follow.completedPromptsWhileOpen += 1
          check(
            'p4.model_responded_in_process',
            `the model answers a prompt injected with no SDK stdio transport (looking for ${P4_MARKER})`,
            matched !== null,
            turn.error !== undefined ? `turn did not settle: ${turn.error}` : `assistant texts=${JSON.stringify(texts.map((entry) => entry.text.slice(0, 120)))}`,
          )
          progress('p4-prompt', matched !== null ? 'ok' : 'fail')
        } else {
          check('p4.model_responded_in_process', `the model answers a prompt injected with no SDK stdio transport`, false, 'the prompt was never accepted')
          progress('p4-prompt', 'fail')
        }

        /* P4 steer: accepted while a turn runs, or what happened instead. */
        progress('p4-steer', 'start')
        const steerBefore = sessionSeq(root, SESSION_ID)
        let steer = { call: 'ctx.sessionController.prompt({mode:"steer"})' }
        try {
          const baseReceipt = await sessionController.prompt(
            {
              requestId: `probe-steer-base-${Date.now()}`,
              sessionId: SESSION_ID,
              mode: 'queue',
              content: [{ type: 'text', text: `Reply with exactly ${P4_MARKER} and nothing else.` }],
            },
            callSignal,
          )
          steer.baseReceipt = jsonSafe(baseReceipt)
          const running = await waitFor(() => root.get('agents')?.get(SESSION_ID)?.status === 'running', 15000, 'agent running')
            .then(() => true)
            .catch(() => false)
          steer.runningAtSteer = running
          const receipt = await sessionController.prompt(
            {
              requestId: `probe-steer-${Date.now()}`,
              sessionId: SESSION_ID,
              mode: 'steer',
              content: [{ type: 'text', text: PROMPTS.p4Steer }],
            },
            callSignal,
          )
          steer.receipt = jsonSafe(receipt)
          check('p4.steer_accepted', "sessionController.prompt accepts mode:'steer'", receipt?.accepted === true, `runningAtSteer=${String(running)} receipt=${JSON.stringify(jsonSafe(receipt))}`)
        } catch (error) {
          steer.error = dumpError(error)
          check('p4.steer_accepted', "sessionController.prompt accepts mode:'steer'", false, `threw ${JSON.stringify(dumpError(error))}`)
        }
        const steerTurn = await waitForTurn(root, SESSION_ID, steerBefore, turnTimeoutMs).catch((error) => ({ error: String(error) }))
        steer.assistantTexts = assistantTextsOf(steerTurn.events ?? [])
        steer.steerMarkerObserved = steer.assistantTexts.some((entry) => entry.text.includes(STEER_MARKER))
        evidence.p4.steer = steer
        progress('p4-steer', steer.error === undefined ? 'ok' : 'fail')
      }
    }

    /* ---------------- P1: question request shape and terminals ---------------- */
    if (userQuestions === undefined || sessionController === undefined) {
      gap('p1.user_questions', 'ctx.userQuestions or ctx.sessionController was absent; the ask_user_question measurements are unmeasurable')
    } else {
      progress('p1-real-call', 'start')
      let realCall = null
      for (let attempt = 1; attempt <= attempts && realCall === null; attempt += 1) {
        listener.mode = 'observe-parked'
        const requestsMark = evidence.p1.requests.length
        const before = sessionSeq(root, SESSION_ID)
        await sessionController
          .prompt({ requestId: `probe-p1-${attempt}-${Date.now()}`, sessionId: SESSION_ID, mode: 'queue', content: [{ type: 'text', text: PROMPTS.p1Parked }] }, callSignal)
          .catch((error) => {
            evidence.p1.promptError = dumpError(error)
            return null
          })
        const turn = await waitForTurn(root, SESSION_ID, before, turnTimeoutMs).catch((error) => ({ error: String(error), events: [] }))
        const requests = evidence.p1.requests.slice(requestsMark)
        const results = toolResultsOf(turn.events ?? []).filter((entry) => entry.name === 'ask_user_question')
        if (requests.length > 0) {
          realCall = {
            attempt,
            request: requests[0],
            parked: evidence.p1.parked,
            toolResults: results,
            assistantTexts: assistantTextsOf(turn.events ?? []),
          }
        }
      }
      evidence.p1.realCall = realCall
      check(
        'p1.request_shape_captured',
        'a real ask_user_question tool call reaches the user-questions/request waterfall and its full event is captured',
        realCall !== null,
        realCall === null
          ? `the model never invoked ask_user_question across ${attempts} attempt(s)`
          : `ownKeys=${JSON.stringify(realCall.request.ownKeys)}`,
      )
      if (realCall !== null) {
        check(
          'p1.no_client_downstream_parked',
          'with api-remotes mounted and no client attached, the downstream answerer chain does not settle within the observation window',
          realCall.parked?.outcome?.kind === 'pending',
          `downstream=${JSON.stringify(realCall.parked?.outcome ?? null)}; toolResult=${JSON.stringify(realCall.toolResults.map((entry) => ({ isError: entry.isError, text: entry.text.slice(0, 200) })))}`,
        )
      }
      progress('p1-real-call', realCall !== null ? 'ok' : 'fail')

      /* The terminal itself: an unscoped dispatch, where the Remote forwarder declines. */
      progress('p1-terminal', 'start')
      listener.mode = 'decline'
      try {
        const value = await userQuestions.ask({
          questions: [{ id: 'terminal', question: 'Does the built-in terminal answer?', options: [{ label: 'Yes' }, { label: 'No' }] }],
        })
        evidence.p1.directTerminal = { kind: 'resolved', value: jsonSafe(value) }
      } catch (error) {
        evidence.p1.directTerminal = { kind: 'rejected', error: dumpError(error) }
      }
      check(
        'p1.terminal_without_answerer_recorded',
        'the waterfall terminal without an answerer is observed as an exact value or throw',
        evidence.p1.directTerminal !== null,
        `terminal=${JSON.stringify(evidence.p1.directTerminal)}`,
      )
      progress('p1-terminal', 'ok')

      /* A claimed request: the probe answers and the tool call completes with it. */
      progress('p1-claim', 'start')
      let claim = null
      for (let attempt = 1; attempt <= attempts && claim === null; attempt += 1) {
        listener.mode = 'claim'
        listener.answerReturned = null
        const before = sessionSeq(root, SESSION_ID)
        await sessionController
          .prompt({ requestId: `probe-p1c-${attempt}-${Date.now()}`, sessionId: SESSION_ID, mode: 'queue', content: [{ type: 'text', text: PROMPTS.p1Claim }] }, callSignal)
          .catch((error) => {
            evidence.p1.promptError = dumpError(error)
            return null
          })
        const turn = await waitForTurn(root, SESSION_ID, before, turnTimeoutMs).catch((error) => ({ error: String(error), events: [] }))
        const results = toolResultsOf(turn.events ?? []).filter((entry) => entry.name === 'ask_user_question')
        const successful = results.find((entry) => entry.isError === false)
        if (successful !== undefined) {
          claim = { attempt, answerReturned: listener.answerReturned, toolResult: successful, allResults: results }
        }
      }
      evidence.p1.claim = claim
      check(
        'p1.claimed_answer_completes_tool_call',
        'an answerer returning a well-formed answer makes the real ask_user_question tool call succeed with that answer',
        claim !== null,
        claim === null
          ? 'no successful ask_user_question tool result was observed'
          : `answer=${JSON.stringify(claim.answerReturned?.answer)} result=${JSON.stringify(claim.toolResult.text.slice(0, 300))}`,
      )
      progress('p1-claim', claim !== null ? 'ok' : 'fail')
    }

    /* ---------------- P2: approval request shape and outcomes ---------------- */
    if (approval === undefined || sessionController === undefined) {
      gap('p2.approval', 'ctx.approval or ctx.sessionController was absent; the approval measurements are unmeasurable')
    } else {
      progress('p2-policy', 'start')
      try {
        const session = root.get('sessions')?.get(SESSION_ID)
        evidence.p2.policy = session === undefined ? null : approval.effectivePolicy(session)
      } catch (error) {
        evidence.p2.policyError = dumpError(error)
      }
      progress('p2-policy', 'ok', `policy=${JSON.stringify(evidence.p2.policy)}`)

      progress('p2-real-call', 'start')
      let realCall = null
      for (let attempt = 1; attempt <= attempts && realCall === null; attempt += 1) {
        listener.mode = 'observe-parked'
        const requestsMark = evidence.p2.requests.length
        const before = sessionSeq(root, SESSION_ID)
        await sessionController
          .prompt({ requestId: `probe-p2-${attempt}-${Date.now()}`, sessionId: SESSION_ID, mode: 'queue', content: [{ type: 'text', text: PROMPTS.p2Parked }] }, callSignal)
          .catch((error) => {
            evidence.p2.promptError = dumpError(error)
            return null
          })
        const turn = await waitForTurn(root, SESSION_ID, before, turnTimeoutMs).catch((error) => ({ error: String(error), events: [] }))
        const requests = evidence.p2.requests.slice(requestsMark)
        const results = toolResultsOf(turn.events ?? []).filter((entry) => entry.name === 'bash')
        if (requests.length > 0) {
          realCall = { attempt, request: requests[0], parked: evidence.p2.parked, toolResults: results }
        }
      }
      evidence.p2.realCall = realCall
      check(
        'p2.request_shape_captured',
        'a real sandbox-escalation approval reaches the approval/request waterfall and its full event is captured',
        realCall !== null,
        realCall === null
          ? `the model never requested sandbox escalation across ${attempts} attempt(s) (policy=${JSON.stringify(evidence.p2.policy)})`
          : `ownKeys=${JSON.stringify(realCall.request.ownKeys)}`,
      )
      if (realCall !== null) {
        check(
          'p2.no_client_downstream_parked',
          'with api-remotes mounted and no client attached, the approval waterfall does not settle within the observation window',
          realCall.parked?.outcome?.kind === 'pending',
          `downstream=${JSON.stringify(realCall.parked?.outcome ?? null)}; toolResult=${JSON.stringify(realCall.toolResults.map((entry) => ({ isError: entry.isError, text: entry.text.slice(0, 240) })))}`,
        )
      }
      progress('p2-real-call', realCall !== null ? 'ok' : 'fail')

      progress('p2-claim', 'start')
      let claim = null
      for (let attempt = 1; attempt <= attempts && claim === null; attempt += 1) {
        listener.mode = 'claim-rejected'
        listener.answerReturned = null
        const before = sessionSeq(root, SESSION_ID)
        await sessionController
          .prompt({ requestId: `probe-p2r-${attempt}-${Date.now()}`, sessionId: SESSION_ID, mode: 'queue', content: [{ type: 'text', text: PROMPTS.p2Rejected }] }, callSignal)
          .catch((error) => {
            evidence.p2.promptError = dumpError(error)
            return null
          })
        const turn = await waitForTurn(root, SESSION_ID, before, turnTimeoutMs).catch((error) => ({ error: String(error), events: [] }))
        const results = toolResultsOf(turn.events ?? []).filter((entry) => entry.name === 'bash')
        const refused = results.find((entry) => entry.isError === true)
        if (refused !== undefined) claim = { attempt, outcomeReturned: listener.answerReturned, toolResult: refused, allResults: results }
      }
      evidence.p2.claim = claim
      check(
        'p2.claimed_rejection_refuses_tool_call',
        "an answerer returning 'rejected' makes the real approval-requiring tool call fail as refused",
        claim !== null,
        claim === null
          ? 'no rejected bash tool result was observed'
          : `outcome=${JSON.stringify(claim.outcomeReturned?.outcome)} result=${JSON.stringify(claim.toolResult.text.slice(0, 300))}`,
      )
      progress('p2-claim', claim !== null ? 'ok' : 'fail')
    }

    /* ---------------- P3 conclusions + P5 in-process stream ---------------- */
    if (evidence.p3 !== undefined && evidence.p3.frames !== undefined) {
      const counts = countFrames(evidence.p3.frames)
      check(
        'p3.durable_events_arrive',
        'durable event frames arrive on the in-process follow stream',
        (counts.event ?? 0) > 0,
        `frameCounts=${JSON.stringify(counts)} eventTypes=${JSON.stringify(evidence.p3.eventTypes)}`,
      )
      check(
        'p3.assistant_stream_frames_arrive',
        'assistant-stream start/chunk/end frames arrive when the follow request opts in',
        evidence.p3.assistantStreamFrames.start > 0 && evidence.p3.assistantStreamFrames.chunk > 0 && evidence.p3.assistantStreamFrames.end > 0,
        `assistantStreamFrames=${JSON.stringify(evidence.p3.assistantStreamFrames)}`,
      )
      check(
        'p3.iterator_does_not_block_plugin',
        'iterating the follow stream concurrently does not block the plugin: other phases complete while it is open',
        evidence.p3.completedPromptsWhileFollowOpen > 0,
        `prompts completed while the iterator was open=${String(evidence.p3.completedPromptsWhileFollowOpen)}`,
      )
    }

    progress('p5-inprocess', 'start')
    if (typertGateway === undefined) {
      gap('p5.in_process_stream', 'ctx.typertGateway was absent; the in-process $events measurement is unmeasurable')
    } else {
      const before = evidence.p5.baseline
      const abort = new AbortController()
      try {
        const iterator = typertGateway.openRemoteEvents({ args: {} }, abort.signal)
        const openedAt = Date.now()
        const first = await iterator.next()
        const flipped = typertGateway.hasLiveClient()
        abort.abort(new Error('probe: in-process client disconnects'))
        try {
          while (!(await iterator.next()).done) {
            // drain so the generator's finally block runs
          }
        } catch {
          // the abort reason is the expected end
        }
        const back = await waitFor(() => typertGateway.hasLiveClient() === false, 5000, 'hasLiveClient false after abort')
          .then(() => false)
          .catch(() => typertGateway.hasLiveClient())
        evidence.p5.inProcess = {
          call: 'ctx.typertGateway.openRemoteEvents({args:{}}, signal)',
          readyFrame: jsonSafe(first?.value ?? null),
          baselineBefore: before,
          flippedTrue: flipped,
          backToFalse: back === false,
          openedAt,
        }
        check('p5.in_process_stream_flips_true', 'opening the gateway $events stream flips hasLiveClient() to true', flipped === true, `readyFrame=${JSON.stringify(jsonSafe(first?.value ?? null))}`)
        check('p5.in_process_stream_flips_back', 'aborting the $events stream flips hasLiveClient() back to false', back === false, `hasLiveClient()=${String(back)}`)
      } catch (error) {
        evidence.p5.inProcess = { call: 'ctx.typertGateway.openRemoteEvents({args:{}}, signal)', error: dumpError(error) }
        gap('p5.in_process_stream', `openRemoteEvents threw ${JSON.stringify(dumpError(error))}`)
      }
    }
    progress('p5-inprocess', 'ok')
    clearInterval(p5Timer)

    progress('done', 'ok')
    evidence.finishedAt = new Date().toISOString()
    evidence.completed = true
    evidence.passed = Object.values(evidence.checks).every((entry) => entry.pass) && Object.keys(evidence.checks).length > 0
    if (evidenceFile !== '') writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`)
    process.exit(0)
  }
}

/** Count occurrences of each value in a list. */
function countFrames(values) {
  const counts = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

/**
 * Wait for one model turn started after a watermark to reach idle.
 *
 * The turn is considered started once a `turn/start` event is appended, and
 * finished once the agent reads `idle` for a short settle window after a
 * `turn/end`; the settle window catches a steered continuation that starts a
 * second turn right after the first.
 *
 * @param ctx - Root plugin context.
 * @param sessionId - Session being driven.
 * @param watermark - Durable seq before the prompt was admitted.
 * @param timeoutMs - Wall-clock ceiling.
 * @returns `{ events, timedOut }`.
 */
async function waitForTurn(ctx, sessionId, watermark, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  await waitFor(() => eventsSince(ctx, sessionId, watermark).some((event) => event.type === 'turn/start'), Math.min(timeoutMs, 30000), 'turn/start')
  let idleSince = null
  while (Date.now() < deadline) {
    const events = eventsSince(ctx, sessionId, watermark)
    const ended = events.some((event) => event.type === 'turn/end')
    const status = ctx.get('agents')?.get(sessionId)?.status
    if (ended && status === 'idle') {
      idleSince ??= Date.now()
      if (Date.now() - idleSince > 800) return { events, timedOut: false }
    } else {
      idleSince = null
    }
    await sleep(120)
  }
  return { events: eventsSince(ctx, sessionId, watermark), timedOut: true }
}

/* ------------------------------------------------------------------ *
 * Launcher half. Runs only in the parent process.                     *
 * ------------------------------------------------------------------ */

if (process.env[PLUGIN_FLAG] !== '1') {
  await main()
}

/**
 * Locate the credential store the scratch home needs.
 *
 * @returns The first existing candidate path, or `null` when none exists.
 */
function credentialsSource() {
  const candidates = [
    process.env.DSH_CREDENTIALS,
    join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '.credentials.yaml'),
    join(homedir(), '.dsh', '.credentials.yaml'),
    join(homedir(), '.npm', 'dsh', '.credentials.yaml'),
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * Resolve the launcher to an executable invocation.
 *
 * @returns `{ command, prefixArgs }` for `spawn`.
 */
function launcher() {
  if (process.env.DSH_BIN) return { command: process.env.DSH_BIN, prefixArgs: [] }
  const candidates = [
    join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(dirname(process.execPath), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ]
  const bin = candidates.find((candidate) => existsSync(candidate))
  if (bin === undefined) {
    process.stderr.write('probe-chat-bridge: cannot locate the dsh launcher; set DSH_BIN.\n')
    process.exit(1)
  }
  return { command: process.execPath, prefixArgs: [bin] }
}

/**
 * Build the scratch home: credentials, a model default, the home-level patch
 * that mounts this file as the probe plugin, and a profile manifest.
 *
 * @param home - Absolute scratch home directory.
 * @param profile - Scratch profile name.
 * @param credentials - Absolute path of the credentials file to copy.
 * @param bundles - Bundle names the scratch profile composes.
 * @returns Absolute path of the scratch workspace the run is opened on.
 */
function buildHome(home, profile, credentials, bundles) {
  const workspace = join(home, 'workspace')
  mkdirSync(workspace, { recursive: true })
  copyFileSync(credentials, join(home, '.credentials.yaml'))
  writeFileSync(
    join(home, 'settings.yaml'),
    ['agent-default-model:', `  provider: ${PROVIDER}`, `  model: ${MODEL}`, ''].join('\n'),
  )
  writeFileSync(
    join(home, 'cordis.patch.yml'),
    [
      '# Scratch probe home. Mounts this probe file as the plugin over whatever profile boots.',
      '- insert:',
      '    - id: chat-bridge-probe',
      `      name: ${JSON.stringify(pathToFileURL(fileURLToPath(import.meta.url)).href)}`,
      '',
    ].join('\n'),
  )
  const profileDir = join(home, 'profiles', profile)
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(
    join(profileDir, 'package.json'),
    `${JSON.stringify(
      {
        name: `dsh-profile-${profile}`,
        private: true,
        dependencies: {},
        dsh: { profile: { bundles } },
      },
      null,
      2,
    )}\n`,
  )
  return workspace
}

/** Parse the probe's own arguments; an unknown flag is a usage error. */
function parseArgs(argv) {
  const options = {
    profile: 'chatbridgeprobe',
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    timeoutMs: 600000,
    attempts: 2,
    keep: false,
    json: false,
    out: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--profile') options.profile = argv[++index] ?? ''
    else if (flag === '--timeout') options.timeoutMs = Number(argv[++index])
    else if (flag === '--attempts') options.attempts = Number(argv[++index])
    else if (flag === '--out') options.out = argv[++index] ?? ''
    else if (flag === '--bundles') {
      options.bundles = (argv[++index] ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    } else if (flag === '--keep') options.keep = true
    else if (flag === '--json') options.json = true
    else {
      process.stderr.write(`probe-chat-bridge: unknown argument ${JSON.stringify(flag)}\n`)
      process.exit(2)
    }
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    process.stderr.write('probe-chat-bridge: --timeout must be a positive number of milliseconds\n')
    process.exit(2)
  }
  return options
}

/** Read the progress NDJSON the plugin wrote, tolerating a partial tail. */
function readProgress(path) {
  if (!existsSync(path)) return []
  const records = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      // A partially flushed tail is not a fact.
    }
  }
  return records
}

/** The phase the run was in when it stopped. */
function stalledPhase(records) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    if (record.status === 'fail') return `${record.phase} (failed): ${record.detail}`
    if (record.status === 'start') return `${record.phase} (never completed)`
  }
  return 'before the first phase'
}

/**
 * Attach one real client to a scratch web server and measure what
 * `hasLiveClient()` does, over the same WebSocket mux route the browser uses.
 *
 * @param url - The authenticated URL the scratch server printed.
 * @param progressPath - Progress NDJSON path the plugin writes.
 * @param timeoutMs - How long to wait for the plugin's baseline reading first.
 * @returns The parent-side observations; never throws.
 */
async function measureRealClient(url, progressPath, timeoutMs) {
  const observation = { url: url.replace(/token=[^&]*/u, 'token=<redacted>'), stages: [] }
  const waitBaselineUntil = Date.now() + timeoutMs
  while (Date.now() < waitBaselineUntil) {
    if (readProgress(progressPath).some((record) => record.phase === 'p5-baseline')) break
    await sleep(200)
  }
  observation.baselineObserved = readProgress(progressPath).some((record) => record.phase === 'p5-baseline')
  let parsed
  try {
    parsed = new URL(url)
  } catch (error) {
    observation.error = `unparseable URL: ${String(error)}`
    return observation
  }
  try {
    // The URL line is printed as the tree settles; retry the token exchange a
    // few times so a server still finishing its listen is not read as a
    // protocol defect.
    let index = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        index = await fetch(url, { redirect: 'manual' })
        break
      } catch (error) {
        observation.tokenExchangeError = String(error?.message ?? error)
        await sleep(500)
      }
    }
    if (index === null) {
      observation.error = `the token exchange never connected: ${String(observation.tokenExchangeError)}`
      return observation
    }
    const cookies = typeof index.headers.getSetCookie === 'function' ? index.headers.getSetCookie() : []
    const rawCookie = cookies[0] ?? index.headers.get('set-cookie') ?? ''
    const cookie = rawCookie.split(';')[0]
    observation.tokenExchange = { status: index.status, cookieReceived: cookie.length > 0 }
    if (cookie.length === 0) {
      observation.error = `the token exchange returned no cookie (status ${String(index.status)})`
      return observation
    }
    const wsUrl = `ws://${parsed.host}/api/remote.mux`
    const socket = new WebSocket(wsUrl, { headers: { Cookie: cookie } })
    const ready = Promise.withResolvers()
    const messages = []
    socket.addEventListener('open', () => {
      observation.openedAt = Date.now()
      socket.send(JSON.stringify({ type: 'open', streamId: 'probe-1', endpoint: '$events', payload: { args: {} } }))
    })
    socket.addEventListener('message', (event) => {
      messages.push(String(event.data).slice(0, 400))
      try {
        const frame = JSON.parse(String(event.data))
        if (frame?.type === 'item' && frame?.value?.type === 'ready') ready.resolve(frame.value)
      } catch {
        // Non-JSON frames are still recorded above.
      }
    })
    socket.addEventListener('error', () => ready.reject(new Error('websocket error')))
    socket.addEventListener('close', (event) => ready.reject(new Error(`websocket closed before the ready frame (code ${String(event.code)})`)))
    observation.readyFrame = await Promise.race([
      ready.promise,
      sleep(15000).then(() => ({ error: 'no $events ready frame within 15s' })),
    ])
    if (observation.readyFrame?.type !== 'ready') {
      observation.error ??= `the mux never delivered a ready frame: ${JSON.stringify(observation.readyFrame)}`
    }
    observation.messages = messages
    await sleep(2000)
    observation.closedAt = Date.now()
    socket.close()
  } catch (error) {
    observation.error = String(error?.message ?? error)
  }
  return observation
}

/** The launcher body: boot the scratch harness, drive it, collect and judge the evidence. */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  const credentials = credentialsSource()
  if (credentials === null) {
    process.stderr.write(
      'probe-chat-bridge: no credentials file found; tried DSH_CREDENTIALS, $DSH_HOME/.credentials.yaml, ~/.dsh/.credentials.yaml, ~/.npm/dsh/.credentials.yaml\n',
    )
    process.exit(1)
  }

  const home = mkdtempSync(join(tmpdir(), 'dsh-chat-bridge-'))
  const workspace = buildHome(home, options.profile, credentials, options.bundles)
  const evidencePath = join(workspace, '.probe', 'evidence.json')
  const progressPath = join(workspace, '.probe', 'progress.ndjson')
  mkdirSync(dirname(evidencePath), { recursive: true })
  writeFileSync(progressPath, '')
  const { command, prefixArgs } = launcher()

  const env = {
    ...process.env,
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
    DSH_PERMISSION_MODE: 'workspace-write',
    [PLUGIN_FLAG]: '1',
    DSH_CHAT_BRIDGE_EVIDENCE: evidencePath,
    DSH_CHAT_BRIDGE_PROGRESS: progressPath,
    DSH_CHAT_BRIDGE_TURN_TIMEOUT: String(Math.max(30000, Math.floor(options.timeoutMs / 4))),
    DSH_CHAT_BRIDGE_ATTEMPTS: String(options.attempts),
  }
  delete env.DSH_TOOLS_MODE

  const started = Date.now()
  const child = spawn(command, [...prefixArgs, '--profile', options.profile, '--no-open', '--port', '0'], {
    cwd: workspace,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  let url = null
  let realClient = null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)

  const attachPromise = Promise.withResolvers()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    const match = /dsh web: (http:\/\/[^\s]+)/u.exec(stdout)
    if (match !== null && url === null) {
      url = match[1]
      void measureRealClient(url, progressPath, 120000)
        .then((observation) => attachPromise.resolve(observation))
        .catch((error) => attachPromise.resolve({ error: String(error) }))
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  const exit = await Promise.race([
    new Promise((resolve) => child.on('exit', (code) => resolve({ code, timedOut: false }))),
    new Promise((resolve) => controller.signal.addEventListener('abort', () => resolve({ code: null, timedOut: true }), { once: true })),
  ])
  clearTimeout(timer)
  if (exit.timedOut) child.kill('SIGKILL')
  if (url === null) {
    realClient = { error: 'the scratch server never printed its URL line' }
  } else {
    realClient = await Promise.race([
      attachPromise.promise,
      sleep(60000).then(() => ({ error: 'the real-client measurement did not finish within 60s of the URL line' })),
    ])
  }

  const progressRecords = readProgress(progressPath)
  let evidence = null
  if (existsSync(evidencePath)) {
    try {
      evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
    } catch (error) {
      evidence = null
      stderr += `\nprobe-chat-bridge: evidence file unreadable: ${String(error)}\n`
    }
  }

  const checks = { ...(evidence?.checks ?? {}) }
  const gaps = [...(evidence?.gaps ?? [])]
  const check = (id, claim, pass, note) => {
    checks[id] = { claim, pass: Boolean(pass), note: String(note) }
  }
  const gap = (id, detail) => gaps.push({ id, detail: String(detail) })

  check('plugin.evidence_written', 'the in-process plugin completed its sequence and wrote its evidence file', evidence !== null, evidence === null ? `no evidence file at ${evidencePath}; last phase ${stalledPhase(progressRecords)}` : `phases=${String(progressRecords.length)}`)
  check(
    'plugin.completed_without_fatal',
    'the in-process plugin reached its final phase without an unhandled failure',
    evidence !== null && evidence.completed === true && evidence.fatal === undefined && progressRecords.some((record) => record.phase === 'done' && record.status === 'ok'),
    evidence === null
      ? `last phase ${stalledPhase(progressRecords)}`
      : `completed=${String(evidence.completed)} fatal=${JSON.stringify(evidence.fatal ?? null)}`,
  )
  if (evidence === null) {
    gap('plugin.incomplete', `the plugin did not complete; last phase ${stalledPhase(progressRecords)}`)
  }
  if (evidence?.fatal !== undefined) {
    gap('plugin.fatal', evidence.fatal)
  }

  // Every fact the composition promises to expose must have been measured. A
  // missing check id is a missing measurement, not a pass: the fatal-run bug
  // this guards against wrote an evidence file whose checks were all true
  // simply because the run stopped before most of them were recorded.
  const expectedChecks = [
    'plugin.evidence_written',
    'plugin.completed_without_fatal',
    'p1.request_shape_captured',
    'p1.no_client_downstream_parked',
    'p1.terminal_without_answerer_recorded',
    'p1.claimed_answer_completes_tool_call',
    'p2.request_shape_captured',
    'p2.no_client_downstream_parked',
    'p2.claimed_rejection_refuses_tool_call',
    'p3.follow_opened_in_process',
    'p3.snapshot_arrives_first',
    'p3.durable_events_arrive',
    'p3.assistant_stream_frames_arrive',
    'p3.iterator_does_not_block_plugin',
    'p4.session_created',
    'p4.prompt_accepted',
    'p4.model_responded_in_process',
    'p4.steer_accepted',
    'p5.baseline_false_without_client',
    'p5.in_process_stream_flips_true',
    'p5.in_process_stream_flips_back',
    'p5.real_client_ready_frame',
    'p5.real_client_flips_true',
    'p5.real_client_flips_back',
  ]

  // P5 real client, judged from the parent's own socket and the plugin's
  // transition log, timestamped on the same machine clock.
  if (realClient === null || realClient.readyFrame === undefined) {
    gap('p5.real_client', `a real client over /api/remote.mux was not measured: ${JSON.stringify(realClient)}`)
  } else {
    const transitions = evidence?.p5?.transitions ?? []
    const openedAt = realClient.openedAt ?? 0
    const closedAt = realClient.closedAt ?? Number.MAX_SAFE_INTEGER
    const toTrue = transitions.find((entry) => entry.value === true && entry.t >= openedAt - 1000 && entry.t <= closedAt + 3000)
    const toFalse = realClient.closedAt === undefined ? undefined : transitions.find((entry) => entry.value === false && entry.t >= realClient.closedAt - 100 && entry.t <= realClient.closedAt + 6000)
    check('p5.real_client_ready_frame', 'a real client over /api/remote.mux receives the $events ready frame', realClient.readyFrame?.type === 'ready', `readyFrame=${JSON.stringify(realClient.readyFrame)}`)
    check(
      'p5.real_client_flips_true',
      'attaching the real client flips hasLiveClient() to true',
      toTrue !== undefined,
      toTrue === undefined ? `no transition to true in [${openedAt - 1000}, ${closedAt + 3000}]; transitions=${JSON.stringify(transitions)}` : `flipped true ${String(toTrue.t - openedAt)} ms after the client opened the mux`,
    )
    check(
      'p5.real_client_flips_back',
      'closing the real client flips hasLiveClient() back to false',
      toFalse !== undefined,
      toFalse === undefined ? `no transition to false after close; transitions=${JSON.stringify(transitions)}` : `flipped false ${String(toFalse.t - closedAt)} ms after the client closed`,
    )
  }

  const missingChecks = expectedChecks.filter((id) => checks[id] === undefined)
  check(
    'plugin.every_fact_measured',
    'every fact this composition promises to expose was measured, not merely the ones reached before a stop',
    missingChecks.length === 0,
    missingChecks.length === 0 ? `all ${String(expectedChecks.length)} expected checks recorded` : `missing: ${JSON.stringify(missingChecks)}`,
  )

  const report = {
    probe: 'chat-bridge',
    generatedAt: new Date().toISOString(),
    harnessVersion: process.env.DSH_CHAT_BRIDGE_VERSION ?? null,
    scratchHome: home,
    profile: options.profile,
    bundles: options.bundles,
    workspace,
    provider: PROVIDER,
    model: MODEL,
    childExit: exit.code,
    timedOut: exit.timedOut,
    elapsedMs: Date.now() - started,
    stdoutUrl: url === null ? null : url.replace(/token=[^&]*/u, 'token=<redacted>'),
    realClient,
    phases: progressRecords,
    stalledPhase: stalledPhase(progressRecords),
    checks,
    gaps,
    passed: false,
    evidence: evidence ?? null,
    stderrTail: stderr.split('\n').slice(-15).filter((line) => line !== ''),
  }
  report.passed =
    Object.values(checks).every((entry) => entry.pass) &&
    Object.keys(checks).length > 0 &&
    evidence !== null

  const outPath = options.out !== null && options.out !== '' ? options.out : join(tmpdir(), `dsh-chat-bridge-evidence-${Date.now()}.json`)
  report.evidenceFile = outPath
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)

  if (!options.keep) rmSync(home, { recursive: true, force: true })

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(`probe-chat-bridge: profile=${options.profile} exit=${String(exit.code)} elapsed=${String(Date.now() - started)}ms\n`)
    process.stdout.write(`  evidence: ${outPath}\n  scratch home: ${home}${options.keep ? ' (kept)' : ' (removed)'}\n\n`)
    for (const [id, entry] of Object.entries(checks)) {
      process.stdout.write(`  [${entry.pass ? 'PASS' : 'FAIL'}] ${id}\n         ${entry.note}\n`)
    }
    if (gaps.length > 0) {
      process.stdout.write('\n  gaps:\n')
      for (const entry of gaps) process.stdout.write(`    - ${entry.id}: ${entry.detail}\n`)
    }
    process.stdout.write(`\n  ${report.passed ? 'chat-bridge probe ok' : `chat-bridge probe FAILED (stalled: ${report.stalledPhase})`}\n`)
  }
  process.exit(report.passed ? 0 : 1)
}
