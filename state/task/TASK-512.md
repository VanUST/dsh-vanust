---
id: TASK-512
kind: task
title: "Ворота в установленной сборке: прогон четырёх входов"
status: done
revision: 4
createdAt: 2026-11-28T18:40:43.508Z
updatedAt: 2026-11-28T18:44:22.835Z
boardId: task-mx0r9zek-ibsfqg
chore: true
choreReason: "Нужно доказать, что ворота архитектурной консультации работают в УСТАНОВЛЕННОЙ сборке 0.1.87, а не только в исходнике: это и есть проверка «правило в ките ≠ правило в силе»."
nonScope: ["Не менять код и профиль.", "Не перезапускать сервер."]
owner:
  kind: agent
  label: BACKEND
  sessionId: cb9ebcbb-b716-4ef9-a4b0-21f5da23a770
preset: backend
resultEvidence: ["Установленный оркестратор байт в байт равен исходнику: SHA256 E2B0F90E… у обоих; версия 0.1.87; store.mjs анализа тоже совпадает (C20AF399…).", "Вход 1 (L2 + флаг, запись без ARCH-): отказ architect_consult_required, задач 0, детей 0.", "Вход 2 (флаг без changeClass): тот же отказ, задач 0, детей 0. Вход 3 (L2 без флага): проходит, задача и ребёнок созданы. Вход 4 (L2 + флаг, запись с ARCH-1): проходит.", "Прогон .tmp/installed-gate-proof/prove-installed-gate.mjs exit 0; delegate_task получен из реестра после apply и agent/created, реальные задачи не писались."]
resultSummary: "Ворота доказаны в установленной сборке, а не только в исходнике: файл совпадает байт в байт, четыре входа дают ожидаемые коды — флаг без класса и L2 с флагом отказывают, L2 без флага и запись с ARCH-1 проходят."
role: BACKEND
scope: [.tmp/installed-gate-proof/]
sessions:
  - sessionId: cb9ebcbb-b716-4ef9-a4b0-21f5da23a770
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Докажи, что установленная сборка оркестратора 0.1.87 содержит ворота архитектурной консультации. Установленное лежит в C:\Users\1\.dsh\profiles\web\node_modules\@cc\dsh-orchestrator. Сделай прогон через путь плагина: подними установленный модуль, найди инструмент делегирования, подставь шлюз доски, который считает вызовы, и сервис анализа, читающий docs/analysis. Проверь четыре входа: (1) changeClass L2 + architectureImpact true на записи без решения ARCH- → отказ architect_consult_required, задач 0; (2) то же с флагом и без changeClass → тоже отказ; (3) L2 без флага → проходит, задача создаётся; (4) architectureImpact true на записи, где решение ARCH-1 уже есть (architect-gate-and-plan-view) → проходит. Приложи по строке на вход и коды. Верни: ведёт ли установленная сборка себя как исходник, вывод по четырём входам, коды.
