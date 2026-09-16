---
id: "0057"
title: Ratify ADR 0056
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-16T11:32:03.969Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-16-ratification-0056.md
  hash: sha256:5a525c707a8d9c0d72d7fcb7db2b2fe406dc76dac7afc8f5f34139c71d27cc80
zones: []
laws: []
supersedes: []
approves:
  - "0056"
ratification:
  channel: adr-panel
  at: '2026-09-16T11:32:03.969Z'
  askedBy: adr-panel session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0056"
      contentHash: sha256:2ed195efd4a8daa0bd28d8d622863182de95d1c7d9ec916dc32825bea80b11e1
---

## Context

- ADR 0056 — A stale generated spec is advisory with a drafted withdrawal note, while an edited, missing or orphaned one still blocks (docs/adrs/0056-a-stale-spec-is-advisory.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0056 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The law brought into force:

- `shipped-plugins.spec-stale-is-advisory-others-still-block` — A generated spec document that is unedited but was written from an older law set is reported as an advisory drift fact with the withdrawal note the RATCHET drafts for it, and does not enter the blocking problem list, so a regeneration is asked for rather than a green gate withheld; a document that was hand-edited after it was written, or is missing while the project tracks generated specs, or is orphaned because no decision in force generates it any more, is still reported as a blocking problem. (docs/adrs/0056-a-stale-spec-is-advisory.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-16-ratification-0056.md instead of trusted.

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
