---
id: TASK-175
kind: task
title: "Ревью: плагин outline и его монтирование на уровне хоста"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.491Z
updatedAt: 2026-11-17T15:52:41.491Z
acceptance:
  - text: "по каждому пункту брифa — вердикт с file:line и запущенной командой, без общих слов"
    done: false
  - text: "найденные расхождения названы и оценены: блокер или замечание"
    done: false
  - text: "отдельно проверено, что в package.json нет runtime-зависимостей и что раздел промпта не обещает больше, чем делает инструмент"
    done: false
  - text: "вердикт по изменению: APPROVE / APPROVE с замечаниями / REQUEST CHANGES, и явный список того, что не проверено"
    done: false
boardId: task-mwkjolvg-31h0s4
nonScope: ["любые правки файлов, коммиты, установка тарбола в профиль, перезапуск :3080", "plugins/designmap/** и docs/TERMINOLOGY.md — параллельная чужая работа", "история в docs/cases/, reports/, .dsh/, .cache/"]
owner:
  kind: agent
  label: REVIEWER
  sessionId: 33f5d04c-f688-4787-99f7-082a1c9ae2ac
ownerRole: REVIEWER
preset: reviewer
resultEvidence: ["APPROVE с замечаниями; независимо воспроизведены гейты и живые замеры 4 791/8 924/5 390/57 490 Б", "найдены и исправлены: +1 Б в числах, ложное утверждение про exit 0, пробел в USERGUIDE"]
resultSummary: "Независимое ревью: блокеров нет, замечания исправлены."
role: REVIEWER
scope: ["новые plugins/outline/*, scripts/outline-selftest.mjs, plugins/cc-dsh-outline-0.1.0.tgz", "правки profile/cordis.patch.yml, plugins/inventory.json, scripts/provision-tools.mjs, README.md, USERGUIDE.md, rules/DEPLOYMENT.md, NOTICE", "сверка текста раздела и описания инструмента с кодом и селфтестом"]
sessions:
  - sessionId: 33f5d04c-f688-4787-99f7-082a1c9ae2ac
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

Независимо проверить новый плагин кита `@cc/dsh-outline`: совпадает ли текст раздела промпта и описание инструмента с его поведением, действительно ли инструмент получает каждый агент (корень и все пресеты), не добавлены ли runtime-зависимости, корректен ли пин и detect в провижининге, согласованы ли инвентарь и документы, побайтно ли тарбол равен исходникам. Вернуть вердикт APPROVE / APPROVE с замечаниями / REQUEST CHANGES с цитатами file:line.

Migrated from .dsh/taskboard.json (task task-mwkjolvg-31h0s4, revision 6).
