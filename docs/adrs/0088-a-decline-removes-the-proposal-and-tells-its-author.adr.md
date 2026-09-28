---
id: "0088"
title: A human decline removes the agent's proposal and tells the agent that proposed it
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-28T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-28-a-decline-removes-the-proposal-and-tells-its-author.md
  hash: sha256:b7fe2c7ac723db64d2f4b7844f0c329277dbd2680367ed4172fceb9cd2e815d3
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.a-decline-removes-an-agent-proposal
    statement: A human decline of an agent-authored record that is still a proposal removes that record's file, and a removal that fails is reported rather than passed over, because a declined proposal that stays on disk is offered again as if nothing had been answered.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a rejected answer removes the proposal file and reports the removal, and a removal that cannot happen is reported as a problem
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.a-decline-leaves-a-human-record-alone
    statement: A decline never removes a human-authored record or a record that is not a proposal, and it records the reason it was left, because a person's own draft is theirs to keep and a decline that destroyed it would be the ratchet deciding for the human.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a declined human-authored proposal keeps its file and the result carries the reason it was kept
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.a-decline-tells-the-producing-agent
    statement: A decline is delivered to the Sessions the ratchet has seen working in that project, actively when such a Session is live and never as a failure of the consent when it is not, and the producing agent is asked for nothing.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a live producing Session receives one user-role message naming the record and the reason, a Session with no live agent is skipped, and the notice asks for nothing
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.a-decline-is-a-reported-fact-not-a-problem
    statement: The decisions a human declined are reported as a field of the ratchet's status and of the decisions view, and the refusal itself raises no problem code, because a refusal is a decision a human made rather than a defect in the project. Removing a record does change the tree, so a verification recorded before the decline is reported stale exactly as it would be after any other edit; that verdict is about the tree, not about the decline.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: status carries the declined decisions after a refusal, and no problem code names the refusal itself
        timeoutMs: 300000
---

## Context

A human declined one proposal twice in a real project and the decision stayed on screen reading
"awaiting a human". The ledger recorded both refusals, and the ratchet's own needs-a-human set
already excluded the record — but the record kept `status: proposed`, the queue kept offering it,
and the panel's badge is drawn from the record's own derived state, which no refusal reaches. The
button appeared to do nothing.

The old shape was deliberate: a refusal mints nothing, so the record stayed ratifiable and a
change of mind stayed one click. That is a defensible reading of a *view*, and it produced a
control that lies about what it did.

An ADR carries its author's model name and never the Session that wrote it, and the project in
question had no ingestion event at all: its records were written by hand, so nothing anywhere
named a producing Session.

## Decision

1. A decline removes the declined agent-authored `proposed` record. No consent exists to void, and
   the file is recoverable from version control.
2. A human-authored record, or one that is not a proposal, is never removed, and the result says
   why it was kept.
3. The refusal, its reason, and what became of each file are recorded in the append-only ledger and
   returned by the ratification.
4. The producing Sessions are remembered in a bounded recency file, and a decline is delivered to
   them: actively through the harness's live-agent registry when such a Session is live, and
   durably as a field of `ratchet_status` and of the decisions view model in every case.
5. The notice is delivered in the background: the consent service stays synchronous, because a
   human's click must not wait on another Session's agent and must not fail if that delivery does.
6. A removal that fails is reported as a problem rather than silently leaving the file behind.

## Reasoning

The cited source carries the ledger lines, the record's own derived state, the panel's rendering
path, and the measurements: no ingestion event in that project, and `@deepseek-ai/dsh-llm` present
in the profile's hoisted `node_modules` alongside `@deepseek-ai/dsh-tools`, which was verified by
resolving it from the installed plugin directory rather than from the source tree.

The two halves of the notice exist because either alone is a silent failure. An active-only notice
is lost whenever the producing Session has closed — the normal case, since a proposal is written in
one sitting and declined in another — and a durable-only notice is lost to an agent that never
reads a status. The refusal is therefore both pushed when it can be and written down when it
cannot.

Deletion is the substance and the notice is the courtesy: the defect was a decision that appeared
not to have been decided. Once the file is gone the queue cannot offer it and no view can render it
as waiting; the notice is what stops the agent from proposing the same law again.

## Consequences

- A declined proposal is no longer ratifiable, so a change of mind means re-proposing rather than
  clicking again. That is the trade this record makes: the alternative kept a control whose whole
  effect was invisible.
- The ratchet's tool adapter now imports `@deepseek-ai/dsh-llm` for `createUserMessage`. The
  packaging check that pins the peer set is extended in the same change, with the reason recorded
  in the test and the hoisting measured.
- Records written before this change have no remembered producing Session and receive the durable
  notice only.
- A decision's source file is not removed with its record: it is reasoning another record may cite,
  and removing it would be a second removal nobody reviewed.
