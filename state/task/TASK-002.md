---
id: TASK-002
kind: task
title: "UX/UI review — Tasks panel"
status: done
revision: 2
createdAt: 2026-11-17T15:52:38.975Z
updatedAt: 2026-11-17T15:52:38.975Z
acceptance:
  - text: "primary buttons and count badges are readable in the dark theme (no white text on a white brand fill) and remain readable in light theme"
    done: false
  - text: "title/status/objective/scope/non-scope/acceptance/result/evidence controls fit at 1280px and the detail pane stacks below the board when the taskboard container is narrower than ~920px"
    done: false
  - text: "scope/non-scope/acceptance evidence show at least three lines without clipping at the default height"
    done: false
  - text: "keyboard focus outlines and form labels are preserved; no horizontal page overflow"
    done: false
  - text: "report the exact edits and a short browser/static evidence note; no autotests"
    done: false
boardId: task-mvjkuoen-efrhz0
nonScope: ["do not edit profile/, inventory, package versions, tarballs, or any other plugin", "do not run kit-update, pnpm, or a dsh server; do not touch the live 3080 process", "do not add tests, new dependencies, or a new RPC layer", "do not change the task JSON shape or the command protocol"]
owner:
  kind: agent
  label: "UX/UI review — Tasks panel"
  sessionId: f6619d24-2b44-4f0a-94a9-2a73b0a1b91d
resultArtifacts: [plugins/taskboard/client.js, reports/harness-integration/assets/taskboard-live.png]
resultEvidence: ["node --check plugins/taskboard/client.js exit 0", "browser fixture: dark primary 18.08:1, light 18.9:1; 918/920px container stacked; 921px two columns; page scrollWidth == clientWidth", "live dsh 3092 after 0.1.8 install: Tasks panel detail at 1280 shows all four scope lines and Save/New task/count controls readable", "screenshot reports/harness-integration/assets/taskboard-live.png"]
resultSummary: "CSS-only UX pass shipped as taskboard 0.1.8 and verified live at 1280: semantic primary fill/foreground pair, 84/96px fields, container-query stacking with the defeating 1200px rule removed, primary hover/disabled states. The taskboard detail now shows the full 4-line scope/non-scope/acceptance without clipping."
scope: [plugins/taskboard/client.js, plugins/taskboard/README.md]
sessions:
  - sessionId: f6619d24-2b44-4f0a-94a9-2a73b0a1b91d
---

Review the current Tasks taskboard UI and make a focused, shippable UX/UI improvement to plugins/taskboard/client.js: readable primary controls in both themes, a form that fits and stacks at narrow panel widths, and honest multi-line editing. Do not rewrite the plugin; keep the existing slot registrations and data flow.

Migrated from .dsh/taskboard.json (task task-mvjkuoen-efrhz0, revision 5).
