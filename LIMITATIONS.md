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
| `ratchet compile --root .` | OK — 52 records, 25 active, 0 proposed, 63 laws |
| `ratchet verify --root .` | OK — 63 laws, 75 checks evaluated, 0 pending, 0 problems |
| `node --test scripts/test-ratchet.mjs` | OK (331) |
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
4. **A stale specification is reported with a drafted withdrawal note and never blocks the gate.**
   Decided 2026-09-16: only the hash-behind kind becomes advisory — a hand-edited, missing or
   orphaned document still blocks — which needs an amendment to ADR 0012 (its law is in force as
   `shipped-plugins.specs-cannot-drift-silently`). Not yet landed.

The fifth decision, **`scripts/verify-upgrade.sh` runs `ratchet verify` and `falsify`**, landed
2026-09-16: the release gate now runs both, and it treats a documented, self-describing `[SKIP]` as
the skip it is while still failing on a `[FAIL]`, an unknown skip, or a missing success marker.

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

1. ~~Ask the human to ratify the amendment in §1 so the gate is green.~~ Done (ADR 0043, ratified by
   approval 0048); §2 done too (0044 by 0047, 0045 by 0046).
2. ~~Commit the approvals, their transcripts and the regenerated law cards together.~~ Done.
3. ~~§3.1: make the window read the ratchet's state instead of deriving it.~~ Done (ratchet 0.2.47,
   panel 0.1.24): the `ratchetDecisions` service and the `/adr-panel/state` route; the panel's
   derivation deleted.
4. Then §3.2–§3.4 in the order they are listed.
5. §4's zone-coverage rule is landed: `scripts/check-zone-coverage.mjs` plus the manifest's explicit
   `zoneCoverage.exceptions`, wired into `verify-upgrade.sh`.
