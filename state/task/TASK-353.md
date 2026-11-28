---
id: TASK-353
kind: task
title: "Освободить корень: карта диска, безопасная чистка, размер ленты сессии"
status: done
revision: 6
createdAt: 2026-11-27T14:58:03.922Z
updatedAt: 2026-11-27T15:37:56.474Z
acceptance:
  - text: "Карта диска: `df -h /`, `du -xh --max-depth=2 / 2>/dev/null | sort -h | tail -30`, и отдельно размеры `/home/iustimov/{.cache,.npm,.local,dsh-kit}`, `/var/lib/docker`, `/var/log`, `/tmp`, внутри кита — `reports/`, `.dsh/npm-cache`, все `node_modules`, сумма `plugins/*.tgz`, `docs/cases/runs/` — числа процитированы."
    done: false
  - text: "Список безопасного к удалению с размерами (кэши пакетных менеджеров, временные артефакты сборки, `/tmp` старше суток, кэш Playwright, `.cache`, `.playwright-mcp`, `.a5c`, `.usage-analysis`, устаревшие логи сессий сверх последних N) и список запретного (state/, docs/, plugins/*.tgz, исходники, git-отслеживаемое, чужие проекты, образы docker)."
    done: false
  - text: "Удалено только из списка безопасного: каждый путь и его размер до удаления, `df -h /` до и после; цель ≥20 ГБ или объяснение, почему нельзя."
    done: false
  - text: "Защищённое цело: `git status --short` в ките до/после совпадает по набору путей; число файлов в `state/` и `docs/cases/` до/после процитировано."
    done: false
  - text: "Отдельно, только чтение: размер лога этой сессии `session-fe097c33-7034-422a-aec2-67cc91eaefa2`, число записей в нём, и топ-5 логов сессий по размеру — чтобы понять, сколько интерфейс грузит, открывая чат."
    done: false
  - text: "Всё неочевидное (образы, снапшоты, чужие кэши, `.babysitter` 627 МБ) не удалять, а назвать с размером и отдать решение владельцу."
    done: false
boardId: task-mwz3vrqf-4h932f
nonScope: ["Не удалять ничего из state/, docs/, plugins/*.tgz и исходников.", "Не останавливать сервисы и не чистить journal.", "Не менять код и профиль."]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-277]
resultEvidence: ["df / до и после: /dev/nvme0n1p2 916G, занято 855G → 821G, свободно 15G → 49G (99 % → 95 %).", "Карта: / 824G, /home 738G, /tmp 34G; в домашнем — SERV_DATA 172G, tasks 154G, clouds_data 117G, Music 66G, miniconda3 66G, .cache 31G (до чистки), .npm 11G; кит 1.1G, plugins/*.tgz 2.0M, node_modules 697M, reports/ 170M, .dsh/npm-cache 31M.", "Удалено (до удаления проверено, что пути никто не держит — скан /proc/*/cwd и /proc/*/fd): .cache/uv 11G, .npm/_cacache 2.9G, /tmp/mainfiles 1.5G, /tmp/headcheck 2.6G, /tmp/strict-commit 3.3G, /tmp/strict-final 3.3G, /tmp/vg-head 3.3G, /tmp/vg-parent 3.3G, /tmp/cc-wrong-product 4.1G, /tmp/autolabel-head-a5de96… 3.3G; итог 34 ГБ.", "Защищённое цело: git status --short 76 строк до и после, diff пуст; state/ 1018 файлов (было 1018), docs/cases/ 631 (было 631), plugins/*.tgz 29 файлов 2.0M; сервер жив, GET /api/settings/describe 1.9 мс.", "Не тронуто и отдано владельцу: .babysitter 627M, .cache/huggingface 10G, .npm/dsh 5.0G (428 сессий), .cache/ms-playwright 1.4G, Trash 1.6G, .local/share/pnpm 2.2G, /tmp/base-check и /tmp/head-check (связанные worktree чужого репозитория).", "Лента этой сессии: 2 170 284 байт сжато / 7 643 449 распаковано / 1632 записи; топ-5 логов 35/26/25/25/23 МБ — в проекте autolabel_pipeline."]
resultSummary: "Корень выведен из предела: освобождено 34 ГБ, занято 855 → 821 ГБ, свободно 15 → 49 ГБ (99 → 95 %). Удалялись только кэши пакетных менеджеров (.cache/uv 11 ГБ, .npm/_cacache 2.9 ГБ) и временные копии завершённых прогонов в /tmp (20 ГБ), каждая после проверки, что её никто не держит. Защищённое цело: git status построчно совпадает, state/ 1018 файлов, docs/cases 631, 29 сборок плагинов. Лента этой сессии — 2.17 МБ сжато / 7.6 МБ распаковано / 1632 записи, то есть 30 секунд загрузки чата ею не объясняются."
role: BACKEND
scope: [/tmp/triage/]
---

Корень заполнен на 99 % (15 ГБ из 916) — единственный ресурс у предела. Снять карту диска, показать безопасный список к удалению с размерами, освободить ≥20 ГБ только из кэшей и временных артефактов, ничего из проекта не тронув. Отдельно измерить размер ленты этой сессии: интерфейс грузит её при открытии, и это подозреваемый в 30 секундах.
