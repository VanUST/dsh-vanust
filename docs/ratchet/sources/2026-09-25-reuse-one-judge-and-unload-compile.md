# Reuse one judge, and keep the model off the compile path

Reasoning source for ADR 0085. It records what was measured, why the judge pool failed to
reuse in production, and which of the review's proposals were taken and which were left.

## The two defects

### The judge pool recreates the child whenever the corpus moves

`plugins/ratchet/ratchet-judge.mjs` keeps one continuable child per calling parent and
reuses it only while the new prompt starts with the prefix stored on the first call
(`ratchet-judge.mjs:346-351`). For a review job that prefix is everything before
`\n# Question`, which is `renderStableContext`, and that text carries the project's law
count and spec hash (`ratchet-dynamic.mjs:313-314`). Every accepted, edited, ratified or
removed decision changes the hash, so the prefix changes and the child is destroyed.

The ratchet's whole purpose is to change the corpus, so the sequence judge → change →
judge recreates the judge every time. The behaviour is pinned by
`scripts/test-ratchet.mjs:1714` ("a changed static prefix recreates the judge rather than
serving stale orientation").

Measured on one root session, two continuable judge children were created hours apart:

```
1789995736220  (2026-09-21T13:02:16Z)  judge child f1d2dee8…
1790005671028  (2026-09-21T15:47:51Z)  judge child 6747bdc0…
```

and five commits touched `docs/adrs` between them (`71c6327`, `4e53787`, `0311749`,
`3bf0baa` plus the ratify of 0075/0076). The second child then served thirteen turns and
consumed 1,419,748 tokens; the first served two turns and 178,654.

### Non-residency is read as death

The same file marks the child dead when the agent registry does not currently hold it
(`ratchet-judge.mjs:250-253`), and again on a `max-tokens` or `refusal` stop reason
(`:274-276`). The installed harness defines a continuable child as a durable Session with a
disposable Agent:

- `dsh-subagent/lib/types/index.d.ts:118-131` — an absent direct child is cold-resumed from
  persistence by `sendMessage`.
- `dsh-subagent/lib/types/continuation.js:254-255` — absence is a handled branch, not an
  error.
- `dsh-subagent/lib/types/continuation-activation.js:559-567`, `:624` — the live Agent is
  disposed after every turn, and removed from the registry.

So `agents.get(childId) === undefined` is the normal between-turns state, and a single
`max-tokens` answer permanently poisons the pool entry. The durable notion of alive is
"the session and descriptor are resumable", which is exactly what `sendMessage` already
establishes.

### The pool is one judge per caller, not one judge per session

The registry is a `WeakMap` keyed by the calling Agent (`ratchet-judge.mjs:191-192`). The
automatic review is guarded to root callers (`ratchet-tools.mjs:489-498`, `:615-616`), but
`ratchet_review` reaches `judgeSpawner(exec)` directly (`ratchet-tools.mjs:916`), so every
subagent that reviews creates another judge. The harness offers no reuse-by-role API
(`dsh-subagent/lib/types/types.d.ts:176-191`).

## The compile path pays for advice nobody asked for

`ratchet_compile` calls `compile()` and then `reviewWhenRequired()`. Counted against the
source:

1. `compile()` runs `compileProject` and then `draftNeedsHuman(root, { write: true })`
   (`ratchet-ops.mjs:567`), which runs `compileProject` again and re-reads the corpus.
2. `reviewWhenRequired` runs `review_corpus` → `contextFor(root)` → `compileProject`
   (`ratchet-ops.mjs:1136`).
3. and `review_duplicates` → `contextFor(root)` → `compileProject` again.
4. and finally `rechecked = await compile({ root })` (`ratchet-tools.mjs:642`), which runs
   the whole prefix once more.

Four compiles and two synchronous judge turns per tool call, for an advisory result that
never changes the compile verdict. The deterministic guardrail — the cached write guard and
`verify` — is the part that actually refuses something, and it is not the part on the hot
path.

Measured size of the material each judge turn reads: `review --job review_corpus --root .`
renders 105,749 bytes, of which the static prefix is 104,260 (98.6%); all four jobs the CLI
can build share that same 104,260-byte prefix. The material is every law in force.

## What this record decides

1. **The judge is keyed on its role, not on the corpus.** A changed material is delivered in
   full to the SAME child with an explicit supersede instruction; the child is recreated only
   when it is genuinely gone or the caller changes the role key. Reuse no longer depends on a
   hash the work is about to change.
2. **Only a failed send is a death.** A non-resident child is awaited briefly and then sent
   to; `max-tokens` and `refusal` are recorded on the answer, not on the child.
3. **Only a root caller gets a judge.** A subagent's review takes the degraded self-review
   path and reports the prompt back to its parent, so the count is corpus states rather than
   callers × corpus states.
4. **`ratchet_compile` runs no model.** It returns the static verdict and the
   `contradictionReview.stale` fact; the meaning review is an explicit `ratchet_review`. This
   is the deliberate trade the review named: automatic detection was the reason the pass was
   added, and it is also the reason every compile blocks on two model turns. The staleness
   fact stays reported by `status`, `compile` and the decisions view, so "nobody looked" is
   visible rather than silent.
5. **The compile pipeline reads the corpus once.** `draftNeedsHuman` accepts the already
   compiled bundle instead of compiling again, and the post-review recompile disappears with
   the review.

## Alternatives considered and rejected

- **One-shot spawn per job with structured output.** Cheaper per call and would give a real
  output schema, but it is the behaviour the user reported as a defect (a new child per
  call), it loses the durable session, and it does not remove the per-call model cost.
- **Recreate on corpus change but keep the pool.** This is the current behaviour and is
  exactly what is wrong: it pays the full orientation again at the moment the agent is
  mid-task, which is the moment it is most valuable.
- **Cap the number of judge children instead of keying on the role.** A cap reports the
  problem rather than fixing it, and leaves the first judge serving stale material.
- **Keep the automatic review and only make it cheaper.** Making the pass asynchronous would
  still spend the two turns per compile; the review's proposal to take it off the hot path
  is the one that matches "guardrail, not toll booth".

## What is not decided here

- Scoping the judge's material to the laws a change touches, and merging the overlapping
  ingest tools. Both are real costs (the 11 ratchet tools are 15,918 of the 45,314 bytes of
  tool schema) but neither is needed to make the judge persistent or to empty the compile
  hot path, and both are larger diffs.
- Whether the harness's compaction is mounted for continuable children. If it is, the reused
  judge's history is bounded automatically; if it is not, the reused child grows and that is a
  separate decision.

## Consequences

- A judge child now survives a corpus change, so its context spans law sets. The supersede
  instruction is what makes that safe; a test asserts the changed material reaches the same
  child and that no second child is created.
- `ratchet_compile` no longer clears the staleness fact. `ratchet_status` and the decisions
  view keep reporting it until a review is run, which is the intended reading of "nobody has
  judged these laws yet".
- The subagent path for `ratchet_review` returns the prompt instead of an answer. A subagent
  that needs a review reports the prompt to its parent; the parent's judge answers it.
