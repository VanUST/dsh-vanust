---
id: TASK-168
kind: task
title: "Карта дизайна: доказательство в браузере и на втором сервере"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.359Z
updatedAt: 2026-11-17T15:52:41.359Z
acceptance:
  - text: "Есть скриншоты до и после: тёмная тема, панель с подписями, легенда, стрелки после перетаскивания"
    done: false
  - text: "Контраст основной кнопки измерен в браузере и не ниже 4.5:1 в обеих темах"
    done: false
  - text: "Перетаскивание узла в браузере: во время drag стрелка на узле, после drop концы на границе; пересечение устранено, Undo работает"
    done: false
  - text: "Правка подписи из панели видна в model.yaml и в сцене после перерисовки; пустая подпись ребра отклонена"
    done: false
  - text: "Второй сервер :3081 запущен с новым пакетом через overlay и загружает 0.1.16 без ошибок; :3080 не тронут и получит пакет при следующем запуске (kit-update)"
    done: false
boardId: task-mwkidre7-a56xb1
inline: true
nonScope: ["Живой сервер :3080, профиль ~/.npm/dsh/profiles/web и установленный пакет не меняются", "Правки кода — отдельные задачи"]
resultEvidence: ["reports/designmap-bugs/auto-proof-before.png, auto-proof-after.png (overlap_adjusted), auto-proof-undo2.png (undo вернул строку)", "reports/designmap-bugs/after-fix-mid-drag.png / after-fix-drop2.png / legend-zoom.png / legend-zoom2.png / labels-final.png", "живой :3081: скретч-пакет 0.1.16 через overlay, тёмная тема — accent #f9fafb, ink #0b0f14, кнопка #f9fafb/#0b0f14, контраст 18.39:1; переключение светлая/тёмная на открытой панели меняет surface #151517 <-> #fff; reports/designmap-bugs/live-dark-edit-mode.png, live-light-switched.png", "toggle: устаревший post-load change больше не перезаписывает Undo (canvas.jsx suppressUntilRef, 600 мс); в логе песочницы после undo нет повторного upsert"]
resultSummary: "Исправления доказаны в реальной панели: песочница (перетаскивание, авто-постановка с сообщением и Undo, легенда по фактическим цветам, инспектор подписей) и второй сервер :3081 с пакетом 0.1.16 через overlay (тёмная тема, контраст 18.39:1, переключение темы на открытой панели). Живой :3080 не тронут."
scope: ["reports/designmap-bugs/ — скриншоты и выводы", "второй сервер :3081 и временный overlay для нового пакета", "песочница plugins/designmap/harness на отдельном порту"]
---

Доказать исправления в реальной панели карты дизайна: песочница панели (harness) для быстрых проверок и второй сервер DSH на :3081 с новым пакетом через overlay, чтобы :3080 остался нетронутым. Для каждого бага и для каждой новой правки — до/после, замер контраста, кадры перетаскивания, легенда и правка подписи; всё сложить в reports/designmap-bugs с командами и выводами.

Migrated from .dsh/taskboard.json (task task-mwkidre7-a56xb1, revision 3).
