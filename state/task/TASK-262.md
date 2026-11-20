---
id: TASK-262
kind: task
title: "Таскборд: закрытие с мёртвым ребёнком, один писатель доски, повтор зеркала"
status: done
revision: 4
createdAt: 2026-11-20T11:51:03.072Z
updatedAt: 2026-11-20T12:27:09.799Z
boardId: task-mwox49d1-p0sybd
nonScope: ["Не трогать ~/.npm/dsh (живой профиль :3080), не перезапускать сервер", "Не менять формат .dsh/taskboard.json и схему задач", "Не менять проекцию выдачи, установщики и скрипты проверок — это другие задачи", "Не менять интерфейс панели Tasks"]
owner:
  kind: agent
  label: BACKEND
  sessionId: b7988253-9132-4916-b9ed-071df53ecd72
preset: backend
reqIds: [REQ-173, REQ-174]
resultEvidence: ["node --test board-lock.test.mjs -> 4/4 exit 0; CASE_NEGATIVE_CONTROL=expect-pre-fix -> pass 1 / fail 3, exit 1 ('23 task(s) were lost by the two-process write; the board kept 27 of 50')", "node --test dead-child-close.test.mjs -> 5/5 exit 0; CASE_NEGATIVE_CONTROL=expect-pre-fix -> pass 3 / fail 2, exit 1 (interrupt_failed 'Cannot read properties of undefined (reading id)')", "case_run red -> green для обоих кейсов: verified rev 5 (runId mwoyco43-m4b81-1, mwoycp9a-rp9am-1)", "make test 70/70 exit 0; check-portability 19/19"]
resultSummary: "Таскборд: живость ребёнка берётся у runtime — мёртвый ребёнок освобождает задачу и закрытие больше не отказывает interrupt_failed; доска пишется под каталогом-локом с ожиданием и temp+rename; зеркало повторяется с backoff и сверяется при старте. Оба дефекта доказаны стандартным негативным контролем (CASE_NEGATIVE_CONTROL=expect-pre-fix грузит копию модуля из git HEAD) и подтверждены прогонами red→green."
role: BACKEND
scope: ["plugins/taskboard/** (сервис, mirror, тесты)", "plugins/orchestrator/orchestrator.mjs — только если нужна проверка живости ребёнка при закрытии", "plugins/cc-dsh-taskboard-*.tgz, plugins/cc-dsh-orchestrator-*.tgz (перепаковка)"]
sessions:
  - sessionId: b7988253-9132-4916-b9ed-071df53ecd72
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Закрыть два отказа таскборда, не меняя формат данных и интерфейс. (ФР2) Задача с мёртвым ребёнком должна закрываться: определять живость ребёнка по процессу/рантайму, а не по приходу subagent/end; если ребёнок исчез, закрытие проходит как обычно (ребёнок помечается завершённым, роль освобождается), без флага force и без потери приёмки; плюс сверка при загрузке доски осаживает active-задачи с исчезнувшими детьми. (ФР3) Один писатель доски: запись .dsh/taskboard.json через temp+rename под кросс-процессной блокировкой (каталог-лок O_EXCL со stale-таймаутом и ожиданием), второй процесс ждёт и не затирает файл; зеркало в реестр состояния получает повтор с backoff и сверку при старте. Доказать: node --test с двумя реальными процессами (spawn) — оба пишут, обе задачи на месте; тест закрытия с «мёртвым» ребёнком; негативный контроль на коде до правки (оба теста падают). Перепаковать плагин с подъёмом версии.
