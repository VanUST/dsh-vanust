---
id: "0031"
title: A decision is resolved, retired and merged under the authority of a removal
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-15T16:35:00Z"
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
    id: lifecycle.a-resolution-answers-to-the-removal-authority
    statement: A resolution, retirement or merge that takes away a law's force answers to exactly the same authority as an explicit removal, so an agent-authored record may do it only where the zones let an agent hold force, and a law whose force came from a human ratification stays in force until a human ratifies the record that removes it.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a resolution that removes a law whose force came from a human ratification is refused until the resolution itself is ratified, and authorised once it is
        outputContains: "a resolution removing a ratified law is refused until it is ratified"
  - op: upsert
    id: lifecycle.a-resolution-is-an-ordinary-record-with-a-resolves-list
    statement: A resolution is an ordinary decision record that removes the losing laws, supersedes the losing record and names both sides in a `resolves` list, so the corpus can audit which conflict was settled and by what.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: resolves is refused unless it names exactly two distinct ADR ids, so naming one side only cannot settle anything
        outputContains: "the field carries exactly two distinct ADR ids"
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a resolution naming a record that does not exist, or one that is neither in force nor leaving it, is refused by the corpus audit
        outputContains: "a resolution naming a record that is neither in force nor leaving it"
  - op: upsert
    id: lifecycle.a-standing-block-lifts-when-the-challenged-law-leaves-force
    statement: A contradiction stops blocking writes once its findings no longer name a law in force, so a ratified resolution lifts the block without any separate clearing gesture and no resolved conflict is ever cleared by hand-editing a cache.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a resolution that takes the challenged law out of force makes the zone writable again with no clearing gesture, and withdrawing the resolution puts the block back
        outputContains: "a resolution that takes the challenged law out of force lifts the standing block"
  - op: upsert
    id: lifecycle.a-retired-record-says-so
    statement: A record that is retired says so in its own frontmatter, so a reader is never left following a decision whose laws no longer hold, and the retirement is visible without running the compiler.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a record a resolution retired, whose laws are all out of force, must carry a terminal status, and a terminal record that still sources a law in force is refused
        outputContains: "a record a resolution retired says so in its own frontmatter"
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a record whose status is terminal may not be the source of a law in force
        outputContains: "a terminal record may not be the source of a law in force"
---

## Context

Decisions accumulate faster than they are retired. The moment a large document is handed over, three
situations appear at once: a new decision that contradicts one already in force, an old decision that
should stop holding, and two records that say the same thing. The corpus can *detect* the first
mechanically (`LAW_CONFLICT`, and a judge for meaning) and the kit's guard blocks writes in the zones
a contradicted law governs — but nothing says how a contradiction is **settled**, or how a decision
is **retired**, and a block with no legitimate way out is a wall an operator eventually walks around.

Measurement decided the shape. A contradiction is folded from the append-only ledger, so editing a
cache cannot lift it. A block bound to a proposed record is self-clearing: the record's content hash
is the text the judge read, so editing it clears the block and re-judging blocks it again if it is
still wrong. An entry is dropped once its findings no longer name a law in force. Writing the record
files is never refused, and the review infrastructure is exempt from a standing contradiction, so
the way out is always writable.

That third fact is the hinge: **a resolution that removes the losing law's force lifts the block by
itself.** No new clearing mechanism is needed — and because removing a ratified law requires a human
ratification, the block against ratified law lifts only once the human has ratified the resolution.
The consent rule is what arms the mechanism, which is exactly why the authority question was settled
before the syntax question.

## Decision

A resolution, retirement or merge is an **ordinary decision record** that removes the losing laws,
supersedes the losing record, and names both sides in a `resolves: [id, id]` list. It answers to the
**same authority as a removal**: an agent may write one for agent-activated records, and anything
whose force came from a human ratification needs a new human ratification before it leaves force. A
retired record declares its own terminal status, so a reader is not left following a decision whose
laws no longer hold.

## Reasoning

The source — `docs/ratchet/sources/2026-09-15-the-decision-lifecycle.md`, whose hash this record
pins — holds the human's direction verbatim, the eight measurements, and each question with the
answer chosen. The two alternatives were rejected on the record: letting a resolution act on
ratified records without new consent turns `resolve` into a bypass of `remove` and makes the consent
guarantee decorative; a new `type: resolution` costs schema, panel, guard and consent-surface
changes to express what `remove` plus `supersedes` already mean.

## Consequences

- Settling a contradiction is a decision, not an edit: the block is lifted by putting a resolution in
  force, and the ledger keeps both the contradiction and the clear.
- A conflict between two **agent-activated** decisions can be resolved without the human; a conflict
  touching ratified law cannot, and that asymmetry is the point rather than an inconvenience.
- The mechanism is one-directional in a useful way: resolutions flow through the same refusal
  (`LAW_REMOVE_UNAUTHORISED`) that already protects ratified law, so there is one authority rule in
  the corpus and not two.
- Deferred, and recorded as deferred in the source: a hard requirement answering a *semantic*
  duplicate, the per-record lifecycle queue, and expiry for specifications that never land.
- **Measured while building the mechanism, and reported rather than resolved: the "removes the
  losing laws" half cannot be combined with the supersession half of this decision.** A resolution
  that supersedes the losing record takes that record out of force, so the record contributes no
  law and the resolution's own `op: remove` of the losing law is reported as
  `LAW_TARGET_DANGLING`; and a record whose laws were all removed by explicit `op: remove` cannot
  then be given a terminal status either, because a terminal record contributes no law to remove.
  There is no green corpus in which a record is FULLY removed, so `validateRetirement` fires on
  supersession (with every law out of force) and not on removal, and the two halves of the
  decision above cannot both be honoured at once. Which half should give way is a further decision
  this record does not take, and it is deliberately not papered over with a rule nobody can
  satisfy.
