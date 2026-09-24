---
id: "0080"
title: Ratify ADR 0079
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-22T06:39:24.111Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-22-ratification-0079.md
  hash: sha256:83b6cdc7b411e03101467a243929b88aab520eef4607385067675bace032b5e4
zones: []
laws: []
supersedes: []
approves:
  - "0079"
ratification:
  channel: adr-panel
  at: '2026-09-22T06:39:24.111Z'
  askedBy: adr-panel session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0079"
      contentHash: sha256:29a87cc657b24f7f6921b18fb935926dd9c5805ab917d5474d673ff27d1ef46b
---

## Context

- ADR 0079 — ADR 0014 governs nothing, and its channel prose is historical (docs/adrs/0079-adr-0014-governs-nothing.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0079 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The ratified record declares no law, so nothing the verifier checks changes.

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-22-ratification-0079.md instead of trusted.

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
