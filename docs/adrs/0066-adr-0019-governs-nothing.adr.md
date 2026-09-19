---
id: "0066"
title: ADR 0019 governs nothing, and its executed-bundle guarantee lives on under ADR 0035's law
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-19T10:26:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-19-adr-0019-governs-nothing.md
  hash: sha256:e603d692a7609ad6d24640faafc563758aee1e3b819630111b1ca3d3468afc0a
zones:
  - shipped-plugins
supersedes: []
approves: []
resolves:
  - "0019"
  - "0035"
laws: []
---

## Context

The 2026-09-18 corpus review raised a **warning**, kind `deprecated_decision`, against ADR
0019: it presents itself as the enforcement binding for the panel's consent laws, and no law in
the in-force set is attributed to it. Measured: 0019 is in force through the ratification
approval 0023 recorded, and the bundle contains **none** of the two laws it declares. ADR 0035
(ratified by 0049) removed `shipped-plugins.the-panels-consent-laws-are-enforced-by-executing-the-bundle`
and restated it as `shipped-plugins.the-panels-consent-path-is-enforced-by-executing-the-bundle`;
ADR 0043 (ratified by 0048) removed `shipped-plugins.the-question-seam-is-measured-by-the-probe`
and restated it as `shipped-plugins.the-questions-intent-and-answer-are-measured-hermetically`.

## Decision

The reading of ADR 0019 that is true is recorded, and its conflict with ADR 0035 is settled:

1. ADR 0019 **governs nothing**. Every law it declared left the bundle through a ratified
   amendment that restated the rule under a new id, and 0019's text is not edited, superseded or
   deleted.
2. The executed-bundle enforcement guarantee 0019 existed to bind is **live**, under
   `shipped-plugins.the-panels-consent-path-is-enforced-by-executing-the-bundle`, whose source
   is ADR 0035.
3. Its second law is likewise live under
   `shipped-plugins.the-questions-intent-and-answer-are-measured-hermetically` (ADR 0043).

Retirement is deliberately not attempted, and this is the measured reason rather than a
preference: `supersedes` requires the retired record to carry a terminal status, and 0019 cannot
be given one — it is in force through a human ratification, so editing its frontmatter reports
`RATIFICATION_STALE`, and an agent may not write a human ratification. `op: remove` has nothing
left to target, because a law can only be removed while the record declaring it is in force and
both of 0019's laws are already out of the bundle. Restating its content under a new law would
duplicate the two restatements that already carry it.

## Reasoning

The source this record cites — `docs/ratchet/sources/2026-09-19-adr-0019-governs-nothing.md`,
whose hash it pins — quotes the finding, records that 0019 declares two laws and sources zero,
and walks the three routes the review offered with the code each one fails on. The alternatives
were rejected on the record: editing 0019 spends a recorded human consent for no gain, since its
laws are already out of force; superseding it makes the gate red against a record nobody may
edit; deleting it is not a corpus mechanism and its consent is part of the history.

## Consequences

- The corpus carries an explicit statement that ADR 0019 is in force and governs nothing, so a
  reader is not left taking its title for the current enforcement binding.
- The state left behind is a record in force that contributes no law — the honest description.
  It is not a terminal status, because no ratified record can be given one and no command could
  check that it had been.
- The settlement takes force away from nothing and adds none, so it is a **proposal** until a
  human ratifies it; `ratchet verify` stays at 67 laws and 78 checks while it waits.
