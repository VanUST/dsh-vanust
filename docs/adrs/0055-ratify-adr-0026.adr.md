---
id: "0055"
title: Ratify ADR 0026
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-16T06:33:59.899Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-16-ratification-0026.md
  hash: sha256:3364d40051d3c5d7d6b976e18e3678313aca648878025b308926dfd1696e5d87
zones: []
laws: []
supersedes: []
approves:
  - "0026"
ratification:
  channel: user-question
  at: '2026-09-16T06:33:59.899Z'
  askedBy: session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0026"
      contentHash: sha256:021fc7c0a0bd748ae0e4d2cc0c37dbef0491e2b96315ab5f4b5d9048358a51cb
---

## Context

- ADR 0026 — Every path the ratchet writes comes from the manifest, not from a default in the code (docs/adrs/0026-the-generated-spec-goes-where-the-manifest-says.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, through the harness user-questions channel, whether this record should enter force,
and selected **Approve** for it. ADR 0026 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The law brought into force:

- `shipped-plugins.a-generated-artifact-goes-where-the-manifest-says` — Every path the ratchet writes or reads for its own records, generated specs, reports and state is resolved from the manifest, so a project that declares any of those directories gets its artifacts there and a reader that resolves the manifest cannot disagree with a writer that does not; a path field the manifest accepts is either honoured or refused, never accepted and ignored. (docs/adrs/0026-the-generated-spec-goes-where-the-manifest-says.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-16-ratification-0026.md instead of trusted.

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
