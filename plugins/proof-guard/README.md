# @cc/dsh-proof-guard

No pointless autotests, enforced where a test file is actually written.

A `tools/pre-execute` waterfall watches `write` and `edit`. When the target
matches a test path — `*.test.*`, `*.spec.*`, `__tests__/`, `tests/`, `test_*.py`,
`*_test.go` — it requires a `PROOF:` header naming the production behavior and
the failure the test prevents:

```ts
// PROOF: charge rounding
// Behavior: a 10.005 total with a 2-decimal currency rounds half-up to 10.01.
// Fails when: the shared rounding helper uses banker's rounding or floats.
// Production path: src/billing/charge.ts -> roundCurrency() -> invoice total.
```

An edit to a file that already carries the header is allowed, so legacy files are
not trapped. `mode: warn` logs and allows; use it for a trial week before
`mode: deny`.

This is friction, not proof. A determined writer can fake the header; the human
review and the handoff evidence remain the real check. A test written through a
shell command is outside this seam.
