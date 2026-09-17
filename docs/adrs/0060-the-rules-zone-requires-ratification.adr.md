---
id: "0060"
title: The rules zone requires a human ratification, not human authorship
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-17T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-17-human-only-is-unverifiable.md
  hash: sha256:c1bd69048e0ddaec344c79f0a5470b22a1314b2dc27e72d2b43cf8c240921b5f
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  # The law this removes is in force (ADR 0012, ratified by approval 0013), so an
  # agent-authored record may not take it away until a human ratifies this amendment; the
  # compiler refuses the removal until then. A removal carries no constraint to check.
  - op: remove
    id: shipped-plugins.the-authority-table-cannot-be-relaxed-silently
    checks: []
    unenforced: "a removal carries no constraint to check; the law is restated under a new id bound to the command that reports it"
  - op: upsert
    id: shipped-plugins.the-authority-table-is-reported-and-ratifiable
    statement: The manifest's zone table decides which paths a human reserves, so a change to a reservation is visible to the gate rather than silent; the deployment-rules zone requires a recorded human RATIFICATION rather than human authorship, because a consent is bound to the text a human was shown while authorship is not verifiable, and an agent proposal in that zone is offered to a human and cannot activate itself.
    checks:
      # The consent surface owns this claim: it asserts the zone's declared authority AND
      # drives the queue over a proposeOnly fixture to require an agent proposal to be
      # offered rather than blocked, so the check is about behaviour, not only the table.
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the authority table reports the rules zone as ratifiable and offers an agent proposal there
        timeoutMs: 120000
        outputContains: consent surface ok
---

## Context

ADR 0058 was written by an agent and bound to `deployment-rules`, which this project's
manifest reserved to humans. The human read it, agreed with it, and could not put it in
force: the ratchet refuses an agent-authored record in a `humanOnly` zone, because consent
cannot transfer authorship. The only route was to edit one frontmatter word and then approve
text already read — ceremony that the source argues at length is both unverifiable and
pointless when the human ratifies anyway.

## Decision

`deployment-rules` becomes `proposeOnly`. An agent may propose a change to the rules; the
ratchet puts it to a human; the human's hash-bound consent is what puts it in force. The
reservation that remains is the one that is real — no self-activation. ADR 0012's law is
removed and restated against the consent surface's command.

## Reasoning

The source states the full argument: a consent is already bound to the text the human was
shown, authorship is not verifiable (the kit's own hard rule 12 records the residual gap), and
`humanOnly` therefore failed §3 — no command fails when an agent writes `authority: human`.
The check that "pinned" it asserted the manifest's value, not the behaviour, which is the
failure mode this kit created `check-gate-invariants.mjs` to eliminate. What `humanOnly`
genuinely bought — no self-activation — `proposeOnly` already provides.

## Consequences

- ADR 0058 stops being blocked and becomes an ordinary ratification question.
- The old law leaves force only when a human ratifies this record; until then it remains in
  force and its check still passes, because that check is the exit status of a script whose
  claim this amendment changes.
- The `humanOnly` mechanism is not deleted. Fixtures in `check-consent-surface.mjs` and
  `test-ratchet.mjs` keep a `humanOnly` zone and require an agent record there to be blocked,
  so the code path stays covered; this project simply stops claiming from it a guarantee it
  cannot verify.
- **The stronger, unbuilt option:** if authorship must be real, enforce it on git provenance —
  the identity on the commit that introduced the record — which a file write cannot fake
  without also forging a commit. The ratchet does not consult git today.
