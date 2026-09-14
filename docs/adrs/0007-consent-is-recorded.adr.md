---
id: "0007"
title: A decision enters force through a recorded human consent
type: adr
status: proposed
author:
  authority: agent
  name: ratchet-agent
created: 2026-09-14T10:00:00Z
source:
  kind: file
  path: docs/ratchet/sources/2026-09-14-human-ratification.md
  hash: sha256:a6b5d9fc13ce9f57b1f444e7bbb320d5029662a6c64b7bd4b4e65c870a9742f5
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.consent-is-hash-bound
    statement: An approval puts a decision into force only while the decision still hashes to the text the approval recorded, so editing an approved record voids the consent instead of inheriting it.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the ratification tests pass, including the falsification that an edited record loses its force
        outputContains: "fail 0"
  - op: upsert
    id: shipped-plugins.consent-travels-the-human-channel
    statement: A ratification question reaches the human through the harness user-questions channel carrying the record's own text, and its answer is derived from a selected label rather than interpreted.
    checks:
      # Local checks, bound to the tests that prove each half of the statement BY
      # NAME. The probe (`node scripts/probe-dsh-api.mjs --ratchet-ratify`) is the
      # strongest evidence — it drives the production path against a live profile —
      # and it is deliberately NOT the gate check: it needs credentials, a network
      # and a model turn, so making it the law's enforcement point would make the
      # gate depend on the environment it happens to run in. It stays a declared
      # verification command (`ratify-probe`) and is run by hand at each upgrade.
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the test that the quiz carries the record's own text as the question detail
        outputContains: "the quiz shows the record text itself"
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the test that a decision is derived from the selected label and from nothing else
        outputContains: "derived from the selected label"
  - op: upsert
    id: shipped-plugins.no-shell-mint
    statement: No shell command mints a consent and no tool argument accepts a caller-composed answer; the CLI can only report which decisions are waiting for a human, and it reports the ones it cannot ratify with the reason.
    checks:
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the consent surface refuses a shell mint, refuses an answer that answers no question, and reports a blocked decision with its reason
        outputContains: "consent surface ok"
  - op: upsert
    id: shipped-plugins.unenforced-laws-are-reported
    statement: A law in force that declares no check and does not say why is reported as unenforced, because a rule with no enforcement point is an unverified claim.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: the test that a silent law is LAW_UNCHECKED and a stated reason is accepted
        outputContains: "fail 0"
---

## Context

The ratchet compiled agent-authored decisions into laws without asking the human,
and its refusal was only a report: a record declaring itself `status: active` in a
`proposeOnly` zone was listed as a problem *and* enforced anyway. ADR 0001 has waited
in `proposed` since it was written because it governs `plugins/**`, where agents may
only propose, and there was no path for a human to say yes. The underlying problem is
that a file cannot prove who wrote it — an agent can write `authority: human` into an
ADR, and no reader can tell that from a decision a human typed.

## Decision

A decision enters force only through a human consent recorded against the exact text
that was approved.

The decision is put to the human as a quiz through the harness user-questions
channel: one question per waiting record, whose detail is that record's own file
text, offering exactly two options. The answer is derived from the selected label by
exact comparison; anything else is unreadable, mints nothing, and is re-asked once in
a different shape.

The consent is written as an ADR of `type: approval` carrying a `ratification` block
— the channel, the time, who asked, and one content hash per approved record — and
the compiler honours it only while each record still hashes to the value recorded.
A record the zone does not authorise is no longer in force, and consent does not
transfer authorship: a ratified agent record still cannot govern a zone reserved to
humans.

## Reasoning

The reasoning is the source this record cites, and three of its conclusions carry the
decision. The harness approval seam was rejected because the deployment's
`danger-full-access` permission preset bundles `approval: never`, so the seam is
inert in exactly the sessions where ratification has to happen. A signed consent was
rejected because the key would live on the same machine as the agent, reducing the
protection to a passphrase at the cost of key management on three machines. A CLI
mint was rejected because an agent can run a shell command, which makes a CLI mint an
agent mint with extra steps. What remains is a channel the agent does not author, a
derivation with no interpretation in it, and a hash that binds the consent to a text
rather than to a title.

## Consequences

- Editing an approved record voids its consent: the compiler reports
  `RATIFICATION_STALE` and the law leaves force until it is ratified again, so every
  ratified record must be committed together with the approval that covers it.
- Hand-written approval ADRs stop working. An approval without a ratification block
  confers nothing and is reported as `RATIFICATION_UNPROVEN`, which is the point:
  the artifact is generated by the seam, not typed by whoever wants the decision.
- The kit's own boundary decision (ADR 0001) can finally be ratified, and this record
  with it — both govern `plugins/**` and both are agent-authored.
- A deliberately forged ratification block remains indistinguishable from a real one.
  The tool path cannot produce a consent without an answer from the human channel,
  and the gate reports what it cannot corroborate; the residual gap is recorded in
  the source rather than papered over.
