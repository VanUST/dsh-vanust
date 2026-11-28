---
id: TASK-311
kind: task
title: "State feed must not block the step it injects into"
status: done
revision: 6
createdAt: 2026-11-24T12:44:58.110Z
updatedAt: 2026-11-24T13:10:51.123Z
acceptance:
  - text: "the blocking mechanism is named from the harness's own code (file:line) — what agent.inject() waits for when it is called inside the pre-step waterfall"
    done: false
  - text: "the feed no longer calls inject synchronously inside a hook that the step waits on: the hook returns before the injection is delivered, or the injection moves to a boundary that cannot block the step — the choice follows the mechanism found"
    done: false
  - text: "a unit test pins the fix: the pre-step participant returns next()'s promise without the injection having been made yet, and exactly one delta is delivered per turn"
    done: false
  - text: "the truncation artefact goes too: a capped delta never leaves a section header with no rows under it"
    done: false
  - text: "make test and make verify are green and the plugin is repacked"
    done: false
boardId: task-mwuot25p-o93spi
chore: true
choreReason: "The state feed can deadlock a running agent: after the STATE (L2, delta) message arrives the turn stalls and only a manual stop plus a new message recovers it. That blocks every root session, so it is fixed before anything is pushed."
nonScope: ["No change to the harness package itself", "No change to the delta content or to the one-per-turn rule", "No designmap, test-cases or profile work"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["harness mechanism: dsh-agent-loop/lib/index.js:585-587 -> :573-577 send(input,'next-step',false) -> agent/inbox/spliced append (159-161, 174-200); preStep claims the batch at :683 before the waterfall at :698; docs/subsystems/core.md:135-143 and :385 state that input inserted after the claim stays pending", "session-log evidence: an autolabel session ended with state-feed spliced into next-step three times, one claim, no turn", "new tests 10/10, including 'the delta enters the step decision and never the session inbox' and 'a capped delta never leaves a section header with no rows'", "red first on HEAD sources: 6 pass / 4 fail (delta-in-decision, L2-per-turn, L1-fallback, cap)", "make test 68/68, make verify 20/20, tarball 0.1.4 identical to its source"]
resultSummary: "The state feed no longer stalls a step. The harness mechanism is named: agent.inject() awaits nothing, it appends to the NEXT step's inbox, and pre-step has already claimed the step's batch before the agent/pre-step waterfall runs, so an injected delta is parked until a new user message wakes the driver - exactly the observed hang. The fix delivers the delta through the pre-step decision (the seam agent-instructions uses), so it enters the step about to run, is written as a user message with source kind state-feed, one delta per turn, hash recorded when the decision enters. cap() also no longer leaves a section header without its rows. Red first on HEAD sources 6 pass / 4 fail, now 10/10; make test 68/68, make verify 20/20; plugin repacked 0.1.4 and matching its source."
role: BACKEND
scope: ["plugins/state-feed/index.mjs — the hook and the delivery", "plugins/state-feed/lib/feed.mjs — cap and any helper the fix needs", "plugins/state-feed/test/ — the regression test", "package.json version, tarball"]
---

Fix the state feed so it can never stall a running agent. Symptom: the STATE (L2, delta) message arrives and the turn then stops; only a manual stop and a new message recover it. Our feed calls agent.inject() synchronously inside the agent/pre-step waterfall participant (index.mjs:96-104) and only afterwards returns next(), so the injection is attempted while the step is still being prepared and the step is waiting on the hook. Read the harness's own inject and pre-step implementation, name what inject waits for (file:line), then remove the re-entrancy: either deliver the message after the hook has returned (a scheduled callback that cannot block the step) or move the delivery to a boundary that cannot block, keeping the design's behaviour — the delta arrives once per turn, only when the projection hash changed, and is logged as a user message. Pin it with a unit test that fails on the current code. Also fix the truncation artefact: a capped delta must not leave a section header with no rows below it.
