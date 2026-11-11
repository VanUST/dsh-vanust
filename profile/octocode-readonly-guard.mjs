/**
 * PURPOSE
 *   Mount Octocode behind a policy point that can say NO, because Octocode's
 *   `structural_search` tool can rewrite files in place: `update_all: true` with a
 *   `rewrite` template edits every match. MCP tools do not pass through the harness's
 *   `tool-fs` write restrictions, so an agent that was told "read-only" is still one
 *   tool call away from changing source. A prompt is not an enforcement point.
 *
 *   This is a stdio JSON-RPC proxy. It spawns the provisioned `octocode mcp --path .`
 *   in its own working directory and pipes requests both ways, changing exactly two
 *   things:
 *     1. `tools/list`: the `rewrite` and `update_all` properties are removed from
 *        `structural_search`'s input schema, so the writing call is not advertised to
 *        the model at all.
 *     2. `tools/call`: a `structural_search` call that still carries `rewrite` or
 *        `update_all` is answered with a JSON-RPC error and is NEVER forwarded.
 *   Every other message is forwarded byte-for-byte; responses other than tools/list
 *   are passed through untouched.
 *
 * WHY A PROXY AND NOT A CONFIG FLAG. Octocode 0.29.2 has no read-only switch: the
 * rewrite capability is a parameter of a core tool, not a server mode (checked against
 * `octocode mcp --help` and doc/MCP_INTEGRATION.md). The alternatives were to drop
 * `structural_search` entirely (losing AST search) or to trust a prompt. The proxy keeps
 * the read half and removes the write half at the only place that must agree: the wire.
 *
 * INPUTS
 *   stdin/stdout  - MCP stdio transport (newline-delimited JSON-RPC 2.0).
 *   OCTOCODE_BIN  - optional path to the octocode binary. Default: `octocode` on PATH,
 *                   then `~/.local/bin/octocode`, where scripts/provision-tools.mjs puts it.
 *   cwd           - the project the bridge starts the server in; passed through to
 *                   octocode as `--path .`.
 *
 * OUTPUTS
 *   One JSON-RPC message per line. The child's stderr is forwarded to this process's
 *   stderr unchanged (the MCP channel is stdout only).
 *
 * KEYWORDS
 *   mcp, stdio proxy, octocode, read-only, structural_search, deny by construction
 *
 * BEHAVIOUR ON EDGE CASES
 *   - octocode not found: exit 1 with a message naming the provision command; the bridge
 *     reports the server as failed to start (failOnStartupError is false).
 *   - a message that is not JSON, or not a request: passed through untouched. This proxy
 *     is not a validator and must not become one.
 *   - a tools/call for another tool, or structural_search without the write parameters:
 *     forwarded unchanged, so the read-only surface behaves exactly like the raw server.
 *   - the child exits: this process exits with its code; pending responses die with it,
 *     which is the same failure the bridge would see without the guard.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const WRITE_TOOL = 'structural_search'
const WRITE_PARAMS = new Set(['rewrite', 'update_all'])

/** Locate the provisioned octocode binary without a shell. */
function resolveOctocode() {
  const override = process.env.OCTOCODE_BIN
  if (typeof override === 'string' && override.trim() !== '' && override.includes('/') && existsSync(override)) return override
  if (typeof override === 'string' && override.trim() !== '' && !override.includes('/')) return override
  const local = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'octocode.exe' : 'octocode')
  return existsSync(local) ? local : 'octocode'
}

const octocode = resolveOctocode()
const child = spawn(octocode, ['mcp', '--path', '.'], { stdio: ['pipe', 'pipe', 'inherit'], cwd: process.cwd(), env: process.env })
child.on('error', (error) => {
  process.stderr.write(`octocode-readonly-guard: cannot start ${octocode}: ${error.message}\n`)
  process.exit(1)
})

/** Strip the write parameters from the advertised structural_search schema. */
function hideWriteParams(message) {
  const tools = message?.result?.tools
  if (!Array.isArray(tools)) return message
  for (const tool of tools) {
    if (tool?.name !== WRITE_TOOL || tool.inputSchema === null || typeof tool.inputSchema !== 'object') continue
    const properties = tool.inputSchema.properties
    if (properties !== null && typeof properties === 'object') {
      for (const name of WRITE_PARAMS) delete properties[name]
    }
    if (typeof tool.description === 'string') {
      tool.description += '\n\nThis deployment mounts Octocode read-only: rewrite/update_all are not available.'
    }
  }
  return message
}

/** Decide whether a tools/call must be refused before Octocode sees it. */
function refusedCall(message) {
  if (message?.method !== 'tools/call') return null
  const params = message.params
  if (params?.name !== WRITE_TOOL) return null
  const keys = Object.keys(params?.arguments ?? {})
  const offending = keys.filter((key) => WRITE_PARAMS.has(key))
  if (offending.length === 0) return null
  return offending
}

createInterface({ input: process.stdin, terminal: false }).on('line', (line) => {
  if (line.trim() === '') return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    child.stdin.write(`${line}\n`)
    return
  }
  const offending = refusedCall(message)
  if (offending !== null) {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: message.id ?? null,
      error: {
        code: -32601,
        message: `octocode-readonly-guard: ${WRITE_TOOL} is mounted read-only; ${offending.join(', ')} is refused`,
      },
    })}\n`)
    process.stderr.write(`octocode-readonly-guard: refused ${WRITE_TOOL} with ${offending.join(', ')}\n`)
    return
  }
  child.stdin.write(`${line}\n`)
})

// Responses go back through the same filter: only tools/list is rewritten, everything else
// is forwarded as received. Re-serialising here is safe because MCP messages are JSON objects
// and the bridge parses them again; it is not a byte-preserving pipe by design.
createInterface({ input: child.stdout, terminal: false }).on('line', (line) => {
  if (line.trim() === '') return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    process.stdout.write(`${line}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify(hideWriteParams(message))}\n`)
})

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal === null ? 1 : 0))
})
