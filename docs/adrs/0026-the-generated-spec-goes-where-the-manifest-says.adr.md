---
id: "0026"
title: Every path the ratchet writes comes from the manifest, not from a default in the code
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-15T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-the-generated-spec-goes-where-the-manifest-says.md
  hash: sha256:8c05965d16a4a8207658f678b5b4316d543d75a552249446593a752e27435338
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.a-generated-artifact-goes-where-the-manifest-says
    statement: Every path the ratchet writes or reads for its own records, generated specs, reports and state is resolved from the manifest, so a project that declares any of those directories gets its artifacts there and a reader that resolves the manifest cannot disagree with a writer that does not; a path field the manifest accepts is either honoured or refused, never accepted and ignored.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a project whose specs directory is not docs/specs compiles and verifies green, with its document written where the manifest says
        timeoutMs: 300000
---

## Context

`renderSpecs` built its output key as `docs/specs/${zone}.spec.md` — a literal — while every READER of those documents resolved `config.specsDir`: `tracksSpecDocuments`, `detectSpecDrift`, and the write guard's exemption logic. A project that declared any other specs directory therefore had compile write the documents to `docs/specs`, verify report every one of them MISSING from `<specsDir>`, and no way to become green — the failure was reported as the project's, and the compile the message prescribed wrote to the same wrong place again.

It survived every check this kit has because this kit's own manifest declares the default. It was found by driving the ratchet against a project with a foreign layout, and its siblings were found by asking the same question of every other path field.

## Decision

A directory the manifest declares is resolved from the manifest at every point that reads or writes it. A field the manifest accepts is honoured everywhere or refused at parse time; it is never accepted by the parser and ignored by the writer.

## Reasoning

The kit's whole claim is that a manifest describes the project. A default baked into a writer makes that claim false in a way no test written against the default can see — the defect is invisible precisely in the configuration the author uses. This is the same class as the in-force law set that was a second implementation of the compiler's and the zone matcher that disagreed with the verifier's: two places computing one shared fact, with nothing forcing them to agree.

The specific fix threads the specs directory into `renderSpecs` and makes the caller supply it, so there is one source for it. The law is written generally on purpose, because the sibling fields — `stateDir`, `reportsDir` — were accepted and ignored in exactly the same way, and a law narrower than the defect would let the next one through.

## Consequences

- A project with its own layout gets its artifacts where its manifest says, and the paths a reader resolves cannot disagree with where a writer put them.
- The regression test compiles and verifies a project whose `specsDir` is not `docs/specs`, which is the configuration the kit's own tests never entered.
- The remaining siblings are named in this record's reasoning source rather than left to be rediscovered: honouring `stateDir` and `reportsDir` is the same change applied to the same class.
