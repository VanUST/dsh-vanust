---
id: TASK-119
kind: task
title: "Реализовать analysis-before-decomposition"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.520Z
updatedAt: 2026-11-17T15:52:40.520Z
acceptance:
  - text: "Analysis Record сохраняет businessOutcome отдельно от requestedSolution, process, BR/FR/NFR, architecture/data/contracts/invariants, decisions, openQuestions, designRef и trace"
    done: false
  - text: "L1/L2 delegation без ready analysis отклоняется analysis_required; устаревший affected analysis отклоняется analysis_stale; L0 продолжает работать без полного документа"
    done: false
  - text: "analysis_check находит отсутствующие acceptance, component/data ownership, contract impact и unresolved trace, а не только валидирует JSON shape"
    done: false
  - text: "Каждый новый requirement change может получить impact до продолжения; завершение инициативы различает proven и explicitly deferred"
    done: false
  - text: "Доказаны red до реализации и green после, включая как минимум feature, mid-work change/conflict, new-chat reload и L0; даны команды/вывод/exit codes"
    done: false
  - text: "Отдельный сервер загружает новые bytes, тестовые writes выполняются только в его новый чат; :3080 PID/командная строка и live profile остаются неизменными"
    done: false
  - text: "make verify проходит; plugin source/tarball/profile/inventory согласованы; тестовый сервер и fixtures очищены, evidence сохранены"
    done: false
boardId: task-mwf3lroq-ii7skg
nonScope: ["Не перезапускать, останавливать, обновлять или переустанавливать пакеты текущего :3080 и live web profile", "Не делать push или final publish до отдельной задачи после review", "Не создавать новый UI, отдельную роль ANALYST или второй глобальный design store", "Не изменять taskboard schema/client или design-map layout: trace хранится только в Analysis Record, designMapRev является ссылкой", "Не вводить тяжёлый анализ для L0 вопросов/локальных исправлений", "Не добавлять analysis в orchestrator.inject: отсутствие сервиса должно сохранять legacy behavior"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 31b4473c-7383-4619-97e5-49f8b9c48a88
ownerRole: BACKEND
preset: backend
resultArtifacts: [plugins/analysis/analysis.mjs, plugins/analysis/store.mjs, plugins/orchestrator/orchestrator.mjs, scripts/analysis-before-decomposition-proof.mjs, plugins/cc-dsh-analysis-0.1.4.tgz, plugins/cc-dsh-orchestrator-0.1.43.tgz]
resultEvidence: ["Финальный proof 93/93 exit 0; red-round4 89/93 exit 1; meaningful mutation 91/93 exit 1", "make verify 17/17 + documentation ok; taskboard legacy proofs 26/26,27/27,15/15,13/13", "Real second server: analysis tools, live guard_denied task_close/update_goal и positive task_close done; :3080 PID 651458/profile sha256 9d11… неизменны", "Packages @cc/dsh-analysis 0.1.4 и @cc/dsh-orchestrator 0.1.43 byte-match source; owner cases rev10 verified и drift clean", "REVIEWER APPROVE task-mwf70qe5-m2ekae; CRITIC PASS task-mwf70qxo-7je7r2"]
resultSummary: "Реализован и независимо принят analysis-before-decomposition контур: repo-tracked Analysis Record, L0/L1/L2 gates, semantic impacts, append-only trace, CAS/fingerprint integrity, design-map reference, completion guards для task_close/update_goal, root-only tools и документация. Четыре итерации adversarial review устранили все подтверждённые обходы."
role: BACKEND
scope: ["Новый in-repo @cc/dsh-analysis plugin с versioned JSON store и root-only tools analysis_read/analysis_upsert/analysis_check/analysis_impact", "Минимальные изменения orchestrator/taskboard для analysisId, requirementIds, architectureImpact и gates в delegate_task/активации L1/L2 задач", "Инвентарь, profile composition, package tarball, README/USERGUIDE/DEPLOYMENT только в части нового контура", "Поведенческий proof с red-first и mutation/negative controls; docs/cases для наблюденных сценариев", "Изолированный второй DSH server через --patch и scratch source, новый тестовый чат/реальные tool calls; никаких writes в sessions :3080"]
---

Построить согласованный вертикальный срез бизнес- и системного анализа для root-оркестратора: repo-tracked docs/analysis/<initiative>.json с CAS/atomic writes и semantic fingerprint, машинная проверка полноты, proportional L0/L1/L2 delegation gates, трассировка requirement→process→component→task→evidence только в Analysis Record, связь с designMapRev и краткая root policy. Доказать поведение red-first, затем green, включая реальный отдельный DSH server; не публиковать до независимого review.

Migrated from .dsh/taskboard.json (task task-mwf3lroq-ii7skg, revision 27).
