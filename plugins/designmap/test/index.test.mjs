/*
PROOF: the designmap plugin registers exactly the four page tools and no v1 tool
Behavior: applying the plugin to a host context registers map_list, map_read, map_edit and
  map_render for an orchestrator agent (and nothing else), and registers the /designmap
  page command; a non-orchestrator preset receives no designmap tool.
Fails when: a designmap_* tool is registered again, a page tool disappears, the command
  stops being the human path, or the preset gate leaks the tools to another seat.
Production path: plugins/designmap/index.js apply() -> src/page-tools.mjs, src/command.mjs.
*/
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

function harness(presetFor = () => 'orchestrator') {
  const handlers = new Map()
  const commands = []
  const ctx = {
    on: (event, handler) => { handlers.set(event, handler) },
    get: (key) => (key === 'toolFamilies' ? { presetFor } : undefined),
    commands: { register: (command) => commands.push(command) },
  }
  return { ctx, handlers, commands }
}

function agent(cwd, names, preset = 'orchestrator') {
  return {
    session: { id: 'session-1', header: { cwd, agentPreset: preset } },
    ctx: { tools: { register: (tool) => { names.push(tool.name); return () => {} } } },
  }
}

test('the orchestrator receives exactly the four page tools', () => {
  const { ctx, handlers, commands } = harness()
  apply(ctx, {})
  const names = []
  handlers.get('agent/created')({ agent: agent(process.cwd(), names) })
  assert.deepEqual(names.sort(), ['map_edit', 'map_list', 'map_read', 'map_render'])
  assert.equal(names.some((name) => name.startsWith('designmap_')), false, 'a v1 tool name must not be registered')
  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, 'designmap')
})

test('another preset receives no designmap tool', () => {
  const { ctx, handlers } = harness(() => 'backend')
  apply(ctx, {})
  const names = []
  handlers.get('agent/created')({ agent: agent(process.cwd(), names, 'backend') })
  assert.deepEqual(names, [])
})
