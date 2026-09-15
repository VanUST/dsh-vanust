# The grill session's consent entry

Date: 2026-09-15. Status: the reasoning behind
`docs/adrs/0015-the-grill-session-consents-through-the-question-channel.adr.md`.

## The request

The human asked for the ratchet to have **two entries to approval**: the ADR panel, and the grill
session. The panel entry exists (ADR 0014); this record is the grill entry.

## What grilling does today, and what it does not

`ratchet_review --job grill_preparation` spawns a judge and returns an **agenda** — questions, in
the order they must be answered, for a human. The agent then grills the human in chat. The output
of that conversation is reasoning; it is not a decision record and it is not a consent.

`ratchet_ingest_source` turns a source of reasoning (the transcript, a brief, an investigation
note) into an ADR. Its own contract is explicit: the record it produces is **always `proposed`**,
and its `nextStep` says "a human must ratify it before it becomes law: run `ratchet_ratify`".

So a grill session today ends at a proposal, and the human must then take a second action to
consent. The request is to close that gap: the grill should end with the question.

## The measurement that constrains the shape

The question seam is `user-questions/request`, typed `Scoped<Agent>`
(`dsh-tool-cordis/lib/index.js:5620`), and it is reached from a call that holds the session's
agent. A tool execution holds it (`exec.agent`); a command handler holds it (`invocation.agent`);
a browser bundle does not. `RATIFY_CHANNEL = 'user-question'` is the single channel
(`ratchet-ratify.mjs`), and `ratchet_ratify` deliberately has no parameter that accepts an answer.

Therefore a third entry is possible **only** where an agent already is — the tool surface — and it
must put the ratchet's own question rather than accept anything.

## The decision

- `ratchet_ingest_source` gains a **`ratify`** boolean. When it is true and the record was
  written, the same call puts the newly ingested decision to the human through the one question
  channel, using the ratchet's own quiz, and writes the approval ADR on an exact approve.
- It is a third **entry** to the one channel, never a third channel: no argument accepts an
  answer, and the consent is still derived from the labels the human selected.
- It **fails closed**. A record that was not written, a missing question channel, or an
  unreadable answer produces no approval; the proposal is reported and nothing is minted.
- The grill flow it enables is: `grill_preparation` → the agent grills the human → the agent
  writes the reasoning to a source file → `ratchet_ingest_source { write: true, ratify: true }` →
  the ratchet's question → approval.

## Why not the alternatives

- **A separate `ratchet_grill` tool that grills and ratifies in one call.** The grilling itself is
  a multi-turn conversation with the human, which a tool cannot hold; it can only ask the
  structured question the question channel supports. A tool that claimed to grill would either be
  a second question mechanism (a second channel) or a thin wrapper that does not grill.
- **Letting `grill_preparation` mint consent from the human's chat answers.** A chat sentence is
  not a question the ratchet asked, and the ratchet explicitly cannot tell one from a sentence the
  agent typed. Refused for the same reason the composed-answer path is refused.
- **Same channel, consent in the same call, no separate confirm step.** This is what the `ratify`
  option does, and it is the smallest honest change: the human still answers the ratchet's
  question; only the number of actions around it shrinks.

## What remains open

- Whether the panel's affordance should also offer "ingest and ratify" as one action for a source
  the user drops in. That is a UI question on top of the same command surface, not a new channel.
- Whether `ratchet_ingest_source` with `ratify` should also compile afterwards, so the new law is
  visible immediately. The ratification already compiles; the reporting is what would change.
