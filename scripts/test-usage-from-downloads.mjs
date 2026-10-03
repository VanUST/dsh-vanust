/**
 * PURPOSE
 *   Prove the one-command usage pipeline works on a synthetic export, and that its archive
 *   reader handles the two compression methods a platform export uses — without depending on
 *   `unzip`, `Expand-Archive`, or a real download being present.
 *
 *   The fixtures are zips written here from the format's own field offsets rather than shelled
 *   out to an archiver. That is deliberate: the reader under test is hand-written, so a fixture
 *   produced by a different tool would test the fixture pipeline instead. Writing the container
 *   in the test also lets a stored entry and a deflated entry be compared, which is the one
 *   thing the reader can get wrong per-method.
 *
 * INPUTS
 *   None. Every fixture is built under the OS temporary directory.
 *
 * OUTPUTS
 *   `node --test` results. Each test names the production change that would make it fail.
 *
 * KEYWORDS
 *   usage, downloads, zip, deflate, stored, discovery, cross-platform, behaviour
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A file that is not a zip: refused with a reason, not a crash.
 *   - An entry with an unsupported compression method: named with its method number.
 *   - A directory with no matching export: exit 2 naming the directory and the pattern.
 *   - A directory that does not exist: exit 2 naming the path.
 */

import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { crc32, deflateRawSync } from 'node:zlib'

const KIT = process.cwd()
const TOOL = join(KIT, 'scripts', 'usage-from-downloads.mjs')

/** Fixture roots created here, removed after the run. */
const roots = []

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/**
 * Build a zip archive from entries, at the byte level.
 *
 * @param entries - `[{ name, content, method }]`; `method` 0 is stored, 8 is deflate.
 * @returns The archive as a Buffer.
 */
function buildZip(entries) {
  const locals = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const plain = Buffer.from(entry.content, 'utf8')
    const body = entry.method === 8 ? deflateRawSync(plain) : plain
    const checksum = crc32(plain)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(entry.method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(plain.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, body)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt16LE(entry.method, 10)
    header.writeUInt16LE(0, 12)
    header.writeUInt16LE(0, 14)
    header.writeUInt32LE(checksum, 16)
    header.writeUInt32LE(body.length, 20)
    header.writeUInt32LE(plain.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    header.writeUInt32LE(0, 38)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)

    offset += local.length + name.length + body.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, directory, end])
}

/** A cost export row, shaped like the platform's. */
const COST_CSV = [
  'user_id,start_time_iso,end_time_iso,model,wallet_type,cost,currency',
  '00000000-0000-4000-8000-000000000000,2026-09-04T00:00:00+03:00,2026-09-05T00:00:00+03:00,deepseek-flash,Paid,10.5000000000000000,USD',
  '',
].join('\n')

/** An amount export row, shaped like the platform's, carrying a masked key that must not leak. */
const AMOUNT_CSV = [
  'user_id,start_time_iso,end_time_iso,model,api_key_name,api_key,type,price,amount',
  '00000000-0000-4000-8000-000000000000,2026-09-04T00:00:00+03:00,2026-09-05T00:00:00+03:00,deepseek-flash,test-key,sk-FAKEAA***********************fake,request_count,,7',
  '00000000-0000-4000-8000-000000000000,2026-09-04T00:00:00+03:00,2026-09-05T00:00:00+03:00,deepseek-flash,test-key,sk-FAKEAA***********************fake,output_tokens,0.00000396,3000',
  '',
].join('\n')

/**
 * Write a synthetic export archive into a fresh directory.
 *
 * @param options - `{ method, name, nested, files }`.
 * @returns `{ dir, zip }` inside a temporary root.
 */
function exportArchive({ method = 8, name = 'usage_data_2026-09-04_2026-10-03.zip', nested = false, files = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'usage-pipeline-'))
  roots.push(root)
  const prefix = nested ? 'export/' : ''
  const entries = files
    ? [
        { name: `${prefix}cost-2026-09-04_2026-10-03.csv`, content: COST_CSV, method },
        { name: `${prefix}amount-2026-09-04_2026-10-03.csv`, content: AMOUNT_CSV, method },
      ]
    : [{ name: 'readme.txt', content: 'nothing here', method }]
  const zip = join(root, name)
  writeFileSync(zip, buildZip(entries))
  return { dir: root, zip }
}

/**
 * Run the pipeline.
 *
 * The working directory is a FRESH TEMPORARY DIRECTORY by default, never the kit. That is
 * load-bearing: the tool's default report path is relative to the working directory, so a test
 * that ran it from the repository root without `--out` overwrote the committed
 * `docs/usage/<month>.html` with synthetic fixture numbers. A test must not be able to write into
 * the product, so no test here can.
 *
 * @param args - Arguments after the script path.
 * @param cwd - Working directory to run in. Defaults to a new temporary directory.
 * @returns `{ status, stdout, stderr, cwd }`.
 */
function run(args, cwd) {
  const workdir = cwd ?? mkdtempSync(join(tmpdir(), 'usage-cwd-'))
  if (cwd === undefined) roots.push(workdir)
  const result = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', cwd: workdir })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', cwd: workdir }
}

describe('usage pipeline — archive reader', () => {
  it('extracts a deflated archive end to end and writes the report', () => {
    // Fails if the reader mishandles deflate — the method a real platform export uses.
    const { dir, zip } = exportArchive({ method: 8 })
    const out = join(dir, 'report.md')
    const result = run(['--zip', zip, '--out', out])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /extracted 2 CSV\(s\)/)
    assert.match(result.stdout, /usage analysis ok/)
    assert.ok(existsSync(out), 'the report was not written')
    const report = readFileSync(out, 'utf8')
    assert.match(report, /deepseek-flash/)
    assert.match(report, /\$10\.5000/) // the fixture's cost, read by hand
  })

  it('extracts a stored archive the same way', () => {
    // Stored is the other method a zip may use; a reader that only inflates would return the
    // raw bytes here and produce an unparseable CSV.
    const { dir, zip } = exportArchive({ method: 0 })
    const out = join(dir, 'report.md')
    const result = run(['--zip', zip, '--out', out])
    assert.equal(result.status, 0, result.stderr)
    assert.match(readFileSync(out, 'utf8'), /\$10\.5000/)
  })

  it('finds the CSVs when the archive nests them in a folder', () => {
    // Fails if extraction keeps the archive's directory structure, which would leave the
    // analyser's `cost-*.csv` discovery looking at an empty directory.
    const { dir, zip } = exportArchive({ nested: true })
    const out = join(dir, 'report.md')
    const result = run(['--zip', zip, '--out', out])
    assert.equal(result.status, 0, result.stderr)
    assert.match(readFileSync(out, 'utf8'), /\$10\.5000/)
  })

  it('refuses a file that is not a zip, with a reason', () => {
    const root = mkdtempSync(join(tmpdir(), 'usage-badzip-'))
    roots.push(root)
    const fake = join(root, 'not-a-zip.zip')
    writeFileSync(fake, 'this is plainly not an archive at all, not even close')
    const result = run(['--zip', fake])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /not a zip archive/)
  })

  it('names the compression method it cannot read', () => {
    // Method 12 (bzip2) is real but unimplemented; returning the raw deflate stream instead
    // would produce a CSV of binary garbage rather than an error.
    const { dir, zip } = exportArchive({ method: 12 })
    const result = run(['--zip', zip, '--out', join(dir, 'report.md')])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /compression method 12/)
  })

  it('refuses an archive that holds no CSV', () => {
    const { zip } = exportArchive({ files: false })
    const result = run(['--zip', zip])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /holds no CSV/)
  })
})

describe('usage pipeline — discovery', () => {
  it('picks by modification time, not by filename', () => {
    // The two orders are deliberately OPPOSITE: the earlier-named file is made the NEWER one, so
    // a discovery that sorted by name would pick September and this test would catch it. Fails if
    // the newest-wins rule is dropped, which would silently analyse a stale export.
    const older = 'usage_data_2026-09-04_2026-10-03.zip'
    const newer = 'usage_data_2026-08-01_2026-08-31.zip'
    const { dir } = exportArchive({ name: older })
    writeFileSync(join(dir, newer), buildZip([
      { name: 'cost-2026-08-01_2026-08-31.csv', content: COST_CSV, method: 8 },
      { name: 'amount-2026-08-01_2026-08-31.csv', content: AMOUNT_CSV, method: 8 },
    ]))
    const t0 = new Date('2026-09-01T00:00:00Z').getTime() / 1000
    utimesSync(join(dir, older), t0, t0)
    utimesSync(join(dir, newer), t0 + 3600, t0 + 3600)

    const result = run(['--downloads', dir, '--out', join(dir, 'report.md')])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /chosen from 2 matches/)
    assert.match(result.stdout, new RegExp(newer.replace(/\./g, '\\.')))
  })

  it('breaks a timestamp tie by filename, later period first', () => {
    // Two exports written in the same instant are a batch download, not a coin toss. Fails if a
    // tie is left to readdir order, which is what made this non-deterministic before.
    const august = 'usage_data_2026-08-01_2026-08-31.zip'
    const september = 'usage_data_2026-09-04_2026-10-03.zip'
    const { dir } = exportArchive({ name: september })
    writeFileSync(join(dir, august), buildZip([
      { name: 'cost-2026-08-01_2026-08-31.csv', content: COST_CSV, method: 8 },
      { name: 'amount-2026-08-01_2026-08-31.csv', content: AMOUNT_CSV, method: 8 },
    ]))
    const t0 = new Date('2026-09-01T00:00:00Z').getTime() / 1000
    utimesSync(join(dir, august), t0, t0)
    utimesSync(join(dir, september), t0, t0)

    const result = run(['--downloads', dir, '--out', join(dir, 'report.md')])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /chosen from 2 matches/)
    assert.match(result.stdout, new RegExp(september.replace(/\./g, '\\.')))
  })

  it('exits 2 naming the directory when nothing matches the pattern', () => {
    // A silent no-op here would read as "the command worked and there was no usage".
    const root = mkdtempSync(join(tmpdir(), 'usage-empty-'))
    roots.push(root)
    const result = run(['--downloads', root])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /nothing matching usage_data_\*\.zip/)
    assert.match(result.stderr, new RegExp(root.replace(/[\\/]/g, '.')))
  })

  it('exits 2 naming the path when the directory does not exist', () => {
    const missing = join(tmpdir(), 'usage-does-not-exist-0000')
    const result = run(['--downloads', missing])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /no directory at/)
  })

  it('derives the report name from the export, not from today', () => {
    // The month in the filename is the month the data covers; stamping "now" would file last
    // month's export under this month. Run in a temporary directory, because this is the one
    // case that exercises the DEFAULT output path — the path relative to the working directory.
    const { dir, zip } = exportArchive()
    const result = run(['--zip', zip], dir)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /docs[\\/]usage[\\/]2026-09\.html/)
    assert.ok(existsSync(join(dir, 'docs', 'usage', '2026-09.html')), 'the default report path was not written under the working directory')
  })

  it('never writes into the kit when run without --out', () => {
    // The regression guard for the bug this file shipped with: the default report path is
    // relative, so a test run from the repository root silently replaced the committed report
    // with synthetic fixture numbers. Fails if `run` ever defaults its working directory back to
    // the kit — the shipped report would change out from under this assertion.
    const shipped = join(KIT, 'docs', 'usage', '2026-09.html')
    const before = existsSync(shipped) ? readFileSync(shipped, 'utf8') : null
    const { zip } = exportArchive()
    const result = run(['--zip', zip])
    assert.equal(result.status, 0, result.stderr)
    assert.notEqual(result.cwd, KIT, 'the pipeline ran in the kit, where it can overwrite a shipped report')
    const after = existsSync(shipped) ? readFileSync(shipped, 'utf8') : null
    assert.equal(after, before, 'a test run modified the shipped report')
  })

  it('writes a standalone HTML page, not markdown', () => {
    // The shipped artifact is a page a human opens, not a text document. Fails if the pipeline
    // stops passing --html and starts emitting markdown under an .html name.
    const { dir, zip } = exportArchive()
    const out = join(dir, 'report.html')
    const result = run(['--zip', zip, '--out', out])
    assert.equal(result.status, 0, result.stderr)
    const page = readFileSync(out, 'utf8')
    assert.ok(page.startsWith('<!doctype html>'), 'the report is not an HTML document')
    assert.match(page, /<title>Usage analysis/)
    assert.ok(!page.includes('|---'), 'markdown table syntax reached the HTML report')
  })

  it('never writes key material into the report it produces', () => {
    // The end-to-end statement of the whole point of the pipeline.
    const { dir, zip } = exportArchive()
    const out = join(dir, 'report.md')
    const result = run(['--zip', zip, '--out', out])
    assert.equal(result.status, 0, result.stderr)
    const report = readFileSync(out, 'utf8')
    assert.ok(!report.includes('sk-FAKEAA'), 'key material reached the shipped report')
    assert.ok(!report.includes('00000000-0000-4000'), 'the account id reached the shipped report')
  })
})
