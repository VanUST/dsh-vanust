---
id: TASK-116
kind: task
title: "Remove shell bypass from live orchestrator"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.481Z
updatedAt: 2026-11-17T15:52:40.481Z
acceptance:
  - text: "Live/isolated fresh orchestrator header has write/edit but 0 bash and 0 pwsh tools."
    done: false
  - text: "Host policy remains consistent: orchestrator cannot execute shell, and a new chat gets the corrected surface."
    done: false
  - text: "No other preset or Hindsight/cross-chat behavior changes."
    done: false
  - text: "Exact proof command/output and next-boot requirement reported; probe cleanup."
    done: false
boardId: task-mwewxkqs-03d6ag
nonScope: ["Не менять write/edit, Playwright, Hindsight или другие роли.", "Не добавлять shell оркестратору.", "Не останавливать :3080; если нужен restart, только сообщить."]
owner:
  kind: agent
  label: BACKEND
  sessionId: df2a7125-9152-4106-9d22-c4f180fc00f7
ownerRole: BACKEND
preset: backend
resultArtifacts: [profile/cordis.patch.yml, docs/cases/orchestrator-header-carries-no-shell-tools.json]
resultEvidence: ["Live red header session-ed90220d seq 1502: 98 tools, bash=true, pwsh=false, write/edit/read=true.", "node /tmp/proof-tool-families.mjs: BEFORE surface 98 bash=true; AFTER deny=['bash'] surface 97 bash=false; write/edit/read remain; ux/backend/reviewer/critic/research/docs identical before/after.", "profile/cordis.patch.yml:272 orchestrator deny ['mcp__godot__*','bash','pwsh']; make verify 17/17 + documentation ok; kit-update --check plans write-profile-files only; :3080 untouched, probe stopped."]
resultSummary: "Остаточный shell-разрыв закрыт в kit: orchestrator tool-families deny теперь `['mcp__godot__*','bash','pwsh']`. Live header был 98 tools с bash; decision proof на реальных 98 именах даёт 97 tools, write/edit/read сохранены, bash удалён; остальные preset deny lists не изменены. Нужен следующий boot для применения профиля; :3080 не трогали."
role: BACKEND
scope: ["profile/cordis.patch.yml tool-families orchestrator deny", "targeted proof fresh orchestrator request/header", "pack/install/kit-update and docs/case if needed"]
---

На live 0.2.2 orchestrator в request/header всё ещё виден host-global `bash` (и потенциально `pwsh`), хотя политика говорит, что shell у оркестратора нет. Закрыть этот разрыв через preset-aware tool-families: у orchestrator должны остаться read/write/edit и разрешённые families, но не должно быть bash/pwsh; проверить fresh header, установить kit reproducibly и назвать необходимость следующего boot, если HMR не применяет изменения.

Migrated from .dsh/taskboard.json (task task-mwewxkqs-03d6ag, revision 8).
