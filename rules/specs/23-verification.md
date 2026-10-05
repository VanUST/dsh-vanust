---
title: Verification Before Completion
slot: rules
order: 230
status: active
---
## 11. Verification Before Completion — claims carry evidence

Do not claim a task is complete without evidence produced **in the same turn**. A completion
claim names the command that was run and the output it produced; a claim resting on a command
run earlier, or on no command at all, is provisional and must be labelled as such.

* **Quote the evidence, not the impression.** "The gate passed" is not evidence; the command and
  its printed marker are. If you cannot point at the output, the claim is a guess.
* **A green run is evidence only if its assertion could fail.** A suite that prints `fail 0`
  proves nothing when its covering check was emptied, and a test *name* is not an assertion.
  Prefer, or require, the output that would change if the behaviour were wrong.
* **Falsify before trusting.** For a guarantee you are about to rely on, name the mutation that
  would make its check fail and confirm the check fails. The breaker role (§10) is how this
  deployment does that.
* **State the limit when you cannot run the command.** Say which command was not run, why, and
  what remains unverified, rather than letting silence imply a pass.
