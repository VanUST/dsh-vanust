---
id: "0012"
title: A green gate means the corpus is current, complete, and inside its declared authority
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-14T16:30:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-14-green-gate-completeness.md
  hash: sha256:ce8314b1d16bc17f2d4b3768e8191d1136c7943e1d98da6c23bb3185092989f7
zones:
  - shipped-plugins
supersedes: []
approves: []
laws:
  - op: upsert
    id: shipped-plugins.specs-cannot-drift-silently
    statement: A generated spec document that no longer matches the decision it was compiled from, or that is missing while the project tracks generated specs, is reported by verify, and so is a compile that persists a bundle without regenerating the document, so a green verify cannot coexist with a stale human-readable view of the laws.
    checks:
      # Behavioural: the script edits a record without recompiling, deletes a tracked
      # document, and compiles without writing, requiring a problem in each case and
      # requiring the same corpus to verify clean once it is rebuilt. A test name or an
      # output string a green run prints anyway would be satisfied by an emptied test.
      - type: command
        run: node scripts/check-gate-invariants.mjs
        expects: a stale, missing or unwritten generated spec is reported, and a rebuilt corpus verifies clean
        timeoutMs: 120000
  - op: upsert
    id: shipped-plugins.laws-cannot-leave-force-silently
    statement: A law that was in force and is no longer compiled is reported unless an active record removes it by id, so a constraint cannot be deleted without a decision that names it.
    checks:
      # Behavioural: the script removes a law from an agent-activated record, recompiles,
      # and requires the removal to be reported; it then retires the same law through an
      # explicit remove op and requires that to be accepted.
      - type: command
        run: node scripts/check-gate-invariants.mjs
        expects: a law that leaves force without a recorded removal is reported, and a recorded removal is accepted
        timeoutMs: 120000
  - op: upsert
    id: shipped-plugins.laws-stay-inside-their-declared-authority
    statement: A record's law whose positive check paths fall outside the union of the zones that record declares is refused, because declaring a less restricted zone must not grant authority over a path the manifest reserves.
    checks:
      # Behavioural: the script compiles a record that declares a permissive zone while
      # its law targets a human-only path and requires refusal, and compiles the
      # equivalent record whose law stays inside its zone and requires acceptance.
      - type: command
        run: node scripts/check-gate-invariants.mjs
        expects: a law targeting a path outside its declared zones is refused, and one inside them is accepted
        timeoutMs: 120000
  - op: upsert
    id: shipped-plugins.the-authority-table-cannot-be-relaxed-silently
    statement: The manifest's zone table decides which paths a human reserves, so a change to a reservation is visible to the gate rather than silent, and the deployment-rules zone still declares humanOnly authority.
    checks:
      # The consent surface owns this claim: the table is what makes proposeOnly and
      # humanOnly mean anything, and that script already fails when the surface stops
      # holding. It is a tripwire, not a proof — it reports that the reservation was
      # edited, and the decision to edit it is still a human's.
      - type: command
        run: node scripts/check-consent-surface.mjs
        expects: the authority table still reserves deployment-rules to humans
        timeoutMs: 120000
---

## Context

An adversarial pass over the ratchet, run as three independent breakers plus the author's
own, falsified five claims drawn from its documentation and its design. Three of them share
a shape that matters more than any individual defect: `verify` reports success over a corpus
it has not actually checked.

A generated spec can drift from the decision it was compiled from and `verify` still exits
0; deleting the generated specs entirely is equally silent; a law can be deleted from an
agent-activated record and the whole release gate stays green; and a record can govern a
path the manifest reserves to humans by declaring a different zone in its own frontmatter.
The full reproductions, with the commands and the observed output, are in the reasoning
source beside this record and in `docs/RATCHET-ASSESSMENT.md` §3.

## Decision

Three rules about what `verify` must be able to see, and one about the authority table it
reads:

1. A generated spec that disagrees with its decision, or is missing while specs are
   tracked, is reported; so is a compile that persists a bundle without regenerating the
   document.
2. A law that was in force and is no longer compiled is reported unless an active record
   removes it by id.
3. A law whose positive check paths fall outside the zones its record declares is refused.
4. The zone table that decides those reservations cannot be relaxed without the gate
   saying so.

Each is enforced by a command that fails when it is broken, and each is asserted
behaviourally rather than by a test name, because ADR 0009 made a test name and output a
green run prints anyway invalid as enforcement points.

## Reasoning

The ratchet answers "is this claim false right now?" and cannot answer "is this still the
claim we agreed to?" or "was a claim removed?". A green verdict carries no evidence that
the corpus it judged is current or complete, so every guarantee built on top of `verify`
inherits the gap — which is why these land before any other work on the ratchet.

The first rule is a configuration defect with a code defect behind it: the project sets
`specsRequired: false` while committing two generated specs, and the code short-circuits on
that flag instead of implementing the on-disk clause the design document already states.
Setting the flag alone was rejected as the whole fix, because it leaves the documented rule
unimplemented and the compile-without-write hole open.

The second rule exists because the previous law set is not retained: a retirement recorded
with `op: remove` and a silent deletion leave identical artifacts. The protection that does
exist tracks ratification rather than lawhood, which leaves the six decisions a human never
saw as the six whose constraints can be removed without trace.

The third rule is cheap by measurement: an audit of every path-based check in the corpus
found three positive path patterns, all three already inside their record's declared zone,
so the cross-check leaves today's corpus green and closes the escape without a migration.
Refusing a law that merely *reads* outside its zone was rejected as too strong; only a
positive check path grants enforcement, so only that is refused.

The fourth rule is a tripwire rather than a proof. The manifest is the root of the authority
the other three rely on, and it is in no zone itself, so relaxing it is otherwise invisible.

## Consequences

- A project that removes `specsRequired` no longer loses drift detection, because the
  documented on-disk rule becomes the implementation.
- `verify` gains verdicts it did not previously produce, so a corpus that was green by
  omission can turn red once; this repository's own corpus was audited and stays green.
- A legitimate law rename or retirement now costs an explicit `op: remove` record. That is
  the intended cost: it is what makes a removal auditable.
- The zone rule constrains future records: a law may not enforce against a path its record
  does not govern. A record needing to do that must declare the zone, which is the decision.
- Text-check weakness is **not** addressed here. The operator's reading is that the semantic
  verification for "violates the intent where no check catches it" is the dynamic agent
  layer's `review_change` job, which exists and was confirmed by execution
  (`scripts/probe-dsh-api.mjs --ratchet-review`, 11/11, `judgeAvailable=true`,
  `degraded=false`). It is advisory by construction — design §5.7, and the probe reports
  `advisory=true gate=false` — so this record accepts that mitigation is by review rather
  than by rule.
- The `requiresDecisionRecord` guard stays off, deferred by the operator rather than decided
  here.
