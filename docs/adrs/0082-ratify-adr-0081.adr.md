---
id: "0082"
title: Ratify ADR 0081
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-24T11:14:48.314Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-24-ratification-0081.md
  hash: sha256:99baa9cfa2184aebf00979e0e46838ac0376b6cc39951504aa7aadd824ba2de1
zones: []
laws: []
supersedes: []
approves:
  - "0081"
ratification:
  channel: adr-panel
  at: '2026-09-24T11:14:48.314Z'
  askedBy: adr-panel session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0081"
      contentHash: sha256:9f5626536eb8c3139edd8ecfb551ee3ba3a571d7d4522791206999be4ca542b4
---

## Context

- ADR 0081 — Gather the context a task needs before its first write (docs/adrs/0081-gather-context-before-the-first-write.adr.md)
  - status: proposed; author authority: agent
  - zones: deployment-rules (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0081 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The ratified record declares no law, so nothing the verifier checks changes.

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-24-ratification-0081.md instead of trusted.

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
