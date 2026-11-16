/**
 * PROOF:
 * Behavior: the human annotation layer round-trips through the real command
 *   (`/designmap op:'annotate'`): elements are stored whole in designmap/annotations.json,
 *   a forged `customData.designmap` is refused (a drawing may never masquerade as scene
 *   geometry), unsupported types / non-finite geometry / over-limit batches are refused
 *   with stable codes and write nothing, and model.yaml is byte-identical afterwards.
 * Fails when: the layer can smuggle a model or scene field, a refusal still writes the
 *   file, the file loses draw order, or annotations reach the model.
 * Production path: src/command.mjs createCommandHandler -> src/host.mjs annotate ->
 *   src/workspace.mjs writeAnnotations.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createCommandHandler } from '../src/command.mjs'
import { createHostService } from '../src/host.mjs'
import { makeRepo } from './host-helpers.mjs'

const hashOf = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`
const NOTE = { id: 'note-1', type: 'text', x: 20, y: 30, width: 140, height: 24, text: 'remember this', fontSize: 14 }
const HIGHLIGHT = { id: 'mark-1', type: 'rectangle', x: 5, y: 5, width: 200, height: 80, backgroundColor: '#fde68a', fillStyle: 'solid' }

function harness() {
  const repo = makeRepo()
  const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
  const command = createCommandHandler({ hostFor: () => ({ service, logger: null }) })
  const run = (op) => command({ rawInput: JSON.stringify(op), agent: null })
  return { repo, command, run }
}

test('annotate stores the human layer whole, in draw order, and never touches the model', async () => {
  const { repo, run } = harness()
  const modelBefore = readFileSync(join(repo.designmapDir, 'model.yaml'), 'utf8')
  const answer = await run({ op: 'annotate', elements: [HIGHLIGHT, NOTE] })
  assert.equal(answer.kind, 'success')
  const value = JSON.parse(answer.text)
  assert.equal(value.elements, 2)
  assert.equal(value.annotationsPath, 'designmap/annotations.json')

  const document = JSON.parse(readFileSync(join(repo.designmapDir, 'annotations.json'), 'utf8'))
  assert.equal(document.schemaVersion, 1)
  assert.deepEqual(document.elements.map((element) => element.id), ['mark-1', 'note-1'], 'draw order must survive')
  assert.equal(document.elements[0].backgroundColor, '#fde68a')
  assert.equal(document.elements[1].text, 'remember this')

  const modelAfter = readFileSync(join(repo.designmapDir, 'model.yaml'), 'utf8')
  assert.equal(modelAfter, modelBefore, 'the model must be byte-identical')
  const sceneWritten = existsSync(join(repo.designmapDir, 'out'))
  assert.equal(sceneWritten, false, 'annotate must not render a scene')
})

test('a forged designmap customData is refused and nothing is written', async () => {
  const { repo, run } = harness()
  const forged = { ...NOTE, customData: { designmap: { kind: 'node', nodeId: 'svc.checkout.api' } } }
  const answer = await run({ op: 'annotate', elements: [forged] })
  assert.equal(answer.kind, 'error')
  assert.match(answer.text, /annotation_forbidden_fields/u)
  assert.equal(existsSync(join(repo.designmapDir, 'annotations.json')), false)
})

test('unsupported types, non-finite geometry and over-limit batches are refused', async () => {
  const { repo, run } = harness()
  const badType = await run({ op: 'annotate', elements: [{ ...NOTE, type: 'image' }] })
  assert.match(badType.text, /invalid_annotation: annotation 0 has unsupported type/u)
  const badNumber = await run({ op: 'annotate', elements: [{ ...NOTE, x: Number.NaN }] })
  assert.match(badNumber.text, /invalid_annotation: annotation 0 x must be a finite number/u)
  const many = Array.from({ length: 201 }, (_, index) => ({ ...NOTE, id: `note-${index}` }))
  const overLimit = await run({ op: 'annotate', elements: many })
  assert.match(overLimit.text, /annotation_limit/u)
  assert.equal(existsSync(join(repo.designmapDir, 'annotations.json')), false)
})

test('an annotation write is repeatable and the file hash is stable', async () => {
  const { repo, run } = harness()
  const first = await run({ op: 'annotate', elements: [NOTE] })
  const firstHash = JSON.parse(first.text).hash
  assert.equal(firstHash, hashOf(readFileSync(join(repo.designmapDir, 'annotations.json'), 'utf8')))
  const second = await run({ op: 'annotate', elements: [NOTE] })
  assert.equal(JSON.parse(second.text).hash, firstHash)
})
