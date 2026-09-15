---
id: "0023"
title: Ratify ADR 0019
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-15T12:51:42.264Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-ratification-0019.md
  hash: sha256:b4dcbe4a662a81a703c7119eb2f30d170cb17ad37a932d8592af024e4fa71a17
zones: []
laws: []
supersedes: []
approves:
  - "0019"
ratification:
  channel: user-question
  at: '2026-09-15T12:51:42.264Z'
  askedBy: session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0019"
      contentHash: sha256:6639bd0ef427ad94993aba6f39b7f4359bcf4fa30f9a42e28e248f62657ad933
---

## Context

- ADR 0019 — The panel's consent laws are enforced by executing the bundle, and the seam by the probe (docs/adrs/0019-the-panels-consent-laws-are-enforced-behaviourally.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, through the harness user-questions channel, whether this record should enter force,
and selected **Approve** for it. ADR 0019 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.the-panels-consent-laws-are-enforced-by-executing-the-bundle` — The panel's consent laws — that it offers consent only through the ratchet's own question and records none of its own — are enforced by executing the shipped browser bundle and driving the real slot core, requiring the claim to be elected for the ratchet's real question while a claim at the default priority loses, the Conversation seat to render nothing the question owns in text, in a displayed attribute or behind any handler that can settle the question, the window's clicks to send exactly the batch the ratchet reads back as an approval or a rejection, and the whole render to call nothing but the file surface's two reads. (docs/adrs/0019-the-panels-consent-laws-are-enforced-behaviourally.adr.md)
- `shipped-plugins.the-question-seam-is-measured-by-the-probe` — The ratification question's path to a human is measured end to end against a live profile rather than assumed — the question reaches a real human channel with the live root agent, its presentation intent survives the wire, the answers are derived from the labels, an unreadable answer is re-asked in a different shape, and the approval puts the decision into force — because the panel presenting that question is only trustworthy if the thing being presented is. (docs/adrs/0019-the-panels-consent-laws-are-enforced-behaviourally.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-15-ratification-0019.md instead of trusted.

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
