---
id: "0047"
title: Ratify ADR 0044
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-16T06:33:49.314Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-16-ratification-0044.md
  hash: sha256:835d68662c4632307eee33f12218e89dcd04923da287e4dcb4c9b4426b334ef7
zones: []
laws: []
supersedes: []
approves:
  - "0044"
ratification:
  channel: user-question
  at: '2026-09-16T06:33:49.314Z'
  askedBy: session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0044"
      contentHash: sha256:07e5b5e81cbdad5db857a2ee16cb250f0a99c1c5e7e96a55c3cd6e0c07902a7c
---

## Context

- ADR 0044 — A law-bound finding must quote the law it judges (docs/adrs/0044-a-law-bound-finding-must-quote-the-law-it-judges.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, through the harness user-questions channel, whether this record should enter force,
and selected **Approve** for it. ADR 0044 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The law brought into force:

- `review.a-law-bound-finding-quotes-the-law-it-judges` — A judge's finding that names a law must quote that law as it is in force — its statement verbatim, or the hash of the law set the judge read — and the ratchet compares the quote against the compiled law before the finding is forwarded, so a quote that does not match the in-force law is reported unusable and blocks nothing, a law-bound finding that carries no quote at all is unusable, and a finding that names no law is unaffected. (docs/adrs/0044-a-law-bound-finding-must-quote-the-law-it-judges.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-16-ratification-0044.md instead of trusted.

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
