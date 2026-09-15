# A judge's contradiction blocks, and the agent that proposed the change is told why

Date: 2026-09-15. Operator requirement, stated directly:

> If judge semantically evaluated a change being contradicting - it should be prohibited or asked to
> be changed. Its the blocking mechanism that guarantees no drift in code logic itself and it should
> be true. ratchet agent sees contradictions - replies coding agent with reasoning and declines.

Scope: `plugins/ratchet/ratchet-contradiction.mjs` (new),
`plugins/ratchet/ratchet-guard.mjs`, `plugins/ratchet/ratchet-ops.mjs`, `plugins/ratchet/ratchet-tools.mjs`.

This file is the reasoning behind ADR 0024.

## What the code did instead

`ratchet_review` spawned an independent judge, validated its verdict, wrote a report, and returned
`advisory: true, gate: false`. Its own comment said so: *"`ok` describes the JUDGE's verdict, never a
gate."* The dynamic layer could report `semantic_violation` with a law id — a change that satisfies
every written check and inverts what the decision was for — and nothing anywhere refused the work.
ADR 0017 had already admitted this as a limit in as many words: the guard caught the *decidable*
contradictions because it runs before every write and asks no model, and everything else was
"refused to the review judge", where it stayed advice.

So the guarantee the operator is asking for — no drift in the logic itself — rested on a report
nobody was obliged to read.

## The four decisions in the mechanism

**1. A contradiction is a recorded FACT, and only three kinds of finding create one.** A finding
blocks when its severity is `error`, its kind is `semantic_violation` or `intent_violation`, and it
names a law. The vocabulary is closed and deliberately narrow. `incompatible_checks` and
`incoherent_corpus` describe the CORPUS disagreeing with itself — a question for a human, not
something the agent that triggered the review fixes by editing its change. `prose_law_mismatch` is
one record's prose against its own laws. `insufficient_reasoning` asks for more reasoning. Treating
any of those as a block would refuse work nobody has shown to be wrong, which is how a gate earns
being switched off.

**2. The block is enforced by the write guard, first, and is NOT gated on the zone rule.** A zone's
`requiresDecisionRecord` is opt-in per zone; a judge reporting that a change contradicts a decision
is the price of enabling the ratchet at all. So the contradiction is checked before the guard can
answer "inert", and it is resolved through the same `zoneFor` the zone rule uses, so a path outside
the zone table cannot dodge it.

**3. It clears by itself, because a block with no route out is a defect.** The finding is bound to
what the judge read: a proposed record's content hash, or — when the material is a change with no
record behind it — the material itself. Editing the proposal moves the hash and retires the finding;
an independent clean verdict on the same material retires it too. This is the property the
mechanical tier already has, and ADR 0017 rejected stored conflicts precisely for lacking it.

**4. A self-review may raise a block but may never clear one.** An agent that could lift its own
block by submitting the verdict it wrote itself would have a gate it controls, which is the same
distinction the consent model draws between a human's answer and one a caller composed. A
self-review that names no material still DECLINES — the finding is reported — but records nothing,
because a block on material nobody named is a block nobody can clear.

## Why the cache key had to change too

The decision-state cache was keyed on the manifest and the decisions directory. The contradiction
record lives outside both, so a freshly recorded block would not have been visible until something
unrelated changed the corpus — a block that works only after an unrelated edit is not a block. The
key now carries that file's signature as well.

## What is still true, and what is not

The judge is a model, so a false positive refuses work that is not actually wrong. That is the price
of the requirement, and the mitigations are structural rather than promised: the blocking vocabulary
is narrow, the denial carries the judge's own reasoning and suggestion so the agent can judge the
judgement, editing the judged artifact lifts the block without anyone's permission, and both routes
out are named in the refusal. A human can always decide the question instead.

The block is a written state file (`.dsh/ratchet/contradiction.json`). An agent that edits it by
hand hides the question rather than settling it — the same honest limit the kit already records for
a hand-written approval, and for the same reason: nothing in a file-based mechanism can tell who
wrote a file.
