---
title: No Tests Driven Development
slot: rules
order: 200
status: active
---
## 9. No Tests Driven Development

**Do not write automated tests** — no test-first ordering, no test per change, no suite kept
beside the code, no test added "so the behaviour is covered". A test an agent writes about
code the agent just wrote restates that code's assumptions in a second place: it passes
because it was written to pass, it fails on a refactor that preserves the behaviour it claims
to protect, and somebody else maintains it afterwards.

- **Never create a test file, case, fixture or helper on your own initiative** — not to
  demonstrate correctness, not to guard a regression you imagine, not because another document
  mentions a test. If you did not run it, do not write it.
- **The one exception is a test the USER asks for**, as a verification or an evaluation. Write
  exactly what was asked and nothing more, say what it proves and what it leaves unproven, and
  ask before extending it.
- **Verify by running the product, not by writing a test.** Execute the command, read its
  output and exit code, open the file it wrote, and quote what you saw.
- **A failing check is information, not an invitation.** Never add, loosen, narrow or delete a
  test to make a check pass; report the failure and what it means.
- **Do not delete a test the user owns.** Prohibiting new tests is not permission to remove
  existing ones — ask first.

Nothing enforces this — no command fails when an unasked-for test is written, and no gate
inspects a diff for one — so do not go looking for the check.
