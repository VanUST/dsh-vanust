---
id: "0068"
title: Ratify ADR 0066
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-19T10:45:42.364Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-19-ratification-0066.md
  hash: sha256:1df4e7f326641e9b80a98106f7be11e7ee18954ddfd6ef279d54a13163b54042
zones: []
laws: []
supersedes: []
approves:
  - "0066"
ratification:
  channel: adr-panel
  at: '2026-09-19T10:45:42.364Z'
  askedBy: adr-panel session-085005b8-f069-4b9d-95d0-500096178360
  targets:
    - id: "0066"
      contentHash: sha256:d1e23abaecf614a744fc4df60dc38fcd4b171e10e3293536810cb5165d30915c
---

## Context

- ADR 0066 — ADR 0019 governs nothing, and its executed-bundle guarantee lives on under ADR 0035's law (docs/adrs/0066-adr-0019-governs-nothing.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0066 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The ratified record declares no law, so nothing the verifier checks changes.

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-19-ratification-0066.md instead of trusted.

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
