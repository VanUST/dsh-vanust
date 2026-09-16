---
id: "0056"
title: A stale generated spec is advisory with a drafted withdrawal note, while an edited, missing or orphaned one still blocks
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-16T09:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-16-stale-spec-is-advisory.md
  hash: sha256:20e9feec263ed2b2056e24951d8494680ba241bd39fd17555f4d8876e38db76c
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  # ADR 0012 is in force through a human ratification (ADR 0013), so its law text and source are
  # frozen with that consent: editing either voids it (`RATIFICATION_STALE`) and re-declaring the
  # same law id is the corpus contradicting itself. The old law is therefore REMOVED here and
  # restated, narrowed, under a new id bound to the command that fails when the narrowing stops
  # holding. A removal carries no constraint to check, so it states an `unenforced` reason.
  - op: remove
    id: shipped-plugins.specs-cannot-drift-silently
    checks: []
    unenforced: "a removal carries no constraint to check; the narrowed rule is restated under a new id bound to a hermetic command"
  - op: upsert
    id: shipped-plugins.spec-stale-is-advisory-others-still-block
    statement: A generated spec document that is unedited but was written from an older law set is reported as an advisory drift fact with the withdrawal note the RATCHET drafts for it, and does not enter the blocking problem list, so a regeneration is asked for rather than a green gate withheld; a document that was hand-edited after it was written, or is missing while the project tracks generated specs, or is orphaned because no decision in force generates it any more, is still reported as a blocking problem.
    checks:
      # Behavioural: the script compiles a corpus with generated specs and corrupts one
      # situation at a time, requiring a stale document to be reported in the advisory
      # `specDrift.stale` list with a drafted withdrawal-note path and NOT to be a problem,
      # while an edited, deleted or orphaned document is a problem. A test name, or an output
      # string a green run prints anyway, would be satisfied by an emptied test.
      - type: command
        run: node scripts/check-gate-invariants.mjs
        expects: a stale generated spec is reported with a drafted withdrawal note and does not block, while an edited, missing or orphaned one still does
        timeoutMs: 180000
        outputContains: gate invariants ok
---

## Context

The in-force law `shipped-plugins.specs-cannot-drift-silently` (ADR 0012, ratified by approval
0013) reports four situations as one blocking problem: a generated spec document that was
hand-edited, one that is missing while the project tracks generated specs, one that is stale —
unedited, but written from an older law set — and one that is orphaned because no decision in
force renders it any more. The four are not the same kind of event. A stale document is
structurally correct and differs only in the spec hash its own header carries; the other three
are evidence that the human-readable view is WRONG rather than merely old.

The decision was taken on 2026-09-16 and recorded in `LIMITATIONS.md` §3.4:

> **A stale specification is reported with a drafted withdrawal note and never blocks the gate.**
> Decided 2026-09-16: only the hash-behind kind becomes advisory — a hand-edited, missing or
> orphaned document still blocks — which needs an amendment to ADR 0012 (its law is in force as
> `shipped-plugins.specs-cannot-drift-silently`).

## Decision

The spec-drift law is **removed and restated, narrowed, under a new id**:

- `shipped-plugins.spec-stale-is-advisory-others-still-block` ←
  `shipped-plugins.specs-cannot-drift-silently`

Under the restated law:

1. A **stale** generated document is reported as an advisory drift fact carrying the withdrawal
   note the ratchet drafts for it, and does NOT enter the blocking `problems` list.
2. A **drifted** (hand-edited), **missing**, or **orphaned** document is still a blocking
   problem.

The stale document's withdrawal note is written by the **ratchet's own drafting pass**
(`ratchet-drafts.mjs`, `draftNeedsHuman`), which `ratchet compile` invokes and the ADR panel's
read-only view also runs. No agent and no model decides to write it, and the ratchet never
applies it: it does not delete or regenerate the document. Deletion and regeneration remain the
human's acts.

## Reasoning

The reasoning source is `docs/ratchet/sources/2026-09-16-stale-spec-is-advisory.md`, whose hash
this record pins. It states why a regeneration-shaped red gate is one people disable, why the
other three kinds are different in kind, why this ships as an amendment rather than an edit to a
ratified record, that the withdrawal note is drafted by the ratchet and never applied, and
exactly what the named command asserts.

The check is `node scripts/check-gate-invariants.mjs`. Its previous assertion — that a stale
document is a blocking `SPEC_OUT_OF_DATE` — is the revert counterexample: restoring it makes the
command fail against the implemented behaviour, which is why the law cannot be satisfied by an
emptied test.

## Consequences

- **Until a human ratifies this record the old law stays in force**, and the narrowed behaviour
  is already implemented and asserted by the updated command. A stale document is no longer a
  blocking problem in `compile`, `verify` and `status`; it is reported in `specDrift.stale` with
  the drafted note's path, and the ADR window shows it as a needs-a-human entry carrying that
  note.
- **A known interaction, stated plainly.** The ratchet's ratification queue reads any proposed
  record that removes law in force as a decidable contradiction and blocks it from being put to
  a human. This amendment is therefore reported as a contradiction — with no drafted resolution,
  because the drafting pass recognises an amendment that restates the decision under a new law
  id and drafts nothing against it — and the queue currently refuses it. Making the queue OFFER
  an amendment to a human instead of refusing it is a change to a ratified rule and is not made
  by this record; it is named here so the failure is visible rather than discovered.
- **The old law remains in force until ratification**, and its check passes while its statement
  no longer describes the behaviour. That gap closes when a human ratifies this amendment and
  the old law leaves force. It is stated rather than hidden: a narrower statement is the point
  of the amendment, and a statement broader than its check is the defect being fixed.
- Nothing in the generated spec documents is deleted or rewritten by this decision; the change
  is to which drift kinds the gate treats as blocking.
