---
id: TASK-134
kind: task
title: "Analysis Record + task decomposition for the designmap redesign"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.764Z
updatedAt: 2026-11-17T15:52:40.764Z
acceptance:
  - text: "analysis_check reports readiness.ok true with readiness state, zero errors"
    done: false
  - text: "Every spec requirement (BR-1..3, FR-1..10, NFR-1..4) has acceptance and a trace row"
    done: false
  - text: "API-first spike and M0 tasks exist and reference the record"
    done: false
boardId: task-mwj4bec2-q44n2p
inline: true
nonScope: ["plugin code changes (M0–M4 belong to specialist tasks)", "installing or restarting the live :3080 profile"]
resultEvidence: ["docs/analysis/designmap-redesign.json rev 2 status ready; analysis_check readiness.ok true, errors 0 (completion in_progress: 17 planned, expected at start)", "17 requirements (BR-1..3, FR-1..10, NFR-1..4) with acceptance and trace rows, 4 components, 5 data owners, 5 contracts, 5 invariants, 8 decisions, 2 open questions, L2 sizing", "Spike tasks tasked: task-mwj4d9ka-tcvwpx (BACKEND §12 host APIs) and task-mwj4da1o-lik5t8 (UX/UI React Flow in-panel proof)", "Milestone tasks created: M0 task-mwj4eqc2-6uznd6, M1 task-mwj4eqgt-rx37sd, M2 task-mwj4eql4-49ja0b, M3 task-mwj4eqpl-a6043y, M4 task-mwj4equ1-jk1d31"]
resultSummary: "Recorded the redesign as a ready L2 initiative and decomposed it into gated work: two API-first spikes per spec §12, five milestone tasks (M0 core, M1 read-only panel, M2 edit mode, M3 living doc, M4 packaging), plus the pinned scene contract (docs/designmap/SCENE-CONTRACT.md) that lets M0 and M1 proceed against one artifact."
scope: [docs/analysis/designmap-redesign.json, "taskboard tasks for the designmap initiative"]
---

Turn the owner's design map v1 spec into a ready Analysis Record (business outcome, process AS-IS/TO-BE, requirements with acceptance, architecture/data/contracts, invariants, decisions, open questions, L2 sizing) and create the milestone tasks with owners, so the API-first gate and M0–M4 can be delegated.

Migrated from .dsh/taskboard.json (task task-mwj4bec2-q44n2p, revision 4).
