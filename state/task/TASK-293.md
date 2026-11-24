---
id: TASK-293
kind: task
title: "Prove a child's rendered prompt from its session log, not from the profile"
status: done
revision: 6
createdAt: 2026-11-24T09:01:40.206Z
updatedAt: 2026-11-24T09:03:56.926Z
acceptance:
  - text: "the decoded session log of a delegated specialist child (delegationDepth 1, created after the 0.1.69 install) is located and named by path, session id, preset and createdAt"
    done: false
  - text: "the CHILD_POLICY acceptance bullet is quoted verbatim from that log's system/message event, not from the profile file"
    done: false
  - text: "the backend persona playbook block (its opening sentence and its False positive clause) is quoted verbatim from the same event"
    done: false
  - text: "if either string is absent, the report names which one, the event types actually present, and the reason — no substitute source quoted as if it were the log"
    done: false
boardId: task-mwugtw7q-xs9tw8
chore: true
choreReason: "Closing the last verification gap of the installed update: prove a specialist child's rendered system prompt from its own session log. No file changes."
nonScope: ["No file edits of any kind; no repack, no install, no kit-update, no restart of :3080", "No case recording and no taskboard writes beyond your own task", "Do not quote the profile, the plugin source or this brief as evidence — only the session log"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["log /home/iustimov/.npm/dsh/sessions/--home-iustimov-dsh-kit--/577b4152-6421-4edb-9a8b-fcd85bf3c6ef/session.v4.jsonl.zstd; header preset backend, delegationDepth 1, createdAt 2026-11-24T08:25:09.896Z", "system/message seq 9 at 2026-11-24T08:25:10.790Z, 38627 bytes: contains neither 'How your result is accepted' nor 'Your change is judged by the product's behaviour' — the pre-install control inside the same log", "system/message seq 1318 at 2026-11-24T08:57:11.827Z, 39902 bytes, decoded with scripts/session/session-log.mjs decodeSession (all zstd frames): contains both strings", "quoted verbatim from that event: '- **How your result is accepted.** The orchestrator owns acceptance and closes the task: …' and 'Your change is judged by the product's behaviour and the smallest complete diff. False positive: … False negative: …'", "scan: 1931 session logs, 205 depth-1 backend children, 0 depth-1 children of any preset created after the install mtime 2026-11-24T08:50:28.175Z", "read-only: only node --input-type=module heredocs; no file written, no restart, no kit-update"]
resultSummary: "The gap is closed from the artifact that matters: a specialist's rendered system prompt, taken from its own session log's system/message event, carries both new texts. The same log supplies the before/after pair — seq 9 at 08:25:10 (38 627 B) has neither string, seq 1318 at 08:57:11 (39 902 B) has both — so the change is measured inside one session rather than inferred. The brief's 'child created after the install' reading was unsatisfiable (0 depth-1 children of any preset created after the install mtime); the satisfied reading is 'render produced after the install'. Read-only throughout: no writes, no restart, no kit-update."
role: BACKEND
---

Close the last gap in the verification of the installed update: prove that a delegated specialist's RENDERED system prompt — as the harness actually sent it — carries the 0.1.69 specialist policy and its preset's playbook block. The artifact is the child's own session log: locate the newest session log under the harness home's sessions root whose decoded header has delegationDepth 1 and preset backend (a child started after the 0.1.69 install), decode it with the repo's multi-frame reader, take its first system/message event, and quote verbatim: (a) the bullet beginning 'How your result is accepted.' and (b) the backend block beginning 'Your change is judged by the product's behaviour' including its 'False positive:' clause. Report the session id, preset, delegationDepth, createdAt and the decoded byte length of that system message, and say plainly if either string is absent.
