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
