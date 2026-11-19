---
id: TASK-030
kind: task
title: "Independent end-to-end verification of the five web testing skills"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.312Z
updatedAt: 2026-11-17T15:52:39.312Z
acceptance:
  - text: "Every claim in the report cites a command and its observed output/exit code"
    done: false
  - text: "At least two executed claims per skill, including one negative case that must fail"
    done: false
  - text: "A mismatch is reported as a defect with the exact expected/observed values, not smoothed over"
    done: false
  - text: "The fixture is reproducible: its path and run commands are in the report"
    done: false
boardId: task-mw95rb6f-nrx2dg
nonScope: ["Editing plugins/ or any shipped file", "Repacking/installing the plugin", "Maestro flow execution", "Windows execution"]
owner:
  kind: agent
  label: REVIEWER
  sessionId: 1a8e8eed-08a0-413f-8f03-7982b9d7279f
ownerRole: REVIEWER
role: REVIEWER
scope: [".cache/skill-verification/ (new fixture, tests, artifacts)", "read-only access to plugins/skills/skills/*.md and .cache/ux-skills-proof/node_modules"]
sessions:
  - sessionId: 1a8e8eed-08a0-413f-8f03-7982b9d7279f
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

A fresh reviewer executes the testable claims of canvas-test-bridge, property-based-domain-tests, visual-golden-tests, a11y-keyboard-audit and test-run-observability against a fixture, records command/output/exit code per claim, and names every mismatch. Maestro is out of scope (no Android target).

Migrated from .dsh/taskboard.json (task task-mw95rb6f-nrx2dg, revision 7).
