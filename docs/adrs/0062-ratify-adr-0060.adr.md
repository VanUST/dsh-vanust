---
id: "0062"
title: Ratify ADR 0060
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-17T12:04:16.512Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-17-ratification-0060.md
  hash: sha256:f50eb10c0df2d6c5cbe1bb9cdb073406650afccc0143d90c3aac3359bb5229db
zones: []
laws: []
supersedes: []
approves:
  - "0060"
ratification:
  channel: adr-panel
  at: '2026-09-17T12:04:16.512Z'
  askedBy: adr-panel session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0060"
      contentHash: sha256:d0812c109799426456197717006149acafd120b9c810dff202d12bd0dee66e74
---

## Context

- ADR 0060 — The rules zone requires a human ratification, not human authorship (docs/adrs/0060-the-rules-zone-requires-ratification.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0060 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The law brought into force:

- `shipped-plugins.the-authority-table-is-reported-and-ratifiable` — The manifest's zone table decides which paths a human reserves, so a change to a reservation is visible to the gate rather than silent; the deployment-rules zone requires a recorded human RATIFICATION rather than human authorship, because a consent is bound to the text a human was shown while authorship is not verifiable, and an agent proposal in that zone is offered to a human and cannot activate itself. (docs/adrs/0060-the-rules-zone-requires-ratification.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-17-ratification-0060.md instead of trusted.

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
