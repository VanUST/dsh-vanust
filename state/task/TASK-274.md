---
id: TASK-274
kind: task
title: "Hindsight starts with dsh web; harness pin is enforced"
status: review
revision: 2
createdAt: 2026-11-22T07:44:20.144Z
updatedAt: 2026-11-22T07:45:52.834Z
acceptance:
  - text: "Hindsight daemon is running and /health reports healthy; hindsight_sync_status returns JSON instead of ECONNREFUSED"
    done: false
  - text: "dsh web starts the Hindsight launcher through WMI when port 18888 is closed and no start is in progress, without making the launch wait"
    done: false
  - text: "The installed harness version equals the install.ps1 pin (0.2.2-rc.3), and dsh web runs the full convergence when they differ"
    done: false
  - text: "check-portability and check-documentation pass"
    done: false
boardId: task-mwrj6rf2-n4qaed
chore: true
choreReason: "Operational reliability: an optional local service and the harness pin must be recovered by the same launch command the owner uses."
inline: true
resultArtifacts: [scripts/dsh-wrapper.ps1, "C:\\Users\\1\\.hindsight\\profiles\\coding-agent.log"]
resultEvidence: ["GET /health -> healthy, database connected", "hindsight_sync_status -> JSON bank github::VanUST/dsh-vanust", "dsh --version 0.2.2-rc.3 = install.ps1 pin", "wrapper autostart: WMI process, port 18888 up after 30 s, health healthy", "check-portability 19/19; check-documentation ok; test-all 73/73", "commit 82ca22e pushed e86d52f..82ca22e"]
resultSummary: "Hindsight was down: daemon not listening on 127.0.0.1:18888 (ECONNREFUSED). The Windows wrapper now starts ~/.hindsight/start-coding-agent.ps1 through WMI when the port is closed and no daemon-start is running, outside the server process tree. Harness installed 0.2.2-rc.3 equals the install.ps1 pin; a mismatch now runs full convergence before boot and warns when a live server is drifted."
steps: ["Diagnose Hindsight daemon and harness pin", "Add Hindsight autostart and harness pin sync to the Windows wrapper", "Reinstall wrapper; verify daemon start is detached and Hindsight tools recover", "Run checks and record evidence"]
stepsDone: 4
---

Make the Windows launcher start the local Hindsight daemon when it is installed but not listening, detached from the server process tree, and make dsh web compare the installed harness with the kit pin and converge on a mismatch. The daemon had died and the Run key only covered logon, so every hindsight_* tool refused until it was restarted by hand.
