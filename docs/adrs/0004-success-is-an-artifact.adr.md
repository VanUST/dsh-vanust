---
id: "0004"
title: Success is a written artifact, not the absence of a thrown exception
type: adr
status: active
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-13T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-13-ratchet-design-session.md
  hash: sha256:1abfded03aafb25e63e826f20a5917056084b58532a07b591caccd67a96efaf8
zones:
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.reports-are-written-on-failure-too
    statement: An operation that produces a report writes it whether it succeeded or failed, because a report that exists only on success cannot record a failure.
    checks:
      # The test compiles a project whose corpus is malformed and asserts the report
      # exists afterwards. Searching for `persistCompile` would have proved only that
      # the function is still called that.
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a failing compile still writes its report and its ledger event
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.writes-are-atomic
    statement: A report reaches a reader whole or not at all, so a crash mid-write cannot be mistaken for a gate that failed.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: every artifact write goes through a temporary file and a rename
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.state-records-what-was-judged
    statement: A verification records the spec hash it judged, so a later reader can tell whether the code is still verified against the laws in force.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: changing a law makes the recorded verification stale, and a zero-check verification does not count as verified
        timeoutMs: 300000
---

## Context

An operation that returns a value to its caller leaves no trace once the caller
finishes. For a gate, that is the wrong shape: "the code was verified" becomes a
claim in a conversation rather than something a later reader, a CI job or another
agent can check. The deployment's own rules say logs are the source of truth for
whether work is done, and a tool return value is not a log.

The predecessor had the adjacent defect from the other side: it asked the model to
write `reports/semantic-report.json` and nothing read or verified the file, so the
"named home" was a convention the model was asked to honour.

## Decision

Durable artifacts, not return values, decide success:

- `reports/ratchet/compile-report.json` and `verify-report.json`, written on failure
  as well as success;
- `.dsh/ratchet/specs.json`, the compiled bundle;
- `.dsh/ratchet/state.json`, recording **the spec hash the verification judged**;
- `.dsh/ratchet/ledger.jsonl`, append-only structured events.

Writes go through a temporary file and a rename.

## Reasoning

Writing on failure is the load-bearing half. A report that appears only on success
cannot record a failure, and the failure is what a reader most needs to see — an
absent report is indistinguishable from an operation that never ran.

Recording the spec hash is what makes "has this been verified?" answerable at all. A
verification is evidence about a particular law set, so a report whose hash no longer
matches the compiled bundle is not evidence about the current laws. Without it the
question is unanswerable, and an unanswerable question becomes an assumed yes.

Atomic writes matter because the artifact is read by someone else's process. A
truncated JSON file cannot be distinguished from a gate that failed, so a crash
mid-write would read as a project problem.

## Consequences

- The gate has an artifact to point at, which is what lets a rule name a command
  that fails rather than a convention that should hold.
- A verification that evaluated **zero** checks does not count as verified. A project
  with no laws "passes" trivially, and counting that as verified is the same silence
  the predecessor produced. That case is a test.
- Ledger appends verify the record round-trips before writing, because
  `JSON.stringify` silently drops a function or an `undefined` value rather than
  throwing, and a dropped field is a fact that was never audited.
