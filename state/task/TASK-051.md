---
id: TASK-051
kind: task
title: "Project rules editor: one cached prompt section, edited from the client"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.573Z
updatedAt: 2026-11-17T15:52:39.573Z
acceptance:
  - text: "A client panel opens from the sidebar, shows the workspace rules file in a plain editable text area, saves via a host command, reloads, and shows dirty/byte state; saving writes exactly what the human typed (no generated header, no timestamps)"
    done: false
  - text: "Every agent and subagent in the workspace receives the rules as a prompt section placed at a fixed order; a child session's system prompt is shown to contain the text"
    done: false
  - text: "CACHE CONTRACT, measured: two turns with no edit produce exactly one system re-render per turn (not per step); an edit saved mid-turn produces ZERO re-renders in that turn; the following turn produces exactly ONE; untouched turns read the prefix from cache (cacheReadTokens high, inputTokens small). Quote counts from the session log with the jq one-liners from the audit skill"
    done: false
  - text: "The section text is byte-identical across steps of a turn and across turns without a file change (freezePerTurn + keep the old string when bytes are unchanged)"
    done: false
  - text: "No volatile content in the section (no counters, timestamps, lengths, role lists); an empty file adds no section"
    done: false
  - text: "Second server on :3081 via a --patch overlay proves it; make verify green; version bumped and packed"
    done: false
boardId: task-mwapi1jg-77vfa8
nonScope: ["no change to the orchestrator policy section or its freeze (it already freezes per turn)", "no new prompt sections beyond the single rules one", "no git-tracked file is chosen without asking: use .dsh/rules.md (gitignored) unless the orchestrator says otherwise", "no server restart of :3080; do not edit the installed profile patch while it runs"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 107c5201-38c5-4577-8555-f359da86ffc7
ownerRole: BACKEND
role: BACKEND
scope: ["new plugin under plugins/project-rules/ (host section + service + /project-rules command, client panel)", "profile/cordis.patch.yml (one insert row)", "docs and one new skill entry if the cache procedure generalises"]
sessions:
  - sessionId: 107c5201-38c5-4577-8555-f359da86ffc7
    label: BACKEND
    role: BACKEND
    status: sleeping
---

A client-side text editor for workspace-local rules that become one system-prompt section for every agent and subagent in the workspace, built so editing is cache-safe: typing never touches the model prompt, a save applies at the next turn's boundary, and the section text stays byte-identical within a turn and across untouched turns. Prove the cache behaviour by counting system re-renders and cache reads in a real session log.

Migrated from .dsh/taskboard.json (task task-mwapi1jg-77vfa8, revision 11).
