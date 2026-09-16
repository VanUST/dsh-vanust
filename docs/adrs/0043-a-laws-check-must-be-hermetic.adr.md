---
id: "0043"
title: A law's check must be hermetic, so the six probe-bound consent laws are restated against hermetic commands
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-16T07:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-16-a-laws-check-must-be-hermetic.md
  hash: sha256:fe225e951d4f7db39925a4af66e37e007b97ce79ae476691876a463650c4f7ee
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  # Six removals. Each of these laws is in force because a human ratified it (0034 by 0041,
  # 0035 by 0042, 0019 by 0023), so an agent-authored record may not take them away until a
  # human ratifies this amendment: the compiler refuses the removal with LAW_REMOVE_UNAUTHORISED
  # once this record is in force, and the gate is the probes' colour until then. A removal
  # carries no constraint to check, so each one states an `unenforced` reason.
  - op: remove
    id: shipped-plugins.the-consent-route-is-not-a-second-consent-path
    checks: []
    unenforced: "a removal carries no constraint to check; the law is restated under a new id bound to a hermetic command"
  - op: remove
    id: shipped-plugins.a-consent-names-the-surface-that-carried-it
    checks: []
    unenforced: "a removal carries no constraint to check; the law is restated under a new id bound to a hermetic command"
  - op: remove
    id: shipped-plugins.the-consent-route-is-unreachable-by-an-agent
    checks: []
    unenforced: "a removal carries no constraint to check; the law is restated under a new id bound to a hermetic command"
  - op: remove
    id: shipped-plugins.a-consent-travels-a-channel-it-records
    checks: []
    unenforced: "a removal carries no constraint to check; the law is restated under a new id bound to a hermetic command"
  - op: remove
    id: shipped-plugins.the-panel-window-is-a-surface-of-one-consent-operation
    checks: []
    unenforced: "a removal carries no constraint to check; the law is restated under a new id bound to a hermetic command"
  - op: remove
    id: shipped-plugins.the-question-seam-is-measured-by-the-probe
    checks: []
    unenforced: "a removal carries no constraint to check; the law is restated under a new id bound to a hermetic command"

  # Six restatements under new ids, each bound ONLY to a hermetic command. Every statement is
  # narrowed to what the named command actually asserts; the live-route, live-browser-fence and
  # live-profile measurements stay release-gate evidence in scripts/verify-upgrade.sh.
  - op: upsert
    id: shipped-plugins.the-consent-service-is-not-a-second-consent-path
    statement: The ratchet provides one consent service the panel's route reaches, whose operations build no question and interpret no answer — ask prepares the ratchet's own question about the decisions waiting now, and settle pairs a selected label with that same question and writes an approval only for its approve label — refusing a label with no quiz behind it, a quiz the ratchet did not build, an answer about a record edited since the question was asked, a replayed quiz, and a record whose zone does not let a consent put it into force.
    checks:
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the provided consent service prepares the ratchet's own question, mints for its own approve label, and refuses a label with no quiz, a foreign quiz, a human-only zone, a replay and a stale text
        timeoutMs: 180000
        outputContains: consent surface ok
  - op: upsert
    id: shipped-plugins.a-consent-records-the-surface-that-carried-it
    statement: A consent recorded through the service the panel's route reaches names, in its approval frontmatter and in its transcript, the channel that carried the question, and that channel value is one the ratchet's closed channel vocabulary and the panel's copy of it both hold; the value recorded is the route's own channel, not the harness seam's.
    checks:
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: an approval the consent service writes for the route names the route channel in its frontmatter and in its transcript, and the panel knows every channel the ratchet accepts
        timeoutMs: 180000
        outputContains: consent surface ok
  - op: upsert
    id: shipped-plugins.no-tool-surface-exposes-the-consent-route
    statement: Nothing on the ratchet's registered tool surface names the consent route, its service, its header or its capability global, no tool argument accepts a caller-composed answer, the CLI has no mint verb and inventing its flags mints nothing, and the panel and its host agree on the route, the service, the header and the capability value.
    checks:
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: no registered tool exposes the route, its service, its header or its capability; no argument accepts an answer; the CLI has no mint verb; the panel and its host agree on all four values
        timeoutMs: 180000
        outputContains: consent surface ok
  - op: upsert
    id: shipped-plugins.a-consent-question-carries-the-record-and-records-its-channel
    statement: A ratification question the ratchet prepares carries the record's own text and is answered by selecting one of the labels the question itself put on its options rather than by interpreting free text; a consent the ratchet records names in its approval and its transcript the channel that carried it, and the panel knows every channel a ratification can have been obtained through.
    checks:
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: asking the service prepares the ratchet's own question carrying the record's own text and writes nothing, the question's own label writes the approval and its transcript, and the recorded channel is one the panel's copy of the vocabulary holds
        timeoutMs: 180000
        outputContains: consent surface ok
  - op: upsert
    id: shipped-plugins.the-panel-window-drives-the-one-consent-operation
    statement: The panel's decision window is a second surface for the ratchet's single consent operation and never a second consent path — a ratifiable row asks the host route for the ratchet's own question about that record, renders it with the record's own text and both of its own labels, and sends back the label it was shown paired with that same question, which the ratchet reads as an approval or a rejection; a decision the ratchet has no question for is reported and no answer is sent; with no capability the row names the CLI command and fetches nothing; and no panel ratification composes a composer message.
    checks:
      - type: command
        run: node scripts/test-adr-panel.mjs
        expects: the shipped bundle asks the route for the ratchet's own question, shows the record's own text and both labels, sends back the label paired with that question, reports a no-question decision, falls back to the CLI with no capability, and composes no composer message
        timeoutMs: 180000
        outputContains: adr panel render ok
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the service the route reaches mints only for its own approve label and refuses a label with no quiz, a foreign quiz, a human-only zone, a replay and a stale text
        timeoutMs: 180000
        outputContains: consent surface ok
  - op: upsert
    id: shipped-plugins.the-questions-intent-and-answer-are-measured-hermetically
    statement: The ratification question's shape is measured rather than assumed by executing the shipped panel bundle and comparing it with the ratchet's own question — the panel matches the presentation intent the ratchet sends and gets no intent to claim for a grilling session, it claims the ratchet's re-ask shape, and the answer the ratchet reads is the label the question itself offered, with an approve click read as an approval and a decline click as a rejection.
    checks:
      - type: command
        run: node scripts/test-adr-panel.mjs
        expects: the intent the panel matches is the one the ratchet sends, a grill gets none, the re-ask shape is claimed, and an approve or decline click is read as an approval or a rejection
        timeoutMs: 180000
        outputContains: adr panel render ok
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the panel's intent literal equals the ratchet's own question intent, and a chat presentation carries no intent to claim
        timeoutMs: 180000
        outputContains: consent surface ok
---

## Context

The gate is red on six laws, one cause: each is bound to one of two **end-to-end probes** that
mount a live webserver on a port or boot a nested `dsh` process with a live root agent. Run by
a human in a shell the probes measure what they claim, but the verifier's command runner
starts them in a context that differs from a shell, and the law gate cannot depend on an
environment it does not control. The precise runner-level cause — a timeout, an environment
variable, a port, the working directory — was not measured, and the decision taken in response
does not depend on knowing it:

> **A law's check must be hermetic.** Probes that need a live webserver, a port or a nested
> process are release-gate evidence (`scripts/verify-upgrade.sh`), not law checks.

The six laws are in force through human ratifications — three declared by ADR 0034 (ratified
by 0041), two by ADR 0035 (ratified by 0042), and one by ADR 0019 (ratified by 0023) — so
re-binding them cannot be an edit. Editing a ratified record voids the consent that put it in
force (`RATIFICATION_STALE`), and re-declaring one of its law ids is the corpus contradicting
itself.

## Decision

The six probe-bound laws are **removed and restated under new ids**, bound only to hermetic
commands:

1. `shipped-plugins.the-consent-service-is-not-a-second-consent-path` ←
   `shipped-plugins.the-consent-route-is-not-a-second-consent-path`
2. `shipped-plugins.a-consent-records-the-surface-that-carried-it` ←
   `shipped-plugins.a-consent-names-the-surface-that-carried-it`
3. `shipped-plugins.no-tool-surface-exposes-the-consent-route` ←
   `shipped-plugins.the-consent-route-is-unreachable-by-an-agent`
4. `shipped-plugins.a-consent-question-carries-the-record-and-records-its-channel` ←
   `shipped-plugins.a-consent-travels-a-channel-it-records`
5. `shipped-plugins.the-panel-window-drives-the-one-consent-operation` ←
   `shipped-plugins.the-panel-window-is-a-surface-of-one-consent-operation`
6. `shipped-plugins.the-questions-intent-and-answer-are-measured-hermetically` ←
   `shipped-plugins.the-question-seam-is-measured-by-the-probe`

The only commands the restatements bind are `node scripts/check-consent-surface.mjs`, which
drives the consent service the route reaches directly and prints `consent surface ok` only
after every claim held, and `node scripts/test-adr-panel.mjs`, which executes the shipped
browser bundle against a stub host and prints `adr panel render ok` only after every claim
held. Neither starts a server, opens a port or spawns a nested process. Each restated
statement says only what those commands actually assert, and where a statement cannot be made
hermetic it is narrowed and the live measurement is named in the Consequences.

## Reasoning

The reasoning source is `docs/ratchet/sources/2026-09-16-a-laws-check-must-be-hermetic.md`,
whose hash this record pins. It lists the six laws with the ratification that put each in
force, the exact claims each hermetic command asserts, and the four narrowings this restatement
makes: the route driven over real HTTP, the harness browser trust fence, the live profile and
live root agent, and a Session's `user-question` channel. Each of those remains measured by
`scripts/verify-upgrade.sh`, which is where a measurement that needs the whole running
deployment belongs.

A statement broader than its check recreates the defect being fixed — a law whose text claims
more than any command can fail on, which is how the two probes came to hold up six laws in the
first place. The narrowings are therefore part of the decision, not a footnote.

## Consequences

- **Until a human ratifies this record the six old laws stay in force** bound to the two
  probes, and the gate's colour is the probes' colour. Ratifying this record leaves them out
  of force and puts the six restated laws in force bound to two commands that run anywhere
  Node runs.
- **The live measurements do not disappear; they move.** An unauthenticated loopback request
  being refused, a browser session with a missing or tampered capability being refused before
  the ratchet is reached, the question surviving the wire to a real human channel with the
  live root agent, and an approval putting a decision into force against a live profile stay
  release-gate evidence in `scripts/verify-upgrade.sh` and are named in the reasoning source.
- **A statement narrower than the old one is the point.** The restated laws claim what the
  hermetic commands can falsify and no more. That a consent obtained in a Session records
  `user-question` is not restated, because neither hermetic command drives that path.
- The records that declared the removed laws keep their other laws in force and their consent
  untouched: a removal is a decision about force, not an edit to an approved text.
