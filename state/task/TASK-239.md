---
id: TASK-239
kind: task
title: "Почистить список задач: синхронизировать статусы реестра с доской и закрыть заброшенные строки"
status: done
revision: 5
createdAt: 2026-11-18T14:51:12.080Z
updatedAt: 2026-11-18T14:58:56.527Z
acceptance:
  - text: "Доска и реестр не показывают open/active для задач, которые уже done/cancelled: статусы state/task совпадают с .dsh/taskboard.json по boardId"
    done: false
  - text: "Заброшенные строки (probe-1..5, старые задачи без владельца и ребёнка) переведены в cancelled с названной причиной и остаются в истории"
    done: false
  - text: "TASK-184 (документ для ревью) закрыт done с доказательством docs/HARNESS-OVERVIEW.md, если документ на месте; иначе cancelled с причиной"
    done: false
  - text: "Повторный прогон сверки не меняет байты; make verify exit 0"
    done: false
boardId: task-mwm8ob7c-wrbov3
chore: true
choreReason: "Владелец просит почистить список задач: в State много open/active, которые по факту не открыты — реестр отстал от таскборда, а старые задачи без владельца висят. Это гигиена доски, не новое требование."
inline: true
resultEvidence: ["node scripts/state-migrate.mjs --sync-status -> updated 22, unchanged 217; second run updated 0, unchanged 239 (idempotent)", "state/views/index.json statuses after sync: done 152, review 60, cancelled 22, open 3 (TASK-233, TASK-237, TASK-239), active 2 (TASK-236, TASK-238) — no stale done row reads as active", "11 abandoned rows cancelled in one ledger write (probe-1..5, old no-owner tasks); TASK-184 closed done with docs/HARNESS-OVERVIEW.md (645 lines) as evidence", "node --input-type=module replay -> true 0 mismatches; make verify -> exit 0 (17/17)"]
resultSummary: "Список задач очищен: state/task синхронизирован с доской по boardId (22 строки, повторный прогон 0), 11 заброшенных строк отменены с причиной, TASK-184 закрыт done по docs/HARNESS-OVERVIEW.md. Открытыми остались только реальные: TASK-233 (Codex вход), TASK-237 (state feed, другая сессия), TASK-236/238/239 (эта работа). Добавлен режим state-migrate --sync-status."
steps: ["Сверить state/task со статусами .dsh/taskboard.json и синхронизировать (режим --sync-status)", "Отменить заброшенные probe-1..5 и старые строки без владельца/ребёнка", "Закрыть TASK-184 done по docs/HARNESS-OVERVIEW.md или отменить с причиной", "Проверить повторный прогон и make verify"]
stepsDone: 4
---
