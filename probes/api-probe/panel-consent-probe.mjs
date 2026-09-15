/**
 * PURPOSE
 *   Prove that the ADR panel's consent route records a human's decision end to end —
 *   and that it mints nothing for anything else. The route is driven over real HTTP
 *   against a real `@deepseek-ai/dsh-host-webserver` and a real
 *   `@deepseek-ai/dsh-client-connection`, with the production panel host half and the
 *   production ratchet plugin composed, and a stub human standing in for the browser:
 *   it fetches the route, reads the ratchet's own question out of the response, and
 *   posts the label that question offered.
 *
 *   A probe that called `ratify` directly would prove only that an operation works.
 *   What is unproven until this runs is the ROUTE: that a browser-facing HTTP handler
 *   can obtain the ratchet's own question, that the answer it is handed must carry that
 *   question or be refused, that the capability the panel's bundle sends is required,
 *   that the harness's browser fence answers an unauthenticated caller with 401, and
 *   that the approval and transcript on disk are the ones the ratchet writes.
 *
 * INPUTS
 *   No configuration. Mounted only by `scripts/probe-dsh-api.mjs --adr-panel-consent`,
 *   which also mounts the panel's host half, `@cc/dsh-ratchet`, the webserver and the
 *   connection. The fixture project is written into the RUN'S SESSION WORKSPACE, because
 *   the route resolves its project root from the Session id the caller supplies — which
 *   is itself a fact under test.
 *
 * OUTPUTS
 *   Registers `zzprobe_adr_panel_consent`, which returns every request it made, the
 *   status and body the route answered with, the files on disk before and after each
 *   case, and the laws the ratification put into force. The evidence is the route's own
 *   answers, not a paraphrase.
 *
 * KEYWORDS
 *   adr panel, consent route, capability token, browser trust fence, http, integration
 *   probe, end to end, ratification, no composed answer
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `webServer` service: the probe reports it and stops; there is no route to drive.
 *   - No `connection` service: likewise, because the fence is half of what is measured.
 *   - The panel's capability row absent from the index-injection table: reported as the
 *     delivery failure it is, before any request is made.
 *   - No live Session for the calling agent: reported, because the route cannot resolve a
 *     project without one.
 *   - The fixture directory already exists: rebuilt from scratch, so a previous run's
 *     approval can never be this run's input.
 *   - Any request that throws (a closed socket, a refused connection): reported as the
 *     status `null` and the error's message, never as an exception out of the tool.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { hashSource } from '../../plugins/ratchet/ratchet-schema.mjs'
import { compileProject } from '../../plugins/ratchet/ratchet-compiler.mjs'

/** Cordis function-plugin name; also the id a patch row targets. */
export const name = 'api-probe-adr-panel-consent'

/** The tool registry. Every other service is reached at call time, like the production path. */
export const inject = ['tools']

/** The global the panel's host half publishes its route and capability under. */
const CONSENT_GLOBAL = '__DSH_ADR_PANEL_CONSENT__'

/** The header the panel's bundle sends that capability in. */
const CONSENT_HEADER = 'x-adr-panel-consent'

/** The reasoning each fixture decision cites, so the source hash verifies. */
const SOURCE_TEXT = [
  '# Grilling session: request budgets',
  '',
  'One endpoint served a report that scanned every row, and a single caller could hold the',
  'database for minutes. We agreed a per-caller budget, because a limit nobody publishes is',
  'a limit nobody can design against.',
  '',
].join('\n')

/** The reasoning the second fixture decision cites. */
const SOURCE_TEXT_TWO = [
  '# Grilling session: config reloads',
  '',
  'Config was read once at boot and a restart was the only way to change it. We agreed on a',
  'watched file with a validated reload, because a reload that can fail has to fail loudly.',
  '',
].join('\n')

/** The reasoning the third fixture decision cites. */
const SOURCE_TEXT_THREE = [
  '# Grilling session: audit retention',
  '',
  'Audit rows were pruned with the operational data and a two-year-old incident could not be',
  'reconstructed. We agreed a separate retention window, because evidence that expires with',
  'the noise is not evidence.',
  '',
].join('\n')

/**
 * Writes the fixture project into the run's session workspace.
 *
 * Three decisions: one a human will approve (so an approval and a transcript are written),
 * one whose zone reserves its paths to a human (so a "yes" can never be recorded), and one
 * whose file is edited between the question and the answer (so the stale check is exercised)
 * and is then declined.
 *
 * @param root - The session workspace, absolute.
 * @returns The absolute fixture root, which is `root` itself.
 */
function buildFixture(root) {
  for (const directory of ['.dsh', 'docs/adrs', 'docs/ratchet/sources']) {
    rmSync(join(root, directory), { recursive: true, force: true })
    mkdirSync(join(root, directory), { recursive: true })
  }

  writeFileSync(
    join(root, '.dsh', 'project.json'),
    `${JSON.stringify(
      {
        manifestVersion: 2,
        name: 'adr-panel-consent-fixture',
        languages: [{ id: 'javascript', extensions: ['.mjs'], roots: ['plugins'] }],
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
          zones: [
            { id: 'api', paths: ['src/api/**'], agentAuthority: 'proposeOnly', requiresDecisionRecord: false },
            { id: 'auth', paths: ['src/auth/**'], agentAuthority: 'humanOnly', requiresDecisionRecord: false },
          ],
        },
      },
      null,
      2,
    )}\n`,
  )

  writeFileSync(join(root, 'docs', 'ratchet', 'sources', 'request-budgets.md'), SOURCE_TEXT)
  writeFileSync(join(root, 'docs', 'ratchet', 'sources', 'config-reloads.md'), SOURCE_TEXT_TWO)
  writeFileSync(join(root, 'docs', 'ratchet', 'sources', 'audit-retention.md'), SOURCE_TEXT_THREE)

  writeFileSync(
    join(root, 'docs', 'adrs', '0001-request-budgets.adr.md'),
    [
      '---',
      'id: "0001"',
      'title: Every caller has a request budget',
      'type: adr',
      'status: proposed',
      'author:',
      '  authority: agent',
      '  name: ratchet-ingest',
      'created: "2026-09-16T00:00:00Z"',
      'source:',
      '  kind: file',
      '  path: docs/ratchet/sources/request-budgets.md',
      `  hash: ${hashSource(SOURCE_TEXT)}`,
      'zones:',
      '  - api',
      'supersedes: []',
      'approves: []',
      'laws:',
      '  - op: upsert',
      '    id: api.request-budget',
      '    statement: Every caller is limited to its own request budget.',
      '    checks:',
      '      - type: required_file',
      '        path: src/api/budget.mjs',
      '---',
      '',
      '## Context',
      '',
      'One endpoint served a report that scanned every row.',
      '',
      '## Decision',
      '',
      'Every caller is limited to its own request budget.',
      '',
      '## Reasoning',
      '',
      'A limit nobody publishes is a limit nobody can design against.',
      '',
      '## Consequences',
      '',
      '- A caller that exceeds its budget is refused.',
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(root, 'docs', 'adrs', '0002-auth-keys.adr.md'),
    [
      '---',
      'id: "0002"',
      'title: Auth keys live in the secret store',
      'type: adr',
      'status: proposed',
      'author:',
      '  authority: agent',
      '  name: ratchet-ingest',
      'created: "2026-09-16T00:00:00Z"',
      'source:',
      '  kind: file',
      '  path: docs/ratchet/sources/config-reloads.md',
      `  hash: ${hashSource(SOURCE_TEXT_TWO)}`,
      'zones:',
      '  - auth',
      'supersedes: []',
      'approves: []',
      'laws:',
      '  - op: upsert',
      '    id: auth.keys-in-store',
      '    statement: Auth keys are read from the secret store.',
      '    checks: []',
      '---',
      '',
      '## Context',
      '',
      'Auth keys were read from the environment.',
      '',
      '## Decision',
      '',
      'Auth keys are read from the secret store.',
      '',
      '## Reasoning',
      '',
      'An environment variable is visible to every child process.',
      '',
      '## Consequences',
      '',
      '- The secret store becomes a boot dependency.',
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(root, 'docs', 'adrs', '0003-audit-retention.adr.md'),
    [
      '---',
      'id: "0003"',
      'title: Audit rows have their own retention window',
      'type: adr',
      'status: proposed',
      'author:',
      '  authority: agent',
      '  name: ratchet-ingest',
      'created: "2026-09-16T00:00:00Z"',
      'source:',
      '  kind: file',
      '  path: docs/ratchet/sources/audit-retention.md',
      `  hash: ${hashSource(SOURCE_TEXT_THREE)}`,
      'zones:',
      '  - api',
      'supersedes: []',
      'approves: []',
      'laws:',
      '  - op: upsert',
      '    id: api.audit-retention',
      '    statement: Audit rows are pruned only by their own retention window.',
      '    checks: []',
      '---',
      '',
      '## Context',
      '',
      'Audit rows were pruned with the operational data.',
      '',
      '## Decision',
      '',
      'Audit rows are pruned only by their own retention window.',
      '',
      '## Reasoning',
      '',
      'Evidence that expires with the noise is not evidence.',
      '',
      '## Consequences',
      '',
      '- Audit storage outlives operational storage.',
      '',
    ].join('\n'),
  )
  return root
}

/**
 * Registers the consent-route probe.
 *
 * @param ctx - Cordis context exposing `tools`; every other service is reached with `get`.
 * @returns Nothing; the registration lives inside an effect and is disposed with it.
 */
export function apply(ctx) {
  ctx.effect(() => {
    const dispose = ctx.tools.register(
      defineTool({
        name: 'zzprobe_adr_panel_consent',
        description:
          'Probe: drive the ADR panel\'s consent route over real HTTP against the production panel host half and the ' +
          'ratchet, with a stub human posting the label the ratchet\'s own question offered, and record the approval it writes.',
        parameters: {},
        output: {
          schema: { type: 'json' },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(_args, exec) {
          const workspace = exec?.agent?.session?.header?.cwd
          const sessionId = exec?.agent?.id
          const web = ctx.get('webServer')
          const connection = ctx.get('connection')
          const sessions = ctx.get('sessions')

          const decide = (body) => {
            if (body === null || typeof body !== 'object') return null
            const decisions = Array.isArray(body.decisions) ? body.decisions : []
            return {
              ok: body.ok === true,
              ratified: body.ratified ?? null,
              rejected: body.rejected ?? null,
              unreadable: body.unreadable ?? null,
              wrote: body.wrote ?? null,
              approval: body.approval ?? null,
              transcript: body.transcript ?? null,
              message: body.message ?? null,
              needsAnswer: body.needsAnswer ?? null,
              error: body.error ?? null,
              codes: decisions.length === 0 ? (Array.isArray(body.problems) ? body.problems.map((entry) => entry.code) : []) : decisions,
              problems: Array.isArray(body.problems) ? body.problems.map((entry) => ({ code: entry.code, message: String(entry.message ?? '').slice(0, 200) })) : [],
            }
          }
          const askSummary = (body) => {
            const question = body?.quiz?.questions?.[0] ?? null
            const role = question === null ? null : body.quiz.roles?.[question.id] ?? null
            return {
              needsAnswer: body?.needsAnswer ?? null,
              nothingToRatify: body?.nothingToRatify ?? null,
              message: body?.message ?? null,
              questionId: question?.id ?? null,
              header: question?.header ?? null,
              text: question?.question ?? null,
              labels: Array.isArray(question?.options) ? question.options.map((option) => option.label) : [],
              detailBytes: typeof question?.detail === 'string' ? question.detail.length : 0,
              detailHasFrontmatter: typeof question?.detail === 'string' && question.detail.startsWith('---'),
              approveLabel: role?.approveLabel ?? null,
              rejectLabel: role?.rejectLabel ?? null,
              frozenHash: body?.quiz?.frozen?.[0]?.contentHash ?? null,
            }
          }
          if (web === undefined || web === null || typeof web.collectIndexInjections !== 'function') {
            return { probe: 'adr-panel-consent', servicePresent: false, reason: 'no webServer service is mounted, so there is no route to drive', workspace }
          }
          if (connection === undefined || connection === null || typeof connection.authorizeIndex !== 'function') {
            return { probe: 'adr-panel-consent', servicePresent: false, reason: 'no connection service is mounted, so the browser fence cannot be measured', workspace }
          }
          if (typeof workspace !== 'string' || workspace.length === 0) {
            return { probe: 'adr-panel-consent', servicePresent: false, reason: 'the calling agent has no session workspace', workspace }
          }

          const fixture = buildFixture(workspace)
          const decisions = () => readdirSync(join(fixture, 'docs', 'adrs')).length
          const sources = () => readdirSync(join(fixture, 'docs', 'ratchet', 'sources')).length

          // The capability, obtained EXACTLY as the browser obtains it: the index-injection
          // table the harness renders into the page. Nothing else hands it out.
          const table = web.collectIndexInjections()
          const row = table.find((entry) => entry !== null && typeof entry === 'object' && entry.kind === 'global' && entry.name === CONSENT_GLOBAL)
          if (row === undefined || row.value === undefined || typeof row.value.route !== 'string' || typeof row.value.token !== 'string') {
            return {
              probe: 'adr-panel-consent',
              servicePresent: false,
              reason: `the panel's host half published no ${CONSENT_GLOBAL} index row, so the browser half would have no route to call`,
              workspace,
              injectionRows: table.map((entry) => ({ kind: entry?.kind ?? null, name: entry?.name ?? null })),
            }
          }

          const port = web.port
          const base = `http://127.0.0.1:${String(port)}`
          const authority = `127.0.0.1:${String(port)}`

          // Mint a browser session the way the harness does: exchange the process launch
          // token at `/` and read the signed cookie out of the response. Done by calling the
          // production `authorizeIndex` rather than by forging a cookie, because a forged one
          // would prove nothing about the fence.
          const minted = { status: null, setCookie: null }
          const fakeRequest = { method: 'GET', url: new URL(connection.authenticatedUrl(base)).pathname + new URL(connection.authenticatedUrl(base)).search, headers: { host: authority } }
          const fakeResponse = {
            writeHead(status, headers) {
              minted.status = status
              if (headers !== undefined && headers !== null && typeof headers['set-cookie'] === 'string') minted.setCookie = headers['set-cookie']
            },
            end() {},
          }
          connection.authorizeIndex(fakeRequest, fakeResponse)
          const cookie = minted.setCookie === null ? null : minted.setCookie.split(';', 1)[0]

          /** One HTTP call to the route, with whatever headers the case needs. */
          const call = async (path, init = {}) => {
            const headers = Object.assign({}, init.headers ?? {})
            try {
              const response = await fetch(`${base}${path}`, Object.assign({}, init, { headers }))
              const text = await response.text()
              let body = null
              try {
                body = JSON.parse(text)
              } catch {
                body = null
              }
              return { status: response.status, body, text: body === null ? text.slice(0, 200) : null }
            } catch (error) {
              return { status: null, body: null, text: `the request threw: ${String(error)}` }
            }
          }
          const ask = (id, withCookie, withToken) =>
            call(`/adr-panel/consent?session=${encodeURIComponent(String(sessionId))}&id=${encodeURIComponent(id)}`, {
              method: 'GET',
              headers: Object.assign({}, withCookie ? { cookie } : {}, withToken ? { [CONSENT_HEADER]: row.value.token } : {}),
            })
          const settle = (payload, withCookie = true, withToken = true) =>
            call('/adr-panel/consent', {
              method: 'POST',
              headers: Object.assign({ 'content-type': 'application/json' }, withCookie ? { cookie } : {}, withToken ? { [CONSENT_HEADER]: row.value.token } : {}),
              body: JSON.stringify(payload),
            })

          const cases = {}

          // A. The fence: no browser session, no consent. This is the measurement that makes
          //    "unreachable by a non-browser caller" a fact rather than a hope.
          const beforeFence = { decisions: decisions(), sources: sources() }
          const unauthenticated = await ask('0001', false, true)
          cases.unauthenticated_ask = { status: unauthenticated.status, wrote: { decisions: decisions() - beforeFence.decisions, sources: sources() - beforeFence.sources } }

          // B. The capability: a caller that was not served this process's index cannot even
          //    build a question.
          const noCapability = await ask('0001', true, false)
          cases.ask_without_capability = { status: noCapability.status, body: noCapability.body }
          const wrongCapability = await call(`/adr-panel/consent?session=${encodeURIComponent(String(sessionId))}&id=0001`, {
            method: 'GET',
            headers: { cookie, [CONSENT_HEADER]: `${row.value.token}-tampered` },
          })
          cases.ask_with_wrong_capability = { status: wrongCapability.status, body: wrongCapability.body }

          // C. The question itself, as the ratchet builds it.
          const asked = await ask('0001', true, true)
          cases.ask = { status: asked.status, ...askSummary(asked.body) }
          const quiz = asked.body?.quiz ?? null
          const approveLabel = quiz?.roles?.[Object.keys(quiz.roles ?? {})[0]]?.approveLabel ?? null
          const questionId = Object.keys(quiz?.roles ?? {})[0] ?? null

          // D. A hand-composed payload: the label, no question behind it.
          const beforeComposed = { decisions: decisions(), sources: sources() }
          const composed = await settle({ session: sessionId, adrId: '0001', label: approveLabel, quiz: null })
          cases.composed_answer_without_quiz = {
            status: composed.status,
            result: decide(composed.body),
            wrote: { decisions: decisions() - beforeComposed.decisions, sources: sources() - beforeComposed.sources },
          }

          // E. A quiz the ratchet did not build.
          const foreign = await settle({
            session: sessionId,
            adrId: '0001',
            label: approveLabel,
            quiz: { attempt: 1, questions: quiz?.questions ?? [], roles: {}, frozen: [] },
          })
          cases.foreign_quiz = {
            status: foreign.status,
            result: decide(foreign.body),
            wrote: { decisions: decisions() - beforeComposed.decisions, sources: sources() - beforeComposed.sources },
          }

          // F. The record whose zone reserves its paths to a human: the ratchet never queued
          //    it, so the click cannot record anything however it reads.
          const blocked = await settle({ session: sessionId, adrId: '0002', label: approveLabel, quiz })
          cases.blocked_zone = {
            status: blocked.status,
            result: decide(blocked.body),
            wrote: { decisions: decisions() - beforeComposed.decisions, sources: sources() - beforeComposed.sources },
          }

          // G. THE STUB HUMAN: the label the ratchet's own question offered, posted with the
          //    question it came from. This is the case the whole route exists for.
          const beforeMint = { decisions: decisions(), sources: sources() }
          const minted2 = await settle({ session: sessionId, adrId: '0001', label: approveLabel, quiz })
          const approvalPath = minted2.body?.approval?.path ?? null
          const transcriptPath = minted2.body?.transcript?.path ?? null
          // The channel the approval records is the surface that CARRIED the answer. It is
          // read out of the written file rather than out of the response, because the file is
          // what a reviewer of the corpus sees.
          const channelIn = (relative, pattern) => {
            if (typeof relative !== 'string') return null
            try {
              const match = pattern.exec(readFileSync(join(fixture, relative), 'utf8'))
              return match === null ? null : match[1]
            } catch {
              return null
            }
          }
          cases.approved = {
            status: minted2.status,
            result: decide(minted2.body),
            wrote: { decisions: decisions() - beforeMint.decisions, sources: sources() - beforeMint.sources },
            approvalChannel: channelIn(approvalPath, /^  channel: (.*)$/m),
            transcriptChannel: channelIn(transcriptPath, /^- channel: (.*)$/m),
          }

          // H. The same answer again: the record is in force, so the replay mints nothing.
          const beforeReplay = { decisions: decisions(), sources: sources() }
          const replay = await settle({ session: sessionId, adrId: '0001', label: approveLabel, quiz })
          cases.replayed = {
            status: replay.status,
            result: decide(replay.body),
            wrote: { decisions: decisions() - beforeReplay.decisions, sources: sources() - beforeReplay.sources },
          }

          // I. A record edited while the question about it was open: the consent covers the
          //    text the human was SHOWN, so the answer is refused rather than bound to the
          //    revision on disk.
          const staleAsk = await ask('0003', true, true)
          const staleQuiz = staleAsk.body?.quiz ?? null
          const staleLabel = staleQuiz?.roles?.[Object.keys(staleQuiz.roles ?? {})[0]]?.approveLabel ?? null
          const stalePath = join(fixture, 'docs', 'adrs', '0003-audit-retention.adr.md')
          writeFileSync(stalePath, `${readFileSync(stalePath, 'utf8')}\n<!-- edited while the question was open -->\n`)
          const beforeStale = { decisions: decisions(), sources: sources() }
          const stale = await settle({ session: sessionId, adrId: '0003', label: staleLabel, quiz: staleQuiz })
          cases.stale_text = {
            status: stale.status,
            result: decide(stale.body),
            wrote: { decisions: decisions() - beforeStale.decisions, sources: sources() - beforeStale.sources },
          }

          // J. The decline, on a question asked after the edit: a real answer that writes
          //    nothing, by the ratchet's own rule.
          const declineAsk = await ask('0003', true, true)
          const declineQuiz = declineAsk.body?.quiz ?? null
          const declineLabel = declineQuiz?.roles?.[Object.keys(declineQuiz.roles ?? {})[0]]?.rejectLabel ?? null
          const declined = await settle({ session: sessionId, adrId: '0003', label: declineLabel, quiz: declineQuiz })
          cases.declined = {
            status: declined.status,
            result: decide(declined.body),
            wrote: { decisions: decisions() - beforeStale.decisions, sources: sources() - beforeStale.sources },
          }

          const compiled = compileProject(fixture)
          return {
            probe: 'adr-panel-consent',
            servicePresent: true,
            workspace,
            sessionId: sessionId ?? null,
            sessionResolved: sessions === undefined ? null : sessions.get(sessionId)?.header?.cwd ?? null,
            route: row.value.route,
            capabilityBytes: row.value.token.length,
            browserSessionMinted: minted.setCookie !== null,
            cases,
            files: { decisions: readdirSync(join(fixture, 'docs', 'adrs')).sort(), sources: readdirSync(join(fixture, 'docs', 'ratchet', 'sources')).sort() },
            counts: compiled.report.counts,
            lawsInForce: (compiled.bundle?.laws ?? []).map((law) => ({ id: law.id, approvedBy: law.approvedBy ?? null })),
            compileProblemCodes: (compiled.problems ?? []).map((entry) => entry.code),
          }
        },
      }),
    )
    return () => dispose()
  })
}
