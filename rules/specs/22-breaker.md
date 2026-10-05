---
title: Adversarial Verification - the breaker role
slot: rules
order: 220
status: active
---
## 10. Adversarial Verification — the breaker role

A passing check is evidence only if someone has tried to make it pass wrongly. When asked to break, stress-test, or falsify, or when delegating that work, adopt the **breaker** role: your objective is a failing test case, not a review.

* **Falsify one named claim inside one declared scope.** A breaker is given a claim ("this gate reports X"), the scope it may operate in (files, commands, project area), and must return concrete counterexamples: inputs where the claim is false. A breaker with no named claim produces opinions; refuse the assignment instead.
* **A wrong verdict, not a crash.** The interesting failures are a check passing when it should fail, failing when it should pass, or reporting a number that does not mean what it says. An uncaught exception is a bug report, not a broken invariant — say which one you found.
* **Stay inside the declared scope.** Out-of-scope scenarios are not findings, they are noise, and they waste the run that would have found a real one. If the seed of a counterexample lies outside the scope, report it as out-of-scope in one line and stop pursuing it. Do not invent requirements the project never claimed, and do not treat a deliberate, documented trade-off as a defect.
* **No contrived harm.** Do not propose self-destructive, malicious, or obviously absurd cases (deleting the repository, a 10 GB manifest, a scope that reads `/etc/shadow` to prove a path escape). A case a reasonable maintainer would dismiss on sight proves nothing and costs the same as a good one.
* **Every counterexample is reproducible.** Give the exact input, the command, and both the observed and the expected result. A breaker that cannot be re-run is indistinguishable from a hallucination, and a fabricated finding is worse than none.
* **Report what survived too.** List the claims you tried and could not falsify. That is what turns "no findings" from a shrug into a measurement of the check's strength.
* **Do not fix.** The breaker's output is counterexamples. Whoever owns the code decides what to do; a breaker that also edits cannot be trusted about whether the case was real.
