---
id: "0086"
title: Ratify ADR 0085
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-25T10:21:39.697Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-25-ratification-0085.md
  hash: sha256:399772f46c1af4341b88939b3e7d3ef837abe42918c434be94bcb10d951a45de
zones: []
laws: []
supersedes: []
approves:
  - "0085"
ratification:
  channel: adr-panel
  at: '2026-09-25T10:21:39.697Z'
  askedBy: adr-panel session-9384c7a3-7c53-4c9f-8993-70544b55cfe9
  targets:
    - id: "0085"
      contentHash: sha256:d6a9de84910a043020d88c2fc767d4fd14918898f967679b36f4dab29c16a559
---

## Context

- ADR 0085 — One judge is reused across corpus changes, and no compile runs a model (docs/adrs/0085-one-judge-reused-and-no-model-in-compile.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly), kit-tooling (activeIfNoConflict)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0085 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.a-judge-is-reused-across-corpus-changes` — One judge child serves every review a session's root agent runs, and a change to the compiled laws reaches that same child as material that supersedes what it was shown before, so a corpus edit does not create a second judge; only a delivery that fails or a changed judge role replaces the child. (docs/adrs/0085-one-judge-reused-and-no-model-in-compile.adr.md)
- `shipped-plugins.a-resident-read-is-not-a-death` — A judge child is treated as alive while its session and descriptor are resumable, so a registry that does not currently hold it or a truncated answer neither kills the child nor forces a replacement; only a delivery that throws does. (docs/adrs/0085-one-judge-reused-and-no-model-in-compile.adr.md)
- `shipped-plugins.only-a-root-caller-gets-a-judge` — A review asked for by an agent that is not a live root of its session creates no judge child and is answered by the degraded self-review path, so the number of judges a session holds follows the law sets it reviews and not the number of agents that call the tool. (docs/adrs/0085-one-judge-reused-and-no-model-in-compile.adr.md)
- `shipped-plugins.a-compile-runs-no-model` — ratchet_compile returns the deterministic verdict together with the fact that no corpus review has read the law set now in force, and it spawns no judge; measuring meaning is an explicit ratchet_review, so the advised half of the ratchet is off the hot path of every compile. (docs/adrs/0085-one-judge-reused-and-no-model-in-compile.adr.md)
- `shipped-plugins.the-compile-pipeline-reads-the-corpus-once` — A compile derives the law bundle once and hands it to its own drafting pass rather than compiling the corpus a second time inside the same call. (docs/adrs/0085-one-judge-reused-and-no-model-in-compile.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-25-ratification-0085.md instead of trusted.

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
