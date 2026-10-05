---
title: Tests Verify Behaviour, Not Shape
slot: rules
order: 240
status: active
---
## 12. Tests Verify Behaviour, Not Shape

Test the PRODUCT, not the code's outline. A suite is a SMALL number of tests that exercise what
the product does — the command's output and exit code, the file it writes, the state it records,
the result an API returns — because that is what a user or another system observes, and it is
the only thing a passing test can honestly claim.

* **A few general behaviour tests, not a test per file or function.** Do not write a test whose
  subject is "this function returns X" or "this module has Y". Those pin the shape of the code,
  break on every refactor, and pass while the behaviour they name is broken. If a behaviour
  matters, it is reachable through a seam the product itself exposes: drive that.
* **One test per behaviour, not per branch.** Cover the behaviour that rests on a decision — "a
  failing call is retried 5 times and the 6th never happens" — not every intermediate value the
  implementation happens to compute. A small suite that walks the real paths beats a large one
  that mirrors the code.
* **Derive expectations by hand.** Literals and hand-checked fixtures, never the code under test
  or its helpers — `expect(f(x)).toBe(f(x))` passes no matter what `f` does.
* **A mock earns no assertion.** Assert what the real component produced; if the only thing you
  can check is that a mock was present or called, delete it and drive the real thing.
* **Test what a contract depends on, or what the product got wrong before** — not whatever is
  easiest to reach.
* **The enforcement point is `node scripts/check-test-quality.mjs --root . --strict`.** Run it and
  follow its output: it names each shape-only assertion and how to exempt one you have judged and
  accept. It cannot see how many tests a suite holds or whether they exercise behaviour, so
  keeping the suite small and behavioural is on you.
