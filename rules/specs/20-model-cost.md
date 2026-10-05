---
title: Model and Cost Policy - Flash-Only Agents
slot: rules
order: 200
status: active
---
## 8. Model & Cost Policy — Flash-Only Agents

Autonomous work in this harness is a cost-controlled operation; model choice is a hard policy, not a preference. The policy rests on a measured usage analysis, not on a preference: see `docs/usage/2026-09.html`, which `scripts/usage-analytics.mjs` (or `make usage`) reproduces from a platform export in your Downloads folder. On that month's data the pro tier was already 0.8% of spend, so this policy buys predictability and a bounded blast radius rather than a large saving — do not restate it as a big saving.

* **Every agent, subagent, and worker runs on a FLASH-CLASS DeepSeek model** (provider `deepseek-official`) — any Flash-tier id, currently `deepseek-flash` (V4.1 Flash); the older `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` ids are accepted but deprecated aliases of the same tier. The policy is by CLASS, never by version: when DeepSeek ships a new Flash release, adopt it without a policy change. Never select, request, or delegate to a non-Flash tier (`deepseek-v4-pro` or any successor pro tier) — not in session model choices, not in `subagent`/`workflow` delegation options, not in any tool argument that names a model, and not by asking the user to switch to it.
* `deepseek-flash` handles image input natively (V4.1 Flash has vision built in), so no separate vision model id is needed.
* Do not "escalate" by switching models when a task gets hard. Finish with flash and surface the limitation to the user (§6) instead.
* `deepseek-v4-pro` bills ~5× the flash rate on every token class and is being retired (from 2026-09-14 07:00 Moscow the API itself routes pro to V4.1 Flash at Flash price); the ban stands regardless.
* Prefer off-peak hours for bulk work: DeepSeek peak windows are Mon–Fri 04:00–07:00 and 09:00–13:00 Moscow (01:00–04:00 and 06:00–10:00 UTC); off-peak is billed at half the peak rate, and weekends are fully off-peak.
