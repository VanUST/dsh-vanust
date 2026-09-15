---
id: "0042"
title: Ratify ADR 0035
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-15T18:13:44.717Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-ratification-0035.md
  hash: sha256:456e3d9f7a38053c5eb8859adee2f195d284cd5909a18e89966445f35025ebd3
zones: []
laws: []
supersedes: []
approves:
  - "0035"
ratification:
  channel: adr-panel
  at: '2026-09-15T18:13:44.717Z'
  askedBy: adr-panel session-085005b8-f069-4b9d-95d0-500096178360
  targets:
    - id: "0035"
      contentHash: sha256:4728a1732edc4767c9ed5ef8e88c170a1fe677d38b8f4ee2766213bc2494e82c
---

## Context

- ADR 0035 — A consent travels a channel it records, and the panel window is a surface of the one consent operation (docs/adrs/0035-a-consent-travels-a-channel-it-records.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0035 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.a-consent-travels-a-channel-it-records` — A ratification question reaches the human through one of the ratchet's closed vocabulary of channels, carrying the record's own text, and its answer is derived from a selected label rather than interpreted; the approval and its transcript both record the channel that actually carried it, so a consent obtained in a Session names user-question and one obtained in the panel's decision window names adr-panel. (docs/adrs/0035-a-consent-travels-a-channel-it-records.adr.md)
- `shipped-plugins.the-panel-window-is-a-surface-of-one-consent-operation` — The panel's decision window is a second SURFACE for the ratchet's single consent operation and never a second consent path: the route builds no question and interprets no answer, both halves call the ratchet's own ratify operation, and an answer mints only when the human selects the approve label of the question the ratchet built for the records waiting at that moment. (docs/adrs/0035-a-consent-travels-a-channel-it-records.adr.md)
- `shipped-plugins.the-panels-consent-path-is-enforced-by-executing-the-bundle` — The panel's consent path is enforced by executing the shipped browser bundle against a stub host for the panel's own route — requiring a row's Approve and Decline to ask the route for the ratchet's own question, to render it with the record's own text and both of its labels, to post back the label it was shown paired with that same question, to show the outcome, to report a refusal rather than a false success, to fall back to the command with no capability, and to compose no composer message in any scenario. (docs/adrs/0035-a-consent-travels-a-channel-it-records.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-15-ratification-0035.md instead of trusted.

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
