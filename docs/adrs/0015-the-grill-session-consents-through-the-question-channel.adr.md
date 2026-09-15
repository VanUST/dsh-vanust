---
id: "0015"
title: The grill session consents through the same question channel
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-15T07:13:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-grill-consent-entry.md
  hash: sha256:33d3138bb279b966fa0ade9b4900d5cfbbd2d6ec956dd40c45c96e192d41d948
zones:
  - shipped-plugins
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.the-grill-entry-triggers-the-one-question-and-accepts-no-answer
    statement: The grill session's consent entry puts the ratchet's own question to the human through the one question channel and exposes no key an answer could travel in, so it is a third entry to the single channel and never a third channel.
    checks:
      # Behavioural and structural: the script registers every tool against a fake
      # context and asserts that the ingestion surface carries exactly the keys it is
      # allowed to and that `ratify` is the boolean that triggers the ask. A key added
      # later is a deliberate edit to the allow-list, not a quiet widening.
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the ingestion surface triggers the ratchet question and accepts no answer
        timeoutMs: 120000
        outputContains: consent surface ok
  - op: upsert
    id: shipped-plugins.ingestion-ratifies-only-a-record-it-wrote
    statement: Ingestion puts a decision to the human only after it has written it, and reports rather than mints when the record was not written, no question channel is available, or the answer cannot be read.
    checks: []
    unenforced: The behaviour is asserted by two tests in `scripts/test-ratchet.mjs` — one drives the tool with a supplied judge result and a stub channel and requires an approval, the other drives it with no judge and requires `attempted: false` and no question. No gate-level check binds them yet, because the suite is a single `node --test` invocation that prints TAP rather than a stable marker line; it becomes enforceable when a dedicated invariant script drives the tool into the three fail-closed states and asserts nothing is minted.
---

## Context

The human asked for two entries to approving an agent's decision: the ADR panel, and the grill
session. The panel entry is ADR 0014. This record is the grill entry.

Grilling today ends at a proposal. `ratchet_review --job grill_preparation` returns an **agenda**
of questions; the agent grills the human in chat; `ratchet_ingest_source` turns the reasoning into
an ADR whose own contract says it is "always `proposed`" and whose `nextStep` sends the human to
`ratchet_ratify`. The consent is therefore a separate action taken after the grill, and the grill
session is a venue for producing decisions rather than for consenting to them.

The measurement that constrains the shape is the same one ADR 0014 recorded: the question seam is
`user-questions/request`, typed `Scoped<Agent>`, and there is exactly one channel
(`RATIFY_CHANNEL = 'user-question'`). A tool execution holds the session's agent, so a tool is a
place a question can be asked from. A browser bundle is not. And no argument anywhere may accept an
answer.

## Decision

- `ratchet_ingest_source` gains a **`ratify`** boolean. When it is true and the record was written,
  the same call puts the newly ingested decision to the human through the one question channel and
  records the approval on an exact approve.
- It is a third **entry** to the one channel, never a third channel: the quiz is the ratchet's own,
  the answer is derived from the labels the human selected, and no value of `ratify` carries an
  answer.
- It **fails closed**. A record that was not written, a missing question channel, and an unreadable
  answer each produce no approval; the proposal and the reason are returned so the caller can put
  the question itself.
- The flow it enables: `grill_preparation` → the agent grills the human → the reasoning is written
  to a source file → `ratchet_ingest_source { write: true, ratify: true }` → the ratchet's question
  → approval.

## Reasoning

The reasoning source — `docs/ratchet/sources/2026-09-15-grill-consent-entry.md`, whose hash this
record pins — records the alternatives and why they were refused: a separate `ratchet_grill` tool
cannot hold the multi-turn conversation a grill is and would either be a second question mechanism
or a wrapper that does not grill; letting `grill_preparation` mint consent from the human's chat
answers is the composed-answer path the ratchet cannot distinguish from a sentence an agent typed.

While implementing this, the ingestion tool was found **broken and untested**: its body called
`ingest(...)`, which the adapter never imported, so every call threw `ReferenceError: ingest is not
defined`. Nothing caught it, because no test executed the tool's body and the consent-surface check
only read the tool's schema. The import is fixed and two tests now drive the body. That is recorded
because it is the failure mode this project exists to remove: a declared surface nothing ever
executed.

## Consequences

- The record declares `shipped-plugins` (`plugins/**`, `proposeOnly`) and `kit-tooling`
  (`scripts/**`, `probes/**`, `activeIfNoConflict`). Because one declared zone is `proposeOnly`, an
  agent cannot self-activate it: it stands `proposed` and waits for a human.
- `shipped-plugins.the-grill-entry-triggers-the-one-question-and-accepts-no-answer` is checked now by
  `scripts/check-consent-surface.mjs`, whose exact allow-list for the ingestion surface is
  `['ingest', 'ratify', 'source', 'write']`.
- `shipped-plugins.ingestion-ratifies-only-a-record-it-wrote` is unenforced and says why: the two
  tests that assert it run inside `node --test`, which has no stable marker line for a law to assert
  on. Binding them is a follow-up invariant script, not a weakened statement.
- The grill session now ends with consent when the caller asks for it, and still ends at a proposal
  when it does not: `ratify` defaults to false, so the existing behaviour is unchanged for every
  caller that does not opt in.
- `check-consent-surface.mjs` now reads two tool schemas rather than one, so a new argument on the
  ingestion surface fails the consent-surface check until it is deliberately allowed.
