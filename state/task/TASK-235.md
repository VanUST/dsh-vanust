---
id: TASK-235
kind: task
title: "P5: правила скорости для всех корней, L0 для локальных правок, один кейс на пачку"
status: done
revision: 4
createdAt: 2026-11-18T12:54:05.793Z
updatedAt: 2026-11-18T12:54:13.048Z
acceptance:
  - text: "Корень на cordis получает общий раздел с «Batch the work»/«Answering is not work»; оркестратор — общий + свой; ребёнок — только CHILD_POLICY (тест на fake-контексте)"
    done: false
  - text: "ANALYSIS_POLICY содержит формулировку про L0-локальную правку и inline; L0 без analysisId проходит, L1/L2 без записи — нет"
    done: false
  - text: "Политика кейсов допускает один кейс на пачку REQ; case_gate пропускает задачу с тремя reqIds при одном verified automated кейсе"
    done: false
  - text: "make verify exit 0 (17/17 + документация); тесты плагинов зелёные"
    done: false
  - text: "Пересобраны ровно три тарбола (orchestrator, analysis, test-cases), версии подняты, соседние целы"
    done: false
boardId: task-mwm4hppu-n64d9m
nonScope: ["docs/analysis/*.json — правит только оркестратор", "живой :3080 и установленный профиль", "REQ-103 и TASK-226 — закрывает оркестратор", "схему кейса (reqId/reqIds) не менять"]
owner:
  kind: agent
  label: BACKEND
  sessionId: c787734e-ad4b-41fc-a357-2c496af2e4d4
preset: backend
reqIds: [REQ-118, REQ-119, REQ-120]
resultEvidence: ["policy-gating/policy-l0/batch-gate: 12/12 pass exit 0; контроли expect-pre-fix exit 1 ×3; все тесты трёх плагинов 37/37 — reports/p5/backend/{green,control-*,red-head-*}.log", "кейсы root-policy-is-common-plus-orchestrator-part (REQ-118), analysis-policy-names-the-l0-local-edit (REQ-119), one-case-may-prove-a-batch-of-requirements (REQ-120), register-batch-rule-is-closed (REQ-121): red→green, verified, linkedTaskId task-mwm4hppu-n64d9m", "REQ-103 → done (зеркало project-state-ecosystem rev 52); TASK-226 → done, reqIds [REQ-103], строка доски revision 10, mirror updated; кейс register-batch-rule-is-closed: снимок pre-fix-register exit 1/violations 2 → текущий реестр exit 0/0", "тарболы orchestrator 0.1.59, analysis 0.1.14, test-cases 0.1.16 (25→25, diff ровно три строки; текст политики найден в каждом)", "make verify: exit 0, 17/17 + documentation ok + glossary ok — reports/p5/backend/verify.log", "docs/analysis/speed-over-bureaucracy.json rev 3: 4 proven, 1 deferred (NFR1), completion ok"]
resultSummary: "Общая рабочая политика («Answering is not work», «Report once», «Batch the work») теперь рендерится любому корневому агенту, оркестратор-специфичная — только пресету orchestrator; политика анализа называет L0-локальную правку с границей контракт/архитектура/данные; политика кейсов перешла на «один кейс на принятое поведение», пачка REQ разрешена. REQ-103 и TASK-226 закрыты в реестре (найдена причина: строка V4.1 без reqId не зеркалилась). Три тарбола пересобраны, четыре кейса verified, make verify 17/17."
role: BACKEND
scope: ["plugins/orchestrator/orchestrator.mjs + test", "plugins/analysis/analysis.mjs + test", "plugins/test-cases/test-cases.mjs + test", "plugins/cc-dsh-orchestrator-*.tgz, plugins/cc-dsh-analysis-*.tgz, plugins/cc-dsh-test-cases-*.tgz", docs/cases/]
sessions:
  - sessionId: c787734e-ad4b-41fc-a357-2c496af2e4d4
    label: BACKEND
    role: BACKEND
    status: sleeping
steps: ["Разделить ROOT_POLICY на общую и оркестратор-специфичную части, рендерить общую всем корням", "Тест gating: cordis-корень видит общую часть, orchestrator — обе, ребёнок — CHILD_POLICY", "ANALYSIS_POLICY: формулировка L0 для локальной правки + тест поведения L0/L1", "test-cases: политика «один кейс на поведение», тест gate с тремя reqIds и одним кейсом", "Кейсы red→green, три тарбола, make verify"]
stepsDone: 0
---

Три правки политики. FR1: в @cc/dsh-orchestrator разделить ROOT_POLICY на общую часть (батчинг, скорость, «отчёт один раз», «вопрос — не работа») и оркестратор-специфичную (роли, делегирование, claim); общую рендерить любому корню, специфичную — только пресету orchestrator; убрать противоречие в шапке модуля. FR2: в ANALYSIS_POLICY (@cc/dsh-analysis) явно назвать L0-локальную правку: без записи анализа, без кейса на каждое требование, без делегации, inline; не расширять L0 на контракт/архитектуру/данные. FR3: в политике @cc/dsh-test-cases заменить «one case per observed requirement» на «один кейс на принятое поведение; один прогон может доказать несколько требований»; схему не менять. Тесты на fake-контексте (gating промпта; case_gate с задачей на три reqIds при одном verified automated кейсе); тарболы трёх плагинов; make verify.
