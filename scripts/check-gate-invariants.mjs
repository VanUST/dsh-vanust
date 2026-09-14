/**
 * PURPOSE
 *   Enforce, behaviourally, that the gate still CATCHES the breakage each of its
 *   laws exists for. Every assertion here drives the production modules
 *   (schema, compiler, verifier, and the ratification path) over a synthetic
 *   project and requires the wrong verdict to be refused.
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
 *   gate, falsification, invariants, mutation testing, verifier, enforcement point,
 *   ratification, consent, content hash, human channel
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
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT = resolve(fileURLToPath(import.meta.url), '..', '..')
const PLUGIN_DIR = join(KIT, 'plugins', 'ratchet').replace(/\\/g, '/')

const { compileProject, readAdrCorpus } = await import(`file:///${PLUGIN_DIR}/ratchet-compiler.mjs`)
const { compile, verify } = await import(`file:///${PLUGIN_DIR}/ratchet-ops.mjs`)
const { verifyProject, codeHashFor, listFiles } = await import(`file:///${PLUGIN_DIR}/ratchet-verifier.mjs`)
const { ratificationQueue, buildQuiz, deriveDecisions, offeredBy } = await import(
  `file:///${PLUGIN_DIR}/ratchet-ratify.mjs`
)

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

/**
 * A complete fixture ADR file body, for a case that needs more than one record.
 *
 * `project()` renders the first record itself and takes only `laws:` lines for it; a
 * second record needs the whole file, and writing it by hand in each case would put the
 * frontmatter contract in two more places to drift.
 *
 * @param id - The four-digit id, which must match the filename prefix.
 * @param laws - Rendered `laws:` frontmatter lines, as `law()` returns.
 * @returns The file's text.
 */
function adrText(id, laws) {
  return [
    '---',
    `id: "${id}"`,
    `title: Fixture ${id}`,
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
    ...laws,
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
  ].join('\n')
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

// 11. A ratification is a claim about a TEXT, not a title. A ratified record is in
//     force only while its file still hashes to what the approval recorded, and
//     editing it voids the consent instead of inheriting it. This is the behavioural
//     enforcement point for ADR 0007's `shipped-plugins.consent-is-hash-bound`, which
//     used to assert on a test runner's output.
const RATIFIED_TARGET = [
  '---',
  'id: "0001"',
  'title: A fixture decision pending a human',
  'type: adr',
  'status: proposed',
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
  'laws:',
  '  - op: upsert',
  '    id: auth.one',
  '    statement: One.',
  '    checks:',
  '      - type: required_file',
  '        path: src/auth/a.ts',
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
].join('\n')

/**
 * Renders the approval ADR that records one ratification of one target.
 *
 * @param options - `{ targetId, contentHash }`; the hash is the production value
 *   read from the parsed target record, never re-derived here.
 * @returns The complete approval file text, in the shape the ratification writer
 *   produces.
 */
function approvalAdr({ targetId, contentHash }) {
  return [
    '---',
    'id: "0002"',
    'title: A ratification recorded in a fixture',
    'type: approval',
    'status: active',
    'author:',
    '  authority: human',
    '  name: human',
    'created: "2026-09-14T00:00:00Z"',
    'source:',
    '  kind: file',
    `  path: ${SOURCE_PATH}`,
    'zones: []',
    'supersedes: []',
    'approves:',
    `  - "${targetId}"`,
    'laws: []',
    'ratification:',
    '  channel: user-question',
    '  at: "2026-09-14T00:00:00Z"',
    '  askedBy: session fixture',
    '  targets:',
    `    - id: "${targetId}"`,
    `      contentHash: ${contentHash}`,
    '---',
    '',
    '## Context',
    '',
    'The transcript the approval cites.',
    '',
    '## Decision',
    '',
    `Put ${targetId} into force at the text it had when the question was asked.`,
    '',
    '## Reasoning',
    '',
    'A consent that did not name the text it covered would approve whatever the file said next.',
    '',
    '## Consequences',
    '',
    'Editing the target voids this consent until a human is asked again.',
    '',
  ].join('\n')
}

const ratificationRoot = project(
  'ratification-hash-bound',
  { laws: law({ id: 'auth.one', checks: [{ type: 'required_file', path: 'src/auth/a.ts' }] }) },
  { files: { 'src/auth/a.ts': 'export const a = 1\n' } },
)
writeFileSync(join(ratificationRoot, 'docs', 'adrs', '0001-a.adr.md'), RATIFIED_TARGET)
const ratificationConfig = JSON.parse(
  readFileSync(join(ratificationRoot, '.dsh', 'project.json'), 'utf8'),
).ratchet
const ratifiedTarget = readAdrCorpus(ratificationRoot, ratificationConfig).records.find(
  (record) => record.id === '0001',
)
writeFileSync(
  join(ratificationRoot, 'docs', 'adrs', '0002-approval.adr.md'),
  approvalAdr({ targetId: '0001', contentHash: ratifiedTarget?.contentHash ?? 'sha256:pending' }),
)
const intactCompile = compileProject(ratificationRoot)
const intactStale = intactCompile.problems.some((entry) => entry.code === 'RATIFICATION_STALE')
const intactLaw = (intactCompile.bundle?.laws ?? []).some((entry) => entry.id === 'auth.one')
writeFileSync(
  join(ratificationRoot, 'docs', 'adrs', '0001-a.adr.md'),
  RATIFIED_TARGET.replace('Fixture decision.', 'Edited after the human consented.'),
)
const editedCompile = compileProject(ratificationRoot)
const editedStale = editedCompile.problems.some((entry) => entry.code === 'RATIFICATION_STALE')
const editedLaw = (editedCompile.bundle?.laws ?? []).some((entry) => entry.id === 'auth.one')
claim(
  'editing an approved record voids its consent (RATIFICATION_STALE) and its law leaves force',
  ratifiedTarget !== undefined && intactStale === false && intactLaw === true &&
    editedStale === true && editedLaw === false,
  `intact: stale=${intactStale} law=${intactLaw}; edited: stale=${editedStale} law=${editedLaw}`,
)

// 12. The question a human answers carries the record's own file text, and the answer
//     is derived from the selected label rather than interpreted. This is the
//     behavioural enforcement point for ADR 0007's
//     `shipped-plugins.consent-travels-the-human-channel`.
const questionRoot = project(
  'ratification-question-text',
  { laws: law({ id: 'auth.one', checks: [{ type: 'required_file', path: 'src/auth/a.ts' }] }) },
  { files: { 'src/auth/a.ts': 'export const a = 1\n' } },
)
writeFileSync(join(questionRoot, 'docs', 'adrs', '0001-a.adr.md'), RATIFIED_TARGET)
const queue = ratificationQueue(questionRoot)
const waiting = queue.pending.find((entry) => entry.id === '0001')
const quiz = buildQuiz(waiting === undefined ? [] : [waiting])
const question = quiz.questions[0] ?? { id: null, header: null, question: '', detail: null }
const role = quiz.roles[question.id] ?? { approveLabel: null, rejectLabel: null }
const frozen = offeredBy(quiz, '0001')
const approved = deriveDecisions(quiz, { answers: [{ id: question.id, selected: [role.approveLabel] }] })
const rejected = deriveDecisions(quiz, { answers: [{ id: question.id, selected: [role.rejectLabel] }] })
const otherLabel = deriveDecisions(quiz, {
  answers: [{ id: question.id, selected: ['Approve ADR 9999'] }],
})
const freeText = deriveDecisions(quiz, { answers: [{ id: question.id, custom: 'yes, go ahead' }] })
const unanswered = deriveDecisions(quiz, null)
const reask = buildQuiz(waiting === undefined ? [] : [waiting], {
  attempt: 2,
  previous: unanswered.unreadable,
})
const reaskQuestion = reask.questions[0] ?? { id: null, header: null, question: '', detail: null }
const reaskRole = reask.roles[reaskQuestion.id] ?? { approveLabel: null, rejectLabel: null }
const reaskApproved = deriveDecisions(reask, {
  answers: [{ id: reaskQuestion.id, selected: [reaskRole.approveLabel] }],
})
const staleLabel = deriveDecisions(reask, {
  answers: [{ id: reaskQuestion.id, selected: [role.approveLabel] }],
})
const questionParts = [
  `waiting=${waiting !== undefined}`,
  `queue-text-is-file-text=${waiting?.text === RATIFIED_TARGET}`,
  `detail-is-file-text=${question.detail === RATIFIED_TARGET}`,
  `detail-is-prose=${String(question.detail).includes('## Reasoning')}`,
  `frozen-hash=${frozen?.contentHash === waiting?.contentHash}`,
  `approve-label-mints=${approved.approved.length === 1 && approved.approved[0] === '0001'}`,
  `reject-label-mints-nothing=${rejected.approved.length === 0 && rejected.rejected.length === 1}`,
  `another-label-mints-nothing=${otherLabel.approved.length === 0 && otherLabel.unreadable.length === 1}`,
  `free-text-mints-nothing=${freeText.approved.length === 0 && freeText.unreadable.length === 1}`,
  `no-answer-mints-nothing=${unanswered.approved.length === 0 && unanswered.unreadable.length === 1}`,
  `reask-asks-differently=${reaskQuestion.header !== question.header && String(reaskQuestion.question).includes('could not be read') && reaskQuestion.detail === RATIFIED_TARGET}`,
  `reask-approve-label-mints=${reaskApproved.approved.length === 1 && reaskApproved.approved[0] === '0001'}`,
  `reask-old-label-mints-nothing=${staleLabel.approved.length === 0 && staleLabel.unreadable.length === 1}`,
]
claim(
  "the ratification question carries the record's own file text and only its exact approve label mints consent",
  questionParts.every((part) => part.endsWith('=true')),
  questionParts.join(' '),
)

// 13. A green gate means the corpus is CURRENT: a generated spec that disagrees with
//     its decision, or that is missing while the project tracks specs, is reported, and
//     a compile that persists a bundle without regenerating the document is reported
//     too. ADR 0012 made this law; before it, the tracking flag short-circuited the
//     on-disk clause and the stale-document half was dropped by the caller, so a
//     project could commit generated specs, let them drift, and still verify clean.
{
  const root = project('spec-current', { laws: law({ checks: [{ type: 'required_text', paths: ['src/auth/x.ts'], pattern: 'one' }] }) }, {
    files: { 'src/auth/x.ts': 'const one = 1\n' },
  })
  // `specsRequired: true`, because with it false the on-disk clause is the only thing
  // that can start tracking — and deleting the LAST document leaves nothing on disk to
  // notice, so "the project never generated specs" and "somebody deleted them all" would
  // be the same state. That is the residual the flag closes.
  const manifestPath = join(root, '.dsh', 'project.json')
  writeFileSync(manifestPath, `${JSON.stringify({ ...JSON.parse(readFileSync(manifestPath, 'utf8')), ratchet: { ...JSON.parse(readFileSync(manifestPath, 'utf8')).ratchet, specsRequired: true } }, null, 2)}\n`)
  await compile({ root, write: true })
  const clean = await verify({ root })
  // Edit the decision without regenerating its document: the document now describes a
  // law that no longer exists, and nothing on disk is marked as changed.
  const adrPath = join(root, 'docs', 'adrs', '0001-a.adr.md')
  writeFileSync(adrPath, readFileSync(adrPath, 'utf8').replace('statement: One.', 'statement: One, edited.'))
  const afterEdit = await verify({ root })
  // Put it back and instead delete a document the project tracks.
  writeFileSync(adrPath, readFileSync(adrPath, 'utf8').replace('statement: One, edited.', 'statement: One.'))
  await compile({ root, write: true })
  const specFile = join(root, 'docs', 'specs', `${readdirSync(join(root, 'docs', 'specs'))[0]}`)
  rmSync(specFile, { force: true })
  const afterDelete = await verify({ root })
  // And the quiet one: a compile that persists the bundle without writing documents.
  writeFileSync(adrPath, readFileSync(adrPath, 'utf8').replace('statement: One.', 'statement: One, edited.'))
  await compile({ root, write: false })
  const afterUnwritten = await verify({ root })
  const parts = [
    `clean-corpus-passes=${clean.problems.length === 0}`,
    `edited-decision-reported=${afterEdit.problems.some((entry) => entry.code === 'SPEC_OUT_OF_DATE')}`,
    `deleted-document-reported=${afterDelete.problems.some((entry) => entry.code === 'SPEC_OUT_OF_DATE')}`,
    `unwritten-compile-reported=${afterUnwritten.problems.some((entry) => entry.code === 'SPEC_OUT_OF_DATE')}`,
  ]
  claim(
    'a generated spec that is stale, missing, or unwritten is reported by verify',
    parts.every((part) => part.endsWith('=true')),
    parts.join(' '),
  )
}

// 14. A green gate means the corpus is COMPLETE: a law that was in force and is gone,
//     with no active record retiring it, is reported — and stays reported run after run,
//     because a run that recorded the shrunken set would certify the deletion one
//     command later. Before ADR 0012 this was silent and the whole release gate passed.
{
  const root = project(
    'law-complete',
    { laws: law({ id: 'auth.kept', checks: [{ type: 'required_text', paths: ['src/auth/x.ts'], pattern: 'one' }] }) },
    { files: { 'src/auth/x.ts': 'const one = 1\n' } },
  )
  const retirable = law({ id: 'auth.retirable', checks: [{ type: 'required_text', paths: ['src/auth/x.ts'], pattern: 'one' }] })
  writeFileSync(join(root, 'docs', 'adrs', '0002-b.adr.md'), adrText('0002', retirable))
  await verify({ root })
  // Delete the second law from its record — not a retirement, a deletion.
  const second = join(root, 'docs', 'adrs', '0002-b.adr.md')
  rmSync(second, { force: true })
  const first = await verify({ root })
  const secondRun = await verify({ root })
  const reported = (result) => result.problems.some((entry) => entry.code === 'LAW_REMOVED_WITHOUT_DECISION')
  // The same removal, declared: a record whose law carries `op: remove`.
  const declared = project(
    'law-retired',
    { laws: law({ id: 'auth.kept', checks: [{ type: 'required_text', paths: ['src/auth/x.ts'], pattern: 'one' }] }) },
    { files: { 'src/auth/x.ts': 'const one = 1\n' } },
  )
  writeFileSync(join(declared, 'docs', 'adrs', '0002-b.adr.md'), adrText('0002', retirable))
  await verify({ root: declared })
  rmSync(join(declared, 'docs', 'adrs', '0002-b.adr.md'), { force: true })
  writeFileSync(
    join(declared, 'docs', 'adrs', '0003-c.adr.md'),
    adrText('0003', ['laws:', '  - op: remove', '    id: auth.retirable']),
  )
  const accepted = await verify({ root: declared })
  const parts = [
    `deletion-reported=${reported(first)}`,
    `still-reported-next-run=${reported(secondRun)}`,
    `declared-removal-accepted=${!reported(accepted)}`,
  ]
  claim(
    'a law that leaves force without a recorded removal is reported, and a recorded removal is accepted',
    parts.every((part) => part.endsWith('=true')),
    parts.join(' '),
  )
}

// 15. A green gate means the corpus is WITHIN ITS AUTHORITY: a law whose positive check
//     paths fall outside the zones its record declares is refused, because declaring a
//     less restricted zone must not grant power over a path the manifest reserves.
{
  const outside = project(
    'zone-outside',
    { laws: law({ checks: [{ type: 'required_text', paths: ['other/thing.ts'], pattern: 'one' }] }) },
    { files: { 'other/thing.ts': 'const one = 1\n' } },
  )
  const inside = project(
    'zone-inside',
    { laws: law({ checks: [{ type: 'required_text', paths: ['src/auth/thing.ts'], pattern: 'one' }] }) },
    { files: { 'src/auth/thing.ts': 'const one = 1\n' } },
  )
  const outsideCompiled = compileProject(outside)
  const insideCompiled = compileProject(inside)
  const parts = [
    `outside-refused=${outsideCompiled.problems.some((entry) => entry.code === 'LAW_PATH_OUTSIDE_DECLARED_ZONE')}`,
    `inside-accepted=${!insideCompiled.problems.some((entry) => entry.code === 'LAW_PATH_OUTSIDE_DECLARED_ZONE')}`,
  ]
  claim(
    'a law targeting a path outside its declared zones is refused, and one inside them is accepted',
    parts.every((part) => part.endsWith('=true')),
    parts.join(' '),
  )
}

if (failures.length > 0) {
  process.stderr.write(`gate invariants FAILED\n${failures.map((entry) => `  - ${entry}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('gate invariants ok\n')
