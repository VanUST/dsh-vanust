---
id: "0034"
title: The panel records a consent through its own host route, with no chat message
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-15T16:40:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-the-panel-records-through-a-host-route.md
  hash: sha256:18ebf94758d5b934d4e0156825f923d1a9a5ee49ff3fffab5a81251a10f210ad
zones:
  - shipped-plugins
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.the-panel-records-consent-without-a-chat-message
    statement: The ADR panel's Approve and Decline record the human's decision through the panel's own host route, so the click produces the consent with no composer message, no model turn and no agent in the loop, and what the row sends is the label the ratchet itself put on the question it built, paired with that same question.
    checks:
      - type: command
        run: node scripts/test-adr-panel.mjs
        expects: the shipped bundle asks the host route for the ratchet's question, renders it, sends its own label back paired with it, and composes no composer message
        timeoutMs: 180000
        outputContains: adr panel render ok
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the panel and its host agree on the route, the service, the header and the capability, and the whole registered tool surface names none of them
        timeoutMs: 180000
        outputContains: consent surface ok
  - op: upsert
    id: shipped-plugins.the-consent-route-is-not-a-second-consent-path
    statement: The ADR panel's consent route builds no question and interprets no answer, it calls the ratchet's own ratify operation for both halves, and that operation writes an approval only for the approve label of a question it built for the records waiting now, refusing a hand-composed payload with no quiz, a quiz it did not build, an answer about a record edited since the question was asked, a replayed quiz and a record its zones do not let a consent put into force.
    checks:
      - type: command
        run: node scripts/probe-dsh-api.mjs --adr-panel-consent
        expects: the route driven over real HTTP with a stub human writes the approval and its transcript, and every refusal mints nothing
        timeoutMs: 600000
        outputContains: adr panel consent route ok
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the service the route reaches refuses a label with no quiz, a foreign quiz, a human-only zone, a replay and a stale text
        timeoutMs: 180000
        outputContains: consent surface ok
  - op: upsert
    id: shipped-plugins.a-consent-names-the-surface-that-carried-it
    statement: A ratification records, in its approval and its transcript, the channel that actually carried the question to the human, so a consent obtained through the harness user-questions seam records user-question and one obtained through the ADR panel's decision window records adr-panel, and both values are in the ratchet's closed channel vocabulary and in the panel's copy of it.
    checks:
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the panel knows every channel the ratchet accepts, and an approval the consent service writes for the route names adr-panel in its frontmatter and in its transcript
        timeoutMs: 180000
        outputContains: consent surface ok
      - type: command
        run: node scripts/probe-dsh-api.mjs --adr-panel-consent
        expects: the approval the route writes over real HTTP records the panel channel, not the harness seam's
        timeoutMs: 600000
        outputContains: adr panel consent route ok
  - op: upsert
    id: shipped-plugins.the-consent-route-is-unreachable-by-an-agent
    statement: No tool, CLI verb or command argument exposes the consent route, and every request to it must pass the harness browser trust fence and carry a capability minted per plugin activation, held in memory and delivered only through the index document this process served, so the token is written to no file and to no log and nothing an agent can call obtains it.
    checks:
      - type: command
        run: node scripts/probe-dsh-api.mjs --adr-panel-consent
        expects: an unauthenticated loopback request is refused without writing, and a browser session with a missing or tampered capability is refused before the ratchet is reached
        timeoutMs: 600000
        outputContains: adr panel consent route ok
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: no registered tool names the route, its service, its header or its capability global
        timeoutMs: 180000
        outputContains: consent surface ok
---

## Context

The ADR panel offers Approve and Decline on a decision that waits for a human. It recorded
that click by submitting the ratchet's `/ratify <id>` command into the Session composer — a
chat message, and therefore a model turn, and therefore an agent that had to run
`ratchet_ratify` before the human's click became a consent. The human clicked a button and
the consent arrived only after an agent acted on a message the human never wrote.

The direction that asked for this change is recorded verbatim in the reasoning source this
record pins: **clicking Approve or Decline in the panel must record the decision silently —
no chat message, no agent in the loop.**

The constraint that shapes any fix is that the panel may not mint a consent. A consent must
pair with a question the ratchet itself built, or it is indistinguishable from a sentence an
agent typed — which is why there is deliberately no tool parameter, no CLI verb and no
command argument that accepts a composed answer.

Three measurements decided the design. **A browser half cannot invoke a registered tool:**
`@deepseek-ai/dsh-tools` declares no `dsh.client` row and no `./client` export, and no
shipped browser bundle contains a tool-invocation call — so the human's first choice has no
mechanism behind it. **A host half can serve a browser:** a plugin registers an exact route
on the `webServer` service, and the shipped `open-in-app` plugin is the worked example,
with its browser half fetching a literal path on the page's own origin. **A route can be
guarded:** `connection.requestRejection` refuses an untrusted authority before it refuses an
unauthenticated browser.

## Decision

- The panel gains a host-side route, `/adr-panel/consent`. `GET` obtains the ratchet's own
  question about one decision and returns it; `POST` hands back `{ adrId, label, quiz }` and
  lets the ratchet write what follows.
- Consent stays the ratchet's business. The ratchet plugin PROVIDES a cordis service,
  `ratchetConsent`, whose two operations are one call each to the existing `ratify`
  operation: `ask` prepares the quiz, `settle` pairs the human's label with the question it
  came from. The route constructs no question, maps no label and writes no file.
- The route must be unreachable by an agent. It is not a tool and nothing on the tool
  surface names it; every request must pass the harness browser trust fence and carry a
  32-byte capability minted per plugin activation, held in memory, and published to the page
  only through the harness's index-injection table — so there is no file for a tool to read.
- The composer seat keeps claiming questions the ratchet asks through other paths, so an
  agent calling `ratchet_ratify` still gets the pointer and the window, and a grilling
  session still asks and blocks in the Conversation. What is removed is the row's click
  travelling through the composer at all.
- Consent names the surface that carried it. The ratchet's channel vocabulary gains
  `adr-panel` beside `user-question`, the `ratify` operation takes a `channel` that reaches
  the approval and its transcript, the consent service records `adr-panel`, and the panel's
  copy of the vocabulary gains the value so it recognises the consents its own route writes.
  The channel is not a caller argument: a caller cannot ask to be recorded as having come
  through the harness seam.

## Reasoning

The reasoning source records the measurements with their reproductions, the rejected
alternatives, the guarantee that moved (the armed-click expiry, replaced by the ratchet's
frozen content hash), and the residual gap in the "unreachable by an agent" claim: the
cookie-signing secret is a file in `$DSH_HOME`, and an agent whose tools can read it could
forge a browser session — which is not a new capability, because the same agent can
hand-write an approval that reproduces the ratification block, the gap hard rule 12 already
states.

The design's shape follows from one property: a consent is a question and an answer, and
only the ratchet may author the question. Everything the panel adds is transport — which is
why the panel's host half reads no corpus, builds no quiz and writes nothing, and why the
service it calls is the same operation the tool and the command call.

**A law in force that this change does not satisfy as written, reported rather than
reinterpreted.** `shipped-plugins.consent-travels-the-human-channel` (ADR 0007, restated by
ADR 0010, in force) says a ratification question reaches the human through the harness
user-questions channel. The route does not put its question through that channel. Read as a
claim about the seam, that law now describes one of two channels rather than every
ratification. This record does not edit ADR 0007 — editing a ratified record voids the
consent that put it in force — and does not re-declare its law id, because two records
declaring one law is the corpus contradicting itself. It declares the weaker, true claims it
can, and the amendment that would make the old law true again ("through a channel that is
recorded") is left for a human to ratify or refuse.

## Consequences

- A click in the panel records the decision with no chat message, no model turn and no agent
  in the loop. The row shows the ratchet's question, the record's own bytes and both labels
  before the answer lands, and names the approval ADR and transcript afterwards.
- The route is a second way to REACH the ratchet's consent operation, never a second consent
  path. Every refusal it can produce — no quiz, foreign quiz, stale text, replay, an id that
  is not waiting, a `humanOnly` zone — writes nothing, and
  `scripts/check-consent-surface.mjs` drives each one against the provided service.
- Every approval and transcript now says which surface carried the question. Consents minted
  before this change keep `user-question`, which is what they were; consents minted through
  the route say `adr-panel`, which is what they are.
- The panel's README and its bundle documentation now describe the route; the old
  description of a `/ratify` submission is gone with the code that did it.
- The plugin's version is bumped and the tarball repacked; the ratchet's is too, because it
  gained a module, a provided service and a channel value.
- A `[SKIP]` remains wherever a machine has no harness checkout or theme: the panel test
  measures what it can and says what it could not.
