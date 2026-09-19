---
id: "0071"
title: The release-gate breaker restores the ledger, and the law set it recorded is declared so it can be retired
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
  # This law exists so that ADR 0072 can RETIRE the id the release-gate breaker injected.
  # `compileLaws` refuses an `op: remove` naming a law no active record declares
  # (`LAW_TARGET_DANGLING`), which is correct — it is what stops an agent retiring a law by
  # writing a removal for something nobody ever declared — and it is also why the injected
  # id could not be retired at all until a record declared it. The `unenforced` note is
  # required because a declared law with no check must say why. ADR 0072 removes the id in
  # the same corpus, so it is never in force in the compiled bundle.
  - op: upsert
    id: kit-tooling.falsified-unchecked
    statement: A law id the release-gate breaker injected into an active record during a falsification run, and which the verify that run performed recorded in the ledger's law set; declared here so that a decision can retire it, because a removal of a law no record declares is refused as LAW_TARGET_DANGLING.
    checks: []
    unenforced: "nothing checks this law and nothing should: it is declared only so that ADR 0072 can retire an id a synthetic corpus put in the ledger, and it is out of force in the compiled bundle"
---

## Context

`scripts/falsify-kit-gate.mjs` breaks one kit invariant at a time, runs the real
`ratchet verify`, requires the gate to fail, and restores the file it broke. Its case
`law-with-no-check-and-no-reason` injects a law into an active record, and the `verify`
that case performs compiles a corpus containing one extra law. Because no law was
*removed*, that run recorded the law set it observed — 68 ids, including
`kit-tooling.falsified-unchecked` — and the case then restored the ADR, leaving the
compiled set at 67 while the ledger still recorded 68.

The result was a gate that could not go green. `readRecordedLawIds` walks the append-only
ledger backwards for the most recent entry carrying a `lawIds` array and finds the 68-law
set; `lawRemovalProblems` reports the missing law on every run as
`LAW_REMOVED_WITHOUT_DECISION`; `persistVerify` records a law set only when no removal
problem stands, so the run does not self-heal; and the remedy the problem names — an
explicit `op: remove` — is itself refused as `LAW_TARGET_DANGLING`, because no active
record declares the law. The injected ADR cannot be restored to declare it either: the
injection was into a ratified record, and editing a ratified record voids its consent.

## Decision

1. **The breaker restores every artifact its own mutations induce.**
   `scripts/falsify-kit-gate.mjs` snapshots `.dsh/ratchet/ledger.jsonl` before each case
   and writes those bytes back in the `finally`, and on `SIGINT`/`SIGTERM` as the file
   restores already are. A law set a synthetic corpus induced is not part of the project's
   append-only history, and leaving it there made the breaker a one-way door. Its OUTPUTS
   section is corrected in the same change, because it claimed a recovery that did not
   work.
2. **The id the synthetic corpus recorded is declared here, and retired by ADR 0072.**
   Two records rather than one, because the schema refuses a single record naming the
   same law id twice (`LAW_DUPLICATE`, "law id `kit-tooling.falsified-unchecked` appears
   twice in this ADR") — the right refusal, since one record cannot both assert a law and
   deny it. With the declaration in force the removal is no longer `LAW_TARGET_DANGLING`,
   the id leaves the compiled set through `removedByDecision`, and the next run records
   the 67 laws the corpus really has.

## Reasoning

The reasoning source is
`docs/ratchet/sources/2026-09-19-unwinding-a-falsifiers-ledger-artifact.md`, whose hash
this record pins. It carries the ledger entry that recorded the injected law, the two
functions that make the state permanent (`readRecordedLawIds`, `persistVerify`'s
`lawIds: removalProblems.length === 0 ? … : null`), the refusal of the named remedy, and
why the fix belongs in the breaker rather than in the removal check.

`LAW_TARGET_DANGLING` is not changed and is not the defect. It is what stops an agent from
retiring a law by writing a removal for something no record ever declared; the defect is a
breaker that wrote a law set no record could account for, and the fix is in the breaker.

## Consequences

- After ADR 0072, `node plugins/ratchet/ratchet-cli.mjs verify --root .` reports no
  problems and records the current law set again, which is the state the breaker's own
  documentation promised and did not deliver.
- Running `node scripts/falsify-kit-gate.mjs` leaves the tree verified. The fix's
  falsification is that run: before the fix it left `LAW_REMOVED_WITHOUT_DECISION`
  standing, after it leaves none.
- Both records stay in the corpus. Deleting them would leave the ledger's removal of
  `kit-tooling.falsified-unchecked` explained by nothing, which is the same gap one level
  down; keeping them costs no law, because ADR 0072 retires the declared id before the
  bundle is built.
