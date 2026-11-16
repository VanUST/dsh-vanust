#!/usr/bin/env node
/**
 * Print the M3 tool contract as the installed harness sees it: names, wire budget,
 * parameter-schema closure and the exact INVALID_ARGS violations for an op that carries
 * coordinates/colours, validated with the real `@deepseek-ai/dsh-tools` validator.
 *
 * This is evidence, not a test: it uses the same validateArgs the host calls before
 * execute, so a schema that would accept x/y/fill fails here.
 *
 * Usage: node bin/tool-contract.mjs
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHostTools, TOOL_SPECS } from '../src/tools.mjs'

const tools = createHostTools({ defineTool: options => options, hostFor: () => ({}) })
const report = { ok: true, failures: [] }

async function loadDshTools() {
  try {
    return await import('@deepseek-ai/dsh-tools')
  } catch {
    const installed = process.env.DSH_INSTALL ?? '/home/iustimov/.npm/node/lib/node_modules/@deepseek-ai/dsh'
    const candidate = process.env.DSH_TOOLS
      ?? join(installed, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')
    if (!existsSync(candidate)) return null
    return import(pathToFileURL(candidate).href)
  }
}

const dsh = await loadDshTools()
report.dshTools = dsh === null ? null : 'loaded'
report.tools = tools.map(tool => ({
  name: tool.name,
  nameValid: /^[A-Za-z0-9_-]{1,64}$/u.test(tool.name),
  parametersClosed: tool.name !== 'designmap_apply'
    ? null
    : tool.parameters.ops.items.additionalProperties === false
      && tool.parameters.ops.items.properties.value.additionalProperties === false,
  geometryProperties: tool.name === 'designmap_apply'
    ? Object.keys(tool.parameters.ops.items.properties.value.properties).filter(key => ['x', 'y', 'fill', 'stroke'].includes(key))
    : [],
}))
if (report.tools.some(tool => !tool.nameValid)) report.failures.push('tool name outside [A-Za-z0-9_-]{1,64}')
if (report.tools.some(tool => tool.geometryProperties.length > 0)) report.failures.push('a geometry property is declared')
if (report.tools.find(tool => tool.name === 'designmap_apply').parametersClosed !== true) report.failures.push('apply op schema is not closed')

if (dsh === null) {
  report.failures.push('@deepseek-ai/dsh-tools is not resolvable on this machine')
  report.ok = false
} else {
  const apply = tools.find(tool => tool.name === 'designmap_apply')
  report.dirtyOpViolations = dsh.validateArgs(apply.parameters, {
    ops: [{ kind: 'node', action: 'upsert', value: { id: 'svc.a', type: 'service', label: 'A', x: 1, y: 2, fill: '#fff' } }],
  })
  report.cleanOpViolations = dsh.validateArgs(apply.parameters, {
    ops: [{ kind: 'node', action: 'upsert', value: { id: 'svc.a', type: 'service', label: 'A' } }],
  })
  report.removeOpViolations = dsh.validateArgs(apply.parameters, { ops: [{ kind: 'edge', action: 'remove', id: 'e.a.b' }] })
  report.openMissingIdViolations = dsh.validateArgs(tools.find(tool => tool.name === 'designmap_open').parameters, {})
  const named = report.dirtyOpViolations.join('\n')
  for (const field of ['ops[0].value.x', 'ops[0].value.y', 'ops[0].value.fill']) {
    if (!named.includes(field)) report.failures.push(`validator did not name ${field}`)
  }
  if (report.cleanOpViolations.length !== 0) report.failures.push('a clean op was refused')
  if (report.removeOpViolations.length !== 0) report.failures.push('a remove op was refused')
  if (!report.openMissingIdViolations.some(message => message.includes('nodeId'))) report.failures.push('open did not require nodeId')
}

report.ok = report.failures.length === 0
report.specNames = TOOL_SPECS.map(spec => spec.name)
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exit(1)
