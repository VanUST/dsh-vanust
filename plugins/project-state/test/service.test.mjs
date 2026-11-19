/*
PROOF: ccProjectState service publication
Behavior: the host row publishes `ccProjectState` through ctx.provide and registers the
  disposal with ctx.effect; every delegated method takes the workspace cwd first and returns a
  code instead of throwing, and an unknown kind is refused with kind_invalid.
Fails when: the row provides nothing, throws from apply, or a bad call escapes as an exception
  into the caller's turn.
Production path: plugins/project-state/index.mjs (apply), used by the host profile row.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.mjs'

test('apply publishes ccProjectState once and disposes it through ctx.effect', async () => {
  const effects = []
  const provided = []
  const ctx = {
    logger: { warn() {} },
    provide(name, service) {
      provided.push({ name, service })
      return () => {}
    },
    effect(fn) {
      effects.push(fn)
      return fn()
    },
  }
  const service = apply(ctx, {})
  assert.equal(provided.length, 1)
  assert.equal(provided[0].name, 'ccProjectState')
  assert.equal(provided[0].service, service)
  assert.equal(effects.length, 1)
  const cwd = await mkdtemp(join(tmpdir(), 'project-state-service-'))
  const created = await service.create(cwd, 'req', { title: 'Requirement', criteria: ['c'] })
  assert.equal(created.ok, true)
  assert.equal(created.id, 'REQ-001')
  const unknown = await service.create(cwd, 'nonsense', { title: 'x' })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.code, 'kind_invalid')
  const missing = await service.get(cwd, 'REQ-404')
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'not_found')
  const verdict = await service.verify(cwd)
  assert.equal(verdict.ok, true, JSON.stringify(verdict.findings))
})

test('the service exposes journal() so a consumer can leave a waiver event', async () => {
  const ctx = {
    logger: { warn() {} },
    provide: () => () => {},
    effect: (fn) => fn(),
  }
  const service = apply(ctx, {})
  const cwd = await mkdtemp(join(tmpdir(), 'project-state-journal-'))
  // The board's owner-status write records its override here; without this delegate the
  // trail the owner asked for silently disappears (the caller sees no journal method).
  assert.equal(typeof service.journal, 'function', 'the service publishes no journal()')
  const record = await service.journal(cwd, { code: 'owner_status_override', by: 'human', reason: 'owner decision', from: 'open', to: 'done' })
  assert.equal(record.seq, 1)
  assert.equal(record.kind, 'waiver')
  assert.equal(record.code, 'owner_status_override')
  assert.equal(record.by, 'human')
  const text = await (await import('node:fs/promises')).readFile(join(cwd, 'state', 'events.jsonl'), 'utf8')
  const events = text.trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(events.length, 1)
  assert.equal(events[0].to, 'done')
})
