---
id: "0017"
title: An agent's proposal licenses the work and never becomes law by itself
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-15T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-agent-proposals-are-not-blocking.md
  hash: sha256:6c143b5cdcb46c5239a78fe8e9d4dfd03090af461967b3617ec74adaa9dab345
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.a-proposed-decision-licenses-the-work
    statement: A PROPOSED decision that names a zone satisfies that zone's requiresDecisionRecord, so an agent may write the work it describes before a human decides, while the proposal itself adds no law, no check and no generated spec — only decisions in force compile.
    checks:
      # The suite drives the real guard: a proposal is written, the write it licenses is
      # allowed, and the state still reports no in-force record for the zone. The marker is
      # printed only after every assertion held.
      - type: command
        run: node --test scripts/test-ratchet-guard.mjs
        expects: a proposed record licenses a governed write without becoming law
        timeoutMs: 180000
  - op: upsert
    id: shipped-plugins.a-proposal-never-licenses-a-human-only-zone
    statement: A proposed record never satisfies requiresDecisionRecord in a zone whose agentAuthority is humanOnly, because the compiler refuses an agent-authored record there even when a human ratifies it, so a proposal that licensed the write would let an agent govern a zone the manifest reserved to humans.
    checks:
      - type: command
        run: node --test scripts/test-ratchet-guard.mjs
        expects: a proposed record cannot license a zone the manifest reserves to humans
        timeoutMs: 180000
  - op: upsert
    id: shipped-plugins.a-contradiction-with-law-in-force-stops-the-work
    statement: A proposed decision that removes a law in force, or redeclares one under a different statement, refuses writes into the zones it names — including zones a decision in force already covers — and the refusal is recomputed from the corpus on every write, so editing the proposal lifts it with no other action; only the decidable form of a contradiction is caught here and the rest is refused to the review judge with that limit stated.
    checks:
      - type: command
        run: node --test scripts/test-ratchet-guard.mjs
        expects: a proposal that contradicts law in force stops writes until it is edited, and a removal stops them too
        timeoutMs: 180000
---

## Context

The guard that enforces `requiresDecisionRecord` accepted only decisions **in force** as
satisfying the rule. In a zone declaring `requiresDecisionRecord: true` with
`agentAuthority: proposeOnly`, an agent could write the decision record and then be refused
every write into the zone it named until a human ratified it. Writing the record was cheap;
the work could not start.

That is the opposite of the operating model: an agent works for an hour, proposes decisions
as it goes, and a human later ratifies, changes or declines them. The block made the
proposal a request for permission rather than a record of a decision already taken, and it
fired hardest in the zones an agent most needs to change — the ones a decision already
describes.

A proposal was also already powerless in the way that matters. `compileLaws` is called with
the in-force set alone, so a proposed record contributed no law, no check and no generated
spec. And nothing detected a contradiction: because only the in-force set compiles, a
proposal that contradicted a law already in force produced no signal at all until a human
ratified the very thing that contradicted it.

## Decision

A **proposed** decision naming a zone satisfies that zone's `requiresDecisionRecord` and
adds nothing to law. Two boundaries hold it in place:

- **Not in a `humanOnly` zone.** The compiler refuses an agent-authored record there even
  when ratified, so a proposal could never become law there and licensing a write would be
  an override rather than a proposal.
- **Not while it contradicts law in force.** A removal, or the same law id under a
  different statement, refuses writes into the zones the proposal names.

## Reasoning

The license takes nothing away from a human. `compileLaws` is fed the in-force set alone,
so a proposal contributes no law, no check and no generated spec — the autonomy it buys is
permission to write code the ratchet does not yet judge, not a decision that governs
anything. A human still reaches the same record and ratifies, changes or declines it, and
until they do the record is evidence of what the agent decided rather than law.

The contradiction boundary is checked before the in-force and proposal answers, so a zone a
decision already covers is not exempt. Working against what a human ratified is the one act
a proposal must not buy, and an existing decision does not make it less of one. Checking it
first also means the stop is uniform: whether or not the zone was already governed, the
same contradiction produces the same refusal.

The check is the decidable subset only, because a guard runs before every write and asks no
model. `review_proposal`'s question asks the judge for the rest, and that answer is
advisory and unpersisted — a semantic contradiction does not stop a write today. The law
says so rather than implying otherwise.

Excluding `humanOnly` follows from the compiler's own rule, not from a second judgement: an
agent-authored record there is refused even when ratified, so a licence would let an agent
govern a zone the manifest reserved to humans by writing a file the ratchet then declines
to activate. Only an in-force decision opens such a zone, and only a human writes one.

## Consequences

- An agent proposes and keeps working; a human decides later, on the same record, with the
  work already in the tree and visible in the diff.
- The record a licence rests on is the record the human will read, so the reason for the
  work is written down at the moment it is done rather than reconstructed afterwards.
- The stop is self-clearing: the contradiction is recomputed from the corpus on every
  write, so editing the proposal lifts the denial with no state to clear and no restart.
- A zone reserved to humans keeps its reservation, and the only way in remains a
  human-authored record.
- The judge's half of the contradiction rule is stated as a limit, not an enforcement. It
  is the first thing a later amendment should close.

## Alternatives rejected

- **Let a proposal license only zones no decision in force covers.** Rejected: it enforces
  the rule exactly where it costs the most autonomy and leaves it useless exactly where it
  would matter, since the zones that already carry a decision are the ones an agent's
  change touches.
- **Record a conflict in state and clear it when the proposal changes.** Rejected: it adds
  state, a staleness rule, and a question about who may clear it — which is a question the
  ratchet exists to put to a human. Recomputing from the corpus removes all three and
  makes the stop lift by itself.
- **Ask the judge on every write.** Rejected: the guard runs before every write, and a
  model call there would make writing slow, unreliable and dependent on a judge's
  availability for a rule whose decidable part is enough to catch the contradictions that
  stop work.
