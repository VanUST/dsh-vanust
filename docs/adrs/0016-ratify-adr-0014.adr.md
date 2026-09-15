---
id: "0016"
title: Ratify ADR 0014
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-15T11:34:24.418Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-ratification-0014.md
  hash: sha256:ec6c5ebcc8d0d648ddcbe541dce392d1ae2507e20e92b4092be2df0b9f2ab7df
zones: []
laws: []
supersedes: []
approves:
  - "0014"
ratification:
  channel: user-question
  at: '2026-09-15T11:34:24.418Z'
  askedBy: session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0014"
      contentHash: sha256:307b2c2011e0666528e85986444c0dee55913091cc5f23aaea574c0864c4dbc3
---

## Context

- ADR 0014 — The ADR panel ratifies through the ratchet's own question, never as a second consent path (docs/adrs/0014-the-panel-ratifies-through-the-question-channel.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly), kit-tooling (activeIfNoConflict)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, through the harness user-questions channel, whether this record should enter force,
and selected **Approve** for it. ADR 0014 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.the-panel-offers-consent-only-through-the-question-channel` — The ADR panel's ratify action puts the ratchet's own question to the human through the harness user-questions seam and produces an approval only when the human selects the approve label, so the overlay is an entry to the one consent channel and never a second one. (docs/adrs/0014-the-panel-ratifies-through-the-question-channel.adr.md)
- `shipped-plugins.the-panel-records-no-consent-of-its-own` — The panel writes no approval record and sets no authorship field, so no path from the overlay turns a record into law without the ratchet's question having been asked and answered. (docs/adrs/0014-the-panel-ratifies-through-the-question-channel.adr.md)
- `shipped-plugins.the-question-seam-is-measured-from-the-panel-host` — Whether the panel's host half can reach the Agent-scoped user-questions seam, or needs an agent-side companion, is measured and recorded before the UI is trusted, because the seam is scoped to an agent and the panel is a web-client plugin. (docs/adrs/0014-the-panel-ratifies-through-the-question-channel.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-15-ratification-0014.md instead of trusted.

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
