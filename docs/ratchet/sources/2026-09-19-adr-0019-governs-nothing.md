# ADR 0019 governs nothing, and its function lives on under a later id

## The finding

The 2026-09-18 corpus review raised this as a **warning**, kind `deprecated_decision`:

> ADR 0019 states it "re-decides nothing and declares no law ADR 0014 already declares", and its
> stated function was binding two consent laws to executed-bundle commands. No law in the
> in-force set is attributed to 0019, and the executed-bundle surface its remaining content
> describes is now carried by ADR 0035's law
> `shipped-plugins.the-panels-consent-path-is-enforced-by-executing-the-bundle`, which is
> approved by 0049 rather than by 0019's approval. It therefore governs nothing while
> presenting itself as the enforcement binding.

## What is now true, measured

Read from the corpus on 2026-09-19 through `readAdrCorpus` → `resolveActiveSet` → `compileLaws`:

| record | in force | laws declared | laws sourced in the bundle |
| --- | --- | --- | --- |
| 0019 | yes (ratified by 0023) | 2 | **0** |
| 0035 | yes (ratified by 0049) | 3 | 1 |

0019's two declarations were:

- `shipped-plugins.the-panels-consent-laws-are-enforced-by-executing-the-bundle` — removed by
  ADR 0035 (ratified by 0049), which restated the same guarantee under
  `shipped-plugins.the-panels-consent-path-is-enforced-by-executing-the-bundle`;
- `shipped-plugins.the-question-seam-is-measured-by-the-probe` — removed by ADR 0043 (ratified
  by 0048) and restated under
  `shipped-plugins.the-questions-intent-and-answer-are-measured-hermetically`.

So 0019 is a record **in force that contributes no law**: it is listed among the active records,
it holds consent recorded by a human, and the bundle contains nothing it declares. Its title and
Decision section still read as the binding that puts the panel's consent laws under an execution
check — a job now done by two laws attributed to 0035 and 0043.

Both removals are ratified amendments, and each restated its rule under a new id rather than
editing 0019. That is exactly the shape a ratified record's amendment has to take; nothing is
wrong with either removal.

## The settlement

A resolution naming both sides, `resolves: [0019, 0035]`, recording that:

1. 0019 no longer governs anything: every law it declared has left the bundle through a ratified
   amendment, and the two laws that replaced them are in force with 0035 and 0043 as their
   sources;
2. the executed-bundle enforcement guarantee it existed to bind is therefore live, under
   `shipped-plugins.the-panels-consent-path-is-enforced-by-executing-the-bundle`; and
3. 0019's text is not edited, and nothing it declares is restored.

## Why this is a settlement and not a retirement

The review offered two routes: retire 0019 by a resolution naming it, or restate its still-true
content under a law that is in force. Retirement is not available, and this is the measured
reason rather than a preference:

- `supersedes` is the mechanism that retires a whole record. A record retired that way **must**
  carry a terminal status, because `validateRetirement` reports
  `RETIREMENT_STATUS_MISSING` for a superseded record whose upserts are all out of force and
  whose status is not `superseded`/`rejected`/`withdrawn`.
- 0019 cannot be given that status. It is in force through a human ratification (0023), so
  editing its frontmatter reports `RATIFICATION_STALE` — and an agent may not write a human
  ratification.
- There is nothing left for `op: remove` to do: a law can only be removed while the record
  declaring it is in force, and both of 0019's laws left the bundle already, so an explicit
  removal here reports `LAW_TARGET_DANGLING`.

Restating its content under a new law is equally unavailable: the content is *already* restated,
by 0035 and 0043, and a third declaration would be the duplicate `check-duplicate-decisions.mjs`
refuses — besides adding a 68th law to a bundle the settlement must leave at 67.

What remains is a record that says which of the two readings of 0019 is true, and a `resolves`
list naming the pair so the corpus can audit it. That is this record. The state it leaves behind
is "in force, governs nothing, and says so where a reader will find it" — which is the honest
description, and better than a terminal status no ratified record can be given and no command
can check.

## What was rejected

- **Edit 0019's status to `superseded`.** Voids the consent 0023 recorded, and 0019's two laws
  are already out of force, so the edit buys nothing and costs a recorded human consent.
- **Supersede 0019 with a proposed record anyway.** The compiler reports
  `RETIREMENT_STATUS_MISSING` against a ratified record nobody may edit, so the gate would be
  red with no legitimate way to clear it. A rule that cannot be satisfied is the shape ADR 0031's
  own consequences refuse.
- **Delete 0019.** Deletion is not a corpus mechanism. The record's consent is part of the
  history, and version control — not the working tree — is the archive.
- **Leave the warning unrecorded.** The review ran once, deliberately, and stays last. A finding
  with no record answering it is re-raised by the next review.

## What this record does not do

It does not edit, supersede or delete ADR 0019, does not remove or re-declare any law, and enters
force only if a human ratifies it. It adds no law, so `ratchet verify` stays at 67 laws and 78
checks while it waits, and `ratchet pending` lists it with the other decisions waiting for a
human.
