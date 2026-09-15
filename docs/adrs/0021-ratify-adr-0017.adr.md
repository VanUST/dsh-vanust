---
id: "0021"
title: Ratify ADR 0017
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-15T12:51:39.355Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-ratification-0017.md
  hash: sha256:376c3a4b926b647918e322a0c7102cd9462835c7e5dd65a069e9bee32bfd9d8d
zones: []
laws: []
supersedes: []
approves:
  - "0017"
ratification:
  channel: user-question
  at: '2026-09-15T12:51:39.355Z'
  askedBy: session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0017"
      contentHash: sha256:76e3efc95d6cb28740193b9b004801cba894f1e1fa26e84022378be7ac39858d
---

## Context

- ADR 0017 — An agent's proposal licenses the work and never becomes law by itself (docs/adrs/0017-agent-proposals-are-not-blocking.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, through the harness user-questions channel, whether this record should enter force,
and selected **Approve** for it. ADR 0017 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.a-proposed-decision-licenses-the-work` — A PROPOSED decision that names a zone satisfies that zone's requiresDecisionRecord, so an agent may write the work it describes before a human decides, while the proposal itself adds no law, no check and no generated spec — only decisions in force compile. (docs/adrs/0017-agent-proposals-are-not-blocking.adr.md)
- `shipped-plugins.a-proposal-never-licenses-a-human-only-zone` — A proposed record never satisfies requiresDecisionRecord in a zone whose agentAuthority is humanOnly, because the compiler refuses an agent-authored record there even when a human ratifies it, so a proposal that licensed the write would let an agent govern a zone the manifest reserved to humans. (docs/adrs/0017-agent-proposals-are-not-blocking.adr.md)
- `shipped-plugins.a-contradiction-with-law-in-force-stops-the-work` — A proposed decision that removes a law in force, or redeclares one under a different statement, refuses writes into the zones it names — including zones a decision in force already covers — and the refusal is recomputed from the corpus on every write, so editing the proposal lifts it with no other action; only the decidable form of a contradiction is caught here and the rest is refused to the review judge with that limit stated. (docs/adrs/0017-agent-proposals-are-not-blocking.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-15-ratification-0017.md instead of trusted.

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
