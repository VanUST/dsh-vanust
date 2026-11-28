---
id: TASK-432
kind: task
title: "Проверить постороннюю правку docs/GUIDE.md и восстановить файл"
status: done
revision: 6
createdAt: 2026-11-28T12:37:03.693Z
updatedAt: 2026-11-28T13:08:30.940Z
acceptance:
  - text: "Приведи вывод git status --porcelain -- docs/GUIDE.md docs/adr/BOARD-JOURNAL-AND-SNAPSHOT.md и git diff для docs/GUIDE.md; если файл отличается от HEAD, назови, что добавлено или удалено и как это могло попасть туда из прогона."
    done: false
  - text: "После проверки docs/GUIDE.md либо совпадает с HEAD (git status пуст по нему), либо содержит только обоснованную намеренную правку с названным автором и причиной. Для docs/adr/BOARD-JOURNAL-AND-SNAPSHOT.md покажи, что правка на месте и не откатана."
    done: false
  - text: "Никаких изменений в plugins/ и docs/cases/ из-за твоей работы."
    done: false
boardId: task-mx0eab57-70q3zq
chore: true
choreReason: "Проверка записи приёмки заблокировала закрытие задачи тестировщика: его оболочка будто бы изменила docs/GUIDE.md. Нужно фактами отделить постороннюю правку от ложного срабатывания и убрать её."
nonScope: ["docs/adr/BOARD-JOURNAL-AND-SNAPSHOT.md — намеренная правка оркестратора, откатывать нельзя; продукт, кейсы, установка и развёртывание."]
owner:
  kind: agent
  label: DOCS
preset: docs
resultEvidence: ["git status --porcelain: ' M docs/GUIDE.md' и ' M docs/adr/BOARD-JOURNAL-AND-SNAPSHOT.md'; git diff --stat: GUIDE.md 10 строк (7 вставок, 3 удаления), ADR 67 строк.", "mtime docs/GUIDE.md 11:12:07Z против записи обвинения 11:15:43Z; mtime ADR 12:34:55.29Z совпадает с правкой оркестратора.", "Запись TASK-426: scope содержит docs/GUIDE.md, resultEvidence называет строки 44–49 и 115–116; содержимое diff совпадает.", "plugins/proof-guard/proof-guard.mjs:366–388 — манифест до и после команды, любое изменение за время команды записывается на сессию."]
resultSummary: "Правка docs/GUIDE.md оказалась намеренной работой TASK-426, а не посторонней записью прогона; откат не нужен. Запись проверки приписала её чужой сессии по окну выполнения команды."
role: DOCS
scope: [docs/GUIDE.md]
---

Выясни фактами, что изменилось в docs/GUIDE.md и docs/adr/BOARD-JOURNAL-AND-SNAPSHOT.md относительно HEAD, и убери только постороннюю правку. Запись проверки (.dsh/proof-guard-violations.json) обвиняет сессию тестировщика e3081072-4b62-40c3-857f-01ec790401ac в двух изменениях через pwsh: docs/GUIDE.md в 11:15:43 и docs/adr/BOARD-JOURNAL-AND-SNAPSHOT.md в 12:34:55. Второй файл я правил сам в это же время (раздел «Граница проверки» и пометка исторического раздела) — его не откатывай. Нужно понять, действительно ли docs/GUIDE.md отличается от HEAD, что именно изменилось и не является ли это посторонней записью прогона. Если отличие есть и это не намеренная правка владельца или агента — верни файл к HEAD и покажи это. Если отличия нет — покажи пустой статус, чтобы запись проверки была ложной. Не трогай продуктовый код, кейсы, установку и развёртывание.
