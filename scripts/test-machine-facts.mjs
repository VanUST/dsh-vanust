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
 *   `node --test` output; exit 0 only when the case holds. The cases for a present
 *   device, a driver without a toolkit and an unchanged document were removed as
 *   per-branch coverage under the small-behavioural-suite ruling; this one carries
 *   the decision all of them served.
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

test('a machine with no GPU says so, with the probe failure, and is not confused with a hidden one', () => {
  const text = renderMachineFacts(machine({}))
  assert.match(text, /GPU: none detected \(nvidia-smi unavailable: not found\)/)
  assert.match(text, /it does not mean the hardware is hidden/)
})

