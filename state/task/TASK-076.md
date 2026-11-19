---
id: TASK-076
kind: task
title: "Build fair code-search benchmark"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.906Z
updatedAt: 2026-11-17T15:52:39.906Z
acceptance:
  - text: "At least three representative repository questions cover conceptual discovery, exact symbolic navigation and relationship/impact analysis, with ground truth established before scoring."
    done: false
  - text: "Baseline and enhanced arms use the same model, prompts/tasks and repository revision, with only tool availability/routing changed."
    done: false
  - text: "Actual logs prove which tools each arm received and called."
    done: false
  - text: "Results report fresh input, cache read, output tokens, calls, duration and correctness per task, including setup/schema cost and limitations."
    done: false
  - text: "Small samples are not presented as statistically conclusive; raw evidence paths and exact commands are included."
    done: false
  - text: "The benchmark CLI help path works without ReferenceError and still documents the exact proof/gate semantics."
    done: false
boardId: task-mwbw9fvd-jx4awm
nonScope: ["Do not alter production source or installed live :3080 profile.", "Do not fabricate token counts or correctness scores; read actual session logs.", "Do not add an automated test suite; benchmark artifacts are measurement tooling requested by the human.", "Do not run the enhanced arm until its exact tool availability is verified from session logs.", "Do not use taskboard/Hindsight as a hidden source of answers for either arm."]
owner:
  kind: agent
  label: "BACKEND adoption benchmark"
  sessionId: 92a56489-afca-48cc-b547-5244a47a4d58
ownerRole: BACKEND
preset: backend
resultEvidence: ["reports/code-search/adoption/comparison.json: same bytes/prompts/model; +20 requests, +25 calls, +694,212 prompt, +31.196s log wall", "reports/code-search/adoption/{baseline,enhanced}/measurements.json: actual calls, with Serena 8 and Octocode 0", "reports/code-search/adoption/provenance: 137/137 clean index paths in HEAD", "reports/test? no; benchmark help exit 0, proof/measure/compare smoke exit 0", "make verify exit 0"]
resultSummary: "Completed overhead-only and clean-index adoption comparisons on a pinned worktree/model. The clean enhanced arm actually used Serena (8 calls) but not Octocode, and cost more requests/calls/prompt tokens and latency at equal correctness, so no savings claim is made. The benchmark runner's help template bug was fixed; proof, measure and compare modes execute and raw results remain unchanged."
role: BACKEND
scope: ["scripts/session/ or scripts/ for a reusable benchmark runner if needed", "reports/code-search/ for task definitions, ground truth, raw measurements and report", "Temporary isolated DSH profiles/overlays for execution"]
sessions:
  - sessionId: 913d5bfc-967b-4ad7-b79e-16f378fa25a8
    label: BACKEND
    role: BACKEND
    status: sleeping
  - sessionId: a89c91e0-4091-4da1-92fe-5eba1f447bae
    label: "BACKEND benchmark"
    role: BACKEND
    status: sleeping
  - sessionId: 92a56489-afca-48cc-b547-5244a47a4d58
    label: "BACKEND adoption benchmark"
    role: BACKEND
    status: sleeping
---

Complete the code-search evaluation in two stages: preserve the completed zero-adoption overhead comparison, then run a clean snapshot-indexed Serena+Octocode adoption pair with DSH reminder hooks on the same pinned worktree. Measure correctness, fresh/cache/prompt/output tokens, calls, latency, setup and actual tool usage from raw logs.

Migrated from .dsh/taskboard.json (task task-mwbw9fvd-jx4awm, revision 22).
