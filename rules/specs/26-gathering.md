---
title: Gather the Context You Do Not Have
slot: rules
order: 210
status: active
---
## 10. Gather the Context You Do Not Have

A task arrives missing the context it needs: the contract it will change, what already
enforces the behaviour, the decision that forbids the obvious fix, the second caller it will
break. Finding those halfway through produces a diff that has to be unwound.

**Before the first write of a task, spend ONE delegation gathering what the task needs and
this session does not already have.** The gatherer answers a question list, not "look around":

- **The contract** — the file, module or manifest that defines the behaviour, and what it
  promises its callers.
- **The enforcement** — the test, check or law that covers it today, and the input that would
  make it fail.
- **The prior decision** — the ADR, rule or comment that governs the area, and whether it is
  in force.
- **The dependants** — the callers, the second implementation, the generated artifact.
- **The gaps** — what could not be determined, named as gaps, so the parent can tell a
  complete answer from a partial one.

Four limits:

- **One gatherer per task, and it is the FIRST delegation** — before a work delegation, not
  beside it, and it spawns nothing of its own. When the task is itself delegated as a block,
  the reconnaissance goes INTO that prompt: one subagent, not two.
- **Skip it, and say which case applies, when the context is already here** — a continuation
  of work in this conversation, a question a file in context answers, a change whose contract
  is on screen with its callers in the same file.
- **A report, not an exploration.** The gatherer returns and stops: it does not fix, refactor
  or write.
- **Evidence, not authority.** Verify a claim like any other (§8), and quote a claim about
  code as `path:line` so the parent can check it rather than inherit it.
