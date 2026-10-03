/**
 * PURPOSE
 *   Prove the usage analyser is actually redacting, and that its `--check` gate can fail.
 *
 *   "The report carries no identity material" is a claim about a program's output, and a claim
 *   nothing can falsify is worth nothing. So this file does two things: it feeds the analyser an
 *   export carrying an account id and a masked API key and asserts neither reaches the report,
 *   and it then feeds it an export whose MODEL NAME contains key-shaped material — a value that
 *   the report legitimately renders — and asserts the gate REFUSES. The second case is the
 *   important one: without it, a check that always passes would look identical to a check that
 *   works.
 *
 * INPUTS
 *   None. Both fixtures are built here, in a temporary directory.
 *
 * OUTPUTS
 *   `node --test` results. Each test names the production change that would make it fail.
 *
 * KEYWORDS
 *   usage, redaction, api key, account id, gate, falsifiable, behaviour
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A blank or unparseable numeric cell: counted as 0 rather than turning a total into NaN.
 *   - A missing export: the tool exits 2 and names what it looked for, so an absent input is
 *     never mistaken for "no usage this period".
 */

import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const KIT = process.cwd()
const TOOL = join(KIT, 'scripts', 'analyze-usage.mjs')

/** Fixture roots created here, removed after the run. */
const roots = []

/**
 * SYNTHETIC identity values, shaped like the platform's but belonging to nobody.
 *
 * These used to be copied from a real export, which put the account id and a real masked key
 * into a public repository — the exact leak this suite exists to prevent. A fixture only has
 * to be SHAPED like the thing it stands for; it must never be the thing itself.
 */
const MASKED_KEY = 'sk-FAKEAA***********************fake'
/** The account id shape the export carries on every row. */
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000000'

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/**
 * Build an extracted-export directory.
 *
 * @param model - The model name to write into both CSVs. A test passes a key-shaped value here
 *   to prove the gate refuses rather than trusting the parser to have dropped everything.
 * @returns Absolute path to the fixture directory.
 */
function exportDir(model = 'deepseek-flash') {
  const dir = mkdtempSync(join(tmpdir(), 'usage-fixture-'))
  roots.push(dir)
  writeFileSync(
    join(dir, 'cost-2026-09-04_2026-10-03.csv'),
    [
      'user_id,start_time_iso,end_time_iso,model,wallet_type,cost,currency',
      `${ACCOUNT_ID},2026-09-04T00:00:00+03:00,2026-09-05T00:00:00+03:00,${model},Paid,10.5000000000000000,USD`,
      `${ACCOUNT_ID},2026-09-05T00:00:00+03:00,2026-09-06T00:00:00+03:00,${model},Paid,2.2500000000000000,USD`,
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(dir, 'amount-2026-09-04_2026-10-03.csv'),
    [
      'user_id,start_time_iso,end_time_iso,model,api_key_name,api_key,type,price,amount',
      `${ACCOUNT_ID},2026-09-04T00:00:00+03:00,2026-09-05T00:00:00+03:00,${model},test-key-alpha,${MASKED_KEY},input_cache_hit_tokens,0.000000022,1000000`,
      `${ACCOUNT_ID},2026-09-04T00:00:00+03:00,2026-09-05T00:00:00+03:00,${model},test-key-alpha,${MASKED_KEY},input_cache_miss_tokens,0.00000066,2000`,
      `${ACCOUNT_ID},2026-09-04T00:00:00+03:00,2026-09-05T00:00:00+03:00,${model},test-key-alpha,${MASKED_KEY},output_tokens,0.00000396,3000`,
      `${ACCOUNT_ID},2026-09-04T00:00:00+03:00,2026-09-05T00:00:00+03:00,${model},test-key-alpha,${MASKED_KEY},request_count,,7`,
      `${ACCOUNT_ID},2026-09-05T00:00:00+03:00,2026-09-06T00:00:00+03:00,${model},test-key-beta,${MASKED_KEY},output_tokens,0.00000396,,`,
      '',
    ].join('\n'),
  )
  return dir
}

/**
 * Run the analyser.
 *
 * @param args - Arguments after the script path.
 * @returns `{ status, stdout, stderr }`.
 */
function run(args) {
  const result = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

describe('usage analysis redaction', () => {
  it('never emits the account id or the masked key', () => {
    // Fails if the parse boundary stops dropping identity columns, or if a later stage starts
    // passing the raw row through.
    const dir = exportDir()
    const { status, stdout } = run(['--dir', dir])
    assert.equal(status, 0)
    assert.ok(!stdout.includes(ACCOUNT_ID), 'the account id reached the report')
    assert.ok(!stdout.includes(MASKED_KEY), 'the masked API key reached the report')
    assert.ok(!stdout.includes('sk-FAKEAA'), 'a key prefix reached the report')
    assert.ok(!stdout.includes('test-key-beta'), 'an API key name reached the report')
  })

  it('still reports the aggregates it exists to produce', () => {
    // The negative control for the test above: redacting everything would also pass it, so this
    // pins that real numbers survive.
    const dir = exportDir()
    const { stdout } = run(['--dir', dir])
    assert.match(stdout, /deepseek-flash/)
    assert.match(stdout, /\$12\.7500/) // 10.5 + 2.25, summed by hand
    assert.match(stdout, /1,000,000/)
    assert.match(stdout, /7/)
  })

  it('reports HOW MANY API keys were used, never which', () => {
    // Fails if the count is read back off a parsed row: `api_key_name` is dropped at the parse
    // boundary, so that read always yields 0 and the report silently claims a single-key
    // account. The fixture carries two names, so the correct answer is 2.
    const dir = exportDir()
    const { stdout } = run(['--dir', dir])
    assert.match(stdout, /referenced 2 distinct API key name/)
    assert.ok(!stdout.includes('test-key-beta'), 'a key name reached the report')
  })

  it('counts a blank numeric cell as zero rather than NaN', () => {
    // Fails if `Number('')` is allowed through, which would render `NaN` in a total.
    const dir = exportDir()
    const { stdout } = run(['--dir', dir])
    assert.ok(!stdout.includes('NaN'), `a NaN reached the report: ${stdout.slice(0, 200)}`)
  })

  it('--check passes on a clean report and prints its marker', () => {
    const dir = exportDir()
    const { status, stdout } = run(['--dir', dir, '--check'])
    assert.equal(status, 0)
    assert.match(stdout, /usage analysis ok/)
    assert.match(stdout, /identity column\(s\) dropped at parse/)
  })

  it('--check FAILS when key-shaped material would be rendered', () => {
    // THE FALSIFICATION. The model name is rendered verbatim by the report, so an export whose
    // model is key-shaped produces a leaking report. If `--check` still returned 0 here, the
    // gate would be decorative and the claim of redaction unverified.
    const dir = exportDir('sk-abcdef1234567890')
    const checked = run(['--dir', dir, '--check'])
    assert.equal(checked.status, 1, `--check should have refused; stdout=${checked.stdout} stderr=${checked.stderr}`)
    assert.match(checked.stderr, /identity material/)

    // …and the plain run must refuse to emit it too, not merely warn.
    const plain = run(['--dir', dir])
    assert.equal(plain.status, 1)
    assert.ok(!plain.stdout.includes('sk-abcdef1234567890'), 'the leaking report was emitted anyway')
  })

  it('exits 2 with a reason when an export is missing', () => {
    // Fails if an absent input is reported as an empty result, which reads like "no usage".
    const dir = mkdtempSync(join(tmpdir(), 'usage-empty-'))
    roots.push(dir)
    const { status, stderr } = run(['--dir', dir])
    assert.equal(status, 2)
    assert.match(stderr, /looked for|need both exports/i)
  })

  it('--json emits the same aggregates as machine-readable data', () => {
    const dir = exportDir()
    const { status, stdout } = run(['--dir', dir, '--json'])
    assert.equal(status, 0)
    const parsed = JSON.parse(stdout)
    assert.equal(parsed.totalCost, 12.75)
    assert.equal(parsed.models.length, 1)
    assert.equal(parsed.totals.requests, 7)
    assert.equal(parsed.totals.cacheHit, 1000000)
  })

  it('writes to --out and leaves stdout for the confirmation', () => {
    const dir = exportDir()
    const out = join(dir, 'report.md')
    const { status, stdout } = run(['--dir', dir, '--out', out])
    assert.equal(status, 0)
    assert.match(stdout, /wrote/)
    const written = readFileSync(out, 'utf8')
    assert.match(written, /Usage analysis/)
    assert.ok(!written.includes(MASKED_KEY))
  })
})

// A fixture directory that is never used still proves the helper is total.
describe('usage analysis fixtures', () => {
  it('builds an export directory carrying both files', () => {
    const dir = exportDir()
    mkdirSync(dir, { recursive: true })
    assert.ok(readFileSync(join(dir, 'cost-2026-09-04_2026-10-03.csv'), 'utf8').includes(ACCOUNT_ID))
  })
})
