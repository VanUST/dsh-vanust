---
id: "0033"
title: Batch extraction writes many proposed records, each citing a span the tool locates itself
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-15T16:45:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-the-decision-lifecycle.md
  hash: sha256:869ade18027208a9f5d06abdad3ed4972f47d0af6455ad1fcf26c7871df96ad7
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  - op: upsert
    id: ingestion.a-batch-decision-cites-a-span-the-tool-locates-itself
    statement: Every decision a batch extraction writes carries a quoted span from the source, and the tool locates that span in the source itself before the record is written, so a justification cannot be attributed to a document that does not contain it.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a decision whose span is not in the source mints nothing, while the locatable decisions in the same batch are written
        outputContains: "a decision whose span cannot be located is refused alone"
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the extractor is reachable as a tool of its own and every record it writes is proposed
        outputContains: "many decisions from one source become many proposed records"
  - op: upsert
    id: ingestion.an-unlocatable-span-refuses-that-record-alone
    statement: A decision whose span cannot be located is refused while the other decisions in the same batch are still written, so one misattributed extraction costs one record rather than the batch.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the refusal names the decision and its code, and the rest of the batch lands
        outputContains: "a decision whose span cannot be located is refused alone"
  - op: upsert
    id: ingestion.a-batch-is-capped-and-an-oversized-source-is-split-on-its-headings
    statement: A batch extraction is capped in the number of decisions it will write, and a source above the cap is refused with the heading boundaries the tool found, so the split is mechanical rather than a judgement about where to cut.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a batch above the cap is refused whole with the heading boundaries the tool found, and nothing is written
        outputContains: "a batch above the cap is refused with the headings the tool found"
  - op: upsert
    id: ingestion.batch-extraction-is-a-distinct-surface-and-writes-only-proposed-records
    statement: Batch extraction is a surface of its own, distinct from single-decision ingestion, and every record it writes is proposed; no batch puts a decision in force.
    checks:
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the whole registered tool surface — the batch extractor included — still carries no argument that accepts a caller-composed answer
        outputContains: "consent surface ok"
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: ratchet_ingest_batch is registered beside ratchet_ingest_source rather than as a mode of it, and its parameters are exactly the source, the write flag and the submitted result
        outputContains: "not a mode of single-decision ingestion"
---

## Context

Handed a document with many decisions, single-decision ingestion is one call per decision, each
spawning its own judge with the tool verifying that every sentence the judge attributes to the
source appears in it. That verification is what makes a fabricated justification detectable, and it
is precisely the thing one read of a large document weakens.

The judge needs a live root agent — judge-driven operations are session tools and the CLI has no
judge command — so a batch path cannot be a CLI command. It has to be a tool, and the human chose a
distinct tool over a mode flag on the existing one, because one tool whose guarantees differ by
argument is what the consent-surface check exists to keep simple.

## Decision

A new `ratchet_ingest_batch` tool extracts many decisions from one source in one call, under four
constraints:

1. Every extracted decision carries a **verbatim quoted span**, and the tool locates that span in
   the source **itself** before writing the record.
2. A decision whose span cannot be located is **refused alone**; the rest of the batch still lands,
   so the batch degrades one record at a time.
3. The batch is **capped**, and a source above the cap is refused with the **heading boundaries the
   tool found**, so splitting is mechanical.
4. It writes **only proposed records**: no batch puts a decision in force.

Single-decision ingestion keeps its stronger guarantee unchanged, and both paths write proposed
records that wait for the same consent.

## Reasoning

The source — `docs/ratchet/sources/2026-09-15-the-decision-lifecycle.md`, whose hash this record
pins — records the direction, the measurements and the answers. Batch extraction was chosen to serve
volume first, knowingly accepting the weaker per-record attribution; the span requirement is what
keeps the weakness bounded and mechanical rather than trusting the judge's own provenance claims.
Refused alternatives are on the record: a section anchor only (it cannot catch a sentence invented
inside a real section), trusting the judge's per-record claims, and a `mode` parameter on the
existing tool.

## Consequences

- A large document becomes a handful of capped calls rather than one per decision, and the person
  handing it over gets a written record of the span each decision was drawn from.
- The per-record span makes the extraction auditable after the fact: a reader can check a record
  against the document without re-running the judge.
- The weakness is bounded, not removed: a span can be located and still be quoted out of context, so
  the human's ratification remains the backstop, exactly as it is for single-decision ingestion.
- Deferred, and recorded as deferred in the source: the per-record lifecycle queue that would make a
  large batch's progress visible, and a hard requirement answering semantic duplicates (ADR 0032).
