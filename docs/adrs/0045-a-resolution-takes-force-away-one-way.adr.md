---
id: "0045"
title: A resolution takes force away in exactly one of two ways
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-16T07:10:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-16-a-resolution-takes-force-away-one-way.md
  hash: sha256:e4240b253cdfa5ea6de762a3b608e821c4c4fbc52ed2810eb4f27cbf2f3772d9
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  # ADR 0031 is in force through a human ratification (ADR 0038), so the ambiguous law may not
  # be edited and may not be re-declared: it is removed here and restated under a new id bound
  # to a hermetic command. A removal carries no constraint to check.
  - op: remove
    id: lifecycle.a-resolution-is-an-ordinary-record-with-a-resolves-list
    checks: []
    unenforced: "a removal carries no constraint to check; the corrected rule is restated under a new id bound to a hermetic command"
  - op: upsert
    id: lifecycle.a-resolution-takes-force-away-in-exactly-one-of-two-ways
    statement: A resolution is an ordinary decision record that names both sides of the conflict it settles in a `resolves` list and takes away force in exactly ONE of two ways — `op: remove` for a named law while the record that declares it keeps governing, or `supersedes` for a whole record, which then carries a terminal status; a record that asks for both is refused as `RESOLUTION_AMBIGUOUS`, because supersession already takes every law the record declares out of force and a record emptied law by law is still in force.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the surgical form removes one law and leaves the rest of the losing record governing, and the same resolution with supersedes added is refused with the code RESOLUTION_AMBIGUOUS
        timeoutMs: 300000
        outputContains: "a resolution removes a named law or supersedes a whole record, never both"
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the resolves list carries exactly two distinct ADR ids, so naming one side only cannot settle anything
        timeoutMs: 300000
        outputContains: "the field carries exactly two distinct ADR ids"
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a resolution naming a record that is neither in force nor leaving it is refused by the corpus audit
        timeoutMs: 300000
        outputContains: "a resolution naming a record that is neither in force nor leaving it"
---

## Context

ADR 0031 (ratified by 0038) declares one law that states a resolution's two ways of taking
force away in one breath — `lifecycle.a-resolution-is-an-ordinary-record-with-a-resolves-list`:

> A resolution is an ordinary decision record that removes the losing laws, supersedes the
> losing record and names both sides in a `resolves` list.

Read literally, a resolution does both. The machinery cannot honour both, and the corpus has
no green form in which it could:

- `supersedes` takes every law the losing record declares out of force, so an `op: remove` of
  one of those laws has no target left and is reported `LAW_TARGET_DANGLING`;
- a record whose laws were removed one by one is still in force, so it cannot also carry the
  terminal status `supersedes` requires, and `RETIREMENT_STATUS_MISSING` fires.

ADR 0031's own Consequences measured this and reported it rather than papering it over, but
the law's statement was left stating both. Meanwhile the refusal that makes the combination
decidable — `RESOLUTION_AMBIGUOUS`, raised by `validateResolutions` in
`plugins/ratchet/ratchet-compiler.mjs` — is enforced and tested but was itself no law.

## Decision

The ambiguous law is `op: remove`d and the corrected rule is restated under a new id,
`lifecycle.a-resolution-takes-force-away-in-exactly-one-of-two-ways`:

1. **`op: remove`** for a named law, while the record that declares it keeps governing. The
   surgical form, for one conflicting law in a record that still holds.
2. **`supersedes`** for a whole record, which then carries a terminal status. For a record
   being replaced.

A record that asks for both is refused as `RESOLUTION_AMBIGUOUS`, before either symptom can
surface. The `resolves` list stays part of the law — it is the audit of which conflict was
settled and by what, not a way of taking force away, so it is not what the old statement got
wrong.

The restated law is bound to the hermetic command `node --test scripts/test-ratchet.mjs`
through three tests: the one-way rule and its `RESOLUTION_AMBIGUOUS` refusal, the `resolves`
list's exactly-two-distinct-ids rule, and the refusal of a record that is neither in force nor
leaving it.

This is an amendment, not an edit. ADR 0031 is in force through a human ratification, so
editing it voids the consent (`RATIFICATION_STALE`) and re-declaring its law id is the corpus
contradicting itself. A proposed record adds no law and removes none, so the gate stays green
while this waits for a human.

## Reasoning

The reasoning source is
`docs/ratchet/sources/2026-09-16-a-resolution-takes-force-away-one-way.md`, whose hash this
record pins. It states the defect, the correction, and the amendment's shape.

The refusal was confirmed **falsifiable before it was bound**. In a throwaway copy of the
plugin, forcing the `RESOLUTION_AMBIGUOUS` branch of `validateResolutions` off made
`compiler: a resolution removes a named law or supersedes a whole record, never both` fail at
its assertion: the corpus then reported `LAW_TARGET_DANGLING` and `RETIREMENT_STATUS_MISSING`
instead of the named code, and `node --test` exited 1. The positive run passes. Binding the
law to that command is therefore not a claim on credit.

## Consequences

- The law stops stating both ways at once. A drafter reading it learns that the two shapes are
  alternatives and that the surgical form is the default when only one law conflicts.
- **The `resolves` list keeps its law.** The old law bundled the list with the two ways; the
  restated law keeps the list and bound it to the two tests that audit it, so the correction
  does not silently drop the audit.
- Until ratification the old law stays in force unchanged and this restatement adds nothing.
  After ratification the old law leaves force and the corrected one enters it.
- The check is hermetic: `node --test scripts/test-ratchet.mjs` runs with no server, no port
  and no nested process.
- The rule is scoped to the compiler's refusal. It does not claim that a drafted resolution is
  always well-formed, only that the corpus refuses one that asks for both ways.
