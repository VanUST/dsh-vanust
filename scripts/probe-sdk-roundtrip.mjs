/**
 * PURPOSE
 *   Measure the one fact a phone-facing chat bridge depends on and that no
 *   reading of a `.d.ts` can settle: whether an out-of-process client can boot
 *   a harness, submit a user turn over the SDK's newline-delimited JSON-RPC
 *   stdio transport, receive the assistant's reply as a streamed session event,
 *   and observe the agent return to idle. A bridge that cannot see the reply
 *   cannot be built at all, so this is measured before anything is designed
 *   against it.
 *
 *   The scaffold is deliberately the cheapest possible deployment: a scratch
 *   home under the system temp directory carrying only a copied credential file,
 *   a profile composing `@deepseek-ai/dsh-base` plus `@deepseek-ai/dsh-sdk-app`,
 *   and no probe plugin at all — the SDK server reserves stdout for protocol
 *   frames, so anything else writing there would corrupt the channel being
 *   measured.
 *
 * INPUTS
 *   --marker <text>   Token the probe asks the model to echo. Default
 *                     `SDKPROBE-OK`, chosen to be absent from any prompt the
 *                     harness assembles on its own, so finding it in the reply
 *                     is evidence of the model's answer and not of scaffolding.
 *   --profile <name>  Scratch profile name. Default `sdkprobe`.
 *   --timeout <ms>    Wall-clock ceiling for the whole round-trip. Default
 *                     180000. The model is the slow part; a timeout is reported
 *                     as a failure naming the step that stalled.
 *   --keep            Leave the scratch home on disk and print its path, for
 *                     inspecting the session log a failing run produced.
 *   --json            Print one JSON object instead of the human report.
 *   Environment: DSH_BIN overrides the launcher. DSH_CREDENTIALS overrides the
 *   credential source.
 *
 * OUTPUTS
 *   Exit 0 only when every asserted fact holds; 1 otherwise, including a failed
 *   boot, a rejected request, or a round-trip that never completes. Prints a
 *   human report, or one JSON object with `--json`. The evidence is read from
 *   the protocol frames the server sent, never from the model's prose: a model
 *   that rephrases the marker fails `assistant_text_matched` rather than passing
 *   on a substring of a tool result. Never prints credential material.
 *
 * KEYWORDS
 *   sdk, json-rpc, ndjson, stdio, round-trip, session/prompt, session.event,
 *   assistant/message, idle, chat bridge, telegram, fetch-api-first, probe,
 *   scratch profile, out-of-process client
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No credentials file: exits 1 naming every path tried, before any spawn. A
 *     probe that ran unauthenticated would report "no reply observed" and be
 *     mistaken for a protocol defect.
 *   - Scratch home already present: removed and rebuilt, so a previous run's
 *     frames can never be read as this run's evidence.
 *   - Child exits before replying: the exit code and the last stderr lines are
 *     reported with the stalled step, because a boot failure is a finding.
 *   - Malformed or unparsable stdout line: counted and skipped, never thrown.
 *     The transport contract says malformed lines are ignored; a probe that
 *     crashed on one would report a harness defect that the protocol does not
 *     have.
 *   - Timeout: the child is killed, the abandoned step is named, and the exit is
 *     1 — a hang is reported as a failure to complete, never smoothed over.
 *   - `--keep` on a failing run: the home is preserved so the sessions directory
 *     can be read after the fact.
 */

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Provider route the probe initializes. The deployment's Flash-only policy is a hard rule. */
const PROVIDER = 'deepseek-official'
/** Model the probe initializes. Flash-class by policy; a pro id must never appear here. */
const MODEL = 'deepseek-flash'
/** Session id the probe prompts. An unknown id lazily creates the agent+session pair. */
const SESSION_ID = 'sdk-roundtrip-probe'

/**
 * Locate the credential store the scratch home needs.
 *
 * Mirrors the resolution the kit's other probes use so a machine that has a home
 * but no exported `DSH_HOME` is not misreported as having no credentials.
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
 * The `dsh` bin is a JavaScript file spawned as `node <bin>` rather than through
 * a shell, so a Windows host does not re-parse the argument vector. The three
 * candidates cover a Windows global install, an npm install beside its own
 * interpreter, and a POSIX global install.
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
    process.stderr.write('probe-sdk-roundtrip: cannot locate the dsh launcher; set DSH_BIN.\n')
    process.exit(1)
  }
  return { command: process.execPath, prefixArgs: [bin] }
}

/**
 * Build the scratch home: credentials, a model default, an SDK profile, and an
 * empty user patch layer.
 *
 * @param home - Absolute scratch home directory.
 * @param profile - Scratch profile name.
 * @param credentials - Absolute path of the credentials file to copy.
 * @returns Absolute path of the scratch working directory the session opens on.
 */
function buildHome(home, profile, credentials) {
  const workspace = join(home, 'workspace')
  mkdirSync(workspace, { recursive: true })
  copyFileSync(credentials, join(home, '.credentials.yaml'))
  writeFileSync(
    join(home, 'settings.yaml'),
    ['agent-default-model:', `  provider: ${PROVIDER}`, `  model: ${MODEL}`, ''].join('\n'),
  )
  // Empty array, not a comment: the profile root parser reads this as a patch
  // list, and a scratch home that mounted a probe plugin here would put its log
  // lines on the stdout this transport owns.
  writeFileSync(join(home, 'cordis.patch.yml'), '[]\n')
  const profileDir = join(home, 'profiles', profile)
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(
    join(profileDir, 'package.json'),
    `${JSON.stringify(
      {
        name: `dsh-profile-${profile}`,
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app'] } },
      },
      null,
      2,
    )}\n`,
  )
  return workspace
}

/**
 * Line-delimited JSON-RPC 2.0 peer over a child's stdio.
 *
 * Requests carry `{jsonrpc, id, method, params}`; a frame with an `id` and no
 * `method` is a response, and one with a `method` and no `id` is a notification.
 * The class only records what arrived, so the report distinguishes "the server
 * never sent it" from "the probe misread it".
 */
class NdjsonPeer {
  constructor(child) {
    this.child = child
    this.buffer = ''
    this.pending = new Map()
    this.notifications = []
    this.malformed = 0
    this.stderr = ''
    this.seq = 0
    this.exit = null
    this.stderrLines = []
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.onData(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      this.stderr += chunk
      // Stderr is the harness's log stream and can be long; the report keeps the
      // tail, which is where a boot failure states its reason.
      this.stderrLines = this.stderr.split('\n').slice(-12)
    })
    child.on('exit', (code) => {
      this.exit = code
      for (const [, entry] of this.pending) entry.reject(new Error(`child exited with code ${String(code)}`))
      this.pending.clear()
    })
  }

  /** Split incoming bytes into frames, dispatching responses and keeping notifications. */
  onData(chunk) {
    this.buffer += chunk
    let at
    while ((at = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, at).trim()
      this.buffer = this.buffer.slice(at + 1)
      if (line === '') continue
      let frame
      try {
        frame = JSON.parse(line)
      } catch {
        this.malformed += 1
        continue
      }
      if (frame.method !== undefined) {
        this.notifications.push({ method: frame.method, params: frame.params })
        continue
      }
      const entry = this.pending.get(frame.id)
      if (entry === undefined) continue
      this.pending.delete(frame.id)
      if (frame.error !== undefined) entry.reject(new Error(`${entry.method}: ${JSON.stringify(frame.error)}`))
      else entry.resolve(frame.result)
    }
  }

  /**
   * Send one request frame.
   *
   * @param method - JSON-RPC method name.
   * @param params - Request parameters object.
   * @param signal - Optional abandonment signal.
   * @returns The result, or a rejection carrying the wire error.
   */
  request(method, params, signal) {
    const id = `probe_${String((this.seq += 1))}`
    const frame = { jsonrpc: '2.0', id, method, params }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id)
        reject(new Error(`${method}: abandoned`))
      }
      if (signal !== undefined) {
        if (signal.aborted) {
          reject(new Error(`${method}: abandoned`))
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      this.pending.set(id, {
        method,
        resolve: (value) => {
          if (signal !== undefined) signal.removeEventListener('abort', onAbort)
          resolve(value)
        },
        reject: (error) => {
          if (signal !== undefined) signal.removeEventListener('abort', onAbort)
          reject(error)
        },
      })
      this.child.stdin.write(`${JSON.stringify(frame)}\n`)
    })
  }

  /** Notifications whose method matches, in arrival order. */
  of(method) {
    return this.notifications.filter((frame) => frame.method === method)
  }
}

/**
 * Extract the text of one `assistant/message` session event.
 *
 * The event is `{type, seq, time, data:{turn, step, message, stream, …}}` and the
 * message is `{role:'assistant', content:[…blocks]}`. Only `text` blocks carry
 * prose; any other block kind is skipped rather than stringified, so a reasoning
 * or tool block can never be mistaken for the model's answer.
 *
 * @param event - One `SessionEvent` envelope from a `session.event` notification.
 * @returns The concatenated text blocks, or `null` when the event has no message.
 */
function assistantText(event) {
  const content = event?.data?.message?.content
  if (!Array.isArray(content)) return null
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

/** Parse the probe's own arguments. */
function parseArgs(argv) {
  const options = { marker: 'SDKPROBE-OK', profile: 'sdkprobe', timeoutMs: 180000, keep: false, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--marker') options.marker = argv[++index]
    else if (arg === '--profile') options.profile = argv[++index]
    else if (arg === '--timeout') options.timeoutMs = Number(argv[++index])
    else if (arg === '--keep') options.keep = true
    else if (arg === '--json') options.json = true
    else {
      process.stderr.write(`probe-sdk-roundtrip: unknown argument ${JSON.stringify(arg)}\n`)
      process.exit(2)
    }
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    process.stderr.write('probe-sdk-roundtrip: --timeout must be a positive number of milliseconds\n')
    process.exit(2)
  }
  return options
}

/**
 * Run the round-trip and collect the assertions.
 *
 * @returns The evidence object, plus the scratch home for cleanup decisions.
 */
async function run() {
  const options = parseArgs(process.argv.slice(2))
  const credentials = credentialsSource()
  if (credentials === null) {
    process.stderr.write(
      'probe-sdk-roundtrip: no credentials file found; tried DSH_CREDENTIALS, $DSH_HOME/.credentials.yaml, ~/.dsh/.credentials.yaml, ~/.npm/dsh/.credentials.yaml\n',
    )
    process.exit(1)
  }

  const home = mkdtempSync(join(tmpdir(), 'dsh-sdk-probe-'))
  const workspace = buildHome(home, options.profile, credentials)
  const { command, prefixArgs } = launcher()
  const log = []
  const step = (name, detail) => log.push({ at: new Date().toISOString(), step: name, detail })

  const child = spawn(command, [...prefixArgs, '--profile', options.profile], {
    cwd: workspace,
    env: { ...process.env, DSH_HOME: home },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const peer = new NdjsonPeer(child)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)

  const evidence = {
    probe: 'sdk-roundtrip',
    scratchHome: home,
    profile: options.profile,
    provider: PROVIDER,
    model: MODEL,
    checks: {},
    notificationMethods: {},
    assistantText: null,
    log,
  }

  const check = (id, claim, pass, note) => {
    evidence.checks[id] = { claim, pass, note }
  }

  try {
    step('initialize', 'sending')
    const initialized = await peer.request(
      'initialize',
      { cwd: workspace, provider: PROVIDER, model: MODEL },
      controller.signal,
    )
    evidence.serverInfo = initialized?.serverInfo ?? null
    check(
      'initialize_handshake',
      'the SDK server boots and completes the initialize handshake',
      typeof initialized?.serverInfo?.name === 'string',
      `serverInfo=${JSON.stringify(initialized?.serverInfo ?? null)}`,
    )

    step('session/prompt', 'sending')
    const prompt = `Reply with exactly ${options.marker} and nothing else.`
    const receipt = await peer.request(
      'session/prompt',
      { sessionId: SESSION_ID, contentBlocks: [{ type: 'text', text: prompt }] },
      controller.signal,
    )
    check(
      'prompt_accepted',
      'session/prompt accepts a user turn and returns an enqueue receipt',
      typeof receipt?.messageId === 'string',
      `messageId=${JSON.stringify(receipt?.messageId ?? null)}`,
    )

    step('await-reply', 'waiting for assistant/message')
    // Poll the recorded notifications rather than racing an event listener: the
    // assertions must read what the server actually sent, and a listener that
    // missed an early frame would report a false negative.
    const deadline = Date.now() + options.timeoutMs
    let reply = null
    let sawIdle = false
    let sawRunning = false
    while (Date.now() < deadline) {
      for (const frame of peer.of('session.event')) {
        const event = frame.params?.event
        if (event?.type !== 'assistant/message') continue
        const text = assistantText(event)
        if (text !== null && text.includes(options.marker)) reply = { text, seq: event.seq }
      }
      for (const frame of peer.of('session.status')) {
        if (frame.params?.status === 'idle') sawIdle = true
        if (frame.params?.status === 'running') sawRunning = true
      }
      if (reply !== null && sawIdle) break
      if (peer.exit !== null) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    evidence.assistantText = reply?.text ?? null
    evidence.notificationMethods = peer.notifications.reduce((counts, frame) => {
      counts[frame.method] = (counts[frame.method] ?? 0) + 1
      return counts
    }, {})
    const eventTypes = [
      ...new Set(
        peer
          .of('session.event')
          .map((frame) => frame.params?.event?.type)
          .filter((type) => typeof type === 'string'),
      ),
    ]
    evidence.sessionEventTypes = eventTypes
    check(
      'assistant_reply_streamed',
      'the assistant reply arrives as a streamed session.event carrying assistant/message',
      reply !== null,
      reply === null ? 'no assistant/message carried the marker before the deadline' : `seq=${String(reply.seq)}`,
    )
    check(
      'idle_status_reported',
      'session.status reports idle, which is the completion signal a chat bridge waits on',
      sawIdle,
      `sawRunning=${String(sawRunning)} sawIdle=${String(sawIdle)}`,
    )

    step('shutdown', 'sending')
    await peer.request('shutdown', {}, controller.signal).catch((error) => step('shutdown', String(error)))
    await new Promise((resolve) => setTimeout(resolve, 500))
    check(
      'shutdown_exits_zero',
      'shutdown disposes the runtime and exits 0',
      peer.exit === 0,
      `exit=${JSON.stringify(peer.exit)}`,
    )
    check(
      'no_malformed_frames',
      'every stdout line the server wrote parsed as a JSON-RPC frame',
      peer.malformed === 0,
      `malformed=${String(peer.malformed)}`,
    )
  } catch (error) {
    step('failure', String(error?.message ?? error))
    for (const id of ['initialize_handshake', 'prompt_accepted', 'assistant_reply_streamed', 'idle_status_reported', 'shutdown_exits_zero']) {
      if (evidence.checks[id] === undefined) {
        evidence.checks[id] = { claim: id, pass: false, note: `not reached: ${String(error?.message ?? error)}` }
      }
    }
  } finally {
    clearTimeout(timer)
    if (peer.exit === null) child.kill('SIGKILL')
    evidence.childExit = peer.exit
    evidence.stderrTail = peer.stderrLines.filter((line) => line !== '')
    if (!options.keep) rmSync(home, { recursive: true, force: true })
  }

  evidence.passed = Object.values(evidence.checks).every((entry) => entry.pass)
  return evidence
}

const report = await run()
if (report.passed) {
  process.stdout.write('sdk round-trip ok (initialize, prompt, assistant reply, idle, shutdown)\n')
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}
if (!report.passed) {
  process.stdout.write('sdk round-trip FAILED\n')
  for (const [id, entry] of Object.entries(report.checks)) {
    process.stdout.write(`  ${entry.pass ? 'ok  ' : 'FAIL'} ${id}: ${entry.note}\n`)
  }
  if (report.assistantText !== null) process.stdout.write(`  assistant text: ${JSON.stringify(report.assistantText)}\n`)
  if (report.stderrTail.length > 0) {
    process.stdout.write('  last stderr lines:\n')
    for (const line of report.stderrTail) process.stdout.write(`    ${line}\n`)
  }
  process.stdout.write(`  scratch home: ${report.scratchHome} (kept: ${process.argv.includes('--keep') ? 'yes' : 'no'})\n`)
}
process.exit(report.passed ? 0 : 1)
