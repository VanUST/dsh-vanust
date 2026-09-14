---
id: "0009"
title: A law's enforcement is checked behaviourally, not by a test's name
type: adr
status: active
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-14T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-14-breaker-gate-verdicts.md
  hash: sha256:8a6eca549129084ff83736aae766995924e4e0069519f3254920b6dd4160a021
zones:
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: kit-tooling.enforcement-is-checked-behaviourally
    statement: An invariant the kit enforces with a command is checked by driving the production modules and requiring the wrong verdict to be refused, so an enforcement point never rests on a test name or on output a green run prints anyway.
    checks:
      # The command asserts a MARKER the script prints only after every invariant held,
      # so a partial run, a crash, or a silently emptied loop cannot satisfy it. The
      # script itself is the enforcement point this law names, and it fails when the
      # verifier's verdict for any of these invariants changes.
      - type: command
        run: node scripts/check-gate-invariants.mjs
        expects: every gate invariant is refused when it is broken
        timeoutMs: 120000
        outputContains: gate invariants ok
  - op: upsert
    id: kit-tooling.verification-is-bound-to-the-code
    statement: A recorded verification names the code it judged as well as the laws it judged, so a status cannot report a clean, verified project over a tree the gate rejects.
    checks:
      - type: command
        run: node scripts/check-gate-invariants.mjs
        expects: the code hash covers file contents and changes when they change
        timeoutMs: 120000
        outputContains: gate invariants ok
---

## Context

A breaker was given one claim — *no input makes the gate report the wrong verdict* — and
falsified it nine times. Five were false passes, where a law that did not hold was
reported clean; two were false failures, where a law that held was reported broken with a
reason that was provably untrue; one was a status that survived arbitrary code edits; one
was a human-readable report that never said how many checks had not run.

The finding that decided this record was not any single verdict. Every law in the corpus
was enforced by a `command` check asserting on a test runner's output —
`outputContains: "fail 0"` — and the breaker demonstrated that a mutation making a law
pass silently survived the gate once the BODY of the covering test was deleted while its
name was kept: `239 pass / 0 fail`, gate green, invariant broken. `fail 0` is a constant
of any green run, including a run of a test file with no tests in it.

## Decision

An invariant the kit enforces with a command is checked **behaviourally**: a command
drives the production modules over constructed inputs and requires the wrong verdict to
be refused. `scripts/check-gate-invariants.mjs` is that enforcement point, and it is
named by this record's laws. It prints `gate invariants ok` only after every invariant
held, and that marker is what the checks assert.

## Reasoning

Confirming a check is cheap and unconvincing, because whoever wrote the check already
believed it; only falsification distinguishes a belief from knowledge. A test *name* is
not evidence of an assertion: a test with an empty body passes, so an assertion on a test
runner's output is satisfied by the absence of the very thing it claims to measure. The
same argument applies to the test file as a whole — a suite that reports `fail 0` reports
it over an empty file.

Driving the production modules directly removes the middleman. The claim "a law with no
check and no stated reason is reported" is then tested by constructing exactly that law
and requiring `LAW_UNCHECKED` — a fact about the shipped code path, not about a test that
happens to call it. A mutation that changes the verdict fails this check immediately,
without anyone having to notice that a test body went missing.

The alternative — running the full `scripts/falsify-kit-gate.mjs` experiment inside the
gate — was measured and rejected as the *primary* point: it takes about five minutes,
because each of its six cases runs the whole gate. It stays a declared verification
command for the release gate, where that cost buys end-to-end evidence; the behavioural
check is what runs on every verification.

## Consequences

- A mutation to the verifier that weakens a verdict fails `ratchet verify` directly,
  instead of depending on the covering test surviving review.
- The kit's own laws no longer rest on an assertion satisfied by a constant. The command
  checks that still name the test suite assert the suite's exit status, which is what a
  suite is for; the invariant-level claims now have a second, independent point.
- **The residual limit, stated plainly:** an agent that edits the module *and* this
  enforcement point passes, because a self-verifying system has no external reference.
  The design buys a two-file edit, one of them named by a law, instead of one deleted
  test body, and nothing more than that.
- This record is agent-authored and in force under the `kit-tooling` zone, where the
  manifest lets an agent activate its own decision. A human has not read it. That is the
  configured authority model, and `docs/RATCHET-V2-DESIGN.md` §6.5 states which records
  carry a human consent and which do not.
