/**
 * PURPOSE
 *   Enforce, behaviourally, that the gate still CATCHES the breakage each of its
 *   laws exists for. Every assertion here drives the production modules
 *   (schema, compiler, verifier) over a synthetic project and requires the wrong
 *   verdict to be refused.
 *
 *   It exists because a `command` check is only as strong as the command, and the
 *   kit's laws were asserting on a test runner's output — `outputContains:
 *   "fail 0"`, which any green run prints, including a run of an EMPTY test file.
 *   The measured consequence: a mutation that made a law with no check and no
 *   stated reason pass silently, combined with deleting the BODY of the one test
 *   that covered it, left the suite at "240 pass / 0 fail" and the gate green.
 *   A test-name assertion cannot tell "the test asserted" from "the test exists".
 *
 *   This script is the independent enforcement point for that class of failure.
 *   It does not read the test suite, it does not trust a test name, and it fails
 *   when the production verdict changes — so hiding a mutation now requires
 *   editing the verifier AND this file, and this file is named by a law.
 *
 * INPUTS
 *   None. Reads only the plugin's modules, and writes its fixtures under the
 *   operating system's temporary directory.
 *
 * OUTPUTS
 *   One `[PASS]`/`[FAIL]` line per invariant, then `gate invariants ok` and exit 0
 *   when every invariant holds; the failing invariants on stderr and exit 1
 *   otherwise. A caller that greps for the marker cannot mistake a partial run for
 *   a pass.
 *
 * KEYWORDS
 *   gate, falsification, invariants, mutation testing, verifier, enforcement point
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A missing module is a FAILURE, not a skip: every invariant here is about a
 *     module that must exist, and "I could not look" is not "it is fine".
 *   - Every fixture lives in its own temporary directory under the OS temp root, so
 *     a failing case cannot poison the next one and no case can write into the
 *     project being verified.
 *   - Nothing here mutates the checked-out project: the invariants are asserted by
 *     constructing inputs, never by breaking the repository.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT = resolve(fileURLToPath(import.meta.url), '..', '..')
const PLUGIN_DIR = join(KIT, 'plugins', 'ratchet').replace(/\\/g, '/')

const { compileProject } = await import(`file:///${PLUGIN_DIR}/ratchet-compiler.mjs`)
const { verifyProject, codeHashFor, listFiles } = await import(`file:///${PLUGIN_DIR}/ratchet-verifier.mjs`)

const failures = []
const claim = (name, ok, detail) => {
  process.stdout.write(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ` — ${detail}`}\n`)
  if (!ok) failures.push(`${name}: ${detail ?? 'no detail'}`)
}

const SOURCE_PATH = 'docs/ratchet/sources/note.md'

/**
 * Builds a throwaway project with one ADR, a manifest, and optional extra files.
 *
 * @param name - Fixture name, used in the temporary directory name.
 * @param adr - `{ laws }` — the rendered `laws:` frontmatter lines, or extra records.
 * @param options - `{ files, zones, extraAdrs }`.
 * @returns The absolute fixture root.
 */
function project(name, adr, { files = {}, zones = null, extraAdrs = {} } = {}) {
  const root = join(tmpdir(), `ratchet-gate-invariant-${name}-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, '.dsh'), { recursive: true })
  mkdirSync(join(root, 'docs', 'ratchet', 'sources'), { recursive: true })
  mkdirSync(join(root, 'docs', 'adrs'), { recursive: true })
  const manifest = {
    manifestVersion: 2,
    name,
    languages: [{ id: 'typescript', extensions: ['.ts'], roots: ['src'] }],
    rules: [],
    verification: [],
    scopes: [],
    ratchet: {
      enabled: true,
      decisionsDir: 'docs/adrs',
      sourcesDir: 'docs/ratchet/sources',
      specsDir: 'docs/specs',
      reportsDir: 'reports/ratchet',
      defaultAgentAuthority: 'proposeOnly',
      zones:
        zones ?? [
          // `activeIfNoConflict`, not `humanOnly`: the fixture record is agent-authored,
          // and a zone that reserves activation to a human would exclude it — every case
          // below would then verify an empty law set and report LAWS_NONE instead of the
          // verdict it is about.
          { id: 'auth', paths: ['src/auth/**'], agentAuthority: 'activeIfNoConflict', requiresDecisionRecord: false },
        ],
    },
  }
  writeFileSync(join(root, '.dsh', 'project.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(
    join(root, SOURCE_PATH),
    '# Note\n\nA stated reason for the record this fixture declares.\n',
  )
  writeFileSync(
    join(root, 'docs', 'adrs', '0001-a.adr.md'),
    [
      '---',
      'id: "0001"',
      'title: A fixture decision',
      'type: adr',
      'status: active',
      'author:',
      '  authority: agent',
      '  name: fixture',
      'created: "2026-09-14T00:00:00Z"',
      'source:',
      '  kind: file',
      `  path: ${SOURCE_PATH}`,
      'zones:',
      '  - auth',
      'supersedes: []',
      'approves: []',
      ...(adr.laws ?? []),
      '---',
      '',
      '## Context',
      '',
      'Fixture context.',
      '',
      '## Decision',
      '',
      'Fixture decision.',
      '',
      '## Reasoning',
      '',
      'Fixture reasoning, which is long enough to be a reason rather than a token.',
      '',
      '## Consequences',
      '',
      'Fixture consequences.',
      '',
    ].join('\n'),
  )
  for (const [filename, body] of Object.entries(extraAdrs)) {
    writeFileSync(join(root, 'docs', 'adrs', filename), body)
  }
  for (const [path, body] of Object.entries(files)) {
    const absolute = join(root, path)
    mkdirSync(join(absolute, '..'), { recursive: true })
    writeFileSync(absolute, body)
  }
  return root
}

/** Renders `laws:` frontmatter lines for one law, so a case states only what it varies. */
function law({ id = 'auth.one', statement = 'One.', checks = null, unenforced = null } = {}) {
  const lines = ['laws:', '  - op: upsert', `    id: ${id}`, `    statement: ${statement}`]
  if (unenforced !== null) lines.push(`    unenforced: ${unenforced}`)
  if (checks === null) return lines
  if (checks.length === 0) {
    lines.push('    checks: []')
    return lines
  }
  lines.push('    checks:')
  for (const check of checks) {
    lines.push(`      - type: ${check.type}`)
    for (const [key, value] of Object.entries(check)) {
      if (key === 'type') continue
      if (Array.isArray(value)) {
        // An empty list is written inline. A bare `deny:` with no entries is a mapping
        // whose value never arrives, so the record would be reported malformed and the
        // empty-list rule this case is about would never be exercised.
        if (value.length === 0) {
          lines.push(`        ${key}: []`)
          continue
        }
        lines.push(`        ${key}:`)
        for (const entry of value) lines.push(`          - ${entry}`)
      } else {
        lines.push(`        ${key}: ${value}`)
      }
    }
  }
  return lines
}

/** Compiles and verifies one fixture, returning the codes seen at each stage. */
async function verdict(name, adr, options = {}) {
  const root = project(name, adr, options)
  const compiled = compileProject(root)
  const manifest = JSON.parse(readFileSync(join(root, '.dsh', 'project.json'), 'utf8')).ratchet
  const verified = await verifyProject({
    root,
    bundle: compiled.bundle,
    config: manifest,
    manifest,
    runCommand: options.runCommand ?? null,
  })
  return {
    root,
    compileCodes: compiled.problems.map((entry) => entry.code),
    codes: verified.problems.map((entry) => entry.code),
    ok: verified.ok,
    counts: verified.report.counts,
    laws: compiled.bundle === null ? [] : compiled.bundle.laws,
  }
}

// 1. A law nothing can check is reported, unless the record says why — the invariant
//    a mutation silently disabled while the suite still reported a green run.
const silent = await verdict('silent-law', { laws: law({ checks: [] }) })
claim(
  'a law with no check and no stated reason is LAW_UNCHECKED',
  silent.codes.includes('LAW_UNCHECKED') && silent.ok === false,
  JSON.stringify(silent.codes),
)

// 2. A stated reason suppresses that problem, but an empty corpus is still not a pass.
const explained = await verdict('explained-law', {
  laws: law({ checks: [], unenforced: 'No tool decides whether a name reads well.' }),
})
claim(
  'a stated reason suppresses LAW_UNCHECKED but not the empty verdict',
  !explained.codes.includes('LAW_UNCHECKED') && explained.codes.includes('VERIFY_NOTHING_EVALUATED'),
  JSON.stringify(explained.codes),
)

// 3. A command that could not run is not a pass.
const unrunnable = await verdict('command-no-runner', {
  laws: law({ checks: [{ type: 'command', run: 'node scripts/x.mjs' }] }),
})
claim(
  'a command check with no runner is never ok',
  unrunnable.ok === false && unrunnable.codes.includes('VERIFY_NOTHING_EVALUATED'),
  JSON.stringify(unrunnable.codes),
)

// 4. Output assertions read each stream as written: a negative assertion must hold in
//    BOTH streams, and a pattern cannot match across the boundary between them.
const negative = await verdict(
  'command-negative',
  { laws: law({ checks: [{ type: 'command', run: 'node x.mjs', outputNotContains: 'ERROR' }] }) },
  { runCommand: async () => ({ code: 0, stdout: 'ERROR: no\n', stderr: '', timedOut: false }) },
)
claim(
  'a forbidden token on either stream fails the check',
  negative.codes.includes('CODE_COMMAND_OUTPUT_MISMATCH'),
  JSON.stringify(negative.codes),
)
const boundary = await verdict(
  'command-boundary',
  { laws: law({ checks: [{ type: 'command', run: 'node x.mjs', outputMatches: 'ALPHA\\nBETA' }] }) },
  { runCommand: async () => ({ code: 0, stdout: 'ALPHA\n', stderr: 'BETA\n', timedOut: false }) },
)
claim(
  'a pattern spanning two streams matches neither',
  boundary.codes.includes('CODE_COMMAND_OUTPUT_MISMATCH'),
  JSON.stringify(boundary.codes),
)

// 5. A glob that selects nothing is not evidence.
const noScope = await verdict('forbidden-text-glob-empty', {
  laws: law({
    checks: [{ type: 'forbidden_text_glob', paths: ['src/**', '!src/**'], pattern: 'FORBIDDEN_MARKER' }],
  }),
})
claim(
  'a forbidden-text glob over no file is not a clean pass',
  noScope.codes.includes('CODE_TEXT_FORBIDDEN_PRESENT'),
  JSON.stringify(noScope.codes),
)

// 6. A check that cannot fail is refused where the decision is compiled.
const emptyDeny = await verdict('path-boundary-empty-deny', {
  laws: law({ checks: [{ type: 'path_boundary', zone: 'auth', deny: [] }] }),
})
claim(
  'an empty path_boundary deny is refused, not counted as evaluated',
  emptyDeny.compileCodes.includes('ADR_FIELD_INVALID'),
  JSON.stringify(emptyDeny.compileCodes),
)
const emptyGlob = await verdict('forbidden-glob-empty', {
  laws: law({ checks: [{ type: 'forbidden_glob', pattern: '""' }] }),
})
claim(
  'an empty glob pattern is refused',
  emptyGlob.compileCodes.includes('ADR_FIELD_INVALID'),
  JSON.stringify(emptyGlob.compileCodes),
)

// 7. A deny is called inert only when that is PROVEN. A leading `**` can match a file
//    the zone owns, and reporting it as enforcing nothing rejected a law that held.
const leadingWildcard = await verdict('path-boundary-leading-wildcard', {
  laws: law({ checks: [{ type: 'path_boundary', zone: 'auth', deny: ['**/legacy/**'] }] }),
})
claim(
  'a deny that can match is never reported inert',
  leadingWildcard.laws.length === 1 && !leadingWildcard.codes.includes('DYNAMIC_REVIEW_REQUIRED'),
  `laws=${leadingWildcard.laws.length} codes=${JSON.stringify(leadingWildcard.codes)}`,
)
const realDivergence = await verdict('path-boundary-divergence', {
  laws: law({ checks: [{ type: 'path_boundary', zone: 'auth', deny: ['src/legacy/**'] }] }),
})
claim(
  'a deny that provably cannot match is still reported',
  realDivergence.codes.includes('DYNAMIC_REVIEW_REQUIRED'),
  JSON.stringify(realDivergence.codes),
)

// 8. A module that does not exist does not "ship" because a list names it.
const listedButAbsent = await verdict(
  'file-in-list-absent',
  {
    laws: law({
      checks: [
        {
          type: 'required_file_in_list',
          path: 'plugins/demo/b.mjs',
          list: 'plugins/demo/package.json',
          keys: ['files'],
          contains: 'b.mjs',
        },
      ],
    }),
  },
  { files: { 'plugins/demo/package.json': '{"files":["b.mjs"]}\n' } },
)
claim(
  'required_file_in_list checks that the file exists',
  listedButAbsent.codes.includes('CODE_REQUIRED_FILE_MISSING'),
  JSON.stringify(listedButAbsent.codes),
)

// 9. A hand-written approval confers nothing: the trust model itself, asserted here
//    rather than in a test whose body a mutation could delete.
const approvalRoot = project('hand-written-approval', {
  laws: law({ checks: [{ type: 'required_file', path: 'src/auth/a.ts' }] }),
})
writeFileSync(
  join(approvalRoot, 'docs', 'adrs', '0002-approval.adr.md'),
  [
    '---',
    'id: "0002"',
    'title: An approval nobody answered',
    'type: approval',
    'status: active',
    'author:',
    '  authority: human',
    '  name: fixture',
    'created: "2026-09-14T00:00:00Z"',
    'source:',
    '  kind: file',
    `  path: ${SOURCE_PATH}`,
    'zones: []',
    'supersedes: []',
    'approves:',
    '  - "0001"',
    'laws: []',
    '---',
    '',
    '## Context',
    '',
    'A consent written by the party it benefits.',
    '',
    '## Decision',
    '',
    'Approve 0001.',
    '',
    '## Reasoning',
    '',
    'There is no reasoning behind a consent nobody gave.',
    '',
    '## Consequences',
    '',
    'None, which is the point.',
    '',
  ].join('\n'),
)
const approvalCompiled = compileProject(approvalRoot)
claim(
  'a hand-written approval mints nothing and is reported',
  approvalCompiled.problems.some((entry) => entry.code === 'RATIFICATION_UNPROVEN'),
  JSON.stringify(approvalCompiled.problems.map((entry) => entry.code)),
)

// 10. The code hash is what ties a verdict to a tree. If it stopped changing, a
//     recorded verification would outlive the code it judged — the exact way a
//     green `status` sat over a tree the gate rejected.
const hashRoot = project(
  'code-hash',
  { laws: law({ checks: [{ type: 'required_file', path: 'src/auth/a.ts' }] }) },
  { files: { 'src/auth/a.ts': 'export const a = 1\n' } },
)
const before = codeHashFor(hashRoot, listFiles(hashRoot))
const stable = codeHashFor(hashRoot, listFiles(hashRoot))
writeFileSync(join(hashRoot, 'src', 'auth', 'a.ts'), 'export const a = 2\n')
const after = codeHashFor(hashRoot, listFiles(hashRoot))
claim('the code hash is stable over an unchanged tree', before === stable, `${before} / ${stable}`)
claim('the code hash changes when a file changes', before !== after, `${before} / ${after}`)

if (failures.length > 0) {
  process.stderr.write(`gate invariants FAILED\n${failures.map((entry) => `  - ${entry}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('gate invariants ok\n')
