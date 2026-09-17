/**
 * PURPOSE
 *   Enforce the consent SURFACE: the claims about human ratification that live in the
 *   tool, CLI, service and route shape rather than in a single function.
 *
 *   A law whose check is `outputContains: '"blocked"'` on a JSON payload verifies
 *   nothing, because that key is always present — a mutant that stopped reporting
 *   blocked decisions entirely still passed. This script exists so the law has an
 *   enforcement point that fails when the behaviour disappears: it builds the
 *   situations the claims are about and requires the observed behaviour, printing
 *   `consent surface ok` only when every one holds.
 *
 *   The routes the ADR panel serves are the newest part of that surface, and they are the
 *   part most able to widen it. Four claims hold them: the panel bundle and its host half
 *   and the ratchet agree on the consent service, route, header and capability global AND
 *   on the state service, route, header and capability global; NO tool exposes any of
 *   those eight values; the decisions service the state route reaches returns the
 *   ratchet's own derivation (so the window has nothing to re-derive), and that derivation
 *   is CACHED and invalidated by the corpus signature (so a changed corpus is never served
 *   from a stale view) and CAPPED with a `truncated` record; and the consent
 *   service the consent route reaches — driven here through the very object
 *   `ratchet-tools.mjs` provides — refuses a label with no quiz, refuses a quiz the
 *   ratchet did not build, refuses a record whose zone reserves its paths to a human,
 *   refuses a replayed quiz, refuses an answer about a record edited since the question
 *   was asked, and writes an approval ONLY for the approve label of the question it built.
 *   A GET's durable effect is asserted as its own distinction: exactly one audit ledger
 *   event, and no approval and no transcript. The host route's PORT deadline is asserted
 *   by driving it with a body that never ends: it must answer 408 and destroy the request.
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
 *   ratification, consent, enforcement point, cli surface, tool schema, consent service,
 *   host route, capability token, gate
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A fixture that cannot be written is a failure, not a skip: the claims are about
 *     behaviour, and behaviour nobody could set up is behaviour nobody verified.
 *   - The tool-surface claim covers EVERY tool the plugin registers, read from the
 *     plugin's own registrations rather than from a list in this file, so a tool added
 *     later is inspected without an edit here. The one exception it encodes is a
 *     boolean `ratify` trigger, which asks for the question and carries no answer. The
 *     route/header/global scan is whole-surface for the same reason.
 *   - The value driven as "the consent service" is the one `apply` PROVIDED, captured
 *     from a fake context — not a fresh import of the module. A service that stopped
 *     being provided (the panel's route would then refuse every request) fails here.
 *   - A service that is absent from the fake context is reported as the missing
 *     provision rather than throwing a `TypeError` out of this script: the claim is
 *     about the surface, and a crash would report nothing about it.
 *   - No network, no harness, no credentials and no model: everything here is the
 *     plugin's own code plus the CLI, so it runs in any checkout.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
    ...(laws.length === 0
      ? ['laws: []']
      : [
          'laws:',
          ...laws.flatMap((law) => ['  - op: upsert', `    id: ${law.id}`, `    statement: ${law.statement}`, '    checks: []']),
        ]),
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
const pendingQueue = ops.ratifications(pendingRoot)
claim(
  'an agent proposal in a proposeOnly zone is offered to a human rather than blocked',
  pendingQueue.pending.length === 1 && pendingQueue.blocked.length === 0,
  `pending=${pendingQueue.pending.length} blocked=${pendingQueue.blocked.length}`,
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
const provided = new Map()
tools.apply({
  effect: (fn) => fn(),
  on: () => () => {},
  get: () => undefined,
  // The consent service is PROVIDED, not registered as a tool: this records the value so the
  // claims below can drive the very object the panel's host route reaches with `ctx.get`.
  provide: (serviceName, value) => (provided.set(serviceName, value), () => {}),
  logger: () => ({ info: () => {}, warn: () => {} }),
  tools: { register: (definition) => (registered.set(definition.name, definition), () => {}), guard: () => () => {}, schemas: () => [] },
})
const schema = registered.get('ratchet_ratify')?.parameters ?? {}
const parameterNames = Object.keys(schema.properties ?? {}).sort()
// `ids` says WHICH records are being put to the human and `root` says WHICH project holds
// them; both are questions the ratchet asks, neither is an answer to one. The claim is that
// the surface carries no key an answer could travel in, so it is asserted as an exact
// allow-list rather than as a deny-list: a new argument is then a deliberate edit here.
const ALLOWED_PARAMETERS = ['ids', 'root']
claim(
  'the tool exposes no argument that accepts an answer',
  JSON.stringify(parameterNames) === JSON.stringify(ALLOWED_PARAMETERS),
  `parameters=${JSON.stringify(parameterNames)}`,
)

// 4b. The grill entry is a third ENTRY to the same channel, not a third channel: it
//     triggers the ratchet's own question and carries no key an answer could travel in.
//     Asserted as an exact allow-list for the same reason as the tool above, so a new
//     argument on the ingestion surface is a deliberate edit here rather than a quiet
//     widening of what the ratchet accepts.
const ingestSchema = registered.get('ratchet_ingest_source')?.parameters ?? {}
const ingestParameters = Object.keys(ingestSchema.properties ?? {}).sort()
const INGEST_ALLOWED_PARAMETERS = ['ingest', 'ratify', 'source', 'write']
claim(
  'the grill entry triggers the question and accepts no answer',
  JSON.stringify(ingestParameters) === JSON.stringify(INGEST_ALLOWED_PARAMETERS) &&
    ingestSchema.properties?.ratify?.type === 'boolean',
  `parameters=${JSON.stringify(ingestParameters)} ratify=${JSON.stringify(ingestSchema.properties?.ratify?.type)}`,
)

// 4c. The claim is about the SURFACE, not about two named tools. The checks above
//     read `ratchet_ratify` and `ratchet_ingest_source` by name, so a NEW tool — or a
//     new argument on an uninspected existing tool — could accept a caller-composed
//     answer and pass them. Every registered tool is scanned here instead, and a
//     property whose NAME denotes an answer is refused unless it is the one known
//     boolean trigger (`ratify`, which causes the question and carries no answer).
//     This is deliberately a whole-surface name denylist, not an allow-list of tool
//     names: it fails on a tool nobody thought to add to a list.
const ANSWER_SHAPED = /^(answer|answers|decision|consent|approve|approveLabel|approved|reject|rejectLabel|rejected|ratification|selected|selection|choice|yes|no|label)$/i
const TRIGGER_PROPERTIES = new Set(['ratify'])
const answerOffenders = []
for (const [name, definition] of registered) {
  const properties = definition?.parameters?.properties ?? {}
  for (const [property, propertySchema] of Object.entries(properties)) {
    if (!ANSWER_SHAPED.test(property)) continue
    // A boolean `ratify` asks the ratchet to put its question; it says nothing about
    // the answer. Everything else, whatever its type, is a way for a caller to compose
    // one, so it is refused.
    if (TRIGGER_PROPERTIES.has(property) && propertySchema?.type === 'boolean') continue
    answerOffenders.push(`${name}.${property}`)
  }
}
claim(
  'no registered tool argument is named like a caller-composed answer',
  answerOffenders.length === 0 && registered.size >= 3,
  `tools=${registered.size} offenders=${JSON.stringify(answerOffenders)}`,
)

// The panel's OTHER consent properties are enforced behaviourally, and by executing the
// shipped bundle rather than reading it: `scripts/test-adr-panel.mjs` drives the panel
// through a stub loader, a recording workspace-file surface and a stub host for the consent
// route, and requires that the seat renders no answer of its own, that a row's Approve and
// Decline ask the host for the ratchet's question and send back one of the labels that
// question put on its options — read back by the ratchet's own `deriveDecisions` as an
// approval or a rejection — that the window shows that question, the record's own text and
// both labels, that the outcome names the artifact, and that NO composer message is composed
// in any of it, so a panel ratification never becomes a chat message. That, plus the whole
// render calling nothing but `list`, the paged `read` and the whole-file `readAll` on the file
// surface — and the real-corpus requirement that the waiting set the panel derives EQUAL the
// set `ratificationQueue` reports — is the enforcement for ADR 0014's and 0018's panel laws;
// this file holds the cross-artifact half, which no single-bundle test can see.

// 4c. The question's presentation is claimed by a wire literal that CANNOT be imported: the
//     ratchet is a Node plugin and the client half is a hand-written browser closure with no
//     module graph, so `ratify-decision` exists twice. Two copies of one value is drift no
//     compiler sees, and the failure is silent in the worst way — the panel stops claiming
//     the question, so a decision an agent proposed is asked as a chat quiz again, and every
//     other check still passes. So the equality is asserted against the real question the
//     ratchet builds, and against the source the browser actually loads.
const ratifyModule = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-ratify.mjs`)
const panelSource = readFileSync(join(KIT, 'plugins', 'dsh-adr-panel', 'client.js'), 'utf8')
// Anchored to the start of a line so a COMMENTED-OUT copy cannot satisfy it, and tolerant
// of spacing and quote style so a formatting-only change is not a failure: this check is
// about the value the bundle compares, not about how the declaration is laid out.
const panelLiteral = /(?:^|\n)[ \t]*const RATIFY_INTENT_KIND\s*=\s*["']([^"']+)["']/.exec(panelSource)
const panelQuiz = ratifyModule.buildQuiz([{ id: '0001', title: 't', text: 'body', laws: [] }], { attempt: 1 })
const chatQuiz = ratifyModule.buildQuiz([{ id: '0001', title: 't', text: 'body', laws: [] }], { attempt: 1, present: 'chat' })
claim(
  'the panel matches the intent the ratchet sends, and a grill gets no intent to claim',
  panelLiteral !== null &&
    panelLiteral[1] === ratifyModule.RATIFY_INTENT_KIND &&
    panelQuiz.questions[0].intent.kind === ratifyModule.RATIFY_INTENT_KIND &&
    chatQuiz.questions[0].intent === undefined,
  `panel=${panelLiteral === null ? 'not declared' : panelLiteral[1]} ratchet=${ratifyModule.RATIFY_INTENT_KIND} grill=${JSON.stringify(chatQuiz.questions[0].intent)}`,
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

// 7. The panel's consent route is a TRANSPORT, not a second consent path. Three claims make
//    that true, and each is asserted against the shipped artifacts rather than described:
//
//    (a) the route and the service are the values the two halves agree on, so what the panel
//        calls is what the ratchet provides;
//    (b) no tool exposes either — the whole registered surface is scanned, not two names;
//    (c) the service itself refuses a composed payload and mints an approval only for the
//        label of a question it built, which is the property that lets a UI be an entry to
//        the one consent channel instead of a second one.
const ratchetConsent = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-consent.mjs`)
const ratchetDecisions = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-decisions.mjs`)
const ratchetResolve = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-resolve.mjs`)
const panelHost = await import(`file:///${join(KIT, 'plugins', 'dsh-adr-panel', 'index.js').replace(/\\/g, '/')}`)
const panelBundle = readFileSync(join(KIT, 'plugins', 'dsh-adr-panel', 'client.js'), 'utf8')
// Anchored to the start of a line so a COMMENTED-OUT copy cannot satisfy it, and tolerant of
// spacing and quote style so a formatting-only change is not a failure.
const bundleLiteral = (name) => {
  const match = new RegExp(`(?:^|\\n)[ \\t]*const ${name}\\s*=\\s*["']([^"']+)["']`).exec(panelBundle)
  return match === null ? null : match[1]
}
claim(
  'the panel and its host agree on the route, the service, the header and the capability global',
  bundleLiteral('CONSENT_ROUTE') === panelHost.CONSENT_ROUTE &&
    bundleLiteral('CONSENT_HEADER') === panelHost.CONSENT_HEADER &&
    bundleLiteral('CONSENT_GLOBAL') === panelHost.CONSENT_GLOBAL &&
    panelHost.CONSENT_SERVICE === ratchetConsent.CONSENT_SERVICE &&
    panelHost.CONSENT_ROUTE.startsWith('/'),
  `bundle=${JSON.stringify({ route: bundleLiteral('CONSENT_ROUTE'), header: bundleLiteral('CONSENT_HEADER'), global: bundleLiteral('CONSENT_GLOBAL') })} host=${JSON.stringify({ route: panelHost.CONSENT_ROUTE, service: panelHost.CONSENT_SERVICE })} ratchet=${ratchetConsent.CONSENT_SERVICE}`,
)

// The STATE surface is the same kind of cross-artifact contract as consent, and the same
// four values exist twice: a cordis service name in the ratchet and the host, and a route,
// a header and a capability global in the host and the browser bundle. The panel must not
// re-derive the state, so this equality is what keeps the one route it calls the one the
// ratchet serves. Asserted against the shipped artifacts, not described.
claim(
  'the panel and its host agree on the state route, the service, the header and the capability global',
  bundleLiteral('STATE_ROUTE') === panelHost.STATE_ROUTE &&
    bundleLiteral('STATE_HEADER') === panelHost.STATE_HEADER &&
    bundleLiteral('STATE_GLOBAL') === panelHost.STATE_GLOBAL &&
    panelHost.STATE_SERVICE === ratchetDecisions.DECISIONS_SERVICE &&
    panelHost.STATE_ROUTE.startsWith('/') &&
    bundleLiteral('STATE_ROUTE') !== bundleLiteral('CONSENT_ROUTE'),
  `bundle=${JSON.stringify({ route: bundleLiteral('STATE_ROUTE'), header: bundleLiteral('STATE_HEADER'), global: bundleLiteral('STATE_GLOBAL') })} host=${JSON.stringify({ route: panelHost.STATE_ROUTE, service: panelHost.STATE_SERVICE })} ratchet=${ratchetDecisions.DECISIONS_SERVICE}`,
)

// The RESOLVE surface is the same four-value contract again. It is the one route that
// STARTS work rather than recording an answer, so its equality matters for a second
// reason: a bundle that called a route the ratchet does not serve would look like a working
// Resolve button, and a tool that exposed the route or its service would be a second way to
// start a resolver.
claim(
  'the panel and its host agree on the resolve route, the service, the header and the capability global',
  bundleLiteral('RESOLVE_ROUTE') === panelHost.RESOLVE_ROUTE &&
    bundleLiteral('RESOLVE_HEADER') === panelHost.RESOLVE_HEADER &&
    bundleLiteral('RESOLVE_GLOBAL') === panelHost.RESOLVE_GLOBAL &&
    panelHost.RESOLVE_SERVICE === ratchetResolve.RESOLVE_SERVICE &&
    panelHost.RESOLVE_ROUTE.startsWith('/') &&
    bundleLiteral('RESOLVE_ROUTE') !== bundleLiteral('CONSENT_ROUTE') &&
    bundleLiteral('RESOLVE_ROUTE') !== bundleLiteral('STATE_ROUTE'),
  `bundle=${JSON.stringify({ route: bundleLiteral('RESOLVE_ROUTE'), header: bundleLiteral('RESOLVE_HEADER'), global: bundleLiteral('RESOLVE_GLOBAL') })} host=${JSON.stringify({ route: panelHost.RESOLVE_ROUTE, service: panelHost.RESOLVE_SERVICE })} ratchet=${ratchetResolve.RESOLVE_SERVICE}`,
)

// The ratchet provides it, with the operations the route calls and no more. It is a
// service, never a tool: a tool that accepted a resolve request would be a second surface
// that starts a resolver, and the panel route is the one the fence and the capability guard.
const resolveService = provided.get(ratchetResolve.RESOLVE_SERVICE)
claim(
  'the ratchet provides the resolve service the route reaches, with plan, prompt, decline, history and rootFor',
  provided.has(ratchetResolve.RESOLVE_SERVICE) &&
    typeof resolveService?.plan === 'function' &&
    typeof resolveService?.prompt === 'function' &&
    typeof resolveService?.decline === 'function' &&
    typeof resolveService?.history === 'function' &&
    typeof resolveService?.rootFor === 'function',
  `provided=${JSON.stringify([...provided.keys()])} keys=${JSON.stringify(resolveService === undefined ? null : Object.keys(resolveService))}`,
)

// Drive the resolve service the route reaches. It derives a plan for a blocked record,
// records a refusal with its reason and reads it back into the next plan, and it mints
// nothing: the refusal is a ledger line, not a consent.
const resolveRoot = fixture('resolve-surface', {
  zones: [{ id: 'engine', paths: ['src/engine/**'], agentAuthority: 'activeIfNoConflict' }],
  adrs: {
    '0001-art.adr.md': adr({ id: '0001', status: 'proposed', authority: 'agent', zone: 'art' }),
  },
})
if (resolveService !== undefined) {
  const before = resolveService.plan({ root: resolveRoot, id: '0001' })
  claim(
    'the resolve service reports an undeclared zone as an agent step, and nothing declined yet',
    before.ok === true &&
      before.declined.length === 0 &&
      before.steps.some((step) => step.op === 'declare-zone' && step.zone === 'art') &&
      before.humanRequired === false,
    JSON.stringify(before),
  )
  const reasoned = resolveService.decline({ root: resolveRoot, id: '0001', comment: 'that zone would govern the wrong files; remap it instead' })
  const after = resolveService.plan({ root: resolveRoot, id: '0001' })
  const prompted = resolveService.prompt({ root: resolveRoot, id: '0001' })
  claim(
    'and a refusal is recorded with its reason, read back into the plan and carried by the prompt',
    reasoned.recorded === true &&
      after.declined.length === 1 &&
      /remap it instead/.test(after.declined[0].comment) &&
      prompted.ok === true &&
      /remap it instead/.test(prompted.prompt) &&
      /\[you\] declare-zone/.test(prompted.prompt) &&
      /never write `authority: human`/.test(prompted.prompt),
    JSON.stringify({ reasoned, declined: after.declined, promptHasReason: prompted.ok === true && /remap it instead/.test(prompted.prompt) }),
  )
}

// The ratification channel is a second duplicated vocabulary, and the one whose drift is
// silent in the worst way: a panel whose list lacks the channel its own route records reads
// its own approval as unproven and keeps offering the decision for ratification. So the
// bundle's list is compared with the ratchet's, and the channel the service mints under is
// required to be one of them.
const { RATIFICATION_CHANNELS } = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/ratchet-schema.mjs`)
const bundleChannels = /(?:^|\n)[ \t]*const RATIFICATION_CHANNELS\s*=\s*\[([^\]]*)\]/.exec(panelBundle)
const bundleChannelList = bundleChannels === null ? null : bundleChannels[1].split(',').map((entry) => entry.trim().replace(/^["']|["']$/g, '')).filter((entry) => entry !== '')
claim(
  'the panel knows every channel a ratification can have been obtained through',
  bundleChannelList !== null &&
    JSON.stringify(bundleChannelList) === JSON.stringify([...RATIFICATION_CHANNELS]) &&
    RATIFICATION_CHANNELS.includes(ratchetConsent.CONSENT_CHANNEL),
  `bundle=${JSON.stringify(bundleChannelList)} ratchet=${JSON.stringify([...RATIFICATION_CHANNELS])} consentChannel=${ratchetConsent.CONSENT_CHANNEL}`,
)

// (b) The route must be unreachable through the tool surface. The scan is the whole registry,
//     so a tool added later is inspected without an edit here, and it looks at the description
//     and every parameter name as well as the tool's own name.
const ROUTE_NEEDLES = [panelHost.CONSENT_ROUTE, panelHost.CONSENT_SERVICE, panelHost.CONSENT_HEADER, panelHost.CONSENT_GLOBAL, panelHost.STATE_ROUTE, panelHost.STATE_SERVICE, panelHost.STATE_HEADER, panelHost.STATE_GLOBAL, panelHost.RESOLVE_ROUTE, panelHost.RESOLVE_SERVICE, panelHost.RESOLVE_HEADER, panelHost.RESOLVE_GLOBAL]
const routeOffenders = []
for (const [toolName, definition] of registered) {
  const haystack = `${toolName}\n${definition?.description ?? ''}\n${JSON.stringify(definition?.parameters ?? {})}`
  for (const needle of ROUTE_NEEDLES) {
    if (haystack.includes(needle)) routeOffenders.push(`${toolName} exposes ${needle}`)
  }
}
claim(
  'no tool exposes the consent, state or resolve route, its service, its header or its capability',
  routeOffenders.length === 0 && registered.size >= 3,
  `tools=${registered.size} offenders=${JSON.stringify(routeOffenders)}`,
)

// (c) Drive the service the panel reaches. Every case below is the production operation: the
//     quiz comes from the ratchet's own `ask`, and the answer is the label that question put
//     on its option. A case that writes asserts the FILE COUNT, because a return value is a
//     claim and a written approval is the artifact.
const consentService = provided.get(ratchetConsent.CONSENT_SERVICE)
claim(
  'the ratchet provides the consent service the route reaches, with the three operations',
  provided.has(ratchetConsent.CONSENT_SERVICE) &&
    typeof consentService?.ask === 'function' &&
    typeof consentService?.settle === 'function' &&
    typeof consentService?.rootFor === 'function',
  `provided=${JSON.stringify([...provided.keys()])} keys=${JSON.stringify(consentService === undefined ? null : Object.keys(consentService))}`,
)

// The decisions service the state route reaches. It exposes a `view` operation and a root
// resolver, and driving it over the live fixture is what makes "the panel renders the
// ratchet's derivation" a claim about the shipped service rather than about a stub.
const decisionsService = provided.get(ratchetDecisions.DECISIONS_SERVICE)
claim(
  'the ratchet provides the decisions service the state route reaches, with view and rootFor',
  provided.has(ratchetDecisions.DECISIONS_SERVICE) &&
    typeof decisionsService?.view === 'function' &&
    typeof decisionsService?.rootFor === 'function',
  `provided=${JSON.stringify([...provided.keys()])} keys=${JSON.stringify(decisionsService === undefined ? null : Object.keys(decisionsService))}`,
)

const serviceRoot = fixture('service', {
  zones: [
    { id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' },
    { id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' },
  ],
  adrs: {
    '0001-waiting.adr.md': adr({ id: '0001', status: 'proposed', authority: 'agent', zone: 'api', laws: [{ id: 'api.one', statement: 'One.' }] }),
    '0002-blocked.adr.md': adr({ id: '0002', status: 'proposed', authority: 'agent', zone: 'auth', laws: [{ id: 'auth.one', statement: 'One.' }] }),
  },
})
const decisionCount = (root) => readdirSync(join(root, 'docs', 'adrs')).length
const sourceCount = (root) => readdirSync(join(root, 'docs', 'ratchet', 'sources')).length
// The ledger is the third file surface a consent touches, and the one the old claim
// ignored: a GET is not read-only, it appends the ratchet's audit event. Reading it back
// is what lets the check state the EXACT distinction — an audit line yes, an approval or
// transcript no — instead of repeating "writes nothing" over a file it never counted.
const ledgerEvents = (root) => {
  try {
    return readFileSync(join(root, '.dsh', 'ratchet', 'ledger.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}
const ledgerBefore = ledgerEvents(serviceRoot).length
const prepared = consentService.ask({ root: serviceRoot, ids: ['0001'], at: '2026-09-16T00:00:00Z' })
const ledgerAfter = ledgerEvents(serviceRoot)
claim(
  'asking the service prepares the ratchet\'s question and appends only its audit ledger line, never an approval or transcript',
  prepared.needsAnswer === true &&
    Array.isArray(prepared.quiz?.questions) &&
    prepared.quiz.questions.length === 1 &&
    prepared.quiz.roles['ratify-0001'].adrId === '0001' &&
    prepared.quiz.questions[0].detail.startsWith('---') &&
    decisionCount(serviceRoot) === 2 &&
    sourceCount(serviceRoot) === 0 &&
    ledgerAfter.length === ledgerBefore + 1 &&
    ledgerAfter[ledgerAfter.length - 1]?.event === 'ratchet.ratify.prepare',
  `needsAnswer=${String(prepared.needsAnswer)} questions=${prepared.quiz?.questions?.length} files=${decisionCount(serviceRoot)}/${sourceCount(serviceRoot)} ledger=${ledgerBefore}->${ledgerAfter.length} last=${JSON.stringify(ledgerAfter[ledgerAfter.length - 1]?.event ?? null)}`,
)
const approveLabel = prepared.quiz.roles['ratify-0001'].approveLabel

// The composed payload: a label with no question behind it. This is the failure the whole
// route exists to make impossible, and it is refused by the ratchet, not by the panel.
const unpaired = consentService.settle({ root: serviceRoot, adrId: '0001', label: approveLabel, quiz: null, at: '2026-09-16T00:00:00Z' })
claim(
  'a label with no quiz behind it mints nothing',
  unpaired.ok === false &&
    unpaired.unanswered === true &&
    (unpaired.problems ?? []).some((entry) => entry.code === 'RATIFICATION_UNPROVEN') &&
    decisionCount(serviceRoot) === 2 &&
    sourceCount(serviceRoot) === 0,
  `codes=${JSON.stringify((unpaired.problems ?? []).map((entry) => entry.code))} files=${decisionCount(serviceRoot)}`,
)

// A quiz that is not the one this ratchet builds — an empty roles map is how a caller-composed
// quiz with nothing in it used to mint a real approval.
const foreign = consentService.settle({
  root: serviceRoot,
  adrId: '0001',
  label: approveLabel,
  quiz: { attempt: 1, questions: prepared.quiz.questions, roles: {}, frozen: [] },
  at: '2026-09-16T00:00:00Z',
})
claim(
  'a quiz the ratchet did not build mints nothing',
  foreign.ok === false &&
    (foreign.problems ?? []).some((entry) => entry.code === 'RATIFICATION_UNPROVEN') &&
    decisionCount(serviceRoot) === 2,
  `codes=${JSON.stringify((foreign.problems ?? []).map((entry) => entry.code))} files=${decisionCount(serviceRoot)}`,
)

// A record whose zone reserves its paths to a human: the ratchet never queued it, so a
// question about it cannot be asked and nothing is minted however the label reads.
const blockedConsent = consentService.settle({
  root: serviceRoot,
  adrId: '0002',
  label: approveLabel,
  quiz: prepared.quiz,
  at: '2026-09-16T00:00:00Z',
})
claim(
  'a record whose zone forbids agent-held force mints nothing',
  blockedConsent.ok === false &&
    (blockedConsent.ratified ?? []).length === 0 &&
    /waiting for a human/.test(blockedConsent.message ?? '') &&
    decisionCount(serviceRoot) === 2 &&
    sourceCount(serviceRoot) === 0,
  `ratified=${JSON.stringify(blockedConsent.ratified ?? null)} message=${JSON.stringify(blockedConsent.message ?? null)}`,
)

// The real thing: the ratchet's own question, answered with the ratchet's own approve label.
const settled = consentService.settle({
  root: serviceRoot,
  adrId: '0001',
  label: approveLabel,
  quiz: prepared.quiz,
  askedBy: 'check-consent-surface',
  at: '2026-09-16T00:00:00Z',
})
claim(
  'the ratchet\'s own question, answered with its own label, writes the approval and its transcript',
  // `ok` is deliberately not asserted: the fixture's law declares no check, and the compile
  // that follows the write reports `LAW_UNCHECKED` for it. What this claim is about is that
  // the consent was recorded, so it asserts the ratification and the two artifacts.
  JSON.stringify(settled.ratified) === JSON.stringify(['0001']) &&
    Array.isArray(settled.wrote) &&
    settled.wrote.length === 2 &&
    typeof settled.approval?.path === 'string' &&
    typeof settled.transcript?.path === 'string' &&
    decisionCount(serviceRoot) === 3 &&
    sourceCount(serviceRoot) === 1,
  `ratified=${JSON.stringify(settled.ratified ?? null)} wrote=${JSON.stringify(settled.wrote ?? null)} files=${decisionCount(serviceRoot)}/${sourceCount(serviceRoot)} codes=${JSON.stringify((settled.problems ?? []).map((entry) => entry.code))}`,
)

// The channel the approval records is the SURFACE that carried the answer, not the harness
// seam's. A route-minted consent that said `user-question` would be a false statement in a
// durable record — and it would be indistinguishable from one the harness delivered.
const approvalText = readFileSync(join(serviceRoot, settled.approval.path), 'utf8')
const transcriptText = readFileSync(join(serviceRoot, settled.transcript.path), 'utf8')
claim(
  'a consent recorded through the route names the route as its channel, in the approval and the transcript',
  new RegExp(`^  channel: ${ratchetConsent.CONSENT_CHANNEL}$`, 'm').test(approvalText) &&
    new RegExp(`^- channel: ${ratchetConsent.CONSENT_CHANNEL}$`, 'm').test(transcriptText) &&
    RATIFICATION_CHANNELS.includes(ratchetConsent.CONSENT_CHANNEL),
  `channel=${ratchetConsent.CONSENT_CHANNEL} approval=${JSON.stringify(/^  channel: (.*)$/m.exec(approvalText)?.[1] ?? null)} transcript=${JSON.stringify(/^- channel: (.*)$/m.exec(transcriptText)?.[1] ?? null)}`,
)

// The same call again: the record is no longer waiting, so a replayed quiz mints nothing.
const replayed = consentService.settle({
  root: serviceRoot,
  adrId: '0001',
  label: approveLabel,
  quiz: prepared.quiz,
  at: '2026-09-16T00:00:00Z',
})
claim(
  'a replayed quiz mints nothing, because the record is no longer waiting',
  replayed.ok === false &&
    (replayed.ratified ?? []).length === 0 &&
    decisionCount(serviceRoot) === 3 &&
    sourceCount(serviceRoot) === 1,
  `ratified=${JSON.stringify(replayed.ratified ?? null)} files=${decisionCount(serviceRoot)}`,
)

// A decline is a real answer and still writes no approval or transcript — by the ratchet's
// own rule, not the panel's, which is what makes the UI's confirm step honest.
const declineRoot = fixture('service-decline', {
  zones: [{ id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
  adrs: { '0001-waiting.adr.md': adr({ id: '0001', status: 'proposed', authority: 'agent', zone: 'api', laws: [] }) },
})
const declineQuiz = consentService.ask({ root: declineRoot, ids: ['0001'], at: '2026-09-16T00:00:00Z' }).quiz
const declined = consentService.settle({
  root: declineRoot,
  adrId: '0001',
  label: declineQuiz.roles['ratify-0001'].rejectLabel,
  quiz: declineQuiz,
  at: '2026-09-16T00:00:00Z',
})
claim(
  'the ratchet\'s own reject label records a decline and writes no approval or transcript',
  declined.ok === false &&
    JSON.stringify(declined.rejected) === JSON.stringify(['0001']) &&
    (declined.ratified ?? []).length === 0 &&
    decisionCount(declineRoot) === 1,
  `rejected=${JSON.stringify(declined.rejected ?? null)} files=${decisionCount(declineRoot)}`,
)

// A record edited while the question was open: the answer is about text that is no longer
// there, so it is refused and nothing is written. This is the content-hash binding, and it is
// what the stale case exists for.
const staleRoot = fixture('service-stale', {
  zones: [{ id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
  adrs: { '0001-waiting.adr.md': adr({ id: '0001', status: 'proposed', authority: 'agent', zone: 'api', laws: [] }) },
})
const staleQuiz = consentService.ask({ root: staleRoot, ids: ['0001'], at: '2026-09-16T00:00:00Z' }).quiz
writeFileSync(
  join(staleRoot, 'docs', 'adrs', '0001-waiting.adr.md'),
  `${readFileSync(join(staleRoot, 'docs', 'adrs', '0001-waiting.adr.md'), 'utf8')}\n<!-- edited while the question was open -->\n`,
)
const stale = consentService.settle({
  root: staleRoot,
  adrId: '0001',
  label: staleQuiz.roles['ratify-0001'].approveLabel,
  quiz: staleQuiz,
  at: '2026-09-16T00:00:00Z',
})
claim(
  'an answer about a record edited since the question was asked mints nothing',
  stale.ok === false &&
    (stale.problems ?? []).some((entry) => entry.code === 'RATIFICATION_STALE') &&
    decisionCount(staleRoot) === 1 &&
    sourceCount(staleRoot) === 0,
  `codes=${JSON.stringify((stale.problems ?? []).map((entry) => entry.code))} files=${decisionCount(staleRoot)}`,
)
// And the same question, answered after the edit, is refused too: consent covers the text the
// human was SHOWN, so a fresh question has to be asked about the new text.
const staleAgain = consentService.ask({ root: staleRoot, ids: ['0001'], at: '2026-09-16T00:00:01Z' })
claim(
  'a stale refusal leaves the decision waiting, so it can be asked again',
  staleAgain.needsAnswer === true &&
    typeof staleAgain.quiz.frozen?.[0]?.contentHash === 'string' &&
    staleAgain.quiz.frozen[0].contentHash.length > 0,
  `needsAnswer=${String(staleAgain.needsAnswer)} frozen=${JSON.stringify(staleAgain.quiz?.frozen ?? null)}`,
)

for (const root of [serviceRoot, declineRoot, staleRoot]) rmSync(root, { recursive: true, force: true })

// 5b. Drive the decisions service the state route reaches: it must return the ratchet's
//     OWN derivation, so the panel has nothing to re-derive. The fixture carries one
//     waiting, one blocked and one withdrawn record, which the service must classify
//     exactly as the ratchet's `ratifications`/`resolveActiveSet` do.
{
  const viewRoot = fixture('state-view', {
    zones: [
      { id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' },
      { id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly' },
    ],
    adrs: {
      '0001-waiting.adr.md': adr({ id: '0001', status: 'proposed', authority: 'agent', zone: 'api', laws: [{ id: 'api.one', statement: 'One.' }] }),
      '0002-blocked.adr.md': adr({ id: '0002', status: 'proposed', authority: 'agent', zone: 'auth', laws: [{ id: 'auth.one', statement: 'One.' }] }),
      '0003-withdrawn.adr.md': adr({ id: '0003', status: 'withdrawn', authority: 'agent', zone: 'api', laws: [] }),
      '0004-in-force.adr.md': adr({ id: '0004', status: 'active', authority: 'human', zone: 'api', laws: [{ id: 'api.in-force', statement: 'A law in force.' }] }),
      '0005-human-waiting.adr.md': adr({ id: '0005', status: 'proposed', authority: 'human', zone: 'api', laws: [{ id: 'api.human', statement: 'A human draft.' }] }),
    },
  })
  const view = await decisionsService.view({ root: viewRoot })
  const byId = new Map(view.records.map((record) => [record.id, record]))
  const queue = ops.ratifications(viewRoot)
  claim(
    'the decisions service returns the ratchet\'s own queue and per-record state',
    view.ok === true &&
      JSON.stringify(view.queue.pending.map((entry) => entry.id).sort()) === JSON.stringify(queue.pending.map((entry) => entry.id).sort()) &&
      byId.get('0001')?.state?.kind === 'pending' &&
      byId.get('0001')?.canRatify === true &&
      byId.get('0002')?.state?.kind === 'neutral' &&
      /humanOnly/.test(byId.get('0002')?.blockedReason ?? '') &&
      byId.get('0002')?.canRatify === false &&
      byId.get('0003')?.state?.text === 'withdrawn' &&
      byId.get('0003')?.canRatify === false &&
      view.specs.length >= 1 &&
      Array.isArray(view.problems),
    `ok=${String(view.ok)} specs=${view.specs.length} pending=${JSON.stringify(view.queue.pending.map((entry) => entry.id))} states=${JSON.stringify([...byId.values()].map((record) => [record.id, record.state?.kind, record.canRatify]))}`,
  )
  // The dead end this pins: a human-authored `proposed` record is OFFERED the same question,
  // not left inert. The state route's own service must report it as a waiter with the ratify
  // action; the consent service below drives the same queue.
  claim(
    'a human-authored proposed record is offered the ratify action, not left not-in-force',
    byId.get('0005')?.canRatify === true &&
      byId.get('0005')?.state?.kind === 'pending' &&
      byId.get('0005')?.state?.text === 'awaiting a human' &&
      queue.pending.some((entry) => entry.id === '0005' && entry.authority === 'human'),
    `canRatify=${String(byId.get('0005')?.canRatify)} state=${JSON.stringify(byId.get('0005')?.state ?? null)} pending=${JSON.stringify(queue.pending.map((entry) => entry.id))}`,
  )
  claim(
    'and the decisions service resolves a project root the same way',
    decisionsService.rootFor(viewRoot) === viewRoot && decisionsService.rootFor(null) === null,
    `rootFor=${String(decisionsService.rootFor(viewRoot))} null=${String(decisionsService.rootFor(null))}`,
  )
  rmSync(viewRoot, { recursive: true, force: true })
}

// 5c. The decisions service CACHES the derived view, and the cache is keyed by a cheap
//     corpus signature so a refresh re-serves it while a corpus CHANGE can never be
//     served from a stale one. The invalidation proof is a real edit: a record added
//     between two calls must appear in the second answer and the signature must move.
//     The cap is driven directly, because the property is the SHAPE of what leaves the
//     service — a bounded answer that says what it dropped — not the size of a fixture.
{
  const cacheRoot = fixture('service-cache', {
    zones: [{ id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
    adrs: { '0001-first.adr.md': adr({ id: '0001', status: 'active', authority: 'human', zone: 'api', laws: [] }) },
  })
  const first = await decisionsService.view({ root: cacheRoot })
  const again = await decisionsService.view({ root: cacheRoot })
  claim(
    'the decisions service caches a derived view and re-serves it unchanged while the corpus is unchanged',
    first === again && Array.isArray(first.records) && first.records.some((record) => record.id === '0001'),
    `sameObject=${String(first === again)} records=${JSON.stringify(first.records?.map((record) => record.id) ?? null)}`,
  )
  const signatureBefore = ratchetDecisions.decisionsSignature(cacheRoot)
  writeFileSync(join(cacheRoot, 'docs', 'adrs', '0002-second.adr.md'), adr({ id: '0002', status: 'active', authority: 'human', zone: 'api', laws: [] }))
  const signatureAfter = ratchetDecisions.decisionsSignature(cacheRoot)
  const changed = await decisionsService.view({ root: cacheRoot })
  claim(
    'a corpus change moves the signature, so the cache is invalidated and the new record is served',
    signatureAfter !== signatureBefore && changed !== first && Array.isArray(changed.records) && changed.records.some((record) => record.id === '0002'),
    `signatureMoved=${String(signatureAfter !== signatureBefore)} records=${JSON.stringify(changed.records?.map((record) => record.id) ?? null)}`,
  )
  rmSync(cacheRoot, { recursive: true, force: true })
}

{
  const baseView = {
    ok: true,
    root: '/tmp/synthetic',
    project: { name: 'synthetic', decisionsDir: 'docs/adrs', specsDir: 'docs/specs' },
    specHash: null,
    records: [],
    queue: { ok: true, config: null, pending: [], blocked: [], problems: [] },
    specs: [],
    drift: { drifted: [], stale: [], missing: [], orphaned: [] },
    needsHuman: [],
    problems: [],
  }
  const manyRecords = {
    ...baseView,
    records: Array.from({ length: ratchetDecisions.MAX_STATE_RECORDS + 25 }, (_, index) => ({ id: String(index), title: `t${index}`, text: 'x'.repeat(120), laws: [], source: null })),
  }
  const capped = ratchetDecisions.capDecisionsView(manyRecords)
  claim(
    'a view over the record ceiling is cut to it and says so',
    capped.records.length === ratchetDecisions.MAX_STATE_RECORDS &&
      capped.truncated?.records?.total === manyRecords.records.length &&
      capped.truncated?.records?.shown === ratchetDecisions.MAX_STATE_RECORDS,
    `records=${capped.records.length} truncated=${JSON.stringify(capped.truncated?.records ?? null)}`,
  )
  const fatRecords = {
    ...baseView,
    records: Array.from({ length: 4 }, (_, index) => ({ id: String(index), title: `t${index}`, text: 'y'.repeat(1_200_000), laws: [], source: null })),
  }
  const byteCapped = ratchetDecisions.capDecisionsView(fatRecords)
  const bytes = JSON.stringify(byteCapped).length
  claim(
    'a view over the byte ceiling drops bodies until it fits, and names what it dropped',
    bytes <= ratchetDecisions.MAX_STATE_BYTES &&
      (byteCapped.truncated?.texts?.dropped ?? 0) >= 1 &&
      byteCapped.records.length === fatRecords.records.length,
    `bytes=${bytes} limit=${ratchetDecisions.MAX_STATE_BYTES} dropped=${JSON.stringify(byteCapped.truncated?.texts ?? null)}`,
  )
}

// 5d. The ROUTE half of the same distinction and the transport bound. The consent route
//     is driven through the very handler `apply` registers — not a factory this file
//     re-implemented — so a GET's durable effect is measured on the shipped route (one
//     audit ledger event, no approval, no transcript) and a POST body that never ends is
//     required to be refused with 408 and its request destroyed, within the route's own
//     declared deadline.
{
  const routeRoot = fixture('service-route', {
    zones: [{ id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly' }],
    adrs: { '0001-waiting.adr.md': adr({ id: '0001', status: 'proposed', authority: 'agent', zone: 'api', laws: [{ id: 'api.one', statement: 'One.' }] }) },
  })
  const captured = new Map()
  let injectCb = null
  const routeWeb = {
    effect: (fn) => fn(),
    on: (event, cb) => {
      if (event === 'webserver/index-inject') injectCb = cb
      return () => {}
    },
    webServer: {
      register: ({ path, handler }) => {
        captured.set(path, handler)
        return () => {}
      },
    },
  }
  const routeCtx = {
    logger: () => ({ info: () => {}, warn: () => {} }),
    inject: (_deps, cb) => cb(routeWeb),
    get: (serviceName) => {
      if (serviceName === 'connection') return { requestRejection: () => undefined }
      if (serviceName === 'sessions') return { get: (id) => (id === 'route-session' ? { header: { cwd: routeRoot } } : undefined) }
      if (serviceName === ratchetConsent.CONSENT_SERVICE) return consentService
      if (serviceName === ratchetDecisions.DECISIONS_SERVICE) return decisionsService
      return undefined
    },
  }
  panelHost.apply(routeCtx)
  const table = []
  injectCb(table)
  const token = table.find((row) => row.name === panelHost.CONSENT_GLOBAL)?.value?.token
  const consentHandler = captured.get(panelHost.CONSENT_ROUTE)
  const mockRes = () => {
    const finishListeners = []
    return {
      statusCode: 0,
      headersSent: false,
      body: null,
      setHeader(key, value) {
        this.headers = this.headers ?? {}
        this.headers[key] = value
      },
      end(body) {
        this.body = body
        this.headersSent = true
        for (const fn of finishListeners) fn()
      },
      once(event, fn) {
        if (event === 'finish' || event === 'close') finishListeners.push(fn)
      },
    }
  }

  const ledgerBefore = ledgerEvents(routeRoot).length
  const getRes = mockRes()
  await consentHandler(
    { url: `${panelHost.CONSENT_ROUTE}?session=route-session&id=0001`, method: 'GET', headers: { [panelHost.CONSENT_HEADER]: token } },
    getRes,
  )
  const ledgerAfter = ledgerEvents(routeRoot)
  claim(
    'the consent ROUTE\'s GET appends one audit ledger line and writes no approval or transcript',
    getRes.statusCode === 200 &&
      decisionCount(routeRoot) === 1 &&
      sourceCount(routeRoot) === 0 &&
      ledgerAfter.length === ledgerBefore + 1 &&
      ledgerAfter[ledgerAfter.length - 1]?.event === 'ratchet.ratify.prepare',
    `status=${getRes.statusCode} files=${decisionCount(routeRoot)}/${sourceCount(routeRoot)} ledger=${ledgerBefore}->${ledgerAfter.length} last=${JSON.stringify(ledgerAfter[ledgerAfter.length - 1]?.event ?? null)}`,
  )

  const hangingRequest = {
    method: 'POST',
    url: `${panelHost.CONSENT_ROUTE}?session=route-session`,
    headers: { 'content-type': 'application/json', [panelHost.CONSENT_HEADER]: token },
    destroyed: false,
    destroy() {
      this.destroyed = true
    },
    async *[Symbol.asyncIterator]() {
      // A partial body, then silence: the request never becomes complete.
      yield Buffer.from('{"session":"route-session",')
      await new Promise(() => {})
    },
  }
  const postRes = mockRes()
  let guardTimer = null
  const guard = new Promise((resolve) => {
    guardTimer = setTimeout(() => resolve('guard'), panelHost.BODY_READ_TIMEOUT_MS + 2000)
  })
  const started = Date.now()
  const outcome = await Promise.race([consentHandler(hangingRequest, postRes).then(() => 'answered'), guard])
  const elapsed = Date.now() - started
  if (guardTimer !== null) clearTimeout(guardTimer)
  const postBody = typeof postRes.body === 'string' ? JSON.parse(postRes.body) : null
  claim(
    'a POST whose body never completes is refused 408 within the deadline and the request is destroyed',
    outcome === 'answered' &&
      postRes.statusCode === 408 &&
      postBody?.error === 'request-timeout' &&
      hangingRequest.destroyed === true &&
      elapsed < panelHost.BODY_READ_TIMEOUT_MS + 1500,
    `outcome=${outcome} status=${postRes.statusCode} error=${JSON.stringify(postBody?.error ?? null)} destroyed=${String(hangingRequest.destroyed)} elapsed=${elapsed}ms deadline=${panelHost.BODY_READ_TIMEOUT_MS}ms`,
  )
  rmSync(routeRoot, { recursive: true, force: true })
}

// 6. The authority table is what makes the surface a surface. A zone that reserves a
//    path to humans is the only reason `proposeOnly` and `humanOnly` mean anything, and
//    the manifest is itself governed by no zone — so relaxing it is otherwise invisible.
//    This is a tripwire, not a proof: it reports that the reservation was edited, and
//    the decision to edit it is still a human's.
{
  const manifestPath = join(KIT, '.dsh', 'project.json')
  let ratifiable = false
  let detail = 'the manifest is unreadable as JSON'
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const zone = (manifest?.ratchet?.zones ?? []).find((entry) => entry.id === 'deployment-rules')
    ratifiable = zone?.agentAuthority === 'proposeOnly'
    detail =
      zone === undefined
        ? 'the manifest declares no deployment-rules zone'
        : `deployment-rules agentAuthority=${JSON.stringify(zone.agentAuthority)}`
  } catch (error) {
    detail = `the manifest is unreadable as JSON: ${String(error)}`
  }
  // ADR 0060: the reservation is a human RATIFICATION, not human authorship. Authorship is
  // not verifiable (a frontmatter word), so a `humanOnly` zone was a guarantee nothing could
  // keep; the table now reports the zone as ratifiable, and the claim above/below shows the
  // behaviour that goes with it. The `humanOnly` mechanism itself stays covered by fixtures.
  claim('the authority table reports the rules zone as ratifiable rather than reserved to authorship', ratifiable, detail)
}

if (failures.length > 0) {
  process.stderr.write(`consent surface FAILED\n${failures.map((entry) => `  - ${entry}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('consent surface ok\n')
