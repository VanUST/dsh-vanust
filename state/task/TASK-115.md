---
id: TASK-115
kind: task
title: "Fix Web UI plugin activation after 0.2.2"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.468Z
updatedAt: 2026-11-17T15:52:40.468Z
acceptance:
  - text: "Root cause назван по текущей 0.2.2 composition/boot log, а не догадкой; указано, какой row/package/service не активировался."
    done: false
  - text: "Исправление воспроизводимо в kit profile/packages и не является ручным изменением live process."
    done: false
  - text: "На isolated 0.2.2 сервере нет pending required client entries; sidebar/chat/workspace и минимум одна панель реально работают в Chromium."
    done: false
  - text: "Логи и exact commands приложены; probe server/sessions/fixtures удалены; :3080 не остановлен."
    done: false
  - text: "Если для live нужен restart, это явно названо и подтверждено evidence второго сервера."
    done: false
boardId: task-mwevuviy-m3ygjp
nonScope: ["Не отключать required client UI plugins и не маскировать pending как успех.", "Не перезапускать :3080 без отдельного подтверждения; сначала воспроизвести/проверить на втором сервере.", "Не менять Kimi, image-window, subagent reuse semantics.", "Не удалять пользовательские данные, sessions или taskboard history."]
owner:
  kind: agent
  label: BACKEND
  sessionId: df2a7125-9152-4106-9d22-c4f180fc00f7
ownerRole: BACKEND
preset: backend
resultArtifacts: [scripts/kit-update.mjs, rules/DEPLOYMENT.md, docs/cases/harness-pin-bump-refused-while-dsh-web-runs.json]
resultEvidence: ["Root cause: 0.2.1-rc.2 tarball web-app has no ui-context-menu/ui-file-drag rows while 0.2.2 client entries inject contextMenus/fileDrag; user's pending list lacks exactly those providers.", "Isolated 0.2.2 :3081 with same DSH_HOME/profile: no 'Failed to load plugins'; sidebar-present true, chat composer 1, Tasks panel opened with real board data; boot log had no activation warnings.", "Guard proof: node scripts/kit-update.mjs --kit /tmp/kitguard --home /tmp/guard-home --apply --no-tools -> harness.state action=blocked have=0.2.2-rc.3 want=0.2.2-rc.4-guardproof reason=web-server-running pids=413264,422866; no install occurred.", "Case harness-pin-bump-refused-while-dsh-web-runs verified; changed scripts/kit-update.mjs and rules/DEPLOYMENT.md; :3081 killed, probe fixtures removed, :3080 pid 413264 remained listening."]
resultSummary: "UI-сбой после первого boot 0.2.2 воспроизведён и объяснён: глобальный harness заменили, пока старый 0.2.1 web-сервер продолжал работать; процесс держал старую composition без ui-context-menu/ui-file-drag, а client bundles уже были 0.2.2. Kit profile не был причиной. Добавлен воспроизводимый guard в kit-update, запрещающий pin bump при работающем dsh web; DEPLOYMENT обновлён. Изолированный 0.2.2 сервер с тем же home/profile загрузил sidebar/chat/workspace и открыл Tasks без pending required entries; probe очищен, :3080 не остановлен. Для текущей вкладки достаточно reload, повторный restart не требуется."
role: BACKEND
scope: ["plugins/**, profile/**, client bundle manifests и kit install/pack scripts, если причина в client-плагинах", "DSH 0.0.2.2 isolated server, boot logs, --dump-config и plugin activation state", "profile patch rows/groups, dropped or overridden web-app rows after upgrade", "targeted proof в реальном браузере и cleanup probe server/sessions"]
---

После перезагрузки на DSH 0.2.2-rc.3 Web UI сообщает «Failed to load plugins»: required dsh-client-ui-sidebar и dsh-client-ui-chat pending, многие client UI plugins ждут uiWorkspace/uiConversation/contextMenus/sidebarRight. Найти корневую причину в composition/profile после upgrade, исправить kit-конфигурацию или несовместимые client bundles, доказать чистое boot/UI и вернуть рабочий harness без ad-hoc отключения панелей.

Migrated from .dsh/taskboard.json (task task-mwevuviy-m3ygjp, revision 8).
