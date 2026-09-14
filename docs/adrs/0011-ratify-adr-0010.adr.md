---
id: "0011"
title: Ratify ADR 0010
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-14T10:49:43.785Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-14-ratification-0010.md
  hash: sha256:6e072c8266a49e193b1732b0150df1077fdf8a3662a7a91d1e3aecf85d0b52e4
zones: []
laws: []
supersedes: []
approves:
  - "0010"
ratification:
  channel: user-question
  at: '2026-09-14T10:49:43.785Z'
  askedBy: session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0010"
      contentHash: sha256:524d6d0a0fd5c99071eecf09a5dac20bf51fa2111033c20bc2f2aa6801d9ef11
---

## Context

- ADR 0010 — The consent laws are enforced behaviourally, not by a test's name (docs/adrs/0010-enforce-the-consent-laws-behaviourally.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, through the harness user-questions channel, whether this record should enter force,
and selected **Approve** for it. ADR 0010 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.consent-is-hash-bound` — An approval puts a decision into force only while the decision still hashes to the text the approval recorded, so editing an approved record voids the consent instead of inheriting it. (docs/adrs/0010-enforce-the-consent-laws-behaviourally.adr.md)
- `shipped-plugins.consent-travels-the-human-channel` — A ratification question reaches the human through the harness user-questions channel carrying the record's own text, and its answer is derived from a selected label rather than interpreted. (docs/adrs/0010-enforce-the-consent-laws-behaviourally.adr.md)
- `shipped-plugins.no-shell-mint` — No shell command mints a consent and no tool argument accepts a caller-composed answer; the CLI can only report which decisions are waiting for a human, and it reports the ones it cannot ratify with the reason. (docs/adrs/0010-enforce-the-consent-laws-behaviourally.adr.md)
- `shipped-plugins.unenforced-laws-are-reported` — A law in force that declares no check and does not say why is reported as unenforced, because a rule with no enforcement point is an unverified claim. (docs/adrs/0010-enforce-the-consent-laws-behaviourally.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-14-ratification-0010.md instead of trusted.

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
