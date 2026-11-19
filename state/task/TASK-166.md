---
id: TASK-166
kind: task
title: "Карта дизайна: сцена с слоем настроек и правка подписи на хосте"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.323Z
updatedAt: 2026-11-17T15:52:41.323Z
acceptance:
  - text: "Команда views возвращает для каждого вида сцену с применёнными overlays и отчётом проверки, файлы out/ при этом не перезаписываются"
    done: false
  - text: "overlay upsert с позицией поверх другого узла возвращает скорректированные x/y и замечание; в overlays.json меняется только строка этого узла; отрицательных координат нет"
    done: false
  - text: "Команда label меняет подпись узла или ребра в model.yaml через apply; пустая подпись ребра отклоняется с кодом и файлы остаются байт-идентичными"
    done: false
  - text: "node --test test/*.test.mjs проходит; новые тесты падают без правки и проходят с ней"
    done: false
boardId: task-mwkidjih-78jzrk
inline: true
nonScope: ["Клиентская панель (client/, view.jsx, canvas.jsx) — отдельная задача", "Схема модели (model.yaml/views.yaml) и формат сцены не меняются", "Порты, протокол транспорта и profile/ не трогаются"]
resultEvidence: ["node --test test/*.test.mjs -> 125/125 pass (13:0x)", "test/host-edit-loop.test.mjs: 5 тестов — views с overlays без записи out/ (концы рёбер на границе), авто-постановка (в т.ч. один только x), label через apply, отказ пустой подписи с байт-идентичными файлами", "src/overlays.mjs findFreeSpot/boxesWithinGap; src/host.mjs panelViews/label/autoPlace; src/command.mjs ops views/label", "git commit 396d8ef"]
resultSummary: "Хост карты дизайна получил три вещи: операцию команды `views`, которая рендерит каждый вид с текущим слоем настроек и ничего не пишет в out/; операцию `label`, которая правит подпись узла или ребра через apply (пустая подпись ребра — missing_edge_label, файлы байт-идентичны); авто-постановку в overlay upsert: узел, брошенный на другой узел, ставится в ближайшее свободное место (обе оси, одноосевой drag тоже), возвращаются row/before/adjusted/finding. Всё покрыто тестами."
scope: ["plugins/designmap/src/host.mjs — операции views и label, авто-постановка в overlay", "plugins/designmap/src/command.mjs — диспетчеризация новых операций", "plugins/designmap/src/overlays.mjs — поиск ближайшего свободного места", "plugins/designmap/test/* — тесты новых операций и авто-постановки"]
---

Хост карты дизайна отдаёт панели сцены, уже отрендеренные с временным слоем настроек (designmap/overlays.json), одной операцией команды; правка слоя, ставящая узел на другой узел, автоматически переносит его в ближайшее свободное место и сообщает об этом; человек может править подпись узла или ребра операцией команды, которая идёт в apply и при отказе не меняет файлы. Всё покрыто тестами хоста и command.

Migrated from .dsh/taskboard.json (task task-mwkidjih-78jzrk, revision 5).
