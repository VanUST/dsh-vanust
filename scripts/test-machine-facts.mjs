/**
 * PURPOSE
 *   Drive `renderMachineFacts` over machines it is told about, so the document is measured
 *   rather than the host it happens to run on. The case that matters is the one that made the
 *   file exist: an agent must be able to tell a machine WITHOUT a GPU from one whose probe
 *   could not run, because only the second is worth investigating.
 *
 * INPUTS
 *   None. Every probe is injected, so the suite needs no GPU, no CUDA and no nvidia-smi.
 *
 * OUTPUTS
 *   `node --test` output; exit 0 only when every case holds.
 *
 * KEYWORDS
 *   machine facts, gpu, cuda, probe injection, hermetic test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMachineFacts } from './machine-facts.mjs'

/** A machine that answers every probe, or none, according to the map it is given. */
const machine = (answers, extra = {}) => ({
  env: {},
  exists: () => true,
  cpus: () => new Array(8).fill({}),
  run: (command, args) => {
    const key = `${command} ${args.join(' ')}`
    if (answers[key] !== undefined) return answers[key]
    throw new Error('not found')
  },
  ...extra,
})

test('a machine with an NVIDIA device states it, and the device line verbatim', () => {
  const text = renderMachineFacts(
    machine({ 'nvidia-smi -L': 'GPU 0: NVIDIA GeForce RTX 3090 (UUID: GPU-abc)\nGPU 1: NVIDIA GeForce RTX 3090 (UUID: GPU-def)' }),
  )
  assert.match(text, /GPU: 2 NVIDIA device\(s\), via nvidia-smi/)
  assert.match(text, /GPU 0: NVIDIA GeForce RTX 3090 \(UUID: GPU-abc\)/)
  assert.match(text, /GPU 1: NVIDIA GeForce RTX 3090 \(UUID: GPU-def\)/)
})

test('a machine with no GPU says so, with the probe failure, and is not confused with a hidden one', () => {
  const text = renderMachineFacts(machine({}))
  assert.match(text, /GPU: none detected \(nvidia-smi unavailable: not found\)/)
  assert.match(text, /it does not mean the hardware is hidden/)
})

test('a driver without a toolkit reports each separately, and a stale CUDA_HOME is called out', () => {
  const text = renderMachineFacts(
    machine({ 'nvidia-smi -L': 'GPU 0: NVIDIA GeForce RTX 4090 (UUID: GPU-xyz)' }, { env: { CUDA_HOME: '/usr/local/cuda-99' }, exists: () => false }),
  )
  assert.match(text, /CUDA_HOME: \/usr\/local\/cuda-99 \(path does not exist\)/)
  assert.match(text, /nvcc: not on PATH/)
})

test('the CPU count is reported as unknown rather than zero when the probe fails', () => {
  const text = renderMachineFacts(machine({ 'nvidia-smi -L': 'GPU 0: x' }, { cpus: () => { throw new Error('no cpu list') } }))
  assert.match(text, /CPUs: unknown/)
  assert.doesNotMatch(text, /CPUs: 0/)
})

test('the document carries no timestamp, so an unchanged machine renders identical bytes', () => {
  const once = renderMachineFacts(machine({ 'nvidia-smi -L': 'GPU 0: x' }))
  const twice = renderMachineFacts(machine({ 'nvidia-smi -L': 'GPU 0: x' }))
  assert.equal(once, twice)
})
