---
id: "0093"
title: Ratify ADR 0092
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-30T13:27:23.565Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-30-ratification-0092.md
  hash: sha256:4fd7fa50f89989619a78d1fa92d7b82bb8f008976e7cba889832f3a50eec18c6
zones: []
laws: []
supersedes: []
approves:
  - "0092"
ratification:
  channel: user-question
  at: '2026-09-30T13:27:23.565Z'
  askedBy: session-9384c7a3-7c53-4c9f-8993-70544b55cfe9
  targets:
    - id: "0092"
      contentHash: sha256:4b6bd215ee2901817a295c0a7942ba0559f58ce75489c58b8d706a797e2b6e0c
---

## Context

- ADR 0092 — The ingestion-ratify law is bound to the tests that drive its three fail-closed states (docs/adrs/0092-bind-the-ingestion-ratify-law.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly), kit-tooling (activeIfNoConflict)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, through the harness user-questions channel, whether this record should enter force,
and selected **Approve** for it. ADR 0092 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The law brought into force:

- `shipped-plugins.ingestion-ratifies-only-what-it-wrote-and-proves-it` — Ingestion puts a decision to the human only after it has written it, and reports rather than mints when the record was not written, no question channel is available, or the answer cannot be read. (docs/adrs/0092-bind-the-ingestion-ratify-law.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-30-ratification-0092.md instead of trusted.

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
