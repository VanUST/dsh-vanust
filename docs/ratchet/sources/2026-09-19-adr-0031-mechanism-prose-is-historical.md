# ADR 0031's mechanism prose is historical

## The finding

The 2026-09-18 corpus review (`review_corpus`, recorded in
`reports/ratchet/dynamic-review.json` against spec hash
`sha256:83962d2e1bb79254fc3740dfb95afca8879a2808aea622f4f3a7438deff8ec55`) raised this as
its one **error** finding, kind `prose_law_mismatch`:

> ADR 0031's decision text, still active through its law
> `lifecycle.a-resolution-answers-to-the-removal-authority`, states a resolution "removes the
> losing laws, supersedes the losing record, and names both sides in a `resolves: [id, id]`
> list" — a conjunctive form. ADR 0045's in-force law
> `lifecycle.a-resolution-takes-force-away-in-exactly-one-of-two-ways` states the opposite
> mechanism requirement, "in exactly ONE of two ways … a record that asks for both is refused
> as `RESOLUTION_AMBIGUOUS`", and ADR 0045 explicitly says its restatement exists because "the
> old statement got [it] wrong". Two active records therefore carry contradictory statements of
> the same rule. ADR 0031 is not retired because its authority law is still in force; only its
> mechanism prose is dead.

## What is now true, measured

Read from the corpus on 2026-09-19, with `compileLaws(resolveActiveSet(readAdrCorpus(…)))` over
this project's own manifest — the same computation `ratchet compile` reports:

| record | in force | laws it declares | laws it sources in the bundle |
| --- | --- | --- | --- |
| 0031 | yes (ratified by 0053) | 4 | 3 |
| 0045 | yes (ratified by 0046) | 1 | 1 |

0031's four declarations are `lifecycle.a-resolution-answers-to-the-removal-authority`,
`lifecycle.a-resolution-is-an-ordinary-record-with-a-resolves-list`,
`lifecycle.a-standing-block-lifts-when-the-challenged-law-leaves-force` and
`lifecycle.a-retired-record-says-so`. The second of those — the one that stated the conjunctive
mechanism — is **not** in the bundle: ADR 0045 removed it. The other three are, and they are
the rules the corpus needs (who may take force away, when a standing block lifts, and that a
retired record says so).

So the corpus is already correct in law and wrong only in prose: a reader who opens 0031 finds
its **Decision** section stating the mechanism its own amendment forbids, and its Consequences
section measuring that the two halves cannot both be honoured. Nothing in force enforces that
prose, and nothing can — but a reader following the files is misled, which is the state
`lifecycle.a-retired-record-says-so` exists to prevent one record over.

## The settlement

A resolution naming both sides, `resolves: [0031, 0045]`, whose text records that:

1. 0045's law is the binding statement of how a resolution takes force away;
2. 0031's mechanism prose — the Decision section's conjunctive sentence and the law it used to
   be attached to — is **historical**, retained only because a ratified record may not be
   edited; and
3. 0031's three surviving laws remain in force and are unaffected by this settlement.

## Why no law changes

The first question is whether this finding needs a law change at all.

- The law that stated the wrong mechanism was **already removed** by ADR 0045, a ratified
  amendment. Removing it again would be `LAW_TARGET_DANGLING`.
- 0031's remaining laws are correct and in force. Removing them would take away the
  removal-authority rule the rest of the lifecycle rests on.
- Superseding 0031 would do the same thing wholesale.
- Re-declaring the removed law id with corrected text would put a **68th** law in force and
  re-state a rule 0045 already states under `lifecycle.a-resolution-takes-force-away-in-exactly-one-of-two-ways`
  — a duplicate, which `check-duplicate-decisions.mjs` exists to refuse.

There is therefore nothing left to legislate. What was missing was a record saying which of the
two texts is live, and a `resolves` list naming the pair so the corpus can audit the settlement.
This record is that.

## What was rejected

- **Edit 0031's Decision section.** 0031 is in force through a human ratification (0053), and
  editing it reports `RATIFICATION_STALE` and drops its three laws out of force. The consent
  guarantee is the mechanism this corpus rests on; it is not to be spent on a sentence.
- **Supersede 0031.** It would take three laws out of force to correct prose about a law that
  has already left. The cure is larger than the disease.
- **Leave the finding open.** The review graded it `error`, which is its strongest severity
  short of a blocking contradiction, and the review's own reasoning says two active records
  carry contradictory statements of one rule. An unrecorded settlement is how the next reviewer
  re-finds it.
- **A `status: active` record.** Nothing here is the author's to activate: the pair it names
  includes law a human ratified, so it is a proposal until a human says otherwise.

## What this record does not do

It does not edit 0031, does not remove or re-declare any law, and does not enter force by
itself. It adds no law, so `ratchet verify` stays at 67 laws and 78 checks while it waits, and
`ratchet pending` lists it among the decisions waiting for a human.
