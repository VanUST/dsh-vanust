---
id: TASK-277
kind: task
title: "U1: провижн impeccable — скилл, движок, make design-audit"
status: done
revision: 1
createdAt: 2026-11-23T08:44:01.694Z
updatedAt: 2026-11-23T08:44:01.694Z
boardId: task-mwlxo6cu-529m2f
ownerRole: BACKEND
---

Провижн дизайн-контура (FR1, FR5, NFR1): добавить impeccable в scripts/provision-tools.mjs как npm-базированный инструмент с пином версии 4.9.2 и проверкой целостности, поставить DSH-скилл impeccable в общую библиотеку скиллов из этого пакета, убедиться что движок после установки работает офлайн (detect --list-rules на 62 правила), и добавить отдельную цель `make design-audit` с JSON-выводом по UI-исходникам кита. Причина: без провижна скилл не воспроизводится на чистой машине, а без отдельного гейта детектор никто не запустит. Цель не должна попадать в make verify — он обязан оставаться офлайновым.

Migrated from .dsh/taskboard.json (task task-mwlxo6cu-529m2f, revision 9).
