---
id: TASK-263
kind: task
title: "Проверки: отказ на пустом входе, негативный контроль, make test"
status: review
revision: 3
createdAt: 2026-11-20T11:51:14.102Z
updatedAt: 2026-11-20T12:11:36.803Z
boardId: task-mwox4hwu-426mqw
nonScope: ["Не трогать ~/.npm/dsh и порт 3080", "Не менять смысл существующих зелёных проверок — только добавить отказ на пустом входе и негативный контроль", "Не чинить плагины, установщики и таскборд — это другие задачи"]
owner:
  kind: agent
  label: BACKEND
  sessionId: db97c9cb-7fbc-4174-b8e4-acafc0d6e682
preset: backend
reqIds: [REQ-175, REQ-177]
role: BACKEND
scope: ["scripts/context-budget.mjs, scripts/schema-lint.mjs, scripts/check-portability.mjs", "scripts/test-all.mjs (новый), Makefile (цель test и help)", "README.md, rules/DEPLOYMENT.md — упоминание make test", ".github/workflows/ (опционально: два job, linux и windows, make verify + make test)"]
sessions:
  - sessionId: db97c9cb-7fbc-4174-b8e4-acafc0d6e682
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Сделать проверки кита честными и дать один вход в тесты. (ФР4) context-budget на машине без сессий должен возвращать отказ с названной причиной, а не успех; schema-lint должен обходить plugins/** рекурсивно и отказывать, когда набор пресетов пуст или регулярка не нашла ни одного инструмента; check-portability не должен считать закомментированную строку монтированием (снять комментарии перед поиском). У каждой из трёх — негативный контроль: прогон на заведомо пустом/сломанном входе даёт отказ, и это записано в её же выводе. (ФР6) scripts/test-all.mjs обходит plugins/*/test/*.test.mjs через node --test и scripts/*-proof.mjs, останавливается на первом падении с кодом 1, умеет --only <подстрока>; цель make test в Makefile; README и rules/DEPLOYMENT.md называют команду.
