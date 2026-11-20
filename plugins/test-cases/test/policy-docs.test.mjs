/*
PROOF: a role is told exactly the case surface it is registered with
Behavior: DEFAULT_ROLE_TOOLS grants case_update and case_verify to backend and case_verify (but
  not case_update) to reviewer; the README "Role availability" table lists each preset's row as
  the map does; sectionText(row) names exactly those verbs; and the registration gate registers
  nothing outside the row, so a preset without case_update cannot call it.
Fails when: the README table and DEFAULT_ROLE_TOOLS disagree, the owner's repair verbs are missing
  from backend or reviewer, case_update reaches a role that judges the change, or a prompt section
  names a verb the role's row does not carry.
Production path: plugins/test-cases/test-cases.mjs (DEFAULT_ROLE_TOOLS, sectionText,
  installCaseGate) and plugins/test-cases/README.md (the Role availability table).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_TOOLS, DEFAULT_ROLE_TOOLS, INTAKE_TOOLS, apply, sectionText } from '../test-cases.mjs'

const control = process.env.CASE_NEGATIVE_CONTROL ?? ''
const README = readFileSync(join(process.cwd(), 'plugins/test-cases/README.md'), 'utf8')
// The table cells quote tool names in backticks; spelled this way so the test file itself stays
// readable in a diff.
const TICK = String.fromCharCode(96)
const quoted = (name) => TICK + name + TICK

/** The availability table: one row per preset, with the case verbs named in it. */
function tableRows(text) {
  const section = text.split('## Role availability')[1]?.split('\n## ')[0] ?? ''
  const rows = {}
  const rowPattern = new RegExp('^\\|\\s*' + TICK + '([a-z]+)' + TICK + '\\s*\\|(.*)\\|\\s*$')
  const verbPattern = new RegExp(TICK + '(case_[a-z_]+)' + TICK, 'g')
  for (const line of section.split('\n')) {
    const match = rowPattern.exec(line)
    if (match === null) continue
    const verbs = [...match[2].matchAll(verbPattern)].map((hit) => hit[1])
    rows[match[1]] = [...new Set(verbs)]
  }
  return rows
}

/** A host context just rich enough for apply() and one agent. */
function registration(preset, cwd) {
  const created = []
  const registered = []
  const sections = []
  const ctx = {
    get: (name) => (name === 'toolFamilies' ? { presetFor: () => preset, allows: () => true } : undefined),
    provide: () => undefined,
    effect: () => undefined,
    on: (event, handler) => { if (event === 'agent/created') created.push(handler) },
    root: { on: () => undefined },
    logger: { warn: () => undefined },
    commands: { register: () => undefined },
  }
  apply(ctx, { dir: 'docs/cases' })
  const agent = {
    session: { header: { cwd, agentPreset: preset } },
    ctx: {
      tools: { register: (tool) => { registered.push(tool.name); return () => undefined } },
      systemPrompt: { section: (section) => { sections.push(section) } },
    },
  }
  for (const handler of created) handler({ agent })
  return { registered, sections }
}

test('negative control expect-pre-fix: the merged table row and a backend without case_update', () => {
  if (control !== 'expect-pre-fix') return
  const merged = [quoted('backend'), quoted('ux'), quoted('reviewer'), quoted('critic'), quoted('docs'), quoted('research')].join(', ')
  assert.ok(README.includes(merged), 'the pre-fix table lumped six roles into one row')
  assert.equal(DEFAULT_ROLE_TOOLS.backend.includes('case_update'), false, 'the pre-fix backend row carried no case_update')
})

test('backend owns case_update and case_verify; the roles that judge never edit', () => {
  assert.ok(DEFAULT_ROLE_TOOLS.backend.includes('case_update'), 'backend lost case_update: the owner of a case cannot repair its text')
  assert.ok(DEFAULT_ROLE_TOOLS.backend.includes('case_verify'), 'backend lost case_verify')
  assert.ok(DEFAULT_ROLE_TOOLS.reviewer.includes('case_verify'), 'reviewer lost case_verify')
  assert.equal(DEFAULT_ROLE_TOOLS.reviewer.includes('case_update'), false, 'reviewer judges the change and must not edit the case')
  assert.equal(DEFAULT_ROLE_TOOLS.critic.includes('case_update'), false, 'critic judges the change and must not edit the case')
  assert.deepEqual(DEFAULT_ROLE_TOOLS.orchestrator, INTAKE_TOOLS, 'the orchestrator intake row changed')
  for (const preset of ['ux', 'research', 'docs', 'gatherer']) {
    const widened = DEFAULT_ROLE_TOOLS[preset].some((verb) => verb === 'case_update' || verb === 'case_verify')
    assert.equal(widened, false, preset + ' was widened')
  }
})

test('the README table names every preset row exactly as DEFAULT_ROLE_TOOLS does', () => {
  const rows = tableRows(README)
  assert.deepEqual(Object.keys(rows).sort(), Object.keys(DEFAULT_ROLE_TOOLS).sort(), 'the README availability table and DEFAULT_ROLE_TOOLS list different presets')
  for (const preset of Object.keys(DEFAULT_ROLE_TOOLS)) {
    assert.deepEqual([...rows[preset]].sort(), [...DEFAULT_ROLE_TOOLS[preset]].sort(), 'README row for ' + preset + ' disagrees with DEFAULT_ROLE_TOOLS')
  }
})

test('the prompt section a role gets names exactly the verbs of its row', () => {
  for (const [preset, granted] of Object.entries(DEFAULT_ROLE_TOOLS)) {
    // An empty row gets no section at all (asserted in the registration test), so there is no text
    // to compare; only a row with verbs is ever rendered into a prompt.
    if (granted.length === 0) continue
    const text = sectionText(granted)
    for (const verb of granted) assert.ok(text.includes(verb), 'the section for ' + preset + ' does not name ' + verb)
    for (const verb of ALL_TOOLS) {
      if (granted.includes(verb)) continue
      assert.equal(text.includes(verb), false, 'the section for ' + preset + ' names ' + verb + ', which its row does not carry')
    }
  }
})

test('registration registers the row and nothing else; critic and reviewer cannot reach case_update', () => {
  const cwd = process.cwd()
  const critic = registration('critic', cwd)
  assert.deepEqual([...critic.registered].sort(), [...DEFAULT_ROLE_TOOLS.critic].sort())
  assert.equal(critic.registered.includes('case_update'), false)
  assert.equal(critic.sections[0].text.includes('case_update'), false, 'the critic prompt named a verb it cannot call')
  assert.ok(critic.sections[0].text.includes('case_run'))

  const backend = registration('backend', cwd)
  assert.ok(backend.registered.includes('case_update'), 'backend was told it owns the case but was not registered case_update')
  assert.ok(backend.registered.includes('case_verify'))
  assert.ok(backend.sections[0].text.includes('case_update'))
  assert.equal(backend.sections[0].text.includes('case_remove'), false, 'the backend prompt named a verb outside its row')

  const reviewer = registration('reviewer', cwd)
  assert.ok(reviewer.registered.includes('case_verify'))
  assert.equal(reviewer.registered.includes('case_update'), false)
  assert.equal(reviewer.sections[0].text.includes('case_update'), false)
})

test('a preset with an empty row receives no case tool and no section at all', () => {
  const gatherer = registration('gatherer', process.cwd())
  assert.deepEqual(gatherer.registered, [])
  assert.deepEqual(gatherer.sections, [])
})
