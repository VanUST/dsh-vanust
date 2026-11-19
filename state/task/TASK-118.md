---
id: TASK-118
kind: task
title: "Исследовать API analysis-контура"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.507Z
updatedAt: 2026-11-17T15:52:40.507Z
acceptance:
  - text: "Названы точные текущие API и файлы/строки, на которых должна строиться реализация"
    done: false
  - text: "Дана минимальная схема данных и правила L0/L1/L2 без второго источника истины"
    done: false
  - text: "Описаны gate semantics, включая отсутствие регресса для существующих задач и мелких изменений"
    done: false
  - text: "Даны 4–6 проверок, которые реально могут упасть, с ожидаемым red до реализации"
    done: false
  - text: "Явно названы риски второго сервера и недопустимость writes в чужие :3080 sessions"
    done: false
boardId: task-mwf3kd2x-gndvuo
nonScope: ["Не изменять файлы, профиль, taskboard или cases: исследование read-only", "Не запускать/перезапускать :3080 и не менять установленные пакеты", "Не реализовывать plugin и не создавать тестовый сервер — это отдельная backend-задача"]
owner:
  kind: agent
  label: RESEARCH
  sessionId: 0edcc4af-c41c-465b-9162-cc5702c9dbb2
ownerRole: RESEARCH
preset: research
resultEvidence: ["Read-only closing report RESEARCH: docs/cookbook/adding-a-tool.md, dsh-tools register/guard contracts, orchestrator.mjs:646–823/1009–1071, taskboard.mjs:1647/1840–1887, design-map/index.js:446–450/700–721, profile/cordis.patch.yml; installed version @deepseek-ai/dsh 0.2.2-rc.3 package.json:4", "Официальный источник: https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/README.md; GitHub API подтвердил default branch master"]
resultSummary: "Исследованы installed DSH 0.2.2-rc.3 и текущие kit seams. Выбран repo-tracked docs/analysis store с CAS/atomic writes; taskboard остаётся без дублирующих полей, orchestrator использует optional analysis service, gates выполняются до создания задачи и при закрытии последней связанной задачи. Даны шесть red/green проверок и ограничения изолированного сервера."
role: RESEARCH
scope: ["Read-only изучение /home/iustimov/dsh-kit/plugins/orchestrator, taskboard, test-cases, design-map, profile и scripts", "Read-only изучение установленного DSH 0.2.2-rc.3 и его официальных docs/source для tools, systemPrompt, agent hooks и plugin packaging", "Сформулировать минимальную схему Analysis Record, analysis_check, gate points и red/green доказательства"]
sessions:
  - sessionId: 0edcc4af-c41c-465b-9162-cc5702c9dbb2
    label: RESEARCH
    role: RESEARCH
    status: sleeping
---

Дать реализации точную, версию-согласованную карту расширения dsh-kit для Analysis Record и analysis gates: где должны жить канонические данные, как зарегистрировать root-only tools, как безопасно связать задачи и требования, и какие контракты DSH 0.2.2-rc.3 нельзя нарушить. Это исследование перед реализацией, не проектирование параллельной архитектуры.

Migrated from .dsh/taskboard.json (task task-mwf3kd2x-gndvuo, revision 6).
