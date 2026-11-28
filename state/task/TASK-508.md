---
id: TASK-508
kind: task
title: "Батч после критики: ворота, доставка, профиль"
status: active
revision: 2
createdAt: 2026-11-28T18:13:57.502Z
updatedAt: 2026-11-28T18:13:57.816Z
boardId: task-mx0qbkd2-y908wr
chore: true
choreReason: "Накопился последний батч после критики: ворота по флагу, доставка архитектуры, профиль роли ARCHITECT, кейсы и правки документации — нужны пересборка, коммит и один перезапуск."
nonScope: ["Не менять тексты по существу.", "Не трогать посторонние неотслеживаемые файлы."]
owner:
  kind: agent
  label: DEVOPS
  sessionId: 9975a578-5800-4dd0-98ba-1926a948fb3a
preset: devops
role: DEVOPS
scope: [packages/, plugins/orchestrator/package.json, plugins/state-feed/package.json]
sessions:
  - sessionId: 9975a578-5800-4dd0-98ba-1926a948fb3a
    label: DEVOPS
    role: DEVOPS
    status: active
---

Собери и закоммить последний батч, чтобы один перезапуск применил всё. Состав: plugins/orchestrator (ворота консультации по флагу architectureImpact, текст отказа без класса, политика), plugins/state-feed (длинная строка, пустой файл против отсутствующего, дельта при смене архитектуры несёт раздел; тег в хеше), profile/cordis.patch.yml (роль ARCHITECT: write/edit и разрешения; персона), docs/ARCHITECTURE.md, plugins/state-feed/README.md и rules/DEPLOYMENT.md (правда про L1/L2 и хеш), кейсы и записи анализа. Подними версии, пересобери, удали прежние пакеты, закоммить, прогони make verify, приложи коммит, версии, sha256 и план kit-update (включая write-profile-files, если профиль расходится). Верни: коммит, план, коды.
