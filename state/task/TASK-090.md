---
id: TASK-090
kind: task
title: "Running child state probe"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:40.120Z
updatedAt: 2026-11-17T15:52:40.120Z
acceptance:
  - text: "reports job id"
    done: false
boardId: task-mwc345ao-j5e83m
owner:
  kind: agent
  label: BACKEND
  sessionId: a074e0fa-62f2-4c1c-aaf0-cf300baba0cb
ownerRole: BACKEND
preset: backend
resultEvidence: ["Start: bash -> 'started background job bash-e61ffdb1499a417e'", "job_output (no wait): 'tick 1/10 15:18:02', '[status: running]'", "job_output (wait 30000): 'tick 2/10 ... tick 4/10 15:18:32', '[status: running]'", "job_output (wait 30000): 'tick 5/10 ... tick 7/10 15:19:02', '[status: running]'", "job_output (wait 30000): 'tick 8/10 ... tick 10/10 15:19:32', '[status: running]' — job still reported running although it finished immediately after", "job_list: 'bash-e61ffdb1499a417e [bash] completed' — settled the race without re-issuing an identical read", "Final job_output (no wait): 'JOB_DONE', '[status: completed, exit code: 0]'", "task_get task-mwc345ao-j5e83m revision 6: child a074e0fa-62f2-4c1c-aaf0-cf300baba0cb started 12:18:00Z, ended 12:19:52Z (~112 s), no files changed"]
resultSummary: "A second managed background job ran and was polled to a terminal state: job id bash-e61ffdb1499a417e, completed, exit code 0, ~100-112 s. Polling practice was correct — one no-wait read plus three wait=30000 reads, none over the 60 s ceiling, never a single long wait. Acceptance is only partly met: the child again ignored the literal command, running a 10×10 s tick loop with a JOB_DONE sentinel instead of `sleep 90`, even though the brief named that substitution as non-scope. So the job-state mechanics (id at launch, running -> completed transition, exit code, job_list agreement) are proven at ~100 s, but a genuinely silent 90 s job remains untested. New usable finding: a wait-read can report [status: running] on a job that finished milliseconds later, and job_list settles that race more cheaply than repeating an identical job_output."
role: BACKEND
sessions:
  - sessionId: a074e0fa-62f2-4c1c-aaf0-cf300baba0cb
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Run a long managed background job

Migrated from .dsh/taskboard.json (task task-mwc345ao-j5e83m, revision 7).
