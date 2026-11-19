---
id: TASK-100
kind: task
title: "Taskboard: batch close with result and a real subagent stop"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:40.254Z
updatedAt: 2026-11-17T15:52:40.254Z
acceptance:
  - text: "task_close on a review task with resultSummary/resultEvidence closes it in one call; a missing summary/evidence is still refused by name"
    done: false
  - text: "task_close with ids closes a batch in one ledger write, returns per-task results, and never rewrites an existing summary"
    done: false
  - text: "task_cancel/pause/close call ctx.subagents.interrupt with a valid authority and a live linked child is actually stopped; a refused interrupt still leaves the task as it was"
    done: false
  - text: "the forced-stop path is reachable by the orchestrator and reports per-child outcomes"
    done: false
  - text: "scripts/taskboard-close-stop-proof.mjs fails on the pre-fix modules (red) and passes on the fixed ones (green)"
    done: false
  - text: "make verify passes; the packed tarballs agree with source; the live profile has the new versions"
    done: false
boardId: task-mwdk0s2c-2j0lhd
inline: true
nonScope: ["no change to the review gate: task_close still refuses a task that is not in review", "no live taskboard row cleanup in this task; the owner does that in batches", "no DSH harness patch: the stop path uses the documented ctx.subagents.interrupt authority", "no broad UI redesign of the Tasks panel"]
resultArtifacts: [plugins/cc-dsh-taskboard-0.1.51.tgz, plugins/cc-dsh-orchestrator-0.1.33.tgz, scripts/taskboard-close-stop-proof.mjs, "reports/taskboard-close-stop/EVIDENCE.md (gitignored local evidence)"]
resultEvidence: ["node scripts/taskboard-close-stop-proof.mjs -> 40/40 checks passed, exit 0 (working tree)", "node scripts/taskboard-close-stop-proof.mjs --taskboard ~/.npm/dsh/profiles/web/node_modules/@cc/dsh-taskboard/taskboard.mjs -> 40/40, exit 0 (installed 0.1.51)", "node scripts/taskboard-close-stop-proof.mjs --taskboard ~/.npm/dsh/profiles/web/node_modules/@cc/dsh-taskboard.bak-0.1.45/taskboard.mjs -> 13/40, exit 1 (previous live build, red)", "make verify -> 17/17 portability and packaging checks passed; documentation ok; exit 0", "node --check plugins/taskboard/taskboard.mjs plugins/orchestrator/orchestrator.mjs plugins/taskboard/client.js -> exit 0", "git commit b34d162 pushed to origin/main (f2b4876..b34d162)"]
resultSummary: "Taskboard 0.1.51 and orchestrator 0.1.33 now make acceptance one call (task_close takes resultSummary/resultEvidence and fills only missing fields) and close/cancel a batch in one ledger write via ids, with per-task refusals. The subagent stop was broken at the runtime seam: the hook passed a raw Agent object where DSH 0.2.1-rc.2 expects {kind:'ancestor',agent} or {kind:'user',parentSessionId}, so every live child produced interrupt_failed. Both authorities now work; task_stop and a Stop child panel button force-stop one child without changing the task status. The running :3080 host still has the old modules in memory until a dsh web restart; the installed profile is 0.1.51/0.1.33."
scope: ["plugins/taskboard/taskboard.mjs: close/closeMany/cancel batch semantics and the subagent interrupt authority", "plugins/taskboard/README.md and USERGUIDE/API docs for the new surface", "plugins/orchestrator/orchestrator.mjs: root policy teaches one-call/batch close and the stop path", "scripts/taskboard-close-stop-proof.mjs: red-first contract proof on a disposable board", "packaged taskboard/orchestrator tarballs and the live web profile install"]
---

Make task acceptance one call for one task and one call for a batch, and make the orchestrator able to stop a linked specialist on task cancel/pause/close and on an explicit forced stop. Preserve the review gate and the ledger's honesty: a close with a result fills only missing result fields, never rewrites a recorded summary; batch close reports per-task refusals instead of claiming a whole batch.

Migrated from .dsh/taskboard.json (task task-mwdk0s2c-2j0lhd, revision 3).
