---
id: "0024"
title: A judge's semantic contradiction is a gate, not advice
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-15T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-a-judged-contradiction-blocks.md
  hash: sha256:66f039bbbc9de9c56ee007550b9beec457cd0ac43a18e8162f875fd2006068dc
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.a-judged-contradiction-declines-the-change
    statement: A review finding that a change contradicts a decision in force in meaning — severity error, kind semantic_violation or intent_violation, naming a law — is recorded as a fact and DECLINES the review, so the agent that proposed the change is told why and the work is refused rather than annotated; every other finding a judge may make stays advice.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a judge that classifies a change as contradicting a decision in force declines it and records the block, and no other finding kind does
        timeoutMs: 300000
      - type: command
        run: node --test scripts/test-ratchet-guard.mjs
        expects: a judged contradiction refuses the write, names the law and the judge's reasoning, and stops when the judged text changes
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.a-judged-contradiction-blocks-writes-regardless-of-the-zone-rule
    statement: The judged-contradiction block is enforced by the write guard before the inert answer and before requiresDecisionRecord, because a zone's record rule is opt-in per zone while a judge reporting that a change contradicts a decision is the price of enabling the ratchet at all; it is resolved through the same zone matcher the zone rule uses.
    checks:
      - type: command
        run: node --test scripts/test-ratchet-guard.mjs
        expects: the block applies in a zone that does not require a decision record, and only inside the zones the contradicted law governs
        timeoutMs: 300000
  - op: upsert
    id: shipped-plugins.a-self-review-may-raise-a-block-and-never-clear-one
    statement: A self-submitted verdict may record a contradiction it sees in the caller's own work, but only an independent judge's clean verdict, or an edit that moves the content hash the finding was bound to, retires a recorded block; a self-review that names no material declines without recording anything, because a block on material nobody named is a block nobody can clear.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a self-review raises a block, a clean self-review does not lift it, and an unnamed one records nothing
        timeoutMs: 300000
---

## Context

`ratchet_review` spawns an independent judge, validates the verdict and writes a report, and until
this record it returned `advisory: true, gate: false` — its own comment said the result "describes
the JUDGE's verdict, never a gate". A judge could therefore report that a change contradicts a
decision in meaning, with the law named, and the change went in anyway: no written check can see
that class of contradiction, and nothing else was listening.

ADR 0017 admitted this in as many words and left it as the stated limit of the mechanical tier. The
operator's requirement removes the limit: a semantic contradiction is to be prohibited or sent back
to be changed, with the judge's reasoning returned to the agent that proposed it.

## Decision

A review finding blocks when its severity is `error`, its kind is `semantic_violation` or
`intent_violation`, and it names a law. Such a finding is recorded against the material the judge
read, the review DECLINES, and the write guard refuses writes in the zones the contradicted law
governs until the block is retired.

## Reasoning

The enforcement has to be the guard, because the guard is the one component that runs before every
write and cannot be skipped by the agent it governs. A review result is read by whoever asked for
it; a guard denial is read by whoever tried to write. Asking the review to be the gate would put the
gate in a report.

The block is not gated on `requiresDecisionRecord`. That field exists so a project can opt a ZONE
into the record rule without opting in everywhere. A project that enables the ratchet and gets a
judge's decline has already opted into that, and answering "inert" because no zone asked for a
record would make the strongest guarantee in the system depend on the weakest setting.

The vocabulary is closed to two kinds on purpose. Anything the judge can say about the CORPUS
disagreeing with itself, or about one record's prose and its own laws, is a question for a human
rather than something the agent that triggered the review repairs by editing its change. A gate that
also refused work for those reasons would refuse work nobody has shown to be wrong.

Clearing is self-service by construction. The finding is bound to the content hash of the text the
judge read, so editing that text retires it, exactly as the mechanical tier's block lifts when the
proposal stops contradicting. An independent clean verdict retires it too. A self-submitted verdict
may raise a block but not clear one, for the same reason consent cannot be composed by the party
that wants it: a gate the gated agent can open is not a gate.

## Consequences

- The guarantee "no drift in the logic itself" now has a command that fails: a judge's contradiction
  refuses the write, and the agent gets the reasoning and the suggested action in the refusal.
- The judge is a model, so a false positive refuses work that is not wrong. The mitigations are
  structural: the narrow vocabulary, the reasoning carried in the refusal so the judgement can be
  judged, two named routes out, and a human who can always decide the question instead.
- `.dsh/ratchet/contradiction.json` is machine-written state. An agent that edits it by hand hides
  the question rather than settling it, which is the same residual gap the kit records for a
  hand-written approval, and for the same reason.
- The decision-state cache now keys on that file as well as the manifest and the corpus, because a
  block that takes effect only after an unrelated edit is not a block.
