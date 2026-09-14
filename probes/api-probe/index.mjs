/**
 * PURPOSE
 *   Answer, by execution rather than by reading declarations, what a DSH plugin
 *   can rely on: how a tool is declared with `defineTool` and registered, what
 *   the execution context actually carries, how the registry treats a value that
 *   violates its declared output schema, and whether an installed plugin can
 *   reach the subagent runtime and the LLM service from inside a running profile.
 *
 *   Every Ratchet v2 design decision that touches the harness is downstream of
 *   these answers. Writing implementation code first and discovering, say, that
 *   `exec.agent` is absent would invalidate the verifier's workspace resolution
 *   and the whole dynamic-review path at once.
 *
 * INPUTS
 *   No configuration. The plugin registers probe tools under globally unique
 *   names (`zzprobe_*`) so a probe run cannot collide with a real deployment
 *   tool, and it never writes outside the scratch home the probe script sets up.
 *
 * OUTPUTS
 *   Registers five tools. Each returns a JSON object describing observed fact,
 *   so the probe script's assertion run and the model's own turn read the same
 *   evidence:
 *     zzprobe_env         — exec context shape, session root, agent identity,
 *                           mounted services, module-resolution base.
 *     zzprobe_schemas     — the registry's model-facing projection: which fields
 *                           of a definition reach the model.
 *     zzprobe_output_ok   — a value that satisfies its declared output schema.
 *     zzprobe_output_bad  — a value that violates it, to see the failure mode.
 *     zzprobe_services    — reachability of subagent / llm / fs / userApproval.
 *   Registration failures are reported on stderr and never thrown: a probe that
 *   cannot register one tool must still boot, or the failure looks like a boot bug.
 *
 * KEYWORDS
 *   api discovery, probe, defineTool, ToolRunContext, exec.signal, output schema,
 *   subagent runtime, llm service, cordis effect, disposal
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Missing `exec.agent`: reported as `present: false` rather than throwing,
 *     because an agent-less dispatch is a real case (nested/transport calls).
 *   - A service that is not mounted: reported as `present: false`, so "absent"
 *     and "unreachable" stay distinguishable.
 *   - Output-schema violation: `zzprobe_output_bad` deliberately returns the wrong
 *     shape; the harness's reaction is the measurement, not a bug to fix here.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

/**
 * Tool-name prefix. Every registered name carries it so a probe tool can never
 * shadow a deployment tool, and so a leak into a real profile is obvious.
 */
const PREFIX = 'zzprobe_'

/** Cordis function-plugin name; also the id a patch row targets. */
export const name = 'api-probe'

/**
 * Services requested before `apply` runs.
 *
 * `tools` only. Cordis makes an injection a hard gate in both directions:
 * without it, reading `ctx.subagent` throws `cannot get property "subagent"
 * without inject` and `ctx.get('subagent')` answers `undefined`; with it and no
 * provider, the entry never activates and the loader fails the whole tree with
 * `pending (waiting for service: subagent)`. Both were observed on this
 * machine, and both are reported below as facts rather than avoided by
 * declaring a dependency the composition may not satisfy.
 */
export const inject = ['tools']

/**
 * Default output declaration shared by the diagnostic probes.
 *
 * `{ type: 'json' }` is the DSL's unconstrained lossless-JSON node and compiles
 * to an annotation-only schema, which is exactly what a diagnostic payload is.
 * A definition registered directly against `ctx.tools.register()` cannot use it:
 * the registry then validates RAW JSON Schema and answers `schema.type must be
 * one of object/array/string/number/integer/boolean/null` (observed). Using the
 * DSL is therefore not a style preference but the only supported route.
 */
const diagnosticOutput = () => ({
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})

/**
 * Describes one property of the execution context without assuming its shape.
 *
 * The `preview` key is OMITTED rather than set to `undefined` for non-string
 * values. A definition's `output.schema` is validated against the returned
 * value as LOSSLESS JSON, and `undefined` is not a JSON value: a payload
 * carrying one is rejected with `value is not lossless JSON` (observed, by
 * running this probe with a `preview: undefined` field).
 *
 * @param label - Field name to report.
 * @param value - Candidate value, of any type.
 * @returns A JSON-safe descriptor: the type name, whether it is present, and a
 *   short preview when the value is a string. Never throws.
 */
function describe(label, value) {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  const descriptor = { label, type, present: value !== undefined && value !== null }
  if (typeof value === 'string') descriptor.preview = value.slice(0, 300)
  return descriptor
}

/**
 * Lists the service names a Cordis context can resolve, and by which route.
 *
 * Two access routes exist and they are not equivalent. `ctx.get(name)` is the
 * documented resolver, while `ctx[name]` is the property Cordis installs for a
 * registered service. Measuring both is what distinguishes "the service is not
 * mounted" from "this is not how a plugin is supposed to reach it" — a
 * distinction that decides whether a design is broken or merely wrong.
 *
 * @param ctx - The plugin context (or any child context).
 * @returns One entry per candidate: name, both access routes, and the
 *   constructor name when either resolved.
 */
function serviceTable(ctx) {
  const candidates = [
    'tools',
    'agents',
    // The runtime registers itself as `subagents` (plural): its constructor
    // calls `super(ctx, "subagents")`. Probing the singular was the whole of a
    // false "the subagent runtime is unreachable" finding, so BOTH spellings are
    // listed and reported side by side.
    'subagents',
    'subagent',
    'llm',
    'fs',
    'userApproval',
    'session',
    'storage',
    'settings',
    'systemPrompt',
    'codeRuntime',
    'loader',
    'hmr',
    'timer',
  ]
  return candidates.map((candidate) => {
    let viaGet
    let viaGetError = null
    try {
      viaGet = ctx.get(candidate)
    } catch (error) {
      viaGetError = String(error)
    }
    let viaProperty
    try {
      viaProperty = ctx[candidate]
    } catch (error) {
      viaProperty = `threw: ${String(error)}`
    }
    // A property read that lands on `Object.prototype` is NOT a service. The
    // candidate `name` is the trap: an un-injected name reads `ctx.name` and
    // yields the string "name", which a truthiness test reports as a mounted
    // service. Comparing against the prototype's own value removes the whole
    // class of false positives instead of special-casing the one name.
    const prototypeValue = Object.prototype[candidate]
    const propertyIsInheritedFallback =
      viaProperty !== undefined && prototypeValue !== undefined && viaProperty === prototypeValue
    const resolved = viaGet ?? (typeof viaProperty === 'string' || propertyIsInheritedFallback ? undefined : viaProperty)
    return {
      name: candidate,
      viaGet: viaGet !== undefined,
      viaGetError,
      viaProperty: viaProperty !== undefined && !propertyIsInheritedFallback,
      viaPropertyType: typeof viaProperty,
      viaPropertyFallback: propertyIsInheritedFallback,
      present: resolved !== undefined,
      kind: resolved === undefined ? null : (resolved?.constructor?.name ?? typeof resolved),
    }
  })
}

/**
 * Lists the enumerable property names of the plugin context.
 *
 * The list is the evidence for how a service is meant to be reached: if a
 * service name appears here but `ctx.get()` returns nothing, the property route
 * is the supported one for that service.
 *
 * @param ctx - The plugin context.
 * @returns Sorted property names, or a `threw:` marker.
 */
function contextProperties(ctx) {
  try {
    return Object.keys(ctx).sort()
  } catch (error) {
    return [`threw: ${String(error)}`]
  }
}

/**
 * Lists the public methods of a service instance by walking its prototype chain.
 *
 * @param target - A service instance, or `undefined` when it is not mounted.
 * @returns Sorted method names, or `null` for an absent service. Getters are
 *   excluded: reading them could have effects the probe must not cause.
 */
function surface(target) {
  if (target === undefined) return null
  const names = new Set()
  let prototype = Object.getPrototypeOf(target)
  while (prototype !== null && prototype !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key)
      if (key !== 'constructor' && typeof descriptor?.value === 'function') names.add(key)
    }
    prototype = Object.getPrototypeOf(prototype)
  }
  return [...names].sort()
}

/**
 * Registers the probe tools.
 *
 * @param ctx - Cordis context; must expose `tools` (declared in `inject`).
 * @returns Nothing. Registrations are made inside `ctx.effect`, which is the
 *   disposal contract: a hot reload replaces them instead of tripping the
 *   registry's duplicate-name rule.
 */
export function apply(ctx) {
  ctx.effect(() => {
    const disposers = []

    /** Registers one probe tool, reporting a registration failure instead of throwing. */
    const register = (definition) => {
      try {
        disposers.push(ctx.tools.register(definition))
      } catch (error) {
        process.stderr.write(`api-probe: cannot register ${definition.name}: ${String(error)}\n`)
      }
    }

    register(
      defineTool({
        name: `${PREFIX}env`,
        description:
          'Probe: report the shape of the tool execution context (exec), the session workspace, ' +
          'the calling agent identity, and the mounted services. Used to confirm harness API facts.',
        parameters: {},
        output: diagnosticOutput(),
        execute(_args, exec) {
          const header = exec?.agent?.session?.header
          return Promise.resolve({
            probe: 'env',
            toolName: exec?.name ?? null,
            hasCallId: typeof exec?.callId === 'string',
            hasToken: exec?.token !== undefined,
            argumentsType: typeof exec?.arguments,
            // Cancellation: the caller's AbortSignal, forwarded to async work.
            signal: describe('exec.signal', exec?.signal),
            signalAborted: exec?.signal?.aborted ?? null,
            // Deferral and turn-ending are functions on ToolRunContext.
            deferContext: describe('exec.deferContext', exec?.deferContext),
            concludeTurn: describe('exec.concludeTurn', exec?.concludeTurn),
            // The workspace root path the whole Ratchet design depends on.
            workspace: describe('exec.agent.session.header.cwd', header?.cwd),
            sessionId: describe('exec.agent.session.header.id', header?.id),
            sessionVersion: header?.version ?? null,
            agentId: describe('exec.agent.id', exec?.agent?.id),
            agentStatus: describe('exec.agent.status', exec?.agent?.status),
            agentOptions:
              exec?.agent?.options === undefined
                ? null
                : {
                    provider: exec.agent.options?.provider ?? null,
                    model: exec.agent.options?.model ?? null,
                  },
            agentCtxPresent: exec?.agent?.ctx !== undefined,
            fileUrl: import.meta.url,
            processCwd: process.cwd(),
            contextProperties: contextProperties(ctx),
            services: serviceTable(ctx),
          })
        },
      }),
    )

    register(
      defineTool({
        name: `${PREFIX}schemas`,
        description:
          'Probe: report the model-facing projection of every registered tool schema, to show which ' +
          'fields of a definition reach the model and which stay host-side.',
        parameters: {
          only: {
            type: 'string',
            description: 'Optional tool-name substring filter.',
          },
        },
        output: diagnosticOutput(),
        execute(args, exec) {
          const schemas = ctx.tools.schemas(exec?.agent)
          const filtered =
            typeof args.only === 'string' && args.only.length > 0
              ? schemas.filter((schema) => schema.name.includes(args.only))
              : schemas
          return Promise.resolve({
            probe: 'schemas',
            count: schemas.length,
            // The exact key set is the fact: a definition's execute,
            // isConcurrencySafe and presenters must not appear here.
            keySets: [...new Set(filtered.map((schema) => Object.keys(schema).sort().join(',')))],
            names: filtered.map((schema) => schema.name).sort(),
            sample: filtered.find((schema) => schema.name.startsWith(PREFIX)) ?? null,
          })
        },
      }),
    )

    register(
      defineTool({
        name: `${PREFIX}output_ok`,
        description: 'Probe: return a value that satisfies the declared output schema.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true },
              note: { type: 'string' },
            },
          },
          render: (_args, value) => [
            { type: 'text', text: `ok=${value.ok} note=${value.note ?? ''}` },
          ],
        },
        execute() {
          return Promise.resolve({ ok: true, note: 'conforming value' })
        },
      }),
    )

    register(
      defineTool({
        name: `${PREFIX}output_bad`,
        description:
          'Probe: return a value that VIOLATES the declared output schema, to observe whether the ' +
          'registry rejects a tool body that contradicts its own contract.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { ok: { type: 'boolean', required: true } },
          },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        execute() {
          // Deliberately wrong: `ok` is declared boolean, and an undeclared key
          // violates the closed object root.
          return Promise.resolve({ ok: 'not-a-boolean', extra: 'undeclared key' })
        },
      }),
    )

    register(
      defineTool({
        name: `${PREFIX}services`,
        description:
          'Probe: report whether the subagent runtime and LLM service are reachable from a tool body, ' +
          'and what their public surface looks like. This decides the Ratchet dynamic-review path.',
        parameters: {},
        output: diagnosticOutput(),
        execute(_args, exec) {
          const subagent = ctx.get('subagent')
          return Promise.resolve({
            probe: 'services',
            agentForSubagentStart: exec?.agent !== undefined,
            parentAgentId: exec?.agent?.id ?? null,
            toolServiceMethods: surface(ctx.tools),
            contextProperties: contextProperties(ctx),
            routes: serviceTable(ctx),
            subagentMethods: surface(subagent),
          })
        },
      }),
    )

    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}
