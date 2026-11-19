---
id: TASK-093
kind: task
title: "Fix test-cases panel usability"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:40.159Z
updatedAt: 2026-11-17T15:52:40.159Z
acceptance:
  - text: "Every list row and detail heading shows a labelled status whose meaning is understandable without decoding a bare badge."
    done: false
  - text: "A deprecated or superseded case can be permanently removed through a host command with confirmation; open/active/review cases cannot."
    done: false
  - text: "The detail pane has an explicit hide/show control; hiding it gives the list the full width and restores it without losing selection/filters."
    done: false
  - text: "The detail pane scrolls independently for long requirements, steps, evidence and history at desktop and narrow widths."
    done: false
  - text: "Empty/loading/error, keyboard focus, dark theme and no-overflow checks remain valid; 22+ existing checks still pass."
    done: false
  - text: "Host deletion is CAS-safe, audited/confirmed in UI, packaged versions bumped, make verify 0, browser screenshots and console/network evidence recorded."
    done: false
boardId: task-mwc5oun7-d5txre
nonScope: ["Do not delete non-closed cases.", "Do not bypass host CAS/schema for deletion.", "No new top-level workspace tab; keep Test cases inside Tasks.", "No live :3080 install/restart during proof."]
owner:
  kind: agent
  label: UX/UI
  sessionId: b7de70dd-8768-4678-80fb-d14484c0d319
ownerRole: UX/UI
preset: ux
resultArtifacts: [plugins/test-cases/client.js, plugins/test-cases/test-cases.mjs, plugins/test-cases/README.md, plugins/test-cases/package.json, plugins/taskboard/client.js, plugins/taskboard/package.json, plugins/cc-dsh-test-cases-0.1.9.tgz, plugins/cc-dsh-taskboard-0.1.48.tgz, reports/test-cases-panel/EVIDENCE.md, reports/test-cases-panel/usability-proof.mjs, reports/test-cases-panel/usability.log, reports/test-cases-panel/usability-result.json, reports/test-cases-panel/usability-console-network.json, reports/test-cases-panel/screens/]
resultEvidence: ["node reports/test-cases-panel/usability-proof.mjs -> exit 0, 15/15 PASS; usability-result.json", "status asserted per row (.tc-statuskey, 12 rows) and detail meaning; screenshot 20", "hide detail width 390 -> 1160, filters verified preserved; screenshots 22/23", "long detail scrollHeight 1380 vs clientHeight 854, page scrollY 0; narrow 1362/461 and no page overflow; screenshots 21/27", "host-created panel-remove-fixture deprecated rev2; file removed, audit line .removed.jsonl removedBy human; active case refused CASE_NOT_REMOVABLE; screenshots 24-26", "make verify -> 17/17 packaging + documentation ok, exit 0; test-cases 0.1.9 sha256 7467f26c…, taskboard 0.1.48 sha256 3d3e63ed…"]
resultSummary: "Four usability defects fixed in the real Tasks > Test cases panel: labelled status with meaning in rows/detail, terminal-only CAS removal via host case_remove with confirmation + audit, hide/show detail with full-width list and preserved filters/selection, and independent detail scrolling at desktop/narrow. Final packages test-cases 0.1.9 + taskboard 0.1.48; make verify 0. Proof: 15/15 usability checks + earlier 22/22 panel checks, console/network logs and screenshots."
role: UX/UI
scope: ["plugins/test-cases/client.js, test-cases.mjs and host contract for explicit closed-case deletion", "plugins/taskboard/client.js only if tab layout needs adjustment", "reports/test-cases-panel/ proof artifacts and screenshots", "docs/cases fixture updates needed for proof"]
sessions:
  - sessionId: b7de70dd-8768-4678-80fb-d14484c0d319
    label: UX/UI
    role: UX/UI
    status: sleeping
---

Fix four owner-reported Test cases panel defects: make case status explicit, allow deprecated/superseded cases to be removed, make the detail pane collapsible so the list can use full width, and make long detail content scrollable. Prove all four in the real Tasks panel.

Migrated from .dsh/taskboard.json (task task-mwc5oun7-d5txre, revision 8).
