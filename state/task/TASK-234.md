---
id: TASK-234
kind: task
title: "P3: счётчики State и список задач с сортировкой"
status: active
revision: 2
createdAt: 2026-11-18T12:29:55.544Z
updatedAt: 2026-11-18T12:39:14.133Z
boardId: task-mwm3mmo3-08soxt
reqIds: [REQ-115, REQ-116, REQ-117]
steps: ["Вынести чистые функции: счётчики (невыполненные/активные/субагенты) и компаратор Relevance + теги", "Триггер State: счётчики с aria-label, обновление по сессиям и проекциям, «—» при ошибке", "Board: переключатель Board/List, таблица списка, теги сортировки с aria-pressed", "Тест чистых функций + кейсы red→green; axe/клавиатура/760px", "Пересобрать тарбол, make verify"]
stepsDone: 0
---

В @cc/dsh-project-state-panel: (FR1) триггер State в conversation.session.header.actions показывает рядом с иконкой три числа — невыполненные задачи, активные задачи, активные субагенты — из проекций workspace и живых дочерних сессий текущего чата, с пересчётом без перезагрузки и названной областью счёта; (FR2) в режиме Board появляется переключатель Board/List, а в List — таблица задач с колонками Status/Task/Requirement/Progress/Updated и тегами сортировки Relevance (по умолчанию), Updated, Status, Title. Relevance: active → blocked → review → open → done → cancelled; внутри — больше выполненных шагов, затем updatedAt по убыванию, затем id. Только чтение, без записей. Тест на чистых функциях сортировки/счёта + кейсы с красным→зелёным; тарбол пересобрать, make verify 17/17.
