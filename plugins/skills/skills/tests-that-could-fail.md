# Tests that could fail

A test earns its place only if it can fail for a reason other than "somebody edited the test".

Agents produce a specific failure here: a test written after the code, against the code's own assumptions, that asserts what is *definitely true* and passes forever. It raises the suite's count, proves nothing, and costs a future maintainer. The defence is mechanical, not moralistic: **every check must name the production change it would catch, and you must watch it go red before you accept it.**

## The rule in one line

If you cannot describe, in one sentence, a plausible one-line production change that makes this check fail, delete the check.

## Make it fail first

1. Write the check against the behaviour you *expect*, not the value you just observed.
2. Run it against the current tree. It must fail, and fail **for the stated reason** — read the failure, not just the exit code.
3. Only then make it pass.
4. Re-read the assertion: if removing the feature would still pass it, the check is decorative. Delete it, or replace it with one that dies.

A test that passed the first time you ran it has demonstrated nothing except that your test runs.

## What reward-hacked checks look like

| Shape | Why it proves nothing |
|---|---|
| `expect(true).toBe(true)`, `assert 1 == 1` | No production code is involved. |
| Asserting a value you configured in the same test | Restates the setup, not the behaviour. |
| Asserting on a mock you told what to return | Tests the mock. |
| Snapshotting markup or JSON and accepting the output | Records the implementation; fails on any rename, passes through real regressions. |
| Testing a getter, a constant, a type, a constructor | The language already guarantees it. |
| `try { ... } catch {}` in the test body | Swallows the failure it exists to report. |
| An async check whose promise is never awaited | The assertion runs after the test has passed. |
| Asserting a library or frameweork behaves as documented | Not your behaviour. |
| Coverage-driven tests with no assertion | Raises the number, not the knowledge. |
| Testing private structure ("calls helper twice") | Breaks on refactor, blind to behaviour. |

## The mutation question

For every assertion, name a mutation it catches. Useful mutations are the ones a careless edit produces:

- flip a comparison (`>=` → `>`, `<` → `<=`);
- change a boundary (`18` → `19`);
- return early / skip a branch;
- swap `&&` for `||`;
- change a default value or a fallback;
- drop the error path (`throw` → silent return);
- reorder two side effects.

If a mutation survives — the check still passes — the check is weak *even if it is green*. This is mutation testing done by hand; a tool (Stryker for JS/TS, `mutmut`/`cosmic-ray` for Python) automates exactly this and is worth running on a critical module. Surviving mutants are the report.

## Design from the risk, not from the code

Two checks written from a real risk beat ten written from the file listing. Ask: what would hurt if it broke silently? Then:

- **One** check for the main path, asserting an observable outcome.
- **One** check for the boundary the code is most likely to get wrong (empty, zero, one, max, negative, duplicate, missing).
- **One** check for the failure path, if the code has one: the error is what users meet.
- Skip the rest. A short suite that dies on real breakage is worth more than a long one nobody trusts.

## Properties beat examples when the oracle is cheap

If a property is easier to state than the expected value, assert the property over many inputs (property-based testing: Hypothesis, fast-check, QuickCheck). Good properties:

- round-trip: `parse(render(x)) == x`;
- idempotence: `normalize(normalize(x)) == normalize(x)`;
- invariance: sorting does not change the multiset of elements;
- ordering: `a < b` implies `rank(a) <= rank(b)`;
- metamorphic: doubling the input doubles the output; adding an element adds one row.

Where no oracle exists at all (rendering, search ranking, model output), **metamorphic** checks are what remain: transform the input in a way whose effect on the output you can predict, then assert that effect.

## Verification that is not a test

Behaviour is proven by running the product, and that evidence is stronger than a green unit test because it exercises the real integration points:

- the command, its stdout, and its **exit code**;
- the file it wrote, read back and quoted;
- the screenshot or accessibility snapshot of the rendered result;
- the row in the database, the entry in the log, the request in the network tab;
- the negative case run too, so "it works" does not only mean "the happy path did not throw".

A passing suite is evidence for exactly the behaviours it exercises, and nothing else. Say so when you report: *"the suite passes"* is not *"the feature works"*.

## When you claim it works

State three things: what you ran, what it printed, and what that proves. If a piece was untested, name it. An honest gap is a smaller failure than a fabricated success, and a reader can act on it.

## Review checklist

- [ ] Each check names the production change it catches.
- [ ] Each check was seen red for the stated reason before green.
- [ ] No assertion restates its own setup or a mock's configuration.
- [ ] No snapshot accepted without a human reading the diff.
- [ ] Async work is awaited; no swallowed exceptions.
- [ ] Boundaries covered: empty, zero, one, max, malformed.
- [ ] The failure path is asserted once, not only the happy path.
- [ ] At least one check would survive a rename but die on a behaviour change.
- [ ] Tests are isolated: order-independent, no shared mutable state.
- [ ] The evidence quoted in the report is the run you actually did.

## Sources

Adapted for this deployment from public practice: Kent Beck's [Test Desiderata](https://testdesiderata.com/) (behavioural, structure-insensitive, deterministic, specific, predictive), [mutation testing](https://stryker-mutator.io/docs/) (surviving mutants as the quality signal), and property-based testing (Hypothesis, fast-check, QuickCheck).
