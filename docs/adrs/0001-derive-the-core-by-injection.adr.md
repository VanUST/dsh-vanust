---
id: "0001"
title: Derive the harness-free core by constructor injection
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-13T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-13-ratchet-design-session.md
  hash: sha256:1abfded03aafb25e63e826f20a5917056084b58532a07b591caccd67a96efaf8
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.no-harness-import-in-logic
    statement: No file under the ratchet plugin may import the harness except its tool adapter, ratchet-tools.mjs.
    checks:
      # A glob, not a path list. The first version of this law named the seven
      # modules that existed, so ratchet-guard.mjs and ratchet-ingest.mjs were written
      # afterwards and were never covered — the law said "a shipped plugin's logic
      # modules" while checking a list that had already gone stale.
      - type: forbidden_text_glob
        paths:
          - plugins/ratchet/**/*.mjs
          - '!plugins/ratchet/node_modules/**'
          - '!plugins/ratchet/ratchet-tools.mjs'
        pattern: "@deepseek-ai/(dsh-tools|cordis)"
  - op: upsert
    id: shipped-plugins.adapter-is-the-only-harness-edge
    statement: The tool adapter is the only module allowed to import the harness, and a module added later cannot escape the boundary by not being named.
    checks:
      # The real test of the boundary, including the case a path list cannot cover: a
      # module written after the law. One command, four assertions, and it fails when
      # a new file imports the harness.
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: every ratchet test passes, including the boundary falsification case
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.judge-is-injected
    statement: A capability the harness provides reaches a logic module as an injected function, so the module remains testable without a deployment.
    checks:
      - type: required_text
        paths:
          - plugins/ratchet/ratchet-ops.mjs
        pattern: "spawnJudge"
      - type: required_text_glob
        paths:
          - plugins/ratchet/ratchet-dynamic.mjs
        pattern: "never imports the harness"
        anyOf: true
---

## Context

The ratchet began as tool bodies inside `ratchet-tools.mjs`: a compile step, a verify
step, and a review step, each declared inline. That arrangement made "the gate fails
when it should" a claim about a tool declaration rather than about the gate, because
the only way to exercise the logic was to boot a harness, build a fake context, and
dispatch a call. The review step had a worse problem: it needed to spawn a child
agent, which is a harness service, so the logic could not be tested at all without a
live deployment.

## Decision

Logic modules take the harness as an injected parameter and never import it. A
capability the harness owns — spawning a judge, resolving a workspace — arrives as a
function the caller supplies. Only `ratchet-tools.mjs` imports `@deepseek-ai/dsh-tools`
and only it reaches `ctx`.

## Reasoning

The split is what makes the layer testable at all. 139 tests across two suites run
in under two seconds with no harness, no credentials and no model, because nothing
below the adapter knows a harness exists. The review path runs under a two-line fake
in a test and under a real child agent in production, and neither arrangement
required a branch in the logic.

Injection also keeps the failure mode honest. "No judge available" becomes a value a
caller passes (`spawnJudge: null`) rather than an exception discovered deep in a call
stack, so the degraded path is a first-class result rather than an error handler.

The rule is enforceable rather than aspirational: a `forbidden_text` check over the
logic modules fails the build if a harness import reappears, which is the difference
between an architecture note and an architecture.

## Consequences

- Adding a harness capability means widening an injected parameter, not importing a
  service, which is a visible change to a seam rather than a new edge in the graph.
- The adapter module is the only place a harness API change can break, so the
  measured-API work in ADR 0005 has a single consumer.
- A caller that forgets to pass an injected capability gets the degraded path by
  default, not a crash. That is deliberate for review and would be wrong for verify,
  which takes no injected capability at all.
