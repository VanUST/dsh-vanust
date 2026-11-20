---
id: TASK-266
kind: task
title: "Проверка компакции: общий бюджет и объявленное исключение architect"
status: done
revision: 4
createdAt: 2026-11-20T12:19:56.483Z
updatedAt: 2026-11-20T12:24:40.442Z
boardId: task-mwoy5gy1-zw96f6
nonScope: ["Не менять profile/cordis.patch.yml и бюджет роли architect", "Не ослаблять проверки общих групп: 1M → 0.5 окна, 272K → 0.8 окна, и обе выше 136K", "Не трогать ~/.npm/dsh и :3080", "Не менять другие кейсы и proof-скрипты"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-131]
resultEvidence: ["node scripts/context-bounds-proof.mjs -> PASS 29 checks exit 0 (до: FAIL 26, три красные проверки компакции)", "CASE_NEGATIVE_CONTROL=pre-change -> exit 1: общие проверки падают (1M=0, 272K=136 000), изолированная 136 000 проходит", "метрики: compactionGeneral1M=524288, compactionGeneral272K=217600, compactionIsolated272K=136000, isolatedBlocks=1", "кейс: red exit 1 -> green exit 0, verified rev 7, 16/16 checks; make test 70/70 exit 0"]
resultSummary: "Проверка компакции разделена на общий бюджет (9 блоков: 1M -> 524 288, 272K -> 217 600) и объявленное исключение preset-architect (136 000, ровно одно); тихая вторая исключительная группа теперь ломает прогон, значение исключения запиновано."
role: BACKEND
scope: [scripts/context-bounds-proof.mjs, "docs/cases/context-bounds-hold-projection-paging-allow-row-compaction.json (запись прогонов)", "docs/cases/runs/ — артефакты прогонов"]
---

Сделать проверку компакции честной к фактическому контракту: общие группы compaction-basic идут по бюджету от окна, а изолированная группа preset-architect — объявленное исключение с фиксированным значением. В scripts/context-bounds-proof.mjs разделить метрики: общие блоки (все compaction-basic, кроме изолированной группы architect) и изолированные блоки; проверки: общая группа на 1M даёт 0.5 окна (524 288, окно 480 000..540 000), на 272K — 0.8 окна (217 600, в диапазоне 136 001..218 000); изолированная группа architect на 272K ровно 136 000 при 0.5; число изолированных групп ровно 1 — новая тихая исключительная группа должна ломать проверку. Метрики вывести в CASE_SUMMARY; в кейсе обновить checks под эти метрики (включая compactionIsolated272K == 136000 и isolatedBlocks == 1). Прогнать: `node scripts/context-bounds-proof.mjs` — exit 0; `CASE_NEGATIVE_CONTROL=pre-change` — exit 1 (доказывает, что проверка умеет падать); затем `case_run` red→green для кейса, чтобы он снова стал verified с измеренной парой; и полный `make test` — exit 0.
