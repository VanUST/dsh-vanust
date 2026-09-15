---
id: "0040"
title: Ratify ADR 0033
type: approval
status: active
author:
  authority: human
  name: human
created: 2026-09-15T18:13:42.935Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-ratification-0033.md
  hash: sha256:268c22f1a05984b9a998854d0218c1f25a39edf73e5ee58adc83d27b98bac4a1
zones: []
laws: []
supersedes: []
approves:
  - "0033"
ratification:
  channel: adr-panel
  at: '2026-09-15T18:13:42.935Z'
  askedBy: adr-panel session-085005b8-f069-4b9d-95d0-500096178360
  targets:
    - id: "0033"
      contentHash: sha256:2ea852094dd98cb98c71bc3da04bafa43fafa552251ebd4472852901e98d3ee0
---

## Context

- ADR 0033 — Batch extraction writes many proposed records, each citing a span the tool locates itself (docs/adrs/0033-batch-extraction.adr.md)
  - status: proposed; author authority: agent
  - zones: shipped-plugins (proposeOnly)

This record is not in force. A decision record is not a decision until somebody with the
authority makes it one, and the ratchet will not infer that from a status field an
agent can write: in a `proposeOnly` zone the author cannot activate its own
decision, and in any zone an agent that declares itself active is making the claim
the gate exists to check.

## Decision

A human was asked, in the ADR panel's decision window, whether this record should enter force,
and selected **Approve** for it. ADR 0033 is ratified at the content hashes recorded in
the frontmatter above and now contributes law.

The laws brought into force:

- `ingestion.a-batch-decision-cites-a-span-the-tool-locates-itself` — Every decision a batch extraction writes carries a quoted span from the source, and the tool locates that span in the source itself before the record is written, so a justification cannot be attributed to a document that does not contain it. (docs/adrs/0033-batch-extraction.adr.md)
- `ingestion.an-unlocatable-span-refuses-that-record-alone` — A decision whose span cannot be located is refused while the other decisions in the same batch are still written, so one misattributed extraction costs one record rather than the batch. (docs/adrs/0033-batch-extraction.adr.md)
- `ingestion.a-batch-is-capped-and-an-oversized-source-is-split-on-its-headings` — A batch extraction is capped in the number of decisions it will write, and a source above the cap is refused with the heading boundaries the tool found, so the split is mechanical rather than a judgement about where to cut. (docs/adrs/0033-batch-extraction.adr.md)
- `ingestion.batch-extraction-is-a-distinct-surface-and-writes-only-proposed-records` — Batch extraction is a surface of its own, distinct from single-decision ingestion, and every record it writes is proposed; no batch puts a decision in force. (docs/adrs/0033-batch-extraction.adr.md)

## Reasoning

Consent is recorded rather than asserted. The question showed the human the exact
text of each record, the answer was taken as a selected option with no
interpretation, and the transcript of both is the source cited above — so the
derivation can be re-read at docs/ratchet/sources/2026-09-15-ratification-0033.md instead of trusted.

Each approved record is bound to the hash it had when the question was asked, so this approval covers that text and
not a later revision of it. An approval that named only a title would keep
approving whatever the file said next, which is how a decision gets substituted
past the person who read it. The text itself is not copied here: it is the record,
committed beside this approval, and the hash is what makes a substitution visible
rather than silent.

Project: dsh-kit

## Consequences

- Editing any ratified record voids this approval: the compiler reports `RATIFICATION_STALE` and the law leaves force until it is ratified again.
- The law set changed, so the spec bundle must be recompiled and the code re-verified before anything is called checked.
- This approval confers force only. The ratified records keep their own author authority, so a ratified agent record still cannot govern a zone reserved to humans.
