---
id: TASK-508
kind: task
title: "Батч после критики: ворота, доставка, профиль"
status: done
revision: 5
createdAt: 2026-11-28T18:13:57.502Z
updatedAt: 2026-11-28T18:28:08.244Z
boardId: task-mx0qbkd2-y908wr
chore: true
choreReason: "Накопился последний батч после критики: ворота по флагу, доставка архитектуры, профиль роли ARCHITECT, кейсы и правки документации — нужны пересборка, коммит и один перезапуск."
nonScope: ["Не менять тексты по существу.", "Не трогать посторонние неотслеживаемые файлы."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["Коммит 4631e25: 52 файла, +1279/−147 — ворота по флагу, доставка архитектуры, профиль роли ARCHITECT, README state-feed и DEPLOYMENT, кейсы, записи анализа.", "Пакеты: orchestrator 0.1.86 → 0.1.87 (c68247e4…), state-feed 0.1.11 → 0.1.12 (f12137cc…); прежние tgz удалены.", "make verify exit 0 до и после коммита: 20/20 portability, boundaries ok, documentation ok, 147 строк пресетов 0 отказов, schema-lint и context-budget 0 red.", "kit-update --check: plan = write-profile-files cordis.patch.yml, write-rules DEPLOYMENT.md, install-plugins orchestrator 0.1.87, project-state 0.1.25, project-state-panel 0.1.53, state-feed 0.1.12, taskboard 0.1.99."]
resultSummary: "Батч после критики собран и закоммичен (4631e25): ворота по флагу, честная доставка архитектуры, право роли ARCHITECT, правка README и правил; verify зелёный, план обновления содержит профиль, правила и пять пакетов."
role: DEVOPS
scope: [packages/, plugins/orchestrator/package.json, plugins/state-feed/package.json]
---

Собери и закоммить последний батч, чтобы один перезапуск применил всё. Состав: plugins/orchestrator (ворота консультации по флагу architectureImpact, текст отказа без класса, политика), plugins/state-feed (длинная строка, пустой файл против отсутствующего, дельта при смене архитектуры несёт раздел; тег в хеше), profile/cordis.patch.yml (роль ARCHITECT: write/edit и разрешения; персона), docs/ARCHITECTURE.md, plugins/state-feed/README.md и rules/DEPLOYMENT.md (правда про L1/L2 и хеш), кейсы и записи анализа. Подними версии, пересобери, удали прежние пакеты, закоммить, прогони make verify, приложи коммит, версии, sha256 и план kit-update (включая write-profile-files, если профиль расходится). Верни: коммит, план, коды.
