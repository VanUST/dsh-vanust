---
id: TASK-062
kind: task
title: "Ownership boundaries: design map (orchestrator+human), rules (human only)"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.712Z
updatedAt: 2026-11-17T15:52:39.712Z
acceptance:
  - text: "The design_map TOOL is registered only for the orchestrator preset (gated on agent/created by header.agentPreset, like the other role tools); a backend/ux/reviewer child has no design_map tool, an orchestrator child does; the human panel path (/design-map command) still works"
    done: false
  - text: "Project rules are human-only: any agent write/edit of .dsh/rules.md is denied by a tools/pre-execute guard with a named code (rules_human_only), and a bash command targeting that path is denied by a command guard; the human panel save still works through the command"
    done: false
  - text: "The guard is documented as a guardrail, not a jail (bash can obfuscate a path), and the prompt/personas never offer to edit rules"
    done: false
  - text: "Proof: a backend child tries write/edit and a bash append on .dsh/rules.md and both are refused with the code; the same child has no design_map tool while an orchestrator session does; the human panel still saves; quoted commands and tool results"
    done: false
  - text: "make verify green, design-map and project-rules versions bumped and packed, docs updated"
    done: false
boardId: task-mwarnyhk-8tdhza
nonScope: ["no sandbox or MCP work (T7)", "no case-library tools (T11)", "no taskboard lifecycle changes (T9)", "no commits; no :3080 restart; no installed-patch edit while a server runs"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
ownerRole: BACKEND
role: BACKEND
scope: ["plugins/design-map/index.js (preset gate for the tool)", "plugins/project-rules/index.js (human-only guard on write/edit + bash path guard)", "README/USERGUIDE/DEPLOYMENT ownership table", "packed tarballs"]
sessions:
  - sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Enforce the three ownership boundaries the human set: the design map is editable only by the orchestrator and the human; project rules are editable only by the human; and the same 'who may change what' rule is visible in the docs. Close the two gaps verified on 2026-11-10: design_map is currently registered host-wide (no preset gate), and .dsh/rules.md can be edited by any agent through write/edit or bash.

Migrated from .dsh/taskboard.json (task task-mwarnyhk-8tdhza, revision 8).
