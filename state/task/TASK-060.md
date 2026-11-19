---
id: TASK-060
kind: task
title: "Add the CRITIC role: adversarial general tester"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.686Z
updatedAt: 2026-11-17T15:52:39.686Z
acceptance:
  - text: "A seventh specialist preset `critic` exists next to ux/backend/research/reviewer/docs; it activates and its persona states the job (break it within the brief's constraints, report only, never fix, never touch production data or product code)"
    done: false
  - text: "delegate_task maps CRITIC / CRITIC-GENERAL / TESTER / QA to the critic preset; the role enum, PRESET_IDS, ROLE_PRESETS and the tool description say seven specialists, and a live child's header records agentPreset=critic"
    done: false
  - text: "The critic child's tool list has bash + filesystem (read/write for fixtures) + web + jobs + skills + taskboard, and NO browser: UI crash testing stays with UX/UI"
    done: false
  - text: "The live child can prove the role in one run: given a small service or algorithm, it produces a reproducible failure (exact command/fixture, observed failure, smallest input) or a clear 'could not break it, tried X, untested Y' report"
    done: false
  - text: "The orchestrator ROOT_POLICY role sentence and delegate_task error texts are updated from six to seven, docs (README/USERGUIDE/DEPLOYMENT) list the role, make verify green, versions bumped and packed"
    done: false
boardId: task-mwar6ny9-2j8za8
nonScope: ["no browser/MCP for this role (T7 decides the MCP placement; UI testing stays UX/UI)", "no changes to the reviewer role: reviewer judges a diff, critic attacks a running behaviour", "no sandbox/artifact_write work here (T7)", "no commits; no :3080 restart"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
ownerRole: BACKEND
role: BACKEND
scope: ["profile/cordis.patch.yml: the critic preset (persona + tool set) and the docs rows", "plugins/orchestrator/orchestrator.mjs: PRESET_IDS/ROLE_PRESETS (qa/tester -> critic, audit stays reviewer), role enum and the six->seven wording", "README.md, USERGUIDE.md, rules/DEPLOYMENT.md role table", "packed tarballs"]
sessions:
  - sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Add a general critic/adversarial tester as a seventh specialist role: an agent whose brief is to try to break the algorithm/service within the stated constraints, find realistic non-trivial inputs and sequences that crash, hang, corrupt state or return a wrong answer, and report reproducible failures without fixing anything or touching production data. It is deliberately separate from UX/UI testing (interfaces) and from the reviewer (judges a diff).

Migrated from .dsh/taskboard.json (task task-mwar6ny9-2j8za8, revision 6).
