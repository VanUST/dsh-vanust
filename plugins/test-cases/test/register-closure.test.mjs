/*
PROOF: the batch rule closed in the register, not only in the analysis record
Behavior: state/req/REQ-103.md carries status done (the analysis mirror of
  project-state-ecosystem FR15) and state/task/TASK-226.md carries status done with REQ-103 in
  its reqIds. REGISTER_ROOT selects the workspace root so the same test runs against a pre-closure
  snapshot.
Fails when: REQ-103 is not done, TASK-226 is not done, or TASK-226 lost its REQ-103 link.
  CASE_NEGATIVE_CONTROL=expect-pre-fix asserts the pre-closure shape, which must fail on the
  closed register (the measured red).
Production path: state/req/REQ-103.md and state/task/TASK-226.md — written by the analysis mirror
  and the taskboard, read here as the durable register.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.env.REGISTER_ROOT ?? process.cwd()
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''

function frontmatter(rel) {
  const path = join(ROOT, rel)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return { error: `${rel} could not be read: ${error.message}` }
  }
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (block === null) return { error: `${rel} has no frontmatter` }
  return { text: block[1] }
}

const scalar = (block, key) => {
  const match = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(block)
  return match === null ? '' : match[1].trim().replace(/^["']|["']$/g, '')
}

const list = (block, key) => {
  const raw = scalar(block, key)
  const inner = /^\[(.*)\]$/.exec(raw)
  if (inner === null) return raw === '' ? [] : [raw.replace(/^["']|["']$/g, '')]
  return inner[1].split(',').map((value) => value.trim().replace(/^["']|["']$/g, '')).filter((value) => value !== '')
}

function violations() {
  const found = []
  const req = frontmatter('state/req/REQ-103.md')
  const task = frontmatter('state/task/TASK-226.md')
  if (req.error !== undefined) {
    found.push(req.error)
  }
  if (task.error !== undefined) {
    found.push(task.error)
  }
  if (control === 'expect-pre-fix') {
    // The pre-closure shape: REQ-103 proposed, TASK-226 open with no reqIds.
    if (req.text !== undefined && scalar(req.text, 'status') === 'done') found.push('pre-fix control: REQ-103 is already done (expected proposed before the closure)')
    if (task.text !== undefined && scalar(task.text, 'status') === 'done' && list(task.text, 'reqIds').includes('REQ-103')) found.push('pre-fix control: TASK-226 is already done with REQ-103 (expected open and no reqIds before the closure)')
    return found
  }
  if (req.text !== undefined && scalar(req.text, 'status') !== 'done') {
    found.push(`state/req/REQ-103.md: status is "${scalar(req.text, 'status')}", expected "done"`)
  }
  if (task.text !== undefined) {
    const parts = []
    if (scalar(task.text, 'status') !== 'done') parts.push(`status is "${scalar(task.text, 'status')}", expected "done"`)
    const reqIds = list(task.text, 'reqIds')
    if (!reqIds.includes('REQ-103')) parts.push(`reqIds ${JSON.stringify(reqIds)} do not contain REQ-103`)
    if (parts.length > 0) found.push(`state/task/TASK-226.md: ${parts.join('; ')}`)
  }
  return found
}

test('the batch rule is closed in the register', () => {
  const found = violations()
  const summary = JSON.stringify({ metrics: { violations: found.length } })
  process.stdout.write(`CASE_SUMMARY ${summary}\n`)
  if (typeof process.env.CASE_SUMMARY === 'string' && process.env.CASE_SUMMARY !== '') writeFileSync(process.env.CASE_SUMMARY, summary)
  assert.deepEqual(found, [], found.join('; '))
})
