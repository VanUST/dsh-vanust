---
id: TASK-052
kind: task
title: "Sandboxed shell for read-only roles, artifact_write, and MCP placed by role"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.588Z
updatedAt: 2026-11-17T15:52:39.588Z
acceptance:
  - text: "Spike: with dsh-sandbox-local + dsh-bash-sandbox + dsh-sandbox-policy mounted and mode read-only, `ls`/`git log`/`rg` run and any file write is refused by the runner with its denial signature; workspace-write allows writes only inside the workspace and the harness temp root. Quote commands, outputs and exit codes"
    done: false
  - text: "The per-preset mode pin works (or the exact reason it cannot be pinned, with the alternative), proven on a second server: an orchestrator-preset session runs a read-only CLI and fails to write; a backend-preset session writes inside the workspace"
    done: false
  - text: "artifact_write exists and is available to orchestrator/research/docs only: it creates files under docs/ and .dsh/artifacts/, refuses other roots and can refuse overwrite without a prior read; both directions proven"
    done: false
  - text: "MCP placement: playwright MCP is available to the ux preset and NOT to reviewer/orchestrator/research, proven by a live child tool list; godot MCP has an explicit owner or is documented as host-wide with the reason"
    done: false
  - text: "Existing roles keep their working tools (backend can still run its CLI toolchain, reviewer can run tests); no role loses a capability silently"
    done: false
  - text: "make verify green, versions bumped and packed, deployment docs updated with the sandbox modes per role"
    done: false
boardId: task-mwapi1or-dbmfmp
nonScope: ["do not change the deployment-wide approval policy without asking", "do not move the kit's own provisioning (npm/pip installs) behind a write-confined role: installs stay a human/standard-preset action", "no changes to the taskboard, design-map, project-rules plugins", "no commits; the orchestrator integrates"]
scope: ["sandbox composition (dsh-sandbox-local, dsh-bash-sandbox, dsh-sandbox-policy) and the per-preset mode pin", "new plugin or tool for artifact_write", "profile/cordis.patch.yml: presets (bash/mode, artifact_write, MCP rows), mcp-servers.json and the home-layer MCP rows", "rules/DEPLOYMENT.md role capability table"]
---

Implement the approved role-capability design: give orchestrator and research a shell that can run CLIs but cannot change files (sandbox-enforced, not heuristic), add one narrow document channel (artifact_write) limited to docs/ and .dsh/artifacts/ for roles that legitimately produce design/results documents, and move the MCP servers into the role presets so the browser/RCE surface follows the role instead of the host. Prove each with a live session.

Migrated from .dsh/taskboard.json (task task-mwapi1or-dbmfmp, revision 3).
