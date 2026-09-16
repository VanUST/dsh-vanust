---
id: "0046"
title: Ratify ADR 0045
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-16T06:33:48.703Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-16-ratification-0045.md
  hash: sha256:ffee8b7af01c4de8cc415a6b01fad401d7134c7fc0a341a63f6859526b450ee4
zones: []
laws: []
supersedes: []
approves:
  - "0045"
ratification:
  channel: user-question
  at: '2026-09-16T06:33:48.703Z'
  askedBy: session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0045"
      contentHash: sha256:e31f6bb8f9188f763070063b99b5a6dae03cba3e11b4321039aeaed89a4dea03
---

## Context

- ADR 0045 — A resolution takes force away in exactly one of two ways (docs/adrs/0045-a-resolution-takes-force-away-one-way.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, through the harness user-questions channel, whether this record should enter force,
and selected **Approve** for it. ADR 0045 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The law brought into force:

- `lifecycle.a-resolution-takes-force-away-in-exactly-one-of-two-ways` — A resolution is an ordinary decision record that names both sides of the conflict it settles in a `resolves` list and takes away force in exactly ONE of two ways — `op: remove` for a named law while the record that declares it keeps governing, or `supersedes` for a whole record, which then carries a terminal status; a record that asks for both is refused as `RESOLUTION_AMBIGUOUS`, because supersession already takes every law the record declares out of force and a record emptied law by law is still in force. (docs/adrs/0045-a-resolution-takes-force-away-one-way.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-16-ratification-0045.md instead of trusted.

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
