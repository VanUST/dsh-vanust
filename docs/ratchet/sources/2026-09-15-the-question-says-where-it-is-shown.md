# An agent's ratification question is asked in the decision panel, and a grilling session asks it in the chat

Date: 2026-09-15. Operator decision, taken in the same session as the ADR-panel
ratification work. Scope: `plugins/ratchet/ratchet-{ratify,ops,tools}.mjs` (where the
question is built and asked) and `plugins/dsh-adr-panel/client.js` (which claims the
composer seat).

This file is the reasoning behind ADR 0018.

## The problem, in the operator's words

> Agent adr's should never appear as quiz inside dsh chat - they only appear in ADRs Ui in
> client. The only case is direct grilling session - here its possible and blocking, as
> user needs to answer. User answer automatically decides on adr being approved.

## What the code did

Nothing in the ratchet said where its question should be shown, and nothing in the client
read a question's origin. The ADR panel was about to claim the Conversation's composer
seat for every ratification question and render the two labels there, which would have
made every one of them a two-button chat card — exactly what the operator ruled out.

The ratchet's question already carried a presentation intent, added for the panel:
`intent: { kind: 'ratify-decision', approve: <label> }`, attached unconditionally by
`buildQuiz`.

## The decision

**Where a question is shown is part of the question.** `buildQuiz(entries, { present })`
attaches the panel's intent only for `'panel'`, which is the default. `'chat'` attaches
none, so the harness's own question card renders it in the Conversation. An unrecognised
value is treated as `'chat'`, because a value that does not say "panel" is one no client
may claim on the ratchet's behalf.

Three call sites, two presentations:

- `ratchet_ratify` (the tool) and `/ratify` (the command) ask with the panel intent. The
  panel claims the seat for exactly that intent and renders a **pointer** there — the
  decision's name and a button that opens the window — so the Conversation never carries
  the question, its record text, or either answer label. The question itself is put in the
  decision window.
- `ratchet_ingest_source` with `ratify: true` is the **grilling session** entry, and it
  asks with `present: 'chat'`: the agent is talking to the human anyway, the human is
  expected to answer before the session moves on, and the question blocking that
  conversation is the point. Its answer is the consent, exactly as in the panel.

The panel's claim is therefore a **suppression**, not the only route to the human. If the
claim is never reached — a future harness that reorders or re-specifies the chain, or a
machine with the bundle absent — nothing claims the seat, the harness asks in the
Conversation, and the question is still answerable. A claim that could make a question
unanswerable would be worse than no claim at all.

## Why the intent and not an `origin` field

An `intent` already means "present me like this", so a grill that wants the harness's own
card should declare none. Adding a second field beside the intent would have created two
ways to say where a question goes, and the panel would have had to read both. The
`present` option is one value with one meaning, and the equality that matters — the panel's
`ratify-decision` literal and the ratchet's — is asserted by
`scripts/check-consent-surface.mjs`, because the two copies cannot import each other.

## What is measured and what is not

Measured: `scripts/test-adr-panel.mjs` imports the ratchet's real `buildQuiz` and
`deriveDecisions`, drives the shipped browser bundle through a stub loader, and requires
the seat to render no answer button, the window to render both labels, and each click's
batch to be read back as an approval or a rejection. It also requires a `present: 'chat'`
question to carry no intent, so the grill is left alone. `scripts/test-ratchet.mjs` pins
that the caller's presentation reaches both the first question and the re-ask.

Not measured: that the running shell elects the panel's composer entry. That remains a
source reading with a shipped precedent, recorded as such in the panel README.
