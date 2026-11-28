/*
PROOF: one module owns the subagent activation form, and both pinned harness contracts read it.
Behavior: activationSpec() takes the facts of one delegation (role, preset, prompt, parent, route,
  cwd, signal) and returns the spec ctx.subagents.startActivation expects. The default 'both' carries
  the request twice: nested as spec.request.* for dsh 0.2.1 and flat as spec.parent/prompt/... for
  dsh 0.2.2-rc.3 (SubagentActivationSpec extends SubagentStartRequest). 'request' and 'flat' build
  one shape each so a test can exercise either reader; an unknown form is an explicit refusal.
  orchestrator.mjs imports this module and names no activation field itself.
Fails when: the two readers disagree on one input, an unknown form silently guesses, or the
  orchestrator starts building the spec again.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { activationSpec, ACTIVATION_FORMS } from '../harness-seam.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const parent = { id: 'parent-1', session: { header: { cwd: '/tmp/ws' } } }
const input = { role: 'DOCS', preset: 'docs', prompt: 'write the note', parent, route: 'spawn', cwd: '/tmp/ws', signal: 'SIG' }

test('one input, both shapes: dsh 0.2.1 reads spec.request.*, dsh 0.2.2 reads the top level', () => {
  const spec = activationSpec(input)
  assert.equal(spec.provider, 'spawn')
  assert.equal(spec.label, 'DOCS')
  assert.equal(spec.delivery, 'parent')
  assert.equal(spec.signal, 'SIG')
  // The flat reader (0.2.2-rc.3: SubagentActivationSpec extends SubagentStartRequest).
  assert.equal(spec.parent.id, 'parent-1')
  assert.equal(spec.agentPreset, 'docs')
  assert.equal(spec.cwd, '/tmp/ws')
  assert.deepEqual(spec.prompt, [{ type: 'text', text: 'write the note' }])
  // The nested reader (0.2.1: spec.request.*).
  assert.equal(spec.request.parent.id, 'parent-1')
  assert.equal(spec.request.agentPreset, 'docs')
  assert.equal(spec.request.cwd, '/tmp/ws')
  assert.deepEqual(spec.request.prompt, spec.prompt)
  assert.equal(spec.request.provider, undefined, 'provider stays top-level only')
})

test('one shape at a time, and an unknown form is an explicit refusal', () => {
  const nested = activationSpec({ ...input, form: 'request' })
  assert.equal(nested.request.parent.id, 'parent-1')
  assert.equal(nested.parent, undefined)
  const flat = activationSpec({ ...input, form: 'flat' })
  assert.equal(flat.parent.id, 'parent-1')
  assert.equal(flat.request, undefined)
  assert.throws(() => activationSpec({ ...input, form: '0.2.3' }), /unknown activation form/)
  assert.deepEqual([...ACTIVATION_FORMS], ['both', 'request', 'flat'])
})

test('the orchestrator names no activation field: the seam is the only place', () => {
  const source = readFileSync(join(HERE, '..', 'orchestrator.mjs'), 'utf8')
  assert.match(source, /from '\.\/harness-seam\.mjs'/, 'the orchestrator must import the seam')
  assert.equal(source.includes('function activationSpec'), false, 'the orchestrator builds the spec itself again')
  for (const marker of ['spec.request', 'maxDepth', 'outputSchema', '...request']) {
    assert.equal(source.includes(marker), false, 'orchestrator.mjs still names the activation form: ' + marker)
  }
})
