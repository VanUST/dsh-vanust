---
id: "0018"
title: A question says where it is shown, and an agent's decision is answered in the panel
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-15T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-the-question-says-where-it-is-shown.md
  hash: sha256:2fced9a90e8e41a3a2dae38b503ef7aff9e06c0f86cfe266b46bb368b5e3c5a8
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.a-question-says-where-it-is-shown
    statement: The ratchet's presentation intent is attached to a ratification question only when the caller asks for the panel, so a grilling session's question declares none and the harness's own card asks it in the Conversation; an unrecognised presentation is treated as the Conversation's, because a value that does not say panel is one no client may claim on the ratchet's behalf.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the caller's presentation reaches the question and the re-ask
        timeoutMs: 300000
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the panel matches the intent the ratchet sends, and a grill gets no intent to claim
        timeoutMs: 180000
  - op: upsert
    id: shipped-plugins.an-agents-decision-is-never-a-chat-quiz
    statement: The ADR panel claims the Conversation's composer seat for a ratification question in order to suppress the harness's card and renders a pointer there — the decision's name and a way into the panel — never the question, its record text or either answer label, which appear only in the decision window; the claim is a suppression and not the only route to the human, so with nothing claiming the seat the question is still asked and answerable in the Conversation.
    checks:
      - type: command
        run: node scripts/test-adr-panel.mjs
        expects: the seat does not put the question or its record text in the Conversation, and offers no answer button
        timeoutMs: 180000
---

## Context

Two decisions met here. The ratchet stamps a ratification question with a presentation
intent so a client can render it itself, and the ADR panel was about to claim the
Conversation's composer seat for every such question and put the two labels there.

That second half was wrong for the product. An agent's decision is reviewed in the panel
that shows the record, its laws and its relations; asking the same thing as a two-button
card in the chat would put a consent question in the middle of a conversation it has
nothing to do with, and would ask the human to answer a question about a document they
cannot see.

But a grilling session is the opposite case and had to stay: there the agent is talking to
the human, the human is expected to answer before the conversation moves on, and the
question blocking the chat is the point.

## Decision

Where a question is shown is part of the question. `buildQuiz(entries, { present })`
attaches the panel's intent only for `'panel'` — the default — and `'chat'` attaches
nothing, so the harness's own card renders it in the Conversation.

The tool `ratchet_ratify` and the `/ratify` command ask for the panel. The grill entry,
`ratchet_ingest_source` with `ratify: true`, asks for the Conversation. The panel claims
the composer seat only for the panel intent, and what it renders there is a pointer: the
decision's name and a button that opens the window.

## Reasoning

The question and its record text are one object: the detail the human is shown is the
record's own file text, the bytes the consent hash covers. Asking it as a chat card puts a
consent question in a conversation that cannot show the document the consent is about, and
makes the human answer about text they are not looking at. The panel is where the record,
its laws and its relations are already on screen, so it is where the question belongs.

A grilling session is not that case. There the agent is mid-conversation with the human,
the reasoning was just discussed in it, and the human is expected to answer before the
session continues. Blocking that conversation is the feature, and the grill entry is the
one caller that knows it is in one — so it is the caller that says so, rather than a
property a client infers.

The panel's claim exists to suppress the harness's card, and that shapes its failure mode.
If nothing claims the seat — the bundle absent, or a harness that reorders the chain — the
harness asks the question in the Conversation and the human can still answer it. The
failure is a question asked in the wrong place, never a question nobody can answer, and the
law states that property because a claim that could strand a consent would be worse than no
claim at all.

The presentation is a value the ratchet sends, not a mode the client guesses, because the
client cannot see the caller. `'chat'` is also the fallback for an unrecognised value: a
presentation that is not explicitly the panel's is one no client may claim on the ratchet's
behalf, so an unknown value degrades to the presentation that needs no claim.

## Consequences

- An agent's decision is never a chat quiz, and the Conversation is not interrupted by a
  consent question about a document it cannot show.
- A grilling session is unchanged: the question is asked, and blocks, in the conversation
  already taking place, and its answer is the consent.
- The claim is a suppression rather than the only route to the human. With nothing claiming
  the seat — the bundle absent, or a harness that reorders the chain — the harness asks in
  the Conversation instead. The failure mode is a question asked in the wrong place, never
  a question nobody can answer.
- The intent and the seat are two halves of one value that cannot be imported across the
  seam, so `scripts/check-consent-surface.mjs` asserts the literal the panel matches equals
  the one the ratchet sends; drift there would silently return every question to the chat.

## Alternatives rejected

- **An `origin` field beside the intent.** Rejected: an intent already means "present me
  like this", so a grill that wants the harness's card should declare none. Two fields
  saying where a question goes is two things to keep in agreement.
- **Claiming the seat and rendering the question there as well as in the window.**
  Rejected by the operator: it makes the agent's decision a chat quiz and duplicates one
  consent surface in two places, where either could look like the authoritative one.
- **Not claiming the seat at all, and putting the question only in the window.** Rejected:
  the harness's card would then ask the same question in the Conversation and the human
  would be shown it twice, in a place the decision says it should not be.
