---
id: "0064"
title: ADR 0031's resolution mechanism prose is historical, and ADR 0045's law is the one in force
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-19T10:26:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-19-adr-0031-mechanism-prose-is-historical.md
  hash: sha256:ed906349cf2ec3a25d800e23e65374cd0708b12c0b9b7f554baf5216abd49c9d
zones:
  - shipped-plugins
supersedes: []
approves: []
resolves:
  - "0031"
  - "0045"
laws: []
---

## Context

The 2026-09-18 corpus review raised one **error**, kind `prose_law_mismatch`, against ADR
0031: its Decision section states that a resolution "removes the losing laws, supersedes the
losing record, and names both sides" — a conjunctive mechanism — while ADR 0045's in-force law
`lifecycle.a-resolution-takes-force-away-in-exactly-one-of-two-ways` states that force is taken
away in exactly ONE of two ways and refuses the combination as `RESOLUTION_AMBIGUOUS`.

The review is right about the prose and right that 0031 is still in force. What it does not say
is that the law the prose described has already left: ADR 0045 removed
`lifecycle.a-resolution-is-an-ordinary-record-with-a-resolves-list`, and 0031's other three laws
— the removal-authority rule, the standing-block rule and the retired-record-says-so rule — are
in force and load-bearing.

## Decision

The conflict between ADR 0031 and ADR 0045 is settled: **ADR 0045's law is the binding statement
of how a resolution takes force away**, and ADR 0031's mechanism prose is **historical** — kept
because a ratified record may not be edited, and true of nothing in force.

Nothing is removed, nothing is restated and nothing is superseded. The law that stated the
conjunctive mechanism was removed by ADR 0045, a ratified amendment; a second removal of it
would be `LAW_TARGET_DANGLING`, and re-declaring it in corrected form would both add a law and
duplicate the rule 0045 already carries. ADR 0031's three surviving laws are unaffected and
remain in force.

## Reasoning

The source this record cites — `docs/ratchet/sources/2026-09-19-adr-0031-mechanism-prose-is-historical.md`,
whose hash it pins — quotes the review's finding, records the measurement of which law each
record contributes to the bundle, and states why no law change is available or needed. The
alternatives were rejected on the record: editing 0031 voids the consent recorded by approval
0053; superseding 0031 would take three working laws out of force to correct a sentence about a
law that has already left; leaving the finding unrecorded is how the next review re-finds it.

## Consequences

- A reader who follows ADR 0031 reaches this record through the `resolves` list and learns which
  of the two texts is live, instead of choosing between a record's prose and a law in force.
- ADR 0031 keeps its three laws and its recorded consent; ADR 0045 keeps its corrected law.
- The settlement takes force away from nothing, so it is not a removal and needs no authority
  the corpus does not already have — but it names law a human ratified, so it is a **proposal**
  until a human ratifies it.
- No law is added, so `ratchet verify` stays at 67 laws and 78 checks while this waits.
