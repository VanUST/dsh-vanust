---
id: "0013"
title: Ratify ADR 0012
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-14T13:26:18.755Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-14-ratification-0012.md
  hash: sha256:92fc488867ae7acef93eccfbb369e7bab87a0ae7efe03e7aa573ee381551a1eb
zones: []
laws: []
supersedes: []
approves:
  - "0012"
ratification:
  channel: user-question
  at: '2026-09-14T13:26:18.755Z'
  askedBy: session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0012"
      contentHash: sha256:eb339ef10aab288a158dfbd0438e6c98ea6fe22dca76622b72d734a511d629bd
---

## Context

- ADR 0012 — A green gate means the corpus is current, complete, and inside its declared authority (docs/adrs/0012-a-green-gate-means-a-current-corpus.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, through the harness user-questions channel, whether this record should enter force,
and selected **Approve** for it. ADR 0012 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.specs-cannot-drift-silently` — A generated spec document that no longer matches the decision it was compiled from, or that is missing while the project tracks generated specs, is reported by verify, and so is a compile that persists a bundle without regenerating the document, so a green verify cannot coexist with a stale human-readable view of the laws. (docs/adrs/0012-a-green-gate-means-a-current-corpus.adr.md)
- `shipped-plugins.laws-cannot-leave-force-silently` — A law that was in force and is no longer compiled is reported unless an active record removes it by id, so a constraint cannot be deleted without a decision that names it. (docs/adrs/0012-a-green-gate-means-a-current-corpus.adr.md)
- `shipped-plugins.laws-stay-inside-their-declared-authority` — A record's law whose positive check paths fall outside the union of the zones that record declares is refused, because declaring a less restricted zone must not grant authority over a path the manifest reserves. (docs/adrs/0012-a-green-gate-means-a-current-corpus.adr.md)
- `shipped-plugins.the-authority-table-cannot-be-relaxed-silently` — The manifest's zone table decides which paths a human reserves, so a change to a reservation is visible to the gate rather than silent, and the deployment-rules zone still declares humanOnly authority. (docs/adrs/0012-a-green-gate-means-a-current-corpus.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-14-ratification-0012.md instead of trusted.

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
