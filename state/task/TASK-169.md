---
id: TASK-169
kind: task
title: "Карта дизайна: документы, кейсы и упаковка"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.377Z
updatedAt: 2026-11-17T15:52:41.377Z
acceptance:
  - text: "README плагина, docs/designmap/SCENE-CONTRACT.md и USERGUIDE описывают новый путь загрузки, привязку стрелок, легенду, авто-постановку и правку подписи"
    done: false
  - text: "В docs/cases записано не меньше пяти требований владельца со статусом unverified и привязкой к задачам"
    done: false
  - text: "Пакет пересобран, tarball cc-dsh-designmap-0.1.16.tgz и версия обновлены; :3081 загружает его без ошибок, :3080 остаётся на 0.1.15 и получит новый пакет при следующем запуске (kit-update), потому что живой сервер не перезапускается"
    done: false
  - text: "Изменения закоммичены (396d8ef) с сообщением, объясняющим причину, и запушены в origin/main"
    done: false
boardId: task-mwkidrjh-7j0e8q
inline: true
nonScope: ["Код панели и хоста — отдельные задачи", "Живой сервер :3080"]
resultEvidence: ["plugins/designmap/README.md, docs/designmap/SCENE-CONTRACT.md, USERGUIDE.md обновлены", "docs/cases/design-map-*.json — 5 кейсов (source human, unverified)", "plugins/cc-dsh-designmap-0.1.16.tgz sha256 13e4933f5a59d6f4c04de4d30de61b087dbcae7e1ea69f94c302693319496b1f; версия в package.json 0.1.16", "git commit 396d8ef, git push origin main -> f530cfe..396d8ef", "живой :3081 (overlay) грузит 0.1.16: панель показывает «Edit map»/«Labels»"]
resultSummary: "Документация обновлена, пять требований владельца записаны кейсами, пакет пересобран и упакован как @cc/dsh-designmap 0.1.16 (sha256 13e4933f…), изменения закоммичены (396d8ef) и запушены в origin/main. Живой :3080 не перезапускался и остаётся на 0.1.15; при следующем запуске kit-update поставит 0.1.16."
scope: [plugins/designmap/README.md, docs/designmap/SCENE-CONTRACT.md, docs/cases/, "plugins/designmap/package.json, tarball, scripts/pack-plugin.mjs", "git commit и push"]
---

Зафиксировать изменение: обновить документацию плагина и контракт сцены, записать требования владельца как кейсы в docs/cases, пересобрать и упаковать новый пакет @cc/dsh-designmap, закоммитить и запушить.

Migrated from .dsh/taskboard.json (task task-mwkidrjh-7j0e8q, revision 3).
