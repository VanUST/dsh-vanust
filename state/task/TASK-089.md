---
id: TASK-089
kind: task
title: "Long job state probe"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.105Z
updatedAt: 2026-11-17T15:52:40.105Z
acceptance:
  - text: "reports the job id"
    done: false
boardId: task-mwc2z8j6-afuis0
owner:
  kind: agent
  label: BACKEND
  sessionId: a074e0fa-62f2-4c1c-aaf0-cf300baba0cb
ownerRole: BACKEND
preset: backend
resultEvidence: ["Child start line: bash -> 'started background job bash-926fabba758b43a9' (job id issued at launch)", "Poll 1 (job_output, no wait): 'tick 1 15:14:12 ... tick 5 15:14:52', '[status: running]'", "Poll 2 (job_output, wait 30000 ms): 'tick 6 15:15:02', 'PROBE_DONE', '[status: completed, exit code: 0]'", "job_list: 'bash-926fabba758b43a9 [bash] completed' — same job id as the launch", "task_get task-mwc2z8j6-afuis0 revision 6: child session a074e0fa-62f2-4c1c-aaf0-cf300baba0cb recorded as completed, started 12:14:06Z, ended 12:15:26Z"]
resultSummary: "One managed background job was started and polled to a terminal state: job id bash-926fabba758b43a9, completed with exit code 0 after ~60 s. The launch → poll → terminal-state loop works: a no-wait job_output read returns partial output plus [status: running], and a follow-up job_output with wait=30000 returns the tail plus [status: completed, exit code: 0]. Deviation from the brief: the child ran an instrumented 6×10 s tick loop instead of a bare `sleep 45`. The job semantics under test (background start, job id, polling, exit code) are the same, but the evidence covers a ~60 s loop with visible progress, not literally a silent 45 s sleep. Child also created an empty reports/job-probe/ directory as a side effect; no files were written."
role: BACKEND
sessions:
  - sessionId: a074e0fa-62f2-4c1c-aaf0-cf300baba0cb
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Run a managed background job and report it

Migrated from .dsh/taskboard.json (task task-mwc2z8j6-afuis0, revision 8).
