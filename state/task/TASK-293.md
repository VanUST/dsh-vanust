---
id: TASK-293
kind: task
title: "P2: task contract, verification level, критерии и покрытие только для independent"
status: done
revision: 5
createdAt: 2026-11-22T19:42:37.271Z
updatedAt: 2026-11-22T19:59:44.964Z
acceptance:
  - text: "task_create/delegate_task принимают criteria, constraints, verification; task_get и бриф показывают тот же контракт backend/tester/reviewer"
    done: false
  - text: "case_record принимает criterionId; case_gate возвращает покрытие; independent с непокрытым критерием не закрывается"
    done: false
  - text: "proof/case закрываются без кейса; L0/L1 не получают обязательный TESTER/REVIEWER/CRITIC"
    done: false
  - text: "BR1: происхождение доказательства видно; самопроверка не закрывает"
    done: false
  - text: "P0/P1-поведение, тесты, make test, make verify, proof зелёные; тарболы; живой профиль/:3080 не тронуты"
    done: false
  - text: "Документация и термины согласованы; миграция существующих задач/кейсов не блокирует чтение"
    done: false
boardId: task-mws8uh2x-uqkuuf
nonScope: ["живой профиль ~/.npm/dsh/profiles/web и :3080; живой пилот P1 — отложен владельцем", "P1 preset/proof-guard/test-cases realism/wrong-product red — не откатывать", "journal/signature B1/B1' — отдельная задача", "существующие docs/cases не переписывать; migration только читаемость", "L0/L1 не должны получать обязательный кейс/тестировщика/ревью"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-184, REQ-192]
resultEvidence: ["reviewer: independent no criteria -> CRITERIA_REQUIRED; with criteria no cases -> CRITERIA_UNCOVERED coverage AC-1/AC-2; proof/case -> ok:true; unverified case covers false; contractBlock one role-agnostic text", "taskboard 0.1.75: verification-contract.test.mjs 7; taskboard 44/44; test-cases 67/67; orchestrator 17/17; make test 82/82; make verify 19/19; proof 29/29", "tarballs taskboard 0.1.75, test-cases 0.1.33, orchestrator 0.1.66 match", "analysis independent-verification rev 38: BR1/FR8 deferred with reason; FR7 planned for live pilot", "live profile mtime 09:47, :3080 untouched"]
resultSummary: "P2 принят независимым ревью (PASS). Task contract: verification proof|case|independent, criteria с id, constraints; одинаковый contractBlock в брифе backend/tester/reviewer. Для independent task_close требует покрытия каждого критерия (CRITERIA_REQUIRED/CRITERIA_UNCOVERED с coverage); proof/case закрываются без кейса. case_record сохраняет criterionId; непринятый кейс критерий не покрывает. Версии taskboard 0.1.75, test-cases 0.1.33, orchestrator 0.1.66; make test 82/82, make verify 19/19, proof 29/29. Один REVIEWER проверил P2 и пакетное ревью; P2 PASS, batch FAIL отдельным вердиктом. BR1/FR8 переведены в deferred с причиной; живой профиль не тронут."
role: BACKEND
scope: ["plugins/taskboard/taskboard.mjs + tests: task fields criteria [{id,text}], verification proof|case|independent, constraints; task_create/task_update; task_get; task_close coverage for independent; store in .dsh/taskboard.json", "plugins/orchestrator/orchestrator.mjs + tests: delegate_task params criteria/constraints/verification; task contract block in renderBrief for backend/tester/reviewer; policy text L0 proof, L1 case, L2/risk independent; role catalog; no full cycle for proof/case", "plugins/test-cases/test-cases.mjs + lib: case_record criterionId; case_get; case_gate coverage per criterion; task_close bridge; existing cases readable (no criterion), independent uncovered refuses", "docs/TERMINOLOGY.md: task contract/verification level/criterion coverage terms; README/DEPLOYMENT if policy; check-documentation/glossary", "tests: proof task closes without case; independent with uncovered criterion refuses; independent with case criterion passes; L0/L1 no case; no regression P0/P1", "package versions/tarballs: taskboard, orchestrator, test-cases; make test, make verify, proof"]
---

Реализовать P2: task contract с уровнем проверки proof | case | independent и критериями приёмки с id; тот же блок в брифе исполнителя, тестировщика и ревьювера; кейс привязывается к criterionId, а task_close требует покрытия каждого критерия только для задачи уровня independent. Для proof и case кейс не обязателен, отсутствие кейса не блокирует закрытие; L0/L1 остаются лёгкими, полный цикл TESTER/REVIEWER/CRITIC не обязателен без риск-триггера. BR1: владелец видит происхождение доказательства, самопроверка не закрывает. P1-поведение и P0/P1-гейты не ломать; живой профиль и :3080 не трогать; пилот P1 отложен.
