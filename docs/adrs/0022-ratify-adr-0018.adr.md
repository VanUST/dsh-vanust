---
id: "0022"
title: Ratify ADR 0018
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-15T12:51:40.622Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-ratification-0018.md
  hash: sha256:ee228103d2841f22daf73b45eb36f254db0da24643cb2cf73190b72a3f3ddcca
zones: []
laws: []
supersedes: []
approves:
  - "0018"
ratification:
  channel: user-question
  at: '2026-09-15T12:51:40.622Z'
  askedBy: session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0018"
      contentHash: sha256:96a36a78ea9861da51ed3f8ea0e76c6712e1dffa3034661acc4e80c9c54156c0
---

## Context

- ADR 0018 — A question says where it is shown, and an agent's decision is answered in the panel (docs/adrs/0018-the-question-says-where-it-is-shown.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, through the harness user-questions channel, whether this record should enter force,
and selected **Approve** for it. ADR 0018 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.a-question-says-where-it-is-shown` — The ratchet's presentation intent is attached to a ratification question only when the caller asks for the panel, so a grilling session's question declares none and the harness's own card asks it in the Conversation; an unrecognised presentation is treated as the Conversation's, because a value that does not say panel is one no client may claim on the ratchet's behalf. (docs/adrs/0018-the-question-says-where-it-is-shown.adr.md)
- `shipped-plugins.an-agents-decision-is-never-a-chat-quiz` — The ADR panel claims the Conversation's composer seat for a ratification question in order to suppress the harness's card and renders a pointer there — the decision's name and a way into the panel — never the question, its record text or either answer label, which appear only in the decision window; the claim is a suppression and not the only route to the human, so with nothing claiming the seat the question is still asked and answerable in the Conversation. (docs/adrs/0018-the-question-says-where-it-is-shown.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-15-ratification-0018.md instead of trusted.

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
