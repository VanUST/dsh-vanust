# A decline removes the proposal and tells its author

Reasoning source for ADR 0088. It records the defect, the measurements, and why the fix is a
deletion plus a notice rather than a relabelling.

## The defect

A human declined the same proposal twice in the project at `/home/iustimov/tasks/Unnamed`, and
the decision stayed in the Decisions list reading "awaiting a human". The ledger shows both
refusals were recorded:

```
{"event":"ratchet.ratify.no-consent","at":"2026-09-28T12:59:38.755Z","rejected":["0002"],"comment":"Rebundant, dont need a law for that"}
{"event":"ratchet.ratify.no-consent","at":"2026-09-28T13:03:21.130Z","rejected":["0002"],"comment":"dont need this law"}
```

The ratchet's own view model already excluded a declined record from the NEEDS-A-HUMAN set
(`ratchet-decisions.mjs`, the `declinesByRecord` filter), so the finding was "handled". But the
record itself stayed `status: proposed`:

```
0002 status: proposed | inForce: false | canRatify: true
0002 queue: "waiting"
0002 state: {"text":"awaiting a human","kind":"pending"}
```

and the panel draws the badge from `record.state` (`client.js` `adr.state.text`, and
`adr.state.kind === "pending"` for the awaiting pill) and from `ratchetStatusPending`'s queue
membership — neither of which consults the refusal. So the human answered and the screen did not
change. `ratchet pending` still listed ADR 0002.

The old design said this was deliberate: a refusal mints nothing, so the record stays ratifiable
and a change of mind is one click. That reading is defensible for a *view*, but it produced a
button that appears to do nothing, which is worse than either alternative.

## The decision

A decline is the END of an agent's proposal:

1. **The record is removed.** It is an agent-authored `proposed` record — no consent exists, so
   nothing is voided by removing it, and the file is recoverable from version control. A
   human-authored record is NOT removed: a person's draft is theirs, and a ratchet that deleted it
   would be deciding for the human.
2. **The refusal, its reason, and what became of the file are recorded** in the ledger's
   `ratchet.ratify.no-consent` event and returned from `ratify`.
3. **The producing agent is told.** Actively, when its Session is live; durably otherwise.

## Why the notice needs an address book

An ADR's frontmatter carries `author.name` ("deepseek-flash") and never the Session that wrote
it. In the project above there is not one `ratchet.ingest.propose` event, so the record was
written by hand and no producing Session was recorded at all. `author.name` is a model, not an
address.

The ratchet therefore remembers which Sessions have used its tools in a project: `touchProducer`
writes a bounded recency list to `.dsh/ratchet/sessions.json` (newest first, deduplicated, 20
entries), called from the tool adapter's `withRoot`. `ratify` returns that list as `producers`.
A bounded state file rather than a ledger stream because the file is overwritten and the only
question asked of it is "who touched this most recently"; an append-only line per tool call would
grow without bound for one fact, and the ledger is already large.

## Why the notice has two halves

- **Active:** `notifyDeclinedProducers` resolves each producer Session through the live-agent
  registry and calls `agent.followup(createUserMessage(...))`, so the agent gets a turn with the
  human's reason. A Session with no live agent is skipped — the normal case for a proposal made
  earlier and declined later.
- **Durable:** `declinedDecisions` reads the ledger's `no-consent` events and reports the recent
  declines, newest first, as a FIELD of `ratchet_status` and of the decisions view model. A
  refusal is a decision a human made, not a defect in the project, so it never makes a status red.

Both halves exist because either alone is a silent failure: an active-only notice is lost to a
closed Session, and a durable-only notice is lost to an agent that never reads status.

## Consequences and limits

- The consent service stays SYNCHRONOUS and returns the ratify result; the notice is delivered in
  the background. A human's click must not wait on another Session's agent, and must not fail if
  that delivery does.
- The adapter now imports `@deepseek-ai/dsh-llm` for `createUserMessage`. It is hoisted by the
  harness install into the profile's `node_modules` alongside `@deepseek-ai/dsh-tools`, which was
  verified by resolving it from the INSTALLED plugin directory rather than the source tree, and
  the packaging check that pins the peer set was extended with that reason.
- A removal that fails (a permission error, a read-only checkout) is reported as
  `ARTIFACT_WRITE_FAILED` rather than silently leaving the file to be offered again.
- The decision's own source file is NOT removed. It is reasoning that another record may cite, and
  deleting it would be a second, unreviewed removal.
- Pre-existing proposals written before this change carry no producers, so they get the durable
  notice only.

## What an adversarial pass found, and what it changed

A bug-finder pass was run over this change (read-only, reproductions in throwaway projects), and
every finding was reproduced before anything was altered:

- **A decline inside a batch that also APPROVED something was reported nowhere.** The durable
  reader looked only at `ratchet.ratify.no-consent` events, but a mixed answer records its
  declines on the MINT event: the file was removed and nobody was told. Both readers now share one
  predicate, `isDeclineEvent`, so the durable notice and the needs-a-human filter cannot disagree.
- **The human's reason was missing from the ACTIVE notice.** A `declined` entry carried no
  `comment`, so a delivered message said "No reason was recorded" while the reason sat unused one
  line above in the same function.
- **`write:false` was not a dry run.** The removal ran before the early return, so the shape the
  consent service's dry-run callers use deleted the record while reporting that nothing was
  written. Removal is now gated on `write === true`, and a dry run reports what it would remove.
- **A decline from `ratchet_ratify` or `/ratify` never notified anybody**, because the notifier was
  wired only into the panel's consent service.
- **Panel: a "ratified by <id>" link forced the Decisions tab** while the id names an approval
  record drawn only in the Consents tab, so 32 such links on the kit's own corpus expanded nothing.
- **Panel: a recorded decline did not re-read state**, so the window kept drawing a record the
  ratchet had already deleted.
- **Panel: a recorded RESOLVE decline did not refetch its plan**, so a card's "you already declined
  this" list omitted the reason the human had just given.

## The one finding that was NOT changed, and why

A decline in a previously verified project turns `ratchet_status` red with `VERIFY_NOT_RUN`. That
is not a defect in the decline path: the verifier binds its verdict to a code hash that walks the
whole project, `docs/adrs` included, so removing any file invalidates a verification recorded
before it — the same thing an edit to a README does. The honest outcome is a stale verdict and a
re-run. Excluding the decisions directory from that hash changes what "verified" means and belongs
in its own decision, so this record narrows its own claim instead: the refusal is carried as a
field and raises no problem code of its own, while the stale-verification verdict is about the
tree.
