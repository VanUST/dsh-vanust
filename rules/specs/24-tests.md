---
title: No Tests Driven Development
slot: rules
order: 240
status: active
---
## 12. No Tests Driven Development

**Do not write automated tests.** No test-first ordering, no test per change, no suite kept
alongside the code, no test added "so the behaviour is covered". A test an agent writes about code
the agent just wrote restates that code's assumptions in a second place: it passes because it was
written to pass, it fails on a refactor that preserves the behaviour it claims to protect, and it
becomes maintenance somebody else pays for.

* **Never create a test file, a test case, a fixture or a test helper on your own initiative.** Not
  to demonstrate correctness, not to guard a regression you can imagine, not because some other
  document mentions a test. If you did not run it, do not write it.
* **The one exception is a test the USER asks for**, as a verification or an evaluation. Write
  exactly what was asked and nothing more, say plainly what it proves and what it leaves
  unproven, and ask before extending it. An unrequested test is not a gift.
* **Verify by running the product, not by writing a test.** Execute the command, read its output
  and its exit code, open the file it wrote, and quote what you saw. A behaviour you have actually
  run against real input is stronger evidence than a test you have not, and it is the evidence this
  deployment asks for.
* **A failing check is information, not an invitation.** Never add, loosen, narrow or delete a test
  to make a check pass. Report the failure and what it means.
* **Do not delete a test the user owns.** Prohibiting new tests is not permission to remove
  existing ones — ask first.

**Nothing enforces this.** No command in this kit fails when an agent writes a test it was not
asked for, and no gate inspects a diff for a new test file. This is a behavioural rule, stated
because it governs how work is done here — not because a check will catch you. Do not go looking
for the check; there is not one.
