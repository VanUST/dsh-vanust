---
id: TASK-179
kind: task
title: "PTC волна 1: проверка gatherer и reviewer на втором сервере"
status: done
revision: 1
createdAt: 2026-11-17T15:52:41.578Z
updatedAt: 2026-11-17T15:52:41.578Z
boardId: task-mwkk3shd-vpgj4y
ownerRole: BACKEND
---

Доказать на втором web-сервере со свежими сессиями, что пресеты gatherer и reviewer из profile/cordis.patch.yml работают в PTC-режиме: шапка из одного run_code, SDK со всеми инструментами пресета, вложенные вызовы tool/ptc-dispatch, корректный результат, без INVALID_REQUEST и CODE_RUN_FAILED. Остальные пресеты должны остаться native. Живой :3080 и установленный профиль не трогать.

Migrated from .dsh/taskboard.json (task task-mwkk3shd-vpgj4y, revision 7).
