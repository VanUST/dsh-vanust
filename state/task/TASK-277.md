---
id: TASK-277
kind: task
title: "P0: независимое ревью происхождения доказательства"
status: done
revision: 5
createdAt: 2026-11-22T10:54:24.932Z
updatedAt: 2026-11-22T11:15:32.033Z
acceptance:
  - text: "Все заявленные команды перезапущены, вывод и коды возврата приложены; расхождение с отчётом названо"
    done: false
  - text: "Минимум шесть обходов воспроизведены самостоятельно, а не только через proof-скрипт; независимый прогон проходит"
    done: false
  - text: "Проверены fail-closed, legacy, testHash, runBy, author-immutability, manual/measured и передача implementerPreset из taskboard"
    done: false
  - text: "Нет P1 scope creep, живого профиля и правок docs/cases; версии/тарболы совпадают"
    done: false
  - text: "Дефекты названы с file:line,severity и точной репродукцией; отдельно сказано, что не проверено"
    done: false
boardId: task-mwrpz79i-hngkiv
nonScope: ["не править код, тесты, README и файлы кейсов", "не трогать живой профиль ~/.npm/dsh/profiles/web, :3080 и production data", "не реализовывать P1/P2 (пресет TESTER, proof-guard, task contract)", "не переписывать существующие docs/cases/*.json"]
owner:
  kind: agent
  label: REVIEWER
preset: reviewer
reqIds: [REQ-185, REQ-186, REQ-187, REQ-188, REQ-193]
resultEvidence: ["node --test plugins/test-cases/test/*.test.mjs → 44 pass, exit 0", "node --test plugins/taskboard/test/*.test.mjs → 31 pass, exit 0", "make test → 76/76, exit 0; make verify → 19/19, exit 0", "node scripts/independent-verification-proof.mjs → 14/14, exit 0", "D1 repro: truncated docs/cases/<id>.json → CLI gate exit 0 with CASE_UNREADABLE; taskboard close ok; до порчи — cases_not_green", "D2: make cases 36/36 skipped, exit 1, но CLI печатает PASS для пропущенных"]
resultSummary: "Независимое ревью P0 завершено: заявленные прогоны воспроизведены (44/44, 31/31, make test 76/76, make verify 19/19, proof 14/14), контракт подтверждён на 9 самостоятельно воспроизведённых обходах. Найден fail-open D1 (нечитаемый кейс не блокирует закрытие) и D2-D7; код не правился."
role: REVIEWER
scope: [plugins/test-cases/lib/acceptance.mjs, plugins/test-cases/lib/schema.mjs, plugins/test-cases/lib/runner.mjs, plugins/test-cases/test-cases.mjs, plugins/test-cases/bin/cases.mjs, plugins/test-cases/README.md, plugins/test-cases/test/independent-verification.test.mjs, "plugins/test-cases/test/*.test.mjs", plugins/taskboard/taskboard.mjs, plugins/taskboard/test/case-gate-preset.test.mjs, scripts/independent-verification-proof.mjs, docs/TERMINOLOGY.md, docs/analysis/independent-verification.json]
---

Независимо проверить P0: кейс записывает автора и исполнителя прогона из сессии, ручное наблюдение не подтверждает автоматический кейс, оракул и тест защищены, task_close отказывает самопроверке. Отчёт исполнителя — утверждение, а не доказательство: перезапусти команды, прочитай изменение и найди дефект, который заденет следующую задачу. Ничего не правь — маршрут исправлений у оркестратора.
