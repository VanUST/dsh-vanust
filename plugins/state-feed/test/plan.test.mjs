/*
PROOF: the plan reaches the model
Behavior: regenerateViews() writes state/plan.yaml from the same analysis records and journal the
  other projections read; a second run on unchanged state produces identical bytes; the file stays
  inside PLAN_YAML_LIMIT_BYTES; readState() carries it and composeL1() puts it in the L1 message as
  the "## Plan" section; the plan text is part of the state hash, so editing an analysis record
  moves the hash and the next turn gets a delta instead of missing the change.
Fails when: plan.yaml is not written, two regenerations differ, the file outgrows its cap, L1 has
  no Plan section, or a plan change leaves the state hash where it was.
Production path: plugins/project-state/lib/core.mjs (regenerateViews) with lib/views.mjs
  (renderPlanYaml, renderPlan) and plugins/state-feed/lib/feed.mjs (readState, composeL1).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateService } from '../../project-state/lib/core.mjs'
import { composeL1, readState } from '../lib/feed.mjs'
import { PLAN_YAML_LIMIT_BYTES } from '../../project-state/lib/views.mjs'

const clock = () => '2026-01-04T00:00:00.000Z'
/** The negative control: the harness sets this to prove the case can fail at all. */
const NEGATIVE_CONTROL = process.env.CASE_NEGATIVE_CONTROL

/** One initiative with one confirmed and one open requirement, plus one open journal task. */
async function seeded() {
  const cwd = await mkdtemp(join(tmpdir(), 'state-feed-plan-'))
  await mkdir(join(cwd, 'docs', 'analysis'), { recursive: true })
  await writeFile(join(cwd, 'docs', 'analysis', 'deliver-the-plan.json'), `${JSON.stringify({
    id: 'deliver-the-plan',
    title: 'Довести план до модели',
    status: 'active',
    requirements: [
      { id: 'BR1', status: 'done' },
      { id: 'BR2', status: 'open' },
      { id: 'BR3', status: 'open' },
    ],
  }, null, 2)}\n`)
  const state = createStateService({ cwd, now: clock })
  const task = await state.create('task', { title: 'Wire the plan into the first message' })
  return { cwd, state, task }
}

const planOf = (cwd) => readFile(join(cwd, 'state', 'plan.yaml'), 'utf8')

test('regenerateViews writes state/plan.yaml, and a second run is byte-identical', async () => {
  const { cwd, state } = await seeded()
  const first = await state.regenerateViews()
  assert.equal(first.ok, true)
  const once = await planOf(cwd)
  if (NEGATIVE_CONTROL !== undefined) assert.equal(once, '', `negative control "${NEGATIVE_CONTROL}": the plan must not be written`)
  assert.match(once, /^# GENERATED — DO NOT EDIT\./)
  assert.match(once, /id: "deliver-the-plan"/)
  assert.match(once, /stage: "active"/)
  assert.match(once, /confirmed: 1/)
  assert.match(once, /requirements: 3/)
  assert.ok(Buffer.byteLength(once, 'utf8') <= PLAN_YAML_LIMIT_BYTES, `plan.yaml is ${Buffer.byteLength(once, 'utf8')} bytes; the cap is ${PLAN_YAML_LIMIT_BYTES}`)
  await state.regenerateViews()
  assert.equal(await planOf(cwd), once, 'a second regeneration changed plan.yaml')
})

test('L1 carries the plan as its Plan section', async () => {
  const { cwd, state } = await seeded()
  await state.regenerateViews()
  const plan = await planOf(cwd)
  const view = readState(cwd)
  assert.equal(view.ok, true)
  assert.equal(view.plan, plan, 'readState did not read state/plan.yaml')
  const l1 = composeL1(view)
  const at = l1.indexOf('## Plan')
  assert.ok(at >= 0, 'L1 has no Plan section')
  assert.ok(l1.includes(plan.trim()), 'L1 does not carry the plan text')
  assert.ok(Buffer.byteLength(l1, 'utf8') <= PLAN_YAML_LIMIT_BYTES + 4096, 'L1 grew past the plan cap plus a session-sized body')
})

test('a changed analysis record changes the state hash', async () => {
  const { cwd, state } = await seeded()
  await state.regenerateViews()
  const before = readState(cwd)
  const record = JSON.parse(await readFile(join(cwd, 'docs', 'analysis', 'deliver-the-plan.json'), 'utf8'))
  record.requirements[1].status = 'done'
  await writeFile(join(cwd, 'docs', 'analysis', 'deliver-the-plan.json'), `${JSON.stringify(record, null, 2)}\n`)
  await state.regenerateViews()
  const after = readState(cwd)
  assert.notEqual(after.plan, before.plan, 'the plan summary did not follow the analysis record')
  assert.match(after.plan, /confirmed: 2/)
  assert.match(after.plan, /requirements: 3/)
  assert.notEqual(after.hash, before.hash, 'a plan change left the state hash where it was')
})
