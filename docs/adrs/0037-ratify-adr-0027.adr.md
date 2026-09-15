---
id: "0037"
title: Ratify ADR 0027
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-15T18:13:40.003Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-ratification-0027.md
  hash: sha256:6c7e1782e9c1eb5835fc2cf873143d1e95abef2872c9c8aa051a5cbce7288488
zones: []
laws: []
supersedes: []
approves:
  - "0027"
ratification:
  channel: adr-panel
  at: '2026-09-15T18:13:40.003Z'
  askedBy: adr-panel session-085005b8-f069-4b9d-95d0-500096178360
  targets:
    - id: "0027"
      contentHash: sha256:66609c4bacb351d4d71e4da2bb79285cf499dffb83517c8d1f0a6039db76074c
---

## Context

- ADR 0027 — Every enforcement point the review falsified can now fail for the reason it names (docs/adrs/0027-every-enforcement-point-the-review-falsified-can-fail.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0027 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `shipped-plugins.a-consent-answers-a-question-the-ratchet-asked` — A consent is minted only from an answer to the question the ratchet builds for the records waiting — the same targets, the same two labels, and a frozen content hash for every one of them — so a caller-composed quiz with no frozen text mints nothing, while a record edited after the question was asked is still answered by the stale-text rule rather than by the shape check. (docs/adrs/0027-every-enforcement-point-the-review-falsified-can-fail.adr.md)
- `shipped-plugins.a-supersession-answers-to-the-same-authority-as-a-removal` — A record retires another through supersedes only if it could have removed the laws that record declares — a human-authored or human-ratified record may supersede anything, and an agent-authored unratified record may not supersede a human-authored record or one whose force came from a human ratification — so a refusal reports LAW_REMOVE_UNAUTHORISED and the target's laws stay in force. (docs/adrs/0027-every-enforcement-point-the-review-falsified-can-fail.adr.md)
- `shipped-plugins.a-zone-id-is-a-filename` — A zone id is restricted to [A-Za-z0-9_-], because the id names the zone's generated spec file and any lossy slug lets two ids share one file and drop a zone's laws from the human-readable view, so a manifest declaring any other character is refused with ZONE_INVALID. (docs/adrs/0027-every-enforcement-point-the-review-falsified-can-fail.adr.md)
- `shipped-plugins.a-law-declared-in-two-zones-governs-both` — When two active records declare the same law id and statement, the compiled law is bound to the union of the zones both named, and a contradiction against it blocks every one of them, because the same law in two zones is one law. (docs/adrs/0027-every-enforcement-point-the-review-falsified-can-fail.adr.md)
- `shipped-plugins.zone-overlap-is-one-predicate` — Whether two declared zone paths can cover a common path is decided by one shared predicate that is conservative rather than optimistic, so validateZones reports ZONE_OVERLAP for a whole-repository ** against a named zone and for a mid-path wildcard such as **/auth/**, where comparing stripped prefixes reported nothing. (docs/adrs/0027-every-enforcement-point-the-review-falsified-can-fail.adr.md)
- `shipped-plugins.the-append-only-record-outlives-its-cache` — A judge's contradiction and a verification verdict are read from the append-only ledger and only fall back to the mutable JSON caches, so deleting or hand-editing contradiction.json or state.json cannot lift a block or certify a tree the last run did not judge; the decisions directory, the sources, the manifest and the machine-written state are exempt from a standing contradiction block, because editing the proposal or its reasoning is the documented way out of one. (docs/adrs/0027-every-enforcement-point-the-review-falsified-can-fail.adr.md)
- `shipped-plugins.a-repack-of-an-existing-version-carries-a-new-version` — A tarball whose bytes differ from the copy committed at HEAD must carry a new package version, because pnpm resolves a file dependency by path string and an unchanged filename is served from the lockfile while the new bytes never land; the check is skipped, never passed, when git or the committed copy is unavailable. (docs/adrs/0027-every-enforcement-point-the-review-falsified-can-fail.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-15-ratification-0027.md instead of trusted.

Each approved record is bound to the hash it had when the question was asked, so this approval covers that text and
not a later revision of it. An approval that named only a title would keep
approving whatever the file said next, which is how a decision gets substituted
past the person who read it. The text itself is not copied here: it is the record,
committed beside this approval, and the hash is what makes a substitution visible
rather than silent.

Project: dsh-kit

## Consequences

- Editing any ratified record voids this approval: the compiler reports `RATIFICATION_STALE` and the law leaves force until it is ratified again.
- The law set changed, so the spec bundle must be recompiled and the code re-verified before anything is called checked.
- This approval confers force only. The ratified records keep their own author authority, so a ratified agent record still cannot govern a zone reserved to humans.
