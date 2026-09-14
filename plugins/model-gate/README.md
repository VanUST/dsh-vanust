# @deepseek-ai/dsh-model-gate

Deployment model-cost gate for the official DeepSeek route.

## Why this exists

Autonomous harness work is a cost-controlled operation, and the pro tier bills
roughly five times the Flash tier per token. Rather than trust every caller to
choose the cheap tier, this plugin makes the choice structural: a dispatch
whose model is outside the deployment's allowed set fails before the adapter is
invoked, so a wrong model costs nothing and fails loudly instead of silently
billing.

Two decisions shape the policy:

- **Class, not version.** The default admits every DeepSeek Flash id through a
  pattern, so a new Flash release (a renamed or re-versioned id) is adopted
  without editing policy, while non-Flash tiers such as the pro line match
  nothing. Pinning named model releases would have forced a policy change on
  every upstream release.
- **Opt-in.** A deployment owns its cost policy, so the shipped default is
  `enabled: false`; the dsh-kit profile patch turns it on with the Flash-class
  pattern. An enabled gate with no usable matcher refuses to start rather than
  silently allowing or blocking everything.

## Behavior

The gate listens on the `llm/stream` waterfall — the single chokepoint every
model dispatch passes (root turns, subagents, compaction, session titles) — and
vetoes a request whose `model` matches neither an allowed exact id nor an
allowed pattern with a `MODEL_NOT_ALLOWED` failure. Rejection is synchronous,
before the waterfall's base call, so no adapter, HTTP request, or billing
occurs. Disabled, it registers nothing.

## Configuration

```yaml
- id: model-gate
  name: '@deepseek-ai/dsh-model-gate'
  config:
    enabled: true
    allowedModelPatterns:
      - '^deepseek-(v[0-9.]+-)?flash(-[a-z0-9-]+)*$'
```

| Field | Meaning |
|---|---|
| `enabled` | Turns the gate on. Defaults to `false`. |
| `allowedModels` | Exact model ids admitted in addition to the patterns. |
| `allowedModelPatterns` | Regular expressions matched against the whole model id. Defaults to the Flash-class pattern. |

## Known Limitations and Deferred Work

- The model id is checked as a string; a provider that silently remaps a
  request to a different backend under an allowed id is out of scope.
- The deployment must restart the harness for a changed row config to take
  effect, since the listener is registered when the plugin activates.
