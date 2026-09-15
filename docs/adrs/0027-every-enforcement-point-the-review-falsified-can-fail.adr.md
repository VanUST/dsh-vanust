---
id: "0027"
title: Every enforcement point the review falsified can now fail for the reason it names
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-15T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-the-checks-could-not-fail.md
  hash: sha256:95d64ad6c85e2c9fe606fdfa00019c99bb315b1320f62f1dacb7ad28731bdca3
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.a-consent-answers-a-question-the-ratchet-asked
    statement: A consent is minted only from an answer to the question the ratchet builds for the records waiting — the same targets, the same two labels, and a frozen content hash for every one of them — so a caller-composed quiz with no frozen text mints nothing, while a record edited after the question was asked is still answered by the stale-text rule rather than by the shape check.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a caller-composed quiz with an empty frozen list is refused with RATIFICATION_UNPROVEN and writes nothing, the ratchet's own quiz mints, and an edited record still reports RATIFICATION_STALE
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.a-supersession-answers-to-the-same-authority-as-a-removal
    statement: A record retires another through supersedes only if it could have removed the laws that record declares — a human-authored or human-ratified record may supersede anything, and an agent-authored unratified record may not supersede a human-authored record or one whose force came from a human ratification — so a refusal reports LAW_REMOVE_UNAUTHORISED and the target's laws stay in force.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: an agent supersession of a ratified or human-authored record is refused with LAW_REMOVE_UNAUTHORISED and leaves the law in force, while the same supersession by a human-authored or ratified record succeeds
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.a-zone-id-is-a-filename
    statement: A zone id is restricted to [A-Za-z0-9_-], because the id names the zone's generated spec file and any lossy slug lets two ids share one file and drop a zone's laws from the human-readable view, so a manifest declaring any other character is refused with ZONE_INVALID.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a manifest declaring zone id auth.v1 is refused with ZONE_INVALID and auth-v1 is accepted
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.a-law-declared-in-two-zones-governs-both
    statement: When two active records declare the same law id and statement, the compiled law is bound to the union of the zones both named, and a contradiction against it blocks every one of them, because the same law in two zones is one law.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the bundle law carries both zones and blockedZones returns both ids
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.zone-overlap-is-one-predicate
    statement: Whether two declared zone paths can cover a common path is decided by one shared predicate that is conservative rather than optimistic, so validateZones reports ZONE_OVERLAP for a whole-repository ** against a named zone and for a mid-path wildcard such as **/auth/**, where comparing stripped prefixes reported nothing.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: ** and src/auth/** with different authority report ZONE_OVERLAP, src/** and **/auth/** report it, and genuinely disjoint paths do not
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.the-append-only-record-outlives-its-cache
    statement: A judge's contradiction and a verification verdict are read from the append-only ledger and only fall back to the mutable JSON caches, so deleting or hand-editing contradiction.json or state.json cannot lift a block or certify a tree the last run did not judge; the decisions directory, the sources, the manifest and the machine-written state are exempt from a standing contradiction block, because editing the proposal or its reasoning is the documented way out of one.
    checks:
      - type: command
        run: node --test scripts/test-ratchet-guard.mjs
        expects: a block survives deleting contradiction.json and is lifted only by clearContradiction, and the decisions directory and sources stay writable while the governed zone does not
        timeoutMs: 300000
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: verificationStatus reports the ledger's verdict when state.json is hand-edited to disagree
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.a-repack-of-an-existing-version-carries-a-new-version
    statement: A tarball whose bytes differ from the copy committed at HEAD must carry a new package version, because pnpm resolves a file dependency by path string and an unchanged filename is served from the lockfile while the new bytes never land; the check is skipped, never passed, when git or the committed copy is unavailable.
    checks:
      - type: command
        run: node scripts/check-portability.mjs
        expects: a tarball repacked at an unchanged version fails tarball:version-bumped while a version bump passes
        timeoutMs: 300000
---

## Context

Six independent reviewers and breakers ran against this kit in scratch copies and falsified claims
it makes about itself. Almost every finding had the same shape: an enforcement point existed, the
gate ran it, and it could not fail for the reason it named. A check read only two hand-picked tool
names; a check accepted a quiz the caller composed; a block lived in a file the subject of the
block could delete; a supersession retired a ratified law through a path the removal guard did not
cover; a version clause named a check that compared bytes against the source, which a hand pack at
an unchanged version satisfies; a zone overlap test missed a whole-repository `**`; and the
`falsify` breaker reported a detection it could not attribute.

Two further findings were refuted by measurement — the corpus was not red at HEAD, and
`tracksSpecDocuments` does fall through as its docstring says — and the rest are recorded as still
open in `REVIEW.md` rather than silently dropped.

## Decision

Each falsified enforcement point is changed so that it fails for the reason it names. The specific
rules are the laws above: a consent answers only the ratchet's own question, a supersession answers
to the same authority as a removal, a zone id is a filename, a law declared twice governs both
zones, zone overlap is one conservative predicate, the append-only ledger outlives the caches it is
copied to, and a repack of an existing version carries a new version. The review infrastructure is
exempt from a standing contradiction block, because the documented way out of one is a write into
it.

## Reasoning

The review found the defect class this kit has now hit repeatedly: a rule implemented twice, with
the copies disagreeing, and a check built on the same premise as the code it checks, so neither can
see the premise missing. The fixes are written to remove the second implementation rather than
reconcile it — `globsMayOverlap` and `zonePathCovers` are single predicates; the ledger is the
authority and the JSON is a cache; the quiz is rebuilt and compared rather than trusted. Where a
rule cannot be enforced, the check is skipped with its reason rather than passed, which is the
distinction this record exists to keep.

## Consequences

- A caller who composes a quiz mints nothing, and the residual gap — a caller who reproduces the
  ratchet's exact question and answer by hand — remains the forge-a-file gap the rules state.
- A ratified decision can no longer be retired by an agent-authored record through `supersedes`,
  which makes the removal guard's stated intent true for both routes.
- `status` reads the append-only verdict, so a hand-edited `state.json` no longer certifies a tree.
- The regression tests named in the laws are the enforcement; a revert of any one of them makes the
  named command fail, and each was replayed against a reverted copy by the review that produced it.
- The rules are proposed, not in force: in the `shipped-plugins` zone only a human ratification puts
  them into effect, and until then they license the work they describe and add no law.
