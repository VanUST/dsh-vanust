---
id: "0032"
title: Duplicate decisions are refused where they can be decided, reported where they cannot
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-15T16:40:00Z"
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
    id: duplicates.identical-statements-under-different-ids-are-refused
    statement: Two active records that declare the same law statement under different law ids are refused, because the corpus then holds one constraint twice and neither record owns it.
    checks: []
    unenforced: "no command checks this yet. It becomes enforceable as a repository-owned command the gate runs, refuted by two records carrying one statement under two ids."
  - op: upsert
    id: duplicates.one-source-cited-by-two-records-is-reported
    statement: Two decision records citing the same source is reported, because it means one document was ingested twice and the second record is a restatement rather than a decision.
    checks: []
    unenforced: "no command reads the source hashes across the corpus yet; the source hash is already recorded per record, so the check is mechanical once written."
  - op: upsert
    id: duplicates.a-redeclared-law-with-an-identical-statement-merges
    statement: A law declared by two records with an identical statement is not a duplicate and not a conflict, and governs the union of the zones both records named.
    checks: []
    unenforced: "measured behaviour of the compiler, which already binds a twice-declared law to the union of both records' zones. It becomes enforceable as a test that asserts the union, so a later change that narrows it back to one record is caught."
  - op: upsert
    id: duplicates.only-a-judge-sees-is-reported-and-never-gates
    statement: A duplicate that only a judge can see — the same decision restated in different words — is reported as an advisory finding the agent must work through, and never fails the build, because a model verdict must not become a build gate.
    checks: []
    unenforced: "the advisory report does not exist yet. It becomes enforceable as a check that the deterministic duplicate command's exit code does not depend on any judge, so the two enforcement strengths cannot silently merge."
---

## Context

The corpus can see a law declared twice under one id with two different statements (`LAW_CONFLICT`)
and a law whose force disappeared without a decision (`LAW_REMOVED_WITHOUT_DECISION`). It cannot see
the same decision stated twice under two ids, in either of the two ways that happens:

- **Decidably**: the identical statement text under different law ids; one source document ingested
  twice, which shows up as two records citing one source hash; a law re-declared by a second record
  with an identical statement.
- **By meaning only**: two differently-worded laws for one constraint. Only a judge sees this, and a
  judge is a model.

The kit has refused model-based gates throughout: a gate that depends on a judgement cannot be
re-run to the same verdict, and `check-gate-invariants.mjs` exists because a check nobody can rely
on gets ignored. So the two cases get two different strengths, and the boundary between them is
itself something to enforce.

## Decision

The deterministic subset **gates**: identical statement text under different law ids, and a source
cited by two records. A re-declared law with an identical statement is explicitly **not** a
duplicate — the compiler already merges it into the union of the zones both records named, and that
behaviour is pinned so it cannot silently narrow. Duplicates that only a judge can see are an
**advisory report** the agent works through, and the deterministic command's exit code must not
depend on any judge.

## Reasoning

The source — `docs/ratchet/sources/2026-09-15-the-decision-lifecycle.md`, whose hash this record
pins — records the measurements and the chosen answer, including the alternative that was refused:
letting a judge's duplicate finding block the build, which would have made this corpus the first
place in the kit where a model verdict is a gate.

The decision not to gate the semantic case is a real limitation, stated rather than hidden: a
40-decision dump can contain the same decision three times in different words and pass the gate. The
harder mechanism — requiring a semantic duplicate to be answered by a resolution record or an
explicit rejection — was offered as a separate decision and deliberately not assumed.

## Consequences

- A mechanical duplicate fails the build with the two records named; the fix is either a resolution
  (ADR 0031) or deleting the redundant record before it is ratified.
- The semantic case is visible in a report and invisible to the gate. An operator who skips the
  report gets no warning, which is the price of keeping every gate deterministic.
- Merging is a resolution, not a new mechanism: the surviving record keeps the statement and the
  other is superseded and its laws removed under ADR 0031's authority rule.
