---
id: TASK-440
kind: task
title: "Сократить документацию до трёх владельцев"
status: done
revision: 12
createdAt: 2026-11-28T13:08:29.395Z
updatedAt: 2026-11-28T13:34:19.147Z
boardId: task-mx0feq7p-3posst
nonScope: ["scripts/, плагины, кейсы, записи анализа; работающее развёртывание."]
owner:
  kind: agent
  label: DOCS
preset: docs
reqIds: [REQ-297]
resultEvidence: ["docs/: ARCHITECTURE.md, GUIDE.md, TERMINOLOGY.md — ровно три markdown-файла, у каждого «Дата проверки: 2026-11-28».", "node scripts/check-documentation.mjs → exit 0, documentation ok; make verify → exit 0.", "Из ARCHITECTURE убраны версии в прозе и адреса, заменены указателями на установщики и rules/DEPLOYMENT.md.", "Порядок результатов в §4; состояние — state/views/plan.md (10 363 Б); процедура проверки кандидата — rules/DEPLOYMENT.md §9."]
resultSummary: "Документация сведена к трём владельцам: навигация, архитектура, словарь. Слияние без потерь, процедура проверки кандидата в правилах, план — сгенерированный вид. make verify зелёный, даты проверки стоят."
role: DOCS
scope: [docs/GUIDE.md, docs/ARCHITECTURE.md, docs/DSH-KIT-ARCHITECTURE.md, docs/HARNESS-CONTRACT.md, docs/CASE-LIBRARY-BEHAVIOUR-DESIGN.md, docs/adr/, docs/HARNESS-UPGRADE-CHECKS.md, docs/REQUEST-CACHE-MEASUREMENTS.md, docs/PROJECT-PLAN.md, rules/DEPLOYMENT.md]
---

Сократи документацию до трёх владельцев и перенеси факты к их владельцам, ничего не потеряв. Нужно: новый docs/ARCHITECTURE.md на основе docs/DSH-KIT-ARCHITECTURE.md, в который слиты контракт шва харнесса, устройство библиотеки кейсов и решение по журналу доски (с его границей проверки); процедура проверки кандидата харнесса переезжает в rules/DEPLOYMENT.md; удаляются docs/HARNESS-CONTRACT.md, docs/CASE-LIBRARY-BEHAVIOUR-DESIGN.md, docs/adr/BOARD-JOURNAL-AND-SNAPSHOT.md, docs/HARNESS-UPGRADE-CHECKS.md, docs/REQUEST-CACHE-MEASUREMENTS.md и docs/PROJECT-PLAN.md (его заменяет сгенерированный вид плана); docs/GUIDE.md остаётся навигацией и указывает только на трёх владельцев и на вид плана. После работы в docs/ должно остаться ровно три markdown-файла: GUIDE.md, ARCHITECTURE.md, TERMINOLOGY.md.
