---
id: TASK-072
kind: task
title: "Auto-converge the kit on every dsh boot"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.844Z
updatedAt: 2026-11-17T15:52:39.844Z
acceptance:
  - text: "Every `dsh` invocation from the shell runs the kit convergence before the harness boots: no server running -> kit-update --apply (no harness pin, no tool provisioning) runs, then the real dsh execs; a running `dsh web` process makes it skip with a clear line (never edit the profile patch under a live server)"
    done: false
  - text: "The machine's local model config survives convergence (the installed agent-default-model row, e.g. reasoningEffort high, is preserved) while every other profile change (new rows, personas, plugin versions) is applied"
    done: false
  - text: "PATH resolves `dsh` to the wrapper: `bash -lc 'which dsh'` shows ~/.npm/dsh/bin/dsh, and `dsh --version` still works (Node 24 pinned)"
    done: false
  - text: "install.sh recreates the wrapper and the PATH line on a fresh machine, so a reinstall keeps the behaviour; DSH_KIT_BOOT=0 disables it"
    done: false
  - text: "Proven: a fake home with an old profile converges (patch rows added, plugins installed, model config kept); a live-server case skips; docs describe the boot convergence"
    done: false
boardId: task-mwbv7r8a-pok877
nonScope: ["no changes to the harness package or the npx resolution (npx runs the package bin directly and cannot be intercepted; documented)", "no change to the plugin code or the canonical model config", "no commit of another chat's uncommitted files"]
scope: ["scripts/kit-update.mjs (a --keep-model-config flag)", "~/.npm/dsh/bin/dsh wrapper (the boot hook)", "~/.bashrc PATH order", "install.sh (wrapper creation)", "USERGUIDE/DEPLOYMENT docs"]
---

Make plain `dsh web` (and any dsh command) converge the machine on the kit automatically: install drifted plugin tarballs, apply the kit profile patch (rows, personas, plugins) while preserving the local model config, and skip safely when a server is already running - so panels and fixes land without start.sh or manual steps.

Migrated from .dsh/taskboard.json (task task-mwbv7r8a-pok877, revision 1).
