# The rules zone requires a human ratification, not human authorship

Reasoning for ADR 0060. Captured 2026-09-17, after ADR 0058 stalled.

## What happened

ADR 0058 was written by an agent and bound to `deployment-rules`, the one zone this
project's manifest reserved to humans. The human read it, wanted it, and could not put it in
force: the ratchet refuses an agent-authored record there — `consent cannot transfer
authorship` — so the queue never offered it. The only way forward was for the human to edit
one word of frontmatter, `authority: agent` → `human`, and then approve text they had already
read and agreed to.

## What the reservation was for

Two real things. First, the rules that carry cost policy, remote-change permission and model
policy should not be changed by an agent alone. Second, and mechanically: a record in that
zone must not **self-activate**, so an agent cannot make law there by declaring `status:
active`.

## Why it fails at the first of those

It conflates two different acts — *writing* a decision and *consenting* to it — and only the
second is verifiable.

1. **A consent is already bound to the text.** The ratification question shows the record's
   own bytes and the approval ADR binds a content hash of exactly those bytes. A human's
   "yes" therefore covers the whole decision; it does not matter who typed the file.
2. **Authorship is not verifiable.** The ratchet reads a frontmatter field. The kit's own
   hard rule 12 states the residual gap plainly: a hand-written `authority: human` is
   indistinguishable from a genuine one, because nothing verifies who wrote the file. So the
   requirement can be satisfied by any agent willing to type one word, and cannot be refused
   to one that is.
3. **It is therefore not a rule in the sense the deployment rules claim.** §3 says a rule is
   real only where a command fails when it is broken. No command fails when an agent writes
   `authority: human`. The check that "pins" it —
   `check-consent-surface.mjs` asserting `zone?.agentAuthority === 'humanOnly'` — asserts the
   manifest's *value*, not the behaviour, so it reports that the table was edited and proves
   nothing about who authors a record. That is the "a test name is not an assertion" failure
   this kit already created `check-gate-invariants.mjs` to kill, surviving on the consent
   surface.
4. **The cost falls on the honest path only.** A determined agent bypasses the check by
   editing a word; an agent that respects it is blocked from the ordinary flow of proposing a
   change and having a human ratify it. The ceremony selected against the behaviour the rules
   ask for.

## What the reservation still buys, and what already buys it

No self-activation. `proposeOnly` already provides exactly that: an agent may write a
record, it is offered to a human, and it enters force only on the human's recorded consent.
For an agent proposal, `humanOnly` is `proposeOnly` plus an unverifiable word.

## Decision

`deployment-rules` becomes `proposeOnly`. An agent may propose a change to the rules; the
ratchet puts it to a human; the human's consent, hash-bound to the text shown, is what puts
it in force. The reservation that remains is the one that is real: an agent cannot activate
it alone.

The tripwire stays, restated: it asserts the zone's declared authority AND drives the queue
over a `proposeOnly` fixture to require an agent proposal to be offered rather than blocked.

## What would make authorship real

The only authorship signal this system actually has is **git provenance** — the identity on
the commit that introduced the record. If `humanOnly` is ever wanted again, that is where it
should be enforced: a check that a record in such a zone was introduced by a configured human
identity, which an agent's file write cannot fake without also forging a commit. The ratchet
does not consult git today, and that stronger option is unbuilt.

## Consequences

- ADR 0012's law `shipped-plugins.the-authority-table-cannot-be-relaxed-silently` is removed
  and restated by this amendment; until a human ratifies it, the old law remains in force and
  its check still passes, because the check asserts exit 0 of a script whose claim this
  amendment changes.
- ADR 0058 stops being blocked and becomes an ordinary ratification question, which is what
  it should have been.
- The `humanOnly` code path is still exercised: `check-consent-surface.mjs` and
  `test-ratchet.mjs` both keep a fixture with a `humanOnly` zone and require an agent record
  there to be blocked. The authority model keeps the mechanism; this project just stops
  claiming an unverifiable guarantee from it.
