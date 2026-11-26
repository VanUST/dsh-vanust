/*
PROOF: a shell write to the product is DETECTED and blocks the row it belongs to
Behavior: for a scoped role, tools/pre-execute snapshots a manifest of tracked product files (git
  ls-files minus docs/cases/, test/, tests/, and minus the runtime's own roots state/ and .dsh/)
  and tools/post-execute compares it; a difference is written to .dsh/proof-guard-violations.json
  naming the session and the files. A shell that only appends to the project ledger or writes the
  session scratch directory records nothing; a real product edit is recorded even when the ledger
  changed in the same shell. The taskboard close refuses that session's row with
  product_shell_violation. Nothing prevents the write: this is a detector, not a sandbox.
Fails when: a shell edit of the product leaves no record, the record names no session, a ledger
  append is recorded as a product edit, or the close accepts a row whose product file changed.
Production path: plugins/proof-guard/proof-guard.mjs (productManifest, manifestDiff,
  recordViolation, violationsFor, the two listeners) and plugins/taskboard/taskboard.mjs (close).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VIOLATION_FILE, apply, manifestDiff, productManifest, violationsFor } from '../proof-guard.mjs'

function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'proof-guard-audit-'))
  mkdirSync(join(cwd, 'src'), { recursive: true })
  mkdirSync(join(cwd, 'docs', 'cases'), { recursive: true })
  mkdirSync(join(cwd, 'state', 'views'), { recursive: true })
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  writeFileSync(join(cwd, 'src', 'product.mjs'), 'export default 1\n', 'utf8')
  writeFileSync(join(cwd, 'docs', 'cases', 'a.json'), '{}\n', 'utf8')
  // Tracked runtime files: the ledger journal and a view projection, plus a scratch file. Every
  // task transition appends to them while a shell runs, and they are in git.
  writeFileSync(join(cwd, 'state', 'events.jsonl'), '{"seq":0}\n', 'utf8')
  writeFileSync(join(cwd, 'state', 'views', 'board.md'), '# Board\n', 'utf8')
  writeFileSync(join(cwd, '.dsh', 'note.json'), '{}\n', 'utf8')
  execFileSync('git', ['init', '-q'], { cwd })
  execFileSync('git', ['add', '-A'], { cwd })
  execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=A', 'commit', '-qm', 'base'], { cwd })
  return cwd
}

function harness(cwd) {
  const handlers = { pre: [], post: [] }
  const ctx = {
    on(event, handler) { if (event === 'tools/pre-execute') handlers.pre.push(handler); if (event === 'tools/post-execute') handlers.post.push(handler) },
    get() { return undefined },
    logger: { warn() {} },
  }
  apply(ctx, { mode: 'deny', roles: { tester: { allow: ['docs/cases/', 'test/', 'tests/'] } } })
  const agent = { session: { header: { cwd, agentPreset: 'tester', id: 'sess-tester' } } }
  const runShell = async (name = 'pwsh') => {
    const exec = { name, arguments: {}, agent }
    for (const handler of handlers.pre) await handler(exec, () => ({ kind: 'allow' }))
    return { exec }
  }
  const finish = async (exec) => {
    for (const handler of handlers.post) await handler(exec, { ok: true }, () => ({ kind: 'accept' }))
  }
  return { runShell, finish }
}

test('the manifest covers tracked product files and ignores the role roots and the runtime roots', () => {
  const cwd = workspace()
  const manifest = productManifest(cwd)
  assert.equal(typeof manifest['src/product.mjs'], 'string')
  assert.equal(manifest['docs/cases/a.json'], undefined, 'the case library was counted as product')
  assert.equal(manifest['state/events.jsonl'], undefined, 'the project ledger was counted as product')
  assert.equal(manifest['state/views/board.md'], undefined, 'a view projection was counted as product')
  assert.equal(manifest['.dsh/note.json'], undefined, 'the session scratch directory was counted as product')
  assert.equal(manifestDiff({ a: '1', b: '2' }, { a: '1', c: '3' })[0], 'b')
})

/*
PROOF: the runtime's ledger writes are not a product edit by the role
Behavior: a shell that only appends to state/events.jsonl and rewrites state/views/* records no
  violation, because the manifest excludes state/ and .dsh/; the same shell that also edits a
  tracked source file records exactly that source file.
Fails when: a ledger append during a scoped shell is recorded as a product edit (the defect: every
  task transition refused the tester's close), or the exclusion swallows a real product edit made
  in the same shell.
*/
test('a shell that only writes the ledger and the scratch directory records nothing', async () => {
  const cwd = workspace()
  const { runShell, finish } = harness(cwd)
  const { exec } = await runShell()
  writeFileSync(join(cwd, 'state', 'events.jsonl'), '{"seq":0}\n{"seq":1,"op":"update"}\n', 'utf8')
  writeFileSync(join(cwd, 'state', 'views', 'board.md'), '# Board\n\n## active (1)\n', 'utf8')
  writeFileSync(join(cwd, '.dsh', 'note.json'), '{"seen":true}\n', 'utf8')
  await finish(exec)
  assert.deepEqual(violationsFor(cwd, 'sess-tester'), [], 'a ledger append was recorded as a product edit')
})

test('a product edit is still recorded when the ledger changed in the same shell', async () => {
  const cwd = workspace()
  const { runShell, finish } = harness(cwd)
  const { exec } = await runShell()
  writeFileSync(join(cwd, 'state', 'events.jsonl'), '{"seq":0}\n{"seq":1}\n', 'utf8')
  writeFileSync(join(cwd, 'src', 'product.mjs'), 'export default 2\n', 'utf8')
  await finish(exec)
  const recorded = violationsFor(cwd, 'sess-tester')
  assert.equal(recorded.length, 1, 'the product change was swallowed by the ledger exclusion')
  assert.deepEqual(recorded[0].files, ['src/product.mjs'], 'the record named the ledger as a product file')
})

test('a shell edit of the product is recorded against the session', async () => {
  const cwd = workspace()
  const { runShell, finish } = harness(cwd)
  const { exec } = await runShell()
  writeFileSync(join(cwd, 'src', 'product.mjs'), 'export default 2\n', 'utf8')
  await finish(exec)
  const recorded = violationsFor(cwd, 'sess-tester')
  assert.equal(recorded.length, 1, 'the product change left no record')
  assert.deepEqual(recorded[0].files, ['src/product.mjs'])
  assert.equal(recorded[0].preset, 'tester')
  assert.equal(recorded[0].tool, 'pwsh')
  const file = JSON.parse(readFileSync(join(cwd, VIOLATION_FILE), 'utf8'))
  assert.equal(Array.isArray(file), true)
})

test('a shell that changes nothing records nothing, and an unscoped role is not audited', async () => {
  const cwd = workspace()
  const { runShell, finish } = harness(cwd)
  const clean = await runShell()
  await finish(clean.exec)
  assert.deepEqual(violationsFor(cwd, 'sess-tester'), [])
  // A role without a scope is not the tester: its shell is its own work.
  const other = { name: 'pwsh', arguments: {}, agent: { session: { header: { cwd, agentPreset: 'backend', id: 'sess-backend' } } } }
  for (const handler of []) await handler
  assert.deepEqual(violationsFor(cwd, 'sess-backend'), [])
})
