# The decision lifecycle: resolution, retirement, duplication and batch ingestion

Captured 2026-09-15. This is the reasoning behind ADRs 0031, 0032 and 0033, which all pin this
file's sha256. It records the human's direction, the measurements that shaped the design, and the
decisions taken question by question.

## The direction, verbatim

> "I think we need resolution mechanism for resolving adr's contradicting specs, for removing
> old/deprecated adr's, deduplicating specs/adr's, batching mechanisms for processing multiple
> decisions."

The scenario behind it: a large document is handed over in chat, containing many decisions, some
new and some contradicting decisions already in force.

## Measurements that shaped the design

Every one of these was read out of the installed ratchet (0.2.38) rather than assumed.

1. **A contradiction is folded from the append-only ledger.** Deleting or hand-editing the JSON
   cache does not lift a block. An entry that judged a PROPOSED record stops standing the moment
   that record is edited, because the record's content hash is the text the judge read — the block
   is self-clearing and the record is re-judged. An entry is dropped by `blockedZones` once its
   findings no longer name a law in force. An entry bound to raw MATERIAL (a diff, a source, a
   change with no record behind it) stands until a later review of that same material clears it via
   `clearContradiction`, because no other artifact's change could clear it.
2. **Writing the record files is never refused** ("the files that satisfy the rule are themselves
   never refused"), and the review infrastructure is exempt from a standing contradiction, which is
   what keeps the edit-to-clear route usable — so a resolution can always be written even while its
   zone is blocked.
3. **Removal is bound to authority.** An agent-authored record cannot remove a law whose force came
   from a human ratification (`LAW_REMOVE_UNAUTHORISED`), and in 0.2.38 supersession answers to the
   same authority as removal, so an unratified agent record cannot retire a ratified one either.
4. **Static detection already covers the letter**: `LAW_CONFLICT` (one law id, two different
   statements), `LAW_REMOVED_WITHOUT_DECISION`, `ZONE_OVERLAP`, `LAW_PATH_OUTSIDE_DECLARED_ZONE`.
   A law declared by two records with an identical statement is not a conflict: it is bound to the
   union of the zones both named.
5. **Deduplication does not exist.** `LAW_CONFLICT` sees only the same id with a different
   statement; two records asserting the same thing under different ids are invisible to every
   static check.
6. **Multi-target consent already exists.** Approval 0008 binds seven records (0001–0007), one
   content hash each, so batching consent was never the missing piece.
7. **The judge needs a live root agent.** Judge-driven operations are session tools; the CLI has no
   judge command (`compile`, `verify`, `status`, `pending`, `hash`, `falsify`, `bootstrap`), so a
   batch extraction path cannot be a CLI command.
8. **Ingestion today is one decision per call**, each spawning its own judge, with the tool
   verifying that every sentence the judge attributes to the source appears in it.

## The decisions, question by question

Each was put to the human as a single question with a recommended answer; the answer recorded here
is the option they chose.

1. **Authority of a resolution.** Chosen: *inherit the removal authority rule* — a resolution,
   retirement or merge answers to the same authority as a removal, so an agent may do it for
   agent-activated records and anything whose force came from a human ratification needs a new human
   ratification. Rejected: letting a resolution act on ratified records without new consent (which
   would make `resolve` a bypass of `remove`), and making every resolution human-gated even between
   two agent-activated records.
2. **The form of a resolution.** Chosen: *an ordinary ADR plus a `resolves: [id, id]` field* — the
   record states the conflict, removes the losing laws and supersedes the losing record, and the
   field makes the settled conflict machine-readable for audit and for duplicate checks. Rejected: a
   new `type: resolution` (schema, panel, guard and consent-surface changes for semantics that
   `supersedes` plus `remove` already carry), and a prose-only convention.
3. **Duplicate detection.** Chosen: *the deterministic subset gates, semantic duplicates are
   advisory* — a command fails on the decidable cases (identical statement text under different law
   ids, one source hash cited by two records, a re-declared law no resolution accounts for), while a
   judge's duplicate finding is a report the agent must work through. Rejected: letting a model
   verdict block the build, which would be the first non-deterministic gate in this system.
4. **Batching.** Chosen: *batch extraction — one call, many records*. Offered and refused: a queue
   with per-record lifecycle state as the first batching mechanism (deferred, not rejected), and
   batch consent first (already expressible). The cost accepted knowingly: in single-decision mode
   the tool can mechanically check that every sentence the judge attributes to the document appears
   in it, and one read of a large document weakens exactly that check.
5. **Batch attribution.** Chosen: *require a verbatim span the tool locates itself, cap the batch,
   split a large document on its headings*. Each extracted decision carries a quoted span, and the
   tool locates that span in the source before writing the record; a decision whose span cannot be
   found is refused while the others still land, so a batch degrades one record at a time. Rejected:
   a section anchor only (it cannot detect a sentence invented inside a real section), and trusting
   the judge's per-record provenance claims.
6. **The batch surface.** Chosen: *a new `ratchet_ingest_batch` tool*. Forced in part by
   measurement 7: the judge needs a session, so the CLI cannot host it. Rejected: a `mode` parameter
   on `ratchet_ingest_source`, because one tool whose guarantees differ by argument is what the
   consent-surface check exists to keep simple.

## What is deliberately NOT decided here

- **A hard requirement answering a semantic duplicate.** Decision 3 leaves "the same decision in
  different words" as an advisory finding. Requiring it to be answered by a `resolves:` record or an
  explicit rejection would close the hole harder, and it is a seventh decision that was offered and
  not assumed.
- **The lifecycle queue.** Per-record state between "proposed" and "waiting for a human" was offered
  as decision 4's recommendation and not chosen. It remains the thing that makes a large dump
  tractable, and nothing here forecloses it.
- **Expiry for specifications.** Specs are transient work orders, not decisions: their correct end
  is deletion when the work lands, and their collision rule (`PROC-SPEC-SCOPE-DISJOINT`, enforced by
  `specs:check` and `resolveScopeFiles`) already refuses two active specs claiming the same write
  area. The rot is an in-flight spec that never lands, which needs its own record.

## What each decision implies is checked

The implementation does not exist yet, so every law in the three records is declared `unenforced`
with the enforcement point it will carry. The intended points, in the order they will be built:

- A compiler/schema change admitting `resolves`, and a test that a resolution removing a ratified
  law is refused until ratified.
- A deterministic duplicate check as a repository-owned command, with the advisory judge report
  separately.
- The batch tool with its span locator, its cap and its split guidance, plus a test that an
  unlocatable span refuses that record and only that record, and a falsification that a hand-written
  span which is not in the source mints nothing.
