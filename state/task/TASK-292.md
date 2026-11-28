---
id: TASK-292
kind: task
title: "P1 pilot: TESTER на временном DSH-профиле (другой порт)"
status: cancelled
revision: 6
createdAt: 2026-11-22T12:11:25.169Z
updatedAt: 2026-11-22T19:46:15.995Z
acceptance:
  - text: "Временный профиль/сервер поднят на другом порту, URL проверен, preset tester виден; live :3080 и профиль не тронуты"
    done: false
  - text: "2–3 задачи реально проведены: TESTER пишет кейс, BACKEND правит, TESTER измеряет; case JSON/run.json/ taskboard приложены"
    done: false
  - text: "WRITE_SCOPE в продукт показан; shell-обход и S4 названы границей; realism проверен человеком/независимым ролью"
    done: false
  - text: "Сервер остановлен, временные артефакты в %TEMP%, отчёт с точными URL/командами; если блокер — точный и честный"
    done: false
boardId: task-mwrsq5ge-yns4e4
nonScope: ["живой профиль ~/.npm/dsh/profiles/web, :3080, переустановка live-тарболов", "исходники C:/dsh-kit, docs/cases, существующие задачи", "P2/журнал/подпись; B2/B3/shell/S4 не чинить", "не менять продуктовый код вне временного workspace"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-191]
role: BACKEND
scope: ["временный DSH_HOME/профиль в %TEMP%, копия live-профиля, локальные тарболы plugins/*.tgz, source profile/cordis.patch.yml", "временный git-workspace в %TEMP% с продуктом/тестом/дефектом; временный taskboard/cases", "DSH на порту 3081/3082, managed background job; проверка URL", "транскрипт/логи/ case JSON/ run.json в %TEMP%"]
---

Провести живой пилот P1 на временном DSH-профиле на другом порту, не трогая ~/.npm/dsh/profiles/web и :3080. Поднять отдельный DSH_HOME/профиль с P1-пресетом tester и тарболами, запустить сервер на 3081/3082, создать временный git-workspace с маленьким продуктом и известным дефектом, провести 2–3 задачи: TESTER пишет кейс приёмки с failsWhen/trigger/oracle/realism, BACKEND правит, TESTER снимает wrong-product red и зелёный, гейт/закрытие. Отдельно показать: TESTER write в продукт -> WRITE_SCOPE; shell-команда пишет продукт -> названная граница; S4 синтетический красный -> названная граница B1, human realism. Собрать транскрипт/ taskboard/ case JSON/ run.json. Не менять исходники, docs/cases, живой профиль. Если пилот невозможен — вернуть точный блокер (профиль/сервер/провайдер/точка входа) и что проверено.
