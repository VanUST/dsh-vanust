---
id: "0078"
title: Ratify ADR 0076
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-21T15:28:54.770Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-21-ratification-0076.md
  hash: sha256:1c90f6cebcd71c6a873b5281d2b46c0210a9c7fdb3249bcabe7a650fd9c934c0
zones: []
laws: []
supersedes: []
approves:
  - "0076"
ratification:
  channel: adr-panel
  at: '2026-09-21T15:28:54.770Z'
  askedBy: adr-panel session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0076"
      contentHash: sha256:1777e539f714c1f4d7b9db8e1ee2a3870171fec424746c2798c25b0a5da656ba
---

## Context

- ADR 0076 — Two unenforced notes that name a mechanism the code does not contain (docs/adrs/0076-two-notes-that-name-an-absent-mechanism.adr.md)
  - status: proposed; author authority: agent
  - zones: (unzoned) (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0076 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.the-panel-bundle-writes-no-consent-of-its-own` — The panel writes no approval record and sets no authorship field, so no path from the overlay turns a record into law without the ratchet's question having been asked and answered. (docs/adrs/0076-two-notes-that-name-an-absent-mechanism.adr.md)
- `shipped-plugins.the-question-seam-reach-is-recorded` — Whether the panel's host half can reach the Agent-scoped user-questions seam, or needs an agent-side companion, is measured and recorded before the UI is trusted, because the seam is scoped to an agent and the panel is a web-client plugin. (docs/adrs/0076-two-notes-that-name-an-absent-mechanism.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-21-ratification-0076.md instead of trusted.

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
