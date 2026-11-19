---
id: TASK-086
kind: task
title: "Build test-cases panel"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:40.066Z
updatedAt: 2026-11-17T15:52:40.066Z
acceptance:
  - text: "Panel lists cases with visible title/status/kind/source/automated/lastVerified and filters; stale badge itself and explanation are both asserted."
    done: false
  - text: "Detail shows requirement, steps, expected, red/green evidence, history and surface drift; long content is bounded but expandable."
    done: false
  - text: "Edit uses revision CAS and surfaces REVISION_CONFLICT without overwriting; verify/deprecate follow host semantics."
    done: false
  - text: "The crowded top workspace bar gets no new full-width tab; test cases live inside the existing Tasks surface and remain keyboard-discoverable."
    done: false
  - text: "Taskboard/tab integration does not throw when test-cases is absent; feature is guarded by plugin availability."
    done: false
  - text: "Case rows keep a valid accessible role while remaining keyboard-openable; panel writes only via host command."
    done: false
  - text: "Empty/loading/error, keyboard, narrow viewport, dark theme and no-overflow are re-proven; screenshots/console/network recorded."
    done: false
  - text: "Plugin latest tarball matches source and make verify 0 after host security fixes."
    done: false
boardId: task-mwc1lrjv-0h9lgy
nonScope: ["Do not change case schema semantics or bypass the host service writer.", "No direct client filesystem writes or unguarded JSON mutation.", "No live :3080 install/restart during proof; use second server.", "Do not overwrite host proof artifacts from the backend task."]
owner:
  kind: agent
  label: UX/UI
  sessionId: b7de70dd-8768-4678-80fb-d14484c0d319
ownerRole: UX/UI
preset: ux
resultEvidence: ["reports/test-cases-panel/proof.log and proof-result.json: 22/22 PASS, exit 0", "reports/test-cases-panel/absent-plugin.mjs: taskboard-only server, testCasesTab 0, board visible, errors []", "screens/01-tasks-cases-tab.png, 02-list-1440.png, 08-cas-conflict.png, 11-narrow-760.png, 12-dark-1440.png, 14-tasks-without-test-cases.png", "plugins/test-cases/client.js and plugins/taskboard/client.js: host-only /test-cases commands and guarded tab", "packed test-cases 0.1.7 and taskboard 0.1.43; final tree taskboard 0.1.45 adds live-running state and remains packaged", "make verify exit 0"]
resultSummary: "Built the Test cases panel inside the existing Tasks surface, avoiding a new crowded top-level tab. It supports list/filter, stale and status badges, detail with steps/evidence/history/drift, host-only compare-and-set edit, verify/deprecate, keyboard access, narrow layout and dark theme. The Taskboard tab is optional and guarded when the test-cases plugin is absent. Final client proof passed 22/22 checks and packaging matches source."
role: UX/UI
scope: ["plugins/test-cases/ client and host bridge/commands/remote methods", "docs/cases/ only for fixtures if needed", "reports/test-cases-panel/ for proof", "directly related package/inventory/docs entries"]
sessions:
  - sessionId: b7de70dd-8768-4678-80fb-d14484c0d319
    label: UX/UI
    role: UX/UI
    status: sleeping
---

Add a human-facing test-cases panel to @cc/dsh-test-cases: list/filter cases, open details with requirement/steps/evidence/history, show stale and status badges, edit with compare-and-set, verify or deprecate through host-owned operations, and render it in the real Harness Web UI.

Migrated from .dsh/taskboard.json (task task-mwc1lrjv-0h9lgy, revision 11).
