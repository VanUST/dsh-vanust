/**
 * THE HARNESS SEAM: how this kit starts a subagent.
 *
 * WHY A MODULE OF ITS OWN. The subagent runtime changed the activation request between the
 * versions this kit pins. dsh 0.2.1 reads the request as `spec.request.*` (`spec.request.parent`,
 * `spec.request.maxDepth`, `spec.request.outputSchema`); the installed dsh 0.2.2-rc.3 declares
 * `SubagentActivationSpec extends Omit<SubagentStartRequest, 'label' | 'signal'>`
 * (node_modules/@deepseek-ai/dsh-subagent/lib/types/types.d.ts), so `parent`, `prompt`,
 * `agentPreset` and `cwd` sit at the TOP level of the spec (`spec.parent.id`). Sending only one
 * shape is a hard break on the other version: on 0.2.2 the nested form throws
 * `Cannot read properties of undefined (reading 'id')` before a child exists, and on 0.2.1 the
 * flat form asks `startExternal(spec)` for a parent it cannot see. Both shapes are therefore sent
 * together; both readers ignore the fields they do not use. This file is the ONLY place that
 * knows either shape: moving the pin means editing this file, and no form knowledge lives in
 * orchestrator.mjs.
 *
 * NO HARNESS IMPORTS. The seam is data and validation only: it takes the facts of one delegation
 * and returns the object `ctx.subagents.startActivation` expects. The caller owns the runtime
 * call, its signal and its result.
 *
 * FORMS. `form: 'both'` (the default, what the orchestrator sends) carries the request twice;
 * `'request'` and `'flat'` carry one shape each, so a test can exercise either reader alone. An
 * unknown form is an explicit refusal: guessing would start a child on a contract nobody
 * implements.
 */

/** The activation shapes this seam can build. `both` is what the product sends today. */
export const ACTIVATION_FORMS = Object.freeze(['both', 'request', 'flat'])

/**
 * Build the `ctx.subagents.startActivation` spec.
 *
 * Two call shapes are accepted, and both are built into exactly one spec:
 *   - the kit's own: `{ role, preset, prompt, parent, route?, delivery?, cwd?, agentOptions?, signal?, form? }`
 *     where `prompt` is the text the child reads, `parent` the agent object the runtime knows, and
 *     `route` the subagent provider name (`spawn` by default);
 *   - a ready request (`{ provider, label, signal, delivery, request }`), which the migration
 *     proof uses to exercise the two readers without a delegation.
 *
 * @param {object} input
 * @returns the spec for `ctx.subagents.startActivation`.
 * @throws when the form is unknown, or when a field the runtime cannot default is missing.
 */
export function activationSpec(input) {
  const form = input?.form ?? 'both'
  if (!ACTIVATION_FORMS.includes(form)) {
    throw new Error('harness-seam: unknown activation form ' + JSON.stringify(form) + '; known forms: ' + ACTIVATION_FORMS.join(', '))
  }
  let route
  let label
  let signal
  let delivery
  let request
  if (input?.request !== undefined) {
    route = input.provider
    label = input.label
    signal = input.signal
    delivery = input.delivery ?? 'parent'
    request = input.request
  } else {
    const role = typeof input?.role === 'string' ? input.role.trim() : ''
    if (role === '') throw new Error('harness-seam: a delegation needs a role')
    if (input?.parent === null || typeof input?.parent !== 'object' || typeof input.parent.id !== 'string') {
      throw new Error('harness-seam: a delegation needs the parent agent object the runtime knows')
    }
    if (typeof input?.prompt !== 'string' || input.prompt === '') throw new Error('harness-seam: a delegation needs the child prompt')
    route = input.route ?? 'spawn'
    label = role.slice(0, 160)
    signal = input.signal
    delivery = input.delivery ?? 'parent'
    request = {
      prompt: [{ type: 'text', text: input.prompt }],
      parent: input.parent,
      agentPreset: input.preset,
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      ...(input.agentOptions === undefined ? {} : { agentOptions: input.agentOptions }),
    }
  }
  const spec = { provider: route, label }
  if (form === 'flat' || form === 'both') Object.assign(spec, request)
  if (form === 'request' || form === 'both') spec.request = request
  spec.signal = signal
  spec.delivery = delivery
  return spec
}
