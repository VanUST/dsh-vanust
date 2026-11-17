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
