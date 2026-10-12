---
title: Model and Cost Policy - Flash-Only Agents
slot: rules
order: 200
status: active
---
## 8. Model & Cost Policy — Flash-Only Agents

* **Every agent, subagent, and worker runs on a FLASH-CLASS DeepSeek model** (provider `deepseek-official`) — any Flash-tier id, currently `deepseek-flash` (V4.1 Flash); the older `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` ids are accepted but deprecated aliases of the same tier. The policy is by CLASS, never by version: when DeepSeek ships a new Flash release, adopt it without a policy change. Never select, request, or delegate to a non-Flash tier (`deepseek-v4-pro` or any successor pro tier) — not in session model choices, not in `subagent`/`workflow` delegation options, not in any tool argument that names a model, and not by asking the user to switch to it.

