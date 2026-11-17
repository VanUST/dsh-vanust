---
id: TASK-221
kind: task
title: "V1.11: бриф делегирования из реестра и разбор возврата (FR12)"
status: done
revision: 1
createdAt: 2026-11-17T15:52:42.559Z
updatedAt: 2026-11-17T15:52:42.559Z
boardId: task-mwkuvwyx-sr1ydm
ownerRole: BACKEND
---

Сделать бриф делегирования собираемым, а не сочиняемым: новый хост-плагин `@cc/dsh-delegation-brief` рендерит бриф из реестра — требование с критериями дословно, связанные решения, обязательные кейсы с командами и формат возврата — детерминированно, так что одинаковый вход даёт одинаковый байт и `briefHash`. Отказы: нет ядра или `state/` → `cold_start_required`; REQ нет или не accepted → `feature_required`; нет критериев → `criteria_missing`. Второй инструмент `delegation_return` разбирает возврат воркера по замороженным критериям и отказывает `brief_stale` (критерии изменились) и `return_unmapped` (критерий не из брифа). Промпт корня получает короткий статический раздел про бриф, без данных, меняющихся между ходами.

Migrated from .dsh/taskboard.json (task task-mwkuvwyx-sr1ydm, revision 7).
