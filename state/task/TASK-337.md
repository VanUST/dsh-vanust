---
id: TASK-337
kind: task
title: "Independent acceptance case: devops role and the one-live-deployment lane"
status: review
revision: 4
createdAt: 2026-11-27T11:09:22.754Z
updatedAt: 2026-11-27T11:19:12.023Z
acceptance:
  - text: "one automated case recorded with source agent (your preset), testPath, runCommand, checks and surfaceFiles"
    done: false
  - text: "case_run red against the HEAD copy records a real red (the guard/role/preset/effort assertion fails there) with a negative control"
    done: false
  - text: "case_run green on the current tree passes"
    done: false
  - text: "the project-state mirror produced a TEST row for the case (a red ref `<runId>:red:fail` and a green ref `<runId>:green:pass`), reported by id"
    done: false
  - text: "the case text names REQ-256..REQ-263 with REQ-257 as primary, and does not claim a verification you did not run"
    done: false
boardId: task-mwyvpo6b-q8dc4o
nonScope: ["product files", "the live :3080 server and its profile", commits, "the designmap work in flight"]
owner:
  kind: agent
  label: TESTER
  sessionId: 2b024beb-4447-4bfe-bbc1-0b042caa4a4b
preset: tester
reqIds: [REQ-256, REQ-257, REQ-258, REQ-259, REQ-260, REQ-261, REQ-262, REQ-263]
role: TESTER
scope: ["docs/cases/ (one JSON case + its driver under tests/)", "read the product modules and git HEAD copy", "run the driver red on the HEAD copy and green on the current tree"]
sessions:
  - sessionId: 2b024beb-4447-4bfe-bbc1-0b042caa4a4b
    label: TESTER
    role: TESTER
    status: sleeping
---

Author ONE automated acceptance case for the change the orchestrator just made inline in /home/iustimov/dsh-kit, and measure it red against the previous version (git HEAD, commit 7090829) and green against the current tree.

The change: a new devops preset/role that owns the running deployment, a one-live-devops-task refusal in delegate_task, the shared runtime added to the orchestrator's serialisation policy, High reasoning effort defaults, and development rules embedded in the root policy.

The case must exercise the REAL product modules, not restate their text:
1. profile/cordis.patch.yml declares the devops preset at order 35 and its tool-todo row carries the REQUIRED config allowParallelInProgress (a missing required config silently unmounts the whole preset: this is the defect that cost the first proof run).
2. presetForRole('DEVOPS') / ('DEPLOYMENT') / ('OPS') resolve to preset devops, and delegate_task accepts role DEVOPS without an explicit preset.
3. delegate_task refuses a second live devops task in the same chat: a fake taskboard row with preset devops and status active makes the call reject with devops_lane_busy naming the task, while no task row is created and no child is started; attaching to that task (taskId) is allowed; a BACKEND delegation is unaffected.
4. a delegated child is started with agentOptions.reasoningEffort 'high'.
5. ROOT_POLICY carries the runtime-lane rule and the Development rules block (assert the anchors, not the full prose).

The red must be real: copy the git HEAD tree into /tmp (hardlink or git archive) and run the same driver there — the guard, the role mapping, the preset row and the effort assertion must FAIL on HEAD. Use the previous version of plugins/orchestrator/orchestrator.mjs and of profile/cordis.patch.yml, not a hand-edited copy that already has the fix.
