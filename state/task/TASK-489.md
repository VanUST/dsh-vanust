---
id: TASK-489
kind: task
title: "Ворота: L2 с architectureImpact без решения архитектора не стартует"
status: done
revision: 6
createdAt: 2026-11-28T17:34:21.951Z
updatedAt: 2026-11-28T17:38:22.007Z
boardId: task-mx0own6u-l6enc4
nonScope: ["Не менять условие приёмки и правила доски.", "Не требовать консультации для L0/L1 и для L2 без architectureImpact."]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-308]
resultEvidence: ["Отказ architect_consult_required: L2+architectureImpact без решения ARCH- в записи анализа; текст отказа перечисляет, что записать (решение, обоснование, отвергнутые варианты, компоненты, инварианты, проверки, путь отката).", "End-to-end на реальных сервисах: L2+impact → отказ, строк 0 и детей 0; L1 → ok, 1 строка и 1 ребёнок; L0 → ok.", "Тест architect-consult-gate.test.mjs 7/7 exit 0; на копии модуля до правки 3/7 fail 4, exit 1; кейс red mx0p0dzj-wsntq-1 и green mx0p0i4i-x78rw.", "Наборы orchestrator 56/56 и analysis 13/13."]
resultSummary: "Правило DEC-002 получило ворота: L2 с architectureImpact без решения архитектора (id ARCH-) в записи анализа не стартует, отказ говорит, что записать; L0/L1 и L2 без impact ведут себя как раньше."
role: BACKEND
scope: [plugins/orchestrator/orchestrator.mjs, plugins/orchestrator/test/]
---

Закрой разрыв из пункта (б): правило DEC-002 требует консультации архитектора при архитектурном изменении, но ничего не проверяет. Сделай: (1) в воротах delegate_task: если changeClass L2 и architectureImpact true, а в записи анализа нет записанной консультации архитектора — отказ с кодом (например architect_consult_required) и сообщением, которое говорит, что записать: решение с компонентами, инвариантами, проверками и путём отката; (2) выбери форму записи консультации из существующей схемы (запись анализа уже держит decisions с id/decision/rationale/alternatives — например id с префиксом ARCH-) и опиши её в сообщении отказа и в политике одной строкой; (3) докажи прогоном: L2 с architectureImpact без решения — отказ; с решением — проходит; L0 и L1 — как раньше; (4) добавь строку в политику, чтобы оркестратор знал правило до отказа. Верни коды, тексты отказа и что осталось.
