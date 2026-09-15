# LIMITATIONS.md — the state a new agent must know before changing anything

This file exists because the kit's governance is now large enough that a fresh agent, on another
machine, cannot tell a red gate from a broken kit, or an unstarted decision from a settled one. It is
maintained the way `REVIEW.md` is: a reading, not a contract. Where it and an artifact disagree, the
artifact wins — and the commands below are how to check.

Read this file, then `AGENTS.md` (the artifact table), then run the gate.

## 1. The gate is currently RED, on purpose, pending a human ratification

Measured on 2026-09-15:

| Command | State |
|---|---|
| `ratchet compile --root .` | OK — 39 records, 22 active, 0 proposed, 62 laws |
| `ratchet verify --root .` | **RED — 6 × `CODE_COMMAND_FAILED`** |
| `node --test scripts/test-ratchet.mjs` | OK (329) |
| `node --test scripts/test-ratchet-guard.mjs` | OK |
| `scripts/check-duplicate-decisions.mjs` | OK |
| `scripts/check-consent-surface.mjs` | OK |
| `scripts/check-gate-invariants.mjs` | OK |
| `scripts/check-instruction-routing.mjs` | OK |
| `scripts/check-portability.mjs` | OK (17/17) |
| `scripts/test-adr-panel.mjs` | OK |

The six failures are all one cause: six laws bind two **end-to-end probes**, and the probes fail when
the verifier's command runner starts them while passing when a human runs them in a shell:

- `node scripts/probe-dsh-api.mjs --adr-panel-consent` — **16/16, exit 0 standalone**; fails under the runner.
- `node scripts/probe-dsh-api.mjs --ratchet-ratify` — **10/10, exit 0 standalone**; fails under the runner.

The precise runner-level cause (timeout, environment, a nested process, a port) has **not** been
measured. The decision taken in response is settled and is what the next agent must implement:

> **A law's check must be hermetic.** Probes that need a live webserver, a port or a nested process are
> release-gate evidence (`scripts/verify-upgrade.sh`), not law checks.

The laws that violate this are in **ratified** records (ADR 0034 approved by 0041, ADR 0035 approved by
0042), so re-binding them **cannot be an edit** — that voids the consent (`RATIFICATION_STALE`). It
ships as an amendment: `op: remove` for each of the six law ids plus the restated laws under new ids,
bound to hermetic commands (`scripts/test-adr-panel.mjs`, which executes the shipped bundle against a
stub host; `scripts/check-consent-surface.mjs`, which drives the consent service directly). The
compiler forbids a remove and an upsert of one law id in one record, which is why the restatement takes
new ids.

**Until a human ratifies that amendment the gate stays red.** Do not "fix" it by editing a ratified
record, by declaring the probes hermetic, or by deleting a check.

## 2. Work that is written down but NOT enforced in the corpus

Both are enforced today by tests and by the validator, but are **not laws**, because encoding them
needs a record in `shipped-plugins` — a human decision:

1. **A law-bound finding must quote the law it judges** (the in-force statement or its spec hash). A
   mismatched quote invalidates itself; a missing quote is unusable. This rule exists because a judge
   error quoted a *superseded* statement, named a law in force, and the guard then refused every write
   under `plugins/**` — including the fix. Reconstructing the truth by hand was the only way out.
2. **A resolution takes away force one of two ways, never both**: `op: remove` for a named law while
   its record keeps governing, or `supersedes` for a whole record, which then carries a terminal
   status. ADR 0031 (ratified by 0038) still states both in one breath; the correction must ship as an
   amendment, not as an edit.

## 3. Decisions taken in a design session and NOT started

1. **The ratchet owns the derivation of a decision's state; the panel window reads it.** Today the
   window re-derives force, consent matching and the queue — a second implementation of one truth. It
   drifted twice in one day: it read `status: proposed` as "unpaid" for records in force by approval,
   and it hashed a record from the paged read that is one byte short, so seven ratified decisions read
   as awaiting a human. Both were found by a human looking at the product, not by a command.
2. **A record that contradicts law in force cannot be ratified until a resolution retires the
   conflicting law.** The ratify path must refuse and name the resolution needed.
3. **One derived "needs a human" set, shown in the ADR window** as the developer's entry point:
   consents waiting, contradictions with their drafted resolutions, duplicates with their drafted
   merges, stale detection, a red gate.
4. **A stale specification is reported with a drafted withdrawal note and never blocks the gate.**
5. **`scripts/verify-upgrade.sh` runs `ratchet verify` and `falsify`** (the release gate already runs
   and passes `verify`; `falsify` is not wired in).

## 4. Known limitations of the mechanisms themselves

- **Semantic duplicates are advisory only.** A duplicate that only meaning reveals is a judge report;
  the deterministic command cannot see it, and nothing forces anyone to answer it.
- **A re-ingestion that renames every law id escapes duplicate detection.** The deterministic rule
  reports a shared source only when the records also share a law id, because reading it literally
  would have failed this kit's own corpus and forbidden batch extraction.
- **Contradiction detection is a call, not a gate**, and its verdict is never a check — a judge needs
  a live root agent, so a red gate on it could not be cleared by any shell command. What is
  deterministic is the *staleness* fact: `compile`/`verify`/`status` report whether a review has read
  the current law set.
- **The panel is still a second implementation** (§3.1) and its agreement with the ratchet is pinned by
  a test rather than by construction.
- **A card that is both stale and hand-edited is reported as stale**, never as edited. The file is
  never silently overwritten; the cause named can be the wrong one.
- **The consent residual gap, unchanged:** a hand-written approval reproducing the ratification block,
  or one word of frontmatter (`authority: human`), is indistinguishable from a genuine one. Never
  forge either; see hard rule 12.
- **`verify-upgrade.sh` treats a `[SKIP]` as a failure.** Without a harness checkout
  (`HARNESS_DIR`/`~/deepseek-harness`), `test-adr-panel.mjs` prints two `[SKIP]` lines while exiting 0,
  and the release gate fails on them. Environmental, unproven here.
- **The kit's own zone coverage is unaudited.** In a sibling project we found 26 of 197 tracked paths
  owned by no zone and made coverage a rule with a failing command. Whether the kit has the same
  silent gap has not been measured.

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
- **Ratifying invalidates the generated law cards.** `ratify` now regenerates the documents it wrote
  itself and never overwrites a hand-edited one. The sequence is still: ratify → verify.

## 6. What to do first, in order

1. Ask the human to ratify the amendment in §1 so the gate is green.
2. Commit the approvals, their transcripts and the regenerated law cards together — a ratification is
   only meaningful as a pair with its approval.
3. Then §3.1: make the window read the ratchet's state instead of deriving it.
4. Then §3.2–§3.5 in the order they are listed.
