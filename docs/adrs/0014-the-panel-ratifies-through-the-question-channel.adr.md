---
id: "0014"
title: The ADR panel ratifies through the ratchet's own question, never as a second consent path
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-15T06:47:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-15-adr-panel-ratify-affordance.md
  hash: sha256:2e7e705c779d9955583dd48ce43244e9dc50315c094b2a6ba8aca6c88209499c
zones:
  - shipped-plugins
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.the-panel-offers-consent-only-through-the-question-channel
    statement: The ADR panel's ratify action puts the ratchet's own question to the human through the harness user-questions seam and produces an approval only when the human selects the approve label, so the overlay is an entry to the one consent channel and never a second one.
    checks: []
    unenforced: The host-side action does not exist yet, so there is nothing to drive. It becomes enforceable when `scripts/check-consent-surface.mjs` exercises the panel surface the way it already exercises the CLI and tool surface — a fixture with a stub question seam that requires an approval record and a transcript on an exact approve, no artifact on a reject or an unreadable answer, and no artifact when the seam is unavailable.
  - op: upsert
    id: shipped-plugins.the-panel-records-no-consent-of-its-own
    statement: The panel writes no approval record and sets no authorship field, so no path from the overlay turns a record into law without the ratchet's question having been asked and answered.
    checks: []
    unenforced: Same phase as the law above, and enforceable by the same script extension, which must assert that the panel bundle calls no write and that the host action mints nothing without an answered question. Its mechanical half already holds and is asserted today — the bundle reads through `workspaceFiles.list`/`read` and writes nothing — by `node scripts/test-adr-panel.mjs`, which prints `adr panel render ok`.
  - op: upsert
    id: shipped-plugins.the-question-seam-is-measured-from-the-panel-host
    statement: Whether the panel's host half can reach the Agent-scoped user-questions seam, or needs an agent-side companion, is measured and recorded before the UI is trusted, because the seam is scoped to an agent and the panel is a web-client plugin.
    checks: []
    unenforced: Nothing has been measured yet; this record decides the requirement rather than claiming the result, which would be the assumption the whole feature rests on. It becomes enforceable when a probe in `scripts/probe-dsh-api.mjs` reports the seam's reachability from the chosen host and the measured fact is recorded in `docs/RATCHET-API-FACTS.md` with its reproduction.
---

## Context

`plugins/dsh-adr-panel` adds a Session-header button and a frame-wide overlay over a project's
`docs/adrs` and `docs/specs`. It already offers a ratify affordance for a proposed,
agent-authored, not-yet-approved decision (`canOfferRatify`, `client.js:570`), and activating it
submits the fixed message "Please run `ratchet_ratify` for ADR … and put the decision to me as a
question. Do not record a consent on my behalf." (`client.js:1369-1378`). It reads through the
workspace file API and writes nothing; its README states the rule: "It never records a consent. A
panel that minted one would be a second consent path, and the deployment's whole consent model
rests on there being exactly one."

The human asked for the obvious next step: a button in the overlay such that one click ratifies
the decision. The request is reasonable — the panel already knows which decisions await a human —
and it is also the exact shape of the failure the panel was written not to have.

Three measurements decide what is possible:

1. The only consent channel is the harness question seam: `user-questions/request`, typed
   `Scoped<Agent>` (`dsh-tool-cordis/lib/index.js:5620`), rendered by
   `@deepseek-ai/dsh-client-ui-user-questions`. `plugins/ratchet/ratchet-ratify.mjs` pins
   `RATIFY_CHANNEL = 'user-question'` and imports no harness: the adapter owns the connection and
   hands the seam a plain question payload.
2. `ratchet_ratify` is an agent tool, and the CLI cannot ratify — "a shell cannot ask you
   anything". There is deliberately no argument, tool parameter or shell command that accepts a
   composed answer, and `scripts/check-consent-surface.mjs` is what fails when that stops holding.
3. The panel is a web-client plugin whose host half is an empty `apply()`. A browser bundle
   cannot call an Agent-scoped service, and it must not write the approval in its place.

Kit `AGENTS.md` rule 12 names the residual gap that makes the distinction load-bearing rather
than pedantic: a hand-written approval, and a frontmatter `authority: human`, are both
indistinguishable from a real consent, "so never do either, and never ask an agent to."

## Decision

- The panel's ratify action becomes a first-class action, offered **only** for records the
  ratchet's own queue reports as ratifiable. A blocked record — an agent record in a `humanOnly`
  zone — is rendered as blocked and offers no action, because putting an impossible question to a
  human spends the one act the mechanism depends on.
- The action's consent is the ratchet's own question through `user-questions/request`. It may
  reduce the human's work to **click → the ratchet's question over the record text → answer**. It
  may not remove the question.
- The capability lives where the seam is reachable: the client half renders and invokes, the host
  half (or a companion agent-side capability) owns the call. **Its reachability is measured
  before the UI is trusted**, recorded in `docs/RATCHET-API-FACTS.md` with its reproduction.
- The panel keeps writing nothing.

Two adjacent designs are refused:

1. **A silent mint.** The button writes the approval record and transcript directly. It is a
   second consent path, it is the forgeable shape rule 12 forbids, and the consent-surface check
   exists to catch it.
2. **A panel-rendered question with a composed answer.** The overlay shows Approve/Reject over
   the record text and submits the answer for recording. The ratchet accepts no composed answer,
   so this is the same second path wearing the question's clothes.

## Reasoning

The reasoning source — `docs/ratchet/sources/2026-09-15-adr-panel-ratify-affordance.md`, whose
hash this record pins — records the measurements, the two refused designs, the three open
questions, and why the enforcement of the panel-specific laws cannot be written yet.

The consent model is not a preference that a convenience feature may trade against. Rule 12
exists because a file cannot prove who wrote it, so the deployment replaced a proof of authorship
with a **channel**: a question the harness delivered and an answer the agent did not author. Every
property the ratchet offers — the content-hash binding, the transcript, `RATIFICATION_STALE`,
`RATIFICATION_UNPROVEN` — is downstream of there being exactly one such channel. A UI that minted
a consent would not be a faster version of this; it would be a different, weaker claim wearing the
same name.

The blocked-record rule follows from the same reasoning: `ratchet_ratify` refuses to put an
impossible question, and the panel should not offer one either.

## Consequences

- The record declares `shipped-plugins` (`plugins/**`, `proposeOnly`) and `kit-tooling`
  (`scripts/**`, `probes/**`, `activeIfNoConflict`). Because one declared zone is `proposeOnly`,
  an agent cannot self-activate it: it stands `proposed` and waits for a human, which is the
  manifest's policy rather than a defect in the record.
- All three laws are unenforced and each says why, because the feature is decided here and built
  after. This record therefore constrains the implementation without pretending to check it; the
  implementation commit must extend `scripts/check-consent-surface.mjs` and the record must be
  updated, or superseded, to bind the checks it earns.
- The implementation order is forced by the open fact: **measure the seam first.** If a web-client
  plugin's host half cannot be granted the Agent-scoped seam, the action needs an agent-side
  companion, and the UI design changes before any of it is written.
- Shipping is a shipped-plugin change: bump the version, `node scripts/pack-plugin.mjs --dir
  plugins/dsh-adr-panel`, reinstall the tarball, restart `dsh web`, and commit the new tarball. A
  client-only bundle change reloads under HMR only while `pnpm run dev:web` is running.
- The panel's README claim that it never records a consent stays true and must be restated in
  terms of the action, because the documentation is part of the change.
- Nothing here makes ratification faster than click → answer. That is the honest limit: the
  consent is the answer, and the design may not delete the question.
