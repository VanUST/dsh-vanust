---
id: TASK-196
kind: task
title: "P0: закоммитить целостность кита"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.958Z
updatedAt: 2026-11-17T15:52:41.958Z
acceptance:
  - text: "Коммит содержит только P0-работу: профиль, два плагина политики, designmap/analysis, скрипты доказательств, документы, тарболы, запись анализа и кейсы"
    done: false
  - text: "`git status` после коммита чистый; `make verify` exit 0"
    done: false
boardId: task-mwkp4lnf-jj81j0
inline: true
nonScope: ["push в удалённый репозиторий — отдельное решение владельца", "публикация в профиль ~/.npm/dsh и перезапуск :3080"]
resultEvidence: ["git log --oneline -1 → 1c6b22c Close the P0 integrity findings before the state ecosystem", "git status --short → пусто", "make verify на том же содержимом → exit 0 (17/17 + documentation ok)"]
resultSummary: "P0 зафиксирован одним коммитом 1c6b22c: профиль, tool-families 0.1.10, orchestrator 0.1.52, designmap 0.1.19, analysis 0.1.10, скрипты доказательств, документы, запись анализа и два кейса приёма. Рабочее дерево чистое. Push не делался — отдельное решение владельца."
scope: ["git add -A и один коммит с сообщением о четырёх закрытых находках P0"]
---

Зафиксировать завершённый P0 одним коммитом, чтобы рабочее дерево не оставалось в смешанном состоянии (старые тарболы удалены, новые не отслеживаются).

Migrated from .dsh/taskboard.json (task task-mwkp4lnf-jj81j0, revision 4).
