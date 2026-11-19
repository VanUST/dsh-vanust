---
id: TASK-039
kind: task
title: "Role presets: orchestrator + 5 specialists with isolated tools and prompts"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.427Z
updatedAt: 2026-11-17T15:52:39.427Z
acceptance:
  - text: "Six presets exist and activate; plugin_manager list_plugins shows each preset row enabled without diagnostics"
    done: false
  - text: "The orchestrator preset's tool list contains no bash/pwsh/fs-write/edit tool"
    done: false
  - text: "A child started for each role reports the role's expected tools and none of the other roles' role-specific tools"
    done: false
  - text: "The orchestrator's delegate tool exposes the role choice and creates the taskboard task with the role recorded"
    done: false
  - text: "Proven by running: the preset rows and one live child per role quoted from the harness"
    done: false
  - text: "Kit checks pass; docs updated; version bumped and repacked"
    done: false
boardId: task-mwan6nl0-vik1oe
nonScope: ["deleting the shipped standard/ptc/minimal presets", "changing the harness packages", "any UI work in the Harness GUI bundle"]
resultEvidence: ["dsh --profile web --dump-config: six preset rows (orchestrator order 10 ... docs order 60), registry default=orchestrator, orchestrator tool-fs {write:false, edit:false}, research {edit:false}, reviewer {write:false, edit:false}", "Live :3081 plain new chat (default preset): header agentPreset=orchestrator; the model listed its tools and answered 'bash, write and edit are not among them'", "REVIEWER child (header agentPreset=reviewer, f8e38bf9): 63 tools, bash present, write/edit absent, pwd exit 0", "RESEARCH child (header agentPreset=research, 4f5fb131, newly created after the reuse fix): no bash/shell tool, no edit, papers_* present, papers_trending(limit=1) returned a paper", "BACKEND child (header agentPreset=backend, 41827c60): full shell, write/edit present, no papers_*", "delegate_task result on :3081: role RESEARCH, preset research, 'newly created - the workspace's older RESEARCH session predates the preset composition, so it was not reused'", "/tmp/preset-reuse-probe.mjs: 12/12 PASS (reuse decision, pre-preset rows, notes, catalog, row preset storage and history)", "make verify: 17/17 portability + documentation ok (22 mounted plugins, 6 presets documented)"]
resultSummary: "Six role presets ship and are the tool surface: orchestrator (default, no bash/write/edit), ux, backend, research (no shell), reviewer (read-only), docs. delegate_task routes a role to its preset via agentPreset and refuses a provider that cannot select one; a role session is reused only when its recorded preset matches, so an old composition is re-created instead of being handed a brief it cannot perform. Kit tools are gated by the recorded preset (papers=research, babysitter=orchestrator, diagram/presentation=orchestrator+ux). Proven on a live second server with a default orchestrator chat and fresh BACKEND/RESEARCH/REVIEWER children whose headers, tool lists and behaviour match the declarations; make verify green. Commits 5bf3dba (presets + gates) and 3768de6 (reuse contract, docs, checks)."
scope: ["new preset bundle(s) under plugins/ or a new roles bundle", profile/cordis.patch.yml, plugins/orchestrator/orchestrator.mjs, "rules/ and USERGUIDE.md documentation", "scripts/pack-plugin.mjs outputs"]
---

Each role is a first-class agent preset: own persona/prompt and only the tool set it needs. Orchestrator is the root of every chat, owns system design and the board, is the only one that picks a role for a task, and has no code-mutating tools at all. Specialists (UX/UI designer-tester, backend, researcher, documenter, reviewer) each get their role tools plus a shared common set. Delegation carries the role as a preset (agentPreset/allowedAgentPresets), so isolation is structural, not a prompt promise.

Migrated from .dsh/taskboard.json (task task-mwan6nl0-vik1oe, revision 6).
