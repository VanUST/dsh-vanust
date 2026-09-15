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
    checks: []
    unenforced: "the resolution path does not exist yet: the compiler refuses `remove` and `supersedes` from an agent record against a ratified law (LAW_REMOVE_UNAUTHORISED), and the resolution record will be bound to that same refusal. It becomes enforceable with a test that a resolution removing a ratified law is refused until ratified, and accepted once it is."
  - op: upsert
    id: lifecycle.a-resolution-is-an-ordinary-record-with-a-resolves-list
    statement: A resolution is an ordinary decision record that removes the losing laws, supersedes the losing record and names both sides in a `resolves` list, so the corpus can audit which conflict was settled and by what.
    checks: []
    unenforced: "the `resolves` field is not in the schema yet, and the audit it exists for needs the compiler to read it. It becomes enforceable with a schema rule that a record declaring `resolves` names records that exist and are in or leaving force, plus a refusal when a resolution names one side only."
  - op: upsert
    id: lifecycle.a-standing-block-lifts-when-the-challenged-law-leaves-force
    statement: A contradiction stops blocking writes once its findings no longer name a law in force, so a ratified resolution lifts the block without any separate clearing gesture and no resolved conflict is ever cleared by hand-editing a cache.
    checks: []
    unenforced: "measured behaviour of `blockedZones`, which drops an entry whose findings no longer name a law in force, and of the ledger fold that survives deleting `contradiction.json`. It becomes enforceable with a test that removes the challenged law's force through a resolution and asserts the zone is writable again, and that the block returns if the resolution is withdrawn."
  - op: upsert
    id: lifecycle.a-retired-record-says-so
    statement: A record that is retired says so in its own frontmatter, so a reader is never left following a decision whose laws no longer hold, and the retirement is visible without running the compiler.
    checks: []
    unenforced: "nothing yet requires a terminal status on a record whose laws were all removed. It becomes enforceable with a check that a record whose laws are all out of force by a resolution carries a terminal status, and that a terminal record declares no law in force."
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
