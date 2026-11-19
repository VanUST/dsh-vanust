---
id: TASK-040
kind: task
title: "Live system-design map both the agent and the human edit"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.441Z
updatedAt: 2026-11-17T15:52:39.441Z
acceptance:
  - text: "The agent can create and update the map through a tool; the human can move/rename/add nodes in the browser and the change is written back to the project-root file"
    done: false
  - text: "Round-trip proven in a real browser (Playwright) and by reading the file after the edit"
    done: false
  - text: "The map renders legibly at a normal laptop viewport; a stale map is detectable (timestamp/version) so the orchestrator knows it must refresh it"
    done: false
boardId: task-mwan6nnm-gskkd2
nonScope: ["the existing diagrams plugin's render contract unless reuse is chosen and then it is an extension", "the git history of the map via a second store"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 107c5201-38c5-4577-8555-f359da86ffc7
ownerRole: BACKEND
role: BACKEND
scope: ["new plugin under plugins/ (host tool + optional client panel)", "the map file format and its location in the project root", profile/cordis.patch.yml, docs]
sessions:
  - sessionId: 107c5201-38c5-4577-8555-f359da86ffc7
    label: BACKEND
    role: BACKEND
    status: sleeping
---

A persistent map in the project root that shows the current architecture/algorithm, readable and editable by the agent (JSON/graph through a tool) and by the human visually, and that the orchestrator updates whenever the design changes. Decided against a dead-end tech first: the research child evaluates Excalidraw/tldraw/JSON+SVG and the recommendation is justified by how edits are persisted through the harness.

Migrated from .dsh/taskboard.json (task task-mwan6nnm-gskkd2, revision 15).
