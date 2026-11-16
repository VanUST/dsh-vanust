/**
 * The `/designmap <json-op>` human command.
 *
 * The panel cannot write the workspace (its file API is read-only), so every operation
 * it needs — status, render, export, open, and M2's overlay writes later — goes through
 * this command. The command is NOT preset-gated: it is the human path, while the tools
 * are the agent path.
 *
 * Result shape matches the command registry: `{kind:'success', text}` is a JSON
 * document; `{kind:'error', text}` carries a stable `designmap: <code>: <detail>`
 * prefix the panel can quote.
 */
import { DesignmapRefusal } from './schema.mjs'

const OPS = ['status', 'scan', 'apply', 'render', 'lint', 'open', 'export', 'overlay']

/**
 * The overlay op's domain payload.
 *
 * The parsed command object carries the transport key `op` (and may carry anything a
 * panel felt like sending). `service.overlay` validates its input against a strict
 * allow-list and refuses model fields with `model_fields_forbidden`, so the transport
 * key must not travel into the domain call: `op` dispatches and is logged, nothing more.
 */
const OVERLAY_FIELDS = ['action', 'nodeId', 'viewId', 'row', 'x', 'y', 'fill', 'stroke']
function overlayPayload(op) {
  const payload = {}
  for (const field of OVERLAY_FIELDS) {
    if (op[field] !== undefined) payload[field] = op[field]
  }
  return payload
}

export function createCommandHandler({ hostFor }) {
  return async function handler(invocation) {
    const { service, logger } = hostFor({ agent: invocation.agent })
    let op
    try {
      op = JSON.parse(invocation.rawInput)
    } catch {
      return { kind: 'error', text: 'designmap: expected a JSON operation' }
    }
    if (op === null || typeof op !== 'object' || !OPS.includes(op.op)) {
      return { kind: 'error', text: `designmap: unknown op (${OPS.join(' | ')})` }
    }
    logger?.log('tool.enter', { tool: 'command', op: op.op })
    const started = performance.now()
    try {
      let value
      switch (op.op) {
        case 'status': value = service.status(); break
        case 'scan': value = service.scan({ roots: op.roots, extensions: op.extensions }); break
        case 'apply': value = service.apply(op.ops); break
        case 'render': value = await service.render({ viewId: op.viewId }); break
        case 'lint': value = await service.lint({ viewId: op.viewId }); break
        case 'open': value = service.open({ nodeId: op.nodeId }); break
        case 'export': value = await service.exportView({ viewId: op.viewId, format: op.format }); break
        case 'overlay': value = service.overlay(overlayPayload(op)); break
        default: return { kind: 'error', text: `designmap: unknown op (${OPS.join(' | ')})` }
      }
      return { kind: 'success', text: JSON.stringify(value) }
    } catch (error) {
      if (error instanceof DesignmapRefusal) {
        return { kind: 'error', text: `designmap: ${error.code}: ${error.message}` }
      }
      return { kind: 'error', text: `designmap: internal_error: ${String(error?.message ?? error)}` }
    } finally {
      logger?.log('tool.exit', { tool: 'command', op: op.op, ms: Math.round((performance.now() - started) * 100) / 100 })
    }
  }
}
