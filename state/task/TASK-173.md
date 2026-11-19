---
id: TASK-173
kind: task
title: "Ревью: удаление Headroom, сужение раздела RTK, правило чтения инструментами"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.450Z
updatedAt: 2026-11-17T15:52:41.450Z
acceptance:
  - text: "для каждого пункта — вердикт с цитатой файла и строки (file:line), без общих слов"
    done: false
  - text: "если найдено расхождение текста с кодом или правило, которое противоречит другому правилу, оно названо и оценено: блокер или замечание"
    done: false
  - text: "отдельно проверено, что ни один документ не обещает Headroom как поставку и не обещает команду, которой больше нет"
    done: false
  - text: "отдельно проверено, что новые тексты не выдают измерение за свойство кода: числа 9 срабатываний, 125 280 Б → 17 050 Б, 129 сессий, 75% совпадают с записью docs/analysis/context-output-economy.json или расходятся с ней"
    done: false
  - text: "вердикт по изменению: APPROVE / APPROVE с замечаниями / REQUEST CHANGES, и названы проверки, которые ты НЕ делал"
    done: false
boardId: task-mwkipz34-ut3fps
nonScope: ["plugins/designmap/** и docs/TERMINOLOGY.md — параллельная чужая работа, не ревьюить и не считать дефектом", "любые правки файлов, коммиты, установка тарболов, перезапуск :3080", "история в docs/cases/, reports/, .dsh/, .cache/"]
owner:
  kind: agent
  label: REVIEWER
  sessionId: 33f5d04c-f688-4787-99f7-082a1c9ae2ac
ownerRole: REVIEWER
preset: reviewer
resultEvidence: ["повторно воспроизведены гейты: rtk-selftest PASS, check-documentation ok, check-portability 16/17 с единственным FAIL по designmap", "замечания с адресами: plugins/orchestrator/orchestrator.mjs:437 (ложное «no filter covers» для find), plugins/rtk/README.md:47 (неполный список), plugins/rtk/rtk.mjs:532-533 (неточность про `;`), «129 sessions» отсутствует в записи анализа", "вердикт APPROVE с замечаниями, блокеров нет"]
resultSummary: "Независимое ревью: блокеров нет, четыре замечания к текстам и доказательной связи. Замечания 1, 2 и 5 исправлены в исходниках и перепакованы; 3 и 4 закрыты правкой записи анализа (размер выборки 129 сессий и ниша git log/git diff приведены к измерению)."
role: REVIEWER
scope: ["незакоммиченный diff по перечисленным 20 файлам (включая удаления и новые тарболы)", "сверка текстов промптов с кодом плагинов rtk и orchestrator", "сверка документов на обещания удалённых команд", "проверка, что gates check-documentation и rtk-selftest действительно проходят"]
---

Независимо проверить незакоммиченное изменение кита, которое удаляет Headroom, сужает раздел промпта RTK до измеренной ниши и добавляет правило чтения файлов инструментами: сходятся ли новые тексты с поведением кода, не осталось ли документов, обещающих удалённое, и нет ли правок вне объявленного объёма. Вернуть вердикт APPROVE / APPROVE с замечаниями / REQUEST CHANGES с цитатами file:line.

Migrated from .dsh/taskboard.json (task task-mwkipz34-ut3fps, revision 7).
