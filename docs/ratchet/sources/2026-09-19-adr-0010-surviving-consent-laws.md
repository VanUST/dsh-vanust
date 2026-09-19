# ADR 0010's surviving consent laws, and the one that moved

## The finding

The 2026-09-18 corpus review raised this as a **warning**, kind `deprecated_decision`:

> ADR 0010's prose says "The four consent laws are restated with behavioural enforcement points
> ... The same four laws, in the same zone, are enforced by commands", naming
> `shipped-plugins.consent-is-hash-bound` and `shipped-plugins.unenforced-laws-are-reported`,
> plus `shipped-plugins.consent-travels-the-human-channel`. Only the first two are declared by
> ADR 0010 in the in-force set; `consent-travels-the-human-channel` is described by ADR 0034 as
> in force and by ADR 0035 as removed and restated, but no law in force carries it. The record
> no longer decides what it claims to decide, so keeping it as written is misleading.

## What is now true, measured

Read from the corpus on 2026-09-19 through the same `readAdrCorpus` → `resolveActiveSet` →
`compileLaws` path `ratchet compile` uses:

ADR 0010 is **in force** (ratified by approval 0011) and it declares four laws, of which
**three** are in the bundle with 0010 as their source:

```
shipped-plugins.consent-is-hash-bound
shipped-plugins.no-shell-mint
shipped-plugins.unenforced-laws-are-reported
```

The fourth, `shipped-plugins.consent-travels-the-human-channel`, is **not** in the bundle. ADR
0035 — ratified by approval 0049 — removed it and restated the same guarantee under
`shipped-plugins.a-consent-travels-a-channel-it-records`, which requires the consent to record
**which** channel carried it (`user-question` for a Session, `adr-panel` for the panel window)
rather than naming one channel as the only one. That restatement was itself replaced: ADR 0043
(ratified by 0048) removed `a-consent-travels-a-channel-it-records` and restated it as
`shipped-plugins.a-consent-question-carries-the-record-and-records-its-channel`, which is the
law in force today. The chain is 0007 → 0010 → 0035 → 0043, and only the last link holds.

The review's own count is one law short of the measurement: it named two of 0010's laws as in
force and did not mention `shipped-plugins.no-shell-mint`, which 0010 declares and which is in
force with 0010 as its source. The review's conclusion is unaffected — the record still claims
four where three survive — but the settlement below states the measured three.

## The settlement

A resolution naming both sides, `resolves: [0010, 0035]`, recording that:

1. ADR 0010's restatement is closed: the three laws named above are in force, in
   `shipped-plugins`, with behavioural enforcement points, exactly as 0010 intended;
2. the fourth law left 0010 when 0035 removed it, and the rule it carried now lives under
   `shipped-plugins.a-consent-question-carries-the-record-and-records-its-channel` (ADR 0043),
   so 0010's sentence "the same four laws, in the same zone" describes the corpus as it stood
   before 0035 and not as it stands now; and
3. nothing in ADR 0010 is edited, removed or re-declared.

## Why no law changes

The first question is whether this finding needs a law change at all.

- 0010's three surviving laws are in force, are enforced, and their statements are not in
  dispute. Removing or re-declaring them would change a law set the finding says nothing is
  wrong with.
- The one law that is gone left through ADR 0035's own `op: remove`, a ratified amendment. An
  `op: remove` of it here would be `LAW_TARGET_DANGLING`, because a law can only be removed
  while the record declaring it is in force and the bundle no longer holds it.
- 0035's replacement law already carries the corrected rule — twice restated, the surviving
  form being ADR 0043's. Re-declaring any link of that chain would be the duplicate
  `check-duplicate-decisions.mjs` refuses.

So the record that settles this is a record that *says* what is true. Its `resolves` list makes
the pair auditable; its prose is what a reader needs and no command can supply.

## What was rejected

- **Edit 0010's Decision section to name three laws.** 0010 is in force through a human
  ratification (0011); editing it reports `RATIFICATION_STALE` and takes its three laws out of
  force. Trading three working laws for a corrected sentence is the wrong direction.
- **Retire 0010 entirely.** Its three laws are in force and load-bearing — hash-bound consent,
  no shell mint, and unenforced laws being reported. Retiring the record would retire them.
- **Leave the warning unrecorded.** The review is the only instrument that reads the corpus for
  meaning, it has already been run, and an advisory finding with no record that answers it is
  re-reported by the next review — the same finding, one cycle later.

## What this record does not do

It does not edit ADR 0010 or ADR 0035, does not remove or re-declare any law, and enters force
only if a human ratifies it. It adds no law, so the gate stays at 67 laws and 78 checks while it
waits.
