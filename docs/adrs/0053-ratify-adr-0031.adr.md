---
id: "0053"
title: Ratify ADR 0031
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-16T06:33:57.384Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-16-ratification-0031.md
  hash: sha256:6527c6e536e25f63561246e357598708eb75c9a9123d787db3132de0fc505217
zones: []
laws: []
supersedes: []
approves:
  - "0031"
ratification:
  channel: user-question
  at: '2026-09-16T06:33:57.384Z'
  askedBy: session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0031"
      contentHash: sha256:c4acf1d2478f3ad5bb6763f59348d67a5377b041a9b14edb23b9dade21868737
---

## Context

- ADR 0031 — A decision is resolved, retired and merged under the authority of a removal (docs/adrs/0031-a-decision-is-resolved-under-the-removal-authority.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, through the harness user-questions channel, whether this record should enter force,
and selected **Approve** for it. ADR 0031 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `lifecycle.a-resolution-answers-to-the-removal-authority` — A resolution, retirement or merge that takes away a law's force answers to exactly the same authority as an explicit removal, so an agent-authored record may do it only where the zones let an agent hold force, and a law whose force came from a human ratification stays in force until a human ratifies the record that removes it. (docs/adrs/0031-a-decision-is-resolved-under-the-removal-authority.adr.md)
- `lifecycle.a-resolution-is-an-ordinary-record-with-a-resolves-list` — A resolution is an ordinary decision record that removes the losing laws, supersedes the losing record and names both sides in a `resolves` list, so the corpus can audit which conflict was settled and by what. (docs/adrs/0031-a-decision-is-resolved-under-the-removal-authority.adr.md)
- `lifecycle.a-standing-block-lifts-when-the-challenged-law-leaves-force` — A contradiction stops blocking writes once its findings no longer name a law in force, so a ratified resolution lifts the block without any separate clearing gesture and no resolved conflict is ever cleared by hand-editing a cache. (docs/adrs/0031-a-decision-is-resolved-under-the-removal-authority.adr.md)
- `lifecycle.a-retired-record-says-so` — A record that is retired says so in its own frontmatter, so a reader is never left following a decision whose laws no longer hold, and the retirement is visible without running the compiler. (docs/adrs/0031-a-decision-is-resolved-under-the-removal-authority.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-16-ratification-0031.md instead of trusted.

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
