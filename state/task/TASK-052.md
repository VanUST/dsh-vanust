---
id: TASK-052
kind: task
title: "Sandboxed shell for read-only roles, artifact_write, and MCP placed by role"
status: open
revision: 1
createdAt: 2026-11-17T15:52:39.588Z
updatedAt: 2026-11-17T15:52:39.588Z
boardId: task-mwapi1or-dbmfmp
---

Implement the approved role-capability design: give orchestrator and research a shell that can run CLIs but cannot change files (sandbox-enforced, not heuristic), add one narrow document channel (artifact_write) limited to docs/ and .dsh/artifacts/ for roles that legitimately produce design/results documents, and move the MCP servers into the role presets so the browser/RCE surface follows the role instead of the host. Prove each with a live session.

Migrated from .dsh/taskboard.json (task task-mwapi1or-dbmfmp, revision 3).
