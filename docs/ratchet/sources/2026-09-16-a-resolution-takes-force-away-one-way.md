# A resolution takes force away in exactly one of two ways

## The defect

ADR 0031 (ratified by 0038) declares, among its laws,
`lifecycle.a-resolution-is-an-ordinary-record-with-a-resolves-list`:

> A resolution is an ordinary decision record that **removes the losing laws, supersedes the
> losing record** and names both sides in a `resolves` list, so the corpus can audit which
> conflict was settled and by what.

Stated in one breath, that reads as two ways of taking force away that a resolution performs
together. The machinery cannot honour both, and the corpus has no green form in which it
could:

- `supersedes` takes every law the losing record declares out of force, so an `op: remove` of
  one of those laws has no target left and is reported `LAW_TARGET_DANGLING`;
- a record whose laws were removed one by one is still in force, so it cannot also be given
  the terminal status `supersedes` requires, and `RETIREMENT_STATUS_MISSING` fires.

ADR 0031's own Consequences already measured this and reported it rather than papering it
over. What it did not do is correct the law's statement. This amendment does.

## The correction

A resolution takes away force in **exactly ONE of two ways**, and each is a complete answer:

1. **`op: remove`** for a named law, while the record that declares it keeps governing. This
   is the surgical form, and the one a drafter should reach for when one law conflicts and the
   rest of the record still holds.
2. **`supersedes`** for a whole record, which then carries a terminal status. This is for a
   record being replaced.

A record that asks for both is refused as **`RESOLUTION_AMBIGUOUS`** by
`validateResolutions` in `plugins/ratchet/ratchet-compiler.mjs`, before the two symptoms
above can surface: a drafter is told which of the two shapes to keep instead of
reverse-engineering an unavailable removal target one stage later.

The `resolves` list stays part of the law. It is the audit of which conflict was settled and
by what, not a way of taking force away, so it is not what the old statement got wrong.

## Amendment, not edit

ADR 0031 is in force through a human ratification (ADR 0038). Editing it voids the consent
that put it in force, and re-declaring its law id is the corpus contradicting itself. So the
old law is `op: remove`d and the corrected rule is restated under a new id. Because the
compiler refuses a remove and an upsert of one id in one record, the restatement needs the
new id. A proposed record adds no law and removes none, so the gate stays green while this
waits for a human.

## The check, and the falsification

The corrected law is bound to `node --test scripts/test-ratchet.mjs`, a hermetic command. The
test `compiler: a resolution removes a named law or supersedes a whole record, never both`
asserts both halves: the surgical form compiles clean and leaves the rest of the losing record
governing, and the same resolution with `supersedes` added is refused with the code
`RESOLUTION_AMBIGUOUS`. Two further tests keep the `resolves` list honest: it carries exactly
two distinct ADR ids, and it may not name a record that is neither in force nor leaving it.

The falsification was run, not assumed: with the `RESOLUTION_AMBIGUOUS` refusal forced off in
a throwaway copy of the plugin, the test fails at its assertion, the corpus then reports
`LAW_TARGET_DANGLING` and `RETIREMENT_STATUS_MISSING` instead, and `node --test` exits 1. The
check can fail, so the law rests on a command rather than on prose.
