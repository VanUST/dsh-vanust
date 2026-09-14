---
id: "0003"
title: A tool definition is built with defineTool, never registered bare
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
    id: shipped-plugins.tools-use-defineTool
    statement: Every tool a shipped plugin registers is built with defineTool, including one that takes no arguments.
    checks:
      # Checking for the string `defineTool(` proved only that the import is used
      # somewhere. The invariant is that no registration bypasses it, which the
      # conformance test asserts by inspecting the definitions the plugin registers.
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: every registered tool was built with defineTool and declares an output schema
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.no-raw-tool-schemas
    statement: A plugin must not register a tool definition whose parameters or output schema was written by hand, because the registry validates those as raw JSON Schema and rejects the author DSL.
    checks:
      - type: command
        run: node scripts/check-portability.mjs
        expects: no registration call passes a hand-written schema
        timeoutMs: 120000
---

## Context

A tool can be built two ways: with `defineTool` from `@deepseek-ai/dsh-tools`, or as
a plain object handed to `ctx.tools.register`. They look interchangeable and are not.
Measured on the installed harness:

- A definition registered bare is validated as RAW JSON Schema. The DSL's
  `{ type: 'json' }` node — the author-facing unconstrained JSON value — is rejected
  with `schema.type must be one of object/array/string/number/integer/boolean/null`.
- A bare definition with `parameters: {}` reaches the model provider without a root
  `type`, and the provider rejects the ENTIRE request with
  `Invalid schema for function '<name>': schema must be a JSON Schema of 'type:
  "object"', got 'type: null'`.

The second is the one that matters. It does not degrade one tool; it fails the whole
model request, so a single hand-written zero-argument tool makes the deployment
unable to talk to the provider at all.

## Decision

Every tool is declared through `defineTool`, including tools that take no arguments.
Declaring a parameter or output schema by hand in a registration call is a defect.

## Reasoning

`defineTool` is not sugar — it is the compiler that turns an author schema into the
enforced subset. The zero-argument case is the trap, because `parameters: {}` reads
as "nothing to declare" and is in fact an invalid schema root once it reaches the
provider.

The rule is enforceable with a text check over the plugin source, so it is an
architecture rather than a convention. The failure mode also justifies the
strictness: this is not a stylistic preference that costs a little if ignored, it is
a deployment-wide outage caused by one plausible-looking line.

## Consequences

- Every tool carries a declared `output.schema`, which the registry enforces: a tool
  whose returned value violates its own contract fails its call rather than
  succeeding quietly (verified — `zzprobe_output_bad` is rejected).
- A plugin that wants a diagnostic tool returning arbitrary JSON must use the DSL
  node, which means it cannot be written as a bare registration.
- The conformance is checked in two places: `check-portability.mjs` scans the source,
  and `test-ratchet.mjs` asserts the tool list the plugin registers.
