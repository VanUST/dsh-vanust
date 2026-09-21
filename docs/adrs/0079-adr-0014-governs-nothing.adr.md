---
id: "0079"
title: ADR 0014 governs nothing, and its channel prose is historical
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-21T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-21-adr-0014-governs-nothing.md
  hash: sha256:d07a7f3ff713b80c3efec9f0c47eb02f9dd875439310f6209ecba73fc9f7eaa2
zones:
  - shipped-plugins
supersedes: []
approves: []
resolves:
  - "0014"
  - "0035"
laws: []
---

## Context

The 2026-09-21 corpus review raised a warning, kind `deprecated_decision`, against ADR 0014: it
is in force through the ratification approval 0016, it declares no law in the current 79-law
set, and its Decision prose describes a channel the shipped panel no longer uses.

ADR 0014's Decision says the panel's action clears by the ratchet's own question through
`user-questions/request`. Since then ADR 0035 removed its first law, ADR 0076 (ratified by
0078) removed the remaining two and restated them under new ids, ADR 0034 decided the panel
records consent through its own host route with no composer message, and ADR 0043 recorded
`adr-panel` as a channel distinct from the harness seam's `user-question`. The panel host
never reads `ctx.userQuestions` itself: its consent route calls the ratchet's `ratchetConsent`
service, which calls the same `ratify` operation the `ratchet_ratify` tool calls.

The record cannot be repaired in place. It was ratified by 0016, so its text is frozen and an
edit voids the consent; a record that has lost every law it declared has no `op: remove` target
left; and `supersedes` demands a terminal status a ratified active record cannot be given.
That is the wall ADR 0066 measured for ADR 0019.

## Decision

The reading of ADR 0014 that is true is recorded, and its conflict with the shipped consent path
is settled:

1. ADR 0014 **governs nothing**. Every law it declared left the bundle through a ratified
   amendment that restated the rule under a new id. Its text is not edited, superseded or
   deleted, and it stays active.
2. Its channel prose is **historical**. The panel's consent travels its own host route through
   the ratchet's `ratchetConsent` service on the `adr-panel` channel, which is what ADR 0034,
   0035 and 0043 decided; `user-questions/request` is the harness seam the ratchet's consent
   service uses, not the panel's own path, and the panel host does not read `ctx.userQuestions`
   itself.
3. The two laws 0076 restated are live under their new ids, and this record changes nothing
   about them.

## Reasoning

The full reasoning is the cited source. In short: an active, ratified decision whose prose
contradicts the shipped mechanism misleads exactly the reader who goes looking for how consent
works, and the record cannot be edited or retired, so the honest remedy is to record what it now
means — the treatment ADR 0066 gave ADR 0019 for the same reason.

## Consequences

- ADR 0014 remains active and frozen. A reader who finds it is pointed at this record and at the
  laws that now carry its subject.
- A human must ratify this record: an unratified agent record cannot put force behind a reading
  of a ratified decision, which is the same limit ADR 0066 recorded.
- Nothing here retires a law or edits a ratified file, so no consent is voided and no law leaves
  force as a side effect.
