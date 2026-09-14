---
id: "0005"
title: A measured harness fact is recorded with its reproduction
type: adr
status: active
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-13T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-13-api-discovery.md
  hash: sha256:a23faea79775ae860bcd403c3a52c5e5bfb1ca9afc2e7e2512ab27f49e07ac53
zones:
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: kit-tooling.api-facts-are-runnable
    statement: A harness fact a shipped plugin depends on must be assertable by a command that exits non-zero when the fact stops holding.
    checks:
      # The probe that measures the facts costs a model call, so it cannot be the
      # check here. What is checked is the property that makes it a detector rather
      # than documentation: it exits non-zero when a fact is not confirmed. The test
      # also asserts the probe records checks at all, because a probe with no checks
      # exits 0 trivially.
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the API probe exits non-zero when a fact is not confirmed
        timeoutMs: 300000
---

## Context

The ratchet rests on four harness capabilities: the session workspace is readable
from a tool body, `defineTool` compiles schemas the registry then enforces, a tool
can attach context to its own result, and a plugin can spawn a judge child agent and
read its verdict. Each would invalidate a module if wrong.

Designing against recalled API behaviour produced a false finding. A probe asked for
`ctx.get('subagent')` (singular) and got `undefined`; reading `ctx.subagent` threw
`cannot get property "subagent" without inject`; declaring `inject: ['subagent']`
failed the boot. Those three observations combined into "the dynamic layer is
impossible" — and every one of them was correct about a name the runtime does not
use. The service registers as `subagents`, plural, in its own constructor.

## Decision

A harness fact a plugin depends on is recorded in `docs/RATCHET-API-FACTS.md` with
the command that produces it, and the probe asserts it so the command exits non-zero
when the fact stops holding. Facts are labelled measured or declared, and a
disagreement between the two is itself recorded.

## Reasoning

The failure this prevents is not ignorance but confident error. Recalled API
behaviour cannot be distinguished from measured behaviour by the person recalling
it, so a wrong recollection propagates into a design as a premise rather than as a
question. The singular/plural mistake was one character, survived several rounds of
reasoning, and was only caught by measuring.

Recording the reproduction is what makes the fact checkable later. The harness is
pre-1.0 and renames freely, so a fact without a command is a fact that rots silently
— and a rename of `subagents` would turn the dynamic layer into its degraded mode
without any visible failure.

The probe exits non-zero when a fact is not confirmed, which makes it a churn
detector rather than documentation. `verify-upgrade.sh` runs it, so an upgrade cannot
be declared safe while a fact the design trusts has moved.

## Consequences

- Two wrong intermediate answers are recorded alongside the right one, because the
  wrong one was convincing and the next reader deserves to know why it was wrong.
- The probe is part of the gate, so it must stay cheap: the judge-spawning modes cost
  a child turn and are therefore opt-in rather than default.
- A fact measured once is still only evidence about that harness version. The record
  names the version, and re-measuring is part of the upgrade procedure.
