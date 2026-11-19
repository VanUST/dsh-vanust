---
id: TASK-075
kind: task
title: "Integrate Serena and Octocode"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.887Z
updatedAt: 2026-11-17T15:52:39.887Z
acceptance:
  - text: "Both MCP servers are represented in kit-owned configuration with pinned versions and the same cache-stable tool set available to every role."
    done: false
  - text: "Provisioning installs or reports both tools portably and verifies release checksums where available."
    done: false
  - text: "Serena exposes only the agreed symbolic read surface and Octocode does not enable its LSP or write operations by default."
    done: false
  - text: "Agent-facing routing distinguishes exact grep/glob, conceptual retrieval, symbolic navigation and graph queries without dynamic prompt churn."
    done: false
  - text: "Compose checks and real server calls prove the tools work on /home/iustimov/dsh-kit; commands, outputs and exit codes are recorded."
    done: false
  - text: "make verify passes or any pre-existing failure is precisely identified."
    done: false
boardId: task-mwbw9fmt-speqo9
nonScope: ["Do not edit the installed $DSH_HOME profile or restart :3080; proof uses an overlay/second instance.", "Do not add automated test files; prove by composing and running the actual MCP servers.", "Do not integrate Probe, other Octocode projects, Serena memory/edit/shell tools, or Octocode LSP tools.", "Do not change unrelated plugins or taskboard history."]
owner:
  kind: agent
  label: BACKEND
  sessionId: 913d5bfc-967b-4ad7-b79e-16f378fa25a8
ownerRole: BACKEND
preset: backend
role: BACKEND
scope: [plugins/, profile/cordis.patch.yml, scripts/provision-tools.mjs, "scripts/dsh-mcp-sync.mjs and directly related checks/docs", "reports/code-search/ for integration evidence"]
sessions:
  - sessionId: 913d5bfc-967b-4ad7-b79e-16f378fa25a8
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Deliver a portable dsh-kit integration for Serena symbolic navigation and Muvon Octocode semantic/AST/graph retrieval as a COMMON capability for every role, using repository-aware MCP composition, pinned provisioning, bounded read-only defaults, and explicit agent routing. The live :3080 profile must remain untouched until integration and benchmark evidence are reviewed.

Migrated from .dsh/taskboard.json (task task-mwbw9fmt-speqo9, revision 9).
