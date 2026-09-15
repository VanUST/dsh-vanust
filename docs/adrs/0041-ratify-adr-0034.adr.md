---
id: "0041"
title: Ratify ADR 0034
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-15T18:13:43.644Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-ratification-0034.md
  hash: sha256:94865c392b7231acadf0bf870d253a17bc3f35ff1d7b04e4db6d7cf6d3f69e24
zones: []
laws: []
supersedes: []
approves:
  - "0034"
ratification:
  channel: adr-panel
  at: '2026-09-15T18:13:43.644Z'
  askedBy: adr-panel session-085005b8-f069-4b9d-95d0-500096178360
  targets:
    - id: "0034"
      contentHash: sha256:872771143ffad9fa15e940249c6a33f1812efc9fc7541028bf311f052a65aac5
---

## Context

- ADR 0034 — The panel records a consent through its own host route, with no chat message (docs/adrs/0034-the-panel-records-through-a-host-route.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly), kit-tooling (activeIfNoConflict)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0034 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.the-panel-records-consent-without-a-chat-message` — The ADR panel's Approve and Decline record the human's decision through the panel's own host route, so the click produces the consent with no composer message, no model turn and no agent in the loop, and what the row sends is the label the ratchet itself put on the question it built, paired with that same question. (docs/adrs/0034-the-panel-records-through-a-host-route.adr.md)
- `shipped-plugins.the-consent-route-is-not-a-second-consent-path` — The ADR panel's consent route builds no question and interprets no answer, it calls the ratchet's own ratify operation for both halves, and that operation writes an approval only for the approve label of a question it built for the records waiting now, refusing a hand-composed payload with no quiz, a quiz it did not build, an answer about a record edited since the question was asked, a replayed quiz and a record its zones do not let a consent put into force. (docs/adrs/0034-the-panel-records-through-a-host-route.adr.md)
- `shipped-plugins.a-consent-names-the-surface-that-carried-it` — A ratification records, in its approval and its transcript, the channel that actually carried the question to the human, so a consent obtained through the harness user-questions seam records user-question and one obtained through the ADR panel's decision window records adr-panel, and both values are in the ratchet's closed channel vocabulary and in the panel's copy of it. (docs/adrs/0034-the-panel-records-through-a-host-route.adr.md)
- `shipped-plugins.the-consent-route-is-unreachable-by-an-agent` — No tool, CLI verb or command argument exposes the consent route, and every request to it must pass the harness browser trust fence and carry a capability minted per plugin activation, held in memory and delivered only through the index document this process served, so the token is written to no file and to no log and nothing an agent can call obtains it. (docs/adrs/0034-the-panel-records-through-a-host-route.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-15-ratification-0034.md instead of trusted.

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
