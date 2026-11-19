---
id: TASK-011
kind: task
title: "Make stale roles, orphaned sessions and stalled delegations visible (P0.5)"
status: done
revision: 2
createdAt: 2026-11-17T15:52:39.080Z
updatedAt: 2026-11-17T15:52:39.080Z
acceptance:
  - text: "a role row whose lastTaskId is gone, or untouched for a day, is reported stale/orphaned instead of active"
    done: false
  - text: "the panel header counts active only from non-stale rows and shows the stale count"
    done: false
  - text: "removing a task clears agent rows pointing at it through lastTaskId, not only through childSessionIds"
    done: false
  - text: "delegate_task leaves a timeline note before the child starts and a guaranteed note when it fails, so a task cannot sit in ready with no reason"
    done: false
  - text: "the root policy states review debt (count + oldest) and ready tasks with no child"
    done: false
  - text: "checks stay green and the new tarballs install and boot"
    done: false
boardId: task-mvv0z951-cxdd1o
nonScope: ["P2 persistent specialists (still deferred)", "rewriting the existing 7 review tasks or orphan rows by hand", autotests]
resultEvidence: ["real board ~/tasks/3d: live active 0, all 10 rows stale/orphan; debt block names 7 reviews (oldest 4d) + task-mvuzyigm-1b6s5f", "scratch board: remove() cleared the role row pointing at the removed task; P0 history/generation regression passed", "check-documentation ok; check-portability 17/17; dsh web --port 3098 boot with new tarballs had no plugin error", "installed taskboard 0.1.29 / orchestrator 0.1.10; live session policy now shows the role catalog and the debt line", "git push 900e7fe..a8f4f36 main -> main"]
resultSummary: "P0.5 shipped as a8f4f36 (taskboard 0.1.29, orchestrator 0.1.10): role rows are annotated stale/orphan on read and the panel counts active only from live rows; remove() clears agents by lastTaskId; delegate_task notes the delegation before the child starts and always records a failure reason; the root policy carries a board-debt block (review count + oldest, ready-with-role-no-child ids)."
scope: [plugins/taskboard/taskboard.mjs, plugins/taskboard/client.js, plugins/orchestrator/orchestrator.mjs, profile/cordis.patch.yml, "rules/DEPLOYMENT.md / USERGUIDE.md where relevant", "plugin tarballs and versions"]
---

Stop the taskboard reporting dead specialists as active and losing the reason a delegation never started: mark role rows stale/orphaned on read, count active only from live rows, clear agent rows by lastTaskId on task removal, make delegate_task record a starting note and a guaranteed failure note, and surface review/ready debt in the root policy so the next chat can act on it.

Migrated from .dsh/taskboard.json (task task-mvv0z951-cxdd1o, revision 3).
