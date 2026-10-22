# @cc/dsh-flash-guard

Keep delegated work on `deepseek-official/deepseek-flash`.

The harness default is already flash, but a `workflow` script can pass
`provider`/`model` to an `agent()` call, and that route reaches the loop
unchanged. This plugin listens on the `agent/request` waterfall after the frozen
`LlmCallConfig` is resolved and, for a child agent (`delegationDepth > 0` or a
`parentSession` header), either rewrites the route to the configured flash target
or throws before dispatch.

## Config

```yaml
- id: flash-guard
  name: '@cc/dsh-flash-guard'
  config:
    provider: deepseek-official
    model: deepseek-flash
    allowedRoutes:
      - { provider: deepseek-official, model: deepseek-flash }
    onViolation: rewrite      # or refuse
    enforceRoot: false        # true also guards the conversation's own agent
    maxReasoningEffort: high  # optional cap; omit to leave effort alone
```

## What it does not cover

An external subagent provider (ACP, SDK, Claude Code) executes outside DSH's
LLM and never reaches `agent/request`. If the rule must be absolute, do not
mount those providers. This is stated in the plugin header beside the code.
