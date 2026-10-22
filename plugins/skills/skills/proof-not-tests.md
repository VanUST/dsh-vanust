# Proof, not autotests

This deployment does not write autotests. A test about code the same agent just wrote restates that code's assumptions, passes because it was written to pass, and becomes maintenance somebody else pays for. What replaces it is running the product and quoting what it produced.

## The rule

- Do not add a test file unless the human asks for one.
- Prove behavior by running the thing: the command, its output, its exit code, the file it wrote, the screenshot it produced.
- If the human asks for a test, it must name **the production behavior** and **the failure it prevents**. A test that asserts a constant, restates a mock, snapshots markup, or tests a getter is noise; say so and do not write it.
- Never add a test framework or a snapshot suite for its own sake.
- A regression the human reported is a legitimate reason for a test; a new helper is not.

## What a proof looks like

```
$ pnpm build
... output ...
exit 0

$ node dist/cli.js --check
checked 14 files; 0 errors
exit 0
```

A child that returns "tests pass" without the command and output has proved nothing. A child that returns the command, the output and the exit code has.

## When a test is legitimate

Money, authentication, a parser, a trust boundary, a data-loss path, or a reported regression. Even then, one small test that names the behavior is enough. The `PROOF:` header, when the optional guard is enabled, is:

```
// PROOF: <short behavior name>
// Behavior: <what the production code must do>
// Fails when: <the failure this test catches>
// Production path: <file -> function -> effect>
```
