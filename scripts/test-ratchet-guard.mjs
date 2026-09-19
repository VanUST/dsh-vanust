import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const PLUGIN = resolve(import.meta.dirname, '..', 'plugins', 'ratchet')
const KIT_ROOT = resolve(import.meta.dirname, '..')
const guardModule = await import(pathToFileURL(join(PLUGIN, "ratchet-guard.mjs")).href)
const schema = await import(pathToFileURL(join(PLUGIN, "ratchet-schema.mjs")).href)
const compilerModule = await import(pathToFileURL(join(PLUGIN, "ratchet-compiler.mjs")).href)
const contradictionModule = await import(pathToFileURL(join(PLUGIN, "ratchet-contradiction.mjs")).href)
const ops = await import(pathToFileURL(join(PLUGIN, "ratchet-ops.mjs")).href)

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

/**
 * Links a directory so that the same path resolves through it, on every platform.
 *
 * @param target - Absolute path of the directory the link points at.
 * @param path - Absolute path of the link to create.
 * @returns Nothing. Throws when the platform refuses to create the link.
 */
function linkDirectory(target, path) {
  // Windows refuses an unprivileged SYMLINK (EPERM) unless Developer Mode is on, which would have
  // meant skipping the three tests whose subject is a link — on the platform this kit is authored
  // on, and a skipped test is not evidence. A directory JUNCTION needs no privilege, resolves
  // through realpath exactly as a symlink does, and is reported as a symlink by `lstat`, so the
  // same code path in the guard is exercised either way.
  if (process.platform === 'win32') {
    symlinkSync(target, path, 'junction')
  } else {
    symlinkSync(target, path)
  }
}

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
  linkDirectory(join(root, 'src', 'auth'), join(root, 'staging', 'link'))
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
  linkDirectory(real, link)
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
  linkDirectory(join(root, 'src', 'auth'), alias)
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

test('guard: a malformed contradiction record never throws and never lifts a standing block', () => {
  // `findings` is read from a FILE, so it can be anything. `?? []` does not guard a non-iterable and
  // iterating it threw — and the guard's catch-all turned that throw into an ALLOW, so corrupting
  // the record BYPASSED the block it recorded. The block is mapped from the target's record as well
  // as from the findings, so a malformed findings list still refuses the zone it was about.
  const root = project('malformed-contradiction')
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
  const manifest = compilerModule.readManifest(root)
  const corpus = compilerModule.readAdrCorpus(root, manifest.config)
  const proposal = corpus.records.find((record) => record.id === '0002')

  const guard = guardModule.createGuard({ root })
  const wellFormed = {
    version: 1,
    entries: {
      'proposal:0002': {
        target: { kind: 'proposal', id: '0002', hash: proposal.contentHash },
        findings: [{ severity: 'error', kind: 'semantic_violation', lawId: 'api.sessions.redis', explanation: 'inverts the decision' }],
      },
    },
  }
  const path = join(root, '.dsh', 'ratchet', 'contradiction.json')
  mkdirSync(dirname(path), { recursive: true })
  const write = (entries) => writeFileSync(path, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`)

  write(wellFormed.entries)
  assert.ok(call(guard, 'write', { file_path: 'src/api/handler.ts' }).startsWith('DENIED:'), 'a well-formed block denies')

  // An intact TARGET is what places the block; the findings only name the laws. So a record whose
  // findings are unreadable must still refuse the zone its target names, and one whose target is
  // gone has nothing left to place — which is an ALLOW, and the only honest answer.
  const malformed = [
    { entries: { 'proposal:0002': { target: { kind: 'proposal', id: '0002', hash: proposal.contentHash }, findings: 5 } }, refuses: true },
    { entries: { 'proposal:0002': { target: { kind: 'proposal', id: '0002', hash: proposal.contentHash }, findings: { a: 1 } } }, refuses: true },
    { entries: { 'proposal:0002': { target: { kind: 'proposal', id: '0002', hash: proposal.contentHash }, findings: [null] } }, refuses: true },
    { entries: { 'proposal:0002': { target: { kind: 'proposal', id: '0002', hash: proposal.contentHash }, findings: 'x' } }, refuses: true },
    { entries: { 'proposal:0002': { target: null, findings: [null] } }, refuses: false },
    { entries: { 'proposal:0002': null }, refuses: false },
  ]
  for (const { entries, refuses } of malformed) {
    write(entries)
    assert.doesNotThrow(() => guardModule.loadDecisionState(root), `loadDecisionState threw for ${JSON.stringify(entries)}`)
    const verdict = call(guard, 'write', { file_path: 'src/api/handler.ts' })
    assert.equal(
      verdict.startsWith('DENIED:'),
      refuses,
      `corrupt record ${JSON.stringify(entries)} should ${refuses ? 'refuse' : 'not refuse'} — got ${verdict}`,
    )
  }
})

test('guard: a judge-classified contradiction leaves the way out writable', () => {
  // Counterexample: the contradiction check runs FIRST and resolves a path by `zoneFor`, so a
  // zone broad enough to cover the decisions or sources directory refused the very record that
  // could resolve the block. The documented ways out — edit the proposal, or ask a human — were
  // deadlocked: the block's only cure was an edit the guard would not let through.
  const root = project('judged-exit')
  setZonePolicy(root, 'api', { requiresDecisionRecord: false, paths: ['src/api/**', 'docs/**'] })
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
        explanation: 'a file-backed adapter inverts the decision',
        suggestedAction: 'keep the Redis adapter',
      },
    ],
  })

  const guard = guardModule.createGuard({ root })
  assert.ok(
    call(guard, 'write', { file_path: 'src/api/handler.ts' }).startsWith('DENIED:'),
    'the governed zone itself is still refused',
  )
  assert.equal(call(guard, 'write', { file_path: 'docs/adrs/0002-edited.adr.md' }), 'ALLOWED', 'the record is where the cure is written')
  assert.equal(call(guard, 'write', { file_path: 'docs/ratchet/sources/x.md' }), 'ALLOWED', 'and so is the reasoning it cites')
})

test('guard: deleting the contradiction JSON does not lift the block, but clearing it does', () => {
  // Counterexample: the JSON file was the only record, so `rm .dsh/ratchet/contradiction.json`
  // lifted a block a judge had just recorded. The ledger event is the durable copy now; only the
  // ratchet's own clear retires it.
  const root = project('contradiction-ledger')
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
  const manifest = compilerModule.readManifest(root)
  const corpus = compilerModule.readAdrCorpus(root, manifest.config)
  const proposal = corpus.records.find((record) => record.id === '0002')
  const target = { kind: 'proposal', id: '0002', hash: proposal.contentHash }
  contradictionModule.recordContradiction(root, {
    target,
    job: 'review_proposal',
    findings: [
      {
        severity: 'error',
        kind: 'semantic_violation',
        lawId: 'api.sessions.redis',
        sourceAdr: '0001',
        explanation: 'a file-backed adapter inverts the decision',
      },
    ],
  })

  const guard = guardModule.createGuard({ root })
  assert.ok(call(guard, 'write', { file_path: 'src/api/handler.ts' }).startsWith('DENIED:'), 'the block stands as recorded')

  // Deleting the cache must not lift it: the ledger still folds to the recorded entry.
  rmSync(join(root, '.dsh', 'ratchet', 'contradiction.json'), { force: true })
  assert.ok(
    call(guard, 'write', { file_path: 'src/api/handler.ts' }).startsWith('DENIED:'),
    'the block survives deleting the JSON cache',
  )

  // Clearing it through the ratchet appends a `cleared` event and is the only thing that lifts it.
  assert.equal(contradictionModule.clearContradiction(root, target), true, 'the clear is recorded')
  assert.equal(call(guard, 'write', { file_path: 'src/api/handler.ts' }), 'ALLOWED', 'and the guard sees it')
})


// ---------------------------------------------------------------------------
// The judgement fact: implementation mode requires that a review has READ the law
// set now in force. This is the deterministic half of the meaning requirement —
// whether a judgement was made is a fact about the ledger, while what it concluded
// is a judge's and reaches the write guard as a recorded block.
// ---------------------------------------------------------------------------

const REVIEW_HASH_A = `sha256:${'a'.repeat(64)}`
const REVIEW_HASH_B = `sha256:${'b'.repeat(64)}`

test('review status: no recorded review is stale, a review of the current law set is not, and a moved law set is again', () => {
  // Fails if the status stops comparing the recorded hash with the current one, which
  // is what makes "a judgement has been made about these laws" checkable without a
  // model. The two hashes differ, so a status that merely finds an event cannot pass.
  const root = project('review-status')
  const none = ops.contradictionReviewStatus(root, REVIEW_HASH_A)
  assert.equal(none.reviewed, false, 'a project nobody has reviewed reports no review')
  assert.equal(none.stale, true, 'and it is stale: an unlooked-at corpus is not a checked one')
  assert.match(none.reason, /no contradiction review has ever been recorded/)

  // The ledger lives in the ratchet's own state directory, which a project that has
  // never compiled does not have yet.
  mkdirSync(join(root, '.dsh', 'ratchet'), { recursive: true })
  appendFileSync(
    join(root, '.dsh', 'ratchet', 'ledger.jsonl'),
    `${JSON.stringify({ event: 'ratchet.contradiction.reviewed', at: '2026-01-01T00:00:00.000Z', job: 'review_corpus', specHash: REVIEW_HASH_A, advisory: true })}\n`,
  )
  const current = ops.contradictionReviewStatus(root, REVIEW_HASH_A)
  assert.equal(current.reviewed, true)
  assert.equal(current.stale, false, 'a review of exactly this law set is current')
  assert.equal(current.at, '2026-01-01T00:00:00.000Z')

  const moved = ops.contradictionReviewStatus(root, REVIEW_HASH_B)
  assert.equal(moved.reviewed, true, 'the review is still recorded')
  assert.equal(moved.stale, true, 'but the laws moved since anything looked at their meaning')
  assert.match(moved.reason, /the laws now hash to/)
})

test('review status: a corrupt ledger reports no review, never a pass', () => {
  // The fail-closed direction. Fails if a broken ledger starts reporting a clean
  // judgement, which would license implementation mode on no evidence at all.
  const root = project('review-status-broken')
  mkdirSync(join(root, '.dsh', 'ratchet'), { recursive: true })
  writeFileSync(join(root, '.dsh', 'ratchet', 'ledger.jsonl'), '{not json\n')
  const status = ops.contradictionReviewStatus(root, REVIEW_HASH_A)
  assert.equal(status.stale, true)
  assert.equal(status.reviewed, false)
})

test('review status: a partly unreadable ledger says how many lines it could not read', () => {
  // The transparency gap this closes: `readLedger` counted the unparseable lines and this
  // caller dropped the count, so a ledger with corrupt lines reported exactly like a clean
  // one. Fails if the count stops travelling with the verdict, in either direction — the
  // corrupt case losing its count, or the healthy case losing its zero.
  const root = project('review-status-skipped')
  mkdirSync(join(root, '.dsh', 'ratchet'), { recursive: true })
  writeFileSync(
    join(root, '.dsh', 'ratchet', 'ledger.jsonl'),
    [
      '{ not json at all',
      JSON.stringify({
        event: 'ratchet.contradiction.reviewed',
        at: '2026-01-01T00:00:00.000Z',
        job: 'review_corpus',
        specHash: REVIEW_HASH_A,
        advisory: true,
      }),
      'nor is this',
    ].join('\n') + '\n',
  )
  const read = ops.contradictionReviewStatus(root, REVIEW_HASH_A)
  assert.equal(read.reviewed, true, 'the readable review line is still found')
  assert.equal(read.stale, false)
  assert.equal(read.ledgerSkipped, 2, 'and both unreadable lines are reported with the verdict')
  assert.equal(read.ledgerError, null, 'a readable ledger reports no read error')

  const clean = project('review-status-clean')
  mkdirSync(join(clean, '.dsh', 'ratchet'), { recursive: true })
  writeFileSync(
    join(clean, '.dsh', 'ratchet', 'ledger.jsonl'),
    `${JSON.stringify({
      event: 'ratchet.contradiction.reviewed',
      at: '2026-01-01T00:00:00.000Z',
      job: 'review_corpus',
      specHash: REVIEW_HASH_A,
      advisory: true,
    })}\n`,
  )
  assert.equal(ops.contradictionReviewStatus(clean, REVIEW_HASH_A).ledgerSkipped, 0, 'a healthy ledger reports zero')
})

// ---------------------------------------------------------------------------
// This project's OWN configuration. ADR 0070 declares `shipped-plugins` — the
// zone that governs what this deployment ships — as requiring a decision record.
// That declaration is a manifest field, so nothing but a test that reads the
// manifest and drives the shipped guard over it can tell "the flag is on" from
// "the flag was turned off and the documents still say it is on". Every case
// below drives the real manifest and the real corpus through a mirror, so
// flipping the flag back is a failing test rather than a paragraph.
// ---------------------------------------------------------------------------

/**
 * Copies this project's manifest and decision corpus into a temporary root.
 *
 * A mirror rather than the checkout: the guard refuses and allows without
 * writing anything, but a case that built its state by editing the real corpus
 * would be a test that can corrupt the thing it measures. The source directory
 * comes along because a record whose cited reasoning is missing is a record the
 * compiler may treat differently, and the point of the mirror is to be the real
 * corpus.
 *
 * @param options - `{ dropRecordsNamingZone }`. When a zone id is given, every
 *   record that names it is left out of the mirror, which is how the "no record
 *   names this zone" state is built from the REAL corpus rather than from a
 *   hand-written fixture. Records are located through the compiler's own reader,
 *   so the test cannot disagree with the guard about which records name a zone.
 * @returns The absolute path of the mirror.
 */
function kitMirror({ dropRecordsNamingZone = null } = {}) {
  const root = join(tmpdir(), `ratchet-guard-kit-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, '.dsh'), { recursive: true })
  cpSync(join(KIT_ROOT, '.dsh', 'project.json'), join(root, '.dsh', 'project.json'))
  cpSync(join(KIT_ROOT, 'docs'), join(root, 'docs'), { recursive: true })
  if (dropRecordsNamingZone !== null) {
    const config = compilerModule.readManifest(root).config
    const corpus = compilerModule.readAdrCorpus(root, config)
    for (const record of corpus.records) {
      if ((record.zones ?? []).includes(dropRecordsNamingZone)) rmSync(join(root, record.path), { force: true })
    }
  }
  return root
}

test('kit: plugins/** is governed, because the manifest declares the flag on shipped-plugins', () => {
  // The declaration itself, read the way the guard reads it. Fails the moment
  // `requiresDecisionRecord` goes back to false — in either direction, since the
  // zone must be governed AND must still be the zone the path falls in.
  const config = compilerModule.readManifest(KIT_ROOT).config
  const governed = guardModule.governanceOf('plugins/ratchet/ratchet-guard.mjs', config)
  assert.equal(governed.governed, true, 'plugins/** must be governed by the shipped-plugins zone')
  assert.equal(governed.zone.id, 'shipped-plugins')
  assert.equal(governed.zone.requiresDecisionRecord, true)
})

test('kit: a write into plugins/** with NO record naming shipped-plugins is refused', () => {
  // The refusal the flag exists for, driven over the real manifest and the real
  // corpus with every record that names the zone removed. A guard that answered
  // from the manifest alone, or one whose flag was flipped back, fails here.
  const root = kitMirror({ dropRecordsNamingZone: 'shipped-plugins' })
  const guard = guardModule.createGuard({ root })
  const reason = guard({ name: 'write', arguments: { file_path: 'plugins/ratchet/ratchet-guard.mjs' } })
  assert.equal(typeof reason, 'string', 'the write must be refused when no record names the zone')
  assert.match(reason, /shipped-plugins/, 'the denial names the zone')
  assert.match(reason, /plugins\/ratchet\/ratchet-guard\.mjs/, 'and the path it refused')
  assert.match(reason, /PROPOSED record is enough/, 'and the smallest thing that satisfies it')
})

test('kit: a record naming shipped-plugins licenses the write, proposed or in force', () => {
  // The other direction, over the untouched corpus: the guard must not refuse the
  // work this record describes. Fails if the flag is on and the licensing record
  // is deleted, edited so it stops naming the zone, or made unreadable.
  const root = kitMirror()
  const guard = guardModule.createGuard({ root })
  assert.equal(
    call(guard, 'write', { file_path: 'plugins/ratchet/ratchet-guard.mjs' }),
    'ALLOWED',
    'a record naming the zone licenses the write',
  )
  assert.equal(call(guard, 'edit', { file_path: 'plugins/work-modes/work-modes.mjs' }), 'ALLOWED')
})

test('kit: a zone whose flag is off is unaffected, so scripts, probes and rules stay writable', () => {
  // The trade-off ADR 0070 reports rather than hides: kit-tooling and
  // deployment-rules are deliberately left off. Fails if a later change turns the
  // flag on everywhere, which would make repairing a red gate need a record.
  const root = kitMirror({ dropRecordsNamingZone: 'shipped-plugins' })
  const guard = guardModule.createGuard({ root })
  for (const path of [
    'scripts/check-portability.mjs',
    'probes/api-probe/index.mjs',
    'rules/AGENTS.md',
    'profile/cordis.patch.yml',
    'docs/RATCHET-V2-DESIGN.md',
  ]) {
    assert.equal(call(guard, 'write', { file_path: path }), 'ALLOWED', `${path} is in a zone whose flag is off`)
  }
})
