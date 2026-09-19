---
id: "0065"
title: ADR 0010's restatement is closed — three of its four consent laws are in force
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-19T10:26:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-19-adr-0010-surviving-consent-laws.md
  hash: sha256:b44e7fbe927abe182bba95aaad6b098cdb60f207bacb7fe9513fa578b85e32be
zones:
  - shipped-plugins
supersedes: []
approves: []
resolves:
  - "0010"
  - "0035"
laws: []
---

## Context

The 2026-09-18 corpus review raised a **warning**, kind `deprecated_decision`, against ADR
0010: its Decision section says "The four consent laws are restated with behavioural enforcement
points … The same four laws, in the same zone, are enforced by commands", but the record no
longer decides four. `shipped-plugins.consent-travels-the-human-channel`, which 0010 declared,
is carried by no law in force: ADR 0035 (ratified by 0049) removed it and restated the guarantee
as a consent that records the channel that carried it, and ADR 0043 (ratified by 0048) restated
that form again as `shipped-plugins.a-consent-question-carries-the-record-and-records-its-channel`,
which is the law in force today.

## Decision

ADR 0010's restatement is closed as follows, and the conflict between 0010 and 0035 is settled:

1. **Three** of 0010's four laws are in force, in `shipped-plugins`, enforced by commands:
   `shipped-plugins.consent-is-hash-bound`, `shipped-plugins.no-shell-mint` and
   `shipped-plugins.unenforced-laws-are-reported`.
2. The fourth left with ADR 0035's ratified removal, and the rule it carried now lives under
   `shipped-plugins.a-consent-question-carries-the-record-and-records-its-channel`. 0010's
   sentence "the same four laws, in the same zone" describes the corpus before 0035, not after.

Nothing is removed, restated or superseded. The law in question left through a ratified
amendment, so an `op: remove` here would be `LAW_TARGET_DANGLING`; 0010's three surviving laws
are in force and undisputed; and re-declaring the restated rule would duplicate what ADR 0043
already carries.

## Reasoning

The source this record cites —
`docs/ratchet/sources/2026-09-19-adr-0010-surviving-consent-laws.md`, whose hash it pins —
quotes the finding, records the measurement of the three laws 0010 sources in the bundle, notes
that the review's own count named two of them and missed `shipped-plugins.no-shell-mint`, and
rejects the alternatives on the record: editing 0010 voids the consent approval 0011 recorded
and would take three working laws out of force; retiring 0010 would retire them with it; leaving
the warning unrecorded is how the next review re-raises it.

## Consequences

- The corpus stops carrying a record that claims four laws while contributing three, without
  touching the record or any law.
- ADR 0010 and ADR 0035 keep their recorded consents and their remaining laws.
- The settlement takes force away from nothing and adds none, so it is a **proposal** until a
  human ratifies it; `ratchet verify` stays at 67 laws and 78 checks while it waits.
