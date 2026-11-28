---
id: TASK-275
kind: task
title: "Запись анализа независимой проверки и карта дизайна"
status: done
revision: 4
createdAt: 2026-11-22T10:31:21.199Z
updatedAt: 2026-11-22T10:31:35.822Z
acceptance:
  - text: "analysis_read independent-verification показывает status ready и 11 требований"
    done: false
  - text: "analysis_check independent-verification проходит readiness с 0 error"
    done: false
  - text: "designmap/manifest.json содержит rev 31 и узлы plug.test-cases, db.cases, plug.proof-guard"
    done: false
  - text: "REQ-184..REQ-194 существуют и связаны с записью"
    done: false
boardId: task-mwrp5jos-98iz2k
inline: true
nonScope: ["plugins/test-cases/* — реализация P0 будет отдельной задачей", "profile/cordis.patch.yml — пресет TESTER относится к P1", "живой профиль ~/.npm/dsh/profiles/web и :3080"]
reqIds: [REQ-184, REQ-185, REQ-186, REQ-187, REQ-188, REQ-189, REQ-190, REQ-191, REQ-192, REQ-193]
resultArtifacts: [docs/analysis/independent-verification.json, designmap/model.yaml, designmap/manifest.json]
resultEvidence: ["docs/analysis/independent-verification.json rev 3, status ready, readiness ok (0 errors)", "analysis_read: 11 requirements, 11 trace rows, 8 decisions, 6 components", "designmap/manifest.json rev 31, commit bd7f9b6d859a1d6b0953acabc1c43f7f6d2b323c", "REQ-184..REQ-194 созданы зеркалом анализа (reqMirror ok, 0 errors)"]
resultSummary: "Запись анализа independent-verification создана и переведена в ready: 11 требований, 8 решений, 6 компонентов, 11 строк трассировки; карта дизайна обновлена до rev 31 узлами plug.test-cases, db.cases, plug.proof-guard и связями с оркестратором, таскбордом и host."
scope: [docs/analysis/independent-verification.json, designmap/model.yaml, designmap/manifest.json]
steps: ["Создать запись анализа с требованиями и трассировкой", "Проверить readiness и получить REQ-идентификаторы", "Обновить карту дизайна и записать designRef", "Перевести запись в ready"]
stepsDone: 4
---

Зафиксировать инициативу independent-verification: бизнес-результат, требования P0/P1/P2, архитектуру, данные, контракты, инварианты и решения; обновить карту дизайна узлом библиотеки кейсов и связями с оркестратором, таскбордом и guard-ом записи. Запись должна пройти analysis_check как ready и дать REQ для делегирования.
