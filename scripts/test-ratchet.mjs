import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const PLUGIN = resolve(import.meta.dirname, '..', 'plugins', 'ratchet')
const CLI = join(PLUGIN, 'ratchet-cli.mjs')

const schema = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-schema.mjs`)
const compiler = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-compiler.mjs`)
const verifier = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-verifier.mjs`)
const ops = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-ops.mjs`)
const dynamic = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-dynamic.mjs`)
const state = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-state.mjs`)
const ratifyModule = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-ratify.mjs`)
const ratchetBootstrap = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-bootstrap.mjs`)
const falsifyModule = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-falsify.mjs`)

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
  const result = await verifyOneLaw('reqglob', [{ type: 'required_glob', pattern: 'tests/auth/**' }])
  assert.deepEqual(result.codes, ['CODE_REQUIRED_GLOB_MISSING'])
})

test('verifier: forbidden_glob reports the offending matches', async () => {
  const result = await verifyOneLaw('forbglob', [{ type: 'forbidden_glob', pattern: 'src/legacy/**' }], {
    files: { 'src/legacy/old.ts': 'x\n', 'src/legacy/older.ts': 'y\n' },
  })
  assert.deepEqual(result.codes, ['CODE_FORBIDDEN_GLOB_PRESENT'])
  assert.equal(result.problems[0].matches.length, 2)
})

test('verifier: required_text fails when no file matches the paths, and says nothing was searched', async () => {
  const result = await verifyOneLaw('reqtext-noscope', [{ type: 'required_text', paths: ['src/auth/**'], pattern: 'redis' }])
  assert.deepEqual(result.codes, ['CODE_REQUIRED_TEXT_MISSING'])
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
  const result = await verifyOneLaw('boundary-inert', [{ type: 'path_boundary', zone: 'auth', deny: ['src/legacy/**'] }])
  assert.deepEqual(result.codes, ['DYNAMIC_REVIEW_REQUIRED'])
  assert.ok(result.problems[0].message.includes('cannot match a file the zone owns'))
})

test('verifier: a deny that only LOOKS disjoint is not reported inert', async () => {
  // The proof, not a guess. The first overlap test compared the two globs as path
  // strings, so `**/legacy/**` вЂ” which matches `src/auth/legacy/old.ts`, and does so
  // through the same `matchFiles` the check itself uses вЂ” was declared non-overlapping
  // and a law that HOLDS over a clean tree was reported broken with a false reason.
  const leadingWildcard = await verifyOneLaw('boundary-leading-wildcard', [
    { type: 'path_boundary', zone: 'auth', deny: ['**/legacy/**'] },
  ])
  assert.deepEqual(leadingWildcard.codes, [], 'a deny that can match is never called inert')

  // And the same deny still fires when a file actually crosses it.
  const crossed = await verifyOneLaw(
    'boundary-leading-wildcard-hit',
    [{ type: 'path_boundary', zone: 'auth', deny: ['**/legacy/**'] }],
    { files: { 'src/auth/legacy/old.ts': 'x\n' } },
  )
  assert.deepEqual(crossed.codes, ['CODE_FORBIDDEN_GLOB_PRESENT'])

  // A wildcard in the middle of a prefix keeps the prefix it can still prove.
  const suffixWildcard = await verifyOneLaw('boundary-suffix-wildcard', [
    { type: 'path_boundary', zone: 'auth', deny: ['**/*.tmp'] },
  ])
  assert.deepEqual(suffixWildcard.codes, [])

  // A wildcard segment ends the provable prefix, so a deny that diverges only AFTER
  // one is ambiguous rather than proven disjoint. Ambiguity is never reported as
  // inert: the check asks for judgement instead of inventing a verdict.
  const dirWildcard = await verifyOneLaw('boundary-dir-wildcard', [
    { type: 'path_boundary', zone: 'auth', deny: ['src/legacy-*/*.ts'] },
  ])
  assert.deepEqual(dirWildcard.codes, [], 'an ambiguous deny is not called inert')

  // And a divergence in the literal prefix is still provable, wildcards or not.
  const literalDivergence = await verifyOneLaw('boundary-literal-divergence', [
    { type: 'path_boundary', zone: 'auth', deny: ['src/legacy/*.ts'] },
  ])
  assert.deepEqual(literalDivergence.codes, ['DYNAMIC_REVIEW_REQUIRED'], 'a wildcard AFTER a diverging literal segment is still a proof')

  const noLiteralAtAll = await verifyOneLaw('boundary-no-literal', [
    { type: 'path_boundary', zone: 'auth', deny: ['*/**'] },
  ])
  assert.deepEqual(noLiteralAtAll.codes, [], 'a deny with no literal segment could match anything, so nothing is proven')
})

test('verifier: path_boundary naming an undeclared zone is reported as LAW_ZONE_MISSING', async () => {
  const result = await verifyOneLaw('boundary-nozone', [{ type: 'path_boundary', zone: 'nosuch', deny: ['src/**'] }])
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

/** A subagent runtime stub that records every spawn and answers a clean verdict. */
function stubRuntime(spawned) {
  return {
    async start(provider, options) {
      spawned.push({ provider, options })
      return {
        result: Promise.resolve({ structured: { ok: true, findings: [] }, output: [], stopReason: 'completed' }),
        dispose: async () => {},
      }
    },
  }
}

test('compile: a judgement the compiler asked for is made, not merely recorded', { skip: HARNESS_SKIP }, async () => {
  const root = ambiguousProject('compile-trigger')
  const compiled = compile(root)
  assert.ok(compiled.report.reviewRequired.length > 0, 'the fixture must be one the compiler cannot decide')

  const spawned = []
  const agent = { id: 'agent-root', session: { header: { cwd: root } } }
  const definitions = mountPlugin({ subagents: stubRuntime(spawned), agents: { roots: () => [agent] } })
  const result = await definitions.get('ratchet_compile').execute({}, { agent })

  assert.equal(result.dynamicReview.ran, true, `expected the review to run: ${JSON.stringify(result.dynamicReview)}`)
  assert.equal(spawned.length, 1, 'exactly one judge, for one marked question')
  assert.match(String(spawned[0].options.prompt[0].text), /auth\.shared/, 'the judge is asked about the corpus that raised the question')
  assert.equal(result.dynamicReview.advisory, true)
  assert.equal(result.dynamicReview.gate, false, 'a review never becomes the gate')
})

test('compile: a judge cannot start a review of its own, and says so', { skip: HARNESS_SKIP }, async () => {
  const root = ambiguousProject('compile-trigger-child')
  const spawned = []
  // The same runtime, but the registry does not list this caller as a root вЂ” which
  // is exactly what a spawned judge looks like from inside its own tool call.
  const agent = { id: 'agent-child', session: { header: { cwd: root } } }
  const definitions = mountPlugin({ subagents: stubRuntime(spawned), agents: { roots: () => [] } })
  const result = await definitions.get('ratchet_compile').execute({}, { agent })

  assert.equal(result.dynamicReview.ran, false)
  assert.match(result.dynamicReview.reason, /root/)
  assert.equal(spawned.length, 0, 'no judge was spawned from inside a judge')
})

test('compile: the trigger is skippable, and a composition with no judge reports that', { skip: HARNESS_SKIP }, async () => {
  const root = ambiguousProject('compile-trigger-off')
  const spawned = []
  const agent = { id: 'agent-root', session: { header: { cwd: root } } }

  const off = mountPlugin({ subagents: stubRuntime(spawned), agents: { roots: () => [agent] } })
  const offResult = await off.get('ratchet_compile').execute({ review: false }, { agent })
  assert.equal(offResult.dynamicReview, undefined, 'review: false keeps the compile purely static')
  assert.equal(spawned.length, 0)

  const noJudge = mountPlugin({ agents: { roots: () => [agent] } })
  const noJudgeResult = await noJudge.get('ratchet_compile').execute({}, { agent })
  assert.equal(noJudgeResult.dynamicReview.ran, false)
  assert.match(noJudgeResult.dynamicReview.reason, /cannot spawn a judge/)

  const clean = makeProject({
    name: 'compile-trigger-clean',
    adrs: { '0001-a.adr.md': adrText({ id: '0001', zones: ['auth'], laws: [{ id: 'auth.one', statement: 'One.', checks: [] }] }) },
  })
  const cleanAgent = { id: 'agent-root', session: { header: { cwd: clean } } }
  const cleanDefs = mountPlugin({ subagents: stubRuntime(spawned), agents: { roots: () => [cleanAgent] } })
  const cleanResult = await cleanDefs.get('ratchet_compile').execute({}, { cleanAgent })
  assert.equal(cleanResult.dynamicReview, undefined, 'a corpus with nothing to judge pays no judge')
  assert.equal(spawned.length, 0)
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
  assert.ok(after.problems.some((entry) => entry.code === 'SPEC_OUT_OF_DATE'))
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
          explanation: 'The change reintroduces a file-backed adapter.',
          suggestedAction: 'Remove it or supersede the decision.',
        },
      ],
    },
    { lawIds: ['auth.session-storage.redis'], adrIds: ['0001'] },
  )
  assert.equal(result.problems.length, 0)
  assert.equal(result.findings.length, 1)
  assert.equal(result.ok, false, "the judge's own ok is preserved")
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
  assert.equal(result.gate, false)
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].lawId, 'auth.session-storage.redis')
  assert.equal(result.verdictSource, 'structured')
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
      '0001-p.adr.md': adrText({ id: '0001', status: 'proposed', authority: 'agent', zones: ['auth'], laws: [{ id: 'a.b', statement: 'S.', checks: [{ type: 'required_file', path: 'x.ts' }] }] }),
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
  assert.ok(result.dropped.some((entry) => /cannot write into a record/.test(entry.reason)), 'a field the renderer would silently omit is refused')
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
  assert.equal(result.problems[0].code, 'CODE_TEXT_FORBIDDEN_PRESENT')
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
    // Codes are emitted through the `problem('CODE', вЂ¦)` helper; matching that call
    // shape avoids counting a code mentioned in a comment or a message.
    for (const match of text.matchAll(/\bproblem\(\s*'([A-Z][A-Z0-9_]{3,})'/g)) {
      if (!declared.has(match[1])) offenders.push(`${file.replace(KIT_ROOT, '')}: ${match[1]}`)
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
    'scripts/kit-update.mjs',
    'scripts/dev-link.mjs',
    'scripts/test-ratchet.mjs',
    'scripts/check-portability.mjs',
    'profile/cordis.patch.yml',
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
  const broken = patch.replace(/(- id: agent-instructions\s*\n\s*disabled:\s*)true/, '$1false')
  assert.notEqual(broken, patch, 'the fixture must actually change the disabling row')
  writeFileSync(patchPath, broken)
  const mutated = run()
  assert.equal(mutated.status, 1, 're-enabling that loader must fail the check')
  assert.match(mutated.stderr, /workspace-instruction loader is disabled/)
  rmSync(tree, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// ratification: the human question, the recorded consent, and the hash binding them
// ---------------------------------------------------------------------------

/** A project whose single agent decision is proposed in a proposeOnly zone. */
function ratifiableProject(name, { zone = 'api', extraAdrs = {}, extraFiles = {} } = {}) {
  const target = adrText({
    id: '0011',
    status: 'proposed',
    authority: 'agent',
    zones: [zone],
    laws: [{ id: 'api.x', statement: 'Agent law.', checks: [] }],
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

test('ratify: a rejected answer writes nothing and leaves the record proposed', () => {
  const { root } = ratifiableProject('ratify-reject')
  const prepared = ops.ratify({ root })
  const result = ops.ratify({ root, answer: answerWith(prepared.quiz, ['Reject']), quiz: prepared.quiz, at: '2026-09-14T09:00:00Z' })

  assert.deepEqual(result.ratified, [])
  assert.deepEqual(result.rejected, ['0011'])
  assert.deepEqual(result.wrote, [])
  assert.equal(readdirSync(join(root, 'docs', 'adrs')).filter((name) => name.endsWith('.adr.md')).length, 1)
  assert.deepEqual(compile(root).laws, [])
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
  assert.deepEqual(result.problems.map((entry) => entry.code), ['CODE_TEXT_FORBIDDEN_PRESENT'])
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
  assert.deepEqual(Object.keys(parameters.properties ?? {}), ['ids'], 'the only argument is which records to ask about')
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

test('falsify: an out-of-scope target is reported and never written', async () => {
  // The only writable zone is src/auth/**, so a law naming outside/ is out of scope
  // even though the file exists. Breaking it would prove nothing about the project's
  // declared scope, so the breaker must refuse and leave the file untouched.
  const root = falsifiableProject('falsify-out-of-scope', {
    zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly', requiresDecisionRecord: true }],
    requiredFile: 'outside/keep.ts',
  })
  const before = readFileSync(join(root, 'outside/keep.ts'))
  const result = await falsifyModule.falsify({ root })
  const required = result.cases.find((entry) => entry.id === 'required-file-missing')
  assert.equal(required.status, 'out-of-scope', JSON.stringify(required))
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

test('falsify: SIGTERM mid-run restores the in-flight mutation and the persisted state', async () => {
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
