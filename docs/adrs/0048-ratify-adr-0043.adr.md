---
id: "0048"
title: Ratify ADR 0043
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-16T06:33:49.770Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-16-ratification-0043.md
  hash: sha256:1062f28c013ffd42235fdde3d01cd96393bea503015a46436359ef24d4f2fd6d
zones: []
laws: []
supersedes: []
approves:
  - "0043"
ratification:
  channel: user-question
  at: '2026-09-16T06:33:49.770Z'
  askedBy: session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0043"
      contentHash: sha256:7c0a9a776d32c8e17be5469a15530fb44775b6a2f6f0cd83f6d6fa0dc31b30f0
---

## Context

- ADR 0043 — A law's check must be hermetic, so the six probe-bound consent laws are restated against hermetic commands (docs/adrs/0043-a-laws-check-must-be-hermetic.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, through the harness user-questions channel, whether this record should enter force,
and selected **Approve** for it. ADR 0043 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.the-consent-service-is-not-a-second-consent-path` — The ratchet provides one consent service the panel's route reaches, whose operations build no question and interpret no answer — ask prepares the ratchet's own question about the decisions waiting now, and settle pairs a selected label with that same question and writes an approval only for its approve label — refusing a label with no quiz behind it, a quiz the ratchet did not build, an answer about a record edited since the question was asked, a replayed quiz, and a record whose zone does not let a consent put it into force. (docs/adrs/0043-a-laws-check-must-be-hermetic.adr.md)
- `shipped-plugins.a-consent-records-the-surface-that-carried-it` — A consent recorded through the service the panel's route reaches names, in its approval frontmatter and in its transcript, the channel that carried the question, and that channel value is one the ratchet's closed channel vocabulary and the panel's copy of it both hold; the value recorded is the route's own channel, not the harness seam's. (docs/adrs/0043-a-laws-check-must-be-hermetic.adr.md)
- `shipped-plugins.no-tool-surface-exposes-the-consent-route` — Nothing on the ratchet's registered tool surface names the consent route, its service, its header or its capability global, no tool argument accepts a caller-composed answer, the CLI has no mint verb and inventing its flags mints nothing, and the panel and its host agree on the route, the service, the header and the capability value. (docs/adrs/0043-a-laws-check-must-be-hermetic.adr.md)
- `shipped-plugins.a-consent-question-carries-the-record-and-records-its-channel` — A ratification question the ratchet prepares carries the record's own text and is answered by selecting one of the labels the question itself put on its options rather than by interpreting free text; a consent the ratchet records names in its approval and its transcript the channel that carried it, and the panel knows every channel a ratification can have been obtained through. (docs/adrs/0043-a-laws-check-must-be-hermetic.adr.md)
- `shipped-plugins.the-panel-window-drives-the-one-consent-operation` — The panel's decision window is a second surface for the ratchet's single consent operation and never a second consent path — a ratifiable row asks the host route for the ratchet's own question about that record, renders it with the record's own text and both of its own labels, and sends back the label it was shown paired with that same question, which the ratchet reads as an approval or a rejection; a decision the ratchet has no question for is reported and no answer is sent; with no capability the row names the CLI command and fetches nothing; and no panel ratification composes a composer message. (docs/adrs/0043-a-laws-check-must-be-hermetic.adr.md)
- `shipped-plugins.the-questions-intent-and-answer-are-measured-hermetically` — The ratification question's shape is measured rather than assumed by executing the shipped panel bundle and comparing it with the ratchet's own question — the panel matches the presentation intent the ratchet sends and gets no intent to claim for a grilling session, it claims the ratchet's re-ask shape, and the answer the ratchet reads is the label the question itself offered, with an approve click read as an approval and a decline click as a rejection. (docs/adrs/0043-a-laws-check-must-be-hermetic.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-16-ratification-0043.md instead of trusted.

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
