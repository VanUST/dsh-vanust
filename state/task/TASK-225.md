---
id: TASK-225
kind: task
title: "V3.2: L1 показывает открытые REQ и разрывы реестра (BR1, третья точка)"
status: review
revision: 1
createdAt: 2026-11-17T16:29:11.872Z
updatedAt: 2026-11-17T16:29:11.872Z
boardId: task-mwkwlg2r-qktas2
ownerRole: BACKEND
---

Закрыть третью точку BR1: L1 должен сам показывать разрывы и состав открытых требований, а не только счётчики. Сейчас digest даёт «REQ 102 · TASK 223 · TEST 49», а про REQ без задач, TASK без reqId и TEST без reqId молчит, поэтому модель добывала ответ bash-чтением файлов. Добавь в digest две детерминированные секции: открытые REQ по id (bounded) и разрывы (REQ без задач с id, задачи без reqId, кейсы без reqId), уложись в кап 3072 байта, и докажи на живой сессии, что ответ называется из L1 без обхода файловой системой.

Migrated from .dsh/taskboard.json (task task-mwkwlg2r-qktas2, revision 5).
