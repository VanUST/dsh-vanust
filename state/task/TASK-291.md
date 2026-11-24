---
id: TASK-291
kind: task
title: "Batch the spike: two seats and one gate per batch in the orchestrator policy"
status: done
revision: 6
createdAt: 2026-11-24T08:44:27.290Z
updatedAt: 2026-11-24T08:57:13.559Z
acceptance:
  - text: "ROOT_POLICY step 3 no longer says \"One task per child\" and states the two-seat pattern (rows created once, each attached to one live role session with taskId, one brief per row)"
    done: false
  - text: "a delegation rule states the batch end to end: implementer seat takes the rows, one verification seat takes the batch (TESTER session or delegate_review 2-8 rows), a verify cycle per row is refused, the record is never merged, the gate runs once at the end, a failure returns as a delta"
    done: false
  - text: "ROOT_POLICY step 5 says the tester/reviewer order runs once for a batch, not once per row"
    done: false
  - text: "docs/HARNESS-OVERVIEW.md:425 quotes the shipped CHILD_POLICY case bullet, not the pre-0.1.68 one"
    done: false
  - text: "orchestrator repacked and make verify exits 0 with 0 FAIL lines; the new sentences are present in the packed tarball"
    done: false
  - text: "ROOT_COMMON_POLICY, CHILD_POLICY, every persona and the budgets table are unchanged; :3080 was not restarted and no kit-update ran"
    done: false
boardId: task-mwug7rbp-m2ryf5
nonScope: ["No change to ROOT_COMMON_POLICY, CHILD_POLICY or any persona text", "No change to the budgets table or to any tool list", "No change to docs/cases/** or the case library", "No new wording about verification levels — the proportional rule stays as it is", "No kit-update, no live profile install, no restart of the server on :3080"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-240, REQ-241]
resultEvidence: ["orchestrator.mjs:461 step 3: rows created once; every further row attaches to the SAME live session with taskId, one brief per row, once the seat has settled", "orchestrator.mjs:475 new delegation rule 'A spike runs in two seats, not one child per row' — implementer seat, ONE verification seat (TESTER session or delegate_review), gate once at the end, delta back into the same seat, single edit not batched", "orchestrator.mjs:463 'That order runs ONCE for a batch'; delegate_review really is 2-8 rows (orchestrator.mjs:1363)", "grep 'One task per child' -> 0 in plugins/orchestrator/orchestrator.mjs and in cc-dsh-orchestrator-0.1.69.tgz; 'two seats' -> 1 in the tarball", "docs/HARNESS-OVERVIEW.md:425 now matches the shipped CHILD_POLICY bullet byte for byte (git diff --numstat 1 1)", "pack-plugin: @cc/dsh-orchestrator 0.1.68 -> 0.1.69, sha256 3efcdd8e…; make verify -> exit 0, 0 FAIL lines, 20/20 portability and packaging checks", "ss -ltnp | grep 3080 -> the same listener; no dsh command ran in the task; ROOT_COMMON_POLICY delta 0 (1144 -> 1144)", "Analysis record batch-execution: FR1/NFR1 deferred with the evidence (proof level, no formal TEST); readiness and completion green"]
resultSummary: "The orchestrator policy now batches a spike in two seats: step 3 creates the rows once and attaches each to the same live role session with taskId (one brief per row, once the seat has settled), a new delegation rule states the batch end to end (implementer seat + ONE verification seat: TESTER session or delegate_review for 2-8 rows; the record is never merged; the gate runs once at the end; a failure returns as a delta; a single edit or a question is not batched), and step 5 says the TESTER/BACKEND/TESTER/REVIEWER order runs once per batch. \"One task per child\" is gone from source and tarball; docs/HARNESS-OVERVIEW.md:425 quotes the shipped CHILD_POLICY bullet. @cc/dsh-orchestrator repacked 0.1.68 -> 0.1.69; make verify exits 0 with 0 FAIL lines and 20/20 packaging checks; ROOT_COMMON_POLICY and every persona untouched; :3080 never restarted."
role: BACKEND
scope: ["plugins/orchestrator/orchestrator.mjs — ROOT_POLICY only: step 3, one new delegation-rule bullet, step 5", "docs/HARNESS-OVERVIEW.md — the quoted CHILD_POLICY bullet at :425 brought in line with the shipped text", "the orchestrator tarball and package version (repack)", "a fresh BACKEND child: the previous BACKEND session was retired with its task, so nothing from it is in context"]
---

Make the orchestrator's own policy say that speed comes from batching, so a spike stops costing one child and one verify cycle per row. Three edits in `plugins/orchestrator/orchestrator.mjs` ROOT_POLICY, plus one doc correction: (1) step 3 of "Bigger than one sitting" — replace "One task per child" with the two-seat pattern: create the rows once, then attach each row to the SAME role session with `taskId`, one brief per row, once that seat has settled (a role keeps one live session; a fresh child per row pays the context cost again for nothing); (2) a new bullet in "Delegation rules" — a spike runs in two seats: one implementer seat takes the batch, ONE verification seat takes the whole batch (TESTER session, or `delegate_review` for 2-8 review rows); a verify cycle per row is the paperwork that turns a two-hour spike into a day; batching never merges the record (each row keeps its acceptance and evidence), the gate runs ONCE at the end, a failure comes back as a delta into the same seat, and a single edit or a question is neither batched nor delegated; (3) step 5 — the TESTER/BACKEND/TESTER/REVIEWER order runs once per batch, not once per row. Then correct `docs/HARNESS-OVERVIEW.md:425`, which still quotes the pre-0.1.68 CHILD_POLICY bullet, and repack the plugin.
