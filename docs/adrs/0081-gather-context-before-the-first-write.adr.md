---
id: "0081"
title: Gather the context a task needs before its first write
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-21T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-21-gather-context-before-the-first-write.md
  hash: sha256:bbdecd9e07ea47444a835557d859b29a2f8faf56e5c7ad995c3c4077e4862f08
zones:
  - deployment-rules
supersedes: []
approves: []
laws: []
---

## Context

A task arrives with less context than it needs. The session can see its prompt, the deployment
rules and its own conversation; it cannot see the file that defines the contract it is about to
change, the test that already covers the case, the decision that forbids the obvious fix, or the
second caller the change will break. A change written against the wrong contract fails later, as
a diff that has to be unwound, and unwinding costs more than the reconnaissance that would have
prevented it.

The delegation tool is the right instrument: it reads and reports without editing, runs in its
own context, and returns a bounded report. The rule has to be stated so that it does not become
the over-delegation §13 forbids, which is why it is gated on the first WRITE rather than on the
task, why one gatherer is the maximum, and why a task that is already delegated folds its
reconnaissance into the block's own prompt.

## Decision

`rules/AGENTS.md` gains §13a: before the first write of a task, spend ONE delegation gathering
what the task needs and the session does not already have, answering a named question list —
contract, enforcement point, governing decision, other dependants, and the gaps it could not
resolve. The section carries four limits with it: one gatherer and it is the first delegation; a
named skip case when the context is already present; a report rather than an exploration; and its
output is evidence to verify rather than authority to inherit.

## Reasoning

The full reasoning is the cited source. In short: the facts are knowable before the first write,
they are usually not in the prompt, and the delegation tool reads them without spending the
parent's context on facts it will not need again — provided the rule is gated on the first write
and bounded to one gatherer, so it reinforces §13 instead of contradicting it.

## Consequences

- Every session's prompt gains §13a. A task whose context is already present is told to skip it
  and to say which skip case applies; the rule is not unconditional.
- `rules/drills/gather-context-first.json` is the enforcement point. The GREEN run must call the
  delegation before the write and at most once; the RED run, with the section stripped, must
  perform them in the wrong order. `node scripts/drill-kit-rules.mjs --root .` fails if the
  section the scenario names does not exist.
- The skip cases are NOT enforced by a command: "the context is already on screen" is a property
  of a conversation, not of an offered action. They are stated for the reader, and this record
  says so rather than implying the drill covers them.
- A human must ratify this record. `deployment-rules` declares `proposeOnly`, so an
  agent-authored record cannot activate itself; the rule text is installed with the next
  `kit-update --apply` either way, and ratification is what puts the decision behind it.
