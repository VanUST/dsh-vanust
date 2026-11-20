---
id: TASK-253
kind: task
title: "Пресет presenter: роль, профиль, политика инструментов, документы"
status: done
revision: 3
createdAt: 2026-11-20T09:16:39.359Z
updatedAt: 2026-11-20T09:53:33.310Z
acceptance:
  - text: "пресет presenter виден в списке композиции второго сервера"
    done: false
  - text: "delegate_task принимает роль PRESENTER"
    done: false
  - text: "make verify печатает 17/17 и называет preset-presenter"
    done: false
  - text: "заголовок ребёнка presenter в бюджете и без лишних семейств"
    done: false
boardId: task-mworls9w-6l6lez
inline: true
nonScope: ["код рендерера (отдельная задача)", "перезапуск :3080"]
reqIds: [REQ-155, REQ-158, REQ-161]
resultArtifacts: [profile/cordis.patch.yml, plugins/orchestrator/orchestrator.mjs, plugins/diagrams/index.js, rules/DEPLOYMENT.md, README.md, USERGUIDE.md]
resultEvidence: ["второй сервер на 3081 (изолированный DSH_HOME): в выборе композиции Presentation maker стоит между UX/UI и Backend; снимок reports/presenter-proof/preset-menu.png", "node scripts/tool-families-proof.mjs -> 105/105: presenter kept=32 из allow-листа 22 записи (playwright — семейство), godot и hindsight вырезаны", "make verify -> exit 0, 18/18 portability, documentation ok, preset-presenter назван в процедуре", "заголовок второга сервера на сессии presenter: 1 инструмент (run_code, режим PTC) — заголовок в бюджете 2"]
resultSummary: "Пресет presenter (роль Presentation maker, order 25) объявлен и доведён до гейтов: строка хоста плагина, allow-лист и бюджет в tool-families, роль в оркестраторе с написаниями PRESENTER/presentation/slides, diagram разрешён новой роли, правила и README/USERGUIDE обновлены, плагины переупакованы."
scope: [profile/cordis.patch.yml, "plugins/orchestrator/**", plugins/diagrams/index.js, "plugins/tool-families/**", scripts/context-budget.mjs, scripts/tool-families-proof.mjs, rules/DEPLOYMENT.md, README.md, USERGUIDE.md, NOTICE, start.sh, start.ps1]
steps: ["Объявить preset-presenter в profile/cordis.patch.yml", "Добавить строку хоста плагина presentation и строку tool-families с бюджетом", "Дописать роль в orchestrator.mjs и разрешить diagram новой роли", "Обновить правила, README, USERGUIDE и списки гейтов", "Переупаковать затронутые плагины и прогнать make verify"]
stepsDone: 5
---

Объявить в ките пресет presenter (роль Presentation maker, order 25): persona и набор плагинов, строка хоста для плагина presentation, allow-лист и бюджет в tool-families, запись роли в оркестраторе, разрешение diagram для новой роли, правки правил, README, USERGUIDE и гейтов (context-budget, tool-families-proof, check-portability), переупаковка затронутых плагинов.
