# The panel's consent laws are enforced by executing the bundle, and the seam is measured by the probe

Date: 2026-09-15. Scope: `plugins/dsh-adr-panel/client.js` (the browser half),
`scripts/test-adr-panel.mjs`, `scripts/check-consent-surface.mjs`,
`scripts/probe-dsh-api.mjs --ratchet-ratify`.

This file is the reasoning behind ADR 0019.

## What is already decided, and what is missing

ADR 0014 decided how the panel ratifies: the ratchet asks through the harness
user-questions channel, showing the record's own text, and the panel presents that
question rather than minting anything. A human ratified it (approval 0016), and its three
laws are **in force with no checks** — each carries an `unenforced:` reason. That was
honest at the time: the panel was about to be written, and a law whose enforcement did not
yet exist should say so rather than cite a command nobody had written.

An in-force record cannot be edited to add those checks. Editing a ratified record voids
the consent that put it in force (`RATIFICATION_STALE`), which is the mechanism the whole
model rests on: the consent covers the text the human was shown, and a record that quietly
grows a new claim after the fact is a record nobody approved. So the enforcement has to
arrive as a **new decision a human ratifies**, and that is all this record is. It does not
re-decide anything ADR 0014 decided, and it does not reuse its law ids — a second
declaration of one law under two records is the corpus contradicting itself.

## The measurement changed the design, so the enforcement had to change with it

The first implementation registered the panel's claim on the Conversation's
`conversation.composer` chain at `priority: 1`, on a reading that said the chain tried its
entries in registration order. The chain is sorted **ascending by `priority`** with the
lower tried first, and the entry that owns the seat claims every pending question at the
default `0`. So `user-questions@0` was elected over `adr-panel@1` for a ratify question and
the panel's `select` was never called: the claim was dead code, the chat quiz the change
existed to remove would still have rendered, and every structural assertion still passed.
At `priority: -1` a run against the real renderer shows the panel elected and the owner's
`select` never called.

That is the reason the enforcement below is written as *executions* rather than as
assertions about source text. The check that would have caught this reads the winner off a
real election; a check that read the bundle would have read the same wrong comment the
implementation was written from.

## What the enforcement is

`scripts/test-adr-panel.mjs` executes the shipped bundle. It loads
`plugins/dsh-adr-panel/client.js` through a stub module loader with a minimal React, drives
`apply` with a fake client context, and asserts the consent surface by ACTING on it:

- the claim is elected by the **real `SlotCore`** over a synthetic entry that claims every
  question, and a claim at `priority: 1` is required to lose — the counterfactual that keeps
  the ordering from regressing back into dead code;
- the Conversation seat renders nothing the question owns — no answer label, no question
  text, no record text, not even a prefix — in text, in an attribute a browser displays
  (`value`, `aria-label`, `title`, …), or behind **any handler that can settle the
  question**: every handler the seat records is clicked and the interaction must not settle;
- the window renders the question, its own labels and the record's own file text, and a
  click sends exactly `{ answers: [{ id, selected: [<the label the ratchet offered>] }] }`;
- each of those batches is fed back through the ratchet's own `deriveDecisions` and required
  to read as `approved` or `rejected` rather than `unreadable`, which is what makes "the
  same effect as the chat quiz" a measurement;
- the whole render's only workspace-file calls are `list` and `read`, against a recording
  surface that reports an unlisted member instead of hiding the call — so the panel has no
  write path for a consent to travel.

`scripts/check-consent-surface.mjs` holds the half no single-bundle test can see: the intent
literal the panel matches and the one the ratchet sends are two copies of one value across a
seam that cannot import, and it fails when they stop being equal.

`scripts/probe-dsh-api.mjs --ratchet-ratify` measures the asking seam end to end against a
live profile: the question reaches a real human channel with the live root agent, its intent
survives the wire, the answers are derived from the labels, an unreadable answer is re-asked
in a different shape, and the approval puts the decision into force.

## What is deliberately left unenforced

The claim that the running shell renders the seat's winner is measured **off-browser** — the
slot core is pure TypeScript with no runtime dependencies, so Node 24 runs the real election,
and a jsdom run against the real renderer reads the winner from the DOM — but no check here
drives a browser. `scripts/test-adr-panel.mjs` needs the harness checkout for its election
claims and prints a `[SKIP]` naming the reason without one, so on a machine that lacks the
checkout those claims do not run. The laws below therefore state what the commands enforce
where the checkout is present, and this paragraph is the reason a reader should not read the
check as stronger than it is.

The transport itself — a click in a browser travelling over the Remote to the waiting host —
is not measured by anything here. The batch shape is measured on both sides of it; the
transport is not.
