---
id: TASK-133
kind: task
title: "Финальная атака schema 0.1.8"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.746Z
updatedAt: 2026-11-17T15:52:40.746Z
acceptance:
  - text: "Для каждого прежнего дефекта: FIXED или актуальный FAIL с output"
    done: false
  - text: "Подтвердить, что 129/129 ловит хотя бы одну mutation и valid paths не блокируются"
    done: false
  - text: "PASS/FAIL verdict и только реальные residuals; никаких новых пожеланий"
    done: false
boardId: task-mwj3cnu3-kp2gio
nonScope: ["Никаких production edits/live state/second server/:3080/commit/push", "Не расширять атаки за пределы уже найденных классов"]
owner:
  kind: agent
  label: CRITIC
  sessionId: 9f0a510f-2325-4a38-bdc5-c6bd060ba7d1
ownerRole: CRITIC
preset: critic
resultEvidence: ["node scripts/analysis-before-decomposition-proof.mjs → 129/129 exit 0 (/tmp/schema-baseline-018.log)", "/tmp/018-schema-loss-probe.out: limit_exceeded для всех лимитов, Unicode отказ без lone surrogate, duplicate+enum и process duplicate в первом ответе", "/tmp/018-attack.out: genuine 0.1.4 fingerprintMatches:true/legacy recognized, benign upsert ok, hand edit после migration refused", "/tmp/018-schema-ownership-probe.out: read warning, gate/link analysis_stale, ambiguous upsert refused; /tmp/018-limit-atomic.mjs: no new file, existing byteIdentical rev1", "Scratch mutation без limit guard → 125/129 exit 1 (/tmp/018-mutation.log); production не изменён"]
resultSummary: "Финальный CRITIC PASS для 0.1.8: все прежние silent-loss/Unicode, duplicate aggregate, ambiguous ownership и legacy fingerprint defects закрыты; 129/129 green, mutation 125/129 red, ошибки не пишут/не меняют bytes/rev."
role: CRITIC
scope: ["Запустить 129 baseline и существующие /tmp/schema-attack/review repros против current bytes", "Повторить ready/draft trace unlink, malformed, goal unlink, hand-edit rebase, stale CAS, non-last/last/batch, genuine legacy migration и canonical ownership", "Проверить одну meaningful mutation на scratch и отсутствие записи при любых ошибках"]
sessions:
  - sessionId: 9f0a510f-2325-4a38-bdc5-c6bd060ba7d1
    label: CRITIC
    role: CRITIC
    status: sleeping
---

Повторить все прежние атаки против 0.1.8 и убедиться, что silent loss, duplicate aggregation, ambiguous gate/link и legacy fingerprint defects закрыты. Не искать новые классы; дать короткий regression verdict и доказательства.

Migrated from .dsh/taskboard.json (task task-mwj3cnu3-kp2gio, revision 6).
