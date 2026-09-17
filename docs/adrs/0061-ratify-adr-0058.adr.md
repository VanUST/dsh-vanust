---
id: "0061"
title: Ratify ADR 0058
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-17T12:04:14.054Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-17-ratification-0058.md
  hash: sha256:de0d3e6ecdfee2a8734a4c4785f0c37b49a135a35c8f734a3a9c2e2f126935fb
zones: []
laws: []
supersedes: []
approves:
  - "0058"
ratification:
  channel: adr-panel
  at: '2026-09-17T12:04:14.054Z'
  askedBy: adr-panel session-8610654b-9341-413b-9b71-180f42875d6f
  targets:
    - id: "0058"
      contentHash: sha256:39b4d2aee9db1406332861690b37685e2ed94c9f14afb70d9a8eb3f31425ca12
---

## Context

- ADR 0058 — Claim discipline and the rule text join the deployment rules (docs/adrs/0058-rule-drills-and-test-quality.adr.md)
  - status: proposed; author authority: agent
  - zones: deployment-rules (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0058 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The law brought into force:

- `deployment-rules.claims-carry-evidence` — A completion claim names the command run in the current turn and the output it produced; a claim resting on an earlier command, or on no command at all, is provisional and says so. (docs/adrs/0058-rule-drills-and-test-quality.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-17-ratification-0058.md instead of trusted.

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
