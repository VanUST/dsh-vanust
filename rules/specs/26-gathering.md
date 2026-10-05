---
title: Gather the context you do not have
slot: rules
order: 260
status: active
---
## 13a. Gather the context you do not have, before the first write

A task arrives with less context than it needs: the contract it is about to change, the test that
already covers the case, the decision that forbids the obvious fix, the second caller it will
break. Discovering those halfway through produces a diff that has to be unwound.

**Before the first write of a task, spend ONE delegation gathering what the task needs and the
session does not already have.** The gatherer answers a question list, not "look around":

* **What is the contract?** The file, module or manifest that defines the behaviour being changed,
  and what it promises its callers.
* **What already enforces this?** The test, check or law that covers it today, and the input that
  would make it fail.
* **What did someone already decide?** The ADR, rule or comment that governs the area, and whether
  it is in force.
* **What else depends on it?** The callers, the second implementation, the generated artifact.
* **What could not be determined?** The gaps, named as gaps. A gatherer that reports only what it
  found leaves the parent unable to tell a complete answer from a partial one.

Four limits keep this from becoming the over-delegation §13 forbids:

* **One gatherer per task, and it is the FIRST delegation.** It runs before a work delegation, not
  beside one, and it spawns nothing of its own. When the task is already being delegated as a block
  (§13), the reconnaissance goes INTO that delegation's prompt — one subagent, not two.
* **Skip it, and say which case applies, when the context is already here.** A continuation of work
  already in this conversation; a question a file in context already answers; a change whose
  contract is on screen and whose callers are in the same file. Gathering there buys a session and
  returns what the parent already had.
* **A report, not an exploration.** The gatherer returns and stops. It does not fix, refactor or
  write: a gatherer that starts changing files is a work delegation that skipped the plan, and its
  edits are then unreviewed by the parent that asked only for facts.
* **Its output is evidence, not authority.** A claim it makes is verified like any other (§11), and
  a claim about code is quoted as `path:line` so the parent can check it rather than inherit it.
