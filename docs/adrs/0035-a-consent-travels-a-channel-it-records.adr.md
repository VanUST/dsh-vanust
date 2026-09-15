---
id: "0035"
title: A consent travels a channel it records, and the panel window is a surface of the one consent operation
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-15T17:20:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-the-panel-records-through-a-host-route.md
  hash: sha256:18ebf94758d5b934d4e0156825f923d1a9a5ee49ff3fffab5a81251a10f210ad
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  # Three removals. Each of these laws is in force because a human ratified it, so an agent-authored
  # record may not take them away until a human ratifies this amendment: the compiler refuses with
  # LAW_REMOVE_UNAUTHORISED and the gate is red until then. That red is the point — it says an agent
  # is changing ratified law, and it names the consent this record does not yet have.
  - op: remove
    id: shipped-plugins.consent-travels-the-human-channel
    checks: []
    unenforced: "a removal carries no constraint to check; the compiler's authorisation rule is what refuses it until this amendment is ratified"
  - op: remove
    id: shipped-plugins.the-panel-offers-consent-only-through-the-question-channel
    checks: []
    unenforced: "a removal carries no constraint to check; the compiler's authorisation rule is what refuses it until this amendment is ratified"
  - op: remove
    id: shipped-plugins.the-panels-consent-laws-are-enforced-by-executing-the-bundle
    checks: []
    unenforced: "a removal carries no constraint to check; the compiler's authorisation rule is what refuses it until this amendment is ratified"
  - op: upsert
    id: shipped-plugins.a-consent-travels-a-channel-it-records
    statement: A ratification question reaches the human through one of the ratchet's closed vocabulary of channels, carrying the record's own text, and its answer is derived from a selected label rather than interpreted; the approval and its transcript both record the channel that actually carried it, so a consent obtained in a Session names user-question and one obtained in the panel's decision window names adr-panel.
    checks:
      # The route is driven over real HTTP against the real webserver and the real browser fence,
      # with a stub human posting the label the ratchet's own question offered. The success line is
      # asserted as well as the exit code: a probe that reports nothing must not pass.
      - type: command
        run: node scripts/probe-dsh-api.mjs --adr-panel-consent
        expects: the panel consent route asks, refuses a composed or foreign or replayed answer, and mints on the question's own label
        timeoutMs: 300000
        outputContains: adr panel consent route ok
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the ratchet's channel vocabulary and the panel's copy of it are equal, and a consent through the route names the route
        timeoutMs: 120000
        outputContains: consent surface ok
  - op: upsert
    id: shipped-plugins.the-panel-window-is-a-surface-of-one-consent-operation
    statement: The panel's decision window is a second SURFACE for the ratchet's single consent operation and never a second consent path: the route builds no question and interprets no answer, both halves call the ratchet's own ratify operation, and an answer mints only when the human selects the approve label of the question the ratchet built for the records waiting at that moment.
    checks:
      - type: command
        run: node scripts/probe-dsh-api.mjs --adr-panel-consent
        expects: a hand-composed payload, a foreign quiz, a replayed quiz, a stale text and a human-only zone each write nothing
        timeoutMs: 300000
        outputContains: adr panel consent route ok
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: no tool names the consent route, its service, its header or its capability global
        timeoutMs: 120000
        outputContains: consent surface ok
  - op: upsert
    id: shipped-plugins.the-panels-consent-path-is-enforced-by-executing-the-bundle
    statement: The panel's consent path is enforced by executing the shipped browser bundle against a stub host for the panel's own route — requiring a row's Approve and Decline to ask the route for the ratchet's own question, to render it with the record's own text and both of its labels, to post back the label it was shown paired with that same question, to show the outcome, to report a refusal rather than a false success, to fall back to the command with no capability, and to compose no composer message in any scenario.
    checks:
      - type: command
        run: node scripts/test-adr-panel.mjs
        expects: the shipped bundle records a decision through the route and submits no composer message
        timeoutMs: 300000
        outputContains: adr panel render ok
---

## Context

This record exists because the panel's consent route was implemented and the kit's gate went green
while **three ratified laws said it must not exist**. That is not a defect in the compiler: each of
the three was checked in the letter and none was contradicted in the letter.

- `shipped-plugins.consent-travels-the-human-channel` (ADR 0010, ratified by 0011) required the
  question to reach the human through the harness user-questions channel.
- `shipped-plugins.the-panel-offers-consent-only-through-the-question-channel` (ADR 0014, ratified by
  0016) required the overlay to be an entry to that one channel and "never a second one".
- `shipped-plugins.the-panels-consent-laws-are-enforced-by-executing-the-bundle` (ADR 0019, ratified
  by 0023) required "the whole render to call nothing but the file surface's two reads" — and the
  bundle now calls the consent route. Its *check* was updated to the new behaviour, so the ratified
  text and its enforcement point had silently diverged: the drift the ratchet exists to catch,
  invisible in the one place it is enforced, because the check was the enforcement point.

`LAW_CONFLICT` cannot see any of this — it fires when one law id is declared twice with different
statements, and the new work declared new ids. A contradiction in meaning needs a review to be
*run*, which is a call rather than a gate. The finding was made by a human asking what the panel
does, not by a command.

## Decision

The three laws are **removed and restated**:

1. A consent travels **a channel it records** — `user-question` for a Session, `adr-panel` for the
   panel's decision window — both values in the ratchet's closed vocabulary and in the panel's copy
   of it, with the channel written into the approval and its transcript.
2. The panel window is a **surface of the one consent operation**, not a second consent path: the
   route builds no question and interprets no answer, and both halves call the ratchet's own ratify
   operation.
3. The panel's consent path is **enforced by executing the shipped bundle**, which now must also
   assert that no composer message is composed.

The restated laws carry **real checks** — the route probe, the consent-surface scan and the executed
bundle — so these are not claims awaiting an enforcement point: the commands already run and already
pass.

## Reasoning

The reasoning is the source this record shares with ADR 0034: the measured harness facts (a host
plugin serves a browser through a `webServer` route behind the connection trust fence; a browser
half cannot invoke a registered tool at all, so the route is the only mechanism, not a detour), the
16/16 probe including every refusal, and the honest gap that a `danger-full-access` agent reading the
cookie-signing secret could forge a browser session — which is the same residual gap hard rule 12
already states for a hand-written approval, and not a new capability.

The alternative was to revert the route and keep the laws. It was refused because the laws were
written when the panel could only *ask an agent*, and the human has since directed that a click
should record the decision; keeping the text and reverting the code would have preserved a
constraint whose reason no longer holds.

## Consequences

- **Until a human ratifies this record the gate is red**, with `LAW_REMOVE_UNAUTHORISED` naming the
  three laws. That is correct and deliberate: an agent-authored record may not take away law a human
  put in force. Ratifying this record turns it green and leaves the amended laws enforced by the same
  three commands.
- The three removed laws are not edited anywhere: the records that declared them (0010, 0014, 0019)
  keep their other laws in force, and their consent is untouched, because a removal is a decision
  about force rather than a change to an approved text.
- A consent now says which surface carried it, so a reader can tell a Session ratification from a
  click in the window without trusting either.
- **The gap that produced this record is not closed by it.** A meaning-level contradiction against
  law in force was invisible until a human asked; the review that would have caught it is a call,
  not a gate. That is the same hole ADR 0032 records for duplicates, and closing it is a separate
  decision.
