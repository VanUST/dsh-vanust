---
id: "0058"
title: Rule drills, test quality and claim discipline join the deployment rules
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-17T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-17-execution-methodology.md
  hash: sha256:6f52ae11d4a054c6ba2c66dc8e8b798baa80b4ea0593dff9c51636d390703e8d
zones:
  - deployment-rules
supersedes: []
approves: []
laws:
  - op: upsert
    id: deployment-rules.tests-verify-behaviour
    statement: Every test exercises real product behaviour and asserts on its observable result; a test that only proves a class or module has a method or a field, asserts a mock, or computes its expectation with the code under test earns no place.
    checks:
      # The marker is printed only when the lint ran over a non-empty test set and
      # found nothing, so a moved test directory or a partial run cannot satisfy it.
      - type: command
        run: node scripts/check-test-quality.mjs --root . --strict
        expects: no test in the corpus is a shape-only assertion engine
        timeoutMs: 120000
        outputContains: check-test-quality: 0 finding(s)
  - op: upsert
    id: deployment-rules.rule-drills-target-real-sections
    statement: Every rule drill names a rule section the injected rules file carries, so the RED run strips the rule under test; a drill that cannot strip anything proves nothing.
    checks:
      - type: command
        run: node scripts/drill-kit-rules.mjs --root .
        expects: every drill scenario strips a section the rules file carries
        timeoutMs: 120000
        outputContains: drill plan ok
  - op: upsert
    id: deployment-rules.claims-carry-evidence
    statement: A completion claim names the command run in the current turn and the output it produced; a claim resting on an earlier command, or on no command at all, is provisional and says so.
    checks: []
    unenforced: "the only behavioural check is the rule drill's live path (scripts/drill-kit-rules.mjs --scenario verification-before-completion --live), which needs a model and credentials and therefore belongs in the release gate; a law's check must be hermetic, so nothing in the deterministic gate can fail when an agent claims completion without evidence"
---

## Context

The kit enforces decisions and governs nothing about how work proceeds. Its injected
rules include prompt constraints — the model policy, the remote-change permission — that
**no command could fail when broken**, which §3 of those rules names as an unverified
claim, and `context_rules` reported exactly two such rules with their unbuilt checks
recorded. Reading `obra/superpowers` against the kit (`docs/SUPERPOWERS-COMPARISON.md`)
identified the missing execution half and the mechanism that would give it a failure
point: pressure-test the rule itself, the way a check is tested.

## Decision

Three rule additions and two hermetic enforcement points:

1. `scripts/drill-kit-rules.mjs` is the differential behavioural test for an injected
   rule: RED runs the scenario with the injected rules minus the section under test, GREEN
   with the file unchanged, and the verdict is read from a journal of the agent's actions.
   It proves a scenario targets a real section (`deployment-rules.rule-drills-target-real-sections`).
2. `scripts/check-test-quality.mjs` refuses shape-only tests, and its marker is the check
   for `deployment-rules.tests-verify-behaviour`.
3. `rules/AGENTS.md` gains §11 (a completion claim carries fresh evidence) and §12 (tests
   verify behaviour, not shape), and §1, §3, §6, §9 and §10 gain rationalization tables.
   §11's rule is recorded as `deployment-rules.claims-carry-evidence`, unenforced in the
   deterministic gate with the reason stated.

## Reasoning

The source states the full argument: the two systems are complements, the drill's live
result for `flash-only-models` was a RED delegation to `deepseek-v4-pro` against a GREEN
delegation to `deepseek-flash`, and the other two scenarios honestly report `missed`
rather than a pass. The test-quality lint was run in report mode first, found one real
finding in the kit's own corpus, and is clean under `--strict`; it states its own
heuristic limit.

## Consequences

- The model-policy rule now has a demonstration that the injected text changes a
  decision, and the same instrument can test any rule the drift-free rules file gains.
- A shape-only test fails the gate instead of passing as coverage. The exemption is an
  inline `test-quality:allow <reason>`, so an accepted finding carries its reason.
- The drill's live path is **not** in a law's checks and not yet in `verify-upgrade.sh`,
  whose skip policy accepts two documented lines; wiring it there is a separate change.
- **This record is agent-authored and the zone is `humanOnly`.** The ratchet's queue
  refuses to offer an agent record there, because consent cannot transfer authorship, so
  this decision waits for a human to author it. That is the configured authority model,
  and it is why the panel shows it as blocked rather than as an approvable question.
