---
id: TASK-185
kind: task
title: "Аудит всех не-дефолтных плагинов и PTC-совместимости"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.716Z
updatedAt: 2026-11-17T15:52:41.716Z
acceptance:
  - text: "Таблица: каждый не-дефолтный плагин — id/package, уровень, что делает, доказательство (команда + exit/итог), PTC-вердикт (ok/caveat/blocked) и причина"
    done: false
  - text: "Все доступные proof/селфтесты реально прогнаны; для каждого указан exit code и итоговая строка; провалы и отсутствующие доказательства названы пробелами, а не замолчаны"
    done: false
  - text: "Контекст-экономия проверена по числам: outline (94%/91%/95%), session-budget (пороги/счётчик), run-code-projection (проекция и границы), tool-families (таблица политики и lifecycle), компакция (0.5/0.08 в пресетах), headroom (не включён)"
    done: false
  - text: "Третьи стороны и MCP: перечислены фактические имена/семейства из шапок, проверено, что PTC-SDK их включает/исключает по политике; отдельно отмечены инструменты с побочными каналами и клиентские половины"
    done: false
  - text: "Список пробелов: что не имеет доказательства, что устарело, что не проверено на живой сессии; для каждого — следующий шаг одной строкой"
    done: false
  - text: "Отчёт reports/plugin-audit/FINDINGS.md; :3080 и :3081 не тронуты; никаких правок в репозитории"
    done: false
boardId: task-mwkll5uv-kvva07
nonScope: ["редактирование плагинов, профиля и доков — аудит только читает", "живой :3080 — не перезапускать", "второй сервер :3081 — занят другим специалистом, не поднимать", "kit-update --apply — не запускать"]
owner:
  kind: agent
  label: REVIEWER
  sessionId: aa15178d-c945-4bea-b0a7-0f875fafe38c
ownerRole: REVIEWER
preset: reviewer
resultEvidence: ["reports/plugin-audit/FINDINGS.md — матрица плагинов и прогоны proof", "reports/plugin-audit/ORCHESTRATOR-VERIFY.md — проверка PTC-SDK: 0 mcp__playwright в 54/59 ToolArgsMap, 24 в native-шапке", "reports/ptc-wave1/sessions/*/session.jsonl — SDK gatherer 54, reviewer 59, mcp__playwright 0", "reports/ptc-resume/sessions/*/session.jsonl — SDK после возобновления 54/59, mcp__playwright 0", "node scripts/outline-selftest.mjs 6/6; rtk-selftest 6; session-budget 15; run-code-projection 13; tool-families 59", "node scripts/babysitter-selftest.mjs exit 1 (шаг 7); node scripts/check-portability.mjs 16/17 (designmap)"]
resultSummary: "Аудит 24 кастомных плагинов, контекст-экономии, сторонних и MCP выполнен: 15 proof/селфтестов зелёные (outline 6/6, rtk 6/4.1 МБ, session-budget 15/15, run-code-projection 13/13, tool-families 59/59, analysis 130/130, компоновка 0.5/0.08), 1 красный (babysitter-selftest шаг 7), 9 плагинов без своего proof, check-portability 16/17 (designmap). Живой :3080 отстаёт от kit-профиля: нет outline и PTC-рядов, живая шапка 54 инструмента. Критическое утверждение аудита «24 mcp__playwright__* в PTC-SDK» проверено и отклонено: в ToolArgsMap PTC-сессий 0 таких имён, 24 — в native-шапке; подробности в reports/plugin-audit/ORCHESTRATOR-VERIFY.md."
role: REVIEWER
scope: ["plugins/inventory.json и plugins/*/ — 24 кастомных плагина кита", "profile/cordis.patch.yml и $DSH_HOME/profiles/web/cordis.patch.yml — какие не-дефолтные ряды реально смонтированы", "$DSH_HOME/cordis.patch.yml — MCP/hindsight/прочие хостовые ряды", "scripts/*proof*.mjs, plugins/*/proof/, scripts/outline-selftest.mjs, scripts/tool-families-proof.mjs", "docs/CONTEXT-ECONOMY-DESIGN.md и docs/PTC-MODE-ANALYSIS.md", reports/plugin-audit/FINDINGS.md]
sessions:
  - sessionId: aa15178d-c945-4bea-b0a7-0f875fafe38c
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

Провести независимую проверку ВСЕХ не-дефолтных плагинов харнесса: кастомные плагины кита (24), плагины экономии контекста (outline, session-budget, run-code-projection, rtk, image-window, tool-families, компакция), установленные сторонние плагины и MCP-серверы. Для каждого: что он регистрирует, каким доказательством это проверяется, что реально прошло, и совместим ли он с PTC. Вернуть таблицу и список пробелов.

Migrated from .dsh/taskboard.json (task task-mwkll5uv-kvva07, revision 7).
