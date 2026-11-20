/**
 * PURPOSE
 *   Prove, by running the plugin, that @cc/dsh-run-code-projection replaces one oversized
 *   `run_code` result with a banner + head + tail + a spill path, that the full text really
 *   is readable from the exact path the banner names, and that every result the brief says
 *   must not be touched is not touched.
 *
 *   The recovery is proven on the AGENT's path, not on the filesystem: the same
 *   `tools/post-execute` listener is run again as a `read` whose `file_path` is the path in
 *   the banner, and the result must come back whole. Reading the spill with `readFileSync`
 *   (what this proof did up to 0.1.2) proves the file exists and says nothing about what the
 *   model would receive — the defect measured 2026-11-20: `read` was itself a projected tool,
 *   so the recovery read arrived as a second banner with its own middle cut,
 *   `proof/negative-control.mjs` runs THIS proof against the pre-fix module and requires it
 *   to fail.
 *
 * INPUTS
 *   `proof/fixture-run-code.json` — a real `run_code` result extracted read-only from
 *   `$DSH_HOME/sessions/--home-iustimov-dsh-kit--/session-7ba8040c-…/session.v4.jsonl.zstd`
 *   (`zstd -dc`, call id `call_00_N2I4YMAgAKyOuSQJsXDo0908`, 27 200 chars). The proof creates
 *   a temporary directory as the SESSION WORKSPACE, so the spill file is written inside a
 *   workspace exactly as it would be in a real session.
 *
 * OUTPUTS
 *   One table row per check, then `run-code-projection proof: PASS|FAIL (n checks)`.
 *   Exit code 0 only when every row passed.
 *
 * KEYWORDS
 *   run_code, projection, spill, proof, head, tail, banner, idempotency, tools/post-execute
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as projectionModule from '../run-code-projection.mjs'
import { BANNER_PREFIX, LEGACY_BANNER_PREFIX, apply, isProjected, parseBanner } from '../run-code-projection.mjs'

// Read from the module object, not by name: the negative control runs this proof against the
// pre-fix module, which has no `TOOL_MIN_BYTES`, and a missing named export would crash the
// proof instead of turning the read-floor rows red.
const READ_FLOOR = Math.max(8192, projectionModule.TOOL_MIN_BYTES?.read ?? 0)

const fixture = JSON.parse(readFileSync(new URL('./fixture-run-code.json', import.meta.url), 'utf8'))

const rows = []
let failed = false

/**
 * Record one check.
 *
 * @param scenario - what is being proven.
 * @param ok - the observed verdict.
 * @param detail - the evidence printed in the last columns.
 * @param numbers - `{ before, after }` characters.
 */
function check(scenario, ok, detail, numbers = {}) {
  const before = numbers.before
  const after = numbers.after
  const saved = before !== undefined && after !== undefined && before > 0 ? `${(100 * (1 - after / before)).toFixed(1)}%` : ''
  rows.push({ scenario, before: before ?? '', after: after ?? '', saved, detail, ok })
  if (!ok) failed = true
}

/** A fake Cordis context: the waterfall handler and a logger. */
function createHarness(config) {
  const handlers = new Map()
  const warnings = []
  const ctx = {
    logger: { warn: (message) => warnings.push(String(message)) },
    on(event, handler) {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
  }
  apply(ctx, config)
  return { ctx, handlers, warnings }
}

/** Run the plugin's real post-execute listener once. */
async function run(harness, { name = 'run_code', content, isError = false, cwd, aborted = false, args }) {
  const exec = {
    name,
    callId: 'call_00_PROOF000000000000000000000',
    arguments: args ?? { code: 'console.log(1)', description: 'proof' },
    ...(cwd === undefined ? {} : { agent: { session: { header: { cwd } } } }),
    signal: { aborted },
  }
  const result = isError
    ? { isError: true, error: { message: 'program failed' }, content }
    : { isError: false, value: { logs: [], result: null }, content }
  let nextCalls = 0
  const decision = await harness.handlers.get('tools/post-execute')(exec, result, () => {
    nextCalls += 1
    return Promise.resolve({ kind: 'accept' })
  })
  return { decision, nextCalls, result }
}

/** The content the harness would materialize: a replacement when accepted, else the result's own. */
function effectiveContent(decision, result) {
  return Array.isArray(decision?.content) ? decision.content : result.content
}

/**
 * The text the `read` tool would return for a file: one `N\t<line>` row per line. The
 * projection decision turns on the call's `file_path`, never on this text; the rendering is
 * here so the recovery checks carry a realistic size, including above the read floor.
 */
function asReadToolRenders(text) {
  return text.split('\n').map((line, index) => `${index + 1}\t${line}`).join('\n')
}

/** How many full texts the spill directory holds. */
function spillFiles(dir) {
  return existsSync(dir) ? readdirSync(dir).length : 0
}

/** The single text block of a content array, or null. */
function textOf(content) {
  return Array.isArray(content) && content.length === 1 && content[0]?.type === 'text' && typeof content[0].text === 'string' ? content[0].text : null
}

const workspace = mkdtempSync(join(tmpdir(), 'run-code-projection-'))
const spillDir = join(workspace, '.dsh', 'spill')
const harness = createHarness({})

try {
  // ── the real fixture: banner + head + tail + readable spill ─────────────
  const original = fixture.text
  const real = await run(harness, { content: [{ type: 'text', text: original }], cwd: workspace })
  const projected = textOf(effectiveContent(real.decision, real.result))
  const bannerPath = parseBanner(projected)
  const spillReadBack = bannerPath !== null && existsSync(bannerPath) ? readFileSync(bannerPath, 'utf8') : null
  const middle = original.slice(Math.floor(original.length / 2), Math.floor(original.length / 2) + 200)
  check(
    'real run_code fixture — projected, spill readable at the banner path',
    projected !== original &&
      projected.startsWith(BANNER_PREFIX) &&
      bannerPath !== null &&
      bannerPath.startsWith(spillDir) &&
      spillReadBack === original &&
      projected.includes(original.slice(0, 1000)) &&
      projected.includes(original.slice(-1000)) &&
      !projected.includes(middle),
    `${bannerPath ?? 'no path'} (${spillReadBack === null ? 'missing' : spillReadBack === original ? 'read back identical' : 'DIFFERS'})`,
    { before: original.length, after: projected.length },
  )
  console.log('projected banner (real fixture):')
  for (const line of projected.split('\n', 2)) console.log(`  ${line}`)
  console.log('')

  // ── the agent's own recovery path: read the banner's file back ──────────
  // The banner promises that the middle is readable. The proof therefore follows the path a
  // session actually takes — the same `tools/post-execute` listener, a `read` call naming the
  // file the banner named — and requires the full text back, not a second banner. Reading the
  // spill with readFileSync (as this proof did before) never exercised the listener, so it
  // could not see that the recovery read was itself projected.
  const recoveryFilesBefore = spillFiles(spillDir)
  const spillText = spillReadBack ?? ''
  const reread = await run(harness, {
    name: 'read',
    args: { file_path: bannerPath ?? join(spillDir, 'missing') },
    content: [{ type: 'text', text: asReadToolRenders(spillText) }],
    cwd: workspace,
  })
  const rereadText = textOf(effectiveContent(reread.decision, reread.result))
  const rereadFiles = spillFiles(spillDir)
  check(
    "read of the banner's file — full text returned, not projected again",
    bannerPath !== null &&
      rereadText === asReadToolRenders(spillText) &&
      !isProjected(rereadText) &&
      parseBanner(rereadText) === null &&
      rereadFiles === recoveryFilesBefore,
    `${(bannerPath ?? 'no path').replace(workspace, '.')} • spill files ${recoveryFilesBefore} -> ${rereadFiles}`,
    { before: asReadToolRenders(spillText).length, after: rereadText.length },
  )

  // The same read, named by a workspace-relative path: the read tool resolves it against the
  // session workspace, so the exception must too.
  const relativePath = bannerPath === null ? '.dsh/spill/missing' : bannerPath.slice(workspace.length + 1)
  const relativeReread = await run(harness, {
    name: 'read',
    args: { file_path: relativePath },
    content: [{ type: 'text', text: asReadToolRenders(spillText) }],
    cwd: workspace,
  })
  const relativeText = textOf(effectiveContent(relativeReread.decision, relativeReread.result))
  check(
    'read of the banner file by its relative path — full text, not projected',
    bannerPath !== null && relativeText === asReadToolRenders(spillText) && !isProjected(relativeText),
    relativePath,
    { before: asReadToolRenders(spillText).length, after: relativeText.length },
  )

  // The same read, from a spill LARGER than the read floor: "independent of the file size".
  const hugeText = fixture.text.repeat(8)
  const huge = await run(harness, { content: [{ type: 'text', text: hugeText }], cwd: workspace })
  const hugePath = parseBanner(textOf(effectiveContent(huge.decision, huge.result)))
  const hugeReread = await run(harness, {
    name: 'read',
    args: { file_path: hugePath ?? join(spillDir, 'missing') },
    content: [{ type: 'text', text: asReadToolRenders(hugeText) }],
    cwd: workspace,
  })
  const hugeRereadText = textOf(effectiveContent(hugeReread.decision, hugeReread.result))
  check(
    'read of a spill above the read floor (217,600 bytes) — full text, not projected',
    hugePath !== null &&
      Buffer.byteLength(hugeText, 'utf8') > 64 * 1024 &&
      existsSync(hugePath) &&
      readFileSync(hugePath, 'utf8') === hugeText &&
      hugeRereadText === asReadToolRenders(hugeText) &&
      !isProjected(hugeRereadText),
    `${hugePath === null ? 'no path' : Buffer.byteLength(hugeText, 'utf8') + ' bytes'} • read back identical`,
    { before: asReadToolRenders(hugeText).length, after: hugeRereadText.length },
  )

  // ── the brief's example size: 41 208 characters ─────────────────────────
  const bigText = fixture.text.repeat(3).slice(0, 41208)
  const big = await run(harness, { content: [{ type: 'text', text: bigText }], cwd: workspace })
  const bigProjected = textOf(effectiveContent(big.decision, big.result))
  const bigPath = parseBanner(bigProjected)
  check(
    '41,208-char fixture — projected, full text readable',
    bigProjected.startsWith(BANNER_PREFIX) && bigPath !== null && readFileSync(bigPath, 'utf8') === bigText,
    bigPath ?? 'no path',
    { before: bigText.length, after: bigProjected.length },
  )

  // ── must not touch: short, error, image, non-run_code, aborted ───────────
  const shortText = 'x'.repeat(4000)
  const short = await run(harness, { content: [{ type: 'text', text: shortText }], cwd: workspace })
  check('short result — untouched', textOf(effectiveContent(short.decision, short.result)) === shortText, 'below minBytes', { before: shortText.length, after: shortText.length })

  const errorRun = await run(harness, { content: [{ type: 'text', text: original }], isError: true, cwd: workspace })
  check('error result — untouched', textOf(effectiveContent(errorRun.decision, errorRun.result)) === original, 'isError', { before: original.length, after: original.length })

  const imageRun = await run(harness, { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }], cwd: workspace })
  const imageContent = effectiveContent(imageRun.decision, imageRun.result)
  check('image result — untouched', !Object.hasOwn(imageRun.decision, 'content') && imageContent[0].type === 'image', 'multi/media block', { before: 0, after: 0 })

  const otherTool = await run(harness, { name: 'web_search', content: [{ type: 'text', text: original }], cwd: workspace })
  check('tool outside the list — untouched', textOf(effectiveContent(otherTool.decision, otherTool.result)) === original, 'name=web_search', { before: original.length, after: original.length })

  const abortedRun = await run(harness, { content: [{ type: 'text', text: original }], cwd: workspace, aborted: true })
  check('aborted step — untouched', textOf(effectiveContent(abortedRun.decision, abortedRun.result)) === original, 'signal.aborted', { before: original.length, after: original.length })

  // ── idempotency: feeding the projection back creates no second file ─────
  const filesBefore = readdirSync(spillDir).length
  const again = await run(harness, { content: [{ type: 'text', text: projected }], cwd: workspace })
  const filesAfter = readdirSync(spillDir).length
  check(
    'already projected — untouched, no second spill',
    textOf(effectiveContent(again.decision, again.result)) === projected && filesAfter === filesBefore,
    `spill files ${filesBefore} -> ${filesAfter}`,
    { before: projected.length, after: projected.length },
  )

  // ── a block decision and a value replacement are authoritative ───────────
  const blockHarness = createHarness({})
  const blockHandler = blockHarness.handlers.get('tools/post-execute')
  const blockDecision = await blockHandler(
    { name: 'run_code', callId: 'c', arguments: {}, agent: { session: { header: { cwd: workspace } } }, signal: { aborted: false } },
    { isError: false, value: {}, content: [{ type: 'text', text: original }] },
    () => Promise.resolve({ kind: 'block', feedback: [{ type: 'text', text: 'no' }] }),
  )
  check('blocked result — untouched', blockDecision.kind === 'block', 'decision.kind=block', { before: original.length, after: original.length })

  const valueHarness = createHarness({})
  const valueHandler = valueHarness.handlers.get('tools/post-execute')
  const valueDecision = await valueHandler(
    { name: 'run_code', callId: 'c', arguments: {}, agent: { session: { header: { cwd: workspace } } }, signal: { aborted: false } },
    { isError: false, value: {}, content: [{ type: 'text', text: original }] },
    () => Promise.resolve({ kind: 'accept', value: { replaced: true } }),
  )
  check('value replacement — untouched', Object.hasOwn(valueDecision, 'value') && !Object.hasOwn(valueDecision, 'content'), 'decision carried value', {
    before: original.length,
    after: original.length,
  })

  // ── failures leave the result alone and are logged ──────────────────────
  const noCwdHarness = createHarness({})
  const noCwd = await run(noCwdHarness, { content: [{ type: 'text', text: original }] })
  check(
    'no workspace — untouched, logged',
    textOf(effectiveContent(noCwd.decision, noCwd.result)) === original && noCwdHarness.warnings.some((warning) => warning.includes('no workspace')),
    noCwdHarness.warnings.find((warning) => warning.includes('no workspace')) ?? 'no warning',
    { before: original.length, after: original.length },
  )

  // A regular file where the workspace must be is a deterministic, fast mkdir failure
  // (ENOTDIR). A /proc path looks like a failure but Node's recursive mkdir loops there.
  const blockedWorkspace = join(workspace, 'blocked-workspace')
  writeFileSync(blockedWorkspace, 'not a directory')
  const unwritableHarness = createHarness({})
  const unwritable = await run(unwritableHarness, { content: [{ type: 'text', text: original }], cwd: blockedWorkspace })
  check(
    'unwritable spill — untouched, logged',
    textOf(effectiveContent(unwritable.decision, unwritable.result)) === original && unwritableHarness.warnings.some((warning) => warning.includes('could not write')),
    unwritableHarness.warnings.find((warning) => warning.includes('could not write')) ?? 'no warning',
    { before: original.length, after: original.length },
  )

  // A projection whose banner would not save at least minSavingRatio is skipped.
  const tinySavingHarness = createHarness({ minBytes: 1000, headBytes: 490, tailBytes: 490, minSavingRatio: 0.9 })
  const tinySaving = await run(tinySavingHarness, { content: [{ type: 'text', text: 'y'.repeat(1100) }], cwd: workspace })
  check(
    'insufficient saving — untouched',
    textOf(effectiveContent(tinySaving.decision, tinySaving.result)) === 'y'.repeat(1100),
    'banner would not pay for itself',
    { before: 1100, after: 1100 },
  )
  // ── the tool list: bulk tools project, contract tools pass through ──────
  // `read` has its own, higher floor: an ordinary document must arrive whole, so a read
  // between `minBytes` and the read floor is not a candidate at all.
  const readFloor = READ_FLOOR
  const documentText = 'doc '.repeat(3000) // 12 000 bytes, above minBytes, below the read floor
  const documentRead = await run(harness, {
    name: 'read',
    args: { file_path: join(workspace, 'workspace-notes.md') },
    content: [{ type: 'text', text: documentText }],
    cwd: workspace,
  })
  const documentReadText = textOf(effectiveContent(documentRead.decision, documentRead.result))
  check(
    `ordinary document (12,000 bytes, under the read floor) — read whole`,
    documentReadText === documentText && !isProjected(documentReadText),
    `read floor ${readFloor} bytes; the agent sees the document`,
    { before: documentText.length, after: documentReadText.length },
  )

  const readLike = 'r'.repeat(readFloor + 5000)
  const readResult = await run(harness, {
    name: 'read',
    args: { file_path: join(workspace, 'large-file.txt') },
    content: [{ type: 'text', text: readLike }],
    cwd: workspace,
  })
  const readProjected = textOf(effectiveContent(readResult.decision, readResult.result))
  const readBanner = parseBanner(readProjected)
  check(`read above the read floor (${readLike.length} bytes) — projected`, readBanner !== null && readBanner.includes('/read-'), readBanner ?? 'not projected', {
    before: readLike.length,
    after: readProjected.length,
  })
  check('read banner names the tool', typeof readProjected === 'string' && readProjected.startsWith(`${BANNER_PREFIX} read `), (readProjected ?? '').split('\n')[0].slice(0, 90))

  const contractText = 'c'.repeat(12_000)
  const contractResult = await run(createHarness({}), { name: 'task_get', content: [{ type: 'text', text: contractText }], cwd: workspace })
  check('compare-and-set tool — untouched', textOf(effectiveContent(contractResult.decision, contractResult.result)) === contractText, 'task_get keeps its revision', {
    before: contractText.length,
    after: contractText.length,
  })

  const bashResult = await run(harness, { name: 'bash', content: [{ type: 'text', text: 'b'.repeat(9000) }], cwd: workspace })
  check('bash above minBytes — projected', parseBanner(textOf(effectiveContent(bashResult.decision, bashResult.result))) !== null, 'command output bounded')

  const legacy = `${LEGACY_BANNER_PREFIX} old projection\nFull text: /tmp/x\n`
  const legacyResult = await run(harness, { name: 'read', content: [{ type: 'text', text: legacy.repeat(200) }], cwd: workspace })
  check('legacy banner — untouched', textOf(effectiveContent(legacyResult.decision, legacyResult.result)).startsWith(LEGACY_BANNER_PREFIX), 'no second projection')
} finally {
  rmSync(workspace, { recursive: true, force: true })
}

// ── the negative control the case harness runs ────────────────────────────
// `case_run mode:"red"` sets CASE_NEGATIVE_CONTROL and requires a non-zero exit: the driver
// breaks its own assertion so a green run cannot be mistaken for a verification. The stronger
// control — this proof run against the pre-fix module — is `proof/negative-control.mjs`.
if (typeof process.env.CASE_NEGATIVE_CONTROL === 'string' && process.env.CASE_NEGATIVE_CONTROL !== '') {
  check(
    `negative control ${process.env.CASE_NEGATIVE_CONTROL} — the driver breaks its own assertion`,
    false,
    'expected red under CASE_NEGATIVE_CONTROL',
  )
}

// ── the table ─────────────────────────────────────────────────────────────
const width = rows.reduce((max, row) => Math.max(max, row.scenario.length), 'scenario'.length)
const beforeWidth = Math.max(6, ...rows.map((row) => String(row.before).length))
const afterWidth = Math.max(6, ...rows.map((row) => String(row.after).length))
const savedWidth = Math.max(6, ...rows.map((row) => row.saved.length))
console.log(`run-code-projection proof — workspace ${workspace} (removed after the run)\n`)
console.log(`${'scenario'.padEnd(width)}  ${'before'.padStart(beforeWidth)}  ${'after'.padStart(afterWidth)}  ${'saved'.padStart(savedWidth)}  result`)
console.log(`${'-'.repeat(width)}  ${'-'.repeat(beforeWidth)}  ${'-'.repeat(afterWidth)}  ${'-'.repeat(savedWidth)}  ${'-'.repeat(44)}`)
for (const row of rows) {
  console.log(`${row.scenario.padEnd(width)}  ${String(row.before).padStart(beforeWidth)}  ${String(row.after).padStart(afterWidth)}  ${row.saved.padStart(savedWidth)}  ${row.ok ? 'PASS' : 'FAIL'} ${row.detail}`)
}
console.log('')
if (failed) {
  console.log(`run-code-projection proof: FAIL (${rows.length} checks)`)
  process.exitCode = 1
} else {
  console.log(`run-code-projection proof: PASS (${rows.length} checks)`)
  process.exitCode = 0
}
