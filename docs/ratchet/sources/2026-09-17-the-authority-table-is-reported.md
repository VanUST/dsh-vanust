# The authority table is reported, and its repairs are drafted

Reasoning for ADR 0061. Captured 2026-09-17, from a project whose records named four
zones its manifest did not declare.

## The failure

A record declares `zones: [art]`. The manifest declares seven zones and none is `art`.
`zonesForRecord` resolves the miss to the conservative default policy with **no paths**,
so `declaredZonePaths` returns nothing, every law whose positive target is a path is
refused as `LAW_PATH_OUTSIDE_DECLARED_ZONE`, the agent record cannot self-activate, and
`ratificationQueue` refuses to offer it because a consent would be inert. Six records in
that project were blocked this way, and the reason was the same in each: the zone table
had drifted from the records.

The drift is structural, not a one-off. A zone **rename** orphans every record that
referenced the old id; a **path move** leaves a declared path matching nothing, which
silently retires any `forbidden_file`/`forbidden_glob` law over it because absence is
their success condition; a **new area** is governed by no zone and no law can target it.
And the manifest itself is governed by no zone — it sits in `zoneCoverage.exceptions` —
so it can be edited without a decision record, which is how the drift starts.

Nothing reported any of this until a record tried to enter force. The first symptom was a
blocked card, and the fix was detective work across the corpus and the manifest.

## What is derivable, and therefore what was missing

The `zoneId → paths it must cover` mapping is already implied by the corpus: a record
declares its zones and its laws carry their positive check targets. So a report can be
computed with no judgement:

- zone ids referenced by records but not declared, each with the union of its records'
  law targets as **inferred paths**;
- declared zones nothing references, and declared paths that match no tracked file;
- laws the compiler refused for enforcing outside their record's zones.

From the same facts a **draft** follows: the inferred paths, the conservative
`proposeOnly` authority, and the records that need it — a proposal a human applies to the
manifest and ratifies. That is the shape the ratchet already uses for duplicates
(`ratchet-deduplicate.mjs` drafts, nothing enters force) and for decidable contradictions
(the compile drafting pass).

## Decision

`ratchet zones` reports the authority table and exits non-zero when it is broken:
`ZONE_UNDECLARED_REFERENCE`, `ZONE_PATH_EMPTY`, `ZONE_LAW_OUTSIDE`. `--write` drafts one
declaration per undeclared zone under `reports/ratchet/drafts/`, never overwriting an
existing draft. The report never edits the manifest and never writes a record. `ok` is
reported only when there is nothing to report, and it prints the marker `zones ok`.

A test pins the three shapes over fixtures: a referenced-but-undeclared zone reported with
its inferred paths, `--write` drafting and then keeping the draft, and a clean table
exiting zero with its marker.

## What this does not yet do, stated plainly

- **A rename is still an N-record edit.** The report finds the orphaned records; it cannot
  retarget them. An alias map (old id → new id) in the manifest, or a ratified rename that
  rewrites the records as its effect, is the next step.
- **The draft is a file, not a proposed record.** The manifest is not an ADR, so the
  proposal lives under `reports/ratchet/drafts/` until a human applies it. Making a zone
  change itself a ratified decision — so the table and the records cannot drift without
  something saying so — is a larger change than this record.
- **Write-time validation covers ingestion only.** `ratchet_ingest` already refuses a zone
  the manifest does not declare; a hand-authored file bypasses it. The report is what
  catches that, at the next run.
