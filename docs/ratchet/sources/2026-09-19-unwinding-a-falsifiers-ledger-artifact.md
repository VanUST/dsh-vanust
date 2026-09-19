# Unwinding a falsifier's ledger artifact

`scripts/falsify-kit-gate.mjs` is the release-gate breaker: it breaks one kit
invariant at a time, runs the real `ratchet verify`, requires the gate to fail,
and restores the file it broke. Its case `law-with-no-check-and-no-reason`
injects a law into an active record and expects `LAW_UNCHECKED`.

**The run is not self-restoring, and the gap is not cosmetic.** The `verify` the
case performs succeeds at its own job — it compiles a corpus that now contains one
extra law — and because no law was *removed*, the run records the law set it
observed:

```
{"event":"ratchet.verify.finish","at":"2026-09-19T11:04:13.807Z","ok":false,"errors":1,
 "checksEvaluated":78,"filesWalked":262,"lawIds":[ ... 68 ids, including
 "kit-tooling.falsified-unchecked" ...]}
```

The case then restores the ADR, so the compiled set falls back to 67 laws —
while `readRecordedLawIds` (`ratchet-state.mjs`) walks the append-only ledger
backwards for the most recent entry that carries a `lawIds` array, and finds the
68-law set. `lawRemovalProblems` (`ratchet-ops.mjs`) therefore reports, on every
subsequent run:

```
LAW_REMOVED_WITHOUT_DECISION [kit-tooling.falsified-unchecked]
  law "kit-tooling.falsified-unchecked" was in force and is no longer compiled, and no
  active record removes it; ... retire it with an explicit "op: remove" or restore it
```

The run does not self-heal, and it is deliberately built that way:
`persistVerify` writes `lawIds` only when `removalProblems.length === 0`, so a run
that reports the removal records no set of its own and the next run reads the same
stale entry again. `check-gate-invariants.mjs` asserts exactly this
(`still-reported-next-run`), because a run that certified the shrunken set would
launder a deletion one command later.

**And the remedy the message names is refused.** The injected law is declared by no
active record, and `compileLaws` refuses a removal of a law nobody declares:

```
LAW_TARGET_DANGLING: <record> removes law "kit-tooling.falsified-unchecked", which no
active ADR declares
```

So the documented recovery — the script's own OUTPUTS section says "Re-run
`ratchet verify` after a falsification run to leave the tree verified" — does not
work, and the two remedies the problem text offers cannot both be taken: the ADR
cannot be restored (the injection was into a ratified record's file, and editing a
ratified record voids its consent), and the removal cannot be declared.

## The two decisions this record records

1. **The breaker must restore every artifact its own mutations induce, not only the
   file it edited.** `falsify-kit-gate.mjs` now snapshots
   `.dsh/ratchet/ledger.jsonl` before each case and writes those bytes back in the
   `finally` (and on `SIGINT`/`SIGTERM`, like the file restores already there). The
   ledger is the project's append-only history; a law set a *synthetic* corpus
   induced is not part of that history, and leaving it there is what made the
   breaker a one-way door. Its OUTPUTS section is corrected in the same change.

2. **The current poisoned ledger is unwound by a decision, not by editing
   state.** One record declares the injected id, and a second retires it with an
   explicit `op: remove`. Two records rather than one because the schema refuses a
   single record that names the same law id twice — `LAW_DUPLICATE`, "law id
   `kit-tooling.falsified-unchecked` appears twice in this ADR" — which is the
   right refusal: one record cannot both assert a law and deny it. With the
   declaration in force, the removal is no longer `LAW_TARGET_DANGLING`, the law
   leaves the compiled set through `removedByDecision`, and the next run records
   the 67 laws the corpus really has. That is the honest shape: decisions about
   force taken in the open, rather than a line deleted from a machine-written
   file.

   Both records stay in the corpus. Deleting them would leave the ledger's
   removal of `kit-tooling.falsified-unchecked` explained by nothing, which is the
   same gap one level down; keeping them costs no law, because the declared id is
   retired before the bundle is built.

`LAW_TARGET_DANGLING` is not the defect here. It is what stops an agent from
retiring a law by writing a removal for something no record ever declared; the
defect is a breaker that wrote a law set no record could account for. The
enforcement points are unchanged, and the falsification of the fix is
`node scripts/falsify-kit-gate.mjs` leaving the tree verified afterwards — the
thing that was broken.
