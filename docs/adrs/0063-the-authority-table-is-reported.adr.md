---
id: "0063"
title: The authority table is reported, and its repairs are drafted
type: adr
status: active
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-17T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-17-the-authority-table-is-reported.md
  hash: sha256:fc67f29f56cb6e9f83be4e3175af5622e5308aaeb44ff9921b6547f9ed70f551
zones:
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: kit-tooling.zones-are-reported
    statement: The authority table is reported rather than discovered — a zone referenced by records but not declared, a declared path that matches no tracked file, and a law enforcing outside its record's zones each fail the command, and the marker is printed only when there is nothing to report.
    checks:
      - type: command
        run: node plugins/ratchet/ratchet-cli.mjs zones --root .
        expects: the authority table reports no undeclared reference, no empty path and no law outside its zones
        timeoutMs: 120000
        outputContains: zones ok
---

## Context

A project's records named four zones its manifest did not declare. Each one resolved to a
missing zone: no paths, so no law could be enforced; the conservative default policy, so no
record could self-activate; and a ratification queue that refused to offer an inert
consent. Six records were blocked, all for the same structural reason.

That is not a one-off. A zone rename orphans every record on the old id; a path move
leaves a declared path matching nothing and silently retires any `forbidden_file` or
`forbidden_glob` law over it, because absence is their success condition; a new area is
governed by nobody. The manifest that decides all of this is governed by no zone, so the
drift can start without a decision record. Nothing reported any of it until a record tried
to enter force.

## Decision

`ratchet zones` reports the authority table and fails when it is broken:

- `ZONE_UNDECLARED_REFERENCE` — a zone id records reference that the manifest does not
  declare, with the paths inferred from the positive targets of those records' laws;
- `ZONE_PATH_EMPTY` — a declared path that matches no tracked file;
- `ZONE_LAW_OUTSIDE` — a law the compiler refused for enforcing outside its record's zones.

`--write` drafts one declaration per undeclared zone under `reports/ratchet/drafts/`, with
the inferred paths and the conservative `proposeOnly` authority, and never overwrites an
existing draft. The command never edits the manifest and never writes a record; `ok` and
the marker `zones ok` appear only when there is nothing to report.

The drafting behaviour is enforced by the ratchet suite, not by a second law: the suite
(`ratchet-tests`) pins the three shapes over fixtures — an undeclared zone reported with
its inferred paths, `--write` drafting and then keeping the draft, and a clean table
exiting zero with its marker. A law asserting a test runner's `pass` line would be the weak
check this kit already has `check-gate-invariants.mjs` to refuse.

## Reasoning

The `zoneId → paths` mapping is already implied by the corpus, so the report needs no
judgement: a record declares its zones and its laws carry their check targets. From the
same facts the repair follows, and it takes the shape the ratchet already uses elsewhere —
`ratchet-deduplicate.mjs` drafts a resolution and puts nothing in force, and the compile
drafting pass does the same for decidable contradictions. The source states the argument
and the failure modes in full.

## Consequences

- A structure change is a report and a draft instead of detective work across the corpus
  and the manifest; the drift is visible before a record tries to enter force.
- This record's laws bind to `kit-tooling`, where an agent may activate its own decision,
  because both enforce checks over `scripts/**` and the plugin.
- **The rename case is not solved.** The report finds the orphaned records; nothing retargets
  them yet. An alias map, or a ratified rename whose effect is the record rewrite, is the
  next step.
- **A zone change is still not a ratified decision.** The draft is a file under
  `reports/ratchet/drafts/`, because the manifest is not an ADR. Until the table is itself
  governed, this record makes drift visible rather than impossible.
- **Write-time validation is still ingestion's.** `ratchet_ingest` refuses an undeclared
  zone; a hand-authored record bypasses it and is caught by this report at the next run.
