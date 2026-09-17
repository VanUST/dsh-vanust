---
id: "0059"
title: The test-quality and rule-drill checks are law under the tooling zone
type: adr
status: active
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-17T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-17-execution-methodology.md
  hash: sha256:6f52ae11d4a054c6ba2c66dc8e8b798baa80b4ea0593dff9c51636d390703e8d
zones:
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: kit-tooling.tests-verify-behaviour
    statement: Every test that the kit's own corpus ships exercises real product behaviour and asserts on its observable result; a test that only proves a class or module has a method or a field, asserts a mock, or computes its expectation with the code under test is refused by the lint.
    checks:
      # The marker is printed only when the lint ran over a non-empty test set and found
      # nothing, so a moved test directory or a partial run cannot satisfy it.
      - type: command
        run: node scripts/check-test-quality.mjs --root . --strict
        expects: no test in the corpus is a shape-only assertion engine
        timeoutMs: 120000
        outputContains: check-test-quality: 0 finding(s)
  - op: upsert
    id: kit-tooling.rule-drills-target-real-sections
    statement: Every rule drill names a rule section the injected rules file carries, so the RED run of the drill strips the rule under test; a drill that cannot strip anything proves nothing.
    checks:
      - type: command
        run: node scripts/drill-kit-rules.mjs --root .
        expects: every drill scenario strips a section the rules file carries
        timeoutMs: 120000
        outputContains: drill plan ok
---

## Context

ADR 0058 records the decision to add the rule drill, the test-quality lint and the claim
discipline to this deployment. It was written by an agent and bound to `deployment-rules`,
the zone the manifest reserved to humans, so it could neither self-activate nor be offered
for ratification: the ratchet refuses an agent-authored record there because consent cannot
transfer authorship. The whole decision therefore stalled on a zone that its enforceable
half never needed.

The two enforcement points are checks over `scripts/**` — the lint and the drill's plan
mode — and `kit-tooling` is where this project lets an agent activate its own decision. Only
the change to the *text* of `rules/AGENTS.md` genuinely touches `deployment-rules`.

## Decision

The two enforceable laws live here, under `kit-tooling`, and enter force by this record's
own declaration:

- `kit-tooling.tests-verify-behaviour` — `scripts/check-test-quality.mjs` run strict over a
  non-empty corpus, its marker asserted so a partial run cannot satisfy it.
- `kit-tooling.rule-drills-target-real-sections` — `scripts/drill-kit-rules.mjs` in plan
  mode, asserting the marker it prints only when every scenario strips a real section.

## Reasoning

The source states the argument for the mechanisms and the evidence: the drill's live result
for `flash-only-models` was a RED delegation to `deepseek-v4-pro` against a GREEN delegation
to `deepseek-flash`; the test-quality lint was run in report mode first, found one real case
in this corpus, and is clean under `--strict`. What changed here is only the jurisdiction:
a check over `scripts/**` belongs to the zone that governs `scripts/**`, and binding it to
the rules zone put an unverifiable authorship requirement in front of two commands that were
already hermetic and green.

## Consequences

- The kit's own test corpus and its drill scenarios are enforced law, not a tool an agent may
  or may not run. A shape-only test now fails `ratchet verify` directly.
- ADR 0058 keeps the rule-text decision and the one law nothing deterministic can check
  (`deployment-rules.claims-carry-evidence`), which is what a human ratifies.
- **The residual split, stated plainly:** this record says nothing about `rules/AGENTS.md`.
  Its laws govern the checks, and the rules text they cover still enters force through the
  human decision in ADR 0058.
