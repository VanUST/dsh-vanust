---
id: TASK-481
kind: task
title: "Собрать батч к одному перезапуску: outline, политика, профиль"
status: active
revision: 2
createdAt: 2026-11-28T16:18:40.639Z
updatedAt: 2026-11-28T16:18:41.197Z
boardId: task-mx0m7atb-q808vn
chore: true
choreReason: "Накопился батч: outline починен и должен вернуться в профиль, политика оркестратора изменена (порог, условные глаголы), профиль получил fetchProvider."
nonScope: ["Не перезапускать сервер и не запускать apply — это шаг владельца.", "Не менять правила политики по существу: только сборка и коммит."]
owner:
  kind: agent
  label: DEVOPS
  sessionId: 9975a578-5800-4dd0-98ba-1926a948fb3a
preset: devops
role: DEVOPS
scope: [profile/cordis.patch.yml, packages/, plugins/outline/package.json, plugins/orchestrator/package.json]
sessions:
  - sessionId: 9975a578-5800-4dd0-98ba-1926a948fb3a
    label: DEVOPS
    role: DEVOPS
    status: active
---

Собери и закоммить батч так, чтобы один перезапуск владельца применил всё. Сделай: (1) в profile/cordis.patch.yml верни outline в работу — убери enabled: false (или поставь true) и поправь комментарий, объясняя, что причина устранена в плагине; оставь fetchProvider: http; (2) подними версию и пересобери пакеты оркестратора (изменилась политика) и outline (починка запуска), удали прежние tgz; (3) прогони проверки схем пресетов, документации, границ и make verify, приложи коды; (4) закоммить профиль, плагины, пакеты, кейс outline и состояние; (5) приложи план kit-update: в нём должны быть только установка пакетов и запись профиля. Сервер не перезапускай.
