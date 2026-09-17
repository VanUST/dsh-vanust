import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// The plugin under test. Overridable so a breaker can run this suite against a scratch copy
// with one fix reverted and show the covering test fail.
const PLUGIN = resolve(process.env.RATCHET_PLUGIN ?? join(import.meta.dirname, '..', 'plugins', 'ratchet'))
const CLI = join(PLUGIN, 'ratchet-cli.mjs')

const schema = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-schema.mjs`)
const compiler = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-compiler.mjs`)
const contradictionModule = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-contradiction.mjs`)
const verifier = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-verifier.mjs`)
const ops = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-ops.mjs`)
const dynamic = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-dynamic.mjs`)
const state = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-state.mjs`)
const ratifyModule = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-ratify.mjs`)
const ratchetBootstrap = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-bootstrap.mjs`)
const falsifyModule = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-falsify.mjs`)
const ingestModule = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-ingest.mjs`)
const draftsModule = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-drafts.mjs`)
const decisionsModule = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-decisions.mjs`)
const judgeModule = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-judge.mjs`)

// The harness adapter is loaded LAZILY and by hand, because it is the one module here
// that imports a package the repository does not carry: `@deepseek-ai/dsh-tools`. A
// static import made a fresh clone fail during module evaluation вЂ” `ERR_MODULE_NOT_FOUND`
// with a stack trace, before a single test could say what was wrong вЂ” and that is how
// "clone the repo and run the gate" quietly became "clone, install, and also link"
// without anyone noticing. Every other test still runs; one failure names the fix, and
// the tests that need the adapter are skipped with the same reason.
let tools = null
let toolsLoadError = null
try {
  tools = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-tools.mjs`)
} catch (error) {
  toolsLoadError = String(error?.message ?? error)
}
/** The reason the adapter-dependent tests are skipped, or `false` when they can run. */
const HARNESS_SKIP =
  toolsLoadError === null
    ? false
    : `the harness packages this checkout imports are not linked (run: node scripts/dev-link.mjs)`

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOURCE_TEXT = [
  '# Grilling session: session storage',
  '',
  'We agreed sessions must move to Redis because the deployment already runs it',
  'and file-backed sessions break under two instances.',
  '',
].join('\n')

const SOURCE_PATH = 'docs/ratchet/sources/2026-09-12-session-storage.md'

/** Builds ADR text from parts, so each test states only what it is varying. */
function adrText({
  id = '0001',
  title = 'Use Redis for session storage',
  type = 'adr',
  status = 'active',
  authority = 'human',
  authorName = 'ada',
  sourcePath = SOURCE_PATH,
  sourceHash = null,
  zones = ['auth'],
  supersedes = [],
  approves = [],
  resolves = [],
  ratification = null,
  ratificationLines = null,
  laws = [],
  reasoning = 'Redis is already deployed and provides TTL. Files break under two instances.',
  omitReasoning = false,
  omitFrontmatter = false,
  created = '2026-09-12T14:22:00Z',
} = {}) {
  if (omitFrontmatter) {
    return ['# A record with no frontmatter', '', '## Context', '', 'x', '', '## Decision', '', 'y', '', '## Reasoning', '', 'z', '', '## Consequences', '', 'w', ''].join('\n')
  }
  const lines = [
    '---',
    `id: "${id}"`,
    `title: ${title}`,
    `type: ${type}`,
    `status: ${status}`,
    'author:',
    `  authority: ${authority}`,
    `  name: ${authorName}`,
    `created: ${created}`,
    'source:',
    '  kind: file',
    `  path: ${sourcePath}`,
  ]
  if (sourceHash !== null) lines.push(`  hash: ${sourceHash}`)
  // Empty lists are written inline (`zones: []`) rather than as a bare key with
  // no entries. A bare `zones:` followed by the next key is a mapping whose value
  // never arrives, and the parser correctly reports it as a missing field ГўВЂвЂќ which
  // is a property of the FORMAT, not a defect, so the fixture must respect it.
  if (zones.length === 0) lines.push('zones: []')
  else {
    lines.push('zones:')
    for (const zone of zones) lines.push(`  - ${zone}`)
  }
  if (supersedes.length === 0) lines.push('supersedes: []')
  else {
    lines.push('supersedes:')
    for (const entry of supersedes) lines.push(`  - "${entry}"`)
  }
  if (approves.length === 0) lines.push('approves: []')
  else {
    lines.push('approves:')
    for (const entry of approves) lines.push(`  - "${entry}"`)
  }
  // Written only when a resolution declares it, so every existing fixture stays byte
  // identical: `resolves` is a new optional field, and a fixture that started emitting
  // `resolves: []` would change the text of records whose hashes other tests pin.
  if (resolves.length > 0) {
    lines.push('resolves:')
    for (const entry of resolves) lines.push(`  - "${entry}"`)
  }
  // A ratification block, rendered from parts or injected verbatim. The verbatim
  // form exists so the malformed shapes (no channel, no timestamp, an empty target
  // list, a hash that is not a hash) are exercised as the parser will meet them,
  // rather than through a builder that cannot express them.
  if (ratificationLines !== null) lines.push(...ratificationLines)
  else if (ratification !== null) {
    lines.push('ratification:')
    lines.push(`  channel: ${ratification.channel}`)
    lines.push(`  at: '${ratification.at}'`)
    lines.push(`  askedBy: ${ratification.askedBy}`)
    lines.push('  targets:')
    for (const target of ratification.targets) {
      lines.push(`    - id: "${target.id}"`)
      lines.push(`      contentHash: ${target.contentHash}`)
    }
  }
  if (laws.length === 0) {
    lines.push('laws: []')
  } else {
    lines.push('laws:')
    for (const law of laws) {
      lines.push(`  - op: ${law.op ?? 'upsert'}`)
      lines.push(`    id: ${law.id}`)
      if (law.statement !== undefined) lines.push(`    statement: ${law.statement}`)
      if (law.unenforced !== undefined) lines.push(`    unenforced: ${law.unenforced}`)
      if (law.checks !== undefined) {
        if (law.checks.length === 0) {
          lines.push('    checks: []')
        } else {
          lines.push('    checks:')
          for (const check of law.checks) {
            lines.push(`      - type: ${check.type}`)
            if (check.path !== undefined) lines.push(`        path: ${check.path}`)
            if (check.pattern !== undefined) lines.push(`        pattern: ${check.pattern}`)
            if (check.flags !== undefined) lines.push(`        flags: ${check.flags}`)
            if (check.unenforced !== undefined) lines.push(`        unenforced: ${check.unenforced}`)
            // Every field the record format carries, so a test can state the shape it
            // is about. Without these the fixture silently dropped them and every
            // command-check case collapsed into the same "needs a run" problem вЂ” a
            // suite that passes for a reason unrelated to what it claims to test.
            for (const key of ['run', 'expects', 'outputContains', 'outputNotContains', 'outputMatches', 'stream', 'list', 'contains', 'containsIs', 'zone']) {
              if (check[key] === undefined) continue
              // An EMPTY string is written as `""` rather than as a bare value: `pattern: `
              // makes the parser read the next line as the value, which turned the fixture
              // into a malformed record and hid the code path the case was about.
              lines.push(`        ${key}: ${check[key] === '' ? '""' : check[key]}`)
            }
            if (check.timeoutMs !== undefined) lines.push(`        timeoutMs: ${check.timeoutMs}`)
            if (check.anyOf !== undefined) lines.push(`        anyOf: ${check.anyOf}`)
            // An empty list is written inline (`deny: []`), for the same reason `zones: []`
            // is: a bare key with no entries is a mapping whose value never arrives, and the
            // record is then reported as malformed instead of exercising the empty-list rule.
            for (const key of ['paths', 'patterns', 'deny']) {
              if (check[key] === undefined) continue
              if (check[key].length === 0) {
                lines.push(`        ${key}: []`)
                continue
              }
              lines.push(`        ${key}:`)
              for (const entry of check[key]) lines.push(`          - ${entry}`)
            }
            if (check.zone !== undefined) lines.push(`        zone: ${check.zone}`)
          }
        }
      }
    }
  }
  lines.push('---', '', '## Context', '', 'Sessions are stored in local files.', '', '## Decision', '', 'Session storage must use Redis.', '')
  lines.push('## Reasoning', '', omitReasoning ? '' : reasoning, '')
  lines.push('## Consequences', '', '- All session access goes through the Redis-backed store.', '')
  return lines.join('\n')
}

/** Writes a project tree and returns its root. */
function makeProject({ name = 'fixture', zones = null, adrs = {}, files = {}, extraManifest = {}, ratchetEnabled = true } = {}) {
  const root = join(tmpdir(), `ratchet-test-${name}-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, '.dsh'), { recursive: true })

  const manifest = {
    manifestVersion: 2,
    name,
    languages: [{ id: 'typescript', extensions: ['.ts'], roots: ['src'] }],
    rules: [],
    verification: [],
    scopes: [],
    ratchet: {
      enabled: ratchetEnabled,
      decisionsDir: 'docs/adrs',
      sourcesDir: 'docs/ratchet/sources',
      specsDir: 'docs/specs',
      reportsDir: 'reports/ratchet',
      defaultAgentAuthority: 'proposeOnly',
      zones:
        zones ?? [
          { id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly', requiresDecisionRecord: true },
          { id: 'tests', paths: ['tests/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false },
        ],
      ...extraManifest,
    },
  }
  writeFileSync(join(root, '.dsh', 'project.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  mkdirSync(join(root, 'docs', 'ratchet', 'sources'), { recursive: true })
  writeFileSync(join(root, SOURCE_PATH), SOURCE_TEXT)

  if (adrs !== null) {
    mkdirSync(join(root, 'docs', 'adrs'), { recursive: true })
    for (const [filename, body] of Object.entries(adrs)) {
      writeFileSync(join(root, 'docs', 'adrs', filename), body)
    }
  }
  for (const [path, body] of Object.entries(files)) {
    const absolute = join(root, path)
    mkdirSync(join(absolute, '..'), { recursive: true })
    writeFileSync(absolute, body)
  }
  return root
}

/** Runs compileProject and returns only what the assertion needs. */
function compile(root) {
  const result = compiler.compileProject(root)
  return {
    ok: result.ok,
    recordIds: (result.report?.counts ?? {}).records,
    excluded: (result.report?.counts ?? {}).excluded,
    active: (result.report?.counts ?? {}).active,
    proposed: (result.report?.counts ?? {}).proposed,
    laws: (result.bundle?.laws ?? []).map((law) => law.id),
    codes: result.problems.map((entry) => entry.code),
    problems: result.problems,
    report: result.report,
  }
}

/**
 * Builds an approval ADR that ratifies records exactly as they are, hashing each
 * target's own text.
 *
 * The hash is the whole point of the record, so the fixture computes it from the
 * text rather than accepting one: an approval fixture with a hand-written hash
 * would test the fixture instead of the compiler.
 */
function approvalText({
  id = '0012',
  title = 'Ratify the decision',
  approved = [],
  channel = 'user-question',
  at = '2026-09-13T10:00:00Z',
  askedBy = 'test-session',
  type = 'approval',
  authority = 'human',
  status = 'active',
  ...rest
} = {}) {
  return adrText({
    id,
    title,
    type,
    authority,
    status,
    zones: [],
    laws: [],
    approves: approved.map((entry) => entry.id),
    ratification: {
      channel,
      at,
      askedBy,
      targets: approved.map((entry) => ({ id: entry.id, contentHash: schema.hashSource(entry.text) })),
    },
    ...rest,
  })
}

const SOURCE_HASH = schema.hashSource(SOURCE_TEXT)

// ---------------------------------------------------------------------------
// schema: frontmatter and identity
// ---------------------------------------------------------------------------

test('schema: a well-formed ADR parses with no problems', () => {
  const parsed = schema.parseAdr({
    filename: '0001-use-redis.adr.md',
    source: adrText({
      sourceHash: SOURCE_HASH,
      laws: [{ id: 'auth.session-storage.redis', statement: 'Session storage must use Redis.', checks: [{ type: 'forbidden_dependency', patterns: ['session-file-store'] }] }],
    }),
  })
  assert.deepEqual(parsed.problems, [])
  assert.equal(parsed.record.id, '0001')
  assert.equal(parsed.record.status, 'active')
  assert.equal(parsed.record.authority, 'human')
  assert.deepEqual(parsed.record.zones, ['auth'])
  assert.equal(parsed.record.laws.length, 1)
  assert.equal(parsed.record.laws[0].checks[0].type, 'forbidden_dependency')
  assert.equal(parsed.record.sections.Decision, 'Session storage must use Redis.')
})

test('schema: a filename that is not NNNN-slug.adr.md is ADR_FILE_INVALID and yields no record', () => {
  // The predecessor's defect: `README.md` became decision "READ".
  const parsed = schema.parseAdr({ filename: 'README.md', source: adrText({ id: '0001' }) })
  assert.ok(parsed.problems.some((entry) => entry.code === 'ADR_FILE_INVALID'))
  assert.equal(parsed.record.id, '0001', 'the record still parses, so the corpus is not silently shortened')
})

test('schema: a valid filename with a disagreeing frontmatter id is ADR_ID_MISMATCH', () => {
  const parsed = schema.parseAdr({ filename: '0002-other.adr.md', source: adrText({ id: '0001' }) })
  assert.ok(parsed.problems.some((entry) => entry.code === 'ADR_ID_MISMATCH'))
})

test('schema: every mandatory field is reported when absent', () => {
  const parsed = schema.parseAdr({
    filename: '0001-x.adr.md',
    source: ['---', 'id: "0001"', '---', '', '## Context', '', 'c', '', '## Decision', '', 'd', '', '## Reasoning', '', 'r', '', '## Consequences', '', 'x', ''].join('\n'),
  })
  const missing = parsed.problems.filter((entry) => entry.code === 'ADR_FIELD_MISSING').map((entry) => entry.field)
  for (const field of ['title', 'type', 'status', 'author', 'source', 'zones']) {
    assert.ok(missing.includes(field), `${field} should be reported missing`)
  }
})

test('schema: an empty Reasoning section is ADR_MISSING_REASONING', () => {
  const parsed = schema.parseAdr({ filename: '0001-x.adr.md', source: adrText({ omitReasoning: true }) })
  assert.ok(parsed.problems.some((entry) => entry.code === 'ADR_MISSING_REASONING'))
})

test('schema: an absent Reasoning section is ADR_SECTION_MISSING, not a missing-reasoning problem', () => {
  const text = adrText().replace(/## Reasoning[\s\S]*?## Consequences/, '## Consequences')
  const parsed = schema.parseAdr({ filename: '0001-x.adr.md', source: text })
  assert.ok(parsed.problems.some((entry) => entry.code === 'ADR_SECTION_MISSING' && entry.section === 'Reasoning'))
  assert.ok(!parsed.problems.some((entry) => entry.code === 'ADR_MISSING_REASONING'))
})

test('schema: no frontmatter block is ADR_FRONTMATTER_MISSING and yields no record', () => {
  const parsed = schema.parseAdr({ filename: '0001-x.adr.md', source: adrText({ omitFrontmatter: true }) })
  assert.equal(parsed.record, null)
  assert.ok(parsed.problems.some((entry) => entry.code === 'ADR_FRONTMATTER_MISSING'))
})

test('schema: an invalid status is reported with the allowed set', () => {
  const parsed = schema.parseAdr({ filename: '0001-x.adr.md', source: adrText({ status: 'accepted' }) })
  const entry = parsed.problems.find((candidate) => candidate.code === 'ADR_FIELD_INVALID' && candidate.message.includes('status'))
  assert.ok(entry, 'an invalid status must be reported')
  assert.ok(entry.message.includes('proposed'), 'the message must name the allowed statuses')
})

test('schema: an invalid authority is reported', () => {
  const parsed = schema.parseAdr({ filename: '0001-x.adr.md', source: adrText({ authority: 'robot' }) })
  assert.ok(parsed.problems.some((entry) => entry.code === 'ADR_FIELD_INVALID' && entry.message.includes('authority')))
})

test('schema: a supersedes entry equal to the record id is ADR_SUPERSEDES_SELF', () => {
  const parsed = schema.parseAdr({ filename: '0001-x.adr.md', source: adrText({ id: '0001', supersedes: ['0001'] }) })
  assert.ok(parsed.problems.some((entry) => entry.code === 'ADR_SUPERSEDES_SELF'))
})

test('schema: a malformed source hash is ADR_SOURCE_HASH_FORM', () => {
  const parsed = schema.parseAdr({ filename: '0001-x.adr.md', source: adrText({ sourceHash: 'sha256:short' }) })
  assert.ok(parsed.problems.some((entry) => entry.code === 'ADR_SOURCE_HASH_FORM'))
})

test('schema: an unsupported check type is rejected at parse time', () => {
  const parsed = schema.parseAdr({
    filename: '0001-x.adr.md',
    source: adrText({ laws: [{ id: 'a.b', statement: 's', checks: [{ type: 'ast_analysis' }] }] }),
  })
  const entry = parsed.problems.find((candidate) => candidate.message.includes('ast_analysis'))
  assert.ok(entry, 'an unknown check type must be reported')
  assert.ok(entry.message.includes('supported types'), 'the message must list the supported types')
})

test('schema: a law with no statement is rejected', () => {
  const parsed = schema.parseAdr({ filename: '0001-x.adr.md', source: adrText({ laws: [{ id: 'a.b', checks: [] }] }) })
  assert.ok(parsed.problems.some((entry) => entry.code === 'ADR_FIELD_INVALID' && entry.message.includes('no statement')))
})

test('schema: two laws with one id in a single ADR are LAW_DUPLICATE', () => {
  const parsed = schema.parseAdr({
    filename: '0001-x.adr.md',
    source: adrText({
      laws: [
        { id: 'a.b', statement: 'One.', checks: [] },
        { id: 'a.b', statement: 'Two.', checks: [] },
      ],
    }),
  })
  assert.ok(parsed.problems.some((entry) => entry.code === 'LAW_DUPLICATE'))
})

test('schema: hashSource is stable across CRLF and LF and ignores a BOM', () => {
  const lf = 'a\nb\n'
  assert.equal(schema.hashSource(lf), schema.hashSource('a\r\nb\r\n'))
  assert.equal(schema.hashSource(lf), schema.hashSource('\uFEFFa\nb\n'))
})

test('schema: hashSource changes when the content changes', () => {
  assert.notEqual(schema.hashSource('a\n'), schema.hashSource('a\nb\n'))
})

// ---------------------------------------------------------------------------
// schema: manifest configuration
// ---------------------------------------------------------------------------

test('schema: a manifest without a ratchet section yields a disabled default config', () => {
  const { config, problems } = schema.parseRatchetConfig(JSON.stringify({ manifestVersion: 1, languages: [] }))
  assert.equal(config.enabled, false)
  assert.equal(config.decisionsDir, 'docs/adrs')
  assert.deepEqual(problems, [])
})

test('schema: an unparseable manifest is MANIFEST_INVALID with no config', () => {
  const { config, problems } = schema.parseRatchetConfig('{ not json')
  assert.equal(config, null)
  assert.equal(problems[0].code, 'MANIFEST_INVALID')
})

test('schema: a manifest without a name is reported rather than rendered as null', () => {
  const { problems } = schema.parseRatchetConfig(JSON.stringify({ manifestVersion: 2, ratchet: { enabled: true } }))
  assert.ok(problems.some((entry) => entry.message.includes('no "name"')))
})

test('schema: decisionsDir is honoured and trailing slashes are trimmed', () => {
  const { config } = schema.parseRatchetConfig(
    JSON.stringify({ name: 'p', ratchet: { enabled: true, decisionsDir: 'docs/decisions/' } }),
  )
  assert.equal(config.decisionsDir, 'docs/decisions')
})

test('schema: a zone with no paths is ZONE_INVALID and is not registered', () => {
  const { config, problems } = schema.parseRatchetConfig(
    JSON.stringify({ name: 'p', ratchet: { enabled: true, zones: [{ id: 'auth', paths: [] }] } }),
  )
  assert.ok(problems.some((entry) => entry.code === 'ZONE_INVALID'))
  assert.deepEqual(config.zones, [])
})

test('schema: an absolute zone path or one containing .. is ZONE_PATH_INVALID', () => {
  const { problems } = schema.parseRatchetConfig(
    JSON.stringify({
      name: 'p',
      ratchet: { enabled: true, zones: [{ id: 'a', paths: ['/etc/**'] }, { id: 'b', paths: ['../secret/**'] }] },
    }),
  )
  assert.equal(problems.filter((entry) => entry.code === 'ZONE_PATH_INVALID').length, 2)
})

test('schema: an unknown agentAuthority is rejected rather than defaulted', () => {
  const { problems } = schema.parseRatchetConfig(
    JSON.stringify({ name: 'p', ratchet: { enabled: true, zones: [{ id: 'a', paths: ['src/**'], agentAuthority: 'anything' }] } }),
  )
  assert.ok(problems.some((entry) => entry.code === 'ZONE_INVALID' && entry.message.includes('agentAuthority')))
})

test('schema: a zone inherits defaultAgentAuthority when it declares none', () => {
  const { config } = schema.parseRatchetConfig(
    JSON.stringify({
      name: 'p',
      ratchet: { enabled: true, defaultAgentAuthority: 'humanOnly', zones: [{ id: 'a', paths: ['src/**'] }] },
    }),
  )
  assert.equal(config.zones[0].agentAuthority, 'humanOnly')
})

test('schema: zoneFor gives the longest matching zone precedence', () => {
  const zones = [
    { id: 'src', paths: ['src/**'], agentAuthority: 'proposeOnly' },
    { id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' },
  ]
  assert.equal(schema.zoneFor('src/auth/session.ts', zones).id, 'auth')
  assert.equal(schema.zoneFor('src/other/x.ts', zones).id, 'src')
  assert.equal(schema.zoneFor('docs/readme.md', zones), null)
})

test('schema: zoneFor places a path by the glob a zone declares, not by a prefix of it', () => {
  // Zone membership and law file selection used to disagree: membership stripped a trailing star
  // and compared directory prefixes. So a zone declaring a wildcard in the MIDDLE, or a wildcard
  // inside a segment, was accepted by the manifest and then governed NOTHING, while a trailing
  // single-star zone denied files it does not cover.
  const deep = [{ id: 'deep', paths: ['src/*/api/**'], agentAuthority: 'proposeOnly' }]
  assert.equal(schema.zoneFor('src/deep/api/x.ts', deep).id, 'deep', 'a wildcard between segments matches')
  assert.equal(schema.zoneFor('src/api/x.ts', deep), null, 'and one star is one segment, not a prefix')

  const single = [{ id: 'single', paths: ['src/api/*'], agentAuthority: 'proposeOnly' }]
  assert.equal(schema.zoneFor('src/api/x.ts', single).id, 'single')
  assert.equal(schema.zoneFor('src/api/deep/x.ts', single), null, 'a deeper path is outside a single star')

  const whole = [{ id: 'all', paths: ['**'], agentAuthority: 'proposeOnly' }]
  assert.equal(schema.zoneFor('anything/at/all.ts', whole).id, 'all', 'a bare ** is the whole repository')
  assert.equal(schema.zoneFor('top.ts', whole).id, 'all')

  const star = [{ id: 'star', paths: ['*'], agentAuthority: 'proposeOnly' }]
  assert.equal(schema.zoneFor('a/b.ts', star).id, 'star', 'a bare * is read as the whole repository too')

  // The most specific declaration still wins, and a whole-repository zone loses to a named one.
  const nested = [{ id: 'all', paths: ['**'], agentAuthority: 'proposeOnly' }, { id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' }]
  assert.equal(schema.zoneFor('src/auth/session.ts', nested).id, 'auth')
  assert.equal(schema.zoneFor('src/other/x.ts', nested).id, 'all')
})

test('schema: zoneFor does not treat a sibling prefix as containment', () => {
  const zones = [{ id: 'sim', paths: ['packages/sim/**'], agentAuthority: 'proposeOnly' }]
  assert.equal(schema.zoneFor('packages/sim-city/x.ts', zones), null)
  assert.equal(schema.zoneFor('packages/sim/x.ts', zones).id, 'sim')
})

// ---------------------------------------------------------------------------
// compiler: corpus reading and the three absence modes
// ---------------------------------------------------------------------------

test('compiler: a missing decisions directory is DIR_MISSING, not an empty corpus', () => {
  const root = makeProject({ name: 'nodir', adrs: null })
  const result = compile(root)
  assert.equal(result.ok, false)
  assert.ok(result.codes.includes('DIR_MISSING'))
  assert.ok(!result.codes.includes('NO_VALID_ADRS'), 'a missing directory is not the same as an empty one')
})

test('compiler: an empty decisions directory is NO_VALID_ADRS', () => {
  const root = makeProject({ name: 'emptydir', adrs: {} })
  const result = compile(root)
  assert.ok(result.codes.includes('NO_VALID_ADRS'))
  assert.ok(!result.codes.includes('DIR_MISSING'))
})

test('compiler: a directory holding only a README is NO_VALID_ADRS and README is not a decision', () => {
  const root = makeProject({ name: 'readmeonly', adrs: { 'README.md': '# How to write a record\n' } })
  const result = compile(root)
  assert.equal(result.recordIds, 0)
  assert.ok(result.codes.includes('NO_VALID_ADRS'))
})

test('compiler: a project with no manifest is MANIFEST_MISSING', () => {
  const root = join(tmpdir(), `ratchet-test-nomanifest-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  const result = compile(root)
  assert.equal(result.ok, false)
  assert.ok(result.codes.includes('MANIFEST_MISSING'))
})

test('compiler: a manifest without ratchet.enabled is RATCHET_DISABLED', () => {
  const root = makeProject({ name: 'disabled', ratchetEnabled: false, adrs: { '0001-x.adr.md': adrText() } })
  const result = compile(root)
  assert.ok(result.codes.includes('RATCHET_DISABLED'))
})

test('compiler: a malformed ADR file is reported and does not abort the corpus', () => {
  const root = makeProject({
    name: 'mixed',
    adrs: {
      '0001-good.adr.md': adrText({ id: '0001', laws: [{ id: 'a.one', statement: 'One.', checks: [] }] }),
      '0002-bad.adr.md': '# no frontmatter at all\n',
    },
  })
  const result = compile(root)
  assert.equal(result.recordIds, 1, 'the good record is still read')
  assert.ok(result.codes.includes('ADR_FRONTMATTER_MISSING'))
})

test('compiler: two files declaring one id is ADR_ID_DUPLICATE', () => {
  const root = makeProject({
    name: 'dup',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001' }),
      '0002-b.adr.md': adrText({ id: '0001' }),
    },
  })
  const result = compile(root)
  assert.ok(result.codes.includes('ADR_ID_DUPLICATE'))
})

// ---------------------------------------------------------------------------
// compiler: supersession
// ---------------------------------------------------------------------------

test('compiler: a dangling supersedes target is ADR_SUPERSEDES_DANGLING and the decision stays in force', () => {
  // The predecessor's sharpest defect: a bogus supersession removed a live
  // decision from review and the tool then said there was nothing to review.
  const root = makeProject({
    name: 'dangling',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', laws: [{ id: 'a.one', statement: 'One.', checks: [] }] }),
      '0002-b.adr.md': adrText({ id: '0002', supersedes: ['9999'], laws: [{ id: 'b.two', statement: 'Two.', checks: [] }] }),
    },
  })
  const result = compile(root)
  assert.ok(result.codes.includes('ADR_SUPERSEDES_DANGLING'))
  assert.ok(result.laws.includes('b.two'), 'a dangling link must not retire the decision')
})

test('compiler: a supersedes cycle is ADR_SUPERSEDES_CYCLE', () => {
  const root = makeProject({
    name: 'cycle',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', supersedes: ['0002'], laws: [{ id: 'a.one', statement: 'One.', checks: [] }] }),
      '0002-b.adr.md': adrText({ id: '0002', supersedes: ['0001'], laws: [{ id: 'b.two', statement: 'Two.', checks: [] }] }),
    },
  })
  const result = compile(root)
  assert.equal(result.codes.filter((code) => code === 'ADR_SUPERSEDES_CYCLE').length, 2)
})

test('compiler: a valid supersession retires the earlier decision and its law', () => {
  const root = makeProject({
    name: 'supersede',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', laws: [{ id: 'a.one', statement: 'One.', checks: [] }] }),
      '0002-b.adr.md': adrText({ id: '0002', supersedes: ['0001'], laws: [{ id: 'b.two', statement: 'Two.', checks: [] }] }),
    },
  })
  const result = compile(root)
  assert.deepEqual(result.laws, ['b.two'])
})

// ---------------------------------------------------------------------------
// compiler: authority
// ---------------------------------------------------------------------------

test('compiler: an agent ADR that declares itself active in a humanOnly zone is rejected', () => {
  const root = makeProject({
    name: 'humanonly',
    adrs: {
      '0001-agent.adr.md': adrText({
        id: '0001',
        authority: 'agent',
        status: 'active',
        zones: ['auth'],
        laws: [{ id: 'auth.x', statement: 'Agent law.', checks: [] }],
      }),
    },
  })
  const result = compile(root)
  assert.ok(result.codes.includes('ADR_AGENT_ACTIVE_IN_HUMAN_ONLY_ZONE'))
})

test('compiler: an agent ADR that declares itself active in a proposeOnly zone must stay proposed', () => {
  const root = makeProject({
    name: 'proposeonly',
    adrs: {
      '0001-agent.adr.md': adrText({
        id: '0001',
        authority: 'agent',
        status: 'active',
        zones: ['api'],
        laws: [{ id: 'api.x', statement: 'Agent law.', checks: [] }],
      }),
    },
    zones: [{ id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
  })
  const result = compile(root)
  assert.ok(result.codes.includes('ADR_AGENT_REQUIRES_APPROVAL'))
})

test('compiler: an agent ADR may be in force in an activeIfNoConflict zone', () => {
  const root = makeProject({
    name: 'aifnc',
    adrs: {
      '0001-agent.adr.md': adrText({
        id: '0001',
        authority: 'agent',
        status: 'active',
        zones: ['tests'],
        laws: [{ id: 'tests.x', statement: 'Agent law.', checks: [] }],
      }),
    },
  })
  const result = compile(root)
  assert.equal(result.ok, true, `expected no problems, got ${JSON.stringify(result.codes)}`)
  assert.deepEqual(result.laws, ['tests.x'])
})

test('compiler: a human approval ADR activates a proposed agent ADR without changing its author', () => {
  const target = adrText({
    id: '0011',
    status: 'proposed',
    authority: 'agent',
    zones: ['api'],
    laws: [{ id: 'api.x', statement: 'Agent law.', checks: [] }],
  })
  const root = makeProject({
    name: 'approval',
    adrs: {
      '0011-agent.adr.md': target,
      '0012-approve.adr.md': approvalText({ id: '0012', approved: [{ id: '0011', text: target }] }),
    },
    zones: [{ id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
  })
  const result = compile(root)
  assert.deepEqual(result.laws, ['api.x'], `expected the approved law, codes=${JSON.stringify(result.codes)}`)
  assert.equal(result.ok, true, `expected no problems, got ${JSON.stringify(result.codes)}`)
})

test('compiler: a proposed agent ADR with no approval contributes no law', () => {
  const root = makeProject({
    name: 'unapproved',
    adrs: {
      '0011-agent.adr.md': adrText({
        id: '0011',
        status: 'proposed',
        authority: 'agent',
        zones: ['api'],
        laws: [{ id: 'api.x', statement: 'Agent law.', checks: [] }],
      }),
    },
    zones: [{ id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
  })
  const result = compile(root)
  assert.deepEqual(result.laws, [])
  assert.equal(result.report.counts.proposed, 1)
})

test('compiler: an agent-authored approval ADR cannot approve anything', () => {
  const root = makeProject({
    name: 'agentapproval',
    adrs: {
      '0011-agent.adr.md': adrText({ id: '0011', status: 'proposed', authority: 'agent', zones: ['api'], laws: [{ id: 'api.x', statement: 'X.', checks: [] }] }),
      '0012-selfapprove.adr.md': adrText({ id: '0012', type: 'approval', authority: 'agent', approves: ['0011'], zones: [], laws: [] }),
    },
    zones: [{ id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
  })
  const result = compile(root)
  assert.ok(result.codes.includes('ADR_AGENT_REQUIRES_APPROVAL'))
  assert.deepEqual(result.laws, [], 'the agent approval must not activate the decision')
})

test('compiler: an approval naming a nonexistent ADR is reported', () => {
  const root = makeProject({
    name: 'danglingapproval',
    adrs: {
      '0012-approve.adr.md': adrText({
        id: '0012',
        type: 'approval',
        approves: ['0404'],
        zones: [],
        laws: [],
        ratification: {
          channel: 'user-question',
          at: '2026-09-13T10:00:00Z',
          askedBy: 'test-session',
          targets: [{ id: '0404', contentHash: `sha256:${'a'.repeat(64)}` }],
        },
      }),
    },
  })
  const result = compile(root)
  assert.ok(
    result.codes.includes('APPROVAL_TARGET_UNKNOWN'),
    `expected APPROVAL_TARGET_UNKNOWN, got ${JSON.stringify(result.codes)}`,
  )
})

test('compiler: an unzoned agent ADR falls under the manifest default, not out of regulation', () => {
  const root = makeProject({
    name: 'unzoned',
    adrs: {
      '0001-agent.adr.md': adrText({
        id: '0001',
        authority: 'agent',
        status: 'active',
        zones: [],
        laws: [{ id: 'x.y', statement: 'Agent law.', checks: [] }],
      }),
    },
  })
  const result = compile(root)
  assert.ok(result.codes.includes('ADR_AGENT_REQUIRES_APPROVAL'), 'proposeOnly is the default and must bind an unzoned agent ADR')
})

test('compiler: a law naming an undeclared zone is LAW_ZONE_MISSING', () => {
  const root = makeProject({
    name: 'badzone',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['nosuchzone'], laws: [{ id: 'a.b', statement: 'S.', checks: [] }] }),
    },
  })
  const result = compile(root)
  assert.ok(result.codes.includes('LAW_ZONE_MISSING'))
})

// ---------------------------------------------------------------------------
// compiler: law collisions
// ---------------------------------------------------------------------------

test('compiler: two active ADRs declaring one law id with different statements is LAW_CONFLICT', () => {
  const root = makeProject({
    name: 'conflict',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.shared', statement: 'Use Redis.', checks: [] }] }),
      '0002-b.adr.md': adrText({ id: '0002', zones: ['auth'], laws: [{ id: 'auth.shared', statement: 'Use files.', checks: [] }] }),
    },
  })
  const result = compile(root)
  assert.ok(result.codes.includes('LAW_CONFLICT'))
  assert.deepEqual(result.laws, [], 'the ratchet must not choose between two statements')
})

test('compiler: one law id with matching statements but different checks asks for dynamic review', () => {
  const root = makeProject({
    name: 'checksdiffer',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.shared', statement: 'Use Redis.', checks: [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis' }] }] }),
      '0002-b.adr.md': adrText({ id: '0002', zones: ['auth'], laws: [{ id: 'auth.shared', statement: 'Use Redis.', checks: [{ type: 'forbidden_text', paths: ['src/auth/**'], pattern: 'legacy' }] }] }),
    },
  })
  const result = compile(root)
  assert.equal(result.ok, true, `codes=${JSON.stringify(result.codes)}`)
  assert.equal(result.report.reviewRequired.length, 1)
  assert.equal(result.report.reviewRequired[0].lawId, 'auth.shared')
})

test('compiler: a remove op targeting an undeclared law is LAW_TARGET_DANGLING', () => {
  const root = makeProject({
    name: 'removedangling',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ op: 'remove', id: 'auth.never', checks: [] }] }),
    },
  })
  const result = compile(root)
  assert.ok(result.codes.includes('LAW_TARGET_DANGLING'))
})

test('compiler: a remove op retires a law declared by an earlier ADR', () => {
  const root = makeProject({
    name: 'removelaw',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.gone', statement: 'Old.', checks: [] }] }),
      '0002-b.adr.md': adrText({ id: '0002', zones: ['auth'], laws: [{ op: 'remove', id: 'auth.gone', checks: [] }] }),
    },
  })
  const result = compile(root)
  assert.deepEqual(result.laws, [])
  assert.equal(result.ok, true, `codes=${JSON.stringify(result.codes)}`)
})

// ---------------------------------------------------------------------------
// compiler: hashing and spec rendering
// ---------------------------------------------------------------------------

test('compiler: the spec hash is stable across runs and changes when a law changes', () => {
  const root = makeProject({
    name: 'hash',
    adrs: { '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.x', statement: 'One.', checks: [] }] }) },
  })
  const first = compiler.compileProject(root)
  const second = compiler.compileProject(root)
  assert.equal(first.report.specHash, second.report.specHash)

  writeFileSync(
    join(root, 'docs', 'adrs', '0001-a.adr.md'),
    adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.x', statement: 'Two.', checks: [] }] }),
  )
  const third = compiler.compileProject(root)
  assert.notEqual(first.report.specHash, third.report.specHash)
})

test('compiler: renderSpecs marks every generated file and stamps the hash', () => {
  const root = makeProject({
    name: 'render',
    adrs: { '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.x', statement: 'One.', checks: [] }] }) },
  })
  const result = compiler.compileProject(root)
  const { files, specHash } = compiler.renderSpecs(result.bundle)
  const path = 'docs/specs/auth.spec.md'
  assert.ok(files[path], `expected ${path}, got ${Object.keys(files).join(', ')}`)
  assert.ok(files[path].includes('GENERATED BY ratchet compile. DO NOT EDIT BY HAND.'))
  assert.ok(files[path].includes(`spec-hash: ${specHash}`))
  assert.ok(files[path].includes('auth.x'))
})

test('compiler: specFileMatches detects a hand-edited generated spec', () => {
  assert.equal(compiler.specFileMatches('a\nb', 'a\nb'), true)
  assert.equal(compiler.specFileMatches('a\nb', 'a\nb (edited)'), false)
  assert.equal(compiler.specFileMatches('a\nb', 'a\r\nb'), true, 'line endings are not an edit')
})

test('compiler: zone overlap with different authority is ZONE_OVERLAP', () => {
  const root = makeProject({
    name: 'zoneoverlap',
    zones: [
      { id: 'src', paths: ['src/**'], agentAuthority: 'proposeOnly' },
      { id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' },
    ],
    adrs: { '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'a.b', statement: 'S.', checks: [] }] }) },
  })
  const result = compile(root)
  assert.ok(result.codes.includes('ZONE_OVERLAP'))
})

// ---------------------------------------------------------------------------
// verifier: every check type
// ---------------------------------------------------------------------------

/** Builds a project with one law carrying the given checks, and verifies it. */
async function verifyOneLaw(name, checks, { files = {}, zones = null, manifest = {} } = {}) {
  const root = makeProject({
    name,
    files,
    zones,
    extraManifest: manifest,
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.check', statement: 'Enforced.', checks }] }),
    },
  })
  const compiled = compiler.compileProject(root)
  assert.equal(compiled.ok, true, `fixture must compile cleanly, codes=${JSON.stringify(compiled.problems.map((entry) => entry.code))}`)
  // The config comes from the manifest the fixture wrote, not from a hand-built
  // object: a verifier given a different zone set than the compiler saw would
  // report LAW_ZONE_MISSING for a zone the project does declare.
  const manifestRead = compiler.readManifest(root)
  const verified = await verifier.verifyProject({
    root,
    bundle: compiled.bundle,
    config: manifestRead.config,
    manifest: manifestRead.config,
    // No runner by default: a `command` check then reports as pending, which is what
    // the verifier does in the tool path an agent reaches.
    runCommand: null,
  })
  return { root, report: verified.report, problems: verified.problems, codes: verified.problems.map((entry) => entry.code) }
}

/**
 * Drives the verifier with a hand-built bundle, skipping the compiler.
 *
 * Some checks can no longer be declared through the compiler at all: ADR 0012 refuses a
 * law whose positive target falls outside its record's zones, and a `path_boundary` whose
 * deny is provably disjoint from its zone is exactly that — a target somewhere the record
 * does not govern. Those cases still need to be verified, because the verifier is what a
 * bundle from an older ratchet, or a later one, will be handed. Building the bundle here
 * tests the verifier's own logic instead of the compiler's refusal.
 */
async function verifyRawLaws(name, checks, { files = {}, zones = null, budget = null } = {}) {
  const root = makeProject({
    name,
    files,
    zones,
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [{ id: 'auth.check', statement: 'Enforced.', checks: [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'x' }] }],
      }),
    },
  })
  const manifestRead = compiler.readManifest(root)
  const bundle = {
    version: 1,
    project: name,
    laws: [{ id: 'auth.check', statement: 'Enforced.', zones: ['auth'], authority: 'human', sourceAdr: '0001', approvedBy: null, checks }],
  }
  const verified = await verifier.verifyProject({
    root,
    bundle,
    config: manifestRead.config,
    manifest: manifestRead.config,
    runCommand: null,
    budget,
  })
  return { root, report: verified.report, problems: verified.problems, codes: verified.problems.map((entry) => entry.code) }
}

test('schema: a check carries only its own fields, and every path field is a zone target', () => {
  // This replaces a test that derived the fields by PARSING THE VERIFIER'S SOURCE. Six
  // independent breaker rounds showed that approach misses a new read form every time —
  // `check.field`, then `check['field']`, destructuring, aliasing, optional chaining,
  // whitespace before the dot — and a guard that needs a fresh regex for each syntax is
  // not a guard. The field set is now closed where a check is parsed, and the compiler's
  // targets are DERIVED from the same table, so they cannot disagree and no syntax can
  // hide a path: a field the parser refuses never reaches the verifier at all.
  const types = [...schema.CHECK_TYPES]
  const missing = types.filter((type) => schema.CHECK_FIELD_KINDS[type] === undefined)
  const extra = Object.keys(schema.CHECK_FIELD_KINDS).filter((type) => !types.includes(type))
  assert.deepEqual(missing, [], 'check types with no field-kind entry')
  assert.deepEqual(extra, [], 'field-kind entries that are not check types')

  for (const type of types) {
    const kinds = schema.CHECK_FIELD_KINDS[type]
    const expected = [
      ...Object.entries(kinds)
        .filter(([, kind]) => kind === 'path')
        .map(([field]) => field),
      // A `zone` field names a zone whose own paths the check reaches.
      ...(Object.values(kinds).includes('zone') ? ['zonePaths'] : []),
    ].sort()
    assert.deepEqual([...schema.CHECK_TARGET_FIELDS[type]].sort(), expected, `${type} targets are derived`)
  }

  // And the parser refuses a field the type does not define, so a path in an unclassified
  // field cannot exist in a record in the first place.
  const refused = schema.validateLawChecks(
    { id: 'auth.x', checks: [{ type: 'required_file', path: 'src/auth/a.ts', secretPath: 'rules/AGENTS.md' }] },
    'test',
  )
  assert.ok(
    refused.some((entry) => entry.code === 'ADR_FIELD_INVALID' && /secretPath/.test(entry.message)),
    'an undefined field is refused by name',
  )
  const accepted = schema.validateLawChecks({ id: 'auth.x', checks: [{ type: 'required_file', path: 'src/auth/a.ts' }] }, 'test')
  assert.deepEqual(accepted, [], 'a check made only of defined fields is accepted')
  // Object.prototype's names are not fields. `key in knownFields` admitted them, so a
  // closure that reads as airtight let `toString`, `constructor` and an own `__proto__`
  // through — harmless here, because nothing reads them, but not closed.
  for (const prototypeName of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
    const inherited = schema.validateLawChecks(
      { id: 'auth.x', checks: [{ type: 'required_file', path: 'src/auth/a.ts', [prototypeName]: 'boom' }] },
      'test',
    )
    assert.ok(inherited.length > 0, `${prototypeName} must not count as a defined field`)
  }
  // `basis` is the one exception, because ingestion records it on every derived check.
  const annotated = schema.validateLawChecks(
    { id: 'auth.x', checks: [{ type: 'required_file', path: 'src/auth/a.ts', basis: 'the source says so' }] },
    'test',
  )
  assert.deepEqual(annotated, [], 'the universal basis annotation is accepted on any check')
})

test('verifier: required_file passes when present and fails when absent', async () => {
  const present = await verifyOneLaw('reqfile-ok', [{ type: 'required_file', path: 'src/auth/session.ts' }], {
    files: { 'src/auth/session.ts': 'export const x = 1\n' },
  })
  assert.equal(present.problems.length, 0)
  assert.equal(present.report.counts.checksEvaluated, 1)

  const absent = await verifyOneLaw('reqfile-fail', [{ type: 'required_file', path: 'src/auth/session.ts' }])
  assert.deepEqual(absent.codes, ['CODE_REQUIRED_FILE_MISSING'])
})

test('verifier: forbidden_file passes when absent and fails when present', async () => {
  const clean = await verifyOneLaw('forbfile-ok', [{ type: 'forbidden_file', path: 'src/auth/file-store.ts' }])
  assert.equal(clean.problems.length, 0)

  const dirty = await verifyOneLaw('forbfile-fail', [{ type: 'forbidden_file', path: 'src/auth/file-store.ts' }], {
    files: { 'src/auth/file-store.ts': 'export const x = 1\n' },
  })
  assert.deepEqual(dirty.codes, ['CODE_FORBIDDEN_FILE_PRESENT'])
})

test('verifier: required_glob fails when nothing matches', async () => {
  const result = await verifyOneLaw('reqglob', [{ type: 'required_glob', pattern: 'src/auth/tests/**' }])
  assert.deepEqual(result.codes, ['CODE_REQUIRED_GLOB_MISSING'])
})

test('verifier: forbidden_glob reports the offending matches', async () => {
  const result = await verifyOneLaw('forbglob', [{ type: 'forbidden_glob', pattern: 'src/auth/legacy/**' }], {
    files: { 'src/auth/legacy/old.ts': 'x\n', 'src/auth/legacy/older.ts': 'y\n' },
  })
  assert.deepEqual(result.codes, ['CODE_FORBIDDEN_GLOB_PRESENT'])
  assert.equal(result.problems[0].matches.length, 2)
})

test('verifier: required_text fails when no file matches the paths, and says nothing was searched', async () => {
  const result = await verifyOneLaw('reqtext-noscope', [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis' }])
  // A selection problem, not a verdict about the code: the code says so, because
  // `CODE_REQUIRED_TEXT_MISSING` means "searched and found nothing" and a caller
  // branching on it was told a verdict had been reached when nothing was read.
  assert.deepEqual(result.codes, ['CODE_TEXT_SCOPE_EMPTY'])
  assert.ok(result.problems[0].message.includes('nothing was searched'))
})

test('verifier: required_text passes when the text is present and fails when it is not', async () => {
  const ok = await verifyOneLaw('reqtext-ok', [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis' }], {
    files: { 'src/auth/session.ts': 'import { createClient } from "redis"\n' },
  })
  assert.equal(ok.problems.length, 0)

  const missing = await verifyOneLaw('reqtext-fail', [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis' }], {
    files: { 'src/auth/session.ts': 'export const x = 1\n' },
  })
  assert.deepEqual(missing.codes, ['CODE_REQUIRED_TEXT_MISSING'])
})

test('verifier: forbidden_text reports the file and line of the first match', async () => {
  const result = await verifyOneLaw('forbtext', [{ type: 'forbidden_text', paths: ['src/auth/**'], pattern: 'session-file-store' }], {
    files: { 'src/auth/session.ts': 'const a = 1\nconst b = 2\nimport "session-file-store"\n' },
  })
  assert.deepEqual(result.codes, ['CODE_TEXT_FORBIDDEN_PRESENT'])
  assert.equal(result.problems[0].matches[0].path, 'src/auth/session.ts')
  assert.equal(result.problems[0].matches[0].line, 3)
})

test('verifier: forbidden_dependency detects a declared dependency', async () => {
  const result = await verifyOneLaw('forbdep', [{ type: 'forbidden_dependency', patterns: ['session-file-store'] }], {
    files: { 'package.json': JSON.stringify({ name: 'x', dependencies: { 'session-file-store': '^1.0.0' } }) },
  })
  assert.deepEqual(result.codes, ['CODE_FORBIDDEN_DEPENDENCY_PRESENT'])
})

test('verifier: required_dependency detects a missing dependency', async () => {
  const result = await verifyOneLaw('reqdep', [{ type: 'required_dependency', patterns: ['ioredis'] }], {
    files: { 'package.json': JSON.stringify({ name: 'x', dependencies: { express: '^4' } }) },
  })
  assert.deepEqual(result.codes, ['CODE_REQUIRED_DEPENDENCY_MISSING'])
})

test('verifier: a dependency law in a project with no manifests FAILS rather than passing quietly', async () => {
  // A law that finds nothing to search must not report success.
  const result = await verifyOneLaw('nodep', [{ type: 'forbidden_dependency', patterns: ['session-file-store'] }], {
    files: { 'src/auth/session.ts': 'x\n' },
  })
  assert.deepEqual(result.codes, ['CODE_REQUIRED_DEPENDENCY_MISSING'])
  assert.ok(result.problems[0].message.includes('nothing was searched'))
})

test('verifier: python requirement files are consulted for dependency laws', async () => {
  const result = await verifyOneLaw('pydep', [{ type: 'forbidden_dependency', patterns: ['flask-session'] }], {
    files: { 'requirements.txt': 'flask\nflask-session==0.5.0\n' },
  })
  assert.deepEqual(result.codes, ['CODE_FORBIDDEN_DEPENDENCY_PRESENT'])
})

test('verifier: path_boundary flags a file in the zone that matches a denied glob', async () => {
  // The deny glob overlaps the zone it restricts, which is what makes it a real
  // restriction: a zone managing src/auth/** can deny itself src/auth/legacy/**.
  const result = await verifyOneLaw(
    'boundary',
    [{ type: 'path_boundary', zone: 'auth', deny: ['src/auth/legacy/**'] }],
    { files: { 'src/auth/legacy/adapter.ts': 'x\n' } },
  )
  assert.deepEqual(result.codes, ['CODE_FORBIDDEN_GLOB_PRESENT'])
  assert.equal(result.problems[0].offenders[0].path, 'src/auth/legacy/adapter.ts')
})

test('verifier: a path_boundary deny that can never overlap its zone is reported, not silently inert', async () => {
  // A deny glob is repository-relative, so denying `src/legacy/**` to a zone that
  // manages `src/auth/**` can never match and enforces nothing. Reporting it is
  // the difference between a restriction and the appearance of one.
  const result = await verifyRawLaws('boundary-inert', [{ type: 'path_boundary', zone: 'auth', deny: ['src/legacy/**'] }])
  assert.deepEqual(result.codes, ['DYNAMIC_REVIEW_REQUIRED'])
  assert.ok(result.problems[0].message.includes('cannot match a file the zone owns'))
})

test('verifier: a deny that only LOOKS disjoint is not reported inert', async () => {
  // The proof, not a guess. The first overlap test compared the two globs as path
  // strings, so `**/legacy/**` вЂ” which matches `src/auth/legacy/old.ts`, and does so
  // through the same `matchFiles` the check itself uses вЂ” was declared non-overlapping
  // and a law that HOLDS over a clean tree was reported broken with a false reason.
  const leadingWildcard = await verifyRawLaws('boundary-leading-wildcard', [
    { type: 'path_boundary', zone: 'auth', deny: ['**/legacy/**'] },
  ])
  assert.deepEqual(leadingWildcard.codes, [], 'a deny that can match is never called inert')

  // And the same deny still fires when a file actually crosses it.
  const crossed = await verifyRawLaws(
    'boundary-leading-wildcard-hit',
    [{ type: 'path_boundary', zone: 'auth', deny: ['**/legacy/**'] }],
    { files: { 'src/auth/legacy/old.ts': 'x\n' } },
  )
  assert.deepEqual(crossed.codes, ['CODE_FORBIDDEN_GLOB_PRESENT'])

  // A wildcard in the middle of a prefix keeps the prefix it can still prove.
  const suffixWildcard = await verifyRawLaws('boundary-suffix-wildcard', [
    { type: 'path_boundary', zone: 'auth', deny: ['**/*.tmp'] },
  ])
  assert.deepEqual(suffixWildcard.codes, [])

  // A wildcard segment ends the provable prefix, so a deny that diverges only AFTER
  // one is ambiguous rather than proven disjoint. Ambiguity is never reported as
  // inert: the check asks for judgement instead of inventing a verdict.
  const dirWildcard = await verifyRawLaws('boundary-dir-wildcard', [
    { type: 'path_boundary', zone: 'auth', deny: ['src/legacy-*/*.ts'] },
  ])
  assert.deepEqual(dirWildcard.codes, [], 'an ambiguous deny is not called inert')

  // And a divergence in the literal prefix is still provable, wildcards or not.
  const literalDivergence = await verifyRawLaws('boundary-literal-divergence', [
    { type: 'path_boundary', zone: 'auth', deny: ['src/legacy/*.ts'] },
  ])
  assert.deepEqual(literalDivergence.codes, ['DYNAMIC_REVIEW_REQUIRED'], 'a wildcard AFTER a diverging literal segment is still a proof')

  const noLiteralAtAll = await verifyRawLaws('boundary-no-literal', [
    { type: 'path_boundary', zone: 'auth', deny: ['*/**'] },
  ])
  assert.deepEqual(noLiteralAtAll.codes, [], 'a deny with no literal segment could match anything, so nothing is proven')
})

test('verifier: path_boundary naming an undeclared zone is reported as LAW_ZONE_MISSING', async () => {
  const result = await verifyRawLaws('boundary-nozone', [{ type: 'path_boundary', zone: 'nosuch', deny: ['src/**'] }])
  assert.deepEqual(result.codes, ['LAW_ZONE_MISSING'])
})

test('verifier: an unimplemented check type is a problem, never a silent pass', async () => {
  // Bypass parse-time rejection to simulate a bundle produced by a newer ratchet.
  const root = makeProject({
    name: 'unknowncheck',
    adrs: { '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.x', statement: 'S.', checks: [] }] }) },
    files: { 'src/auth/x.ts': 'x\n' },
  })
  const bundle = {
    version: 1,
    project: 'unknowncheck',
    laws: [{ id: 'auth.x', statement: 'S.', zones: ['auth'], authority: 'human', sourceAdr: '0001', approvedBy: null, checks: [{ type: 'from_the_future' }] }],
  }
  const verified = await verifier.verifyProject({ root, bundle, config: { zones: [] }, runCommand: null })
  assert.deepEqual(verified.problems.map((entry) => entry.code), ['DYNAMIC_REVIEW_REQUIRED'])
  assert.ok(verified.problems[0].message.includes('NOT evaluated'))
})

test('verifier: an empty bundle is a problem rather than a clean pass', async () => {
  const root = makeProject({ name: 'emptybundle', adrs: {} })
  const verified = await verifier.verifyProject({ root, bundle: { version: 1, project: 'emptybundle', laws: [] }, config: { zones: [] }, runCommand: null })
  assert.equal(verified.ok, false)
  assert.ok(verified.problems.some((entry) => entry.code === 'LAWS_NONE'))
})

test('verifier: dependency checks never read node_modules', async () => {
  const result = await verifyOneLaw('ignorenm', [{ type: 'forbidden_dependency', patterns: ['session-file-store'] }], {
    files: {
      'package.json': JSON.stringify({ name: 'x', dependencies: {} }),
      'node_modules/session-file-store/package.json': JSON.stringify({ name: 'session-file-store' }),
    },
  })
  assert.equal(result.problems.length, 0, 'a transitive copy under node_modules is not the project declaring it')
})

test('verifier: the report counts what was actually evaluated', async () => {
  const verified = await verifyOneLaw(
    'counts',
    [
      { type: 'required_file', path: 'src/auth/session.ts' },
      { type: 'forbidden_file', path: 'src/auth/file-store.ts' },
    ],
    { files: { 'src/auth/session.ts': 'x\n' } },
  )
  assert.equal(verified.report.counts.laws, 1)
  assert.equal(verified.report.counts.checksEvaluated, 2)
  assert.equal(verified.report.counts.errors, 0)
  assert.ok(verified.report.specHash.startsWith('sha256:'))
})

// ---------------------------------------------------------------------------
// glob semantics
// ---------------------------------------------------------------------------

test('glob: ** crosses segments and * does not', () => {
  const files = ['src/auth/a.ts', 'src/auth/deep/b.ts', 'src/other/c.ts', 'src/auth/x/y/z.ts']
  assert.deepEqual(verifier.matchFiles(files, 'src/auth/**'), ['src/auth/a.ts', 'src/auth/deep/b.ts', 'src/auth/x/y/z.ts'])
  assert.deepEqual(verifier.matchFiles(files, 'src/auth/*'), ['src/auth/a.ts'])
  assert.deepEqual(verifier.matchFiles(files, 'src/**/*.ts'), files)
})

test('glob: regex metacharacters in a pattern are literal', () => {
  const files = ['src/a+b.ts', 'src/aab.ts']
  assert.deepEqual(verifier.matchFiles(files, 'src/a+b.ts'), ['src/a+b.ts'])
})

// ---------------------------------------------------------------------------
// probe: the predecessor's recorded defects are now covered by the compiler
// ---------------------------------------------------------------------------

test('regression: the five probed predecessor scenarios are decided, not silent', () => {
  const scenarios = [
    {
      name: 'A-dangling-supersession',
      adrs: {
        '0001-first.adr.md': adrText({ id: '0001', laws: [{ id: 'a.one', statement: 'Poll the API.', checks: [] }] }),
        '0002-second.adr.md': adrText({ id: '0002', supersedes: ['0001'], laws: [{ id: 'b.two', statement: 'Push webhooks.', checks: [] }] }),
        '0003-third.adr.md': adrText({ id: '0003', supersedes: ['9999'], laws: [{ id: 'c.three', statement: 'Drop webhooks.', checks: [] }] }),
      },
      expectCode: 'ADR_SUPERSEDES_DANGLING',
      expectLaws: ['b.two', 'c.three'],
    },
    {
      name: 'B-non-record-filenames',
      adrs: {
        '0007-real.adr.md': adrText({ id: '0007', laws: [{ id: 'a.one', statement: 'Be real.', checks: [] }] }),
        'README.md': '# How to write a record\n',
        'decisions.md': '# Everything at once\n',
      },
      expectCode: 'ADR_FILE_INVALID',
      expectLaws: ['a.one'],
    },
  ]

  for (const scenario of scenarios) {
    const root = makeProject({ name: scenario.name, adrs: scenario.adrs })
    const result = compile(root)
    assert.ok(
      result.codes.includes(scenario.expectCode),
      `${scenario.name}: expected ${scenario.expectCode}, got ${JSON.stringify(result.codes)}`,
    )
    assert.deepEqual(result.laws, scenario.expectLaws, `${scenario.name}: law set`)
  }
})

test('regression: a corpus that lost a record reports it instead of answering "nothing to review"', () => {
  // The predecessor's sharpest failure: a bogus supersession removed a live
  // decision AND pushed the population below its comparison threshold, so the
  // output was "nothing to reconcile yet" from a corpus that had just shrunk.
  const root = makeProject({
    name: 'shrink',
    adrs: {
      '0001-real.adr.md': adrText({ id: '0001', laws: [{ id: 'a.one', statement: 'One.', checks: [] }] }),
      '0002-bogus.adr.md': adrText({ id: '0002', supersedes: ['9999'], laws: [{ id: 'b.two', statement: 'Two.', checks: [] }] }),
    },
  })
  const result = compile(root)
  assert.equal(result.ok, false)
  assert.ok(result.codes.includes('ADR_SUPERSEDES_DANGLING'))
  assert.equal(result.report.counts.active, 2, 'both decisions remain in force, so the count never shrinks silently')
})

// ---------------------------------------------------------------------------
// tool surface: the plugin registers through defineTool and the harness boots
// ---------------------------------------------------------------------------

test('setup: the harness packages this checkout imports are linked', () => {
  // The single failure that tells a reader of a fresh clone what to do. Everything else
  // in this file runs without the harness; only the adapter test needs the packages, and
  // `install.sh` links them on a machine it set up. Without this test the reader got an
  // ERR_MODULE_NOT_FOUND stack trace and no way to know it was a setup step.
  assert.equal(
    toolsLoadError,
    null,
    'the tool surface in this plugin imports @deepseek-ai/dsh-tools, which lives in the harness install rather than in this repository; run `node scripts/dev-link.mjs` in the kit checkout to link it',
  )
})

test('tools: the plugin module loads and every tool is declared', { skip: HARNESS_SKIP }, () => {
  const pluginPath = `file:///${join(PLUGIN, 'ratchet-tools.mjs').replace(/\\/g, '/')}`
  const output = execFileSync(process.execPath, [
    '-e',
    `import(${JSON.stringify(pluginPath)}).then((m) => {
       const registered = []
       const ctx = {
         effect(fn) { fn() },
         tools: { register(def) { registered.push(def); return () => {} }, schemas: () => [] },
         get: () => undefined,
       }
       m.apply(ctx)
       process.stdout.write(JSON.stringify({ name: m.name, inject: m.inject, tools: registered.map((d) => d.name).sort() }))
     })`,
  ], { encoding: 'utf8' })
  const parsed = JSON.parse(output)
  assert.equal(parsed.name, 'ratchet')
  assert.deepEqual(parsed.tools, [
    'ratchet_bootstrap',
    'ratchet_compile',
    'ratchet_deduplicate',
    'ratchet_ingest',
    'ratchet_ingest_batch',
    'ratchet_ingest_source',
    'ratchet_ratify',
    'ratchet_review',
    'ratchet_status',
    'ratchet_verify',
  ])
  assert.ok(parsed.inject.includes('tools'))
  assert.ok(
    !parsed.inject.includes('subagents'),
    'the plugin must not DEPEND on a service a base-only composition lacks; the dynamic layer reaches it opportunistically',
  )
})

test('tools: a manifest bootstrap preview produces a config the parser accepts', () => {
  const opsPath = `file:///${join(PLUGIN, 'ratchet-ops.mjs').replace(/\\/g, '/')}`
  const output = execFileSync(process.execPath, [
    '-e',
    `import(${JSON.stringify(opsPath)}).then(async (m) => {
       const preview = m.bootstrap({ mode: 'preview', name: 'probe-project' })
       const parsed = JSON.parse(preview.manifestText)
       process.stdout.write(JSON.stringify({ manifest: parsed, files: preview.wouldCreate }))
     })`,
  ], { encoding: 'utf8' })
  const parsed = JSON.parse(output)
  assert.equal(parsed.manifest.ratchet.enabled, true)
  assert.equal(parsed.manifest.name, 'probe-project')
  const { config, problems } = schema.parseRatchetConfig(JSON.stringify(parsed.manifest))
  assert.deepEqual(problems, [])
  assert.equal(config.enabled, true)
  assert.ok(parsed.files.includes('docs/adrs/'), 'the decisions directory is part of the plan')
  assert.ok(parsed.files.includes('docs/ratchet/sources/'), 'the sources directory is part of the plan')
  assert.ok(
    parsed.files.some((path) => path.endsWith('.adr.md')),
    'the plan includes a starter ADR so the project has one valid record immediately',
  )
  // The preview must list the manifest, because apply writes it: an apply that creates a
  // file the preview never mentioned is a preview nobody can plan from.
  assert.ok(parsed.files.includes('.dsh/project.json'), `the plan names the manifest it writes: ${parsed.files.join(', ')}`)
})

test('tools: the bootstrapped starter record agrees with the source file beside it', () => {
  // The README says every ADR records its source hash, and the generated pair has to hold
  // that from the first file a project owns вЂ” a starter record whose hash matched nothing
  // taught the reader that the hash is decoration.
  const root = join(tmpdir(), `ratchet-bootstrap-hash-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  const plan = ratchetBootstrap.bootstrapPreview({ name: 'hash-fixture' })
  const applied = ratchetBootstrap.bootstrapApply(root, plan)
  assert.ok(applied.created.includes('.dsh/project.json'), 'the manifest is created by the plan, not by a side path')

  const readme = readFileSync(join(root, 'docs', 'ratchet', 'sources', 'README.md'), 'utf8')
  const helper = plan.files.find((entry) => entry.path.endsWith('0001-record-decisions-as-adrs.adr.md'))
  assert.ok(helper, 'the starter record is part of the plan')
  const match = /^\s+hash:\s*(sha256:[0-9a-f]{64})$/m.exec(helper.text)
  assert.ok(match, 'the starter record declares a source hash rather than a placeholder')
  assert.equal(match[1], schema.hashSource(readme), 'and it hashes the README the same plan writes')

  // Applying twice skips what exists rather than rewriting it, and says so.
  const second = ratchetBootstrap.bootstrapApply(root, plan)
  assert.deepEqual(second.created, [])
  assert.ok(second.skipped.includes('.dsh/project.json'))
  assert.equal(second.manifestWritten, false)
  rmSync(root, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// the compile trigger: a judgement the compiler asked for is actually made
// ---------------------------------------------------------------------------

/**
 * Mounts the plugin over a stub harness and returns its registered tools by name.
 *
 * A stub rather than a boot: the claim under test is the WIRING вЂ” which service is
 * consulted, what happens when it is absent, and that a judge cannot start a review
 * of its own вЂ” and each of those is a branch a live profile would take minutes and
 * a model turn to reach.
 */
function mountPlugin(services = {}) {
  if (tools === null) {
    // Thrown rather than returned: a caller that cannot load the adapter has nothing to
    // assert about, and a silent empty registry would turn every wiring claim into a
    // passing test about nothing.
    throw new Error(`the harness adapter did not load: ${toolsLoadError}`)
  }
  const definitions = new Map()
  const ctx = {
    effect(fn) {
      fn()
      return () => {}
    },
    on() {
      return () => {}
    },
    get: (name) => services[name],
    tools: {
      register(definition) {
        definitions.set(definition.name, definition)
        return () => {}
      },
      guard() {
        return () => {}
      },
      schemas: () => [],
    },
  }
  tools.apply(ctx)
  return definitions
}

/** A project the compiler cannot finish: one law id, one statement, two check sets. */
function ambiguousProject(name) {
  return makeProject({
    name,
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [{ id: 'auth.shared', statement: 'One rule, one wording.', checks: [{ type: 'required_file', path: 'src/auth/a.ts' }] }],
      }),
      '0002-b.adr.md': adrText({
        id: '0002',
        zones: ['auth'],
        laws: [{ id: 'auth.shared', statement: 'One rule, one wording.', checks: [{ type: 'required_file', path: 'src/auth/b.ts' }] }],
      }),
    },
  })
}

/**
 * A fake subagents + agents harness for the judge pool.
 *
 * It records `startContinuable` (child creation), `sendMessage` (per-call follow-ups),
 * `interrupt` and `drainContinuableChildren`, and exposes a synthetic child whose
 * `whenIdle()` appends this turn's answer to a session log. It is deliberately a FAKE of
 * the durable-child seam: the real API facts (startContinuable returns `{childId}`, a
 * continuable child carries no output schema, output is read from the child session) are
 * measured from the installed harness and recorded in `probes/api-probe/judge-reuse-probe.mjs`.
 *
 * @param options - `{ verdict, failFirstSend, turnEnd }`.
 * @returns `{ services, spawned, sent, interrupted, released, children, control, maxActive }`.
 *   `control.gate` is an optional promise every turn awaits before finishing, so a test can
 *   hold a turn open and cancel or observe it.
 */
function stubJudgeHarness({ verdict = { ok: true, findings: [] }, failFirstSend = false, turnEnd = 'completed' } = {}) {
  const spawned = []
  const sent = []
  const interrupted = []
  const released = []
  const children = new Map()
  const control = { gate: null }
  let nextId = 1
  let sendAttempts = 0
  let active = 0
  let maxActive = 0

  const makeChild = (id) => {
    const events = []
    let seq = 0
    const child = {
      id,
      status: 'idle',
      pending: [],
      session: { get seq() { return seq }, snapshotEvents: (from = 0) => events.slice(from) },
      async whenIdle() {
        active -= 1
        if (control.gate !== null) await control.gate
        events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: JSON.stringify(verdict) }] } } })
        events.push({ type: 'turn/end', data: { reason: { kind: turnEnd } } })
        seq = events.length
      },
    }
    return child
  }

  const subagents = {
    async startContinuable(spec) {
      const childId = `judge-${nextId}`
      nextId += 1
      spawned.push({ provider: spec.provider, label: spec.label, options: spec.request, spec })
      children.set(childId, makeChild(childId))
      active += 1
      maxActive = Math.max(maxActive, active)
      return { childId, messageId: `${childId}-m0` }
    },
    async sendMessage(_parent, childId, content) {
      sendAttempts += 1
      if (failFirstSend && sendAttempts === 1) throw new Error('stub: the judge send failed')
      const child = children.get(childId)
      if (child === undefined) throw new Error(`stub: no judge child ${String(childId)}`)
      sent.push({ childId, text: content[0].text })
      child.pending.push(content[0])
      active += 1
      maxActive = Math.max(maxActive, active)
      return `${childId}-m${child.pending.length}`
    },
    interrupt(childId, authority) {
      interrupted.push({ childId, authority })
    },
    async drainContinuableChildren(_parent, ids) {
      released.push(...ids)
    },
  }
  const agents = { roots: () => [], get: (id) => children.get(id) }
  return { services: { subagents, agents }, spawned, sent, interrupted, released, children, control, get maxActive() { return maxActive } }
}

/** The static/call split a real review prompt has, for the judge-pool tests. */
const JUDGE_STATIC = '# Project\n\nName: fixture\n'
const judgePrompt = (material) => `${JUDGE_STATIC}\n# Question\n\n${material}`
const signalOf = () => new AbortController().signal

/**
 * The pool under test over the fake harness.
 */
function stubJudgePool(options = {}) {
  const harness = stubJudgeHarness(options)
  const pool = judgeModule.createJudgePool({
    runtimeOf: () => harness.services.subagents,
    agentsOf: () => harness.services.agents,
  })
  return { harness, pool }
}

test('judge: two consecutive calls create ONE judge and each gets only its own material', async () => {
  const { harness, pool } = stubJudgePool()
  const parent = { id: 'parent-one' }

  const first = await pool.judge({ parent, signal: signalOf(), prompt: judgePrompt('first material'), staticPrompt: JUDGE_STATIC })
  const second = await pool.judge({ parent, signal: signalOf(), prompt: judgePrompt('second material'), staticPrompt: JUDGE_STATIC })

  assert.equal(harness.spawned.length, 1, `two calls must create one judge, got ${harness.spawned.length}`)
  assert.equal(first.created, true)
  assert.equal(first.reused, false)
  assert.equal(second.created, false)
  assert.equal(second.reused, true)
  // The first call's material was the creation prompt; the second travelled as a follow-up.
  assert.match(String(harness.spawned[0].options.prompt[0].text), /first material/)
  assert.equal(harness.sent.length, 1, 'only the second call sends a follow-up')
  assert.match(harness.sent[0].text, /second material/)
  assert.doesNotMatch(harness.sent[0].text, /^# Project/, 'the static prefix is not resent')
  assert.equal(harness.released.length, 0, 'a finished call must not dispose the shared judge')
})

test('judge: two concurrent calls are serialized onto the one judge, never interleaved', async () => {
  const { harness, pool } = stubJudgePool()
  const parent = { id: 'parent-concurrent' }
  const gate = Promise.withResolvers()
  harness.control.gate = gate.promise

  const first = pool.judge({ parent, signal: signalOf(), prompt: judgePrompt('concurrent A'), staticPrompt: JUDGE_STATIC })
  const second = pool.judge({ parent, signal: signalOf(), prompt: judgePrompt('concurrent B'), staticPrompt: JUDGE_STATIC })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(harness.maxActive, 1, 'a second turn must not open while the first is running')
  gate.resolve()
  const [a, b] = await Promise.all([first, second])

  assert.equal(harness.spawned.length, 1, 'concurrent calls share one judge')
  assert.equal(a.created, true)
  assert.equal(b.reused, true)
  assert.equal(harness.maxActive, 1, 'turns never interleave')
  assert.match(harness.sent[0].text, /concurrent B/, 'B ran only after A finished')
})

test('judge: a dead judge is recreated once and the call still answers', async () => {
  const { harness, pool } = stubJudgePool({ failFirstSend: true })
  const parent = { id: 'parent-dead' }

  const first = await pool.judge({ parent, signal: signalOf(), prompt: judgePrompt('warm up'), staticPrompt: JUDGE_STATIC })
  assert.equal(first.created, true)
  assert.equal(harness.spawned.length, 1)

  // The follow-up send fails once: the pool must release the dead child and create one fresh.
  const second = await pool.judge({ parent, signal: signalOf(), prompt: judgePrompt('after failure'), staticPrompt: JUDGE_STATIC })
  assert.equal(harness.spawned.length, 2, 'a dead judge is recreated exactly once')
  assert.equal(second.created, true)
  assert.ok(harness.released.includes('judge-1'), 'the dead child is released before the replacement')
})

test('judge: a cancelled call interrupts only its own turn and keeps the shared judge', async () => {
  const { harness, pool } = stubJudgePool()
  const parent = { id: 'parent-cancel' }

  await pool.judge({ parent, signal: signalOf(), prompt: judgePrompt('warm up'), staticPrompt: JUDGE_STATIC })
  assert.equal(harness.spawned.length, 1)

  const gate = Promise.withResolvers()
  harness.control.gate = gate.promise
  const controller = new AbortController()
  const pending = pool.judge({ parent, signal: controller.signal, prompt: judgePrompt('cancelled work'), staticPrompt: JUDGE_STATIC })
  await new Promise((resolve) => setTimeout(resolve, 0))
  controller.abort()
  gate.resolve()
  await assert.rejects(pending, /cancelled/)

  assert.equal(harness.interrupted.length, 1, 'the cancelled turn is interrupted')
  assert.equal(harness.interrupted[0].childId, 'judge-1')
  assert.equal(harness.released.length, 0, 'the shared judge is NOT disposed by a cancelled call')

  // A later call keeps using the same child.
  harness.control.gate = null
  const next = await pool.judge({ parent, signal: signalOf(), prompt: judgePrompt('later work'), staticPrompt: JUDGE_STATIC })
  assert.equal(harness.spawned.length, 1, 'the judge survived the cancellation')
  assert.equal(next.reused, true)
})

test('judge: a changed static prefix recreates the judge rather than serving stale orientation', async () => {
  const { harness, pool } = stubJudgePool()
  const parent = { id: 'parent-stale' }
  await pool.judge({ parent, signal: signalOf(), prompt: `# Project\n\nv1\n\n# Question\n\nq1`, staticPrompt: '# Project\n\nv1\n' })
  const second = await pool.judge({ parent, signal: signalOf(), prompt: `# Project\n\nv2\n\n# Question\n\nq2`, staticPrompt: '# Project\n\nv2\n' })
  assert.equal(harness.spawned.length, 2, 'a changed static context is not cached as if it were current')
  assert.equal(second.created, true)
  assert.ok(harness.released.includes('judge-1'))
})

test('compile: a judgement the compiler asked for is made, not merely recorded', { skip: HARNESS_SKIP }, async () => {
  const root = ambiguousProject('compile-trigger')
  const compiled = compile(root)
  assert.ok(compiled.report.reviewRequired.length > 0, 'the fixture must be one the compiler cannot decide')

  const harness = stubJudgeHarness()
  const agent = { id: 'agent-root', session: { header: { cwd: root } } }
  const definitions = mountPlugin({ ...harness.services, agents: { ...harness.services.agents, roots: () => [agent] } })
  const result = await definitions.get('ratchet_compile').execute({}, { agent })

  assert.equal(result.dynamicReview.ran, true, `expected the review to run: ${JSON.stringify(result.dynamicReview)}`)
  assert.equal(harness.spawned.length, 1, 'exactly one judge, for one marked question')
  assert.match(String(harness.spawned[0].options.prompt[0].text), /auth\.shared/, 'the judge is asked about the corpus that raised the question')
  assert.equal(result.dynamicReview.advisory, true)
  assert.equal(result.dynamicReview.gate, false, 'a review never becomes the gate')
})

test('compile: a judge cannot start a review of its own, and says so', { skip: HARNESS_SKIP }, async () => {
  const root = ambiguousProject('compile-trigger-child')
  // The same runtime, but the registry does not list this caller as a root вЂ” which
  // is exactly what a spawned judge looks like from inside its own tool call.
  const agent = { id: 'agent-child', session: { header: { cwd: root } } }
  const harness = stubJudgeHarness()
  const definitions = mountPlugin({ ...harness.services, agents: { ...harness.services.agents, roots: () => [] } })
  const result = await definitions.get('ratchet_compile').execute({}, { agent })

  assert.equal(result.dynamicReview.ran, false)
  assert.match(result.dynamicReview.reason, /root/)
  assert.equal(harness.spawned.length, 0, 'no judge was spawned from inside a judge')
})

test('compile: the trigger is skippable, and a composition with no judge reports that', { skip: HARNESS_SKIP }, async () => {
  const root = ambiguousProject('compile-trigger-off')
  const agent = { id: 'agent-root', session: { header: { cwd: root } } }

  const offHarness = stubJudgeHarness()
  const off = mountPlugin({ ...offHarness.services, agents: { ...offHarness.services.agents, roots: () => [agent] } })
  const offResult = await off.get('ratchet_compile').execute({ review: false }, { agent })
  assert.equal(offResult.dynamicReview, undefined, 'review: false keeps the compile purely static')
  assert.equal(offHarness.spawned.length, 0)

  const noJudge = mountPlugin({ agents: { roots: () => [agent] } })
  const noJudgeResult = await noJudge.get('ratchet_compile').execute({}, { agent })
  assert.equal(noJudgeResult.dynamicReview.ran, false)
  assert.match(noJudgeResult.dynamicReview.reason, /cannot spawn a judge/)

  // A fresh corpus the compiler has no question about is STILL stale — no corpus review has
  // ever read its law set — and the automatic pass now fires on that fact. Before the trigger
  // read `contradictionReview.stale`, this case paid no judge and passed for the wrong reason:
  // the exec object below was keyed `cleanAgent` instead of `agent`, so the project was never
  // reached at all.
  const clean = makeProject({
    name: 'compile-trigger-clean',
    adrs: { '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.one', statement: 'One.', checks: [] }] }) },
  })
  const cleanAgent = { id: 'agent-root', session: { header: { cwd: clean } } }
  const cleanHarness = stubJudgeHarness()
  const cleanDefs = mountPlugin({ ...cleanHarness.services, agents: { ...cleanHarness.services.agents, roots: () => [cleanAgent] } })
  const cleanResult = await cleanDefs.get('ratchet_compile').execute({}, { agent: cleanAgent })
  assert.equal(cleanResult.dynamicReview.ran, true, 'a law set nobody reviewed triggers the automatic pass')
  assert.equal(cleanResult.dynamicReview.stale, true, 'and the staleness is the fact that triggered it')
  assert.equal(cleanHarness.spawned.length, 1, 'the pass pays for one judge')
})

test('compile: a law set no corpus review has read triggers the automatic pass, which clears the staleness', { skip: HARNESS_SKIP }, async () => {
  // The DEAD TRIGGER this pins: `reviewWhenRequired` used to decide `stale` from a problem
  // code (`CONTRADICTION_DETECTION_STALE`) that is emitted nowhere, so a compile with an empty
  // `reviewRequired` and a stale `contradictionReview` spawned no judge at all. A corpus the
  // compiler has no question about is exactly that case.
  const root = cleanCorpusProject('compile-stale-trigger')
  const before = ops.compile({ root })
  assert.equal(before.reviewRequired.length, 0, 'the compiler has no question of its own')
  assert.equal(before.contradictionReview.stale, true, 'and no corpus review has read its law set')

  const harness = stubJudgeHarness()
  const agent = { id: 'agent-root', session: { header: { cwd: root } } }
  const defs = mountPlugin({ ...harness.services, agents: { ...harness.services.agents, roots: () => [agent] } })
  const result = await defs.get('ratchet_compile').execute({}, { agent })

  assert.equal(result.dynamicReview.ran, true, `expected the pass to run: ${JSON.stringify(result.dynamicReview)}`)
  assert.equal(result.dynamicReview.stale, true, 'the staleness is what triggered it')
  assert.deepEqual(
    Object.keys(result.dynamicReview.jobs).sort(),
    ['review_corpus', 'review_duplicates'],
    'one automatic pass runs both corpus jobs',
  )
  // Two judge TURNS on ONE pooled judge: the corpus review creates it, the duplicate review
  // travels as a follow-up on the same child.
  assert.equal(harness.spawned.length, 1, 'two turns in one pass pay for one judge')
  assert.equal(harness.sent.length, 1, 'the second job is a follow-up turn on the same judge')

  // The review recorded the law set it read, so the fact that triggered the pass is cleared
  // by the very call that created it.
  const after = ops.compile({ root })
  assert.equal(after.contradictionReview.stale, false, 'the recorded review clears the staleness')
  assert.equal(after.contradictionReview.reviewed, true)

  // ...and a later compile over the same law set pays no judge again.
  const again = stubJudgeHarness()
  const againDefs = mountPlugin({ ...again.services, agents: { ...again.services.agents, roots: () => [agent] } })
  const second = await againDefs.get('ratchet_compile').execute({}, { agent })
  assert.equal(second.dynamicReview, undefined, 'a law set with a recorded review is not reviewed again')
  assert.equal(again.spawned.length, 0)
})

test('compile: review:false neither runs the automatic pass nor clears its trigger', { skip: HARNESS_SKIP }, async () => {
  const root = cleanCorpusProject('compile-stale-off')
  const harness = stubJudgeHarness()
  const agent = { id: 'agent-root', session: { header: { cwd: root } } }
  const defs = mountPlugin({ ...harness.services, agents: { ...harness.services.agents, roots: () => [agent] } })

  const result = await defs.get('ratchet_compile').execute({ review: false }, { agent })
  assert.equal(result.dynamicReview, undefined, 'review: false keeps the compile purely static')
  assert.equal(harness.spawned.length, 0)
  assert.equal(ops.compile({ root }).contradictionReview.stale, true, 'the fact that would have triggered the pass survives')
})

test('compile: a non-root caller reports the automatic pass unrun and spawns nothing', { skip: HARNESS_SKIP }, async () => {
  const root = cleanCorpusProject('compile-stale-child')
  const harness = stubJudgeHarness()
  const agent = { id: 'agent-child', session: { header: { cwd: root } } }
  // The same runtime, but the registry does not list this caller as a root — a spawned judge
  // compiling from inside its own tool call.
  const defs = mountPlugin({ ...harness.services, agents: { ...harness.services.agents, roots: () => [] } })
  const result = await defs.get('ratchet_compile').execute({}, { agent })

  assert.equal(result.dynamicReview.ran, false)
  assert.match(result.dynamicReview.reason, /root/)
  assert.equal(harness.spawned.length, 0, 'a judge cannot start a review of its own')
  assert.equal(ops.compile({ root }).contradictionReview.stale, true, 'the trigger survives an unrun pass')
})

test('review: a semantic duplicate and a deprecated decision reach needsHuman as advisory kinds', { skip: HARNESS_SKIP }, async () => {
  // Two records state one constraint in different words under different law ids: the
  // deterministic command sees nothing, and only a judge can. The retirement finding is the
  // second automatic question the corpus review asks.
  const root = semanticDuplicateProject('advisory-needs')
  // Write the generated specs first: a second compile of a project that tracks spec documents
  // but has never emitted them is `SPEC_OUT_OF_DATE` for a reason unrelated to this test.
  const before = ops.compile({ root, write: true })

  const duplicateVerdict = {
    ok: false,
    findings: [
      {
        severity: 'error',
        kind: 'semantic_duplicate',
        lawId: 'auth.one',
        lawQuote: 'Sessions must live in Redis.',
        sourceAdr: '0002',
        explanation: 'ADR 0002 restates the constraint ADR 0001 states',
      },
    ],
  }
  const duplicateReview = await ops.review({ root, job: 'review_duplicates', spawnJudge: async () => ({ structured: duplicateVerdict, output: '', stopReason: 'completed' }) })
  assert.equal(duplicateReview.declined, false, 'a semantic duplicate is advisory, never a block')
  assert.equal(duplicateReview.gate, false)
  const deprecatedVerdict = {
    ok: false,
    findings: [
      { severity: 'warning', kind: 'deprecated_decision', sourceAdr: '0002', explanation: 'ADR 0002 is restated by ADR 0001 and should be retired' },
    ],
  }
  const deprecatedReview = await ops.review({ root, job: 'review_corpus', spawnJudge: async () => ({ structured: deprecatedVerdict, output: '', stopReason: 'completed' }) })
  assert.equal(deprecatedReview.declined, false, 'a retirement finding is advisory, never a block')
  assert.equal(deprecatedReview.gate, false)

  const view = decisionsModule.deriveDecisions({ root })
  const duplicate = view.needsHuman.find((need) => need.kind === 'duplicate')
  const deprecated = view.needsHuman.find((need) => need.kind === 'deprecated')
  assert.ok(duplicate, `expected a duplicate need, got ${JSON.stringify(view.needsHuman.map((need) => need.kind))}`)
  assert.ok(deprecated, `expected a deprecated need, got ${JSON.stringify(view.needsHuman.map((need) => need.kind))}`)
  assert.equal(deprecated.id, '0002', 'the deprecated need names the decision to retire')
  assert.match(deprecated.action, /supersedes|op: remove/, 'the action names the retirement shape')
  assert.equal(deprecated.draft, null, 'a retirement is a human act, so nothing is drafted for it')
  // The duplicate either produced a draft or says why it could not; both are needs a human acts on.
  assert.ok(duplicate.draft !== null || (duplicate.draftReason ?? '').length > 0)

  // ADVISORY, never a gate: the compile's own verdict is unchanged by either finding.
  const after = ops.compile({ root })
  assert.equal(after.ok, before.ok)
  assert.deepEqual(after.problems.map((entry) => entry.code), before.problems.map((entry) => entry.code))
})

test('decisions: the view cap counts a deprecated need like any other kind', () => {
  const total = decisionsModule.MAX_STATE_NEEDS_PER_KIND + 3
  const needs = Array.from({ length: total }, (_unused, index) => ({
    kind: 'deprecated',
    id: String(index).padStart(4, '0'),
    title: 'a decision to retire',
    path: null,
    reason: 'the review says so',
    action: 'supersede it',
    draft: null,
    draftReason: 'a retirement is a human act',
  }))
  const capped = decisionsModule.capDecisionsView({ records: [], specs: [], queue: { pending: [], blocked: [] }, needsHuman: needs, truncated: null })
  assert.equal(capped.needsHuman.length, decisionsModule.MAX_STATE_NEEDS_PER_KIND, 'the per-kind ceiling applies to deprecated too')
  const cut = capped.truncated?.needsHuman?.kinds ?? []
  assert.ok(
    cut.some((entry) => entry.kind === 'deprecated' && entry.total === total),
    `a cut deprecated kind is named rather than dropped: ${JSON.stringify(cut)}`,
  )
})

test('review tool: two reviews in one session reuse ONE judge and each sends its own change', { skip: HARNESS_SKIP }, async () => {
  const root = reviewableProject('judge-reuse-review')
  const harness = stubJudgeHarness()
  const agent = { id: 'agent-root', session: { header: { cwd: root } } }
  const definitions = mountPlugin({ ...harness.services, agents: { ...harness.services.agents, roots: () => [agent] } })
  const reviewTool = definitions.get('ratchet_review')

  const first = await reviewTool.execute({ job: 'review_change', change: 'switch session storage to files' }, { agent })
  const second = await reviewTool.execute({ job: 'review_change', change: 'switch session storage to sqlite' }, { agent })

  assert.equal(first.stage, 'review', `first review ran: ${JSON.stringify(first.problems ?? [])}`)
  assert.equal(second.stage, 'review', `second review ran: ${JSON.stringify(second.problems ?? [])}`)
  assert.equal(harness.spawned.length, 1, 'one session must pay for one judge, not one per review')
  assert.match(String(harness.spawned[0].options.prompt[0].text), /files/, 'the first change is the creation task')
  assert.equal(harness.sent.length, 1, 'the second review is a follow-up turn')
  assert.match(harness.sent[0].text, /sqlite/, 'the second change travels as call material')
  assert.doesNotMatch(harness.sent[0].text, /^# Material/m, 'the static corpus prefix is delivered once')
})

// ---------------------------------------------------------------------------
// source verification: ADR_SOURCE_MISSING / ADR_SOURCE_HASH_MISMATCH
// ---------------------------------------------------------------------------

/** Compiles a project whose single ADR declares the given source fields. */
function compileWithSource(name, { sourcePath = SOURCE_PATH, sourceHash = undefined, sourceFile = SOURCE_TEXT } = {}) {
  const root = makeProject({
    name,
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourcePath,
        sourceHash: sourceHash === undefined ? schema.hashSource(sourceFile) : sourceHash,
        zones: ['auth'],
        laws: [{ id: 'a.one', statement: 'One.', checks: [] }],
      }),
    },
  })
  if (sourcePath !== SOURCE_PATH && sourceFile !== null) {
    mkdirSync(join(root, sourcePath, '..'), { recursive: true })
    writeFileSync(join(root, sourcePath), sourceFile)
  }
  return { root, result: compiler.compileProject(root) }
}

test('source: a matching hash verifies and is reported as verified', () => {
  const { result } = compileWithSource('src-ok')
  assert.equal(result.ok, true, `codes=${JSON.stringify(result.problems.map((e) => e.code))}`)
  const corpus = compiler.readAdrCorpus(
    makeProject({
      name: 'src-ok-2',
      adrs: { '0001-a.adr.md': adrText({ id: '0001', sourceHash: schema.hashSource(SOURCE_TEXT) }) },
    }),
    { decisionsDir: 'docs/adrs' },
  )
  assert.equal(corpus.records[0].source.status, 'verified')
  assert.equal(corpus.records[0].source.actualHash, schema.hashSource(SOURCE_TEXT))
})

test('source: a missing source file is ADR_SOURCE_MISSING', () => {
  const root = makeProject({
    name: 'src-missing',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourcePath: 'docs/ratchet/sources/not-there.md',
        sourceHash: schema.hashSource('anything'),
      }),
    },
  })
  const result = compiler.compileProject(root)
  assert.ok(result.problems.some((entry) => entry.code === 'ADR_SOURCE_MISSING'))
  assert.ok(result.problems.some((entry) => entry.message.includes('does not exist')))
})

test('source: an edited source file is ADR_SOURCE_HASH_MISMATCH and names both hashes', () => {
  const edited = `${SOURCE_TEXT}\nWe changed our minds.\n`
  const root = makeProject({
    name: 'src-mismatch',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [{ id: 'a.one', statement: 'One.', checks: [] }],
      }),
    },
  })
  // Edit the source AFTER the ADR recorded its hash, which is the situation the
  // check exists for.
  writeFileSync(join(root, SOURCE_PATH), edited)

  const result = compiler.compileProject(root)
  const entry = result.problems.find((candidate) => candidate.code === 'ADR_SOURCE_HASH_MISMATCH')
  assert.ok(entry, `expected a hash mismatch, got ${JSON.stringify(result.problems.map((e) => e.code))}`)
  assert.equal(entry.recorded, schema.hashSource(SOURCE_TEXT))
  assert.equal(entry.actual, schema.hashSource(edited))
  assert.notEqual(entry.recorded, entry.actual)
})

test('source: a record with no hash is unverified but not an error', () => {
  const root = makeProject({
    name: 'src-nohash',
    adrs: { '0001-a.adr.md': adrText({ id: '0001', sourceHash: null, zones: ['auth'], laws: [{ id: 'a.one', statement: 'One.', checks: [] }] }) },
  })
  const corpus = compiler.readAdrCorpus(root, { decisionsDir: 'docs/adrs' })
  assert.equal(corpus.records[0].source.status, 'unhashed')
  assert.deepEqual(corpus.problems, [])
})

test('source: hashSource is what the CLI prints, so the two cannot disagree', () => {
  const file = join(tmpdir(), `ratchet-hash-${Math.random().toString(36).slice(2, 8)}.md`)
  writeFileSync(file, SOURCE_TEXT)
  const printed = spawnSync(process.execPath, [CLI, 'hash', file], { encoding: 'utf8' }).stdout.trim()
  assert.equal(printed, schema.hashSource(SOURCE_TEXT))
  rmSync(file, { force: true })
})

// ---------------------------------------------------------------------------
// state, reports and the ledger
// ---------------------------------------------------------------------------

test('state: compile records a report, a spec bundle and a ledger event even on failure', () => {
  const root = makeProject({ name: 'state-compile', adrs: { '0001-a.adr.md': '# not an ADR\n' } })
  const result = ops.compile({ root })
  assert.equal(result.ok, false)
  assert.ok(existsSync(join(root, state.STATE_PATHS.compileReport)), 'a failing compile still writes its report')
  const report = JSON.parse(readFileSync(join(root, state.STATE_PATHS.compileReport), 'utf8'))
  assert.ok(report.problems.length > 0)
  const ledger = state.readLedger(root)
  assert.ok(ledger.events.some((event) => event.event === 'ratchet.compile.finish'))
})

test('state: verify records the spec hash it judged, which is what makes VERIFY_NOT_RUN checkable', async () => {
  const root = makeProject({
    name: 'state-verify',
    files: { 'src/auth/session.ts': 'redis\n' },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [{ id: 'a.one', statement: 'One.', checks: [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis' }] }],
      }),
    },
  })
  const verified = await ops.verify({ root })
  assert.equal(verified.ok, true, `codes=${JSON.stringify(verified.problems.map((e) => e.code))}`)
  const recorded = JSON.parse(readFileSync(join(root, state.STATE_PATHS.state), 'utf8'))
  assert.equal(recorded.lastVerify.specHash, verified.specHash)
  assert.equal(recorded.lastVerify.checksEvaluated, 1)
  assert.equal(ops.status(root).verified.ran, true)
})

/** Writes the ADRs' generated spec documents, so the project tracks them. */
function writeSpecs(root) {
  const compiled = compiler.compileProject(root)
  const rendered = compiler.renderSpecs(compiled.bundle)
  for (const [path, text] of Object.entries(rendered.files)) {
    mkdirSync(join(root, path).replace(/[\\/][^\\/]+$/, ''), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return Object.keys(rendered.files)
}

test('state: changing a law makes the previous verification stale', async () => {
  const root = makeProject({
    name: 'state-stale',
    files: { 'src/auth/session.ts': 'redis\n' },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [{ id: 'a.one', statement: 'One.', checks: [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis' }] }],
      }),
    },
  })
  writeSpecs(root)
  assert.equal((await ops.verify({ root })).ok, true)
  // Amend the law so the bundle hash changes.
  writeFileSync(
    join(root, 'docs', 'adrs', '0001-a.adr.md'),
    adrText({
      id: '0001',
      sourceHash: schema.hashSource(SOURCE_TEXT),
      zones: ['auth'],
      laws: [{ id: 'a.one', statement: 'One, amended.', checks: [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis' }] }],
    }),
  )
  const after = ops.status(root)
  assert.equal(after.verified.ran, false)
  assert.equal(after.verified.stale, true)
  assert.ok(after.problems.some((entry) => entry.code === 'VERIFY_NOT_RUN'))
  // The document is now behind the laws, which is the ADVISORY kind: it is reported in
  // `specDrift.stale` with a drafted withdrawal note and does NOT block the status. ADR 0056
  // narrowed the spec-drift law to exactly this.
  assert.ok(after.specDrift.stale.includes('docs/specs/auth.spec.md'))
  assert.ok(after.specDrift.notes.some((note) => note.path === 'docs/specs/auth.spec.md' && typeof note.notePath === 'string'))
  assert.ok(!after.problems.some((entry) => entry.code === 'SPEC_OUT_OF_DATE'), 'a stale document is advisory, not a blocking problem')
})

test('gate: a tampered persisted bundle cannot inject a law into verify', async () => {
  // `verify` recompiles from the corpus, so `.dsh/ratchet/specs.json` is a RECORD of what
  // was compiled, not an input to what is checked. That is what keeps the closed check-field
  // set closed: without it, a law carrying a field the parser refuses could be smuggled in
  // by writing it straight into the persisted bundle, and the zone rule would never see it.
  const root = makeProject({
    name: 'bundle-injection',
    files: { 'src/auth/x.ts': 'redis\n' },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [{ id: 'a.one', statement: 'One.', checks: [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis' }] }],
      }),
    },
  })
  // `compile` is what writes the persisted bundle; `verify` alone does not.
  ops.compile({ root, write: true })
  await ops.verify({ root })
  const bundlePath = join(root, '.dsh', 'ratchet', 'specs.json')
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'))
  bundle.laws.push({
    id: 'injected.law',
    statement: 'Injected into the persisted bundle.',
    zones: ['auth'],
    authority: 'agent',
    sourceAdr: '0001',
    approvedBy: null,
    checks: [{ type: 'required_file', path: 'src/auth/x.ts', secretPath: 'rules/AGENTS.md' }],
  })
  writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`)
  const verified = await ops.verify({ root })
  assert.ok(
    !(verified.laws ?? []).some((law) => law.id === 'injected.law'),
    'a law written only into the persisted bundle is not compiled from it',
  )
})

test('state: a verification that evaluated zero checks does not count as verified', async () => {
  // The sharp case: a project with no laws verifies "cleanly" because there was
  // nothing to check. Reporting that as verified is exactly the silence the
  // ratchet exists to remove.
  const root = makeProject({
    name: 'state-zero',
    adrs: { '0001-a.adr.md': adrText({ id: '0001', sourceHash: schema.hashSource(SOURCE_TEXT), zones: ['auth'], laws: [] }) },
  })
  const verified = await ops.verify({ root })
  assert.equal(verified.ok, false)
  assert.ok(verified.problems.some((entry) => entry.code === 'LAWS_NONE'))
  const after = ops.status(root)
  assert.equal(after.verified.ran, false, 'a zero-check verification must not read as verified')
  assert.ok(after.problems.some((entry) => entry.code === 'VERIFY_NOT_RUN'))
})

test('state: specsRequired false does NOT opt out once generated documents exist', () => {
  // ADR 0012, ratified by 0013, decided this: "the project sets `specsRequired: false` while
  // committing two generated specs, and the code short-circuits on that flag instead of
  // implementing the on-disk clause the design document already states", and its consequence —
  // "a project that removes `specsRequired` no longer loses drift detection". A later commit
  // (7306c19, whose own subject was "turn spec tracking ON by default") reintroduced the
  // short-circuit and this test asserted it, so a ratified decision was regressed by a test that
  // encoded the defect. Only `true` short-circuits.
  const root = makeProject({ name: 'specs-opt-out' })
  mkdirSync(join(root, 'docs', 'specs'), { recursive: true })
  writeFileSync(join(root, 'docs', 'specs', 'zone.spec.md'), '# Spec\n')

  assert.equal(state.tracksSpecDocuments(root, 'docs/specs', undefined), true, 'a document on disk is tracked when the manifest says nothing')
  assert.equal(state.tracksSpecDocuments(root, 'docs/specs', false), true, 'and `false` does not opt out while it exists')
  assert.equal(state.tracksSpecDocuments(root, 'docs/specs', true), true, 'the explicit opt-in is honoured')
})

test('state: deleting the LAST generated document cannot switch drift detection off', () => {
  // The on-disk clause asks whether any document exists, so removing the only one answered "no" and
  // the deletion became invisible — the drift this function exists to catch, reachable by deleting
  // one file. The persisted bundle is the evidence that the project tracks specs.
  const root = makeProject({ name: 'specs-last-doc' })
  mkdirSync(join(root, '.dsh', 'ratchet'), { recursive: true })
  writeFileSync(join(root, state.STATE_PATHS.specBundle), '{"version":1}\n')
  assert.equal(state.tracksSpecDocuments(root, 'docs/specs', false), true, 'a project that ever tracked specs keeps tracking them')
  rmSync(join(root, '.dsh', 'ratchet'), { recursive: true, force: true })
  assert.equal(state.tracksSpecDocuments(root, 'docs/specs', false), false, 'and a project that never did is left alone')
})

test('state: the ledger is append-only and survives an unreadable line', () => {
  const root = makeProject({ name: 'ledger', adrs: {} })
  state.appendLedger(root, 'ratchet.test.one', { a: 1 })
  writeFileSync(join(root, state.STATE_PATHS.ledger), 'not json\n', { flag: 'a' })
  state.appendLedger(root, 'ratchet.test.two', { b: 2 })
  const ledger = state.readLedger(root)
  assert.deepEqual(
    ledger.events.map((event) => event.event),
    ['ratchet.test.one', 'ratchet.test.two'],
  )
  assert.equal(ledger.skipped, 1, 'a damaged line is counted, not thrown')
})

test('state: a non-JSON-safe ledger field is refused rather than written corrupt', () => {
  const root = makeProject({ name: 'ledger-bad', adrs: {} })
  const result = state.appendLedger(root, 'ratchet.test.bad', { circular: undefined, fn: () => {} })
  assert.ok(result.error !== undefined, 'a function is not JSON, so the append must fail loudly')
})

test('state: spec drift distinguishes an edited file from a missing one', () => {
  const root = makeProject({ name: 'drift', adrs: { '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'a.one', statement: 'One.', checks: [] }] }) } })
  const compiled = compiler.compileProject(root)
  const rendered = compiler.renderSpecs(compiled.bundle)
  const missing = state.detectSpecDrift(root, rendered.files)
  assert.equal(missing.missing.length, 1)
  assert.equal(missing.drifted.length, 0)

  const [path, text] = Object.entries(rendered.files)[0]
  mkdirSync(join(root, 'docs', 'specs'), { recursive: true })
  writeFileSync(join(root, path), `${text}\n<!-- hand edit -->\n`)
  const edited = state.detectSpecDrift(root, rendered.files)
  assert.equal(edited.missing.length, 0)
  assert.equal(edited.drifted.length, 1)

  const problems = compiler.specDriftProblems(edited)
  assert.deepEqual(problems.map((entry) => entry.code), ['SPEC_HASH_MISMATCH'])

  writeFileSync(join(root, path), text)
  assert.deepEqual(state.detectSpecDrift(root, rendered.files).drifted, [])
})

// ---------------------------------------------------------------------------
// the gate: exit codes, and falsification
// ---------------------------------------------------------------------------

/** Runs the CLI and returns `{ status, stdout, stderr }`. */
function cli(args) {
  const run = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' }
}

test('gate: exit codes separate "unusable project" from "project has problems"', () => {
  const empty = join(tmpdir(), `ratchet-gate-empty-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(empty, { recursive: true, force: true })
  mkdirSync(empty, { recursive: true })
  const noManifest = cli(['verify', '--root', empty])
  assert.equal(noManifest.status, ops.EXIT.CONFIG, 'no manifest is a configuration failure, not a violation')

  const disabled = makeProject({ name: 'gate-disabled', ratchetEnabled: false, adrs: {} })
  assert.equal(cli(['verify', '--root', disabled]).status, ops.EXIT.CONFIG)

  const emptyDir = makeProject({ name: 'gate-noadr', adrs: {} })
  assert.equal(cli(['verify', '--root', emptyDir]).status, ops.EXIT.CONFIG, 'an empty corpus is unusable')

  const violation = makeProject({
    name: 'gate-violation',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [{ id: 'a.one', statement: 'One.', checks: [{ type: 'required_file', path: 'src/auth/missing.ts' }] }],
      }),
    },
  })
  assert.equal(cli(['verify', '--root', violation]).status, ops.EXIT.PROBLEMS, 'a real violation is exit 1')
})

test('gate: a clean project exits 0 from verify and status', () => {
  const root = makeProject({
    name: 'gate-clean',
    files: { 'src/auth/session.ts': 'redis\n', 'package.json': JSON.stringify({ name: 'x', dependencies: {} }) },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [
          {
            id: 'a.one',
            statement: 'One.',
            checks: [
              { type: 'required_file', path: 'src/auth/session.ts' },
              { type: 'required_text', paths: ['src/auth/**'], pattern: 'redis' },
            ],
          },
        ],
      }),
    },
  })
  assert.equal(cli(['compile', '--root', root, '--write']).status, 0)
  assert.equal(cli(['verify', '--root', root]).status, 0)
  assert.equal(cli(['status', '--root', root]).status, 0)
})

test('FALSIFICATION: the gate fails when a required file disappears', () => {
  // The claim under test is "ratchet verify reports a violation when the code
  // stops obeying a law". Confirming it is cheap and unconvincing; making it fail
  // is the only way to know the check is real.
  const root = makeProject({
    name: 'falsify-required-file',
    files: { 'src/auth/session.ts': 'redis\n', 'package.json': JSON.stringify({ name: 'x' }) },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [{ id: 'a.one', statement: 'One.', checks: [{ type: 'required_file', path: 'src/auth/session.ts' }] }],
      }),
    },
  })
  assert.equal(cli(['verify', '--root', root]).status, 0, 'precondition: the project is clean')

  rmSync(join(root, 'src', 'auth', 'session.ts'))
  const after = cli(['verify', '--root', root])
  assert.equal(after.status, ops.EXIT.PROBLEMS)
  assert.ok(after.stdout.includes('CODE_REQUIRED_FILE_MISSING'), after.stdout)

  const report = JSON.parse(readFileSync(join(root, state.STATE_PATHS.verifyReport), 'utf8'))
  assert.equal(report.problems[0].code, 'CODE_REQUIRED_FILE_MISSING')
  assert.equal(report.problems[0].lawId, 'a.one')
})

test('FALSIFICATION: the gate fails when a generated spec is hand-edited', () => {
  const root = makeProject({
    name: 'falsify-spec-drift',
    files: { 'src/auth/session.ts': 'redis\n' },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [{ id: 'a.one', statement: 'One.', checks: [{ type: 'required_file', path: 'src/auth/session.ts' }] }],
      }),
    },
  })
  assert.equal(cli(['compile', '--root', root, '--write']).status, 0)
  assert.equal(cli(['verify', '--root', root]).status, 0, 'precondition: specs match the bundle')

  const specPath = Object.keys(compiler.renderSpecs(compiler.compileProject(root).bundle).files)[0]
  writeFileSync(join(root, specPath), `${readFileSync(join(root, specPath), 'utf8')}\n<!-- hand edit -->\n`)
  const after = cli(['verify', '--root', root])
  assert.equal(after.status, ops.EXIT.PROBLEMS)
  assert.ok(after.stdout.includes('SPEC_HASH_MISMATCH'), after.stdout)
})

test('FALSIFICATION: editing the reasoning behind a decision fails the compile', () => {
  const root = makeProject({
    name: 'falsify-source-drift',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [{ id: 'a.one', statement: 'One.', checks: [] }],
      }),
    },
  })
  assert.equal(cli(['compile', '--root', root]).status, 0, 'precondition: the source hash matches')

  writeFileSync(join(root, SOURCE_PATH), `${SOURCE_TEXT}\nRewritten reasoning.\n`)
  const after = cli(['compile', '--root', root])
  assert.equal(after.status, ops.EXIT.PROBLEMS)
  assert.ok(after.stdout.includes('ADR_SOURCE_HASH_MISMATCH'), after.stdout)
})

test('FALSIFICATION: deleting a decision changes the laws and invalidates the verification', () => {
  const root = makeProject({
    name: 'falsify-delete-adr',
    files: { 'src/auth/session.ts': 'redis\n' },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [{ id: 'a.one', statement: 'One.', checks: [{ type: 'required_file', path: 'src/auth/session.ts' }] }],
      }),
    },
  })
  assert.equal(cli(['verify', '--root', root]).status, 0)

  rmSync(join(root, 'docs', 'adrs', '0001-a.adr.md'))
  const after = cli(['status', '--root', root])
  assert.notEqual(after.status, 0, 'removing the only decision must not leave the project looking verified')
  assert.ok(
    after.stdout.includes('VERIFY_NOT_RUN') || after.stdout.includes('NO_VALID_ADRS'),
    `expected an explicit failure, got: ${after.stdout}`,
  )
})

test('gate: an unknown command or option is a usage error, never a silent success', () => {
  assert.equal(cli(['verifyy', '--root', process.cwd()]).status, 3)
  assert.equal(cli(['verify', '--nonsense']).status, 3)
  assert.equal(cli(['--help']).status, 0)
})

test('gate: a corpus that does not compile blocks verification at the compile stage', () => {
  const root = makeProject({ name: 'gate-blocked', adrs: { '0001-a.adr.md': '# not an ADR\n' } })
  const result = cli(['verify', '--root', root, '--json'])
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.stage, 'compile')
  assert.ok(parsed.problems.some((entry) => entry.code === 'ADR_FRONTMATTER_MISSING'))
  assert.equal(result.status, ops.EXIT.CONFIG)
})

// ---------------------------------------------------------------------------
// dynamic layer: the context bundle and the prompt
// ---------------------------------------------------------------------------

/** A project with one active law, used as the corpus for review tests. */
function reviewableProject(name) {
  return makeProject({
    name,
    files: { 'src/auth/session.ts': 'redis\n' },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [
          {
            id: 'auth.session-storage.redis',
            statement: 'Session storage must use Redis.',
            checks: [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis' }],
          },
        ],
      }),
      '0009-proposed.adr.md': adrText({
        id: '0009',
        status: 'proposed',
        authority: 'agent',
        zones: ['auth'],
        laws: [{ id: 'auth.proposed.thing', statement: 'A proposal.', checks: [] }],
      }),
    },
  })
}

/**
 * A corpus the compiler has NO question about: one law with no checks, so `reviewRequired` is
 * empty. It is the fixture that isolates the staleness trigger, because the compiler-flagged
 * trigger cannot fire on it.
 */
function cleanCorpusProject(name) {
  return makeProject({
    name,
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [{ id: 'auth.one', statement: 'One.', checks: [] }],
      }),
    },
  })
}

/**
 * Two active decisions that state one constraint in different words under different law ids
 * and cite different sources: the deterministic duplicate rules see nothing, so only a judge
 * can report the semantic duplicate. `tests` is an `activeIfNoConflict` zone, so the drafter
 * is not refused for a `humanOnly` reason and the finding is exercised on its own terms.
 */
function semanticDuplicateProject(name) {
  const other = 'docs/ratchet/sources/2026-09-16-other.md'
  const otherText = '# Other session\n\nSession state belongs in a Redis store rather than on disk.\n'
  return makeProject({
    name,
    files: { [other]: otherText },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['tests'],
        sourceHash: schema.hashSource(SOURCE_TEXT),
        laws: [{ id: 'auth.one', statement: 'Sessions must live in Redis.', checks: [] }],
      }),
      '0002-b.adr.md': adrText({
        id: '0002',
        zones: ['tests'],
        sourcePath: other,
        sourceHash: schema.hashSource(otherText),
        laws: [{ id: 'auth.two', statement: 'Session state belongs in a Redis store rather than on disk.', checks: [] }],
      }),
    },
  })
}

test('dynamic: the stable context carries the corpus, the zones and the authority rule', () => {
  const root = reviewableProject('dyn-stable')
  const compiled = compiler.compileProject(root)
  const corpus = compiler.readAdrCorpus(root, { decisionsDir: 'docs/adrs' })
  const resolved = compiler.resolveActiveSet(corpus.records, { zones: compiled.report.enabled ? [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' }] : [] })
  const stable = dynamic.renderStableContext({
    project: 'dyn-stable',
    config: { zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' }], defaultAgentAuthority: 'proposeOnly' },
    bundle: compiled.bundle,
    activeRecords: resolved.active,
    proposedRecords: resolved.proposed,
    reviewRequired: [],
  })
  assert.ok(stable.includes('auth.session-storage.redis'), 'the law id is present')
  assert.ok(stable.includes('Session storage must use Redis.'), 'the law statement is present')
  assert.ok(stable.includes('required_text(redis)'), 'the check is described')
  assert.ok(stable.includes('human decision outranks an agent decision'), 'the authority rule is stated')
  assert.ok(stable.includes('0009'), 'a proposed decision is listed as not in force')
  assert.ok(stable.includes('Spec hash: sha256:'), 'the spec hash anchors the context to a law set')
})

test('dynamic: the stable prefix does not move when only the question changes', () => {
  // This is the whole cache argument. If the prefix moved with the question, the
  // split would buy nothing and nobody would notice.
  const stable = 'STABLE-MATERIAL'
  const a = dynamic.buildContextBundle({ stable, job: 'review_corpus' })
  const b = dynamic.buildContextBundle({ stable, job: 'review_change', change: 'a diff' })
  assert.equal(a.stable, b.stable)
  assert.notEqual(a.volatile, b.volatile)
})

test('dynamic: every job renders a prompt naming its own question and the JSON contract', () => {
  for (const job of Object.keys(dynamic.REVIEW_JOBS)) {
    const bundle = dynamic.buildContextBundle({
      stable: 'LAWS',
      job,
      change: 'C',
      proposal: 'P',
      source: 'S',
      conflict: 'K',
      violation: 'V',
    })
    const prompt = dynamic.renderReviewPrompt(bundle)
    assert.ok(prompt.includes(dynamic.REVIEW_JOBS[job].asks), `${job} states its own question`)
    assert.ok(prompt.includes('Reply with ONLY this JSON object'), `${job} states the output format`)
    assert.ok(prompt.includes('ADVISORY'), `${job} says it is advisory`)
    // The format contract is the JOB's own. A verdict job lists the finding kinds;
    // a grilling preparation asks for questions and must not offer severities.
    if (job === 'grill_preparation') {
      assert.ok(prompt.includes('"questions"'), `${job} asks for questions`)
      assert.ok(!prompt.includes('"findings"'), `${job} must not ask for findings`)
    } else {
      assert.ok(prompt.includes('"findings"'), `${job} asks for findings`)
      for (const kind of dynamic.FINDING_KINDS) {
        assert.ok(prompt.includes(kind), `${job} offers the kind ${kind}`)
      }
    }
  }
})

test('dynamic: an unknown job is refused rather than defaulted', () => {
  assert.throws(
    () => dynamic.buildContextBundle({ stable: 'S', job: 'review_everything' }),
    /unknown review job/,
  )
})

test('dynamic: a job missing its material reports what is missing instead of asking', () => {
  const bundle = dynamic.buildContextBundle({ stable: 'S', job: 'review_change' })
  assert.deepEqual(bundle.missing, ['change'])
  const both = dynamic.buildContextBundle({ stable: 'S', job: 'review_proposal' })
  assert.deepEqual(both.missing.sort(), ['proposal', 'source'])
})

// ---------------------------------------------------------------------------
// dynamic layer: reading a judge's answer
// ---------------------------------------------------------------------------

test('dynamic: a verdict is read from structured output, plain JSON, a fence, or embedded text', () => {
  const verdict = { ok: true, findings: [] }
  assert.equal(dynamic.parseVerdict(verdict, '').source, 'structured')
  assert.equal(dynamic.parseVerdict(null, JSON.stringify(verdict)).source, 'text')
  assert.equal(dynamic.parseVerdict(null, '```json\n' + JSON.stringify(verdict) + '\n```').source, 'fenced')
  assert.equal(dynamic.parseVerdict(null, `Here you go: ${JSON.stringify(verdict)} вЂ” hope that helps`).source, 'embedded')
})

test('dynamic: text with no JSON object yields no verdict, not an empty one', () => {
  // An empty verdict and a missing one lead to opposite conclusions: one says
  // "reviewed, nothing wrong", the other says "the review did not happen".
  const parsed = dynamic.parseVerdict(null, 'I reviewed the change and it looks fine to me.')
  assert.equal(parsed.verdict, null)
  assert.ok(parsed.problem.includes('no JSON object'))
})

test('dynamic: a brace inside a quoted explanation does not end the scan early', () => {
  const parsed = dynamic.parseVerdict(null, 'prefix {"ok":false,"findings":[{"severity":"note","kind":"semantic_violation","explanation":"uses { braces } inside"}]} suffix')
  assert.equal(parsed.verdict.ok, false)
  assert.equal(parsed.verdict.findings[0].explanation, 'uses { braces } inside')
})

// ---------------------------------------------------------------------------
// dynamic layer: validating a verdict against the facts
// ---------------------------------------------------------------------------

test('dynamic: a well-formed finding passes validation', () => {
  const result = dynamic.validateVerdict(
    {
      ok: false,
      findings: [
        {
          severity: 'error',
          kind: 'semantic_violation',
          lawId: 'auth.session-storage.redis',
          sourceAdr: '0001',
          lawQuote: 'Session storage must use Redis.',
          explanation: 'The change reintroduces a file-backed adapter.',
          suggestedAction: 'Remove it or supersede the decision.',
        },
      ],
    },
    {
      lawIds: ['auth.session-storage.redis'],
      adrIds: ['0001'],
      laws: { 'auth.session-storage.redis': 'Session storage must use Redis.' },
    },
  )
  assert.equal(result.problems.length, 0)
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].lawQuote, 'Session storage must use Redis.', 'the quote is carried, so a reader can see what was judged')
  assert.equal(result.ok, false, "the judge's own ok is preserved")
})

test('FALSIFICATION: a finding that quotes the law it names is checked against it', () => {
  // The rule this pins, and the failure it exists for: a judge named a law that WAS in force
  // and described a SUPERSEDED statement of it, and the finding stood — freezing every write
  // in a zone until a second review corrected it. A quotation turns that from an unfalsifiable
  // claim into a comparison, and a comparison that fails refuses the finding.
  const laws = { 'auth.session-storage.redis': 'Session storage must use Redis.' }
  const lawIds = ['auth.session-storage.redis']

  const correct = dynamic.validateVerdict(
    { ok: false, findings: [{ severity: 'error', kind: 'semantic_violation', lawId: 'auth.session-storage.redis', lawQuote: 'Session storage must use Redis.', explanation: 'x' }] },
    { lawIds, adrIds: [], laws },
  )
  assert.equal(correct.problems.length, 0, 'a correct quotation is accepted')
  assert.equal(correct.findings.length, 1)

  // The same finding, quoting the text the id used to carry before the decision was restated.
  const superseded = dynamic.validateVerdict(
    { ok: false, findings: [{ severity: 'error', kind: 'semantic_violation', lawId: 'auth.session-storage.redis', lawQuote: 'Sessions must be stored in files.', explanation: 'x' }] },
    { lawIds, adrIds: [], laws },
  )
  assert.equal(superseded.findings.length, 0, 'a finding about a statement that is not the compiled law is not forwarded')
  assert.equal(superseded.ok, false, 'and the verdict cannot be reported as ok')
  assert.ok(
    superseded.problems.some((entry) => entry.message.includes('does not match law')),
    JSON.stringify(superseded.problems.map((entry) => entry.message)),
  )

  // NO QUOTATION AT ALL is malformed, not authoritative — the same treatment a citation of a
  // law that does not exist already gets.
  const unquoted = dynamic.validateVerdict(
    { ok: false, findings: [{ severity: 'error', kind: 'semantic_violation', lawId: 'auth.session-storage.redis', explanation: 'x' }] },
    { lawIds, adrIds: [], laws },
  )
  assert.equal(unquoted.findings.length, 0, 'a law-bound finding with no quotation is unusable')
  assert.ok(
    unquoted.problems.some((entry) => entry.message.includes('quotes neither')),
    JSON.stringify(unquoted.problems.map((entry) => entry.message)),
  )

  // A finding that names NO law is unaffected: not every real problem binds to one law.
  const unbound = dynamic.validateVerdict(
    { ok: false, findings: [{ severity: 'warning', kind: 'incoherent_corpus', explanation: 'two decisions pull apart' }] },
    { lawIds, adrIds: [], laws },
  )
  assert.equal(unbound.problems.length, 0)
  assert.equal(unbound.findings.length, 1)
})

test('FALSIFICATION: a bundle hash is an acceptable quotation for a law-bound finding', () => {
  // The rule offers the statement OR the hash, because a judge that reads the compiled bundle
  // sees one hash for the whole law set. Quoting it is a claim the ratchet can also check.
  const hash = `sha256:${'a'.repeat(64)}`
  const withHash = dynamic.validateVerdict(
    { ok: false, findings: [{ severity: 'error', kind: 'intent_violation', lawId: 'auth.x', lawQuote: `the law set hashing to ${hash}`, explanation: 'x' }] },
    { lawIds: ['auth.x'], adrIds: [], laws: { 'auth.x': 'Something else entirely.' }, lawHashes: { 'auth.x': hash } },
  )
  assert.equal(withHash.problems.length, 0, 'a hash that matches the law set is accepted')
  assert.equal(withHash.findings.length, 1)
})

test('FALSIFICATION: a judge citing a law that does not exist is not passed on', () => {
  // The claim under test is "the ratchet does not forward a reference a reader
  // cannot resolve". Confirming it needs a judge that fabricates one.
  const result = dynamic.validateVerdict(
    {
      ok: false,
      findings: [
        {
          severity: 'error',
          kind: 'semantic_violation',
          lawId: 'auth.invented.law',
          explanation: 'This contradicts a law that does not exist.',
        },
      ],
    },
    { lawIds: ['auth.session-storage.redis'], adrIds: ['0001'] },
  )
  assert.equal(result.findings.length, 0, 'the unusable finding is not forwarded')
  assert.equal(result.ok, false, 'and the verdict cannot be reported as ok')
  assert.equal(result.problems.length, 1)
  assert.ok(result.problems[0].message.includes('auth.invented.law'))
  assert.ok(result.problems[0].message.includes('does not exist'))
})

test('FALSIFICATION: a judge citing a nonexistent ADR or an unknown kind is caught too', () => {
  const badAdr = dynamic.validateVerdict(
    { ok: true, findings: [{ severity: 'note', kind: 'semantic_violation', sourceAdr: '0999', explanation: 'x' }] },
    { lawIds: [], adrIds: ['0001'] },
  )
  assert.equal(badAdr.findings.length, 0)
  assert.ok(badAdr.problems[0].message.includes('0999'))

  const badKind = dynamic.validateVerdict(
    { ok: true, findings: [{ severity: 'note', kind: 'vibes', explanation: 'x' }] },
    { lawIds: [], adrIds: [] },
  )
  assert.equal(badKind.findings.length, 0)
  assert.ok(badKind.problems[0].message.includes('vibes'))
})

test('dynamic: a finding with no explanation is unusable, since a reader cannot act on it', () => {
  const result = dynamic.validateVerdict(
    { ok: true, findings: [{ severity: 'error', kind: 'semantic_violation' }] },
    { lawIds: [], adrIds: [] },
  )
  assert.equal(result.findings.length, 0)
  assert.ok(result.problems[0].message.includes('no explanation'))
})

test('dynamic: a finding without citations is accepted', () => {
  // Not every real problem has a law to point at, and requiring one would push a
  // judge into inventing a citation to satisfy the format.
  const result = dynamic.validateVerdict(
    { ok: false, findings: [{ severity: 'warning', kind: 'incoherent_corpus', explanation: 'Two decisions pull in opposite directions.' }] },
    { lawIds: [], adrIds: [] },
  )
  assert.equal(result.problems.length, 0)
  assert.equal(result.findings.length, 1)
})

test('dynamic: a verdict with no findings array is a problem, not an empty review', () => {
  const result = dynamic.validateVerdict({ ok: true }, { lawIds: [], adrIds: [] })
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((entry) => entry.message.includes('no findings array')))
})

test('dynamic: an unusable verdict is reported as unusable, never as a clean review', () => {
  const result = dynamic.validateVerdict(null, { lawIds: [], adrIds: [] })
  assert.equal(result.ok, false)
  assert.ok(result.problems[0].message.includes('no usable verdict'))
})

// ---------------------------------------------------------------------------
// dynamic layer: the operation, with and without a judge
// ---------------------------------------------------------------------------

test('dynamic: with no judge the review degrades and says so, instead of failing', () => {
  const root = reviewableProject('dyn-degraded')
  return ops
    .review({ root, job: 'review_corpus', spawnJudge: null, record: false })
    .then((result) => {
      assert.equal(result.degraded, true)
      assert.equal(result.gate, false)
      assert.equal(result.advisory, true)
      assert.ok(result.prompt.includes('Reply with ONLY this JSON object'))
      // The note must name the real cause. It used to say the deployment mounts no
      // subagents runtime, which sent a shell user hunting for a plugin row that was
      // already there вЂ” the CLI never spawns a judge on any deployment.
      assert.ok(result.note.includes('did not spawn a judge'), result.note)
      assert.ok(result.note.includes('a shell has no agent to parent one with'), result.note)
      assert.deepEqual(result.problems, [], 'degrading is a capability, not a problem')
      assert.ok(result.nextStep.includes('ratchet_review'))
    })
})

test('dynamic: a review job is answered by an injected judge and the verdict comes back', async () => {
  const root = reviewableProject('dyn-judged')
  const seen = {}
  const result = await ops.review({
    root,
    job: 'review_change',
    change: 'src/auth/session.ts now imports session-file-store',
    spawnJudge: async (prompt, schema) => {
      seen.prompt = prompt
      seen.schema = schema
      return {
        structured: {
          ok: false,
          findings: [
            {
              severity: 'error',
              kind: 'semantic_violation',
              lawId: 'auth.session-storage.redis',
              lawQuote: 'Session storage must use Redis.',
              sourceAdr: '0001',
              explanation: 'A file-backed session adapter contradicts the Redis decision.',
              suggestedAction: 'Remove the adapter or supersede 0001.',
            },
          ],
        },
        output: '',
        stopReason: 'completed',
      }
    },
  })
  assert.equal(result.degraded, false)
  // A judge that classifies the change as contradicting a decision in force DECLINES it. This
  // assertion used to read `gate === false`: the review was advice, so a contradiction nobody
  // could see in a check was recorded and ignored, which is the drift the gate exists to stop.
  assert.equal(result.gate, true)
  assert.equal(result.declined, true)
  assert.equal(result.ok, false)
  assert.equal(result.blocking.findings.length, 1)
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].lawId, 'auth.session-storage.redis')
  assert.equal(result.verdictSource, 'structured')
  // ...and it was recorded, so the write guard can refuse the work rather than only annotate it.
  const recorded = contradictionModule.readContradictions(root)
  assert.equal(Object.keys(recorded).length, 1)
  assert.equal(Object.values(recorded)[0].findings[0].lawId, 'auth.session-storage.redis')
  assert.ok(seen.prompt.includes('session-file-store'), 'the change reached the judge')
  assert.deepEqual(seen.schema, dynamic.VERDICT_SCHEMA)
  assert.ok(result.adrIds.includes('0001'))
})

test('dynamic: a judge that fails to be spawned is reported, not treated as a clean review', async () => {
  const root = reviewableProject('dyn-judge-error')
  const result = await ops.review({
    root,
    job: 'review_corpus',
    spawnJudge: async () => {
      throw new Error('no subagent provider registered')
    },
  })
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((entry) => entry.message.includes('could not be run')))
  assert.ok(result.problems.some((entry) => entry.message.includes('no usable verdict')))
})

test('dynamic: a judge that answers in prose is reported as producing no verdict', async () => {
  const root = reviewableProject('dyn-judge-prose')
  const result = await ops.review({
    root,
    job: 'review_corpus',
    spawnJudge: async () => ({ structured: null, output: 'Looks fine to me!', stopReason: 'completed' }),
  })
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((entry) => entry.message.includes('no usable verdict')))
})

test('dynamic: a review is recorded and the ledger says it was advisory', async () => {
  const root = reviewableProject('dyn-record')
  const result = await ops.review({
    root,
    job: 'review_corpus',
    spawnJudge: async () => ({ structured: { ok: true, findings: [] }, output: '', stopReason: 'completed' }),
    record: true,
  })
  assert.equal(result.ok, true)
  const report = JSON.parse(readFileSync(join(root, state.STATE_PATHS.dynamicReport), 'utf8'))
  assert.equal(report.gate, false)
  assert.equal(report.advisory, true)
  assert.equal(report.job, 'review_corpus')
  const ledger = state.readLedger(root)
  assert.ok(ledger.events.some((event) => event.event === 'ratchet.review.finish' && event.advisory === true))
})

test('dynamic: a self-review is validated exactly like a spawned judge', () => {
  const root = reviewableProject('dyn-self')
  // The same fabricated reference that fails for a spawned judge must fail here.
  const bad = ops.submitReview({
    root,
    job: 'review_change',
    verdict: { ok: true, findings: [{ severity: 'note', kind: 'semantic_violation', lawId: 'nope', explanation: 'x' }] },
    record: false,
  })
  assert.equal(bad.findings.length, 0)
  assert.equal(bad.ok, false)
  assert.equal(bad.judge.kind, 'self')

  const good = ops.submitReview({
    root,
    job: 'review_change',
    verdict: { ok: true, findings: [] },
    record: false,
  })
  assert.equal(good.ok, true)
  assert.equal(good.advisory, true)
})

test('gate: review NEVER changes the exit code, whatever the judge said', () => {
  // The one property that keeps a model's answer from becoming a gate.
  const root = reviewableProject('gate-review-exit')
  assert.equal(ops.exitCodeForReview(), 0)
  const result = cli(['review', '--root', root, '--job', 'review_corpus'])
  assert.equal(result.status, 0, 'review exits 0 even though a judge was not run')
  assert.ok(result.stdout.includes('advisory'))
})

test('gate: an unknown review job is a usage error, not a silent corpus review', () => {
  const root = reviewableProject('gate-review-badjob')
  assert.equal(cli(['review', '--root', root, '--job', 'review_everything']).status, 3)
})

// ---------------------------------------------------------------------------
// packaging: an installed copy must contain every module it imports
// ---------------------------------------------------------------------------

test('packaging: every module the plugin imports is listed in package.json files', () => {
  // The failure this prevents is ordering-dependent, which is what makes it
  // dangerous: a missing entry works from the checkout and fails once installed,
  // so it survives every local run and appears only in production.
  const manifest = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8'))
  const listed = new Set(manifest.files ?? [])
  const modules = readdirSync(PLUGIN)
    .filter((name) => name.endsWith('.mjs'))
    .sort()
  const missing = modules.filter((name) => !listed.has(name))
  assert.deepEqual(missing, [], `modules present but not shipped: ${missing.join(', ')}`)
  assert.ok(listed.has(manifest.main), 'the declared main entry must be shipped')
  assert.ok(listed.has(manifest.bin.ratchet), 'the declared bin entry must be shipped')
})

test('packaging: no module imports a file that does not exist', () => {
  // A renamed module leaves a dangling relative import that a checkout-only test
  // run may never touch if the importing file is not exercised.
  const modules = readdirSync(PLUGIN).filter((name) => name.endsWith('.mjs'))
  const dangling = []
  for (const name of modules) {
    const source = readFileSync(join(PLUGIN, name), 'utf8')
    for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
      const target = resolve(PLUGIN, match[1])
      if (!existsSync(target)) dangling.push(`${name} -> ${match[1]}`)
    }
  }
  assert.deepEqual(dangling, [])
})

test('packaging: the plugin has no dependency on a package the profile must hoist', () => {
  // A peer dependency pnpm does not hoist fails at boot with `Cannot find package`,
  // which is a boot failure rather than a degraded feature.
  const manifest = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8'))
  const peers = Object.keys(manifest.peerDependencies ?? {})
  assert.deepEqual(
    peers.filter((name) => !['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools'].includes(name)),
    [],
    'only the two packages the plugin actually imports may be peers',
  )
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}), [], 'a dependency would have to be installed into every profile')
})

test('gate: a corpus with no law in force is a finding, not a misconfiguration', () => {
  // Every record proposed and none approved is a legitimate project state. It must
  // report LAWS_NONE at exit 1 вЂ” "nothing is enforced" вЂ” rather than exit 2, which
  // would send a reader hunting for a broken file instead of an unapproved proposal.
  const root = makeProject({
    name: 'gate-laws-none',
    adrs: {
      '0001-proposed.adr.md': adrText({
        id: '0001',
        status: 'proposed',
        authority: 'agent',
        zones: ['auth'],
        laws: [{ id: 'auth.x', statement: 'Proposed.', checks: [{ type: 'required_file', path: 'src/auth/x.ts' }] }],
      }),
    },
  })
  const result = cli(['verify', '--root', root])
  assert.equal(result.status, ops.EXIT.PROBLEMS)
  assert.ok(result.stdout.includes('LAWS_NONE'), result.stdout)
  assert.ok(!result.stdout.includes('NO_VALID_ADRS'), 'a readable corpus is not an empty one')
})

test('gate: LAWS_NONE and NO_VALID_ADRS are different codes for different problems', () => {
  const emptyCorpus = makeProject({ name: 'gate-no-adr', adrs: {} })
  const emptyResult = cli(['verify', '--root', emptyCorpus])
  assert.equal(emptyResult.status, ops.EXIT.CONFIG)
  assert.ok(emptyResult.stdout.includes('NO_VALID_ADRS'))

  const proposedOnly = makeProject({
    name: 'gate-proposed',
    adrs: {
      '0001-p.adr.md': adrText({ id: '0001', status: 'proposed', authority: 'agent', zones: ['auth'], laws: [{ id: 'a.b', statement: 'S.', checks: [{ type: 'required_file', path: 'src/auth/x.ts' }] }] }),
    },
  })
  const proposedResult = cli(['verify', '--root', proposedOnly])
  assert.equal(proposedResult.status, ops.EXIT.PROBLEMS)
  assert.ok(proposedResult.stdout.includes('LAWS_NONE'))
})

// ---------------------------------------------------------------------------
// dynamic layer: the grilling agenda
// ---------------------------------------------------------------------------

test('dynamic: a grilling preparation asks for questions, not findings', () => {
  // The format instruction is what the judge actually answers, so sending the
  // verdict contract to this job would produce findings where questions were wanted.
  const bundle = dynamic.buildContextBundle({ stable: 'LAWS', job: 'grill_preparation', change: 'a change' })
  const prompt = dynamic.renderReviewPrompt(bundle)
  assert.ok(prompt.includes('"questions"'), 'the agenda contract asks for questions')
  assert.ok(prompt.includes('"conflictingLaws"'), 'it asks which laws conflict')
  assert.ok(prompt.includes('"proposedOverride"'), 'it asks what the agent wants instead')
  assert.ok(prompt.includes('ONE decision per question'), 'it asks for one decision per question')
  assert.ok(!prompt.includes('"findings"'), 'it does NOT ask for findings')
  assert.ok(!prompt.includes('"severity"'), 'and not for severities')
})

test('dynamic: a verdict job still asks for findings and not questions', () => {
  const bundle = dynamic.buildContextBundle({ stable: 'LAWS', job: 'review_change', change: 'a change' })
  const prompt = dynamic.renderReviewPrompt(bundle)
  assert.ok(prompt.includes('"findings"'))
  assert.ok(!prompt.includes('"questions"'), 'a review must not ask a human anything')
})

test('dynamic: each job maps to its own output schema', () => {
  for (const job of Object.keys(dynamic.REVIEW_JOBS)) {
    const expected = job === 'grill_preparation' ? dynamic.AGENDA_SCHEMA : dynamic.VERDICT_SCHEMA
    assert.equal(dynamic.schemaForJob(job), expected, `${job} must use its own schema`)
  }
})

test('dynamic: a well-formed agenda validates', () => {
  const result = dynamic.validateAgenda(
    {
      request: 'Allow a file-backed session adapter for the offline build',
      conflictingLaws: [{ lawId: 'auth.session-storage.redis', sourceAdr: '0001', why: 'It requires Redis.' }],
      proposedOverride: 'Use a signed-cookie store when REDIS_URL is unset.',
      risks: ['Two deployment paths diverge in behaviour'],
      questions: [
        {
          question: 'May the offline build use a non-Redis session store?',
          why: 'Only a human can relax a human decision.',
          options: ['yes', 'no'],
          recommendation: 'yes, scoped to the offline build',
          implications: 'A yes needs a superseding ADR naming the zone.',
        },
      ],
    },
    { lawIds: ['auth.session-storage.redis'], adrIds: ['0001'] },
  )
  assert.equal(result.problems.length, 0)
  assert.equal(result.ok, true)
  assert.equal(result.questions.length, 1)
  assert.equal(result.conflictingLaws.length, 1)
  assert.equal(result.risks.length, 1)
})

test('FALSIFICATION: an agenda citing a law that does not exist is not passed on', () => {
  const result = dynamic.validateAgenda(
    {
      request: 'X',
      conflictingLaws: [{ lawId: 'auth.invented', why: 'It conflicts.' }],
      questions: [{ question: 'May I proceed?' }],
    },
    { lawIds: ['auth.session-storage.redis'], adrIds: [] },
  )
  assert.equal(result.conflictingLaws.length, 0, 'the unresolvable conflict is not forwarded')
  assert.equal(result.ok, false)
  assert.ok(result.problems[0].message.includes('auth.invented'))
})

test('dynamic: an agenda with no questions is a failure, not an empty agenda', () => {
  // This is the failure the job exists to prevent: it looks like completed
  // preparation while asking the human nothing.
  const result = dynamic.validateAgenda({ request: 'X', questions: [] }, { lawIds: [], adrIds: [] })
  assert.equal(result.ok, false)
  assert.ok(result.problems[0].message.includes('nothing for a human to answer'))
})

test('dynamic: an agenda may declare insufficient reasoning instead of inventing questions', () => {
  const result = dynamic.validateAgenda(
    { request: 'X', questions: [], insufficientReasoning: true },
    { lawIds: [], adrIds: [] },
  )
  assert.equal(result.ok, false)
  assert.equal(result.insufficientReasoning, true)
  assert.ok(result.problems[0].message.includes('source must be extended'))
})

test('dynamic: an agenda with no usable object is reported, never read as "nothing to ask"', () => {
  const result = dynamic.validateAgenda(null, { lawIds: [], adrIds: [] })
  assert.equal(result.ok, false)
  assert.ok(result.problems[0].message.includes('no usable agenda'))
})

test('dynamic: a grilling preparation runs through the operation and returns an agenda', async () => {
  const root = reviewableProject('dyn-grill')
  const result = await ops.review({
    root,
    job: 'grill_preparation',
    change: 'src/auth/session.ts would use a cookie store',
    spawnJudge: async () => ({
      structured: {
        request: 'Relax the Redis requirement for offline builds',
        conflictingLaws: [{ lawId: 'auth.session-storage.redis', why: 'It requires Redis.' }],
        proposedOverride: 'Cookie store when REDIS_URL is unset',
        risks: ['Divergent behaviour'],
        questions: [{ question: 'May the offline build skip Redis?', options: ['yes', 'no'], recommendation: 'yes' }],
      },
      output: '',
      stopReason: 'completed',
    }),
  })
  assert.equal(result.kind, 'agenda')
  assert.equal(result.agenda.questions.length, 1)
  assert.equal(result.agenda.conflictingLaws.length, 1)
  assert.equal(result.gate, false)
  assert.equal(result.advisory, true)
  assert.equal(result.findings, undefined, 'an agenda result carries no findings')
})

// ---------------------------------------------------------------------------
// ingestion: raw reasoning to a proposed ADR
// ---------------------------------------------------------------------------

const ingest = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-ingest.mjs`)

/** A source that states a decision AND the reasoning behind it. */
const RICH_SOURCE = [
  '# Grilling session: session storage',
  '',
  'Sessions currently live in local files, which breaks under two instances.',
  'We agreed to move them to Redis because the deployment already runs it and it',
  'provides TTL, so no new dependency is introduced.',
  '',
].join('\n')

/** The same decision with the reasoning stripped out. */
const THIN_SOURCE = [
  '# Standup note',
  '',
  'Decided: sessions move to Redis. Moving on.',
  '',
].join('\n')

/** A complete, grounded ingestion result. */
function ingestResult(overrides = {}) {
  return {
    insufficientReasoning: false,
    title: 'Use Redis for session storage',
    decision: 'Session storage must use Redis.',
    reasoning: 'Redis is already deployed and provides TTL, so no new dependency is introduced.',
    reasoningBasis: 'the deployment already runs it and it provides TTL',
    context: 'Sessions live in local files, which breaks under two instances.',
    contextBasis: 'Sessions currently live in local files, which breaks under two instances.',
    consequences: ['Local file session adapters are prohibited.'],
    zones: ['auth'],
    laws: [
      { id: 'auth.session-storage.redis', statement: 'Session storage must use Redis.', checks: [] },
    ],
    ...overrides,
  }
}

test('ingest: nextAdrId continues the sequence and never reuses an id', () => {
  assert.equal(ingest.nextAdrId([]), '0001')
  assert.equal(ingest.nextAdrId(['0001', '0002']), '0003')
  assert.equal(ingest.nextAdrId(['0007', '0002']), '0008', 'it takes the highest, not the last')
  assert.equal(ingest.nextAdrId(['0009']), '0010', 'it pads to four digits')
})

test('ingest: slugFor produces a name the strict filename rule accepts', () => {
  // A generated record that fails its own naming rule is a generation bug wearing a
  // decision's clothes, so the slug is checked against the parser rather than trusted.
  for (const title of [
    'Use Redis for session storage',
    'Define-Tool is the only way!',
    '  spaces  and   more  ',
    'ГњnГЇcГ¶dГ© and symbols: *&^%',
    '',
  ]) {
    const slug = ingest.slugFor(title)
    const filename = `0001-${slug}.adr.md`
    const parsed = schema.parseAdrFilename(filename)
    assert.equal(parsed.ok, true, `${JSON.stringify(title)} produced a rejected filename: ${filename}`)
  }
})

test('FALSIFICATION: a quote that is not in the source is refused', () => {
  // The claim under test is "the ratchet does not record reasoning the source does
  // not contain". Confirming it needs a judge that invents a justification.
  const outcome = ingest.quoteAppears(
    'the team benchmarked Redis against Memcached and chose Redis',
    RICH_SOURCE,
  )
  assert.equal(outcome.ok, false)
  assert.ok(outcome.reason.includes('does not appear in the source'))
})

test('ingest: a real quote matches even across a line break', () => {
  const outcome = ingest.quoteAppears('the deployment already runs it and it\nprovides TTL', RICH_SOURCE)
  assert.equal(outcome.ok, true)
})

test('ingest: a quote too short to prove anything is refused', () => {
  const outcome = ingest.quoteAppears('Redis', RICH_SOURCE)
  assert.equal(outcome.ok, false)
  assert.ok(outcome.reason.includes('shorter than'))
})

test('FALSIFICATION: an invented reasoning basis stops the record being generated', () => {
  const result = ingest.validateIngest(
    ingestResult({ reasoningBasis: 'we measured a 40% latency improvement in production' }),
    { sourceText: RICH_SOURCE, config: { zones: [{ id: 'auth', paths: ['src/auth/**'] }] }, existingIds: [] },
  )
  assert.equal(result.ok, false)
  assert.equal(result.fields, null, 'no partial record may be produced')
  assert.ok(result.problems.some((entry) => entry.message.includes('not there')))
})

test('ingest: a grounded result validates and carries the chosen id', () => {
  const result = ingest.validateIngest(ingestResult(), {
    sourceText: RICH_SOURCE,
    config: { zones: [{ id: 'auth', paths: ['src/auth/**'] }] },
    existingIds: ['0001', '0002'],
  })
  assert.deepEqual(result.problems, [])
  assert.equal(result.ok, true)
  assert.equal(result.fields.id, '0003')
  assert.deepEqual(result.fields.zones, ['auth'])
})

test('ingest: a source with no reasoning returns INSUFFICIENT_REASONING, not a record', () => {
  const result = ingest.validateIngest(
    { insufficientReasoning: true, insufficiencyReason: 'the note states the decision but gives no reason for it' },
    { sourceText: THIN_SOURCE, config: { zones: [] }, existingIds: [] },
  )
  assert.equal(result.ok, false)
  assert.equal(result.insufficientReasoning, true)
  assert.equal(result.fields, null)
  assert.deepEqual(result.problems, [], 'a refusal is a result, not a problem')
  assert.ok(result.reason.includes('no reason'))
})

test('ingest: a zone the manifest does not declare is refused before the record exists', () => {
  const result = ingest.validateIngest(ingestResult({ zones: ['nosuchzone'] }), {
    sourceText: RICH_SOURCE,
    config: { zones: [{ id: 'auth', paths: ['src/auth/**'] }] },
    existingIds: [],
  })
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((entry) => entry.code === 'LAW_ZONE_MISSING'))
})

test('ingest: a decision governing no zone is refused, since nothing could require it', () => {
  const result = ingest.validateIngest(ingestResult({ zones: [] }), {
    sourceText: RICH_SOURCE,
    config: { zones: [{ id: 'auth', paths: ['src/auth/**'] }] },
    existingIds: [],
  })
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((entry) => entry.message.includes('names no zone')))
})

test('ingest: a fragment of a real sentence still counts as grounded', () => {
  // A judge that reformats a sentence has still grounded the record in the source;
  // the check must not report formatting as fabrication.
  const result = ingest.validateIngest(
    ingestResult({ reasoningBasis: 'We agreed to move them to Redis because the deployment already runs it' }),
    { sourceText: RICH_SOURCE, config: { zones: [{ id: 'auth', paths: ['src/auth/**'] }] }, existingIds: [] },
  )
  assert.equal(result.ok, true, JSON.stringify(result.problems.map((entry) => entry.message)))
})

test('ingest: a generated ADR passes the very rules a written one must', () => {
  const result = ingest.validateIngest(ingestResult(), {
    sourceText: RICH_SOURCE,
    config: { zones: [{ id: 'auth', paths: ['src/auth/**'] }] },
    existingIds: [],
  })
  const rendered = ingest.renderAdr({
    fields: result.fields,
    sourcePath: 'docs/ratchet/sources/session-storage.md',
    sourceHash: schema.hashSource(RICH_SOURCE),
    createdAt: '2026-09-13T00:00:00Z',
  })
  assert.equal(rendered.filename, '0001-use-redis-for-session-storage.adr.md')
  assert.ok(rendered.text.includes('status: proposed'), 'a generated record is always proposed')
  assert.ok(rendered.text.includes('  authority: agent'), 'and agent-authored')
  assert.ok(rendered.text.includes('## Reasoning'))
  const parsed = schema.parseAdr({ filename: rendered.filename, source: rendered.text, root: null })
  assert.deepEqual(parsed.problems, [], 'the generated record must satisfy the parser')
  assert.equal(parsed.record.id, '0001')
  assert.equal(parsed.record.status, 'proposed')
  assert.equal(parsed.record.zones[0], 'auth')
})

/**
 * A project with the starter record and a verified source, for ingestion tests.
 *
 * The fixture has to be a real project rather than an empty directory: ingestion
 * reads the manifest for its zone list, the decisions directory for existing ids,
 * and the source file it hashes into the record.
 */
async function ingestProject(name) {
  return makeProject({
    name,
    adrs: {
      '0001-starter.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [{ id: 'auth.starter', statement: 'A starter law.', checks: [] }],
      }),
    },
  })
}

/**
 * Quotes taken verbatim from the fixture project's own source (SOURCE_TEXT).
 *
 * The fixture has to be a real project вЂ” ingestion reads the manifest for its zone
 * list and the decisions directory for existing ids вЂ” and its source is a different
 * document from RICH_SOURCE. Using one document's sentences against another's
 * source is exactly what the verbatim check refuses, which is why the two quote sets
 * are separate named constants rather than one shared string.
 */
const FIXTURE_BASIS = Object.freeze({
  reasoningBasis: 'the deployment already runs it',
  contextBasis: 'file-backed sessions break under two instances',
})

/** A grounded ingestion result written against the fixture's own source. */
function fixtureIngestResult(overrides = {}) {
  return ingestResult({ ...FIXTURE_BASIS, ...overrides })
}

/**
 * One decision in a batch extraction, grounded in the fixture project's own source.
 *
 * The `span` is what makes a batch decision different from a single-ingestion result: the
 * tool locates it in the source before writing anything, so a fixture without one is a
 * fixture whose every decision would be refused.
 */
function batchDecision(overrides = {}) {
  return { span: 'the deployment already runs it', ...fixtureIngestResult(), ...overrides }
}

test('ingest: the generated record compiles in the project it would land in', async () => {
  const root = await ingestProject('ingest-compile')
  const result = await ops.ingest({
    root,
    sourcePath: SOURCE_PATH,
    spawnJudge: async () => ({ structured: fixtureIngestResult(), output: '', stopReason: 'completed' }),
    write: true,
    now: '2026-09-13T00:00:00Z',
  })
  assert.equal(result.ok, true, JSON.stringify(result.problems?.map((entry) => entry.message)))
  assert.equal(result.compiles, true)
  assert.ok(result.written, 'write: true must place the record')
  assert.equal(result.status, 'proposed')

  // And the project still compiles with the new record in place.
  const compiled = compiler.compileProject(root)
  assert.deepEqual(compiled.problems.map((entry) => entry.code), [])
  assert.equal(compiled.report.counts.records, 2, 'the starter record plus the ingested one')
})

// ---------------------------------------------------------------------------
// derived checks: what a decision implies is checked, and nothing else is
// ---------------------------------------------------------------------------

const AUTH_ZONES = { zones: [{ id: 'auth', paths: ['src/auth/**'] }] }

/** A source that states an enforcement gap, so an unenforced claim can be grounded. */
const CONVENTION_SOURCE = [
  '# Grilling session: naming',
  '',
  'Naming conventions are a matter of taste and no tool can enforce them, so we agreed',
  'to write them down rather than check them.',
  '',
].join('\n')

test('schema: a text check with no pattern is refused, because it would match every file', () => {
  // `new RegExp(undefined)` is the empty expression, which matches everything: a
  // required_text law without a pattern reported itself satisfied whatever the code
  // said. A false pass is the one outcome a gate must never produce.
  const cases = {
    'a required_text with no pattern': { type: 'required_text', paths: ['src/auth/**'] },
    'a required_text with an empty pattern': { type: 'required_text', paths: ['src/auth/**'], pattern: '' },
    'a forbidden_text with no pattern': { type: 'forbidden_text', paths: ['src/auth/**'] },
    'a required_text_glob with an empty pattern': { type: 'required_text_glob', paths: ['src/auth/**'], pattern: '' },
    'a forbidden_text_glob with an empty pattern': { type: 'forbidden_text_glob', paths: ['src/auth/**'], pattern: '' },
    'a text check with no paths to search': { type: 'forbidden_text', paths: [], pattern: 'console\\.log' },
    'a pattern that is not a regular expression': { type: 'required_text', paths: ['src/auth/**'], pattern: '([unclosed' },
    'the stateful flag g': { type: 'required_text', paths: ['src/auth/**'], pattern: 'redis', flags: 'g' },
    'the stateful flag y': { type: 'required_text_glob', paths: ['src/auth/**'], pattern: 'redis', flags: 'y' },
    'flags nobody implements': { type: 'required_text', paths: ['src/auth/**'], pattern: 'redis', flags: 'qq' },
  }
  for (const [label, check] of Object.entries(cases)) {
    const root = makeProject({
      name: `text-check-${label.replace(/[^a-z]+/gi, '-')}`,
      adrs: {
        '0001-a.adr.md': adrText({
          id: '0001',
          zones: ['auth'],
          laws: [{ id: 'a.one', statement: 'One.', checks: [check] }],
        }),
      },
    })
    const result = compile(root)
    assert.ok(
      result.codes.includes('ADR_FIELD_INVALID'),
      `${label}: expected ADR_FIELD_INVALID, got ${JSON.stringify(result.codes)}`,
    )
  }
})

test('ingest: a derived check is recorded only when the sentence it quotes is in the source', () => {
  const grounded = ingest.validateIngest(
    ingestResult({
      laws: [
        {
          id: 'auth.session-storage.redis',
          statement: 'Session storage must use Redis.',
          checks: [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis', basis: 'the deployment already runs it and it provides TTL' }],
        },
      ],
    }),
    { sourceText: RICH_SOURCE, config: AUTH_ZONES, existingIds: [] },
  )
  assert.equal(grounded.ok, true)
  assert.deepEqual(grounded.dropped, [])
  assert.equal(grounded.fields.laws[0].checks.length, 1)
  assert.equal(
    grounded.fields.laws[0].checks[0].basis,
    undefined,
    'the basis is the judge\'s evidence for the check, not part of the check itself',
  )

  const fabricated = ingest.validateIngest(
    ingestResult({
      laws: [
        {
          id: 'auth.session-storage.redis',
          statement: 'Session storage must use Redis.',
          checks: [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis', basis: 'we benchmarked Redis against Memcached for a week' }],
        },
      ],
    }),
    { sourceText: RICH_SOURCE, config: AUTH_ZONES, existingIds: [] },
  )
  assert.equal(fabricated.ok, true, 'the law still stands: only the invented check is removed')
  assert.equal(fabricated.fields.laws[0].checks.length, 0)
  assert.equal(fabricated.dropped.length, 1)
  assert.match(fabricated.dropped[0].reason, /not in the source/)
})

test('ingest: a check that cannot be evaluated is dropped with its reason, never repaired', () => {
  const result = ingest.validateIngest(
    ingestResult({
      laws: [
        {
          id: 'auth.session-storage.redis',
          statement: 'Session storage must use Redis.',
          checks: [
            { type: 'telepathy', basis: 'the deployment already runs it and it provides TTL' },
            { type: 'required_text', paths: ['src/auth/**'], basis: 'the deployment already runs it and it provides TTL' },
            { type: 'required_text', paths: ['src/auth/**'], pattern: 'redis', note: 'not a field this ratchet stores', basis: 'the deployment already runs it and it provides TTL' },
          ],
        },
      ],
    }),
    { sourceText: RICH_SOURCE, config: AUTH_ZONES, existingIds: [] },
  )
  assert.equal(result.ok, true)
  assert.equal(result.fields.laws[0].checks.length, 0)
  assert.equal(result.dropped.length, 3)
  assert.ok(result.dropped.some((entry) => /telepathy/.test(entry.reason)), 'an unknown type is named')
  assert.ok(result.dropped.some((entry) => /pattern/.test(entry.reason)), 'a missing required field is named')
  // `note` is refused by the schema's field set, which now runs before the renderer's own
  // check: an unknown field is not read by anything, so it enforces nothing whatever it
  // names, and that is the more useful thing to say. The check is still dropped and the
  // field is still named, which is what this case is about.
  assert.ok(
    result.dropped.some((entry) => /"note"/.test(entry.reason) && /does not define/.test(entry.reason)),
    'a field the ratchet does not store is refused by name',
  )
})

/** A payload whose quoted bases are sentences from CONVENTION_SOURCE. */
function conventionResult(overrides = {}) {
  return ingestResult({
    title: 'Write naming conventions down instead of checking them',
    decision: 'Naming conventions are recorded, not enforced.',
    reasoning: 'No tool can enforce a matter of taste, so writing it down is the honest option.',
    reasoningBasis: 'Naming conventions are a matter of taste and no tool can enforce them',
    context: 'Naming has no enforcement point.',
    contextBasis: 'we agreed to write them down rather than check them',
    laws: [],
    ...overrides,
  })
}

test('ingest: a law nothing can check says so, and needs a quote to say it', () => {
  const declared = ingest.validateIngest(
    conventionResult({
      laws: [
        {
          id: 'auth.naming.convention',
          statement: 'Names read as the domain does.',
          checks: [],
          unenforced: 'No tool can decide whether a name reads well.',
          unenforcedBasis: 'Naming conventions are a matter of taste and no tool can enforce them',
        },
      ],
    }),
    { sourceText: CONVENTION_SOURCE, config: AUTH_ZONES, existingIds: [] },
  )
  assert.equal(declared.ok, true, JSON.stringify(declared.problems?.map((entry) => entry.message)))
  assert.deepEqual(declared.dropped, [])
  assert.equal(declared.fields.laws[0].unenforced, 'No tool can decide whether a name reads well.')

  const unquoted = ingest.validateIngest(
    conventionResult({
      laws: [{ id: 'auth.naming.convention', statement: 'Names read as the domain does.', checks: [], unenforced: 'No tool can decide whether a name reads well.' }],
    }),
    { sourceText: CONVENTION_SOURCE, config: AUTH_ZONES, existingIds: [] },
  )
  assert.equal(unquoted.ok, true)
  assert.equal(unquoted.fields.laws[0].unenforced, null, 'an exemption with no quoted reason is not recorded')
  assert.equal(unquoted.dropped.length, 1)
  assert.match(unquoted.dropped[0].reason, /quotes no sentence/)
})

test('verifier: a law nothing checks is LAW_UNCHECKED until the record says why', async () => {
  const silent = makeProject({
    name: 'law-unchecked-silent',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.one', statement: 'One.', checks: [] }] }),
    },
  })
  const silentResult = await ops.verify({ root: silent })
  assert.ok(
    silentResult.problems.some((entry) => entry.code === 'LAW_UNCHECKED'),
    `expected LAW_UNCHECKED, got ${JSON.stringify(silentResult.problems.map((entry) => entry.code))}`,
  )

  const declared = makeProject({
    name: 'law-unchecked-declared',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [{ id: 'auth.one', statement: 'One.', checks: [], unenforced: 'It is a matter of taste, and no tool decides taste.' }],
      }),
    },
  })
  const declaredResult = await ops.verify({ root: declared })
  assert.equal(declaredResult.laws[0].unenforced, 'It is a matter of taste, and no tool decides taste.')
  assert.ok(
    !declaredResult.problems.some((entry) => entry.code === 'LAW_UNCHECKED'),
    'a stated reason is an answer, so LAW_UNCHECKED is suppressed',
  )
  // Suppressing LAW_UNCHECKED is not the same as passing. With every law in the
  // corpus unenforced the run evaluated nothing, and `ok: true` there was the exact
  // contradiction the report's contract forbids вЂ” `status` already refused to call
  // the same record verified, so the gate and the state layer disagreed about one
  // tree. The gate now reports the emptiness instead of blessing it.
  assert.deepEqual(
    declaredResult.problems.map((entry) => entry.code),
    ['VERIFY_NOTHING_EVALUATED'],
    'an all-unenforced corpus is unverified, not clean',
  )
  assert.equal(declaredResult.counts.checksDeclared, 0)
  assert.equal(declaredResult.counts.checksEvaluated, 0)
})

test('schema: an unenforced marker that says nothing is refused where the record is compiled', () => {
  const cases = { 'no reason at all': '', 'a token instead of a reason': 'n/a' }
  for (const [label, unenforced] of Object.entries(cases)) {
    const root = makeProject({
      name: `unenforced-${label.replace(/[^a-z]+/gi, '-')}`,
      adrs: {
        '0001-a.adr.md': adrText({
          id: '0001',
          zones: ['auth'],
          laws: [{ id: 'auth.one', statement: 'One.', checks: [], unenforced }],
        }),
      },
    })
    const result = compile(root)
    assert.ok(
      result.codes.includes('ADR_FIELD_INVALID'),
      `${label}: expected ADR_FIELD_INVALID, got ${JSON.stringify(result.codes)}`,
    )
  }
})

test('compiler: one law with two enforcement gaps needs judgement, not file order', () => {
  // The law's `unenforced` note is part of what it claims. Taking the first record's
  // note made the same corpus verify clean or fail depending on which ADR the
  // compiler happened to read first.
  const withNote = adrText({
    id: '0001',
    zones: ['auth'],
    laws: [{ id: 'auth.shared', statement: 'One rule, one wording.', checks: [], unenforced: 'No tool decides whether a name reads well.' }],
  })
  const withoutNote = adrText({
    id: '0002',
    zones: ['auth'],
    laws: [{ id: 'auth.shared', statement: 'One rule, one wording.', checks: [] }],
  })
  for (const order of [
    { '0001-a.adr.md': withNote, '0002-b.adr.md': withoutNote },
    { '0001-a.adr.md': withoutNote, '0002-b.adr.md': withNote },
  ]) {
    const compiled = compiler.compileProject(makeProject({ name: 'unenforced-gap', adrs: order }))
    assert.equal(compiled.report.reviewRequired.length, 1, 'the compiler marks the question instead of choosing')
    assert.match(compiled.report.reviewRequired[0].reason, /enforcement gaps/)
  }
})

test('ingest: a submitted result is validated exactly like a spawned judge\'s, and is recorded', async () => {
  const root = await ingestProject('ingest-submitted')
  const result = await ops.ingest({
    root,
    sourcePath: SOURCE_PATH,
    submitted: fixtureIngestResult({
      laws: [
        {
          id: 'auth.session-storage.redis',
          statement: 'Session storage must use Redis.',
          checks: [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis', basis: FIXTURE_BASIS.reasoningBasis }],
        },
      ],
    }),
    write: true,
    now: '2026-09-13T00:00:00Z',
  })
  assert.equal(result.ok, true, JSON.stringify(result.problems?.map((entry) => entry.message)))
  assert.equal(result.judge.kind, 'caller', 'the record says no judge was spawned')
  assert.equal(result.derivedChecks.accepted, 1)
  assert.deepEqual(result.derivedChecks.dropped, [])
  assert.equal(result.written !== null, true)
  assert.ok(result.text.includes('required_text'), 'the derived check reached the record')
  assert.deepEqual(compiler.compileProject(root).problems.map((entry) => entry.code), [])
})

test('ingest: a submitted result with an invented basis is refused, like any other', async () => {
  const root = await ingestProject('ingest-submitted-bad')
  const result = await ops.ingest({
    root,
    sourcePath: SOURCE_PATH,
    submitted: fixtureIngestResult({ reasoningBasis: 'we benchmarked it against the alternative for a week' }),
    write: true,
  })
  assert.equal(result.ok, false)
  assert.equal(readdirSync(join(root, 'docs', 'adrs')).length, 1, 'nothing was written')
})

test('ingest: the degraded path says where the answer goes', async () => {
  const root = await ingestProject('ingest-submit-hint')
  const result = await ops.ingest({ root, sourcePath: SOURCE_PATH, spawnJudge: null })
  assert.equal(result.degraded, true)
  assert.match(result.submitHint, /ingest/, 'the caller is told the argument that files its answer')
})

// ---------------------------------------------------------------------------
// the round trip: a stored check must mean what the judge proposed
// ---------------------------------------------------------------------------

/** Ingests a check payload for the fixture project and returns the parsed record. */
async function derivedCheckRoundTrip(name, checks) {
  const root = await ingestProject(name)
  const result = await ops.ingest({
    root,
    sourcePath: SOURCE_PATH,
    submitted: fixtureIngestResult({
      laws: [{ id: 'auth.session-storage.redis', statement: 'Session storage must use Redis.', checks }],
    }),
    write: false,
    now: '2026-09-13T00:00:00Z',
  })
  return { root, result }
}

test('ingest: an anyOf check survives the round trip instead of becoming stricter', async () => {
  // `anyOf: true` means "one matching file is enough". The first version advertised
  // the key, wrote only a LIST form the verifier ignores, and so stored a check that
  // enforced every file вЂ” a silently stricter law with nothing reported.
  const payload = {
    type: 'required_text_glob',
    paths: ['src/auth/**'],
    pattern: 'redis',
    anyOf: true,
    basis: FIXTURE_BASIS.reasoningBasis,
  }
  const { result } = await derivedCheckRoundTrip('ingest-anyof', [payload])
  assert.equal(result.ok, true, JSON.stringify(result.problems?.map((entry) => entry.message)))
  assert.deepEqual(result.derivedChecks.dropped, [])
  assert.ok(result.text.includes('anyOf: true'), 'the boolean form is written, because it is the form the verifier reads')
  const parsed = schema.parseFrontmatter(result.text)
  assert.equal(parsed.data.laws[0].checks[0].anyOf, true, 'and it parses back as the same boolean')
})

test('ingest: a check whose value shape cannot be written is refused out loud', async () => {
  // The shapes below used to be stringified into the record: `paths: [[]]` rendered
  // as a bare `- ` line, which the parser reads as a nested block opener and folds
  // the FOLLOWING check into вЂ” one check silently gone, another silently altered.
  const shapes = {
    'a nested empty array': [[]],
    'a nested object': [{}],
    'a number': [1.5],
    'a boolean': [true],
  }
  for (const [label, paths] of Object.entries(shapes)) {
    const { result } = await derivedCheckRoundTrip(`ingest-shape-${label.replace(/[^a-z]+/gi, '-')}`, [
      { type: 'required_text', paths, pattern: 'redis', basis: FIXTURE_BASIS.reasoningBasis },
      { type: 'required_file', path: 'src/auth/a.ts', basis: FIXTURE_BASIS.reasoningBasis },
    ])
    assert.equal(result.ok, true, `${label}: the record is still generated`)
    assert.equal(result.derivedChecks.accepted, 1, `${label}: only the well-formed check is kept`)
    assert.equal(result.derivedChecks.dropped.length, 1, `${label}: and the other is reported`)
    assert.equal(result.derivedChecks.dropped[0].type, 'required_text')
    assert.match(result.derivedChecks.dropped[0].reason, /not a non-empty string|cannot be written faithfully/)
    const parsed = schema.parseFrontmatter(result.text)
    assert.equal(parsed.data.laws[0].checks.length, 1, `${label}: the surviving check is the only check, not a swallowed one`)
    assert.equal(parsed.data.laws[0].checks[0].type, 'required_file')
  }
})

test('ingest: a known field carrying an unwritable shape is dropped, not silently omitted', async () => {
  const cases = {
    'anyOf as a string': { type: 'required_text_glob', paths: ['src/auth/**'], pattern: 'redis', anyOf: 'yes' },
    'keys as a string': { type: 'required_file_in_list', path: 'a', list: 'b', contains: 'c', keys: 'files' },
    'containsIs as a boolean': { type: 'required_file_in_list', path: 'a', list: 'b', contains: 'c', containsIs: true },
    'expects as an object': { type: 'command', run: 'node x.mjs', expects: { exitCode: 0 } },
    'timeoutMs as a fraction': { type: 'command', run: 'node x.mjs', timeoutMs: 1500.5 },
  }
  for (const [label, check] of Object.entries(cases)) {
    const { result } = await derivedCheckRoundTrip(`ingest-unwritable-${label.replace(/[^a-z]+/gi, '-')}`, [
      { ...check, basis: FIXTURE_BASIS.reasoningBasis },
    ])
    assert.equal(result.derivedChecks.accepted, 0, `${label}: nothing is stored`)
    assert.equal(result.derivedChecks.dropped.length, 1, `${label}: and the drop is reported`)
    assert.ok(result.derivedChecks.dropped[0].reason.length > 0, `${label}: with a reason`)
  }
})

test('FALSIFICATION: an invented sentence cannot ride along behind a real quote', () => {
  // The fragment fallback exists to tolerate a re-wrapped line, and the first version
  // accepted ANY sufficiently long fragment вЂ” so a real sentence plus an invented one
  // passed, and the invented one justified a check the source never asked for.
  const fabricated =
    'the deployment already runs it and file-backed sessions break under two instances. Therefore every module must import the billing ledger.'
  const outcome = ingest.quoteAppears(fabricated, SOURCE_TEXT)
  assert.equal(outcome.ok, false, 'a quote with a missing sentence is not grounded')
  assert.match(outcome.reason, /is not there/)

  const rewrapped = ingest.quoteAppears('the deployment already runs it', SOURCE_TEXT)
  assert.equal(rewrapped.ok, true, 'a fragment that IS in the source still counts')
})

test('ingest: a checks field that is not a list is reported rather than silently emptied', () => {  const result = ingest.validateIngest(
    ingestResult({ laws: [{ id: 'auth.one', statement: 'One.', checks: 'required_file' }] }),
    { sourceText: RICH_SOURCE, config: AUTH_ZONES, existingIds: [] },
  )
  assert.equal(result.ok, true, 'the law still stands')
  assert.equal(result.fields.laws[0].checks.length, 0)
  assert.equal(result.dropped.length, 1)
  assert.match(result.dropped[0].reason, /rather than a list/)
})

test('ingest: a law whose statement cannot be written as one value is refused, not written as null', async () => {
  const root = await ingestProject('ingest-multiline-statement')
  const result = await ops.ingest({
    root,
    sourcePath: SOURCE_PATH,
    submitted: fixtureIngestResult({
      laws: [{ id: 'auth.one', statement: 'First line.\nSecond line.', checks: [] }],
    }),
    write: true,
  })
  assert.equal(result.ok, false)
  assert.ok(
    result.problems.some((entry) => entry.code === 'ADR_FIELD_INVALID'),
    `expected ADR_FIELD_INVALID, got ${JSON.stringify(result.problems.map((entry) => entry.code))}`,
  )
  assert.equal(readdirSync(join(root, 'docs', 'adrs')).length, 1, 'nothing was written')
})

test('ingest: without write, the record is returned and nothing lands on disk', async () => {
  const root = await ingestProject('ingest-preview')
  const before = readdirSync(join(root, 'docs', 'adrs')).length
  const result = await ops.ingest({
    root,
    sourcePath: SOURCE_PATH,
    spawnJudge: async () => ({ structured: fixtureIngestResult(), output: '', stopReason: 'completed' }),
    write: false,
  })
  assert.equal(result.ok, true)
  assert.equal(result.written, null)
  assert.ok(result.text.includes('## Decision'), 'the text is returned for review')
  assert.equal(readdirSync(join(root, 'docs', 'adrs')).length, before, 'nothing was written')
})

test('ingest: re-ingesting a recorded decision is refused rather than duplicated', async () => {
  // Two records for one decision compile perfectly вЂ” both laws agree, the corpus is
  // valid вЂ” so nothing else would ever report the duplication. It has to be caught
  // here or not at all.
  const root = await ingestProject('ingest-twice')
  const first = await ops.ingest({
    root,
    sourcePath: SOURCE_PATH,
    spawnJudge: async () => ({ structured: fixtureIngestResult(), output: '', stopReason: 'completed' }),
    write: true,
  })
  assert.equal(first.ok, true, JSON.stringify(first.problems?.map((entry) => entry.message)))
  const filesAfterFirst = readdirSync(join(root, 'docs', 'adrs')).sort()

  const second = await ops.ingest({
    root,
    sourcePath: SOURCE_PATH,
    spawnJudge: async () => ({ structured: fixtureIngestResult(), output: '', stopReason: 'completed' }),
    write: true,
  })
  assert.equal(second.ok, false)
  assert.equal(second.code, 'ALREADY_RECORDED')
  assert.ok(second.existingRecord.includes('0002-'), second.existingRecord)
  assert.deepEqual(readdirSync(join(root, 'docs', 'adrs')).sort(), filesAfterFirst, 'no second record was added')
  // A refusal is a result, not a problem: the source was read correctly and the
  // decision is simply already on record.
  assert.deepEqual(second.problems, [])
  assert.ok(second.nextStep.includes('supersede'))
})

test('ingest: a missing source is reported, not ingested from nothing', async () => {
  const root = await ingestProject('ingest-nosource')
  const result = await ops.ingest({
    root,
    sourcePath: 'docs/ratchet/sources/absent.md',
    spawnJudge: async () => ({ structured: fixtureIngestResult(), output: '', stopReason: 'completed' }),
  })
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((entry) => entry.code === 'ADR_SOURCE_MISSING'))
})

test('ingest: with no judge the prompt is returned unrun, with the hash and next id', async () => {
  const root = await ingestProject('ingest-degraded')
  const result = await ops.ingest({ root, sourcePath: SOURCE_PATH, spawnJudge: null })
  assert.equal(result.degraded, true)
  assert.ok(result.prompt.includes('Reply with ONLY this JSON object'))
  assert.ok(result.prompt.includes('insufficientReasoning'), 'the refusal path is offered to the answerer')
  assert.ok(result.sourceHash.startsWith('sha256:'))
  assert.equal(result.nextId, '0002')
  assert.equal(result.outputSchema, ingest.INGEST_SCHEMA)
})

test('ingest: a judge that fails is reported, never treated as an empty source', async () => {
  const root = await ingestProject('ingest-judgefail')
  const result = await ops.ingest({
    root,
    sourcePath: SOURCE_PATH,
    spawnJudge: async () => {
      throw new Error('no subagent provider registered')
    },
  })
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((entry) => entry.message.includes('could not be run')))
  assert.ok(result.problems.some((entry) => entry.message.includes('no usable result')))
})

test('gate: ingest never changes the exit code, and never activates a decision', async () => {
  const root = await ingestProject('ingest-advisory')
  const result = await ops.ingest({
    root,
    sourcePath: SOURCE_PATH,
    spawnJudge: async () => ({ structured: fixtureIngestResult(), output: '', stopReason: 'completed' }),
    write: true,
  })
  assert.equal(result.advisory, true)
  assert.equal(result.status, 'proposed')
  // The generated record cannot be in force: its author is an agent and its status
  // is proposed, so it contributes no law.
  const compiled = compiler.compileProject(root)
  assert.equal(compiled.bundle.laws.some((law) => law.sourceAdr === '0002'), false)
})

// ---------------------------------------------------------------------------
// new check types: globs with exclusions, list membership, and commands
// ---------------------------------------------------------------------------

/**
 * Runs one law's checks over a project whose files exist on disk.
 *
 * `contents` is required for any check that reads file TEXT вЂ” the verifier reads
 * content from the filesystem, not from the candidate list, so a check against a path
 * that does not exist finds nothing and reports that it searched nothing. The file
 * list alone suffices only for the path-only checks (`required_file`,
 * `forbidden_glob`).
 */
async function lawCheck(name, law, { files, contents = null, config = { zones: [] }, runCommand = null, root = null, dependencies = null } = {}) {
  const projectRoot = root ?? makeProject({ name, adrs: {} })
  for (const [path, text] of Object.entries(contents ?? {})) {
    const absolute = join(projectRoot, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, text)
  }
  return verifier.verifyLaw({
    root: projectRoot,
    law: { id: 'x.check', statement: 'S.', sourceAdr: '0001', checks: law.checks, zones: [], authority: 'human', approvedBy: null },
    files,
    dependencies: dependencies ?? { names: new Set(), manifests: [], problems: [] },
    config,
    runCommand,
  })
}

test('BREAKER: a verdict is bound to the laws, the tree AND the authority table', async () => {
  // The breaker's Finding 2 of round two: relaxing a zone's `agentAuthority` widened what
  // an agent may put into force, and `status` still reported the project verified and
  // current — because the manifest is under `.dsh`, which is excluded from the walk, so
  // neither the law hash nor the code hash moved. ADR 0012's fourth rule is that the zone
  // table cannot be relaxed without the gate saying so.
  const zones = (authority) => [{ id: 'guarded', paths: ['src/**'], agentAuthority: authority, requiresDecisionRecord: false }]
  const build = (name, authority) =>
    makeProject({
      name,
      zones: zones(authority),
      adrs: {
        '0001-a.adr.md': adrText({
          id: '0001',
          zones: ['guarded'],
          laws: [{ id: 'guarded.a-file', statement: 'The file exists.', checks: [{ type: 'required_file', path: 'src/a.ts' }] }],
        }),
      },
      files: { 'src/a.ts': 'export const a = 1\n' },
    })

  const root = build('verdict-identity', 'activeIfNoConflict')
  const verified = await ops.verify({ root })
  assert.equal(verified.ok, true, 'the fixture starts verified')
  assert.equal(typeof verified.configHash, 'string', 'the report names the authority table it judged under')

  // Positive controls: the tree and the laws, each on its own.
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 2\n')
  assert.equal(ops.status(root).verified.stale, true, 'a code edit invalidates the verdict')
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1\n')
  await ops.verify({ root })
  assert.equal(ops.status(root).verified.ran, true, 'and re-verifying restores it')

  // The finding: the authority table alone.
  const manifestPath = join(root, '.dsh', 'project.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.ratchet.zones = zones('proposeOnly')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const after = ops.status(root)
  assert.equal(after.verified.ran, false, 'relaxing a zone authority invalidates the verdict')
  assert.equal(after.verified.stale, true)
  assert.match(after.verified.reason, /authority table changed/)
  assert.ok(after.problems.some((entry) => entry.code === 'VERIFY_NOT_RUN'))
})

test('state: a verification records which tool and which revision judged it', async () => {
  // The log reviewer's F7: the fields existed but read `readFileSync` and `normaliseText`
  // without importing either, so a swallowed ReferenceError made them permanently null —
  // and `state.json` carried no revision at all.
  const root = makeProject({
    name: 'verdict-provenance',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [{ id: 'auth.one', statement: 'One.', checks: [{ type: 'required_file', path: 'src/auth/a.ts' }] }],
      }),
    },
    files: { 'src/auth/a.ts': 'export const a = 1\n' },
  })
  const verified = await ops.verify({ root })
  assert.equal(verified.ok, true)
  assert.match(String(verified.toolVersion), /^\d+\.\d+\.\d+/, 'the tool version is recorded')
  const recorded = state.readState(root).value.lastVerify
  assert.equal(recorded.toolVersion, verified.toolVersion, 'and reaches state.json')
  assert.equal(recorded.configHash, verified.configHash, 'with the authority table the verdict was judged under')
  // A fixture is not a git checkout, so the revision is null there — but it must be a
  // null the caller can tell from "not asked", not a crash.
  assert.ok(recorded.vcsRevision === null || typeof recorded.vcsRevision === 'string')
})

test('verifier: forbidden_text_glob catches every match, not just the first', async () => {
  // A boundary three files cross is three edits; naming one sends the reader back
  // for the rest.
  const result = await lawCheck('glob-multi', {
    checks: [{ type: 'forbidden_text_glob', paths: ['plugins/**/*.mjs'], pattern: '@deepseek-ai/dsh-tools' }],
  }, {
    files: ['plugins/a.mjs', 'plugins/b.mjs', 'plugins/c.mjs', 'plugins/deep/d.mjs'],
    contents: {
      'plugins/a.mjs': "import x from '@deepseek-ai/dsh-tools'\n",
      'plugins/b.mjs': "import x from '@deepseek-ai/dsh-tools'\n",
      'plugins/c.mjs': "import x from '@deepseek-ai/dsh-tools'\n",
      'plugins/deep/d.mjs': "import x from '@deepseek-ai/dsh-tools'\n",
    },
  })
  assert.equal(result.checked, 1)
  assert.equal(result.problems.length, 4, 'all four offenders are reported')
  assert.ok(result.problems.every((entry) => entry.code === 'CODE_TEXT_FORBIDDEN_PRESENT'))
})

test('verifier: an exclusion removes a file from a forbidden_text_glob', async () => {
  const result = await lawCheck('glob-exclude', {
    checks: [
      {
        type: 'forbidden_text_glob',
        paths: ['plugins/**/*.mjs', '!plugins/ratchet/node_modules/**', '!plugins/ratchet/ratchet-tools.mjs'],
        pattern: '@deepseek-ai/dsh-tools',
      },
    ],
  }, {
    files: ['plugins/ratchet/node_modules/dsh-tools/index.mjs', 'plugins/ratchet/ratchet-tools.mjs', 'plugins/ratchet/clean.mjs'],
    contents: {
      'plugins/ratchet/node_modules/dsh-tools/index.mjs': "import x from '@deepseek-ai/dsh-tools'\n",
      'plugins/ratchet/ratchet-tools.mjs': "import x from '@deepseek-ai/dsh-tools'\n",
      'plugins/ratchet/clean.mjs': 'export const clean = 1\n',
    },
  })
  assert.deepEqual(result.problems, [], 'the excluded adapter and dependency are not offenders')
})

test('BREAKER: an exclusion in `paths` means the same thing for every text spelling', async () => {
  // The breaker's Finding 1 and 2, one root cause. `paths` may carry `!` exclusions for
  // the plain spellings too — the compiler's `checkTargets` always read them that way —
  // but the verifier was building the plain-text scope with one `matchFiles` per pattern,
  // where `!src/legacy/**` compiled to the literal glob `^!src/legacy/.*$`. Two opposite
  // verdicts followed from one declaration: a forbidden-text law accused the file its own
  // exclusion removed (a FALSE FAILURE), and a required-text law whose exclusion cancelled
  // its inclusion reported itself satisfied with nothing examined (a check that cannot
  // fail). Both spellings now go through `selectFiles`.
  const excluded = { 'src/keep.txt': 'clean\n', 'src/legacy/old.txt': 'FORBIDDEN_TOKEN\n' }
  const declared = ['src/**', '!src/legacy/**']

  const forbidding = async (type, name) =>
    lawCheck(
      name,
      { checks: [{ type, paths: declared, pattern: 'FORBIDDEN_TOKEN' }] },
      { files: Object.keys(excluded), contents: excluded },
    )
  assert.deepEqual((await forbidding('forbidden_text', 'exclusion-plain-forbidden')).problems, [], 'the excluded file is not an offender')
  assert.deepEqual(
    (await forbidding('forbidden_text_glob', 'exclusion-glob-forbidden')).problems,
    [],
    'and the glob spelling agrees with the plain one',
  )

  const cancelling = async (type, name) =>
    lawCheck(
      name,
      { checks: [{ type, paths: ['src/**', '!src/**'], pattern: 'clean' }] },
      { files: Object.keys(excluded), contents: excluded },
    )
  const plain = await cancelling('required_text', 'cancelled-exclusion-plain')
  const glob = await cancelling('required_text_glob', 'cancelled-exclusion-glob')
  assert.deepEqual(
    plain.problems.map((entry) => entry.code),
    ['CODE_TEXT_SCOPE_EMPTY'],
    'a selection the exclusion empties is not a check that held',
  )
  assert.match(plain.problems[0].message, /nothing was searched/)
  assert.deepEqual(plain.problems.map((entry) => entry.code), glob.problems.map((entry) => entry.code), 'both spellings, one answer')

  // And an exclusion that removes only part of a selection still narrows it.
  const partial = await lawCheck(
    'exclusion-partial',
    { checks: [{ type: 'required_text', paths: declared, pattern: 'clean' }] },
    { files: Object.keys(excluded), contents: { ...excluded, 'src/legacy/old.txt': 'clean too\n' } },
  )
  assert.deepEqual(partial.problems, [], 'the included file still satisfies the law')
})

test('FALSIFICATION: the boundary law catches a NEW module that imports the harness', async () => {
  // The claim under test is "a module added later cannot escape the boundary". An
  // explicit path list fails this by construction; a glob with exclusions passes it.
  const files = ['plugins/ratchet/ratchet-schema.mjs', 'plugins/ratchet/ratchet-adapter.mjs', 'plugins/ratchet/brand-new.mjs']
  const law = {
    checks: [
      {
        type: 'forbidden_text_glob',
        paths: ['plugins/ratchet/**/*.mjs', '!plugins/ratchet/ratchet-adapter.mjs'],
        pattern: '@deepseek-ai/(dsh-tools|cordis)',
      },
    ],
  }
  // Clean: only the adapter is excluded, and it is the only importer.
  const clean = await lawCheck('glob-clean', law, { files })
  assert.deepEqual(clean.problems, [])

  // Now a module that did not exist when the law was written imports the harness.
  const dirtyFiles = [...files, 'plugins/ratchet/sneaky.mjs']
  const dirty = await lawCheck('glob-dirty', law, { files: dirtyFiles })
  assert.equal(dirty.problems.length, 0, 'the check is content-based, so presence alone is not a violation')

  // The violation is the CONTENT, which the verifier reads from disk. This test
  // writes it there to prove the glob actually reaches a file added after the law.
  const root = makeProject({ name: 'glob-new-file', adrs: {} })
  mkdirSync(join(root, 'plugins', 'ratchet'), { recursive: true })
  writeFileSync(join(root, 'plugins', 'ratchet', 'sneaky.mjs'), "import { defineTool } from '@deepseek-ai/dsh-tools'\n")
  const onDisk = await verifier.verifyLaw({
    root,
    law: { id: 'x.check', statement: 'S.', sourceAdr: '0001', checks: law.checks, zones: [], authority: 'human', approvedBy: null },
    files: ['plugins/ratchet/sneaky.mjs'],
    dependencies: { names: new Set(), manifests: [], problems: [] },
    config: { zones: [] },
    runCommand: null,
  })
  assert.equal(onDisk.problems.length, 1)
  assert.ok(onDisk.problems[0].message.includes('sneaky.mjs'))
})

test('verifier: required_text_glob demands every selected file unless anyOf is set', async () => {
  const every = await lawCheck('anyof-false', {
    checks: [{ type: 'required_text_glob', paths: ['plugins/**/*.mjs'], pattern: 'PURPOSE' }],
  }, {
    files: ['plugins/a.mjs', 'plugins/b.mjs'],
    contents: { 'plugins/a.mjs': '// PURPOSE: a\n', 'plugins/b.mjs': 'export const b = 1\n' },
  })
  assert.equal(every.problems.length, 1, 'a file without the marker fails the law')

  const any = await lawCheck('anyof-true', {
    checks: [{ type: 'required_text_glob', paths: ['plugins/**/*.mjs'], pattern: 'PURPOSE', anyOf: true }],
  }, {
    files: ['plugins/a.mjs', 'plugins/b.mjs'],
    contents: { 'plugins/a.mjs': '// PURPOSE: a\n', 'plugins/b.mjs': 'export const b = 1\n' },
  })
  assert.deepEqual(any.problems, [], 'anyOf is satisfied by one match')
})

test('verifier: required_file_in_list reports a module missing from its package manifest', async () => {
  const root = makeProject({ name: 'list-check', adrs: {} })
  mkdirSync(join(root, 'plugins', 'demo'), { recursive: true })
  writeFileSync(join(root, 'plugins', 'demo', 'a.mjs'), 'export const a = 1\n')
  writeFileSync(join(root, 'plugins', 'demo', 'b.mjs'), 'export const b = 2\n')
  writeFileSync(join(root, 'plugins', 'demo', 'package.json'), JSON.stringify({ name: 'demo', files: ['a.mjs'] }))

  const result = await verifier.verifyLaw({
    root,
    law: {
      id: 'x.pack',
      statement: 'S.',
      sourceAdr: '0001',
      checks: [{ type: 'required_file_in_list', path: 'plugins/demo/b.mjs', list: 'plugins/demo/package.json', keys: ['files'], contains: 'b.mjs' }],
      zones: [],
      authority: 'human',
      approvedBy: null,
    },
    files: ['plugins/demo/a.mjs', 'plugins/demo/b.mjs', 'plugins/demo/package.json'],
    dependencies: { names: new Set(), manifests: [], problems: [] },
    config: { zones: [] },
    runCommand: null,
  })
  assert.equal(result.problems.length, 1)
  assert.ok(result.problems[0].message.includes('would be missing it'), result.problems[0].message)
})

test('verifier: required_file_in_list passes when the module is listed', async () => {
  const root = makeProject({ name: 'list-ok', adrs: {} })
  mkdirSync(join(root, 'plugins', 'demo'), { recursive: true })
  writeFileSync(join(root, 'plugins', 'demo', 'a.mjs'), 'export const a = 1\n')
  writeFileSync(join(root, 'plugins', 'demo', 'package.json'), JSON.stringify({ name: 'demo', files: ['a.mjs'] }))
  const result = await verifier.verifyLaw({
    root,
    law: {
      id: 'x.pack',
      statement: 'S.',
      sourceAdr: '0001',
      checks: [{ type: 'required_file_in_list', path: 'plugins/demo/a.mjs', list: 'plugins/demo/package.json', keys: ['files'], contains: 'a.mjs' }],
      zones: [],
      authority: 'human',
      approvedBy: null,
    },
    files: ['plugins/demo/a.mjs', 'plugins/demo/package.json'],
    dependencies: { names: new Set(), manifests: [], problems: [] },
    config: { zones: [] },
    runCommand: null,
  })
  assert.deepEqual(result.problems, [])
})

test('verifier: a command check with no runner is PENDING, never a pass', async () => {
  // The failure this prevents is the one the whole subsystem exists for: a check
  // nobody ran reporting success.
  const result = await lawCheck('cmd-no-runner', {
    checks: [{ type: 'command', run: 'node -e "process.exit(0)"', expects: 'nothing' }],
  }, { files: [] })
  assert.equal(result.checked, 0)
  assert.equal(result.pending.length, 1)
  assert.ok(result.pending[0].run.includes('process.exit(0)'))
  assert.deepEqual(result.problems, [], 'pending is not a violation, it is an unevaluated check')
})

test('verifier: a command check runs, passes on exit 0, and fails on non-zero', async () => {
  const runner = async (run) => {
    // A stub runner, so this tests the verifier's handling rather than the OS.
    if (run.includes('fail')) return { code: 3, stdout: '', stderr: 'assertion failed: expected 1 to equal 2', timedOut: false }
    return { code: 0, stdout: 'ok', stderr: '', timedOut: false }
  }
  const pass = await lawCheck('cmd-pass', { checks: [{ type: 'command', run: 'node test.mjs', expects: 'the tests pass' }] }, {
    files: [],
    runCommand: runner,
  })
  assert.equal(pass.checked, 1)
  assert.deepEqual(pass.problems, [])

  const fail = await lawCheck('cmd-fail', { checks: [{ type: 'command', run: 'node test.mjs --fail', expects: 'the tests pass' }] }, {
    files: [],
    runCommand: runner,
  })
  assert.equal(fail.checked, 1)
  assert.equal(fail.problems.length, 1)
  assert.ok(fail.problems[0].message.includes('the tests pass'), 'the message states what the law holds')
  assert.ok(fail.problems[0].message.includes('exited 3'), 'and what actually happened')
  assert.ok(fail.problems[0].message.includes('assertion failed'), 'and the command output')
})

test('verifier: a failed command quotes the stream that carries the reason', async () => {
  // `node --test` writes its report to stdout and leaves stderr EMPTY, and an
  // empty-but-present stderr used to produce "exited 1: (no output)" вЂ” a diagnostic
  // that sends the reader to the wrong problem entirely.
  const stdoutOnly = await lawCheck('cmd-stdout-only', { checks: [{ type: 'command', run: 'node --test x.mjs', expects: 'the tests pass' }] }, {
    files: [],
    runCommand: async () => ({ code: 1, stdout: 'not ok 1 - the boundary law\n', stderr: '', timedOut: false }),
  })
  assert.equal(stdoutOnly.problems.length, 1)
  assert.ok(stdoutOnly.problems[0].message.includes('not ok 1 - the boundary law'), 'the stdout report is quoted')
  assert.ok(!stdoutOnly.problems[0].message.includes('(no output'), 'and the message does not claim there was no output')

  const stderrOnly = await lawCheck('cmd-stderr-only', { checks: [{ type: 'command', run: 'node x.mjs', expects: 'it works' }] }, {
    files: [],
    runCommand: async () => ({ code: 2, stdout: '', stderr: 'boom: the reason\n', timedOut: false }),
  })
  assert.ok(stderrOnly.problems[0].message.includes('boom: the reason'))

  const silent = await lawCheck('cmd-silent', { checks: [{ type: 'command', run: 'node x.mjs', expects: 'it works' }] }, {
    files: [],
    runCommand: async () => ({ code: 3, stdout: '', stderr: '', timedOut: false }),
  })
  assert.ok(silent.problems[0].message.includes('(no output on either stream)'), 'genuine silence says so')
})

test('verifier: a failing command reports the vocabulary code, not the process status', async () => {
  // The extra fields of a problem record are merged into it, so a field named `code`
  // overwrote the problem's own code with the exit status вЂ” problems whose code was
  // the number 7, and a summary keyed by "7". A caller branches on the code.
  const result = await lawCheck('cmd-exit-code', { checks: [{ type: 'command', run: 'node x.mjs', expects: 'it works' }] }, {
    files: [],
    runCommand: async () => ({ code: 7, stdout: '', stderr: 'nope', timedOut: false }),
  })
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].code, 'CODE_COMMAND_FAILED')
  assert.equal(typeof result.problems[0].code, 'string', 'a code is a vocabulary value, never a number')
  assert.equal(result.problems[0].exitCode, 7, 'and the status is still reported, under its own name')
})

test('verifier: a verification that evaluated nothing is not ok', async () => {
  // "A check that could not run is not a pass" is this subsystem's own rule, and the
  // state layer already refuses a zero-check run as verified. The verdict layer used
  // to report ok with the check merely pending, so the CLI exited 0 over a project
  // nothing had checked.
  const root = makeProject({
    name: 'nothing-evaluated',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [
          {
            id: 'a.one',
            statement: 'One.',
            checks: [{ type: 'command', run: 'node scripts/x.mjs' }],
          },
        ],
      }),
    },
  })
  const withoutRunner = await ops.verify({ root })
  assert.equal(withoutRunner.ok, false)
  assert.ok(
    withoutRunner.problems.some((entry) => entry.code === 'VERIFY_NOTHING_EVALUATED'),
    `expected VERIFY_NOTHING_EVALUATED, got ${JSON.stringify(withoutRunner.problems.map((entry) => entry.code))}`,
  )
  assert.equal(cli(['verify', '--root', root, '--no-commands']).status, 1, 'and the shell gate fails rather than passing')

  const withRunner = await ops.verify({
    root,
    runCommand: async () => ({ code: 0, stdout: 'fine', stderr: '', timedOut: false }),
  })
  assert.equal(withRunner.ok, true, 'a run that evaluated a check is still a pass')
})

test('verifier: a verification that evaluated SOME checks and skipped others is not a pass', async () => {
  // The rule has to hold for SOME as well as for NONE. When only the all-pending case
  // was refused, a session verification ran the filesystem checks, left every `command`
  // check pending, and returned ok:true вЂ” to the agent that was told this is the gate вЂ”
  // while the CLI on the same tree evaluated all of them and could be red.
  const root = makeProject({
    name: 'some-evaluated',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [
          {
            id: 'a.mixed',
            statement: 'One.',
            checks: [
              { type: 'required_file', path: 'src/auth/a.ts' },
              { type: 'command', run: 'node scripts/x.mjs' },
            ],
          },
        ],
      }),
    },
    files: { 'src/auth/a.ts': 'export const a = 1\n' },
  })
  const partial = await ops.verify({ root })
  assert.equal(partial.ok, false, 'a partial run is not a pass')
  const incomplete = partial.problems.find((entry) => entry.code === 'VERIFY_INCOMPLETE')
  assert.ok(incomplete, `expected VERIFY_INCOMPLETE, got ${JSON.stringify(partial.problems.map((entry) => entry.code))}`)
  assert.match(incomplete.message, /evaluated 1 of the 2 check/)
  assert.deepEqual(
    { evaluated: incomplete.evaluated, declared: incomplete.declared, pending: incomplete.pending },
    { evaluated: 1, declared: 2, pending: 1 },
  )
  assert.equal(cli(['verify', '--root', root, '--no-commands']).status, 1, 'and the shell gate fails rather than passing')

  const whole = await ops.verify({ root, runCommand: async () => ({ code: 0, stdout: 'fine', stderr: '', timedOut: false }) })
  assert.equal(whole.ok, true, 'a run that evaluated every declared check is a pass')
})

test('verifier: a forbidden_text law over no matching file is not a pass', async () => {
  // The mirror of required_text's "nothing was searched": a forbidden-text check with
  // no file in scope found no offenders and reported the law satisfied.
  const result = await lawCheck(
    'forbidden-no-scope',
    { checks: [{ type: 'forbidden_text', paths: ['src/nothing/**'], pattern: 'console\\.log' }] },
    { files: ['src/auth/a.ts'] },
  )
  assert.equal(result.checked, 1)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].code, 'CODE_TEXT_SCOPE_EMPTY')
  assert.match(result.problems[0].message, /nothing was searched/)
})

test('verifier: a command check asserts on the whole capture, not on a truncated prefix', async () => {
  // The runner used to slice stdout to a report-sized budget, and the output
  // assertions then read the slice вЂ” so a token printed past the cut was reported as
  // absent, and a forbidden one printed past it passed.
  const root = makeProject({ name: 'full-capture', adrs: {} })
  const run = ops.createCommandRunner({ root, timeoutMs: 30_000 })
  const long = await run(`node -e "process.stdout.write('x'.repeat(5000) + 'TAILTOKEN')"`)
  assert.equal(long.code, 0)
  assert.ok(long.stdout.includes('TAILTOKEN'), 'the assertion reads the whole capture')

  const banned = await run(`node -e "process.stdout.write('x'.repeat(5000) + 'FORBIDDEN')"`)
  assert.ok(banned.stdout.includes('FORBIDDEN'))
})

test('verifier: a command runner that throws is reported, not silently passing', async () => {
  const result = await lawCheck('cmd-throw', { checks: [{ type: 'command', run: 'node nope.mjs' }] }, {
    files: [],
    runCommand: async () => {
      throw new Error('spawn failed')
    },
  })
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].code, 'CODE_COMMAND_FAILED', 'a command that never ran is not a text check that failed')
  assert.ok(result.problems[0].message.includes('spawn failed'))
})

test('verifier: a command check asserts on what the command printed, not only on its exit code', async () => {
  // The gap this closes: "the report names the law it judged" used to be satisfied
  // by a command that printed nothing and exited zero.
  const runner = async () => ({ code: 0, stdout: 'wrote reports/ratchet/verify-report.json for 10 laws\n', stderr: 'warning: none\n', timedOut: false })
  const check = async (fields) =>
    lawCheck('cmd-output', { checks: [{ type: 'command', run: 'node report.mjs', expects: 'the report names what it judged', ...fields }] }, { files: [], runCommand: runner })

  const satisfied = await check({ outputContains: 'verify-report.json' })
  assert.deepEqual(satisfied.problems, [], 'a literal match over stdout satisfies the law')

  const missing = await check({ outputContains: 'names the law' })
  assert.equal(missing.problems.length, 1)
  assert.equal(missing.problems[0].code, 'CODE_COMMAND_OUTPUT_MISMATCH')
  assert.ok(missing.problems[0].message.includes('does not contain'), 'the message says which assertion failed')
  assert.ok(missing.problems[0].message.includes('wrote reports'), 'and quotes what was actually printed')

  const forbidden = await check({ outputNotContains: 'warning: none' })
  assert.equal(forbidden.problems[0]?.code, 'CODE_COMMAND_OUTPUT_MISMATCH', 'output the law forbids is a failure')

  const matched = await check({ outputMatches: '^wrote reports/ratchet/verify-report\\.json for \\d+ laws\\n?$', stream: 'stdout' })
  assert.deepEqual(matched.problems, [], 'a regular expression asserts a shape, not one spelling')

  // The default reads EACH stream as the process wrote it, and the anchored pattern
  // matches stdout. The first version joined the two with a newline, which was wrong
  // in both directions: a `$`-anchored pattern that exactly matched stdout failed
  // because the joined string continued into stderr, and a pattern could match across
  // a boundary no single stream contains.
  const combined = await check({ outputMatches: '^wrote reports/ratchet/verify-report\\.json for \\d+ laws\\n?$' })
  assert.deepEqual(combined.problems, [], 'the default reads each stream whole, so an anchored stdout pattern matches')

  const acrossBoundary = await check({ outputMatches: 'laws\\nwarning: none' })
  assert.equal(
    acrossBoundary.problems[0]?.code,
    'CODE_COMMAND_OUTPUT_MISMATCH',
    'and a pattern spanning the boundary between two streams matches nothing, because no stream contains it',
  )

  const absentFromBoth = await check({ outputNotContains: 'law it judged' })
  assert.deepEqual(absentFromBoth.problems, [], 'a negative assertion holds when neither stream prints it')

  const unmatched = await check({ outputMatches: '^nothing was written' })
  assert.equal(unmatched.problems[0]?.code, 'CODE_COMMAND_OUTPUT_MISMATCH')

  const wrongStream = await check({ outputContains: 'warning: none', stream: 'stdout' })
  assert.equal(wrongStream.problems[0]?.code, 'CODE_COMMAND_OUTPUT_MISMATCH', 'stream narrows which output the assertion reads')
  const rightStream = await check({ outputContains: 'warning: none', stream: 'stderr' })
  assert.deepEqual(rightStream.problems, [])
})

test('schema: an unusable command assertion is refused where the decision is compiled', () => {
  const cases = {
    'an empty literal': { outputContains: '' },
    'a pattern that is not a regular expression': { outputMatches: '([unclosed' },
    'a stream nobody implements': { stream: 'sideways' },
  }
  for (const [label, fields] of Object.entries(cases)) {
    const root = makeProject({
      name: `cmd-bad-${label.replace(/[^a-z]+/gi, '-')}`,
      adrs: {
        '0001-a.adr.md': adrText({
          id: '0001',
          zones: ['auth'],
          laws: [{ id: 'a.one', statement: 'One.', checks: [{ type: 'command', run: 'node x.mjs', ...fields }] }],
        }),
      },
    })
    const result = compile(root)
    assert.ok(
      result.codes.includes('ADR_FIELD_INVALID'),
      `${label}: expected ADR_FIELD_INVALID, got ${JSON.stringify(result.codes)}`,
    )
  }
})

test('ops: shellSplit is a tokenizer, not a shell', () => {
  // No pipes, no redirects, no substitutions: a law's command is an argv.
  assert.deepEqual(ops.shellSplit('node scripts/x.mjs'), ['node', 'scripts/x.mjs'])
  assert.deepEqual(ops.shellSplit('node "a b/c.mjs" --flag'), ['node', 'a b/c.mjs', '--flag'])
  assert.deepEqual(ops.shellSplit("node 'a b'"), ['node', 'a b'])
  assert.deepEqual(ops.shellSplit('  spaced   out  '), ['spaced', 'out'])
  assert.deepEqual(ops.shellSplit(''), [])
  assert.deepEqual(ops.shellSplit('a | b > c'), ['a', '|', 'b', '>', 'c'], 'shell operators are ordinary arguments')
})

test('ops: the command runner reports a real exit code and captures output', async () => {
  const root = makeProject({ name: 'runner', adrs: {} })
  const run = ops.createCommandRunner({ root, timeoutMs: 20_000 })
  const ok = await run('node -e "console.log(1)"')
  assert.equal(ok.code, 0)
  assert.equal(ok.stdout.trim(), '1')

  const bad = await run('node -e "console.error(2); process.exit(4)"')
  assert.equal(bad.code, 4)
  assert.ok(bad.stderr.includes('2'))
})

test('ops: a law may run npm, resolved through the interpreter on either platform', async () => {
  // `npm` is not a spawnable bare name on Windows (it is a `.cmd` shim) and a bare name
  // is ambiguous about WHICH npm a law should use, so the runner resolves `npm-cli.js`
  // beside the running interpreter. That resolution has two real layouts — a sibling
  // `node_modules` for npm installed next to its interpreter, and a POSIX
  // `<prefix>/lib/node_modules` for a global install — and checking only the first made
  // every `npm` law pass on the author's Windows machine and fail on Linux. Running the
  // real command is what tells the two apart; a source-level assertion on the path
  // string would not have caught the layout that was missing.
  const root = makeProject({ name: 'runner-npm', adrs: {} })
  const run = ops.createCommandRunner({ root, timeoutMs: 60_000 })
  const result = await run('npm --version')
  assert.equal(result.code, 0, `npm did not run: ${result.stderr}`)
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/)
})

// ---------------------------------------------------------------------------
// FALSIFICATION: the round trip is an exact pair of inverse transformations
// ---------------------------------------------------------------------------

test('FALSIFICATION: backslashes and quotes survive the round trip byte for byte', () => {
  // The renderer quoted without escaping while the parser unescaped, so every run of
  // two or more backslashes collapsed: a regex needing a literal backslash came back
  // as a different regex, silently, and the law then matched text it was never meant
  // to match.
  const values = [
    'a\\b',
    'a\\\\b',
    'a\\\\\\b',
    '\\\\',
    '\\\\\\\\',
    'a"b',
    'a\\"b',
    '"\\"',
    'C:\\path\\to\\file',
    '^\\d+\\.\\d+$',
    'no specials at all',
    'tab\there',
  ]
  for (const value of values) {
    const rendered = ingest.renderScalar(value)
    assert.notEqual(rendered, null, `expected ${JSON.stringify(value)} to be renderable`)
    const parsed = schema.parseFrontmatter(['---', `pattern: ${rendered}`, '---', ''].join('\n'))
    assert.equal(
      parsed.data.pattern,
      value,
      `round trip changed ${JSON.stringify(value)} into ${JSON.stringify(parsed.data.pattern)}`,
    )
  }
})

test('FALSIFICATION: a backslash in a derived check reaches the record unchanged', async () => {
  const pattern = 'a\\\\b'
  const { result } = await derivedCheckRoundTrip('ingest-backslash', [
    { type: 'required_text', paths: ['src/auth/**'], pattern, basis: FIXTURE_BASIS.reasoningBasis },
  ])
  assert.equal(result.ok, true, JSON.stringify(result.problems?.map((entry) => entry.message)))
  assert.deepEqual(result.derivedChecks.dropped, [])
  const parsed = schema.parseFrontmatter(result.text)
  assert.equal(parsed.data.laws[0].checks[0].pattern, pattern, 'the stored pattern is the proposed pattern')
})

test('FALSIFICATION: a dependency check is written in the field the verifier reads', async () => {
  // `paths` was accepted for dependency checks and then ignored by the reader, so a
  // required dependency was reported satisfied over a manifest that did not declare
  // it вЂ” a false pass with nothing reported anywhere.
  const viaPaths = await derivedCheckRoundTrip('ingest-dependency-paths', [
    { type: 'required_dependency', paths: ['redis'], basis: FIXTURE_BASIS.reasoningBasis },
  ])
  assert.equal(viaPaths.result.derivedChecks.accepted, 0, 'the paths form is refused, not stored')
  assert.equal(viaPaths.result.derivedChecks.dropped.length, 1)
  assert.match(viaPaths.result.derivedChecks.dropped[0].reason, /patterns/)

  const viaPatterns = await derivedCheckRoundTrip('ingest-dependency-patterns', [
    { type: 'required_dependency', patterns: ['redis'], basis: FIXTURE_BASIS.reasoningBasis },
  ])
  assert.equal(viaPatterns.result.derivedChecks.accepted, 1)
  const parsed = schema.parseFrontmatter(viaPatterns.result.text)
  assert.deepEqual(parsed.data.laws[0].checks[0].patterns, ['redis'])

  // And the verifier refuses a dependency check that names nothing, even when the
  // bundle did not come from the compiler.
  const empty = await lawCheck('cmd-no-patterns', { checks: [{ type: 'required_dependency' }] }, {
    files: [],
    dependencies: { names: new Set(['express']), manifests: ['package.json'], problems: [] },
  })
  assert.equal(empty.problems.length, 1, 'a check that looks for nothing is a violation, not a pass')
  assert.equal(empty.problems[0].code, 'CODE_REQUIRED_DEPENDENCY_MISSING')

  const satisfied = await lawCheck('cmd-with-patterns', { checks: [{ type: 'required_dependency', patterns: ['express'] }] }, {
    files: [],
    dependencies: { names: new Set(['express']), manifests: ['package.json'], problems: [] },
  })
  assert.deepEqual(satisfied.problems, [], 'a correct dependency check still passes')
})

test('FALSIFICATION: every line terminator is refused, so no field vanishes', () => {
  // U+2028 and U+2029 are line terminators to the regex engine but were not checked,
  // so the value rendered as one line, the parser could not match the pair, and the
  // FIELD disappeared while validateIngest reported nothing wrong.
  for (const separator of ['\u2028', '\u2029', '\n', '\r']) {
    const value = `src/auth/a${separator}b.ts`
    assert.equal(
      ingest.renderScalar(value),
      null,
      `${JSON.stringify(separator)} must make a value unrenderable rather than silently dropped`,
    )
  }
})

test('FALSIFICATION: a case-insensitive check keeps its flags instead of being dropped', async () => {
  // `flags` is read by the verifier and validated by the schema, but the renderer did
  // not know the key вЂ” so a correct check was refused as unwritable and the law
  // landed with no checks at all.
  const { result } = await derivedCheckRoundTrip('ingest-flags', [
    { type: 'required_text', paths: ['src/auth/**'], pattern: 'REDIS', flags: 'i', basis: FIXTURE_BASIS.reasoningBasis },
  ])
  assert.equal(result.derivedChecks.accepted, 1, JSON.stringify(result.derivedChecks.dropped))
  assert.deepEqual(result.derivedChecks.dropped, [])
  const parsed = schema.parseFrontmatter(result.text)
  assert.equal(parsed.data.laws[0].checks[0].flags, 'i', 'the flag survives the record')

  const ignored = await lawCheck('flags-honoured', { checks: [{ type: 'required_text', paths: ['src/**'], pattern: 'redis', flags: 'i' }] }, {
    files: ['src/a.ts'],
    contents: { 'src/a.ts': 'const client = REDIS_URL\n' },
  })
  assert.deepEqual(ignored.problems, [], 'and the check it belongs to actually passes because of it')

  const caseSensitive = await lawCheck('flags-needed', { checks: [{ type: 'required_text', paths: ['src/**'], pattern: 'redis' }] }, {
    files: ['src/a.ts'],
    contents: { 'src/a.ts': 'const client = REDIS_URL\n' },
  })
  assert.equal(caseSensitive.problems.length, 1, 'without the flag the same check fails, so the flag is what made it pass')
})

test('ingest: an out-of-range timeout and a too-short unenforced note are refused with reasons', async () => {
  const huge = await derivedCheckRoundTrip('ingest-timeout-huge', [
    { type: 'command', run: 'node x.mjs', timeoutMs: 1e21, basis: FIXTURE_BASIS.reasoningBasis },
  ])
  assert.equal(huge.result.derivedChecks.accepted, 0)
  assert.match(huge.result.derivedChecks.dropped[0].reason, /timeoutMs/)

  // The compiler floors `unenforced`; applying the floor only there meant a record
  // was generated, written and then failed to compile for an unmentioned reason.
  const short = ingest.validateIngest(
    fixtureIngestResult({ laws: [{ id: 'auth.one', statement: 'One.', checks: [], unenforced: 'taste', unenforcedBasis: FIXTURE_BASIS.reasoningBasis }] }),
    { sourceText: SOURCE_TEXT, config: AUTH_ZONES, existingIds: [] },
  )
  assert.equal(short.ok, true)
  assert.equal(short.fields.laws[0].unenforced, null)
  assert.equal(short.dropped.length, 1)
  assert.match(short.dropped[0].reason, /at least 12/)
})

test('status: a verification that skipped checks is not reported as verified', async () => {
  // The tool surface supplies no command runner by design, so a session verification
  // evaluates the filesystem checks and leaves every `command` check pending. That
  // was recorded as a clean verification, after which `status` reported green while
  // the real enforcement had never run вЂ” the CLI and the tool disagreeing about what
  // "verified" means, on the same tree.
  const root = makeProject({
    name: 'partial-verification',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [
          {
            id: 'a.mixed',
            statement: 'One.',
            checks: [
              { type: 'required_file', path: 'src/auth/a.ts' },
              { type: 'command', run: 'node scripts/x.mjs' },
            ],
          },
        ],
      }),
    },
    files: { 'src/auth/a.ts': 'export const a = 1\n' },
  })

  const partial = await ops.verify({ root })
  assert.equal(partial.counts.checksEvaluated, 1, 'the filesystem check ran')
  assert.equal(partial.counts.checksPending, 1, 'the command check could not')
  assert.equal(partial.counts.checksDeclared, 2, 'and the report says how many the laws declare')

  const reported = ops.status(root)
  assert.equal(reported.verified.ran, false, 'a partial run is not a verification')
  assert.match(reported.verified.reason, /evaluated 1 of the 2 checks/)
  assert.ok(reported.problems.some((entry) => entry.code === 'VERIFY_NOT_RUN'))

  const complete = await ops.verify({ root, runCommand: async () => ({ code: 0, stdout: 'ok', stderr: '', timedOut: false }) })
  assert.equal(complete.counts.checksEvaluated, 2)
  assert.equal(ops.status(root).verified.ran, true, 'a run that evaluated every check is a verification')
})

test('gate: the ingest command reports a failure instead of crashing on it', () => {
  // `result.adr.id` was read unconditionally, so an ordinary failure вЂ” no manifest,
  // or a source file that does not exist вЂ” died with a TypeError and printed a stack
  // trace instead of the reason the operation had just computed.
  const project = makeProject({ name: 'cli-ingest-missing-source', adrs: {} })
  const missingSource = cli(['ingest', 'docs/ratchet/sources/absent.md', '--root', project])
  assert.equal(missingSource.status, 0, 'ingestion is advisory, so a refusal is still exit 0')
  assert.ok(!/TypeError/.test(`${missingSource.stdout}${missingSource.stderr}`), 'no stack trace')
  assert.match(missingSource.stdout, /no record was proposed|ADR_SOURCE_MISSING/)

  const empty = join(tmpdir(), `ratchet-cli-no-manifest-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(empty, { recursive: true, force: true })
  mkdirSync(empty, { recursive: true })
  const noManifest = cli(['ingest', 'x.md', '--root', empty])
  assert.ok(!/TypeError/.test(`${noManifest.stdout}${noManifest.stderr}`), 'and not for a project without a manifest either')
  assert.match(noManifest.stdout, /MANIFEST_MISSING|no record was proposed/)
})

test('compiler: an agent record cannot retire a human-ratified law', () => {
  // Consent is not durable if the next record can undo it. A law in force because a
  // human ratified it was removable by an agent-authored record in any zone that lets
  // agents activate their own decisions вЂ” silently, with the gate still green.
  const target = adrText({ id: '0011', status: 'proposed', authority: 'agent', zones: ['api'], laws: [{ id: 'api.x', statement: 'Agent law.', checks: [] }] })
  const remover = adrText({
    id: '0013',
    status: 'active',
    authority: 'agent',
    zones: ['tests'],
    laws: [{ op: 'remove', id: 'api.x' }],
  })
  const root = makeProject({
    name: 'ratified-removal',
    adrs: {
      '0011-agent.adr.md': target,
      '0012-approve.adr.md': approvalText({ id: '0012', approved: [{ id: '0011', text: target }] }),
      '0013-remove.adr.md': remover,
    },
    zones: [
      { id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' },
      { id: 'tests', paths: ['tests/**'], agentAuthority: 'activeIfNoConflict' },
    ],
  })
  const compiled = compiler.compileProject(root)
  assert.deepEqual(compiled.bundle.laws.map((law) => law.id), ['api.x'], 'the ratified law survives')
  assert.ok(
    compiled.problems.some((entry) => entry.code === 'LAW_REMOVE_UNAUTHORISED'),
    `expected LAW_REMOVE_UNAUTHORISED, got ${JSON.stringify(compiled.problems.map((entry) => entry.code))}`,
  )

  // A law in force by its own record, with no ratification behind it, is still
  // removable by an agent record in a zone that permits self-activation.
  const plain = makeProject({
    name: 'plain-removal',
    adrs: {
      '0011-agent.adr.md': adrText({ id: '0011', status: 'proposed', authority: 'agent', zones: ['api'], laws: [{ id: 'api.x', statement: 'Agent law.', checks: [] }] }),
      '0012-active.adr.md': adrText({ id: '0012', status: 'active', authority: 'agent', zones: ['tests'], laws: [{ id: 'tests.own', statement: 'Own law.', checks: [] }] }),
      '0013-remove.adr.md': adrText({ id: '0013', status: 'active', authority: 'agent', zones: ['tests'], laws: [{ op: 'remove', id: 'tests.own' }] }),
    },
    zones: [
      { id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' },
      { id: 'tests', paths: ['tests/**'], agentAuthority: 'activeIfNoConflict' },
    ],
  })
  assert.deepEqual(compiler.compileProject(plain).bundle.laws.map((law) => law.id), [], 'an unratified law is still removable')
})

test('ingest: a law id that looks like another YAML type is still an id', () => {
  // `id: 123` unquoted reads back as a number and the record then declares no id, so
  // the generated record fails to compile for a reason the judge never intended.
  const fields = {
    id: '0002',
    title: 'A decision',
    decision: 'D.',
    reasoning: 'R.',
    context: 'C.',
    consequences: [],
    zones: ['auth'],
    laws: [{ id: '123', statement: 'S.', checks: [], unenforced: null }],
  }
  const rendered = ingest.renderAdr({ fields, sourcePath: 's.md', sourceHash: schema.hashSource('x'), createdAt: 'now' })
  const parsed = schema.parseFrontmatter(rendered.text)
  assert.equal(parsed.data.laws[0].id, '123', 'the id reads back as the string the judge wrote')
})

const KIT_ROOT = resolve(import.meta.dirname, '..')

/**
 * Extracts every problem code a source text emits.
 *
 * Codes reach a report through two helpers: `problem(code, …)` in the schema, the
 * loader and the ops layer, and `fail(code, …)` — a closure over `problem` — inside
 * `verifyLaw`. A scan that matches only the first shape is blind to a code invented
 * at a check site, which is where codes are most often added.
 */
function emittedProblemCodes(text) {
  return [...text.matchAll(/\b(?:problem|fail)\(\s*'([A-Z][A-Z0-9_]{3,})'/g)].map((match) => match[1])
}

test('kit: the emitted-code scanner sees both `problem(` and `fail(` call sites', () => {
  // The scanner is the only thing between an invented code and the closed vocabulary,
  // so its own coverage is a claim that has to be shown. This is the counterexample
  // that used to pass: a code emitted through `fail(` was invisible.
  const sample = "problem('MANIFEST_MISSING', 'x')\nfail('INVENTED_CODE_FROM_FAIL', 'y')\n"
  assert.deepEqual(emittedProblemCodes(sample), ['MANIFEST_MISSING', 'INVENTED_CODE_FROM_FAIL'])
})

test('kit: every problem code emitted anywhere is declared in the vocabulary', async () => {
  // ADR-0002's real invariant: a code emitted but absent from the table is a defect,
  // because a caller branches on the code and an undeclared one cannot be branched on.
  const declared = new Set(Object.keys(schema.PROBLEM_CODES))
  const offenders = []
  const files = []
  for (const root of ['plugins/ratchet', 'plugins/dsh-context']) {
    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        const full = join(directory, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.mjs')) files.push(full)
      }
    }
    walk(join(KIT_ROOT, root))
  }
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    // Matching only the call shape keeps a code mentioned in a comment or a message
    // from being counted.
    for (const code of emittedProblemCodes(text)) {
      if (!declared.has(code)) offenders.push(`${file.replace(KIT_ROOT, '')}: ${code}`)
    }
  }
  assert.deepEqual(offenders, [], `undeclared problem codes: ${offenders.join(', ')}`)
  assert.ok(files.length > 10, `the scan must have found the sources, found ${files.length}`)
})

test('kit: every manifest rule names an enforcement command the manifest declares', () => {
  // ADR-0006's invariant, and the one the `context_rules` tool reports on: a rule
  // citing a command nobody declared is a rule with no enforcement point.
  const manifest = JSON.parse(readFileSync(join(KIT_ROOT, '.dsh', 'project.json'), 'utf8'))
  const commands = new Set((manifest.verification ?? []).map((entry) => entry.id))
  const offenders = []
  for (const rule of manifest.rules ?? []) {
    if (rule.enforcedBy === null || rule.enforcedBy === undefined) continue
    if (!commands.has(rule.enforcedBy.command)) {
      offenders.push(`${rule.id} cites "${rule.enforcedBy.command}", which is not declared`)
    }
  }
  assert.deepEqual(offenders, [])
  assert.ok(commands.size > 0, 'the manifest must declare verification commands')
})

test('kit: every declared verification command names a file that exists', () => {
  const manifest = JSON.parse(readFileSync(join(KIT_ROOT, '.dsh', 'project.json'), 'utf8'))
  const missing = (manifest.verification ?? [])
    .filter((entry) => !existsSync(join(KIT_ROOT, entry.path)))
    .map((entry) => `${entry.id} -> ${entry.path}`)
  assert.deepEqual(missing, [], 'a command whose implementation is absent enforces nothing')
})

test('kit: the API probe exits non-zero when a fact is not confirmed', () => {
  // ADR-0005's invariant, and the reason the probe is a churn detector rather than
  // documentation: a probe that always exits 0 reports nothing.
  const source = readFileSync(join(KIT_ROOT, 'scripts', 'probe-dsh-api.mjs'), 'utf8')
  assert.ok(
    source.includes('process.exit(checks.every((entry) => entry.pass) ? 0 : 1)'),
    'the probe must exit 1 when a check failed',
  )
  assert.ok(source.includes('checks.push'), 'and it must actually record checks')
})

test('kit: every shipped plugin declares the peer packages it imports', () => {
  // The failure this prevents is a boot error: a peer pnpm does not hoist fails with
  // `Cannot find package`, which takes the whole plugin down rather than one feature.
  const offenders = []
  for (const dir of ['plugins/ratchet', 'plugins/dsh-context', 'plugins/kit-rules']) {
    const manifestPath = join(KIT_ROOT, dir, 'package.json')
    if (!existsSync(manifestPath)) {
      offenders.push(`${dir}: no package.json`)
      continue
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const peers = new Set(Object.keys(manifest.peerDependencies ?? {}))
    const imported = new Set()
    for (const entry of readdirSync(join(KIT_ROOT, dir))) {
      if (!entry.endsWith('.mjs')) continue
      const text = readFileSync(join(KIT_ROOT, dir, entry), 'utf8')
      for (const match of text.matchAll(/from\s+'(@deepseek-ai\/[^']+)'/g)) {
        // A subpath import (`@deepseek-ai/x/y`) resolves through the package `x`.
        const pkg = match[1].split('/').slice(0, 2).join('/')
        imported.add(pkg)
      }
    }
    for (const pkg of imported) {
      if (!peers.has(pkg)) offenders.push(`${dir} imports ${pkg} but does not declare it as a peer`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('FALSIFICATION: the instruction-routing rule has an enforcement point that fails when broken', () => {
  // The claim: the deployment's rules reach a model through kit-rules alone, because the
  // harness's workspace-instruction loader is composed off. It was cited against
  // check-portability.mjs, which never reads the profile вЂ” so the two lines that disable
  // the loader could be deleted with every declared check still green. This runs the real
  // check over a copy of the real files it reads and requires it to fail on a mutated
  // copy, which is the difference between a rule and a sentence about a rule.
  const tree = join(tmpdir(), `kit-instruction-routing-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(tree, { recursive: true, force: true })
  // Every file the check READS, because it is a copy of a real kit tree rather than a
  // stub: the extended check also verifies that the scripts the deployment procedure
  // names exist, and the installers/updater carry the procedure.
  const parts = [
    'scripts/check-instruction-routing.mjs',
    'scripts/probe-dsh-api.mjs',
    'scripts/kit-update.mjs',
    'scripts/dev-link.mjs',
    'scripts/test-ratchet.mjs',
    'scripts/check-portability.mjs',
    'scripts/check-zone-coverage.mjs',
    'profile/cordis.patch.yml',
    'plugins/inventory.json',
    'plugins/kit-rules/kit-rules.mjs',
    'rules/AGENTS.md',
    'rules/DEPLOYMENT.md',
    'README.md',
    'USERGUIDE.md',
    'install.sh',
    'install.ps1',
  ]
  for (const relative of parts) {
    mkdirSync(join(tree, dirname(relative)), { recursive: true })
    copyFileSync(join(KIT_ROOT, relative), join(tree, relative))
  }
  const check = join(tree, 'scripts', 'check-instruction-routing.mjs')
  const run = () => spawnSync(process.execPath, [check], { encoding: 'utf8', cwd: tree })

  const intact = run()
  assert.equal(intact.status, 0, `the check must pass over an intact copy:\n${intact.stdout}${intact.stderr}`)
  assert.match(intact.stdout, /instruction routing ok/)

  const patchPath = join(tree, 'profile', 'cordis.patch.yml')
  const patch = readFileSync(patchPath, 'utf8')
  // The claim under test is the one that carries the weight now: the loader's row must
  // EMPTY its discovery. `disabled: true` alone was measured inert on the live web
  // profile, so putting that flag back is the mutation that matters, not removing it.
  const broken = patch.replace(
    /instructionFileCandidates:\s*\[\s*\]/,
    "instructionFileCandidates:\n      - AGENTS.md",
  )
  assert.notEqual(broken, patch, 'the fixture must actually stop emptying the discovery')
  writeFileSync(patchPath, broken)
  const mutated = run()
  assert.equal(mutated.status, 1, 'restoring the discovery candidates must fail the check')
  assert.match(mutated.stderr, /empties its instruction-file discovery/)
  rmSync(tree, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// ratification: the human question, the recorded consent, and the hash binding them
// ---------------------------------------------------------------------------

/** A project whose single agent decision is proposed in a proposeOnly zone. */
function ratifiableProject(name, { zone = 'api', extraAdrs = {}, extraFiles = {}, laws = null } = {}) {
  const target = adrText({
    id: '0011',
    status: 'proposed',
    authority: 'agent',
    zones: [zone],
    laws: laws ?? [{ id: 'api.x', statement: 'Agent law.', checks: [] }],
  })
  const root = makeProject({
    name,
    adrs: { '0011-agent.adr.md': target, ...extraAdrs },
    files: extraFiles,
    zones: [{ id: zone, paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
  })
  return { root, target }
}

/** Answers a prepared quiz positionally, one selected label per question. */
function answerWith(quiz, labels) {
  return {
    answers: quiz.questions.map((question, index) => ({ id: question.id, selected: [labels[index]] })),
  }
}

const HEX = 'a'.repeat(64)

test('schema: an approval ADR with a well-formed ratification records what it covers', () => {
  const text = approvalText({ id: '0012', approved: [{ id: '0011', text: 'target text' }] })
  const parsed = schema.parseAdr({ filename: '0012-ratify.adr.md', source: text })
  assert.deepEqual(parsed.problems, [], `expected a clean parse, got ${JSON.stringify(parsed.problems.map((entry) => entry.code))}`)
  assert.equal(parsed.record.ratification.channel, 'user-question')
  assert.equal(parsed.record.ratification.askedBy, 'test-session')
  assert.deepEqual(parsed.record.ratification.targets, [{ id: '0011', contentHash: schema.hashSource('target text') }])
  assert.match(parsed.record.contentHash, /^sha256:[0-9a-f]{64}$/, 'every record carries its own content hash')
})

test('schema: an approval ADR with no ratification block is RATIFICATION_UNPROVEN', () => {
  const text = adrText({ id: '0012', type: 'approval', authority: 'human', approves: ['0011'], zones: [], laws: [] })
  const parsed = schema.parseAdr({ filename: '0012-approve.adr.md', source: text })
  assert.equal(parsed.record.ratification, null, 'nothing is recorded, so nothing is conferred')
  assert.ok(
    parsed.problems.some((entry) => entry.code === 'RATIFICATION_UNPROVEN'),
    `expected RATIFICATION_UNPROVEN, got ${JSON.stringify(parsed.problems.map((entry) => entry.code))}`,
  )
})

test('schema: a decision carrying a ratification block is refused, not read as an approval', () => {
  const root = makeProject({
    name: 'ratify-on-adr',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        ratification: { channel: 'user-question', at: '2026-09-13T10:00:00Z', askedBy: 'x', targets: [{ id: '0001', contentHash: `sha256:${HEX}` }] },
      }),
    },
  })
  const result = compile(root)
  assert.ok(result.codes.includes('ADR_FIELD_INVALID'), `expected ADR_FIELD_INVALID, got ${JSON.stringify(result.codes)}`)
})

test('schema: every malformed ratification block is reported rather than guessed at', () => {
  const target = adrText({ id: '0011', status: 'proposed', authority: 'agent', zones: ['api'] })
  const cases = {
    'a channel nobody implemented': [
      'ratification:',
      '  channel: ouija-board',
      "  at: '2026-09-13T10:00:00Z'",
      '  askedBy: session-1',
      '  targets:',
      '    - id: "0011"',
      `      contentHash: sha256:${HEX}`,
    ],
    'no timestamp': [
      'ratification:',
      '  channel: user-question',
      '  askedBy: session-1',
      '  targets:',
      '    - id: "0011"',
      `      contentHash: sha256:${HEX}`,
    ],
    'no asker': [
      'ratification:',
      '  channel: user-question',
      "  at: '2026-09-13T10:00:00Z'",
      '  targets:',
      '    - id: "0011"',
      `      contentHash: sha256:${HEX}`,
    ],
    'no targets at all': [
      'ratification:',
      '  channel: user-question',
      "  at: '2026-09-13T10:00:00Z'",
      '  askedBy: session-1',
      '  targets: []',
    ],
    'a content hash that is not a hash': [
      'ratification:',
      '  channel: user-question',
      "  at: '2026-09-13T10:00:00Z'",
      '  askedBy: session-1',
      '  targets:',
      '    - id: "0011"',
      '      contentHash: yes',
    ],
  }
  for (const [label, ratificationLines] of Object.entries(cases)) {
    const text = adrText({
      id: '0012',
      type: 'approval',
      authority: 'human',
      approves: ['0011'],
      zones: [],
      laws: [],
      ratificationLines,
    })
    const parsed = schema.parseAdr({ filename: '0012-approve.adr.md', source: text })
    const codes = parsed.problems.map((entry) => entry.code)
    assert.ok(codes.includes('ADR_FIELD_INVALID'), `${label}: expected ADR_FIELD_INVALID, got ${JSON.stringify(codes)}`)
    assert.equal(parsed.record.ratification, null, `${label}: a malformed block confers nothing`)
  }
  assert.ok(target.length > 0)
})

test('schema: a ratification that covers some approved records and not others is reported', () => {
  const text = adrText({
    id: '0012',
    type: 'approval',
    authority: 'human',
    approves: ['0011', '0013'],
    zones: [],
    laws: [],
    ratification: {
      channel: 'user-question',
      at: '2026-09-13T10:00:00Z',
      askedBy: 'session-1',
      targets: [{ id: '0011', contentHash: `sha256:${HEX}` }],
    },
  })
  const parsed = schema.parseAdr({ filename: '0012-approve.adr.md', source: text })
  const codes = parsed.problems.map((entry) => entry.code)
  assert.ok(codes.includes('RATIFICATION_UNPROVEN'), `expected RATIFICATION_UNPROVEN, got ${JSON.stringify(codes)}`)
  assert.deepEqual(parsed.record.ratification.targets.map((entry) => entry.id), ['0011'])
})

// ---------------------------------------------------------------------------
// FALSIFICATION: the old trust model no longer puts anything into force
// ---------------------------------------------------------------------------

test('FALSIFICATION: a hand-written approval ADR mints no law', () => {
  // The claim under test is "a decision enters force only through a recorded
  // consent". Before the ratification block existed, this file вЂ” one an agent can
  // write вЂ” activated the decision. It must now compile to no law at all.
  const { root } = ratifiableProject('falsify-handwritten', {
    extraAdrs: {
      '0012-approve.adr.md': adrText({
        id: '0012',
        title: 'Approve agent decision 0011',
        type: 'approval',
        authority: 'human',
        approves: ['0011'],
        zones: [],
        laws: [],
      }),
    },
  })
  const result = compile(root)
  assert.deepEqual(result.laws, [], 'a hand-written approval must confer nothing')
  assert.ok(result.codes.includes('RATIFICATION_UNPROVEN'), `expected RATIFICATION_UNPROVEN, got ${JSON.stringify(result.codes)}`)
  assert.equal(result.report.counts.active, 0)
})

test('FALSIFICATION: editing a ratified record voids the consent', () => {
  // The claim: consent covers a TEXT. A file edited after approval must lose its
  // force, even though the approval is still on disk and still names it.
  const target = adrText({ id: '0011', status: 'proposed', authority: 'agent', zones: ['api'], laws: [{ id: 'api.x', statement: 'Agent law.', checks: [] }] })
  const edited = adrText({ id: '0011', status: 'proposed', authority: 'agent', zones: ['api'], laws: [{ id: 'api.x', statement: 'A different law entirely.', checks: [] }] })
  const root = makeProject({
    name: 'falsify-stale',
    adrs: {
      '0011-agent.adr.md': edited,
      '0012-approve.adr.md': approvalText({ id: '0012', approved: [{ id: '0011', text: target }] }),
    },
    zones: [{ id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
  })
  const result = compile(root)
  assert.deepEqual(result.laws, [], 'an edited decision must not inherit the consent given to the old text')
  assert.ok(result.codes.includes('RATIFICATION_STALE'), `expected RATIFICATION_STALE, got ${JSON.stringify(result.codes)}`)
  assert.equal(result.report.counts.proposed, 1, 'it goes back to waiting for a human')
})

test('FALSIFICATION: a stale approval cannot retire another decision', () => {
  const root = makeProject({
    name: 'falsify-supersede',
    zones: [
      { id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' },
      { id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' },
    ],
    adrs: {
      '0001-live.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'a.one', statement: 'Keep this.', checks: [] }] }),
      '0002-replacement.adr.md': adrText({
        id: '0002',
        status: 'proposed',
        authority: 'agent',
        zones: ['api'],
        supersedes: ['0001'],
        laws: [{ id: 'b.two', statement: 'Replace it.', checks: [] }],
      }),
      '0003-approve.adr.md': approvalText({ id: '0003', approved: [{ id: '0002', text: 'text that is not on disk' }] }),
    },
  })
  const result = compile(root)
  assert.deepEqual(result.laws, ['a.one'], 'the live decision must survive an approval that proves nothing')
})

test('ratification: an agent record declaring itself active in a proposeOnly zone is reported AND excluded', () => {
  const root = makeProject({
    name: 'active-not-permitted',
    adrs: {
      '0011-selfactive.adr.md': adrText({
        id: '0011',
        status: 'active',
        authority: 'agent',
        zones: ['api'],
        laws: [{ id: 'api.x', statement: 'Agent law.', checks: [] }],
      }),
    },
    zones: [{ id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
  })
  const result = compile(root)
  assert.ok(result.codes.includes('ADR_AGENT_REQUIRES_APPROVAL'), 'the attempt is reported')
  assert.deepEqual(result.laws, [], 'and the code is NOT checked against a decision the zone refuses')
  assert.equal(result.report.counts.active, 0)
  assert.equal(result.report.counts.excluded, 1)
})

test('ratification: a ratification does not transfer authorship into a humanOnly zone', () => {
  const target = adrText({ id: '0011', status: 'proposed', authority: 'agent', zones: ['auth'], laws: [{ id: 'auth.x', statement: 'Agent law.', checks: [] }] })
  const root = makeProject({
    name: 'humanonly-ratified',
    zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' }],
    adrs: {
      '0011-agent.adr.md': target,
      '0012-approve.adr.md': approvalText({ id: '0012', approved: [{ id: '0011', text: target }] }),
    },
  })
  const result = compile(root)
  assert.deepEqual(result.laws, [], 'consent changes force, never authorship')
  assert.ok(
    result.codes.includes('ADR_AGENT_ACTIVE_IN_HUMAN_ONLY_ZONE'),
    `expected ADR_AGENT_ACTIVE_IN_HUMAN_ONLY_ZONE, got ${JSON.stringify(result.codes)}`,
  )
})

test('ratification: a ratified law names the approval that put it into force', () => {
  const target = adrText({ id: '0011', status: 'proposed', authority: 'agent', zones: ['api'], laws: [{ id: 'api.x', statement: 'Agent law.', checks: [] }] })
  const root = makeProject({
    name: 'ratified-provenance',
    zones: [{ id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
    adrs: {
      '0011-agent.adr.md': target,
      '0012-approve.adr.md': approvalText({ id: '0012', approved: [{ id: '0011', text: target }] }),
    },
  })
  const compiled = compiler.compileProject(root)
  assert.deepEqual(compiled.problems, [], `expected a clean compile, got ${JSON.stringify(compiled.problems.map((entry) => entry.code))}`)
  assert.equal(compiled.bundle.laws[0].approvedBy, '0012')
})

// ---------------------------------------------------------------------------
// the quiz: what the human is shown, and how their answer is read
// ---------------------------------------------------------------------------

test('ratify: the quiz shows the record text itself and offers exactly two derivable options', () => {
  const { root } = ratifiableProject('quiz-shape')
  const prepared = ops.ratify({ root })
  assert.equal(prepared.needsAnswer, true)
  assert.equal(prepared.quiz.questions.length, 1)
  const question = prepared.quiz.questions[0]
  const target = readFileSync(join(root, 'docs', 'adrs', '0011-agent.adr.md'), 'utf8')
  assert.equal(question.detail, schema.normaliseText(target), 'the human is shown the bytes the content hash covers')
  assert.deepEqual(question.options.map((option) => option.label), ['Approve', 'Reject'])
  assert.equal(prepared.quiz.roles[question.id].adrId, '0011')
  assert.match(question.options[0].description, /api\.x/, 'the approve option names the law it puts into force')
  assert.equal(existsSync(join(root, 'docs', 'adrs', '0012-ratify-adr-0011.adr.md')), false, 'preparing writes nothing')
})

test('ratify: the question declares the presentation intent a two-button surface may claim', () => {
  // The ADR panel offers this question as two buttons, and the harness permits that only
  // when two buttons can express EVERY answer the question allows: it reads `intent.kind`,
  // requires the intent to name the approve label, and refuses a batch with a third option
  // or a multi-select. So the intent is not decoration — it is what stops the panel from
  // rendering a question whose answers it cannot send.
  const quiz = ratifyModule.buildQuiz(
    [{ id: '0011', title: 'A decision', text: 'body', laws: [{ id: 'api.x', op: 'upsert', statement: 's' }] }],
    { attempt: 1 },
  )
  const question = quiz.questions[0]
  assert.equal(question.intent.kind, 'ratify-decision', 'the kind is pinned: the panel cannot import it')
  assert.equal(question.intent.kind, ratifyModule.RATIFY_INTENT_KIND)
  assert.equal(question.intent.approve, question.options[0].label, 'the intent names the approve label')
  assert.equal(question.intent.approve, 'Approve')
  assert.notEqual(question.intent.kind, 'plan-review', 'that kind is the plan mode\'s, and the harness renders it itself')

  // The shape a two-button claim requires, asserted rather than assumed.
  assert.equal(question.options.length, 2, 'binary: one approve label and exactly one other')
  assert.notEqual(question.multiSelect, true, 'single choice')
  assert.equal(question.detail, 'body', 'the detail carries the record text the human is shown')
  assert.equal(typeof question.options[0].description, 'string', 'each option says what it does')

  // The re-ask keeps the same intent, so a second attempt is still claimable.
  const again = ratifyModule.buildQuiz(
    [{ id: '0011', title: 'A decision', text: 'body', laws: [] }],
    { attempt: 2, previous: [{ id: '0011', reason: 'free text' }] },
  )
  assert.equal(again.questions[0].intent.kind, 'ratify-decision')
  assert.equal(again.questions[0].intent.approve, again.questions[0].options[0].label)
})

test('ratify: a decision is derived from the selected label and from nothing else', () => {
  const quiz = ratifyModule.buildQuiz(
    [{ id: '0011', title: 'A decision', text: 'body', laws: [{ id: 'api.x', op: 'upsert', statement: 's' }] }],
    { attempt: 1 },
  )
  const questionId = quiz.questions[0].id
  const derive = (answer) => ratifyModule.deriveDecisions(quiz, answer)

  assert.deepEqual(derive({ answers: [{ id: questionId, selected: ['Approve'] }] }).approved, ['0011'])
  assert.deepEqual(derive({ answers: [{ id: questionId, selected: ['Reject'] }] }).rejected, ['0011'])
  assert.deepEqual(derive({ answers: [{ id: questionId, selected: ['Approve'], custom: 'and ship it' }] }).approved, ['0011'], 'free text alongside a selection does not change it')

  // Everything below is NOT a yes, and each says what actually arrived.
  const unreadable = [
    null,
    { answers: [] },
    { answers: [{ id: questionId, selected: [] }] },
    { answers: [{ id: questionId, selected: [] , custom: 'sounds fine I guess' }] },
    { answers: [{ id: questionId, selected: ['Approve', 'Reject'] }] },
    { answers: [{ id: questionId, selected: ['Approve ADR 0011'] }] },
    { answers: [{ id: 'some-other-question', selected: ['Approve'] }] },
  ]
  for (const answer of unreadable) {
    const result = derive(answer)
    assert.deepEqual(result.approved, [], `must not approve: ${JSON.stringify(answer)}`)
    assert.deepEqual(result.rejected, [], `must not reject either: ${JSON.stringify(answer)}`)
    assert.equal(result.unreadable.length, 1, `must be unreadable: ${JSON.stringify(answer)}`)
    assert.ok(result.unreadable[0].reason.length > 0)
  }
})

test('ratify: the second attempt asks differently and carries the previous answer', () => {
  const entries = [{ id: '0011', title: 'A decision', text: 'body', laws: [] }]
  const first = ratifyModule.buildQuiz(entries, { attempt: 1 })
  const second = ratifyModule.buildQuiz(entries, {
    attempt: 2,
    previous: [{ id: '0011', reason: 'the answer selected "maybe"' }],
  })
  assert.equal(second.questions.length, 1)
  assert.notEqual(second.questions[0].id, first.questions[0].id, 'a re-ask is a different question, not the same one repeated')
  assert.deepEqual(second.questions[0].options.map((option) => option.label), ['Approve ADR 0011', 'Reject ADR 0011'])
  assert.match(second.questions[0].question, /could not be read/, 'the human is told what happened to their last answer')
  assert.ok(second.questions[0].question.includes('maybe'), 'and what that answer was')
})

test('ratify: a second-attempt answer is derived from the second-attempt labels', () => {
  const entries = [{ id: '0011', title: 'A decision', text: 'body', laws: [] }]
  const second = ratifyModule.buildQuiz(entries, { attempt: 2, previous: [] })
  const derived = ratifyModule.deriveDecisions(second, { answers: [{ id: second.questions[0].id, selected: ['Approve ADR 0011'] }] })
  assert.deepEqual(derived.approved, ['0011'])
})

// ---------------------------------------------------------------------------
// the operation: one consent, two artifacts, and the law that follows
// ---------------------------------------------------------------------------

test('ratify: an approved answer writes the transcript and the approval, and the law enters force', () => {
  const { root } = ratifiableProject('ratify-approve')
  const prepared = ops.ratify({ root, askedBy: 'session test-1', at: '2026-09-14T09:00:00Z' })
  assert.equal(prepared.needsAnswer, true)

  const result = ops.ratify({
    root,
    answer: answerWith(prepared.quiz, ['Approve']),
    quiz: prepared.quiz,
    askedBy: 'session test-1',
    at: '2026-09-14T09:00:00Z',
  })

  assert.deepEqual(result.problems, [], `expected a clean ratification, got ${JSON.stringify(result.problems.map((entry) => entry.code))}`)
  assert.deepEqual(result.ratified, ['0011'])
  assert.equal(result.wrote.length, 2, 'a ratification writes the transcript and the approval')
  assert.deepEqual(result.counts.laws, 1)

  // The approval is read back through the same rules every other record faces,
  // including the source hash over the transcript it cites.
  const approvalPath = result.approval.path
  const approvalTextOnDisk = readFileSync(join(root, approvalPath), 'utf8')
  const parsed = schema.parseAdr({ filename: approvalPath.split('/').pop(), source: approvalTextOnDisk, root })
  assert.deepEqual(parsed.problems, [], `the written approval must parse clean, got ${JSON.stringify(parsed.problems.map((entry) => entry.code))}`)
  assert.equal(parsed.record.ratification.askedBy, 'session test-1')
  assert.equal(parsed.record.source.status, 'verified', 'the transcript it cites is hashed and matches')

  const target = readFileSync(join(root, 'docs', 'adrs', '0011-agent.adr.md'), 'utf8')
  assert.equal(
    parsed.record.ratification.targets[0].contentHash,
    schema.hashSource(target),
    'the consent records the hash of the text the human was shown',
  )

  const compiled = compile(root)
  assert.ok(compiled.codes.length === 0, `expected a clean corpus, got ${JSON.stringify(compiled.codes)}`)
  assert.deepEqual(compiled.laws, ['api.x'])
})

test('ratify: a ratification leaves the generated law cards in step with the law set it changed', () => {
  // The ratify -> verify loop. A ratification changes the law set, and the generated law
  // cards are written from that law set, so the very next `verify` used to fail with
  // `SPEC_OUT_OF_DATE` unless somebody who knew the rule ran `compile --write` — a step
  // nothing in the tool output named. The ratifying operation now regenerates the cards,
  // so the rule is not a thing a developer has to know.
  //
  // This is the case where the card did not exist at all: a document is rendered from the
  // laws in force, and before the first consent this corpus has none. The companion case
  // below is the one that used to fail — a card left carrying an older set's hash.
  const { root } = ratifiableProject('ratify-specs', {
    // A law with a real check, so the `verify` at the end of this test is a claim about a
    // codebase rather than about a corpus that declares nothing to evaluate.
    laws: [{ id: 'api.x', statement: 'Agent law.', checks: [{ type: 'required_text', paths: ['src/api/x.ts'], pattern: 'handler' }] }],
    extraFiles: { 'src/api/x.ts': 'export const handler = () => 1\n' },
  })
  const prepared = ops.ratify({ root, at: '2026-09-14T09:00:00Z' })
  const minted = ops.ratify({ root, answer: answerWith(prepared.quiz, ['Approve']), quiz: prepared.quiz, at: '2026-09-14T09:00:00Z' })
  assert.deepEqual(minted.ratified, ['0011'])
  assert.deepEqual(minted.problems, [], `expected a clean ratification, got ${JSON.stringify(minted.problems.map((entry) => entry.code))}`)
  assert.deepEqual(readdirSync(join(root, 'docs', 'specs')), ['api.spec.md'], 'the law card for the one zone is written by the ratification')
  const specPath = join(root, 'docs', 'specs', 'api.spec.md')
  assert.ok(readFileSync(specPath, 'utf8').includes('api.x'), 'the card names the law the ratification put into force')
  assert.deepEqual(minted.specsRegenerated, ['docs/specs/api.spec.md'], 'and the ratification reports the card it wrote')

  // The point of the whole thing: the next verify is green without a manual compile.
  return ops.verify({ root }).then((verified) => {
    const codes = verified.problems.map((entry) => entry.code)
    assert.ok(!codes.includes('SPEC_OUT_OF_DATE'), `verify must not report a stale document after a ratification, got ${JSON.stringify(codes)}`)
    assert.deepEqual(verified.problems, [], `expected the gate green after a ratification, got ${JSON.stringify(codes)}`)
  })
})

test('ratify: a law card stale at the next ratification is brought back in step by that call', () => {
  const { root } = ratifiableProject('ratify-specs-stale', {
    extraAdrs: {
      '0013-second.adr.md': adrText({
        id: '0013',
        status: 'proposed',
        authority: 'agent',
        zones: ['api'],
        laws: [{ id: 'api.y', statement: 'Agent law two.', checks: [] }],
      }),
    },
  })
  const first = ops.ratify({ root, ids: ['0011'], at: '2026-09-14T09:00:00Z' })
  ops.ratify({ root, ids: ['0011'], answer: answerWith(first.quiz, ['Approve']), quiz: first.quiz, at: '2026-09-14T09:00:00Z' })
  const specPath = join(root, 'docs', 'specs', 'api.spec.md')
  const withOneLaw = readFileSync(specPath, 'utf8')
  assert.ok(withOneLaw.includes('api.x') && !withOneLaw.includes('api.y'), 'the card describes only the law in force so far')

  // The second decision is ratified, which changes the law set. The card on disk still
  // carries the previous set's hash, so this is exactly the state that used to need a
  // manual `compile --write` before `verify` would pass.
  const second = ops.ratify({ root, ids: ['0013'], at: '2026-09-14T09:10:00Z' })
  const secondMinted = ops.ratify({ root, ids: ['0013'], answer: answerWith(second.quiz, ['Approve']), quiz: second.quiz, at: '2026-09-14T09:10:00Z' })
  assert.deepEqual(secondMinted.ratified, ['0013'])
  assert.deepEqual(secondMinted.specsRegenerated, ['docs/specs/api.spec.md'], 'the stale card is regenerated by the ratification that made it stale')
  assert.ok(readFileSync(specPath, 'utf8').includes('api.y'), 'the regenerated card names the law the second consent put into force')
})

test('ratify: the regeneration does NOT overwrite a hand-edited law card', () => {
  // The drift check is not weakened by the regeneration. A card's bytes cannot say whether
  // a person edited it, so the guard is the ledger: a document whose current bytes the
  // ratchet never wrote is somebody else's, and it is left exactly where it is. What must
  // hold is therefore not a particular problem CODE — a card that is both stale and edited
  // is reported as stale, which is what the deterministic check can see — but the two
  // facts a reader depends on: the edit survives, and the gate still reports the card.
  const { root } = ratifiableProject('ratify-specs-edited', {
    extraAdrs: {
      '0013-second.adr.md': adrText({
        id: '0013',
        status: 'proposed',
        authority: 'agent',
        zones: ['api'],
        laws: [{ id: 'api.y', statement: 'Agent law two.', checks: [] }],
      }),
    },
  })
  const first = ops.ratify({ root, ids: ['0011'], at: '2026-09-14T09:00:00Z' })
  ops.ratify({ root, ids: ['0011'], answer: answerWith(first.quiz, ['Approve']), quiz: first.quiz, at: '2026-09-14T09:00:00Z' })
  const specPath = join(root, 'docs', 'specs', 'api.spec.md')
  writeFileSync(specPath, `${readFileSync(specPath, 'utf8')}\nA human added this line.\n`)
  const second = ops.ratify({ root, ids: ['0013'], at: '2026-09-14T09:10:00Z' })
  const secondMinted = ops.ratify({ root, ids: ['0013'], answer: answerWith(second.quiz, ['Approve']), quiz: second.quiz, at: '2026-09-14T09:10:00Z' })
  assert.deepEqual(secondMinted.specsRegenerated, [], 'an edited document is not regenerated by the ratification')
  assert.deepEqual(secondMinted.specsSkipped, ['docs/specs/api.spec.md'], 'and the ratification says which document it left alone')
  assert.ok(
    readFileSync(specPath, 'utf8').includes('A human added this line.'),
    'the hand edit is still there, so the ratification did not destroy the evidence of it',
  )
  return ops.verify({ root }).then((verified) => {
    // The card is reported as the STALE kind — it is behind the laws and was also edited, and
    // the deterministic check can see the first — so it is advisory with a drafted withdrawal
    // note rather than a blocking problem. What a reader depends on is that it is REPORTED,
    // which is the claim here; the edit surviving is asserted above.
    assert.ok(
      verified.specDrift.stale.includes('docs/specs/api.spec.md'),
      `verify must still report the card it did not touch, got stale=${JSON.stringify(verified.specDrift.stale)}`,
    )
    assert.ok(
      verified.specDrift.notes.some((note) => note.path === 'docs/specs/api.spec.md' && typeof note.notePath === 'string'),
      'and it carries the drafted withdrawal note for that card',
    )
  })
})

test('ratify: a law card written by an ordinary compile --write is regenerated by the next ratification', () => {
  // The counterexample the real corpus produced: ADR 0056 was ratified and the mint recorded
  // `specsRegenerated: 0` while the law set had moved, so `ratchet compile --write` had to be
  // run by hand before the cards were in step. The cause was the ledger-based guard: it can
  // only call a card the ratchet's own if the ledger records its digest, and `compile --write`
  // (the writer that actually produced every existing card) recorded none. Every pre-existing
  // card was therefore treated as a person's and skipped. This fixture writes the card with an
  // ordinary `compile --write` BEFORE the ratification, which is exactly that state.
  const { root } = ratifiableProject('ratify-specs-preexisting', {
    laws: [{ id: 'api.x', statement: 'Agent law.', checks: [{ type: 'required_text', paths: ['src/api/x.ts'], pattern: 'handler' }] }],
    extraFiles: { 'src/api/x.ts': 'export const handler = () => 1\n' },
    extraAdrs: {
      '0001-base.adr.md': adrText({
        id: '0001',
        status: 'active',
        authority: 'human',
        zones: ['api'],
        laws: [{ id: 'api.base', statement: 'Base law.', checks: [{ type: 'required_text', paths: ['src/api/x.ts'], pattern: 'handler' }] }],
      }),
    },
  })
  const before = ops.compile({ root, write: true })
  assert.ok(before.ok, `the pre-ratification compile must be clean, got ${JSON.stringify(before.problems.map((entry) => entry.code))}`)
  const specPath = join(root, 'docs', 'specs', 'api.spec.md')
  assert.ok(readFileSync(specPath, 'utf8').includes('api.base'), 'the card exists and describes the law already in force')

  const prepared = ops.ratify({ root, ids: ['0011'], at: '2026-09-14T09:00:00Z' })
  const minted = ops.ratify({ root, ids: ['0011'], answer: answerWith(prepared.quiz, ['Approve']), quiz: prepared.quiz, at: '2026-09-14T09:00:00Z' })
  assert.deepEqual(minted.ratified, ['0011'])
  assert.deepEqual(minted.problems, [], `expected a clean ratification, got ${JSON.stringify(minted.problems.map((entry) => entry.code))}`)
  assert.deepEqual(
    minted.specsRegenerated,
    ['docs/specs/api.spec.md'],
    'the ratification regenerates the card a previous `compile --write` wrote, without the manual step',
  )
  assert.ok(readFileSync(specPath, 'utf8').includes('api.x'), 'the regenerated card names the law the consent put into force')

  // The documented sequence ratify -> regenerate -> verify completes in one operation.
  return ops.verify({ root }).then((verified) => {
    assert.deepEqual(verified.problems, [], `expected the gate green after a ratification, got ${JSON.stringify(verified.problems.map((entry) => entry.code))}`)
  })
})

test('ratify: a rejected answer writes nothing and leaves the record proposed', () => {  const { root } = ratifiableProject('ratify-reject')
  const prepared = ops.ratify({ root })
  const result = ops.ratify({ root, answer: answerWith(prepared.quiz, ['Reject']), quiz: prepared.quiz, at: '2026-09-14T09:00:00Z' })

  assert.deepEqual(result.ratified, [])
  assert.deepEqual(result.rejected, ['0011'])
  assert.deepEqual(result.wrote, [])
  assert.equal(readdirSync(join(root, 'docs', 'adrs')).filter((name) => name.endsWith('.adr.md')).length, 1)
  assert.deepEqual(compile(root).laws, [])
})

test('ratify: a human-authored proposed decision is offered a question, and the human\'s own approval puts it in force', () => {
  // The dead end this pins: a `status: proposed`, `authority: human` record rendered as
  // "not in force" with no action at all, because the queue skipped everything not
  // agent-authored. Authorship is not activation — only a recorded human consent is — so
  // the human-authored record is offered the SAME question as an agent's proposal, and
  // approving it writes the human's own approval and transcript. Reverting the queue to
  // skip non-agent records makes this test fail at the first assertion: the record is
  // neither queued nor actionable.
  const root = makeProject({
    name: 'human-authored-waiting',
    zones: [{ id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
    adrs: {
      '0001-human.adr.md': adrText({
        id: '0001',
        status: 'proposed',
        authority: 'human',
        zones: ['api'],
        laws: [{ id: 'api.human', statement: 'A human law.', checks: [] }],
      }),
      '0002-agent.adr.md': adrText({ id: '0002', status: 'proposed', authority: 'agent', zones: ['api'], laws: [] }),
    },
  })

  const queue = ops.ratifications(root)
  assert.deepEqual(
    queue.pending.map((entry) => entry.id).sort(),
    ['0001', '0002'],
    'both authors are waiting for the same human question',
  )
  assert.deepEqual(queue.blocked, [], 'neither is blocked')

  // The human-authored record is actionable: the ratchet builds its question.
  const prepared = ops.ratify({ root, ids: ['0001'] })
  assert.equal(prepared.needsAnswer, true, 'the registered human-authored proposal is put to the human')
  assert.deepEqual(prepared.quiz.questions.map((question) => question.id), ['ratify-0001'])

  const result = ops.ratify({
    root,
    ids: ['0001'],
    answer: answerWith(prepared.quiz, ['Approve']),
    quiz: prepared.quiz,
    askedBy: 'human-authored-test',
    at: '2026-09-16T00:00:00Z',
  })
  assert.deepEqual(result.ratified, ['0001'], `expected the record ratified, got ${JSON.stringify(result.problems.map((entry) => entry.code))}`)
  assert.equal(result.wrote.length, 2, 'the approval ADR and its transcript were written')
  assert.ok(existsSync(join(root, result.transcript.path)), 'the transcript cited by the approval exists')
  const approval = readFileSync(join(root, result.approval.path), 'utf8')
  assert.match(approval, /^type: approval$/m, 'the artifact is an approval ADR')
  assert.match(approval, /^  authority: human$/m, 'the approval is authored by the human, not the agent')
  assert.match(approval, /^  - "0001"$/m, 'the approval names the record it covers')

  const after = ops.ratifications(root)
  assert.deepEqual(after.pending.map((entry) => entry.id), ['0002'], 'the human record left the queue; the agent-authored one behaves exactly as before')
  assert.deepEqual(after.blocked, [])
  assert.ok(compile(root).laws.includes('api.human'), 'the human-authored record now contributes law')
})

// ---------------------------------------------------------------------------
// the tool adapter: a declared tool whose body was never executed
// ---------------------------------------------------------------------------

/** Applies the adapter against a fake context and returns the registered tools. */
function toolHarness({ ask = null } = {}) {
  const registered = new Map()
  const questions = ask === null ? undefined : { ask }
  tools.apply({
    effect: (fn) => fn(),
    on: () => () => {},
    get: (name) => (name === 'userQuestions' ? questions : undefined),
    tools: {
      register: (definition) => (registered.set(definition.name, definition), () => {}),
      guard: () => () => {},
      schemas: () => [],
    },
  })
  return registered
}

test('tool: ratchet_ingest_source runs, and ratify puts the new decision to the human in the same call', async () => {
  // A `proposeOnly` zone, because that is the only kind the ratchet can put to a human:
  // a `humanOnly` zone refuses an agent record even when ratified, so a fixture using
  // one would test the refusal rather than the consent.
  const root = makeProject({
    name: 'tool-ingest-ratify',
    zones: [{ id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
    adrs: {
      '0001-starter.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['api'],
        laws: [{ id: 'api.starter', statement: 'A starter law.', checks: [] }],
      }),
    },
  })
  const asked = []
  const registered = toolHarness({
    ask: async ({ questions }) => {
      asked.push(questions)
      return { answers: questions.map((question) => ({ id: question.id, selected: ['Approve'] })) }
    },
  })
  const tool = registered.get('ratchet_ingest_source')
  assert.ok(tool !== undefined, 'the ingest tool is registered')

  // The `ingest` argument supplies the judge's result, so this path needs no model.
  const result = await tool.execute(
    {
      source: SOURCE_PATH,
      write: true,
      ratify: true,
      ingest: fixtureIngestResult({
        zones: ['api'],
        laws: [{ id: 'api.session-storage.redis', statement: 'Session storage must use Redis.', checks: [] }],
      }),
    },
    { agent: { id: 'session-tool-ingest', session: { header: { cwd: root } } } },
  )

  assert.equal(result.ok, true, JSON.stringify(result.problems?.map((entry) => entry.code)))
  assert.equal(result.ratify?.attempted, undefined, 'the ratification ran rather than reporting nothing to ratify')
  assert.equal(asked.length, 1, 'the question reached the human channel, not the model')
  assert.deepEqual(result.ratified, [result.adr.id])
  assert.ok(
    readdirSync(join(root, 'docs', 'adrs')).some((name) => name.includes('ratify')),
    'an approval ADR was written for the ingested decision',
  )
})

test('tool: ingestion with ratify mints nothing when the record was not written', async () => {
  const root = await ingestProject('tool-ingest-fail-closed')
  const asked = []
  const registered = toolHarness({
    ask: async ({ questions }) => {
      asked.push(questions)
      return { answers: questions.map((question) => ({ id: question.id, selected: ['Approve'] })) }
    },
  })
  const tool = registered.get('ratchet_ingest_source')

  // No judge and no submitted result, so ingestion cannot produce a record to consent to.
  const result = await tool.execute(
    { source: SOURCE_PATH, write: true, ratify: true },
    { agent: { id: 'session-tool-ingest-2', session: { header: { cwd: root } } } },
  )

  assert.equal(result.ratify?.attempted, false, 'nothing was written, so nothing was put to the human')
  assert.equal(asked.length, 0, 'no question is asked when there is nothing to consent to')
  assert.equal(
    readdirSync(join(root, 'docs', 'adrs')).length,
    1,
    'only the starter record exists; the grill entry minted nothing',
  )
})

// ---------------------------------------------------------------------------
// the /ratify command: the same operation, reached without a model turn
// ---------------------------------------------------------------------------

/**
 * Applies the tool adapter against a fake cordis context and returns the command.
 *
 * The fake is deliberately minimal: the adapter must work with `tools.register`,
 * `tools.guard`, `effect` and `get`, and the test supplies exactly those, so the
 * command cannot come to depend on a service the fake does not model.
 *
 * @param ask - The question channel's `ask`, or `null` for a deployment without one.
 * @returns `{ command, commands }` — the registered `/ratify` definition, or undefined.
 */
function commandHarness({ ask = null } = {}) {
  const commands = []
  const questions = ask === null ? undefined : { ask }
  const ctx = {
    tools: { register: () => () => {}, guard: () => () => {} },
    effect: (fn) => fn(),
    get: (name) =>
      name === 'commands'
        ? {
            register: (definition) => {
              commands.push(definition)
              return () => {}
            },
          }
        : name === 'userQuestions'
          ? questions
          : undefined,
  }
  tools.apply(ctx)
  return { command: commands.find((entry) => entry.name === 'ratify'), commands }
}

/** One command invocation for a session rooted at `root`. */
function invocationFor(root, rawInput, id = 'session-command') {
  return { agent: { id, session: { header: { cwd: root } } }, rawInput }
}

test('command: /ratify puts the ratchet question to the human and mints the same consent', async () => {
  const { root } = ratifiableProject('command-approve')
  const asked = []
  const { command } = commandHarness({
    ask: async ({ agent, questions }) => {
      asked.push({ agent, questions })
      return { answers: questions.map((question) => ({ id: question.id, selected: ['Approve'] })) }
    },
  })
  assert.ok(command !== undefined, 'the /ratify command is registered')

  const result = await command.handler(invocationFor(root, '0011'))
  assert.equal(result.kind, 'success', result.text)
  assert.match(result.text, /Ratified 0011/u)
  assert.equal(asked.length, 1, 'the question reached the human channel, not the model')
  assert.deepEqual(compile(root).laws, ['api.x'])
})

test('command: a rejected /ratify answer writes nothing and reports the decision, not a failure', async () => {
  const { root } = ratifiableProject('command-reject')
  const { command } = commandHarness({
    ask: async ({ questions }) => ({
      answers: questions.map((question) => ({ id: question.id, selected: ['Reject'] })),
    }),
  })

  const result = await command.handler(invocationFor(root, '0011'))
  assert.equal(result.kind, 'success', result.text)
  assert.match(result.text, /Not ratified/u)
  assert.deepEqual(compile(root).laws, [], 'a rejection puts nothing into force')
})

test('command: /ratify without a question channel reports an error and mints nothing', async () => {
  const { root } = ratifiableProject('command-no-channel')
  const { command } = commandHarness({ ask: null })

  const result = await command.handler(invocationFor(root, '0011'))
  assert.equal(result.kind, 'error', result.text)
  assert.match(result.text, /Nothing was ratified/u)
  assert.deepEqual(compile(root).laws, [], 'a command that cannot ask must not mint')
})

test('command: /ratify refuses a decision a humanOnly zone reserves, without asking', async () => {
  const target = adrText({ id: '0011', status: 'proposed', authority: 'agent', zones: ['auth'], laws: [] })
  const root = makeProject({
    name: 'command-blocked',
    adrs: { '0011-agent.adr.md': target },
    zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' }],
  })
  const asked = []
  const { command } = commandHarness({
    ask: async ({ questions }) => {
      asked.push(questions)
      return { answers: questions.map((question) => ({ id: question.id, selected: ['Approve'] })) }
    },
  })

  const result = await command.handler(invocationFor(root, '0011'))
  assert.equal(result.kind, 'error', result.text)
  assert.equal(asked.length, 0, 'an impossible question is never put to a human')
  assert.deepEqual(compile(root).laws, [], 'consent cannot transfer authorship')
})

test('ratify: an unreadable answer mints nothing and returns a differently shaped re-ask', () => {
  const { root } = ratifiableProject('ratify-unreadable')
  const prepared = ops.ratify({ root })
  const result = ops.ratify({
    root,
    answer: { answers: [{ id: prepared.quiz.questions[0].id, selected: [], custom: 'yes-ish' }] },
    quiz: prepared.quiz,
    at: '2026-09-14T09:00:00Z',
  })

  assert.deepEqual(result.ratified, [])
  assert.deepEqual(result.wrote, [])
  assert.equal(result.unreadable.length, 1)
  assert.ok(result.problems.some((entry) => entry.code === 'RATIFICATION_UNPROVEN'), 'an unreadable answer is reported as unproven consent')
  assert.deepEqual(result.reask.questions[0].options.map((option) => option.label), ['Approve ADR 0011', 'Reject ADR 0011'])
  assert.equal(readdirSync(join(root, 'docs', 'adrs')).length, 1, 'nothing was written')

  const second = ops.ratify({
    root,
    answer: answerWith(result.reask, ['Approve ADR 0011']),
    quiz: result.reask,
    attempt: 2,
    previous: result.unreadable,
    at: '2026-09-14T09:05:00Z',
  })
  assert.deepEqual(second.ratified, ['0011'], 'the re-ask answer is the consent the first one failed to be')
  assert.deepEqual(second.problems, [], `expected a clean ratification, got ${JSON.stringify(second.problems.map((entry) => entry.code))}`)
})

test('ratify: the queue reports what waits for a human and what cannot be ratified at all', () => {
  const { root } = ratifiableProject('queue-pending')
  const queue = ops.ratifications(root)
  assert.deepEqual(queue.pending.map((entry) => entry.id), ['0011'])
  assert.match(queue.pending[0].contentHash, /^sha256:[0-9a-f]{64}$/)
  assert.deepEqual(queue.blocked, [])

  const target = adrText({ id: '0021', status: 'proposed', authority: 'agent', zones: ['auth'], laws: [] })
  const humanOnly = makeProject({
    name: 'queue-blocked',
    zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' }],
    adrs: { '0021-agent.adr.md': target },
  })
  const blocked = ops.ratifications(humanOnly)
  assert.deepEqual(blocked.pending, [])
  assert.equal(blocked.blocked.length, 1)
  assert.match(blocked.blocked[0].reason, /humanOnly/)

  // A blocked decision is not waiting for a consent, but it is still something only
  // a human can settle, so the ONE needs-a-human set reports it rather than hiding it
  // from the only place that tells a human what needs them.
  const view = decisionsModule.deriveDecisions({ root: humanOnly })
  const need = view.needsHuman.find((entry) => entry.kind === 'blocked')
  assert.ok(need, `expected a blocked need, got ${JSON.stringify(view.needsHuman.map((entry) => entry.kind))}`)
  assert.equal(need.id, '0021')
  assert.match(need.reason, /humanOnly/)
  assert.match(need.action, /consent cannot settle it/)
})

test('ratify: a proposed record that removes law in force is blocked, and a ratify attempt mints nothing', () => {
  // A proposed decision may work ahead of a ratification, but it may not take away what a
  // human already put in force. The one decidable form of that — a record that removes an
  // in-force law — is blocked rather than put to a human, and the block names the resolution
  // that would lift it. The guard refuses writes for the same fact through the same
  // `decidableContradictions`, so the two cannot disagree about one record.
  const root = makeProject({
    name: 'ratify-contradiction-remove',
    zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'proposeOnly', requiresDecisionRecord: false }],
    adrs: {
      '0001-holder.adr.md': adrText({
        id: '0001',
        authority: 'human',
        zones: ['tests'],
        laws: [{ id: 'tests.one', statement: 'One.', checks: [] }],
      }),
      '0002-remover.adr.md': adrText({
        id: '0002',
        status: 'proposed',
        authority: 'agent',
        zones: ['tests'],
        laws: [{ op: 'remove', id: 'tests.one' }],
      }),
    },
  })

  const queue = ops.ratifications(root)
  assert.deepEqual(queue.pending, [], 'a record that takes away law in force is not offered to a human')
  assert.deepEqual(queue.blocked.map((entry) => entry.id), ['0002'])
  const reason = queue.blocked[0].reason
  assert.match(reason, /contradicts law in force/, `reason must say what it is: ${reason}`)
  assert.match(reason, /"tests\.one"/, 'reason names the conflicting law')
  assert.match(reason, /ADR 0001/, 'reason names the record that holds it in force')
  assert.match(reason, /resolves:/, 'reason names the resolution shape')
  assert.match(reason, /op: remove/, 'reason names the op the resolution takes')
  assert.match(reason, /ratchet_deduplicate/, 'with no draft on disk, the reason points at the drafter')

  const before = readdirSync(join(root, 'docs', 'adrs')).length
  const attempt = ops.ratify({ root, ids: ['0002'] })
  assert.equal(attempt.ok, false, 'ratifying a blocked record is refused')
  assert.ok(
    attempt.problems.some((entry) => entry.code === 'ADR_FIELD_INVALID' && /contradicts law in force/.test(entry.message)),
    `the refusal repeats the block and its resolution: ${JSON.stringify(attempt.problems.map((entry) => entry.message))}`,
  )
  assert.equal(readdirSync(join(root, 'docs', 'adrs')).length, before, 'the blocked record mints nothing')
  assert.equal(ops.ratifications(root).pending.length, 0, 'and it is still not waiting')
})

test('ratify: the blocked reason names a drafted resolution when one exists', () => {
  // The reason must be actionable. A `resolves` record that the compiler's own
  // `validateResolutions` accepts is a RESOLUTION, so its `op: remove` is the fix rather than a
  // second contradiction: it is offered for ratification and named in the blocked record's
  // reason. A bogus `resolves` the compiler refuses buys no exemption, which the companion
  // test below pins.
  const root = makeProject({
    name: 'ratify-contradiction-draft',
    zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'proposeOnly', requiresDecisionRecord: false }],
    adrs: {
      '0001-holder.adr.md': adrText({
        id: '0001',
        authority: 'human',
        zones: ['tests'],
        laws: [{ id: 'tests.one', statement: 'One.', checks: [] }],
      }),
      '0002-rival.adr.md': adrText({
        id: '0002',
        status: 'proposed',
        authority: 'agent',
        zones: ['tests'],
        laws: [{ id: 'tests.one', statement: 'Different.', checks: [] }],
      }),
      '0003-draft.adr.md': adrText({
        id: '0003',
        status: 'proposed',
        authority: 'agent',
        zones: ['tests'],
        resolves: ['0001', '0002'],
        laws: [{ op: 'remove', id: 'tests.one' }],
      }),
    },
  })

  const queue = ops.ratifications(root)
  assert.deepEqual(queue.blocked.map((entry) => entry.id), ['0002'])
  assert.match(queue.blocked[0].reason, /contradicts law in force/)
  assert.match(queue.blocked[0].reason, /ADR 0003/, 'the reason names the drafted resolution')
  assert.deepEqual(queue.pending.map((entry) => entry.id), ['0003'], 'and the audited resolution is offered, not blocked')

  // A `resolves` list the compiler refuses is not an exemption: the record is still a removal of
  // law in force, and the block stands.
  const bogus = makeProject({
    name: 'ratify-contradiction-bogus-draft',
    zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'proposeOnly', requiresDecisionRecord: false }],
    adrs: {
      '0001-holder.adr.md': adrText({
        id: '0001',
        authority: 'human',
        zones: ['tests'],
        laws: [{ id: 'tests.one', statement: 'One.', checks: [] }],
      }),
      '0002-bogus.adr.md': adrText({
        id: '0002',
        status: 'proposed',
        authority: 'agent',
        zones: ['tests'],
        resolves: ['0001', '0099'],
        laws: [{ op: 'remove', id: 'tests.one' }],
      }),
    },
  })
  const bogusQueue = ops.ratifications(bogus)
  assert.deepEqual(bogusQueue.pending, [], 'a bogus resolves does not make the removal ratifiable')
  assert.deepEqual(bogusQueue.blocked.map((entry) => entry.id), ['0002'])
  assert.ok(
    compile(bogus).codes.includes('ADR_RESOLVES_DANGLING'),
    `the compiler refuses the bogus resolves: ${JSON.stringify(compile(bogus).codes)}`,
  )

  // A `resolves` list whose FORM the schema refuses — here three ids — is the same story even
  // when every id it names exists, so the audit's rejection is not only about dangling targets.
  const formBogus = makeProject({
    name: 'ratify-contradiction-form-bogus',
    zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'proposeOnly', requiresDecisionRecord: false }],
    adrs: {
      '0001-holder.adr.md': adrText({
        id: '0001',
        authority: 'human',
        zones: ['tests'],
        laws: [{ id: 'tests.one', statement: 'One.', checks: [] }],
      }),
      '0002-other.adr.md': adrText({
        id: '0002',
        authority: 'human',
        zones: ['tests'],
        laws: [{ id: 'tests.two', statement: 'Two.', checks: [] }],
      }),
      '0003-three.adr.md': adrText({
        id: '0003',
        status: 'proposed',
        authority: 'agent',
        zones: ['tests'],
        resolves: ['0001', '0002', '0003'],
        laws: [{ op: 'remove', id: 'tests.one' }],
      }),
    },
  })
  const formQueue = ops.ratifications(formBogus)
  assert.deepEqual(formQueue.pending, [], 'a three-sided resolves is not a resolution')
  assert.deepEqual(formQueue.blocked.map((entry) => entry.id), ['0003'])
  assert.ok(
    compile(formBogus).codes.includes('ADR_RESOLVES_INVALID'),
    `the schema refuses the three-sided resolves: ${JSON.stringify(compile(formBogus).codes)}`,
  )
})

test('ratify: a record that redeclares law in force is blocked until a resolution retires it', () => {
  // The end-to-end claim of §3.2: the block is real, the fix is a resolution that takes the
  // conflicting record out of force, and once it is in force the block lifts by itself and the
  // record ratifies. Superseding the holder is the shape that retires the law without the
  // process-order hazard a bare `op: remove` would leave behind.
  const root = makeProject({
    name: 'ratify-contradiction-resolution',
    zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'proposeOnly', requiresDecisionRecord: false }],
    adrs: {
      '0001-holder.adr.md': adrText({
        id: '0001',
        authority: 'human',
        zones: ['tests'],
        laws: [{ id: 'tests.one', statement: 'One.', checks: [] }],
      }),
      '0002-rival.adr.md': adrText({
        id: '0002',
        status: 'proposed',
        authority: 'agent',
        zones: ['tests'],
        laws: [{ id: 'tests.one', statement: 'Different.', checks: [] }],
      }),
      '0003-other.adr.md': adrText({
        id: '0003',
        authority: 'human',
        zones: ['tests'],
        laws: [{ id: 'tests.two', statement: 'Two.', checks: [] }],
      }),
    },
  })

  const blockedQueue = ops.ratifications(root)
  assert.deepEqual(blockedQueue.pending, [])
  assert.deepEqual(blockedQueue.blocked.map((entry) => entry.id), ['0002'])
  assert.match(blockedQueue.blocked[0].reason, /redeclares "tests\.one"/, blockedQueue.blocked[0].reason)
  assert.match(blockedQueue.blocked[0].reason, /ADR 0001/, 'the holder is named')

  // The resolution supersedes the holder. It is offered for ratification — a resolution is the
  // fix, not a second record that contradicts law in force — while the rival stays blocked.
  writeFileSync(
    join(root, 'docs', 'adrs', '0004-resolution.adr.md'),
    adrText({
      id: '0004',
      status: 'proposed',
      authority: 'agent',
      zones: ['tests'],
      supersedes: ['0001'],
      resolves: ['0001', '0003'],
      laws: [],
    }),
  )
  const withResolution = ops.ratifications(root)
  assert.deepEqual(withResolution.pending.map((entry) => entry.id), ['0004'], 'the resolution is offered, not blocked')
  assert.deepEqual(withResolution.blocked.map((entry) => entry.id), ['0002'], 'the rival stays blocked while it is only proposed')

  const prepared = ops.ratify({ root, ids: ['0004'] })
  const minted = ops.ratify({
    root,
    ids: ['0004'],
    answer: answerWith(prepared.quiz, ['Approve']),
    quiz: prepared.quiz,
    at: '2026-09-14T10:00:00Z',
  })
  assert.deepEqual(minted.ratified, ['0004'], `the resolution ratifies: ${JSON.stringify(minted.problems.map((entry) => entry.code))}`)

  // The retired holder has to say so; that is the retirement rule, not this one.
  const holderPath = join(root, 'docs', 'adrs', '0001-holder.adr.md')
  writeFileSync(holderPath, readFileSync(holderPath, 'utf8').replace(/^status: active$/m, 'status: superseded'))

  const lifted = ops.ratifications(root)
  assert.deepEqual(lifted.blocked, [], 'retiring the conflicting law lifts the block with no state to clear')
  assert.deepEqual(lifted.pending.map((entry) => entry.id), ['0002'])

  const after = ops.ratify({ root, ids: ['0002'] })
  const ratified = ops.ratify({
    root,
    ids: ['0002'],
    answer: answerWith(after.quiz, ['Approve']),
    quiz: after.quiz,
    at: '2026-09-14T11:00:00Z',
  })
  assert.deepEqual(ratified.ratified, ['0002'])
  const compiled = compile(root)
  assert.ok(compiled.laws.includes('tests.one'), 'the surviving decision now declares the law')
  assert.deepEqual(compiled.codes, [], `the corpus compiles clean, got ${JSON.stringify(compiled.codes)}`)
})

test('ratify: asking about an id that is not waiting is reported, not ignored', () => {
  const { root } = ratifiableProject('ratify-unknown-id')
  const result = ops.ratify({ root, ids: ['9999'] })
  assert.equal(result.ok, false)
  assert.equal(result.nothingToRatify, false)
  assert.ok(result.problems.some((entry) => entry.code === 'ADR_FIELD_INVALID'))
})

test('ratify: nothing to do is an answer, not an error', () => {
  const root = makeProject({
    name: 'ratify-nothing',
    adrs: { '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'a.one', statement: 'One.', checks: [] }] }) },
  })
  const result = ops.ratify({ root })
  assert.equal(result.ok, true)
  assert.equal(result.nothingToRatify, true)
  assert.match(result.message, /already in force/)
})

// ---------------------------------------------------------------------------
// the shell: it can say what is waiting, and it cannot mint
// ---------------------------------------------------------------------------

test('gate: the CLI lists what is waiting for a human and refuses to ratify for them', () => {
  const { root } = ratifiableProject('cli-pending')
  const pending = cli(['pending', '--root', root])
  assert.equal(pending.status, 0, `pending is a report, not a gate: ${pending.stderr}`)
  assert.match(pending.stdout, /ADR 0011/)
  assert.match(pending.stdout, /content hash: sha256:/)
  assert.match(pending.stdout, /cannot ratify/, 'the shell says plainly that it cannot ask the human')

  const attempt = cli(['ratify', '--root', root])
  assert.equal(attempt.status, 3, 'no shell command may mint a consent')
  assert.match(attempt.stderr, /unknown command/)
})

test('gate: pending lists a blocked decision with the reason it cannot be ratified', () => {
  const target = adrText({ id: '0021', status: 'proposed', authority: 'agent', zones: ['auth'], laws: [] })
  const root = makeProject({
    name: 'cli-blocked',
    zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' }],
    adrs: { '0021-agent.adr.md': target },
  })
  const pending = cli(['pending', '--root', root])
  assert.equal(pending.status, 0)
  assert.match(pending.stdout, /BLOCKED ADR 0021/)
  assert.match(pending.stdout, /humanOnly/)
})

test('gate: check is machine-readable without asking, and a job that never ran says so', () => {
  // Three surfaces that used to overstate what happened. `check` printed the human
  // report unless the caller also passed --json, so the CI command was the one command
  // a CI could not parse. A review job whose material was never supplied printed
  // `findings: 0`, which reads as "reviewed, nothing wrong" over a question that was
  // never asked. And `ingest` returned 0 on a project the other commands call unusable.
  const root = makeProject({
    name: 'cli-honesty',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [{ id: 'a.one', statement: 'One.', checks: [{ type: 'required_file', path: 'src/auth/a.ts' }] }],
      }),
    },
    files: { 'src/auth/a.ts': 'export const a = 1\n' },
  })

  const checked = cli(['check', '--root', root])
  assert.equal(checked.status, 0, checked.stderr)
  const parsed = JSON.parse(checked.stdout)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.counts.checksEvaluated, 1)
  assert.ok(!/^ratchet check:/m.test(checked.stdout), 'and nothing but the object is printed')

  const partial = cli(['check', '--root', root, '--no-commands'])
  assert.equal(partial.status, 0, 'a project whose only law is a filesystem check still passes with no runner')

  const unanswered = cli(['review', '--root', root, '--job', 'review_change'])
  assert.equal(unanswered.status, 0, 'a review is advisory, so it never changes the exit code')
  assert.match(unanswered.stdout, /NOT RUN/)
  assert.match(unanswered.stdout, /needs change/)
  assert.ok(!/findings: 0/.test(unanswered.stdout), 'and never reports a count for a question nobody asked')

  const empty = join(tmpdir(), `ratchet-cli-ingest-unusable-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(empty, { recursive: true, force: true })
  mkdirSync(empty, { recursive: true })
  const unusable = cli(['ingest', 'x.md', '--root', empty])
  assert.equal(unusable.status, 2, `an unusable project is exit 2, got ${unusable.status}: ${unusable.stdout}`)
})

// ---------------------------------------------------------------------------
// the breaker's findings, as regressions
//
// A breaker was given one claim вЂ” "no input makes the gate report the wrong verdict" вЂ”
// and falsified it nine times. Each of those inputs is a test here, named for the
// verdict it was about, so the same input cannot quietly work again.
// ---------------------------------------------------------------------------

test('BREAKER: a forbidden-text glob whose selection is empty is not a clean pass', async () => {
  // `paths: ['src/**', '!src/**']` selects nothing, so the check read no file вЂ” and
  // reported the law satisfied over a tree that contained the forbidden text. The
  // three sibling checks already refused this; the glob spelling of the family did not.
  const result = await lawCheck(
    'breaker-empty-glob-scope',
    { checks: [{ type: 'forbidden_text_glob', paths: ['src/**', '!src/**'], pattern: 'FORBIDDEN_MARKER' }] },
    { files: ['src/a.mjs'], contents: { 'src/a.mjs': 'FORBIDDEN_MARKER\n' } },
  )
  assert.deepEqual(result.problems.map((entry) => entry.code), ['CODE_TEXT_SCOPE_EMPTY'])
  assert.match(result.problems[0].message, /nothing was searched/)

  // The same law with a selection that works still finds the offender.
  const honest = await lawCheck(
    'breaker-empty-glob-scope-control',
    { checks: [{ type: 'forbidden_text_glob', paths: ['src/**'], pattern: 'FORBIDDEN_MARKER' }] },
    { files: ['src/a.mjs'], contents: { 'src/a.mjs': 'FORBIDDEN_MARKER\n' } },
  )
  assert.deepEqual(honest.problems.map((entry) => entry.code), ['CODE_TEXT_FORBIDDEN_PRESENT'])
})

test('BREAKER: a corpus nothing can check does not verify clean, and status agrees', async () => {
  // The all-`unenforced` corpus: no check declared anywhere, nothing pending, so the
  // verifier reported `ok: true` with `checksEvaluated: 0` вЂ” while `status` on the same
  // tree refused to call it verified. Two subsystems, one question, opposite answers.
  const root = makeProject({
    name: 'breaker-all-unenforced',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [{ id: 'auth.one', statement: 'One.', checks: [], unenforced: 'No tool decides whether a name reads well.' }],
      }),
    },
  })
  const verified = await ops.verify({ root })
  assert.equal(verified.ok, false, 'nothing was evaluated, so nothing is proven')
  assert.deepEqual(verified.problems.map((entry) => entry.code), ['VERIFY_NOTHING_EVALUATED'])
  assert.equal(verified.counts.checksDeclared, 0)
  assert.equal(verified.counts.checksPending, 0)
  assert.equal(cli(['verify', '--root', root]).status, 1, 'and the shell gate fails rather than passing')
  assert.equal(ops.status(root).verified.ran, false, 'and status says the same thing')
})

test('BREAKER: a module listed in a package manifest does not ship if it does not exist', async () => {
  // `check.path` was required by the schema and never read, so a law saying
  // "plugins/demo/b.mjs ships" was satisfied by a manifest naming a file that was not
  // in the tree вЂ” while the check's own failure message asserted that it was.
  const result = await lawCheck(
    'breaker-file-in-list-absent',
    {
      checks: [
        {
          type: 'required_file_in_list',
          path: 'plugins/demo/b.mjs',
          list: 'plugins/demo/package.json',
          keys: ['files'],
          contains: 'b.mjs',
        },
      ],
    },
    { files: ['plugins/demo/package.json'], contents: { 'plugins/demo/package.json': '{"files":["b.mjs"]}\n' } },
  )
  assert.deepEqual(result.problems.map((entry) => entry.code), ['CODE_REQUIRED_FILE_MISSING'])
  assert.match(result.problems[0].message, /does not exist in the repository/)

  const shipped = await lawCheck(
    'breaker-file-in-list-present',
    {
      checks: [
        {
          type: 'required_file_in_list',
          path: 'plugins/demo/b.mjs',
          list: 'plugins/demo/package.json',
          keys: ['files'],
          contains: 'b.mjs',
        },
      ],
    },
    {
      files: ['plugins/demo/b.mjs', 'plugins/demo/package.json'],
      contents: { 'plugins/demo/b.mjs': 'export const b = 1\n', 'plugins/demo/package.json': '{"files":["b.mjs"]}\n' },
    },
  )
  assert.deepEqual(shipped.problems, [], 'the file that does exist and is listed still passes')
})

test('BREAKER: a check that can never fail is refused where the decision is compiled', () => {
  // `deny: []` restricts nothing and was accepted, counted as evaluated, and passed
  // over any tree вЂ” strictly weaker than a deny that cannot overlap, which the verifier
  // reports. And an empty glob compiles to /^$/ and a `forbidden_glob` over it found no
  // offender while the forbidden file sat in the tree.
  const root = makeProject({
    name: 'breaker-checks-that-cannot-fail',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [
          { id: 'auth.boundary', statement: 'One.', checks: [{ type: 'path_boundary', zone: 'auth', deny: [] }] },
          { id: 'auth.glob', statement: 'Two.', checks: [{ type: 'forbidden_glob', pattern: '' }] },
        ],
      }),
    },
  })
  const compiled = compile(root)
  assert.equal(compiled.codes.filter((code) => code === 'ADR_FIELD_INVALID').length, 2, JSON.stringify(compiled.codes))
  assert.ok(
    compiled.problems.some((entry) => entry.message.includes('forbids the zone nothing')),
    'the empty deny names what it fails to restrict',
  )
})

test('BREAKER: command output assertions read each stream as written', async () => {
  // The default joined stdout and stderr with a newline. Two consequences, in opposite
  // directions: a pattern could match across the boundary between the streams (a
  // newline no single stream contains), and a `$`-anchored pattern that exactly matched
  // stdout failed because the joined string continued into stderr.
  const runner = async () => ({ code: 0, stdout: '# fail 0\n', stderr: 'noise\n', timedOut: false })
  const check = (fields) =>
    lawCheck('breaker-stream', { checks: [{ type: 'command', run: 'node x.mjs', ...fields }] }, { files: [], runCommand: runner })

  const anchored = await check({ outputMatches: '^# fail 0\n$' })
  assert.deepEqual(anchored.problems, [], 'an anchored pattern matches the stream it describes')

  const across = await check({ outputMatches: 'fail 0\\nnoise' })
  assert.deepEqual(
    across.problems.map((entry) => entry.code),
    ['CODE_COMMAND_OUTPUT_MISMATCH'],
    'no stream contains the boundary',
  )

  const negative = await check({ outputNotContains: 'noise' })
  assert.deepEqual(negative.problems.map((entry) => entry.code), ['CODE_COMMAND_OUTPUT_MISMATCH'], 'a negative assertion must hold in both streams')
  assert.match(negative.problems[0].message, /stderr contains/)

  const forbiddenOnStdout = await lawCheck(
    'breaker-stream-positive',
    { checks: [{ type: 'command', run: 'node x.mjs', outputContains: 'noise' }] },
    { files: [], runCommand: runner },
  )
  assert.deepEqual(forbiddenOnStdout.problems, [], 'a positive assertion holds when either stream carries it')
})

test('BREAKER: status stops reporting a verified project once the code changes', async () => {
  // The recorded verification bound the LAW hash and nothing else, so editing any file
  // left `status` reporting a verified, clean project while `verify` on the same tree
  // exited 1 вЂ” the CLI documents status as "exit 0 only when verified and clean".
  const root = makeProject({
    name: 'breaker-status-vs-code',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [{ id: 'auth.one', statement: 'One.', checks: [{ type: 'required_file', path: 'src/auth/a.ts' }] }],
      }),
    },
    files: { 'src/auth/a.ts': 'export const a = 1\n' },
  })

  const first = await ops.verify({ root })
  assert.equal(first.ok, true, 'the fixture starts clean')
  assert.equal(ops.status(root).verified.ran, true, 'and a complete evaluation of the current tree verifies')

  // The code changes; no law does.
  writeFileSync(join(root, 'src', 'auth', 'a.ts'), 'export const a = 2\n')
  const afterEdit = ops.status(root)
  assert.equal(afterEdit.verified.ran, false, 'a verdict is about a tree, so editing the tree invalidates it')
  assert.ok(afterEdit.problems.some((entry) => entry.code === 'VERIFY_NOT_RUN'))
  assert.equal(afterEdit.problems.find((entry) => entry.code === 'VERIFY_NOT_RUN').stale, true)

  // Re-verifying the new tree restores the verdict вЂ” and only the new tree.
  const second = await ops.verify({ root })
  assert.equal(second.ok, true)
  assert.notEqual(second.codeHash, first.codeHash, 'the two verdicts name different trees')
  assert.equal(ops.status(root).verified.ran, true)
})

test('BREAKER: verify and status compute ONE code hash on an unchanged tree, above the file cap', async () => {
  // The reported defect: `verify` recorded the tree as one hash and a later `status`
  // computed another, so `status` reported VERIFY_NOT_RUN with no edit in between. On a tree
  // larger than the code-hash file cap the two walked differently: the unbounded CLI walk
  // hashed the first `maxFiles` of a globally sorted list, while the budgeted in-process walk
  // stopped at the same count in `readdirSync` order and hashed a DIFFERENT subset. The code
  // hash is now computed over `codeHashFilesFor`, a deterministic, budget-independent list.
  const cap = schema.WORK_LIMITS.maxFiles
  const files = {}
  for (let index = 0; index <= cap; index += 1) {
    files[`src/data/f${String(index).padStart(5, '0')}.ts`] = `export const v = ${index}\n`
  }
  const root = makeProject({
    name: 'code-hash-one-identity',
    zones: [{ id: 'data', paths: ['src/data/**'], agentAuthority: 'activeIfNoConflict' }],
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['data'],
        laws: [{ id: 'data.one', statement: 'One.', checks: [{ type: 'required_file', path: 'src/data/f00000.ts' }] }],
      }),
    },
    files,
  })

  const unbounded = verifier.listFiles(root, '', null)
  assert.ok(unbounded.length > cap, `the fixture must exceed the cap: ${unbounded.length} vs ${cap}`)
  const hashFiles = verifier.codeHashFilesFor(root)
  assert.equal(hashFiles.length, cap, 'the code hash list is capped')
  assert.deepEqual(hashFiles, verifier.listFiles(root, '', schema.createWorkBudget()), 'the budgeted walk and the code-hash list select the same files')
  assert.deepEqual(verifier.codeHashFilesFor(root), hashFiles, 'and the selection is stable across calls')

  const inProcessVerify = await ops.verify({ root })
  assert.equal(inProcessVerify.ok, true, 'the fixture verifies clean')
  const cliStatus = ops.status(root)
  assert.equal(cliStatus.verified.ran, true, 'an unbudgeted status agrees with the verify that just ran')
  assert.equal(cliStatus.verified.last.codeHash, inProcessVerify.codeHash)
  assert.equal(
    cliStatus.verified.last.codeHash,
    verifier.codeHashFor(root, verifier.codeHashFilesFor(root), {}),
    'the recorded hash is exactly what the deterministic list computes',
  )

  const toolStatus = ops.status(root, { budget: schema.createWorkBudget() })
  assert.equal(toolStatus.verified.ran, true, 'a budgeted in-process status recomputes the SAME identity, so it reports verified rather than VERIFY_NOT_RUN')
  assert.equal(toolStatus.problems.some((entry) => entry.code === 'VERIFY_NOT_RUN'), false)

  const toolVerify = await ops.verify({ root, budget: schema.createWorkBudget() })
  assert.equal(toolVerify.stage, 'budget', 'the in-process verify fails closed above the budget and records no verdict')

  // A FRESH process too: the CLI recomputes the same hash from the same tree.
  const cli = spawnSync(process.execPath, [CLI, 'verify', '--root', root, '--json'], { encoding: 'utf8' })
  assert.equal(cli.status, 0, `the CLI verify exited ${cli.status}: ${cli.stderr}`)
  assert.equal(JSON.parse(cli.stdout).codeHash, inProcessVerify.codeHash, 'the CLI hashes the same tree to the same value')
  const freshStatus = spawnSync(process.execPath, [CLI, 'status', '--root', root, '--json'], { encoding: 'utf8' })
  assert.equal(freshStatus.status, 0, `the CLI status exited ${freshStatus.status}: ${freshStatus.stderr}`)
  assert.equal(JSON.parse(freshStatus.stdout).verified.ran, true, 'and a fresh status process agrees, with no edit between the runs')
})

// ---------------------------------------------------------------------------
// FALSIFICATION: a consent this ratchet cannot check is not a consent
// ---------------------------------------------------------------------------
test('FALSIFICATION: the ratchet_ratify tool has no argument that accepts a caller-composed answer', { skip: HARNESS_SKIP }, () => {
  // The claim under test: a consent can only come from an answer to a question this
  // ratchet asked. The first version of this tool took an `answers` object, which
  // made it an agent mint with extra steps вЂ” an agent could read the quiz it had just
  // been handed, type the approve label, and mint law. The tool must have no such
  // argument, and the operation must refuse an answer it cannot pair with a quiz.
  const definitions = mountPlugin({})
  const parameters = definitions.get('ratchet_ratify').parameters
  assert.deepEqual(
    Object.keys(parameters.properties ?? {}).sort(),
    ['ids', 'root'],
    'the arguments say WHICH records and WHICH project, and nothing else',
  )
  assert.equal(parameters.properties.answers, undefined, 'no argument may carry an answer')

  const { root } = ratifiableProject('falsify-unpaired-answer')
  const composed = { answers: [{ id: 'ratify-0011', selected: ['Approve'] }] }
  const result = ops.ratify({ root, answer: composed, at: '2026-09-14T09:00:00Z' })
  assert.equal(result.ok, false)
  assert.equal(result.unanswered, true)
  assert.equal(result.needsAnswer, true)
  assert.ok(
    result.problems.some((entry) => entry.code === 'RATIFICATION_UNPROVEN'),
    `expected RATIFICATION_UNPROVEN, got ${JSON.stringify(result.problems.map((entry) => entry.code))}`,
  )
  assert.equal(readdirSync(join(root, 'docs', 'adrs')).length, 1, 'nothing was written')
  assert.ok(result.quiz.questions.length === 1, 'and the caller is handed the quiz to ask instead')
})

test('FALSIFICATION: a record edited while the question is open is not ratified', () => {
  // The consent must cover the text the human was SHOWN. A record rewritten between
  // the question and the answer is refused rather than approved, because otherwise
  // the substitution happens by timing instead of by an edit.
  const { root } = ratifiableProject('falsify-open-question')
  const prepared = ops.ratify({ root })
  assert.equal(prepared.needsAnswer, true)

  const path = join(root, 'docs', 'adrs', '0011-agent.adr.md')
  const before = readFileSync(path, 'utf8')
  writeFileSync(path, before.replace('Agent law.', 'A law the human never read.'))

  const result = ops.ratify({
    root,
    answer: answerWith(prepared.quiz, ['Approve']),
    quiz: prepared.quiz,
    at: '2026-09-14T09:00:00Z',
  })

  assert.deepEqual(result.ratified, [], 'the answer was about a text that is no longer there')
  assert.equal(result.changed.length, 1)
  assert.ok(
    result.problems.some((entry) => entry.code === 'RATIFICATION_STALE'),
    `expected RATIFICATION_STALE, got ${JSON.stringify(result.problems.map((entry) => entry.code))}`,
  )
  assert.deepEqual(result.wrote, [])
  assert.equal(readdirSync(join(root, 'docs', 'adrs')).length, 1, 'no approval was written')
})

test('ratify: preparing a quiz reports no consent-shaped problem', () => {
  // The unpaired-answer guard's condition was `answer !== null || answer !==
  // undefined`, which is true for every value вЂ” so a call that supplied NOTHING was
  // told "an answer was supplied without the quiz it answers", and every
  // no-channel result carried a defect that never happened.
  const { root } = ratifiableProject('ratify-prepare-clean')
  const prepared = ops.ratify({ root })
  assert.equal(prepared.needsAnswer, true)
  assert.deepEqual(prepared.problems, [], 'preparing a question is not a problem')
  assert.deepEqual(prepared.summary.byCode, {})
})

test('ratify: the caller\'s presentation reaches the question and the re-ask', () => {
  // Where a question is answered is part of the question, and it is forwarded rather than
  // decided twice: the grill entry knows it is a conversation and asks for the harness's own
  // card, every other entry asks for the panel's. A re-ask shown somewhere else than the
  // question it repeats would make the human find the same decision in two places.
  const { root } = ratifiableProject('ratify-presentation')

  const panel = ops.ratify({ root })
  assert.equal(panel.needsAnswer, true)
  assert.equal(panel.quiz.questions[0].intent.kind, 'ratify-decision', 'the panel is the default')

  const chat = ops.ratify({ root, present: 'chat' })
  assert.equal(chat.needsAnswer, true)
  assert.equal(chat.quiz.questions[0].intent, undefined, 'the grill asks for the Conversation card')

  // Everything except the presentation is the same question, so the answer means the same
  // thing in either place.
  assert.deepEqual(chat.quiz.roles, panel.quiz.roles, 'the same labels mean the same decision')
  assert.deepEqual(chat.quiz.frozen, panel.quiz.frozen, 'and the same text is bound to a yes')

  const answeredChat = ops.ratify({ root, answer: answerWith(chat.quiz, []), quiz: chat.quiz, present: 'chat', at: '2026-09-14T09:00:00Z' })
  assert.ok(answeredChat.reask !== null && answeredChat.reask !== undefined, 'an unreadable answer is re-asked')
  assert.equal(answeredChat.reask.questions[0].intent, undefined, 'the re-ask is shown where the first question was')

  const answeredPanel = ops.ratify({ root, answer: answerWith(panel.quiz, []), quiz: panel.quiz, present: 'panel', at: '2026-09-14T09:00:00Z' })
  assert.ok(answeredPanel.reask !== null && answeredPanel.reask !== undefined)
  assert.equal(answeredPanel.reask.questions[0].intent.kind, 'ratify-decision', 'and the panel keeps its own presentation')

  // Neither unreadable answer minted anything.
  assert.deepEqual(answeredChat.ratified, [])
  assert.deepEqual(answeredPanel.ratified, [])

  // An unrecognised presentation is NOT the panel's: a value that does not say "panel" is one
  // no client may claim on the ratchet's behalf, so it falls back to the Conversation card.
  const elsewhere = ops.ratify({ root, present: 'somewhere-else' })
  assert.equal(elsewhere.quiz.questions[0].intent, undefined)
})

test('compiler: a record the zone refuses cannot retire the decision it supersedes', () => {
  // Supersession was decided from the raw consent, before the humanOnly refusal, so a
  // ratified agent record in a zone reserved to humans still retired the human
  // decision it named вЂ” emptying the bundle with only the refusal reported.
  const human = adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.old', statement: 'The old rule.', checks: [] }] })
  const replacement = adrText({
    id: '0002',
    status: 'proposed',
    authority: 'agent',
    zones: ['auth'],
    supersedes: ['0001'],
    laws: [{ id: 'auth.new', statement: 'The new rule.', checks: [] }],
  })
  const root = makeProject({
    name: 'refused-superseder',
    zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' }],
    adrs: {
      '0001-live.adr.md': human,
      '0002-replacement.adr.md': replacement,
      '0003-approve.adr.md': approvalText({ id: '0003', approved: [{ id: '0002', text: replacement }] }),
    },
  })
  const compiled = compiler.compileProject(root)
  assert.ok(compiled.problems.some((entry) => entry.code === 'ADR_AGENT_ACTIVE_IN_HUMAN_ONLY_ZONE'), 'the refusal is reported')
  assert.deepEqual(compiled.bundle.laws.map((law) => law.id), ['auth.old'], 'and the live decision stays in force')
})

test('compiler: a retired decision is neither queued for ratification nor put back into force', () => {
  // Every non-active record whose status was not `proposed` landed in `excluded`, so
  // withdrawn and rejected decisions were offered as waiting and a "yes" minted them
  // back into law.
  const root = makeProject({
    name: 'terminal-statuses',
    adrs: {
      '0001-withdrawn.adr.md': adrText({ id: '0001', status: 'withdrawn', authority: 'agent', zones: ['tests'], laws: [{ id: 'tests.a', statement: 'A.', checks: [] }] }),
      '0002-rejected.adr.md': adrText({ id: '0002', status: 'rejected', authority: 'agent', zones: ['tests'], laws: [{ id: 'tests.b', statement: 'B.', checks: [] }] }),
    },
  })
  const compiled = compiler.compileProject(root)
  assert.equal(compiled.report.counts.excluded, 0, 'a terminal status claims no force, so it is not excluded force')
  const queue = ops.ratifications(root)
  assert.deepEqual(queue.pending, [], 'and it is not waiting for a human')
  assert.deepEqual(queue.blocked, [])
  const attempt = ops.ratify({ root })
  assert.equal(attempt.nothingToRatify, true, 'asking to ratify finds nothing to ask about')
  assert.match(attempt.message, /already in force/)
})

test('gate: pending exits 2 on a corpus the other commands call unusable', () => {
  const empty = makeProject({ name: 'pending-unusable', adrs: {} })
  const pending = cli(['pending', '--root', empty])
  assert.equal(pending.status, ops.EXIT.CONFIG, 'no decisions directory is a configuration failure, not a clean queue')
  assert.equal(cli(['verify', '--root', empty]).status, ops.EXIT.CONFIG, 'and the gate agrees')
})

test('status: a failed verification of the current laws is reported, not hidden', async () => {
  // `status` said OK and exited 0 immediately before `verify` exited 1 on the same
  // tree: the failure was recorded in state.json and never surfaced.
  const root = makeProject({
    name: 'status-after-failure',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [{ id: 'a.one', statement: 'One.', checks: [{ type: 'required_file', path: 'src/auth/missing.ts' }] }],
      }),
    },
  })
  const verified = await ops.verify({ root })
  assert.equal(verified.ok, false, 'the fixture must fail verification')

  const reported = ops.status(root)
  assert.equal(reported.ok, false)
  assert.ok(
    reported.problems.some((entry) => entry.code === 'VERIFICATION_FAILED'),
    `expected VERIFICATION_FAILED, got ${JSON.stringify(reported.problems.map((entry) => entry.code))}`,
  )
  assert.equal(cli(['status', '--root', root]).status, 1, 'and the shell agrees with the gate')
})

test('schema: an escaped quote in a quoted scalar is unescaped, so the declared command runs', () => {
  // Keeping the backslashes verbatim sent `node -e \"вЂ¦\"` to the runner as an
  // argument containing quote characters: node evaluated a string literal, exited 0,
  // and the law was reported checked while its command never ran.
  const parsed = schema.parseFrontmatter(['---', 'run: "node -e \\"console.log(1)\\""', '---', ''].join('\n'))
  assert.equal(parsed.data.run, 'node -e "console.log(1)"')
  assert.deepEqual(ops.shellSplit(parsed.data.run), ['node', '-e', 'console.log(1)'])

  const root = makeProject({
    name: 'escaped-run',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [
          {
            id: 'a.one',
            statement: 'One.',
            checks: [{ type: 'command', run: 'node -e "console.log(1)"' }],
          },
        ],
      }),
    },
  })
  const compiled = compiler.compileProject(root)
  assert.equal(compiled.bundle.laws[0].checks[0].run, 'node -e "console.log(1)"')
})

test('ratify: the transcript records the hash the question offered, and the asker is named once', () => {  const { root } = ratifiableProject('ratify-transcript')
  const prepared = ops.ratify({ root })
  const offered = prepared.quiz.frozen[0].contentHash
  const result = ops.ratify({
    root,
    answer: answerWith(prepared.quiz, ['Approve']),
    quiz: prepared.quiz,
    askedBy: 'session-abc123',
    at: '2026-09-14T09:00:00Z',
  })
  assert.deepEqual(result.problems, [])
  const transcript = readFileSync(join(root, result.transcript.path), 'utf8')
  assert.ok(transcript.includes(offered), 'the transcript names the hash the human was shown')
  const approval = readFileSync(join(root, result.approval.path), 'utf8')
  assert.ok(
    approval.includes('askedBy: session-abc123'),
    'an id that already carries the session prefix is not prefixed twice',
  )
})

// ---------------------------------------------------------------------------
// The breaker: `falsify` is project-agnostic and restores everything it breaks
// ---------------------------------------------------------------------------

/** A fixture whose only law is a required_file check over a file that exists. */
function falsifiableProject(name, { zones = undefined, requiredFile = 'src/auth/keep.ts' } = {}) {
  return makeProject({
    name,
    zones,
    adrs: {
      '0001-keep-the-file.adr.md': adrText({
        id: '0001',
        title: 'Keep the file',
        laws: [
          {
            id: 'auth.keep-the-file',
            statement: 'The keep file must exist.',
            checks: [{ type: 'required_file', path: requiredFile }],
          },
        ],
      }),
    },
    files: { [requiredFile]: 'export const keep = 1\n' },
  })
}

/** Reads every file under a root into a Map, for a byte-for-byte comparison. */
function snapshotTree(root) {
  const map = new Map()
  for (const relative of verifier.listFiles(root)) map.set(relative, readFileSync(join(root, relative)))
  return map
}

test('falsify: a breakable case is DETECTED on a fixture project', async () => {
  const root = falsifiableProject('falsify-detected')
  const result = await falsifyModule.falsify({ root })
  const required = result.cases.find((entry) => entry.id === 'required-file-missing')
  assert.equal(required.status, 'detected', 'removing a required file must make the gate report it')
  assert.equal(required.expectedCode, 'CODE_REQUIRED_FILE_MISSING')
  assert.ok(required.observedCodes.includes('CODE_REQUIRED_FILE_MISSING'))
  assert.equal(result.ok, true, `unexpected non-detected cases: ${JSON.stringify(result.cases)}`)
})

test('falsify: a case whose check cannot fail is reported MISSED, never silently green', async () => {
  const root = falsifiableProject('falsify-missed')
  // A verifier that reports nothing stands in for a gate that fails to detect the
  // mutation. If falsify called that a pass it would be the very failure it exists
  // to catch, so the case must come back `missed` and the overall run must not be ok.
  const result = await falsifyModule.falsify({ root, verifyImpl: async () => ({ ok: true, problems: [] }) })
  const required = result.cases.find((entry) => entry.id === 'required-file-missing')
  assert.equal(required.status, 'missed')
  assert.equal(result.ok, false, 'a missed case is not a pass')
  assert.ok(result.counts.missed >= 1)
})

test('falsify: a case whose expected problem already exists is SKIPPED, never called detected', async () => {
  // `detected` asserts the MUTATION caused the problem. `LAW_UNCHECKED` is a
  // verification problem, not a compile one, so a corpus that already declares an
  // unchecked law still compiles and the case would otherwise run and report
  // `detected` for a problem it did not create.
  const root = falsifiableProject('falsify-baseline')
  writeFileSync(
    join(root, 'docs', 'adrs', '0002-already-unchecked.adr.md'),
    adrText({
      id: '0002',
      title: 'Already unchecked',
      laws: [{ id: 'auth.already-unchecked', statement: 'No check and no stated reason.', checks: [] }],
    }),
  )
  const result = await falsifyModule.falsify({ root })
  const unchecked = result.cases.find((entry) => entry.id === 'law-with-no-check')
  assert.equal(unchecked.status, 'skipped')
  assert.match(unchecked.detail, /already declares a law with no check/)
  assert.ok(
    !result.cases.some((entry) => entry.id === 'law-with-no-check' && entry.status === 'detected'),
    'a problem present before the mutation is not a detection',
  )
})

test('falsify: a law whose target lies outside its declared zone never reaches the breaker', async () => {
  // This used to exercise the breaker's out-of-scope branch with a law targeting a path
  // the declared scopes did not cover. ADR 0012 made that law impossible to declare: the
  // compiler refuses a positive target outside the record's own zones, so the branch is
  // no longer reachable from a law's target and the property that must hold instead is
  // that the corpus is refused before the breaker runs and nothing is written. The
  // branch keeps its coverage through the symlink-containment case below, which reaches
  // `assertWritable` the way a law no longer can.
  const root = falsifiableProject('falsify-out-of-scope', {
    zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly', requiresDecisionRecord: true }],
    requiredFile: 'outside/keep.ts',
  })
  const before = readFileSync(join(root, 'outside/keep.ts'))
  assert.ok(
    compiler.compileProject(root).problems.some((entry) => entry.code === 'LAW_PATH_OUTSIDE_DECLARED_ZONE'),
    'the compiler must refuse the law before the breaker is handed it',
  )
  const result = await falsifyModule.falsify({ root })
  assert.equal(result.ok, false)
  assert.equal(result.unusable, true)
  assert.equal(result.cases.length, 0, 'an unusable corpus claims no cases')
  assert.ok(
    readFileSync(join(root, 'outside/keep.ts')).equals(before),
    'an out-of-scope target must be byte-identical after the run',
  )
})
test('falsify: a full run restores every mutated file and the persisted state', async () => {
  const root = falsifiableProject('falsify-restores')
  const before = snapshotTree(root)
  assert.equal(existsSync(join(root, '.dsh', 'ratchet', 'state.json')), false, 'fixture starts unverified')

  const result = await falsifyModule.falsify({ root })
  assert.ok(result.counts.detected >= 1, 'the fixture has at least one breakable case')

  const after = snapshotTree(root)
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), 'the file set changed')
  for (const [relative, bytes] of before) {
    assert.ok(bytes.equals(after.get(relative)), `${relative} was not restored byte-for-byte`)
  }
  assert.equal(existsSync(join(root, '.dsh', 'ratchet', 'state.json')), false, 'state.json must be restored')
  assert.equal(existsSync(join(root, '.dsh', 'ratchet', 'ledger.jsonl')), false, 'the ledger must be restored')
})

test('falsify: a project with no manifest is unusable, not a green run', async () => {
  const root = join(tmpdir(), `ratchet-test-falsify-unusable-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  const result = await falsifyModule.falsify({ root })
  assert.equal(result.unusable, true)
  assert.equal(result.ok, false)
  assert.equal(result.cases.length, 0)
  assert.equal(result.problems[0].code, 'MANIFEST_MISSING')
})

test('falsify: SIGTERM mid-run restores the in-flight mutation and the persisted state', {
  // Windows has no catchable SIGTERM: `child.kill('SIGTERM')` terminates the process
  // through the OS, so the handler cannot run and the mutation survives until recovery.
  // The claim is a POSIX one, and the cross-platform answer — journal plus
  // `falsify --recover` — has its own test below, which runs everywhere.
  skip:
    process.platform === 'win32'
      ? 'Windows does not deliver a catchable SIGTERM; the journal + falsify --recover path covers it (see the SIGKILL recovery test)'
      : false,
}, async () => {
  // `finally` does not run on an unhandled signal, so a killed run used to leave the
  // 9001 ADR behind and the ledger modified. The command check sleeps, which keeps the
  // run inside a mutated case long enough for the signal to land; the mutation file is
  // awaited rather than timed, so the test never races a finished run.
  const root = makeProject({
    name: 'falsify-signal',
    adrs: {
      '0001-slow-gate.adr.md': adrText({
        id: '0001',
        title: 'Slow gate',
        laws: [
          {
            id: 'auth.slow-gate',
            statement: 'The keep file must exist, and the check is slow.',
            checks: [
              { type: 'required_file', path: 'src/auth/keep.ts' },
              { type: 'command', run: 'node -e "setTimeout(()=>{}, 30000)"', timeoutMs: 60000 },
            ],
          },
        ],
      }),
    },
    files: { 'src/auth/keep.ts': 'export const keep = 1\n' },
  })
  const before = snapshotTree(root)
  const adrDir = join(root, 'docs', 'adrs')
  const child = spawn(process.execPath, [CLI, 'falsify', '--root', root], { stdio: 'ignore' })

  let mutated = false
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    // Case 1 (the approval ADR) fails at the compile stage, so it finishes before the
    // slow command runs. Case 2 adds an active law with no check, which compiles, so its
    // `9002` record is the mutation held in flight by the sleeping command check.
    if (existsSync(adrDir) && readdirSync(adrDir).some((name) => /^900\d-/.test(name))) {
      mutated = true
      break
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  assert.ok(mutated, 'the run never reached a mutation, so the test would race a finished run')

  child.kill('SIGTERM')
  const exit = await new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  assert.ok(
    exit.code === 143 || exit.signal === 'SIGTERM',
    `the child was not terminated by the signal: ${JSON.stringify(exit)}`,
  )

  const after = snapshotTree(root)
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), 'the file set changed')
  for (const [relative, bytes] of before) {
    assert.ok(bytes.equals(after.get(relative)), `${relative} was not restored after the signal`)
  }
  assert.ok(
    !readdirSync(adrDir).some((name) => name.startsWith('900')),
    'a falsification ADR was left behind by the killed run',
  )
  assert.equal(existsSync(join(root, '.dsh', 'ratchet', 'state.json')), false, 'state.json must be restored')
  assert.equal(existsSync(join(root, '.dsh', 'ratchet', 'ledger.jsonl')), false, 'the ledger must be restored')
})

test('falsify: a symlinked directory inside a scope cannot move a write outside the root', async (t) => {
  const outside = join(tmpdir(), `ratchet-falsify-outside-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(outside, { recursive: true, force: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'evil.ts'), 'export const evil = 1\n')

  const root = makeProject({
    name: 'falsify-symlink',
    adrs: {
      '0001-forbid.adr.md': adrText({
        id: '0001',
        title: 'Forbid the file',
        laws: [
          {
            id: 'auth.forbid-evil',
            statement: 'The evil file must not exist.',
            checks: [{ type: 'forbidden_file', path: 'src/auth/outside-link/evil.ts' }],
          },
        ],
      }),
    },
  })
  mkdirSync(join(root, 'src', 'auth'), { recursive: true })
  try {
    symlinkSync(outside, join(root, 'src', 'auth', 'outside-link'), 'dir')
  } catch (error) {
    t.skip(`symlinks are unavailable on this platform: ${String(error)}`)
    return
  }
  const before = readFileSync(join(outside, 'evil.ts'))
  const result = await falsifyModule.falsify({ root })
  const forbidden = result.cases.find((entry) => entry.id === 'forbidden-file-present')
  assert.equal(forbidden.status, 'out-of-scope', JSON.stringify(forbidden))
  assert.ok(
    readFileSync(join(outside, 'evil.ts')).equals(before),
    'a target behind a symlink must never be written',
  )
})

test('falsify --recover restores a stale journal and removes its residue', () => {
  // Models a hard-killed run: a mutated file, a journal naming it, a backup of the
  // original, and the temporary sibling an interrupted atomic write would leave.
  const root = falsifiableProject('falsify-recover')
  const stateDir = join(root, '.dsh', 'ratchet')
  const target = 'docs/adrs/0001-keep-the-file.adr.md'
  const original = readFileSync(join(root, target))
  mkdirSync(join(stateDir, 'falsify-backups'), { recursive: true })
  writeFileSync(join(stateDir, 'falsify-backups', '1.bin'), original)
  writeFileSync(join(root, target), 'MUTATED BY A KILLED RUN\n')
  writeFileSync(`${join(root, target)}.falsify-tmp`, 'torn write\n')
  writeFileSync(
    join(stateDir, 'falsify-journal.json'),
    `${JSON.stringify({ version: 1, root, files: [{ path: target, existed: true, backup: 'falsify-backups/1.bin' }] }, null, 2)}\n`,
  )

  const result = falsifyModule.recover({ root })
  assert.equal(result.ok, true)
  assert.deepEqual(result.recovered, [target])
  assert.ok(readFileSync(join(root, target)).equals(original), 'the original bytes must be back')
  assert.equal(existsSync(join(stateDir, 'falsify-journal.json')), false, 'the journal must be gone')
  assert.equal(existsSync(join(stateDir, 'falsify-backups')), false, 'the backups must be gone')
  assert.equal(existsSync(`${join(root, target)}.falsify-tmp`), false, 'no torn-write residue may remain')
})

test('falsify: a SIGKILLed run leaves a journal, and the next recover repairs the tree', async () => {
  const root = makeProject({
    name: 'falsify-sigkill',
    adrs: {
      '0001-slow-gate.adr.md': adrText({
        id: '0001',
        title: 'Slow gate',
        laws: [
          {
            id: 'auth.slow-gate',
            statement: 'The keep file must exist, and the check is slow.',
            checks: [
              { type: 'required_file', path: 'src/auth/keep.ts' },
              { type: 'command', run: 'node -e "setTimeout(()=>{}, 30000)"', timeoutMs: 60000 },
            ],
          },
        ],
      }),
    },
    files: { 'src/auth/keep.ts': 'export const keep = 1\n' },
  })
  const before = snapshotTree(root)
  const adrDir = join(root, 'docs', 'adrs')
  const child = spawn(process.execPath, [CLI, 'falsify', '--root', root], { stdio: 'ignore' })

  const deadline = Date.now() + 30_000
  let mutated = false
  while (Date.now() < deadline) {
    if (existsSync(adrDir) && readdirSync(adrDir).some((name) => /^900\d-/.test(name))) {
      mutated = true
      break
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  assert.ok(mutated, 'the run never reached a mutation, so the test would race a finished run')

  child.kill('SIGKILL')
  const exit = await new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })))
  assert.ok(exit.signal === 'SIGKILL' || exit.code === null, `expected a hard kill: ${JSON.stringify(exit)}`)

  const journal = join(root, '.dsh', 'ratchet', 'falsify-journal.json')
  assert.ok(existsSync(journal), 'the hard-killed run must leave a journal to recover from')

  const recovered = falsifyModule.recover({ root })
  assert.ok(recovered.recovered.length >= 1, 'recovery must name what it repaired')

  const after = snapshotTree(root)
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), 'the file set changed after recovery')
  for (const [relative, bytes] of before) {
    assert.ok(bytes.equals(after.get(relative)), `${relative} was not restored from the journal`)
  }
  assert.equal(existsSync(journal), false, 'the journal must be gone after recovery')
  assert.deepEqual(
    verifier.listFiles(root).filter((path) => path.endsWith('.falsify-tmp')),
    [],
    'no atomic-write residue may remain',
  )
})

test('CLI: falsify --recover repairs a stale journal and exits 0', () => {
  const root = falsifiableProject('falsify-recover-cli')
  const stateDir = join(root, '.dsh', 'ratchet')
  const target = 'docs/adrs/0001-keep-the-file.adr.md'
  const original = readFileSync(join(root, target))
  mkdirSync(join(stateDir, 'falsify-backups'), { recursive: true })
  writeFileSync(join(stateDir, 'falsify-backups', '1.bin'), original)
  writeFileSync(join(root, target), 'MUTATED\n')
  writeFileSync(
    join(stateDir, 'falsify-journal.json'),
    `${JSON.stringify({ version: 1, root, files: [{ path: target, existed: true, backup: 'falsify-backups/1.bin' }] }, null, 2)}\n`,
  )
  const run = spawnSync(process.execPath, [CLI, 'falsify', '--root', root, '--recover'], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.ok(run.stdout.includes('restored'), `expected a recovery report, got: ${run.stdout}`)
  assert.ok(readFileSync(join(root, target)).equals(original))
  assert.equal(existsSync(join(stateDir, 'falsify-journal.json')), false)
})

test('falsify --recover leaves an unreadable journal and its backups in place', () => {
  // A journal that cannot be parsed names no paths. Deleting it and its backups would
  // destroy the only copy of the originals, so recovery must refuse to clean up and
  // leave both for a human — a warning, not silent data loss.
  const root = falsifiableProject('falsify-recover-corrupt')
  const stateDir = join(root, '.dsh', 'ratchet')
  mkdirSync(join(stateDir, 'falsify-backups'), { recursive: true })
  writeFileSync(join(stateDir, 'falsify-backups', '1.bin'), 'ORIGINAL')
  writeFileSync(join(stateDir, 'falsify-journal.json'), '{ this is not json')
  const result = falsifyModule.recover({ root })
  assert.ok(
    result.warnings.some((warning) => warning.includes('could not be read')),
    JSON.stringify(result.warnings),
  )
  assert.ok(existsSync(join(stateDir, 'falsify-journal.json')), 'the journal must be left for inspection')
  assert.ok(
    existsSync(join(stateDir, 'falsify-backups', '1.bin')),
    'the backups must be left for inspection',
  )
})

test('falsify --recover repairs without a readable manifest', () => {
  // Recovery must not depend on the manifest: a project a hard-killed run left broken
  // may also have a broken manifest, and refusing to recover would strand the damage.
  const root = falsifiableProject('falsify-recover-nomanifest')
  const stateDir = join(root, '.dsh', 'ratchet')
  const target = 'docs/adrs/0001-keep-the-file.adr.md'
  const original = readFileSync(join(root, target))
  mkdirSync(join(stateDir, 'falsify-backups'), { recursive: true })
  writeFileSync(join(stateDir, 'falsify-backups', '1.bin'), original)
  writeFileSync(join(root, target), 'MUTATED\n')
  writeFileSync(
    join(stateDir, 'falsify-journal.json'),
    JSON.stringify({ version: 1, root, files: [{ path: target, existed: true, backup: 'falsify-backups/1.bin' }] }),
  )
  writeFileSync(join(root, '.dsh', 'project.json'), '{ broken manifest')
  const result = falsifyModule.recover({ root })
  assert.equal(result.unusable, undefined, `recovery must not need a manifest: ${JSON.stringify(result)}`)
  assert.ok(readFileSync(join(root, target)).equals(original), 'the original must be restored')
  assert.equal(existsSync(join(stateDir, 'falsify-journal.json')), false, 'the journal is gone after recovery')
})

test('verifier: an identical command runs once per verification, not once per law', async () => {
  // Fourteen laws in this kit name the same test suite. Running it per law made one
  // verify take ~2 minutes for one answer. Within a verification the tree does not
  // change, so the same command has the same result and re-running it proves nothing
  // new — but every law still counts its own check as evaluated.
  const root = makeProject({ name: 'command-dedupe', adrs: {} })
  let calls = 0
  const bundle = {
    version: 1,
    project: 'command-dedupe',
    laws: ['a', 'b', 'c'].map((suffix) => ({
      id: `x.${suffix}`,
      statement: 'S.',
      sourceAdr: '0001',
      checks: [
        { type: 'command', run: 'node suite.mjs', expects: 'the suite passes' },
        { type: 'command', run: 'node other.mjs', expects: 'the other command passes' },
      ],
      zones: [],
      authority: 'human',
      approvedBy: null,
    })),
  }
  const result = await verifier.verifyProject({
    root,
    bundle,
    config: { zones: [] },
    runCommand: async () => {
      calls += 1
      return { code: 0, stdout: 'ok', stderr: '', timedOut: false }
    },
  })
  assert.equal(result.ok, true, JSON.stringify(result.problems))
  assert.equal(result.report.counts.checksEvaluated, 6, 'every law still evaluates both of its checks')
  assert.equal(calls, 2, 'two distinct commands must run twice, not once per law')
})

test('schema: zoneFor and the compiler decide membership with one predicate', () => {
  // They were two implementations — a directory-prefix test in `zoneFor` and a different prefix
  // test in `pathIsGoverned` — and they disagreed in both directions: a zone declaring a bare
  // directory governed a write in the guard and was invisible to the compiler's authority check,
  // while a zone with a wildcard mid-path was governed by the guard and refused by the compiler.
  // A zone the manifest accepts must mean the same thing everywhere, so this drives both through
  // the same table.
  const cases = [
    ['src/auth/**', 'src/auth/x.ts', true],
    ['src/auth/**', 'src/auth', true],
    ['src/auth/**', 'src/authdeep/x.ts', false],
    ['src/auth', 'src/auth/x.ts', true],
    ['src/auth', 'src/auth', true],
    ['src/auth', 'src/authdeep/x.ts', false],
    ['src/auth/*', 'src/auth/x.ts', true],
    ['src/auth/*', 'src/auth/deep/x.ts', false],
    ['**/auth/**', 'src/deep/auth/x.ts', true],
    ['**/auth/**', 'src/deep/other/x.ts', false],
    ['src/au?h/**', 'src/auth/x.ts', true],
    ['src/au?h/**', 'src/auuuh/x.ts', false],
    ['**', 'anything/at/all.ts', true],
    ['*', 'anything/deep.ts', true],
  ]
  for (const [zonePath, file, expected] of cases) {
    const byZone = schema.zoneFor(file, [{ id: 'z', paths: [zonePath], agentAuthority: 'proposeOnly' }]) !== null
    const byCompiler = compiler.pathIsGoverned(file, [zonePath])
    assert.equal(byZone, byCompiler, `zoneFor and pathIsGoverned disagree for ${JSON.stringify(zonePath)} vs ${file}`)
    assert.equal(byZone, expected, `${JSON.stringify(zonePath)} should ${expected ? '' : 'not '}cover ${file}`)
  }
})

test('dynamic: a clean independent verdict retires a recorded contradiction', async () => {
  // The block has to be clearable by the loop it prescribes: change the change, review it again.
  // Only an INDEPENDENT verdict clears — see the self-review case below.
  const root = reviewableProject('dyn-clear')
  const judgeSaying = (verdict) => async () => ({ structured: verdict, output: '', stopReason: 'completed' })
  const blocking = {
    ok: false,
    findings: [{ severity: 'error', kind: 'semantic_violation', lawId: 'auth.session-storage.redis', lawQuote: 'Session storage must use Redis.', explanation: 'a file-backed adapter contradicts the Redis decision' }],
  }
  const first = await ops.review({ root, job: 'review_change', change: 'the same change', spawnJudge: judgeSaying(blocking) })
  assert.equal(first.declined, true)
  assert.equal(Object.keys(contradictionModule.readContradictions(root)).length, 1)

  const second = await ops.review({ root, job: 'review_change', change: 'the same change', spawnJudge: judgeSaying({ ok: true, findings: [] }) })
  assert.equal(second.declined, false)
  assert.equal(
    Object.keys(contradictionModule.readContradictions(root)).length,
    0,
    'an independent clean verdict on the same material retires the block',
  )
})

test('dynamic: a verdict with nothing blocking does not record anything', async () => {
  // Only the kinds that mean "this contradicts a decision in meaning" block. A note, a record whose
  // prose disagrees with its own laws, or an ask for more reasoning must not refuse work nobody has
  // shown to be wrong.
  const root = reviewableProject('dyn-nonblocking')
  const advisory = {
    ok: true,
    findings: [
      { severity: 'warning', kind: 'semantic_violation', lawId: 'auth.session-storage.redis', lawQuote: 'Session storage must use Redis.', explanation: 'a warning is not a block' },
      { severity: 'error', kind: 'prose_law_mismatch', lawId: 'auth.session-storage.redis', lawQuote: 'Session storage must use Redis.', explanation: 'the record disagreeing with itself is not this change contradicting law' },
      { severity: 'error', kind: 'insufficient_reasoning', explanation: 'no law named' },
      { severity: 'error', kind: 'semantic_violation', lawId: 'no.such.law', explanation: 'a law nobody declares cannot place a block' },
    ],
  }
  const result = await ops.review({
    root,
    job: 'review_change',
    change: 'a change',
    spawnJudge: async () => ({ structured: advisory, output: '', stopReason: 'completed' }),
  })
  assert.equal(result.declined, false)
  assert.equal(Object.keys(contradictionModule.readContradictions(root)).length, 0)
})

test('dynamic: a self-review may raise a block but may not clear one', () => {
  // An agent that could lift its own block by submitting the verdict it wrote itself would have a
  // gate it controls. It may still REPORT a contradiction it sees in its own work.
  const root = reviewableProject('dyn-self-block')
  const blocking = {
    ok: false,
    findings: [{ severity: 'error', kind: 'intent_violation', lawId: 'auth.session-storage.redis', lawQuote: 'Session storage must use Redis.', explanation: 'inverts the decision' }],
  }
  const raised = ops.submitReview({ root, job: 'review_change', change: 'a change', verdict: blocking })
  assert.equal(raised.declined, true)
  assert.equal(Object.keys(contradictionModule.readContradictions(root)).length, 1, 'a self-review may raise a block')

  // ...and a clean self-review of the same material leaves it standing.
  const cleared = ops.submitReview({ root, job: 'review_change', change: 'a change', verdict: { ok: true, findings: [] } })
  assert.equal(cleared.declined, false)
  assert.equal(
    Object.keys(contradictionModule.readContradictions(root)).length,
    1,
    'but it may not clear one, or the gate would answer to the agent it gates',
  )
})

test('dynamic: a self-review that names nothing records a block a later review can retire', () => {
  // A block has to be bound to something whose change can retire it. Unnamed material is bound to
  // the REVIEW JOB, which is the stream the agent is iterating, so the next independent review of
  // that job clears it — unlike a material-hash binding, which the prescribed loop could never
  // retire because changing the text writes a different key.
  const root = reviewableProject('dyn-self-untargeted')
  const blocking = {
    ok: false,
    findings: [{ severity: 'error', kind: 'intent_violation', lawId: 'auth.session-storage.redis', lawQuote: 'Session storage must use Redis.', explanation: 'inverts the decision' }],
  }
  const result = ops.submitReview({ root, job: 'review_change', verdict: blocking })
  assert.equal(result.declined, true, 'the finding is reported')
  assert.equal(result.advisory, false, 'a self-review that reports a contradiction is a gate too')
  assert.equal(typeof result.nextStep, 'string', 'and it names the route out')
  assert.deepEqual(Object.keys(contradictionModule.readContradictions(root)), ['review:review_change'])
})

test('dynamic: an independent clean review retires a job-scoped block', async () => {
  // The prescribed loop: the review declines, the agent changes the change, the review runs again.
  // If the block were keyed on the material hash, the second review would write a different key and
  // the first block would stand for ever — a refusal nobody can obey their way out of.
  const root = reviewableProject('dyn-job-clear')
  const judgeSaying = (verdict) => async () => ({ structured: verdict, output: '', stopReason: 'completed' })
  const blocking = {
    ok: false,
    findings: [{ severity: 'error', kind: 'semantic_violation', lawId: 'auth.session-storage.redis', lawQuote: 'Session storage must use Redis.', explanation: 'contradicts' }],
  }
  const first = await ops.review({ root, job: 'review_change', change: 'the first change', spawnJudge: judgeSaying(blocking) })
  assert.equal(first.declined, true)
  assert.deepEqual(Object.keys(contradictionModule.readContradictions(root)), ['review:review_change'])

  const second = await ops.review({ root, job: 'review_change', change: 'the changed change', spawnJudge: judgeSaying({ ok: true, findings: [] }) })
  assert.equal(second.declined, false)
  assert.deepEqual(
    Object.keys(contradictionModule.readContradictions(root)),
    [],
    'reviewing the CHANGED material retires the block, which is what the refusal asked for',
  )
})

test('dynamic: a finding against a PROPOSED record binds to that record and retires when it changes', async () => {
  // The match is by content hash, because a corpus record carries the hash of its file text and not
  // the text itself. Matching a `text` field was dead code, so every block became a material one.
  const root = reviewableProject('dyn-proposal-binding')
  const manifest = compiler.readManifest(root)
  const corpus = compiler.readAdrCorpus(root, manifest.config)
  const judged = corpus.records.find((record) => record.id === '0009')
  assert.ok(judged !== undefined, 'the fixture proposes 0009')
  const fileText = readFileSync(join(root, 'docs', 'adrs', '0009-proposed.adr.md'), 'utf8')
  assert.equal(schema.hashSource(fileText), judged.contentHash, 'the record hash is the hash of its own file text')

  const result = await ops.review({
    root,
    job: 'review_proposal',
    proposal: fileText,
    source: SOURCE_TEXT,
    spawnJudge: async () => ({
      structured: {
        ok: false,
        findings: [{ severity: 'error', kind: 'semantic_violation', lawId: 'auth.session-storage.redis', sourceAdr: '0001', lawQuote: 'Session storage must use Redis.', explanation: 'contradicts' }],
      },
      output: '',
      stopReason: 'completed',
    }),
  })
  assert.equal(result.declined, true)
  assert.deepEqual(
    Object.keys(contradictionModule.readContradictions(root)),
    ['proposal:0009'],
    'bound to the RECORD, so the block follows that record rather than the material',
  )
})

test('compiler: a generated spec goes where the manifest says, not to a hardcoded default', async () => {
  // `renderSpecs` hardcoded `docs/specs` while every READER — `tracksSpecDocuments`,
  // `detectSpecDrift`, the guard — resolved `config.specsDir`. A project that declared any other
  // directory therefore had its compile write to one place, its verify look in another, and NO WAY
  // TO BECOME GREEN: verify reported the document missing and prescribed a compile, and the compile
  // wrote to the same wrong directory again. The kit never saw it because its own `specsDir` is the
  // default. Found by driving the ratchet against a foreign project with its own layout.
  const root = makeProject({
    name: 'custom-specs-dir',
    extraManifest: { specsDir: 'generated-specs' },
    files: { 'src/auth/session.ts': 'x\n' },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [{ id: 'auth.x', statement: 'X holds.', checks: [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'x' }] }],
      }),
    },
  })

  const compile = ops.compile({ root, write: true })
  assert.equal(compile.ok, true, JSON.stringify(compile.problems?.map((entry) => entry.code)))
  assert.ok(existsSync(join(root, 'generated-specs', 'auth.spec.md')), 'the document is where the manifest says')
  assert.equal(existsSync(join(root, 'docs', 'specs')), false, 'and nothing was written to the default')

  const verified = await ops.verify({ root })
  assert.equal(
    verified.ok,
    true,
    `a project with its own specs directory must verify green: ${JSON.stringify(verified.problems?.map((entry) => entry.code))}`,
  )
})

test('schema: a directory field the writers do not honour is refused, not accepted and ignored', () => {
  // `reportsDir` and `stateDir` were parsed, validated and stored, and the state/report paths are
  // frozen constants no writer rebased — so a project declaring either got its artifacts somewhere
  // other than the manifest said, while the guard and the breaker resolved the DECLARED directory
  // and disagreed with the writers about where state lives. A path field is honoured or refused,
  // never accepted and ignored.
  for (const [field, value] of [
    ['stateDir', 'var/ratch'],
    ['reportsDir', 'out/reports'],
  ]) {
    const root = makeProject({ name: `unhonoured-${field}`, extraManifest: { [field]: value } })
    const manifest = compiler.readManifest(root)
    assert.ok(
      manifest.problems.some((entry) => entry.code === 'MANIFEST_INVALID' && entry.message.includes(field)),
      `${field} = ${value} must be refused while no writer honours it`,
    )
  }
  // ...and the values the writers actually use are accepted, so the refusal is not a blanket ban.
  const ok = makeProject({
    name: 'honoured-dir-defaults',
    extraManifest: { stateDir: '.dsh/ratchet', reportsDir: 'reports/ratchet' },
  })
  assert.equal(compiler.readManifest(ok).problems.length, 0, 'the defaults the writers use are fine')
})

test('schema: a directory field cannot escape the project root', () => {
  // `specsDir: "../escaped-out/specs"` compiled green and wrote generated documents OUTSIDE the
  // project, because the one directory field nobody containment-checked was the one that escaped.
  for (const [field, value] of [
    ['specsDir', '../escaped-out/specs'],
    ['decisionsDir', '/etc/decisions'],
    ['sourcesDir', 'a/../../b'],
  ]) {
    const root = makeProject({ name: `escape-${field}`, extraManifest: { [field]: value } })
    const manifest = compiler.readManifest(root)
    assert.ok(
      manifest.problems.some((entry) => entry.code === 'MANIFEST_INVALID' && entry.message.includes(field)),
      `${field} = ${value} must be refused`,
    )
  }
})

// ---------------------------------------------------------------------------
// Regression pins for the just-landed fixes: consent durability, zone identity
// and overlap, a law bound to several zones, the quiz shape, and ledger authority
// ---------------------------------------------------------------------------

test('compiler: an agent supersession may not retire a human-authored or human-ratified decision', () => {
  // Counterexample: one `supersedes:` line in an agent-authored active record retired a
  // human's decision AND a decision a human had ratified, because supersession was decided
  // before the authority rule — the same act an `op: remove` refuses. The bundle emptied
  // with no problem naming the cause, so a consent was un-minted by a file an agent writes.
  const ratifiedTarget = adrText({
    id: '0011',
    status: 'proposed',
    authority: 'agent',
    zones: ['api'],
    laws: [{ id: 'api.x', statement: 'Agent law.', checks: [] }],
  })
  const zones = [
    { id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' },
    { id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' },
    { id: 'tests', paths: ['tests/**'], agentAuthority: 'activeIfNoConflict' },
  ]
  const refused = makeProject({
    name: 'supersede-consent-refused',
    zones,
    adrs: {
      '0001-human.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.human', statement: 'Human law.', checks: [] }] }),
      '0011-agent.adr.md': ratifiedTarget,
      '0012-approve.adr.md': approvalText({ id: '0012', approved: [{ id: '0011', text: ratifiedTarget }] }),
      '0021-agent-supersede-human.adr.md': adrText({
        id: '0021',
        status: 'active',
        authority: 'agent',
        zones: ['tests'],
        supersedes: ['0001'],
        laws: [{ id: 'tests.a', statement: 'Replacement one.', checks: [] }],
      }),
      '0022-agent-supersede-ratified.adr.md': adrText({
        id: '0022',
        status: 'active',
        authority: 'agent',
        zones: ['tests'],
        supersedes: ['0011'],
        laws: [{ id: 'tests.b', statement: 'Replacement two.', checks: [] }],
      }),
    },
  })
  const blocked = compile(refused)
  const unauthorised = blocked.problems.filter((entry) => entry.code === 'LAW_REMOVE_UNAUTHORISED')
  assert.equal(unauthorised.length, 2, `each protected target must be reported, got ${JSON.stringify(blocked.codes)}`)
  assert.ok(blocked.laws.includes('auth.human'), 'the human-authored decision stays in force')
  assert.ok(blocked.laws.includes('api.x'), 'and so does the one a human ratified')

  // Control: a human-authored superseder retires the human target.
  const byHuman = makeProject({
    name: 'supersede-consent-human',
    zones,
    adrs: {
      '0001-human.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.human', statement: 'Human law.', checks: [] }] }),
      '0031-human-supersede.adr.md': adrText({
        id: '0031',
        status: 'active',
        authority: 'human',
        zones: ['tests'],
        supersedes: ['0001'],
        laws: [{ id: 'tests.c', statement: 'Human replacement.', checks: [] }],
      }),
    },
  })
  const humanResult = compile(byHuman)
  assert.ok(!humanResult.laws.includes('auth.human'), 'a human may retire a human decision')
  assert.ok(humanResult.laws.includes('tests.c'))

  // Control: a human-RATIFIED superseder retires the human target too.
  const ratifiedSuperseder = adrText({
    id: '0041',
    status: 'proposed',
    authority: 'agent',
    zones: ['api'],
    supersedes: ['0001'],
    laws: [{ id: 'api.y', statement: 'Ratified replacement.', checks: [] }],
  })
  const byRatified = makeProject({
    name: 'supersede-consent-ratified',
    zones,
    adrs: {
      '0001-human.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.human', statement: 'Human law.', checks: [] }] }),
      '0041-agent-supersede.adr.md': ratifiedSuperseder,
      '0042-approve.adr.md': approvalText({ id: '0042', approved: [{ id: '0041', text: ratifiedSuperseder }] }),
    },
  })
  const ratifiedResult = compile(byRatified)
  assert.ok(!ratifiedResult.laws.includes('auth.human'), 'a human consent authorises the supersession it ratifies')
  assert.ok(ratifiedResult.laws.includes('api.y'))
})

test('schema: a zone id outside [A-Za-z0-9_-] is ZONE_INVALID because it names a spec file', () => {
  // Counterexample: `auth.v1` and `auth-v1` both slug to `auth-v1.spec.md`, so one generated
  // spec file silently replaced the other and a zone's laws vanished from it. Every accepted id
  // equals its own slug now, and `auth.v1` is refused rather than compiled to a colliding file.
  const dotted = makeProject({
    name: 'zone-dotted-id',
    zones: [{ id: 'auth.v1', paths: ['src/auth/**'], agentAuthority: 'humanOnly' }],
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth.v1'], laws: [{ id: 'auth.x', statement: 'X.', checks: [] }] }),
    },
  })
  const dottedResult = compile(dotted)
  assert.ok(
    dottedResult.codes.includes('ZONE_INVALID'),
    `a dotted zone id must be refused, got ${JSON.stringify(dottedResult.codes)}`,
  )

  // Control: the slug it would have collided with is accepted.
  const dashed = makeProject({
    name: 'zone-dashed-id',
    zones: [{ id: 'auth-v1', paths: ['src/auth/**'], agentAuthority: 'humanOnly' }],
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth-v1'], laws: [{ id: 'auth.x', statement: 'X.', checks: [] }] }),
    },
  })
  const dashedResult = compile(dashed)
  assert.ok(!dashedResult.codes.includes('ZONE_INVALID'), `auth-v1 is accepted, got ${JSON.stringify(dashedResult.codes)}`)
  assert.deepEqual(dashedResult.laws, ['auth.x'])
})

test('compiler: zone overlap detection sees a whole-repo ** and a mid-path wildcard', () => {
  // Counterexample: the old prefix comparison reduced `**` to `**` and `src/auth/**` to
  // `src/auth`, neither a prefix of the other — and `src/**` versus `**/auth/**` likewise —
  // so two zones with different authority overlapped and the manifest parsed clean.
  const overlapping = [
    { name: 'zone-overlap-whole', paths: [['**'], ['src/auth/**']] },
    { name: 'zone-overlap-mid', paths: [['src/**'], ['**/auth/**']] },
  ]
  for (const { name, paths } of overlapping) {
    const root = makeProject({
      name,
      zones: [
        { id: 'a', paths: paths[0], agentAuthority: 'proposeOnly' },
        { id: 'b', paths: paths[1], agentAuthority: 'humanOnly' },
      ],
      adrs: { '0001-a.adr.md': adrText({ id: '0001', zones: ['a'], laws: [{ id: 'a.x', statement: 'X.', checks: [] }] }) },
    })
    assert.ok(
      compile(root).codes.includes('ZONE_OVERLAP'),
      `${name}: ${JSON.stringify(paths)} must be reported as an overlap`,
    )
  }

  // Control: genuinely disjoint paths report nothing.
  const disjoint = makeProject({
    name: 'zone-disjoint',
    zones: [
      { id: 'a', paths: ['src/a/**'], agentAuthority: 'proposeOnly' },
      { id: 'b', paths: ['lib/b/**'], agentAuthority: 'humanOnly' },
    ],
    adrs: { '0001-a.adr.md': adrText({ id: '0001', zones: ['a'], laws: [{ id: 'a.x', statement: 'X.', checks: [] }] }) },
  })
  assert.ok(
    !compile(disjoint).codes.includes('ZONE_OVERLAP'),
    'src/a/** and lib/b/** cannot cover a common path',
  )
})

test('schema: a zone path with a trailing slash governs its subtree', async () => {
  // Counterexample: `src/auth/` fell through the no-wildcard branch as the literal string
  // `src/auth/`, which matched neither `src/auth` nor `src/auth/x.ts`, so the zone governed
  // NOTHING while the manifest parsed clean — and a law whose target was there compiled anyway.
  assert.equal(schema.zonePathCovers('src/auth/', 'src/auth/x.ts'), true, 'the slash is decoration')

  const root = makeProject({
    name: 'zone-trailing-slash',
    zones: [{ id: 'auth', paths: ['src/auth/'], agentAuthority: 'humanOnly', requiresDecisionRecord: true }],
    files: { 'src/auth/x.ts': 'redis\n' },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [
          {
            id: 'auth.redis',
            statement: 'Use redis.',
            checks: [{ type: 'required_text', paths: ['src/auth/x.ts'], pattern: 'redis' }],
          },
        ],
      }),
    },
  })
  const manifestRead = compiler.readManifest(root)
  assert.deepEqual(manifestRead.problems, [], 'the trailing slash is a legal zone path')
  assert.equal(schema.zoneFor('src/auth/x.ts', manifestRead.config.zones)?.id, 'auth', 'the file is placed in the zone')

  const compiled = compiler.compileProject(root)
  assert.equal(
    compiled.ok,
    true,
    `the law's target there must be covered: ${JSON.stringify(compiled.problems.map((entry) => entry.code))}`,
  )
  const verified = await verifier.verifyProject({
    root,
    bundle: compiled.bundle,
    config: manifestRead.config,
    manifest: manifestRead.config,
    runCommand: null,
  })
  assert.deepEqual(verified.problems, [], `the target must verify: ${JSON.stringify(verified.problems.map((entry) => entry.code))}`)
})

test('compiler: a law declared by two active records in two zones is ONE law bound to both', () => {
  // Counterexample: only the first record's zones survived the merge, so a contradicted law
  // in force in two zones blocked only one of them — a write in the second went through while
  // the law's own statement claimed to govern both.
  const root = makeProject({
    name: 'law-bound-to-two-zones',
    zones: [
      { id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' },
      { id: 'api', paths: ['src/api/**'], agentAuthority: 'humanOnly' },
    ],
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'shared.law', statement: 'One rule.', checks: [] }] }),
      '0002-b.adr.md': adrText({ id: '0002', zones: ['api'], laws: [{ id: 'shared.law', statement: 'One rule.', checks: [] }] }),
    },
  })
  const compiled = compiler.compileProject(root)
  assert.equal(compiled.ok, true, `codes=${JSON.stringify(compiled.problems.map((entry) => entry.code))}`)
  const law = compiled.bundle.laws.find((entry) => entry.id === 'shared.law')
  assert.ok(law !== undefined, 'the shared law is compiled once')
  assert.deepEqual([...law.zones].sort(), ['api', 'auth'], 'the merge unions the zones both records named')

  const zones = contradictionModule.blockedZones(
    [{ entry: { findings: [{ severity: 'error', kind: 'semantic_violation', lawId: 'shared.law', explanation: 'x' }] } }],
    { active: [], proposed: [], laws: compiled.bundle.laws },
  )
  assert.deepEqual([...zones].sort(), ['api', 'auth'], 'a finding against it blocks BOTH zones, not the first declarer')
})

test('ratify: a caller-composed quiz is refused, while an answer to the real quiz is read as stale', () => {
  // Counterexample: `ratify` accepted any object with a `roles` map and a `frozen` entry whose
  // content hash was null skipped the stale check, so a caller-composed quiz with an empty
  // frozen list minted a real approval with no question ever asked. The supplied quiz must now
  // match the one this ratchet builds — its targets, its labels, and a frozen hash per record.
  // The complete composition FIRST (`questions: []`), so a revert that removed only the shape
  // check reaches the WRITE — it mints an approval — instead of crashing later while rendering
  // the transcript of a quiz that has none. It must mint nothing, and no approval file may appear.
  const complete = ratifiableProject('foreign-quiz-complete')
  const refusedComplete = ops.ratify({
    root: complete.root,
    answer: { answers: [{ id: 'ratify-0011', selected: ['Approve'] }] },
    quiz: {
      attempt: 1,
      questions: [],
      roles: { 'ratify-0011': { adrId: '0011', approveLabel: 'Approve', rejectLabel: 'Reject' } },
      frozen: [],
    },
    at: '2026-09-14T09:00:00Z',
  })
  assert.equal(refusedComplete.ok, false, 'a complete caller-composed quiz mints nothing either')
  assert.ok(
    refusedComplete.problems.some((entry) => entry.code === 'RATIFICATION_UNPROVEN'),
    `expected RATIFICATION_UNPROVEN for the complete quiz, got ${JSON.stringify(refusedComplete.problems.map((entry) => entry.code))}`,
  )
  assert.equal(readdirSync(join(complete.root, 'docs', 'adrs')).length, 1, 'and no approval file was written')

  // And the exact composition the finding was reproduced with, which lacks `questions` entirely.
  const composed = ratifiableProject('foreign-quiz')
  const refused = ops.ratify({
    root: composed.root,
    answer: { answers: [{ id: 'ratify-0011', selected: ['Approve'] }] },
    quiz: { roles: { 'ratify-0011': { adrId: '0011', approveLabel: 'Approve', rejectLabel: 'Reject' } }, frozen: [] },
    at: '2026-09-14T09:00:00Z',
  })
  assert.equal(refused.ok, false, 'a question the ratchet never built mints nothing')
  assert.ok(
    refused.problems.some((entry) => entry.code === 'RATIFICATION_UNPROVEN'),
    `expected RATIFICATION_UNPROVEN, got ${JSON.stringify(refused.problems.map((entry) => entry.code))}`,
  )
  assert.equal(readdirSync(join(composed.root, 'docs', 'adrs')).length, 1, 'no approval file was written')

  // Control A: the quiz buildQuiz produces does mint, and the law enters force.
  const genuine = ratifiableProject('genuine-quiz')
  const prepared = ops.ratify({ root: genuine.root })
  const minted = ops.ratify({
    root: genuine.root,
    answer: answerWith(prepared.quiz, ['Approve']),
    quiz: prepared.quiz,
    at: '2026-09-14T09:00:00Z',
  })
  assert.deepEqual(minted.ratified, ['0011'], `the real quiz mints, got ${JSON.stringify(minted.problems.map((entry) => entry.code))}`)
  assert.deepEqual(compile(genuine.root).laws, ['api.x'], 'and the law is in force')

  // Control B: the record edited while the question was open, answered with the ORIGINAL quiz,
  // is answered by the STALE check — not by the foreign-quiz shape check.
  const edited = ratifiableProject('stale-not-foreign')
  const open = ops.ratify({ root: edited.root })
  const path = join(edited.root, 'docs', 'adrs', '0011-agent.adr.md')
  writeFileSync(path, readFileSync(path, 'utf8').replace('Agent law.', 'A law the human never read.'))
  const stale = ops.ratify({
    root: edited.root,
    answer: answerWith(open.quiz, ['Approve']),
    quiz: open.quiz,
    at: '2026-09-14T09:00:00Z',
  })
  assert.ok(
    stale.problems.some((entry) => entry.code === 'RATIFICATION_STALE'),
    `expected RATIFICATION_STALE, got ${JSON.stringify(stale.problems.map((entry) => entry.code))}`,
  )
  assert.ok(
    !stale.problems.some((entry) => entry.code === 'RATIFICATION_UNPROVEN'),
    'the original quiz is this ratchet\'s own question, so the stale check answers, not the shape check',
  )
})

test('state: verificationStatus reads the append-only ledger, not the editable state cache', async () => {
  // Counterexample: `state.json` is mutable, and a hand-edit of `lastVerify` made `status`
  // report a verified-clean project while `verify` on the same tree exited 1. The ledger is
  // append-only, so its `ratchet.verify.finish` event is the authority; the cache is the
  // fallback only for a history that predates the event.
  const root = makeProject({
    name: 'verify-ledger-authority',
    files: { 'src/auth/session.ts': 'redis\n' },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [
          {
            id: 'a.one',
            statement: 'One.',
            checks: [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis' }],
          },
        ],
      }),
    },
  })
  const verified = await ops.verify({ root })
  assert.equal(verified.ok, true, `codes=${JSON.stringify(verified.problems.map((entry) => entry.code))}`)
  const finish = state.readLedger(root).events.filter((event) => event.event === 'ratchet.verify.finish').at(-1)
  assert.ok(finish !== undefined, 'the run recorded a verify.finish event')

  // Hand-edit the cache to claim a different, false verdict.
  const cachePath = join(root, state.STATE_PATHS.state)
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
  cache.lastVerify = { ...cache.lastVerify, specHash: `sha256:${'0'.repeat(64)}`, checksEvaluated: 0, ok: false }
  writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`)

  const after = ops.status(root)
  assert.equal(after.verified.ran, true, 'the ledger verdict is the authority, not the edited cache')
  assert.equal(after.verified.last.specHash, finish.specHash, 'and the reported verdict is the one the ledger recorded')
  assert.notEqual(after.verified.last.specHash, cache.lastVerify.specHash, 'the false hash in the cache is ignored')
})

// ---------------------------------------------------------------------------
// the decision lifecycle: resolves, retirement, duplicates and batch extraction
// ---------------------------------------------------------------------------

const DUPLICATE_COMMAND = join(resolve(import.meta.dirname, '..'), 'scripts', 'check-duplicate-decisions.mjs')

/** Runs the deterministic duplicate command and returns its exit code and streams. */
function duplicateCommand(root) {
  const run = spawnSync(process.execPath, [DUPLICATE_COMMAND, '--root', root], { encoding: 'utf8' })
  return { status: run.status, stdout: `${run.stdout ?? ''}${run.stderr ?? ''}` }
}

/** A second reasoning document, for fixtures whose records must cite different sources. */
const OTHER_SOURCE_PATH = 'docs/ratchet/sources/2026-09-12-api-shape.md'
const OTHER_SOURCE_TEXT = [
  '# Design session: API shape',
  '',
  'We agreed the version is carried in the path rather than a header because a path',
  'is visible in every access log and a header is not.',
  '',
].join('\n')

/** A project with two conflicting decisions in one agent-activated zone. */
function resolutionProject(name, { resolution, firstStatus = 'active' } = {}) {
  return makeProject({
    name,
    zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }],
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        status: firstStatus,
        authority: 'agent',
        zones: ['tests'],
        laws: [{ id: 'tests.one', statement: 'One.', checks: [] }],
      }),
      '0002-b.adr.md': adrText({
        id: '0002',
        status: 'active',
        authority: 'agent',
        zones: ['tests'],
        laws: [{ id: 'tests.two', statement: 'Two.', checks: [] }],
      }),
      '0003-resolution.adr.md': adrText({
        id: '0003',
        status: 'active',
        authority: 'agent',
        zones: ['tests'],
        supersedes: ['0001'],
        resolves: ['0001', '0002'],
        laws: [{ id: 'tests.three', statement: 'Three.', checks: [] }],
      }),
      ...(resolution === undefined ? {} : { '0004-extra.adr.md': resolution }),
    },
  })
}

test('resolves: the field carries exactly two distinct ADR ids, or is refused', () => {
  const good = schema.parseAdr({
    filename: '0003-r.adr.md',
    source: adrText({ id: '0003', resolves: ['0001', '0002'] }),
  })
  assert.deepEqual(good.problems.map((entry) => entry.code), [])
  assert.deepEqual(good.record.resolves, ['0001', '0002'])

  // One side only: the conflict the record claims to have settled cannot be audited, which
  // is the whole reason the field exists.
  const oneSided = schema.parseAdr({
    filename: '0003-r.adr.md',
    source: adrText({ id: '0003', resolves: ['0001'] }),
  })
  assert.ok(oneSided.problems.some((entry) => entry.code === 'ADR_RESOLVES_INVALID'), 'one side is refused')

  const bothSidesSame = schema.parseAdr({
    filename: '0003-r.adr.md',
    source: adrText({ id: '0003', resolves: ['0001', '0001'] }),
  })
  assert.ok(
    bothSidesSame.problems.some((entry) => entry.code === 'ADR_RESOLVES_INVALID'),
    'the same record on both sides is not a conflict',
  )

  const three = schema.parseAdr({
    filename: '0003-r.adr.md',
    source: adrText({ id: '0003', resolves: ['0001', '0002', '0004'] }),
  })
  assert.ok(three.problems.some((entry) => entry.code === 'ADR_RESOLVES_INVALID'), 'three sides is not a resolution')
})

test('compiler: a resolution naming a record that does not exist is ADR_RESOLVES_DANGLING', () => {
  const root = resolutionProject('resolves-dangling')
  writeFileSync(
    join(root, 'docs', 'adrs', '0003-resolution.adr.md'),
    adrText({
      id: '0003',
      status: 'active',
      authority: 'agent',
      zones: ['tests'],
      supersedes: ['0001'],
      resolves: ['0001', '0099'],
      laws: [{ id: 'tests.three', statement: 'Three.', checks: [] }],
    }),
  )
  const result = compile(root)
  assert.ok(result.codes.includes('ADR_RESOLVES_DANGLING'), `codes=${JSON.stringify(result.codes)}`)
})

test('compiler: a resolution naming a record that is neither in force nor leaving it is refused', () => {
  // 0004 is proposed in a zone where only `active` self-activates, nothing supersedes it and
  // no record removes its law: it stands exactly where it was, so a resolution naming it
  // settles a conflict the corpus does not have.
  const root = makeProject({
    name: 'resolves-outside-force',
    zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }],
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', authority: 'agent', zones: ['tests'], laws: [{ id: 'tests.one', statement: 'One.', checks: [] }] }),
      '0004-d.adr.md': adrText({ id: '0004', status: 'proposed', authority: 'agent', zones: ['tests'], laws: [{ id: 'tests.four', statement: 'Four.', checks: [] }] }),
      '0003-resolution.adr.md': adrText({
        id: '0003',
        status: 'active',
        authority: 'agent',
        zones: ['tests'],
        resolves: ['0001', '0004'],
        laws: [{ id: 'tests.three', statement: 'Three.', checks: [] }],
      }),
    },
  })
  const result = compile(root)
  assert.ok(result.codes.includes('ADR_RESOLVES_OUTSIDE_FORCE'), `codes=${JSON.stringify(result.codes)}`)

  // And the same resolution naming the superseded side is accepted: `supersedes` names a
  // record that is leaving force, which is the other half of the rule. The losing record
  // carries a terminal status because the retirement rule requires it — that is a separate
  // test, and asserting it here keeps this one about the resolves rule.
  const accepted = compile(resolutionProject('resolves-leaving', { firstStatus: 'superseded' }))
  assert.deepEqual(accepted.codes, [], `codes=${JSON.stringify(accepted.codes)}`)
  assert.ok(accepted.laws.includes('tests.two'), 'the surviving side keeps its law')
})

test('compiler: a resolution removing a ratified law is refused until it is ratified', () => {
  // The authority rule, driven through the resolution path rather than restated: an
  // agent-authored resolution may not take away a law whose force came from a human
  // ratification, and becomes able to do it once a human ratifies the resolution.
  const losing = adrText({
    id: '0001',
    status: 'proposed',
    authority: 'agent',
    zones: ['tests'],
    laws: [{ id: 'tests.one', statement: 'One.', checks: [] }],
  })
  const approval = approvalText({ id: '0002', approved: [{ id: '0001', text: losing }] })
  const resolution = adrText({
    id: '0003',
    status: 'active',
    authority: 'agent',
    zones: ['tests'],
    resolves: ['0001', '0004'],
    laws: [{ op: 'remove', id: 'tests.one', checks: [] }],
  })
  const root = makeProject({
    name: 'resolves-authority',
    zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }],
    adrs: {
      '0001-a.adr.md': losing,
      '0002-approval.adr.md': approval,
      '0003-resolution.adr.md': resolution,
      '0004-d.adr.md': adrText({ id: '0004', authority: 'agent', zones: ['tests'], laws: [{ id: 'tests.four', statement: 'Four.', checks: [] }] }),
    },
  })
  const refused = compile(root)
  assert.ok(
    refused.codes.includes('LAW_REMOVE_UNAUTHORISED'),
    `an unratified resolution may not retire ratified law: ${JSON.stringify(refused.codes)}`,
  )
  assert.ok(refused.laws.includes('tests.one'), 'and the ratified law is still in force')

  // The same resolution, ratified by a human: the removal is now authorised and the law
  // leaves force.
  writeFileSync(join(root, 'docs', 'adrs', '0005-approve-resolution.adr.md'), approvalText({ id: '0005', approved: [{ id: '0003', text: resolution }] }))
  const allowed = compile(root)
  assert.deepEqual(allowed.codes, [], `codes=${JSON.stringify(allowed.codes)}`)
  assert.ok(!allowed.laws.includes('tests.one'), 'the ratified resolution retires the law it names')
  assert.ok(allowed.laws.includes('tests.four'), 'and the surviving side keeps its own')
})

test('compiler: a resolution removes a named law or supersedes a whole record, never both', () => {
  // A resolution takes away force in exactly ONE of two ways and each is a complete answer.
  // Combining them is not a stronger resolution, it is an unanswerable one: superseding the
  // losing record takes every law it declares out of force, so a removal of one of those
  // laws has no target left, and a record emptied law by law is still in force so it cannot
  // also carry the terminal status supersession needs. The surgical form is the default a
  // drafter should reach for — remove the law that conflicts and leave the rest of the
  // record governing — and supersession is for a whole record being replaced.
  const losing = (status) =>
    adrText({
      id: '0001',
      status,
      authority: 'agent',
      zones: ['tests'],
      laws: [
        { id: 'tests.one', statement: 'One.', checks: [] },
        { id: 'tests.kept', statement: 'Kept.', checks: [] },
      ],
    })
  const other = adrText({ id: '0002', status: 'active', authority: 'agent', zones: ['tests'], laws: [{ id: 'tests.two', statement: 'Two.', checks: [] }] })
  const resolution = (extra) =>
    adrText({
      id: '0003',
      status: 'active',
      authority: 'agent',
      zones: ['tests'],
      ...extra,
      resolves: ['0001', '0002'],
      laws: [{ op: 'remove', id: 'tests.one', checks: [] }],
    })
  const project = (name, ownResolution, targetStatus) =>
    makeProject({
      name,
      zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }],
      adrs: { '0001-a.adr.md': losing(targetStatus), '0002-b.adr.md': other, '0003-resolution.adr.md': ownResolution },
    })

  // The surgical form: one law leaves force, the rest of the losing record keeps governing.
  const removed = compile(project('resolution-surgical', resolution({}), 'active'))
  assert.deepEqual(removed.codes, [], `the surgical form compiles clean: ${JSON.stringify(removed.codes)}`)
  assert.ok(!removed.laws.includes('tests.one'), 'the conflicting law leaves force')
  assert.ok(removed.laws.includes('tests.kept'), 'and the rest of the losing record stays in force')

  // The same resolution with `supersedes` added on top: which shape it means is not decidable.
  const bothWays = compile(project('resolution-ambiguous', resolution({ supersedes: ['0001'] }), 'active'))
  assert.ok(
    bothWays.codes.includes('RESOLUTION_AMBIGUOUS'),
    `removing a law and superseding its record in one resolution is refused by name: ${JSON.stringify(bothWays.codes)}`,
  )
})

test('compiler: a record a resolution retired says so in its own frontmatter', () => {
  // 0001 is superseded by the resolution and every law it declares is out of force, so a
  // reader following the files would find a record that looks live and governs nothing.
  const missing = compile(resolutionProject('retirement-missing', { firstStatus: 'active' }))
  assert.ok(
    missing.codes.includes('RETIREMENT_STATUS_MISSING'),
    `a retired record must carry a terminal status: ${JSON.stringify(missing.codes)}`,
  )

  const declared = compile(resolutionProject('retirement-declared', { firstStatus: 'superseded' }))
  assert.deepEqual(declared.codes, [], `a terminal status satisfies the rule: ${JSON.stringify(declared.codes)}`)
  assert.ok(!declared.laws.includes('tests.one'), 'the retired record contributes no law')
})

test('compiler: a terminal record may not be the source of a law in force', () => {
  // A human can ratify a record whose own status says it is withdrawn, and then the corpus
  // enforces a law from a decision it has retired: a reader who trusts the status stops
  // following the record while the gate keeps checking the code against it.
  const withdrawn = adrText({
    id: '0001',
    status: 'withdrawn',
    authority: 'agent',
    zones: ['tests'],
    laws: [{ id: 'tests.one', statement: 'One.', checks: [] }],
  })
  const root = makeProject({
    name: 'terminal-live-law',
    zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }],
    adrs: {
      '0001-a.adr.md': withdrawn,
      '0002-approval.adr.md': approvalText({ id: '0002', approved: [{ id: '0001', text: withdrawn }] }),
    },
  })
  const result = compile(root)
  assert.ok(
    result.codes.includes('TERMINAL_RECORD_DECLARES_LIVE_LAW'),
    `codes=${JSON.stringify(result.codes)}`,
  )

  // The same record left live is not a problem: a live record may declare a law in force.
  const live = compile(
    makeProject({
      name: 'live-law',
      zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }],
      adrs: { '0001-a.adr.md': adrText({ id: '0001', authority: 'agent', zones: ['tests'], laws: [{ id: 'tests.one', statement: 'One.', checks: [] }] }) },
    }),
  )
  assert.deepEqual(live.codes, [])
})

/**
 * The zones a project's recorded contradictions block right now.
 *
 * Drives the production reads — corpus, active set, compiled bundle, standing entries — so a
 * test asserts what the guard would refuse rather than what a component returns in isolation.
 */
function blockedZonesNow(root) {
  const manifest = compiler.readManifest(root)
  const corpus = compiler.readAdrCorpus(root, manifest.config)
  const resolved = compiler.resolveActiveSet(corpus.records, manifest.config)
  const compiled = compiler.compileLaws(resolved.active, manifest.config)
  const standing = contradictionModule.standingContradictions(root, { resolved })
  return contradictionModule.blockedZones(standing, {
    active: resolved.active,
    proposed: resolved.proposed,
    laws: compiled.bundle.laws,
  })
}

test('lifecycle: a resolution that takes the challenged law out of force lifts the standing block', async () => {
  // ADR 0031's hinge: a block is bound to a LAW, and it is dropped once its findings name no
  // law in force — so a resolution that retires the law is the way out, with no separate
  // clearing gesture, and withdrawing the resolution puts the block back.
  const first = adrText({
    id: '0001',
    status: 'active',
    authority: 'agent',
    zones: ['tests'],
    laws: [{ id: 'tests.one', statement: 'One.', checks: [] }],
  })
  const resolution = (status) =>
    adrText({
      id: '0002',
      status,
      authority: 'agent',
      zones: ['tests'],
      supersedes: ['0001'],
      resolves: ['0001', '0003'],
      laws: [],
    })
  const root = makeProject({
    name: 'resolution-lifts-block',
    zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }],
    adrs: {
      '0001-a.adr.md': first,
      // Withdrawn, so the law is still in force and the block is real.
      '0002-resolution.adr.md': resolution('withdrawn'),
      '0003-c.adr.md': adrText({ id: '0003', authority: 'agent', zones: ['tests'], laws: [{ id: 'tests.three', statement: 'Three.', checks: [] }] }),
    },
  })
  contradictionModule.recordContradiction(root, {
    target: { kind: 'review', id: 'review_change', hash: null },
    findings: [{ severity: 'error', kind: 'semantic_violation', lawId: 'tests.one', explanation: 'the change contradicts the decision in meaning' }],
    job: 'review_change',
  })
  assert.ok(blockedZonesNow(root).has('tests'), 'the contradicted law blocks the zone it governs')

  // The resolution enters force: it supersedes 0001, so 0001 contributes no law and the
  // finding names a law that is no longer in force.
  writeFileSync(join(root, 'docs', 'adrs', '0002-resolution.adr.md'), resolution('active'))
  assert.equal(blockedZonesNow(root).has('tests'), false, 'the block lifts by itself once the law leaves force')

  // Withdraw the resolution and the law is back, so the block is back with it: nothing was
  // cleared by hand, and the block follows the corpus rather than a gesture.
  writeFileSync(join(root, 'docs', 'adrs', '0002-resolution.adr.md'), resolution('withdrawn'))
  assert.ok(blockedZonesNow(root).has('tests'), 'the block returns when the resolution is withdrawn')
})

test('dedupe: a duplicate produces a drafted resolution that removes the law and keeps the record', () => {
  // The developer's only remaining act is to ratify or decline. The draft is an ordinary
  // `proposed` record with `resolves: [loser, winner]` and the SURGICAL `op: remove` ADR 0031
  // settled on: the duplicated law leaves force, the losing record keeps everything else.
  const root = makeProject({
    name: 'dedupe-draft',
    zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'activeIfNoConflict' }],
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        authority: 'agent',
        laws: [
          { id: 'auth.one', statement: 'Sessions must use Redis.', checks: [] },
          { id: 'auth.kept', statement: 'Sessions expire.', checks: [] },
        ],
      }),
      '0002-b.adr.md': adrText({ id: '0002', zones: ['auth'], authority: 'agent', laws: [{ id: 'auth.two', statement: 'Sessions must use Redis.', checks: [] }] }),
    },
  })
  const result = ops.deduplicate({ root, write: true, createdAt: '2026-09-16T00:00:00Z' })
  assert.equal(result.ok, true, JSON.stringify(result.problems))
  assert.equal(result.duplicates.length, 1, 'the statement rule found the duplicate')
  assert.equal(result.duplicates[0].code, 'DUPLICATE_LAW_STATEMENT')
  assert.equal(result.drafts.length, 1)
  const draft = result.drafts[0]
  assert.equal(draft.written, draft.path, 'the draft was placed')
  assert.equal(draft.keeps, '0001', 'the EARLIER record keeps the law, so the decision a reader has followed longest survives')
  assert.equal(draft.withdraws, '0002', 'the later record loses the duplicated law')
  assert.equal(draft.removes, 'auth.two')

  // The draft is a real record: it parses, it says proposed, and it resolves both sides.
  const text = readFileSync(join(root, draft.path), 'utf8')
  assert.match(text, /^status: proposed$/m, 'nothing machine-drafted is in force')
  assert.match(text, /^resolves:$/m)
  assert.match(text, /- op: remove/)
  assert.match(text, /id: auth\.two/)
  const parsed = schema.parseAdr({ filename: draft.path.split('/').pop(), source: text, root })
  assert.deepEqual(parsed.problems, [], `the draft must parse clean: ${JSON.stringify(parsed.problems.map((entry) => entry.code))}`)

  // And the corpus compiles with the draft standing as a proposal, which is the state a
  // human is asked to ratify.
  assert.deepEqual(compiler.compileProject(root).problems.map((entry) => entry.code), [])
  // The deterministic command still fails: the duplicate is reported until a human settles
  // it, and drafting is not settling.
  assert.equal(duplicateCommand(root).status, 1, 'the drafter does not clear the deterministic gate')
})

test('dedupe: ratifying the draft settles the duplicate, and the losing record keeps its other laws', () => {
  const root = makeProject({
    name: 'dedupe-ratify',
    zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'activeIfNoConflict' }],
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        authority: 'agent',
        laws: [{ id: 'auth.one', statement: 'Sessions must use Redis.', checks: [] }],
      }),
      '0002-b.adr.md': adrText({
        id: '0002',
        zones: ['auth'],
        authority: 'agent',
        laws: [
          { id: 'auth.two', statement: 'Sessions must use Redis.', checks: [] },
          { id: 'auth.kept', statement: 'Sessions expire.', checks: [] },
        ],
      }),
    },
  })
  const drafted = ops.deduplicate({ root, write: true, createdAt: '2026-09-16T00:00:00Z' })
  assert.equal(drafted.drafts.length, 1)
  const draftPath = drafted.drafts[0].path
  const draftText = readFileSync(join(root, draftPath), 'utf8')

  // The draft is `proposed`, so nothing has changed yet.
  const before = compile(root)
  assert.ok(before.laws.includes('auth.two'), 'the duplicated law is still in force while the resolution is proposed')

  // A human ratifies it, which is the one act the machinery leaves to them. The approval takes
  // the id AFTER the draft, because the draft already claimed one.
  const approvalId = String(Number(drafted.drafts[0].id) + 1).padStart(4, '0')
  writeFileSync(
    join(root, 'docs', 'adrs', `${approvalId}-approval.adr.md`),
    approvalText({ id: approvalId, approved: [{ id: drafted.drafts[0].id, text: draftText }] }),
  )
  const after = compile(root)
  assert.deepEqual(after.codes, [], `the settled corpus compiles clean: ${JSON.stringify(after.codes)}`)
  assert.ok(!after.laws.includes('auth.two'), 'the duplicated law leaves force')
  assert.ok(after.laws.includes('auth.one'), 'the kept decision still governs')
  assert.ok(after.laws.includes('auth.kept'), 'and the losing record keeps the law the conflict did not touch')
  assert.equal(duplicateCommand(root).status, 0, 'with the duplicate settled the deterministic gate is green again')
  // The draft is a proposed record, not an approval, so it stays where it is as the record of
  // the settlement rather than being consumed.
  assert.ok(readFileSync(join(root, draftPath), 'utf8').includes('status: proposed'))
})

test('dedupe: a duplicate it cannot draft is reported with the reason, never skipped', () => {
  // A `humanOnly` zone makes the removal unratifiable by this path, so a draft would be a
  // question nobody could answer. The finding is reported as undraftable rather than dropped:
  // a duplicate the command reports and the drafts do not mention would read as handled.
  const root = makeProject({
    name: 'dedupe-undraftable',
    zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' }],
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], authority: 'human', status: 'active', laws: [{ id: 'auth.one', statement: 'Sessions must use Redis.', checks: [] }] }),
      '0002-b.adr.md': adrText({ id: '0002', zones: ['auth'], authority: 'agent', laws: [{ id: 'auth.two', statement: 'Sessions must use Redis.', checks: [] }] }),
    },
  })
  assert.equal(duplicateCommand(root).status, 1, 'the duplicate is still reported deterministically')
  const result = ops.deduplicate({ root })
  assert.deepEqual(result.drafts, [], 'nothing was drafted')
  assert.equal(result.undraftable.length, 1)
  assert.match(result.undraftable[0].reason, /humanOnly|reserved to humans/)
  assert.equal(result.ok, true, 'the run happened and reported what it could not do')
})

test('dedupe: the deterministic command loads no judge, and drafting loads no judge either', () => {
  // The exit code of the deterministic command must stay independent of any judge, and the
  // drafter must not smuggle one in: both carry no model. A judge's finding never reaches
  // either — `ratchet_review --job review_duplicates` is the advisory report and it never
  // gates, which the semantic-duplicate test above pins from the other side.
  const commandSource = readFileSync(DUPLICATE_COMMAND, 'utf8')
  assert.doesNotMatch(commandSource, /ratchet-dynamic|ratchet-ops|spawnJudge|subagents/, 'the command loads no judge')
  const dedupeSource = readFileSync(join(resolve(import.meta.dirname, '..'), 'plugins', 'ratchet', 'ratchet-dedupe.mjs'), 'utf8')
  assert.doesNotMatch(dedupeSource, /ratchet-dynamic|spawnJudge|subagents|ratchet-review/, 'the drafter loads no judge')
  const opsSource = readFileSync(join(resolve(import.meta.dirname, '..'), 'plugins', 'ratchet', 'ratchet-ops.mjs'), 'utf8')
  assert.doesNotMatch(opsSource, /export function deduplicate[\s\S]{0,2000}?spawnJudge/, 'and the operation takes no judge argument')
})

// ---------------------------------------------------------------------------
// The ratchet's OWN automatic drafting pass (deliverable: drafting is invoked by
// the ratchet, never by an agent calling a tool).
// ---------------------------------------------------------------------------

test('drafting: compile itself drafts a duplicate resolution, idempotently and without an agent call', () => {
  // The human's direction: the ratchet detects the issue and flags it for a human, and no
  // agent has to remember to call `ratchet_deduplicate`. Removing the `draftNeedsHuman` call
  // from `compile` makes this test fail, which is the counterexample that pins the mechanism.
  const root = makeProject({
    name: 'auto-draft-duplicate',
    zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }],
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.one', statement: 'Sessions must use Redis.', checks: [] }] }),
      '0002-b.adr.md': adrText({ id: '0002', zones: ['auth'], laws: [{ id: 'auth.two', statement: 'Sessions must use Redis.', checks: [] }] }),
    },
  })
  const before = readdirSync(join(root, 'docs', 'adrs')).length
  const compiled = ops.compile({ root })
  assert.equal(compiled.drafting.duplicates.drafted.length, 1, 'compile drafted the duplicate resolution on its own')
  const draft = compiled.drafting.duplicates.drafted[0]
  assert.ok(existsSync(join(root, draft.path)), 'the draft is a real file a human can Approve or Decline')
  assert.equal(readdirSync(join(root, 'docs', 'adrs')).length, before + 1)
  const text = readFileSync(join(root, draft.path), 'utf8')
  assert.match(text, /^draft: true$/m, 'the draft carries the machine-draft marker')
  assert.match(text, /^draftKey: "duplicate:[0-9a-f]{16}"$/m, 'and the deterministic identity the next pass reads back')

  // A second pass is idempotent: no second draft, and the existing one is reported.
  const again = ops.compile({ root })
  assert.equal(again.drafting.duplicates.drafted.length, 0, 'a second compile adds no second draft')
  assert.equal(again.drafting.duplicates.alreadyDrafted.length, 1)
  assert.equal(again.drafting.duplicates.alreadyDrafted[0].id, draft.id, 'and names the draft already on disk')
  assert.equal(readdirSync(join(root, 'docs', 'adrs')).length, before + 1)

  // A draft a human edited is never overwritten.
  writeFileSync(join(root, draft.path), `${readFileSync(join(root, draft.path), 'utf8')}\n<!-- edited by a human -->\n`)
  ops.compile({ root })
  assert.ok(
    readFileSync(join(root, draft.path), 'utf8').includes('edited by a human'),
    'the human edit survives the next automatic pass',
  )
})

test('drafting: compile itself drafts a contradiction resolution, and the audit accepts it', () => {
  const root = makeProject({
    name: 'auto-draft-contradiction',
    zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }],
    adrs: {
      '0001-holder.adr.md': adrText({
        id: '0001',
        authority: 'human',
        zones: ['tests'],
        laws: [{ id: 'tests.one', statement: 'One.', checks: [] }],
      }),
      '0002-rival.adr.md': adrText({
        id: '0002',
        status: 'proposed',
        authority: 'agent',
        zones: ['tests'],
        laws: [{ id: 'tests.one', statement: 'Different.', checks: [] }],
      }),
    },
  })
  const result = ops.compile({ root })
  assert.equal(result.drafting.contradictions.drafted.length, 1, 'compile detected the decidable contradiction and drafted a resolution')
  const draft = result.drafting.contradictions.drafted[0]
  assert.equal(draft.offenderId, '0002')
  assert.equal(draft.holderId, '0001')
  assert.equal(draft.strategy, 'remove', 'a redeclaration is settled by the surgical removal of the in-force law')
  const text = readFileSync(join(root, draft.path), 'utf8')
  assert.match(text, /^resolves:$/m)
  assert.match(text, /- "0001"/)
  assert.match(text, /- "0002"/)
  assert.match(text, /- op: remove/)
  assert.match(text, /id: tests\.one/)
  const parsed = schema.parseAdr({ filename: draft.path.split('/').pop(), source: text, root })
  assert.deepEqual(parsed.problems, [], `the drafted resolution must parse clean: ${JSON.stringify(parsed.problems.map((entry) => entry.code))}`)
  // The compiler's own audit accepts it, so the drafted resolution is not itself a contradiction.
  assert.deepEqual(compiler.compileProject(root).problems.map((entry) => entry.code), [])
  // And it is an ordinary proposed record: the ratify queue offers it, so the human can approve it.
  const queue = ops.ratifications(root)
  assert.ok(queue.pending.some((entry) => entry.id === draft.id), 'the drafted resolution is a proposed record a human can approve')

  // Idempotent on the contradiction too.
  const again = ops.compile({ root })
  assert.equal(again.drafting.contradictions.drafted.length, 0)
  assert.equal(again.drafting.contradictions.alreadyDrafted.length, 1)
})

test('drafting: a pure-removal contradiction is settled by supersession, which the audit accepts', () => {
  // The removal arm of the one-way shape cannot be audited against a record that only REMOVES
  // law in force, because neither named side is leaving force (`ADR_RESOLVES_OUTSIDE_FORCE`).
  // The draft therefore retires the offending proposal instead, which the audit accepts.
  const root = makeProject({
    name: 'auto-draft-removal',
    zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }],
    adrs: {
      '0001-holder.adr.md': adrText({
        id: '0001',
        authority: 'human',
        zones: ['tests'],
        laws: [{ id: 'tests.one', statement: 'One.', checks: [] }],
      }),
      '0002-remover.adr.md': adrText({
        id: '0002',
        status: 'proposed',
        authority: 'agent',
        zones: ['tests'],
        laws: [{ op: 'remove', id: 'tests.one' }],
      }),
    },
  })
  const result = ops.compile({ root })
  assert.equal(result.drafting.contradictions.drafted.length, 1)
  const draft = result.drafting.contradictions.drafted[0]
  assert.equal(draft.strategy, 'supersede')
  const text = readFileSync(join(root, draft.path), 'utf8')
  assert.match(text, /^supersedes:$/m)
  assert.match(text, /- "0002"/)
  assert.match(text, /^laws: \[\]$/m, 'the supersede arm removes no law, so the law in force stays')
  assert.deepEqual(compiler.compileProject(root).problems.map((entry) => entry.code), [], 'the supersession-shaped resolution compiles clean')
})

test('spec drift: a stale document is advisory with a drafted withdrawal note, and a missing one still blocks', async () => {
  const root = makeProject({
    name: 'stale-advisory',
    files: { 'src/auth/x.ts': 'redis\n' },
    extraManifest: { specsRequired: true },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['auth'],
        laws: [{ id: 'a.one', statement: 'One.', checks: [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis' }] }],
      }),
    },
  })
  await ops.compile({ root, write: true })
  const adrPath = join(root, 'docs', 'adrs', '0001-a.adr.md')
  writeFileSync(
    adrPath,
    readFileSync(adrPath, 'utf8').replace('statement: One.', 'statement: One, amended.'),
  )
  // The document is unedited and merely behind the laws: reported in `specDrift.stale` with a
  // drafted note, and NOT a blocking problem.
  const stale = ops.compile({ root, write: false })
  assert.ok(stale.specDrift.stale.includes('docs/specs/auth.spec.md'), 'the stale document is reported')
  const note = stale.specDrift.notes.find((entry) => entry.path === 'docs/specs/auth.spec.md')
  assert.ok(note !== undefined && typeof note.notePath === 'string', 'and it carries the drafted withdrawal note path')
  assert.ok(existsSync(join(root, note.notePath)), 'the ratchet wrote the withdrawal note')
  assert.ok(readFileSync(join(root, note.notePath), 'utf8').includes('written by the RATCHET itself'), 'the note says the ratchet wrote it, not an agent')
  assert.ok(!stale.problems.some((entry) => entry.code === 'SPEC_OUT_OF_DATE'), 'a stale document is advisory, not blocking')
  // Deleting a tracked document is the `missing` kind, which still blocks.
  rmSync(join(root, 'docs', 'specs', 'auth.spec.md'), { force: true })
  const missing = ops.compile({ root, write: false })
  assert.ok(missing.problems.some((entry) => entry.code === 'SPEC_OUT_OF_DATE'), 'a missing tracked document still blocks')
})

test('needsHuman: every entry carries the drafted path/id or says why no draft exists', () => {
  const root = makeProject({
    name: 'needs-draft-contract',
    zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }],
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.one', statement: 'Sessions must use Redis.', checks: [] }] }),
      '0002-b.adr.md': adrText({ id: '0002', zones: ['auth'], laws: [{ id: 'auth.two', statement: 'Sessions must use Redis.', checks: [] }] }),
    },
  })
  // Compile writes the draft; the read-only view then reports it as already drafted.
  ops.compile({ root })
  const view = decisionsModule.deriveDecisions({ root })
  const duplicates = view.needsHuman.filter((entry) => entry.kind === 'duplicate')
  assert.ok(duplicates.length > 0, 'the view reports the duplicate')
  const withDraft = duplicates.find((entry) => entry.draft !== null)
  assert.ok(withDraft !== undefined, 'the entry carries the drafted resolution')
  assert.equal(typeof withDraft.draft.id, 'string')
  assert.ok(typeof withDraft.draft.path === 'string' && withDraft.draft.path.length > 0)
  assert.equal(withDraft.draftReason, null)
  for (const entry of view.needsHuman) {
    assert.ok(Object.prototype.hasOwnProperty.call(entry, 'draft'), `every entry carries a draft field: ${entry.kind}`)
    assert.ok(Object.prototype.hasOwnProperty.call(entry, 'draftReason'), `every entry carries a draftReason field: ${entry.kind}`)
    if (entry.draft === null) {
      assert.ok(typeof entry.draftReason === 'string' && entry.draftReason.length > 0, `a draftless entry says why: ${entry.kind}`)
    }
  }
  // The drafted resolution is a normal proposed record: parseable, and in the corpus.
  assert.ok(view.records.some((record) => record.draft === true && record.draftKey !== null), 'the draft is in the corpus with its identity')
})

test('decisions: a draftless need states WHY without repeating its own action', () => {
  // The red-gate card printed "no drafted fix exists …" twice — once as the action and once as
  // the draftReason — so the card showed one sentence for a fact, a reason and an instruction.
  // A draftless entry's reason must add information rather than echo the action.
  const root = makeProject({
    name: 'red-gate-reason',
    adrs: { '0001-a.adr.md': adrText({ id: '0001', laws: [{ id: 'x.one', statement: 'One.', checks: [] }] }) },
    files: {},
  })
  mkdirSync(join(root, 'reports', 'ratchet'), { recursive: true })
  writeFileSync(
    join(root, 'reports', 'ratchet', 'verify-report.json'),
    JSON.stringify({ problems: [{ code: 'X', lawId: 'x.one', message: 'y' }] }),
  )
  const view = decisionsModule.deriveDecisions({ root })
  const red = view.needsHuman.find((entry) => entry.kind === 'red-gate')
  assert.ok(red !== undefined, 'the red gate is reported from the persisted report')
  assert.equal(red.draft, null)
  assert.ok(typeof red.action === 'string' && red.action.length > 0, 'the action is an instruction')
  assert.ok(typeof red.draftReason === 'string' && red.draftReason.length > 0, 'a draftless entry says why')
  assert.notEqual(red.draftReason, red.action, 'the draft reason must not repeat the action')

  // The count alone told a human nothing to do. Each problem is carried with the record
  // that decided its law, so the window can offer the decision instead of only the report.
  assert.deepEqual(red.problems, [{ code: 'X', lawId: 'x.one', adrId: '0001', message: 'y' }])
  assert.equal(red.problemCount, 1)
})

test('duplicates: one statement under two law ids fails the deterministic command', () => {
  const root = makeProject({
    name: 'duplicate-statement',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.one', statement: 'Sessions must use Redis.', checks: [] }] }),
      '0002-b.adr.md': adrText({ id: '0002', zones: ['auth'], laws: [{ id: 'auth.two', statement: 'Sessions must use Redis.', checks: [] }] }),
    },
  })
  const run = duplicateCommand(root)
  assert.equal(run.status, 1, `a decidable duplicate is a failure: ${run.stdout}`)
  assert.match(run.stdout, /DUPLICATE_LAW_STATEMENT/)
  assert.match(run.stdout, /auth\.one/)
  assert.match(run.stdout, /auth\.two/)
  assert.doesNotMatch(run.stdout, /duplicate decisions ok/, 'a failing run does not print the pass marker')
})

test('duplicates: one source cited by two records that share a law fails the command', () => {
  // The compiler is silent here — one law id with one statement is a merge, not a conflict —
  // so this is exactly the duplication no static check otherwise sees.
  const shared = { sourceHash: schema.hashSource(SOURCE_TEXT), zones: ['auth'] }
  const root = makeProject({
    name: 'duplicate-source',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', ...shared, laws: [{ id: 'auth.one', statement: 'Sessions must use Redis.', checks: [] }] }),
      '0002-b.adr.md': adrText({ id: '0002', ...shared, laws: [{ id: 'auth.one', statement: 'Sessions must use Redis.', checks: [] }] }),
    },
  })
  assert.deepEqual(compile(root).codes, [], 'the compiler merges the re-declaration and reports nothing')
  const run = duplicateCommand(root)
  assert.equal(run.status, 1, `one document ingested twice is a failure: ${run.stdout}`)
  assert.match(run.stdout, /DUPLICATE_SOURCE_CITED/)
  assert.match(run.stdout, /0001/)
  assert.match(run.stdout, /0002/)
})

test('duplicates: a re-declared law with an identical statement is NOT a duplicate, and merges', () => {
  // ADR 0032 is explicit: one law id with one statement declared by two records is the
  // corpus agreeing with itself. The compiler binds it to the union of the zones both
  // records named, and the deterministic command must stay silent — a check that reported
  // it would refuse a corpus the compiler has already merged.
  const root = makeProject({
    name: 'duplicate-merge',
    files: { [OTHER_SOURCE_PATH]: OTHER_SOURCE_TEXT },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        sourceHash: schema.hashSource(SOURCE_TEXT),
        laws: [{ id: 'shared.one', statement: 'One law, declared twice.', checks: [] }],
      }),
      '0002-b.adr.md': adrText({
        id: '0002',
        zones: ['tests'],
        sourcePath: OTHER_SOURCE_PATH,
        sourceHash: schema.hashSource(OTHER_SOURCE_TEXT),
        laws: [{ id: 'shared.one', statement: 'One law, declared twice.', checks: [] }],
      }),
    },
  })
  const compiled = compiler.compileProject(root)
  assert.deepEqual(compiled.problems.map((entry) => entry.code), [])
  const law = compiled.bundle.laws.find((entry) => entry.id === 'shared.one')
  assert.ok(law !== undefined, 'the law is in force once')
  assert.deepEqual(
    [...law.zones].sort(),
    ['auth', 'tests'],
    'the law governs the UNION of the zones both records named, which is what makes it a merge rather than a duplicate',
  )
  assert.equal(compiled.bundle.laws.filter((entry) => entry.id === 'shared.one').length, 1, 'one law, not two')

  const run = duplicateCommand(root)
  assert.equal(run.status, 0, `a merge is not a duplicate: ${run.stdout}`)
  assert.match(run.stdout, /duplicate decisions ok/)
})

test('duplicates: many decisions from one source with disjoint laws are not duplicates', () => {
  // The shape batch extraction produces (ADR 0033) and the shape this kit's own corpus has:
  // one reasoning document, several decisions, no law declared twice. Reporting a shared
  // source on its own would forbid the batch mechanism the corpus also decided on.
  const shared = { sourceHash: schema.hashSource(SOURCE_TEXT) }
  const root = makeProject({
    name: 'duplicate-shared-source',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], ...shared, laws: [{ id: 'auth.one', statement: 'One.', checks: [] }] }),
      '0002-b.adr.md': adrText({ id: '0002', zones: ['auth'], ...shared, laws: [{ id: 'auth.two', statement: 'Two.', checks: [] }] }),
    },
  })
  const run = duplicateCommand(root)
  assert.equal(run.status, 0, `one source, two decisions: ${run.stdout}`)
  assert.match(run.stdout, /duplicate decisions ok/)
})

test('duplicates: a corpus that cannot be read exits 2, so nothing checked is never a pass', () => {
  const empty = makeProject({ name: 'duplicate-unusable', adrs: {} })
  const run = duplicateCommand(empty)
  assert.equal(run.status, 2, run.stdout)
  assert.doesNotMatch(run.stdout, /duplicate decisions ok/)
})

test('duplicates: the semantic report is advisory and the deterministic command does not depend on it', async () => {
  // The boundary ADR 0032 draws: meaning is a judge's question, and a model verdict must not
  // be able to fail a build. Two records here state one constraint in different words, from
  // different sources, under different law ids — the deterministic rules see nothing, and
  // the judge sees a duplicate. The two must not merge.
  const root = makeProject({
    name: 'duplicate-semantic',
    files: { [OTHER_SOURCE_PATH]: OTHER_SOURCE_TEXT },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        sourceHash: schema.hashSource(SOURCE_TEXT),
        laws: [{ id: 'auth.one', statement: 'Sessions must live in Redis.', checks: [] }],
      }),
      '0002-b.adr.md': adrText({
        id: '0002',
        zones: ['auth'],
        sourcePath: OTHER_SOURCE_PATH,
        sourceHash: schema.hashSource(OTHER_SOURCE_TEXT),
        laws: [{ id: 'auth.two', statement: 'Session state belongs in a Redis store rather than on disk.', checks: [] }],
      }),
    },
  })
  const deterministic = duplicateCommand(root)
  assert.equal(deterministic.status, 0, `no rule this command decides is broken: ${deterministic.stdout}`)
  assert.match(deterministic.stdout, /duplicate decisions ok/)

  // ...and the judge, over the same corpus, reports the duplicate.
  const verdict = {
    ok: false,
    findings: [
      {
        severity: 'error',
        kind: 'semantic_duplicate',
        lawId: 'auth.one',
        // The duplicate finding names a law too, so it quotes it: the rule is about any
        // law-bound finding, not only about a blocking one, and a judge that has to quote
        // the law it is talking about cannot report a duplicate of a statement that is not
        // the one in force.
        lawQuote: 'Sessions must live in Redis.',
        explanation: 'auth.two restates the constraint auth.one states, in different words, for the same store',
      },
    ],
  }
  const reported = await ops.review({
    root,
    job: 'review_duplicates',
    spawnJudge: async () => ({ structured: verdict, output: '', stopReason: 'completed' }),
  })
  assert.equal(reported.findings.length, 1, 'the judge sees what the command cannot')
  assert.equal(reported.findings[0].kind, 'semantic_duplicate')
  assert.equal(reported.declined, false, 'a duplicate finding is reported, never a block')
  assert.equal(reported.gate, false, 'and it is not a gate')
  // The exit code of the deterministic command is unchanged by any of that: it is a separate
  // process whose only inputs are the files, and it never loads the review layer.
  const commandSource = readFileSync(DUPLICATE_COMMAND, 'utf8')
  assert.doesNotMatch(commandSource, /ratchet-dynamic|ratchet-ops|spawnJudge|subagents/, 'the command loads no judge')
  assert.equal(duplicateCommand(root).status, 0, 'running it again after a judge answered still exits 0')
})

// ---------------------------------------------------------------------------
// one ingestion entry point: the path is chosen for the caller, not by them
// ---------------------------------------------------------------------------

/**
 * A source with more headed sections than one batch may carry.
 *
 * Every sentence a decision may cite is generated from the section number, so a fixture
 * cannot accidentally cite another section's text: a batch decision's span is located in the
 * chunk it was extracted from, and a helper that reused one sentence would make every
 * cross-chunk assertion pass for the wrong reason.
 */
const MANY_SOURCE_TEXT = [
  '# A design session with many decisions',
  '',
  ...Array.from({ length: ingestModule.BATCH_DECISION_CAP + 2 }, (_unused, position) => [
    `## Decision ${position + 1}`,
    '',
    `We agreed decision number ${position + 1} because the deployment already runs it.`,
    '',
  ]).flat(),
].join('\n')

const MANY_SOURCE_PATH = 'docs/ratchet/sources/2026-09-16-many-decisions.md'

/** One batch decision grounded in section `number` of {@link MANY_SOURCE_TEXT}. */
function manyDecision(number, overrides = {}) {
  const sentence = `We agreed decision number ${number} because the deployment already runs it.`
  return {
    span: sentence,
    title: `Decision ${number}`,
    decision: `Adopt what decision ${number} states.`,
    reasoning: `Because ${sentence}`,
    reasoningBasis: sentence,
    context: `The session reached decision ${number}.`,
    contextBasis: sentence,
    zones: ['auth'],
    laws: [],
    ...overrides,
  }
}

test('auto-ingest: one entry point reads a source the cap can hold in one call', async () => {
  const root = await ingestProject('auto-ingest-one')
  const result = await ops.ingestAuto({
    root,
    sourcePath: SOURCE_PATH,
    submitted: { decisions: [batchDecision({ title: 'Use Redis for session storage', laws: [{ id: 'auth.session.redis', statement: 'Session storage must use Redis.', checks: [] }] })] },
    write: true,
    now: '2026-09-16T00:00:00Z',
  })
  assert.equal(result.ok, true, JSON.stringify(result.problems?.map((entry) => entry.message)))
  assert.equal(result.status, 'proposed', 'the unified path is still proposals only')
  assert.equal(result.chunkCount, 1, 'a document the cap can hold is one chunk')
  assert.equal(result.chunks[0].accepted, 1)
  assert.equal(result.written.length, 1)
  assert.deepEqual(result.unanswered, [])
})

test('auto-ingest: a source above the cap is split on its headings and driven chunk by chunk', async () => {
  const root = await ingestProject('auto-ingest-many')
  writeFileSync(join(root, MANY_SOURCE_PATH), MANY_SOURCE_TEXT)

  const cap = ingestModule.BATCH_DECISION_CAP
  const plan = ingestModule.planIngestChunks(MANY_SOURCE_TEXT)
  assert.equal(plan.chunks.length, 2, `the split is mechanical: ${JSON.stringify(plan.chunks.map((chunk) => [chunk.startLine, chunk.endLine]))}`)
  assert.ok(
    plan.chunks.every((chunk, index) => index === 0 || chunk.startLine === plan.headings[cap].line),
    'the second chunk starts on a heading, so no section is divided between two chunks',
  )
  assert.ok(
    plan.chunks.map((chunk) => chunk.headings.length).every((count) => count <= cap),
    'each chunk holds at most the cap in headings, so at most the cap in decisions',
  )

  // The answers come back as an ARRAY, one verdict per chunk, which is the shape the tool
  // returns when no judge could be spawned.
  const answers = plan.chunks.map((chunk, index) => ({ decisions: [manyDecision(index * cap + 1)] }))
  const result = await ops.ingestAuto({
    root,
    sourcePath: MANY_SOURCE_PATH,
    submitted: answers,
    write: true,
    now: '2026-09-16T00:00:00Z',
  })
  assert.equal(result.chunkCount, 2)
  assert.deepEqual(result.unanswered, [])
  assert.equal(result.written.length, 2, `both chunks landed: ${JSON.stringify(result.refused)}`)
  assert.deepEqual(result.records.map((record) => record.status), ['proposed', 'proposed'])
  assert.deepEqual(compiler.compileProject(root).problems.map((entry) => entry.code), [], 'the project still compiles')
})

test('auto-ingest: a span located only in ANOTHER chunk is refused, so the chunk is the scope', async () => {
  const root = await ingestProject('auto-ingest-scope')
  writeFileSync(join(root, MANY_SOURCE_PATH), MANY_SOURCE_TEXT)
  const cap = ingestModule.BATCH_DECISION_CAP
  const plan = ingestModule.planIngestChunks(MANY_SOURCE_TEXT)

  // Chunk 1 cites a sentence that lives in chunk 2. Attribution is to the text the judge was
  // given, so this cannot be located and is refused — while chunk 2's own answer lands.
  const answers = [
    { decisions: [manyDecision(cap + 1, { title: 'Cross-chunk span' })] },
    { decisions: [manyDecision(cap + 1, { title: 'Chunk two decision' })] },
  ]
  const result = await ops.ingestAuto({
    root,
    sourcePath: MANY_SOURCE_PATH,
    submitted: answers,
    write: true,
    now: '2026-09-16T00:00:00Z',
  })
  assert.equal(result.written.length, 1, `one record lands and one extraction costs one record: ${JSON.stringify(result)}`)
  assert.deepEqual(result.refused.map((entry) => entry.code), ['SPAN_NOT_LOCATED'])
  assert.equal(result.refused[0].chunk, 1, 'the refusal names the chunk it came from')
  assert.ok(plan.chunks[1].text.includes(`decision number ${cap + 1}`), 'and the sentence really is in the other chunk')
})

test('auto-ingest: with no judge the split is returned unrun, and the answers resume the same call', async () => {
  const root = await ingestProject('auto-ingest-degraded')
  writeFileSync(join(root, MANY_SOURCE_PATH), MANY_SOURCE_TEXT)

  const bare = await ops.ingestAuto({ root, sourcePath: MANY_SOURCE_PATH, spawnJudge: null })
  assert.equal(bare.ok, false, 'nothing was read, so this is not a success')
  assert.equal(bare.unanswered.length, 2, 'every chunk is returned unrun rather than half-ingested')
  assert.equal(bare.written.length, 0)
  assert.ok(typeof bare.unanswered[0].prompt === 'string' && bare.unanswered[0].prompt.length > 0, 'the prompt the judge would have received is returned')
  assert.match(bare.nextStep, /no judge could be spawned/, 'and the result says why, in the words a developer needs')

  // Resume: the same call with the answers, which is what a session that cannot spawn a
  // judge uses to finish the ingestion.
  const cap = ingestModule.BATCH_DECISION_CAP
  const resumed = await ops.ingestAuto({
    root,
    sourcePath: MANY_SOURCE_PATH,
    submitted: bare.unanswered.map((entry) => ({ decisions: [manyDecision((entry.index - 1) * cap + 1)] })),
    write: true,
    now: '2026-09-16T00:00:00Z',
  })
  assert.deepEqual(resumed.unanswered, [])
  assert.equal(resumed.written.length, 2, JSON.stringify(resumed.refused))
})

test('batch: many decisions from one source become many proposed records', async () => {
  const root = await ingestProject('batch-good')
  const result = await ops.ingestBatch({
    root,
    sourcePath: SOURCE_PATH,
    submitted: {
      decisions: [
        batchDecision({ title: 'Use Redis for session storage', laws: [{ id: 'auth.session.redis', statement: 'Session storage must use Redis.', checks: [] }] }),
        batchDecision({
          title: 'Read sessions through one adapter',
          span: 'file-backed sessions break under two instances',
          contextBasis: 'file-backed sessions break under two instances',
          laws: [{ id: 'auth.session.adapter', statement: 'Session reads go through one adapter.', checks: [] }],
        }),
      ],
    },
    write: true,
    now: '2026-09-16T00:00:00Z',
  })
  assert.equal(result.ok, true, JSON.stringify(result.problems?.map((entry) => entry.code)))
  assert.equal(result.advisory, true, 'a batch is advisory: it writes proposals, it does not gate')
  assert.equal(result.status, 'proposed')
  assert.deepEqual(result.refused, [])
  assert.equal(result.written.length, 2, JSON.stringify(result.written))
  assert.deepEqual(result.records.map((record) => record.status), ['proposed', 'proposed'])
  assert.deepEqual(result.records.map((record) => record.id), ['0002', '0003'], 'ids advance across the batch')
  assert.deepEqual(compiler.compileProject(root).problems.map((entry) => entry.code), [], 'the project still compiles')
  const texts = result.records.map((record) => readFileSync(join(root, record.path), 'utf8'))
  assert.ok(texts.every((text) => /^status: proposed$/m.test(text)), 'every written record is proposed')
})

test('batch: a decision whose span cannot be located is refused alone', async () => {
  const root = await ingestProject('batch-one-bad')
  const result = await ops.ingestBatch({
    root,
    sourcePath: SOURCE_PATH,
    submitted: {
      decisions: [
        batchDecision({ title: 'Use Redis for session storage', laws: [{ id: 'auth.session.redis', statement: 'Session storage must use Redis.', checks: [] }] }),
        batchDecision({
          title: 'A decision whose span was invented',
          span: 'we benchmarked Redis against every alternative for a week',
        }),
      ],
    },
    write: true,
    now: '2026-09-16T00:00:00Z',
  })
  // `ok` is false because the batch did not land whole, and one record still landed: that is
  // the degradation the record asks for — one misattributed extraction costs one record.
  assert.equal(result.ok, false)
  assert.equal(result.written.length, 1, JSON.stringify(result.written))
  assert.deepEqual(result.refused.map((entry) => entry.code), ['SPAN_NOT_LOCATED'])
  assert.equal(result.refused[0].title, 'A decision whose span was invented')
  assert.equal(result.records.length, 1)
  assert.equal(result.records[0].status, 'proposed')
  assert.ok(
    !result.records.some((record) => record.title === 'A decision whose span was invented'),
    'the record with the invented span minted nothing',
  )
})

test('batch: a batch above the cap is refused with the headings the tool found', async () => {
  const root = await ingestProject('batch-over-cap')
  const cap = ingestModule.BATCH_DECISION_CAP
  const result = await ops.ingestBatch({
    root,
    sourcePath: SOURCE_PATH,
    submitted: {
      decisions: Array.from({ length: cap + 1 }, (_, index) => batchDecision({ title: `Decision ${index}` })),
    },
    write: true,
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'BATCH_OVER_CAP')
  assert.equal(result.cap, cap)
  assert.equal(result.written, undefined, 'nothing is written for a batch over the cap')
  assert.ok(Array.isArray(result.headings) && result.headings.length > 0, 'the refusal carries the headings it found')
  assert.equal(result.headings[0].title, 'Grilling session: session storage')
  assert.match(result.nextStep, /split the source/)
  assert.equal(readdirSync(join(root, 'docs', 'adrs')).length, 1, 'only the starter record exists')
})

test('batch: the extractor is a surface of its own, not a mode of single-decision ingestion', { skip: HARNESS_SKIP }, () => {
  const registered = toolHarness()
  const batch = registered.get('ratchet_ingest_batch')
  const single = registered.get('ratchet_ingest_source')
  assert.ok(batch !== undefined, 'ratchet_ingest_batch is registered')
  assert.ok(single !== undefined, 'ratchet_ingest_source keeps its own surface')
  assert.notEqual(batch, single)
  assert.deepEqual(Object.keys(batch.parameters.properties).sort(), ['ingest', 'source', 'write'])
  // Neither surface accepts an answer: `ingest` files a result the caller obtained, `write`
  // asks for the file, `source` says which document. The consent-surface check scans every
  // registered tool for the same reason.
  assert.equal(single.parameters.properties.ratify?.type, 'boolean')
  assert.equal(batch.parameters.properties.ratify, undefined, 'a batch is not a consent entry')
  assert.match(batch.description, /cap/i)
  assert.match(batch.description, /proposed/i)
})

test('batch: the degraded path returns the prompt, the cap and the source hash', async () => {
  const root = await ingestProject('batch-degraded')
  const result = await ops.ingestBatch({ root, sourcePath: SOURCE_PATH })
  assert.equal(result.degraded, true)
  assert.equal(result.cap, ingestModule.BATCH_DECISION_CAP)
  assert.match(result.prompt, /"decisions"/)
  assert.match(result.prompt, /verbatim/)
  assert.match(result.submitHint, /ratchet_ingest_batch/)
  assert.equal(result.sourceHash, schema.hashSource(SOURCE_TEXT))
})

test('verifier: an explicit file check sees a path the walk skips, and never goes green wrongly', async () => {
  // The walk skips directories that are never a project's own source (`node_modules`, `bin`,
  // `weights`, …). Reading file-check membership from that walk made `forbidden_file` on a
  // skipped name report SATISFIED while the file exists (a false green) and `required_file`
  // report a file that exists as missing (a false red). These checks promise an existence
  // claim, so they resolve the path they name against the filesystem. The revert counterexample
  // is the NEVER_WALK expansion this repo briefly carried: restoring it makes the first two
  // assertions fail.
  const ASSET_ZONES = [{ id: 'assets', paths: ['weights/**', 'data/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }]
  const forbidden = makeProject({
    name: 'file-check-forbidden-skipped',
    zones: ASSET_ZONES,
    files: { 'weights/model.bin': 'binary\n' },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['assets'],
        laws: [{ id: 'a.forbidden', statement: 'No model weights.', checks: [{ type: 'forbidden_file', path: 'weights/model.bin' }] }],
      }),
    },
  })
  const forbiddenResult = await ops.verify({ root: forbidden })
  assert.ok(
    forbiddenResult.problems.some((entry) => entry.code === 'CODE_FORBIDDEN_FILE_PRESENT'),
    `a forbidden file under a walk-skipped name must be seen, got ${JSON.stringify(forbiddenResult.problems.map((entry) => entry.code))}`,
  )

  const required = makeProject({
    name: 'file-check-required-skipped',
    zones: ASSET_ZONES,
    files: { 'weights/model.bin': 'binary\n' },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['assets'],
        laws: [{ id: 'a.required', statement: 'Weights ship.', checks: [{ type: 'required_file', path: 'weights/model.bin' }] }],
      }),
    },
  })
  const requiredResult = await ops.verify({ root: required })
  assert.ok(
    !requiredResult.problems.some((entry) => entry.code === 'CODE_REQUIRED_FILE_MISSING'),
    `a required file under a walk-skipped name exists and must not be reported missing, got ${JSON.stringify(requiredResult.problems.map((entry) => entry.code))}`,
  )

  // The control: a path outside every skip rule behaves exactly the same, so the fix did not
  // special-case one spelling.
  const control = makeProject({
    name: 'file-check-control',
    zones: ASSET_ZONES,
    files: { 'data/model.bin': 'binary\n' },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['assets'],
        laws: [
          { id: 'a.forbidden', statement: 'No model weights.', checks: [{ type: 'forbidden_file', path: 'data/model.bin' }] },
          { id: 'a.missing', statement: 'Absent.', checks: [{ type: 'required_file', path: 'data/absent.bin' }] },
        ],
      }),
    },
  })
  const controlResult = await ops.verify({ root: control })
  const controlCodes = controlResult.problems.map((entry) => entry.code)
  assert.ok(controlCodes.includes('CODE_FORBIDDEN_FILE_PRESENT'), `the control forbidden file is seen: ${JSON.stringify(controlCodes)}`)
  assert.ok(controlCodes.includes('CODE_REQUIRED_FILE_MISSING'), `a genuinely absent file is still reported: ${JSON.stringify(controlCodes)}`)
})

test('verifier: a glob whose literal scope names a walk-skipped directory sees the file there', async () => {
  // The glob kinds matched membership in `listFiles()`, which skips every NEVER_WALK name — so
  // `forbidden_glob: bin/**` reported OK while `bin/tool` existed (a false green) and
  // `required_glob: bin/**` reported the file missing. An explicit scope that NAMES a skipped
  // directory is now walked from that directory, carrying the same work budget. `bin` is used
  // because it is in this repo's NEVER_WALK; `weights` is NOT (it was removed from the list
  // because that made the literal file kinds silently wrong), so the brief's example is kept
  // as a case that behaves correctly either way, and `bin` isolates the fix.
  const ASSET_ZONES = [{ id: 'assets', paths: ['weights/**', 'data/**', 'bin/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }]
  const mk = (name, checks, files) =>
    makeProject({
      name,
      zones: ASSET_ZONES,
      files,
      adrs: {
        '0001-a.adr.md': adrText({
          id: '0001',
          sourceHash: schema.hashSource(SOURCE_TEXT),
          zones: ['assets'],
          laws: [{ id: 'a.glob', statement: 'A glob.', checks }],
        }),
      },
    })

  const forbidden = await ops.verify({ root: mk('glob-forbidden-skipped', [{ type: 'forbidden_glob', pattern: 'bin/**' }], { 'bin/tool': 'binary\n' }) })
  assert.ok(
    forbidden.problems.some((entry) => entry.code === 'CODE_FORBIDDEN_GLOB_PRESENT'),
    `a forbidden file under a walk-skipped scope must be seen, got ${JSON.stringify(forbidden.problems.map((entry) => entry.code))}`,
  )

  const required = await ops.verify({ root: mk('glob-required-skipped', [{ type: 'required_glob', pattern: 'bin/**' }], { 'bin/tool': 'binary\n' }) })
  assert.ok(
    !required.problems.some((entry) => entry.code === 'CODE_REQUIRED_GLOB_MISSING'),
    `a required file under a walk-skipped scope exists and must not be reported missing, got ${JSON.stringify(required.problems.map((entry) => entry.code))}`,
  )

  // The brief's own example: `weights` is not skipped here, but the spelling must still work.
  const weights = await ops.verify({ root: mk('glob-forbidden-weights', [{ type: 'forbidden_glob', pattern: 'weights/**' }], { 'weights/model.bin': 'binary\n' }) })
  assert.ok(weights.problems.some((entry) => entry.code === 'CODE_FORBIDDEN_GLOB_PRESENT'), JSON.stringify(weights.problems.map((entry) => entry.code)))

  // The control: a path outside every skip rule behaves identically — present is present,
  // absent is absent — so the fix is the explicit scope, not a special case for one name.
  const controlPresent = await ops.verify({ root: mk('glob-control-present', [{ type: 'forbidden_glob', pattern: 'data/**' }], { 'data/model.bin': 'binary\n' }) })
  const controlAbsent = await ops.verify({ root: mk('glob-control-absent', [{ type: 'required_glob', pattern: 'data/**' }], {}) })
  const controlPresentCodes = controlPresent.problems.map((entry) => entry.code)
  const controlAbsentCodes = controlAbsent.problems.map((entry) => entry.code)
  assert.ok(controlPresentCodes.includes('CODE_FORBIDDEN_GLOB_PRESENT'), `the control forbidden glob is seen: ${JSON.stringify(controlPresentCodes)}`)
  assert.ok(controlAbsentCodes.includes('CODE_REQUIRED_GLOB_MISSING'), `a genuinely absent control glob is still reported: ${JSON.stringify(controlAbsentCodes)}`)
})

test('verifier: the explicit glob scope widens WHAT is seen but not HOW MUCH may be read', async () => {
  // The NEVER_WALK scope is walked, so the walk must still carry the work budget: a huge
  // `bin/**` scope must exhaust it and fail closed rather than enumerate without bound.
  const files = {}
  for (let index = 0; index < 30; index += 1) files[`bin/f${index}.bin`] = 'x'
  const root = makeProject({
    name: 'glob-scope-budget',
    zones: [{ id: 'assets', paths: ['bin/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }],
    files,
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['assets'],
        laws: [{ id: 'a.glob', statement: 'A glob.', checks: [{ type: 'forbidden_glob', pattern: 'bin/**' }] }],
      }),
    },
  })
  const budget = schema.createWorkBudget({ maxFiles: 5, maxFileBytes: 1000, maxTotalBytes: 10_000 })
  const result = await ops.verify({ root, budget })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'budget')
  assert.ok(budget.exceededCount > 0, 'the scoped walk recorded the stop it made')
})

test('verifier: the literal file kinds follow a symlink to an existing target', async () => {
  // `pathOnDisk` uses `statSync`, which follows a symlink, so a symlink to a real file is seen.
  // A directory symlink inside a check scope is deliberately NOT followed by the glob walk
  // (see `walkProjectFiles`): a recursive walk that followed one could loop or leave the
  // repository, so only an explicitly named path resolves through a link.
  const root = makeProject({
    name: 'file-symlink',
    zones: [{ id: 'assets', paths: ['src/assets/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false }],
    files: { 'src/assets/real.bin': 'binary\n' },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        sourceHash: schema.hashSource(SOURCE_TEXT),
        zones: ['assets'],
        laws: [
          { id: 'a.forbidden', statement: 'No link.', checks: [{ type: 'forbidden_file', path: 'src/assets/link.bin' }] },
          { id: 'a.required', statement: 'Link ships.', checks: [{ type: 'required_file', path: 'src/assets/link.bin' }] },
        ],
      }),
    },
  })
  symlinkSync('real.bin', join(root, 'src', 'assets', 'link.bin'))
  const codes = (await ops.verify({ root })).problems.map((entry) => entry.code)
  assert.ok(codes.includes('CODE_FORBIDDEN_FILE_PRESENT'), `a forbidden symlink whose target exists must be found, got ${JSON.stringify(codes)}`)
  assert.ok(!codes.includes('CODE_REQUIRED_FILE_MISSING'), `a required symlink whose target exists must not be reported missing, got ${JSON.stringify(codes)}`)
})

test('ratify: an amendment that removes law in force is offered to the human, not deadlocked', () => {
  // The lifecycle's own shape: a record that removes an in-force law and restates the decision
  // under a new law id. The consent a removal requires IS the question, so the queue offers it;
  // a record that only removes law in force without restating it is still refused. This is what
  // makes ADR 0043/0045-shaped amendments ratifiable under the queue's contradiction block.
  const amendment = () =>
    makeProject({
      name: 'ratify-amendment-offered',
      zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'proposeOnly', requiresDecisionRecord: false }],
      adrs: {
        '0001-holder.adr.md': adrText({
          id: '0001',
          status: 'active',
          authority: 'human',
          zones: ['tests'],
          laws: [{ id: 'tests.one', statement: 'One.', checks: [] }],
        }),
        '0002-amendment.adr.md': adrText({
          id: '0002',
          status: 'proposed',
          authority: 'agent',
          zones: ['tests'],
          laws: [
            { op: 'remove', id: 'tests.one' },
            { id: 'tests.one-narrowed', statement: 'One, narrowed.', checks: [] },
          ],
        }),
      },
    })
  const root = amendment()
  const queue = ops.ratifications(root)
  assert.deepEqual(queue.blocked, [], 'an amendment is not refused by the queue')
  assert.deepEqual(queue.pending.map((entry) => entry.id), ['0002'], 'it is offered to the human')

  // The write guard is unchanged: the amendment's removal is still a decidable contradiction
  // for the guard, which is why the queue offering it is a change to the QUEUE and not the rule.
  const manifest = compiler.readManifest(root)
  const corpus = compiler.readAdrCorpus(root, manifest.config)
  const resolved = compiler.resolveActiveSet(corpus.records, manifest.config)
  const compiled = compiler.compileLaws(resolved.active, manifest.config)
  const resolutions = compiler.auditedResolutions(corpus.records, {
    active: resolved.active,
    removedByDecision: compiled.removedByDecision,
    problems: corpus.problems,
  })
  const conflicted = compiler.decidableContradictions(
    resolved.proposed.find((record) => record.id === '0002'),
    compiled.bundle.laws,
    { resolutions },
  )
  assert.ok(conflicted.length > 0, 'the guard still sees the removal as a contradiction')

  // A pure removal, with nothing restated, is still refused.
  const pure = makeProject({
    name: 'ratify-pure-removal-refused',
    zones: [{ id: 'tests', paths: ['tests/**'], agentAuthority: 'proposeOnly', requiresDecisionRecord: false }],
    adrs: {
      '0001-holder.adr.md': adrText({ id: '0001', status: 'active', authority: 'human', zones: ['tests'], laws: [{ id: 'tests.one', statement: 'One.', checks: [] }] }),
      '0002-remover.adr.md': adrText({ id: '0002', status: 'proposed', authority: 'agent', zones: ['tests'], laws: [{ op: 'remove', id: 'tests.one' }] }),
    },
  })
  assert.deepEqual(ops.ratifications(pure).pending, [], 'a bare removal is not offered')
  assert.deepEqual(ops.ratifications(pure).blocked.map((entry) => entry.id), ['0002'])
})

// ---------------------------------------------------------------------------
// the in-process work budget: bound the event loop, fail closed, report it
//
// The tool surface (`ratchet_status`, `ratchet_compile`, `ratchet_verify`) runs IN the
// harness process, on its single event loop, and a synchronous read or a catastrophic
// regex freezes every session in that process. Each test below pins one of the measured
// findings: the defect it reproduces and the behaviour that must hold instead.
// ---------------------------------------------------------------------------

const BUDGET_LIMITS = { maxFiles: 100, maxFileBytes: 100, maxTotalBytes: 100_000 }

test('verifier: the code hash bounds the number of files it stat/reads', () => {
  // Finding 1: `codeHashFor` stat'ed and read every file, so 50,000 empty files cost ~7.5 s
  // even though none held a byte. Content past the FILE-COUNT cap is contributed as path only,
  // and a path-only contribution is deterministic but content-blind by design.
  const root = makeProject({
    name: 'hash-file-count',
    adrs: {},
    files: { 'src/a.ts': 'A\n', 'src/b.ts': 'B\n', 'src/c.ts': 'C\n' },
  })
  const files = ['src/a.ts', 'src/b.ts', 'src/c.ts']
  const before = verifier.codeHashFor(root, files, { maxFiles: 2, maxFileBytes: 1024, maxTotalBytes: 1024 * 1024 })
  writeFileSync(join(root, 'src', 'c.ts'), 'C-changed\n')
  const afterTail = verifier.codeHashFor(root, files, { maxFiles: 2, maxFileBytes: 1024, maxTotalBytes: 1024 * 1024 })
  assert.equal(afterTail, before, 'a file past the count cap was read as content, so the syscall bound is not real')
  writeFileSync(join(root, 'src', 'a.ts'), 'A-changed\n')
  const afterHead = verifier.codeHashFor(root, files, { maxFiles: 2, maxFileBytes: 1024, maxTotalBytes: 1024 * 1024 })
  assert.notEqual(afterHead, before, 'a file within the count cap must still move the hash')
})

test('verifier: a small file always moves the code hash, even after the total byte budget is spent', () => {
  // Finding 1's second half: charging the total budget in sorted order made every later file
  // content-blind, so once 64 MiB had been read a 29-byte file's edit stopped moving the hash.
  // A file at or below the small-file threshold is now ALWAYS read from its content.
  const root = makeProject({
    name: 'hash-small-after-budget',
    adrs: {},
    files: { 'src/a-fill.ts': 'x'.repeat(1000), 'src/z-small.ts': 'tiny' },
  })
  const files = ['src/a-fill.ts', 'src/z-small.ts']
  const options = { maxFiles: 100, maxFileBytes: 10_000, maxTotalBytes: 1000 }
  const before = verifier.codeHashFor(root, files, options)
  writeFileSync(join(root, 'src', 'z-small.ts'), 'TINY')
  const after = verifier.codeHashFor(root, files, options)
  assert.notEqual(
    before,
    after,
    'a 4-byte file went content-blind once the total byte budget was spent; its same-size edit stopped moving the hash',
  )
})

test('verifier: an oversized file is REPORTED as CODE_FILE_TOO_LARGE, never read', async () => {
  // Finding 2: a `forbidden_text` law over twelve 500 MB files blocked the loop for 15,101 ms
  // because `readProjectFile` read each whole. A file above the per-file cap is now a reported
  // problem, and the operation fails closed rather than passing over a file nobody read.
  const result = await verifyRawLaws(
    'text-too-large',
    [{ type: 'forbidden_text', paths: ['src/auth/**'], pattern: 'TODO' }],
    {
      files: { 'src/auth/big.ts': 'x'.repeat(5000) },
      budget: schema.createWorkBudget(BUDGET_LIMITS),
    },
  )
  assert.ok(result.codes.includes('CODE_FILE_TOO_LARGE'), JSON.stringify(result.codes))
  assert.ok(result.codes.includes('WORK_BUDGET_EXCEEDED'), JSON.stringify(result.codes))
})

test('verifier: selectFiles is linear in the number of files', () => {
  // Finding 3: `selected.includes(file)` in a loop was O(n^2) — 20k files 2.6 s, 40k 21 s,
  // 80k 102 s, which was most of a 147-second verify. The bound is generous against a linear
  // pass and far below the old quadratic cost, so a reintroduced scan fails here.
  const files = []
  for (let index = 0; index < 40_000; index += 1) files.push(`src/auth/f${index}.ts`)
  const started = Date.now()
  const selected = verifier.selectFiles(files, ['src/auth/**'])
  const elapsed = Date.now() - started
  assert.equal(selected.length, 40_000)
  assert.ok(elapsed < 5000, `selectFiles took ${elapsed}ms over 40000 files (the quadratic loop took ~21s)`)
})

test('compiler: a catastrophic regex is refused as REGEX_UNSAFE where the corpus is compiled', () => {
  // Finding 4: `(a+)+$` over a 29-byte file blocked 34,654 ms. The pattern is refused where the
  // decision is compiled, so a corpus carrying it never reaches the verifier at all.
  const root = makeProject({
    name: 'regex-unsafe-compile',
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [{ id: 'a.one', statement: 'One.', checks: [{ type: 'forbidden_text', paths: ['src/auth/**'], pattern: '(a+)+$' }] }],
      }),
    },
  })
  const result = compile(root)
  assert.ok(result.codes.includes('REGEX_UNSAFE'), JSON.stringify(result.codes))
})

test('verifier: a catastrophic regex is refused as REGEX_UNSAFE instead of executed', async () => {
  // The same refusal on the verifier path, because a bundle from another ratchet can carry a
  // pattern the compiler here never saw. The bound is the point: the match must not run.
  const started = Date.now()
  const result = await verifyRawLaws(
    'regex-unsafe-verify',
    [{ type: 'forbidden_text', paths: ['src/auth/**'], pattern: '(a+)+$' }],
    { files: { 'src/auth/x.ts': `${'a'.repeat(28)}b` } },
  )
  const elapsed = Date.now() - started
  assert.ok(result.codes.includes('REGEX_UNSAFE'), JSON.stringify(result.codes))
  assert.ok(elapsed < 5000, `an unsafe pattern was executed and cost ${elapsed}ms`)
})

test('compiler: an oversized ADR is reported as ADR_TOO_LARGE, not read', () => {
  // Finding 5: `compile`/`status` read every ADR whole; a 500 MB record blocked ~3 s. The
  // manifest read is budgeted too (it was one of the unbudgeted in-process paths), so the cap
  // is derived from the fixture: it must let the manifest through for the ADR read to be
  // reached. A flat cap of 100 failed closed on the manifest instead of the ADR — still no
  // verdict, but the record named was the wrong one.
  const root = makeProject({
    name: 'adr-too-large',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'a.one', statement: 'One.', checks: [] }] }),
    },
  })
  const manifestBytes = readFileSync(join(root, '.dsh', 'project.json')).length
  // The fixture ADR is smaller than the generated manifest, so pad it past the manifest-sized
  // cap: this test isolates the ADR read, not the manifest read.
  const adrPath = join(root, 'docs', 'adrs', '0001-a.adr.md')
  writeFileSync(adrPath, `${readFileSync(adrPath, 'utf8')}\n${'x'.repeat(manifestBytes + 200)}\n`)
  assert.ok(readFileSync(adrPath).length > manifestBytes + 1)
  const budget = schema.createWorkBudget({ maxFiles: 100, maxFileBytes: manifestBytes + 1, maxTotalBytes: 1_000_000 })
  const result = compiler.compileProject(root, { budget })
  assert.ok(result.problems.some((entry) => entry.code === 'ADR_TOO_LARGE'), JSON.stringify(result.problems.map((entry) => entry.code)))
  assert.ok(result.problems.some((entry) => entry.code === 'WORK_BUDGET_EXCEEDED'))
  assert.equal(result.ok, false)
})

test('compiler: an oversized cited source is reported as ADR_TOO_LARGE, not read', () => {
  // The other half of finding 5: the source a record cites is hashed whole, and a 500 MB source
  // blocked the loop too. The record still parses; the problem is about its evidence.
  const root = makeProject({
    name: 'source-too-large',
    adrs: {
      '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'a.one', statement: 'One.', checks: [] }] }),
    },
  })
  writeFileSync(join(root, SOURCE_PATH), 'y'.repeat(3000))
  const budget = schema.createWorkBudget({ maxFiles: 100, maxFileBytes: 2000, maxTotalBytes: 100_000 })
  const result = compiler.compileProject(root, { budget })
  assert.ok(result.problems.some((entry) => entry.code === 'ADR_TOO_LARGE' && entry.path !== undefined), JSON.stringify(result.problems.map((entry) => entry.code)))
  assert.equal(result.ok, false)
})

test('verifier: an oversized dependency manifest is reported, not read', () => {
  // Finding 6: `readDeclaredDependencies` read every package.json whole; a 300 MB manifest
  // blocked 1.3 s. The cap makes it a problem, and the names it declares are NOT harvested.
  const root = makeProject({
    name: 'dep-too-large',
    adrs: {},
    files: { 'package.json': `${JSON.stringify({ dependencies: { redis: '^1' } })}${' '.repeat(3000)}` },
  })
  const files = verifier.listFiles(root)
  const budget = schema.createWorkBudget({ maxFiles: 100, maxFileBytes: 100, maxTotalBytes: 1_000_000 })
  const result = verifier.readDeclaredDependencies(root, files, null, budget)
  assert.ok(result.problems.some((entry) => entry.code === 'CODE_FILE_TOO_LARGE'), JSON.stringify(result.problems.map((entry) => entry.code)))
  assert.equal(result.names.has('redis'), false, 'an oversized manifest must not have been read')
})

test('verifier: listFiles stops at the budget and records the stop', () => {
  // Part of finding 7: the walk itself is a syscall per directory and entry, so a budget that
  // only bounded reads still left the loop enumerating a huge tree.
  const files = {}
  for (let index = 0; index < 20; index += 1) files[`src/auth/f${index}.ts`] = 'x'
  const root = makeProject({ name: 'walk-budget', adrs: {}, files })
  const budget = schema.createWorkBudget({ maxFiles: 5, maxFileBytes: 1000, maxTotalBytes: 10_000 })
  const walked = verifier.listFiles(root, '', budget)
  assert.ok(walked.length <= 6, `the walk returned ${walked.length} files past a 5-file budget`)
  assert.ok(budget.exceededCount > 0, 'the walk did not record the stop it made')
})

test('compiler: readManifest obeys the work budget and reports rather than opening an oversized manifest', () => {
  // GAP: `readManifest` read `.dsh/project.json` whole on every in-process call, outside the
  // budget the rest of the operation carried. The manifest is small in every real project, so
  // the regression is pinned with a per-file cap below its ordinary size.
  const root = makeProject({ name: 'manifest-budget', adrs: {} })
  const budget = schema.createWorkBudget({ maxFiles: 100, maxFileBytes: 10, maxTotalBytes: 1_000_000 })
  const read = compiler.readManifest(root, budget)
  assert.equal(read.config, null, 'an over-budget manifest yields no configuration')
  assert.ok(read.problems.some((entry) => entry.code === 'CODE_FILE_TOO_LARGE'), JSON.stringify(read.problems.map((entry) => entry.code)))
  assert.ok(budget.exceededCount > 0, 'the refusal is recorded on the operation tracker, so the operation has no verdict')
})

test('state: detectSpecDrift obeys the work budget and refuses a non-regular card', () => {
  // GAP: the drift check read every generated card whole on the in-process path. These two
  // fixtures are the two refusals: a card above the cap, and a path that is not a regular file.
  const root = makeProject({ name: 'spec-drift-budget', adrs: {} })
  mkdirSync(join(root, 'docs', 'specs'), { recursive: true })
  writeFileSync(join(root, 'docs', 'specs', 'api.spec.md'), `<!-- spec-hash: sha256:${'a'.repeat(64)} -->\n${'x'.repeat(500)}\n`)
  const files = { 'docs/specs/api.spec.md': 'different\n' }
  const budget = schema.createWorkBudget({ maxFiles: 100, maxFileBytes: 100, maxTotalBytes: 1_000_000 })
  const overBudget = state.detectSpecDrift(root, files, 'docs/specs', budget)
  assert.deepEqual(overBudget.drifted.map((entry) => entry.path), ['docs/specs/api.spec.md'], JSON.stringify(overBudget))
  assert.ok(budget.exceededCount > 0, 'the oversized card is recorded on the tracker')

  const nonRegularRoot = makeProject({ name: 'spec-drift-non-regular', adrs: {} })
  mkdirSync(join(nonRegularRoot, 'docs', 'specs', 'api.spec.md'), { recursive: true })
  const nonRegular = state.detectSpecDrift(nonRegularRoot, files, 'docs/specs', null)
  assert.equal(nonRegular.drifted.length, 1)
  assert.match(nonRegular.drifted[0].reason, /not a regular file/)
})

test('ops: ratify carries the in-process work budget and mints nothing when it is exhausted', () => {
  // GAP: `ops.ratify` recompiled with `compileProject(root)` unbudgeted. This is the CONSENT
  // path the panel's click reaches, so the budget is asserted here: with a cap below the
  // manifest's size the queue itself refuses, no approval is written, and the problem is the
  // budget code rather than a hang.
  const { root } = ratifiableProject('ratify-budget')
  const budget = schema.createWorkBudget({ maxFiles: 100, maxFileBytes: 50, maxTotalBytes: 1_000_000 })
  const result = ops.ratify({ root, budget })
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((entry) => entry.code === 'CODE_FILE_TOO_LARGE'), JSON.stringify(result.problems.map((entry) => entry.code)))
  assert.deepEqual(readdirSync(join(root, 'docs', 'adrs')), ['0011-agent.adr.md'], 'a budget-exhausted ratification writes no approval')
})

test('ingest: a FIFO source is refused with CODE_FILE_NOT_REGULAR and never opened', { skip: process.platform === 'win32' ? 'FIFOs are a POSIX facility' : false }, () => {
  // GAP: any read of a project file that is a FIFO or device node blocked `readFileSync`
  // forever (the breaker measured `timeout 8` exiting 124 on an ingest source FIFO). The
  // refusal is asserted in a CHILD process with a timeout, so a regression fails this test
  // instead of hanging the suite.
  const root = makeProject({ name: 'fifo-source', adrs: {} })
  mkdirSync(join(root, 'docs', 'ratchet', 'sources'), { recursive: true })
  const fifo = join(root, 'docs', 'ratchet', 'sources', 'pipe.md')
  execFileSync('mkfifo', [fifo])
  assert.ok(existsSync(fifo))

  const script = `
import { ingest } from ${JSON.stringify(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-ops.mjs`)}
const result = await ingest({ root: ${JSON.stringify(root)}, sourcePath: 'docs/ratchet/sources/pipe.md', budget: null })
console.log(JSON.stringify({ codes: (result.problems ?? []).map((entry) => entry.code) }))
`
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5000 })
  assert.match(output, /CODE_FILE_NOT_REGULAR/, `a FIFO source must be refused, got ${output}`)
})

test('ops: an exhausted work budget fails closed with WORK_BUDGET_EXCEEDED and no verdict', async () => {
  // Finding 7: the tool path must carry a conservative budget, and ops must return a problem
  // and NO verdict when it is exceeded. The oversized file is above the per-file cap, so the
  // verification may not persist a partial read as this project's current verdict.
  const root = makeProject({
    name: 'ops-budget',
    files: { 'src/auth/big.ts': 'x'.repeat(20_000) },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [{ id: 'auth.check', statement: 'Enforced.', checks: [{ type: 'forbidden_text', paths: ['src/auth/**'], pattern: 'TODO' }] }],
      }),
    },
  })
  const budget = schema.createWorkBudget({ maxFiles: 100, maxFileBytes: 5000, maxTotalBytes: 100_000 })
  const result = await ops.verify({ root, budget })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'budget')
  assert.ok(result.problems.some((entry) => entry.code === 'WORK_BUDGET_EXCEEDED'), JSON.stringify(result.problems.map((entry) => entry.code)))
  assert.ok(result.problems.some((entry) => entry.code === 'CODE_FILE_TOO_LARGE'))
  assert.equal(
    existsSync(join(root, 'reports', 'ratchet', 'verify-report.json')),
    false,
    'a budget-exhausted verification must not persist a verdict about part of the tree',
  )
})

test('tool: ratchet_verify passes the in-process work budget and returns no verdict', { skip: HARNESS_SKIP }, async () => {
  // The enforcement point for finding 7 on the surface an agent actually calls: the tool must
  // pass `createWorkBudget()` into ops, and an oversized file must produce a reported problem
  // rather than a 3 MiB synchronous read on the harness event loop.
  const root = makeProject({
    name: 'tool-budget',
    files: { 'src/auth/big.ts': 'x'.repeat(3 * 1024 * 1024) },
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [{ id: 'auth.check', statement: 'Enforced.', checks: [{ type: 'forbidden_text', paths: ['src/auth/**'], pattern: 'TODO' }] }],
      }),
    },
  })
  const registered = toolHarness()
  const tool = registered.get('ratchet_verify')
  assert.ok(tool !== undefined, 'the verify tool is registered')
  const result = await tool.execute({ root }, { agent: { id: 'session-tool-budget', session: { header: { cwd: root } } } })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'budget')
  assert.ok(result.problems.some((entry) => entry.code === 'WORK_BUDGET_EXCEEDED'), JSON.stringify(result.problems?.map((entry) => entry.code)))
  assert.ok(result.problems.some((entry) => entry.code === 'CODE_FILE_TOO_LARGE'))
  assert.equal(existsSync(join(root, 'reports', 'ratchet', 'verify-report.json')), false)
})

// ---------------------------------------------------------------------------
// the zone report: the authority table drifts, and this is what sees it
// ---------------------------------------------------------------------------

test('zones: a record referencing an undeclared zone is reported, with the paths inferred from its laws', () => {
  const root = makeProject({
    name: 'zones-undeclared',
    zones: [{ id: 'engine', paths: ['packages/engine/**'], agentAuthority: 'activeIfNoConflict' }],
    adrs: {
      '0001-art.adr.md': adrText({
        id: '0001',
        zones: ['art'],
        laws: [
          {
            id: 'art.projection',
            statement: 'The camera is a plan view.',
            checks: [{ type: 'required_text', pattern: 'plan view', paths: ['packages/renderer/**'] }],
          },
        ],
      }),
    },
    files: { 'packages/renderer/x.ts': 'plan view' },
  })
  const run = cli(['zones', '--root', root, '--json'])
  assert.equal(run.status, 1, `zones over an undeclared reference must fail the command: ${run.stdout}${run.stderr}`)
  const report = JSON.parse(run.stdout)
  const entry = report.undeclared.find((candidate) => candidate.id === 'art')
  assert.ok(entry !== undefined, `expected an undeclared "art" entry, got ${JSON.stringify(report.undeclared)}`)
  assert.deepEqual(entry.records, ['0001'])
  assert.deepEqual(entry.inferredPaths, ['packages/renderer/**'])
  assert.equal(entry.suggestedAuthority, 'proposeOnly')
  assert.ok(report.problems.some((problem) => problem.code === 'ZONE_UNDECLARED_REFERENCE'))
})

test('zones --write drafts the declaration it proposes, and never overwrites an existing draft', () => {
  const root = makeProject({
    name: 'zones-draft',
    zones: [{ id: 'engine', paths: ['packages/engine/**'], agentAuthority: 'activeIfNoConflict' }],
    adrs: {
      '0001-art.adr.md': adrText({
        id: '0001',
        zones: ['art'],
        laws: [
          {
            id: 'art.projection',
            statement: 'The camera is a plan view.',
            checks: [{ type: 'required_text', pattern: 'plan view', paths: ['packages/renderer/**'] }],
          },
        ],
      }),
    },
    files: { 'packages/renderer/x.ts': 'plan view' },
  })
  const first = cli(['zones', '--root', root, '--write', '--json'])
  assert.equal(first.status, 1, `drafting still reports the problem: ${first.stdout}`)
  const draftPath = join(root, 'reports', 'ratchet', 'drafts', 'zone-art.md')
  assert.ok(existsSync(draftPath), 'the draft was written')
  const text = readFileSync(draftPath, 'utf8')
  assert.match(text, /"id": "art"/)
  assert.match(text, /packages\/renderer\/\*\*/)
  const second = JSON.parse(cli(['zones', '--root', root, '--write', '--json']).stdout)
  assert.ok(second.drafts.skipped.some((path) => path.endsWith('zone-art.md')), 'a second run keeps the draft it found')
  assert.equal(second.drafts.written.length, 0)
})

test('zones: a project whose every referenced zone is declared reports ok and prints its marker', () => {
  const root = makeProject({
    name: 'zones-clean',
    zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'activeIfNoConflict' }],
    adrs: {
      '0001-a.adr.md': adrText({
        id: '0001',
        zones: ['auth'],
        laws: [
          { id: 'auth.one', statement: 'Sessions use Redis.', checks: [{ type: 'required_text', pattern: 'redis', paths: ['src/auth/**'] }] },
        ],
      }),
    },
    files: { 'src/auth/x.ts': 'redis' },
  })
  const run = cli(['zones', '--root', root])
  assert.equal(run.status, 0, `a clean authority table is exit 0: ${run.stdout}${run.stderr}`)
  assert.match(run.stdout, /zones ok/)
})

// ---------------------------------------------------------------------------
// the resolve plan: a blocked record becomes pending WITH the steps that unblock it
// ---------------------------------------------------------------------------

test('resolve: an undeclared zone yields a declare-zone step with the paths inferred from the record laws', () => {
  const root = makeProject({
    name: 'resolve-undeclared',
    zones: [{ id: 'engine', paths: ['packages/engine/**'], agentAuthority: 'activeIfNoConflict' }],
    adrs: {
      '0001-art.adr.md': adrText({
        id: '0001',
        zones: ['art'],
        laws: [
          { id: 'art.projection', statement: 'The camera is a plan view.', checks: [{ type: 'required_text', pattern: 'plan view', paths: ['packages/renderer/**'] }] },
        ],
      }),
    },
    files: { 'packages/renderer/x.ts': 'plan view' },
  })
  const run = cli(['resolve', '0001', '--root', root, '--json'])
  assert.equal(run.status, 0, `a record with an automatable plan is exit 0: ${run.stdout}${run.stderr}`)
  const plan = JSON.parse(run.stdout)
  const step = plan.steps.find((candidate) => candidate.op === 'declare-zone')
  assert.ok(step !== undefined, `expected a declare-zone step, got ${JSON.stringify(plan.steps)}`)
  assert.equal(step.zone, 'art')
  assert.deepEqual(step.paths, ['packages/renderer/**'])
  assert.equal(step.agentAuthority, 'proposeOnly')
  assert.equal(plan.humanRequired, false, 'the zone can be declared by an agent; the consent stays a human act')
})

test('resolve: a humanOnly zone is reported as requiring a human, never as an automatable step', () => {
  const root = makeProject({
    name: 'resolve-human',
    zones: [{ id: 'sim', paths: ['src/sim/**'], agentAuthority: 'humanOnly' }],
    adrs: {
      '0001-sim.adr.md': adrText({
        id: '0001',
        authority: 'agent',
        status: 'proposed',
        zones: ['sim'],
        laws: [{ id: 'sim.one', statement: 'One.', checks: [{ type: 'required_text', pattern: 'x', paths: ['src/sim/**'] }] }],
      }),
    },
    files: { 'src/sim/x.ts': 'x' },
  })
  const run = cli(['resolve', '0001', '--root', root, '--json'])
  assert.equal(run.status, 0, `the plan is reported whatever it says: ${run.stdout}`)
  const plan = JSON.parse(run.stdout)
  assert.equal(plan.humanRequired, true)
  assert.ok(plan.steps.some((step) => step.op === 'human-authorship-required'))
})

test('resolve: an unknown record is a reason, not a crash', () => {
  const root = makeProject({ name: 'resolve-missing', adrs: {} })
  const run = cli(['resolve', '9999', '--root', root, '--json'])
  assert.equal(run.status, 1, `an unknown id is a finding: ${run.stdout}`)
  assert.match(JSON.parse(run.stdout).reason, /9999/)
})
