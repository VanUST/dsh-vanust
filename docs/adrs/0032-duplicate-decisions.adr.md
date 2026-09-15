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
    checks:
      - type: command
        run: node scripts/check-duplicate-decisions.mjs
        expects: this corpus holds no decidable duplicate, which is the command the gate runs
        outputContains: "duplicate decisions ok"
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: one statement text under two law ids fails that command with DUPLICATE_LAW_STATEMENT, so the command can fail rather than merely pass
        outputContains: "one statement under two law ids fails the deterministic command"
  - op: upsert
    id: duplicates.one-source-cited-by-two-records-is-reported
    statement: Two decision records citing the same source is reported, because it means one document was ingested twice and the second record is a restatement rather than a decision.
    checks:
      - type: command
        run: node scripts/check-duplicate-decisions.mjs
        expects: every source hash in this corpus is cited once, or cited by records that declare no law in common
        outputContains: "duplicate decisions ok"
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: one source cited by two records that declare a law in common fails the command with DUPLICATE_SOURCE_CITED, and one source carrying disjoint decisions does not
        outputContains: "one source cited by two records that share a law fails the command"
  - op: upsert
    id: duplicates.a-redeclared-law-with-an-identical-statement-merges
    statement: A law declared by two records with an identical statement is not a duplicate and not a conflict, and governs the union of the zones both records named.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a re-declared law with an identical statement is one law bound to the union of both records' zones, and the deterministic command reports nothing for it
        outputContains: "a re-declared law with an identical statement is NOT a duplicate, and merges"
  - op: upsert
    id: duplicates.only-a-judge-sees-is-reported-and-never-gates
    statement: A duplicate that only a judge can see — the same decision restated in different words — is reported as an advisory finding the agent must work through, and never fails the build, because a model verdict must not become a build gate.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the semantic duplicate is reported by the advisory judge job over a corpus the deterministic command calls clean, and it neither blocks nor moves that command's exit code
        outputContains: "the semantic report is advisory and the deterministic command does not depend on it"
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
- **Measured against this repository's own corpus, and narrowed rather than resolved: "one source
  cited by two records" cannot be read literally.** Four decisions here cite one design-session
  document and two cite one API-discovery document, and ADR 0033's batch extraction writes one
  record per decision from ONE source — so the literal rule would fail this kit and forbid the
  mechanism 0033 decided on. `scripts/check-duplicate-decisions.mjs` therefore reports a shared
  source when the records ALSO declare a law id in common, which is what separates a restatement
  from a second decision drawn from the same document. A re-ingestion that renames every law id and
  shares none with the first record is consequently not reported, and this record does not settle
  that narrowing.
