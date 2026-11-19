---
id: TASK-095
kind: task
title: "design_map v2: формы, слои-контейнеры, заголовок и подписи на стрелках"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.185Z
updatedAt: 2026-11-17T15:52:40.185Z
acceptance:
  - text: "write/upsert с kind и layers создаёт сцену, где формы, ленты, заголовок и подписи стрелок видны в реальном Excalidraw-фрейме"
    done: false
  - text: "сцена без слоёв раскладывается как раньше (регрессия по dense/cyclic/multiline)"
    done: false
  - text: "валидатор отказывает с устойчивым кодом, если узел вне слоя, слой на слое, подпись не влезает"
    done: false
  - text: "подпись ребра и заголовок переживают перечитывание сцены (deriveMap возвращает их обратно)"
    done: false
boardId: task-mwc8jac0-zzro1j
inline: true
nonScope: ["client.frame.js — вендоренный бандл не пересобирается", "живой design.excalidraw в корне — не переписываю без явного согласия", "PROFILE и :3080 — не трогаю"]
resultArtifacts: [plugins/design-map/layout.js, plugins/design-map/index.js, plugins/design-map/preview.js, reports/design-map-v2/EVIDENCE.md]
resultEvidence: ["node reports/design-map-v2/cases.mjs -> 76 PASS, 0 FAIL, exit 0 (includes K1-K6 for the review findings)", "node reports/design-map-layout/validator-cases.mjs -> all assertions passed (unlayered regression)", "reviewer repros re-run against the fixed bytes: remove cleans ellipse/diamond bindings; one label per rebuilt edge; remove(['layer:x']) refused with layer_id; a hand-deleted band is rebuilt; a read no longer reports an undrawn title", "reports/design-map-v2/fixtures.log: live map rev 28 health 4 issues -> rev 29 health ok after one layout (legacy title migrated onto the canvas)"]
resultSummary: "design-map v2 scene model is in: node kinds render as rectangle/ellipse/diamond/dashed-rectangle with bound editable labels; layers are titled locked bands (lanes×stage grid) that a node names; the title and edge labels are now real elements instead of silently stored data; band-aware validation reports clipping, overlap, edge crossings, member-outside-band and foreign-in-band; upserts keep every existing node and band in place, and only defects the call introduced are refused. An independent REVIEWER pass found six defects (shape bindings on remove/health, duplicated human flow labels, band removal dead end, two title truths, ignored layer order); all six are fixed and covered by regression cases K1–K6."
scope: [plugins/design-map/layout.js, plugins/design-map/index.js]
---

Расширить модель сцены design-map так, чтобы принятый вход всегда был виден: узел получает kind (service/store/decision/external → прямоугольник/эллипс/ромб/пунктир), карта получает слои-контейнеры (ленты с подписью, члены двигаются вместе), заголовок рисуется на канвасе, подпись ребра становится настоящим bound-текстом у стрелки. Раскладка становится grid lane×rank, когда слои заданы; без слоёв прежний rank-layout не меняется. Валидация: подпись внутри формы, узел внутри своего слоя, слои не пересекаются, чужие блоки не стоят в слое.

Migrated from .dsh/taskboard.json (task task-mwc8jac0-zzro1j, revision 5).
