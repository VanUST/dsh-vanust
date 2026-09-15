---
id: "0019"
title: The panel's consent laws are enforced by executing the bundle, and the seam by the probe
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-15T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-panel-consent-enforcement.md
  hash: sha256:c2a50ce4205a5f7d3099560fed82731a230da35fdab788ca6f881873d86dc082
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.the-panels-consent-laws-are-enforced-by-executing-the-bundle
    statement: The panel's consent laws — that it offers consent only through the ratchet's own question and records none of its own — are enforced by executing the shipped browser bundle and driving the real slot core, requiring the claim to be elected for the ratchet's real question while a claim at the default priority loses, the Conversation seat to render nothing the question owns in text, in a displayed attribute or behind any handler that can settle the question, the window's clicks to send exactly the batch the ratchet reads back as an approval or a rejection, and the whole render to call nothing but the file surface's two reads.
    checks:
      # The marker is printed only after every assertion held, so a partial run, a crash, or a
      # quietly emptied loop cannot satisfy it. The script EXECUTES the bundle; a check that
      # read it would have read the same prose the dead `priority: 1` claim was written from.
      - type: command
        run: node scripts/test-adr-panel.mjs
        expects: the panel's consent surface is measured by acting on it, not read
        timeoutMs: 180000
        outputContains: adr panel render ok
      # The half no single-bundle test can see: the intent literal is one value with two copies
      # across a seam that cannot import, and this fails when they stop being equal.
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the panel matches the intent the ratchet sends, and a grill gets no intent to claim
        timeoutMs: 180000
        outputContains: consent surface ok
  - op: upsert
    id: shipped-plugins.the-question-seam-is-measured-by-the-probe
    statement: The ratification question's path to a human is measured end to end against a live profile rather than assumed — the question reaches a real human channel with the live root agent, its presentation intent survives the wire, the answers are derived from the labels, an unreadable answer is re-asked in a different shape, and the approval puts the decision into force — because the panel presenting that question is only trustworthy if the thing being presented is.
    checks:
      - type: command
        run: node scripts/probe-dsh-api.mjs --ratchet-ratify
        expects: the ratification quiz runs end to end and the approval lands
        timeoutMs: 600000
        outputContains: 10/10 facts confirmed by execution
---

## Context

ADR 0014 decided how the panel ratifies, a human ratified it, and its three laws entered
force with **no checks** — each carrying an `unenforced:` reason, because the enforcement did
not exist yet. An in-force record cannot be edited to add those checks: editing a ratified
record voids the consent that put it in force, which is the mechanism the model rests on.

The measurement that arrived afterwards also changed the design. The panel's claim on the
Conversation's composer seat was registered at `priority: 1`, on a reading that said the chain
tried its entries in registration order. The chain sorts them **ascending by `priority`** with
the lower first, and the entry that owns the seat claims every question at `0`, so the claim
was never reached: the chat quiz the change existed to remove would still have rendered while
every structural assertion passed.

## Decision

The enforcement arrives as this record, which re-decides nothing and declares no law ADR 0014
already declares. It binds the two consent laws to commands that **execute** the bundle and
drive the real slot core (`node scripts/test-adr-panel.mjs`, `node scripts/check-consent-surface.mjs`),
and binds the asking seam to the probe that measures it against a live profile
(`node scripts/probe-dsh-api.mjs --ratchet-ratify`).

## Reasoning

An enforcement point written against source text would have read the same wrong comment the
implementation was written from, and passed. The check that catches a dead claim has to read
the winner off a real election, which is why the panel's laws are bound to a command that runs
the shipped bundle rather than to one that inspects it. The counterfactual is part of the
enforcement for the same reason: the check requires a claim at the default priority to LOSE,
so the ordering cannot quietly return to the value that made the claim dead code.

A second declaration of one law id under two records is the corpus contradicting itself, so
these are new ids stating where the enforcement lives rather than restatements of ADR 0014's
laws. That keeps one law with one declaration and leaves the ratified text untouched.

## Consequences

- The two consent laws and the asking seam stop being claims with a stated gap and become
  claims with a command that fails.
- A machine without a harness checkout runs the panel test with its election claims reported
  as `[SKIP]` and the reason named, so the laws are as strong as the machine's checkout. That
  is stated in the source rather than hidden, because a check that silently measures less than
  it claims is the failure this kit exists to refuse.
- The transport — a browser click travelling over the Remote to the waiting host — is still
  measured by nothing here. Both ends of the batch shape are measured; the wire between them
  is not.

## Alternatives rejected

- **Edit ADR 0014 to add the checks.** Rejected: it voids the consent that put it in force,
  and the record a human approved would stop being the record in force.
- **Re-declare 0014's law ids with the checks attached.** Rejected: two records declaring one
  law is the corpus contradicting itself, and the compiler reports it for a reason.
- **Keep the enforcement in the scripts and cite it only in their comments.** Rejected: a kit
  whose own rule is that a rule is real only where a command fails cannot leave its consent
  laws pointing at a comment. The comment is where the mechanism is explained; the law is
  where the failure is named.
