---
id: "0085"
title: One judge is reused across corpus changes, and no compile runs a model
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-25T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-25-reuse-one-judge-and-unload-compile.md
  hash: sha256:c9ad283b87990a71474645ad7c762419dcc6ff57394af7e42fb435df99b00447
zones:
  - shipped-plugins
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.a-judge-is-reused-across-corpus-changes
    statement: One judge child serves every review a session's root agent runs, and a change to the compiled laws reaches that same child as material that supersedes what it was shown before, so a corpus edit does not create a second judge; only a delivery that fails or a changed judge role replaces the child.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: two reviews whose only difference is the law set both report the same child id, one creation, and the second carries the changed laws as superseding material
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.a-resident-read-is-not-a-death
    statement: A judge child is treated as alive while its session and descriptor are resumable, so a registry that does not currently hold it or a truncated answer neither kills the child nor forces a replacement; only a delivery that throws does.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a call whose registry read is absent, and a call whose answer stopped at max-tokens, both reuse the child instead of spawning a second one
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.only-a-root-caller-gets-a-judge
    statement: A review asked for by an agent that is not a live root of its session creates no judge child and is answered by the degraded self-review path, so the number of judges a session holds follows the law sets it reviews and not the number of agents that call the tool.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a review executed by a non-root agent reports the prompt back and spawns nothing
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.a-compile-runs-no-model
    statement: ratchet_compile returns the deterministic verdict together with the fact that no corpus review has read the law set now in force, and it spawns no judge; measuring meaning is an explicit ratchet_review, so the advised half of the ratchet is off the hot path of every compile.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a compile on a corpus no review has read completes with no judge spawned and reports the staleness, and the review tool remains the only path that spawns one
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.the-compile-pipeline-reads-the-corpus-once
    statement: A compile derives the law bundle once and hands it to its own drafting pass rather than compiling the corpus a second time inside the same call.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the drafting pass is driven with the already compiled bundle and reports the same drafts as when it compiles for itself
        timeoutMs: 300000
---

## Context

A read-only review of the mechanism (`docs/reviews/ratchet-mechanism-review.md`) found that
the judge pool had never worked as intended in production, and that the cheap guardrail was
not the part running on every compile.

`ratchet-judge.mjs` reuses its child only while the new prompt starts with the prefix stored
on the first call. For a review that prefix is `renderStableContext`, which carries the spec
hash and the law count, so every accepted or ratified decision invalidated the judge it was
reviewing. One session was measured creating two continuable judge children two hours apart,
with five `docs/adrs` commits between them.

The same file treated a registry read that did not currently hold the child as a death. The
installed harness defines a continuable child as a durable Session with a disposable Agent:
the live Agent is torn down after every turn and the next `sendMessage` cold-resumes it. A
`max-tokens` answer was likewise recorded as a dead child.

`ratchet_compile` ran four passes of the compile pipeline and two synchronous judge turns per
call — `compile`, the drafting pass's own compile, one `contextFor` per review job, and a
recompile after the review — to produce an advisory result that never changes the verdict.

## Decision

1. The judge is keyed on its role, not on the corpus. A changed material is delivered in full
   to the same child with a supersede instruction; only a failed delivery or a changed role
   key replaces the child.
2. A non-resident child is never a dead child. The pool awaits its materialization briefly,
   treats `max-tokens` and `refusal` as properties of one answer, and replaces a child only
   when a delivery throws.
3. Only a live root caller gets a judge. A subagent's `ratchet_review` takes the degraded
   self-review path and reports the prompt to its parent, because the harness authorizes a
   message only between a parent and its own direct child and there is no reuse-by-role API.
4. `ratchet_compile` spawns no judge. It returns the static verdict and the
   `contradictionReview.stale` fact; meaning is measured by an explicit `ratchet_review`.
5. `draftNeedsHuman` accepts the bundle the compile already derived instead of compiling the
   corpus again.

## Reasoning

The cited source carries the measurements: the two judge children and the commits between
them, the 1,419,748 tokens the second child spent over thirteen turns, the 104,260-byte static
prefix of a 105,749-byte review prompt, the four compiles one `ratchet_compile` performed, and
the harness citations that define continuable as a durable session rather than a resident
agent.

The trade in decision 4 is deliberate and is the point of the record. The automatic review was
added so that a stale law set could not go unread, and the cost of that guarantee was two
model turns inside every compile. The staleness is a fact the ratchet already computes and
already reports from `status`, so moving the judgement to an explicit call keeps the fact
visible and removes the toll. A model verdict was never allowed to change the compile verdict,
so nothing that gates behaviour is lost.

## Consequences

- A reused judge's context spans law sets. The supersede instruction is what makes the new
  material authoritative, and a test asserts the second call carries the changed laws to the
  same child.
- `ratchet_compile` no longer clears the staleness fact, so `ratchet_status` keeps reporting
  that no review has read the current laws until one is run. That is the intended reading of
  the fact, not a regression.
- A subagent's review is answered by the prompt rather than a verdict; the caller submits it or
  reports it to its parent. This is a visible behaviour change for subagents that reviewed
  directly.
- The rules text `rules/AGENTS.md` describes the automatic review and is corrected in the same
  change, because a rule that outlives the behaviour it describes is the defect this corpus
  exists to prevent.
