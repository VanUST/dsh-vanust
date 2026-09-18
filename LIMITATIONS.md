# LIMITATIONS.md — the state a new agent must know before changing anything

This file exists because the kit's governance is now large enough that a fresh agent, on another
machine, cannot tell a red gate from a broken kit, or an unstarted decision from a settled one. It is
maintained the way `REVIEW.md` is: a reading, not a contract. Where it and an artifact disagree, the
artifact wins — and the commands below are how to check.

Read this file, then `AGENTS.md` (the artifact table), then run the gate.

## 1. The gate is GREEN, and every law check is hermetic (resolved 2026-09-16)

Measured on 2026-09-16:

| Command | State |
|---|---|
| `ratchet compile --root .` | OK — 54 records, 26 active, 0 proposed, 63 laws |
| `ratchet verify --root .` | OK — 63 laws, 75 checks evaluated, 0 pending, 0 problems |
| `node --test scripts/test-ratchet.mjs` | OK (354) |
| `node --test scripts/test-ratchet-guard.mjs` | OK |
| `scripts/check-duplicate-decisions.mjs` | OK |
| `scripts/check-consent-surface.mjs` | OK |
| `scripts/check-gate-invariants.mjs` | OK |
| `scripts/check-instruction-routing.mjs` | OK |
| `scripts/check-portability.mjs` | OK (17/17) |
| `scripts/test-adr-panel.mjs` | OK |
| `scripts/verify-upgrade.sh` | GATE PASS |

The red state that stood here was six laws bound to two **end-to-end probes**
(`probe-dsh-api.mjs --adr-panel-consent`, `probe-dsh-api.mjs --ratchet-ratify`) that pass
standalone (16/16 and 10/10, both exit 0) but failed when the verifier's command runner started
them. On this machine the failure does not reproduce; the structural defect is real regardless, and
the settled decision was applied:

> **A law's check must be hermetic.** Probes that need a live webserver, a port or a nested process
> are release-gate evidence (`scripts/verify-upgrade.sh`), not law checks.

**Amendment 0043** removed the six probe-bound laws from the ratified records 0019, 0034 and 0035 and
restated them under new ids bound only to `scripts/test-adr-panel.mjs` and
`scripts/check-consent-surface.mjs`. The human ratified it through the ADR window (approval 0048);
regenerating the law cards (`ratchet compile --write`) made the gate green. No law in force binds a
probe — `ratchet verify --root .` is the proof.

## 2. The two written-down rules are now law (resolved 2026-09-16)

Both were enforced by tests and by the validator but were **not laws**. They are now in force:

1. **A law-bound finding must quote the law it judges** (the in-force statement or its spec hash). A
   mismatched quote invalidates itself; a missing quote is unusable. — **ADR 0044**, ratified by the
   human (approval 0047).
2. **A resolution takes away force one of two ways, never both**: `op: remove` for a named law while
   its record keeps governing, or `supersedes` for a whole record, which then carries a terminal
   status. A record asking for both is refused as `RESOLUTION_AMBIGUOUS`. — **ADR 0045**, an
   amendment to ADR 0031, ratified by the human (approval 0046).

## 3. Decisions taken in a design session and NOT started

1. ~~**The ratchet owns the derivation of a decision's state; the panel window reads it.**~~ **LANDED
   (2026-09-16).** The ratchet now provides a `ratchetDecisions` cordis service whose one operation
   derives the whole view model from the ratchet's own functions (`compileProject`, `readManifest`,
   `resolveActiveSet`, `compileLaws`, `ratificationQueue`, `renderSpecs`, `detectSpecDrift`), and the
   panel's host half serves it at `/adr-panel/state` behind the same browser trust fence and a
   per-activation capability as `/adr-panel/consent`. The window renders that view and its derivation
   is deleted (`resolveZonePolicy`, `governingZones`, `parseRatification`, `contentHashOf`,
   `buildRelations`, `displayedState`, `canOfferRatify`, the ADR text hashing). A route the window
   cannot reach is reported as state unavailable; the window never falls back to reading the corpus.
   The two drifts that motivated it — `status: proposed` read as "unpaid", and a hash taken from the
   paged read that is one byte short — cannot recur, because the panel no longer computes either.
2. **A record that contradicts law in force cannot be ratified until a resolution retires the
   conflicting law.** The ratify path must refuse and name the resolution needed.
3. **One derived "needs a human" set, shown in the ADR window** as the developer's entry point:
   consents waiting, contradictions with their drafted resolutions, duplicates with their drafted
   merges, stale detection, a red gate.
4. ~~**A stale specification is reported with a drafted withdrawal note and never blocks the gate.**~~
   **LANDED (2026-09-16) and RATIFIED as ADR 0056 (approval 0057).** Only the hash-behind kind
   (`stale`) is advisory: it is reported in `compile`/`verify`/`status` `specDrift.stale` with the
   withdrawal note the ratchet drafts at `reports/ratchet/drafts/`, and it does NOT enter the
   blocking `problems`. A hand-edited (`drifted`), missing, or orphaned document still blocks.
   The narrowed rule is in force as
   `shipped-plugins.spec-stale-is-advisory-others-still-block`; the old law
   `shipped-plugins.specs-cannot-drift-silently` (ADR 0012) left force with the consent. The
   withdrawal note is written by the RATCHET's own drafting pass (`ratchet-drafts.mjs`), invoked by
   `ratchet compile` and read-only by the ADR panel's view — never by an agent, and never applied
   (the ratchet does not delete or regenerate the document).

The fifth decision, **`scripts/verify-upgrade.sh` runs `ratchet verify` and `falsify`**, landed
2026-09-16: the release gate now runs both, and it treats a documented, self-describing `[SKIP]` as
the skip it is while still failing on a `[FAIL]`, an unknown skip, or a missing success marker.

## 4. Known limitations of the mechanisms themselves
- **Semantic duplicates are advisory only, but are now detected automatically.** A duplicate that only
  meaning reveals is a judge report; the deterministic command cannot see it. The automatic pass that a
  stale law set triggers runs the semantic duplicate review as well as the corpus review, and the
  finding reaches the decisions view model as a `duplicate` need — but nothing forces anyone to answer
  it, and it never fails a build.
- **A re-ingestion that renames every law id escapes duplicate detection.** The deterministic rule
  reports a shared source only when the records also share a law id, because reading it literally
  would have failed this kit's own corpus and forbidden batch extraction.
- **Contradiction detection is a call, not a gate**, and its verdict is never a check — a judge needs
  a live root agent, so a red gate on it could not be cleared by any shell command. What is
  deterministic is the *staleness* fact: `compile`/`verify`/`status` report whether a review has read
  the current law set.
- **The panel and the ratchet share one derivation now, and the panel's copy is gone** (§3.1). The
  agreement is no longer pinned by a comparison of two implementations: the panel renders the
  ratchet's `ratchetDecisions` view, so a change to `resolveActiveSet` moves the window with no panel
  edit. The tests still pin that the rendered waiting set equals `ratificationQueue`'s, and the
  surface check pins the four state values (service, route, header, capability) across the ratchet,
  the host and the browser bundle.
- **A card that is both stale and hand-edited is reported as stale**, never as edited. The file is
  never silently overwritten; the cause named can be the wrong one.
- **The consent residual gap, unchanged:** a hand-written approval reproducing the ratification block,
  or one word of frontmatter (`authority: human`), is indistinguishable from a genuine one. Never
  forge either; see hard rule 12.
- **The kit's zone coverage is now a rule with a failing command, and its exceptions are explicit.**
  122 of 205 tracked paths are owned by no zone: `docs/`, the root meta files, `.dsh/`, `.reasonix/`.
  They are not code and are already governed by a rule of their own — the write guard exempts the
  ratchet's record, source and state directories, and reports are generated — so they are named
  explicitly in `.dsh/project.json`'s `zoneCoverage.exceptions` instead of being left to fall to the
  default authority unnamed. `scripts/check-zone-coverage.mjs` fails with `ZONE_COVERAGE_GAP` on any
  tracked path that is neither zoned nor excepted, so a NEW file outside every zone fails until it is
  placed. It uses the same `zonePathCovers` matcher as the guard, and exits 2 when the work tree
  cannot be read rather than reporting a pass.

## 4b. Two defects found and fixed (2026-09-16)

Both were operator reports, both reproduced, both falsified by reverting the fix.

1. **A `status: proposed`, `authority: human` record was a dead end in the ADR window.** The
   ratification queue skipped every record that was not `authority: agent` — the comment read
   "its author carries its own authority and activates it" — so a human-authored proposal rendered
   as "not in force" with a `human` pill and no action at all, and the window offered no other
   affordance. Authorship is not activation: the one act that puts a record into force through the
   ratchet is a recorded human consent, so the queue now offers a human-authored `proposed` record
   the same question it offers an agent's. Approving it writes the human's own approval ADR and its
   transcript (`resolveActiveSet` already activates a record from `effectiveConsent` alone), and the
   window renders the same Approve/Decline on its row. A terminal (rejected/withdrawn/superseded)
   record is still not offered. Nothing about this widens authority: an agent record in a `humanOnly`
   zone is still blocked, an agent still cannot mint, and `scripts/check-consent-surface.mjs` fails if
   the consent path widens. Pinned by tests in `scripts/test-ratchet.mjs`,
   `scripts/test-adr-panel.mjs` and `scripts/check-consent-surface.mjs`; reverting the queue's
   `authority !== 'agent'` skip fails them.
2. **`ratchet verify` and `ratchet status` could compute different code hashes on an unchanged tree.**
   Above the code-hash file cap (`WORK_LIMITS.maxFiles`, 5000) the two paths selected different files:
   `verifyProject` hashed the first 5000 of the walk it had already done, while `status` walked again
   and, on the budgeted path, stopped at the same count in `readdirSync` order — so a CLI verdict and
   an in-process `status` disagreed and `status` reported `VERIFY_NOT_RUN` with no edit in between.
   The walk is now deterministic (directory entries sorted by name) and both callers compute the
   identity over one budget-independent list, `codeHashFilesFor(root)`, which is exactly the first
   `CODE_HASH_MAX_FILES` files of a deterministic traversal. `ratchet verify`, `ratchet status`, the
   budgeted tools and a fresh CLI process all recompute the same hash for the tree they judged; the
   file-count cap is deliberately not a work-budget stop, because a bounded identity is not a partial
   verification.

## 5. Platform facts that explain surprising behaviour

- **A tool call runs the plugin code the *session* loaded.** A change to the ratchet is invisible to
  `ratchet_*` tools until a session starts after it; a fresh CLI process sees it immediately. Plan a
  restart, and do not conclude a change failed when it only has not been loaded.
- **The workspace file API's paged `read` rebuilds text from lines and drops a final newline.** Hash
  anything by content hash from `readAll` (exact bytes), never from a page. This cost seven ratified
  decisions their visible state.
- **The write guard is real.** A recorded contradiction blocks writes in the zones that law governs,
  including the fix; the record files themselves are never refused. A `humanOnly` zone can never be
  held by an agent, and `proposeOnly` needs a human ratification.
- **Ratifying regenerates the generated law cards it invalidates.** `ratify` rewrites only the
  documents the ratchet itself wrote and never overwrites a hand-edited one. The writer that records
  those documents (`writeSpecDocuments`) also records each one's digest in the ledger, so a card
  produced by an ordinary `ratchet compile --write` is recognised as the ratchet's own and brought in
  step by the next ratification. The sequence is still ratify → verify, with no manual
  `compile --write` step. (Ratchet 0.2.57.)

## 6. Four defects found and fixed (2026-09-16, ratchet 0.2.57)

Each was reproduced on this machine, fixed, covered by a test, and falsified by reverting the fix in a
scratch copy of the plugin and watching the covering test fail.

1. **A ratification did not regenerate the law cards it invalidated, so `ratchet compile --write` was
   a manual step.** ADR 0056 was ratified through the panel and the ledger recorded `specsRegenerated:
   0` while the law set had moved. The mint did compile the post-ratification corpus; the cause was the
   regeneration's own not-overwriting guard, which consulted a ledger of digests that the ordinary
   `compile --write` writer never wrote — so every pre-existing card looked like a person's and was
   skipped. `writeSpecDocuments` now records the digest of every document it writes, at the one choke
   point both `compile --write` and the mint use; the hand-edited-card guard is unchanged.
2. **Four in-process paths bypassed the work budget.** `readManifest` read the manifest whole;
   `detectSpecDrift` read every generated card whole; `ops.ratify` recompiled with an unbudgeted
   `compileProject` on the consent (panel-click) path; and a FIFO or device node at any project-file
   path blocked `readFileSync` forever (an ingest-source FIFO hung `timeout 8`, exit 124). The manifest,
   the drift reads and the ratify queue/compile/regeneration now carry the operation's tracker;
   `workBudgetRead` `stat`s before it opens and refuses a non-regular file with `CODE_FILE_NOT_REGULAR`
   at both call shapes (budgeted and CLI), so an unbounded read never means "allowed to hang". The
   ingest source read is refused the same way and reported instead of opened.
3. **The glob check kinds were blind to `NEVER_WALK`.** `required_glob`/`forbidden_glob` tested
   membership in `listFiles()`, which skips every name in `NEVER_WALK`, so `forbidden_glob: bin/**`
   reported the law satisfied while `bin/tool` existed. A glob whose literal prefix begins with a
   skipped name is now matched against a walk that STARTS at that named directory, carrying the same
   work budget, so the explicit scope widens WHAT is seen and not how much may be read. The literal
   file kinds already asked the filesystem; `statSync` follows a symlink, so a forbidden symlink to an
   existing target is found and a required one is not reported missing.

Residual limits of this work, stated plainly:

- **A glob reaches `NEVER_WALK` only when its literal prefix names the directory.** `**/*.bin` still
  does not see `bin/x.bin`; the law must name the scope (`bin/**`). This is the deliberate line: the
  whole-project walk stays cheap and a check's own scope is honoured.
- **The recursive walk does not follow symlinks** (neither a symlinked directory nor a symlinked file
  is listed), so a glob never descends through a link and cannot loop or leave the repository. The
  literal `required_file`/`forbidden_file` kinds do follow one, because they ask the filesystem about
  one named path. A directory symlink inside a glob scope is therefore not followed; name the path
  with a literal file check if it must be seen.
- **The ledger read is unbudgeted.** `readLedger` (used by the ratify regeneration and `status`) still
  reads `.dsh/ratchet/ledger.jsonl` whole. The file is machine-written and small in normal use, but it
  is the one remaining project-file read on the consent path that a pathological history could grow.
- **`contextFor`/`review` and the guard's reads remain unbudgeted.** They are not on the panel-click
  path and were outside the four gaps; a review spawns a judge and is not a synchronous gate.

## 7. What to do first, in order

1. ~~Ask the human to ratify the amendment in §1 so the gate is green.~~ Done (ADR 0043, ratified by
   approval 0048); §2 done too (0044 by 0047, 0045 by 0046).
2. ~~Commit the approvals, their transcripts and the regenerated law cards together.~~ Done.
3. ~~§3.1: make the window read the ratchet's state instead of deriving it.~~ Done (ratchet 0.2.47,
   panel 0.1.24): the `ratchetDecisions` service and the `/adr-panel/state` route; the panel's
   derivation deleted.
4. Then §3.2–§3.4 in the order they are listed.
5. §4's zone-coverage rule is landed: `scripts/check-zone-coverage.mjs` plus the manifest's explicit
   `zoneCoverage.exceptions`, wired into `verify-upgrade.sh`.

## 8. The automatic corpus review actually fires now (2026-09-17, ratchet 0.2.61)

**The dead trigger, reproduced before the fix.** `plugins/ratchet/ratchet-tools.mjs`'s
`reviewWhenRequired` decided `stale` from `result.problems.some(e => e.code ===
'CONTRADICTION_DETECTION_STALE')`, but that code was declared in `ratchet-schema.mjs` and emitted
NOWHERE. On a scratch project whose compile had `reviewRequired.length === 0` and
`contradictionReview.stale === true` — a law set no review has ever read — the compile spawned no
judge and returned `dynamicReview: undefined`. The real fact is the field
`result.contradictionReview.stale`, computed by `contradictionReviewStatus` and printed by the CLI as
"contradiction detection: NOT RUN for these laws".

**The fix.**
1. The trigger reads `result?.contradictionReview?.stale === true`, alongside the existing
   `reviewRequired` trigger. The never-emitted `CONTRADICTION_DETECTION_STALE` code was REMOVED from
   the vocabulary rather than left declared for a comment to claim: the fact is deliberately a field,
   not a problem, because a status that is red on every new project cannot be cleared without a judge.
2. One automatic pass now runs TWO corpus jobs on the ONE pooled judge: `review_corpus`
   (contradictions plus the new ADVISORY question of which decision should be retired) and
   `review_duplicates` (semantic restatements, previously reachable only by an explicit call). No new
   job was added for the retirement question. Two judge turns in one pass reuse the same judge child.
3. `review()` and `submitReview()` persist the corpus jobs' findings to
   `reports/ratchet/advisory-findings.json`, keyed by job and bound to the spec hash the judge read.
   `draftNeedsHuman` translates `semantic_duplicate` findings into its drafting path, and
   `ratchetDecisions.deriveDecisions` raises a `duplicate` need (with a drafted resolution id/path or a
   `draftReason`) and a new `deprecated` need whose `action` names the retirement shape (`supersedes`,
   or `op: remove` plus a `resolves` list). Both are ADVISORY: only `semantic_violation` /
   `intent_violation` naming a law can block, so neither changes a compile or verify verdict.
4. The panel needed no edit: `deprecated` falls into its generic non-decision grouping, renders in the
   neutral tone, and the per-kind cap counts it like any other kind.

**Residual limits.** The retirement question is a judge report; the ratchet drafts no retirement
record, because superseding a whole decision is a human act — the `deprecated` need names the shape
and stops. A semantic duplicate can usually only be reported, not drafted, because the verdict names
at most one law and one ADR and the losing side's law is not decidable from that; such a finding
lands as a `duplicate` need with a `draftReason` saying so. `reviewWhenRequired` still refuses to
spawn from a non-root caller and still honours `review: false`; a composition with no judge reports
`ran: false` with the reason. A stale tarball (until the next repack) makes `check-portability`
report `tarball:matches-source` because `package.json` was bumped to 0.2.61 without packing.

## 9. The execution-methodology additions (2026-09-17, uncommitted at the time of writing)

Superpowers was read against the kit (`docs/SUPERPOWERS-COMPARISON.md`) and the first four
proposals were landed. **They are not yet ratified as law, and `rules/AGENTS.md` lives in the
`deployment-rules` zone, whose `agentAuthority` is `humanOnly`:** the edits below are proposed
until a human puts them in force, and no law in `docs/adrs/` covers them yet.

1. **The rule drill** (`scripts/drill-kit-rules.mjs`, `scripts/test-drill-kit-rules.mjs`,
   `rules/drills/*.json`, `probes/api-probe/drill.mjs`, and `probe-dsh-api.mjs --drill`). It is
   the first enforcement point for a prompt rule: `flash-only-models` had none, and the live
   drill now proves the rule changes a decision. RED (the real rules minus `## 8.`) recorded
   `zzdrill_delegate({model:'deepseek-v4-pro'})`; GREEN (the file unchanged) recorded
   `deepseek-flash`. **The measured limit:** a drill is non-hermetic (credentials, a model, ~30 s
   per variant) and can report `missed` when the pressure scenario does not tempt the agent — the
   other two scenarios are not yet shown to elicit their violations, so their `pass` is unproven.
   It is therefore NOT in a law's `checks` and NOT yet in `verify-upgrade.sh`, whose SKIP policy
   accepts exactly two documented lines; wiring it there is a separate change. `--plan` and
   `--from-journal` are hermetic and are where the verdict logic is tested.
2. **Rationalization tables** in `rules/AGENTS.md` §1, §3, §6, §9, §10: the excuse next to its
   rebuttal. They are prose; the drill is what tests whether they change a decision, and only the
   §8, §11 and §12 scenarios exist so far.
3. **§11 Verification Before Completion** and **§12 Tests Verify Behaviour, Not Shape**.
4. **The test-quality lint** (`scripts/check-test-quality.mjs` + `scripts/test-check-test-quality.mjs`).
   Report mode first, as agreed: it found exactly one shape assertion in the kit's own suite
   (`test-adr-panel.mjs:225`, `typeof bundle.apply === 'function'`), which is now exempted inline
   with a reason, and the suite is clean under `--strict`. **The measured limit:** it is a shape
   heuristic, not a semantic check — it cannot see a mirror assertion that is not textually
   identical, a mock that swallows the behaviour under test, or a test that asserts a real value
   which happens to be constant. Its detections are `SHAPE_TYPEOF`, `SHAPE_MEMBER`, `MIRROR` and
   `MOCK_ONLY`; the inline `test-quality:allow <reason>` is how a judged finding stops being
   reported.

**What remains from the comparison:** a plan artifact with a lint, the universal approval gate,
systematic debugging, the subagent review protocol, worktree isolation, and contribution
discipline. They are candidate decisions, not patches.

## 10. A verify concurrent with `falsify` poisons the ledger's law set (2026-09-17)

`scripts/verify-upgrade.sh` runs `ratchet falsify`, which temporarily mutates shipped source
AND compiles a temporary law (`falsify.unchecked-law`) into the corpus and the persisted
bundle. A `ratchet verify` run in another shell while that mutation is in place records a
`ratchet.verify.finish` ledger event whose `lawIds` **include the falsify law**. When the
mutation is restored, `readRecordedLawIds` still reads that event, so `lawRemovalProblems`
reports `LAW_REMOVED_WITHOUT_DECISION [falsify.unchecked-law]` — and it can never clear
itself, because a verify that reports the removal problem appends no `lawIds` of its own, so
the poisoned entry stays the last recorded set. Observed on this kit and repaired by
appending one truthful `ratchet.verify.finish` event carrying the restored 63-law set.

**The operational rule that follows: do not run a ratchet command while the release gate is
in its falsify phase.** The product fix — a verify that judged a law set should record that
set even when it reports a problem — is unbuilt, and a `falsify`-held lock or an explicit
"mutating" marker in the ledger would remove the trap rather than document it.

## 11. The ADR window now surfaces a blocked decision (2026-09-17, ratchet 0.2.64, panel 0.1.32)

The decisions view deliberately omitted a queue-blocked record from the needs-a-human set on
the ground that it is "not waiting for anyone". The effect was that a `humanOnly`-zone
proposal — the one kind of decision an agent may write but may never activate — was invisible
in the only place meant to tell a human what needs them; ADR 0058 sat in the blocked list and
in the Decisions section, with the Needs-a-human tab empty. A blocked record now reaches that
set as the `blocked` kind, carrying the queue's own reason and the action a consent cannot
take, and the panel draws it as its own decision card with no Approve. It is deduplicated
against a `contradiction`/`duplicate` need for the same record, which already carries the
drafted resolution. The change is shipped and repacked, but the **live profile still runs
0.2.63/0.1.31 until it is converged and `dsh web` is restarted.**

A second defect surfaced once the window was actually read: ADR 0058's collapsed row
summarised as `Three rule additions and two hermetic enforcement points: 1.`. Its Decision
opens with a paragraph and CONTINUES as a numbered list, so the `1.` is mid-string; the
existing strip was anchored at the string's start and the first-sentence extractor took
the marker's own period as the sentence end. `plainText` now strips a bullet or ordered
marker on the line it belongs to, so the false period never exists, and the panel test
pins the shape (panel 0.1.33).

## 12. A red gate is now actionable in the window (2026-09-17, ratchet 0.2.65, panel 0.1.34)

`compile-and-conquer` showed "Needs a human (1)" with a red-gate card that named only the
report file: the ratchet's `redGateNeed` read the report's problems, counted them, and threw
the list away, so the window — which derives nothing — could render a count and a path and no
way to act. The report's problem was decidable and specific (`CODE_FORBIDDEN_GLOB_PRESENT`:
ADR 0017's law forbids `docs/decisions/*.md` and ten legacy files still match), and none of it
reached the screen. The need now carries the problems (capped at five, with the count kept),
each with its code, its law id and the record that decided that law; the panel renders them and
offers a button that opens that decision. **The card is still not consentable, by design:** a
red gate is a fact about the report and the code, not a decision a record can be drafted for,
so the action remains "fix what it names and re-run `ratchet verify`" — but what it names is
now on the card.

## 13. The rules zone now requires ratification, not authorship (2026-09-17)

**Why.** ADR 0058 was written by an agent and bound to `deployment-rules`, which the manifest
reserved to humans. The human read it and agreed, and could not put it in force: the ratchet
refuses an agent-authored record in a `humanOnly` zone, so the queue never offered it — the
only route was to edit one frontmatter word and then approve text already read. The
reservation conflates *writing* a decision with *consenting* to it, and only the second is
verifiable: a consent is bound to the text the human was shown, while authorship is a
frontmatter word. The kit's own hard rule 12 records the gap — nothing verifies who wrote the
file — so no command fails when an agent writes `authority: human`. By §3 that made
`humanOnly` an unenforceable rule, and the check that "pinned" it asserted the manifest's
value rather than the behaviour. What `humanOnly` genuinely bought — no self-activation —
`proposeOnly` already provides.

**What landed.**
1. **ADR 0059** (`active`, `kit-tooling`): the two enforcement laws —
   `kit-tooling.tests-verify-behaviour` (`check-test-quality.mjs --strict`) and
   `kit-tooling.rule-drills-target-real-sections` (`drill-kit-rules.mjs` plan mode) — bind to
   the zone that governs `scripts/**` and enter force by their own declaration. 63 → 65 laws.
2. **ADR 0058** (`proposed`, `deployment-rules`) now carries only the rules-text decision and
   `deployment-rules.claims-carry-evidence` (unenforced, with the reason stated).
3. **ADR 0060** (`proposed`, `shipped-plugins`) removes ADR 0012's
   `shipped-plugins.the-authority-table-cannot-be-relaxed-silently` and restates it: the zone
   requires a recorded human RATIFICATION, not human authorship.
4. `.dsh/project.json`: `deployment-rules.agentAuthority` is `proposeOnly`.
   `scripts/check-consent-surface.mjs` asserts the new value AND drives a `proposeOnly`
   fixture to require an agent proposal to be offered rather than blocked; a `humanOnly`
   fixture still requires an agent record there to be blocked, so the mechanism stays covered.

**State: both 0058 and 0060 are waiting for you** (`ratchet pending`); neither is in force,
so ADR 0012's old law is still in force and its check still passes. Ratifying 0060 settles it.
The stronger option, unbuilt: enforce authorship on git provenance rather than a frontmatter
word.

**A falsify residue found while doing this.** A `ratchet falsify` run left
`docs/adrs/9002-falsify-unchecked.adr.md` behind, so a `compile --write` generated
`docs/specs/-unzoned-.spec.md` from it. Removing both surfaced
`LAW_REMOVED_WITHOUT_DECISION [falsify.unchecked-law]` until the bundle was rewritten — the
same family as §10: a transient mutation can leave the recorded law set disagreeing with the
corpus. `ratchet falsify` should clean up the ADR *and* any generated spec document it caused.

## 14. The authority table is now reported and its repairs drafted (2026-09-17)

A project's records named four zones its manifest did not declare; each resolved to a
missing zone — no paths, so no law could be enforced; the conservative default policy, so
no record could self-activate — and the queue refused to offer an inert consent. Six
records were blocked for one structural reason. The same class recurs on every zone rename,
path move or new area, and the manifest that decides it is governed by no zone.

`ratchet zones` (ADR 0063) reports it deterministically and exits 1 on
`ZONE_UNDECLARED_REFERENCE`, `ZONE_PATH_EMPTY`, or the compiler's
`LAW_PATH_OUTSIDE_DECLARED_ZONE`; `--write` drafts a declaration per undeclared zone under
`reports/ratchet/drafts/`, with the paths inferred from those records' law targets, and
applies nothing. Two new problem codes are declared in the vocabulary; the deck of three
fixture tests lives in `scripts/test-ratchet.mjs` (377 tests, all passing).

**What it does not do yet.** A rename still needs the records retargeted — the report finds
them, nothing rewrites them; an alias map is the next step. The draft is a file, not a
proposed record, because the manifest is not an ADR, so a zone change is still not itself a
ratified decision. And write-time validation remains ingestion's: `ratchet_ingest` refuses
an undeclared zone, but a hand-authored record bypasses it and is caught at the next run.

**Illegitimate reads, stated plainly:** the zone report reads the whole corpus and the
tracked-path list, so it is bounded by the same work budget as everything else and reports
an unreadable project as unusable (exit 2) rather than clean.

## 15. A blocked record now has a resolve plan (2026-09-17)

The first half of "everything else is resolved automatically" (ratchet 0.2.69):
`plugins/ratchet/ratchet-resolve.mjs` derives, with no judgement, what would unblock a
record — `declare-zone` (with the paths inferred from the positive targets of the
record's laws), `widen-or-remap-zone` (a law targeting a path its zones do not govern),
and `human-authorship-required` for a `humanOnly` zone, which no agent may satisfy.
`ratchet resolve <id>` prints it and reports `humanRequired`. It changes nothing.

**What is deliberately not automated:** `human-authorship-required`. A `humanOnly` zone
refuses an agent record however a human answers, and the alternative — an agent writing
`authority: human` — is the one act hard rule 12 forbids. The plan says so instead of
offering it.

**Landed (the second half, ratchet 0.2.70).** The plan now has a service and a route.
`plugins/ratchet/ratchet-resolve.mjs` also exports `recordResolveDecline`,
`resolveHistory`, `resolverPrompt` and `createResolveService`, provided as the
`ratchetResolve` cordis service; `resolvePlan` carries `declined` — the reasons a human
already gave — read back from the ledger. The panel's host half serves
`GET`/`POST /adr-panel/resolve`: a GET reads the plan, a POST with `decision: "decline"`
records a refusal with its reason, and a POST with `decision: "resolve"` resolves the
session's live agent through `AgentRegistry.get(sessionId)` and starts ONE child through
`subagents.start('spawn', { parent, prompt })` on the ratchet's own `resolverPrompt`. A
plan with `humanRequired` starts no child and returns the step instead, and a composition
with no subagent runtime refuses with a named reason. The resolver prompt marks each step
`[you]` or `[human only]` and repeats the declined reasons, so a resolution offered after
a refusal must differ from the one rejected. No composer message is involved, and starting
a resolver mints no consent: the child writes a `proposed` record and the human approves
it through the ordinary row.

**Measured live, and what is not.** `scripts/probe-dsh-api.mjs --adr-panel-consent`
(21/21 now) drives the real route over real HTTP against the real webserver, browser
fence and ratchet: the capability is required, the plan comes back as the ratchet's own
(a `humanOnly` record reports `human-authorship-required`), a decline is recorded with the
human's reason and the reason is read back into the next plan, and a resolve request for a
record with a step no agent may carry is refused with that step rather than started. What
is NOT measured live is the one thing that needs a model: an actual
`subagents.start('spawn', …)` child. The spawn path is designed against the measured
`subagents`/`agents` API and the panel's Resolve button is driven against a stub host, so
"a resolver started" is asserted at the transport and at the spawn seam, not observed on a
live child — the next probe, and until it exists this is the honest boundary.

## 16. A decline now carries the human's reason (2026-09-17)

Pressing **Decline** in the ADR panel's decision row no longer sends at once: it puts a
reason box in the row, and the words travel with the refusal as the `comment` field of the
same `POST /adr-panel/consent`. `ratify({ …, comment })` (`plugins/ratchet/ratchet-ops.mjs`)
records the reason — trimmed, capped at 2000 characters — beside the refusal in the
append-only ledger (`ratchet.ratify.no-consent`, with both `rejected` and `comment`) and
returns it, so the surface that carried the answer can show it back. The panel does exactly
that: the outcome repeats the recorded reason. A whitespace-only box is sent as `null`, and
an approval discards any reason sent with it, so a reason can never become a consent and a
silent decline stays silent.

**Why it matters and what it does not do.** The reason is the one place a "no" says WHY,
which is what a later proposal can be drafted against. Recording it is all this change does:
the ledger keeps it, and no ratchet routine reads it yet. Making the ratchet *produce another
resolution* from a declined one is the resolver work in §15 — the panel's Resolve control and
the `/adr-panel/resolve` route — which is still missing, so a declined resolution is recorded
with its reason and nothing yet re-drafts automatically.

## 17. Two wrong verdicts fixed in the resolve path (2026-09-18)

**A `supersedes` retirement is now credited by the removal audit.** `supersedes` is one of
the exactly two ways a decision takes force away, but `removedByDecision` carried only the
`op: remove` retirements `compileLaws` can see — and a superseded record is not among the
records it is handed. So an active record superseding another produced one
`LAW_REMOVED_WITHOUT_DECISION` per law of the retired record, a wrong verdict about a
correct corpus. `supersessionRemovals` (`ratchet-compiler.mjs`) adds the laws a supersession
actually removed, and `scripts/check-gate-invariants.mjs` has an invariant for it. On the
`compile_and_conquer` corpus this turned four false findings into none.

**A resolver is called started only when the runtime accepted it.** The resolve route
returned `spawned: true` before `subagents.start` settled, so a rejected start (no provider,
no model, a veto) was logged and the window still said the resolution had begun — the human
reloaded and nothing had changed because nothing had started. The route now awaits the
start through the exported `startResolver`: an accepted run reports its child session, a
rejection is a `502` refusal with the runtime's own message, and
`scripts/check-consent-surface.mjs` drives all four verdicts hermetically.

**And the start request was malformed in two ways the first fix exposed.** Awaiting turned a
silent failure into `Cannot read properties of undefined (reading 'aborted')`: the request's
`signal` is not optional, and the route had passed none. The `prompt` is a `ContentBlock[]`,
not a string, and the route had passed a bare string. Both are now the shape the harness's
own `subagent` tool sends — a fresh `AbortController` per resolver (never this request's own
abort, which would cancel a resolver meant to outlive the click) and
`[{ type: 'text', text }]` — and `check-consent-surface.mjs` asserts both, so neither field
can be dropped again. **The limit:** the request is pinned field-by-field against the
harness's own tool call and a real child was started in this composition through the public
`subagent` seam, but the panel's own spawn has not been driven live end to end — doing so
needs a model turn and would have the child edit a fixture project.

**And one resolver per PROJECT, not per click.** Six blocked records were each given their
own resolver, and six agents then edited one `.dsh/project.json` at once: last write won, the
only surviving change was unrelated (a `scopes` entry rewritten from `experiments` to
`assets`), no zone was declared, and the six blocked records were still blocked. So
**Resolve now QUEUES** and closing the window dispatches the whole queue as ONE request;
`resolverPrompt` accepts a batch and states a step several records share ONCE (`declare-zone
art` four times is one decision about one zone, and an agent told to make it four times can
make it four different ways). The host starts one **continuable** child and a later batch
**steers** it with `sendMessage` rather than starting a rival; a dispatch from a different
Session is refused `resolve-busy`, because delivery follows the direct-parent relation and a
second child would race the first for the same manifest. Records with a `humanOnly` step are
reported in `humanRequiredIds` and left out of the batch, so one of them cannot poison the
rest. What this does NOT fix: two people (or two machines) with the panel open on the same
project are still two resolvers, because the memory of the running child is per plugin
activation, not shared state.
