---
id: "0072"
title: The law id the release-gate breaker left in the ledger is retired
type: adr
status: active
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-19T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-19-unwinding-a-falsifiers-ledger-artifact.md
  hash: sha256:216391b5d892ff13004a9a8a40228a7cb376155bcb8ea64068d14f4f503a2268
zones:
  - kit-tooling
supersedes: []
approves: []
laws:
  # The retirement. Before ADR 0071 declared the id this was refused as
  # LAW_TARGET_DANGLING — a removal of a law no active record declares — which is why the
  # ledger's recorded set could not move forward. `removedByDecision` is what
  # `lawRemovalProblems` subtracts, so with this record in force the next run records its
  # own (67-law) set again and the standing LAW_REMOVED_WITHOUT_DECISION disappears.
  # A removal carries no constraint to check, so it states an `unenforced` reason.
  - op: remove
    id: kit-tooling.falsified-unchecked
    checks: []
    unenforced: "a removal carries no constraint to check; the law it retires was never in force in the compiled bundle, so there is nothing left to verify"
---

## Context

ADR 0071 records the defect and the fix: `scripts/falsify-kit-gate.mjs` recorded a law set
its own synthetic corpus induced, `readRecordedLawIds` found it on every later run,
`lawRemovalProblems` reported `kit-tooling.falsified-unchecked` as removed without a
decision, `persistVerify` refused to record a new set while that stood, and the remedy the
problem named was refused as `LAW_TARGET_DANGLING` because no active record declared the
law.

ADR 0071 declares it. It has to be retired by a **second** record, because the schema
refuses one record naming the same law id twice: `LAW_DUPLICATE`, "law id
`kit-tooling.falsified-unchecked` appears twice in this ADR".

## Decision

`kit-tooling.falsified-unchecked` is retired with an explicit `op: remove`. It leaves the
compiled set through `removedByDecision`, which is the set `lawRemovalProblems` subtracts
from the ledger's recorded set, so the standing `LAW_REMOVED_WITHOUT_DECISION` clears and
the next run records the law set the corpus really has.

Nothing is edited: no line is removed from `.dsh/ratchet/ledger.jsonl`, and no ratified
record is touched. The ledger's history keeps the entry that named the id, and these two
records are the decision that accounts for it.

## Reasoning

The reasoning source is
`docs/ratchet/sources/2026-09-19-unwinding-a-falsifiers-ledger-artifact.md`, whose hash
this record pins, shared with ADR 0071 — the two records are one decision in two halves,
and the schema is what forces the split. `LAW_TARGET_DANGLING` is left exactly as it was:
it is what stops an agent from retiring a law by writing a removal for something no record
ever declared, and the defect it exposed was in the breaker, not in the refusal.

## Consequences

- The gate goes green again without state being edited by hand: the record is the cure, and
  a later reader can follow the ledger's entry to the two decisions that explain it.
- Both records stay. Deleting them would leave the ledger's removal explained by nothing,
  and no law is carried by them: the declared id is out of force before the bundle is
  built, so the compiled law set is the same before and after.
- A future falsification run no longer poisons the ledger, because
  `scripts/falsify-kit-gate.mjs` now snapshots and restores it around every case (ADR
  0071).
