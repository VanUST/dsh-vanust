import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const PLUGIN = resolve(import.meta.dirname, '..', 'plugins', 'ratchet')
const guardModule = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-guard.mjs`)
const schema = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-schema.mjs`)
const compilerModule = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-compiler.mjs`)
const contradictionModule = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-contradiction.mjs`)

const SOURCE_TEXT = '# Grilling session\n\nWe agreed sessions must move to Redis.\n'
const SOURCE_PATH = 'docs/ratchet/sources/sessions.md'

/**
 * Writes a project whose manifest declares three zones: `auth` requires a decision
 * record and reserves itself to humans, `api` requires one and lets an agent's proposal
 * satisfy it, and `loose` requires nothing. The two governed zones differ only in
 * `agentAuthority`, which is the whole difference the guard's proposal rule turns on.
 */
function project(name, { withRecord = false, status = 'active', authority = 'human' } = {}) {
  const root = join(tmpdir(), `ratchet-guard-${name}-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, '.dsh'), { recursive: true })
  mkdirSync(join(root, 'docs', 'adrs'), { recursive: true })
  mkdirSync(join(root, 'docs', 'ratchet', 'sources'), { recursive: true })
  mkdirSync(join(root, 'src', 'auth'), { recursive: true })
  mkdirSync(join(root, 'src', 'api'), { recursive: true })
  mkdirSync(join(root, 'src', 'loose'), { recursive: true })
  writeFileSync(join(root, 'src', 'auth', 'session.ts'), 'export const x = 1\n')
  writeFileSync(join(root, 'src', 'api', 'handler.ts'), 'export const z = 3\n')
  writeFileSync(join(root, 'src', 'loose', 'util.ts'), 'export const y = 2\n')
  writeFileSync(join(root, SOURCE_PATH), SOURCE_TEXT)
  writeFileSync(
    join(root, '.dsh', 'project.json'),
    `${JSON.stringify(
      {
        manifestVersion: 2,
        name,
        languages: [{ id: 'typescript', extensions: ['.ts'], roots: ['src'] }],
        rules: [],
        ratchet: {
          enabled: true,
          decisionsDir: 'docs/adrs',
          sourcesDir: 'docs/ratchet/sources',
          defaultAgentAuthority: 'proposeOnly',
          zones: [
            { id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly', requiresDecisionRecord: true },
            { id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly', requiresDecisionRecord: true },
            { id: 'loose', paths: ['src/loose/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false },
          ],
        },
      },
      null,
      2,
    )}\n`,
  )
  if (withRecord) writeAdr(root, { status, authority })
  return root
}

/** Writes one ADR, with a correct source hash, at a name derived from its id. */
function writeAdr(root, {
  status = 'active',
  authority = 'human',
  zone = 'auth',
  id = '0001',
  lawId = 'auth.sessions.redis',
  statement = 'Session storage must use Redis.',
  op = 'upsert',
  supersedes = '[]',
} = {}) {
  writeFileSync(
    join(root, 'docs', 'adrs', `${id}-sessions-use-redis.adr.md`),
    [
      '---',
      `id: "${id}"`,
      'title: Sessions use Redis',
      'type: adr',
      `status: ${status}`,
      'author:',
      `  authority: ${authority}`,
      '  name: ada',
      'source:',
      '  kind: file',
      `  path: ${SOURCE_PATH}`,
      `  hash: ${schema.hashSource(readFileSync(join(root, SOURCE_PATH), 'utf8'))}`,
      'zones:',
      `  - ${zone}`,
      `supersedes: ${supersedes}`,
      'approves: []',
      'laws:',
      `  - op: ${op}`,
      `    id: ${lawId}`,
      `    statement: ${statement}`,
      '    checks: []',
      '---',
      '',
      '## Context',
      '',
      'Files break under two instances.',
      '',
      '## Decision',
      '',
      'Session storage must use Redis.',
      '',
      '## Reasoning',
      '',
      'Redis is already deployed and provides TTL, so no new dependency is introduced.',
      '',
      '## Consequences',
      '',
      '- File-backed session adapters are prohibited.',
      '',
    ].join('\n'),
  )
}

/** Runs the guard for one call and returns `'ALLOWED'` or the denial's first line. */
function call(guard, name, args) {
  const reason = guard({ name, arguments: args })
  return reason === undefined ? 'ALLOWED' : `DENIED: ${reason.split('\n')[0]}`
}

// ---------------------------------------------------------------------------

test('guard: a write into a zone requiring a decision record is refused when none exists', () => {
  const root = project('deny')
  const guard = guardModule.createGuard({ root })
  const outcome = call(guard, 'write', { file_path: 'src/auth/session.ts' })
  assert.ok(outcome.startsWith('DENIED:'), outcome)
  assert.ok(outcome.includes('src/auth/session.ts'))
  assert.ok(outcome.includes('"auth"'))
})

test('guard: the denial names the fix, so an agent can satisfy it', () => {
  const root = project('denial-text')
  const guard = guardModule.createGuard({ root })
  const reason = guard({ name: 'edit', arguments: { file_path: 'src/auth/session.ts' } })
  assert.ok(reason.includes('docs/adrs'), 'names the decisions directory')
  assert.ok(reason.includes('Reasoning'), 'names the required section')
  assert.ok(reason.includes('ratchet-cli.mjs hash'), 'names the command that computes the source hash')
  assert.ok(reason.includes('ratchet_compile'), 'names the check to run afterwards')
})

test('guard: writing the record unblocks the write, without restarting anything', () => {
  // The cache must notice the new record. A guard that only re-read after a restart
  // would leave a contributor stuck at the exact moment they complied.
  const root = project('unblock')
  const guard = guardModule.createGuard({ root })
  assert.ok(call(guard, 'write', { file_path: 'src/auth/session.ts' }).startsWith('DENIED:'))

  writeAdr(root, { status: 'active' })
  assert.equal(call(guard, 'write', { file_path: 'src/auth/session.ts' }), 'ALLOWED')
})

test('guard: a PROPOSED agent record licenses the write while adding no law', () => {
  // The autonomy rule. An agent writes the record, keeps working, and a human ratifies,
  // changes or declines it later — so a proposal has to satisfy `requiresDecisionRecord`
  // WITHOUT becoming law. The two halves are asserted separately: the write is allowed, and
  // the state still distinguishes a licence from a decision in force.
  const root = project('proposed-licence')
  const guard = guardModule.createGuard({ root })
  assert.ok(call(guard, 'write', { file_path: 'src/api/handler.ts' }).startsWith('DENIED:'), 'nothing is behind the write yet')

  writeAdr(root, { status: 'proposed', authority: 'agent', zone: 'api', lawId: 'api.sessions.redis' })
  assert.equal(call(guard, 'write', { file_path: 'src/api/handler.ts' }), 'ALLOWED')

  const state = guardModule.loadDecisionState(root)
  assert.equal(state.zonesWithRecords.has('api'), false, 'a proposal is not a decision in force')
  assert.deepEqual(state.licenceByZone.get('api'), { adrId: '0001', path: 'docs/adrs/0001-sessions-use-redis.adr.md' })
  assert.equal(state.conflictsByZone.size, 0, 'and it contradicts nothing')

  // A human's own activation still works, and is a different state.
  writeAdr(root, { status: 'active', authority: 'human', zone: 'api', lawId: 'api.sessions.redis' })
  assert.equal(guardModule.loadDecisionState(root).zonesWithRecords.has('api'), true)
})

test('guard: a PROPOSED record cannot license a zone the manifest reserves to humans', () => {
  // `humanOnly` is the reservation the whole authority model rests on, and an agent's
  // proposal can never become law there — the compiler refuses it even when ratified — so
  // letting it license a write would let an agent govern the zone by writing a file the
  // ratchet then declines to activate.
  const root = project('proposed-human-only')
  writeAdr(root, { status: 'proposed', authority: 'agent', zone: 'auth' })
  const guard = guardModule.createGuard({ root })
  const outcome = call(guard, 'write', { file_path: 'src/auth/session.ts' })
  assert.ok(outcome.startsWith('DENIED:'), outcome)
  assert.equal(guardModule.loadDecisionState(root).licenceByZone.has('auth'), false)
})

test('guard: a proposal that contradicts law in force stops writes until it is edited', () => {
  // The one place autonomy ends. An agent may work ahead of a ratification, but not
  // against what a human already ratified — and the stop must lift on its own when the
  // proposal stops contradicting, with no state to clear and no restart.
  const root = project('contradiction')
  writeAdr(root, {
    status: 'active',
    authority: 'human',
    zone: 'api',
    id: '0001',
    lawId: 'api.sessions.redis',
    statement: 'Session storage must use Redis.',
  })
  const guard = guardModule.createGuard({ root })
  assert.equal(call(guard, 'write', { file_path: 'src/api/handler.ts' }), 'ALLOWED', 'an in-force decision governs the zone')

  writeAdr(root, {
    status: 'proposed',
    authority: 'agent',
    zone: 'api',
    id: '0002',
    lawId: 'api.sessions.redis',
    statement: 'Session storage must use Postgres.',
  })
  const denied = guard({ name: 'write', arguments: { file_path: 'src/api/handler.ts' } })
  assert.equal(typeof denied, 'string', 'the write is refused')
  assert.match(denied, /contradicts/)
  assert.match(denied, /0002/, 'the denial names the proposal that contradicts')

  writeAdr(root, {
    status: 'proposed',
    authority: 'agent',
    zone: 'api',
    id: '0002',
    lawId: 'api.sessions.redis',
    statement: 'Session storage must use Redis.',
  })
  assert.equal(call(guard, 'write', { file_path: 'src/api/handler.ts' }), 'ALLOWED', 'the denial lifts by itself')
})

test('guard: a proposal that removes law in force stops writes too', () => {
  const root = project('removal-contradiction')
  writeAdr(root, { status: 'active', authority: 'human', zone: 'api', id: '0001', lawId: 'api.sessions.redis' })
  writeAdr(root, { status: 'proposed', authority: 'agent', zone: 'api', id: '0002', lawId: 'api.sessions.redis', op: 'remove' })
  const guard = guardModule.createGuard({ root })
  const outcome = guard({ name: 'write', arguments: { file_path: 'src/api/handler.ts' } })
  assert.equal(typeof outcome, 'string', 'the write is refused')
  assert.match(outcome, /removes/)
})

test('guard: a record naming a DIFFERENT zone does not satisfy this one', () => {
  const root = project('other-zone')
  writeAdr(root, { zone: 'loose' })
  const guard = guardModule.createGuard({ root })
  assert.ok(call(guard, 'write', { file_path: 'src/auth/session.ts' }).startsWith('DENIED:'))
})

test('guard: reads are never refused, so reconnaissance stays possible', () => {
  const root = project('reads')
  const guard = guardModule.createGuard({ root })
  assert.equal(call(guard, 'read', { file_path: 'src/auth/session.ts' }), 'ALLOWED')
  assert.equal(call(guard, 'grep', { pattern: 'redis' }), 'ALLOWED')
})

test('guard: the files that satisfy the rule are themselves never refused', () => {
  const root = project('exempt')
  const guard = guardModule.createGuard({ root })
  for (const path of [
    'docs/adrs/0002-new.adr.md',
    'docs/ratchet/sources/new.md',
    '.dsh/project.json',
    '.dsh/ratchet/specs.json',
    'reports/ratchet/verify-report.json',
    'docs/specs/auth.spec.md',
  ]) {
    assert.equal(call(guard, 'write', { file_path: path }), 'ALLOWED', `${path} must stay writable`)
  }
})

test('guard: a zone without requiresDecisionRecord is not guarded', () => {
  const root = project('unguarded-zone')
  const guard = guardModule.createGuard({ root })
  assert.equal(call(guard, 'write', { file_path: 'src/loose/util.ts' }), 'ALLOWED')
})

test('guard: a path in no zone is not guarded', () => {
  const root = project('unzoned')
  const guard = guardModule.createGuard({ root })
  assert.equal(call(guard, 'write', { file_path: 'README.md' }), 'ALLOWED')
  assert.equal(call(guard, 'write', { file_path: 'frontend/app.tsx' }), 'ALLOWED')
})

test('guard: a path outside the project is not this guard\'s business', () => {
  const root = project('outside')
  const guard = guardModule.createGuard({ root })
  assert.equal(call(guard, 'write', { file_path: join(tmpdir(), 'elsewhere', 'x.ts') }), 'ALLOWED')
})

test('guard: a call naming no path is allowed rather than guessed at', () => {
  // Guessing that a shell command mutates a regulated file would refuse work the
  // guard cannot see, and a false denial costs more than a missed one here.
  const root = project('no-path')
  const guard = guardModule.createGuard({ root })
  assert.equal(call(guard, 'pwsh', { command: 'rm -rf src' }), 'ALLOWED')
  assert.equal(call(guard, 'write', {}), 'ALLOWED')
  assert.equal(call(guard, 'write', null), 'ALLOWED')
})

test('guard: a project that never opted in is left completely alone', () => {
  // Inert means inert: a project with no ratchet section must not have writes
  // refused because some other project does.
  const root = join(tmpdir(), `ratchet-guard-inert-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, '.dsh'), { recursive: true })
  writeFileSync(join(root, '.dsh', 'project.json'), JSON.stringify({ manifestVersion: 2, name: 'x', rules: [] }))
  const guard = guardModule.createGuard({ root })
  assert.equal(call(guard, 'write', { file_path: 'src/auth/session.ts' }), 'ALLOWED')

  const empty = join(tmpdir(), `ratchet-guard-nomanifest-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(empty, { recursive: true, force: true })
  mkdirSync(empty, { recursive: true })
  assert.equal(call(guardModule.createGuard({ root: empty }), 'write', { file_path: 'src/auth/session.ts' }), 'ALLOWED')
})

test('guard: a project with no zone declaring requiresDecisionRecord is inert', () => {
  const root = project('no-required-zone')
  const manifest = JSON.parse(readFileSync(join(root, '.dsh', 'project.json'), 'utf8'))
  manifest.ratchet.zones[0].requiresDecisionRecord = false
  writeFileSync(join(root, '.dsh', 'project.json'), JSON.stringify(manifest, null, 2))
  const guard = guardModule.createGuard({ root })
  assert.equal(call(guard, 'write', { file_path: 'src/auth/session.ts' }), 'ALLOWED')
})

test('guard: relative and absolute paths are judged identically', () => {
  const root = project('absolute')
  const guard = guardModule.createGuard({ root })
  const relativeOutcome = call(guard, 'write', { file_path: 'src/auth/session.ts' })
  const absoluteOutcome = call(guard, 'write', { file_path: join(root, 'src', 'auth', 'session.ts') })
  assert.ok(relativeOutcome.startsWith('DENIED:'))
  assert.equal(absoluteOutcome, relativeOutcome, 'the same file must be refused however it is spelled')
})

test('guard: alternative path argument names are recognised', () => {
  const root = project('alt-args')
  const guard = guardModule.createGuard({ root })
  for (const key of ['file_path', 'path', 'filePath', 'filename']) {
    assert.ok(
      call(guard, 'write', { [key]: 'src/auth/session.ts' }).startsWith('DENIED:'),
      `${key} must be recognised as the target path`,
    )
  }
})

test('governanceOf: the exempt paths are exempt for stated reasons', () => {
  const root = project('governance')
  const state = guardModule.loadDecisionState(root)
  for (const path of ['.dsh/project.json', 'docs/adrs/0001-x.adr.md', 'docs/ratchet/sources/x.md', '.dsh/ratchet/specs.json', 'reports/ratchet/x.json', 'docs/specs/auth.spec.md']) {
    const governance = guardModule.governanceOf(path, state.config)
    assert.equal(governance.governed, false, `${path} must not be governed`)
    assert.ok(typeof governance.reason === 'string' && governance.reason.length > 0, `${path} needs a stated reason`)
  }
  const governed = guardModule.governanceOf('src/auth/session.ts', state.config)
  assert.equal(governed.governed, true)
  assert.equal(governed.zone.id, 'auth')
})

/** Rewrites the manifest's zone policy, the way an operator editing `.dsh/project.json` would. */
function setZonePolicy(root, zoneId, patch) {
  const path = join(root, '.dsh', 'project.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  const zone = manifest.ratchet.zones.find((entry) => entry.id === zoneId)
  Object.assign(zone, patch)
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

test('guard: a law retired by an in-force removal is not law in force', () => {
  // The guard's law set must be the COMPILER's set. It began as a local loop over the
  // active records that skipped `op: remove` and knew nothing about the rule that an agent
  // record may not retire a human-ratified law, so it disagreed with `compileLaws` exactly
  // where a second implementation does: a law the corpus had RETIRED was still treated as in
  // force, and a proposal that redeclared it was refused for contradicting a law that no
  // longer existed. A breaker found this by compiling the same fixture and getting zero
  // laws while the guard reported a contradiction.
  const root = project('retired-law')
  writeAdr(root, { status: 'active', authority: 'human', zone: 'api', id: '0001', lawId: 'api.sessions.redis', statement: 'Session storage must use Redis.' })
  writeAdr(root, { status: 'active', authority: 'human', zone: 'api', id: '0002', lawId: 'api.sessions.redis', op: 'remove' })
  writeAdr(root, { status: 'proposed', authority: 'agent', zone: 'api', id: '0003', lawId: 'api.sessions.redis', statement: 'Session storage must use Postgres.' })
  const guard = guardModule.createGuard({ root })
  assert.equal(
    call(guard, 'write', { file_path: 'src/api/handler.ts' }),
    'ALLOWED',
    'the proposal redeclares a law the corpus retired, so it contradicts nothing in force',
  )
})

test('guard: the cache notices a manifest change, in both directions', () => {
  // The answer depends on the zones table, so a cache keyed on the decisions directory
  // alone served a stale allow after the operator asked for a denial, and a stale denial
  // after they lifted one — until something unrelated touched the corpus.
  const root = project('manifest-cache')
  const guard = guardModule.createGuard({ root })
  assert.ok(
    call(guard, 'write', { file_path: 'src/api/handler.ts' }).startsWith('DENIED:'),
    'the fixture governs api, and nothing names it yet',
  )

  // Lifting the policy: the stale-DENIAL direction.
  setZonePolicy(root, 'api', { requiresDecisionRecord: false })
  assert.equal(call(guard, 'write', { file_path: 'src/api/handler.ts' }), 'ALLOWED', 'lifting it is seen without a restart')

  // And imposing it: the stale-ALLOW direction.
  setZonePolicy(root, 'api', { requiresDecisionRecord: true })
  assert.ok(call(guard, 'write', { file_path: 'src/api/handler.ts' }).startsWith('DENIED:'), 'and so is imposing it')

  setZonePolicy(root, 'api', { requiresDecisionRecord: false })
  assert.equal(call(guard, 'write', { file_path: 'src/api/handler.ts' }), 'ALLOWED', 'and lifting it again')
})

test('guard: every writer the harness can mount is governed, not only the names on the list', () => {
  // `str_replace_editor` is a real writer in this harness with a `path` argument, and it was
  // absent from the list, so a governed zone was open to it. A name-based allow-list is a
  // rule for the names somebody thought to write down; the omission was invisible because the
  // tool is opt-in and not mounted in every profile.
  const root = project('other-writers')
  const guard = guardModule.createGuard({ root })
  for (const name of ['str_replace_editor', 'write', 'edit', 'multi_edit', 'notebook_edit']) {
    assert.ok(
      call(guard, name, { file_path: 'src/auth/session.ts' }).startsWith('DENIED:'),
      `${name} must be governed`,
    )
  }
})

/** Rewrites one zone's `paths`, the way an operator editing `.dsh/project.json` would. */
function setZonePaths(root, zoneId, paths) {
  const path = join(root, '.dsh', 'project.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  manifest.ratchet.zones.find((entry) => entry.id === zoneId).paths = paths
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

test('guard: a zone that claims the whole repository governs the whole repository', () => {
  // A breaker falsified this: `paths: ["**"]` parsed with no problem and then governed
  // NOTHING, because zone membership was a directory-prefix test while file selection used the
  // project's glob matcher. The manifest accepted a declaration the guard ignored.
  const root = project('whole-repo')
  setZonePaths(root, 'api', ['**'])
  const guard = guardModule.createGuard({ root })
  mkdirSync(join(root, 'docs', 'inner'), { recursive: true })
  assert.ok(
    call(guard, 'write', { file_path: 'docs/inner/x.md' }).startsWith('DENIED:'),
    'a path no other zone names is still governed by a whole-repository zone',
  )
})

test('guard: a zone path is the glob it is written as, not a prefix of it', () => {
  const root = project('zone-globs')

  // A wildcard in the middle used to match nothing at all.
  setZonePaths(root, 'api', ['src/*/api/**'])
  const guard = guardModule.createGuard({ root })
  assert.ok(
    call(guard, 'write', { file_path: 'src/deep/api/x.ts' }).startsWith('DENIED:'),
    'a wildcard between two segments is honoured',
  )
  assert.equal(
    call(guard, 'write', { file_path: 'src/api/handler.ts' }),
    'ALLOWED',
    'and it is one segment, not a prefix that swallows a sibling path',
  )

  // A trailing single star is one segment deep, and used to deny deeper paths it does not cover.
  setZonePaths(root, 'api', ['src/api/*'])
  mkdirSync(join(root, 'src', 'api', 'deep'), { recursive: true })
  assert.ok(call(guard, 'write', { file_path: 'src/api/handler.ts' }).startsWith('DENIED:'), 'one segment is covered')
  assert.equal(
    call(guard, 'write', { file_path: 'src/api/deep/x.ts' }),
    'ALLOWED',
    'a deeper path is outside a single-star zone',
  )
})

test('guard: a write through a symlink into a governed zone is governed', () => {
  // The guard compared strings, so a link made a governed zone reachable from a path that read
  // as ungoverned. The harness filesystem writes THROUGH a symlink to its target.
  const root = project('symlink')
  mkdirSync(join(root, 'staging'), { recursive: true })
  symlinkSync(join(root, 'src', 'auth'), join(root, 'staging', 'link'))
  const guard = guardModule.createGuard({ root })
  assert.ok(call(guard, 'write', { file_path: 'src/auth/session.ts' }).startsWith('DENIED:'), 'the zone itself is governed')
  assert.ok(
    call(guard, 'write', { file_path: 'staging/link/session.ts' }).startsWith('DENIED:'),
    'and so is the same file reached through a link',
  )
})

test('guard: a rewrite that keeps a record size and mtime is still noticed', () => {
  // The cache key was name:size:mtimeMs, so a same-size rewrite whose mtime was restored was
  // invisible and a proposal that contradicted law in force stayed allowed. `ctimeNs` is the
  // field a writer cannot set, which is why the key carries it.
  const root = project('cache-forge')
  const proposal = join(root, 'docs', 'adrs', '0002-sessions-use-redis.adr.md')
  writeAdr(root, { status: 'active', authority: 'human', zone: 'api', id: '0001', lawId: 'api.sessions.redis', statement: 'Session storage must use Redis.' })
  writeAdr(root, { status: 'proposed', authority: 'agent', zone: 'api', id: '0002', lawId: 'api.sessions.redis', statement: 'Session storage must use Redis.' })

  const guard = guardModule.createGuard({ root })
  assert.equal(call(guard, 'write', { file_path: 'src/api/handler.ts' }), 'ALLOWED', 'an agreeing proposal contradicts nothing')

  // A FIXED timestamp, set twice, so the two revisions really do share a size and an
  // mtime to the millisecond — which is what the old key compared.
  const stamp = new Date('2026-09-15T00:00:00Z')
  utimesSync(proposal, stamp, stamp)
  const before = statSync(proposal)

  // Same byte length ('Redis.' -> 'Nginx.'), same timestamp.
  writeAdr(root, { status: 'proposed', authority: 'agent', zone: 'api', id: '0002', lawId: 'api.sessions.redis', statement: 'Session storage must use Nginx.' })
  utimesSync(proposal, stamp, stamp)
  const after = statSync(proposal)
  assert.equal(after.size, before.size, 'the fixture really is a same-size rewrite')
  assert.equal(after.mtimeMs, before.mtimeMs, 'and the mtime really was restored')

  assert.ok(
    call(guard, 'write', { file_path: 'src/api/handler.ts' }).startsWith('DENIED:'),
    'the contradicting proposal is seen despite the restored mtime',
  )
})

test('guard: reading through an editor tool is reconnaissance, not a write', () => {
  // Governing the tool NAME refused `str_replace_editor {command: "view"}`, which is the read
  // decision 4 says must never be refused.
  const root = project('editor-view')
  const guard = guardModule.createGuard({ root })
  assert.equal(
    call(guard, 'str_replace_editor', { command: 'view', path: 'src/auth/session.ts' }),
    'ALLOWED',
    'a view is a read',
  )
  for (const command of ['create', 'str_replace', 'insert']) {
    assert.ok(
      call(guard, 'str_replace_editor', { command, path: 'src/auth/session.ts' }).startsWith('DENIED:'),
      `${command} changes the file and is governed`,
    )
  }
  assert.ok(
    call(guard, 'str_replace_editor', { path: 'src/auth/session.ts' }).startsWith('DENIED:'),
    'an unrecognised command is treated as a write, not as a read',
  )
})

test('guard: a symlinked project root is judged by where the write lands', () => {
  // The guard compared the LEXICAL path against the root before resolving anything, so an absolute
  // path spelled through the project's REAL location — which is what a symlinked session cwd
  // produces — was answered before the filesystem was asked, and landed in a governed zone with no
  // record and an ALLOW.
  const real = project('symlinked-root')
  const link = `${real}-link`
  symlinkSync(real, link)
  const guard = guardModule.createGuard({ root: link })
  assert.ok(call(guard, 'write', { file_path: 'src/auth/session.ts' }).startsWith('DENIED:'), 'the relative spelling is governed')
  assert.ok(
    call(guard, 'write', { file_path: join(real, 'src', 'auth', 'session.ts') }).startsWith('DENIED:'),
    'and so is the absolute spelling through the real root — the same file',
  )
})

test('guard: a symlink outside the project pointing into a governed zone is governed', () => {
  // An alias anywhere on the machine made a governed zone writable with no ADR at all, because the
  // alias path reads as outside the project and the lexical check answered first.
  const root = project('outside-alias')
  const alias = join(tmpdir(), `ratchet-guard-alias-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(alias, { recursive: true, force: true })
  symlinkSync(join(root, 'src', 'auth'), alias)
  try {
    const guard = guardModule.createGuard({ root })
    assert.ok(
      call(guard, 'write', { file_path: join(alias, 'new.ts') }).startsWith('DENIED:'),
      'a write through the alias lands in the zone',
    )
  } finally {
    rmSync(alias, { force: true })
  }
})

test('guard: a zone naming a directory governs that directory', () => {
  // Reading a wildcard-free zone path as an exact path was a silent narrowing: `src/api` governed
  // `src/api` and nothing under it, while the compiler's authority check still treated the subtree
  // as inside. A zone names a directory.
  const root = project('bare-directory-zone')
  setZonePaths(root, 'api', ['src/api'])
  const guard = guardModule.createGuard({ root })
  assert.ok(
    call(guard, 'write', { file_path: 'src/api/handler.ts' }).startsWith('DENIED:'),
    'a path with no wildcard names a directory, so its subtree is governed',
  )
})

test('guard: a judge-classified contradiction stops the work, and follows the text it judged', () => {
  // The semantic tier had no enforcement point: a judge could classify a change as contradicting a
  // decision in meaning, and the change went in anyway because no written check could see it. The
  // guard refuses it now, quoting the judge's own reasoning, and a block bound to a PROPOSED record
  // retires by itself when that record is edited — the same property the mechanical tier has.
  const root = project('judged-contradiction')
  // The zone does NOT require a record, on purpose: the judged-contradiction rule is the price of
  // enabling the ratchet, not of opting a zone into the record rule.
  setZonePolicy(root, 'api', { requiresDecisionRecord: false })
  writeAdr(root, {
    status: 'active',
    authority: 'human',
    zone: 'api',
    id: '0001',
    lawId: 'api.sessions.redis',
    statement: 'Session storage must use Redis.',
  })
  writeAdr(root, {
    status: 'proposed',
    authority: 'agent',
    zone: 'api',
    id: '0002',
    lawId: 'api.sessions.redis',
    statement: 'Session storage must use Redis.',
  })

  const guard = guardModule.createGuard({ root })
  assert.equal(call(guard, 'write', { file_path: 'src/api/handler.ts' }), 'ALLOWED', 'nothing has been judged yet')

  const manifest = compilerModule.readManifest(root)
  const corpus = compilerModule.readAdrCorpus(root, manifest.config)
  const proposal = corpus.records.find((record) => record.id === '0002')
  contradictionModule.recordContradiction(root, {
    target: { kind: 'proposal', id: '0002', hash: proposal.contentHash },
    job: 'review_proposal',
    findings: [
      {
        severity: 'error',
        kind: 'semantic_violation',
        lawId: 'api.sessions.redis',
        sourceAdr: '0001',
        explanation: 'a file-backed adapter satisfies the letter of the law and inverts what it was for',
        suggestedAction: 'keep the Redis adapter',
      },
    ],
  })

  const denied = guard({ name: 'write', arguments: { file_path: 'src/api/handler.ts' } })
  assert.equal(typeof denied, 'string', 'the write is refused')
  assert.match(denied, /CONTRADICTING/)
  assert.match(denied, /api\.sessions\.redis/, "the denial names the law")
  assert.match(denied, /inverts what it was for/, "and carries the judge's own reasoning")
  assert.match(denied, /keep the Redis adapter/, 'and the judge\'s suggestion')
  assert.match(denied, /ratchet_ratify/, 'and a route out that involves a human')
  // A path outside every blocked zone is untouched by the block.
  assert.equal(call(guard, 'write', { file_path: 'src/loose/util.ts' }), 'ALLOWED')

  // Editing the proposal moves the hash the finding was bound to, so the block retires by itself.
  writeAdr(root, {
    status: 'proposed',
    authority: 'agent',
    zone: 'api',
    id: '0002',
    lawId: 'api.sessions.redis',
    statement: 'Session storage must use Nginx.',
  })
  assert.equal(
    call(guard, 'write', { file_path: 'src/api/handler.ts' }),
    'ALLOWED',
    'the block follows the text the judge read, so editing it lifts the refusal',
  )
})
