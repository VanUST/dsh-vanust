/**
 * PROOF:
 * Behavior: every tool call appends JSONL to designmap/logs/events.jsonl with
 *   tool.enter/tool.exit, and the core events the acceptance reads (model.diff,
 *   layout.done, merge.applied, lint.result, render.done) are in the same stream; a
 *   payload with undefined/NaN/circular fields serializes to null instead of failing
 *   (owner spec §8, FR-9).
 * Fails when: a tool stops logging enter/exit, an event name drifts, a log line is not
 *   valid JSON, or an unserializable field throws and kills the tool.
 * Production path: src/host.mjs createFileLogger -> src/log.mjs; tool wrappers in
 *   src/tools.mjs and src/command.mjs.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHostService, createFileLogger } from '../src/host.mjs'
import { createHostTools } from '../src/tools.mjs'
import { createCommandHandler } from '../src/command.mjs'
import { makeRepo, stubDefineTool } from './host-helpers.mjs'

function hostFor(repo, loggers) {
  return () => {
    const { logger, path } = createFileLogger(repo.designmapDir)
    loggers.push({ logger, path })
    return { service: createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root, logger }), logger, logPath: path }
  }
}

const eventsOf = path => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))

test('apply, render and export leave the required events in logs/events.jsonl', async () => {
  const repo = makeRepo()
  try {
    // baseline manifest through the service (no tool wrapper needed)
    createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root }).apply([])
    const loggers = []
    const tools = createHostTools({ defineTool: stubDefineTool, hostFor: hostFor(repo, loggers) })
    const exec = { agent: { session: { header: { cwd: repo.root } } } }
    await tools.find(tool => tool.name === 'designmap_apply').execute({ ops: [] }, exec)
    await tools.find(tool => tool.name === 'designmap_render').execute({}, exec)
    await tools.find(tool => tool.name === 'designmap_export').execute({ viewId: 'v.context' }, exec)
    await tools.find(tool => tool.name === 'designmap_lint').execute({}, exec)
    await tools.find(tool => tool.name === 'designmap_status').execute({}, exec)
    await tools.find(tool => tool.name === 'designmap_scan').execute({}, exec)

    const path = join(repo.designmapDir, 'logs', 'events.jsonl')
    assert.equal(existsSync(path), true)
    const events = eventsOf(path)
    const names = new Set(events.map(event => event.event))
    for (const required of ['tool.enter', 'tool.exit', 'model.diff', 'layout.done', 'merge.applied', 'lint.result', 'render.done']) {
      assert.ok(names.has(required), `missing ${required}; got ${[...names].join(',')}`)
    }
    const toolsLogged = new Set(events.filter(event => event.event === 'tool.enter').map(event => event.tool))
    for (const name of ['designmap_apply', 'designmap_render', 'designmap_export', 'designmap_lint', 'designmap_status', 'designmap_scan']) {
      assert.ok(toolsLogged.has(name), `missing tool.enter for ${name}`)
    }
    assert.equal(events.every(event => event.event !== 'tool.exit' || typeof event.ok === 'boolean'), true)
    // Every line was already parsed above; also assert the render hash is in the stream.
    const rendered = events.find(event => event.event === 'render.done')
    assert.match(rendered.sceneHash, /^sha256:[0-9a-f]{64}$/u)
  } finally {
    repo.cleanup()
  }
})

test('null/undefined/NaN/circular fields serialize to JSON-safe values', () => {
  const repo = makeRepo()
  try {
    const { logger, path } = createFileLogger(repo.designmapDir)
    const circular = { name: 'loop' }
    circular.self = circular
    logger.log('tool.enter', { undefinedField: undefined, nan: Number.NaN, infinite: Infinity, nullField: null, circular })
    const events = eventsOf(path)
    const last = events.at(-1)
    assert.equal(last.undefinedField, null)
    assert.equal(last.nan, null)
    assert.equal(last.infinite, null)
    assert.equal(last.nullField, null)
    assert.equal(last.circular.self, '[circular]')
    assert.doesNotThrow(() => JSON.parse(readFileSync(path, 'utf8').trim().split('\n').at(-1)))
  } finally {
    repo.cleanup()
  }
})

test('the command handler logs tool.enter/exit for the panel path', async () => {
  const repo = makeRepo()
  try {
    const loggers = []
    const handler = createCommandHandler({ hostFor: hostFor(repo, loggers) })
    const invocation = { agent: { session: { header: { cwd: repo.root } } }, rawInput: JSON.stringify({ op: 'status' }) }
    const result = await handler(invocation)
    assert.equal(result.kind, 'success')
    const path = join(repo.designmapDir, 'logs', 'events.jsonl')
    const events = eventsOf(path)
    assert.deepEqual(events.map(event => event.event), ['tool.enter', 'tool.exit'])
    assert.equal(events[0].tool, 'command')
    assert.equal(events[0].op, 'status')
  } finally {
    repo.cleanup()
  }
})
