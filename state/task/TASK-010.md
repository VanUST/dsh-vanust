---
id: TASK-010
kind: task
title: "Role reuse + idempotent delegation (P0+P1) in orchestrator/taskboard"
status: done
revision: 2
createdAt: 2026-11-17T15:52:39.069Z
updatedAt: 2026-11-17T15:52:39.069Z
acceptance:
  - text: "a second chat's delegate_task reuses an existing role name and reports that it did"
    done: false
  - text: "a near-duplicate new role is refused with the existing roles listed, unless forceRole is passed"
    done: false
  - text: "the ledger keeps the previous sessionId under history[] + generation instead of overwriting silently"
    done: false
  - text: "a re-created specialist's brief carries the role's previous results"
    done: false
  - text: "delegate_task(taskId) attaches to that task instead of creating a second one"
    done: false
  - text: "kit-update --apply installs the new tarballs and dsh web --dump-config still composes"
    done: false
boardId: task-mvuwm7kn-asnwgv
nonScope: ["P2 persistent specialists as root-kind sessions (deferred by the user)", "the harness itself (no changes outside ~/dsh-kit)", autotests]
resultEvidence: ["node scripts/pack-plugin.mjs --dir plugins/orchestrator -> cc-dsh-orchestrator-0.1.9.tgz (removed 0.1.8)", "kit-update --apply -> installed @cc/dsh-orchestrator 0.1.9, @cc/dsh-taskboard 0.1.28; dsh web --dump-config exit 0", "scratch board: generation 1 -> 1 -> 2, history kept with chatSessionId, attach patched a roleless task to BACKEND", "real ledger: catalog lists 10 roles; carry-forward for BACKEND rendered its last result", "dsh web --port 3099 booted with the new tarballs, no plugin error in the log", "check-documentation ok; check-portability 17/17", "git push 4e8df96..900e7fe main -> main"]
resultSummary: "P0+P1 implemented, converged and pushed as 900e7fe: the root policy lists the workspace's roles at assembly time; delegate_task refuses a near-duplicate new role unless forceRole, keeps superseded session ids in the ledger history[] with a generation counter and chatSessionId, carries a re-created role's last results into the brief, and attaches to an existing task when taskId is given. Taskboard 0.1.28, orchestrator 0.1.9 are installed in the web profile and committed."
scope: [plugins/orchestrator/orchestrator.mjs, plugins/taskboard/taskboard.mjs, "profile/cordis.patch.yml and profile/package.json pins", "plugins/*.tgz repack via scripts/pack-plugin.mjs", "rules/DEPLOYMENT.md and USERGUIDE.md where the delegation flow is described"]
---

Stop the orchestrator from inventing duplicate specialist roles across chats and from creating a second task for work that already has one: show existing roles to the root agent, refuse a near-duplicate new role unless forced, keep role session history instead of silently overwriting it, carry the role's prior results into a re-created specialist's brief, and let delegate_task attach to an existing task instead of always creating one.

Migrated from .dsh/taskboard.json (task task-mvuwm7kn-asnwgv, revision 3).
