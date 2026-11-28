---
id: TASK-334
kind: task
title: "Independent acceptance: design map instruments and full-height editor"
status: done
revision: 6
createdAt: 2026-11-27T09:36:30.332Z
updatedAt: 2026-11-27T09:55:57.603Z
acceptance:
  - text: "Every criterion AC-1..AC-8 has a recorded case (case_record with criterionId AC-n, a real testPath and runCommand, linkedTaskId task-mwyr7f5u-b180jl) that you authored and ran; case_run records a green on the current tree and a red on the pre-fix product for the behaviour it covers."
    done: false
  - text: "Your verdict per criterion: pass or fail with the exact command, measured output and file:line where relevant; a criterion that cannot be verified is named as unverified with the reason, not glossed as pass."
    done: false
  - text: "No product file modified by you (git status shows only your tests/ and docs/cases/ additions); the live :3080 answered nothing you did."
    done: false
  - text: "Report lists any defect you found with the smallest reproduction, or states what remains untested."
    done: false
boardId: task-mwyse8mz-z1b3nm
nonScope: ["editing any file under plugins/, profile/, rules/, docs/ (except docs/cases/), state/", "reinstalling or restarting the live :3080 server", "committing or pushing"]
owner:
  kind: agent
  label: TESTER
  sessionId: 6e566b2b-f7cb-40f5-bd09-6f627650af83
preset: tester
reqIds: [REQ-251, REQ-252, REQ-253, REQ-254, REQ-255]
role: TESTER
scope: ["read and run anything under /home/iustimov/dsh-kit", "write new drivers under tests/designmap-instruments/ (NOT named *.test.mjs, so `make test` stays runnable without a browser/server)", "record cases in docs/cases via case_record and run them via case_run", "start a temporary second dsh server on a free port for the browser criteria, then stop it and remove its session/profile"]
sessions:
  - sessionId: 6e566b2b-f7cb-40f5-bd09-6f627650af83
    label: TESTER
    role: TESTER
    status: sleeping
---

Independently verify the finished design-map change on the current tree in /home/iustimov/dsh-kit, and record ONE acceptable acceptance case per TASK-333 criterion (AC-1..AC-8) so the orchestrator can close the task. Derive the expected behaviour from the criteria text, not from the orchestrator's own tests: write your own drivers where the existing tests would be self-verification, run them, measure a red on the pre-fix sources, and report a verdict per criterion with evidence. Do not edit product code: your write scope is tests/, test/ and docs/cases/ only; a defect goes back as a finding, not a patch.
