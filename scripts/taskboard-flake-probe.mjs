/*
PROOF: a flaky file is caught with the name of the test that failed, not just a count
Behavior: runs the taskboard suite N times (default 6) IN PARALLEL with the TAP reporter, keeps each
  run's log under %TEMP%, and prints every `not ok` line with the run that produced it. Exit 1 when
  any run failed, 0 when all passed - so a flake is a named test, not "pass 49 fail 1".
Fails when: the probe reports only counts, or a failing run leaves no log behind to read.
Production path: scripts/taskboard-flake-probe.mjs (this file); it does not touch the plugins.
*/
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runs = Number.parseInt(process.argv[2] ?? '6', 10)
const dir = mkdtempSync(join(tmpdir(), 'taskboard-flake-'))
const one = (index) => new Promise((done) => {
  const log = join(dir, `run-${index}.tap`)
  const child = spawn(process.execPath, ['--test', '--test-reporter=tap', 'plugins/taskboard/test/board-lock.test.mjs'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (chunk) => { out += chunk })
  child.stderr.on('data', (chunk) => { out += chunk })
  child.on('close', (code) => {
    writeFileSync(log, out, 'utf8')
    const failing = out.split('\n').filter((line) => line.startsWith('not ok')).map((line) => line.trim())
    done({ index, code, log, failing })
  })
})

const results = await Promise.all(Array.from({ length: runs }, (_, index) => one(index + 1)))
const failed = results.filter((result) => result.code !== 0)
for (const result of failed) {
  console.log(`run ${result.index} failed (exit ${result.code}); log ${result.log}`)
  for (const line of result.failing) console.log('  ' + line)
}
console.log(`${runs - failed.length}/${runs} runs green; logs in ${dir}`)
process.exit(failed.length === 0 ? 0 : 1)
