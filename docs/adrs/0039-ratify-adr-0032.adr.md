---
id: "0039"
title: Ratify ADR 0032
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-15T18:13:42.223Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-ratification-0032.md
  hash: sha256:9419764b0f0462dfcc4c203aebebe1dbbb53f1bfdbcd355e7089e5263a61ba89
zones: []
laws: []
supersedes: []
approves:
  - "0032"
ratification:
  channel: adr-panel
  at: '2026-09-15T18:13:42.223Z'
  askedBy: adr-panel session-085005b8-f069-4b9d-95d0-500096178360
  targets:
    - id: "0032"
      contentHash: sha256:4b88cfaf18e9759042af26cc5f7fd3b6b68c4731a30cda080c36f6111ca844c8
---

## Context

- ADR 0032 — Duplicate decisions are refused where they can be decided, reported where they cannot (docs/adrs/0032-duplicate-decisions.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0032 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `duplicates.identical-statements-under-different-ids-are-refused` — Two active records that declare the same law statement under different law ids are refused, because the corpus then holds one constraint twice and neither record owns it. (docs/adrs/0032-duplicate-decisions.adr.md)
- `duplicates.one-source-cited-by-two-records-is-reported` — Two decision records citing the same source is reported, because it means one document was ingested twice and the second record is a restatement rather than a decision. (docs/adrs/0032-duplicate-decisions.adr.md)
- `duplicates.a-redeclared-law-with-an-identical-statement-merges` — A law declared by two records with an identical statement is not a duplicate and not a conflict, and governs the union of the zones both records named. (docs/adrs/0032-duplicate-decisions.adr.md)
- `duplicates.only-a-judge-sees-is-reported-and-never-gates` — A duplicate that only a judge can see — the same decision restated in different words — is reported as an advisory finding the agent must work through, and never fails the build, because a model verdict must not become a build gate. (docs/adrs/0032-duplicate-decisions.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-15-ratification-0032.md instead of trusted.

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
