---
id: TASK-181
kind: task
title: "tool-families: пресет из проекции и пересчёт при смене"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.635Z
updatedAt: 2026-11-17T15:52:41.635Z
boardId: task-mwkkohfa-fsuvk0
nonScope: ["profile/cordis.patch.yml — политика семейств не меняется", "живой :3080 — не трогать", "другие плагины"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 9f9ba103-cddd-4b9b-9a1c-14c648707ccc
ownerRole: BACKEND
preset: backend
resultEvidence: ["reports/ptc-resume/sessions/session-943b5cc4.raw/session.jsonl: header 67, playwright 0, godot 0, bash True", "reports/ptc-resume/dsh-3081-debug4.log: debug:selected preset=backend deny=24, applied", "node scripts/tool-families-proof.mjs → 62/62; --plugin old → 54/62 exit 1", "plugins/cc-dsh-tool-families-0.1.8.tgz; tar -xzOf + diff = identical", "node scripts/check-documentation.mjs → documentation ok; ss -ltn только :3080"]
resultSummary: "Фикс закрыт на втором сервере: выбор пресета слушается на ctx.root (session/event), restrict ставится в момент выбора; первый request/header backend — 67 инструментов, mcp__playwright__* 0, bash есть (было 91/24). Proof 62/62, старые байты 54/62 exit 1; tarball 0.1.8, tar=source; check-documentation зелёный; :3080 не тронут."
role: BACKEND
scope: [plugins/tool-families/tool-families.mjs, plugins/tool-families/README.md, plugins/tool-families/package.json, scripts/tool-families-proof.mjs, "plugins/cc-dsh-tool-families-*.tgz"]
---

Починить tool-families: брать пресет из проекции agentPreset, а не из начального заголовка сессии, и пересчитывать ограничение при смене пресета. Добавить в scripts/tool-families-proof.mjs проверку жизненного цикла (создание под orchestrator, затем pre-step под backend → restrict с backend deny), перепаковать плагин и доказать.

Migrated from .dsh/taskboard.json (task task-mwkkohfa-fsuvk0, revision 10).
