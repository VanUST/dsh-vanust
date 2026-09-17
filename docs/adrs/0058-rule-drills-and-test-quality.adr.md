---
id: "0058"
title: Claim discipline and the rule text join the deployment rules
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
    id: deployment-rules.claims-carry-evidence
    statement: A completion claim names the command run in the current turn and the output it produced; a claim resting on an earlier command, or on no command at all, is provisional and says so.
    checks: []
    unenforced: "the only behavioural check is the rule drill's live path (scripts/drill-kit-rules.mjs --scenario verification-before-completion --live), which needs a model and credentials and therefore belongs in the release gate; a law's check must be hermetic, so nothing in the deterministic gate can fail when an agent claims completion without evidence"
---

## Context

The kit enforces decisions and governs nothing about how work proceeds. Its injected rules
include prompt constraints — the model policy, the remote-change permission — that **no
command could fail when broken**, which §3 of those rules names as an unverified claim.
Reading `obra/superpowers` against the kit (`docs/SUPERPOWERS-COMPARISON.md`) identified the
missing execution half and the mechanism that would give it a failure point: pressure-test
the rule itself, the way a check is tested.

The two mechanisms that came out of that — the rule drill and the test-quality lint — are
checks over `scripts/**`, and they are law under **ADR 0059**, bound to `kit-tooling`, where
this project lets an agent activate its own decision. What remains here is the part that
genuinely concerns the deployment rules: the TEXT of `rules/AGENTS.md`, plus the one rule
nothing deterministic can check.

## Decision

`rules/AGENTS.md` gains §11 (a completion claim carries fresh evidence) and §12 (tests verify
behaviour, not shape), and §1, §3, §6, §9 and §10 gain rationalization tables naming the
excuse next to its rebuttal. §11's rule is recorded here as
`deployment-rules.claims-carry-evidence`, unenforced in the deterministic gate with the
reason stated.

## Reasoning

The source states the full argument and the evidence for the mechanisms: the drill's live
result for `flash-only-models` was a RED delegation to `deepseek-v4-pro` against a GREEN
delegation to `deepseek-flash`, and the other two scenarios honestly report `missed` rather
than a pass. The test-quality lint was run in report mode first, found one real finding in
this corpus, and is clean under `--strict`; it states its own heuristic limit.

The rule text is where the two enforcement points come from, and it is the part a human owns:
a completion claim is a sentence an agent writes, and no command can read an agent's mind.

## Consequences

- §11 and §12 are the rules the two registered checks enforce; the checks themselves are
  `kit-tooling.tests-verify-behaviour` and `kit-tooling.rule-drills-target-real-sections`
  (ADR 0059).
- **This record is agent-authored.** The zone that governs `rules/**` now requires a human
  *ratification* rather than human authorship (ADR 0060), because authorship is not
  verifiable while a consent is bound to the text the human was shown. So this record is
  offered to a human as a question and enters force on their answer.
- The rationalization tables are prose. The drill is the only instrument that tests whether a
  rule changes a decision, and only the `flash-only-models` scenario has been shown to.
