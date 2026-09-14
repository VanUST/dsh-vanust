# Breaker report: the gate's verdicts, falsified

Date: 2026-09-14. Scope: `plugins/ratchet/ratchet-{schema,compiler,verifier,state,ops,cli}.mjs`
and the law corpus in `docs/adrs/`. Claim under test: **no input makes the gate report
the wrong verdict.** Verdict: FALSIFIED, in nine reproducible findings.

This file is the reasoning behind ADR 0009. It records what was measured, because the
decision it justifies is a change to how the kit enforces its own laws.

## What was found

| # | Finding | Shape |
|---|---|---|
| F1 | `forbidden_text_glob` over a selection that matches nothing | false pass |
| F2 | `verify` reported `ok` with zero checks evaluated (an all-`unenforced` corpus) | false pass |
| F3 | `path_boundary` with a leading-`**` deny | false failure |
| F4 | `required_file_in_list` never checked that its subject exists | false pass |
| F5 | `deny: []` and `pattern: ""` accepted as checks that can never fail | false pass |
| F6 | A law enforced by `outputContains: "fail 0"` survived a mutation plus a deleted test body | false pass |
| F7 | The default command stream joined stdout and stderr into one string | false pass and false failure |
| F8 | `status` reported a verified, clean project after the code changed | false pass |
| F9 | The human-readable report never printed how many checks were pending | visibility |

F3 and F7 are the interesting ones: they are failures in the *other* direction. A gate
that reports a law broken when it holds teaches its readers to ignore it, which costs
more than the false pass it was trying to prevent.

## The finding that changed the enforcement model (F6)

Every law in the corpus was enforced by a `command` check whose assertion read a test
runner's output — `outputContains: "fail 0"`. The breaker measured the consequence in
three steps on a fresh copy:

1. pristine → gate exit 0;
2. mutate the verifier so a law with no check and no stated reason passes silently →
   gate exit 1 (the gate catches it);
3. the same mutation, plus deleting the **body** of the single test that covered that
   invariant while keeping its name → suite reports `239 pass / 0 fail`, and the gate
   exits 0 with the invariant broken.

`fail 0` is a constant of any green run; a test file with no tests at all prints it.
No assertion over a test runner's output can distinguish "the test asserted" from "the
test exists", because a test that asserts nothing passes.

## What was decided because of it

The failing invariants were fixed in the modules that produced them (schema refusals for
F5, a proof-based overlap test for F3, an existence check for F4, per-stream output
assertions for F7, a code hash bound into the verification record for F8, and the
`VERIFY_NOTHING_EVALUATED` / `VERIFY_INCOMPLETE` pair extended to cover F2 and F9).

For F6 the fix is structural rather than local. `scripts/check-gate-invariants.mjs` is a
new enforcement point that drives the production modules over synthetic projects and
requires each wrong verdict to be refused. It is deliberately not a test: a test can be
gutted while keeping its name, which is exactly the attack that worked. Its assertions
fail when the production behaviour changes, so hiding a mutation now requires editing the
verifier AND the enforcement point named by the law.

The residual limit is stated rather than hidden: an agent that edits both the module and
the script that checks it can still pass, because a self-verifying system has no external
reference point. What the design buys is that the edit is two files, one of which is
named by a law, instead of one deleted test body.
