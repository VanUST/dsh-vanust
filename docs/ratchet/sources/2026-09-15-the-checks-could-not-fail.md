# The checks that could not fail for the reason they name

An independent review dispatch — six reviewers and breakers, each working in a scratch copy —
falsified claims this kit makes about itself. The findings were not random: nearly all of them had
the same shape. An enforcement point existed, the gate ran it, and it could not fail for the reason
it named. A check pointed at the wrong input, or at two hand-picked names, or at a file the subject
of the check can delete, or at a version comparison that can never be false. This source records the
decisions taken to close them.

## 1. A consent answers a question the ratchet asked

**Decision.** `ratify` accepts a quiz only if it is the question the ratchet builds for the records
now waiting: the same targets, the same two labels, and a frozen content hash for every one of them.
A quiz whose frozen list is empty, whose labels differ, or whose targets differ is refused as
`RATIFICATION_UNPROVEN` and mints nothing. A quiz that IS the ratchet's question but whose frozen
hash no longer matches the file is still answered by the stale-text rule (`RATIFICATION_STALE`),
because that is a statement about the answer, not about the shape of the question.

**Reasoning.** A breaker showed that `ratify` accepted any object with a `roles` map, and that a
`frozen` entry whose `contentHash` was null skipped the stale-text comparison entirely. A
caller-composed quiz with `frozen: []` therefore minted a real approval, wrote its transcript, and
put a law into force with no human ever asked. The function already refused an answer with no quiz at
all — "an answer with no quiz is not a consent, it is a string" — but it never checked that the quiz
it was handed was one it had built. The hash a consent covers is only meaningful if the question
that produced it is the ratchet's; otherwise the caller chooses both the question and the answer.
The residual gap is unchanged and stated in the rules: a caller who writes that exact question by
hand is writing a consent file, and nothing in a file-based mechanism can tell the two apart. What
this closes is consent derived from a question the ratchet never asked.

## 2. A supersession answers to the same authority as a removal

**Decision.** A record retires another record through `supersedes:` only if the superseder could
have removed the laws that record declares: a human-authored record or a human-ratified record may
supersede anything, and an agent-authored, unratified record may not supersede a human-authored
record or a record whose force came from a human ratification. A refused supersession reports
`LAW_REMOVE_UNAUTHORISED` and the target's laws stay in force.

**Reasoning.** The law loop already refuses an agent-authored, unratified record that removes a law
whose force came from a human ratification: "Consent is not durable if the next record can undo it."
Supersession ran earlier and retired the whole record, so every law it contributed left the bundle
before the law loop could see it. A breaker demonstrated the consequence: a ratified decision
retired by one agent-authored ADR, the compile reporting `ok: true`, no law, and no problem, while
the equivalent `op: remove` was refused. A rule implemented twice with the copies disagreeing is the
defect class this kit keeps finding; here the disagreement was between two removals, and only one of
them was guarded. A human-authored record is protected for the same reason at a larger scale:
retiring a person's decision wholesale is a stronger act than removing one of its laws.

## 3. A zone id is a filename, and two zones cannot share one

**Decision.** A zone id is restricted to `[A-Za-z0-9_-]+`. The generated spec filename is the zone
id, so the mapping from id to file is injective by construction. A manifest declaring any other
character is refused with `ZONE_INVALID`.

**Reasoning.** `compile` named each generated spec `<zone with every character outside
[A-Za-z0-9_-] replaced>.spec.md`. That replacement is not injective: zones `auth.v1` and `auth-v1`
compiled to one file, and the second zone's laws were silently dropped from the generated view of
them — the human-readable spec, which exists to be read, disagreed with the laws it claimed to
describe, and no check noticed. Restricting the id is the fix that removes the class rather than the
instance; every accepted id already equals its own slug, so no existing project changes filename.

## 4. A law declared by two records governs the union of their zones

**Decision.** When two active records declare the same law id and statement, the compiled law's
`zones` is the union of the zones both declared, and a judge's contradiction against that law blocks
all of them.

**Reasoning.** The compiler kept the first declaration and ignored the second record's zones
entirely, and `blockedZones` mapped a law to the single `sourceAdr` the bundle carried. A breaker
put a law in force in two zones, recorded a contradiction against it, and showed that a write into
the second zone was allowed — while the law's own statement claims to govern both. "The same law in
two zones is one law", as the compiler's own comment says, and one law has one set of zones.

## 5. Zone overlap is decided by one predicate

**Decision.** Whether two declared zone paths can cover a common path is decided by one exported
predicate, `globsMayOverlap`, which walks both patterns segment by segment and answers `true` as soon
as neither side can rule the other out. Two concrete segments that differ prove disjointness; that
is the only `false`. `validateZones` uses it instead of comparing stripped prefixes.

**Reasoning.** The prefix comparison missed a whole-repository `**` (which covers everything) and a
mid-path wildcard such as `**/auth/**`, so two zones with different agent authority could be declared
over the same files and the manifest accepted it. The failure is deliberately on the conservative
side: reporting an overlap that a narrower path would remove is a project the author can fix, while
missing one leaves a file whose authority is decided by resolution order.

## 6. The append-only record outlives the cache it is copied to

**Decision.** The judge's contradiction is written to the append-only ledger as a recorded event,
and clearing it appends a cleared event; `readContradictions` folds the ledger when it holds any such
event and falls back to the JSON cache otherwise. The verification verdict `status` reports is read
from the ledger's last `ratchet.verify.finish` event, not from the mutable `state.json`. The review
infrastructure — the decisions directory, the sources, the manifest and the machine-written state —
is exempt from a standing contradiction block.

**Reasoning.** A breaker deleted `.dsh/ratchet/contradiction.json` and the guard, which read only
that file, went from DENIED to ALLOWED: a block recorded by a judge was lifted by one `rm`, though
the tool output says the file is machine-written and not to be edited. Separately, hand-editing
`state.json` made `status` report a verified-clean project while `verify` on the same tree exited 1.
The ledger is the artifact both features describe as the audit trail — append-only, one event per
run — so it is where the answer has to come from, and the mutable file is a cache. The exemption is
the other half of the same defect: the documented way out of a block is to edit the proposal, or to
edit the reasoning a record cites, and a guard that refuses those writes has no exit at all.

## 7. A repack of an existing version carries a new version

**Decision.** `check-portability.mjs` fails when a tarball's bytes differ from the copy committed at
HEAD while its package version is unchanged. The comparison is skipped, rather than passed, when
git or the committed copy is unavailable.

**Reasoning.** The kit's own rule says a tarball's version is bumped whenever its bytes change, and
named `check-portability` as the enforcement. The check it named compared the tarball with the
SOURCE, which a hand `pnpm pack` at an unchanged version satisfies perfectly, so the version clause
of the rule had no failure behind it. pnpm resolves a `file:` dependency by path string: an unchanged
filename is served from the profile lockfile and the new bytes never land, which is exactly what the
clause exists to prevent. Comparing against HEAD makes the clause a fact about the change in flight.
