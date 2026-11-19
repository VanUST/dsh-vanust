---
id: TASK-110
kind: task
title: "Preset-контекст и DSH 0.2.2"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.398Z
updatedAt: 2026-11-17T15:52:40.398Z
acceptance:
  - text: "Preset policy реально убирает MCP schemas из fresh request/header на втором сервере: Playwright только standard/orchestrator/ux; Godot только standard и backend/ux/reviewer/critic в Godot project workspace; research/docs без MCP; Hindsight сохранён."
    done: false
  - text: "Hindsight child tools работают без disabled; automatic recall/write-back root-only. Cadence и test-case prompt сохранены."
    done: false
  - text: "Skill catalog: все 70 описаний <=250, write-path skill-evolve тоже <=250; bodies не изменены, без массового archiving."
    done: false
  - text: "DSH 0.2.2-rc.3: migration code + реальная delegation на изолированном 0.2.2 проходит до первого успешного request; preset tools корректны."
    done: false
  - text: "НОВОЕ по требованию владельца: fresh orchestrator видит write/edit в request/header и реально создаёт+редактирует fixture; bash остаётся недоступен; persona/description/docs больше не обещают read-only."
    done: false
  - text: "Существующие kit gates и targeted proofs зелёные; второй сервер остановлен и probes/fixtures удалены."
    done: false
  - text: "СРОЧНОЕ maxTasks=0 и maxRows отдельный guard сохранены с 13/13 proof."
    done: false
  - text: "Live :3080 не перезапущен; любые непроверенные live effects названы."
    done: false
boardId: task-mwesykjl-raw3t1
nonScope: ["Ровно один BACKEND-специалист разрешён пользователем; не запускать дополнительных children/workflow fan-out.", "Не менять Kimi capabilities, image-window и не запускать свежий corpus/A/B measurement.", "Не обновлять live harness вслепую: сначала backup, compatibility review и изолированная проверка; :3080 не останавливать без отдельного подтверждения.", "Не отключать или скрывать Hindsight tools у subagents; automatic recall/write-back не должны дублировать root."]
owner:
  kind: agent
  label: BACKEND
ownerRole: BACKEND
preset: backend
resultArtifacts: [plugins/tool-families, plugins/orchestrator/orchestrator.mjs, plugins/taskboard/taskboard.mjs, plugins/test-cases/test-cases.mjs, plugins/session-budget/session-budget.mjs, plugins/skill-evolve/skill-evolve.mjs, profile/cordis.patch.yml, scripts/dsh-migration-proof.mjs, scripts/tool-families-proof.mjs, scripts/taskboard-limit-proof.mjs, scripts/hindsight-subagent-tools.mjs]
resultEvidence: ["Fresh headers on second 0.2.1 server: orchestrator 80 tools (write/edit true, bash false, Playwright 24, Godot 0, Hindsight 8); research 52 tools (0 MCP, Hindsight 8); tool-families log applied 30 denies.", "0.2.2 isolated real delegation: pending child a1963888 created with agent-preset backend, 53-tool header, deepseek-flash, replied CHILD-OK; parent task_get×2 + task_close ok; no startActivation/route error.", "Migration proof scripts/dsh-migration-proof.mjs 16/16 green, 7/13 red on HEAD; startActivation has both shapes; flash-guard refuses and never mutates; session-budget uses awaited handle with fallback.", "taskboard-limit-proof 13/13 green, 8/13 red; maxTasks 0 accepts 210+ actionable rows and maxRows remains separate guard.", "Hindsight probe: unpatched 48-char disabled response -> patched 9414 chars real bank pages; hooks stay root-only; kit-update re-applies pinned patch.", "Skills: 70 descriptions max 249, 9 trimmed above 250; bodies byte-verified; skill-evolve write cap 250.", "Cases verified: orchestrator-can-write-files, preset-aware-mcp-tool-families-leave-the-header, hindsight-works-in-subagents, disable-taskboard-actionable-cap; documentation ok, portability 17/17.", "Global harness installed at 0.2.2-rc.3; pins in install.sh/install.ps1 and provision-tools hook pins updated; :3080 was not stopped by the agents and now runs 0.2.2 after user restart."]
resultSummary: "Согласованная оптимизация и миграция завершены. Hindsight tools работают у subagents, automatic recall/write-back остаются root-only. Taskboard maxTasks=0 снял лимит 200 при сохранённом maxRows. Test-cases prompt соответствует выданным tools. Preset-aware tool-families удаляет Playwright/Godot schemas по роли и workspace, сохраняя Hindsight. Описания skills ограничены 250. Orchestrator получил write/edit без shell. DSH 0.2.2-rc.3: activationSpec dual-shape, flash-guard refuse-only, session-budget awaited handle; реальная delegation на 0.2.2 прошла, глобально установлен 0.2.2-rc.3. Отдельно найдена и закрыта причина UI-сбоя: harness заменили под работающим сервером; добавлен kit-update guard от повторения."
role: BACKEND
scope: ["plugins/** и profile/** для preset/tool/prompt changes", "Hindsight adapter/config для работы в subagents и refresh cadence", "skills/catalog configuration и test-cases prompt visibility", "DSH version pins, compatibility-sensitive kit files и upgrade proofs"]
sessions:
  - sessionId: e8f8ffa3-af0e-4640-9c1b-45d466a994a0
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Завершить согласованную оптимизацию dsh-kit и миграцию на DSH 0.2.2-rc.3. Уже доказанные taskboard/Hindsight/test-cases/cadence изменения сохранить; довести preset-aware MCP filtering, безопасное сокращение skill catalog и реальную delegation на новой версии. Hindsight read/search tools работают у subagents в bank их cwd; automatic recall/write-back остаются root-only, чтобы не дублировать расход.

Migrated from .dsh/taskboard.json (task task-mwesykjl-raw3t1, revision 24).
