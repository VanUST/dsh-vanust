# The ADR panel's ratify affordance: one click, one question, no second consent path

Date: 2026-09-15. Status: the reasoning behind
`docs/adrs/0014-the-panel-ratifies-through-the-question-channel.adr.md`.

## The request

The human asked for a ratification mechanism inside the ADR panel's menu: open the overlay on a
proposed decision and click a button, and the decision is ratified. The request is reasonable —
the panel already lists which decisions await a human — but "click and it is law" collides with
the deployment's consent model, and the nature of that collision is the whole content of this
decision.

## What the panel does today (measured)

- `plugins/dsh-adr-panel` adds a Session-header button and a frame-wide overlay that reads
  `docs/adrs` and `docs/specs` through the workspace file API. The bundle calls
  `workspaceFiles.list` and `workspaceFiles.read` and writes no file.
- `canOfferRatify(record, relations)` (`client.js:570`) offers the ratify affordance only for a
  proposed, agent-authored, not-yet-approved decision.
- Activating it calls `inputActions.setDraft(...)` followed by `inputActions.submit()`
  (`client.js:1369-1378`), sending the fixed message "Please run `ratchet_ratify` for ADR … and
  put the decision to me as a question. Do not record a consent on my behalf." It therefore
  *asks the agent to ask the ratchet*; it mints nothing.
- The README states the rule plainly: "It never records a consent. A panel that minted one would
  be a second consent path, and the deployment's whole consent model rests on there being exactly
  one."

So the mechanism the human is asking for already exists in a two-step form: click → the agent
runs `ratchet_ratify` → the harness puts the ratchet's own question → the human answers. The
request is to remove the agent round-trip and the second step.

## Where a consent can be minted (measured)

- The only channel is the harness question seam: `user-questions/request`, an event typed
  `Scoped<Agent>` (`dsh-tool-cordis/lib/index.js:5620`). The UI half that renders a question and
  returns the answer is `@deepseek-ai/dsh-client-ui-user-questions`.
- `plugins/ratchet/ratchet-ratify.mjs` pins `RATIFY_CHANNEL = 'user-question'` and states that
  one channel is implemented. The module deliberately imports no harness: it builds a plain
  question payload and the adapter that owns the harness connection passes it to the seam and
  hands back the answer.
- `ratchet_ratify` is an agent tool. The ratchet CLI cannot ratify: "a shell cannot ask you
  anything, so this command cannot ratify".
- Kit `AGENTS.md` rule 12: a decision enters force through a recorded human consent and nothing
  else; there is deliberately no argument, tool parameter or shell command that accepts a
  composed answer, and `scripts/check-consent-surface.mjs` is what fails when that stops holding.
  The same rule names the residual gap: a hand-written approval and a frontmatter
  `authority: human` are both indistinguishable from a real consent, so "never do either, and
  never ask an agent to".

Two consequences follow for the panel. A browser bundle cannot reach the seam, because the seam
is Agent-scoped and the panel is a web-client plugin whose host half is an empty `apply()`. And
the panel must not write the approval file in its place.

## The two refused designs

1. **Silent mint.** The button writes the approval ADR and its transcript directly. Refused: it
   is a second consent path, it is exactly the forgeable shape rule 12 forbids, and the
   consent-surface check exists to fail when such a path appears.
2. **Panel-rendered question with a composed answer.** The panel shows Approve/Reject over the
   record text and submits the answer to the agent to record. Refused: the ratchet accepts no
   composed answer, and a question the ratchet did not ask is not the channel — it is the same
   second path wearing the question's clothes.

## The decision

- The panel gains a **first-class ratify action**, offered only for records the ratchet's own
  queue reports as ratifiable. A blocked record (an agent record in a `humanOnly` zone) is shown
  as blocked and offers no action, because putting an impossible question to a human wastes the
  one act the mechanism depends on.
- The action's consent is the ratchet's own question through `user-questions/request`. It may
  reduce the human's work to **click → the ratchet's question over the record text → answer**. It
  may not remove the question.
- The capability must live where the seam is reachable. The client half may render the affordance
  and invoke the action; it cannot ask. The host half, or a companion agent-side capability, owns
  the call — and **its reachability is measured before the UI is trusted**, recorded in
  `docs/RATCHET-API-FACTS.md` with its reproduction, because the panel is a web-client plugin
  today and the seam is scoped to an agent.
- The panel keeps writing nothing.

## What remains open

- Whether a web-client plugin's host half can be granted the Agent-scoped seam, or whether the
  action needs an agent-side companion plugin. This is the one unmeasured harness fact, and it is
  the implementation's first task.
- Whether the affordance's copy should show the content hash a "yes" would cover, as the CLI's
  `pending` does. The plumbing exists (the queue carries the hash); the UI does not show it yet.
- Whether the action should also be offered for a decision the queue reports as blocked, as a way
  to surface *why* it cannot be ratified. The reading here is no: the overlay already renders the
  blocked state.
