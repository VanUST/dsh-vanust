/**
 * PURPOSE
 *   Enforce the consent SURFACE: the claims about human ratification that live in the
 *   tool and CLI shape rather than in a single function.
 *
 *   A law whose check is `outputContains: '"blocked"'` on a JSON payload verifies
 *   nothing, because that key is always present — a mutant that stopped reporting
 *   blocked decisions entirely still passed. This script exists so the law has an
 *   enforcement point that fails when the behaviour disappears: it builds the
 *   situations the claims are about and requires the observed behaviour, printing
 *   `consent surface ok` only when every one holds.
 *
 * INPUTS
 *   None. Fixtures are written under the system temp directory, and nothing outside
 *   those fixtures is read or written.
 *
 * OUTPUTS
 *   One line per claim, then `consent surface ok` and exit 0 when every claim holds;
 *   the failing claim's name and reason on stderr and exit 1 otherwise. A script that
 *   exits 0 without printing the marker is not a pass, which is why the law's check
 *   asserts on the marker rather than on the exit code alone.
 *
 * KEYWORDS
 *   ratification, consent, enforcement point, cli surface, tool schema, gate
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A fixture that cannot be written is a failure, not a skip: the claims are about
 *     behaviour, and behaviour nobody could set up is behaviour nobody verified.
 *   - No network, no harness, no credentials and no model: everything here is the
 *     plugin's own code plus the CLI, so it runs in any checkout.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = join(KIT, 'plugins', 'ratchet')
const CLI = join(PLUGIN, 'ratchet-cli.mjs')

const ops = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-ops.mjs`)
const tools = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-tools.mjs`)

const failures = []
const claim = (name, ok, detail) => {
  process.stdout.write(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ` — ${detail}`}\n`)
  if (!ok) failures.push(`${name}: ${detail ?? 'no detail'}`)
}

/** Writes a throwaway project with the given ADRs. */
function fixture(name, { adrs, zones }) {
  const root = join(tmpdir(), `consent-surface-${name}-${Math.random().toString(36).slice(2, 8)}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, '.dsh'), { recursive: true })
  mkdirSync(join(root, 'docs', 'adrs'), { recursive: true })
  mkdirSync(join(root, 'docs', 'ratchet', 'sources'), { recursive: true })
  writeFileSync(
    join(root, '.dsh', 'project.json'),
    `${JSON.stringify(
      {
        manifestVersion: 2,
        name,
        languages: [{ id: 'javascript', extensions: ['.mjs'], roots: ['src'] }],
        rules: [],
        verification: [],
        scopes: [],
        ratchet: { enabled: true, decisionsDir: 'docs/adrs', sourcesDir: 'docs/ratchet/sources', zones },
      },
      null,
      2,
    )}\n`,
  )
  for (const [filename, body] of Object.entries(adrs)) writeFileSync(join(root, 'docs', 'adrs', filename), body)
  return root
}

/** Renders one minimal ADR. */
function adr({ id, status, authority, zone, supersedes = [], laws = [] }) {
  return [
    '---',
    `id: "${id}"`,
    `title: Decision ${id}`,
    'type: adr',
    `status: ${status}`,
    'author:',
    `  authority: ${authority}`,
    `  name: ${authority}`,
    'created: 2026-09-14T00:00:00Z',
    'source:',
    '  kind: file',
    '  path: docs/ratchet/sources/consent-surface.md',
    'zones:',
    `  - ${zone}`,
    ...(supersedes.length === 0 ? ['supersedes: []'] : ['supersedes:', ...supersedes.map((entry) => `  - "${entry}"`)]),
    'approves: []',
    laws.length === 0
      ? 'laws: []'
      : [
          'laws:',
          ...laws.flatMap((law) => ['  - op: upsert', `    id: ${law.id}`, `    statement: ${law.statement}`, '    checks: []']),
        ],
    '---',
    '',
    '## Context',
    '',
    'A fixture for the consent-surface check.',
    '',
    '## Decision',
    '',
    'It exists to be refused, or to be offered.',
    '',
    '## Reasoning',
    '',
    'The claims under test are about what the surface does with a decision, so the',
    'fixture has to be a real decision the surface can act on.',
    '',
    '## Consequences',
    '',
    '- The check reads the surface, not the fixture.',
    '',
  ].join('\n')
}

const blockedRoot = fixture('blocked', {
  zones: [{ id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' }],
  adrs: {
    '0001-blocked.adr.md': adr({ id: '0001', status: 'proposed', authority: 'agent', zone: 'auth', laws: [{ id: 'auth.one', statement: 'One.' }] }),
  },
})
const terminalRoot = fixture('terminal', {
  zones: [{ id: 'tests', paths: ['src/**'], agentAuthority: 'activeIfNoConflict' }],
  adrs: {
    '0001-withdrawn.adr.md': adr({ id: '0001', status: 'withdrawn', authority: 'agent', zone: 'tests', laws: [{ id: 'tests.a', statement: 'A.' }] }),
  },
})
const pendingRoot = fixture('pending', {
  zones: [{ id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
  adrs: {
    '0001-waiting.adr.md': adr({ id: '0001', status: 'proposed', authority: 'agent', zone: 'api', laws: [{ id: 'api.one', statement: 'One.' }] }),
  },
})

const cli = (args) => {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout }
  } catch (error) {
    return { status: typeof error.status === 'number' ? error.status : 1, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

// 1. A shell cannot mint. The verb must not exist, and that must be a usage error
//    rather than a silent success — including when the caller supplies the flags a
//    minting command would have taken.
const mintAttempt = cli(['ratify', '--root', pendingRoot])
claim(
  'the CLI has no mint verb',
  mintAttempt.status === 3 && /unknown command/.test(mintAttempt.stdout),
  `exit ${mintAttempt.status}`,
)
const mintWithFlags = cli(['ratify', '--root', pendingRoot, '--answers', '{}', '--yes'])
claim(
  'and inventing its flags does not mint either',
  mintWithFlags.status === 3 && !/wrote|approval/.test(mintWithFlags.stdout),
  `exit ${mintWithFlags.status}`,
)

// 2. The queue reports a decision it cannot ratify WITH its reason. The reason is the
//    substance: a payload that always carries a `blocked` key says nothing.
const blockedQueue = ops.ratifications(blockedRoot)
claim(
  'a blocked decision is reported with the reason it cannot be ratified',
  blockedQueue.pending.length === 0 &&
    blockedQueue.blocked.length === 1 &&
    /humanOnly/.test(blockedQueue.blocked[0].reason ?? ''),
  `pending=${blockedQueue.pending.length} blocked=${blockedQueue.blocked.length}`,
)
const blockedCli = cli(['pending', '--root', blockedRoot])
claim(
  'and the shell says so too',
  /BLOCKED ADR 0001/.test(blockedCli.stdout) && /humanOnly/.test(blockedCli.stdout),
  `exit ${blockedCli.status}`,
)

// 3. A decision the project RETIRED is not waiting for anyone: offering it would let
//    a "yes" put a withdrawn decision back into law.
const terminalQueue = ops.ratifications(terminalRoot)
claim(
  'a withdrawn decision is not queued for ratification',
  terminalQueue.pending.length === 0 && terminalQueue.blocked.length === 0,
  `pending=${terminalQueue.pending.length} blocked=${terminalQueue.blocked.length}`,
)

// 4. No argument of the tool accepts an answer.
const registered = new Map()
tools.apply({
  effect: (fn) => fn(),
  on: () => () => {},
  get: () => undefined,
  tools: { register: (definition) => (registered.set(definition.name, definition), () => {}), guard: () => () => {}, schemas: () => [] },
})
const schema = registered.get('ratchet_ratify')?.parameters ?? {}
const parameterNames = Object.keys(schema.properties ?? {})
claim(
  'the tool exposes no argument that accepts an answer',
  parameterNames.length === 1 && parameterNames[0] === 'ids',
  `parameters=${JSON.stringify(parameterNames)}`,
)

// 5. And an answer without the quiz it answers is refused, writing nothing.
const composed = ops.ratify({
  root: pendingRoot,
  answer: { answers: [{ id: 'ratify-0001', selected: ['Approve'] }] },
  at: '2026-09-14T00:00:00Z',
})
claim(
  'an answer that answers no question mints nothing',
  composed.ok === false &&
    composed.unanswered === true &&
    readdirSync(join(pendingRoot, 'docs', 'adrs')).length === 1,
  `ok=${String(composed.ok)} files=${readdirSync(join(pendingRoot, 'docs', 'adrs')).length}`,
)

for (const root of [blockedRoot, terminalRoot, pendingRoot]) rmSync(root, { recursive: true, force: true })

if (failures.length > 0) {
  process.stderr.write(`consent surface FAILED\n${failures.map((entry) => `  - ${entry}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('consent surface ok\n')
