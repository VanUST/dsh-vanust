---
id: "0089"
title: Ratify ADR 0088
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-29T13:43:57.265Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-29-ratification-0088.md
  hash: sha256:a2eb67233c6361e92e55f1ffced5c5954dfbf1a35f8ebe686ec1956f6d58c69e
zones: []
laws: []
supersedes: []
approves:
  - "0088"
ratification:
  channel: adr-panel
  at: '2026-09-29T13:43:57.265Z'
  askedBy: adr-panel session-9384c7a3-7c53-4c9f-8993-70544b55cfe9
  targets:
    - id: "0088"
      contentHash: sha256:30231197a9411a7c86786699ed6c01a27b92f07e77fc8aba2732031ff2c0f69f
---

## Context

- ADR 0088 — A human decline removes the agent's proposal and tells the agent that proposed it (docs/adrs/0088-a-decline-removes-the-proposal-and-tells-its-author.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0088 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.a-decline-removes-an-agent-proposal` — A human decline of an agent-authored record that is still a proposal removes that record's file, and a removal that fails is reported rather than passed over, because a declined proposal that stays on disk is offered again as if nothing had been answered. (docs/adrs/0088-a-decline-removes-the-proposal-and-tells-its-author.adr.md)
- `shipped-plugins.a-decline-leaves-a-human-record-alone` — A decline never removes a human-authored record or a record that is not a proposal, and it records the reason it was left, because a person's own draft is theirs to keep and a decline that destroyed it would be the ratchet deciding for the human. (docs/adrs/0088-a-decline-removes-the-proposal-and-tells-its-author.adr.md)
- `shipped-plugins.a-decline-tells-the-producing-agent` — A decline is delivered to the Sessions the ratchet has seen working in that project, actively when such a Session is live and never as a failure of the consent when it is not, and the producing agent is asked for nothing. (docs/adrs/0088-a-decline-removes-the-proposal-and-tells-its-author.adr.md)
- `shipped-plugins.a-decline-is-a-reported-fact-not-a-problem` — The decisions a human declined are reported as a field of the ratchet's status and of the decisions view, and the refusal itself raises no problem code, because a refusal is a decision a human made rather than a defect in the project. Removing a record does change the tree, so a verification recorded before the decline is reported stale exactly as it would be after any other edit; that verdict is about the tree, not about the decline. (docs/adrs/0088-a-decline-removes-the-proposal-and-tells-its-author.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-29-ratification-0088.md instead of trusted.

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
