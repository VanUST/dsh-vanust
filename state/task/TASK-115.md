---
id: TASK-115
kind: task
title: "Fix Web UI plugin activation after 0.2.2"
status: done
revision: 1
createdAt: 2026-11-17T15:52:40.468Z
updatedAt: 2026-11-17T15:52:40.468Z
boardId: task-mwevuviy-m3ygjp
ownerRole: BACKEND
---

После перезагрузки на DSH 0.2.2-rc.3 Web UI сообщает «Failed to load plugins»: required dsh-client-ui-sidebar и dsh-client-ui-chat pending, многие client UI plugins ждут uiWorkspace/uiConversation/contextMenus/sidebarRight. Найти корневую причину в composition/profile после upgrade, исправить kit-конфигурацию или несовместимые client bundles, доказать чистое boot/UI и вернуть рабочий harness без ad-hoc отключения панелей.

Migrated from .dsh/taskboard.json (task task-mwevuviy-m3ygjp, revision 8).
