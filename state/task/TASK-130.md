---
id: TASK-130
kind: task
title: "Attack Analysis Record validation"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.697Z
updatedAt: 2026-11-17T15:52:40.697Z
acceptance:
  - text: "Для каждого подтверждённого дефекта: минимальный repro, фактический output/exit code, path:line и нарушенный инвариант"
    done: false
  - text: "Отдельно перечислить неудавшиеся атаки и valid inputs, которые не блокируются"
    done: false
  - text: "Доказать минимум одну meaningful mutation red; не выдавать PASS count за полноту"
    done: false
  - text: "Вернуть PASS/FAIL и только реальные blockers/high-value residuals"
    done: false
boardId: task-mwj2n7qm-hhnvcd
nonScope: ["Никаких production edits, live data/cases/tasks/profile, второго сервера или :3080", "Не исправлять код, не делать commit/push и не выходить за пределы analysis schema/validation"]
owner:
  kind: agent
  label: CRITIC
  sessionId: 9f0a510f-2325-4a38-bdc5-c6bd060ba7d1
ownerRole: CRITIC
preset: critic
resultEvidence: ["node /tmp/schema-attack/attack.mjs: title 250→200, requestedSolution 8100→8000, successMetrics 25→20, acceptance 35→30 с ok:true; 4001 code unit → lone high surrogate", "Genuine 0.1.4 fixture: read ok + fingerprintMatches:false; gate/linkTask analysis_stale; benign upsert fingerprint_mismatch до acceptHandEdit", "Duplicate-after-trim + independent enum: первый ответ только invalid_enum, следующий открывает duplicate id без findings[]; current/target duplicate P-1 аналогично", "Baseline 107/107 exit 0; mutations unknown-key и ownership_conflict → 106/107 exit 1; atomicity/ownership/negative controls green", "/tmp/schema-attack/attack.out, sweep.out, mutation-m1/m2 logs; production не изменён"]
resultSummary: "CRITIC FAIL для 0.1.7: silent truncation нарушает INV-NO-LOSS и может резать Unicode surrogate; genuine 0.1.4 record после upgrade получает ложный fingerprint_mismatch и блокирует gate/linkTask/upsert; trim-aware и cross-process duplicate id не входят в aggregate validation. Strict unknown/type/reference и ownership paths в остальном работают."
role: CRITIC
scope: ["Unknown keys на всех nested уровнях, wrong types, invalid enums, пустое содержимое, Unicode/whitespace, duplicate ids, dangling references", "Aggregate error coverage и byte/rev atomicity на new/existing records", "Canonical/legacy ownership conflict, multiple owners, ambiguous read→write/gate/linkTask, derived owns и fingerprint stability", "Прежние trace/goal/malformed/CAS/completion attacks и meaningful mutations на scratch"]
---

Атаковать @cc/dsh-analysis 0.1.7 на disposable fixtures: попытаться записать потерянные/неверные данные, получить частичную запись, обойти ownership/impact/completion или заставить valid input отклоняться. Проверить, что новые 107 checks действительно ловят реальные мутации.

Migrated from .dsh/taskboard.json (task task-mwj2n7qm-hhnvcd, revision 7).
