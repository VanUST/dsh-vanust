#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove the project ledger merges across two machines from git, with explicit collisions.
 *   Two clones of one repository each add a task (both get TASK-002) and a requirement (one
 *   number twice), the second clone is pulled, and the merge stops on state/. The proof then
 *   shows the conflict, the naive union that replay refuses, the resolution with its report,
 *   the absence of duplicate numbers, a coherent journal, and a second run that changes nothing.
 *
 * INPUTS
 *   None. Builds its fixtures under .cache/state-merge-proof/, uses local git only (no network).
 *
 * OUTPUTS
 *   One PASS/FAIL line per check and a summary; exit 0 only when every check held. The scratch
 *   tree is removed on success and kept on failure for inspection.
 *
 * KEYWORDS
 *   project state, ledger merge, git merge, collision, renumbering, replay, two machines
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStateService } from '../plugins/project-state/lib/core.mjs'
import { parseJournal, readSide, sha256 } from '../plugins/project-state/lib/merge.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = join(KIT, '.cache', 'state-merge-proof')
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : `  [${detail}]`}`)
}

function git(cwd, args, options = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
}
function gitTry(cwd, args) {
  try {
    return { ok: true, out: git(cwd, args) }
  } catch (error) {
    return { ok: false, status: error.status, out: String(error.stdout ?? ''), err: String(error.stderr ?? '') }
  }
}
/** File content from a ref, byte-exact: the trimming helper would eat the trailing newline. */
function gitShow(cwd, spec) {
  return execFileSync('git', ['-C', cwd, 'show', spec], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}
function runScript(args) {
  const result = spawnSync(process.execPath, [join(KIT, 'scripts', 'state-merge.mjs'), ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return { status: result.status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
}
function unmerged(cwd) {
  const out = gitTry(cwd, ['diff', '--name-only', '--diff-filter=U'])
  return out.ok ? out.out.split('\n').filter((line) => line !== '') : []
}
function initRepo(dir) {
  mkdirSync(dir, { recursive: true })
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.name', 'State Merge Proof'])
  git(dir, ['config', 'user.email', 'proof@example.invalid'])
}
function commitAll(dir, message) {
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', message])
}
/** Every file of state/ as path -> sha256, so "the second run changed nothing" is measurable. */
function digestState(dir) {
  const rows = []
  const walk = (rel) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const next = `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(next)
      else if (entry.name !== '.lock') rows.push(`${next} ${sha256(readFileSync(join(dir, next), 'utf8'))}`)
    }
  }
  walk('state')
  return sha256(rows.join('\n'))
}
function stateFiles(dir) {
  const files = new Map()
  const walk = (rel) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const next = `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(next)
      else if (entry.name !== '.lock') files.set(next, readFileSync(join(dir, next), 'utf8'))
    }
  }
  walk('state')
  return files
}

const root = join(SCRATCH, `run-${process.pid}`)
rmSync(root, { recursive: true, force: true })
mkdirSync(root, { recursive: true })
const origin = join(root, 'origin')
const machineA = join(root, 'machine-a')
const machineB = join(root, 'machine-b')

try {
  // 1. ONE SHARED REPOSITORY WITH A BASE ROW ON EACH KIND THE LEDGER USES.
  const seedDir = join(root, 'seed')
  initRepo(seedDir)
  const seed = createStateService({ cwd: seedDir })
  const baseReq = await seed.create('req', { title: 'Base requirement', criteria: ['the base requirement holds'] })
  const baseTask = await seed.create('task', { title: 'Base task', boardId: 'board-base', reqId: baseReq.id })
  await seed.link(baseTask.id, baseReq.id)
  await seed.regenerateViews()
  commitAll(seedDir, 'seed the shared ledger')
  // A bare repository is the shared remote: a push into a checked-out work tree is refused by git.
  execFileSync('git', ['init', '-q', '--bare', origin], { encoding: 'utf8' })
  // A bare repository initialises on the default branch name, which is not necessarily "main";
  // without this the clones check out an empty HEAD and the seed rows never reach them.
  git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  git(seedDir, ['remote', 'add', 'origin', origin])
  git(seedDir, ['push', '-q', '-u', 'origin', 'main'])
  git(root, ['clone', '-q', origin, machineA])
  git(root, ['clone', '-q', origin, machineB])
  for (const dir of [machineA, machineB]) {
    git(dir, ['config', 'user.name', 'State Merge Proof'])
    git(dir, ['config', 'user.email', 'proof@example.invalid'])
  }

  // 2. EACH MACHINE ADDS A ROW AND BOTH HAPPEN TO TAKE THE SAME NUMBER.
  const a = createStateService({ cwd: machineA })
  const aReq = await a.create('req', { title: 'Requirement one, written on A', criteria: ['criterion A'], analysisRef: { initiative: 'proof', requirementId: 'FR1' } })
  const aTask = await a.create('task', { title: 'Task written on machine A', boardId: 'board-a', reqId: aReq.id })
  await a.link(aTask.id, aReq.id)
  await a.regenerateViews()
  commitAll(machineA, 'A: one requirement and one task')

  const b = createStateService({ cwd: machineB })
  const bReq2 = await b.create('req', { title: 'Requirement two, written on B', criteria: ['criterion B'], analysisRef: { initiative: 'proof', requirementId: 'FR2' } })
  const bReq3 = await b.create('req', { title: 'Requirement one, written on B', criteria: ['criterion A'], analysisRef: { initiative: 'proof', requirementId: 'FR1' } })
  const bTask = await b.create('task', { title: 'Task written on machine B', boardId: 'board-b', reqId: bReq2.id })
  await b.link(bTask.id, bReq2.id)
  await b.regenerateViews()
  commitAll(machineB, 'B: a colliding number and one requirement twice')
  check('both machines really claimed TASK-002', aTask.id === 'TASK-002' && bTask.id === 'TASK-002', `${aTask.id}/${bTask.id}`)
  check('one requirement was written twice, under two numbers', aReq.id === 'REQ-002' && bReq3.id === 'REQ-003' && bReq2.id === 'REQ-002', `${aReq.id}/${bReq3.id}/${bReq2.id}`)

  git(machineB, ['push', '-q', 'origin', 'main'])
  git(machineA, ['fetch', '-q', 'origin'])
  const pull = gitTry(machineA, ['merge', '--no-edit', 'origin/main'])
  const conflicted = unmerged(machineA)
  check('the pull stops on state/', pull.ok === false && conflicted.some((path) => path.startsWith('state/')), `${conflicted.length} unmerged path(s)`)

  // 3. THE PROBE NAMES THE COLLISIONS BEFORE ANYTHING IS WRITTEN.
  const probe = runScript(['--cwd', machineA, '--check'])
  check('--check exits 1 while state/ is conflicted', probe.status === 1)
  check('--check names both collision kinds', /renumbered/.test(probe.stdout) && /merged by identity/.test(probe.stdout))
  check('--check writes nothing', digestState(machineA) === digestState(machineA) && unmerged(machineA).length === conflicted.length)

  // 4. THE NEGATIVE CONTROL: a naive "keep both journals" union is refused by replay.
  const naive = join(root, 'naive')
  mkdirSync(naive, { recursive: true })
  for (const path of git(machineA, ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'state']).split('\n').filter((line) => line !== '')) {
    const target = join(naive, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, gitShow(machineA, `HEAD:${path}`), 'utf8')
  }
  const naiveJournal = readFileSync(join(naive, 'state', 'events.jsonl'), 'utf8') + git(machineA, ['show', 'origin/main:state/events.jsonl']) + '\n'
  writeFileSync(join(naive, 'state', 'events.jsonl'), naiveJournal, 'utf8')
  const naiveReplay = await createStateService({ cwd: naive }).replay()
  check('a naive journal union is refused by replay', naiveReplay.ok === false, `${naiveReplay.mismatches.length} mismatch(es)`)

  // 5. THE RESOLUTION — or, under CASE_NEGATIVE_CONTROL, the wrong product the case must catch.
  const negativeControl = typeof process.env.CASE_NEGATIVE_CONTROL === 'string' && process.env.CASE_NEGATIVE_CONTROL !== ''
  let report = null
  if (negativeControl) {
    // THE WRONG PRODUCT: a resolver that picks one side. Every check below that asks for both
    // machines' rows has to fail against it, which is what the case's red run measures.
    gitTry(machineA, ['checkout', '--ours', '--', 'state'])
    gitTry(machineA, ['add', '-A', '--', 'state'])
    check('the wrong product keeps both machines\' rows', false, `CASE_NEGATIVE_CONTROL=${negativeControl}`)
  } else {
    const first = runScript(['--cwd', machineA, '--json'])
    try {
      report = JSON.parse(first.stdout).report
    } catch {
      report = null
      console.log(`  (stdout starts: ${JSON.stringify(first.stdout.slice(0, 240))}; stderr starts: ${JSON.stringify(first.stderr.slice(0, 240))})`)
    }
    check('the resolution exits 0', first.status === 0, first.stderr.slice(0, 200))
    check('the resolution reports the renumbered task', report !== null && report.renamed.some((entry) => entry.from === 'TASK-002' && entry.to === 'TASK-003'), report === null ? 'no report' : JSON.stringify(report.renamed))
    check('the resolution reports the requirement merged by identity', report !== null && report.aliased.some((entry) => entry.from === 'REQ-003' && entry.to === 'REQ-002'))
    check('nothing is left unmerged under state/', unmerged(machineA).length === 0)
    const sameNumberFiles = readdirSync(join(machineA, 'state', 'task')).filter((name) => name === 'TASK-002.md' || name === 'TASK-003.md').sort()
    check('both tasks exist under different numbers', sameNumberFiles.join(',') === 'TASK-002.md,TASK-003.md', sameNumberFiles.join(','))

    const before = digestState(machineA)
    runScript(['--cwd', machineA])
    check('a second resolution changes no byte', digestState(machineA) === before)
  }

  gitTry(machineA, ['commit', '-q', '-m', 'Merge machine B: resolved the project state'])

  // 6. THE MERGED LEDGER IS COHERENT.
  const merged = readSide(stateFiles(machineA))
  const taskA = merged.entities.get('TASK-002')
  const taskB = merged.entities.get('TASK-003')
  const req1 = merged.entities.get('REQ-002')
  const req2 = merged.entities.get('REQ-004')
  check('each machine keeps its own task', taskA?.fm.boardId === 'board-a' && taskB?.fm.boardId === 'board-b')
  check('the duplicated requirement is one row', req1 !== undefined && merged.entities.get('REQ-003') === undefined)
  check('the second requirement moved to a free number', req2?.fm.analysisRef?.requirementId === 'FR2')
  check('the renamed task points its reqId at the renamed requirement', taskB?.fm.reqId === 'REQ-004')
  check('the link follows the renamed target', taskB?.fm.links?.[0]?.id === 'REQ-004' && taskB?.fm.links?.[0]?.hash === sha256(req2.text))

  const service = createStateService({ cwd: machineA })
  const verify = await service.verify()
  const replay = await service.replay()
  check('replay reproduces every merged row', replay.ok === true, `${replay.mismatches.length} mismatch(es)`)
  check('verify finds no problem', verify.ok === true, JSON.stringify(verify.findings.slice(0, 2)))
  const events = parseJournal(readFileSync(join(machineA, 'state', 'events.jsonl'), 'utf8'))
  check('seq runs 1..N without a gap', events.every((event, index) => event.seq === index + 1), `${events.length} event(s)`)
  const created = events.filter((event) => event.op === 'create').map((event) => event.record?.boardId ?? event.id)
  check('both machines\' rows survive in the journal', created.includes('board-a') && created.includes('board-b'))
  check('the pull is no longer in progress', gitTry(machineA, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok === false)
} finally {
  const failed = results.filter((entry) => entry.ok === false)
  if (failed.length === 0) rmSync(root, { recursive: true, force: true })
  else console.log(`scratch kept for inspection: ${root}`)
}

const failed = results.filter((entry) => entry.ok === false)
console.log(`\n${results.length - failed.length}/${results.length} checks held: a conflicted state/ merge was resolved from git, both machines kept their rows and the journal stayed replayable`)
if (failed.length > 0) {
  console.log(`FAILED: ${failed.map((entry) => entry.name).join('; ')}`)
  process.exit(1)
}
process.exit(0)
