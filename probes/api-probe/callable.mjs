/**
 * PURPOSE
 *   Determine whether the subagent runtime can actually be *used* from inside a
 *   plugin, when ordinary reflection fails to describe it.
 *
 *   A first probe found `ctx.get('subagent')` non-undefined while its own keys
 *   and its whole prototype chain reported no methods at all, whereas
 *   `ctx.get('llm')` enumerated normally. That leaves two very different worlds:
 *   either the service is a Cordis/typert Proxy that answers well-known members
 *   without listing them, in which case dynamic review works; or it is a stub
 *   whose methods genuinely do not exist here, in which case the dynamic-review
 *   design needs a different road. Reflection cannot tell them apart, so this
 *   probe calls instead of inspects.
 *
 * INPUTS
 *   No configuration. Registered by the throwaway `api-probe` plugin as
 *   `zzprobe_callable`, mounted over a scratch DSH_HOME.
 *
 * OUTPUTS
 *   One JSON object listing, per candidate member name, whether `name in service`
 *   is true, whether the type of `service[name]` is a function, and — for names
 *   that are functions — whether a guarded no-argument call rejects with a
 *   *validation* error (meaning the member exists and runs) or throws a
 *   TypeError (meaning it does not). No candidate is ever called with real
 *   arguments, so nothing is spawned and no cost is incurred.
 *
 * KEYWORDS
 *   subagent runtime, typert, cordis service proxy, capability probe, callable
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A member whose read throws: recorded as `readError` for that member only.
 *   - A member that is not a function: recorded as `kind: 'data'`, never called.
 *   - A call that returns a promise which rejects: the rejection message is
 *     recorded, because "rejects with a schema error" is the success signal here.
 *   - A call that returns a promise which never settles: bounded by a short
 *     timer, so the probe cannot hang the one-shot run.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

/**
 * Member names a dynamic-review implementation would want on the runtime.
 *
 * Taken from the runtime's own `index.d.ts`, not invented: a name the class does
 * not declare would report `undefined` and tell us nothing about the API.
 */
const CANDIDATES = [
  'start',
  'list',
  'prompt',
  'interrupt',
  'interruptByParent',
  'listChildren',
  'listDescendants',
  'startContinuable',
  'sendMessage',
  'drainContinuableChildren',
  'drainContinuableDescendants',
]

/** Milliseconds to wait for a guarded probe call before calling it unsettled. */
const CALL_TIMEOUT_MS = 1500

/**
 * Probes one service member without invoking real work.
 *
 * @param service - The service object (possibly a Proxy).
 * @param member - Member name to probe.
 * @returns A JSON-safe descriptor of what the member is and how it behaves.
 */
async function probeMember(service, member) {
  const report = { member }
  try {
    report.inOperator = member in service
  } catch (error) {
    report.inOperator = `threw: ${String(error)}`
  }
  let value
  try {
    value = service[member]
  } catch (error) {
    report.kind = 'readError'
    report.readError = String(error)
    return report
  }
  report.kind = typeof value === 'function' ? 'function' : value === undefined ? 'undefined' : 'data'
  report.arity = typeof value === 'function' ? value.length : null
  if (typeof value !== 'function') return report

  // Call with no arguments and a bounded wait. A validation rejection proves the
  // member exists and executes; a TypeError proves it does not.
  try {
    const outcome = await Promise.race([
      Promise.resolve(value.call(service)).then(
        (result) => ({ settled: 'fulfilled', preview: JSON.stringify(result)?.slice(0, 200) ?? 'undefined' }),
        (error) => ({ settled: 'rejected', preview: String(error).slice(0, 300) }),
      ),
      new Promise((resolveCall) => setTimeout(() => resolveCall({ settled: 'timeout' }), CALL_TIMEOUT_MS)),
    ])
    report.call = outcome
  } catch (error) {
    report.call = { settled: 'threw', preview: String(error).slice(0, 300) }
  }
  return report
}

/**
 * Builds the callable-surface report for one service by name.
 *
 * Resolution tries `ctx.get(name)` and then the `ctx[name]` property, because
 * the two routes are not equivalent for every service: the subagent runtime was
 * observed in the composed tree while `ctx.get('subagent')` returned nothing,
 * and the reason was an undeclared injection rather than an absent service. The
 * route that produced the value is reported so a caller can rely on it.
 *
 * @param ctx - Cordis context.
 * @param serviceName - Service name to resolve.
 * @returns A promise for the JSON-safe report.
 */
export async function probeCallable(ctx, serviceName) {
  let service
  let resolvedVia = null
  try {
    service = ctx.get(serviceName)
    if (service !== undefined) resolvedVia = 'ctx.get'
  } catch (error) {
    return { service: serviceName, present: false, resolvedVia: null, error: String(error) }
  }
  if (service === undefined) {
    try {
      const property = ctx[serviceName]
      if (property !== undefined) {
        service = property
        resolvedVia = 'ctx[name]'
      }
    } catch (error) {
      return { service: serviceName, present: false, resolvedVia: null, error: String(error) }
    }
  }
  if (service === undefined) return { service: serviceName, present: false, resolvedVia: null }

  const members = []
  for (const member of CANDIDATES) members.push(await probeMember(service, member))

  let constructorName = null
  let chain = []
  try {
    constructorName = service.constructor?.name ?? null
    let cursor = Object.getPrototypeOf(service)
    while (cursor !== null && chain.length < 6) {
      chain.push(cursor.constructor?.name ?? 'anonymous')
      cursor = Object.getPrototypeOf(cursor)
    }
  } catch (error) {
    chain = [`threw: ${String(error)}`]
  }

  return {
    service: serviceName,
    present: true,
    resolvedVia,
    constructorName,
    prototypeChain: chain,
    toStringTag: (() => {
      try {
        return service[Symbol.toStringTag] ?? null
      } catch {
        return 'threw'
      }
    })(),
    ownKeyCount: (() => {
      try {
        return Object.getOwnPropertyNames(service).length
      } catch (error) {
        return `threw: ${String(error)}`
      }
    })(),
    members,
  }
}

/** Cordis function-plugin name; also the id a patch row targets. */
export const name = 'api-probe-callable'

/**
 * The tool registry always; `subagent` only when the row's config asks for it.
 *
 * Cordis makes an injection a HARD gate, in both directions:
 *   - Without it, reading `ctx.subagent` throws `cannot get property "subagent"
 *     without inject`, and `ctx.get('subagent')` answers `undefined` — observed
 *     with `inject: ['tools']` while the `subagent` row was demonstrably in the
 *     composed tree.
 *   - With it and no provider for the dependency, the entry never activates and
 *     the loader fails the whole tree with `pending (waiting for service:
 *     subagent)` — observed with `inject: ['tools', 'subagent']` under a
 *     composition where the runtime itself could not start.
 *
 * Injecting only on request lets one probe measure both the reachable surface
 * and the failure mode.
 */
/**
 * The tool registry only.
 *
 * `subagents` is deliberately NOT declared, so this row measures whether the
 * runtime is reachable through `ctx.get` WITHOUT an injection while the sibling
 * judge row injects it. Without that contrast, "it resolves" and "the injection
 * is what makes it resolve" are indistinguishable, and an earlier version of
 * this probe reported the runtime as unreachable purely because it asked for
 * `subagent` (singular) while the service registers as `subagents`.
 */
export const inject = ['tools']

/**
 * Registers the callable-surface probe tool.
 *
 * Declared with `defineTool`, not a bare object. A bare definition with
 * `parameters: {}` reaches the model provider without a root `type`, and the
 * request fails with `Invalid schema for function '<name>': schema must be a
 * JSON Schema of 'type: "object"', got 'type: null'` — which failed the whole
 * one-shot run, not just this tool (observed twice). The DSL compiles an empty
 * parameter map into a well-formed object root; nothing else does.
 *
 * @param ctx - Cordis context exposing `tools`.
 * @returns Nothing; the registration is made inside `ctx.effect`.
 */
export function applyCallable(ctx) {
  ctx.effect(() => {
    const dispose = ctx.tools.register(
      defineTool({
        name: 'zzprobe_callable',
        description:
          'Probe: call each candidate member of the subagent and llm services with no arguments and ' +
          'report whether it exists and executes, so a service that reflection cannot describe is ' +
          'still measured.',
        parameters: {},
        output: {
          schema: { type: 'json' },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute() {
          return {
            probe: 'callable',
            services: [await probeCallable(ctx, 'subagents'), await probeCallable(ctx, 'llm')],
          }
        },
      }),
    )
    return () => dispose()
  })
}
