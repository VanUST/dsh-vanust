---
id: TASK-269
kind: task
title: "Коммит и push изменений в origin/main"
status: active
revision: 2
createdAt: 2026-11-20T14:21:31.116Z
updatedAt: 2026-11-20T14:21:31.504Z
boardId: task-mwp2hsqd-ssld7u
chore: true
choreReason: "Публикация уже сделанных изменений: коммит и push в origin по прямой просьбе владельца, без правок кода."
nonScope: ["Не менять код и конфигурацию — только git add/commit/push", "Не перезаписывать историю (никаких --amend, --force, rebase) и не трогать другие ветки", "Не коммитить игнорируемое: .dsh/, .cache/, node_modules, docs/cases/runs/ — проверь, что они не попали в индекс"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 13d7e613-7524-4d67-98a4-6063d061fc6f
preset: backend
role: BACKEND
scope: ["git add/commit/push в текущем дереве", "ветка main, origin https://github.com/VanUST/dsh-vanust/"]
sessions:
  - sessionId: 13d7e613-7524-4d67-98a4-6063d061fc6f
    label: BACKEND
    role: BACKEND
    status: active
---

Закоммитить и запушить изменения рабочего дерева dsh-kit в origin/main. Шаги: (1) `git status --porcelain` и `git diff --stat` — снять полную картину; отдельно проверить, что игнорируемые каталоги (.dsh/, .cache/, node_modules/) не попадают в индекс; (2) `git log --oneline -8` — посмотреть стиль сообщений и следовать ему; (3) добавить все неигнорируемые изменения (включая новые файлы scripts/dsh-wrapper.ps1, scripts/test-all.mjs, docs/review/**, docs/analysis/harness-hardening-non-ui.json, state/**) и напечатать список того, что попало в индекс, числом и первыми строками; (4) один коммит с сообщением, объясняющим суть: устойчивость без изменения интерфейса — восстановление проекции, жизненный цикл задачи, один писатель доски, проверки на пустом входе и make test, установка/откат/Windows-обёртка, маршрут architect на gpt-6.2-sol; в теле перечислить по пунктам и назвать доказательства (make verify 19/19, make test 70/70); (5) push по процедуре навыка — retry с HTTP/1.1 и HTTP/1.0, код возврата читать только из файла, не через pipe; (6) проверить, что refs/heads/main на origin равен локальному `git rev-parse HEAD` (ls-remote с повторами), и напечатать оба хеша; (7) финальный `git status --porcelain` — что осталось и почему.
