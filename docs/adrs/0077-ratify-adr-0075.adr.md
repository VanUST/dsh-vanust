---
id: "0077"
title: Ratify ADR 0075
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-21T15:28:40.609Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-21-ratification-0075.md
  hash: sha256:d7faf9d774aea05cb503dba2da2d0494b330c65310462c28134ee51f2d2518aa
zones: []
laws: []
supersedes: []
approves:
  - "0075"
ratification:
  channel: adr-panel
  at: '2026-09-21T15:28:40.609Z'
  askedBy: adr-panel session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0075"
      contentHash: sha256:26022e7e8a7029511080585e452f64d15490fe5cafbf7d0fd7ee6c5c4c7049a2
---

## Context

- ADR 0075 — The three calls the critic's findings force (docs/adrs/0075-the-critic-findings.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly), kit-tooling (activeIfNoConflict)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0075 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.the-removal-authority-is-the-strongest-declarer` — When two records declare one law id and statement, the merged law carries the strongest authority either declarer had, so a human ratification is not diluted by an unratified twin and the authority to retire a law does not depend on ADR file order. (docs/adrs/0075-the-critic-findings.adr.md)
- `kit-tooling.a-contradiction-blocks-only-the-paths-the-law-claims` — A judged contradiction refuses a write only where the contradicted law's own path claim reaches — the paths of its path-scoped checks, or its whole zone when it declares none — so a block never stops work its finding says nothing about. (docs/adrs/0075-the-critic-findings.adr.md)
- `kit-tooling.the-delegation-cap-is-measured-without-a-clock` — The delegation cap's evidence is reproducible, awaiting the harness's own release edge rather than a fixed sleep, so the suite measures the mechanism and not the scheduler. (docs/adrs/0075-the-critic-findings.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-21-ratification-0075.md instead of trusted.

Each approved record is bound to the hash it had when the question was asked, so this approval covers that text and
not a later revision of it. An approval that named only a title would keep
approving whatever the file said next, which is how a decision gets substituted
past the person who read it. The text itself is not copied here: it is the record,
committed beside this approval, and the hash is what makes a substitution visible
rather than silent.

Project: dsh-kit

## Consequences

- Editing any ratified record voids this approval: the compiler reports `RATIFICATION_STALE` and the law leaves force until it is ratified again.
- The law set changed, so the spec bundle must be recompiled and the code re-verified before anything is called checked.
- This approval confers force only. The ratified records keep their own author authority, so a ratified agent record still cannot govern a zone reserved to humans.
