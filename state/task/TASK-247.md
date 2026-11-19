---
id: TASK-247
kind: task
title: "Роль ARCHITECT: пресет, маршрут astra с фолбэком, границы секций промпта"
status: done
revision: 4
createdAt: 2026-11-19T08:24:16.894Z
updatedAt: 2026-11-19T09:07:15.148Z
acceptance:
  - text: "make verify зелёный: 17/17, documentation ok, все пресеты включая architect в таблице бюджетов"
    done: false
  - text: "замер context-budget: architect 10 инструментов / 10 551 B / 8 487 B / 3 884 B, OK; ни у одной из восьми прежних ролей значения не выросли"
    done: false
  - text: "тесты role-model: выбор primary без явного выбора, явный выбор не перезаписан, QUOTA -> fallback + retry, второго повтора нет, чужие коды и роли игнорируются (16/16)"
    done: false
  - text: "второй сервер (порт 3092, 3081 занят чужим процессом) поднимает пресет architect и запускает сессию на gpt-6.2-astra без ошибки"
    done: false
  - text: "headless-прогон с фейковым 429 usage limit НЕ ВЫПОЛНЕН: живой отказ QUOTA не воспроизводился, фолбэк доказан только тестами; остаток записан в риски"
    done: false
boardId: task-mwnaakvt-z1cbbg
inline: true
nonScope: ["перезапуск живого сервера :3080 (сессия владельца не должна умереть)", "снятие уже принятых решений codex-context-bounds FR-5/FR-6 (остаток квоты и цену не показываем)", "изменение пресетов ux/backend/research/gatherer/reviewer/critic/docs сверх гейта секций"]
reqIds: [REQ-139, REQ-140, REQ-141, REQ-142, REQ-143, REQ-144, REQ-145]
resultArtifacts: [plugins/role-model/role-model.mjs, profile/cordis.patch.yml, reports/architect-role/EVIDENCE.md, docs/analysis/architect-role-and-context-economy.json]
resultEvidence: ["make verify -> exit 0; 17/17 portability and packaging checks passed; documentation ok; every role preset is named in the procedure — 9 preset(s)", "node scripts/context-budget.mjs -> | architect | 10 | 15 | 12 | 10 551 | 8 487 | 3 884 | OK |; 1/9 presets within budget (было 0/8)", "сессия b47cea97-... на втором сервере: request/header config {\"provider\":\"openai-codex\",\"model\":\"gpt-6.2-astra\",\"reasoningEffort\":\"high\"}, contextWindow 272000; system prompt 8 487 B без секций Analysis/SKILLS/RTK/MCP", "node --test plugins/role-model/test/*.test.mjs -> 16/16; analysis 13/13; orchestrator 5/5; delegation-brief 7/7; rtk-selftest PASS; outline-selftest PASS", "reports/architect-role/3092-preset-menu.png (Architect между Orchestrator и UX/UI), 3092-architect-astra-composer.png (current GPT-6.2 Astra, effort High)"]
resultSummary: "Девятая роль ARCHITECT: минимальный пресет, маршрут gpt-6.2-astra с фолбэком на deepseek-flash/max, роль-гейтованные секции промпта и инструменты теперь следуют выбору пресета, а не только заголовку создания сессии. Измерено на изолированном втором сервере: первый запрос ARCHITECT — 10 инструментов, 10 551 B схемы, 8 487 B системного промпта, без каталога скиллов и без секции политики анализа; маршрут openai-codex/gpt-6.2-astra, усилие high. make verify зелёный (17/17, documentation ok, 9 пресетов)."
scope: [profile/cordis.patch.yml, "plugins/role-model (новый)", plugins/orchestrator/orchestrator.mjs, plugins/analysis/analysis.mjs, plugins/rtk/rtk.mjs, plugins/outline/outline.mjs, plugins/skill-evolve/skill-evolve.mjs, plugins/godot-mcp/godot-mcp.mjs, "rules/DEPLOYMENT.md, README.md, USERGUIDE.md, docs/TERMINOLOGY.md", "тарболы изменённых плагинов"]
steps: ["Написать плагин role-model (agent/created + agent/request-error) с тестом", "Объявить пресет architect, строку allow и бюджет в tool-families, маршрут astra в flash-guard, строку role-model", "Добавить architect в PRESET_IDS и ROLE_PRESETS оркестратора, обновить счётчики в текстах", "Гейт секций промпта по toolFamilies.allows() в пяти плагинах кита", "Научить роль-гейтованные регистрации следовать позднему выбору пресета (D-7) в восьми плагинах", "Обновить rules/DEPLOYMENT.md, README.md, USERGUIDE.md, docs/TERMINOLOGY.md, карту дизайна", "Перепаковать тарболы и прогнать make verify", "Поднять второй сервер на копии профиля, засесть роль ARCHITECT и замерить первый запрос", "Записать остаток: живой отказ QUOTA не воспроизводился, фолбэк доказан только тестами"]
stepsDone: 9
---

Сделать девятую роль ARCHITECT с минимальной поверхностью: пресет architect в profile/cordis.patch.yml без bash/web/write/edit/skill/analysis, строка allow и бюджет в tool-families, маршрут openai-codex/gpt-6.2-astra по умолчанию и фолбэк deepseek-official/deepseek-flash с усилием max по agent/request-error (новый плагин role-model, пакет @cc/dsh-role-model), роль в реестре оркестратора, и гейт секций промпта по toolFamilies.allows() в analysis, rtk, outline, skill-evolve, godot-mcp. Доказать замером context-budget до/после, тестами, make verify и вторым сервером :3081.
