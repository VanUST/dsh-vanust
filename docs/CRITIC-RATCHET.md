# Critic: where the ratchet's specs lie to a reader

A breaker run over the whole ratchet design (2026-09-21): five adversarial agents, one
per block of laws, plus a ranking pass. Each was told to falsify the **named claim** of
every law in its block and to return a reproducible counterexample — an input where the
statement is false, or where the enforcement passes while the invariant is broken. 76
laws were attacked; 46 were tried and could not be falsified; the rest are below.

This is a reading, not a contract. The artifacts win where they disagree. Nothing here
was fixed: a breaker's output is counterexamples, and the owner decides.

## What would mislead a reader ("lies")

1. **The delegation-cap suite is not reproducible, and was briefly a gate.**
   `kit-tooling.the-delegation-cap-and-modes-behave-as-stated` named
   `node --test scripts/test-work-modes.mjs`. Measured over five consecutive runs on one
   unchanged tree, **four exited 1 and one exited 0**, and the failing assertion
   alternates between the two that sit either side of the release race — *"a delegation
   whose run settled releases its slot"* (observed refused) and *"a run that is still
   live keeps its slot"* (observed admitted). The test admits a delegation, emits one
   start edge and waits a fixed 20 ms, so whether a settled run has been swept before the
   next call depends on the clock, and **the two assertions cannot both hold under either
   timing**. The law is now `unenforced` with that measurement recorded, because a gate
   whose colour is luck teaches people to re-run it. Reproduce:
   `for i in 1 2 3 4 5; do node --test scripts/test-work-modes.mjs >/dev/null 2>&1; echo $?; done`

2. **A consent records the wrong channel and every check still passes.**
   `shipped-plugins.a-consent-records-the-surface-that-carried-it` and
   `…a-consent-question-carries-the-record-and-records-its-channel`. `check-consent-surface.mjs`
   compares the written channel to `ratchetConsent.CONSENT_CHANNEL` — the same constant
   the service reads. **The oracle moves with the thing under test.** Set it to the
   harness seam's channel and the approval plus the transcript record `user-question` for
   a consent the panel delivered, with `consent surface ok` and exit 0.
   Repro: in a copy, `CONSENT_CHANNEL = 'user-question'`, then `node scripts/check-consent-surface.mjs`.

3. **An unratified agent record can retire a human-ratified law, depending on FILE ORDER.**
   `lifecycle.a-resolution-answers-to-the-removal-authority`. When one law id is declared
   by both a human-ratified agent record and an unratified one, the compiler unions their
   zones but keeps only the **first** declarer's `approvedBy`. Two corpora with identical
   meaning produce opposite verdicts: with the ratified declarer first, `LAW_REMOVE_UNAUTHORISED`
   and the law survives; with the unratified declarer first, `codes: []` and the law
   leaves force. A consent must not depend on which file happens to be numbered lower.

4. **A submitted review records a block the law says it does not.**
   `shipped-plugins.a-self-review-may-raise-a-block-and-never-clear-one`. `submitReview`
   computes `judgedSomething` and **never uses it**; the `if (record && blocking.length > 0)`
   block calls `recordContradiction` unconditionally, binding the finding to
   `review:<job>`. A self-review that names no material therefore records a block that
   will refuse writes — the opposite of the law's stated reason ("a block nobody can
   clear"), and the covering test asserts the code's behaviour, not the law's.

5. **A forged span is accepted and written.**
   `ingestion.a-batch-decision-cites-a-span-the-tool-locates-itself`. `quoteAppears`
   falls back to splitting the needle on sentence punctuation and requiring each ~12-char
   fragment to appear *anywhere*. A span assembled from two fragments that occur in
   different sentences — appearing nowhere as a whole — is reported
   `{ok:true, matched:'fragments'}` and the record is written. The docstring says the
   fallback "does NOT tolerate a MISSING phrase".

6. **A written batch decision carries no span at all.**
   Same law. The span lives only on the transient result; `renderAdr()` is called without
   it, so the `.adr.md` on disk contains no quote. The ADR promises a reader can check a
   record against the document; after the call there is nothing to check.

## True but nothing fails on it ("weak")

7. **`writes-are-atomic` has no check.** Its named enforcement is `node --test scripts/test-ratchet.mjs`,
   which has no test that touches `writeArtifact`, spies a temp-file-and-rename, or crashes
   a write. Replacing the atomic body with a plain `writeFileSync` leaves **391 pass / 0 fail,
   exit 0**. `grep -rn "writeArtifact|renameSync|\.tmp-" scripts/*.mjs` finds no assertion.
   A reader is told a truncated report cannot exist; the shipped writer can leave one.
8. **`tools-use-defineTool` scans one file of six.** `check-portability.mjs` reads
   `plugins/ratchet/ratchet-tools.mjs` only, so any other shipped plugin may register a
   raw tool definition and the intended check still prints `[PASS] tools:use-defineTool`.
9. **`a-judged-contradiction-blocks-writes…` over-blocks.** The guard denies a write in the
   contradicted law's declared **zone ids**, not its governed paths: a law targeting
   `src/org/alpha/**` refuses `src/org/beta/**` too when both are in one zone.
10. **`problems-carry-a-subject` has no test.** `grep -n "subject" scripts/test-ratchet.mjs`
    finds no assertion, and `problem()` validates nothing: `ADR_FILE_INVALID` is emitted
    with `subject: null` for the very filename a consumer would filter on.
11. **`the-question-seam-is-measured-from-the-panel-host` measures nothing from the panel host.**
    The API facts cite a plugin *tool body* reaching `ctx.userQuestions`, not the panel's
    host half — the fact the law gates UI-trust on.
12. **`the-panel-records-no-consent-of-its-own` names a mechanism the bundle does not have.**
    The note describes reading through `workspaceFiles.list`/`read`; the shipped
    `client.js` contains no `workspaceFiles` and reads through the host routes.
13. **`the-cap-seam-is-measured` is declared release-gate evidence that the release gate never runs.**
    `grep -c 'probe-work-modes' scripts/verify-upgrade.sh` → **0**.
14. **`every-command-has-an-implementation` checks the wrong field.** The test inspects
    `verification[].path`, not the file named in `verification[].command`; point the command
    at a nonexistent script and `test-ratchet`, `compile` and `check-portability` all stay green.
15. **`api-facts-are-runnable` asserts on source text, not behaviour.** Replacing the probe's
    exit with `process.exit(0)` while keeping the old line in a comment leaves the check green.
16. **`the-rules-reach-the-prompt…` matches a comment.** The empty-candidate-list check is an
    unanchored regex over YAML, so a non-empty discovery list plus a commented-out empty one passes.
17. **`rules-name-a-declared-command` skips exactly the case it exists for.** The test
    `continue`s when `enforcedBy` is null, so a rule with no enforcement point passes it.
18. **`verification-is-bound-to-the-code` is content-blind above 2 MB.** Two different 3 MiB
    files hash identically (`sha256:e5884cec…` both), while the check's own `expects` says the
    hash changes with content — so an above-cap same-size edit does not invalidate a verdict.
19. **`a-resolution-takes-force-away-in-exactly-one-of-two-ways` is narrower than its words.**
    `RESOLUTION_AMBIGUOUS` fires only when the removed law belongs to the record being
    superseded; a resolution that supersedes A and removes a law of B is accepted.
20. **`duplicates.identical-statements-under-different-ids-are-refused` ignores "active".**
    `findDuplicates` does not filter by status, so a corpus with **no law in force** is still
    refused as a duplicate.

## Survived (tried and not falsified)

46 laws were attacked without a counterexample, including the whole consent-route fence
(capability required, no tool exposing the route), the hash-bound ratification, the
atomic-write *mechanism* (no test observes it, but the mechanism holds), the manifest
path resolution for `decisionsDir`/`sourcesDir`/`specsDir`, the judged-contradiction
block's authority, and the ingestion refusal paths. That count is what turns "no findings"
into a measurement rather than a shrug.

## Method and its limits

Five breaker agents (Flash-class) over blocks of laws grouped by subsystem; each had to
carry the exact command and both the observed and expected result, had to work in a
`/tmp` copy for any mutation, and was forbidden to edit the repository. The two most
consequential findings (1 and 10) were re-verified by hand in the live checkout; the rest
are the agents' reproductions and have not been re-run. The whole-tree mutation the
repository was never subjected to is exactly what makes finding 1 credible: the gate went
red for real when that suite was bound, and was observed red before it was unbound.

## Resolution (2026-09-21)

Every finding above is fixed or explicitly accounted for. Each fix was preceded by a
reproduction of the finding on the unfixed tree and followed by a command that now passes;
the commands are named per finding. The whole-tree evidence is the release gate:

```
bash scripts/verify-upgrade.sh          -> GATE PASS
ratchet verify --root .                 -> OK, 76 laws, 85 checks declared, 85 evaluated, 0 pending
node --test scripts/test-ratchet.mjs    -> 398 pass, 0 fail
node --test scripts/test-ratchet-guard.mjs -> 41 pass, 0 fail
node --test scripts/test-work-modes.mjs -> 26 pass, 0 fail, exit 0 on 8/8 consecutive runs
node scripts/check-portability.mjs      -> 22/22
```

| # | Finding | Fix and its evidence |
|---|---|---|
| 1 | work-modes suite not reproducible | The test no longer sleeps: the release is driven by the run's terminal edge and the guard warm-up runs on its own session, so `staleAfterMs` stays at the production default and no assertion depends on a clock. `node --test scripts/test-work-modes.mjs` exits 0 on 8/8 consecutive runs over one unchanged tree. |
| 2 | consent channel check used its own subject as oracle | The expectation is now derived from the surface the check drove and from an independently observed harness-seam channel, and a `key=value` line prints both. With `CONSENT_CHANNEL` mutated to a wrong value the check now exits 1 naming `expected=adr-panel observed=user-question`; untouched, it exits 0. |
| 3 | removal authority depended on file order | `compileLaws` gives the merged law the strongest authority any declarer had. `compileLaws` is driven with both orderings and asserts `approvedBy` survives and `LAW_REMOVE_UNAUTHORISED` fires either way. |
| 4 | a self-review that named nothing still recorded a block | `submitReview` gates `recordContradiction` on `judgedSomething`, which it computed and never read. The covering test asserted the code's behaviour and is corrected to the law: declined, gate, no block recorded. |
| 5 | a forged span was accepted | The fragment fallback is removed. A span stitched from two different sentences now fails; a real span, including one wrapping a line break, still passes. |
| 6 | a written record carried no span | `renderAdr` takes a `span` and emits a `## Source span` section; the batch path passes the located span through. The rendered record still parses clean. |
| 7 | `writes-are-atomic` had no test | A test asserts the destination inode MOVES (only a rename does that) and that a failed rename leaves no temp sibling. |
| 8 | `tools-use-defineTool` scanned one file of six | `check-portability.mjs` discovers every shipped plugin source file; a raw registration in a different plugin now fails the check naming `file:line`. |
| 9 | a contradiction blocked its whole zone | `blockedScopes` narrows a block to the paths the contradicted law's own checks claim; whole zone when it claims none. A guard test shows a write to the claimed subtree denied and a write beside it allowed. |
| 10 | `problems-carry-a-subject` had no test and emitted `subject: null` | `ADR_FILE_INVALID` now carries the filename, and a test drives a spread of malformed records asserting no problem is subjectless. |
| 11 | the question-seam law named a measurement that is not of the panel host | Amendment ADR 0076 retires the law and restates it with the measurement that exists, the wiring that answers the question, and the half still unenforced. |
| 12 | the panel-no-consent note named a mechanism the bundle lacks | Amendment ADR 0076 retires the law and restates it with the bundle's actual data paths. |
| 13 | the cap-seam was declared release-gate evidence the gate never ran | `verify-upgrade.sh` runs `probe-work-modes.mjs` as a labelled step; the gate output shows `[ok ] the delegation cap is measured against the installed harness`. |
| 14 | `every-command-has-an-implementation` checked the wrong field | The test now also extracts the script from each `verification[].command` and asserts it exists. |
| 15 | `api-facts-are-runnable` asserted source text | The probe exposes an exit-rule selftest that pushes three hand-known fixtures through the same function the real run ends with; the test spawns it and asserts the printed mapping. |
| 16 | the rules-reach-the-prompt check matched a comment | The check isolates the loader row, drops comments and anchors each candidate key to its own line; a fixture with non-empty lists plus commented-out empties now fails. |
| 17 | `rules-name-a-declared-command` skipped the null case | The test no longer `continue`s on a missing `enforcedBy`; it reports it. The manifest has none. |
| 18 | the code hash was content-blind above its cap | The check no longer asserts the hole: it asserts content coverage within budget, that the cap is not read past, and that an above-cap EDIT still moves the hash — which the production marker now guarantees by including the file's mtime, so a recorded verdict is invalidated by an edit. |
| 19 | `RESOLUTION_AMBIGUOUS` was narrower than the law | The refusal is record-level: any `resolves` + `supersedes` + `op: remove` in one record is refused, and a test drives a record that supersedes one record while removing another's law. |
| 20 | duplicate detection ignored `active` | `findDuplicates` filters on the record's declared `status`, which is the law's own word; a test shows two proposed records are not a duplicate while two active ones still are. |

### Residuals, stated rather than implied

- **Finding 18's bound is now smaller, not gone.** The content of a file above the per-file
  cap is still not read — that cap prevents a synchronous freeze on a huge tree. What
  changed is that the verdict is no longer stale-safe: the marker carries the mtime, so an
  edit invalidates it. A replacement preserving BOTH size and mtime is the one case the
  marker cannot see, and the code says so where the marker is written.
- **Both decision records are `proposed` and wait for a human.** ADR 0075 carries the three
  design calls (findings 1, 3 and 9) and ADR 0076 the two note corrections (11 and 12). The
  CODE those calls describe is already changed and green; what is not yet in force is the law
  that will hold it there, because the zones involved are `proposeOnly` and the laws 0076
  retires were ratified by ADR 0016, which freezes their text. Nothing changes about a ratified
  law until a human ratifies the amendment — the intended behaviour.
- **Why the amendment names no zone.** ADR 0076 removes two laws that are in force, so the
  guard would classify it as a proposal working against a ratification and refuse writes in
  every zone it named. Naming `shipped-plugins` would therefore have frozen all plugin work
  between the drafting of the record and its ratification — and it did, until the removals
  were moved out of ADR 0075 into their own zone-less record. Correcting a note is not work in
  a zone; the removals target law ids, not paths.
- **The critic's methodology limit stands.** Only findings 1 and 10 were re-verified by hand
  in this session's first pass; the rest are now covered by executed checks, which is the
  standard this document holds others to.
