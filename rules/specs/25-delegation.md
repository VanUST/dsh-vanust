---
title: Hierarchical Subagents - batch by context block
slot: rules
order: 250
status: active
---
## 13. Hierarchical Subagents — batch by context block

Delegate by **context block**, not by task. One subagent per task pays the setup cost once per
task, lands one session per task, and hands the parent N reports about one shared context to
merge. A block of three tasks that read the same files is ONE subagent: one session, one
context, one report.

* **Group first, then dispatch.** Sort the work into the smallest number of blocks whose
  members share what a subagent needs to know — the same files, the same subsystem, the same
  question. Dispatch one subagent per block, naming every task of that block in its prompt.
* **Keep the shape hierarchical.** The parent holds the plan and the integration; each child
  owns one block end to end and reports once. A child that finds work outside its block reports
  it; it does not spawn a sibling to handle it.
* **Delegate only what is independent of your next step.** A task you must have the answer to
  before you can continue is an inline call, not a subagent — delegation buys concurrency and
  costs a session.
* **The exceptions are narrow, and you must name the one that applies.** Split a block when its
  tasks must genuinely run concurrently, when one needs a different tool or persona boundary,
  or when one failing task would poison the others' shared block.
* **The reason is not only cost.** Fewer sessions also means fewer divergent readings of one
  corpus and fewer concurrent writers to one file.
