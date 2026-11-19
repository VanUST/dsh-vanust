---
id: TASK-109
kind: task
title: "Аудит токенов и контекста DSH"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.384Z
updatedAt: 2026-11-17T15:52:40.384Z
acceptance:
  - text: "Есть карта фактических механизмов DSH и отличий конфигурации dsh-kit."
    done: false
  - text: "Каждая существенная находка подтверждена текущим файлом/строкой, runtime inspection или логом."
    done: false
  - text: "Отдельно оценены input/cache stability, tool schemas/calls, dynamic prompt sections, images, compaction и parallel sessions."
    done: false
  - text: "Даны приоритизированные рекомендации с ожидаемым эффектом, риском и способом измерения."
    done: false
  - text: "Ограничения доступа к метрикам явно названы; никаких непроверенных процентов экономии."
    done: false
boardId: task-mweqjwt2-0sk20e
inline: true
nonScope: ["Не использовать субагентов или внешние agent runs — прямой запрет пользователя.", "Не менять плагины, профиль, пакеты, данные сессий и не перезапускать сервер — это read-only аудит.", "Не считать прошлые Hindsight claims текущими фактами без проверки по коду/логам."]
resultEvidence: ["Live cordis_inspect_query Tool.listTools: 129 schema names; полный formatted JSON 159364 bytes / 4188 lines; providers.js:49-52 подтверждает ctx.tools.schemas(context.agent).", "plugins/orchestrator/orchestrator.mjs:302-315,923-949 и plugins/project-rules/index.js:157-214 — per-turn cache-stable sections.", "/home/iustimov/.hindsight/coding-agents/dist/dsh.js:1705-1709,18717-18747,19121-19134 — default ~2KB guide каждый user-turn; subagent tools не имеют рабочего workspace.", ".cache/session-analysis/analysis2.json:61-104,156-249 — исторические tool-list sizes и фактические calls; Godot только 4 вызова в том корпусе.", "docs/CONTEXT-ECONOMY-DESIGN.md:322-352 и profile/cordis.patch.yml:295-324,519-970 — P1/P2/P3 в исходной композиции; plugin_manager подтвердил session-budget и run-code-projection active.", "Официальные DeepSeek Context Caching и Models & Pricing прочитаны 2026-11-13; GitHub releases показывает installed 0.2.1-rc.2 и доступный 0.2.2-rc.3."]
resultSummary: "Завершён самостоятельный read-only аудит без субагентов: проверены активная композиция, фактический tool surface текущего Agent, context/cache семантика установленного DSH 0.2.1-rc.2, пользовательские prompt/result/image плагины, Hindsight, skill catalog и сохранённые измерения корпуса. Найдены приоритетные источники расхода: 129 видимых tool schemas (30 Godot + 24 Playwright), отсутствие mid-conversation capabilities у Kimi, ежетурный ~2KB Hindsight guide и скрытые reflect/retain calls, целые replacement-каталоги skills, а также неточное допущение image-window о работе только на хвосте. Подтверждено, что per-turn freeze orchestrator/project-rules, append-only spill/projection, compaction 0.5/0.08 и session-budget уже работают в правильном направлении. Сформирован план измерений и безопасного rollout; рабочие файлы и конфигурация не изменены."
scope: [/home/iustimov/dsh-kit/plugins, /home/iustimov/dsh-kit/profile, /home/iustimov/dsh-kit/docs, /home/iustimov/dsh-kit/scripts/session, /home/iustimov/.npm/node/lib/node_modules/@deepseek-ai/dsh, "доступные session logs и read-only runtime inspection"]
---

Самостоятельно, без субагентов, проверить реальную стоимость контекста и кэширования в dsh-kit/DSH, найти источники перерасхода в плагинах и профиле, изучить встроенные механизмы оптимизации и подготовить доказательные приоритеты.

Migrated from .dsh/taskboard.json (task task-mweqjwt2-0sk20e, revision 4).
