---
id: TASK-419
kind: task
title: "Закрывать законно изменённые задачи без повторного сохранения"
status: done
revision: 26
createdAt: 2026-11-28T11:04:53.120Z
updatedAt: 2026-11-28T12:42:37.859Z
acceptance:
  - text: "Покрыты AC-1, AC-2 и AC-3 записи анализа taskboard-write-integrity."
    done: false
boardId: task-mx0azs5x-m90gyp
nonScope: ["Кейсы приёмки принадлежат TESTER; работающий сервер, установленный кит и данные рабочих досок не менять."]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-293, REQ-294]
resultEvidence: ["Пакет plugins/cc-dsh-taskboard-0.1.97.tgz sha256 8cbbbe63349fb3b91936d700734dcf977cebf973233d17e9cde599a578f4fb9b (102668 Б); taskboard.mjs 81FA00F3, lib/store.mjs 1FE011FC, lib/journal.mjs B6DBFDC0 — совпадает с рабочим деревом.", "TEST-105 rev 21: красный mx0e84l6-n92on-1 на d14bc29 exit 1, зелёный mx0e8ay1-os5ph-1 exit 0.", "TEST-106 rev 28: зелёный mx0e8but-87jcq-1 exit 0 после красного mx0e85kr-dpenq-1; TEST-107 rev 26: зелёный mx0e8d11-wu6tx-1 exit 0 после красного mx0e86js-8bf5o-1 (оба красных на 0.1.95 b7e358b4, exit 1).", "Негативный контроль: CASE_NEGATIVE_CONTROL=expect-refusal, mx0e3aze-6v8ts-1, продукт вернул ok:true там, где драйвер требует отказа, exit 1.", "Независимое ревью TASK-430 rev 11: PASS на этих байтах; .tmp/review-197-probes.txt, время записи .tmp/review-197-baseline.txt (8,32 мс против 8,39 мс)."]
resultSummary: "Запись строки доски и сведения проверки пишутся одной строкой журнала под существующей блокировкой. Кандидат 0.1.97 закрывает обе находки: потерянный или пустой журнал под снимком отказывает в одиночном закрытии, в closeMany и в applyMany без изменения файлов; полная запись без сведений проверки не подтверждает записанную строку. Принято по независимым кейсам на упакованных байтах."
role: BACKEND
scope: [plugins/taskboard/lib/store.mjs, plugins/taskboard/lib/journal.mjs, plugins/taskboard/taskboard.mjs]
---

Записывать изменение строки доски и сведения для его проверки одной операцией; сохранить отказ при расхождении и восстановление после неполной записи.
