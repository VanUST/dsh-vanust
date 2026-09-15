---
id: "0025"
title: Ratify ADR 0024
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-15T13:27:36.383Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-ratification-0024.md
  hash: sha256:ba91fbdac6b4dcd0fe0aba479062f8457c688b2dc8aa1f434cea9df2b7631a32
zones: []
laws: []
supersedes: []
approves:
  - "0024"
ratification:
  channel: user-question
  at: '2026-09-15T13:27:36.383Z'
  askedBy: session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0024"
      contentHash: sha256:554120d6472fc3e38c14d7e05cb46ce493ef30372898abeca12de0bdccb05d67
---

## Context

- ADR 0024 — A judge's semantic contradiction is a gate, not advice (docs/adrs/0024-a-judged-contradiction-blocks-the-change.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, through the harness user-questions channel, whether this record should enter force,
and selected **Approve** for it. ADR 0024 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.a-judged-contradiction-declines-the-change` — A review finding that a change contradicts a decision in force in meaning — severity error, kind semantic_violation or intent_violation, naming a law — is recorded as a fact and DECLINES the review, so the agent that proposed the change is told why and the work is refused rather than annotated; every other finding a judge may make stays advice. (docs/adrs/0024-a-judged-contradiction-blocks-the-change.adr.md)
- `shipped-plugins.a-judged-contradiction-blocks-writes-regardless-of-the-zone-rule` — The judged-contradiction block is enforced by the write guard before the inert answer and before requiresDecisionRecord, because a zone's record rule is opt-in per zone while a judge reporting that a change contradicts a decision is the price of enabling the ratchet at all; it is resolved through the same zone matcher the zone rule uses. (docs/adrs/0024-a-judged-contradiction-blocks-the-change.adr.md)
- `shipped-plugins.a-self-review-may-raise-a-block-and-never-clear-one` — A self-submitted verdict may record a contradiction it sees in the caller's own work, but only an independent judge's clean verdict, or an edit that moves the content hash the finding was bound to, retires a recorded block; a self-review that names no material declines without recording anything, because a block on material nobody named is a block nobody can clear. (docs/adrs/0024-a-judged-contradiction-blocks-the-change.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-15-ratification-0024.md instead of trusted.

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
