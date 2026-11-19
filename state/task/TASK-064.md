---
id: TASK-064
kind: task
title: "Review the delivery for defects"
status: done
revision: 2
createdAt: 2026-11-17T15:52:39.738Z
updatedAt: 2026-11-17T15:52:39.738Z
acceptance:
  - text: "Every finding names severity, file:line and a reproduction or a cited code path; no style opinions without a defect"
    done: false
  - text: "The review covers all three commits (f80d7b8 per-chat taskboard, 3768de6 role presets, b5adb7a lifecycle/design-map/project-rules/toolchain/critic), including client-host contract mismatches and the gated plugins"
    done: false
  - text: "The review explicitly checks the uncommitted other-chat work is out of scope and does not blame it on this delivery"
    done: false
  - text: "A ranked list of defects (P0 data loss/security, P1 wrong behaviour, P2 doc/UX) is in the task note and the final message; no fixes are made"
    done: false
boardId: task-mwatgtf7-p2c4kg
nonScope: ["no code changes, no commits, no installs, no server restart", "out of scope: the uncommitted image-window plugin, session-store guard, start.sh/ps1 and Makefile from another chat", "no style-only findings"]
owner:
  kind: agent
  label: REVIEWER
  sessionId: 1abe39dd-1c5d-40a9-964e-fbb5c15562b5
ownerRole: REVIEWER
role: REVIEWER
scope: ["read-only inspection of the committed tree", "the five changed plugins, profile/cordis.patch.yml, scripts/provision-tools.mjs, scripts/check-*.mjs, docs"]
sessions:
  - sessionId: 1abe39dd-1c5d-40a9-964e-fbb5c15562b5
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

Independent review of the delivered changes for defects: read the three commits and the surrounding code, and report logic errors, contract mismatches (client vs host), guard bypasses, regressions and documentation lies, each with file:line and a reproduction.

Migrated from .dsh/taskboard.json (task task-mwatgtf7-p2c4kg, revision 7).
