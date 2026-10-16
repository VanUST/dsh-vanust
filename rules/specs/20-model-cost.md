---
title: Model and Cost Policy - Flash-Only Agents
slot: rules
order: 170
status: active
---
## 6. Model and Cost Policy — Flash-Only Agents

Every agent, subagent and worker runs a **Flash-class** DeepSeek model from provider
`deepseek-official` — currently `deepseek-flash` (V4.1 Flash); the older `deepseek-v4-flash`
and `deepseek-v4-flash-vision-exp` are deprecated aliases of the same tier. The policy is by
class, never by version: adopt a new Flash release without changing this rule.

Never select, request or delegate to a non-Flash tier — `deepseek-v4-pro` or any successor
pro tier — in a session model choice, a `subagent`/`workflow` option, or any other argument
that names a model. Do not ask the user to switch to one.
