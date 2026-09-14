---
id: "0010"
title: The consent laws are enforced behaviourally, not by a test's name
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-14T10:30:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-14-enforcement-amendment.md
  hash: sha256:5cf5242690eddad2b6dd012bd4d6f9a6d4b78aac3b18057aedf17db51ab44a06
zones:
  - shipped-plugins
supersedes:
  - "0007"
approves: []
laws:
  - op: upsert
    id: shipped-plugins.consent-is-hash-bound
    statement: An approval puts a decision into force only while the decision still hashes to the text the approval recorded, so editing an approved record voids the consent instead of inheriting it.
    checks:
      # Behavioural: the script constructs an approval bound to a record's hash, edits
      # the record, and requires RATIFICATION_STALE and the law leaving force. A test
      # name or "fail 0" would be satisfied by a green run over an emptied test.
      - type: command
        run: node scripts/check-gate-invariants.mjs
        expects: an edited approved record is refused and its law leaves force
        timeoutMs: 120000
        outputContains: gate invariants ok
  - op: upsert
    id: shipped-plugins.consent-travels-the-human-channel
    statement: A ratification question reaches the human through the harness user-questions channel carrying the record's own text, and its answer is derived from a selected label rather than interpreted.
    checks:
      # Behavioural: the production quiz builder and derivation are driven directly, so
      # the assertion is about what those functions return, not about a test's name.
      - type: command
        run: node scripts/check-gate-invariants.mjs
        expects: the question detail is the record's own text and only the approve label yields consent
        timeoutMs: 120000
        outputContains: gate invariants ok
  - op: upsert
    id: shipped-plugins.no-shell-mint
    statement: No shell command mints a consent and no tool argument accepts a caller-composed answer; the CLI can only report which decisions are waiting for a human, and it reports the ones it cannot ratify with the reason.
    checks:
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the consent surface refuses a shell mint, refuses an answer that answers no question, and reports a blocked decision with its reason
        outputContains: "consent surface ok"
  - op: upsert
    id: shipped-plugins.unenforced-laws-are-reported
    statement: A law in force that declares no check and does not say why is reported as unenforced, because a rule with no enforcement point is an unverified claim.
    checks:
      - type: command
        run: node scripts/check-gate-invariants.mjs
        expects: a law with no check and no stated reason is reported as unenforced
        timeoutMs: 120000
        outputContains: gate invariants ok
---

## Context

ADR 0007's four consent laws are human-ratified, and three of them were enforced by
assertions that a green run prints regardless of whether anything was checked:
`outputContains: "fail 0"` on the test suite, and two strings that are test *names*. The
breaker had already demonstrated the consequence before ADR 0009 was written — deleting a
covering test's body while keeping its name produced `239 pass / 0 fail` and a green
gate. ADR 0009 then made the general claim, in the universal, that "an enforcement point
never rests on a test name or on output a green run prints anyway", while three of 0007's
laws still did exactly that. Two in-force decisions disagreed, and the disagreement was
found by the kit's own dynamic review (`review_corpus`) and confirmed by reading the
compiled bundle.

## Decision

The four consent laws are restated with behavioural enforcement points, and this record
supersedes ADR 0007. Nothing about 0007's statements changes: the same four laws, in the
same zone, are enforced by commands that drive the production modules and refuse the
wrong verdict:

- `shipped-plugins.consent-is-hash-bound` and
  `shipped-plugins.unenforced-laws-are-reported` are bound to
  `node scripts/check-gate-invariants.mjs`, whose `gate invariants ok` marker is printed
  only after every invariant held;
- `shipped-plugins.consent-travels-the-human-channel` is bound to the same script, which
  drives the production quiz builder and answer derivation directly;
- `shipped-plugins.no-shell-mint` keeps its `scripts/check-consent-surface.mjs` binding,
  whose marker already asserts the no-mint surface behaviourally.

ADR 0007's file is not edited. It is retired by supersession only when this record is
ratified, which is what the kit's own rule requires for a change to a ratified record.

## Reasoning

The reasoning is the source this record cites. Its three load-bearing conclusions:
`fail 0` and test names cannot distinguish an assertion from its absence, so the consent
laws were passing over exactly the mutations that disprove them; narrowing ADR 0009
instead would resolve the contradiction by weakening the human-ratified decision; and
the strongest available evidence for the human-channel claim — the live ratification
probe — must stay a hand-run verification command rather than the gate check, because it
needs credentials, a network and a model turn.

## Consequences

- A mutation that lets an edited record keep its force, or that makes the question carry
  something other than the record's own text, fails `ratchet verify` directly instead of
  depending on a test's name surviving review.
- Superseding is not editing: ADR 0007 and its consent record remain in the history, and
  the consent recorded for 0007 is not retroactively rewritten.
- This record is agent-authored and governs `shipped-plugins`, where the manifest allows
  an agent to propose but not to activate. It enters force only when a human ratifies it,
  and it is a proposal until then.
- The residual limit is unchanged from ADR 0009: an agent that edits both the production
  module and its enforcement point passes, because a self-verifying system has no external
  reference point.
