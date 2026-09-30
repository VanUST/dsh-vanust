---
id: "0090"
title: A ratchet child is re-attached across a restart instead of replaced
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-30T12:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-30-ratchet-children-survive-a-restart.md
  hash: sha256:a4286eb997a1830afac8f3a80c3357f4b179d9b77bd52b2a150380fcb453460e
zones:
  - shipped-plugins
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.a-judge-is-rediscovered-from-the-session-log
    statement: A judge pool that holds no child for a session re-discovers the judge that session already created from the session's own durable `subagent/catalog` records and delivers to it, so a pool built by a new process re-attaches to the existing judge instead of creating a second one; only a delivery the runtime refuses replaces the child.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a second pool over a session whose log catalogs an existing judge child sends to that child, creates none, and re-sends the whole task with the supersede note; a catalog child the runtime refuses is replaced by exactly one new child
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.a-resolver-child-outlives-its-process
    statement: Every resolver child a start establishes is recorded in the project's ratchet ledger with its child id, and that id is read back and steered before a start, so a resolver that outlives the process that created it is continued rather than duplicated; a steer the runtime refuses falls back to starting one child.
    checks:
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: a recorded resolver child is steered by a later dispatch whose registry is empty, a refused steer starts exactly one child, and the child id is written to the ledger
        timeoutMs: 300000
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the resolve ledger round-trips a child id, and a service built over a fresh root reads back the child the earlier one recorded
        timeoutMs: 300000
---

## Context

A session in the `Unnamed` project held four ratchet children — two judges and two
resolvers — under one law set. The cause was a `dsh web` restart at 14:04:35 local: both
roles kept their child id only in process memory (a `WeakMap` keyed on the parent Agent for
the judge, a `Map` per plugin activation for the resolver), so the new process created a
second child of each role instead of continuing the durable one it already had. The
duplicate pair spent about 1.5M prompt tokens re-doing work the first children had done.

The children were never lost. The harness cold-resumes a durable continuable child on a
`sendMessage` to its id: `deliverFollowup` reads the child's log, requires a `continuable`
descriptor and a lineage match, and re-materializes the agent. Only the remembered id was
missing, and both facts already have durable homes: the parent session's own log carries a
`subagent/catalog` record for every continuable child, and the project ledger carries the
resolver's dispatch.

## Decision

A judge pool with no child for a session folds that session's `subagent/catalog` records for
its label and adopts a `continuable` child by id, delivering the full task with the existing
supersede note because the adopted child's static prefix is unknown. A resolver child id is
written to the ledger as `ratchet.resolve.child` by both the click and the automatic dispatch
paths, read back when the panel's registry has no entry, and steered before a create.

Replacement is unchanged and still allowed: a delivery the runtime refuses marks the child
gone and the existing retry creates one. What changes is only that a missing id is no longer
treated as a missing child.

## Reasoning

See `docs/ratchet/sources/2026-09-30-ratchet-children-survive-a-restart.md` for the
measurements, the harness facts the mechanism rests on, and the alternatives that were
rejected — a `$DSH_HOME` state file, keying the pool on `parent.id`, a per-project child
file, and never replacing a child.

The enforcement gap this closes is stated plainly: the existing law
`shipped-plugins.a-judge-is-reused-across-corpus-changes` already promised one judge per
session, and its check passed while the observed session held two. The check drove reuse
inside one pool instance, so it could not see the failure. These two laws carry checks that
build a second pool over the durable record and fail when the re-attach is dropped.

## Consequences

- A restart no longer costs a second judge or a second resolver. The re-attached child
  receives the full task with the supersede note, so its context is correct after the gap
  even though the prefix it was shown before is not known to the new process.
- The judge's memory is read from the session's own log, so it follows the session rather
  than a file, and a session that reviewed several projects still finds its judge wherever
  the review names the project whose corpus it reads.
- A resolver id left in the ledger by a child that is no longer resumable costs one refused
  steer before a fresh child starts; the refusal is the existing replacement path and is
  covered by a check.
- The resolver's remembered id is project-scoped. Two Sessions looking at one manifest
  already share one resolver by root, and the ledger records the id under the same root, so
  the second Session continues the first's child rather than starting a rival.
