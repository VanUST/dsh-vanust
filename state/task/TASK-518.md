---
id: TASK-518
kind: task
title: "Финальный батч: коммит и push"
status: active
revision: 2
createdAt: 2026-11-28T21:07:03.828Z
updatedAt: 2026-11-28T21:07:04.140Z
boardId: task-mx0wi6et-t6muaa
chore: true
choreReason: "Владелец попросил завершить и запушить: накопились правка панели, персона тестировщика, политика, кейсы, драйвер и состояние."
nonScope: ["Не перезапускать сервер и не запускать apply.", "Не force-push и не ребейзить."]
owner:
  kind: agent
  label: DEVOPS
  sessionId: 9975a578-5800-4dd0-98ba-1926a948fb3a
preset: devops
role: DEVOPS
scope: [packages/, plugins/orchestrator/package.json]
sessions:
  - sessionId: 9975a578-5800-4dd0-98ba-1926a948fb3a
    label: DEVOPS
    role: DEVOPS
    status: active
---

Собери батч, закоммить и запушь. Состав: plugins/project-state-panel/client.js (исправление зависания вкладки плана), profile/cordis.patch.yml (персона TESTER про браузер из .tools; правки ролей из прошлых задач), plugins/orchestrator/orchestrator.mjs (правило о том, когда ставится флаг влияния на архитектуру), docs/cases (приёмочный кейс вкладки плана, драйвер, обновления), state/ (перегенерированные виды, строки задач), docs/analysis. Сделай: (1) подними версию оркестратора и пересобери пакет, удали прежний tgz; (2) прогони make verify; (3) закоммить; (4) запушь в текущую ветку и покажи, что remote обновился; (5) приложи план kit-update и скажи, какой версии развёртывание отстаёт. Верни: коммит, версии, вывод verify, вывод push, что осталось.
