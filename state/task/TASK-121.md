---
id: TASK-121
kind: task
title: "Атаковать analysis gates"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.548Z
updatedAt: 2026-11-17T15:52:40.548Z
acceptance:
  - text: "Для каждого отказа: минимальные входы, команда/скрипт, фактический output/exit code, почему это нарушает контракт"
    done: false
  - text: "Отдельно перечислить атаки, которые НЕ сработали — это позитивные доказательства"
    done: false
  - text: "Если отказов нет, доказать силу проверки mutation на scratch copy; не выдумывать bug"
    done: false
  - text: "Вернуть prioritized findings с path:line и минимальным предлагаемым исправлением, не применяя его"
    done: false
boardId: task-mwf4oilo-v5m1rv
nonScope: ["Никаких изменений production source, live tasks/cases/design map или profile", "Не трогать :3080 и не запускать второй сервер; disposable fake harness достаточно", "Не исправлять найденное и не делать commit/push", "Не использовать реальные пользовательские данные"]
owner:
  kind: agent
  label: CRITIC
  sessionId: 9f0a510f-2325-4a38-bdc5-c6bd060ba7d1
ownerRole: CRITIC
preset: critic
resultEvidence: ["node /tmp/dsh-attack/minimal-repros.mjs и /tmp/dsh-attack/attack.mjs: P1 ready+pendingImpacts:0 после удаления REQ-2, P2 gate/linkTask для deferred, P3 contractImpact none→breaking остаётся ready, P4 L1 non-architecture analysis_stale на moved map, P5 RESEARCH без changeClass analysis_required", "node scripts/analysis-before-decomposition-proof.mjs → 45/45 exit 0 baseline; scratch mutation без pendingImpacts refusal → 44/45 exit 1; scratch P1 fix → 45/45 exit 0, доказав слепоту текущего proof к удалению requirements", "/tmp/dsh-attack/minimal.out, attack.out, negatives.out, mutation-m1.log, mutation-m2.log; production не изменён"]
resultSummary: "Adversarial проверка подтвердила пять дефектов gate: добавление/удаление requirements не создаёт impact и может стереть trace активной задачи; deferred/rejected requirements можно делегировать; architecture/contract edits через upsert не reopen; design drift ошибочно блокирует non-architecture L1 и снимается простым designRef bump; omitted changeClass ломает read-only delegation через default L1. Есть положительные negative controls и mutation proof."
role: CRITIC
scope: ["Использовать реальные plugins/analysis/store.mjs и orchestrator.mjs с fake harness/disposable dirs, не меняя production files", "Атаковать: L1 без changeClass для read-only, L1 non-architecture при moved design map, закрытие последней traced task с planned requirement, deleted/deferred/rejected requirements, unknown/dangling trace, trace-only updates, stale CAS, failure между task create/link/child start", "Проверить хотя бы одну отрицательную mutation, которая заставляет существующий proof упасть на scratch copy"]
---

Попытаться сломать новый analysis/gate на disposable fixtures: получить делегирование или завершение вопреки контракту, обойти stale/design/completion правила или заставить gate блокировать разрешённую работу. Нужны наименьшие воспроизводимые отказы, не общая оценка кода.

Migrated from .dsh/taskboard.json (task task-mwf4oilo-v5m1rv, revision 7).
