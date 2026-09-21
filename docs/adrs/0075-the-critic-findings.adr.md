---
id: "0075"
title: The three calls the critic's findings force
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-21T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-21-the-critic-findings-and-the-three-calls.md
  hash: sha256:c6cbc9b04ad7fd45650b4a7c9613d3838c17f319394dae1e31fbf9d5c8b71420
zones:
  - shipped-plugins
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.the-removal-authority-is-the-strongest-declarer
    statement: When two records declare one law id and statement, the merged law carries the strongest authority either declarer had, so a human ratification is not diluted by an unratified twin and the authority to retire a law does not depend on ADR file order.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a ratified and an unratified declaration of one law id leave the law removable only by a ratified or human-authored record, in either file order
        timeoutMs: 300000
  - op: upsert
    id: kit-tooling.a-contradiction-blocks-only-the-paths-the-law-claims
    statement: A judged contradiction refuses a write only where the contradicted law's own path claim reaches — the paths of its path-scoped checks, or its whole zone when it declares none — so a block never stops work its finding says nothing about.
    checks:
      - type: command
        run: node --test scripts/test-ratchet-guard.mjs
        expects: a law whose path-scoped check names one subtree refuses a write there and admits a write beside it in the same zone
        timeoutMs: 300000
  - op: upsert
    id: kit-tooling.the-delegation-cap-is-measured-without-a-clock
    statement: The delegation cap's evidence is reproducible, awaiting the harness's own release edge rather than a fixed sleep, so the suite measures the mechanism and not the scheduler.
    checks:
      - type: command
        run: node --test scripts/test-work-modes.mjs
        expects: the suite reports the same verdict on repeated runs over one unchanged tree, driven by the release edge rather than a sleep
        timeoutMs: 300000
---

## Context

An adversarial critic over the seventy-six laws produced twenty findings. Seventeen are
defects against a meaning the corpus already states: a check whose oracle is the constant
under test, a law naming a verification with no test behind it, a note describing a
mechanism the code does not contain, or a production behaviour that inverts its own law.
Those are fixed in the code, and the law that already governs each one is the record for
the fix.

Three are not defects but underspecifications: the law holds under more than one
implementation and the corpus does not say which. This record decides them.

## Decision

1. **The merged law carries the strongest authority among its declarers.** `approvedBy` is
   the ratification if any declarer has one, and `authority` is `human` if any declarer is
   human-authored. A law declared by both a ratified and an unratified record can be
   retired only by a ratified or human-authored record.
2. **A judged contradiction blocks the paths the law claims.** When the contradicted law
   declares path-scoped checks, only a target under those paths is refused; when it
   declares none, its whole zone is refused.
3. **A law is never enforced by a non-reproducible suite.** The work-modes suite must
   await the harness's release edge rather than sleep; a suite whose verdict depends on the
   scheduler is not evidence, and the law it would enforce stays unenforced instead.

## Reasoning

The full reasoning is the cited source. In short: consent must not depend on file order,
because the same corpus must not yield two verdicts by renaming a file; a block that stops
work its finding says nothing about destroys the credibility of the block itself; and a
gate whose colour is luck teaches people to re-run it until it passes, which is worse than
an honest gap.

## Consequences

- A law with one ratified and one unratified declarer now needs a human to retire it. This
  is deliberate: an agent that wants it gone must ask, which is the same answer the corpus
  already gives for any ratified law.
- A contradicted law with no path-scoped check still blocks its whole zone. The fallback is
  the zone on purpose: a narrower fallback would let a finding be dodged by moving a file.
- `scripts/check-hermetic-laws.mjs` refuses a law bound to a probe, so the work-modes probe
  cannot be a law's check. Its evidence is release-gate only, and it is now wired into
  `scripts/verify-upgrade.sh` so that claim is true rather than aspirational.
