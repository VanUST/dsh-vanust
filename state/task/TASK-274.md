---
id: TASK-274
kind: task
title: "Hindsight starts with dsh web; harness pin is enforced"
status: open
revision: 1
createdAt: 2026-11-22T07:44:20.144Z
updatedAt: 2026-11-22T07:44:20.144Z
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
steps: ["Diagnose Hindsight daemon and harness pin", "Add Hindsight autostart and harness pin sync to the Windows wrapper", "Reinstall wrapper; verify daemon start is detached and Hindsight tools recover", "Run checks and record evidence"]
stepsDone: 0
---

Make the Windows launcher start the local Hindsight daemon when it is installed but not listening, detached from the server process tree, and make dsh web compare the installed harness with the kit pin and converge on a mismatch. The daemon had died and the Run key only covered logon, so every hindsight_* tool refused until it was restarted by hand.
