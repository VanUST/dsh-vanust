---
title: The Delegation Cap
slot: rules
order: 270
status: active
---
## 14. The Delegation Cap

There are no work modes: no session is in a RESEARCH or IMPLEMENTATION mode and no mode is
injected into any prompt. What a session does is governed by the specs its project injects
(§0a) and by these rules.

**At most two concurrent `subagent` children per session.** A third call is refused immediately,
with the two running agents named, and the caller decides: batch the remaining work into the
delegations already running, finish its own step first, or retry later. It is not a queue and not
a wait. The mechanism is a monotonic `tools.guard()`, which may only deny, so no listener
ordering can turn the refusal back into permission. Grandchildren count against the session that
started the chain.

**A `workflow` fan-out is deliberately outside that cap.** The cap counts the `subagent` tool's
children and nothing else, so it is a cap on one delegation tool, never a ceiling on concurrent
work.

**The cap counts RUNNING children, not resident ones.** The slot is released when the child's run
settles, so a resident child that is idle between turns holds no slot; a child this process cannot
see at all is released by liveness first and by the 15-minute age bound only as a fallback. The
exact bound, and the measurement it rests on, are stated beside the code in
`plugins/work-modes/work-modes.mjs`; do not restate it as a guarantee the mechanism does not give.

`node --test scripts/test-work-modes.mjs` drives the real tool registry over both behaviours, and
`node scripts/probe-work-modes.mjs` measures the seam it rests on.
