---
id: "0084"
title: Ratify ADR 0083
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-25T09:59:49.398Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-25-ratification-0083.md
  hash: sha256:172a577b0808c29e34f0f41ee57f59b34e1dc9e3028c9c36bf45770ab166101a
zones: []
laws: []
supersedes: []
approves:
  - "0083"
ratification:
  channel: adr-panel
  at: '2026-09-25T09:59:49.398Z'
  askedBy: adr-panel session-9384c7a3-7c53-4c9f-8993-70544b55cfe9
  targets:
    - id: "0083"
      contentHash: sha256:16020e8388497ebebf60c5a542e0eb4a18832c74c7c47a4f4c46fc88909ac090
---

## Context

- ADR 0083 — Deduplicate the rules prompt without losing a rule (docs/adrs/0083-deduplicating-the-rules-prompt.adr.md)
  - status: proposed; author authority: agent
  - zones: deployment-rules (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0083 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The ratified record declares no law, so nothing the verifier checks changes.

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-25-ratification-0083.md instead of trusted.

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
