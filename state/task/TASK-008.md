---
id: TASK-008
kind: task
title: "Adversarial review of the RTK, skill-evolve, babysitter and headroom integrations"
status: done
revision: 2
createdAt: 2026-11-17T15:52:39.043Z
updatedAt: 2026-11-17T15:52:39.043Z
acceptance:
  - text: "At least one finding per file reviewed, or an explicit statement that the file has none."
    done: false
  - text: "Every finding names severity, file:line, why it matters, and the exact command that demonstrates it (or says it was found by reading and why a command is not possible)."
    done: false
  - text: "At least three findings that the implementation's own author did not advertise — duplicated work is not review."
    done: false
  - text: "The report states what you could NOT test and why, rather than implying coverage."
    done: false
  - text: "No file in the repository is modified (verify with `git status --short` and say so)."
    done: false
boardId: task-mvp5zvtr-dxba2c
nonScope: ["Changing any file — review only. Report findings; the orchestrator fixes them.", "Running the kit's gate, the real GUI, or anything that installs packages", "Reviewing plugins other than the four named (proof-guard, notify, taskboard etc. are out of scope and were not written today)", "Reviewing the upstream projects themselves — only this repository's integration code", "Git operations of any kind"]
owner:
  kind: agent
  label: REVIEWER
  sessionId: 32c5a873-5148-47bb-951c-cd1a6d1c9239
ownerRole: REVIEWER
role: REVIEWER
scope: ["plugins/rtk/rtk.mjs and scripts/rtk-selftest.mjs", plugins/skill-evolve/skill-evolve.mjs, "plugins/babysitter/babysitter.mjs and scripts/babysitter-selftest.mjs", scripts/headroom.mjs, "the start.sh diff and profile/headroom.patch.yml", "Running read-only commands and scratch scripts under /tmp to prove a defect"]
sessions:
  - sessionId: 32c5a873-5148-47bb-951c-cd1a6d1c9239
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

Adversarial code review of today's four integrations in /home/iustimov/dsh-kit: find the bugs an author misses. Target real defects, not style preferences: wrong behaviour at a seam, corrupt or lost data, a hang, a false success, a security hole, a portability break, or a claim in a comment that the code does not keep. Exercise corner cases with commands where you can, and report each finding with severity, exact location, why it matters, and the command that demonstrates it. You are the second pair of eyes before this is committed and pushed.

Migrated from .dsh/taskboard.json (task task-mvp5zvtr-dxba2c, revision 6).
