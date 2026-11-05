# @cc/dsh-flash-guard

Keep delegated work on `deepseek-official/deepseek-flash`.

The harness default is already flash, but a `workflow` script can pass
`provider`/`model` to an `agent()` call, and that route reaches the loop
unchanged. This plugin listens on the `agent/request` waterfall after the frozen
`LlmCallConfig` is resolved and, for a child agent (`delegationDepth > 0` or a
`parentSession` header), either rewrites the route to the configured flash target
or throws before dispatch.

A second rule covers the opposite direction. `deniedModels` names routes that must
never run, and a match is **refused for every agent, root included** — not
rewritten. Silently substituting a model would let a "never use this" rule hold
while the expensive route was paid for anyway.

## Config

```yaml
- id: flash-guard
  name: '@cc/dsh-flash-guard'
  config:
    provider: deepseek-official
    model: deepseek-flash
    allowedRoutes:
      - { provider: deepseek-official, model: deepseek-flash }
      - { provider: kimi-coding, model: k3.1-pro }
    onViolation: rewrite      # or refuse
    enforceRoot: false        # true also guards the conversation's own agent
    maxReasoningEffort: high  # optional cap; omit to leave effort alone
    deniedModels:             # refused for root and child alike, always
      - '*highspeed*'
```

A `deniedModels` pattern is a case-insensitive glob where `*` is the only
metacharacter: `*highspeed*` matches every current and future variant. A pattern
containing `/` is matched against `<provider>/<model>` instead of the model id.

## What it does not cover

An external subagent provider (ACP, SDK, Claude Code) executes outside DSH's
LLM and never reaches `agent/request`. If the rule must be absolute, do not
mount those providers. This is stated in the plugin header beside the code.
