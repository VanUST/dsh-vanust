---
id: "0002"
title: A problem code is a stable branchable identifier
type: adr
status: active
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-13T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-13-ratchet-design-session.md
  hash: sha256:1abfded03aafb25e63e826f20a5917056084b58532a07b591caccd67a96efaf8
zones:
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.problem-codes-are-declared
    statement: Every problem the ratchet emits carries a code from the closed vocabulary in ratchet-schema.mjs; a code invented at a call site is a defect.
    checks:
      # The first version checked that the TABLE existed, which is true of a table
      # nothing uses. The invariant is that no emit site names a code the table lacks,
      # and that needs a scan rather than a pattern.
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: every emitted problem code is declared in PROBLEM_CODES
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.problems-carry-a-subject
    statement: A problem record carries a self-contained message and a subject, so a branch can filter on the subject and a reader can act without opening the source.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: every problem record carries a code, a subject and a self-contained message
        timeoutMs: 300000
---

## Context

The predecessor reported problems as prose in a `problems` array: bare strings with
no identifier, and in the worst case an empty array for a project whose decisions
directory did not exist at all. An empty array and a clean project were the same
value, which is how a gate reports success while nothing was checked.

An agent reading a report needs to branch on what went wrong. Prose forces it to
pattern-match English, and every rewording of a message silently breaks callers that
depended on the old phrasing.

## Decision

Every problem is a record `{ code, severity, subject, message, ... }` whose `code`
comes from a single frozen `PROBLEM_CODES` table, each entry carrying the condition
it names. Codes are added and never renamed; adding one is a compatible change and
renaming one is not.

## Reasoning

A code is a branchable identifier: an agent, a shell script or a rule can act on
`ADR_SOURCE_HASH_MISMATCH` without parsing a sentence, and the message can be
rewritten for clarity without breaking anything that branches on it.

The table also gives the vocabulary an enforcement point. A code emitted but absent
from the table is a defect, which is a checkable property — and the design records
the opposite case too: three codes were declared in the first draft with no emitter,
and pretending they were rules would have been a lie, so the design document lists
them as gaps until they gained one.

`subject` and `message` are separate for the same reason: `subject` names the law,
ADR, zone or path a consumer wants to filter on, and `message` explains it to a human.
Collapsing them means either a filter has to parse prose or a reader has to look up
an identifier.

## Consequences

- A report can be summarised by code (`VERIFY_NOT_RUN x1, LAW_CONFLICT x2`) without
  reading any message.
- Every new failure mode costs a table entry, which is a small deliberate friction
  that keeps the vocabulary from growing by accident.
- Severity exists as a field and is currently always `error`. Warning severity is
  declared and unused; that is a gap rather than a feature.
