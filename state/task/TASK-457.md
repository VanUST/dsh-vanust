---
id: TASK-457
kind: task
title: "Собрать пакеты и закоммитить батч: границы, план, наблюдение"
status: done
revision: 5
createdAt: 2026-11-28T13:53:19.733Z
updatedAt: 2026-11-28T13:57:39.724Z
boardId: task-mx0h0eds-6whiqg
chore: true
choreReason: "Накопился незакоммиченный батч: три файла плагинов изменены, новые проверки и инструменты вне индекса, из-за чего check-portability сравнивает исходники с прежними пакетами и make verify красный."
nonScope: ["Не перезапускать сервер и не устанавливать пакеты: установку делает владелец после коммита.", "Не менять код плагинов и проверок; только версии, сборка, коммит."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["Коммит 3896ecb: 104 файла, +3924/−107; дерево без незакоммиченных изменений.", "pack-plugin: project-state 0.1.21 → 0.1.22 (sha256 69239042…), state-feed 0.1.9 → 0.1.10 (sha256 1f8b71a0…), прежние пакеты удалены.", "make verify на закоммиченном дереве: exit 0 — 20/20 portability (tarball:matches-source PASS), gate ok 5 исключений, documentation ok, schema-lint 0 red, preset-configs 0 refused.", "Сервер не перезапускался, пакеты не устанавливались — установка за владельцем."]
resultSummary: "Батч закоммичен (3896ecb), пакеты собраны (project-state 0.1.22, state-feed 0.1.10), make verify на закоммиченном дереве зелёный: 20/20 portability, границы ok, документация ok."
role: DEVOPS
scope: [packages/, state/, docs/cases/]
---

Приведи дерево в коммитируемое состояние и собери пакеты для плагинов, чьи исходники изменились. Сейчас изменены plugins/project-state/lib/core.mjs, plugins/project-state/lib/views.mjs, plugins/state-feed/lib/feed.mjs; новые файлы scripts/check-boundaries.mjs, scripts/test/check-boundaries.test.mjs, scripts/request-snapshot.mjs, state/plan.yaml, правка Makefile; из-за расхождения исходников и .tgz падает tarball:matches-source. Сделай: (1) подними версии project-state и state-feed там, где исходники изменились, собери .tgz и удали прежние пакеты этих плагинов; (2) git add всего батча, включая неотслеживаемые файлы проверки границ, plan.yaml и кейсы; (3) коммит с внятным сообщением: границы архитектуры, план в инъекции, наблюдение запроса, переносы тестов; (4) прогони make verify на закоммиченном дереве и приложи код возврата. Верни коммит, версии, sha256 пакетов, результат make verify и что не проверено.
