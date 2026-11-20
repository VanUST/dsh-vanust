---
id: TASK-271
kind: task
title: "Библиотека кейсов: правка и наблюдение доступны, каталог в доказательстве, запрет прибитых команд"
status: done
revision: 5
createdAt: 2026-11-20T14:42:08.599Z
updatedAt: 2026-11-20T15:02:21.499Z
boardId: task-mwp38cbu-yxweys
nonScope: ["Не трогать ~/.npm/dsh и :3080", "Не менять кейсы в других рабочих пространствах (autolabel) — только код плагина и его документация здесь", "Не выдавать case_update ролям, которые судят изменение (reviewer, critic), и не расширять поверхность оркестратора сверх intake"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-179, REQ-180, REQ-181, REQ-182, REQ-183]
resultEvidence: ["node --test plugins/test-cases/test/*.test.mjs -> 34/34 exit 0; make test 72/72 exit 0; make verify 19/19 exit 0", "red на копии HEAD: 5 падений run-cwd-pinned ('the run.json does not name the directory the command ran in', 'a pinned command was registered: cd /home/iustimov/tasks/autolabel_pipeline && …'); policy-docs падает на отсутствующем экспорте ALL_TOOLS", "кейсы verified через control expect-pre-fix: case-surface-per-role-matches-the-readme-table, a-run-records-the-directory-it-happened-in, a-command-pinned-to-one-tree-is-refused", "cc-dsh-test-cases-0.1.19.tgz; 33 сохранённых runCommand -> 0 отказов"]
resultSummary: "Библиотека кейсов: backend получил case_update и case_verify, reviewer — case_verify; case_run принимает cwd и записывает каталог в прогон, case_get показывает каталог последнего прогона и наблюдения; регистрация и правка отклоняют команду с абсолютным путём (PINNED_COMMAND) с подсказкой «относительная команда + cwd»; README-таблица и подсказка роли генерируются из DEFAULT_ROLE_TOOLS и сверяются тестом. Каждый пункт доказан red-first на копии HEAD, три кейса verified."
role: BACKEND
scope: ["plugins/test-cases/** (test-cases.mjs, lib/schema.mjs, lib/runner.mjs, README.md, test/)", "plugins/cc-dsh-test-cases-*.tgz (перепаковка)", "profile/cordis.patch.yml — только если текст подсказки роли живёт там", "docs/cases/tests/ — тест сверки README с политикой"]
---

Починить библиотеку кейсов по трём дефектам владельца. (FR1) Выдать case_update и case_verify роли backend (владелец кейса), case_verify — reviewer; остальные наборы не расширять. (FR2) Добавить каталог запуска в доказательство: case_run принимает необязательный cwd (абсолютный или относительно рабочего пространства, по умолчанию рабочее пространство сессии), запись прогона хранит cwd и cwdRelative, case_get показывает каталог последнего прогона и последнего наблюдения; то же поле в case_verify. (FR3) Отклонять runCommand, прибитый к дереву: команда, начинающаяся с `cd /…` или содержащая абсолютный путь (/home/…, C:\\), получает отказ с названной причиной и подсказкой «относительная команда + cwd»; уже записанные кейсы с абсолютным путём остаются читаемыми, но правка через case_update их не пропускает. (FR4) README-таблица поверхностей должна совпадать с DEFAULT_ROLE_TOOLS — добавить тест, который сравнивает их и падает при расхождении; подсказку роли (SECTION_* текст) привести к реальному набору. Каждый пункт доказать red-first на копии модуля из git HEAD и зелёным прогоном; перепаковать плагин с подъёмом версии; make verify и make test — exit 0.
