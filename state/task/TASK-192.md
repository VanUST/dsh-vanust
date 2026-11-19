---
id: TASK-192
kind: task
title: "P0.6: Аудит на компонент ratchet"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.870Z
updatedAt: 2026-11-17T15:52:41.870Z
acceptance:
  - text: "результат поиска записан с командами"
    done: false
  - text: "при отсутствии компонента — сказано, что заменён и когда"
    done: false
boardId: task-mwknzcym-rtkk7u
inline: true
nonScope: ["удаление чего-либо", "интеграция ratchet"]
resultEvidence: ["find . -iname '*ratchet*' (без node_modules/.git) → пусто", "grep по plugins/ profile/ rules/ scripts/ docs/ Makefile README.md USERGUIDE.md install.sh start.sh NOTICE → только baseline ratchet библиотеки кейсов (другое понятие)", "git show --stat 0914fcd (2026-09-30) → удалены .dsh/ratchet/ledger.jsonl, .dsh/ratchet/specs.json, .dsh/ratchet/state.json, docs/RATCHET-*.md, docs/CRITIC-RATCHET.md", "grep по ~/.npm/dsh/cordis.patch.yml и ~/.npm/dsh/profiles/web/package.json → компонента нет"]
resultSummary: "Компонента ratchet нет ни в ките, ни в установленном профиле: он заменён человеческими спецификациями 2026-09-30 (0914fcd). Единственное совпадение по слову — baseline ratchet библиотеки кейсов, это другое понятие. Удалять нечего."
scope: ["поиск по репозиторию кита", "поиск по ~/.npm/dsh", "история git"]
---

Выполнить пункт P0.6 дизайна: найти, есть ли в ките, установленном профиле или рабочем пространстве компонент ratchet. По дизайну ratchet депрекейтед: при обнаружении — отчёт владельцу и задача на удаление, не интеграция.

Migrated from .dsh/taskboard.json (task task-mwknzcym-rtkk7u, revision 4).
