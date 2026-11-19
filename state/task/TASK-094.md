---
id: TASK-094
kind: task
title: "Test cases panel proof, round 2"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:40.172Z
updatedAt: 2026-11-17T15:52:40.172Z
acceptance:
  - text: "Panel reachable at http://127.0.0.1:3082 and shows this workspace's cases"
    done: false
  - text: "Each of the four owner requirements judged visible/absent with a screenshot path"
    done: false
  - text: "Console and failed-network evidence captured"
    done: false
  - text: "Verdict recorded on the taskboard with concrete evidence, defects delegated rather than patched"
    done: false
boardId: task-mwc63eg6-qa5b47
inline: true
nonScope: ["Editing plugins/test-cases or plugins/taskboard source (a UX/UI child owns fixes)", "Restarting or touching the :3080 install", "Running make verify or repacking"]
scope: ["reports/test-cases-panel/ proof artifacts and screenshots", "docs/cases/ case evidence for the four owner requirements"]
---

Prove the Test cases panel in the real running GUI (:3082) after the usability fix: list rows carry an explicit status label, a terminal case can be removed through the host with confirmation, the detail pane can be collapsed/restored, long detail content scrolls, and the prior 22 checks still hold. Record what is observed with screenshots and console/network evidence; do not change plugin source in this task.

Migrated from .dsh/taskboard.json (task task-mwc63eg6-qa5b47, revision 2).
