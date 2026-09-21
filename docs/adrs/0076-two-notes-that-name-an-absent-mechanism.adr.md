---
id: "0076"
title: Two unenforced notes that name a mechanism the code does not contain
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-21T00:00:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-21-the-critic-findings-and-the-three-calls.md
  hash: sha256:c6cbc9b04ad7fd45650b4a7c9613d3838c17f319394dae1e31fbf9d5c8b71420
zones: []
supersedes: []
approves: []
laws:
  - op: remove
    id: shipped-plugins.the-panel-records-no-consent-of-its-own
  - op: upsert
    id: shipped-plugins.the-panel-bundle-writes-no-consent-of-its-own
    statement: The panel writes no approval record and sets no authorship field, so no path from the overlay turns a record into law without the ratchet's question having been asked and answered.
    checks: []
    unenforced: Enforceable by extending `node scripts/test-adr-panel.mjs`, which already evaluates the shipped bundle, to assert that the bundle performs no write and that every control it renders answers the state route's payload. The mechanism such a check would assert, read from the shipped bundle rather than assumed: `plugins/dsh-adr-panel/client.js` performs no file write and contains no `workspaceFiles` access at all; its only data paths are the three host routes `/adr-panel/state`, `/adr-panel/consent` and `/adr-panel/resolve`, and the host half constructs no question, interprets no answer and writes no artifact. It replaces a law whose note claimed the bundle "reads through `workspaceFiles.list`/`read`" — a mechanism the bundle does not contain, which is what the next reader would have gone looking for.
  - op: remove
    id: shipped-plugins.the-question-seam-is-measured-from-the-panel-host
  - op: upsert
    id: shipped-plugins.the-question-seam-reach-is-recorded
    statement: Whether the panel's host half can reach the Agent-scoped user-questions seam, or needs an agent-side companion, is measured and recorded before the UI is trusted, because the seam is scoped to an agent and the panel is a web-client plugin.
    checks: []
    unenforced: The measured fact is recorded in `docs/RATCHET-API-FACTS.md` section 2.5 with its reproduction — a plugin TOOL BODY reaches the Agent-scoped `ctx.userQuestions` with the live root agent and receives an answer (check `ratchet_ratify.channel_reached_with_a_live_root_agent`), which is the seam the ratification path uses. The answer to this law's question follows from the shipped wiring rather than from that measurement alone: the panel's consent route calls the ratchet's `ratchetConsent` service (`plugins/dsh-adr-panel/index.js`), which calls the same `ratify` operation the `ratchet_ratify` tool calls, so the panel host reaches the seam INDIRECTLY and never reads `ctx.userQuestions` itself, and no agent-side companion is needed. Still unenforced by a command: nothing executes the panel host's route to prove it holds that shape, and the note this replaces said nothing had been measured at all.
---

## Context

Two laws in the corpus are `unenforced`, so their `unenforced` note is the whole of what a
reader learns from them — and both notes describe a state or a mechanism that is not there.
One says the ADR panel bundle "reads through `workspaceFiles.list`/`read`"; the shipped
bundle contains no `workspaceFiles` at all. The other says the question seam "has not been
measured yet"; a measurement exists in `docs/RATCHET-API-FACTS.md` and has since the probe
started reporting it.

Both laws are declared by record 0014 and were put in force by the ratification 0016, so
neither file can be edited: a ratified record and the source it cites are frozen, and an
edit voids the consent and takes the law out of force. The lifecycle for a change to a
ratified law is an amendment — `op: remove` for the old law id and a restatement under a
new one — and that is what this record is.

## Decision

Retire `shipped-plugins.the-panel-records-no-consent-of-its-own` and
`shipped-plugins.the-question-seam-is-measured-from-the-panel-host`, and restate both laws
under new ids with notes that describe what the code and the recorded measurements actually
contain.

## Reasoning

A note is the only content an unenforced law has. A note naming a mechanism the code does
not have is worse than no note: it is exactly what the next reader goes looking for, and
finding nothing, they distrust the law rather than the note. The full reasoning is the cited
source, which also records the mechanism the panel actually uses.

## Consequences

- This record names NO zone, and that is deliberate. It removes laws that are in force, so
  the guard would classify it as a proposal working against a ratification and refuse writes
  in every zone it named — which for `shipped-plugins` would freeze all plugin work between
  the drafting of this record and its ratification. Correcting a note is not work in a zone;
  the removals target law ids, not paths.
- Nothing changes until a human ratifies this record. Removal of a law whose force came from
  a ratification is refused to an unratified agent record, which is the intended behaviour.
