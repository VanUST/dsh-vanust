/**
 * PURPOSE
 *   Prove @cc/dsh-babysitter against the real installed CLI, in order: resolve the
 *   CLIs, show `babysitter --help`'s exit code, run one deterministic process end to
 *   end through genty's internal harness, list the journal it wrote, and show the one
 *   linked taskboard task in `review` with its timeline notes. Then simulate a missing
 *   CLI and prove every tool returns one actionable install message.
 *
 * INPUTS
 *   A globally installed @a5c-ai/babysitter (Node 24), a writable temp directory, and
 *   this checkout's plugins/babysitter and plugins/taskboard modules.
 *
 * OUTPUTS
 *   One block per step on stdout, including the run id, journal path, journal event
 *   list, task id, task status and timeline. Exit 0 only when the end-to-end run
 *   produced journal evidence and the taskboard task really reached `review`.
 *   Exit 1 on the first missing piece, with the reason printed.
 *
 * KEYWORDS
 *   babysitter, genty, selftest, journal, taskboard, proof, headless
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No CLI: prints the install hint and exits 1; it never fakes a pass.
 *   - The process file imports @a5c-ai/babysitter-sdk, so the temp workspace gets a
 *     node_modules symlink to the SDK nested in the global install. This is exactly the
 *     resolution requirement the plugin documents; without it the CLI retries the
 *     import until the timeout.
 *   - The temp workspace is left in place and printed, so the journal and taskboard
 *     files can be inspected after the script exits.
 *   - The CLI-absent step temporarily sets PATH to a nonexistent directory and restores
 *     it in a finally block; it does not touch the real environment.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply as applyBabysitter, normalizeConfig, resolveCli, resolveSdkDir, runCli } from '../plugins/babysitter/babysitter.mjs'
import { apply as applyTaskboard } from '../plugins/taskboard/taskboard.mjs'

const failures = []
let stepNumber = 0

/** Print one numbered step. */
function step(title) {
  stepNumber += 1
  console.log(`\n=== ${stepNumber}. ${title} ===`)
}

/** Record a failed proof without hiding earlier output. */
function fail(reason) {
  failures.push(reason)
  console.log(`FAIL: ${reason}`)
}

/** Print a JSON-safe value under a label. */
function show(label, value) {
  console.log(`${label}: ${JSON.stringify(value, null, 2)}`)
}

/** Build a fake Cordis context that is enough for the two host plugins. */
function fakeContext() {
  const tools = new Map()
  const services = new Map()
  const ctx = {
    logger: {
      info: () => {},
      debug: () => {},
      warn: (...args) => console.error('[warn]', ...args),
    },
    tools: { register: (tool) => tools.set(tool.name, tool) },
    commands: { register: () => {} },
    provide: (serviceName, value) => {
      services.set(serviceName, value)
      return value
    },
    get: (serviceName) => services.get(serviceName),
    effect: (factory) => {
      factory()
      return () => {}
    },
    on: () => {},
    inject: (names, callback) => {
      for (const serviceName of names) {
        if (services.has(serviceName)) {
          callback({ [serviceName]: services.get(serviceName), on: () => {} })
          return
        }
      }
    },
  }
  return { ctx, tools, services }
}

/** Find the SDK package nested inside the global babysitter install. */
function sdkDirOrFail(clis) {
  const sdkDir = resolveSdkDir(clis)
  if (sdkDir === null) {
    fail('could not find @a5c-ai/babysitter-sdk inside the global install; the process file cannot import defineTask')
    return null
  }
  return sdkDir
}

/** One journal file read into `{seq, type, at}`. */
function journalEvent(runDir, file) {
  try {
    const value = JSON.parse(readFileSync(join(runDir, 'journal', file), 'utf8'))
    return { file, seq: Number.parseInt(file.split('.')[0], 10), type: value.type ?? null, at: value.recordedAt ?? null }
  } catch {
    return { file, seq: null, type: null, at: null }
  }
}

async function main() {
  const settings = normalizeConfig({ timeoutMs: 180_000, doctorTimeoutMs: 60_000, maxOutputBytes: 24_000 })

  step('CLI resolved')
  const clis = resolveCli(settings)
  if (clis.error !== undefined) {
    fail(clis.error)
    console.log('\nSELFTEST FAILED: the CLI is not installed.')
    return 1
  }
  show('babysitter', clis.babysitter?.path ?? null)
  show('genty', clis.genty?.path ?? null)
  if (clis.babysitter === null || clis.genty === null) {
    fail('both babysitter and genty must resolve for the end-to-end run')
    console.log('\nSELFTEST FAILED: a required CLI is missing.')
    return 1
  }
  if (clis.notes.length > 0) show('resolution notes', clis.notes)

  step('CLI versions')
  for (const [label, entry] of [['babysitter', clis.babysitter], ['genty', clis.genty]]) {
    const version = await runCli(entry, ['--version'], { timeoutMs: 30_000, maxOutputBytes: 4_000 })
    show(`${label} --version`, { exitCode: version.exitCode, stdout: version.stdout.trim(), stderr: version.stderr.trim() })
    if (version.exitCode !== 0) fail(`${label} --version exited ${version.exitCode}`)
  }

  step('babysitter --help exit code')
  const help = await runCli(clis.babysitter, ['--help'], { timeoutMs: 30_000, maxOutputBytes: 8_000 })
  show('babysitter --help', { exitCode: help.exitCode, timedOut: help.timedOut, stdoutChars: help.stdout.length, stderrChars: help.stderr.length })
  if (help.exitCode !== 0) fail(`babysitter --help exited ${help.exitCode}`)
  show('babysitter --help command families', (help.stdout.match(/babysitter [a-z][a-z:-]+/g) ?? []).slice(0, 12))
  if (!/babysitter run:create/.test(help.stdout) || !/babysitter run:status/.test(help.stdout)) {
    fail('babysitter --help did not name its own run:create/run:status commands')
  }

  step('genty --help shows the commands babysitter does not own (call, resume, doctor)')
  const gentyHelp = await runCli(clis.genty, ['--help'], { timeoutMs: 30_000, maxOutputBytes: 12_000 })
  show('genty --help', { exitCode: gentyHelp.exitCode, timedOut: gentyHelp.timedOut, stdoutChars: gentyHelp.stdout.length, stderrChars: gentyHelp.stderr.length })
  if (gentyHelp.exitCode !== 0) fail(`genty --help exited ${gentyHelp.exitCode}`)
  for (const command of ['genty call', 'genty resume', 'genty doctor']) {
    const present = gentyHelp.stdout.includes(command)
    show(`genty help names "${command}"`, present)
    if (!present) fail(`genty --help did not name "${command}"`)
  }

  step('temp workspace and trivial headless process')
  const root = mkdtempSync(join(tmpdir(), 'dsh-babysitter-selftest-'))
  const workspace = join(root, 'workspace')
  mkdirSync(workspace, { recursive: true })
  const sdkDir = sdkDirOrFail(clis)
  if (sdkDir === null) {
    console.log('\nSELFTEST FAILED: no SDK directory.')
    return 1
  }
  mkdirSync(join(workspace, 'node_modules', '@a5c-ai'), { recursive: true })
  symlinkSync(sdkDir, join(workspace, 'node_modules', '@a5c-ai', 'babysitter-sdk'), process.platform === 'win32' ? 'junction' : 'dir')
  const processFile = join(workspace, 'selftest.process.mjs')
  writeFileSync(
    processFile,
    `import { defineTask } from '@a5c-ai/babysitter-sdk';

const sayHello = defineTask('selftest-say-hello', () => ({
  kind: 'shell',
  title: 'selftest say hello',
  shell: { command: 'node', args: ['-e', "process.stdout.write('selftest-ok')"] },
}));

export async function process(inputs, ctx) {
  const said = await ctx.task(sayHello, {});
  return { ok: true, said };
}
`,
    'utf8',
  )
  show('temp root', root)
  show('workspace', workspace)
  show('process file', processFile)
  show('SDK symlink', { from: sdkDir, to: join(workspace, 'node_modules', '@a5c-ai', 'babysitter-sdk') })

  step('mount taskboard and babysitter plugins in a fake Host context')
  const { ctx, tools, services } = fakeContext()
  applyTaskboard(ctx, { file: join(workspace, '.dsh', 'taskboard.json'), timelineLimit: 120 })
  applyBabysitter(ctx, { timeoutMs: 180_000, doctorTimeoutMs: 60_000, maxOutputBytes: 24_000 })
  show('registered tools', [...tools.keys()].sort())
  const taskboard = services.get('taskboard')
  if (taskboard === undefined) {
    fail('the taskboard service did not mount')
    console.log('\nSELFTEST FAILED: no taskboard service.')
    return 1
  }

  step('execute one real headless process through the internal harness')
  const exec = { agent: { session: { header: { cwd: workspace } } } }
  const run = tools.get('babysitter_run')
  const runResult = await run.execute(
    { process: processFile, workspace, mode: 'call', harness: 'internal', timeoutMs: 180_000 },
    exec,
  )
  show('run result', {
    ok: runResult.ok,
    runId: runResult.runId,
    runDir: runResult.runDir,
    exitCode: runResult.exitCode,
    timedOut: runResult.timedOut,
    durationMs: runResult.durationMs,
    runState: runResult.run?.state ?? null,
    failedTasks: runResult.failedTasks,
    taskId: runResult.taskId,
    taskRevision: runResult.taskRevision,
    taskStatus: runResult.taskStatus,
    taskboardNotes: runResult.taskboard?.notes ?? null,
    taskboardErrors: runResult.taskboard?.errors ?? null,
    error: runResult.error,
    warnings: runResult.warnings,
  })
  if (runResult.ok !== true) fail(`babysitter_run did not succeed: ${runResult.error ?? 'no error given'}`)
  if (runResult.exitCode !== 0) fail(`babysitter_run exit code was ${runResult.exitCode}`)
  if (runResult.timedOut !== false) fail('babysitter_run reported a timeout')
  if (typeof runResult.runId !== 'string' || runResult.runId === '') fail('babysitter_run returned no run id')
  if (typeof runResult.runDir !== 'string' || runResult.runDir === '') fail('babysitter_run returned no run directory')
  if (runResult.run?.state !== 'completed') fail(`journal state was ${runResult.run?.state ?? 'missing'}, not completed`)
  if ((runResult.failedTasks ?? []).length !== 0) fail('the run contains failed tasks')

  step('journal entries produced by the run')
  let journalFiles = []
  if (typeof runResult.runDir === 'string' && runResult.runDir !== '') {
    try {
      journalFiles = readdirSync(join(runResult.runDir, 'journal')).filter((name) => name.endsWith('.json')).sort()
    } catch {
      journalFiles = []
    }
  }
  show('journal path', runResult.run?.journalPath ?? null)
  show('journal file count', journalFiles.length)
  for (const file of journalFiles) show(`journal ${file}`, journalEvent(runResult.runDir, file))
  if (journalFiles.length < 3) fail(`expected at least 3 journal entries, found ${journalFiles.length}`)
  const journalTypes = journalFiles.map((file) => journalEvent(runResult.runDir, file).type)
  if (!journalTypes.includes('RUN_CREATED')) fail('journal has no RUN_CREATED entry')
  if (!journalTypes.includes('RUN_COMPLETED')) fail('journal has no RUN_COMPLETED entry')
  show('journal types', journalTypes)

  step('linked taskboard task after the run')
  const task = typeof runResult.taskId === 'string' ? taskboard.get(workspace, runResult.taskId) : undefined
  if (task === undefined) {
    fail('the run did not leave a readable taskboard task')
  } else {
    show('task', {
      id: task.id,
      title: task.title,
      status: task.status,
      revision: task.revision,
      scope: task.scope,
      updatedAt: task.updatedAt,
      timelineEntries: task.timeline.length,
    })
    for (const entry of task.timeline) show(`timeline ${entry.at}`, { kind: entry.kind, actor: entry.actor, text: entry.text })
    if (task.status !== 'review') fail(`task status is ${task.status}, not review`)
    const timelineText = task.timeline.map((entry) => entry.text).join('\n')
    if (!timelineText.includes('babysitter start')) fail('task timeline has no start note')
    if (!timelineText.includes('babysitter finish')) fail('task timeline has no finish note')
    if (!timelineText.includes(`babysitter run id: ${runResult.runId}`)) fail('task timeline has no run id note')
    if (task.timeline.length < 3) fail(`task timeline has ${task.timeline.length} entries, expected at least 3`)
  }
  show('lookup index', JSON.parse(readFileSync(join(workspace, '.dsh', 'babysitter-links.json'), 'utf8')))

  step('status tool reads the same run from the journal')
  const status = tools.get('babysitter_status')
  const statusResult = await status.execute({ runId: runResult.runId, workspace }, exec)
  show('status result', {
    ok: statusResult.ok,
    runId: statusResult.run?.runId ?? null,
    state: statusResult.run?.state ?? null,
    journalEntryCount: statusResult.run?.journalEntryCount ?? null,
    lastEvent: statusResult.run?.lastEvent ?? null,
    task: statusResult.task,
    error: statusResult.error ?? null,
  })
  if (statusResult.ok !== true) fail(`babysitter_status failed: ${statusResult.error ?? 'no error given'}`)
  if (statusResult.run?.state !== 'completed') fail(`babysitter_status read state ${statusResult.run?.state ?? 'missing'}`)
  if ((statusResult.task?.id ?? null) !== (runResult.taskId ?? null)) fail('babysitter_status did not find the linked task')

  step('status tool lists the recent run from the journal')
  const recent = await status.execute({ workspace, limit: 5 }, exec)
  show('recent runs', {
    ok: recent.ok,
    scanned: recent.scanned,
    sources: recent.sources,
    runs: (recent.runs ?? []).map((entry) => ({ runId: entry.runId, state: entry.state, taskId: entry.taskId, journalEntries: entry.journalEntryCount })),
    error: recent.error ?? null,
  })
  if (recent.ok !== true) fail(`babysitter_status recent list failed: ${recent.error ?? 'no error given'}`)
  if (!Array.isArray(recent.runs) || recent.runs.length === 0) fail('babysitter_status returned no recent runs')
  else if (!recent.runs.some((entry) => entry.runId === runResult.runId)) fail('the recent list did not include the run that just finished')

  step('resume tool calls genty resume-run and reports the exact result')
  const resume = tools.get('babysitter_resume')
  const resumeResult = await resume.execute({ runId: runResult.runId, workspace, harness: 'internal', timeoutMs: 60_000 }, exec)
  show('resume result', {
    ok: resumeResult.ok,
    runId: resumeResult.runId,
    exitCode: resumeResult.exitCode,
    timedOut: resumeResult.timedOut,
    runState: resumeResult.run?.state ?? null,
    taskId: resumeResult.taskId,
    taskRevision: resumeResult.taskRevision,
    taskStatus: resumeResult.taskStatus,
    error: resumeResult.error,
  })
  if (resumeResult.ok === true) {
    console.log('resume succeeded (a model provider is configured in this environment)')
  } else if (typeof resumeResult.error === 'string' && /No API credentials found/.test(resumeResult.error)) {
    console.log('resume failed with the exact provider-credential message; this is the documented limitation, not a surprise')
  } else {
    fail(`resume failed for an unexpected reason: ${resumeResult.error ?? 'no error given'}`)
  }
  if (resumeResult.taskStatus !== null && resumeResult.taskStatus !== 'review') fail(`resume left the task in ${resumeResult.taskStatus}, not review`)
  const afterResume = typeof runResult.taskId === 'string' ? taskboard.get(workspace, runResult.taskId) : undefined
  if (afterResume !== undefined) {
    show('task after resume', { id: afterResume.id, status: afterResume.status, revision: afterResume.revision, timelineEntries: afterResume.timeline.length })
    if (afterResume.status !== 'review') fail(`task after resume is ${afterResume.status}, not review`)
    const resumeNotes = afterResume.timeline.filter((entry) => String(entry.text).includes('babysitter resume'))
    for (const entry of resumeNotes) show(`resume timeline ${entry.at}`, { kind: entry.kind, actor: entry.actor, text: entry.text })
    if (resumeNotes.length === 0) fail('the task timeline has no resume note')
  }

  step('doctor reports the exact provider-credential failure when there is no provider')
  const doctor = tools.get('babysitter_doctor')
  const doctorResult = await doctor.execute({ workspace, timeoutMs: 60_000 }, exec)
  show('doctor result', {
    ok: doctorResult.ok,
    clis: doctorResult.clis,
    versions: doctorResult.versions,
    sdkDir: doctorResult.sdkDir,
    runsDirs: doctorResult.runsDirs,
    exitCode: doctorResult.doctor?.exitCode ?? null,
    error: doctorResult.error,
    doctorStdoutChars: doctorResult.doctor?.stdout?.length ?? null,
    doctorStderrChars: doctorResult.doctor?.stderr?.length ?? null,
    note: doctorResult.note,
  })
  if (doctorResult.ok === true) {
    console.log('doctor passed (a model provider is configured in this environment)')
  } else if (typeof doctorResult.error === 'string' && /No API credentials found/.test(doctorResult.error)) {
    console.log('doctor failed with the exact provider-credential message; this is the documented limitation, not a surprise')
  } else {
    fail(`doctor failed for an unexpected reason: ${doctorResult.error ?? 'no error given'}`)
  }

  step('tail cap on a real CLI log')
  const capped = await runCli(clis.babysitter, ['--help'], { timeoutMs: 30_000, maxOutputBytes: 1_000 })
  show('capped help', { exitCode: capped.exitCode, stdoutChars: capped.stdout.length, stdoutTruncated: capped.truncated.stdout, stderrChars: capped.stderr.length })
  if (capped.stdout.length > 1_000) fail(`tail cap kept ${capped.stdout.length} chars from a real help output`)
  if (capped.truncated.stdout !== true) fail('tail cap did not report truncation on a log larger than the cap')

  step('bounded spawn: a 500 ms timeout returns a failure naming the timeout')
  const slow = await tools.get('babysitter_run').execute(
    { process: processFile, workspace, mode: 'call', harness: 'internal', timeoutMs: 500 },
    exec,
  )
  show('timeout result', {
    ok: slow.ok,
    timedOut: slow.timedOut,
    exitCode: slow.exitCode,
    durationMs: slow.durationMs,
    taskId: slow.taskId,
    taskStatus: slow.taskStatus,
    error: slow.error,
  })
  if (slow.ok !== false) fail('the timed-out run reported ok')
  if (slow.timedOut !== true) fail('the timed-out run did not set timedOut')
  if (!/timed out after 500 ms/.test(String(slow.error ?? ''))) fail(`the timeout failure did not name the timeout: ${slow.error ?? '(no error)'}`)
  if (process.platform !== 'win32') {
    let leftover = ''
    try {
      // Match THIS run's workspace, not every genty on the machine: the old
      // pattern also matched an unrelated `genty --version` and red-flagged a
      // clean plugin. The temp workspace path is unique per selftest run.
      leftover = execFileSync('pgrep', ['-f', workspace], { encoding: 'utf8' }).trim()
    } catch (error) {
      if (error?.status !== 1) leftover = `pgrep failed: ${error.message}`
    }
    show('leftover genty processes after the timeout', leftover === '' ? 'none' : leftover)
    if (leftover !== '') fail(`a process in this run's workspace survived the timeout: ${leftover}`)
  }

  step('early refusal when the process file imports an unresolvable SDK')
  const unsolvedDir = join(root, 'unsolved')
  mkdirSync(unsolvedDir, { recursive: true })
  const unsolvedProcess = join(unsolvedDir, 'unsolved.process.mjs')
  writeFileSync(
    unsolvedProcess,
    `import { defineTask } from '@a5c-ai/babysitter-sdk';
const noop = defineTask('noop', () => ({ kind: 'shell', title: 'noop', shell: { command: 'node', args: ['-e', ''] } }));
export async function process(inputs, ctx) { await ctx.task(noop, {}); return { ok: true }; }
`,
    'utf8',
  )
  const unresolved = await tools.get('babysitter_run').execute(
    { process: unsolvedProcess, workspace: unsolvedDir, mode: 'call', harness: 'internal', timeoutMs: 5_000 },
    exec,
  )
  show('unresolved SDK result', {
    ok: unresolved.ok,
    timedOut: unresolved.timedOut,
    durationMs: unresolved.durationMs,
    runId: unresolved.runId,
    taskId: unresolved.taskId,
    error: unresolved.error,
  })
  if (unresolved.ok !== false) fail('the unresolved-SDK run reported ok')
  if (unresolved.timedOut === true) fail('the unresolved-SDK run reached the timeout instead of failing early')
  if (!/not resolvable/.test(String(unresolved.error ?? ''))) fail(`the unresolved-SDK failure did not name resolution: ${unresolved.error ?? '(no error)'}`)
  if (!/node_modules/.test(String(unresolved.error ?? ''))) fail('the unresolved-SDK failure did not include the symlink command')
  if (unresolved.durationMs > 5_000) fail(`the unresolved-SDK refusal took ${unresolved.durationMs} ms`)

  step('CLI absent: every tool returns one actionable install message')
  const savedPath = process.env.PATH
  const absenceResults = []
  try {
    process.env.PATH = '/nonexistent-dsh-babysitter-selftest'
    for (const [toolName, args] of [
      ['babysitter_run', { process: processFile, workspace, mode: 'call' }],
      ['babysitter_status', {}],
      ['babysitter_resume', { runId: 'fake-run-id' }],
      ['babysitter_doctor', {}],
    ]) {
      const tool = tools.get(toolName)
      const value = await tool.execute(args, exec)
      absenceResults.push({ tool: toolName, ok: value.ok, error: value.error })
      show(`${toolName} absent`, { ok: value.ok, error: value.error })
      if (value.ok !== false) fail(`${toolName} reported ok while the CLI was absent`)
      if (typeof value.error !== 'string' || !value.error.includes('npm install -g @a5c-ai/babysitter')) {
        fail(`${toolName} did not return the install hint`)
      }
      if (/\n\s+at\s/.test(String(value.error ?? ''))) fail(`${toolName} returned a stack trace`)
    }
  } finally {
    process.env.PATH = savedPath
  }
  show('absence results', absenceResults)

  step('result')
  if (failures.length > 0) {
    console.log(`SELFTEST FAILED with ${failures.length} failure(s):`)
    for (const reason of failures) console.log(`- ${reason}`)
    return 1
  }
  console.log('SELFTEST PASSED')
  console.log(`run id: ${runResult.runId}`)
  console.log(`journal: ${runResult.run?.journalPath ?? '(missing)'}`)
  console.log(`task id: ${runResult.taskId} (status ${task?.status ?? 'missing'}, revision ${task?.revision ?? 'missing'})`)
  console.log(`temp root: ${root}`)
  return 0
}

const exitCode = await main().catch((error) => {
  console.error(`SELFTEST FAILED: ${error instanceof Error ? error.message : String(error)}`)
  return 1
})
process.exitCode = exitCode
