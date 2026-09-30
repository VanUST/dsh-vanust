# Reasoning: the ingestion-ratify law is bound, and its two untested fail-closed states are tested

Status: source for a proposed amendment. Written 2026-09-30 after the corpus review.

## What was observed

The corpus review of 2026-09-30 flagged
`shipped-plugins.ingestion-ratifies-only-a-record-it-wrote` (ADR 0015, ratified by 0020) as
an in-force law whose `unenforced` note the corpus's own checks disprove. The note says:

> The behaviour is asserted by two tests in `scripts/test-ratchet.mjs` — one drives the tool
> with a supplied judge result and a stub channel and requires an approval, the other drives
> it with no judge and requires `attempted: false` and no question. No gate-level check binds
> them yet, because the suite is a single `node --test` invocation that prints TAP rather than
> a stable marker line; it becomes enforceable when a dedicated invariant script drives the
> tool into the three fail-closed states and asserts nothing is minted.

Two facts make that reason stale:

1. **A TAP test name IS a usable marker.** ADR 0044 introduced `outputContains` on a
   `command` check, and in-force laws already bind `node --test scripts/test-ratchet.mjs`
   that way — `review.a-law-bound-finding-quotes-the-law-it-judges` names
   `"a finding that quotes the law it names is checked against it"`. The note was written
   2026-09-15, one day before that pattern existed.
2. **Two of the law's three fail-closed states were untested.** The note accounted for "the
   record was not written" and the success path. It did not cover "no question channel is
   available" or "the answer cannot be read", so binding the two tests it named would have
   enforced a statement broader than its check.

## The measurement

A test now drives `ratchet_ingest_source` with `ratify: true` through all three:

- **no channel**: `toolHarness()` with no `userQuestions` service → the ratchet prepares the
  quiz, reports `ratify.askFailed`, mints nothing, writes no approval ADR;
- **unreadable answer**: a live channel whose human selects `Resume`, a label the ratchet
  never offered → `ratified` is empty and no approval ADR is written;
- **control**: the same fixture, the same call, a readable `Approve` → exactly one approval
  ADR. The control is what makes the first two assertions measurements: two cases that only
  ever observed "nothing minted" would pass on a tool that could never mint at all.

Falsified before it was trusted: with the production reading mutated so an unmatched label
records `approved`, the test fails on `an unreadable answer mints nothing`; restored, it
passes.

## The decision

ADR 0015 is ratified by 0020, so its text is frozen — editing it would report
`RATIFICATION_STALE` and the law would leave force. The change therefore ships as an
amendment: the old law id is removed and the same statement is restated under a new id with a
`command` check that binds the suite and names each of its three tests through
`outputContains`, so the note disappears and the law is enforced.

## Alternatives rejected

- **Correcting the note in place.** ADR 0015 is ratified; editing it voids the consent that
  put the law in force. The note could only be corrected by a new record anyway.
- **Binding the two existing tests and correcting the note.** Cheaper, and it was the
  reviewer's fallback. Rejected because it leaves the law claiming a state nothing checks:
  the point of the binding is that the whole statement is enforced, and the missing case —
  an answer that cannot be read — is the one where a mistake would mint a consent from a
  label nobody offered.
- **A dedicated invariant script.** The old note proposed one. It would add a second runner
  for the same tool surface, when `scripts/test-ratchet.mjs` already drives it and the corpus
  already knows how to bind a named test in it.
